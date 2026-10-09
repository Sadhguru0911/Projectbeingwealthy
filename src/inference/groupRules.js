/**
 * A rule can carry a merchant group (Sub Category 2). The group a rule names is applied by putting the merchant of every
 * Expense / Income row the rule matches into that group - unless the merchant already has a group (a group is never moved silently).
 * Merchant groups stay the one place the app reads a group from; the rule is where the answer is remembered. Pure.
 *   matchRule(description, rules) -> the winning rule or null.
 * Returns { aliases, changed } - the same aliases array when nothing changed.
 */
export function healGroups(transactions, rules, aliases, matchRule, identityOf = (x) => x) {
  const taken = new Map(); // merchant -> a category group it is already in
  aliases.forEach((g) => { if ((g.type || "category") === "category") g.variants.forEach((v) => taken.set(identityOf(v), g.canonical)); });
  const add = new Map(); // group name -> merchants to add
  transactions.forEach((t) => {
    if (t.category !== "Expense" && t.category !== "Income") return;
    const m = t.merchant || t.description; if (!m || taken.has(identityOf(m))) return;
    const rule = matchRule(t.description, rules);
    if (!rule || !rule.group) return;
    taken.set(identityOf(m), rule.group);
    if (!add.has(rule.group)) add.set(rule.group, []);
    add.get(rule.group).push(m);
  });
  if (!add.size) return { aliases, changed: 0 };
  let next = [...aliases], changed = 0;
  add.forEach((merchants, name) => {
    changed += merchants.length;
    const ex = next.find((g) => g.canonical.toLowerCase() === name.toLowerCase() && (g.type || "category") === "category");
    if (ex) next = next.map((g) => (g === ex ? { ...g, variants: [...new Set([...g.variants, ...merchants])] } : g));
    else next.push({ id: "mg_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_"), canonical: name, type: "category", variants: [...new Set(merchants)] });
  });
  return { aliases: next, changed };
}
