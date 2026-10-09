/**
 * Turns RAW statement rows into the labelled transactions the app computes from, using ONLY what the engine can
 * know (backlog #78): the starter rules, the merchant library, the person's card answers, and sightings.
 * Same function for the demo and (once #72 is wired) a real upload. Pure; the engine is injected.
 *
 * The single-sighting rule is enforced HERE, at import: a keyword rule may set category / tag / control on the
 * first sighting, but the repeat pattern comes from sightings alone - one sighting is "One-Time" (not planned
 * for), never "Recurring". Cadence is inferred from the dates (monthly; ~6 months apart -> Semi-Annual; ~12 ->
 * Annual), so a merchant seen steadily is complete without anyone setting it by hand.
 */
import { computeOnboardingResult, stripHandle, answerPatch, COMMITTED_GROUPS } from "../inference/onboardingResult.js";
const gapMonths = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

function cadenceOf(g) {
  const k = g.pattern.kind;
  if (k === "monthly" || k === "twice") {
    // Recurring = it happens once per period of its cadence. Thirteen Zepto orders in a month is not a monthly event, so it is
    // Irregular (forecast as an allowance). The amount does not matter here: a bill can be a fixed or a varying amount
    // (amount behaviour is its own field, learned separately).
    const steady = g.count <= g.pattern.months * 1.2;
    return steady ? { frequencyClass: "Recurring", frequency: "Monthly" } : { frequencyClass: "Irregular", frequency: null };
  }
  if (k === "periodic") {
    const months = [...new Set(g.dates.map((d) => d.slice(0, 7)))].sort();
    const gap = gapMonths(months[0], months[months.length - 1]);
    return { frequencyClass: "Recurring", frequency: gap >= 11 ? "Annual" : "Semi-Annual" };
  }
  if (k === "irregular") return { frequencyClass: "Irregular", frequency: null };
  return { frequencyClass: "One-Time", frequency: null }; // one sighting: not planned for (see header)
}

/**
 * rows: raw rows. opts: { linked: { loan, card, demat } booleans for accounts the person has added }.
 * Returns { transactions, merchantAliases, rules }:
 *  - merchantAliases: every merchant the library knows a group for (and every group a card answer named) is put in that
 *    merchant group - the app's "Sub Category 2" - so Zepto and Blinkit are Grocery without anyone grouping them by hand;
 *  - rules: one learned rule per answered merchant, the same shape Review's bulk apply saves, so the answer sticks.
 */
export function labelStatementFull(rows, engine, answers = [], opts = {}) {
  const result = computeOnboardingResult(rows, engine, answers);
  const byKey = new Map(result.groups.map((g) => [g.key, g]));
  const rules = engine.seedRules();
  const linked = opts.linked || {};
  const transactions = rows.map((r) => {
    const key = r.aiKey || engine.normalizeMerchant(stripHandle(r.description));
    const g = byKey.get(key);
    const rule = engine.matchRule(r.description, rules), lib = engine.findLibraryEntry(r.aiKey || r.description);
    const ans = answers.find((a) => a.key === key || a.key === g.name.toLowerCase());
    const ap = answerPatch(ans);
    const userRule = rule && rule.source && rule.source !== "system" ? rule : null; // the hierarchy: answer > the person's own / learned rule > library > starter rule
    let category = ap && ap.category ? ap.category : userRule ? userRule.category : lib && lib.category ? lib.category : rule && rule.category ? rule.category : r.direction === "credit" ? "Income" : "Expense";
    let subCategory = null, linkedAccountId;
    const text = r.description.toUpperCase();
    const onCard = !!(opts.cardAccounts && opts.cardAccounts.has(r.accountId));
    if (r.direction === "credit" && onCard) { category = "Transfer"; subCategory = "Debt Payment"; } // a payment or refund on a card is not income
    else if (r.direction === "credit") category = userRule ? userRule.category : "Income";
    else if (ap) { /* the person's own answer decides the category */ }
    else if (userRule) { if (category === "Transfer" || category === "Investment") subCategory = userRule.subCategory || (category === "Investment" ? "Add" : null); }
    else if (lib && lib.category === "Transfer") { category = "Transfer"; subCategory = "Debt Payment"; }
    else if (/CREDIT CARD PAYMENT|CARD BILL/.test(text)) { category = "Transfer"; subCategory = "Debt Payment"; }
    else if (category === "Investment") subCategory = "Add";
    if (category === "Transfer" && /HOME LOAN|EMI/.test(text) && linked.loan) linkedAccountId = "acc_loan";
    if (category === "Transfer" && /CARD/.test(text) && linked.card) linkedAccountId = "acc_card";
    if (category === "Investment" && linked.demat) linkedAccountId = "acc_demat";
    const rep = answers.find((a) => a.key === "repeat:" + key); // a "Does this repeat?" answer (live path) sets the cadence itself
    const cad = rep && rep.cadence ? rep.cadence : userRule && userRule.frequencyClass ? { frequencyClass: userRule.frequencyClass, frequency: userRule.frequency || null } : cadenceOf(g); // a rule the person made sets the cadence itself
    const control = r.direction === "credit" || category === "Investment" ? null
      : ap && ap.control ? ap.control : userRule ? (userRule.control || (userRule.frequencyClass === "One-Time" ? null : category === "Transfer" ? "Committed" : "Flexible")) : (rule && rule.control) || (lib && COMMITTED_GROUPS.has(lib.group)) || category === "Transfer" ? "Committed" : "Flexible";
    // Sub Category 1: Expense is Household or Personal (the answer, else the library's or the rule's own tag; blank when nobody knows, so a
    // card asks); Income is its kind. `purpose` in the app is Personal / Business, which nothing here knows.
    if (category === "Expense") subCategory = (ap && ap.sub1) || (userRule && (userRule.subCategory || userRule.tag)) || (lib && lib.category === "Expense" && lib.sub) || (rule && rule.tag) || null;
    if (category === "Income") subCategory = userRule && userRule.subCategory ? userRule.subCategory : /SALARY/.test(text) ? "Salary" : /DIVIDEND/.test(text) ? "Dividend" : /INTEREST/.test(text) ? "Interest" : "Others";
    const purpose = userRule && userRule.purpose ? userRule.purpose : "Personal";
    return { id: r.id, accountId: r.accountId, importBatchId: opts.batchId || "demo_batch", date: r.date, description: r.description, merchant: g.name, merchantLocked: true, amount: r.amount,
      direction: r.direction, category, subCategory, frequencyClass: cad.frequencyClass, ...(cad.frequency ? { frequency: cad.frequency } : {}), control, purpose,
      ...(linkedAccountId ? { linkedAccountId } : userRule && userRule.linkedAccountId ? { linkedAccountId: userRule.linkedAccountId } : {}) };
  });
  // Merchant groups (Sub Category 2): one per library / answered group name, holding the merchants that belong to it.
  const aliases = new Map();
  const catOf = new Map(transactions.map((x) => [x.merchant, x.category])); // the category each merchant's rows ended up with
  result.groups.forEach((g) => {
    const cat = catOf.get(g.name);
    // The library never makes a group for a merchant the person's own (or a learned) rule already covers: that rule's group, if it has one, is used; otherwise none (#153/#161).
    const grp = g.groupFrom === "library" && g.hasUserRule ? g.ruleGroup : g.group;
    if (!grp || (cat !== "Expense" && cat !== "Income")) return; // Sub Category 2 only exists for Expense / Income
    const a = aliases.get(grp) || { id: "mg_" + grp.toLowerCase().replace(/[^a-z0-9]+/g, "_"), canonical: grp, type: "category", variants: [] };
    if (!a.variants.includes(g.name)) a.variants.push(g.name);
    aliases.set(grp, a);
  });
  const learned = answers.filter((a) => answerPatch(a)).map((a) => {
    const g = result.groups.find((x) => x.key === a.key || x.name.toLowerCase() === a.key);
    const ap = answerPatch(a); if (!g) return null;
    return { id: "rule_ans_" + g.key.replace(/[^a-z0-9]+/gi, "_"), pattern: g.name.toLowerCase(), category: ap.category, subCategory: ap.sub1 || null, frequencyClass: null, frequency: null, control: ap.control, purpose: "Personal", linkedAccountId: null, source: "learned", priority: g.name.length + 1001 };
  }).filter(Boolean);
  return { transactions, merchantAliases: [...aliases.values()], rules: learned };
}

/** Just the labelled rows (kept for callers and tests that only need those). */
export function labelStatement(rows, engine, answers = [], opts = {}) { return labelStatementFull(rows, engine, answers, opts).transactions; }
