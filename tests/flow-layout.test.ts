import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { ELK as ELKInstance, ELKConstructorArguments } from 'elkjs/lib/elk-api.js';
import { buildLayoutGraph, extractLayout } from '../public/layout.js';
import { flowView, boundaryRoles } from '../public/flows.js';
const ELK: new (options?: ELKConstructorArguments) => ELKInstance = createRequire(import.meta.url)('elkjs/lib/elk.bundled.js');
const elk = new ELK();
const node = (id: string) => ({ id, status: 'confirmed' });
const edge = (id: string, source: string, target: string) => ({ id, source, target, status: 'active', relation: '結論 → next' });
const flow = (id: string, nodeIds: string[], edgeIds: string[], startNodeIds: string[], endNodeIds: string[]) => ({ id, scope: 'custom' as const, status: 'active' as const, label: id, nodeIds, edgeIds, startNodeIds, endNodeIds });
const measurements = (edges: { id: string }[]) => Object.fromEntries(edges.map(e => [e.id, { text: '結論 → next', width: 180, height: 28 }]));

test('scoped real ELK boundaries align unequal disconnected paths and isolated members in either input order', async () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'isolated', 'outside'].map(node);
  const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('de', 'd', 'e')];
  const scope = flow('selected', nodes.slice(0, -1).map(n => n.id), edges.map(e => e.id), ['a', 'd'], ['c', 'e']);
  for (const direction of ['RIGHT', 'DOWN']) for (const reverse of [false, true]) {
    const graph = { nodes: reverse ? [...nodes].reverse() : nodes, edges: reverse ? [...edges].reverse() : edges, flows: [scope] };
    const before = structuredClone(graph);
    const output = await elk.layout(buildLayoutGraph(graph, direction, measurements(edges), 'selected'));
    assert.equal(output.children?.length, 6, 'Only explicit scope members may reach ELK');
    const result = extractLayout(output, direction, graph, 'selected');
    const axis = direction === 'RIGHT' ? 'x' : 'y';
    const size = direction === 'RIGHT' ? 340 : 150;
    const p = result.positions;
    assert.equal(p.a[axis], p.d[axis]); assert.equal(p.c[axis], p.e[axis]);
    for (const id of ['b', 'isolated']) { assert.ok(p[id][axis] > p.a[axis] + size); assert.ok(p[id][axis] + size < p.c[axis]); }
    assert.deepEqual(graph, before);
  }
});

test('shared boundaries remain scope-qualified and view geometry stays isolated', async () => {
  const graph = { nodes: ['a', 'shared', 'z'].map(node), edges: [edge('as', 'a', 'shared'), edge('sz', 'shared', 'z')], positions: { shared: { x: 100, y: 200 } }, routes: {}, layoutDirection: 'RIGHT' as const,
    flows: [flow('Turn1', ['a', 'shared'], ['as'], ['a'], ['shared']), flow('Turn2', ['shared', 'z'], ['sz'], ['shared'], ['z'])],
    flowLayouts: { Turn1: { positions: { shared: { x: 900, y: 100 } }, routes: {}, direction: 'DOWN' as const } } };
  const before = structuredClone(graph);
  assert.deepEqual(boundaryRoles(graph, 'shared').map(r => [r.flowId, r.start, r.end]), [['Turn1', false, true], ['Turn2', true, false]]);
  assert.deepEqual(flowView(graph, 'Turn2').positions.shared, graph.positions.shared);
  assert.deepEqual(flowView(graph, 'Turn2').routes, {});
  assert.equal(flowView(graph, 'Turn2').layoutDirection, null);
  assert.deepEqual(flowView(graph, 'Turn1').positions.shared, { x: 900, y: 100 });
  for (const id of ['Turn1', 'Turn2']) for (const direction of ['RIGHT', 'DOWN']) {
    const result = extractLayout(await elk.layout(buildLayoutGraph(graph, direction, measurements(graph.edges), id)), direction, graph, id);
    assert.equal(Object.keys(result.positions).length, 2);
  }
  assert.deepEqual(graph, before);
  assert.throws(() => flowView(graph, 'missing'), /flow|scope/i);
  assert.deepEqual(boundaryRoles({ nodes: graph.nodes, edges: graph.edges }, 'shared'), []);
  const whole = { ...graph, flows: [...graph.flows, { ...flow('whole', [], [], ['a'], ['z']), scope: 'graph' as const }] };
  assert.equal(flowView(whole, 'whole').flowId, null);
  assert.deepEqual(flowView(whole).nodes, graph.nodes);
  assert.equal(flowView(whole).flow?.id, 'whole');
  assert.throws(() => flowView({ ...graph, flows: [{ ...graph.flows[0], status: 'retired' }] }, 'Turn1'), /flow|scope/i);
});

test('boundary cycles, linked starts, parallel edges and self loops retain original endpoints', async () => {
  const graph = { nodes: ['s1', 's2', 'm', 'e'].map(node), edges: [edge('ss', 's1', 's2'), edge('sm', 's2', 'm'), edge('sm2', 's2', 'm'), edge('me', 'm', 'e'), edge('es', 'e', 's1'), edge('self', 'm', 'm')], flows: [flow('cycle', ['s1', 's2', 'm', 'e'], ['ss', 'sm', 'sm2', 'me', 'es', 'self'], ['s1', 's2'], ['e'])] };
  for (const direction of ['RIGHT', 'DOWN']) {
    const output = await elk.layout(buildLayoutGraph(graph, direction, measurements(graph.edges), 'cycle'));
    const result = extractLayout(output, direction, graph, 'cycle');
    assert.equal(Object.keys(result.routes).length, graph.edges.length);
    const routedEdges = [...(output.edges ?? []), ...(output.children ?? []).flatMap(child => child.edges ?? [])];
    for (const e of graph.edges) { const routed = routedEdges.find(r => r.id === `edge:${e.id}`)!; assert.deepEqual(routed.sources, [`node:${e.source}`]); assert.deepEqual(routed.targets, [`node:${e.target}`]); }
  }
});

test('linked boundary bands retain alignment with linked ends, isolated members and boundary-only views', async () => {
  for (const interior of [false, true]) for (const reverse of [false, true]) for (const direction of ['RIGHT', 'DOWN']) {
    const ids = ['s1', 's2', ...(interior ? ['m', 'isolated'] : []), 'e1', 'e2'];
    const edges = [edge('ss', 's1', 's2'), edge('ss2', 's1', 's2'), edge('ee', 'e1', 'e2'), edge('se', 's2', 'e1'), edge('es', 'e2', 's1'), edge('self', 's1', 's1'), ...(interior ? [edge('sm', 's1', 'm'), edge('me', 'm', 'e2')] : [])];
    const graph = { nodes: (reverse ? [...ids].reverse() : ids).map(node), edges: reverse ? [...edges].reverse() : edges, flows: [flow('linked', ids, edges.map(e => e.id), ['s1', 's2'], ['e1', 'e2'])] };
    const before = structuredClone(graph);
    const result = extractLayout(await elk.layout(buildLayoutGraph(graph, direction, measurements(edges), 'linked')), direction, graph, 'linked');
    const axis = direction === 'RIGHT' ? 'x' : 'y', size = direction === 'RIGHT' ? 340 : 150;
    assert.equal(result.positions.s1[axis], result.positions.s2[axis]);
    assert.equal(result.positions.e1[axis], result.positions.e2[axis]);
    assert.ok(result.positions.s1[axis] + size < result.positions.e1[axis]);
    for (const id of interior ? ['m', 'isolated'] : []) {
      assert.ok(result.positions[id][axis] > result.positions.s1[axis] + size);
      assert.ok(result.positions[id][axis] + size < result.positions.e1[axis]);
    }
    assert.equal(Object.keys(result.positions).length, ids.length);
    assert.equal(Object.keys(result.routes).length, edges.length);
    assert.deepEqual(graph, before);
  }
});

test('single-member dual roles are valid but multiple-member dual roles fail explicitly', async () => {
  const graph = { nodes: [node('a'), node('outside')], edges: [edge('self', 'a', 'a')], flows: [flow('single', ['a'], ['self'], ['a'], ['a'])] };
  for (const direction of ['RIGHT', 'DOWN']) assert.equal(Object.keys(extractLayout(await elk.layout(buildLayoutGraph(graph, direction, measurements(graph.edges), 'single')), direction, graph, 'single').positions).length, 1);
  assert.throws(() => buildLayoutGraph({ ...graph, flows: [flow('single', ['a', 'outside'], ['self'], ['a'], ['a'])] }, 'RIGHT', measurements(graph.edges), 'single'), /both|start.*end/i);
});

test('incomplete, nonfinite, overlapping, diagonal and endpoint-corrupted engine outputs fail visibly', async () => {
  const graph = { nodes: ['a', 'b', 'c'].map(node), edges: [edge('ab', 'a', 'b'), edge('bc', 'b', 'c')], flows: [flow('f', ['a', 'b', 'c'], ['ab', 'bc'], ['a'], ['c'])] };
  const output = await elk.layout(buildLayoutGraph(graph, 'RIGHT', measurements(graph.edges), 'f'));
  const reject = (mutate: (copy: typeof output) => void) => { const copy = structuredClone(output); mutate(copy); assert.throws(() => extractLayout(copy, 'RIGHT', graph, 'f')); };
  reject(copy => { copy.children!.pop(); });
  reject(copy => { copy.edges!.pop(); });
  reject(copy => { copy.children![0].x = NaN; });
  reject(copy => { copy.children![1].x = copy.children![0].x; copy.children![1].y = copy.children![0].y; });
  reject(copy => { copy.edges![0].sources = ['node:c']; });
  reject(copy => { copy.edges![0].sections![0].startPoint = { x: -123, y: -456 }; });
  reject(copy => { copy.edges![0].labels![0].width = -1; });
  reject(copy => { copy.children![0].x = 99999; });
});

test('explicit edge membership never includes unrelated links and old graphs infer no roles', () => {
  const edges = [edge('included', 'a', 'b'), edge('unrelated', 'a', 'b'), edge('outside', 'b', 'c')];
  const graph = { nodes: ['a', 'b', 'c'].map(node), edges, flows: [flow('selected', ['a', 'b'], ['included'], [], [])] };
  const view = flowView(graph, 'selected');
  assert.deepEqual(view.edges.map(e => e.id), ['included']);
  const input = buildLayoutGraph(graph, 'RIGHT', measurements(edges), 'selected');
  assert.equal(input.layoutOptions?.['elk.separateConnectedComponents'], undefined);
  assert.equal(input.layoutOptions?.['elk.layered.cycleBreaking.strategy'], undefined);
  assert.ok(input.children?.every(child => !child.layoutOptions));
  const legacy = { nodes: graph.nodes, edges };
  assert.equal(flowView(legacy).flow, null);
  assert.equal(flowView(legacy).flowId, null);
  assert.deepEqual(flowView(legacy).positions, {});
  assert.deepEqual(flowView(legacy).routes, {});
});
