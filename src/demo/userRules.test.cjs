// The person's own and learned rules outrank the library and the starter rules, in the labeller AND in the review cards (backlog #116-#118).
(async () => {
  const assert = require("assert");
  const { callEngine } = require("../../golden/load-engine.cjs");
  const { labelStatementFull } = await import("./labelStatement.js");
  const { computeOnboardingResult } = await import("../inference/onboardingResult.js");
  const memo = {}; const m = (fn) => (...a) => { const k = fn + JSON.stringify(a[0]).replace(/\d+/g, "#") + (fn === "matchRule" ? JSON.stringify(a[1] && a[1].length) : ""); return k in memo ? memo[k] : (memo[k] = callEngine(fn, a)); };
  const seed = callEngine("seedRules", []);
  const user = [
    { id: "u1", pattern: "communite", category: "Expense", subCategory: "Personal", frequencyClass: "Irregular", frequency: null, control: "Flexible", purpose: "Business", source: "user", priority: 9 + 1000 },
    { id: "u2", pattern: "upi siddalingappa shreyasharsha", category: "Expense", subCategory: "Household", frequencyClass: "Recurring", frequency: "Monthly", control: "Committed", purpose: "Personal", source: "learned", priority: 31 + 1000 },
  ];
  const rules = [...seed, ...user];
  const engine = { matchRule: (d, r) => callEngine("matchRule", [d, r]), seedRules: () => rules, findLibraryEntry: m("findLibraryEntry"), normalizeMerchant: m("normalizeMerchant") };
  const rows = [
    { id: "a", accountId: "b", date: "2026-09-28", description: "UPI/627023592955/ MR. KUMAR M S/KUMARAMS1990- 1@OKHDFCBANK/IDIB000R52814862630/UNCLE DELIVERY COMMUNITE/ 627023592955/IDIBRAJA RAJESWARI NAG", amount: 193, direction: "debit" },
    { id: "b", accountId: "b", date: "2026-09-27", description: "UPI/626488984634/ SIDDALINGAPPA /SHREYASHARSHA0488@YBL /SBIN0032295/ 00000040840530067/COOKING GAS CYLINDER/ 626488984634/SBIN SARJAPUR ROAD BAN", amount: 1100, direction: "debit" },
    { id: "c", accountId: "b", date: "2026-03-10", description: "ACH C- INDRAPRASTHA GAS LTD-DIVIDEND 2025", amount: 1729, direction: "credit" },
  ];
  let pass = 0; const t = (n, f) => { f(); pass++; console.log("ok -", n); };
  const lab = labelStatementFull(rows, engine, [], { linked: {} }).transactions;
  const by = (id) => lab.find((x) => x.id === id);
  t("user rule 'communite': Expense / Personal (Sub Category 1) / Irregular / Flexible / Business", () => { const x = by("a"); assert.strictEqual(x.category, "Expense"); assert.strictEqual(x.subCategory, "Personal"); assert.strictEqual(x.frequencyClass, "Irregular"); assert.strictEqual(x.control, "Flexible"); assert.strictEqual(x.purpose, "Business"); });
  t("learned rule: Expense / Household / Recurring / Monthly / Committed, even though it is seen once", () => { const x = by("b"); assert.strictEqual(x.subCategory, "Household"); assert.strictEqual(x.frequencyClass, "Recurring"); assert.strictEqual(x.frequency, "Monthly"); assert.strictEqual(x.control, "Committed"); });
  t("a dividend credit is Income, never Expense", () => { const x = by("c"); assert.strictEqual(x.category, "Income"); assert.strictEqual(x.subCategory, "Dividend"); });
  const r = computeOnboardingResult(rows, engine, [], null);
  t("no review card for a merchant the person already has a rule for", () => assert(!r.deck.some((c) => /communite|siddalingappa|gas cylinder/i.test(c.name + c.key)), JSON.stringify(r.deck.map((c) => c.name))));
  t("no expense guess card for a dividend credit", () => assert(!r.deck.some((c) => /indraprastha|gas/i.test(c.name))));
  const plain = computeOnboardingResult(rows, { ...engine, seedRules: () => seed }, [], null);
  t("cards carry signed amounts and the real rows underneath", () => { const all = [...plain.deck, ...plain.repeatCards]; assert(all.length >= 1); all.forEach((c) => { assert(/[−+]₹/.test(c.meta), c.meta); assert(c.samples && c.samples.length >= 1 && /^[−+]₹/.test(c.samples[0].signed)); }); });
  console.log(pass + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
