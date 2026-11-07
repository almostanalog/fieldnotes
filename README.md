# Fieldnotes

A small personal Notion replacement: a home screen of square cards, one per collection.
Each collection is **Notes** (Markdown pages), a **List** (checklist) or a **Table**
(columns you define). Built to replace a bloated Notion for books, ideas, lists and reference notes.

## Running it

No build step, no dependencies. Serve the folder statically:

```bash
python -m http.server 8850 --directory notebook
```

Open <http://localhost:8850>. There is also a `notebook` entry in `.claude/launch.json`.

## Where data lives

Everything is one JSON document (`js/store.js`), saved to `localStorage` under `notebook.v1`
on every edit. The gear menu has **Export backup**, **Restore from backup**, **Reset notebook**
and the theme (saved per device as `notebook.theme`).

Each collection has a `color` (one of `COLORS` in `store.js`, mapped to `--c-*` in CSS).
New collections take the least-used ink; change it from the collection's ⋯ menu.

## Google Drive sync

Gear menu → **Connect Google Drive**. The notebook becomes `Fieldnotes/fieldnotes.json` in
Drive (`js/drive.js`), with the `drive.file` permission only, so the app sees nothing else.

- Sign-in is Google's browser-only OAuth redirect (no server, no client secret). The token
  lasts about an hour; after that the app quietly asks Google again (`prompt=none`) when it
  opens if the last sync is over 20 hours old, or when you tap **Sync now**.
- Syncs: on open, ~4 s after an edit, when the app is hidden or comes back, and every 10 min.
- Merging (`js/merge.js`) is three-way against the copy from the last sync, so edits made on
  two devices between syncs both survive. Only the very same field edited on both sides
  conflicts, and then the device doing the sync wins. An edit beats a deletion.
- A device's first sync with an untouched notebook just takes the Drive copy.
- Google Cloud project "Fieldnotes": OAuth client "Fieldnotes web", testing mode, the owner
  is the only test user. Redirect URIs: `https://almostanalog.github.io/fieldnotes/` and
  `http://localhost:8850/`.

## Files

| File | What it holds |
|---|---|
| `js/store.js` | The document, persistence, templates (Books, Ideas, …), cell value conversion |
| `js/drive.js` | Google sign-in, Drive file read/write, sync scheduling |
| `js/merge.js` | Three-way merge of two notebook copies |
| `js/app.js` | Hash router and every view: home grid, search, notes, list, table, row detail |
| `js/md.js` | Markdown renderer for pages, plus HTML → Markdown for pasting |
| `js/csv.js` | CSV parse/export, column type inference, Notion import matching |
| `js/ui.js` | `h()` DOM helper, modal, menu, toast, file pick/download |
| `css/app.css` | Tokens (paper, ink, cyan) and components; dark mode follows the OS |

## Behaviour notes

- **Notes layouts**: a Notes collection shows as a page list or as one square card per
  entry (`layout: 'list' | 'cards'`, switched from the ⋯ menu). Ideas uses cards. Its first
  card is a capture card: type, press Enter, and the first line becomes the title.
- **Tables on a phone** (under 720px) become a list showing the first two columns
  (title and author for Books). Tap a row for the full fields.
- **Notion CSV import**: the first CSV column maps to the table's first column (Notion calls
  it "Name"), other headers match by name or by containment ("Date Finished" → "Finished").
  Star ratings, Notion dates and comma-separated multi-selects are converted.
- **Paste** into a page keeps headings, lists, to-dos, bold/italic and links. Pasting a
  multi-line list into a List makes one item per line.
- **Shortcuts**: `/` search, `N` new collection. Cards drag to reorder on desktop.
