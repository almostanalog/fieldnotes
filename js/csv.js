import { uid, fromText, touch, isEmpty } from './store.js';

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

export function toCSV(rows) {
  return rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}

const isDateLike = s =>
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s) ||
  /^[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}/.test(s);

export function inferType(name, values, isFirst) {
  const v = values.map(x => (x ?? '').trim()).filter(Boolean);
  if (!v.length || isFirst) return 'text';
  const n = name.toLowerCase();
  if (/tag|genre|categor|topic|label/.test(n)) return 'tags';
  if (/rating|stars|score/.test(n) && v.every(x => /^(\d(\.\d)?|[⭐★☆\s️]+)$/u.test(x))) return 'rating';
  if (v.every(x => /^(yes|no|true|false)$/i.test(x))) return 'checkbox';
  if (v.every(x => /^https?:\/\//i.test(x))) return 'url';
  if (v.every(x => /^-?[\d,]*\.?\d+$/.test(x))) return 'number';
  if (v.every(isDateLike)) return 'date';
  // Notion multi-select exports as "a, b, c"
  const multi = v.filter(x => x.includes(', ')).length;
  const pieces = v.flatMap(x => x.split(', '));
  if (multi / v.length >= 0.3 && pieces.every(p => p.length <= 24)) return 'tags';
  const distinct = new Set(v);
  if (v.length >= 6 && distinct.size <= Math.max(3, v.length / 4) && [...distinct].every(x => x.length <= 30)) return 'select';
  return 'text';
}

// Append CSV rows to a table collection. Columns match by name (case-insensitive);
// unknown headers become new columns with an inferred type.
export function importRows(c, rows) {
  if (!rows.length) return { added: 0, created: 0 };
  const [header, ...body] = rows;
  let created = 0;
  const used = new Set();
  const lc = s => s.toLowerCase().trim();
  // Exact name, then the title column (Notion calls it "Name"), then one name inside the other
  // ("Date Finished" → "Finished"). Each table column is claimed at most once.
  const match = (name, idx) => {
    const free = c.columns.filter(k => !used.has(k));
    return free.find(k => lc(k.name) === lc(name))
      || (idx === 0 && c.columns[0] && !used.has(c.columns[0]) && !c.columns.some(k => lc(k.name) === lc(name)) ? c.columns[0] : null)
      || free.find(k => k !== c.columns[0] && lc(k.name).length >= 4 && lc(name).length >= 4 &&
                        (lc(name).includes(lc(k.name)) || lc(k.name).includes(lc(name))));
  };
  const map = header.map((raw, idx) => {
    const name = raw.trim() || `Column ${idx + 1}`;
    let col = match(name, idx);
    if (col) used.add(col);
    if (!col) {
      col = { id: uid(), name, type: inferType(name, body.map(r => r[idx]), idx === 0 && !c.columns.length) };
      c.columns.push(col);
      used.add(col);
      created++;
    }
    return col;
  });
  for (const r of body) {
    const row = { id: uid(), cells: {}, created: Date.now() };
    map.forEach((col, idx) => {
      const v = fromText(r[idx] ?? '', col.type);
      if (!isEmpty(v)) row.cells[col.id] = v;
    });
    c.rows.push(row);
  }
  touch(c);
  return { added: body.length, created };
}
