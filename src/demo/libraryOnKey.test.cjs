// The library is looked up by the merchant's name for rows read by the AI, not by the whole line; and the library never makes a group for a
// merchant the person's own / a learned rule already covers (backlog #153, #161).
(async () => {
  const assert = require("assert");
  const { callEngine } = require("../../golden/load-engine.cjs");
  const { labelStatementFull } = await import("./labelStatement.js");
  const seed = callEngine("seedRules", []);
  const mk = (rules) => ({ matchRule: (d, r) => callEngine("matchRule", [d, r]), seedRules: () => rules, findLibraryEntry: (d) => callEngine("findLibraryEntry", [d]), normalizeMerchant: (d) => callEngine("normalizeMerchant", [d]) });
  const rapido = "UPI/662126269159/ FIROJA BEGUM /FIROJABEGUM2801@NYES /AIRP0000001/ 8453662801/RAPIDO COMMUNITE/ 662126269159/X";
  const insta = "UPI/663152545548/ SWIGGY INSTAMART PRIVATE LIMITED/INSTAMART.GROCERY@ICICI 002281300/UPI/ 663152545548/";
  let pass = 0; const t = (n, f) => { f(); pass++; console.log("ok -", n); };
  const rows = (ai) => [
    { id: "a", accountId: "b", date: "2026-09-10", description: rapido, amount: 120, direction: "debit", ...(ai ? { aiKey: "FIROJA BEGUM" } : {}) },
    { id: "b", accountId: "b", date: "2026-09-11", description: insta, amount: 450, direction: "debit", ...(ai ? { aiKey: "SWIGGY INSTAMART" } : {}) },
  ];
  const lab = (ai, rules = seed) => labelStatementFull(rows(ai), mk(rules), [], { linked: {} });
  t("without an AI key the whole line is still read (a row not yet migrated keeps its old behaviour): Rapido is found in the remark", () => {
    const x = lab(false).transactions.find((r) => r.id === "a"); assert.strictEqual(x.merchant, "Rapido", x.merchant); });
  t("with an AI key the library is asked about the name only: the person's name is not turned into Rapido", () => {
    const x = lab(true).transactions.find((r) => r.id === "a"); assert.notStrictEqual(x.merchant, "Rapido", x.merchant); assert.strictEqual(x.merchant, "Firoja Begum"); });
  t("with an AI key a name the library knows is still found: Swiggy Instamart", () => {
    const x = lab(true).transactions.find((r) => r.id === "b"); assert(/instamart/i.test(x.merchant), x.merchant); });
  const base = lab(true); const grpOf = (l) => l.merchantAliases.find((a) => a.variants.some((v) => /instamart/i.test(v)));
  t("with no rule, the library makes its group for a merchant that has a transaction", () => assert(grpOf(base), JSON.stringify(base.merchantAliases)));
  const learned = { id: "L1", pattern: "swiggy instamart", category: "Expense", subCategory: "Household", frequencyClass: "Recurring", frequency: "Monthly", control: "Flexible", purpose: "Personal", source: "learned", priority: 1020 };
  const withRule = lab(true, [...seed, learned]);
  t("a learned rule (no group) already covers it: the library makes NO group for it", () => assert(!grpOf(withRule), JSON.stringify(withRule.merchantAliases)));
  const withGroup = lab(true, [...seed, { ...learned, group: "My groceries" }]);
  t("a rule that carries its own group puts the merchant in THAT group, not the library's", () => { const g = grpOf(withGroup); assert(g && g.canonical === "My groceries", JSON.stringify(withGroup.merchantAliases)); });
  console.log(pass + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
