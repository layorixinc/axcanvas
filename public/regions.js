import { flowView } from './flows.js';
import { NODE_WIDTH, NODE_HEIGHT } from './layout.js';

import { tagKey } from './tags.js';

/** Select active in-scope targets, preserving view order. Tag matches never seed new tags. */
export function layoutTargetIds(view, selectedIds, mode) {
  if (mode !== 'connected' && mode !== 'tags') throw new Error('Unsupported region layout mode.');
  const selected = new Set(selectedIds), seeds = view.nodes.filter(node => selected.has(node.id));
  if (!seeds.length) return [];
  if (mode === 'tags') {
    const tags = new Set(seeds.flatMap(node => (node.tags ?? []).map(tagKey)));
    return tags.size ? view.nodes.filter(node => (node.tags ?? []).some(tag => tags.has(tagKey(tag)))).map(node => node.id) : [];
  }
  const targets = new Set(seeds.map(node => node.id)), queue = [...targets], adjacent = new Map();
  for (const edge of view.edges) {
    if (!adjacent.has(edge.source)) adjacent.set(edge.source, []);
    if (!adjacent.has(edge.target)) adjacent.set(edge.target, []);
    adjacent.get(edge.source).push(edge.target); adjacent.get(edge.target).push(edge.source);
  }
  for (let i = 0; i < queue.length; i++) for (const id of adjacent.get(queue[i]) ?? []) {
    if (!targets.has(id)) { targets.add(id); queue.push(id); }
  }
  return view.nodes.filter(node => targets.has(node.id)).map(node => node.id);
}

export function selectedRegion(graph, flowId, selectedIds, mode = 'connected') {
  const view = flowView(graph, flowId), nodeIds = layoutTargetIds(view, selectedIds, mode), targets = new Set(nodeIds);
  if (!targets.size) throw new Error(mode === 'tags' ? 'Select active nodes with tags in this scope.' : 'Select at least one active node in this scope.');
  const nodes = view.nodes.filter(node => targets.has(node.id));
  const edges = view.edges.filter(edge => targets.has(edge.source) && targets.has(edge.target));
  const flow = view.flow ? { ...view.flow, scope: 'graph', nodeIds: [], edgeIds: [], startNodeIds: view.flow.startNodeIds.filter(id => targets.has(id)), endNodeIds: view.flow.endNodeIds.filter(id => targets.has(id)) } : null;
  const positions = Object.fromEntries(view.nodes.flatMap((node, i) => targets.has(node.id) ? [[node.id, view.positions[node.id] ?? fallback(i)]] : []));
  return { nodeIds, graph: { ...graph, nodes, edges, flows: flow ? [flow] : [], flowLayouts: {}, positions, routes: {} } };
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
export function placeRegion(graph, flowId, region, computed, direction) {
  if (direction !== 'RIGHT' && direction !== 'DOWN') throw new Error('Unsupported layout direction');
  const view = flowView(graph, flowId), ids = new Set(region.nodeIds);
  const old = bounds(Object.values(region.graph.positions).map(p => rectangle(p)));
  const local = regionBounds(computed);
  let dx = (old.left + old.right - local.left - local.right) / 2, dy = (old.top + old.bottom - local.top - local.bottom) / 2;
  const obstacles = view.nodes.flatMap((node, i) => ids.has(node.id) ? [] : [rectangle(view.positions[node.id] ?? fallback(i))]);
  const unrelated = mergeRegionGeometry({ ...view, direction: view.layoutDirection }, region.nodeIds, {}, {}).routes;
  obstacles.push(...Object.values(unrelated).map(routeBounds));
  const translated = { left: local.left + dx, right: local.right + dx, top: local.top + dy, bottom: local.bottom + dy };
  if (obstacles.some(obstacle => intersects(translated, obstacle))) {
    const fixed = bounds(obstacles);
    if (direction === 'RIGHT') dx = fixed.right + 90 - local.left;
    else dy = fixed.bottom + 90 - local.top;
  }
  const move = p => {
    const next = { x: p.x + dx, y: p.y + dy };
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || Math.abs(next.x) > 100000 || Math.abs(next.y) > 100000) throw new Error('Region layout coordinates exceed the supported range. Existing geometry is preserved.');
    return next;
  };
  return {
    positions: Object.fromEntries(Object.entries(computed.positions).map(([id, p]) => [id, move(p)])),
    routes: Object.fromEntries(Object.entries(computed.routes).map(([id, route]) => [id, { sections: route.sections.map(section => section.map(move)), label: { ...route.label, ...move(route.label) } }])),
  };
}
