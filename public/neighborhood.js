import { flowView } from './flows.js';
import { NODE_WIDTH, NODE_HEIGHT } from './layout.js';

/** Project a one-hop neighborhood, never a recursive connected component. */
export function selectedNeighborhood(graph, flowId, selectedIds) {
  const view = flowView(graph, flowId), available = new Set(view.nodes.map(node => node.id));
  const seeds = new Set([...selectedIds].filter(id => available.has(id)));
  if (!seeds.size) throw new Error('Select at least one active node in this scope.');
  const targets = new Set(seeds);
  for (const edge of view.edges) {
    if (seeds.has(edge.source)) targets.add(edge.target);
    if (seeds.has(edge.target)) targets.add(edge.source);
  }
  const nodes = view.nodes.filter(node => targets.has(node.id));
  const edges = view.edges.filter(edge => targets.has(edge.source) && targets.has(edge.target));
  const flow = view.flow ? { ...view.flow, scope: 'graph', nodeIds: [], edgeIds: [], startNodeIds: view.flow.startNodeIds.filter(id => targets.has(id)), endNodeIds: view.flow.endNodeIds.filter(id => targets.has(id)) } : null;
  const positions = Object.fromEntries(view.nodes.flatMap((node, i) => targets.has(node.id) ? [[node.id, view.positions[node.id] ?? fallback(i)]] : []));
  return { nodeIds: nodes.map(node => node.id), graph: { ...graph, nodes, edges, flows: flow ? [flow] : [], flowLayouts: {}, positions, routes: {} } };
}
const fallback = i => ({ x: 90 + (i % 3) * 440, y: 100 + Math.floor(i / 3) * 235 });
const rectangle = (p, width = NODE_WIDTH, height = NODE_HEIGHT) => ({ left: p.x, top: p.y, right: p.x + width, bottom: p.y + height });
function bounds(rectangles) {
  const result = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const r of rectangles) { result.left = Math.min(result.left, r.left); result.top = Math.min(result.top, r.top); result.right = Math.max(result.right, r.right); result.bottom = Math.max(result.bottom, r.bottom); }
  return result;
}
function routeBounds(route) {
  const r = rectangle(route.label, route.label.width, route.label.height);
  for (const section of route.sections) for (const p of section) { r.left = Math.min(r.left, p.x); r.right = Math.max(r.right, p.x); r.top = Math.min(r.top, p.y); r.bottom = Math.max(r.bottom, p.y); }
  return r;
}
export function regionBounds(layout) {
  return bounds([...Object.values(layout.positions).map(p => rectangle(p)), ...Object.values(layout.routes).map(routeBounds)]);
}
const intersects = (a, b) => a.left < b.right + 32 && a.right + 32 > b.left && a.top < b.bottom + 32 && a.bottom + 32 > b.top;

/** Merge an explicit region without clearing outside coordinates or routes. */
export function mergeRegionGeometry(view, nodeIds, positions, routes) {
  const ids = new Set(nodeIds), edges = new Map(view.edges.map(edge => [edge.id, edge]));
  const retained = Object.entries(view.routes ?? {}).filter(([id]) => { const edge = edges.get(id); return edge && !ids.has(edge.source) && !ids.has(edge.target); });
  return { positions: { ...view.positions, ...positions }, routes: { ...Object.fromEntries(retained), ...routes }, direction: view.direction ?? null };
}

/** Translate every node/bend/label together, respecting fixed outside geometry. */
export function placeNeighborhood(graph, flowId, neighborhood, computed, direction) {
  if (direction !== 'RIGHT' && direction !== 'DOWN') throw new Error('Unsupported layout direction');
  const view = flowView(graph, flowId), ids = new Set(neighborhood.nodeIds);
  const old = bounds(Object.values(neighborhood.graph.positions).map(p => rectangle(p)));
  const local = regionBounds(computed);
  let dx = (old.left + old.right - local.left - local.right) / 2, dy = (old.top + old.bottom - local.top - local.bottom) / 2;
  const obstacles = view.nodes.flatMap((node, i) => ids.has(node.id) ? [] : [rectangle(view.positions[node.id] ?? fallback(i))]);
  const unrelated = mergeRegionGeometry({ ...view, direction: view.layoutDirection }, neighborhood.nodeIds, {}, {}).routes;
  obstacles.push(...Object.values(unrelated).map(routeBounds));
  const translated = { left: local.left + dx, right: local.right + dx, top: local.top + dy, bottom: local.bottom + dy };
  if (obstacles.some(obstacle => intersects(translated, obstacle))) {
    const fixed = bounds(obstacles);
    if (direction === 'RIGHT') dx = fixed.right + 90 - local.left;
    else dy = fixed.bottom + 90 - local.top;
  }
  const move = p => {
    const next = { x: p.x + dx, y: p.y + dy };
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || Math.abs(next.x) > 100000 || Math.abs(next.y) > 100000) throw new Error('Neighborhood layout coordinates exceed the supported range. Existing geometry is preserved.');
    return next;
  };
  return {
    positions: Object.fromEntries(Object.entries(computed.positions).map(([id, p]) => [id, move(p)])),
    routes: Object.fromEntries(Object.entries(computed.routes).map(([id, route]) => [id, { sections: route.sections.map(section => section.map(move)), label: { ...route.label, ...move(route.label) } }])),
  };
}
