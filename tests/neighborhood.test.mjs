import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { selectedNeighborhood, placeNeighborhood, mergeRegionGeometry } from '../public/neighborhood.js';
import { buildLayoutGraph, extractLayout } from '../public/layout.js';
const ELK = createRequire(import.meta.url)('elkjs/lib/elk.bundled.js');
const elk = new ELK();
const node = id => ({ id, status: 'confirmed' });
const edge = (id, source, target) => ({ id, source, target, relation: 'uses', status: 'active' });
const route = (x, y) => ({ sections: [[{ x, y }, { x: x + 100, y }]], label: { x, y: y - 30, width: 80, height: 20, text: 'uses' } });
const positions = { a: { x: 0, y: 0 }, b: { x: 500, y: 500 }, c: { x: 1000, y: 0 }, d: { x: 5000, y: 1000 }, e: { x: 5600, y: 1000 }, isolated: { x: -2000, y: 500 } };
const graph = () => ({ nodes: ['a','b','c','d','e','isolated'].map(node), edges: [edge('ab','a','b'),edge('bc','b','c'),edge('cd','c','d'),edge('de','d','e'),edge('bb','b','b'),edge('ab2','a','b')], positions: structuredClone(positions), routes: { cd: route(2000, 600), de: route(5400, 1075) }, layoutDirection: 'RIGHT', flows: [], flowLayouts: {} });
async function compute(projection, direction) {
  const labels = Object.fromEntries(projection.graph.edges.map(e => [e.id, { text: e.relation, width: 80, height: 20 }]));
  return extractLayout(await elk.layout(buildLayoutGraph(projection.graph, direction, labels)), direction, projection.graph);
}

test('one-hop projection includes induced parallel/self edges but never expands recursively', () => {
  const g = graph(), before = structuredClone(g);
  const p = selectedNeighborhood(g, null, ['b']);
  assert.deepEqual(p.nodeIds, ['a','b','c']); assert.deepEqual(p.graph.edges.map(e => e.id), ['ab','bc','bb','ab2']);
  assert.deepEqual(selectedNeighborhood(g, null, ['b','isolated']).nodeIds, ['a','b','c','isolated']);
  assert.throws(() => selectedNeighborhood(g, null, []), /Select/);
  assert.deepEqual(g, before);
});

test('scope membership and boundary roles are projected without creating or changing a flow', async () => {
  const g = graph(); g.flows = [{ id: 'scope', scope: 'custom', label: 'Scope', status: 'active', nodeIds: ['a','b','isolated'], edgeIds: ['ab','ab2','bb'], startNodeIds: ['a'], endNodeIds: ['b'] }];
  const before = structuredClone(g), p = selectedNeighborhood(g, 'scope', ['b']);
  assert.deepEqual(p.nodeIds, ['a','b']); assert.deepEqual(p.graph.flows[0].startNodeIds, ['a']); assert.deepEqual(p.graph.flows[0].endNodeIds, ['b']);
  const result = await compute(p, 'RIGHT'); assert.ok(result.positions.a.x < result.positions.b.x);
  assert.deepEqual(g, before);
});

test('real Worker geometry is translated rigidly while outside positions/routes remain exact', async () => {
  for (const direction of ['RIGHT','DOWN']) {
    const g = graph(), p = selectedNeighborhood(g, null, ['b']), result = await compute(p, direction);
    const placed = placeNeighborhood(g, null, p, result, direction);
    const merged = mergeRegionGeometry({ ...g, direction: g.layoutDirection }, p.nodeIds, placed.positions, placed.routes);
    assert.deepEqual(merged.positions.d, g.positions.d); assert.deepEqual(merged.positions.e, g.positions.e); assert.deepEqual(merged.positions.isolated, g.positions.isolated);
    assert.deepEqual(merged.routes.de, g.routes.de); assert.equal(merged.routes.cd, undefined); assert.equal(merged.direction, 'RIGHT');
    const dx = placed.positions.a.x - result.positions.a.x, dy = placed.positions.a.y - result.positions.a.y;
    for (const id of p.nodeIds) { assert.equal(placed.positions[id].x - result.positions[id].x, dx); assert.equal(placed.positions[id].y - result.positions[id].y, dy); }
    for (const [id, r] of Object.entries(result.routes)) assert.deepEqual(placed.routes[id].sections[0][0], { x: r.sections[0][0].x + dx, y: r.sections[0][0].y + dy });
  }
});

test('colliding fixed geometry moves the whole neighborhood to free space without moving obstacles', async () => {
  const g = graph(); g.positions.isolated = { x: 500, y: 250 }; delete g.routes.cd;
  const p = selectedNeighborhood(g, null, ['b']), result = await compute(p, 'RIGHT');
  const placed = placeNeighborhood(g, null, p, result, 'RIGHT');
  const right = Math.max(...['d','e','isolated'].map(id => g.positions[id].x + 340), ...Object.values(g.routes).map(r => r.label.x + r.label.width));
  assert.ok(Math.min(...Object.values(placed.positions).map(p => p.x)) >= right);
  assert.deepEqual(g.positions.isolated, { x: 500, y: 250 });
});

test('isolated nodes and fallback coordinates work, while out-of-range placements fail without clamping', async () => {
  const g = graph(); delete g.positions.isolated;
  const p = selectedNeighborhood(g, null, ['isolated']); const result = await compute(p, 'DOWN');
  assert.deepEqual(p.nodeIds, ['isolated']); assert.ok(Number.isFinite(placeNeighborhood(g, null, p, result, 'DOWN').positions.isolated.x));
  g.positions.isolated = { x: 100000, y: 100000 }; const edgeCase = selectedNeighborhood(g, null, ['isolated']);
  assert.throws(() => placeNeighborhood(g, null, edgeCase, { ...result, positions: { isolated: { x: 0, y: 0 } }, routes: { extreme: route(300000, 0) } }, 'RIGHT'), /range|coordinates/);
});
