/**
 * Suggests which existing merchant group (Sub Category 2) a not-yet-grouped merchant belongs in (backlog #127).
 * Order: (1) the merchant library's own group, when the person already has a group of that name;
 * (2) the closest existing group by shared words - the payee's name first, the remarks as a lighter hint;
 * (3) nothing. "Others" is never suggested on its own; it is only ever a plain option the person can pick.
 * Pure. groups: [{ canonical, variants:[merchant keys] }]. row: { merchant, description }. lib: library entry or null.
 */
const STOP = new Set(["upi", "imps", "neft", "rtgs", "payment", "pay", "paid", "bank", "ltd", "limited", "pvt", "private", "india", "the", "and", "for", "to", "from", "ref", "txn", "online", "bill"]);
export const tokens = (s) => [...new Set(String(s || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
const stem = (w) => w.replace(/(ing|es|s)$/, "");

export function suggestGroup(row, groups, lib) {
  const names = new Map(groups.map((g) => [g.canonical.toLowerCase(), g.canonical]));
  if (lib && lib.group && lib.group.toLowerCase() !== "others" && lib.group.toLowerCase() !== "other") {
    const own = names.get(lib.group.toLowerCase());
    return { group: own || lib.group, existing: !!own, why: "library" };
  }
  const payee = tokens(row.merchant).map(stem), remark = tokens(row.description).map(stem).filter((w) => !payee.includes(w));
  let best = null;
  groups.forEach((g) => {
    if (/^others?$/i.test(g.canonical)) return;
    const gTok = new Set([...tokens(g.canonical), ...g.variants.flatMap((v) => tokens(v))].map(stem));
    const nameTok = new Set(tokens(g.canonical).map(stem));
    const score = payee.filter((w) => gTok.has(w)).length * 2 + remark.filter((w) => nameTok.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { score, group: g.canonical };
  });
  return best ? { group: best.group, existing: true, why: "similar" } : null;
}
