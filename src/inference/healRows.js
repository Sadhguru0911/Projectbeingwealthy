/**
 * Keeps already-imported rows in line with the rule book (backlog #124). After a rule is saved, or rows are imported, every row the person
 * has NOT edited by hand takes whatever the best-matching rule of theirs says. Pure; the rule matcher is injected.
 *
 * "Edited by hand" means: the row says so (`handEdited`, set when it was tagged without a rule behind it), or - for rows saved before that
 * flag existed - it carries a category with no rule behind it and was not labelled by the engine. Anything the engine labelled
 * (`labelSource: "engine"`) or a rule labelled (`matchedRuleId`) is fair game: a rule of the person's own outranks both.
 */
export const isHandEdited = (t) => !!t.handEdited || (!t.matchedRuleId && !!t.category && t.labelSource !== "engine");

const FIELDS = ["category", "subCategory", "frequencyClass", "frequency", "control", "purpose", "linkedAccountId"];

export function healTransactions(transactions, rules, matchRule) {
  if (!rules || !rules.length) return { transactions, changed: 0 };
  let changed = 0;
  const next = transactions.map((t) => {
    if (!t.description || isHandEdited(t)) return t;
    const rule = matchRule(t.description, rules);
    if (!rule) return t;
    const patch = {};
    FIELDS.forEach((f) => { const v = rule[f]; if (v !== null && v !== undefined && v !== "" && v !== t[f]) patch[f] = v; });
    if (rule.category && rule.category !== "Expense" && t.control) patch.control = null; // a transfer / income / investment carries no control
    if (t.matchedRuleId !== rule.id) patch.matchedRuleId = rule.id;
    if (!Object.keys(patch).length) return t;
    changed++;
    return { ...t, ...patch };
  });
  return { transactions: changed ? next : transactions, changed };
}
