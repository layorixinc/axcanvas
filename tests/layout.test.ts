import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { ELK as ELKInstance, ELKConstructorArguments } from 'elkjs/lib/elk-api.js';
import { buildLayoutGraph, extractLayout, shortRelation } from '../public/layout.js';
const ELK: new (options?: ELKConstructorArguments) => ELKInstance = createRequire(import.meta.url)('elkjs/lib/elk.bundled.js');
const elk = new ELK();
const node = (id: string) => ({ id, status: 'confirmed' });
const edge = (id: string, source: string, target: string, relation = 'uses') => ({ id, source, target, relation, status: 'active' });
function measurements(edges: { id: string; relation: string }[]) { return Object.fromEntries(edges.map(e => [e.id, { text: shortRelation(e.relation), width: 180, height: 28 }])); }
function overlaps(a: { x: number; y: number }, b: { x: number; y: number }) { return a.x < b.x + 340 && a.x + 340 > b.x && a.y < b.y + 150 && a.y + 150 > b.y; }
test('real layered layout follows direction, returns routed labels and leaves semantic input untouched', async () => {
  const graph = { nodes: [node('a'), node('b'), node('c')], edges: [edge('ab', 'a', 'b'), edge('ac', 'a', 'c')] };
  const original = structuredClone(graph);
  for (const direction of ['RIGHT', 'DOWN']) {
    const input = buildLayoutGraph(graph, direction, measurements(graph.edges));
    const result = extractLayout(await elk.layout(input), direction);
    assert.equal(result.direction, direction);
    assert.ok(direction === 'RIGHT' ? result.positions.a.x < result.positions.b.x : result.positions.a.y < result.positions.b.y);
    for (const a of Object.keys(result.positions)) for (const b of Object.keys(result.positions)) if (a !== b) assert.equal(overlaps(result.positions[a], result.positions[b]), false);
    for (const route of Object.values(result.routes)) {
      assert.equal(route.label.width, 180); assert.equal(route.label.height, 28);
      for (const section of route.sections) for (let i = 1; i < section.length; i++) assert.ok(section[i].x === section[i - 1].x || section[i].y === section[i - 1].y, 'Orthogonal segments required');
    }
  }
  assert.deepEqual(graph, original);
});
test('cycles, parallel edges, self-loops and disconnected nodes receive distinct geometry', async () => {
  const graph = { nodes: ['a', 'b', 'c', 'isolated'].map(node), edges: [edge('ab', 'a', 'b'), edge('ab2', 'a', 'b', 'also uses'), edge('bc', 'b', 'c'), edge('ca', 'c', 'a'), edge('loop', 'c', 'c')] };
  const result = extractLayout(await elk.layout(buildLayoutGraph(graph, 'RIGHT', measurements(graph.edges))), 'RIGHT');
  assert.equal(Object.keys(result.positions).length, 4); assert.equal(Object.keys(result.routes).length, 5);
  assert.notDeepEqual(result.routes.ab.sections, result.routes.ab2.sections);
  assert.ok(result.routes.loop.sections[0].length > 2);
  for (const e of graph.edges) for (const section of result.routes[e.id].sections) for (let i = 1; i < section.length; i++) {
    const p = section[i - 1], q = section[i];
    for (const n of graph.nodes) {
      if (n.id === e.source || n.id === e.target) continue;
      const rect = result.positions[n.id];
      const crosses = p.x === q.x ? p.x > rect.x && p.x < rect.x + 340 && Math.max(p.y, q.y) > rect.y && Math.min(p.y, q.y) < rect.y + 150 : p.y > rect.y && p.y < rect.y + 150 && Math.max(p.x, q.x) > rect.x && Math.min(p.x, q.x) < rect.x + 340;
      assert.equal(crosses, false, `${e.id} must avoid node ${n.id}`);
    }
  }
});
test('retired content is excluded and unsupported geometry fails visibly', async () => {
  const graph = { nodes: [node('a'), { ...node('old'), status: 'retired' }], edges: [{ ...edge('old-edge', 'a', 'old'), status: 'retired' }] };
  const result = extractLayout(await elk.layout(buildLayoutGraph(graph, 'RIGHT', {})), 'RIGHT');
  assert.deepEqual(Object.keys(result.positions), ['a']); assert.deepEqual(result.routes, {});
  assert.throws(() => extractLayout({ id: 'broken', children: [{ id: 'a' }], edges: [] }, 'RIGHT'), /coordinate|position/i);
});
