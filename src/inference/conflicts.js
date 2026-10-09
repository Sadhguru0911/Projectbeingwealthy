/**
 * "Same merchant, classified differently" (backlog #129). A merchant is in conflict when its rows carry two or more different
 * (category, Sub Category 1) answers. Rows with nothing decided yet are not a conflict - they are simply unfinished.
 * Pure. deps: { merchantKey(row) -> string }. Returns [{ key, name, options:[{category, subCategory, count, ids, latest, exemplar}], rows }], biggest first.
 */
export function findConflicts(transactions, deps) {
  const by = new Map();
  transactions.forEach((t) => { if (!t.category) return; const k = deps.merchantKey(t); if (!by.has(k)) by.set(k, []); by.get(k).push(t); });
  const out = [];
  by.forEach((rows, key) => {
    const combos = new Map();
    rows.forEach((t) => {
      const sub = t.subCategory || null;
      const id = t.category + "|" + (sub || "");
      const c = combos.get(id) || { category: t.category, subCategory: sub, count: 0, ids: [], latest: "", exemplar: t };
      c.count++; c.ids.push(t.id); if ((t.date || "") > c.latest) { c.latest = t.date || ""; c.exemplar = t; }
      combos.set(id, c);
    });
    // "Expense" with no Sub Category 1 yet is unfinished, not a competing answer to "Expense / Household".
    let options = [...combos.values()];
    const decided = options.filter((o) => o.subCategory || !options.some((p) => p !== o && p.category === o.category && p.subCategory));
    options = decided;
    if (options.length < 2) return;
    options.sort((a, b) => b.count - a.count || (a.latest < b.latest ? 1 : -1));
    out.push({ key, name: rows.find((t) => t.merchant)?.merchant || key, options, rows: rows.length });
  });
  return out.sort((a, b) => b.rows - a.rows);
}
