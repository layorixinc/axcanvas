/** @typedef {import('elkjs/lib/elk-api.js').ElkNode} ElkNode */
/** @typedef {import('../src/schema.ts').Position} Position */
/** @typedef {import('../src/schema.ts').EdgeRoute} EdgeRoute */
/** @typedef {import('./flows.js').SemanticGraph} SemanticGraph */
import { flowView } from './flows.js';

export const NODE_WIDTH = 340;
export const NODE_HEIGHT = 150;
/** @param {string} relation */
export function shortRelation(relation) {
  const chars = Array.from(relation);
  return chars.length > 28 ? chars.slice(0, 27).join('') + '…' : relation;
}
/** @param {SemanticGraph} graph @param {string} direction @param {Record<string,{text:string,width:number,height:number}>} measurements @param {string|null} flowId @returns {ElkNode} */
export function buildLayoutGraph(graph, direction, measurements, flowId = null) {
  if (direction !== 'RIGHT' && direction !== 'DOWN') throw new Error('Unsupported layout direction');
  const view = flowView(graph, flowId);
  const { starts, ends, constrained, linkedBoundaries } = constraints(view);
  /** @type {ElkNode} */
  const input = {
    id: 'axcanvas:root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': direction, 'elk.edgeRouting': 'ORTHOGONAL', 'elk.spacing.nodeNode': '55', 'elk.layered.spacing.nodeNodeBetweenLayers': '90', 'elk.spacing.edgeNode': '24', 'elk.spacing.edgeEdge': '18', 'elk.layered.spacing.edgeNodeBetweenLayers': '30', 'elk.randomSeed': '1',
      ...(constrained ? { 'elk.separateConnectedComponents': 'false', 'elk.layered.cycleBreaking.strategy': 'GREEDY_MODEL_ORDER' } : {}) },
    children: view.nodes.map(n => ({ id: `node:${n.id}`, width: NODE_WIDTH, height: NODE_HEIGHT,
      ...(constrained ? { layoutOptions: { 'elk.layered.layering.layerConstraint': starts.has(n.id) && !ends.has(n.id) ? 'FIRST_SEPARATE' : ends.has(n.id) && !starts.has(n.id) ? 'LAST_SEPARATE' : 'NONE' } } : {}) })),
    edges: view.edges.map(e => {
      const label = measurements[e.id];
      if (!label || !Number.isFinite(label.width) || !Number.isFinite(label.height) || label.width <= 0 || label.height <= 0) throw new Error(`Missing valid label measurement: ${e.id}`);
      return { id: `edge:${e.id}`, sources: [`node:${e.source}`], targets: [`node:${e.target}`], labels: [{ id: `label:${e.id}`, text: label.text, width: label.width, height: label.height }] };
    })
  };
  if (!linkedBoundaries) return input;
  // FIRST_SEPARATE cannot accept links within its own boundary band in ELK.
  // Represent boundary rectangles as fixed-side compound ports instead. ELK
  // supports external-port links, including loops, and routes every real edge.
  // The compound is only a coordinate container, never a semantic node/edge.
  const ports = (input.children ?? []).filter(node => starts.has(node.id.slice(5)) || ends.has(node.id.slice(5))).map(node => ({
    id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT,
    layoutOptions: { 'elk.port.side': starts.has(node.id.slice(5)) ? (direction === 'RIGHT' ? 'WEST' : 'NORTH') : (direction === 'RIGHT' ? 'EAST' : 'SOUTH') }
  }));
  const interior = (input.children ?? []).filter(node => !starts.has(node.id.slice(5)) && !ends.has(node.id.slice(5)));
  return {
    id: 'axcanvas:root',
    layoutOptions: { ...input.layoutOptions },
    children: [{
      ...input, id: 'axcanvas:boundary-container', children: interior, ports,
      // Childless compounds must still reserve space for full-size ports.
      width: 100, height: 100,
      layoutOptions: { ...input.layoutOptions, 'elk.portConstraints': 'FIXED_SIDE', 'elk.nodeSize.constraints': '[MINIMUM_SIZE, PORTS]', 'elk.nodeSize.minimum': '(100,100)', 'elk.spacing.portPort': '55' }
    }]
  };
}
/** @param {ReturnType<typeof flowView>} view */
function constraints(view) {
  const starts = new Set(view.flow?.startNodeIds ?? []), ends = new Set(view.flow?.endNodeIds ?? []);
  const ids = new Set(view.nodes.map(node => node.id));
  for (const id of [...starts, ...ends]) if (!ids.has(id)) throw new Error(`Boundary node is outside the selected scope: ${id}`);
  if (view.nodes.length > 1) for (const id of starts) if (ends.has(id)) throw new Error(`Node ${id} is both start and end in a multi-member flow. Choose distinct boundaries or a single-member scope.`);
  const linkedBoundaries = view.edges.some(edge => edge.source !== edge.target && ((starts.has(edge.source) && starts.has(edge.target)) || (ends.has(edge.source) && ends.has(edge.target))));
  return { starts, ends, constrained: starts.size > 0 || ends.size > 0, linkedBoundaries };
}

/** Convert ELK compound-local coordinates to one view frame, including routes
 * whose container is the outer graph. This is a rigid coordinate conversion,
 * not a repair of boundary positions: every node, bend and label moves together.
 * @param {ElkNode} graph @returns {ElkNode}
 */
function flattenBoundaryContainer(graph) {
  const container = graph.children?.[0];
  if (graph.children?.length !== 1 || container?.id !== 'axcanvas:boundary-container' || graph.edges?.length || graph.ports?.length || typeof container.x !== 'number' || typeof container.y !== 'number' || !Number.isFinite(container.x) || !Number.isFinite(container.y)) throw new Error('Invalid boundary layout container');
  const x = container.x, y = container.y;
  return {
    ...graph,
    children: [...(container.children ?? []), ...(container.ports ?? [])].map(node => ({
      id: node.id, width: node.width, height: node.height,
      x: typeof node.x === 'number' ? node.x + x : undefined,
      y: typeof node.y === 'number' ? node.y + y : undefined
    })),
    edges: (container.edges ?? []).map(edge => {
      if (edge.container !== graph.id && edge.container !== container.id) throw new Error(`Unknown edge coordinate container: ${edge.id}`);
      const dx = edge.container === graph.id ? 0 : x, dy = edge.container === graph.id ? 0 : y;
      /** @param {{x:number,y:number}} point */
      const translate = point => ({ x: point.x + dx, y: point.y + dy });
      return { ...edge,
        labels: edge.labels?.map(label => ({ ...label, x: typeof label.x === 'number' ? label.x + dx : undefined, y: typeof label.y === 'number' ? label.y + dy : undefined })),
        sections: edge.sections?.map(section => ({ ...section, startPoint: translate(section.startPoint), endPoint: translate(section.endPoint), bendPoints: section.bendPoints?.map(translate) }))
      };
    })
  };
}

const EPSILON = 0.001;
/** @param {number} a @param {number} b */
const near = (a, b) => Math.abs(a - b) < EPSILON;
/** @typedef {{x:number,y:number,width:number,height:number}} Rectangle */
/** @param {Rectangle} a @param {Rectangle} b */
const overlaps = (a, b) => a.x < b.x + b.width - EPSILON && a.x + a.width > b.x + EPSILON && a.y < b.y + b.height - EPSILON && a.y + a.height > b.y + EPSILON;
/** @param {{x:number,y:number}} p @param {Rectangle} rect */
const onBoundary = (p, rect) => p.x >= rect.x - EPSILON && p.x <= rect.x + rect.width + EPSILON && p.y >= rect.y - EPSILON && p.y <= rect.y + rect.height + EPSILON && (near(p.x, rect.x) || near(p.x, rect.x + rect.width) || near(p.y, rect.y) || near(p.y, rect.y + rect.height));

/** Validate the engine result as a whole; never repair only boundary positions.
 * @param {ElkNode} graph @param {string} direction @param {SemanticGraph} semanticGraph @param {string|null} flowId
 */
export function extractLayout(graph, direction, semanticGraph, flowId = null) {
  if (direction !== 'RIGHT' && direction !== 'DOWN') throw new Error('Unsupported layout direction');
  if (!semanticGraph) throw new Error('Semantic graph is required to validate layout');
  const view = flowView(semanticGraph, flowId);
  const { starts, ends, linkedBoundaries } = constraints(view);
  if (linkedBoundaries) graph = flattenBoundaryContainer(graph);
  const expectedNodes = new Set(view.nodes.map(node => `node:${node.id}`));
  const expectedEdges = new Map(view.edges.map(edge => [`edge:${edge.id}`, edge]));
  /** @type {Record<string,Position>} */
  const positions = {};
  /** @type {Record<string,EdgeRoute>} */
  const routes = {};
  /** @type {Map<string,Rectangle>} */
  const rectangles = new Map();
  for (const node of graph.children ?? []) {
    if (typeof node.x !== 'number' || typeof node.y !== 'number' || !Number.isFinite(node.x) || !Number.isFinite(node.y)) throw new Error(`Missing node position coordinates: ${node.id}`);
    if (!expectedNodes.delete(node.id)) throw new Error(`Unexpected or duplicate layout node identity: ${node.id}`);
    if (node.width !== NODE_WIDTH || node.height !== NODE_HEIGHT) throw new Error(`Invalid node dimensions: ${node.id}`);
    const rect = { x: node.x, y: node.y, width: node.width, height: node.height };
    for (const other of rectangles.values()) if (overlaps(rect, other)) throw new Error(`Overlapping layout nodes: ${node.id}`);
    rectangles.set(node.id, rect);
    Object.defineProperty(positions, node.id.slice(5), { value: { x: node.x, y: node.y }, enumerable: true, configurable: true });
  }
  if (expectedNodes.size) throw new Error(`Incomplete layout node positions: ${[...expectedNodes].join(', ')}`);
  const axis = direction === 'RIGHT' ? 'x' : 'y', extent = direction === 'RIGHT' ? NODE_WIDTH : NODE_HEIGHT;
  if (rectangles.size) {
    const leading = Math.min(...[...rectangles.values()].map(rect => rect[axis]));
    const trailing = Math.max(...[...rectangles.values()].map(rect => rect[axis] + extent));
    for (const node of view.nodes) {
      const coordinate = positions[node.id][axis];
      if (starts.has(node.id) ? !near(coordinate, leading) : starts.size && coordinate <= leading + extent + EPSILON) throw new Error(`Invalid leading boundary band: ${node.id}`);
      if (ends.has(node.id) ? !near(coordinate + extent, trailing) : ends.size && coordinate + extent >= trailing - extent - EPSILON) throw new Error(`Invalid trailing boundary band: ${node.id}`);
    }
  }
  /** @type {Rectangle[]} */
  const labels = [];
  for (const edge of graph.edges ?? []) {
    const semantic = expectedEdges.get(edge.id);
    if (!semantic || !expectedEdges.delete(edge.id)) throw new Error(`Unexpected or duplicate layout edge identity: ${edge.id}`);
    if (edge.sources.length !== 1 || edge.targets.length !== 1 || edge.sources[0] !== `node:${semantic.source}` || edge.targets[0] !== `node:${semantic.target}`) throw new Error(`Changed edge endpoints: ${edge.id}`);
    if (!edge.sections?.length) throw new Error(`Missing routed edge sections: ${edge.id}`);
    const label = edge.labels?.[0];
    if (edge.labels?.length !== 1 || !label || label.id !== `label:${semantic.id}` || typeof label.x !== 'number' || typeof label.y !== 'number' || typeof label.width !== 'number' || typeof label.height !== 'number' || ![label.x, label.y, label.width, label.height].every(Number.isFinite) || label.width <= 0 || label.height <= 0 || typeof label.text !== 'string') throw new Error(`Invalid edge label coordinates: ${edge.id}`);
    const labelRect = { x: label.x, y: label.y, width: label.width, height: label.height };
    for (const rect of [...rectangles.values(), ...labels]) if (overlaps(labelRect, rect)) throw new Error(`Overlapping edge label: ${edge.id}`);
    labels.push(labelRect);
    const sections = edge.sections.map(section => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(p => {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error(`Invalid edge coordinates: ${edge.id}`);
      return { x: p.x, y: p.y };
    }));
    for (let s = 0; s < sections.length; s++) {
      const points = sections[s];
      const previous = s ? sections[s - 1][sections[s - 1].length - 1] : null;
      if (previous && (!near(previous.x, points[0].x) || !near(previous.y, points[0].y))) throw new Error(`Disconnected edge sections: ${edge.id}`);
      for (let i = 1; i < points.length; i++) {
        const p = points[i - 1], q = points[i];
        if (!near(p.x, q.x) && !near(p.y, q.y)) throw new Error(`Nonorthogonal edge segment: ${edge.id}`);
        for (const rect of rectangles.values()) {
          const crosses = near(p.x, q.x) ? p.x > rect.x + EPSILON && p.x < rect.x + rect.width - EPSILON && Math.max(p.y, q.y) > rect.y + EPSILON && Math.min(p.y, q.y) < rect.y + rect.height - EPSILON : p.y > rect.y + EPSILON && p.y < rect.y + rect.height - EPSILON && Math.max(p.x, q.x) > rect.x + EPSILON && Math.min(p.x, q.x) < rect.x + rect.width - EPSILON;
          if (crosses) throw new Error(`Edge route crosses a node: ${edge.id}`);
        }
      }
    }
    const source = rectangles.get(`node:${semantic.source}`), target = rectangles.get(`node:${semantic.target}`);
    const last = sections[sections.length - 1];
    if (!source || !target || !onBoundary(sections[0][0], source) || !onBoundary(last[last.length - 1], target)) throw new Error(`Edge route misses its endpoints: ${edge.id}`);
    Object.defineProperty(routes, edge.id.slice(5), { value: { sections, label: { ...labelRect, text: label.text } }, enumerable: true, configurable: true });
  }
  if (expectedEdges.size) throw new Error(`Incomplete edge routes: ${[...expectedEdges.keys()].join(', ')}`);
  return { positions, routes, direction };
}
