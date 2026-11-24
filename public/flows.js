/** @typedef {import('../src/schema.ts').Position} Position */
/** @typedef {import('../src/schema.ts').EdgeRoute} EdgeRoute */
/** @typedef {{id:string,scope:string,label:string,status?:string,nodeIds:string[],edgeIds:string[],startNodeIds:string[],endNodeIds:string[]}} Flow */
/** @typedef {{positions:Record<string,Position>,routes:Record<string,EdgeRoute>,direction:string|null}} ViewLayout */
/** @typedef {{nodes:{id:string,status:string}[],edges:{id:string,source:string,target:string,relation:string,status:string}[],flows?:Flow[],flowLayouts?:Record<string,ViewLayout>,positions?:Record<string,Position>,routes?:Record<string,EdgeRoute>,layoutDirection?:string|null}} SemanticGraph */

/** Select semantic membership and its independent geometry without inferring old flows.
 * @template {SemanticGraph['nodes'][number]} N
 * @template {SemanticGraph['edges'][number]} E
 * @param {Omit<SemanticGraph,'nodes'|'edges'> & {nodes:N[],edges:E[]}} graph @param {string|null} flowId
 */
export function flowView(graph, flowId = null) {
  const active = (graph.flows ?? []).filter(flow => flow.status !== 'retired');
  const flow = flowId === null ? active.find(flow => flow.scope === 'graph') ?? null : active.find(flow => flow.id === flowId);
  if (flow === undefined) throw new Error(`Unknown or retired flow: ${flowId}`);
  const scoped = flow !== null && flow.scope !== 'graph';
  const members = scoped ? new Set(flow.nodeIds) : null;
  const edgeIds = scoped ? new Set(flow.edgeIds) : null;
  const nodes = graph.nodes.filter(node => node.status !== 'retired' && (!members || members.has(node.id)));
  const ids = new Set(nodes.map(node => node.id));
  const edges = graph.edges.filter(edge => edge.status === 'active' && ids.has(edge.source) && ids.has(edge.target) && (!edgeIds || edgeIds.has(edge.id)));
  const layout = scoped && Object.hasOwn(graph.flowLayouts ?? {}, flow.id) ? graph.flowLayouts?.[flow.id] : undefined;
  const positions = scoped ? Object.fromEntries(nodes.flatMap(node => {
    const source = layout ? layout.positions : graph.positions;
    return source && Object.hasOwn(source, node.id) ? [[node.id, source[node.id]]] : [];
  })) : graph.positions ?? {};
  const routes = scoped ? Object.fromEntries(edges.flatMap(edge => layout && Object.hasOwn(layout.routes, edge.id) ? [[edge.id, layout.routes[edge.id]]] : [])) : graph.routes ?? {};
  return { nodes, edges, positions, routes, layoutDirection: scoped ? layout?.direction ?? null : graph.layoutDirection ?? null, flow, flowId: scoped ? flow.id : null };
}

/** @param {SemanticGraph} graph @param {string} nodeId */
export function boundaryRoles(graph, nodeId) {
  if (!graph.nodes.some(node => node.id === nodeId && node.status !== 'retired')) return [];
  return (graph.flows ?? []).filter(flow => flow.status !== 'retired' && (flow.scope === 'graph' || flow.nodeIds.includes(nodeId)))
    .flatMap(flow => {
      const start = flow.startNodeIds.includes(nodeId), end = flow.endNodeIds.includes(nodeId);
      return start || end ? [{ flowId: flow.id, label: flow.label, scope: flow.scope, start, end }] : [];
    });
}
