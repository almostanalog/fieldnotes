// Small Markdown renderer for note pages, plus HTML → Markdown for pasting.

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(src) {
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g,
    (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  return s;
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function render(src) {
  const lines = (src || '').replace(/\r/g, '').split('\n');
  const out = [];
  let para = [];
  const flushP = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  let i = 0;
  while (i < lines.length) {
    const L = lines[i];
    let m;
    if (/^```/.test(L)) {
      flushP();
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
    } else if ((m = L.match(/^(#{1,3})\s+(.*)/))) {
      flushP();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++;
    } else if (/^\s*(---|\*\*\*)\s*$/.test(L)) {
      flushP(); out.push('<hr>'); i++;
    } else if (/^>\s?/.test(L)) {
      flushP();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`);
    } else if (LIST_RE.test(L)) {
      flushP();
      const r = list(lines, i); out.push(r.html); i = r.next;
    } else if (!L.trim()) {
      flushP(); i++;
    } else {
      para.push(L); i++;
    }
  }
  flushP();
  return out.join('\n');
}

function list(lines, i) {
  const items = [];
  while (i < lines.length) {
    const m = lines[i].match(LIST_RE);
    if (!m) break;
    items.push({ indent: m[1].replace(/\t/g, '  ').length, ordered: /\d/.test(m[2]), text: m[3], line: i });
    i++;
  }
  let html = '';
  const stack = [];
  for (const it of items) {
    while (stack.length && it.indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().tag}>`;
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) {
      const tag = it.ordered ? 'ol' : 'ul';
      stack.push({ indent: it.indent, tag });
      html += `<${tag}>`;
    } else html += '</li>';
    const t = it.text.match(/^\[([ xX])\]\s*(.*)$/);
    if (t) {
      const on = t[1] !== ' ';
      html += `<li class="task${on ? ' done' : ''}"><input type="checkbox" data-line="${it.line}"${on ? ' checked' : ''}> <span>${inline(t[2])}</span>`;
    } else html += `<li>${inline(it.text)}`;
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return { html, next: i };
}

export function toggleTask(src, line) {
  const lines = src.split('\n');
  lines[line] = lines[line].replace(/\[([ xX])\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}

export const plain = md => (md || '')
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/^\s*([-*+]|\d+[.)]|#{1,6}|>)\s+(\[[ xX]\]\s*)?/gm, '')
  .replace(/[*`~]/g, '')
  .replace(/\s+/g, ' ').trim();

// ---- HTML → Markdown (paste) --------------------------------------------------

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE',
  'PRE', 'HR', 'TABLE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'DETAILS', 'SUMMARY', 'FIGURE', 'MAIN', 'NAV']);
const BLOCK_SEL = [...BLOCK].join(',');
const SKIP = new Set(['STYLE', 'SCRIPT', 'IMG', 'SVG', 'META', 'LINK', 'TITLE', 'BUTTON', 'INPUT']);

export function htmlToMd(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return walkBlock(doc.body, 0).replace(/\n{3,}/g, '\n\n').trim();
}

function wrap(mark, x) {
  const t = x.trim();
  if (!t) return x;
  const lead = x.match(/^\s*/)[0], trail = x.match(/\s*$/)[0];
  return `${lead}${mark}${t}${mark}${trail}`;
}

function inl(nodes) {
  let s = '';
  for (const n of nodes) {
    if (n.nodeType === 3) { s += n.nodeValue.replace(/\s+/g, ' '); continue; }
    if (n.nodeType !== 1 || SKIP.has(n.tagName)) continue;
    const t = n.tagName;
    const st = n.style || {};
    const kids = () => inl(n.childNodes);
    const normalWeight = st.fontWeight === 'normal' || st.fontWeight === '400';
    if (t === 'BR') s += '\n';
    else if (BLOCK.has(t)) s += '\n' + walkBlock(n, 0) + '\n';
    else if (((t === 'STRONG' || t === 'B') && !normalWeight) || st.fontWeight === 'bold' || +st.fontWeight >= 600) s += wrap('**', kids());
    else if (t === 'EM' || t === 'I' || st.fontStyle === 'italic') s += wrap('*', kids());
    else if (t === 'S' || t === 'DEL' || t === 'STRIKE') s += wrap('~~', kids());
    else if (t === 'CODE') s += '`' + n.textContent + '`';
    else if (t === 'A') {
      const href = n.getAttribute('href') || '';
      const x = kids().trim();
      s += /^https?:/.test(href) ? (x && x !== href ? `[${x}](${href})` : href) : x;
    } else s += kids();
  }
  return s;
}

function walkBlock(node, depth) {
  const out = [];
  let buf = [];
  const flush = () => {
    const t = inl(buf).replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
    if (t) out.push(t);
    buf = [];
  };
  for (const n of node.childNodes) {
    if (n.nodeType === 1 && SKIP.has(n.tagName)) continue;
    // Inline wrappers around blocks (Google Docs wraps everything in <b>) are see-through.
    if (n.nodeType === 1 && !BLOCK.has(n.tagName) && n.querySelector(BLOCK_SEL)) {
      flush(); out.push(walkBlock(n, depth)); continue;
    }
    if (n.nodeType !== 1 || !BLOCK.has(n.tagName)) { buf.push(n); continue; }
    flush();
    const t = n.tagName;
    if (/^H[1-6]$/.test(t)) out.push('#'.repeat(Math.min(3, +t[1])) + ' ' + inl(n.childNodes).replace(/\s+/g, ' ').trim());
    else if (t === 'UL' || t === 'OL') out.push(listMd(n, depth));
    else if (t === 'BLOCKQUOTE') out.push(walkBlock(n, depth).split('\n').map(l => '> ' + l).join('\n'));
    else if (t === 'PRE') out.push('```\n' + n.textContent.replace(/\n$/, '') + '\n```');
    else if (t === 'HR') out.push('---');
    else if (t === 'TABLE') out.push([...n.rows].map(r => [...r.cells].map(c => c.textContent.trim()).join(' | ')).join('\n'));
    else out.push(walkBlock(n, depth));
  }
  flush();
  return out.filter(Boolean).join('\n\n');
}

function listMd(list, depth) {
  const ordered = list.tagName === 'OL';
  let k = 1;
  const lines = [];
  for (const li of list.children) {
    if (li.tagName !== 'LI') continue;
    // Notion to-dos: <div class="checkbox checkbox-on|off">; elsewhere a real checkbox input
    const cb = li.querySelector(':scope > input[type=checkbox], :scope > .checkbox, :scope > div > .checkbox, :scope > span > input[type=checkbox]');
    let prefix = ordered ? `${k++}. ` : '- ';
    if (cb) prefix += (cb.checked || cb.classList.contains('checkbox-on')) ? '[x] ' : '[ ] ';
    const text = [], nested = [];
    for (const c of li.childNodes) {
      if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) nested.push(listMd(c, depth + 1));
      else if (c !== cb) text.push(c);
    }
    lines.push('  '.repeat(depth) + prefix + inl(text).replace(/\s*\n\s*/g, ' ').trim());
    lines.push(...nested);
  }
  return lines.join('\n');
}
