export const TAG_PALETTE = Object.freeze({ blue: '#9dc4ff', teal: '#72dfdb', green: '#a6e39c', amber: '#ffda80', coral: '#ffb09e', pink: '#f7add8', violet: '#cdb4ff' });
/** @param {string} tag */
export const tagKey = tag => tag.normalize('NFKC').toLowerCase();
/** @param {{tagColors?:Record<string,string>}} node @param {string} tag */
export function tagColor(node, tag) {
  const key = tagKey(tag), names = Object.keys(TAG_PALETTE);
  let hash = 0; for (const char of key) hash = (Math.imul(hash, 31) + char.codePointAt(0)) >>> 0;
  const name = Object.hasOwn(node.tagColors ?? {}, key) ? node.tagColors[key] : null;
  return TAG_PALETTE[name] ?? TAG_PALETTE[names[hash % names.length]];
}
/** One bounded row; preserve complete names in accessible titles. */
/** @param {{tags?:string[],tagColors?:Record<string,string>}} node */
export function tagChips(node) {
  const tags = node.tags ?? [], chips = []; let x = 20;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i], text = '#' + Array.from(tag).slice(0, 17).join('') + (Array.from(tag).length > 17 ? '…' : '');
    const width = Math.min(190, Array.from(text).reduce((n, char) => n + (char.codePointAt(0) > 255 ? 12 : 7), 16));
    if (x + width > (i < tags.length - 1 ? 275 : 320)) { chips.push({ x, width: 320 - x, text: `+${tags.length - i}`, title: tags.slice(i).map(t => '#' + t).join(', '), color: '#c4cedf' }); break; }
    chips.push({ x, width, text, title: '#' + tag, color: tagColor(node, tag) }); x += width + 6;
  }
  return chips;
}
