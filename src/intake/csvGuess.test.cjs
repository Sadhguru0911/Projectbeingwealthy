const assert = require("assert");
(async () => {
  const { balancesFromList, looksLikeCard } = await import("./csvGuess.js");
  let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok  :", name); };
  t("balances from an ascending file", () => { const l = [{ date: "2026-01-01", amount: 100, direction: "debit" }, { date: "2026-01-02", amount: 50, direction: "credit" }, { date: "2026-01-03", amount: 30, direction: "debit" }]; const b = balancesFromList(l, [900, 950, 920]); assert.deepStrictEqual(b, { opening: 1000, closing: 920, trusted: true, breaks: 0, seen: 2 }); });
  t("balances from a newest-first file", () => { const l = [{ date: "2026-01-03", amount: 30, direction: "debit" }, { date: "2026-01-02", amount: 50, direction: "credit" }, { date: "2026-01-01", amount: 100, direction: "debit" }]; const b = balancesFromList(l, [920, 950, 900]); assert.deepStrictEqual(b, { opening: 1000, closing: 920, trusted: true, breaks: 0, seen: 2 }); });
  t("a broken balance chain is not trusted", () => { const l = [{ date: "2026-01-01", amount: 100, direction: "debit" }, { date: "2026-01-02", amount: 50, direction: "credit" }, { date: "2026-01-03", amount: 30, direction: "debit" }]; assert.strictEqual(balancesFromList(l, [900, 5000, 920]).trusted, false); });
  t("no balance column gives null", () => assert.strictEqual(balancesFromList([{ date: "2026-01-01", amount: 1, direction: "debit" }], [null]), null));
  t("card statement text is recognised", () => assert.ok(looksLikeCard(["Date", "Description", "Amount"], "Credit Card Statement  Minimum Amount Due")));
  console.log("\n" + n + " passed");
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
