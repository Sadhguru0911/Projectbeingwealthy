/**
 * ONE definition of "needs you" (backlog #125): a merchant needs you when at least one of its stored transactions is not fully categorised -
 * the very same test Review's "By transaction" count uses. The review cards, the Home note and Review's counts all come from here.
 * A card asks only for the fields that are still missing, with what is already known filled in.
 * Pure; everything app-specific is injected:
 *   deps: { missing(row) -> [field], merchantKey(row) -> string, suggest(row) -> partial values, fmtDate(iso), fmtMoney(n), remarkOf?(row) -> string|null,
 *           cardKey?(row) -> string|null  ("remark:<words>" clubs payments to different payees that carry the same remark into ONE card; null keeps the payee) }
 */
export const FIELD_ORDER = ["category", "subCategory", "group", "frequencyClass", "frequency", "control", "purpose", "linkedAccountId"];
const empty = (v) => v === null || v === undefined || v === "";

const mostCommon = (rows, f) => {
  const tally = new Map();
  rows.forEach((r) => { if (!empty(r[f])) tally.set(r[f], (tally.get(r[f]) || 0) + 1); });
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
};

export function buildNeedsYouCards(transactions, deps) {
  const groups = new Map();
  transactions.map((t) => (deps.groupOf ? { ...t, group: deps.groupOf(t) } : t)).forEach((t) => { const k = (deps.cardKey && deps.cardKey(t)) || deps.merchantKey(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  const signed = (n) => (n < 0 ? "−" : "+") + deps.fmtMoney(Math.abs(n));
  // The remark the person typed on these payments, exactly as written, most common first: always shown on the card, whether or not it suggests anything.
  const remarksOf = (rows) => {
    if (!deps.remarkOf) return {};
    const tally = new Map(); rows.forEach((t) => { const r = deps.remarkOf(t); if (r) tally.set(r, (tally.get(r) || 0) + 1); });
    const list = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ text, count }));
    return list.length ? { remarks: list } : {};
  };
  const topRemark = (rows) => { const tally = new Map(); rows.forEach((t) => { const r = deps.remarkOf && deps.remarkOf(t); if (r) tally.set(r, (tally.get(r) || 0) + 1); }); return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ""; };
  const cards = [];
  // A row the person said is waiting for an account it has not got yet still lacks the link, but is not asked about again.
  const lacks = (t) => deps.missing(t).filter((f) => !(f === "linkedAccountId" && t.noLinkedAccount));
  groups.forEach((rows, key) => {
    const isRemark = String(key).startsWith("remark:");
    const pending = rows.filter((t) => lacks(t).length > 0);
    if (!pending.length) return;
    const base = {};
    FIELD_ORDER.forEach((f) => { const v = mostCommon(rows, f); if (v !== null) base[f] = v; });
    const hint = deps.suggest(pending[0]) || {};
    FIELD_ORDER.forEach((f) => { if (empty(base[f]) && !empty(hint[f])) base[f] = hint[f]; });
    const amount = (t) => (t.direction === "credit" ? t.amount : -t.amount);
    const net = pending.reduce((s, t) => s + amount(t), 0);
    const byDate = [...pending].sort((a, b) => (a.date < b.date ? 1 : -1));
    cards.push({
      key, name: isRemark ? "Remark: " + topRemark(rows) : rows.find((t) => t.merchant)?.merchant || key,
      meta: pending.length + (pending.length === 1 ? " payment" : " payments") + " · " + signed(net) + " · last " + deps.fmtDate(byDate[0].date),
      samples: byDate.slice(0, 3).map((t) => ({ id: t.id, date: deps.fmtDate(t.date), text: String(t.description).replace(/\s+/g, " ").slice(0, 90), amount: amount(t), signed: signed(amount(t)) })),
      more: Math.max(0, pending.length - 3),
      txnIds: pending.map((t) => t.id), base, ask: "What is still missing", fields: true,
      missingNow: [...new Set(pending.flatMap((t) => lacks(t)))], total: pending.reduce((s, t) => s + t.amount, 0),
      pendingRows: pending.length, suggestedGroup: hint.group || null,
      ...remarksOf(pending), ...(hint.remarkHint ? { remarkHint: hint.remarkHint } : {}),
      ...(isRemark ? { remarkCard: true, remarkKey: key.slice(7), searchName: topRemark(rows), payees: new Set(pending.map((t) => t.merchant || t.description)).size } : {}),
    });
  });
  return cards.sort((a, b) => b.total - a.total);
}
