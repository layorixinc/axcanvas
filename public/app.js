import '/vendor/elk-api.js';
import { buildLayoutGraph, extractLayout, shortRelation } from '/layout.js';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const colors = { concept: '#8aabff', claim: '#dfb675', decision: '#70c8ac', question: '#c4a0ef', task: '#eb9ca3' };
const names = { concept: 'Concept', claim: 'Claim', decision: 'Decision', question: 'Question', task: 'Task' };
let graph = null, selected = null, dirty = false, changed = new Set(), dragging = null, loading = 0;
let camera = { x: 0, y: 0, w: 1500, h: 1000 };
let penMode = false, strokes = [], events;
let layoutJob = null, layoutPreview = null, layoutUndo = null, layoutSaving = false;
let draft = null, mutationTail = Promise.resolve(), pending = 0, review = null, inspectedLatest = null;
let newNode = false, edgeEditing = null, edgeDirty = false, instructionDirty = false, instructionTimer;
let draftConflict = false, reviewBusy = false;
function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
let noticeTimer;
function notice(text) { $('notice').textContent = text; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 7000); }
async function api(tool, args = {}, sessionId = graph?.sessionId) {
  const r = await fetch('/api/agent/v1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: newId(), sessionId, tool, arguments: args, actor: 'user' }) });
  const data = await r.json();
  if (!r.ok || data.isError) { const error = new Error([`${data.error?.code ?? r.status}: ${data.error?.message ?? 'Request failed'}`, data.error?.recovery?.instructions, data.error?.details ? JSON.stringify(data.error.details) : ''].filter(Boolean).join('\n')); error.status = r.status; error.payload = data; throw error; }
  return data.result;
}
function svg(tag, attrs, text) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); if (text !== undefined) e.textContent = text; return e; }
function activeNodes() { return graph?.nodes.filter(n => $('show-retired').checked || n.status !== 'retired') ?? []; }
function displayedLayout() { return layoutPreview?.layout ?? { positions: graph.positions, routes: graph.routes }; }
function point(node) {
  if (dragging?.id === node.id) return dragging.position;
  const i = graph.nodes.findIndex(n => n.id === node.id);
  return displayedLayout().positions[node.id] ?? { x: 90 + (i % 3) * 440, y: 100 + Math.floor(i / 3) * 235 };
}
let minimapBounds = null, minimapFrame = null, minimapDrag = null;
function geometryBounds(nodes = activeNodes()) {
  if (!nodes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const n of nodes) { const p = point(n); include(p.x, p.y); include(p.x + 340, p.y + 150); }
  if (!dragging?.id) for (const route of Object.values(displayedLayout().routes ?? {})) {
    for (const section of route.sections) for (const p of section) include(p.x, p.y);
    include(route.label.x, route.label.y); include(route.label.x + route.label.width, route.label.y + route.label.height);
  }
  return { minX, minY, maxX, maxY };
}
function view() { $('canvas').setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.w} ${camera.h}`); updateMinimapView(); }
function fit() {
  const bounds = geometryBounds(); if (!bounds) return;
  const { minX, minY, maxX, maxY } = bounds;
  const width = Math.max(900, maxX - minX + 140), height = Math.max(600, maxY - minY + 140);
  const ratio = $('canvas').clientWidth / Math.max(1, $('canvas').clientHeight);
  const w = Math.max(width, height * ratio), h = Math.max(height, width / ratio);
  camera = { x: (minX + maxX - w) / 2, y: (minY + maxY - h) / 2, w, h }; view();
}
function drawMinimap(nodes = activeNodes()) {
  minimapBounds = geometryBounds(nodes);
  $('minimap-panel').hidden = !minimapBounds;
  $('minimap-nodes').replaceChildren(); $('minimap-edges').replaceChildren();
  if (!minimapBounds) return;
  const positions = new Map(nodes.map(n => [n.id, point(n)]));
  for (const edge of graph.edges) {
    const a = positions.get(edge.source), b = positions.get(edge.target);
    if (!a || !b || (!$('show-retired').checked && edge.status === 'retired')) continue;
    const route = dragging?.id ? null : displayedLayout().routes?.[edge.id];
    const d = route ? route.sections.map(section => `M ${section.map(p => `${p.x} ${p.y}`).join(' L ')}`).join(' ') : `M ${a.x + 170} ${a.y + 75} L ${b.x + 170} ${b.y + 75}`;
    $('minimap-edges').append(svg('path', { d }));
  }
  for (const n of nodes) {
    const p = positions.get(n.id);
    $('minimap-nodes').append(svg('rect', { x: p.x, y: p.y, width: 340, height: 150, rx: 20, fill: colors[n.kind], class: selected?.id === n.id ? 'selected' : '', 'data-minimap-node': n.id }));
  }
  updateMinimapView();
}
function updateMinimapView() {
  if (!minimapBounds) return;
  const canvas = $('canvas'), matrix = canvas.getScreenCTM(); if (!matrix) return;
  const box = canvas.getBoundingClientRect(), inverse = matrix.inverse();
  const a = new DOMPoint(box.left, box.top).matrixTransform(inverse), b = new DOMPoint(box.right, box.bottom).matrixTransform(inverse);
  const viewport = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  const x = Math.min(minimapBounds.minX, viewport.x) - 40, y = Math.min(minimapBounds.minY, viewport.y) - 40;
  minimapFrame = minimapDrag?.frame ?? { x, y, w: Math.max(minimapBounds.maxX, b.x) + 40 - x, h: Math.max(minimapBounds.maxY, b.y) + 40 - y };
  const f = minimapFrame; $('minimap').setAttribute('viewBox', `${f.x} ${f.y} ${f.w} ${f.h}`);
  for (const [name, value] of Object.entries({ x: viewport.x, y: viewport.y, width: viewport.w, height: viewport.h })) $('minimap-viewport').setAttribute(name, value);
}
$('minimap').addEventListener('pointerdown', e => {
  if (e.button !== 0 || dragging || minimapDrag || !minimapFrame) return;
  e.preventDefault(); $('minimap').focus();
  const inverse = $('minimap').getScreenCTM().inverse(), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(inverse);
  const inside = e.target === $('minimap-viewport');
  minimapDrag = { pointerId: e.pointerId, inverse, frame: { ...minimapFrame }, start: p, clientX: e.clientX, clientY: e.clientY, offsetX: inside ? p.x - camera.x : camera.w / 2, offsetY: inside ? p.y - camera.y : camera.h / 2, moved: false };
  $('minimap').setPointerCapture(e.pointerId);
  if (!inside) { camera.x = p.x - camera.w / 2; camera.y = p.y - camera.h / 2; view(); }
});
$('minimap').addEventListener('pointermove', e => {
  const d = minimapDrag; if (!d || d.pointerId !== e.pointerId) return;
  d.moved ||= Math.hypot(e.clientX - d.clientX, e.clientY - d.clientY) > 2;
  if (!d.moved) return;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(d.inverse);
  camera.x = p.x - d.offsetX; camera.y = p.y - d.offsetY; view();
});
function endMinimapDrag(e) {
  const d = minimapDrag; if (!d || d.pointerId !== e.pointerId) return;
  minimapDrag = null;
  if (e.type === 'pointerup' && !d.moved) { camera.x = d.start.x - camera.w / 2; camera.y = d.start.y - camera.h / 2; }
  if ($('minimap').hasPointerCapture(e.pointerId)) $('minimap').releasePointerCapture(e.pointerId);
  view();
}
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('minimap').addEventListener(event, endMinimapDrag);
$('minimap').addEventListener('keydown', e => {
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (e.key === 'Home') { e.preventDefault(); fit(); }
  else if (delta) { e.preventDefault(); camera.x += delta[0] * camera.w / 10; camera.y += delta[1] * camera.h / 10; view(); }
});
$('minimap-toggle').onclick = () => {
  const collapsed = !$('minimap').hasAttribute('hidden');
  $('minimap').toggleAttribute('hidden', collapsed);
  $('minimap-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('minimap-toggle').textContent = collapsed ? 'Expand' : 'Collapse';
};
new ResizeObserver(updateMinimapView).observe($('canvas'));
function wrap(text, max = 21) {
  const lines = []; let rest = text;
  while (rest.length && lines.length < 3) { lines.push(rest.slice(0, max)); rest = rest.slice(max); }
  if (rest) lines[2] = lines[2].slice(0, max - 1) + '…'; return lines;
}
function neighbors() {
  const ids = new Set(selected ? [selected.id] : []);
  if (selected) for (const e of graph.edges) if (e.status === 'active' && (e.source === selected.id || e.target === selected.id)) { ids.add(e.source); ids.add(e.target); }
  return ids;
}
function drawEdges() {
  $('edges').replaceChildren();
  const ids = new Set(activeNodes().map(n => n.id));
  for (const edge of graph.edges) {
    if ((!$('show-retired').checked && edge.status === 'retired') || !ids.has(edge.source) || !ids.has(edge.target)) continue;
    const route = dragging?.id ? null : displayedLayout().routes?.[edge.id];
    const focused = selected && $('focus-relations').checked && (edge.source === selected.id || edge.target === selected.id);
    const dimmed = selected && $('focus-relations').checked && !focused;
    const group = svg('g', { class: `graph-edge ${route ? 'routed' : ''} ${focused ? 'focused' : ''} ${dimmed ? 'dimmed' : ''}`, 'data-edge-id': edge.id, opacity: edge.status === 'retired' ? .3 : 1 });
    group.append(svg('title', {}, edge.relation));
    let label;
    if (route) {
      for (const section of route.sections) group.append(svg('path', { d: section.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '), class: 'edge-line' }));
      group.append(svg('rect', { x: route.label.x, y: route.label.y, width: route.label.width, height: route.label.height, rx: 5, class: 'edge-label-bg' }));
      label = svg('text', { x: route.label.x + route.label.width / 2, y: route.label.y + route.label.height / 2 + 4, class: 'edge-label' }, route.label.text);
    } else {
      const a = point(graph.nodes.find(n => n.id === edge.source)), b = point(graph.nodes.find(n => n.id === edge.target));
      const dx = b.x - a.x, dy = b.y - a.y;
      let x1 = a.x + 170, y1 = a.y + 75, x2 = b.x + 170, y2 = b.y + 75;
      if (Math.abs(dx) > Math.abs(dy)) { x1 += Math.sign(dx) * 172; x2 -= Math.sign(dx) * 177; } else { y1 += Math.sign(dy) * 77; y2 -= Math.sign(dy) * 82; }
      const parallel = graph.edges.filter(e => e.status === 'active' && ((e.source === edge.source && e.target === edge.target) || (e.source === edge.target && e.target === edge.source)));
      const offset = (parallel.indexOf(edge) - (parallel.length - 1) / 2) * 44;
      const self = edge.source === edge.target, cx = (x1 + x2) / 2 + (Math.abs(dx) <= Math.abs(dy) ? offset : 0), cy = (y1 + y2) / 2 + (Math.abs(dx) > Math.abs(dy) ? offset : 0);
      group.append(svg('path', { d: self ? `M${a.x + 260},${a.y} C${a.x + 420 + offset},${a.y - 110} ${a.x - 80 - offset},${a.y - 110} ${a.x + 80},${a.y}` : `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, class: 'edge-line' }));
      label = svg('text', { x: self ? a.x + 170 : cx, y: self ? a.y - 75 - Math.abs(offset) / 3 : cy - 10, class: 'edge-label' }, shortRelation(edge.relation));
    }
    group.append(label); $('edges').append(group);
    group.setAttribute('tabindex', '0'); group.setAttribute('role', 'button'); group.setAttribute('aria-label', `Edit relationship: ${edge.relation}`);
    group.addEventListener('click', () => openEdge(edge.id));
    group.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdge(edge.id); } });
  }
}
function draw() {
  if (!graph || dragging) return;
  $('nodes').replaceChildren(); drawEdges();
  const nodes = activeNodes(), adjacent = neighbors();
  for (const n of nodes) {
    const p = point(n), group = svg('g', { transform: `translate(${p.x},${p.y})`, class: `graph-node ${selected?.id === n.id ? 'selected' : ''} ${changed.has(n.id) ? 'changed' : ''} ${n.status === 'retired' ? 'retired' : ''} ${selected && $('focus-relations').checked && !adjacent.has(n.id) ? 'dimmed' : ''}`, 'data-node-id': n.id, tabindex: 0, role: 'button', 'aria-label': `${names[n.kind]}: ${n.label}` });
    group.append(svg('title', {}, n.label), svg('rect', { class: 'body', width: 340, height: 150 }), svg('line', { x1: 0, y1: 25, x2: 0, y2: 125, class: 'accent-line', stroke: colors[n.kind] }));
    group.append(svg('text', { x: 20, y: 27, class: 'kind', fill: colors[n.kind] }, names[n.kind].toUpperCase()));
    wrap(n.label).forEach((line, i) => group.append(svg('text', { x: 20, y: 57 + i * 23, class: 'label' }, line)));
    group.append(svg('text', { x: 20, y: 132, class: 'status' }, `${n.status === 'confirmed' ? 'Confirmed' : n.status === 'retired' ? 'Retired' : 'Proposed'}  ·  ${n.sources.length} source${n.sources.length === 1 ? '' : 's'}`));
    group.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(n.id, false, e.ctrlKey); } });
    group.addEventListener('pointerdown', e => {
      if (penMode) return;
      if (e.button !== 0) return; e.stopPropagation();
      if (layoutLocked()) { e.preventDefault(); select(n.id, false, e.ctrlKey); return; }
      if (pending || reviewBusy || hasUnsaved() || strokes.length) { select(n.id, false, e.ctrlKey); if (strokes.length) notice('Clear or submit drawings before moving nodes.'); return; }
      const start = screenPoint(e); dragging = { id: n.id, start, origin: p, element: group, position: p, layoutRevision: graph.layoutRevision, graphRevision: graph.revision, moved: false };
      group.setPointerCapture(e.pointerId);
    });
    $('nodes').append(group);
  }
  renderInk();
  drawMinimap(nodes);
  $('empty').hidden = nodes.length > 0;
}
function select(id, discard = false, focus) {
  if (dirty && !discard) { if (selected?.id !== id) notice('Save your changes or reload before selecting another node.'); return; }
  if (typeof focus === 'boolean') $('focus-relations').checked = focus;
  selected = graph.nodes.find(n => n.id === id); dirty = false;
  newNode = false; $('new-node-position').hidden = true;
  $('editor').hidden = !selected; $('hint').hidden = !!selected; $('edit-warning').hidden = true;
  if (selected) {
    $('inspector-title').textContent = 'Node details and editing'; $('node-kind').textContent = names[selected.kind]; $('node-id').textContent = selected.id;
    $('node-label').value = selected.label; $('node-detail').value = selected.detail; $('node-status').value = selected.status;
    $('node-type').value = selected.kind;
    $('sources').replaceChildren();
    for (const source of selected.sources) {
      const li = document.createElement('li');
      if (source.kind === 'url' && /^https?:\/\//i.test(source.ref)) { const a = document.createElement('a'); a.href = source.ref; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = source.ref; li.append(a); }
      else li.textContent = `${source.kind}: ${source.ref}`;
      $('sources').append(li);
    }
  }
  $('relation-panel').hidden = !selected;
  $('node-relations').replaceChildren();
  if (selected) for (const edge of graph.edges) if (edge.status === 'active' && (edge.source === selected.id || edge.target === selected.id)) {
    const item = document.createElement('li'), source = graph.nodes.find(n => n.id === edge.source), target = graph.nodes.find(n => n.id === edge.target);
    item.textContent = `${source.label} → ${target.label}: ${edge.relation}`;
    $('node-relations').append(item);
  }
  $('feedback-target').textContent = selected ? `Selected: ${selected.label} · ${selected.id}` : 'No selection';
  draw(); layoutControls();
}
async function loadGraph(id) {
  if (pending) { await mutationTail; if (pending) return; }
  const ticket = ++loading, isNew = graph?.sessionId !== id;
  if (!isNew && draft) { await checkCanonical(); return; }
  const latest = await api('graph_read', {}, id);
  let draftId;
  try { draftId = localStorage.getItem(`axcanvas-draft:${id}`); } catch { /* Storage can be unavailable. */ }
  draftId ||= newId();
  let opened = await api('draft_open', { draftId }, id);
  if (opened.state !== 'editing') { draftId = newId(); opened = await api('draft_open', { draftId }, id); }
  if (ticket !== loading) return;
  try { localStorage.setItem(`axcanvas-draft:${id}`, draftId); } catch { notice('Browser storage is unavailable; this draft cannot be automatically restored after reload.'); }
  selected = null; newNode = false; dirty = false; edgeDirty = false; edgeEditing = null; instructionDirty = false;
  $('editor').hidden = true; $('edge-editor').hidden = true; $('hint').hidden = false;
  acceptDraft(opened, true);
  draftConflict = latest.revision !== opened.baseRevision || latest.layoutRevision !== opened.baseLayoutRevision;
  location.hash = id; remember(id, latest.title); renderSessions(); $('sessions').value = id;
  $('title').textContent = latest.title; $('subtitle').textContent = `Session ${id}`;
  $('turn-detail').textContent = 'Only reviewed submissions notify a connected watcher. Connection does not prove agent execution.';
  connectEvents(id); fit(); layoutControls(); await loadFeedback(); await watcherStatus();
}
async function refresh(id) {
  const target = id ?? graph?.sessionId ?? decodeURIComponent(location.hash.slice(1));
  renderSessions();
  if (target) await loadGraph(target);
}
function screenPoint(e) { const p = $('canvas').createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform($('canvas').getScreenCTM().inverse()); }
function startPan(e) {
  e.preventDefault();
  const inverse = $('canvas').getScreenCTM().inverse();
  dragging = { camera: { ...camera }, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, scaleX: inverse.a, scaleY: inverse.d };
  $('canvas').classList.add('panning');
  $('canvas').setPointerCapture(e.pointerId);
}
$('canvas').addEventListener('pointermove', e => {
  if (!dragging || (dragging.pointerId !== undefined && dragging.pointerId !== e.pointerId)) return;
  const p = screenPoint(e);
  if (dragging.ink) {
    const points = dragging.stroke.points, last = points[points.length - 1];
    if (points.length < 2000 && Math.hypot(p.x - last.x, p.y - last.y) >= 3) points.push({ x: Math.round(p.x), y: Math.round(p.y) });
    renderInk(); return;
  }
  if (dragging.id) { const x = dragging.origin.x + p.x - dragging.start.x, y = dragging.origin.y + p.y - dragging.start.y; dragging.position = { x: Math.round(x), y: Math.round(y) }; dragging.moved ||= Math.abs(x - dragging.origin.x) + Math.abs(y - dragging.origin.y) > 4; dragging.element.setAttribute('transform', `translate(${x},${y})`); drawEdges(); drawMinimap(); }
  else { camera.x = dragging.camera.x - (e.clientX - dragging.clientX) * dragging.scaleX; camera.y = dragging.camera.y - (e.clientY - dragging.clientY) * dragging.scaleY; view(); }
});
async function endDrag(e) {
  if (!dragging || (dragging.pointerId !== undefined && dragging.pointerId !== e.pointerId)) return;
  const d = dragging; dragging = null;
  $('canvas').classList.remove('panning');
  if (d.pointerId !== undefined && $('canvas').hasPointerCapture(d.pointerId)) $('canvas').releasePointerCapture(d.pointerId);
  if (d.ink) { if (d.stroke.points.length < 2) strokes.pop(); renderInk(); instructionDirty = true; saveInstructions().catch(e => notice(e.message)); layoutControls(); return; }
  if (d.id && d.moved) {
    try { await changeDraft({ type: 'move', nodeId: d.id, position: d.position }); }
    catch (error) { notice(error.message); draw(); }
  } else if (d.id) select(d.id, false, e.ctrlKey);
  else draw();
}
$('canvas').addEventListener('pointerup', endDrag);
$('canvas').addEventListener('pointercancel', endDrag);
$('canvas').addEventListener('lostpointercapture', endDrag);
$('canvas').addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
$('canvas').addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
$('canvas').addEventListener('pointerdown', e => {
  if (e.button === 1) { if (!dragging) startPan(e); return; }
  if (layoutLocked() || pending || reviewBusy) { if (e.button === 0 && !e.target.closest('.graph-node')) startPan(e); return; }
  if (e.button !== 0 || !graph) return;
  if (penMode) {
    if (strokes.length >= 100) { notice('Each instruction supports up to 100 strokes. Send or clear the current drawing first.'); return; }
    const p = screenPoint(e), stroke = { points: [{ x: Math.round(p.x), y: Math.round(p.y) }] };
    strokes.push(stroke); dragging = { ink: true, stroke }; $('canvas').setPointerCapture(e.pointerId); return;
  }
  if (e.target.closest('.graph-node')) return;
  startPan(e);
});
function zoom(factor) { const w = Math.min(20000, Math.max(350, camera.w * factor)), ratio = w / camera.w; camera.x += (camera.w - w) / 2; camera.y += (camera.h - camera.h * ratio) / 2; camera.w = w; camera.h *= ratio; view(); }
$('canvas').addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.1 : .9); }, { passive: false });
$('fit').onclick = fit; $('zoom-in').onclick = () => zoom(.8); $('zoom-out').onclick = () => zoom(1.25); $('show-retired').onchange = draw;
$('sessions').onchange = () => {
  if (layoutLocked() || pending || hasUnsaved()) { $('sessions').value = graph?.sessionId ?? ''; notice('Save or discard active form edits before changing sessions.'); return; }
  loadGraph($('sessions').value).catch(e => notice(e.message));
};
$('editor').addEventListener('input', () => { dirty = true; layoutControls(); });
$('cancel').onclick = () => { dirty = false; if (newNode) { newNode = false; selected = null; } select(selected?.id, true); };
$('editor').onsubmit = async e => {
  e.preventDefault();
  try { await saveNode(); notice('Saved to draft.'); }
  catch (error) { notice(`Could not save: ${error.message}\nYour input is preserved.`); }
};
async function loadHistory() {
  const { history: list } = await api('graph_history'); $('history').replaceChildren();
  for (const item of list.slice(-12).reverse()) { const li = document.createElement('li'); li.textContent = `rev ${item.revision} · ${item.actor} · ${item.changedNodeIds.length} nodes · ${new Date(item.at).toLocaleTimeString('en-US')}`; $('history').append(li); }
}
$('history-toggle').onclick = async () => { $('history').hidden = !$('history').hidden; $('history-toggle').setAttribute('aria-expanded', String(!$('history').hidden)); $('history-toggle').textContent = $('history').hidden ? 'Show history' : 'Collapse'; if (!$('history').hidden && graph) try { await loadHistory(); } catch (e) { notice(e.message); } };
function remember(id, title) {
  const list = visited().filter(item => item.id !== id); list.unshift({ id, title });
  try { localStorage.setItem('axcanvas-recent', JSON.stringify(list.slice(0, 30))); } catch { /* Optional local history; the session URL still works. */ }
}
function visited() {
  try { const items = JSON.parse(localStorage.getItem('axcanvas-recent') ?? '[]'); return Array.isArray(items) ? items.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string') : []; }
  catch { return []; }
}
function renderSessions() {
  const list = visited(); $('sessions').replaceChildren();
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Recent sessions'; $('sessions').append(placeholder);
  for (const item of list) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; $('sessions').append(option); }
}
function connectEvents(sessionId) {
  events?.close(); events = new EventSource(`/api/events?sessionId=${encodeURIComponent(sessionId)}`);
  events.onopen = () => { $('connection').textContent = '● Connected'; $('connection').className = 'connection'; };
  events.onerror = () => { $('connection').textContent = '● Reconnecting'; $('connection').className = 'connection offline'; };
  events.onmessage = async () => {
    try { await checkCanonical(); if (graph?.sessionId === sessionId) await loadFeedback(); }
    catch (error) { notice(error.message); }
  };
}
function renderInk() {
  $('ink').replaceChildren();
  for (const stroke of strokes) $('ink').append(svg('polyline', { points: stroke.points.map(p => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: '#ffca70', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}
async function loadFeedback() {
  const sessionId = graph?.sessionId; if (!sessionId) return;
  const result = await api('feedback_read', { status: 'all' }, sessionId);
  if (graph?.sessionId !== sessionId) return;
  $('feedback-list').replaceChildren();
  const status = { pending: 'Pending', applied: 'Applied', needs_clarification: 'Needs clarification', rejected: 'Rejected' };
  for (const item of result.feedback.slice(-5).reverse()) {
    const li = document.createElement('li'); li.dataset.feedbackId = item.id;
    const summary = document.createElement('strong'); summary.textContent = `${status[item.status]} · ${item.strokes.length} strokes`;
    const note = document.createElement('p'); note.textContent = item.note || 'Drawing instruction';
    const link = document.createElement('a'); link.href = item.imageUrl; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Submitted drawing';
    li.append(summary, note, link); if (item.resolution) { const resolution = document.createElement('p'); resolution.textContent = item.resolution; li.append(resolution); }
    $('feedback-list').append(li);
  }
}
$('pen').onclick = () => { penMode = !penMode; $('pen').setAttribute('aria-pressed', String(penMode)); $('canvas').classList.toggle('drawing', penMode); };
$('clear-ink').onclick = () => { strokes = []; instructionDirty = true; renderInk(); saveInstructions().catch(e => notice(e.message)); layoutControls(); };
$('feedback-note').oninput = () => { instructionDirty = true; review = null; clearTimeout(instructionTimer); instructionTimer = setTimeout(() => saveInstructions().catch(e => notice(e.message)), 350); layoutControls(); };
$('send-feedback').onclick = openReview;
$('open-session').onclick = async () => {
  if (layoutLocked() || pending || hasUnsaved()) { notice('Save or discard active form edits before changing sessions.'); return; }
  const id = $('session-id').value.trim() || newId();
  try { await api('session_open', { title: `Canvas ${id}` }, id); await refresh(id); $('session-id').value = ''; }
  catch (error) { notice(error.message); }
};
window.addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id || id === graph?.sessionId) return;
  if (layoutLocked() || pending || hasUnsaved()) { location.hash = graph?.sessionId ?? ''; notice('Save or discard active form edits before changing sessions.'); return; }
  loadGraph(id).catch(e => notice(e.message));
});

function hasUnsaved() { return dirty || edgeDirty || instructionDirty; }
function hasDraft() { return hasUnsaved() || strokes.length > 0; }
function layoutLocked() { return !!(layoutJob || layoutPreview || layoutSaving); }
function layoutControls() {
  const locked = layoutLocked() || pending > 0 || reviewBusy, unsaved = hasDraft(), available = !!graph?.nodes.some(n => n.status !== 'retired');
  $('auto-layout').disabled = !available || locked || unsaved;
  $('auto-layout').textContent = layoutJob ? 'Computing…' : 'Auto layout';
  $('apply-layout').hidden = !layoutPreview; $('apply-layout').disabled = layoutSaving;
  $('cancel-layout').hidden = !layoutJob && !layoutPreview; $('cancel-layout').disabled = layoutSaving;
  $('undo-layout').disabled = !layoutUndo || locked || unsaved;
  $('layout-direction').disabled = locked;
  for (const id of ['node-label', 'node-detail', 'node-status', 'node-type', 'node-x', 'node-y', 'cancel', 'retire-node']) $(id).disabled = locked;
  $('save').disabled = locked || !selected;
  for (const id of ['pen', 'clear-ink', 'feedback-note', 'sessions', 'open-session', 'session-id', 'show-retired', 'add-node', 'connect-nodes', 'edge-picker', 'edge-source', 'edge-target', 'edge-relation', 'edge-reverse', 'edge-save', 'edge-cancel', 'edge-retire', 'discard-draft', 'inspect-latest']) $(id).disabled = locked || !graph;
  $('send-feedback').disabled = locked || !graph || !!dragging;
  $('draft-undo').disabled = locked || hasUnsaved() || !draft?.canUndo;
  $('draft-redo').disabled = locked || hasUnsaved() || !draft?.canRedo;
  $('draft-version').textContent = draft ? `Draft version ${draft.version}${pending ? ' · Saving…' : ''}${draftConflict ? ' · Conflict: inspect latest before submitting' : ''}` : 'No draft';
  $('review-submit').disabled = locked || !review?.canSubmit || draftConflict;
  const state = layoutSaving ? 'saving' : layoutJob ? 'computing' : layoutPreview ? 'preview' : 'idle';
  $('layout-status').dataset.state = state;
  $('layout-status').textContent = layoutSaving ? 'Saving layout…' : layoutJob ? 'Computing positions and routes in a Worker…' : layoutPreview ? 'Preview — not saved yet.' : unsaved ? 'Save form edits and clear or submit drawings before layout.' : layoutUndo ? 'Applied to draft — undo is available.' : 'Positions change only when you run layout.';
}
function cancelLayout(reason = '') {
  if (layoutSaving) return;
  if (layoutJob) { const job = layoutJob; layoutJob = null; job.reject(new Error('Layout cancelled')); job.elk?.terminateWorker(); clearTimeout(job.timer); }
  if (layoutPreview) { camera = { ...layoutPreview.cameraBefore }; layoutPreview = null; view(); }
  draw(); layoutControls(); if (reason) notice(reason);
}
async function previewLayout() {
  if (!graph || layoutLocked() || hasDraft()) return;
  const cancelled = Promise.withResolvers();
  const job = { id: newId(), sessionId: graph.sessionId, baseRevision: graph.revision, baseLayoutRevision: graph.layoutRevision, snapshot: structuredClone(graph), direction: $('layout-direction').value, elk: null, reject: cancelled.reject, timer: null };
  layoutJob = job; layoutControls();
  job.timer = setTimeout(() => job.reject(new Error('Layout exceeded 30 seconds. The existing layout is preserved.')), 30000);
  try {
    await Promise.race([document.fonts.ready, cancelled.promise]);
    if (layoutJob !== job) return;
    const measure = document.createElement('canvas').getContext('2d');
    if (!measure || typeof window.ELK !== 'function') throw new Error('The layout engine or font measurement is unavailable.');
    measure.font = `13px ${getComputedStyle(document.body).fontFamily}`;
    const labels = Object.fromEntries(job.snapshot.edges.filter(e => e.status === 'active').map(e => { const text = shortRelation(e.relation); return [e.id, { text, width: Math.ceil(measure.measureText(text).width) + 20, height: 28 }]; }));
    job.elk = new window.ELK({
      workerUrl: '/vendor/elk-worker.js', algorithms: ['layered'],
      workerFactory: url => {
        const worker = new Worker(url);
        worker.addEventListener('error', event => job.reject(new Error(event.message || 'Could not load the layout Worker.')));
        worker.addEventListener('messageerror', () => job.reject(new Error('Could not read the layout Worker response.')));
        return worker;
      }
    });
    const output = await Promise.race([job.elk.layout(buildLayoutGraph(job.snapshot, job.direction, labels)), cancelled.promise]);
    if (layoutJob !== job || graph.sessionId !== job.sessionId || graph.revision !== job.baseRevision || graph.layoutRevision !== job.baseLayoutRevision) return;
    const layout = extractLayout(output, job.direction);
    layoutPreview = { id: job.id, sessionId: job.sessionId, baseRevision: job.baseRevision, baseLayoutRevision: job.baseLayoutRevision, layout, before: { positions: job.snapshot.positions, routes: job.snapshot.routes, direction: job.snapshot.layoutDirection }, cameraBefore: { ...camera } };
    layoutJob = null; draw(); fit();
  } catch (error) { if (layoutJob === job) notice(`Could not compute layout: ${error.message}`); }
  finally { clearTimeout(job.timer); job.elk?.terminateWorker(); if (layoutJob === job) layoutJob = null; layoutControls(); }
}
async function applyLayout() {
  if (!layoutPreview || layoutSaving) return;
  const candidate = layoutPreview; layoutPreview = null; layoutSaving = true; layoutControls();
  try {
    await changeDraft({ type: 'layout', ...candidate.layout });
    layoutUndo = { sessionId: candidate.sessionId, version: draft.version, before: candidate.before, cameraBefore: candidate.cameraBefore };
    fit(); notice('Auto layout saved to draft.');
  } catch (error) {
    camera = { ...candidate.cameraBefore }; view(); notice(`Could not save layout: ${error.message}`);
  } finally { layoutSaving = false; layoutControls(); draw(); }
}
async function undoLayout() {
  if (!layoutUndo || layoutLocked() || hasDraft()) return;
  const undo = layoutUndo; layoutSaving = true; layoutControls();
  try {
    if (undo.version !== draft.version) throw new Error('The draft changed after layout. Use draft Undo instead.');
    await mutateDraft('draft_step', { direction: 'undo' });
    layoutUndo = null; camera = { ...undo.cameraBefore }; view(); notice('The previous layout was restored in the draft.');
  } catch (error) { notice(`Could not undo layout: ${error.message}`); }
  finally { layoutSaving = false; layoutControls(); draw(); }
}
$('auto-layout').onclick = previewLayout;
$('apply-layout').onclick = applyLayout;
$('cancel-layout').onclick = () => cancelLayout();
$('undo-layout').onclick = undoLayout;
$('focus-relations').onchange = draw;

function acceptDraft(next, restoreInstructions = false) {
  const priorVersion = draft?.version;
  draft = next; graph = next.graph; review = null;
  if (priorVersion !== next.version && !layoutSaving) layoutUndo = null;
  if (restoreInstructions || !instructionDirty) { strokes = structuredClone(next.strokes); $('feedback-note').value = next.note; }
  if (!layoutLocked() && graph.layoutDirection) $('layout-direction').value = graph.layoutDirection;
  if (restoreInstructions) instructionDirty = false;
  if (selected && !dirty) select(selected.id, true);
  $('revision').textContent = `rev ${next.baseRevision}`;
  $('counts').textContent = `${graph.nodes.filter(n => n.status !== 'retired').length} nodes · ${graph.edges.filter(e => e.status !== 'retired').length} relations`;
  $('turn-status').textContent = `Draft version ${next.version} · not submitted`;
  $('turn-status').className = 'turn-status';
  renderEdgePicker(); draw(); layoutControls();
}
function mutateDraft(tool, args) {
  const id = draft.id, sessionId = graph.sessionId;
  pending++; review = null; layoutControls();
  const task = mutationTail.then(async () => {
    if (draft.id !== id) throw new Error('The active draft changed. Your action was not applied.');
    const next = await api(tool, { draftId: id, baseDraftVersion: draft.version, ...args }, sessionId);
    acceptDraft(next); return next;
  });
  mutationTail = task.catch(error => {
    if (error.status === 409) { draftConflict = true; $('edit-warning').hidden = false; }
  }).finally(() => { pending--; layoutControls(); });
  return task;
}
function changeDraft(operation) {
  if (strokes.length && (['move', 'layout', 'retire_node'].includes(operation.type) || (operation.type === 'node' && !graph.nodes.some(n => n.id === operation.node.id)))) return Promise.reject(new Error('Clear or submit drawings before changing geometry.'));
  return mutateDraft('draft_change', { operation });
}
async function saveNode() {
  if (!selected || !dirty) return;
  if (!$('node-label').value.trim() || !$('editor').reportValidity()) throw new Error('Complete the node form before reviewing.');
  const node = { ...selected, kind: $('node-type').value, label: $('node-label').value, detail: $('node-detail').value, status: $('node-status').value };
  const operation = node.status === 'retired' && !newNode ? { type: 'retire_node', nodeId: node.id } : { type: 'node', node };
  if (newNode) operation.position = { x: Number($('node-x').value), y: Number($('node-y').value) };
  await changeDraft(operation);
  dirty = false; newNode = false; select(node.id, true);
}
function renderEdgePicker() {
  const picker = $('edge-picker'); picker.replaceChildren(new Option('Choose a relationship', ''));
  for (const edge of graph.edges) picker.add(new Option(`${edge.source} → ${edge.target}: ${edge.relation}${edge.status === 'retired' ? ' (retired)' : ''}`, edge.id));
  picker.value = edgeEditing?.id ?? '';
}
function openEdge(id) {
  if (pending || layoutLocked() || edgeDirty) { notice('Save or discard relationship edits first.'); return; }
  const edge = graph.edges.find(e => e.id === id);
  edgeEditing = edge ? { ...edge } : { id: newId(), source: selected?.id ?? '', target: '', relation: '', status: 'active' };
  for (const field of ['edge-source', 'edge-target']) {
    $(field).replaceChildren(new Option('Choose a node', ''));
    for (const node of graph.nodes.filter(n => n.status !== 'retired')) $(field).add(new Option(`${node.label} · ${node.id}`, node.id));
  }
  $('edge-id').textContent = edgeEditing.id; $('edge-source').value = edgeEditing.source; $('edge-target').value = edgeEditing.target;
  $('edge-relation').value = edgeEditing.relation; $('edge-editor').hidden = false; $('edge-retire').hidden = !edge;
  edgeDirty = !edge; $('edge-source').focus(); layoutControls();
}
async function saveEdge() {
  if (!edgeDirty) return;
  if (!$('edge-editor').reportValidity()) throw new Error('Complete the relationship form before reviewing.');
  const edge = { ...edgeEditing, source: $('edge-source').value, target: $('edge-target').value, relation: $('edge-relation').value };
  await changeDraft({ type: 'edge', edge });
  edgeDirty = false; edgeEditing = edge; $('edge-retire').hidden = false; layoutControls();
}
async function saveInstructions() {
  clearTimeout(instructionTimer);
  if (!draft || !instructionDirty) return;
  const note = $('feedback-note').value, savedStrokes = structuredClone(strokes);
  const nodeIds = selected && !newNode ? [selected.id] : draft.nodeIds.filter(id => graph.nodes.some(n => n.id === id && n.status !== 'retired'));
  await changeDraft({ type: 'instruction', note, strokes: savedStrokes, nodeIds });
  if ($('feedback-note').value === note && JSON.stringify(strokes) === JSON.stringify(savedStrokes)) instructionDirty = false;
  layoutControls();
}
async function flushForms() {
  clearTimeout(instructionTimer); await mutationTail;
  await saveNode(); await saveEdge(); await saveInstructions(); await mutationTail;
  if (hasUnsaved()) throw new Error('Save or explicitly discard all active input before continuing.');
}
async function openReview() {
  if (!draft || layoutLocked() || dragging) return;
  reviewBusy = true; layoutControls();
  try {
    await flushForms();
    const result = await api('draft_review', { draftId: draft.id, baseDraftVersion: draft.version });
    review = result; draftConflict = !!result.conflict;
    $('review-summary').textContent = `Draft version ${result.version} · ${result.changes.length} changes${result.conflict ? ' · Canonical conflict: back to editing and inspect latest.' : ''}${!result.canSubmit && !result.conflict ? ' · Nothing meaningful to submit.' : ''}`;
    $('review-changes').replaceChildren();
    for (const change of result.changes) {
      const section = document.createElement('section'), heading = document.createElement('h3'), before = document.createElement('pre'), after = document.createElement('pre');
      section.dataset.entity = change.entity; section.dataset.changeId = change.id;
      heading.textContent = `${change.entity} · ${change.id} · ${change.change}`;
      before.textContent = `Before:\n${JSON.stringify(change.before, null, 2)}`; after.textContent = `After:\n${JSON.stringify(change.after, null, 2)}`;
      section.append(heading, before, after); $('review-changes').append(section);
    }
    $('review-snapshot').textContent = JSON.stringify({ graph: draft.graph, note: draft.note, strokes: draft.strokes, nodeIds: draft.nodeIds }, null, 2);
    $('review-dialog').showModal();
  } catch (error) { notice(error.message); }
  finally { reviewBusy = false; layoutControls(); }
}
async function checkCanonical() {
  if (!draft) return;
  const id = draft.id, latest = await api('graph_read');
  if (draft?.id !== id) return;
  draftConflict = latest.revision !== draft.baseRevision || latest.layoutRevision !== draft.baseLayoutRevision;
  if (draftConflict) {
    review = null;
    if (layoutJob || layoutPreview) cancelLayout();
    $('edit-warning').hidden = false;
    notice('The canonical graph changed. Your draft and active input are preserved. Any outdated layout preview was cancelled. Inspect latest before submitting.');
  }
  layoutControls(); await watcherStatus();
}
async function watcherStatus() {
  if (!graph) return;
  const id = graph.sessionId;
  try {
    const response = await fetch(`/api/submissions/status?sessionId=${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('Status unavailable');
    const status = await response.json();
    if (graph?.sessionId === id) $('watcher-status').textContent = status.connected ? 'Watcher connected' : 'No watcher';
  } catch { $('watcher-status').textContent = 'Watcher status unavailable'; }
}
async function resetDraft() {
  const id = graph.sessionId;
  try { localStorage.removeItem(`axcanvas-draft:${id}`); } catch { /* Optional browser storage. */ }
  clearTimeout(instructionTimer);
  instructionDirty = false; strokes = []; $('feedback-note').value = '';
  draft = null; draftConflict = false; layoutUndo = null; await loadGraph(id);
}
$('add-node').onclick = () => {
  if (hasUnsaved()) { notice('Save or discard active input before adding a node.'); return; }
  if (strokes.length) { notice('Clear or submit drawings before changing geometry.'); return; }
  selected = { id: newId(), kind: 'concept', label: '', detail: '', status: 'proposed', sources: [] }; newNode = true; dirty = true;
  $('editor').hidden = false; $('hint').hidden = true; $('new-node-position').hidden = false; $('inspector-title').textContent = 'Create node';
  $('node-id').textContent = selected.id; $('node-kind').textContent = 'Concept'; $('node-type').value = 'concept'; $('node-label').value = ''; $('node-detail').value = ''; $('node-status').value = 'proposed';
  $('node-x').value = Math.round(camera.x + camera.w / 2 - 170); $('node-y').value = Math.round(camera.y + camera.h / 2 - 75);
  $('sources').replaceChildren(); $('node-label').focus(); layoutControls();
};
$('retire-node').onclick = async () => {
  if (!selected) return;
  if (dirty) { notice('Save or discard node input before retiring it.'); return; }
  if (strokes.length) { notice('Clear or submit drawings before changing geometry.'); return; }
  try { await changeDraft({ type: 'retire_node', nodeId: selected.id }); select(null, true); } catch (error) { notice(error.message); }
};
$('connect-nodes').onclick = () => openEdge();
$('edge-picker').onchange = () => { if ($('edge-picker').value) openEdge($('edge-picker').value); };
$('edge-editor').oninput = () => { edgeDirty = true; review = null; layoutControls(); };
$('edge-reverse').onclick = () => { const source = $('edge-source').value; $('edge-source').value = $('edge-target').value; $('edge-target').value = source; edgeDirty = true; review = null; layoutControls(); };
$('edge-editor').onsubmit = async e => { e.preventDefault(); try { await saveEdge(); notice('Relationship saved to draft.'); } catch (error) { notice(error.message); } };
$('edge-cancel').onclick = () => { edgeDirty = false; edgeEditing = null; $('edge-editor').hidden = true; layoutControls(); };
$('edge-retire').onclick = async () => {
  if (edgeDirty) { notice('Save or discard relationship input before retiring it.'); return; }
  try { await changeDraft({ type: 'retire_edge', edgeId: edgeEditing.id }); edgeEditing = null; $('edge-editor').hidden = true; } catch (error) { notice(error.message); }
};
for (const direction of ['undo', 'redo']) $(`draft-${direction}`).onclick = async () => {
  if (hasUnsaved()) { notice('Save or discard active input before undo or redo.'); return; }
  try { await mutateDraft('draft_step', { direction }); } catch (error) { notice(error.message); }
};
$('discard-draft').onclick = async () => {
  if (!confirm('Discard this entire draft, including unsaved form input, notes and drawings? The canonical graph will not change.')) return;
  clearTimeout(instructionTimer);
  try { await mutateDraft('draft_discard', {}); await mutationTail; await resetDraft(); } catch (error) { notice(error.message); }
};
$('review-back').onclick = () => { $('review-dialog').close(); review = null; layoutControls(); };
$('review-dialog').addEventListener('cancel', () => { review = null; });
$('review-submit').onclick = async () => {
  if (!review?.canSubmit || review.version !== draft.version || pending || reviewBusy || hasUnsaved()) return;
  reviewBusy = true; const approved = review; layoutControls();
  try {
    await api('draft_submit', { draftId: draft.id, baseDraftVersion: approved.version, reviewToken: approved.token });
    $('review-dialog').close(); await resetDraft(); notice('Reviewed changes submitted to agent. Delivery does not prove processing.');
  } catch (error) { review = null; $('review-summary').textContent = `Submission failed; draft preserved. ${error.message}`; }
  finally { reviewBusy = false; layoutControls(); }
};
$('inspect-latest').onclick = async () => {
  reviewBusy = true; layoutControls();
  try {
    await mutationTail;
    // Explicit inspection refreshes the shared draft version but never replaces active form input.
    const current = await api('draft_read', { draftId: draft.id });
    if (current.state !== 'editing') throw new Error(`This draft was ${current.state} in another tab. Reopen the page to start a new draft.`);
    acceptDraft(current);
    inspectedLatest = await api('graph_read');
    $('rebase-snapshot').textContent = JSON.stringify({ latest: inspectedLatest, draft: current }, null, 2);
    $('rebase-conflicts').textContent = 'Latest graph inspected. Active form input is preserved; save it before merging.';
    $('rebase-draft').disabled = true; $('rebase-latest').disabled = true;
    $('rebase-dialog').showModal();
  } catch (error) { notice(error.message); }
  finally { reviewBusy = false; layoutControls(); }
};
for (const [button, resolution] of [['rebase-merge', 'fail'], ['rebase-draft', 'draft'], ['rebase-latest', 'latest']]) $(button).onclick = async () => {
  if (hasUnsaved()) { $('rebase-conflicts').textContent = 'Back to editing: save or explicitly discard active form input, then inspect latest again.'; return; }
  for (const id of ['rebase-merge', 'rebase-draft', 'rebase-latest', 'rebase-back']) $(id).disabled = true;
  try {
    await mutateDraft('draft_rebase', { baseRevision: inspectedLatest.revision, baseLayoutRevision: inspectedLatest.layoutRevision, resolution });
    draftConflict = false; $('rebase-dialog').close(); notice('Draft rebased. Review the complete changes before submitting.');
  } catch (error) {
    $('rebase-conflicts').textContent = `${error.message}\n${JSON.stringify(error.payload?.error ?? {}, null, 2)}`;
    $('rebase-draft').disabled = false; $('rebase-latest').disabled = false;
  } finally { $('rebase-merge').disabled = false; $('rebase-back').disabled = false; layoutControls(); }
};
$('rebase-back').onclick = () => $('rebase-dialog').close();
window.addEventListener('beforeunload', event => { if (pending || hasUnsaved()) { event.preventDefault(); event.returnValue = ''; } });
setInterval(watcherStatus, 5000);
layoutControls();
refresh().catch(e => notice(e.message));
