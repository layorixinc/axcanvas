import { GraphError } from './store.ts';
import { flowSchema, type GraphView, type ViewLayout } from './schema.ts';

export function flowView(graph: GraphView, flowId: string | null = null) {
  const flow = flowId === null ? null : graph.flows.find(item => item.id === flowId && item.status === 'active');
  if (flowId !== null && !flow) throw new GraphError('INVALID_GRAPH', `Unknown or retired flow: ${flowId}`);
  const scoped = flow && flow.scope !== 'graph' ? flow : null;
  const nodes = graph.nodes.filter(node => node.status !== 'retired' && (!scoped || scoped.nodeIds.includes(node.id)));
  const edges = graph.edges.filter(edge => edge.status === 'active' && (!scoped || scoped.edgeIds.includes(edge.id)));
  const layout = scoped ? graph.flowLayouts[scoped.id] : undefined;
  const positions = scoped ? layout?.positions ?? Object.fromEntries(nodes.filter(node => graph.positions[node.id]).map(node => [node.id, graph.positions[node.id]])) : graph.positions;
  return { flow, flowId: scoped?.id ?? null, nodes, edges, positions, routes: scoped ? layout?.routes ?? {} : graph.routes, direction: scoped ? layout?.direction ?? null : graph.layoutDirection };
}
export function annotationFrame(graph: GraphView, flowId: string | null = null) {
  const view = flowView(graph, flowId);
  return { flowId: view.flowId, nodeIds: view.nodes.map(node => node.id).sort(), edgeIds: view.edges.map(edge => edge.id).sort(), positions: Object.fromEntries(view.nodes.map(node => [node.id, view.positions[node.id] ?? null])) };
}
export function validateFlows(graph: GraphView) {
  const seen = new Set<string>(), scopes = new Set<string>();
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const edges = new Map(graph.edges.map(edge => [edge.id, edge]));
  for (const flow of graph.flows) {
    flowSchema.parse(flow);
    if (seen.has(flow.id)) throw new GraphError('INVALID_GRAPH', `Duplicate flow ID: ${flow.id}`);
    seen.add(flow.id);
    if (flow.status !== 'active') continue;
    const key = flow.scope === 'graph' ? 'graph' : flow.scope === 'turn' ? `turn:${flow.turnId}` : null;
    if (key && scopes.has(key)) throw new GraphError('INVALID_GRAPH', `Only one active flow is allowed for ${key}`);
    if (key) scopes.add(key);
    const member = (id: string) => nodes.has(id) && nodes.get(id)!.status !== 'retired' && (flow.scope === 'graph' || flow.nodeIds.includes(id));
    for (const id of [...flow.nodeIds, ...flow.startNodeIds, ...flow.endNodeIds]) if (!member(id)) throw new GraphError('INVALID_GRAPH', `Flow ${flow.id} references missing, retired or nonmember node ${id}; repair membership/roles or retire the flow`, { fieldErrors: [{ path: `flows.${flow.id}.nodeIds`, message: `Invalid member or boundary: ${id}` }] });
    for (const id of flow.edgeIds) {
      const edge = edges.get(id);
      if (!edge || edge.status !== 'active' || !member(edge.source) || !member(edge.target)) throw new GraphError('INVALID_GRAPH', `Flow ${flow.id} has invalid member edge ${id}; include active endpoints or repair/retire the flow`);
    }
  }
  for (const [id, layout] of Object.entries(graph.flowLayouts)) validateGeometry(graph, id, layout);
}
export function validateGeometry(graph: GraphView, flowId: string | null, layout: ViewLayout) {
  const view = flowView(graph, flowId);
  if (flowId !== null && view.flowId === null) throw new GraphError('INVALID_LAYOUT', 'Graph scope uses global geometry');
  for (const id of Object.keys(layout.positions)) if (!view.nodes.some(node => node.id === id)) throw new GraphError('INVALID_LAYOUT', `Unknown, retired or nonmember layout node: ${id}`);
  for (const id of Object.keys(layout.routes)) if (!view.edges.some(edge => edge.id === id)) throw new GraphError('INVALID_LAYOUT', `Unknown, retired or nonmember routed edge: ${id}`);
}
export function invalidateFlowRoutes(graph: GraphView) {
  for (const layout of Object.values(graph.flowLayouts)) layout.routes = {};
}
export function pruneFlowLayouts(graph: GraphView) {
  for (const [id, layout] of Object.entries(graph.flowLayouts)) {
    const flow = graph.flows.find(flow => flow.id === id && flow.status === 'active' && flow.scope !== 'graph');
    if (!flow) { delete graph.flowLayouts[id]; continue; }
    for (const nodeId of Object.keys(layout.positions)) if (!flow.nodeIds.includes(nodeId) || !graph.nodes.some(node => node.id === nodeId && node.status !== 'retired')) delete layout.positions[nodeId];
    for (const edgeId of Object.keys(layout.routes)) if (!flow.edgeIds.includes(edgeId) || !graph.edges.some(edge => edge.id === edgeId && edge.status === 'active')) delete layout.routes[edgeId];
  }
}
