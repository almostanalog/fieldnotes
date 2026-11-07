// DOM helpers shared by every view.

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate']);

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val);
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const pad2 = n => String(n).padStart(2, '0');

export function fmtDate(ts, withTime = false) {
  if (!ts) return '';
  const d = new Date(ts), today = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return withTime ? `today ${time}` : time;
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}

export function autosize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

export function modal(title, body, actions) {
  const root = document.getElementById('modal-root');
  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const back = h('div', { class: 'modal-back', onmousedown: e => { if (e.target === back) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('span', {}, title), h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Close' }, '✕')),
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-actions' },
        actions.map(([label, fn, cls]) => h('button', { class: 'btn ' + (cls || ''), onclick: fn }, label)))));
  root.append(back);
  document.addEventListener('keydown', onKey);
  return close;
}

export function menu(anchor, items) {
  document.querySelectorAll('.menu').forEach(m => m.remove());
  // Item shapes: { label, action, danger?, checked?, swatch? } · { sep: true } · { head } · { info }
  const m = h('div', { class: 'menu', role: 'menu' },
    items.filter(Boolean).map(it => {
      if (it.sep) return h('div', { class: 'menu-sep' });
      if (it.head) return h('div', { class: 'menu-head' }, it.head);
      if (it.info) return h('div', { class: 'menu-info' }, it.info);
      return h('button', {
        class: 'menu-item' + (it.danger ? ' danger' : ''), role: 'menuitem',
        onclick: () => { close(); it.action(); },
      },
        it.checked !== undefined && h('span', { class: 'tick' }, it.checked ? '●' : ''),
        it.swatch && h('span', { class: 'swatch', style: { background: it.swatch } }),
        it.label);
    }));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth;
  m.style.top = (r.bottom + scrollY + 6) + 'px';
  m.style.left = (Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + scrollX) + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  const outside = e => { if (!m.contains(e.target) && !anchor.contains(e.target)) close(); };
  const close = () => { m.remove(); anchor.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside); };
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
}

export function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 2200);
  setTimeout(() => t.remove(), 2600);
}

export function pickFile(accept, cb) {
  const inp = h('input', { type: 'file', accept, class: 'hidden', onchange: () => { if (inp.files[0]) cb(inp.files[0]); inp.remove(); } });
  document.body.append(inp);
  inp.click();
}

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
