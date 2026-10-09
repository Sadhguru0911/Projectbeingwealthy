(async () => {
  const assert = require("assert");
  const { ruleMatchCounts, repairDeadRule } = await import("./ruleStats.js");
  let pass = 0; const t = (n, f) => { f(); pass++; console.log("ok -", n); };
  const norm = (s) => s.toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  const deps = { norm, test: (tx, r) => tx.includes(norm(r.pattern)), merchantKey: (d) => (/swiggy/i.test(d) ? "swiggy" : /bescom/i.test(d) ? "bescom" : "") };
  const rules = [{ id: "a", pattern: "swiggy" }, { id: "b", pattern: "swiggy (food delivery)" }, { id: "c", pattern: "nothing here" }, { id: "d", pattern: "electricity - bescom (bangalore)" }];
  const txs = [
    { id: 1, description: "UPI-SWIGGY-x", merchant: "Swiggy (food delivery)", matchedRuleId: "b" },
    { id: 2, description: "BESCOM BILL PAYMENT", merchant: "Electricity - BESCOM (Bangalore)" },
  ];
  const c = ruleMatchCounts(rules, txs, deps);
  t("counts the transactions each rule matches; a rule matching none counts 0", () => { assert.strictEqual(c.get("a"), 1); assert.strictEqual(c.get("b"), 0); assert.strictEqual(c.get("c"), 0); assert.strictEqual(c.get("d"), 0); });
  t("a dead rule made from a display name is rebuilt from the rows that point to it; it merges into an existing rule for the same payee", () => { const r = repairDeadRule(rules[1], txs, rules, deps); assert(r.ok); assert.strictEqual(r.pattern, "swiggy"); assert.strictEqual(r.merge, true); });
  t("rows found by merchant name when none carry the rule id", () => { const r = repairDeadRule(rules[3], txs, rules, deps); assert(r.ok); assert.strictEqual(r.pattern, "bescom"); assert.strictEqual(r.merge, false); });
  t("nothing points to the rule: no guess is made", () => { const r = repairDeadRule(rules[2], txs, rules, deps); assert.strictEqual(r.ok, false); assert(/delete it/.test(r.reason)); });
  console.log(pass + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
