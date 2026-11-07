// Notebook data layer. One JSON document holds everything; this module owns it.
// It persists to localStorage on every edit; js/drive.js syncs that copy with Google
// Drive and hands merged results back through adopt().

const KEY = 'notebook.v1';

export const TYPES = { notes: 'Notes', list: 'List', table: 'Table' };
export const COL_TYPES = {
  text: 'Text', number: 'Number', date: 'Date', select: 'Select',
  tags: 'Tags', rating: 'Rating', checkbox: 'Checkbox', url: 'URL',
};

// Card inks, in the order new collections receive them. Names map to --c-<name> in CSS.
export const COLORS = ['cyan', 'orange', 'blue', 'green', 'yellow', 'pink', 'violet'];

function nextColor() {
  const used = COLORS.map(k => state.collections.filter(c => c.color === k).length);
  return COLORS[used.indexOf(Math.min(...used))];
}

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const now = () => Date.now();

let state = null;
let saveTimer = null;
const listeners = new Set();
export const status = { saved: null, error: null, dirty: false };

export function load() {
  try { state = JSON.parse(localStorage.getItem(KEY)); } catch { state = null; }
  const fresh = !state || !Array.isArray(state.collections);
  if (fresh) state = seed();
  state.collections.forEach(normalize);
  state.collections.forEach(c => { if (!COLORS.includes(c.color)) c.color = nextColor(); });
  if (fresh) persist();
  return state;
}

// Swap in a document produced by sync. Saves it here and redraws without marking it as a
// local edit (it already matches Drive).
export function adopt(next) {
  state = next;
  state.collections.forEach(normalize);
  persist();
  listeners.forEach(fn => fn());
}

export function reset() {
  state = seed();
  state.collections.forEach(normalize);
  commit();
}

function normalize(c) {
  c.notes ||= []; c.items ||= []; c.columns ||= []; c.rows ||= [];
  if (c.sort === undefined) c.sort = null;
  // Notes collections show as a page list or as one card per entry. Ideas defaults to cards.
  if (c.type === 'notes' && !c.layout) c.layout = /^ideas?$/i.test(c.name || '') ? 'cards' : 'list';
}

export const data = () => state;
export const getCollection = id => state.collections.find(c => c.id === id);
export const onChange = fn => listeners.add(fn);

// rerender=false for keystroke-level edits, so the focused input survives.
export function commit(rerender = true) {
  state.updated = now();
  delete state.pristine;
  status.dirty = true;
  document.dispatchEvent(new CustomEvent('nb:edited'));   // drive.js schedules an upload
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 350);
  if (rerender) listeners.forEach(fn => fn());
}

export function flush() {
  if (!status.dirty) return;
  clearTimeout(saveTimer);
  persist();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    status.saved = now(); status.error = null; status.dirty = false;
  } catch (e) {
    status.error = e.message;
  }
  document.dispatchEvent(new CustomEvent('nb:saved'));
}
export const persistNow = () => { clearTimeout(saveTimer); persist(); };

export function replaceAll(next) {
  if (!next || !Array.isArray(next.collections)) throw new Error('Not a notebook backup');
  state = next;
  state.collections.forEach(normalize);
  commit();
}

export const touch = c => { c.updated = now(); };

// ---- creation ---------------------------------------------------------------

const col = (name, type, extra = {}) => ({ id: uid(), name, type, ...extra });

export const TEMPLATES = {
  books:  { label: 'Books', type: 'table', hint: 'Table: title, author, status, rating, tags',
            make: () => ({ columns: [
              col('Title', 'text'), col('Author', 'text'),
              col('Status', 'select', { options: ['Want to read', 'Reading', 'Read', "Didn't finish"] }),
              col('Rating', 'rating'), col('Finished', 'date'), col('Tags', 'tags'),
            ] }) },
  ideas:  { label: 'Ideas', type: 'notes', hint: 'One card per idea, quick to jot down',
            make: () => ({ layout: 'cards' }) },
  notes:  { label: 'Notes', type: 'notes', hint: 'Freeform pages',
            make: () => ({ layout: 'list' }) },
  list:   { label: 'List',  type: 'list',  hint: 'A checklist' },
  table:  { label: 'Table', type: 'table', hint: 'Columns you define',
            make: () => ({ columns: [col('Name', 'text'), col('Notes', 'text')] }) },
};

export function createCollection(name, type, extra = {}) {
  const c = { id: uid(), name, type, color: nextColor(), created: now(), updated: now(),
              notes: [], items: [], columns: [], rows: [], sort: null, ...extra };
  state.collections.push(c);
  return c;
}

export function newRow(c) {
  const r = { id: uid(), cells: {}, created: now() };
  c.rows.push(r); touch(c); return r;
}
export function newNote(c) {
  const n = { id: uid(), title: '', body: '', created: now(), updated: now() };
  c.notes.push(n); touch(c); return n;
}
export function newItem(c, text, done = false) {
  const i = { id: uid(), text, done, created: now() };
  c.items.push(i); touch(c); return i;
}

// ---- cell values --------------------------------------------------------------
// Stored shapes: text/select/url → string, number → number, date → 'YYYY-MM-DD',
// tags → string[], rating → 0..5, checkbox → boolean. Empty cells are deleted.

export function isEmpty(v) {
  return v == null || v === '' || v === false || v === 0 || (Array.isArray(v) && !v.length);
}

export function toText(v, type) {
  if (isEmpty(v)) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (type === 'checkbox' || typeof v === 'boolean') return v ? 'Yes' : '';
  return String(v);
}

export function fromText(s, type) {
  s = (s ?? '').toString().trim();
  switch (type) {
    case 'number': {
      if (!s) return '';
      const n = parseFloat(s.replace(/,/g, ''));
      return isNaN(n) ? '' : n;
    }
    case 'date': return parseDate(s);
    case 'tags': return s ? [...new Set(s.split(',').map(t => t.trim()).filter(Boolean))] : [];
    case 'checkbox': return /^(yes|true|1|x|✓|☑|checked)$/i.test(s);
    case 'rating': {
      const stars = (s.match(/[⭐★]/gu) || []).length;
      if (stars) return Math.min(5, stars);
      const n = parseFloat(s);
      return isNaN(n) ? 0 : Math.max(0, Math.min(5, Math.round(n)));
    }
    default: return s;
  }
}

export const convert = (v, from, to) => fromText(toText(v, from), to);

const pad = n => String(n).padStart(2, '0');
export function parseDate(s) {
  if (!s) return '';
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  // Notion: "January 5, 2024", "January 5, 2024 3:00 PM", "Jan 1, 2024 → Jan 5, 2024"
  const cleaned = s.split('→')[0].replace(/\s+\d{1,2}:\d{2}.*$/, '').trim();
  const d = new Date(cleaned);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---- seed -------------------------------------------------------------------

const WELCOME = `This is a page in a Notes collection. Click anywhere on it to edit.

## The basics
- The home screen has one square card per collection.
- **Notes** collections hold pages like this one.
- **Lists** are checklists. Paste a list and each line becomes an item.
- **Tables** have columns you define. On a phone they turn into a simple list.

## Writing
Markdown works: \`# heading\`, \`- bullet\`, \`**bold**\`, \`*italic*\`, \`[link](https://example.com)\`.

- [ ] Tasks like this can be ticked off right here
- [x] Like this one

Pasting from Notion, Google Docs or a web page keeps headings, lists, bold and links.

## Shortcuts
- \`/\` searches everything
- \`N\` starts a new collection (on the home screen)

Delete this page whenever you like.`;

function seed() {
  // pristine: nobody has touched it yet. On a device's first sync a pristine notebook
  // is simply replaced by the Drive copy instead of merged into it (no duplicate Books).
  state = { version: 1, created: now(), updated: now(), pristine: true, collections: [] };
  createCollection('Books', 'table', TEMPLATES.books.make());
  const ideas = createCollection('Ideas', 'notes', { layout: 'cards' });
  ideas.notes.push({ id: uid(), title: 'How this notebook works', body: WELCOME, created: now(), updated: now() });
  return state;
}
