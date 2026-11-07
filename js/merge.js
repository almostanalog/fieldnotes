// Three-way merge of notebook documents.
//
// base   = the document as it was at the last successful sync (the common ancestor)
// local  = this device's document now
// remote = the copy in Google Drive now
//
// Whatever only one side changed since base is kept. Arrays of objects with an `id`
// (collections, rows, notes, items, columns) are merged entry by entry, so a book added
// on the phone and an idea added on the PC both survive. Objects merge key by key, so two
// different cells of the same row edited on two devices both survive. Only when both
// sides changed the very same value does one win: this device's.
// An edit beats a deletion: if one side deleted an entry the other side changed, it stays.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isKeyed = a => Array.isArray(a) && a.length > 0 && a.every(x => isObj(x) && 'id' in x);

// JSON with sorted keys, so key order never makes equal values look different.
export function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export const same = (a, b) => stable(a) === stable(b);

export function merge3(base, local, remote) {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;

  // Both sides changed it.
  if (isObj(local) && isObj(remote)) return mergeObj(isObj(base) ? base : {}, local, remote);
  const arrays = [base, local, remote].filter(Array.isArray);
  if (Array.isArray(local) && Array.isArray(remote) && arrays.some(isKeyed)
      && arrays.every(a => !a.length || isKeyed(a))) {
    return mergeKeyed(Array.isArray(base) ? base : [], local, remote);
  }
  return local;
}

function mergeObj(base, local, remote) {
  const out = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])) {
    const v = merge3(base[k], local[k], remote[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function mergeKeyed(base, local, remote) {
  const B = new Map(base.map(x => [x.id, x]));
  const L = new Map(local.map(x => [x.id, x]));
  const R = new Map(remote.map(x => [x.id, x]));

  const keep = new Map();
  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    if (l && r) keep.set(id, merge3(b, l, r));
    else if (l) { if (!b || !same(l, b)) keep.set(id, l); }   // remote deleted it: keep only if edited here
    else if (r) { if (!b || !same(r, b)) keep.set(id, r); }   // deleted here: keep only if edited there
  }

  // Order follows this device unless only the other side reordered (dragged cards).
  // Entries only the other side has go in right after their neighbour there.
  const primary = reordered(base, remote) && !reordered(base, local) ? remote : local;
  const secondary = primary === local ? remote : local;
  const order = primary.map(x => x.id);
  let prev = null;
  for (const { id } of secondary) {
    if (!order.includes(id)) order.splice(prev === null ? 0 : order.indexOf(prev) + 1, 0, id);
    prev = id;
  }
  return order.filter(id => keep.has(id)).map(id => keep.get(id));
}

// Did `a` change the relative order of the entries it shares with `base`?
function reordered(base, a) {
  const inA = new Set(a.map(x => x.id)), inB = new Set(base.map(x => x.id));
  return base.filter(x => inA.has(x.id)).map(x => x.id).join() !== a.filter(x => inB.has(x.id)).map(x => x.id).join();
}
