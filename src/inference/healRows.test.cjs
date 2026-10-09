(async () => {
  const assert = require("assert");
  const { healTransactions, isHandEdited } = await import("./healRows.js");
  const { callEngine } = require("../../golden/load-engine.cjs");
  const matchRule = (d, r) => callEngine("matchRule", [d, r]);
  let pass = 0; const t = (n, f) => { f(); pass++; console.log("ok -", n); };
  const rules = [{ id: "r1", pattern: "mamata adak", category: "Expense", subCategory: "Household", frequencyClass: "Recurring", frequency: "Monthly", control: "Committed", purpose: "Personal", source: "learned", priority: 1011 }];
  const D = "UPI/624637571604/ MAMATA ADAK /MAMATHAADHOK@OKHDFCBANK /PUNB0059820/ 6928000100037376/COOK/ 624637571604/PUNBKAKDWIP/";
  const rows = [
    { id: 1, description: D, category: "Expense", subCategory: null, matchedRuleId: "r1" },                 // imported under the old bug: rule id, blank fields
    { id: 2, description: D, category: "Expense", subCategory: "Personal", labelSource: "engine" },          // engine / library labelled
    { id: 3, description: D, category: "Expense", subCategory: "Personal", handEdited: true },              // edited by hand
    { id: 4, description: D, category: "Expense", subCategory: "Personal" },                                // old row: category, no rule, no flag = by hand
    { id: 5, description: D, category: null },                                                              // uncategorised
    { id: 6, description: "SOMETHING ELSE", category: "Expense", labelSource: "engine" },                  // no rule matches
  ];
  const r = healTransactions(rows, rules, matchRule), by = (i) => r.transactions.find((x) => x.id === i);
  t("a row with a rule id and blank fields is filled from the rule", () => { assert.strictEqual(by(1).subCategory, "Household"); assert.strictEqual(by(1).control, "Committed"); assert.strictEqual(by(1).frequency, "Monthly"); });
  t("an engine-labelled row takes the person's rule", () => { assert.strictEqual(by(2).subCategory, "Household"); assert.strictEqual(by(2).matchedRuleId, "r1"); });
  t("rows edited by hand (flag, or old category-without-rule) are never touched", () => { assert.strictEqual(by(3).subCategory, "Personal"); assert.strictEqual(by(4).subCategory, "Personal"); assert(isHandEdited(rows[3]) && isHandEdited(rows[2]) && !isHandEdited(rows[1])); });
  t("an uncategorised row is filled; a row no rule matches is left alone", () => { assert.strictEqual(by(5).category, "Expense"); assert.strictEqual(by(6).matchedRuleId, undefined); });
  t("nothing to do returns the same array (no needless re-render)", () => { const again = healTransactions(r.transactions, rules, matchRule); assert.strictEqual(again.changed, 0); assert.strictEqual(again.transactions, r.transactions); });
  console.log(pass + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
