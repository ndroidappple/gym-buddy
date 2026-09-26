/* Three-way merge of the account state, for when another device saved since this one loaded.
   `base` is what both copies started from; whatever a side didn't touch takes the other side's
   version, so a phone that sat in the background with old data can't wipe what was done since.
   Where both sides changed the same thing, this device (the one saving now) wins. */

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// Lists whose items have a stable identity merge item by item; other lists are replaced whole.
const idOf = (x) => (isObj(x) ? x.id ?? x.date : undefined);
const keyedList = (...lists) => lists.every((l) => Array.isArray(l) && l.every((x) => idOf(x) !== undefined));

function mergeKeyed(base, ours, theirs, keys, get) {
  const out = [];
  for (const k of keys) {
    const v = merge3(get(base, k), get(ours, k), get(theirs, k));
    if (v !== undefined) out.push([k, v]);
  }
  return out;
}

export function merge3(base, ours, theirs) {
  if (same(ours, base)) return theirs;
  if (same(theirs, base) || same(ours, theirs)) return ours;
  if (isObj(ours) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const keys = new Set([...Object.keys(b), ...Object.keys(ours), ...Object.keys(theirs)]);
    return Object.fromEntries(mergeKeyed(b, ours, theirs, keys, (o, k) => o[k]));
  }
  if (keyedList(ours, theirs) && (base === undefined || keyedList(base))) {
    const byId = (l) => new Map((l || []).map((x) => [String(idOf(x)), x]));
    const [b, o, t] = [byId(base), byId(ours), byId(theirs)];
    // Their order first (it has everything they kept), then anything only this device has.
    const keys = new Set([...t.keys(), ...o.keys(), ...b.keys()]);
    return mergeKeyed(b, o, t, keys, (m, k) => m.get(k)).map(([, v]) => v);
  }
  return ours;
}
