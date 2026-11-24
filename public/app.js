import '/vendor/elk-api.js';
import { buildLayoutGraph, extractLayout, shortRelation } from '/layout.js';
import { flowView, boundaryRoles } from '/flows.js';
import { initWorkspace } from '/workspace.js';
import { initGraphSearch } from '/search.js';

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
let activeFlowId = null, captureFlowId = null, flowEditing = null, flowDirty = false, nodeFormFlowId = null, edgeFormFlowId = null;
let tool = 'select', spaceTool = null, selection = new Set(), clipboard = null, connector = null, gesture = null;
let placementKind = 'concept';
let workspace, saveError = '', deliveryState = '', composing = false, propertyTimer, editSession = null, propertySave = Promise.resolve();
let graphSearch;
const toolHints = { select: 'Select · Shift-click or drag to select several nodes', hand: 'Hand · Drag to pan', node: 'Add node · Click to place, then save', connect: 'Connect · Choose source and target, or drag a handle', draw: 'Draw · Annotate this scope', erase: 'Erase · Drag across whole annotation strokes' };
function refreshWorkspace() {
  workspace?.refresh({ selectionCount: selection.size, hasSelection: selection.size > 0, toolHint: toolHints[tool], canCenter: canCenterSelection(),
    saveState: pending ? 'Saving…' : saveError ? 'Save failed' : hasUnsaved() ? 'Unsaved input' : draft ? 'Saved to draft' : 'No draft',
    saveError, connectionState: `${$('connection').textContent} · ${$('watcher-status').textContent}${deliveryState ? ` · ${deliveryState}` : ''}`,
    zoomPercent: Math.round(1500 / camera.w * 100), conflict: draftConflict });
  graphSearch?.refresh();
}
function closeEditSession() { clearTimeout(propertyTimer); editSession = null; }
function editGroup(target) { if (editSession?.target !== target) editSession = { target, id: newId() }; return editSession.id; }
function formSnapshot(kind) {
  return JSON.stringify((kind === 'node' ? ['node-label', 'node-detail', 'node-status', 'node-type', 'node-x', 'node-y'] : ['edge-source', 'edge-target', 'edge-relation']).map(id => $(id).value));
}
function saveFailure(error) { saveError = error.message; notice(`${error.message} Your input is preserved; save or discard it before continuing.`); refreshWorkspace(); }
function scheduleProperties() {
  clearTimeout(propertyTimer); saveError = ''; refreshWorkspace();
  if (!composing) propertyTimer = setTimeout(() => persistProperties().catch(saveFailure), 600);
}
function persistProperties() {
  clearTimeout(propertyTimer);
  propertySave = propertySave.catch(() => {}).then(async () => {
    if (composing) return;
    if (dirty && !newNode) await saveNode(false);
    if (edgeDirty && graph?.edges.some(e => e.id === edgeEditing?.id)) await saveEdge(false);
  });
  return propertySave;
}
async function prepareSwitch() {
  if (composing) throw new Error('Finish composing text before continuing.');
  await persistProperties(); await mutationTail;
  if (instructionDirty) await saveInstructions();
  if (hasUnsaved()) throw new Error('Save or discard the active new object or flow form before continuing.');
  closeEditSession();
}
async function setTool(next) {
  try { await prepareSwitch(); if (layoutLocked() || reviewBusy) return; connector = null; tool = next; penMode = next === 'draw'; workspace.setTool(next); $('canvas').classList.toggle('drawing', penMode); draw(); refreshWorkspace(); }
  catch (error) { workspace.setTool(tool); saveFailure(error); }
}
function currentView() { return flowView(graph, activeFlowId); }
function roleText(role) { return role.start && role.end ? 'START + END' : role.start ? 'START' : 'END'; }
function qualifiedRoles(source, nodeId) { return boundaryRoles(source, nodeId).map(role => `${role.label} · ${roleText(role)}`).join('; '); }
function appendBadges(group, source, nodeId, flowId) {
  const roles = boundaryRoles(source, nodeId), flow = flowView(source, flowId).flow;
  const role = roles.find(item => item.flowId === flow?.id), others = roles.filter(item => item !== role);
  const title = qualifiedRoles(source, nodeId);
  if (role) {
    group.append(svg('rect', { x: 142, y: 9, width: 145, height: 25, rx: role.start && role.end ? 2 : 8, class: 'flow-badge-outline' }));
    const badge = svg('text', { x: 214, y: 26, class: 'flow-badge', 'data-flow-role': role.start && role.end ? 'both' : role.start ? 'start' : 'end', 'data-flow-id': role.flowId, 'aria-label': `${role.label} · ${roleText(role)}` }, roleText(role));
    badge.append(svg('title', {}, `${role.label} · ${roleText(role)}`)); group.append(badge);
  }
  if (others.length) { const extra = svg('text', { x: 300, y: 26, class: 'flow-extra', 'aria-label': `${others.length} additional roles: ${title}` }, `+${others.length}`); extra.append(svg('title', {}, title)); group.append(extra); }
}
function renderFlowSelector() {
  $('flow-selector').replaceChildren(new Option('Whole graph', ''));
  for (const flow of graph.flows ?? []) if (flow.status !== 'retired' && flow.scope !== 'graph') $('flow-selector').add(new Option(flow.label, flow.id));
  $('flow-selector').value = activeFlowId ?? '';
  const scope = currentView();
  $('flow-context').textContent = scope.flow ? `${scope.flow.label} · ${scope.flow.scope}${scope.flow.turnId ? ` · ${scope.flow.turnId}` : ''}` : 'Whole graph · no boundaries defined';
  $('counts').textContent = `${scope.nodes.length} nodes · ${scope.edges.length} relations`;
}
function renderNodeRoles() {
  $('node-flow-panel').hidden = !selected || newNode;
  $('node-flow-roles').replaceChildren();
  if (!selected || newNode) return;
  const flow = currentView().flow;
  $('node-flow-heading').textContent = `${flow?.label ?? 'Whole graph'} · boundaries`;
  $('node-flow-start').checked = flow?.startNodeIds.includes(selected.id) ?? false;
  $('node-flow-end').checked = flow?.endNodeIds.includes(selected.id) ?? false;
  for (const item of graph.flows ?? []) {
    if (item.status === 'retired' || selected.status === 'retired' || item.scope !== 'graph' && !item.nodeIds.includes(selected.id)) continue;
    const role = boundaryRoles(graph, selected.id).find(role => role.flowId === item.id);
    const li = document.createElement('li'); li.textContent = `${item.label} · ${role ? roleText(role) : 'Member'}`; $('node-flow-roles').append(li);
  }
}
function emptyFlow(scope) { return { id: newId(), scope, label: scope === 'graph' ? 'Whole graph' : '', status: 'active', nodeIds: [], edgeIds: [], startNodeIds: [], endNodeIds: [] }; }
function selectedValues(id) { return Array.from($(id).selectedOptions, option => option.value); }
function updateFlowFields() {
  const whole = $('flow-scope').value === 'graph', turn = $('flow-scope').value === 'turn';
  $('flow-turn-id').disabled = !turn; $('flow-turn-id').required = turn;
  $('flow-nodes').disabled = whole; $('flow-edges').disabled = whole;
}
function openFlow(create) {
  if (!graph || pending || layoutLocked() || hasUnsaved() || strokes.length) { notice('Save or discard forms and clear or submit drawings before editing flow membership.'); return; }
  flowEditing = structuredClone(create ? emptyFlow('custom') : currentView().flow ?? emptyFlow('graph'));
  $('flow-label').value = flowEditing.label; $('flow-scope').value = flowEditing.scope; $('flow-turn-id').value = flowEditing.turnId ?? '';
  for (const [id, key] of [['flow-nodes', 'nodeIds'], ['flow-starts', 'startNodeIds'], ['flow-ends', 'endNodeIds']]) {
    $(id).replaceChildren();
    for (const node of graph.nodes.filter(node => node.status !== 'retired')) $(id).add(new Option(`${node.label} · ${node.id}`, node.id, false, flowEditing[key].includes(node.id)));
  }
  $('flow-edges').replaceChildren();
  for (const edge of graph.edges.filter(edge => edge.status === 'active')) $('flow-edges').add(new Option(`${edge.source} → ${edge.target}: ${edge.relation}`, edge.id, false, flowEditing.edgeIds.includes(edge.id)));
  $('flow-retire').hidden = !graph.flows?.some(flow => flow.id === flowEditing.id);
  flowDirty = true; updateFlowFields(); $('flow-editor').showModal(); layoutControls();
}
function closeFlow() { flowDirty = false; flowEditing = null; $('flow-editor').close(); layoutControls(); }
$('flow-selector').onchange = async () => {
  const next = $('flow-selector').value || null; $('flow-selector').value = activeFlowId ?? '';
  try { await prepareSwitch(); } catch (error) { saveFailure(error); return; }
  if (strokes.length || dragging || reviewBusy || layoutLocked()) { notice('Clear or submit the captured drawing before changing scope.'); return; }
  selection.clear(); activeFlowId = next; layoutUndo = null; review = null;
  edgeEditing = null; $('edge-editor').hidden = true;
  renderFlowSelector(); renderEdgePicker(); select(currentView().nodes.some(node => node.id === selected?.id) ? selected.id : null, true);
  if (currentView().layoutDirection) $('layout-direction').value = currentView().layoutDirection;
  fit();
};
$('add-flow').onclick = () => openFlow(true);
$('edit-flow').onclick = () => openFlow(false);
$('flow-form').oninput = () => { flowDirty = true; updateFlowFields(); };
$('flow-cancel').onclick = closeFlow;
$('flow-editor').addEventListener('cancel', event => { event.preventDefault(); if (!pending) closeFlow(); });
$('flow-form').onsubmit = async event => {
  event.preventDefault();
  if (!$('flow-form').reportValidity() || pending) return;
  const scope = $('flow-scope').value;
  const flow = { id: flowEditing.id, status: 'active', scope, label: $('flow-label').value, nodeIds: scope === 'graph' ? [] : selectedValues('flow-nodes'), edgeIds: scope === 'graph' ? [] : selectedValues('flow-edges'), startNodeIds: selectedValues('flow-starts'), endNodeIds: selectedValues('flow-ends'), ...(scope === 'turn' ? { turnId: $('flow-turn-id').value } : {}) };
  try {
    await changeDraft({ type: 'flow', flow }); closeFlow();
    activeFlowId = scope === 'graph' ? null : flow.id; renderFlowSelector(); renderEdgePicker(); select(null, true); fit();
    notice('Flow saved to draft.');
  } catch (error) { notice(`${error.message}\nYour flow input is preserved.`); }
};
$('flow-retire').onclick = async () => {
  if (!flowEditing || pending) return;
  try { await changeDraft({ type: 'retire_flow', flowId: flowEditing.id }); closeFlow(); renderFlowSelector(); select(null, true); fit(); }
  catch (error) { notice(error.message); }
};
for (const [id, key] of [['node-flow-start', 'startNodeIds'], ['node-flow-end', 'endNodeIds']]) $(id).onchange = async () => {
  if (!selected || newNode || hasUnsaved() || strokes.length || pending || layoutLocked()) { renderNodeRoles(); return; }
  const flow = structuredClone(currentView().flow ?? emptyFlow('graph')), nodeId = selected.id;
  flow[key] = $(id).checked ? [...new Set([...flow[key], nodeId])] : flow[key].filter(member => member !== nodeId);
  try { await changeDraft({ type: 'flow', flow }); notice('Boundary role saved to draft.'); }
  catch (error) { notice(error.message); renderNodeRoles(); }
};
function drawReviewSnapshot() {
  const source = draft.graph, flowId = draft.captureFlowId ?? null, captured = flowView(source, flowId), canvas = $('review-canvas');
  canvas.replaceChildren(); canvas.hidden = false; $('review-snapshot').before(canvas);
  canvas.setAttribute('aria-label', `${captured.flow?.label ?? 'Whole graph'} · captured drawing and boundary roles`);
  const positions = Object.fromEntries(captured.nodes.map((node, i) => [node.id, captured.positions[node.id] ?? { x: 90 + (i % 3) * 440, y: 100 + Math.floor(i / 3) * 235 }]));
  const points = [];
  for (const edge of captured.edges) {
    const route = captured.routes[edge.id], a = positions[edge.source], b = positions[edge.target];
    const group = svg('g', { class: 'review-edge' });
    if (route) {
      for (const section of route.sections) { points.push(...section); group.append(svg('path', { d: section.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '), class: 'edge-line' })); }
      points.push(route.label, { x: route.label.x + route.label.width, y: route.label.y + route.label.height });
      group.append(svg('rect', { ...route.label, rx: 5, class: 'edge-label-bg' }), svg('text', { x: route.label.x + route.label.width / 2, y: route.label.y + route.label.height / 2 + 4, class: 'edge-label' }, route.label.text));
    } else {
      const dx = b.x - a.x, dy = b.y - a.y; let x1 = a.x + 170, y1 = a.y + 75, x2 = b.x + 170, y2 = b.y + 75;
      if (Math.abs(dx) > Math.abs(dy)) { x1 += Math.sign(dx) * 172; x2 -= Math.sign(dx) * 177; } else { y1 += Math.sign(dy) * 77; y2 -= Math.sign(dy) * 82; }
      const parallel = captured.edges.filter(item => item.source === edge.source && item.target === edge.target || item.source === edge.target && item.target === edge.source), offset = (parallel.indexOf(edge) - (parallel.length - 1) / 2) * 44;
      const self = edge.source === edge.target, cx = (x1 + x2) / 2 + (Math.abs(dx) <= Math.abs(dy) ? offset : 0), cy = (y1 + y2) / 2 + (Math.abs(dx) > Math.abs(dy) ? offset : 0);
      group.append(svg('path', { d: self ? `M${a.x + 260},${a.y} C${a.x + 420 + offset},${a.y - 110} ${a.x - 80 - offset},${a.y - 110} ${a.x + 80},${a.y}` : `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, class: 'edge-line' }), svg('text', { x: self ? a.x + 170 : cx, y: self ? a.y - 75 - Math.abs(offset) / 3 : cy - 10, class: 'edge-label' }, shortRelation(edge.relation)));
      points.push({ x: self ? a.x - 80 - Math.abs(offset) : cx, y: self ? a.y - 110 - Math.abs(offset) : cy }, { x: self ? a.x + 420 + Math.abs(offset) : cx, y: cy });
    }
    canvas.append(group);
  }
  for (const node of captured.nodes) {
    const p = positions[node.id], group = svg('g', { transform: `translate(${p.x},${p.y})`, class: 'review-node', 'data-review-node-id': node.id, 'aria-label': `${node.label}; ${qualifiedRoles(source, node.id)}` });
    points.push(p, { x: p.x + 340, y: p.y + 150 });
    group.append(svg('rect', { class: 'body', width: 340, height: 150 }), svg('text', { x: 20, y: 27, class: 'kind', fill: colors[node.kind] }, names[node.kind].toUpperCase()));
    appendBadges(group, source, node.id, flowId);
    wrap(node.label).forEach((line, i) => group.append(svg('text', { x: 20, y: 57 + i * 23, class: 'label' }, line)));
    group.append(svg('text', { x: 20, y: 132, class: 'status' }, `${node.status === 'confirmed' ? 'Confirmed' : 'Proposed'} · ${node.sources.length} sources`)); canvas.append(group);
  }
  for (const stroke of draft.strokes) { points.push(...stroke.points); canvas.append(svg('polyline', { points: stroke.points.map(p => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: '#ffca70', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); }
  let minX = 0, minY = 0, maxX = 400, maxY = 250;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  canvas.setAttribute('viewBox', `${minX - 40} ${minY - 40} ${maxX - minX + 80} ${maxY - minY + 80}`);
}
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
function activeNodes() { return graph ? activeFlowId ? currentView().nodes : graph.nodes.filter(n => $('show-retired').checked || n.status !== 'retired') : []; }
function visibleEdges() { return !activeFlowId && $('show-retired').checked ? graph.edges : currentView().edges; }
function displayedLayout() { return layoutPreview?.layout ?? currentView(); }
function point(node) {
  if (dragging?.positions?.[node.id]) return dragging.positions[node.id];
  const i = currentView().nodes.findIndex(n => n.id === node.id);
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
function view() { $('canvas').setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.w} ${camera.h}`); updateMinimapView(); refreshWorkspace(); }
function fit() {
  const bounds = geometryBounds(); if (!bounds) return;
  const { minX, minY, maxX, maxY } = bounds;
  const width = Math.max(900, maxX - minX + 140), height = Math.max(600, maxY - minY + 140);
  const ratio = $('canvas').clientWidth / Math.max(1, $('canvas').clientHeight);
  const w = Math.max(width, height * ratio), h = Math.max(height, width / ratio);
  camera = { x: (minX + maxX - w) / 2, y: (minY + maxY - h) / 2, w, h }; view();
}
function canCenterSelection() {
  return !!(graph && selection.size && !layoutJob && !layoutSaving && !reviewBusy && !dragging && !gesture && !connector && !minimapDrag &&
    !document.querySelector('dialog[open]') && $('canvas').clientWidth > 0 && $('canvas').clientHeight > 0 &&
    activeNodes().some(node => selection.has(node.id)));
}
async function centerSelection() {
  if (!canCenterSelection()) return;
  if (workspace.revealCanvas()) await new Promise(requestAnimationFrame);
  if (!canCenterSelection()) return;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const node of activeNodes()) if (selection.has(node.id)) {
    const p = point(node);
    left = Math.min(left, p.x); top = Math.min(top, p.y);
    right = Math.max(right, p.x + 340); bottom = Math.max(bottom, p.y + 150);
  }
  const canvas = $('canvas'), frame = canvas.getBoundingClientRect(), tools = $('toolbox').getBoundingClientRect();
  let usableLeft = frame.left, usableTop = frame.top;
  if ($('toolbox').getAttribute('aria-orientation') === 'horizontal') usableTop = Math.max(usableTop, tools.bottom + 8);
  else usableLeft = Math.max(usableLeft, tools.right + 8);
  if (usableLeft >= frame.right || usableTop >= frame.bottom) return;
  const matrix = canvas.getScreenCTM(); if (!matrix) return;
  const center = new DOMPoint((left + right) / 2, (top + bottom) / 2).matrixTransform(matrix);
  const dx = center.x - (usableLeft + frame.right) / 2, dy = center.y - (usableTop + frame.bottom) / 2, inverse = matrix.inverse();
  camera.x += inverse.a * dx + inverse.c * dy;
  camera.y += inverse.b * dx + inverse.d * dy;
  view();
}

function searchNavigationBlock() {
  if (hasUnsaved() || composing || newNode || flowEditing || edgeEditing && !graph?.edges.some(edge => edge.id === edgeEditing.id)) return 'Save or discard the active form before navigating. You can still search.';
  if (pending || layoutJob || layoutSaving || reviewBusy || dragging || gesture || connector || document.querySelector('dialog[open]')) return 'Finish the current gesture, save or dialog before navigating.';
  return '';
}
async function navigateSearchNode(id) {
  const blocked = searchNavigationBlock(); if (blocked) throw new Error(blocked);
  const node = graph?.nodes.find(node => node.id === id);
  if (!node || node.status === 'retired' && !$('show-retired').checked) throw new Error('This result is no longer available. Search again.');
  if (!activeNodes().some(node => node.id === id)) {
    if (strokes.length || layoutPreview) throw new Error('Clear or submit the captured drawing, or finish the layout preview, before navigating outside this scope.');
    activeFlowId = null; layoutUndo = null; review = null; edgeEditing = null;
    renderFlowSelector(); renderEdgePicker();
  }
  closeEditSession(); select(id, true, false);
  await centerSelection(); $('canvas').focus({ preventScroll: true });
  return true;
}
function drawMinimap(nodes = activeNodes()) {
  minimapBounds = geometryBounds(nodes);
  $('minimap-panel').hidden = !minimapBounds;
  $('minimap-nodes').replaceChildren(); $('minimap-edges').replaceChildren();
  if (!minimapBounds) return;
  const positions = new Map(nodes.map(n => [n.id, point(n)]));
  for (const edge of visibleEdges()) {
    const a = positions.get(edge.source), b = positions.get(edge.target);
    if (!a || !b || (!$('show-retired').checked && edge.status === 'retired')) continue;
    const route = dragging?.id ? null : displayedLayout().routes?.[edge.id];
    const d = route ? route.sections.map(section => `M ${section.map(p => `${p.x} ${p.y}`).join(' L ')}`).join(' ') : `M ${a.x + 170} ${a.y + 75} L ${b.x + 170} ${b.y + 75}`;
    $('minimap-edges').append(svg('path', { d }));
  }
  for (const n of nodes) {
    const p = positions.get(n.id);
    $('minimap-nodes').append(svg('rect', { x: p.x, y: p.y, width: 340, height: 150, rx: 20, fill: colors[n.kind], class: selected?.id === n.id ? 'selected' : '', 'data-minimap-node': n.id }));
    const role = boundaryRoles(graph, n.id).find(item => item.flowId === currentView().flow?.id);
    if (role) { const mark = svg('text', { x: p.x + 170, y: p.y + 95, class: 'minimap-role', 'aria-label': `${role.label} · ${roleText(role)}` }, roleText(role)); mark.append(svg('title', {}, `${role.label} · ${roleText(role)}`)); $('minimap-nodes').append(mark); }
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
if (matchMedia('(max-width: 850px)').matches) { $('minimap').setAttribute('hidden', ''); $('minimap-toggle').setAttribute('aria-expanded', 'false'); $('minimap-toggle').textContent = 'Expand'; }
new ResizeObserver(() => { updateMinimapView(); refreshWorkspace(); }).observe($('canvas'));
function wrap(text, max = 21) {
  const lines = []; let rest = text;
  while (rest.length && lines.length < 3) { lines.push(rest.slice(0, max)); rest = rest.slice(max); }
  if (rest) lines[2] = lines[2].slice(0, max - 1) + '…'; return lines;
}
function neighbors() {
  const ids = new Set(selected ? [selected.id] : []);
  if (selected) for (const e of visibleEdges()) if (e.source === selected.id || e.target === selected.id) { ids.add(e.source); ids.add(e.target); }
  return ids;
}
function drawEdges() {
  $('edges').replaceChildren();
  const ids = new Set(activeNodes().map(n => n.id));
  for (const edge of visibleEdges()) {
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
      const parallel = visibleEdges().filter(e => (e.source === edge.source && e.target === edge.target) || (e.source === edge.target && e.target === edge.source));
      const offset = (parallel.indexOf(edge) - (parallel.length - 1) / 2) * 44;
      const self = edge.source === edge.target, cx = (x1 + x2) / 2 + (Math.abs(dx) <= Math.abs(dy) ? offset : 0), cy = (y1 + y2) / 2 + (Math.abs(dx) > Math.abs(dy) ? offset : 0);
      group.append(svg('path', { d: self ? `M${a.x + 260},${a.y} C${a.x + 420 + offset},${a.y - 110} ${a.x - 80 - offset},${a.y - 110} ${a.x + 80},${a.y}` : `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, class: 'edge-line' }));
      label = svg('text', { x: self ? a.x + 170 : cx, y: self ? a.y - 75 - Math.abs(offset) / 3 : cy - 10, class: 'edge-label' }, shortRelation(edge.relation));
    }
    group.append(label); $('edges').append(group);
    group.setAttribute('tabindex', '0'); group.setAttribute('role', 'button'); group.setAttribute('aria-label', `Edit relationship: ${edge.relation}`);
    group.addEventListener('click', () => { if (tool === 'select' && !spaceTool) prepareSwitch().then(() => openEdge(edge.id)).catch(saveFailure); });
    group.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdge(edge.id); } });
  }
}
function draw() {
  if (!graph || dragging) return;
  $('nodes').replaceChildren(); drawEdges();
  const nodes = activeNodes(), adjacent = neighbors();
  for (const n of nodes) {
    const p = point(n), group = svg('g', { transform: `translate(${p.x},${p.y})`, class: `graph-node ${selection.has(n.id) ? 'selected' : ''} ${connector?.source === n.id ? 'connect-source' : ''} ${changed.has(n.id) ? 'changed' : ''} ${n.status === 'retired' ? 'retired' : ''} ${selected && $('focus-relations').checked && !adjacent.has(n.id) ? 'dimmed' : ''}`, 'data-node-id': n.id, tabindex: 0, role: 'button', 'aria-label': `${names[n.kind]}: ${n.label}` });
    group.append(svg('title', {}, n.label), svg('rect', { class: 'body', width: 340, height: 150 }), svg('line', { x1: 0, y1: 25, x2: 0, y2: 125, class: 'accent-line', stroke: colors[n.kind] }));
    group.append(svg('text', { x: 20, y: 27, class: 'kind', fill: colors[n.kind] }, names[n.kind].toUpperCase()));
    appendBadges(group, graph, n.id, activeFlowId);
    group.setAttribute('aria-label', `${names[n.kind]}: ${n.label}${qualifiedRoles(graph, n.id) ? `; ${qualifiedRoles(graph, n.id)}` : ''}`);
    wrap(n.label).forEach((line, i) => group.append(svg('text', { x: 20, y: 57 + i * 23, class: 'label' }, line)));
    group.append(svg('text', { x: 20, y: 132, class: 'status' }, `${n.status === 'confirmed' ? 'Confirmed' : n.status === 'retired' ? 'Retired' : 'Proposed'}  ·  ${n.sources.length} source${n.sources.length === 1 ? '' : 's'}`));
    group.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (tool === 'connect') { if (connector) completeConnector(n.id); else { connector = { source: n.id, point: { x: p.x + 340, y: p.y + 75 } }; renderConnector(); } } else prepareSwitch().then(() => select(n.id, true, e.ctrlKey)).catch(saveFailure); } });
    group.addEventListener('pointerdown', e => nodePointerDown(e, n, group));
    if (tool === 'connect' || selection.has(n.id)) {
      const handle = svg('circle', { cx: 340, cy: 75, r: 11, fill: '#8aabff', stroke: '#fff', 'stroke-width': 2, class: 'connector-handle', 'data-source-id': n.id, role: 'button', tabindex: 0, 'aria-label': `Connect from ${n.label}` });
      handle.addEventListener('pointerdown', e => { if (e.button !== 0 || tool === 'hand' || spaceTool) return; e.stopPropagation(); beginConnector(e, n.id); });
      handle.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setTool('connect').then(() => { connector = { source: n.id, point: { x: p.x + 340, y: p.y + 75 } }; renderConnector(); }); } });
      group.append(handle);
    }
    $('nodes').append(group);
  }
  renderInk();
  drawMinimap(nodes);
  renderConnector(); refreshWorkspace();
  $('empty').hidden = nodes.length > 0;
}
function select(id, discard = false, focus, additive = false) {
  if ((dirty || edgeDirty) && !discard) { prepareSwitch().then(() => select(id, true, focus, additive)).catch(saveFailure); return; }
  if (typeof focus === 'boolean') $('focus-relations').checked = focus;
  if (!additive) selection = new Set(id ? [id] : []);
  selected = graph.nodes.find(n => n.id === id); dirty = false;
  newNode = false; $('new-node-position').hidden = true; $('edge-editor').hidden = true;
  $('editor').hidden = !selected; $('hint').hidden = !!selected; $('edit-warning').hidden = true;
  $('node-label').setCustomValidity('');
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
    item.textContent = `${source.label} → ${target.label}: ${edge.relation}${activeFlowId && !visibleEdges().some(member => member.id === edge.id) ? ' (outside selected flow)' : ''}`;
    $('node-relations').append(item);
  }
  $('feedback-target').textContent = selection.size > 1 ? `Selected: ${selection.size} nodes` : selected ? `Selected: ${selected.label} · ${selected.id}` : 'No selection';
  renderNodeRoles();
  if (selection.size > 1) { $('editor').hidden = true; $('relation-panel').hidden = true; $('node-flow-panel').hidden = true; $('hint').hidden = false; $('hint').textContent = `${selection.size} nodes selected`; $('inspector-title').textContent = 'Selection'; }
  else if (!selected) $('hint').textContent = 'Select an object to inspect it.';
  if (selected) workspace?.showPanel('properties');
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
  closeEditSession(); selection.clear(); connector = null; saveError = ''; selected = null; newNode = false; dirty = false; edgeDirty = false; edgeEditing = null; instructionDirty = false;
  tool = 'select'; penMode = false; spaceTool = null; gesture = null; dragging = null; workspace.setTool(tool);
  activeFlowId = opened.strokes.length ? opened.captureFlowId ?? null : null; captureFlowId = opened.captureFlowId ?? null; flowDirty = false; flowEditing = null;
  $('editor').hidden = true; $('edge-editor').hidden = true; $('hint').hidden = false;
  acceptDraft(opened, true);
  select(null, true);
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
  refreshWorkspace();
}
$('canvas').addEventListener('pointermove', e => {
  if (!dragging || (dragging.pointerId !== undefined && dragging.pointerId !== e.pointerId)) return;
  const p = screenPoint(e);
  if (dragging.ink) {
    const points = dragging.stroke.points, last = points[points.length - 1];
    if (points.length < 2000 && Math.hypot(p.x - last.x, p.y - last.y) >= 3) points.push({ x: Math.round(p.x), y: Math.round(p.y) });
    renderInk(); return;
  }
  if (dragging.id) {
    const dx = p.x - dragging.start.x, dy = p.y - dragging.start.y;
    dragging.moved ||= Math.abs(dx) + Math.abs(dy) > 4;
    for (const [id, origin] of Object.entries(dragging.origins)) {
      const position = dragging.positions[id] = { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) };
      for (const element of $('nodes').children) if (element.dataset.nodeId === id) element.setAttribute('transform', `translate(${position.x},${position.y})`);
    }
    drawEdges(); drawMinimap();
  }
  else { camera.x = dragging.camera.x - (e.clientX - dragging.clientX) * dragging.scaleX; camera.y = dragging.camera.y - (e.clientY - dragging.clientY) * dragging.scaleY; view(); }
});
async function endDrag(e) {
  if (!dragging || (dragging.pointerId !== undefined && dragging.pointerId !== e.pointerId)) return;
  const d = dragging; dragging = null;
  $('canvas').classList.remove('panning');
  if (d.pointerId !== undefined && $('canvas').hasPointerCapture(d.pointerId)) $('canvas').releasePointerCapture(d.pointerId);
  if (d.ink) { if (e.type !== 'pointerup' || d.stroke.points.length < 2) strokes.pop(); renderInk(); if (e.type === 'pointerup' && d.stroke.points.length > 1) { closeEditSession(); instructionDirty = true; saveInstructions().then(closeEditSession).catch(saveFailure); } layoutControls(); return; }
  if (d.id && d.moved && e.type === 'pointerup') {
    try { await changeDraft({ type: 'batch', operations: Object.entries(d.positions).map(([nodeId, position]) => ({ type: 'move', nodeId, position, flowId: d.flowId })) }); }
    catch (error) { notice(error.message); draw(); }
  } else if (d.id && e.type === 'pointerup') select(d.id, true, e.ctrlKey);
  else draw();
  layoutControls();
}
$('canvas').addEventListener('pointerup', endDrag);
$('canvas').addEventListener('pointercancel', endDrag);
$('canvas').addEventListener('lostpointercapture', endDrag);
$('canvas').addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
$('canvas').addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
$('canvas').addEventListener('pointerdown', e => {
  if (e.button === 0 || e.button === 1) e.preventDefault();
  $('canvas').focus({ preventScroll: true });
  if (e.button === 1 || e.button === 0 && (tool === 'hand' || spaceTool)) { if (!dragging) startPan(e); return; }
  if (layoutLocked() || pending || reviewBusy || e.button !== 0 || !graph) return;
  if (tool === 'node') { placeNode(screenPoint(e)); return; }
  if (penMode) {
    if (strokes.length >= 100) { notice('Each instruction supports up to 100 strokes. Send or clear the current drawing first.'); return; }
    if (hasUnsaved()) { notice('Save or discard active forms before drawing.'); return; }
    if (!strokes.length) captureFlowId = activeFlowId;
    const p = screenPoint(e), stroke = { points: [{ x: Math.round(p.x), y: Math.round(p.y) }] };
    strokes.push(stroke); dragging = { ink: true, stroke, pointerId: e.pointerId }; $('canvas').setPointerCapture(e.pointerId); refreshWorkspace(); return;
  }
  if (tool === 'erase') { gesture = { kind: 'erase', original: structuredClone(strokes), changed: false }; eraseAt(screenPoint(e)); $('canvas').setPointerCapture(e.pointerId); refreshWorkspace(); return; }
  if (tool !== 'select' || e.target.closest('.graph-node,.graph-edge')) return;
  if (hasUnsaved()) { prepareSwitch().catch(saveFailure); return; }
  const start = screenPoint(e); gesture = { kind: 'marquee', start, point: start, prior: e.shiftKey ? new Set(selection) : new Set() };
  if (!e.shiftKey) select(null, true, false);
  $('canvas').setPointerCapture(e.pointerId);
  refreshWorkspace();
});
function zoom(factor) { const w = Math.min(20000, Math.max(350, camera.w * factor)), ratio = w / camera.w; camera.x += (camera.w - w) / 2; camera.y += (camera.h - camera.h * ratio) / 2; camera.w = w; camera.h *= ratio; view(); }
$('canvas').addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.1 : .9); }, { passive: false });
$('fit').onclick = fit; $('zoom-in').onclick = () => zoom(.8); $('zoom-out').onclick = () => zoom(1.25); $('show-retired').onchange = draw;
$('sessions').onchange = async () => {
  const id = $('sessions').value; $('sessions').value = graph?.sessionId ?? '';
  try { await prepareSwitch(); if (layoutLocked()) throw new Error('Finish the layout before changing sessions.'); await loadGraph(id); } catch (error) { saveFailure(error); }
};
$('editor').addEventListener('input', () => { $('node-label').setCustomValidity(''); dirty = true; review = null; scheduleProperties(); layoutControls(); });
$('cancel').onclick = () => { closeEditSession(); saveError = ''; dirty = false; if (newNode) { newNode = false; selected = null; } select(selected?.id, true); };
$('editor').onsubmit = async e => {
  e.preventDefault();
  try { await saveNode(); notice('Saved to draft.'); }
  catch (error) { saveFailure(error); }
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
  events.onopen = () => { $('connection').textContent = 'Server connected'; $('connection').className = 'connection'; refreshWorkspace(); };
  events.onerror = () => { $('connection').textContent = 'Server disconnected · reconnecting'; $('connection').className = 'connection offline'; refreshWorkspace(); };
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
  deliveryState = result.feedback.length ? status[result.feedback.at(-1).status] ?? 'Unknown response' : '';
  refreshWorkspace();
  for (const item of result.feedback.slice(-5).reverse()) {
    const li = document.createElement('li'); li.dataset.feedbackId = item.id;
    const summary = document.createElement('strong'); summary.textContent = `${status[item.status]} · ${item.strokes.length} strokes`;
    const note = document.createElement('p'); note.textContent = item.note || 'Drawing instruction';
    const link = document.createElement('a'); link.href = item.imageUrl; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Submitted drawing';
    li.append(summary, note, link); if (item.resolution) { const resolution = document.createElement('p'); resolution.textContent = item.resolution; li.append(resolution); }
    $('feedback-list').append(li);
  }
}
// Toolbox events belong to workspace.js; graph gestures and shortcuts stay here.
$('clear-ink').onclick = () => { closeEditSession(); strokes = []; instructionDirty = true; renderInk(); saveInstructions().then(closeEditSession).catch(saveFailure); layoutControls(); };
$('feedback-note').oninput = () => { instructionDirty = true; review = null; clearTimeout(instructionTimer); if (!composing) instructionTimer = setTimeout(() => saveInstructions().catch(saveFailure), 600); layoutControls(); };
$('send-feedback').onclick = openReview;
$('open-session').onclick = async () => {
  const id = $('session-id').value.trim() || newId();
  try { await prepareSwitch(); if (layoutLocked()) throw new Error('Finish the layout before changing sessions.'); await api('session_open', { title: `Canvas ${id}` }, id); await refresh(id); $('session-id').value = ''; }
  catch (error) { saveFailure(error); }
};
window.addEventListener('hashchange', async () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id || id === graph?.sessionId) return;
  try { await prepareSwitch(); if (layoutLocked()) throw new Error('Finish the layout before changing sessions.'); await loadGraph(id); }
  catch (error) { location.hash = graph?.sessionId ?? ''; saveFailure(error); }
});

function hasUnsaved() { return dirty || edgeDirty || instructionDirty || flowDirty; }
function hasDraft() { return hasUnsaved() || strokes.length > 0; }
function layoutLocked() { return !!(layoutJob || layoutPreview || layoutSaving); }
function layoutControls() {
  const locked = layoutLocked() || pending > 0 || reviewBusy, unsaved = hasDraft(), available = !!graph && activeNodes().some(n => n.status !== 'retired');
  $('auto-layout').disabled = !available || locked || unsaved;
  $('auto-layout').textContent = layoutJob ? 'Computing…' : 'Auto layout';
  $('apply-layout').hidden = !layoutPreview; $('apply-layout').disabled = layoutSaving;
  $('cancel-layout').hidden = !layoutJob && !layoutPreview; $('cancel-layout').disabled = layoutSaving;
  $('undo-layout').disabled = !layoutUndo || locked || unsaved;
  $('layout-direction').disabled = locked;
  for (const id of ['node-label', 'node-detail', 'node-status', 'node-type', 'node-x', 'node-y', 'cancel', 'retire-node']) $(id).disabled = layoutLocked() || reviewBusy;
  $('save').disabled = locked || !selected;
  for (const id of ['pen', 'clear-ink', 'feedback-note', 'sessions', 'open-session', 'session-id', 'show-retired', 'add-node', 'connect-nodes', 'edge-picker', 'edge-source', 'edge-target', 'edge-relation', 'edge-reverse', 'edge-save', 'edge-cancel', 'edge-retire', 'discard-draft', 'inspect-latest']) $(id).disabled = locked || !graph;
  for (const id of ['edge-source', 'edge-target', 'edge-relation', 'feedback-note']) $(id).disabled = layoutLocked() || reviewBusy || !graph;
  for (const id of ['flow-selector', 'add-flow', 'edit-flow']) $(id).disabled = locked || !graph;
  for (const id of ['node-flow-start', 'node-flow-end']) $(id).disabled = locked || hasUnsaved() || strokes.length > 0 || !selected || newNode || selected.status === 'retired';
  for (const id of ['flow-label', 'flow-scope', 'flow-turn-id', 'flow-nodes', 'flow-edges', 'flow-starts', 'flow-ends', 'flow-save', 'flow-retire', 'flow-cancel']) $(id).disabled = locked;
  if (!locked && flowEditing) updateFlowFields();
  $('send-feedback').disabled = layoutLocked() || reviewBusy || !graph || !!dragging;
  $('draft-undo').disabled = locked || !draft?.canUndo;
  $('draft-redo').disabled = locked || !draft?.canRedo;
  $('draft-version').textContent = draft ? `Draft version ${draft.version}${pending ? ' · Saving…' : ''}${draftConflict ? ' · Conflict: inspect latest before submitting' : ''}` : 'No draft';
  $('review-submit').disabled = locked || !review?.canSubmit || draftConflict;
  const state = layoutSaving ? 'saving' : layoutJob ? 'computing' : layoutPreview ? 'preview' : 'idle';
  $('layout-status').dataset.state = state;
  $('layout-status').textContent = layoutSaving ? 'Saving layout…' : layoutJob ? 'Computing layout…' : layoutPreview ? 'Preview — not saved yet.' : '';
  refreshWorkspace();
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
  const job = { id: newId(), sessionId: graph.sessionId, draftId: draft.id, version: draft.version, flowId: activeFlowId, baseRevision: graph.revision, baseLayoutRevision: graph.layoutRevision, snapshot: structuredClone(graph), direction: $('layout-direction').value, elk: null, reject: cancelled.reject, timer: null };
  layoutJob = job; layoutControls();
  job.timer = setTimeout(() => job.reject(new Error('Layout exceeded 30 seconds. The existing layout is preserved.')), 30000);
  try {
    await Promise.race([document.fonts.ready, cancelled.promise]);
    if (layoutJob !== job) return;
    const measure = document.createElement('canvas').getContext('2d');
    if (!measure || typeof window.ELK !== 'function') throw new Error('The layout engine or font measurement is unavailable.');
    measure.font = `13px ${getComputedStyle(document.body).fontFamily}`;
    const labels = Object.fromEntries(flowView(job.snapshot, job.flowId).edges.map(e => { const text = shortRelation(e.relation); return [e.id, { text, width: Math.ceil(measure.measureText(text).width) + 20, height: 28 }]; }));
    job.elk = new window.ELK({
      workerUrl: '/vendor/elk-worker.js', algorithms: ['layered'],
      workerFactory: url => {
        const worker = new Worker(url);
        worker.addEventListener('error', event => job.reject(new Error(event.message || 'Could not load the layout Worker.')));
        worker.addEventListener('messageerror', () => job.reject(new Error('Could not read the layout Worker response.')));
        return worker;
      }
    });
    const output = await Promise.race([job.elk.layout(buildLayoutGraph(job.snapshot, job.direction, labels, job.flowId)), cancelled.promise]);
    if (layoutJob !== job || !layoutMatches(job)) return;
    const layout = extractLayout(output, job.direction, job.snapshot, job.flowId), previous = flowView(job.snapshot, job.flowId);
    layoutPreview = { id: job.id, sessionId: job.sessionId, draftId: job.draftId, version: job.version, flowId: job.flowId, baseRevision: job.baseRevision, baseLayoutRevision: job.baseLayoutRevision, layout, before: { positions: previous.positions, routes: previous.routes, direction: previous.layoutDirection }, cameraBefore: { ...camera } };
    layoutJob = null; draw(); fit();
  } catch (error) { if (layoutJob === job) notice(`Could not compute layout: ${error.message}`); }
  finally { clearTimeout(job.timer); job.elk?.terminateWorker(); if (layoutJob === job) layoutJob = null; layoutControls(); }
}
async function applyLayout() {
  if (!layoutPreview || layoutSaving) return;
  if (!layoutMatches(layoutPreview)) { cancelLayout('The draft or selected flow changed. Compute a fresh layout.'); return; }
  const candidate = layoutPreview; layoutPreview = null; layoutSaving = true; layoutControls();
  try {
    await changeDraft({ type: 'layout', ...candidate.layout, flowId: candidate.flowId });
    layoutUndo = { sessionId: candidate.sessionId, draftId: candidate.draftId, flowId: candidate.flowId, version: draft.version, before: candidate.before, cameraBefore: candidate.cameraBefore };
    fit(); notice('Auto layout saved to draft.');
  } catch (error) {
    camera = { ...candidate.cameraBefore }; view(); notice(`Could not save layout: ${error.message}`);
  } finally { layoutSaving = false; layoutControls(); draw(); }
}
async function undoLayout() {
  if (!layoutUndo || layoutLocked() || hasDraft()) return;
  const undo = layoutUndo; layoutSaving = true; layoutControls();
  try {
    if (undo.version !== draft.version || undo.draftId !== draft.id || undo.flowId !== activeFlowId || undo.sessionId !== graph.sessionId) throw new Error('The draft or selected flow changed after layout. Use draft Undo instead.');
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

function layoutMatches(candidate) {
  return candidate.sessionId === graph.sessionId && candidate.draftId === draft.id && candidate.version === draft.version && candidate.flowId === activeFlowId && candidate.baseRevision === graph.revision && candidate.baseLayoutRevision === graph.layoutRevision;
}
function acceptDraft(next, restoreInstructions = false) {
  const priorVersion = draft?.version;
  draft = next; graph = next.graph; review = null;
  if (priorVersion !== next.version && !layoutSaving) layoutUndo = null;
  if (restoreInstructions || !instructionDirty) { strokes = structuredClone(next.strokes); captureFlowId = next.captureFlowId ?? null; $('feedback-note').value = next.note; }
  if ((restoreInstructions || !instructionDirty) && strokes.length) activeFlowId = captureFlowId;
  if (activeFlowId && !graph.flows?.some(flow => flow.id === activeFlowId && flow.status !== 'retired')) activeFlowId = null;
  if (layoutJob && !layoutMatches(layoutJob) || layoutPreview && !layoutMatches(layoutPreview)) cancelLayout();
  renderFlowSelector();
  if (!layoutLocked() && currentView().layoutDirection) $('layout-direction').value = currentView().layoutDirection;
  if (restoreInstructions) instructionDirty = false;
  if (selected && !dirty && !newNode && $('edge-editor').hidden) { const retained = new Set(selection); select(selected.id, true, undefined, true); selection = retained; }
  renderNodeRoles();
  $('revision').textContent = `rev ${next.baseRevision}`;
  $('counts').textContent = `${currentView().nodes.length} nodes · ${currentView().edges.length} relations`;
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
    saveError = error.message;
    if (error.status === 409) { draftConflict = true; $('edit-warning').hidden = false; }
  }).finally(() => { pending--; layoutControls(); });
  return task;
}
function changeDraft(operation, group) {
  const operations = operation.type === 'batch' ? operation.operations : [operation];
  if (strokes.length && operations.some(op => ['move', 'layout', 'retire_node', 'retire_edge', 'flow', 'retire_flow', 'edge'].includes(op.type) || (op.type === 'node' && (!graph.nodes.some(n => n.id === op.node.id) || op.node.status === 'retired')))) return Promise.reject(new Error('Clear or submit drawings before changing geometry or flow membership.'));
  if (!group) closeEditSession();
  return mutateDraft('draft_change', { operation, ...(group ? { editGroup: group } : {}) });
}
async function saveNode(report = true) {
  if (!selected || !dirty || composing) return;
  $('node-label').setCustomValidity($('node-label').value.trim() ? '' : 'Enter a node label.');
  if (!(report ? $('editor').reportValidity() : $('editor').checkValidity())) throw new Error('Complete the node form before saving.');
  const snapshot = formSnapshot('node'), creating = newNode;
  const node = { ...selected, kind: $('node-type').value, label: $('node-label').value, detail: $('node-detail').value, status: $('node-status').value };
  const operation = node.status === 'retired' && !creating ? { type: 'retire_node', nodeId: node.id } : { type: 'node', node };
  if (creating) { operation.position = { x: Number($('node-x').value), y: Number($('node-y').value) }; operation.flowId = nodeFormFlowId; }
  await changeDraft(operation, creating ? undefined : editGroup(`node:${node.id}`));
  saveError = ''; newNode = false; selected = graph.nodes.find(n => n.id === node.id);
  if (snapshot === formSnapshot('node')) { dirty = false; if (creating) select(node.id, true, undefined, true); else { renderNodeRoles(); draw(); } }
  if (creating) { tool = 'select'; penMode = false; workspace.setTool(tool); selection = new Set([node.id]); draw(); }
  layoutControls();
}
function renderEdgePicker() {
  const picker = $('edge-picker'); picker.replaceChildren(new Option('Choose a relationship', ''));
  for (const edge of visibleEdges()) picker.add(new Option(`${edge.source} → ${edge.target}: ${edge.relation}`, edge.id));
  picker.value = edgeEditing?.id ?? '';
}
function openEdge(id) {
  if (pending || layoutLocked() || dirty || edgeDirty) { notice('Save or discard active edits first.'); return; }
  const edge = graph.edges.find(e => e.id === id);
  edgeEditing = edge ? { ...edge } : { id: newId(), source: selected?.id ?? '', target: '', relation: '', status: 'active' };
  edgeFormFlowId = activeFlowId;
  for (const field of ['edge-source', 'edge-target']) {
    $(field).replaceChildren(new Option('Choose a node', ''));
    for (const node of currentView().nodes) $(field).add(new Option(`${node.label} · ${node.id}`, node.id));
  }
  $('edge-id').textContent = edgeEditing.id; $('edge-source').value = edgeEditing.source; $('edge-target').value = edgeEditing.target;
  $('edge-relation').value = edgeEditing.relation; $('edge-editor').hidden = false; $('edge-retire').hidden = !edge;
  $('editor').hidden = true; $('relation-panel').hidden = true; $('node-flow-panel').hidden = true; $('hint').hidden = true; $('inspector-title').textContent = 'Relationship'; workspace?.showPanel('properties');
  edgeDirty = !edge; $('edge-source').focus(); layoutControls();
}
async function saveEdge(report = true) {
  if (!edgeDirty || composing) return;
  $('edge-relation').setCustomValidity($('edge-relation').value.trim() ? '' : 'Enter a relationship label.');
  if (!(report ? $('edge-editor').reportValidity() : $('edge-editor').checkValidity())) throw new Error('Complete the relationship form before saving.');
  const snapshot = formSnapshot('edge'), creating = !graph.edges.some(e => e.id === edgeEditing.id);
  const edge = { ...edgeEditing, source: $('edge-source').value, target: $('edge-target').value, relation: $('edge-relation').value };
  await changeDraft({ type: 'edge', edge, flowId: edgeFormFlowId }, creating ? undefined : editGroup(`edge:${edge.id}`));
  saveError = ''; if (snapshot === formSnapshot('edge')) edgeDirty = false;
  edgeEditing = edge; $('edge-retire').hidden = false;
  if (creating) { connector = null; tool = 'select'; penMode = false; workspace.setTool(tool); draw(); }
  layoutControls();
}
async function saveInstructions() {
  clearTimeout(instructionTimer);
  if (!draft || !instructionDirty || composing) return;
  const note = $('feedback-note').value, savedStrokes = structuredClone(strokes), flowId = strokes.length ? captureFlowId : activeFlowId;
  const members = new Set(currentView().nodes.map(node => node.id));
  const nodeIds = selection.size && !newNode ? [...selection].filter(id => members.has(id)) : draft.nodeIds.filter(id => members.has(id));
  await changeDraft({ type: 'instruction', note, strokes: savedStrokes, nodeIds, flowId }, editGroup('instruction'));
  if ($('feedback-note').value === note && JSON.stringify(strokes) === JSON.stringify(savedStrokes)) { instructionDirty = false; saveError = ''; }
  layoutControls();
}
async function flushForms() {
  if (composing) throw new Error('Finish composing text before saving.');
  clearTimeout(instructionTimer); await persistProperties(); await mutationTail;
  await saveNode(); await saveEdge(); if (flowDirty) throw new Error('Save or discard the flow editor before reviewing.'); await saveInstructions(); await mutationTail;
  if (hasUnsaved()) throw new Error('Save or explicitly discard all active input before continuing.');
}
async function openReview() {
  if (!draft || layoutLocked() || dragging) return;
  reviewBusy = true; layoutControls();
  try {
    await flushForms();
    closeEditSession();
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
    $('review-snapshot').textContent = JSON.stringify({ graph: draft.graph, note: draft.note, strokes: draft.strokes, nodeIds: draft.nodeIds, captureFlowId: draft.captureFlowId ?? null }, null, 2);
    drawReviewSnapshot();
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
  refreshWorkspace();
}
async function resetDraft() {
  const id = graph.sessionId;
  try { localStorage.removeItem(`axcanvas-draft:${id}`); } catch { /* Optional browser storage. */ }
  clearTimeout(instructionTimer);
  instructionDirty = false; strokes = []; $('feedback-note').value = '';
  draft = null; draftConflict = false; layoutUndo = null; await loadGraph(id);
}
function placeNode(position) {
  if (hasUnsaved()) { notice('Save or discard active input before adding a node.'); return; }
  if (strokes.length) { notice('Clear or submit drawings before changing geometry.'); return; }
  selected = { id: newId(), kind: placementKind, label: '', detail: '', status: 'proposed', sources: [] }; newNode = true; dirty = true;
  nodeFormFlowId = activeFlowId;
  $('node-flow-panel').hidden = true;
  $('editor').hidden = false; $('hint').hidden = true; $('new-node-position').hidden = false; $('inspector-title').textContent = 'Create node';
  $('node-id').textContent = selected.id; $('node-kind').textContent = names[placementKind]; $('node-type').value = placementKind; $('node-label').value = ''; $('node-detail').value = ''; $('node-status').value = 'proposed';
  $('node-x').value = Math.round(position.x); $('node-y').value = Math.round(position.y);
  selection.clear(); workspace.showPanel('properties');
  $('sources').replaceChildren(); $('node-label').focus(); layoutControls();
}
$('retire-node').onclick = async () => {
  if (!selected) return;
  if (dirty) { notice('Save or discard node input before retiring it.'); return; }
  if (strokes.length) { notice('Clear or submit drawings before changing geometry.'); return; }
  try { await changeDraft({ type: 'retire_node', nodeId: selected.id }); select(null, true); } catch (error) { notice(error.message); }
};
$('edge-picker').onchange = () => { if ($('edge-picker').value) openEdge($('edge-picker').value); };
$('edge-editor').oninput = () => { $('edge-relation').setCustomValidity(''); edgeDirty = true; review = null; scheduleProperties(); layoutControls(); };
$('edge-reverse').onclick = () => { const source = $('edge-source').value; $('edge-source').value = $('edge-target').value; $('edge-target').value = source; edgeDirty = true; review = null; scheduleProperties(); layoutControls(); };
$('edge-editor').onsubmit = async e => { e.preventDefault(); try { await saveEdge(); notice('Relationship saved to draft.'); } catch (error) { saveFailure(error); } };
$('edge-cancel').onclick = () => { closeEditSession(); saveError = ''; edgeDirty = false; edgeEditing = null; $('edge-editor').hidden = true; select(selected?.id, true, undefined, true); layoutControls(); };
$('edge-retire').onclick = async () => {
  if (edgeDirty) { notice('Save or discard relationship input before retiring it.'); return; }
  try { await changeDraft({ type: 'retire_edge', edgeId: edgeEditing.id }); edgeEditing = null; $('edge-editor').hidden = true; } catch (error) { notice(error.message); }
};
for (const direction of ['undo', 'redo']) $(`draft-${direction}`).onclick = async () => {
  try { await prepareSwitch(); await mutateDraft('draft_step', { direction }); } catch (error) { saveFailure(error); }
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
function nodePointerDown(e, node) {
  if (e.button !== 0 || spaceTool || ['hand', 'draw', 'erase', 'node'].includes(tool)) return;
  e.stopPropagation();
  e.preventDefault();
  $('canvas').focus({ preventScroll: true });
  if (tool === 'connect') {
    if (connector) completeConnector(node.id);
    else beginConnector(e, node.id, false);
    return;
  }
  if (hasUnsaved() || pending) { prepareSwitch().then(() => select(node.id, true, e.ctrlKey)).catch(saveFailure); return; }
  closeEditSession();
  if (e.shiftKey) {
    if (selection.has(node.id)) selection.delete(node.id); else selection.add(node.id);
    select(selection.has(node.id) ? node.id : [...selection].at(-1), true, e.ctrlKey, true);
    return;
  }
  if (!selection.has(node.id)) select(node.id, true, e.ctrlKey);
  else select(node.id, true, e.ctrlKey, true);
  if (layoutLocked() || reviewBusy || strokes.length) { if (strokes.length) notice('Clear or submit drawings before moving nodes.'); draw(); return; }
  const origins = Object.fromEntries(activeNodes().filter(n => selection.has(n.id)).map(n => [n.id, { ...point(n) }]));
  dragging = { id: node.id, flowId: activeFlowId, start: screenPoint(e), origins, positions: structuredClone(origins), moved: false, pointerId: e.pointerId };
  $('canvas').setPointerCapture(e.pointerId);
  refreshWorkspace();
}
function beginConnector(e, source, drag = true) {
  if (pending || hasUnsaved() || layoutLocked() || strokes.length) { notice('Save forms and clear or submit drawings before connecting nodes.'); return; }
  closeEditSession(); tool = 'connect'; penMode = false; workspace.setTool(tool);
  connector = { source, point: screenPoint(e), drag };
  if (drag) $('canvas').setPointerCapture(e.pointerId);
  draw();
}
function renderConnector() {
  $('connector-preview')?.remove();
  for (const group of $('nodes').children) {
    const active = group.dataset.nodeId === connector?.source || group.dataset.nodeId === connector?.target;
    group.classList.toggle('connect-target', group.dataset.nodeId === connector?.target);
    const body = group.querySelector('.body');
    if (body) { body.style.stroke = active ? '#70c8ac' : ''; body.style.strokeWidth = active ? '5' : ''; }
  }
  if (!connector || !graph) return;
  const source = graph.nodes.find(n => n.id === connector.source); if (!source) return;
  const p = point(source), end = connector.point;
  $('edges').append(svg('path', { id: 'connector-preview', d: `M${p.x + 340},${p.y + 75} L${end.x},${end.y}`, fill: 'none', stroke: '#70c8ac', 'stroke-width': 4, 'stroke-dasharray': '9 6', 'pointer-events': 'none' }));
}
function completeConnector(target) {
  if (!connector) return;
  const source = connector.source; connector = null;
  openEdge();
  if (!edgeEditing) return;
  $('edge-source').value = source; $('edge-target').value = target; edgeDirty = true;
  $('edge-relation').focus(); draw();
}
function eraseAt(p) {
  const radius = 12 * camera.w / Math.max(1, $('canvas').getBoundingClientRect().width);
  const hit = stroke => stroke.points.some((b, i) => {
    const a = stroke.points[Math.max(0, i - 1)], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= radius;
  });
  const retained = strokes.filter(stroke => !hit(stroke));
  if (retained.length !== strokes.length) { strokes = retained; gesture.changed = true; renderInk(); }
}
$('canvas').addEventListener('pointermove', e => {
  const p = screenPoint(e);
  if (connector) {
    connector.point = p; connector.target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node-id]')?.dataset.nodeId;
    renderConnector();
  }
  if (gesture?.kind === 'erase') eraseAt(p);
  if (gesture?.kind === 'marquee') {
    gesture.point = p; $('selection-marquee')?.remove();
    const a = gesture.start;
    $('canvas').append(svg('rect', { id: 'selection-marquee', x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), width: Math.abs(p.x - a.x), height: Math.abs(p.y - a.y), fill: '#8aabff22', stroke: '#8aabff', 'stroke-width': 2, 'pointer-events': 'none' }));
  }
});
function finishGesture(e) {
  if (connector?.drag) {
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node-id]')?.dataset.nodeId;
    if (e.type === 'pointerup' && target) completeConnector(target); else { connector = null; draw(); }
  }
  if (!gesture) return;
  const g = gesture; gesture = null; $('selection-marquee')?.remove();
  if (g.kind === 'erase') {
    if (e.type !== 'pointerup') strokes = g.original;
    else if (g.changed) { closeEditSession(); instructionDirty = true; saveInstructions().then(closeEditSession).catch(saveFailure); }
    renderInk(); layoutControls();
  } else if (e.type === 'pointerup') {
    const left = Math.min(g.start.x, g.point.x), right = Math.max(g.start.x, g.point.x), top = Math.min(g.start.y, g.point.y), bottom = Math.max(g.start.y, g.point.y);
    selection = g.prior;
    if (right - left > 3 || bottom - top > 3) for (const n of activeNodes()) {
      const p = point(n); if (p.x <= right && p.x + 340 >= left && p.y <= bottom && p.y + 150 >= top) selection.add(n.id);
    }
    select([...selection].at(-1), true, false, true);
  }
}
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('canvas').addEventListener(event, finishGesture);
function copySelection() {
  const nodes = activeNodes().filter(n => selection.has(n.id));
  if (!nodes.length) throw new Error('Select nodes to copy.');
  clipboard = { nodes: structuredClone(nodes), edges: structuredClone(visibleEdges().filter(e => e.status === 'active' && selection.has(e.source) && selection.has(e.target))), positions: Object.fromEntries(nodes.map(n => [n.id, { ...point(n) }])), offset: 0 };
}
async function pasteSelection() {
  if (!clipboard) throw new Error('Copy nodes before pasting.');
  const ids = new Map(clipboard.nodes.map(n => [n.id, newId()])), offset = clipboard.offset + 40;
  const operations = clipboard.nodes.map(n => ({ type: 'node', node: { ...structuredClone(n), id: ids.get(n.id) }, position: { x: clipboard.positions[n.id].x + offset, y: clipboard.positions[n.id].y + offset }, flowId: activeFlowId }));
  operations.push(...clipboard.edges.map(e => ({ type: 'edge', edge: { ...structuredClone(e), id: newId(), source: ids.get(e.source), target: ids.get(e.target) }, flowId: activeFlowId })));
  if (operations.length > 300) throw new Error('Select fewer nodes and relationships (maximum 300 operations per paste).');
  await changeDraft({ type: 'batch', operations }); clipboard.offset = offset;
  selection = new Set(ids.values()); select([...selection].at(-1), true, false, true);
}
async function dispatchCommand(command) {
  if (command === 'center-selection') { await centerSelection(); return; }
  if (command.startsWith('node-kind:')) {
    const kind = command.slice('node-kind:'.length);
    if (Object.hasOwn(names, kind)) { placementKind = kind; if (newNode) { $('node-type').value = kind; dirty = true; layoutControls(); } }
    return;
  }
  if (command === 'cancel-tool') { cancelGesture(); return; }
  if (!graph) return;
  await prepareSwitch();
  if (layoutLocked() || reviewBusy || dragging) throw new Error('Finish the current gesture or layout before continuing.');
  if (command === 'copy-selection') { copySelection(); return; }
  if (strokes.length || hasUnsaved()) throw new Error('Save forms and clear or submit drawings before changing geometry.');
  if (command === 'duplicate-selection') { copySelection(); await pasteSelection(); return; }
  if (command === 'paste-selection') { await pasteSelection(); return; }
  const nodes = activeNodes().filter(n => selection.has(n.id));
  if (!nodes.length) throw new Error('Select nodes first.');
  if (command === 'retire-selection') { await changeDraft({ type: 'batch', operations: nodes.map(n => ({ type: 'retire_node', nodeId: n.id })) }); select(null, true); return; }
  const positions = Object.fromEntries(nodes.map(n => [n.id, { ...point(n) }]));
  const axis = command === 'align-left' || command === 'distribute-horizontal' ? 'x' : 'y';
  if (command.startsWith('nudge:')) {
    const [, key, step] = command.split(':');
    for (const p of Object.values(positions)) { p.x += key === 'ArrowLeft' ? -Number(step) : key === 'ArrowRight' ? Number(step) : 0; p.y += key === 'ArrowUp' ? -Number(step) : key === 'ArrowDown' ? Number(step) : 0; }
  } else if (command === 'align-left' || command === 'align-top') {
    const value = Math.min(...Object.values(positions).map(p => p[axis])); for (const p of Object.values(positions)) p[axis] = value;
  } else if (command === 'distribute-horizontal' || command === 'distribute-vertical') {
    if (nodes.length < 3) throw new Error('Select at least three nodes to distribute.');
    const ordered = Object.values(positions).sort((a, b) => a[axis] - b[axis]), start = ordered[0][axis], step = (ordered.at(-1)[axis] - start) / (ordered.length - 1);
    ordered.forEach((p, i) => { p[axis] = Math.round(start + i * step); });
  } else throw new Error(`Unknown workspace command: ${command}`);
  await changeDraft({ type: 'batch', operations: Object.entries(positions).map(([nodeId, position]) => ({ type: 'move', nodeId, position, flowId: activeFlowId })) });
}
function cancelGesture() {
  connector = null;
  if (gesture?.kind === 'erase') strokes = gesture.original;
  gesture = null; $('selection-marquee')?.remove();
  if (dragging?.ink) strokes = strokes.filter(s => s !== dragging.stroke);
  dragging = null; $('canvas').classList.remove('panning');
  if (newNode) { newNode = false; dirty = false; selected = null; selection.clear(); $('editor').hidden = true; }
  if (edgeEditing && !graph?.edges.some(e => e.id === edgeEditing.id)) { edgeEditing = null; edgeDirty = false; $('edge-editor').hidden = true; }
  tool = 'select'; penMode = false; spaceTool = null; workspace.setTool(tool); $('canvas').classList.remove('drawing'); renderInk(); draw(); layoutControls();
}
const editable = target => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable="true"]');
document.addEventListener('compositionstart', () => { composing = true; clearTimeout(propertyTimer); clearTimeout(instructionTimer); });
document.addEventListener('compositionend', () => { composing = false; scheduleProperties(); if (instructionDirty) instructionTimer = setTimeout(() => saveInstructions().catch(saveFailure), 600); });
for (const id of ['editor', 'edge-editor']) {
  $(id).addEventListener('focusout', event => {
    if (composing) return;
    persistProperties().then(() => { if (!$(id).contains(event.relatedTarget)) closeEditSession(); }).catch(saveFailure);
  });
  $(id).addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && !composing && !event.target.matches('textarea,button,select')) {
      if (id === 'editor' && !newNode || id === 'edge-editor' && graph?.edges.some(e => e.id === edgeEditing?.id)) { event.preventDefault(); persistProperties().catch(saveFailure); }
    }
  });
}
$('feedback-note').addEventListener('blur', () => { if (!composing) saveInstructions().then(closeEditSession).catch(saveFailure); });
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || composing || event.isComposing || event.target.closest?.('dialog[open],#minimap')) return;
  const key = event.key.toLowerCase(), modifier = event.ctrlKey || event.metaKey;
  if (modifier && key === 's') { event.preventDefault(); flushForms().catch(saveFailure); return; }
  if (key === 'escape' && (newNode || connector || gesture || dragging?.ink || edgeEditing && !graph?.edges.some(e => e.id === edgeEditing.id))) { event.preventDefault(); cancelGesture(); return; }
  if (editable(event.target)) return;
  if (modifier) {
    const command = { c: 'copy-selection', v: 'paste-selection', d: 'duplicate-selection' }[key];
    if (command) { event.preventDefault(); dispatchCommand(command).catch(saveFailure); }
    else if (key === 'z' || key === 'y') { event.preventDefault(); prepareSwitch().then(() => mutateDraft('draft_step', { direction: key === 'y' || event.shiftKey ? 'redo' : 'undo' })).catch(saveFailure); }
    return;
  }
  if (event.altKey) return;
  if (key === 'f' && event.target.closest?.('#canvas,#toolbox')) { event.preventDefault(); centerSelection(); return; }
  if (event.code === 'Space') { if (event.target.closest?.('button')) return; event.preventDefault(); if (!spaceTool) { spaceTool = tool; workspace.setTool('hand'); } return; }
  if (key === 'escape') { event.preventDefault(); cancelGesture(); return; }
  if (event.key.startsWith('Arrow') && selection.size) { event.preventDefault(); dispatchCommand(`nudge:${event.key}:${event.shiftKey ? 10 : 1}`).catch(saveFailure); return; }
  const next = { v: 'select', h: 'hand', n: 'node', c: 'connect', p: 'draw', e: 'erase' }[key];
  if (next) { event.preventDefault(); setTool(next); }
});
function releaseSpace() { if (spaceTool) { spaceTool = null; workspace.setTool(tool); refreshWorkspace(); } }
document.addEventListener('keyup', event => { if (event.code === 'Space') releaseSpace(); });
window.addEventListener('blur', releaseSpace);
$('canvas').addEventListener('contextmenu', event => {
  event.preventDefault(); $('canvas-context-menu')?.remove();
  const clean = !hasUnsaved();
  const id = event.target.closest('[data-node-id]')?.dataset.nodeId;
  if (clean && id && !selection.has(id)) select(id, true);
  const menu = document.createElement('div'); menu.id = 'canvas-context-menu'; menu.setAttribute('role', 'menu');
  Object.assign(menu.style, { position: 'fixed', left: `${Math.min(event.clientX, innerWidth - 210)}px`, top: `${Math.min(event.clientY, innerHeight - 320)}px`, zIndex: '100', background: '#17212f', padding: '8px', border: '1px solid #8aabff', display: 'grid' });
  const commands = [['center-selection', 'Center selection'], ...(clean ? [['copy-selection', 'Copy'], ['paste-selection', 'Paste'], ['duplicate-selection', 'Duplicate'], ['align-left', 'Align left'], ['align-top', 'Align top'], ['distribute-horizontal', 'Distribute horizontally'], ['distribute-vertical', 'Distribute vertically'], ['retire-selection', 'Retire selection']] : [])];
  for (const [command, text] of commands) {
    const button = document.createElement('button'); button.textContent = text; button.setAttribute('role', 'menuitem'); button.dataset.command = command;
    if (command === 'center-selection') button.disabled = !canCenterSelection();
    button.onclick = () => { menu.remove(); dispatchCommand(command).catch(saveFailure); }; menu.append(button);
  }
  document.body.append(menu); menu.firstElementChild.focus();
});
document.addEventListener('pointerdown', event => { if (!event.target.closest('#canvas-context-menu')) $('canvas-context-menu')?.remove(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') $('canvas-context-menu')?.remove(); });
window.addEventListener('beforeunload', event => { if (pending || hasUnsaved()) { event.preventDefault(); event.returnValue = ''; } });
setInterval(watcherStatus, 5000);
workspace = initWorkspace({ onTool: setTool, onCommand: command => dispatchCommand(command).catch(saveFailure), onPanel: tab => { if (tab === 'history' && graph) loadHistory().catch(saveFailure); } });
graphSearch = initGraphSearch({ getState: () => ({ graph, nodes: activeNodes(), flowId: activeFlowId, includeRetired: $('show-retired').checked, blocked: searchNavigationBlock() }), navigate: navigateSearchNode });
layoutControls();
refresh().catch(e => notice(e.message));
