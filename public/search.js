import { boundaryRoles, flowView } from './flows.js';
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();

/** Index semantic text once; camera changes do not require rebuilding it. */
export function createSearchIndex(graph) {
  const relations = new Map();
  for (const edge of graph.edges) {
    if (edge.status !== 'active') continue;
    for (const id of new Set([edge.source, edge.target])) {
      if (!relations.has(id)) relations.set(id, []);
      relations.get(id).push(edge.relation);
    }
  }
  return graph.nodes.map(node => ({ node, roles: boundaryRoles(graph, node.id), tags: new Set((node.tags ?? []).map(normalize)), fields: [
    ['Label', node.label, 80], ['ID', node.id, 90], ['Detail', node.detail, 20], ['Tag', (node.tags ?? []).join(' · '), 70],
    ['Source', node.sources.map(source => source.ref).join(' · '), 10],
    ['Relationship', (relations.get(node.id) ?? []).join(' · '), 15],
  ].map(([name, text, weight]) => ({ name, text, weight, normalized: normalize(text) })) }));
}

/** Literal AND matching with deterministic, field-weighted ranking. */
export function searchNodes(index, query, { allowedIds = null, kind = '', includeRetired = false, limit = 50, role = '', roleFlowId = undefined } = {}) {
  const q = normalize(query), terms = [...new Set(q.split(' ').filter(Boolean))];
  if (!terms.length && !role) return { matches: [], total: 0 };
  const matches = [];
  for (const row of index) {
    const { node, fields } = row;
    if ((!includeRetired && node.status === 'retired') || (kind && node.kind !== kind) || (allowedIds && !allowedIds.has(node.id))) continue;
    const roles = row.roles.filter(item => roleFlowId === undefined || item.flowId === roleFlowId);
    const hasRole = name => roles.some(item => name === 'start' ? item.start : name === 'end' ? item.end : false);
    if (role && !hasRole(role)) continue;
    let score = 0, matched = true;
    for (const term of terms) {
      if (term.startsWith('is:')) {
        if (!hasRole(term.slice(3))) { matched = false; break; }
        score += 120; continue;
      }
      if (term.startsWith('#')) {
        if (!row.tags.has(term.slice(1))) { matched = false; break; }
        score += 120; continue;
      }
      let best = 0;
      for (const field of fields) if (field.normalized.includes(term)) best = Math.max(best, field.weight);
      if (!best) { matched = false; break; }
      score += best;
    }
    if (!matched) continue;
    const label = fields[0].normalized, id = fields[1].normalized;
    score += label === q ? 20000 : id === q ? 10000 : label.startsWith(q) ? 5000 : label.includes(q) ? 2000 : 0;
    const field = fields.find(field => terms.some(term => term.startsWith('#') ? field.name === 'Tag' && row.tags.has(term.slice(1)) : !term.startsWith('is:') && field.normalized.includes(term)));
    const matchedTerm = field && terms.find(term => term.startsWith('#') ? field.name === 'Tag' && row.tags.has(term.slice(1)) : !term.startsWith('is:') && field.normalized.includes(term)).replace(/^#/, '');
    const offset = field ? Math.max(0, field.normalized.indexOf(matchedTerm) - 32) : 0;
    const roleText = roles.map(item => `${item.label} · ${[item.start ? 'START' : '', item.end ? 'END' : ''].filter(Boolean).join(' + ')}`).join('; ');
    const snippet = field ? `${offset ? '…' : ''}${field.text.slice(offset, offset + 160)}${field.text.length > offset + 160 ? '…' : ''}` : roleText;
    matches.push({ node, score, field: field?.name ?? 'Flow role', snippet, label, roleText });
  }
  matches.sort((a, b) => b.score - a.score || (a.label < b.label ? -1 : a.label > b.label ? 1 : a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0));
  return { matches: matches.slice(0, limit), total: matches.length };
}

/** UI-only search: navigation belongs to the editor, not this module. */
export function initGraphSearch({ getState, navigate }) {
  const byId = id => document.getElementById(id);
  const toggle = byId('graph-search-toggle'), panel = byId('graph-search-panel');
  const input = byId('graph-search-input'), range = byId('graph-search-range'), kind = byId('graph-search-kind');
  const role = byId('graph-search-role');
  const results = byId('graph-search-results'), count = byId('graph-search-count'), warning = byId('graph-search-warning');
  let indexedGraph = null, index = [], sessionId = null, snapshot = null, returnFocus = toggle, choosing = false;
  let matchedIds = new Set();
  function highlight() {
    for (const node of document.querySelectorAll('#nodes [data-node-id]')) node.classList.toggle('search-match', !panel.hidden && matchedIds.has(node.dataset.nodeId));
  }
  function close(restoreFocus = true) {
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); highlight();
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  }
  async function choose(id) {
    if (choosing) return;
    choosing = true;
    try { if (await navigate(id)) close(false); }
    catch (error) { warning.textContent = error.message; warning.hidden = false; }
    finally { choosing = false; }
  }
  function refresh(force = false) {
    if (panel.hidden) return;
    const state = getState();
    if (sessionId !== state.graph?.sessionId) {
      if (sessionId !== null) { input.value = ''; range.value = 'current'; kind.value = ''; role.value = ''; }
      sessionId = state.graph?.sessionId ?? null; snapshot = null;
    }
    const key = [state.graph, state.flowId, state.includeRetired, state.blocked, input.value, range.value, kind.value, role.value];
    if (!force && snapshot && key.every((value, i) => value === snapshot[i])) { highlight(); return; }
    snapshot = key;
    if (indexedGraph !== state.graph) { indexedGraph = state.graph; index = indexedGraph ? createSearchIndex(indexedGraph) : []; }
    const visibleIds = new Set(state.nodes.map(node => node.id));
    const roleFlowId = range.value === 'current' && state.graph ? flowView(state.graph, state.flowId).flow?.id ?? null : undefined;
    const found = searchNodes(index, input.value, { allowedIds: range.value === 'current' ? visibleIds : null, kind: kind.value, includeRetired: state.includeRetired, role: role.value, roleFlowId });
    matchedIds = new Set(found.matches.map(match => match.node.id)); highlight();
    results.replaceChildren();
    warning.textContent = state.blocked; warning.hidden = !state.blocked;
    count.textContent = !state.graph ? 'Open a session to search.' : !normalize(input.value) && !role.value ? 'Search text, #tag, is:start or is:end. Roles use the selected search scope.' : !found.total ? 'No matches. Try other words or Whole graph.' : found.total > found.matches.length ? `Showing ${found.matches.length} of ${found.total} matches` : `${found.total} match${found.total === 1 ? '' : 'es'}`;
    for (const match of found.matches) {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.dataset.nodeId = match.node.id; button.disabled = Boolean(state.blocked);
      const label = document.createElement('strong'); label.textContent = match.node.label;
      const meta = document.createElement('span'); meta.className = 'search-meta';
      meta.textContent = `${match.node.kind} · ${match.node.id}${visibleIds.has(match.node.id) ? '' : ' · Outside scope'}${match.node.status === 'retired' ? ' · Retired' : ''}${match.node.tags?.length ? ' · ' + match.node.tags.map(tag => '#' + tag).join(' ') : ''}`;
      if (match.roleText) meta.textContent += ' · ' + match.roleText;
      const snippet = document.createElement('span'); snippet.className = 'search-snippet'; snippet.textContent = `${match.field}: ${match.snippet}`;
      button.append(label, meta, snippet); button.addEventListener('click', () => choose(match.node.id)); item.append(button); results.append(item);
    }
  }
  function open() {
    if (document.querySelector('dialog[open]')) return;
    returnFocus = document.activeElement; panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); refresh(true); input.focus(); input.select();
  }
  toggle.addEventListener('click', () => panel.hidden ? open() : close());
  byId('graph-search-close').addEventListener('click', () => close());
  input.addEventListener('input', event => { if (!event.isComposing) refresh(true); });
  input.addEventListener('compositionend', () => refresh(true));
  range.addEventListener('change', () => refresh(true)); kind.addEventListener('change', () => refresh(true));
  role.addEventListener('change', () => refresh(true));
  panel.addEventListener('keydown', event => {
    event.stopPropagation();
    if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.focus(); input.select(); return; }
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    const buttons = [...results.querySelectorAll('button:not(:disabled)')];
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.target.matches('select')) {
      event.preventDefault(); if (!buttons.length) return;
      const at = buttons.indexOf(document.activeElement), next = event.key === 'ArrowDown' ? (at + 1) % buttons.length : (at <= 0 ? buttons.length : at) - 1;
      buttons[next].focus(); buttons[next].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && event.target === input) {
      event.preventDefault(); if (buttons[0]) choose(buttons[0].dataset.nodeId);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.altKey || document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (panel.hidden) open(); else { input.focus(); input.select(); } }
  });
  document.addEventListener('pointerdown', event => { if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) close(false); });
  return { refresh };
}
