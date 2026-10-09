/**
 * How many transactions each rule matches, which rules match none ("dead"), and how a dead rule is repaired (backlog #123).
 * Pure; the text matching is injected so it is the very same matching the app applies.
 *   deps: { norm(text) -> normalised text, test(normText, rule, rawDescription) -> boolean, merchantKey(description) -> the payee identity }
 */
export function ruleMatchCounts(rules, transactions, deps) {
  const counts = new Map(rules.map((r) => [r.id, 0]));
  const texts = transactions.map((t) => deps.norm(t.description || ""));
  rules.forEach((r) => { let n = 0; texts.forEach((tx, i) => { if (deps.test(tx, r, transactions[i].description || "")) n++; }); counts.set(r.id, n); });
  return counts;
}

/** A dead rule is repaired from the transactions that point to it (they carry its id) or, failing that, whose merchant name is its pattern. */
export function repairDeadRule(rule, transactions, rules, deps) {
  if (rule.scope === "remark") return { ok: false, reason: "A remark rule has no payee to rebuild it from. Edit it or delete it." };
  const pat = String(rule.pattern || "").toLowerCase();
  let rows = transactions.filter((t) => t.matchedRuleId === rule.id && t.description);
  if (!rows.length) rows = transactions.filter((t) => t.description && String(t.merchant || "").toLowerCase() === pat);
  if (!rows.length) return { ok: false, rowIds: [], reason: "No transaction points to this rule, so there is nothing to rebuild it from. Edit it or delete it." };
  const tally = new Map();
  rows.forEach((t) => { const k = String(deps.merchantKey(t.description) || "").toLowerCase().trim(); if (k) tally.set(k, (tally.get(k) || 0) + 1); });
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[0] === pat) return { ok: false, reason: "Could not work out a better pattern. Edit it or delete it." };
  const candidate = { ...rule, pattern: best[0] };
  if (!rows.some((t) => deps.test(deps.norm(t.description), candidate, t.description))) return { ok: false, reason: "Could not work out a better pattern. Edit it or delete it." };
  return { ok: true, pattern: best[0], matches: rows.length, rowIds: rows.map((t) => t.id), merge: rules.some((r) => r.id !== rule.id && String(r.pattern).toLowerCase() === best[0]) };
}

/** Pairs of rules that both match the same transactions but disagree on category / Sub Category 1 (backlog #129). Only the pairs that actually collide on a real row. */
export function overlappingRules(rules, transactions, deps) {
  const pairs = new Map();
  const same = (a, b) => (a.category || null) === (b.category || null) && (a.subCategory || null) === (b.subCategory || null);
  transactions.forEach((t) => {
    const tx = deps.norm(t.description || "");
    const hit = rules.filter((r) => deps.test(tx, r, t.description || ""));
    for (let i = 0; i < hit.length; i++) for (let j = i + 1; j < hit.length; j++) {
      if (same(hit[i], hit[j])) continue;
      if ((hit[i].keepBoth || []).includes(hit[j].id) || (hit[j].keepBoth || []).includes(hit[i].id)) continue; // the person said both are meant to exist
      const k = hit[i].id + "|" + hit[j].id;
      const cur = pairs.get(k);
      pairs.set(k, { a: hit[i], b: hit[j], rows: (cur?.rows || 0) + 1, ids: [...(cur?.ids || []), t.id] });
    }
  });
  return [...pairs.values()].sort((x, y) => y.rows - x.rows);
}
