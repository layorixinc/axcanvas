import { GraphError } from './store.ts';
import { graphViewSchema, type Graph, type GraphView, type DraftOperation, type ReviewChange, type Stroke } from './schema.ts';

export type DraftWork = { graph: GraphView; note: string; strokes: Stroke[]; nodeIds: string[]; routeOrigin?: GraphView };
export function graphView(graph: Graph): GraphView { const { graphId: _id, ...view } = graph; return view; }
export function stable(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
export function validateWork(work: DraftWork) {
  graphViewSchema.parse(work.graph);
  const g = work.graph;
  const nodes = new Map(g.nodes.map(node => [node.id, node]));
  const edges = new Map(g.edges.map(edge => [edge.id, edge]));
  if (nodes.size !== g.nodes.length || edges.size !== g.edges.length) throw new GraphError('INVALID_GRAPH', 'Duplicate graph IDs');
  for (const edge of g.edges) {
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    if (!source || !target) throw new GraphError('INVALID_GRAPH', `Relation endpoint missing: ${edge.id}`);
    if (edge.status === 'active' && (source.status === 'retired' || target.status === 'retired')) throw new GraphError('INVALID_GRAPH', `Active relation ${edge.id} has a retired endpoint; retire the relation or restore the node`);
  }
  for (const id of Object.keys(g.positions)) if (!nodes.has(id)) throw new GraphError('INVALID_LAYOUT', `Unknown layout node: ${id}`);
  for (const id of Object.keys(g.routes)) if (edges.get(id)?.status !== 'active') throw new GraphError('INVALID_LAYOUT', `Unknown or retired routed edge: ${id}`);
  if (new Set(work.nodeIds).size !== work.nodeIds.length) throw new GraphError('INVALID_GRAPH', 'Duplicate selected node IDs');
  for (const id of work.nodeIds) if (!nodes.has(id)) throw new GraphError('INVALID_GRAPH', `Unknown feedback node: ${id}`);
}
export function applyOperation(work: DraftWork, base: GraphView, operation: DraftOperation): DraftWork {
  if (work.strokes.length) {
    const existingNode = operation.type === 'node' ? work.graph.nodes.find(node => node.id === operation.node.id) : undefined;
    const changesGeometry = operation.type === 'move' || operation.type === 'layout' || operation.type === 'retire_node'
      || (operation.type === 'node' && (!existingNode
        || (operation.node.status === 'retired' && existingNode.status !== 'retired')
        || (operation.position !== undefined && !same(operation.position, work.graph.positions[operation.node.id]))));
    if (changesGeometry) throw new GraphError('VALIDATION_FAILED', 'Clear drawings with an instruction operation before changing geometry, or submit the reviewed draft first. Drawings retain their captured coordinates.');
  }
  const next = structuredClone(work), g = next.graph;
  if (operation.type !== 'layout' && operation.type !== 'instruction' && !next.routeOrigin) next.routeOrigin = structuredClone(g);
  const node = (id: string) => { const n = g.nodes.find(n => n.id === id); if (!n) throw new GraphError('INVALID_GRAPH', `Unknown node: ${id}`); return n; };
  const retireEdge = (id: string) => {
    const edge = g.edges.find(e => e.id === id);
    if (!edge) throw new GraphError('INVALID_GRAPH', `Unknown edge: ${id}`);
    if (base.edges.some(e => e.id === id)) edge.status = 'retired';
    else g.edges = g.edges.filter(e => e.id !== id);
  };
  switch (operation.type) {
    case 'node': {
      const index = g.nodes.findIndex(n => n.id === operation.node.id);
      if (index < 0) g.nodes.push(operation.node); else g.nodes[index] = operation.node;
      if (operation.position) g.positions[operation.node.id] = operation.position;
      if (operation.node.status === 'retired') for (const edge of [...g.edges]) if (edge.source === operation.node.id || edge.target === operation.node.id) retireEdge(edge.id);
      g.routes = {}; break;
    }
    case 'edge': {
      const index = g.edges.findIndex(e => e.id === operation.edge.id);
      if (index < 0) g.edges.push(operation.edge); else g.edges[index] = operation.edge;
      g.routes = {}; break;
    }
    case 'retire_node': {
      const n = node(operation.nodeId);
      for (const edge of [...g.edges]) if (edge.source === n.id || edge.target === n.id) retireEdge(edge.id);
      if (base.nodes.some(old => old.id === n.id)) n.status = 'retired';
      else { g.nodes = g.nodes.filter(old => old.id !== n.id); delete g.positions[n.id]; next.nodeIds = next.nodeIds.filter(id => id !== n.id); }
      g.routes = {}; break;
    }
    case 'retire_edge': retireEdge(operation.edgeId); g.routes = {}; break;
    case 'move': node(operation.nodeId); g.positions[operation.nodeId] = operation.position; g.routes = {}; break;
    case 'layout': g.positions = operation.positions; g.routes = operation.routes; g.layoutDirection = operation.direction; delete next.routeOrigin; break;
    case 'instruction': next.note = operation.note; next.strokes = operation.strokes; next.nodeIds = operation.nodeIds; break;
  }
  if (next.routeOrigin) {
    const origin = next.routeOrigin;
    const nodes = Object.fromEntries(g.nodes.map(item => [item.id, item]));
    const edges = Object.fromEntries(g.edges.map(item => [item.id, item]));
    if (same(nodes, Object.fromEntries(origin.nodes.map(item => [item.id, item]))) && same(edges, Object.fromEntries(origin.edges.map(item => [item.id, item]))) && same(g.positions, origin.positions)) {
      g.routes = origin.routes;
      delete next.routeOrigin;
    }
  }
  validateWork(next);
  return next;
}
export function diff(base: GraphView, work: DraftWork): ReviewChange[] {
  const changes: ReviewChange[] = [];
  const add = (entity: ReviewChange['entity'], id: string, before: unknown, after: unknown) => {
    if (same(before, after)) return;
    const retired = (entity === 'node' || entity === 'edge') && (after as { status?: string } | undefined)?.status === 'retired';
    changes.push({ entity, id, change: before === undefined ? 'added' : after === undefined ? 'removed' : retired ? 'retired' : 'modified', before: before ?? null, after: after ?? null });
  };
  for (const [entity, oldItems, newItems] of [['node', base.nodes, work.graph.nodes], ['edge', base.edges, work.graph.edges]] as const) {
    const old = new Map<string, unknown>(oldItems.map(item => [item.id, item]));
    const next = new Map<string, unknown>(newItems.map(item => [item.id, item]));
    for (const id of new Set([...old.keys(), ...next.keys()])) add(entity, id, old.get(id), next.get(id));
  }
  for (const id of new Set([...Object.keys(base.positions), ...Object.keys(work.graph.positions)])) add('position', id, base.positions[id], work.graph.positions[id]);
  add('layout', 'routes', base.routes, work.graph.routes);
  add('layout', 'direction', base.layoutDirection, work.graph.layoutDirection);
  if (work.note.trim() || work.strokes.length) add('instruction', 'instructions', { note: '', strokes: [], nodeIds: [] }, { note: work.note, strokes: work.strokes, nodeIds: work.nodeIds });
  return changes;
}

// Merge fields rather than entire entities so unrelated edits on one node survive.
export function mergeGraph(base: GraphView, draft: GraphView, latest: GraphView, resolution: 'fail' | 'draft' | 'latest'): { graph: GraphView; conflicts: string[] } {
  const conflicts: string[] = [];
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  const merge = (before: unknown, local: unknown, remote: unknown, path: string): unknown => {
    if (same(local, before)) return remote;
    if (same(remote, before) || same(local, remote)) return local;
    if (object(before) && object(local) && object(remote)) {
      const result: Record<string, unknown> = Object.create(null);
      for (const key of new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(remote)])) {
        const value = merge(Object.hasOwn(before, key) ? before[key] : undefined, Object.hasOwn(local, key) ? local[key] : undefined, Object.hasOwn(remote, key) ? remote[key] : undefined, `${path}.${key}`);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    conflicts.push(path); return resolution === 'latest' ? remote : local;
  };
  const keyed = <T extends { id: string }>(items: T[]) => Object.fromEntries(items.map(item => [item.id, item]));
  const graph: GraphView = structuredClone(latest);
  graph.nodes = Object.values(merge(keyed(base.nodes), keyed(draft.nodes), keyed(latest.nodes), 'nodes') as Record<string, GraphView['nodes'][number]>);
  graph.edges = Object.values(merge(keyed(base.edges), keyed(draft.edges), keyed(latest.edges), 'edges') as Record<string, GraphView['edges'][number]>);
  graph.positions = merge(base.positions, draft.positions, latest.positions, 'positions') as GraphView['positions'];
  graph.routes = merge(base.routes, draft.routes, latest.routes, 'routes') as GraphView['routes'];
  graph.layoutDirection = merge(base.layoutDirection, draft.layoutDirection, latest.layoutDirection, 'layoutDirection') as GraphView['layoutDirection'];
  // Retirement and concurrent edge creation conflict across entity boundaries.
  for (const edge of [...graph.edges]) {
    const invalid = [edge.source, edge.target].filter(id => !graph.nodes.some(node => node.id === id && (edge.status !== 'active' || node.status !== 'retired')));
    if (!invalid.length) continue;
    conflicts.push(`edges.${edge.id}.endpoints`);
    const chosen = resolution === 'latest' ? latest : draft;
    const chosenEdge = chosen.edges.find(item => item.id === edge.id);
    graph.edges = graph.edges.filter(item => item.id !== edge.id);
    if (chosenEdge) {
      graph.edges.push(structuredClone(chosenEdge));
      for (const id of [chosenEdge.source, chosenEdge.target]) {
        const chosenNode = chosen.nodes.find(node => node.id === id);
        const mergedNode = graph.nodes.find(node => node.id === id);
        if (chosenNode && !mergedNode) graph.nodes.push(structuredClone(chosenNode));
        else if (chosenNode && mergedNode && chosenEdge.status === 'active' && mergedNode.status === 'retired') mergedNode.status = chosenNode.status;
      }
    }
  }
  // Routes cannot describe a merged semantic graph or a different coordinate frame.
  if (!same(graph.nodes, latest.nodes) || !same(graph.edges, latest.edges) || !same(graph.positions, latest.positions)) {
    if (!same(graph.nodes, draft.nodes) || !same(graph.edges, draft.edges) || !same(graph.positions, draft.positions)) graph.routes = {};
  }
  const nodeIds = new Set(graph.nodes.map(node => node.id));
  for (const id of Object.keys(graph.positions)) if (!nodeIds.has(id)) delete graph.positions[id];
  for (const id of Object.keys(graph.routes)) if (!graph.edges.some(edge => edge.id === id && edge.status === 'active')) delete graph.routes[id];
  return { graph, conflicts: [...new Set(conflicts)] };
}
