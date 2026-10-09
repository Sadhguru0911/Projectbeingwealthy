(async () => {
  const assert = require("assert");
  const { buildNeedsYouCards } = await import("./needsYou.js");
  let pass = 0; const t = (n, f) => { f(); pass++; console.log("ok -", n); };
  const missing = (r) => ["category", "subCategory", "frequencyClass", "purpose"].filter((f) => r[f] === undefined || r[f] === null || r[f] === "");
  const deps = { missing, merchantKey: (r) => r.merchant, suggest: (r) => (r.merchant === "Amazon" ? { category: "Expense", subCategory: "Personal" } : {}), fmtDate: (d) => d.slice(8) + "/" + d.slice(5, 7), fmtMoney: (n) => "₹" + n };
  const done = { category: "Expense", subCategory: "Household", frequencyClass: "Irregular", purpose: "Personal" };
  const rows = [
    { id: 1, merchant: "Cook", date: "2026-09-03", description: "UPI/1/ COOK /x", amount: 5000, direction: "debit", ...done },
    { id: 2, merchant: "Cook", date: "2026-09-04", description: "UPI/2/ COOK /y", amount: 100, direction: "debit", category: "Expense", frequencyClass: "Irregular", purpose: "Personal" },
    { id: 3, merchant: "Amazon", date: "2026-09-05", description: "AMAZON", amount: 900, direction: "debit" },
    { id: 4, merchant: "Salary", date: "2026-09-01", description: "SALARY", amount: 1e5, direction: "credit", ...done, category: "Income", subCategory: "Salary" },
    { id: 5, merchant: "Dividend", date: "2026-03-10", description: "DIVIDEND", amount: 1729, direction: "credit" },
  ];
  const cards = buildNeedsYouCards(rows, deps);
  t("a merchant with every row complete is not a card", () => assert(!cards.some((c) => c.key === "Salary")));
  t("a merchant with at least one incomplete row is a card, and only its incomplete rows count", () => { const c = cards.find((x) => x.key === "Cook"); assert.deepStrictEqual(c.txnIds, [2]); assert.deepStrictEqual(c.missingNow, ["subCategory"]); });
  t("what the merchant's other rows already say is filled in (Household for the cook)", () => assert.strictEqual(cards.find((x) => x.key === "Cook").base.subCategory, "Household"));
  t("the library's suggestion fills what nothing else knows", () => { const c = cards.find((x) => x.key === "Amazon"); assert.strictEqual(c.base.category, "Expense"); assert.strictEqual(c.base.subCategory, "Personal"); });
  t("amounts carry signs: money out is minus, money in is plus", () => { assert(/−₹900/.test(cards.find((x) => x.key === "Amazon").meta)); assert(/\+₹1729/.test(cards.find((x) => x.key === "Dividend").meta)); assert.strictEqual(cards.find((x) => x.key === "Dividend").samples[0].signed, "+₹1729"); });
  t("card count equals the number of merchants that have an incomplete row", () => assert.strictEqual(cards.length, new Set(rows.filter((r) => missing(r).length).map((r) => r.merchant)).size));
  console.log(pass + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
