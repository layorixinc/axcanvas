import { GraphError } from './store.ts';
import { graphViewSchema, type Graph, type GraphView, type DraftOperation, type DraftLeafOperation, type ReviewChange, type Stroke } from './schema.ts';
import { flowView, annotationFrame, validateFlows, validateGeometry, invalidateFlowRoutes, pruneFlowLayouts } from './flows.ts';
import { mergeRegionGeometry } from '../public/regions.js';

export type DraftWork = { graph: GraphView; note: string; strokes: Stroke[]; nodeIds: string[]; captureFlowId?: string | null; routeOrigin?: GraphView };
export function graphView(graph: Graph): GraphView { const { graphId: _id, ...view } = graph; return { ...view, flows: view.flows ?? [], flowLayouts: view.flowLayouts ?? {} }; }
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
  validateFlows(g);
  if (work.captureFlowId) {
    const view = flowView(g, work.captureFlowId);
    for (const id of work.nodeIds) if (!view.nodes.some(node => node.id === id)) throw new GraphError('INVALID_GRAPH', `Feedback node ${id} is not an active member of the captured flow`);
  }
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
  const next = structuredClone(work);
  if (operation.type === 'batch') for (const leaf of operation.operations) applyLeaf(next, base, leaf);
  else applyLeaf(next, base, operation);
  validateWork(next);
  return next;
}
function applyLeaf(work: DraftWork, base: GraphView, operation: DraftLeafOperation): DraftWork {
  const captured = work.strokes.length ? annotationFrame(work.graph, work.captureFlowId ?? null) : null;
  const next = work, g = next.graph;
  const scope = 'flowId' in operation && operation.type !== 'retire_flow' ? flowView(g, operation.flowId ?? null) : null;
  const scoped = scope?.flowId ? scope.flow! : null;
  const geometry = () => {
    if (!scoped) return null;
    return g.flowLayouts[scoped.id] ??= { positions: { ...scope!.positions }, routes: {}, direction: null };
  };
  if (!['layout', 'layout_region', 'instruction'].includes(operation.type) && !next.routeOrigin) next.routeOrigin = structuredClone(g);
  const node = (id: string) => { const n = g.nodes.find(n => n.id === id); if (!n) throw new GraphError('INVALID_GRAPH', `Unknown node: ${id}`); return n; };
  const cleanMembership = (id: string, edge: boolean) => {
    if (!edge) next.nodeIds = next.nodeIds.filter(value => value !== id);
    for (const flow of g.flows) {
      if (edge) flow.edgeIds = flow.edgeIds.filter(value => value !== id);
      else {
        flow.nodeIds = flow.nodeIds.filter(value => value !== id);
        flow.startNodeIds = flow.startNodeIds.filter(value => value !== id);
        flow.endNodeIds = flow.endNodeIds.filter(value => value !== id);
      }
    }
  };
  const retireEdge = (id: string) => {
    const edge = g.edges.find(e => e.id === id);
    if (!edge) throw new GraphError('INVALID_GRAPH', `Unknown edge: ${id}`);
    if (base.edges.some(e => e.id === id)) edge.status = 'retired';
    else g.edges = g.edges.filter(e => e.id !== id);
    cleanMembership(id, true);
  };
  switch (operation.type) {
    case 'node': {
      const index = g.nodes.findIndex(n => n.id === operation.node.id);
      const previous = g.nodes[index];
      const updated = { ...operation.node, ...(operation.node.tags === undefined && previous?.tags !== undefined ? { tags: previous.tags } : {}), ...(operation.node.tagColors === undefined && previous?.tagColors !== undefined ? { tagColors: previous.tagColors } : {}) };
      if (index < 0) g.nodes.push(updated); else g.nodes[index] = updated;
      if (scoped && !scoped.nodeIds.includes(operation.node.id)) scoped.nodeIds.push(operation.node.id);
      if (operation.position) (geometry()?.positions ?? g.positions)[operation.node.id] = operation.position;
      if (operation.node.status === 'retired') {
        cleanMembership(operation.node.id, false);
        for (const edge of [...g.edges]) if (edge.source === operation.node.id || edge.target === operation.node.id) retireEdge(edge.id);
      }
      g.routes = {}; break;
    }
    case 'edge': {
      const index = g.edges.findIndex(e => e.id === operation.edge.id);
      if (index < 0) g.edges.push(operation.edge); else g.edges[index] = operation.edge;
      if (scoped && !scoped.edgeIds.includes(operation.edge.id)) scoped.edgeIds.push(operation.edge.id);
      if (operation.edge.status === 'retired') cleanMembership(operation.edge.id, true);
      g.routes = {}; break;
    }
    case 'retire_node': {
      const n = node(operation.nodeId);
      for (const edge of [...g.edges]) if (edge.source === n.id || edge.target === n.id) retireEdge(edge.id);
      cleanMembership(n.id, false);
      if (base.nodes.some(old => old.id === n.id)) n.status = 'retired';
      else { g.nodes = g.nodes.filter(old => old.id !== n.id); delete g.positions[n.id]; next.nodeIds = next.nodeIds.filter(id => id !== n.id); }
      g.routes = {}; break;
    }
    case 'retire_edge': retireEdge(operation.edgeId); g.routes = {}; break;
    case 'flow': {
      const index = g.flows.findIndex(flow => flow.id === operation.flow.id);
      if (index < 0) g.flows.push(operation.flow); else g.flows[index] = operation.flow;
      g.routes = {}; break;
    }
    case 'retire_flow': {
      const flow = g.flows.find(flow => flow.id === operation.flowId);
      if (!flow) throw new GraphError('INVALID_GRAPH', `Unknown flow: ${operation.flowId}`);
      if (base.flows.some(old => old.id === flow.id)) flow.status = 'retired';
      else g.flows = g.flows.filter(old => old.id !== flow.id);
      delete g.flowLayouts[flow.id]; g.routes = {}; break;
    }
    case 'move': {
      node(operation.nodeId);
      if (scope && !scope.nodes.some(node => node.id === operation.nodeId)) throw new GraphError('INVALID_LAYOUT', 'Moved node must be an active member of this view');
      const layout = geometry();
      if (layout) { layout.positions[operation.nodeId] = operation.position; layout.routes = {}; }
      else { g.positions[operation.nodeId] = operation.position; g.routes = {}; }
      break;
    }
    case 'layout_region': {
      const ids = new Set(operation.nodeIds), positioned = Object.keys(operation.positions), region = scope ?? flowView(g);
      if (positioned.length !== ids.size || positioned.some(id => !ids.has(id))) throw new GraphError('INVALID_LAYOUT', 'Region positions must exactly match its nodeIds');
      validateGeometry(g, region.flowId, { positions: operation.positions, routes: operation.routes, direction: null });
      const edges = new Map(region.edges.map(edge => [edge.id, edge]));
      for (const id of Object.keys(operation.routes)) {
        const edge = edges.get(id);
        if (!edge || !ids.has(edge.source) || !ids.has(edge.target)) throw new GraphError('INVALID_LAYOUT', 'Region routes must connect region nodes only');
      }
      const layout = mergeRegionGeometry(region, operation.nodeIds, operation.positions, operation.routes);
      if (scoped) g.flowLayouts[scoped.id] = layout;
      else { g.positions = layout.positions; g.routes = layout.routes; }
      delete next.routeOrigin; break;
    }
    case 'layout': {
      validateGeometry(g, scope?.flowId ?? null, operation);
      if (scoped) g.flowLayouts[scoped.id] = { positions: operation.positions, routes: operation.routes, direction: operation.direction };
      else { g.positions = operation.positions; g.routes = operation.routes; g.layoutDirection = operation.direction; }
      delete next.routeOrigin; break;
    }
    case 'instruction': {
      const flowId = scope?.flowId ?? null;
      if (work.strokes.length && operation.strokes.length && flowId !== (work.captureFlowId ?? null)) throw new GraphError('VALIDATION_FAILED', 'Clear captured drawings before switching annotation views');
      next.note = operation.note; next.strokes = operation.strokes; next.nodeIds = operation.nodeIds; next.captureFlowId = flowId; break;
    }
  }
  if (!['layout', 'layout_region', 'move', 'instruction'].includes(operation.type)) invalidateFlowRoutes(g);
  pruneFlowLayouts(g);
  if (captured && operation.type !== 'instruction' && !same(captured, annotationFrame(g, work.captureFlowId ?? null))) throw new GraphError('VALIDATION_FAILED', 'Clear drawings before changing their captured view membership or geometry');
  if (next.routeOrigin) {
    const origin = next.routeOrigin;
    // A transient scoped node must not materialize an otherwise unsaved view.
    for (const [id, layout] of Object.entries(g.flowLayouts)) {
      if (Object.hasOwn(origin.flowLayouts, id) || !origin.flows.some(flow => flow.id === id && flow.status === 'active' && flow.scope !== 'graph')) continue;
      const fallback = flowView(origin, id);
      if (same(layout, { positions: fallback.positions, routes: {}, direction: null })) delete g.flowLayouts[id];
    }
    const semantics = (view: GraphView) => ({ nodes: Object.fromEntries(view.nodes.map(item => [item.id, item])), edges: Object.fromEntries(view.edges.map(item => [item.id, item])), flows: Object.fromEntries(view.flows.map(item => [item.id, item])), positions: view.positions, layouts: Object.fromEntries(Object.entries(view.flowLayouts).map(([id, layout]) => [id, { ...layout, routes: {} }])) });
    if (same(semantics(g), semantics(origin))) { g.routes = origin.routes; g.flowLayouts = origin.flowLayouts; delete next.routeOrigin; }
  }
  return next;
}
export function diff(base: GraphView, work: DraftWork): ReviewChange[] {
  const changes: ReviewChange[] = [];
  const add = (entity: ReviewChange['entity'], id: string, before: unknown, after: unknown) => {
    if (same(before, after)) return;
    const retired = (entity === 'node' || entity === 'edge' || entity === 'flow') && (after as { status?: string } | undefined)?.status === 'retired';
    changes.push({ entity, id, change: before === undefined ? 'added' : after === undefined ? 'removed' : retired ? 'retired' : 'modified', before: before ?? null, after: after ?? null });
  };
  for (const [entity, oldItems, newItems] of [['node', base.nodes, work.graph.nodes], ['edge', base.edges, work.graph.edges], ['flow', base.flows, work.graph.flows]] as const) {
    const old = new Map<string, unknown>(oldItems.map(item => [item.id, item]));
    const next = new Map<string, unknown>(newItems.map(item => [item.id, item]));
    for (const id of new Set([...old.keys(), ...next.keys()])) add(entity, id, old.get(id), next.get(id));
  }
  for (const id of new Set([...Object.keys(base.positions), ...Object.keys(work.graph.positions)])) add('position', id, base.positions[id], work.graph.positions[id]);
  for (const id of new Set([...Object.keys(base.flowLayouts), ...Object.keys(work.graph.flowLayouts)])) add('flow_layout', id, base.flowLayouts[id], work.graph.flowLayouts[id]);
  add('layout', 'routes', base.routes, work.graph.routes);
  add('layout', 'direction', base.layoutDirection, work.graph.layoutDirection);
  if (work.note.trim() || work.strokes.length) add('instruction', 'instructions', { note: '', strokes: [], nodeIds: [], captureFlowId: null }, { note: work.note, strokes: work.strokes, nodeIds: work.nodeIds, captureFlowId: work.captureFlowId ?? null });
  return changes;
}

// Merge fields rather than entire entities so unrelated edits on one node survive.
export function mergeGraph(base: GraphView, draft: GraphView, latest: GraphView, resolution: 'fail' | 'draft' | 'latest'): { graph: GraphView; conflicts: string[] } {
  const conflicts: string[] = [];
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  const merge = (before: unknown, local: unknown, remote: unknown, path: string): unknown => {
    if (same(local, before)) return remote;
    if (same(remote, before) || same(local, remote)) return local;
    if (/^flows\..+\.(nodeIds|edgeIds|startNodeIds|endNodeIds)$/.test(path) && Array.isArray(before) && Array.isArray(local) && Array.isArray(remote)) {
      const old = new Set(before), left = new Set(local), right = new Set(remote);
      return [...new Set([...before.filter(id => left.has(id) && right.has(id)), ...local.filter(id => !old.has(id)), ...remote.filter(id => !old.has(id))])];
    }
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
  graph.flows = structuredClone(Object.values(merge(keyed(base.flows), keyed(draft.flows), keyed(latest.flows), 'flows') as Record<string, GraphView['flows'][number]>));
  graph.flowLayouts = structuredClone(merge(base.flowLayouts, draft.flowLayouts, latest.flowLayouts, 'flowLayouts') as GraphView['flowLayouts']);
  for (const [id, layout] of Object.entries(graph.flowLayouts)) {
    const flow = graph.flows.find(flow => flow.id === id && flow.status === 'active' && flow.scope !== 'graph');
    if (!flow) continue;
    const frame = (view: GraphView) => {
      const definition = view.flows.find(item => item.id === id && item.status === 'active');
      if (!definition) return null;
      const selected = flowView(view, id);
      return { definition, nodes: selected.nodes, edges: selected.edges, positions: selected.positions };
    };
    if (!same(frame(graph), frame(latest)) && !same(frame(graph), frame(draft))) layout.routes = {};
  }
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
  const invalidFlows = new Set<string>();
  for (const [id, layout] of Object.entries(graph.flowLayouts)) {
    try { validateGeometry(graph, id, layout); }
    catch {
      // Concurrent membership/retirement must not silently discard authored geometry.
      if (!same(draft.flowLayouts[id], base.flowLayouts[id]) || !same(latest.flowLayouts[id], base.flowLayouts[id])) invalidFlows.add(id);
    }
  }
  pruneFlowLayouts(graph);
  const scopeOwners = new Map<string, string>();
  for (const flow of graph.flows) {
    try { validateFlows({ ...graph, flows: [flow], flowLayouts: {} }); }
    catch { invalidFlows.add(flow.id); }
    if (flow.status !== 'active' || flow.scope === 'custom') continue;
    const scope = flow.scope === 'graph' ? 'graph' : `turn:${flow.turnId}`;
    const owner = scopeOwners.get(scope);
    if (owner) { invalidFlows.add(owner); invalidFlows.add(flow.id); }
    else scopeOwners.set(scope, flow.id);
  }
  for (const id of invalidFlows) {
    conflicts.push(`flows.${id}.membership`);
    if (resolution === 'fail') continue;
    const chosen = resolution === 'latest' ? latest : draft;
    const flow = chosen.flows.find(flow => flow.id === id);
    graph.flows = graph.flows.filter(flow => flow.id !== id);
    delete graph.flowLayouts[id];
    if (!flow) continue;
    graph.flows.push(structuredClone(flow));
    if (chosen.flowLayouts[id]) graph.flowLayouts[id] = structuredClone(chosen.flowLayouts[id]);
    if (flow.status !== 'active') continue;
    for (const nodeId of new Set([...flow.nodeIds, ...flow.startNodeIds, ...flow.endNodeIds])) {
      const node = chosen.nodes.find(node => node.id === nodeId);
      if (node) { graph.nodes = graph.nodes.filter(item => item.id !== nodeId); graph.nodes.push(structuredClone(node)); }
    }
    for (const edgeId of flow.edgeIds) {
      const edge = chosen.edges.find(edge => edge.id === edgeId);
      if (edge) { graph.edges = graph.edges.filter(item => item.id !== edgeId); graph.edges.push(structuredClone(edge)); }
    }
  }
  return { graph, conflicts: [...new Set(conflicts)] };
}
