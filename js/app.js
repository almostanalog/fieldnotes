import * as S from './store.js';
import * as MD from './md.js';
import { parseCSV, toCSV, importRows } from './csv.js';
import * as D from './drive.js';
import { h, pad2, fmtDate, autosize, modal, menu, toast, pickFile, download } from './ui.js';

const root = document.getElementById('app');
const narrowMQ = matchMedia('(max-width: 719px)');
const ui = { query: '', filter: {}, showDone: {}, pendingRow: null, focus: null };

const signedIn = D.takeRedirect();   // returning from Google sign-in: read the token off the URL first
S.load();
S.onChange(render);
addEventListener('hashchange', () => {
  if (route().cid) ui.query = '';   // leaving search for a collection; home shows the cards again
  render();
  scrollTo(0, 0);
});
narrowMQ.addEventListener('change', render);
addEventListener('pagehide', S.flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) S.flush(); });
document.addEventListener('nb:sync', () => {
  document.querySelectorAll('.gear').forEach(g => g.classList.toggle('attn', ['signin', 'error'].includes(D.sync.state)));
  if (D.sync.state === 'error') toast('Sync failed: ' + D.sync.error);
});

// ---- routing ----------------------------------------------------------------
// #/                      home
// #/c/<id>                collection
// #/c/<id>/n/<noteId>     note page
// #/c/<id>/r/<rowId>      table row detail

function route() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return p[0] === 'c' ? { cid: p[1], sub: p[2], sid: p[3] } : {};
}
const go = hash => { location.hash = hash; };

function render() {
  const r = route();
  dropAbandonedRow(r);
  if (r.cid) {
    const c = S.getCollection(r.cid);
    if (!c) { location.replace('#/'); return; }
    root.replaceChildren(CollectionPage(c, r));
    document.title = `${c.name || 'Untitled'} · Fieldnotes`;
  } else {
    root.replaceChildren(Home());
    document.title = 'Fieldnotes';
  }
  requestAnimationFrame(() => {
    root.querySelectorAll('.grow-ta').forEach(autosize);
    if (ui.focus) {
      const el = root.querySelector(ui.focus);
      el?.focus();
      if (el && el.id === 'search') el.setSelectionRange(el.value.length, el.value.length);
      ui.focus = null;
    }
  });
}

// A row created from the phone "+ Add" button and then left blank is discarded.
function dropAbandonedRow(r) {
  const p = ui.pendingRow;
  if (!p || (r.sub === 'r' && r.sid === p.rid)) return;
  ui.pendingRow = null;
  const c = S.getCollection(p.cid);
  const row = c?.rows.find(x => x.id === p.rid);
  if (row && !Object.keys(row.cells).length) { c.rows.splice(c.rows.indexOf(row), 1); S.commit(false); }
}

// ---- shared bits ----------------------------------------------------------------

function statusText() {
  if (S.status.error) return 'Couldn’t save on this device';
  if (!D.connected()) return 'Saved on this device only';
  switch (D.sync.state) {
    case 'busy': return 'Syncing with Google Drive…';
    case 'signin': return 'Drive sync paused. Sync now to sign in';
    case 'error': return 'Sync failed: ' + D.sync.error;
    default: return D.lastSynced() ? `Synced with Drive ${fmtDate(D.lastSynced(), true)}` : 'Google Drive connected';
  }
}

function summary(c) {
  if (c.type === 'table') return { count: c.rows.length, unit: c.rows.length === 1 ? 'row' : 'rows' };
  if (c.type === 'list') return { count: c.items.filter(i => !i.done).length, unit: 'open' };
  const n = c.notes.length;
  const unit = c.layout === 'cards' ? (n === 1 ? 'card' : 'cards') : (n === 1 ? 'page' : 'pages');
  return { count: n, unit };
}

const inkOf = c => ({ '--card': `var(--c-${c.color || 'cyan'})` });

// A note's display title: its title, else the first line of its text.
const headline = n => n.title.trim() || MD.plain((n.body || '').split('\n').find(l => l.trim()) || '') || 'Untitled';

const cleanName = file => file.replace(/\.csv$/i, '').replace(/[\s_]+[0-9a-f]{32}$/i, '').replace(/_all$/, '').trim();

// ---- home -------------------------------------------------------------------

function Home() {
  const s = S.data();
  const body = h('div', { class: 'home-body' });
  const fill = () => body.replaceChildren(ui.query.trim() ? SearchResults(ui.query.trim()) : Grid(s));
  fill();
  return h('div', { class: 'page' },
    Masthead(fill),
    TitleRow({ title: h('h1', { class: 'tr-title' }, 'Collections'), count: pad2(s.collections.length) }),
    body);
}

// The same header on every page. On home, search filters in place; elsewhere the first
// keystroke jumps to home with the results showing.
function Masthead(onSearch) {
  const search = h('input', {
    class: 'search', id: 'search', type: 'search', placeholder: 'Search everything   /',
    value: ui.query, autocomplete: 'off', 'aria-label': 'Search everything',
    oninput: e => {
      ui.query = e.target.value;
      if (onSearch) onSearch(); else { ui.focus = '#search'; go('#/'); }
    },
    onkeydown: e => {
      if (e.key !== 'Escape') return;
      ui.query = ''; e.target.value = '';
      if (onSearch) onSearch();
      e.target.blur();
    },
  });
  const gear = h('button', { class: 'gear' + (['signin', 'error'].includes(D.sync.state) ? ' attn' : ''), title: 'Settings', 'aria-label': 'Settings', 'aria-haspopup': 'menu',
    onclick: e => gearMenu(e.currentTarget) });
  gear.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  const logo = h('a', { class: 'logo-note', href: '#/', title: 'All collections', 'aria-label': 'All collections',
    onclick: () => { ui.query = ''; } });
  // A sticky note: hard offset shadow, folded bottom-right corner.
  logo.innerHTML = '<svg viewBox="0 0 44 44" aria-hidden="true">'
    + '<path d="M5 5H41V31L31 41H5Z" style="fill:var(--shadow)"/>'
    + '<path d="M2 2H38V28L28 38H2Z" style="fill:var(--c-yellow);stroke:#151515;stroke-width:2;stroke-linejoin:round"/>'
    + '<path d="M38 28H28V38Z" style="fill:#E3B13C;stroke:#151515;stroke-width:2;stroke-linejoin:round"/>'
    + '</svg>';
  return h('header', { class: 'masthead' }, logo, h('div', { class: 'mast-tools' }, search, gear));
}

// One title row under the header on every page, so the content below it always starts
// at the same height: "Collections" on home, the collection's name inside one.
function TitleRow({ lead, title, count, tools = [] }) {
  return h('div', { class: 'titlerow' },
    h('div', { class: 'tr-left' }, lead, title, count && h('span', { class: 'tr-count' }, count)),
    tools.length > 0 && h('div', { class: 'tr-tools' }, tools));
}

// ---- theme + settings ---------------------------------------------------------------

const THEME_KEY = 'notebook.theme';
function getTheme() { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; } }
function setTheme(t) {
  try { t === 'system' ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, t); } catch {}
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function gearMenu(anchor) {
  const t = getTheme();
  menu(anchor, [
    { info: statusText() },
    { head: 'Appearance' },
    { label: 'Match system', checked: t === 'system', action: () => setTheme('system') },
    { label: 'Light', checked: t === 'light', action: () => setTheme('light') },
    { label: 'Dark', checked: t === 'dark', action: () => setTheme('dark') },
    { head: 'Google Drive' },
    ...(D.connected()
      ? [{ label: 'Sync now', action: D.syncOrSignIn },
         { label: 'Disconnect Drive', action: () => {
           if (!confirm('Stop syncing this device with Google Drive?\n\nYour notebook stays here and in Drive. You can connect again any time.')) return;
           D.disconnect();
           toast('Drive disconnected');
         } }]
      : [{ label: 'Connect Google Drive', action: () => D.signIn() }]),
    { sep: true },
    { label: 'Export backup', action: exportJSON },
    { label: 'Restore from backup', action: importJSON },
    { sep: true },
    { label: 'Reset notebook', danger: true, action: () => {
      const where = D.connected() ? ' This also erases the copy in Google Drive.' : '';
      if (!confirm(`Erase every collection and start over with an empty notebook?${where}\n\nExport a backup first if you might want any of it back.`)) return;
      S.reset();
      ui.query = '';
      ui.filter = {};
      toast('Notebook reset');
    } },
  ]);
}

let dragId = null;

function Grid(s) {
  return h('div', { class: 'grid' },
    s.collections.map(Card),
    h('button', { class: 'card card-new', onclick: openNew },
      h('span', { class: 'plus' }, '+'), h('span', { class: 'label' }, 'New collection')));
}

function Card(c) {
  const sm = summary(c);
  return h('a', {
    class: 'card inked', href: `#/c/${c.id}`, draggable: 'true', style: inkOf(c),
    ondragstart: e => { dragId = c.id; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
    ondragend: e => { e.currentTarget.classList.remove('dragging'); dragId = null; },
    ondragover: e => { if (dragId && dragId !== c.id) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
    ondragleave: e => e.currentTarget.classList.remove('drop'),
    ondrop: e => {
      e.preventDefault();
      const arr = S.data().collections;
      const from = arr.findIndex(x => x.id === dragId), to = arr.findIndex(x => x.id === c.id);
      if (from < 0 || to < 0) return;
      arr.splice(to, 0, arr.splice(from, 1)[0]);
      S.commit();
    },
  },
    h('div', { class: 'card-top' }, h('span', {}, S.TYPES[c.type]), h('span', {}, `${pad2(sm.count)} ${sm.unit}`)),
    h('div', { class: 'card-name' }, c.name || 'Untitled'));
}

function snippet(text, q) {
  const flat = MD.plain(text);
  const i = flat.toLowerCase().indexOf(q);
  if (i < 0) return flat.slice(0, 100);
  const a = Math.max(0, i - 40);
  return (a ? '…' : '') + flat.slice(a, i + q.length + 70);
}

function SearchResults(q) {
  const ql = q.toLowerCase();
  const groups = [];
  for (const c of S.data().collections) {
    const hits = [];
    if (c.type === 'notes') for (const n of c.notes) {
      if ((n.title + '\n' + n.body).toLowerCase().includes(ql))
        hits.push({ title: n.title || 'Untitled', sub: snippet(n.body, ql), href: `#/c/${c.id}/n/${n.id}` });
    }
    if (c.type === 'list') for (const it of c.items) {
      if (it.text.toLowerCase().includes(ql)) hits.push({ title: (it.done ? '✓ ' : '□ ') + it.text, href: `#/c/${c.id}` });
    }
    if (c.type === 'table') for (const r of c.rows) {
      const texts = c.columns.map(k => S.toText(r.cells[k.id], k.type));
      if (texts.some(t => t.toLowerCase().includes(ql)))
        hits.push({ title: texts[0] || 'Untitled', sub: texts.slice(1).filter(Boolean).slice(0, 3).join(' · '), href: `#/c/${c.id}/r/${r.id}` });
    }
    if (hits.length || (c.name || '').toLowerCase().includes(ql)) groups.push({ c, hits });
  }
  if (!groups.length) return h('div', { class: 'empty-state' }, `Nothing matches “${q}”.`);
  return h('section', { class: 'results' }, groups.map(g => h('div', { class: 'result-group' },
    h('a', { class: 'result-head', href: `#/c/${g.c.id}` },
      h('span', { class: 'name' }, g.c.name || 'Untitled'),
      h('span', { class: 'meta' }, `${g.hits.length} match${g.hits.length === 1 ? '' : 'es'}`)),
    g.hits.slice(0, 30).map(x => h('a', { class: 'result', href: x.href },
      h('div', { class: 'r-title' }, x.title), x.sub && h('div', { class: 'r-sub' }, x.sub))))));
}

// ---- new collection -----------------------------------------------------------

function openNew() {
  let choice = 'notes', csvFile = null;
  const name = h('input', { class: 'field', placeholder: 'Notes', 'aria-label': 'Name',
    onkeydown: e => { if (e.key === 'Enter') create(); } });
  const fileNote = h('div', { class: 'file-note' });
  const fileIn = h('input', { type: 'file', accept: '.csv,text/csv', class: 'hidden', onchange: () => {
    csvFile = fileIn.files[0] || null;
    if (!csvFile) return;
    if (!name.value) name.value = cleanName(csvFile.name);
    fileNote.textContent = `File: ${csvFile.name}`;
    pick('csv');
  } });
  const opts = [
    ...Object.entries(S.TEMPLATES).map(([k, t]) => [k, t.label, t.hint]),
    ['csv', 'Import CSV', 'A table from a Notion or spreadsheet export'],
  ];
  const tiles = opts.map(([k, label, hint]) => h('button', {
    class: 'tile', type: 'button', 'data-k': k,
    onclick: () => { if (k === 'csv' && !csvFile) { fileIn.click(); return; } pick(k); },
  }, h('div', { class: 'tile-label' }, label), h('div', { class: 'tile-hint' }, hint)));
  function pick(k) {
    choice = k;
    tiles.forEach(t => t.classList.toggle('on', t.dataset.k === k));
    name.placeholder = k === 'csv' ? (csvFile ? cleanName(csvFile.name) : 'Imported') : S.TEMPLATES[k].label;
  }
  async function create() {
    const nm = name.value.trim() || name.placeholder || 'Untitled';
    let c;
    if (choice === 'csv') {
      c = S.createCollection(nm, 'table');
      const r = importRows(c, parseCSV(await csvFile.text()));
      toast(`Imported ${r.added} rows`);
    } else {
      const t = S.TEMPLATES[choice];
      c = S.createCollection(nm, t.type, t.make ? t.make() : {});
    }
    S.commit(false);
    close();
    go(`#/c/${c.id}`);
  }
  pick('notes');
  const close = modal('New collection',
    h('div', {}, h('label', { class: 'flabel' }, 'Name', name), h('div', { class: 'tiles' }, tiles), fileIn, fileNote),
    [['Cancel', () => close(), 'ghost'], ['Create', create, 'primary']]);
  name.focus();
}

// ---- collection page --------------------------------------------------------------

function CollectionPage(c, r) {
  const tools = [];
  let body, inside = false;   // inside: looking at one book or one idea card
  if (c.type === 'table' && r.sub === 'r') { body = RowDetail(c, r.sid); inside = true; }
  else if (c.type === 'notes') { body = NotesView(c, r, tools); inside = c.layout === 'cards' && r.sub === 'n'; }
  else if (c.type === 'list') body = ListView(c);
  else body = TableView(c, tools);
  return h('div', { class: 'page coll', style: inkOf(c) }, Masthead(), CollTitle(c, inside, tools), body);
}

function CollTitle(c, inside, tools) {
  const chip = h('span', { class: 'tr-chip', 'aria-hidden': 'true' });
  // Inside an item, the name links back to the collection.
  if (inside) return TitleRow({ lead: chip, title: h('a', { class: 'tr-title tr-link', href: `#/c/${c.id}` }, c.name || 'Untitled') });
  const sm = summary(c);
  const fit = el => { el.size = Math.max(4, el.value.length + 1); };
  const name = h('input', { class: 'tr-title', value: c.name, placeholder: 'Untitled', 'aria-label': 'Collection name',
    oninput: e => { c.name = e.target.value; fit(e.target); S.touch(c); S.commit(false); },
    onkeydown: e => { if (e.key === 'Enter') e.target.blur(); } });
  fit(name);
  return TitleRow({ lead: chip, title: name, count: `${pad2(sm.count)} ${sm.unit}`,
    tools: [...tools, h('button', { class: 'icon-btn tr-more', title: 'More', 'aria-label': 'Collection menu',
      onclick: e => collMenu(e.currentTarget, c) }, '⋯')] });
}

function collMenu(anchor, c) {
  menu(anchor, [
    c.type === 'table' && { label: 'Import CSV rows', action: () => pickFile('.csv,text/csv', async f => {
      const r = importRows(c, parseCSV(await f.text()));
      S.commit();
      toast(`Imported ${r.added} rows${r.created ? `, ${r.created} new columns` : ''}`);
    }) },
    c.type === 'table' && { label: 'Export CSV', action: () => download(`${c.name || 'table'}.csv`,
      toCSV([c.columns.map(k => k.name), ...c.rows.map(r => c.columns.map(k => S.toText(r.cells[k.id], k.type)))]), 'text/csv') },
    c.type === 'table' && { label: 'Add column', action: () => editColumn(c, null) },
    c.type === 'notes' && { label: 'Import ideas', action: () => pickFile('.json,.txt,.md,application/json,text/plain', async f => {
      try {
        const n = importIdeas(c, f, await f.text());
        S.commit();
        toast(n ? `Imported ${n} ideas` : 'No ideas found in that file');
      } catch (e) { alert('Could not read that file: ' + e.message); }
    }) },
    c.type === 'notes' && { label: c.layout === 'cards' ? 'Show as page list' : 'Show as cards', action: () => {
      c.layout = c.layout === 'cards' ? 'list' : 'cards';
      S.touch(c);
      history.replaceState(null, '', `#/c/${c.id}`);
      S.commit();
    } },
    c.type === 'list' && { label: 'Clear done items', action: () => { c.items = c.items.filter(i => !i.done); S.touch(c); S.commit(); } },
    { sep: true },
    { head: 'Color' },
    ...S.COLORS.map(k => ({ label: k[0].toUpperCase() + k.slice(1), swatch: `var(--c-${k})`, checked: c.color === k,
      action: () => { c.color = k; S.touch(c); S.commit(); } })),
    { sep: true },
    { label: 'Delete collection', danger: true, action: () => {
      if (!confirm(`Delete “${c.name || 'Untitled'}” and everything in it?`)) return;
      const a = S.data().collections;
      a.splice(a.indexOf(c), 1);
      S.commit(false);
      go('#/');
    } },
  ]);
}

// ---- notes ----------------------------------------------------------------------

function dayLabel(ts) {
  const d = new Date(ts), t = new Date();
  if (d.toDateString() === t.toDateString()) return 'Today';
  t.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Yesterday';
  return fmtDate(ts);
}

// Idea cards can carry a group ("3D printing", "Games"…). Groups appear as chips above the
// cards, in the order they were first used; the chosen chip is remembered per device.
// Groups made with "+ Group" are kept in c.groups so they show before any idea is in them.
const groupsOf = c => [...new Set([...(c.groups || []), ...c.notes.map(n => (n.group || '').trim())].filter(Boolean))];
function activeGroup(c) {
  const v = shown[c.id];
  return v && groupsOf(c).includes(v) ? v : null;
}
function addGroup(c) {
  const name = h('input', { class: 'field', placeholder: 'e.g. Woodworking', 'aria-label': 'Group name',
    onkeydown: e => { if (e.key === 'Enter') save(); } });
  const save = () => {
    const g = name.value.trim();
    if (!g) return name.focus();
    if (!groupsOf(c).includes(g)) { c.groups = [...(c.groups || []), g]; S.touch(c); S.commit(false); }
    close();
    setShown(c, g);
  };
  const close = modal('New group', h('label', { class: 'flabel' }, 'Name', name),
    [['Cancel', () => close(), 'ghost'], ['Create', save, 'primary']]);
  name.focus();
}
// An empty group can be removed from its own chip.
function removeGroup(c, g) {
  c.groups = (c.groups || []).filter(x => x !== g);
  if (!c.groups.length) delete c.groups;
  S.touch(c); S.commit(false);
  setShown(c, null);
}
function GroupBar(c) {
  const gs = groupsOf(c);
  const cur = activeGroup(c);
  const count = g => c.notes.filter(n => (n.group || '').trim() === g).length;
  const chip = (label, v, n) => h('button', { class: 'st-chip' + (cur === v ? ' on' : ''), 'aria-pressed': String(cur === v),
    onclick: () => setShown(c, v) }, label, h('span', { class: 'st-n' }, n));
  return h('div', { class: 'status-bar', role: 'group', 'aria-label': 'Show group' },
    gs.length > 0 && chip('All', null, c.notes.length),
    gs.map(g => chip(g, g, count(g))),
    cur && !count(cur) && h('button', { class: 'st-chip ghost', title: `Remove the empty “${cur}” group`,
      onclick: () => removeGroup(c, cur) }, '✕ Remove'),
    h('button', { class: 'st-chip ghost', onclick: () => addGroup(c) }, '+ Group'));
}

// Import ideas from a file: JSON ({ ideas: [{ title, body, group }] } or a plain array), or
// text where blank lines separate ideas and "## Name" lines start a group. Added, never replaced.
function importIdeas(c, file, text) {
  let items = [];
  if (/\.json$/i.test(file.name) || /^\s*[\[{]/.test(text)) {
    const d = JSON.parse(text);
    items = (Array.isArray(d) ? d : d.ideas || []).map(x => typeof x === 'string' ? { title: x } : x);
  } else {
    let group = '';
    for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
      const lines = block.split('\n').filter(l => l.trim());
      if (!lines.length) continue;
      if (/^#{1,3}\s/.test(lines[0])) { group = lines.shift().replace(/^#+\s*/, '').trim(); if (!lines.length) continue; }
      items.push({ title: lines[0].replace(/^\s*[-*•]\s*/, '').trim(), body: lines.slice(1).join('\n').trim(), group });
    }
  }
  const now = Date.now();
  items = items.filter(x => (x.title || '').trim() || (x.body || '').trim());
  items.forEach((x, i) => {
    const n = S.newNote(c);
    n.title = (x.title || '').trim();
    n.body = (x.body || '').trim();
    if ((x.group || '').trim()) n.group = x.group.trim();
    n.created = n.updated = now - i;          // keeps the file's order, first idea first
  });
  S.touch(c);
  return items.length;
}

function IdeaCards(c, r, tools) {
  const cur = r.sub === 'n' ? c.notes.find(n => n.id === r.sid) : null;
  if (cur) return h('div', { class: 'idea-open' }, NoteEditor(c, cur, { inside: true }));
  const group = activeGroup(c);

  const save = () => {
    const text = cap.value.trim();
    if (!text) return;
    const [first, ...rest] = text.split('\n');
    const n = S.newNote(c);
    n.title = first.trim();
    n.body = rest.join('\n').trim();
    if (group) n.group = group;
    ui.focus = '.capture-input';
    S.commit();
  };
  const cap = h('textarea', { class: 'capture-input', placeholder: 'Jot down an idea', 'aria-label': 'New idea',
    onkeydown: e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
      if (e.key === 'Escape') { cap.value = ''; cap.blur(); }
    } });
  const capture = h('div', { class: 'card capture', onclick: e => { if (e.target === e.currentTarget) cap.focus(); } },
    h('div', { class: 'card-top' }, h('span', {}, group ? 'New · ' + group : 'New idea'),
      h('button', { class: 'capture-save', onclick: save, title: 'Save idea (Enter)' }, 'Save ↵')),
    cap);

  const grid = h('div', { class: 'grid idea-grid' });
  const fill = () => {
    const q = (ui.filter[c.id] || '').trim().toLowerCase();
    const notes = [...c.notes]
      .filter(n => !group || (n.group || '').trim() === group)
      .filter(n => !q || (n.title + '\n' + n.body + '\n' + (n.group || '')).toLowerCase().includes(q))
      .sort((a, b) => b.created - a.created);
    grid.replaceChildren(...(q ? [] : [capture]), ...notes.map(n => IdeaCard(c, n)),
      ...(q && !notes.length ? [h('div', { class: 'empty-state small' }, 'No ideas match.')] : []));
  };
  fill();
  tools.push(h('input', { class: 'filter', type: 'search', placeholder: 'Filter', 'aria-label': 'Filter ideas',
    value: ui.filter[c.id] || '', oninput: e => { ui.filter[c.id] = e.target.value; fill(); } }));
  return h('div', {}, GroupBar(c), grid);
}

function IdeaCard(c, n) {
  const title = headline(n);
  const g = !activeGroup(c) && (n.group || '').trim();
  // When the title came from the first line of the text, don't repeat that line underneath.
  const lines = (n.body || '').split('\n');
  const bodyLines = n.title.trim() ? lines : lines.slice(lines.findIndex(l => l.trim()) + 1);
  const body = MD.plain(bodyLines.join('\n'));
  return h('a', { class: 'card idea', href: `#/c/${c.id}/n/${n.id}` },
    h('div', { class: 'card-top' }, g ? h('span', { class: 'card-group' }, g) : h('span', {}, dayLabel(n.created)),
      g && h('span', {}, dayLabel(n.created))),
    h('div', { class: 'idea-title' }, title),
    body && h('div', { class: 'idea-body' }, body));
}

function NotesView(c, r, tools) {
  if (c.layout === 'cards') return IdeaCards(c, r, tools);
  const notes = [...c.notes].sort((a, b) => b.updated - a.updated);
  let cur = r.sub === 'n' ? c.notes.find(n => n.id === r.sid) : null;
  if (!cur && !narrowMQ.matches && notes.length) {
    cur = notes[0];
    history.replaceState(null, '', `#/c/${c.id}/n/${cur.id}`);
  }
  const add = () => {
    const n = S.newNote(c);
    S.commit(false);
    ui.focus = '.note-title';
    go(`#/c/${c.id}/n/${n.id}`);
  };
  const list = h('aside', { class: 'note-list' },
    h('button', { class: 'btn block', onclick: add }, '+ New page'),
    notes.length
      ? notes.map(n => h('a', { class: 'note-row' + (n === cur ? ' on' : ''), href: `#/c/${c.id}/n/${n.id}`, 'data-id': n.id },
          h('div', { class: 'nr-title' }, n.title || 'Untitled'),
          h('div', { class: 'nr-meta' }, fmtDate(n.updated) + (n.body ? ' · ' + MD.plain(n.body).slice(0, 80) : ''))))
      : h('div', { class: 'empty-state small' }, 'No pages yet.'));
  return h('div', { class: 'notes' + (cur ? ' open' : '') },
    list,
    cur ? NoteEditor(c, cur) : h('div', { class: 'note-empty' }, 'Pick a page, or start a new one.'));
}

function NoteEditor(c, n, opts = {}) {
  const save = () => {
    n.updated = Date.now();
    S.touch(c);
    S.commit(false);
    const row = document.querySelector(`.note-row[data-id="${n.id}"] .nr-title`);
    if (row) row.textContent = n.title || 'Untitled';
  };
  const title = h('input', { class: 'note-title', value: n.title, placeholder: 'Untitled',
    oninput: e => { n.title = e.target.value; save(); },
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); edit(); } } });
  const ta = h('textarea', { class: 'note-body-edit', value: n.body,
    placeholder: 'Write, or paste from anywhere. Markdown works: # heading, - list, - [ ] task, **bold**.',
    oninput: () => { n.body = ta.value; autosize(ta); save(); },
    onblur: () => { if (n.body.trim()) view(); },
    onkeydown: e => { if (e.key === 'Escape') ta.blur(); } });
  ta.addEventListener('paste', e => {
    const html = e.clipboardData?.getData('text/html');
    if (!html) return;
    const md = MD.htmlToMd(html);
    if (!md) return;
    e.preventDefault();
    ta.setRangeText(md, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  });
  const out = h('div', { class: 'md', onclick: e => {
    if (e.target.closest('a')) return;
    if (e.target.matches('input[type=checkbox]')) {
      n.body = MD.toggleTask(n.body, +e.target.dataset.line);
      ta.value = n.body;
      save(); view();
      return;
    }
    if (getSelection().toString()) return;
    edit();
  } });
  const toggle = h('button', { class: 'btn small', onclick: () => (ta.hidden ? edit() : view()) }, 'Edit');
  function view() { out.innerHTML = MD.render(n.body); ta.hidden = true; out.hidden = false; toggle.textContent = 'Edit'; }
  function edit() { out.hidden = true; ta.hidden = false; toggle.textContent = 'Done'; autosize(ta); ta.focus(); }
  const del = () => {
    if ((n.title || n.body) && !confirm('Delete this page?')) return;
    c.notes.splice(c.notes.indexOf(n), 1);
    S.touch(c);
    S.commit(false);
    history.replaceState(null, '', `#/c/${c.id}`);
    render();
  };
  if (n.body.trim()) view(); else { out.hidden = true; toggle.textContent = 'Done'; requestAnimationFrame(() => autosize(ta)); }
  let groupField = null;
  if (c.layout === 'cards') {
    const dlId = 'dl-groups-' + c.id;
    document.getElementById(dlId)?.remove();
    document.body.append(h('datalist', { id: dlId }, groupsOf(c).map(g => h('option', { value: g }))));
    groupField = h('input', { class: 'field group-field', value: n.group || '', placeholder: 'Group', list: dlId,
      'aria-label': 'Group', autocomplete: 'off',
      oninput: e => { const v = e.target.value.trim(); if (v) n.group = v; else delete n.group; save(); },
      onkeydown: e => { if (e.key === 'Enter') e.target.blur(); } });
  }
  return h('article', { class: 'note-editor' },
    h('div', { class: 'note-tools' },
      !opts.inside && h('a', { class: 'back only-narrow', href: `#/c/${c.id}` }, '← All pages'),
      h('span', { class: 'meta' }, 'Edited ' + fmtDate(n.updated, true)),
      groupField,
      h('span', { class: 'grow' }),
      toggle,
      h('button', { class: 'btn small ghost danger', onclick: del }, 'Delete')),
    title, ta, out);
}

// ---- lists ---------------------------------------------------------------------

function cleanItem(line) {
  const m = line.match(/^\s*(?:[-*•+]|\d+[.)])?\s*(?:\[([ xX])\])?\s*(.*)$/);
  return { done: !!m[1] && m[1] !== ' ', text: (m[2] || '').trim() };
}

function ListView(c) {
  const open = c.items.filter(i => !i.done), done = c.items.filter(i => i.done);
  const addLines = text => {
    text.split(/\r?\n/).map(cleanItem).filter(x => x.text).forEach(x => S.newItem(c, x.text, x.done));
    ui.focus = '.add-input';
    S.commit();
  };
  const addIn = h('textarea', { class: 'add-input grow-ta', rows: 1, placeholder: 'Add an item, or paste a whole list',
    oninput: () => autosize(addIn),
    onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (addIn.value.trim()) addLines(addIn.value); } },
    onpaste: e => {
      const t = e.clipboardData.getData('text/plain');
      if (t.includes('\n')) { e.preventDefault(); addLines(t); }
    } });
  return h('div', { class: 'listview' },
    h('div', { class: 'items' }, open.map(it => ItemRow(c, it))),
    h('div', { class: 'add-row' }, h('span', { class: 'box ghost' }, '+'), addIn),
    done.length > 0 && h('details', { class: 'done', open: ui.showDone[c.id] || null,
      ontoggle: e => { ui.showDone[c.id] = e.target.open; } },
      h('summary', {}, `Done · ${done.length}`),
      done.map(it => ItemRow(c, it))));
}

function ItemRow(c, it) {
  const remove = () => { c.items.splice(c.items.indexOf(it), 1); S.touch(c); S.commit(); };
  return h('div', { class: 'item' + (it.done ? ' is-done' : '') },
    h('button', { class: 'box' + (it.done ? ' on' : ''), 'aria-label': it.done ? 'Mark not done' : 'Mark done',
      onclick: () => { it.done = !it.done; S.touch(c); S.commit(); } }, it.done ? '✓' : ''),
    h('textarea', { class: 'item-text grow-ta', rows: 1, value: it.text,
      oninput: e => { it.text = e.target.value; autosize(e.target); S.touch(c); S.commit(false); },
      onkeydown: e => {
        if (e.key === 'Enter') { e.preventDefault(); document.querySelector('.add-input')?.focus(); }
        if (e.key === 'Backspace' && !e.target.value) { e.preventDefault(); remove(); }
      } }),
    h('button', { class: 'icon-btn x', 'aria-label': 'Delete item', onclick: remove }, '✕'));
}

// ---- tables ---------------------------------------------------------------------

function cmpVal(a, b, type) {
  if (type === 'number' || type === 'rating') return a - b;
  if (type === 'checkbox') return (a ? 1 : 0) - (b ? 1 : 0);
  return S.toText(a, type).localeCompare(S.toText(b, type), undefined, { numeric: true, sensitivity: 'base' });
}

// ---- status filter ------------------------------------------------------------------
// A table with a select column called Status (or Shelf/State) gets a row of chips above it:
// one per status plus All. The choice is remembered per device. Changing a row's status
// moves it out of the current view as soon as the edit is done.

const SHOW_KEY = 'notebook.show';
const shown = (() => { try { return JSON.parse(localStorage.getItem(SHOW_KEY)) || {}; } catch { return {}; } })();
const statusCol = c => c.columns.find(k => k.type === 'select' && /^(status|shelf|state)$/i.test(k.name.trim()));
function statusValues(c, k) {
  const used = c.rows.map(r => r.cells[k.id]).filter(Boolean);
  return [...new Set([...(k.options || []), ...used])];
}
function activeStatus(c) {
  const k = statusCol(c), v = shown[c.id];
  return k && v && statusValues(c, k).includes(v) ? v : null;
}
function setShown(c, v) {
  if (v) shown[c.id] = v; else delete shown[c.id];
  try { localStorage.setItem(SHOW_KEY, JSON.stringify(shown)); } catch {}
  render();
}
function StatusBar(c) {
  const k = statusCol(c);
  if (!k || !c.rows.length) return null;
  const cur = activeStatus(c);
  const count = v => c.rows.filter(r => r.cells[k.id] === v).length;
  const chip = (label, v, n) => h('button', { class: 'st-chip' + (cur === v ? ' on' : ''), 'aria-pressed': String(cur === v),
    onclick: () => setShown(c, v) }, label, h('span', { class: 'st-n' }, n));
  return h('div', { class: 'status-bar', role: 'group', 'aria-label': 'Show ' + k.name },
    statusValues(c, k).map(v => chip(v, v, count(v))),
    chip('All', null, c.rows.length));
}
// New rows made while a status is showing start with that status, so they don't vanish.
function newRowIn(c) {
  const r = S.newRow(c), v = activeStatus(c);
  if (v) r.cells[statusCol(c).id] = v;
  return r;
}

function visibleRows(c) {
  const q = (ui.filter[c.id] || '').trim().toLowerCase();
  let rows = c.rows;
  const st = activeStatus(c);
  if (st) { const k = statusCol(c); rows = rows.filter(r => r.cells[k.id] === st); }
  if (q) rows = rows.filter(r => c.columns.some(k => S.toText(r.cells[k.id], k.type).toLowerCase().includes(q)));
  const k = c.sort && c.columns.find(x => x.id === c.sort.col);
  if (k) {
    const d = c.sort.dir;
    rows = [...rows].sort((x, y) => {
      const a = x.cells[k.id], b = y.cells[k.id];
      const ea = S.isEmpty(a), eb = S.isEmpty(b);
      if (ea !== eb) return ea ? 1 : -1;
      return ea ? 0 : cmpVal(a, b, k.type) * d;
    });
  }
  return rows;
}

function TableView(c, tools) {
  if (narrowMQ.matches) return TableList(c, tools);
  const tbody = h('tbody');
  const lists = {};
  function fillBody() {
    const rows = visibleRows(c);
    tbody.replaceChildren(...rows.map(r => h('tr', { 'data-id': r.id },
      c.columns.map(k => h('td', { class: 't-' + k.type }, Cell(c, k, r, lists))),
      h('td', { class: 't-actions' },
        h('a', { class: 'icon-btn', href: `#/c/${c.id}/r/${r.id}`, title: 'Open row' }, '↗'),
        h('button', { class: 'icon-btn', title: 'Delete row', onclick: () => {
          if (Object.keys(r.cells).length && !confirm('Delete this row?')) return;
          c.rows.splice(c.rows.indexOf(r), 1); S.touch(c); S.commit();
        } }, '✕')))));
    requestAnimationFrame(() => tbody.querySelectorAll('.grow-ta').forEach(autosize));
  }
  fillBody();
  const head = h('tr', {},
    c.columns.map(k => {
      const dir = c.sort?.col === k.id ? c.sort.dir : 0;
      return h('th', { class: 't-' + k.type }, h('div', { class: 'th' },
        h('button', { class: 'th-name', title: 'Sort', onclick: () => {
          c.sort = dir === 1 ? { col: k.id, dir: -1 } : dir === -1 ? null : { col: k.id, dir: 1 };
          S.commit();
        } }, k.name, dir ? (dir === 1 ? ' ↑' : ' ↓') : ''),
        h('button', { class: 'icon-btn th-more', title: 'Edit column', onclick: () => editColumn(c, k) }, '⋯')));
    }),
    h('th', { class: 't-actions' }, h('button', { class: 'icon-btn', title: 'Add column', onclick: () => editColumn(c, null) }, '+')));
  const addRow = () => {
    const r = newRowIn(c);
    ui.focus = `tr[data-id="${r.id}"] .cell`;
    S.commit();
  };
  tools.push(
    h('input', { class: 'filter', type: 'search', placeholder: 'Filter', 'aria-label': 'Filter rows',
      value: ui.filter[c.id] || '', oninput: e => { ui.filter[c.id] = e.target.value; fillBody(); } }),
    h('button', { class: 'btn primary', onclick: addRow }, '+ Row'));
  return h('div', { class: 'tableview' },
    StatusBar(c),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid-table' }, h('thead', {}, head), tbody)),
    !c.rows.length && h('div', { class: 'empty-state' }, 'No rows yet. Add one, or bring in a CSV from the ⋯ menu.'));
}

function TableList(c, tools) {
  const [p, s2] = c.columns;
  const listEl = h('div', { class: 'rowlist' });
  const byline = s2 && /author|by|writer/i.test(s2.name) ? 'By ' : '';
  const fill = () => {
    const rows = visibleRows(c);
    listEl.replaceChildren(
      ...rows.map(r => {
        const sub = s2 ? S.toText(r.cells[s2.id], s2.type) : '';
        return h('a', { class: 'rowlist-item', href: `#/c/${c.id}/r/${r.id}` },
          h('div', { class: 'rl-title' }, S.toText(r.cells[p?.id], p?.type) || 'Untitled'),
          sub && h('div', { class: 'rl-sub' }, byline + sub));
      }),
      ...(rows.length ? [] : [h('div', { class: 'empty-state small' }, c.rows.length ? 'No matches.' : 'Nothing here yet.')]));
  };
  fill();
  tools.push(h('button', { class: 'btn primary', onclick: () => {
    const r = newRowIn(c);
    S.commit(false);
    ui.pendingRow = { cid: c.id, rid: r.id };
    go(`#/c/${c.id}/r/${r.id}`);
  } }, '+ Add'));
  return h('div', { class: 'tableview narrow' }, StatusBar(c), listEl);
}

function RowDetail(c, rid) {
  const r = c.rows.find(x => x.id === rid);
  if (!r) { queueMicrotask(() => location.replace(`#/c/${c.id}`)); return h('div'); }
  const lists = {};
  const del = () => {
    if (Object.keys(r.cells).length && !confirm('Delete this row?')) return;
    c.rows.splice(c.rows.indexOf(r), 1);
    S.touch(c);
    S.commit(false);
    go(`#/c/${c.id}`);
  };
  if (!Object.keys(r.cells).length) ui.focus = '.fields .cell';
  return h('div', { class: 'row-body' },
    h('table', { class: 'fields' }, c.columns.map(k => h('tr', {},
      h('th', {}, k.name),
      h('td', { class: 't-' + k.type }, Cell(c, k, r, lists))))),
    h('div', { class: 'row-actions' }, h('button', { class: 'btn ghost danger', onclick: del }, 'Delete row')));
}

// One datalist per select column per render, shared by every cell in that column.
function datalistFor(c, k, lists) {
  const id = 'dl-' + k.id;
  if (lists[id]) return id;
  let dl = document.getElementById(id);
  if (!dl) { dl = h('datalist', { id }); document.body.append(dl); }
  const vals = [...new Set([...(k.options || []), ...c.rows.map(r => r.cells[k.id]).filter(Boolean)])];
  dl.replaceChildren(...vals.map(v => h('option', { value: v })));
  lists[id] = true;
  return id;
}

function Cell(c, k, r, lists) {
  const v = r.cells[k.id];
  const set = val => {
    if (S.isEmpty(val)) delete r.cells[k.id]; else r.cells[k.id] = val;
    S.touch(c);
    S.commit(false);
  };
  switch (k.type) {
    case 'number':
      return h('input', { class: 'cell', type: 'number', step: 'any', value: v ?? '',
        oninput: e => set(e.target.value === '' ? '' : Number(e.target.value)) });
    case 'date':
      return h('input', { class: 'cell' + (v ? '' : ' empty'), type: 'date', value: v || '',
        onchange: e => { set(e.target.value); e.target.classList.toggle('empty', !e.target.value); } });
    case 'checkbox':
      return h('label', { class: 'cell cell-check' },
        h('input', { type: 'checkbox', checked: !!v, 'aria-label': k.name, onchange: e => set(e.target.checked) }));
    case 'rating':
      return Rating(v || 0, set);
    case 'tags':
      return Tags(v || [], set, tagInks(c, k, lists));
    case 'select':
      return h('input', { class: 'cell', value: v || '', list: datalistFor(c, k, lists), autocomplete: 'off',
        oninput: e => set(e.target.value.trim() ? e.target.value : ''),
        onchange: () => { if (k === statusCol(c) && activeStatus(c) !== null) render(); } });
    case 'url': {
      const a = h('a', { class: 'url-go', href: v || '#', target: '_blank', rel: 'noopener', title: 'Open link', hidden: !v }, '↗');
      return h('div', { class: 'cell-url' },
        h('input', { class: 'cell', type: 'url', value: v || '', placeholder: 'https://',
          oninput: e => { const u = e.target.value.trim(); set(u); a.href = u || '#'; a.hidden = !u; } }),
        a);
    }
    default:
      return h('textarea', { class: 'cell grow-ta', rows: 1, value: v || '',
        oninput: e => { set(e.target.value); autosize(e.target); } });
  }
}

function Rating(val, onSet) {
  const el = h('div', { class: 'rating' });
  let cur = val;
  const draw = () => el.replaceChildren(...[1, 2, 3, 4, 5].map(i => h('button', {
    class: 'pip' + (i <= cur ? ' on' : ''), 'aria-label': `${i} of 5`,
    onclick: () => { cur = cur === i ? 0 : i; onSet(cur); draw(); },
  })));
  draw();
  return el;
}

// Tag colours come from the card palette. The most-used tags in a column get the colours
// first, so the common ones never share one. Worked out once per render per column.
function tagInks(c, k, lists) {
  const key = 'tags-' + k.id;
  if (lists[key]) return lists[key];
  const n = new Map();
  for (const r of c.rows) for (const t of r.cells[k.id] || []) n.set(t, (n.get(t) || 0) + 1);
  const order = [...n.keys()].sort((a, b) => n.get(b) - n.get(a) || a.localeCompare(b));
  const inks = new Map(order.map((t, i) => [t, `var(--c-${S.COLORS[i % S.COLORS.length]})`]));
  return (lists[key] = t => inks.get(t) || `var(--c-${S.COLORS[0]})`);
}

function Tags(val, set, tagInk) {
  let tags = [...val];
  const el = h('div', { class: 'cell tags', tabindex: '0' });
  const show = () => el.replaceChildren(...(tags.length
    ? tags.map(t => h('span', { class: 'chip', style: { '--tag': tagInk(t) } }, t))
    : [h('span', { class: 'placeholder' }, '—')]));
  const edit = () => {
    const inp = h('input', { class: 'tag-input', value: tags.join(', '), placeholder: 'tag, tag',
      onblur: () => { tags = S.fromText(inp.value, 'tags'); set(tags); show(); },
      onkeydown: e => {
        if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { inp.value = tags.join(', '); inp.blur(); }
      } });
    el.replaceChildren(inp);
    inp.focus();
  };
  el.addEventListener('click', () => { if (!el.querySelector('input')) edit(); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && !el.querySelector('input')) { e.preventDefault(); edit(); } });
  show();
  return el;
}

function editColumn(c, k) {
  const isNew = !k;
  const idx = k ? c.columns.indexOf(k) : -1;
  const name = h('input', { class: 'field', value: k?.name || '', placeholder: 'Column name',
    onkeydown: e => { if (e.key === 'Enter') save(); } });
  const type = h('select', { class: 'field', onchange: () => { optsWrap.hidden = type.value !== 'select'; } },
    Object.entries(S.COL_TYPES).map(([v, l]) => h('option', { value: v, selected: (k?.type || 'text') === v }, l)));
  const optsIn = h('input', { class: 'field', value: (k?.options || []).join(', '), placeholder: 'Comma separated (optional)' });
  const optsWrap = h('label', { class: 'flabel', hidden: (k?.type || 'text') !== 'select' }, 'Suggested choices', optsIn);
  const move = d => {
    const j = idx + d;
    if (j < 0 || j >= c.columns.length) return;
    [c.columns[idx], c.columns[j]] = [c.columns[j], c.columns[idx]];
    S.touch(c); S.commit(); close();
  };
  const remove = () => {
    if (!confirm(`Delete column “${k.name}” and everything in it?`)) return;
    c.columns.splice(idx, 1);
    c.rows.forEach(r => delete r.cells[k.id]);
    if (c.sort?.col === k.id) c.sort = null;
    S.touch(c); S.commit(); close();
  };
  function save() {
    const nm = name.value.trim() || 'Untitled';
    const t = type.value;
    const opts = optsIn.value.split(',').map(s => s.trim()).filter(Boolean);
    if (isNew) {
      c.columns.push({ id: S.uid(), name: nm, type: t, ...(t === 'select' && opts.length ? { options: opts } : {}) });
    } else {
      if (k.type !== t) {
        c.rows.forEach(r => {
          const v = S.convert(r.cells[k.id], k.type, t);
          if (S.isEmpty(v)) delete r.cells[k.id]; else r.cells[k.id] = v;
        });
        k.type = t;
      }
      k.name = nm;
      if (t === 'select' && opts.length) k.options = opts; else delete k.options;
    }
    S.touch(c); S.commit(); close();
  }
  const body = h('div', { class: 'form' },
    h('label', { class: 'flabel' }, 'Name', name),
    h('label', { class: 'flabel' }, 'Type', type),
    optsWrap,
    !isNew && h('div', { class: 'form-row' },
      h('button', { class: 'btn small', disabled: idx === 0, onclick: () => move(-1) }, '← Left'),
      h('button', { class: 'btn small', disabled: idx === c.columns.length - 1, onclick: () => move(1) }, 'Right →'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn small ghost danger', onclick: remove }, 'Delete column')),
    h('p', { class: 'hint' }, 'On a phone, tables show as a list using the first two columns.'));
  const close = modal(isNew ? 'Add column' : 'Edit column', body,
    [['Cancel', () => close(), 'ghost'], [isNew ? 'Add' : 'Save', save, 'primary']]);
  name.focus();
}

// ---- backup ---------------------------------------------------------------------

function exportJSON() {
  download(`notebook-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S.data(), null, 2), 'application/json');
}
function importJSON() {
  pickFile('.json,application/json', async f => {
    try {
      const d = JSON.parse(await f.text());
      if (!confirm('Replace everything in this notebook with that backup?')) return;
      S.replaceAll(d);
      toast('Backup restored');
    } catch (e) {
      alert('Could not read that file: ' + e.message);
    }
  });
}

// ---- keyboard ---------------------------------------------------------------------

document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (document.querySelector('.modal-back')) return;
  if (e.key === '/') {
    e.preventDefault();
    document.getElementById('search')?.focus();
  } else if ((e.key === 'n' || e.key === 'N') && !route().cid) {
    e.preventDefault();
    openNew();
  }
});

render();
if (signedIn === 'retry') D.signIn();
else {
  if (signedIn === 'connected') toast('Google Drive connected. Your notebook is in a Fieldnotes folder.');
  if (signedIn === 'denied') toast('Drive not connected: permission was declined');
  if (signedIn === 'failed') toast('Google sign-in didn’t work. Try again from the gear menu.');
  D.start();
}
