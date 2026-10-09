(async () => {
  const assert = require("assert");
  const { rawBankRows, rawCardRows, rawAshaStatement } = await import("./ashaStatement.js");
  const key = require("./ashaAnswerKey.cjs");
  let pass = 0; const t = (n, f) => { f(); pass++; console.log("ok -", n); };
  const all = rawAshaStatement(), bank = rawBankRows();
  t("rows carry raw fields only", () => all.forEach((r) => assert.deepStrictEqual(Object.keys(r).sort(), ["accountId", "amount", "date", "description", "direction", "id"])));
  t("deterministic", () => assert.deepStrictEqual(rawBankRows(), rawBankRows()));
  t("ids unique", () => assert.strictEqual(new Set(all.map((r) => r.id)).size, all.length));
  t("nothing after the history end", () => all.forEach((r) => assert(r.date <= "2026-09-28", r.date)));
  t("September is realistically sized (60-80 rows)", () => { const n = bank.filter((r) => r.date >= "2026-09").length; assert(n >= 60 && n <= 80, n); });
  t("12 months is 700-850 bank rows", () => assert(bank.length >= 700 && bank.length <= 850, bank.length));
  t("fixed bills each appear 12 times", () => ["SALARY", "RENT", "HOME LOAN EMI", "NETFLIX"].forEach((p) => assert.strictEqual(bank.filter((r) => r.description.includes(p)).length, 12, p)));
  t("school fee twice, car insurance once", () => { assert.strictEqual(bank.filter((r) => r.description.includes("SCHOOL FEES")).length, 2); assert.strictEqual(bank.filter((r) => r.description.includes("GENERAL INSURANCE")).length, 1); });
  t("answer key resolves the fixed bills", () => ["SALARY", "HOME LOAN EMI", "NETFLIX", "BESCOM"].forEach((p) => assert(key.some(([k]) => bank.find((r) => r.description.includes(p)).description.includes(k)), p)));
  t("card rows exist for 12 months", () => assert.strictEqual(rawCardRows().length, 48));
  console.log("\n" + pass + " passed");
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
