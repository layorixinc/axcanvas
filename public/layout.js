/** @typedef {import('elkjs/lib/elk-api.js').ElkNode} ElkNode */
/** @typedef {import('../src/schema.ts').Position} Position */
/** @typedef {import('../src/schema.ts').EdgeRoute} EdgeRoute */
/** @typedef {{nodes: {id:string,status:string}[], edges:{id:string,source:string,target:string,relation:string,status:string}[]}} SemanticGraph */

export const NODE_WIDTH = 340;
export const NODE_HEIGHT = 150;
/** @param {string} relation */
export function shortRelation(relation) {
  const chars = Array.from(relation);
  return chars.length > 28 ? chars.slice(0, 27).join('') + '…' : relation;
}
/** @param {SemanticGraph} graph @param {string} direction @param {Record<string,{text:string,width:number,height:number}>} measurements @returns {ElkNode} */
export function buildLayoutGraph(graph, direction, measurements) {
  if (direction !== 'RIGHT' && direction !== 'DOWN') throw new Error('Unsupported layout direction');
  const nodes = graph.nodes.filter(n => n.status !== 'retired'), ids = new Set(nodes.map(n => n.id));
  return {
    id: 'axcanvas:root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': direction, 'elk.edgeRouting': 'ORTHOGONAL', 'elk.spacing.nodeNode': '55', 'elk.layered.spacing.nodeNodeBetweenLayers': '90', 'elk.spacing.edgeNode': '24', 'elk.spacing.edgeEdge': '18', 'elk.layered.spacing.edgeNodeBetweenLayers': '30', 'elk.randomSeed': '1' },
    children: nodes.map(n => ({ id: `node:${n.id}`, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: graph.edges.filter(e => e.status === 'active' && ids.has(e.source) && ids.has(e.target)).map(e => {
      const label = measurements[e.id];
      if (!label || !Number.isFinite(label.width) || !Number.isFinite(label.height) || label.width <= 0 || label.height <= 0) throw new Error(`Missing valid label measurement: ${e.id}`);
      return { id: `edge:${e.id}`, sources: [`node:${e.source}`], targets: [`node:${e.target}`], labels: [{ id: `label:${e.id}`, text: label.text, width: label.width, height: label.height }] };
    })
  };
}
/** @param {ElkNode} graph @param {string} direction */
export function extractLayout(graph, direction) {
  /** @type {Record<string,Position>} */
  const positions = {};
  /** @type {Record<string,EdgeRoute>} */
  const routes = {};
  for (const node of graph.children ?? []) {
    if (typeof node.x !== 'number' || typeof node.y !== 'number' || !Number.isFinite(node.x) || !Number.isFinite(node.y)) throw new Error(`Missing node position coordinates: ${node.id}`);
    if (!node.id.startsWith('node:')) throw new Error('Unexpected layout node identity');
    Object.defineProperty(positions, node.id.slice(5), { value: { x: node.x, y: node.y }, enumerable: true, configurable: true });
  }
  for (const edge of graph.edges ?? []) {
    if (!edge.id?.startsWith('edge:') || !edge.sections?.length) throw new Error('Missing routed edge sections');
    const label = edge.labels?.[0];
    if (!label || ![label.x, label.y, label.width, label.height].every(v => typeof v === 'number' && Number.isFinite(v))) throw new Error(`Missing edge label coordinates: ${edge.id}`);
    const sections = edge.sections.map(section => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(p => {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('Invalid edge coordinates');
      return { x: p.x, y: p.y };
    }));
    Object.defineProperty(routes, edge.id.slice(5), { value: { sections, label: { x: label.x, y: label.y, width: label.width, height: label.height, text: label.text ?? '' } }, enumerable: true, configurable: true });
  }
  return { positions, routes, direction };
}
