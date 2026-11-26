import type { Feedback } from './schema.ts';
import { flowView, boundaryRoles } from '../public/flows.js';
import { tagChips } from '../public/tags.js';

const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
function xml(value: string) { return value.replace(/[&<>"']/g, char => escapes[char]); }
export function feedbackImage(feedback: Feedback) {
  const graph = feedback.capture;
  const view = flowView(graph, feedback.captureFlowId ?? null);
  const visibleIds = new Set(view.nodes.map(n => n.id));
  const nodes = graph.nodes.filter(n => visibleIds.has(n.id));
  const positions = new Map(nodes.map((n, index) => [n.id, view.positions[n.id] ?? { x: 90 + index % 3 * 440, y: 100 + Math.floor(index / 3) * 235 }]));
  const routes = view.routes;
  const points = [...positions.values(), ...feedback.strokes.flatMap(s => s.points), ...Object.values(routes).flatMap(r => [...r.sections.flat(), { x: r.label.x, y: r.label.y }, { x: r.label.x + r.label.width, y: r.label.y + r.label.height }])];
  const minX = Math.min(0, ...points.map(p => p.x)) - 40, minY = Math.min(0, ...points.map(p => p.y)) - 70;
  const width = Math.max(800, ...points.map(p => p.x + 400)) - minX, height = Math.max(500, ...points.map(p => p.y + 200)) - minY;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="1200" role="img"><title>${xml(feedback.note || 'User drawing')}</title><defs><marker id="route-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="#7183a0"/></marker></defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#121720"/><text x="${minX + 20}" y="${minY + 30}" fill="#eef2ff" font-size="18">${xml(feedback.note.slice(0, 160))}</text>`];
  parts.push(`<text x="${minX + 20}" y="${minY + 53}" fill="#b7c5db" font-size="13">${xml(view.flow?.label ?? 'Whole graph')}</text>`);
  for (const edge of view.edges) {
    const a = positions.get(edge.source), b = positions.get(edge.target);
    if (edge.status !== 'active' || !a || !b) continue;
    const route = routes[edge.id];
    if (route) {
      for (const section of route.sections) parts.push(`<polyline points="${section.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#7183a0" stroke-width="2" marker-end="url(#route-arrow)"/>`);
      const label = route.label;
      parts.push(`<rect x="${label.x}" y="${label.y}" width="${label.width}" height="${label.height}" rx="5" fill="#121720"/><text x="${label.x + label.width / 2}" y="${label.y + label.height / 2 + 4}" fill="#b7c5db" text-anchor="middle" font-size="13">${xml(label.text)}</text>`);
    } else parts.push(`<line x1="${a.x + 170}" y1="${a.y + 75}" x2="${b.x + 170}" y2="${b.y + 75}" stroke="#7183a0" stroke-width="2"/><text x="${(a.x + b.x) / 2 + 170}" y="${(a.y + b.y) / 2 + 65}" fill="#b7c5db" text-anchor="middle" font-size="14">${xml(edge.relation)}</text>`);
  }
  for (const node of nodes) {
    const p = positions.get(node.id)!;
    parts.push(`<rect x="${p.x}" y="${p.y}" width="340" height="150" rx="12" fill="#202c40" stroke="${feedback.nodeIds.includes(node.id) ? '#ffca70' : '#869fe3'}" stroke-width="2"/><text x="${p.x + 16}" y="${p.y + 28}" fill="#9eb6fa" font-size="12">${xml(node.kind)}</text><text x="${p.x + 16}" y="${p.y + 70}" fill="#eef2ff" font-size="18">${xml(node.label.slice(0, 32))}</text>`);
    for (const chip of tagChips(node)) parts.push(`<g aria-label="${xml(chip.title)}"><title>${xml(chip.title)}</title><rect x="${p.x + chip.x}" y="${p.y + 109}" width="${chip.width}" height="22" rx="7" fill="${chip.color}"/><text x="${p.x + chip.x + 8}" y="${p.y + 124}" fill="#142033" font-size="12" font-weight="700">${xml(chip.text)}</text></g>`);
    const roles = boundaryRoles(graph, node.id);
    const current = roles.find(role => role.flowId === view.flow?.id);
    const label = current ? [current.start ? 'START' : '', current.end ? 'END' : ''].filter(Boolean).join(' + ') : '';
    const otherCount = roles.length - (current ? 1 : 0);
    const description = roles.map(role => `${role.label} · ${[role.start ? 'START' : '', role.end ? 'END' : ''].filter(Boolean).join(' + ')}`).join('; ');
    if (label) parts.push(`<g role="img" aria-label="${xml(`${current!.label} · ${label}`)}"><title>${xml(description)}</title><rect x="${p.x + 148}" y="${p.y + 10}" width="112" height="26" rx="5" fill="#182c32" stroke="#7ddec2"/><text x="${p.x + 204}" y="${p.y + 28}" fill="#bdf5e7" font-size="12" text-anchor="middle">${label}</text></g>`);
    if (otherCount) parts.push(`<g role="img" aria-label="${xml(description)}"><title>${xml(description)}</title><rect x="${p.x + 278}" y="${p.y + 10}" width="44" height="26" rx="10" fill="#202c40" stroke="#869fe3"/><text x="${p.x + 300}" y="${p.y + 28}" fill="#eef2ff" font-size="12" text-anchor="middle">+${otherCount}</text></g>`);
  }
  for (const stroke of feedback.strokes) parts.push(`<polyline points="${stroke.points.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#ffca70" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`);
  parts.push('</svg>'); return parts.join('');
}
