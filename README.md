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

Everything is one JSON document (`js/store.js`). Right now it's saved to `localStorage`
under `notebook.v1`. Each browser has its own copy until Drive sync lands. The gear menu
on the home screen has **Export backup**, **Restore from backup** and **Reset notebook**,
plus the theme (match system / light / dark, saved per device as `notebook.theme`).

Each collection has a `color` (one of `COLORS` in `store.js`, mapped to `--c-*` in CSS).
New collections take the least-used ink; change it from the collection's ⋯ menu.

Planned: a Google Drive adapter behind `load()` / `persist()` that reads and writes one
`notebook.json` in a Drive folder (scope `drive.file`), with the local copy kept as an
offline cache. After that, host the static files on GitHub Pages so the phone can install it
to the home screen.

## Files

| File | What it holds |
|---|---|
| `js/store.js` | The document, persistence, templates (Books, Ideas, …), cell value conversion |
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
