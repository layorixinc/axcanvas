import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchIndex, searchNodes } from '../public/search.js';

const node = (id, label, detail = '', extra = {}) => ({ id, label, detail, kind: 'concept', status: 'confirmed', sources: [], ...extra });
const graph = nodes => ({ nodes, edges: [] });
const ids = result => result.matches.map(match => match.node.id);

test('search ranks exact labels and IDs before prefix, substring and long-body matches', () => {
  const index = createSearchIndex(graph([
    node('body', 'Infrastructure', 'gateway'), node('substring', 'My gateway'), node('prefix', 'Gateway service'),
    node('exact', 'Gateway'), node('gateway', 'Other'),
  ]));
  assert.deepEqual(ids(searchNodes(index, 'GATEWAY')), ['exact', 'gateway', 'prefix', 'substring', 'body']);
  assert.deepEqual(ids(searchNodes(index.toReversed(), 'gateway')), ids(searchNodes(index, 'gateway')));
});

test('literal AND search covers detail, sources and active relationships without cross-node token leakage', () => {
  const g = graph([node('a', 'Request handler', 'credentials'), node('b', 'Database', 'WAL', { sources: [{ kind: 'url', ref: 'https://example.test/architecture' }] }), node('c', 'credentials', 'unrelated')]);
  g.edges = [{ id: 'ab', source: 'a', target: 'b', relation: 'persists transactions', status: 'active' }, { id: 'bc', source: 'b', target: 'c', relation: 'obsolete route', status: 'retired' }];
  const index = createSearchIndex(g);
  assert.deepEqual(ids(searchNodes(index, 'handler credentials')), ['a']);
  assert.deepEqual(ids(searchNodes(index, 'Database credentials')), []);
  assert.deepEqual(ids(searchNodes(index, 'architecture WAL')), ['b']);
  assert.deepEqual(ids(searchNodes(index, 'transactions')), ['b', 'a']);
  assert.deepEqual(ids(searchNodes(index, 'obsolete')), []);
  assert.equal(searchNodes(index, 'architecture').matches[0].field, 'Source');
  assert.equal(searchNodes(index, 'transactions WAL').matches[0].node.id, 'b');
});

test('Unicode normalization handles decomposed Korean and fullwidth text without invented synonyms', () => {
  const index = createSearchIndex(graph([node('ko', '한글 검색'), node('api', 'API gateway')]));
  assert.deepEqual(ids(searchNodes(index, '한글')), ['ko']);
  assert.deepEqual(ids(searchNodes(index, 'ＡＰＩ')), ['api']);
  assert.deepEqual(ids(searchNodes(index, 'authentication')), []);
  assert.deepEqual(searchNodes(index, ' \n\t '), { matches: [], total: 0 });
});

test('scope, kind and retired policy filter results before counting and limiting', () => {
  const nodes = Array.from({ length: 65 }, (_, i) => node(`n${String(i).padStart(2, '0')}`, 'Storage', '', { kind: i % 2 ? 'decision' : 'concept' }));
  nodes.push(node('old', 'Storage', '', { status: 'retired' }));
  const index = createSearchIndex(graph(nodes));
  assert.equal(searchNodes(index, 'Storage').total, 65);
  assert.equal(searchNodes(index, 'Storage').matches.length, 50);
  assert.equal(searchNodes(index, 'Storage', { includeRetired: true }).total, 66);
  assert.deepEqual(ids(searchNodes(index, 'Storage', { allowedIds: new Set(['n01', 'n02']), kind: 'decision' })), ['n01']);
  assert.deepEqual(searchNodes(index, 'Storage', { allowedIds: new Set() }), { matches: [], total: 0 });
});

test('search returns contextual deep-body snippets and leaves semantic input untouched', () => {
  const g = graph([node('deep', 'Long note', 'x'.repeat(250) + 'unique-evidence' + 'y'.repeat(250))]);
  const before = structuredClone(g), index = createSearchIndex(g);
  const result = searchNodes(index, 'unique-evidence');
  assert.match(result.matches[0].snippet, /unique-evidence/);
  assert.ok(result.matches[0].snippet.startsWith('…'));
  assert.deepEqual(g, before);
});
