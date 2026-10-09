/**
 * Who a bank line was paid to (backlog #126). The merchant IDENTITY is the payee - never the bank handle, the bank's own name, a
 * reference number or the free-text remark - so the same person paid from two apps, or with a different remark each month, is one merchant.
 * Pure. Only the formats where the payee is clearly marked are read; anything else returns null and the caller keeps its older way.
 *
 *   UPI/<ref>/<PAYEE>/<vpa>/<ifsc>/<acct>/<remark>/<ref>/<branch>     (also IMPS / NEFT / RTGS in that slash layout)
 *   <ref> <PAYEE> <BANK NAME> <utr> NEFT <ifsc> <remark>              (a NEFT credit/debit line that starts with a reference number)
 */
const HONORIFIC = new Set(["MR", "MRS", "MS", "MISS", "SHRI", "SMT", "SRI", "DR"]);
const BANK_WORDS = new Set(["BANK", "IDBI", "SBI", "HDFC", "ICICI", "AXIS", "KOTAK", "CANARA", "PNB", "BOB", "BOI", "UNION", "INDIAN", "IOB", "UCO", "YES", "IDFC", "RBL",
  "FEDERAL", "BANDHAN", "INDUSIND", "SCB", "CITI", "HSBC", "DBS", "SYNDICATE", "BARODA", "KARNATAKA", "KVB", "SIB", "TMB", "CSB", "DCB", "PAYTM", "JANA", "UJJIVAN", "EQUITAS", "IPPB"]);

const clean = (s) => String(s || "").toUpperCase().replace(/[0-9]/g, " ").replace(/[^A-Z& ]/g, " ").replace(/\s+/g, " ").trim();

/** The payee's words, e.g. "MAMATA ADAK", or null when the line is not in a layout where the payee is marked. */
export function payeeKey(description) {
  const d = String(description || "").trim();
  let payee = null;
  const seg = d.split("/").map((x) => x.trim());
  if (seg.length >= 4 && /^(UPI|IMPS|NEFT|RTGS)$/i.test(seg[0]) && /^\d{6,}$/.test(seg[1]) && seg[2] && !seg[2].includes("@")) payee = seg[2];
  else if (/^[\d-]{6,}\s+/.test(d) && /\bNEFT\b/i.test(d)) {
    const words = [];
    for (const w of d.replace(/^[\d-]+\s+/, "").split(/\s+/)) {
      if (/\d/.test(w) || BANK_WORDS.has(w.toUpperCase())) break;
      words.push(w);
    }
    if (words.length) payee = words.join(" ");
  }
  if (!payee) return null;
  const tokens = clean(payee).split(" ").filter((t) => t && !HONORIFIC.has(t));
  return tokens.length ? tokens.slice(0, 4).join(" ") : null;
}

/**
 * One-time move of merchant names stored under the older "first three words" key to the payee identity, in the rows AND in the
 * merchant groups (a group lists the exact merchant strings it holds, so it must follow the rename or it silently loses members).
 * fns: { legacyKey(desc), newKey(desc), legacyName(desc), newName(desc) } - the name pair is what the labeller stores for rows it labelled.
 */
export function migrateMerchantIdentity(transactions, aliases, fns) {
  const rename = new Map();
  let changed = 0;
  const next = (transactions || []).map((t) => {
    if (!t.description) return t;
    const nk = fns.newKey(t.description);
    if (!nk) return t;
    const oldVal = t.merchantLocked ? fns.legacyName(t.description) : fns.legacyKey(t.description);
    const newVal = t.merchantLocked ? fns.newName(t.description) : nk;
    if (t.merchant !== oldVal || oldVal === newVal) return t;
    rename.set(oldVal, newVal); changed++;
    return { ...t, merchant: newVal };
  });
  const nextAliases = (aliases || []).map((a) => {
    const variants = [];
    (a.variants || []).forEach((v) => { const nv = rename.has(v) ? rename.get(v) : v; if (!variants.includes(nv)) variants.push(nv); });
    return { ...a, variants };
  });
  return { transactions: next, aliases: nextAliases, changed };
}
