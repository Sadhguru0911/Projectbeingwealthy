/**
 * Who a merchant NAME is, for comparing spellings (never for storing). "GOOGLE PLAY", "Google Play" and "Google Play Utib" are one payee;
 * "GOOGLE PLAY" and "GOOGLE CLOUD" are two. A name the merchant library recognises is identified by the library's merchant, so the
 * library's display name ("Indian Oil (IOCL)") and the raw bank text ("UPI INDIAN OIL") meet. Pure.
 *   libLookup(name) -> the library merchant's name for this text, or null.
 */
const RAIL = new Set(["UPI", "NEFT", "IMPS", "RTGS", "ACH", "BBPS", "POS", "ECOM", "MB", "IB"]);
const HONORIFIC = new Set(["MR", "MRS", "MS", "MISS", "SHRI", "SMT", "SRI", "DR"]);
// Four-letter bank (IFSC) prefixes that leak into names built from a bank line. HDFC is left out on purpose: HDFC ERGO / HDFC LIFE are real payees.
const IFSC = new Set(["UTIB", "KKBK", "SBIN", "YESB", "IDIB", "PUNB", "BARB", "CNRB", "UBIN", "IBKL", "FDRL", "RATN", "INDB", "BKID", "CBIN", "MAHB", "SIBL", "KARB", "TMBL", "UCBA", "IOBA", "IDFB", "ICIC"]);

export function cleanTokens(name) {
  const seen = new Set();
  const all = String(name || "").toUpperCase().replace(/[0-9]/g, " ").replace(/[^A-Z& ]/g, " ").split(/\s+/).filter(Boolean);
  const kept = all.filter((t) => !RAIL.has(t) && !HONORIFIC.has(t) && !IFSC.has(t) && !seen.has(t) && seen.add(t));
  return kept.length ? kept : all.slice(0, 4);
}

export function payeeIdentity(name, libLookup) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const lib = libLookup ? libLookup(raw) : null;
  if (lib) return "LIB:" + cleanTokens(lib).join(" ");
  return cleanTokens(raw).join(" ");
}

/** A function that gives an identity quickly: results are remembered per name. */
export function makeIdentity(libLookup) {
  const memo = new Map();
  return (name) => { const k = String(name || ""); let v = memo.get(k); if (v === undefined) { v = payeeIdentity(k, libLookup); memo.set(k, v); } return v; };
}

/** identity -> the groups (canonical names) holding any spelling of it, in group order. */
export function groupsByIdentity(aliases, identityOf) {
  const out = new Map();
  (aliases || []).forEach((g) => (g.variants || []).forEach((v) => {
    const id = identityOf(v); if (!id) return;
    const list = out.get(id) || []; if (!list.includes(g.id)) list.push(g.id); out.set(id, list);
  }));
  return out;
}

/** Merchants listed once each: [{ id, spellings:[...] }] in the order first seen. */
export function payeesOfGroup(group, identityOf) {
  const by = new Map();
  (group.variants || []).forEach((v) => { const id = identityOf(v) || v; if (!by.has(id)) by.set(id, { id, spellings: [] }); by.get(id).spellings.push(v); });
  return [...by.values()];
}

/** Adds incoming library/engine groups to the person's own, never putting a payee the person already has in a group into a second one. Pure. */
export function mergeAliasesOwnFirst(prev, incoming, identityOf) {
  const next = (prev || []).map((a) => ({ ...a, variants: [...(a.variants || [])] }));
  const taken = new Set(); next.forEach((g) => g.variants.forEach((v) => taken.add(identityOf(v))));
  (incoming || []).forEach((al) => {
    const fresh = [];
    (al.variants || []).forEach((v) => { const id = identityOf(v); if (taken.has(id)) return; taken.add(id); fresh.push(v); });
    if (!fresh.length) return;
    const ex = next.find((a) => a.canonical === al.canonical);
    if (ex) fresh.forEach((v) => { if (!ex.variants.includes(v)) ex.variants.push(v); });
    else next.push({ ...al, variants: fresh });
  });
  return next;
}
