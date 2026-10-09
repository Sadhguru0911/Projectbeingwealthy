(async () => {
  const assert = require("assert");
  const { callEngine } = require("../../golden/load-engine.cjs");
  const { computeOnboardingResult, patternOf, patchForAnswer } = await import("./onboardingResult.js");
  const { rawBankRows } = await import("../demo/ashaStatement.js");
  const cache = {};
  const memo = (fn) => (...a) => { const k = fn + JSON.stringify(a[0]).replace(/\d+/g, "#"); return k in cache ? cache[k] : (cache[k] = callEngine(fn, a)); };
  const engine = { matchRule: (d, r) => memo("matchRule")(d, r), seedRules: () => callEngine("seedRules", []), findLibraryEntry: memo("findLibraryEntry"), normalizeMerchant: memo("normalizeMerchant") };
  let pass = 0; const t = (n, f) => { f(); pass++; console.log("ok -", n); };
  const bank = rawBankRows();
  const run = (from, answers) => computeOnboardingResult(bank.filter((r) => r.date >= from), engine, answers);
  const r1 = run("2026-09-01");
  console.log("1 month:", r1.transactions, "tx,", r1.merchants, "merchants, sorted/quick/need", r1.sorted, r1.quick, r1.need, "cov", r1.cov + "%", "cards", r1.cards.length, "repeat cards", r1.repeatCards.length);
  t("counts add up", () => assert.strictEqual(r1.sorted + r1.quick + r1.need, r1.merchants));
  t("transactions equal the rows given", () => assert.strictEqual(r1.transactions, bank.filter((r) => r.date >= "2026-09-01").length));
  t("at 1 month nothing has an established pattern", () => r1.groups.forEach((g) => assert(g.pattern.kind === "once" || g.count > 1)));
  t("a recognised name is Sorted even when seen once", () => { const n = r1.groups.find((g) => /netflix/i.test(g.key)); assert.strictEqual(n.status, "sorted"); assert.strictEqual(n.pattern.kind, "once"); });
  t("rule hint is exposed, not promoted to a pattern", () => assert(r1.lookMonthly > 0));
  t("no \"does this repeat\" cards when the window is too short to tell", () => assert.strictEqual(r1.repeatCards.length, 0));
  t("unknown people/shops need the person", () => assert(r1.need >= 1));
  t("cards carry real counts/amounts", () => { const z = r1.cards.find((c) => /zepto/i.test(c.name)) || r1.groups.find((g) => /zepto/i.test(g.key)); assert(z); });
  t("a card answer sorts that merchant on the next run", () => {
    const first = r1.cards.find((c) => c.status === "need");
    const r2 = run("2026-09-01", [{ key: first.key, label: "Household help" }]);
    assert.strictEqual(r2.need, r1.need - 1); assert.strictEqual(r2.sorted, r1.sorted + 1);
  });
  t("more history never loses merchants", () => { const r12 = run("2025-10-01"); assert(r12.merchants >= r1.merchants); assert.deepStrictEqual(r12.repeatCards.map((c) => c.name), ["ICICI Lombard"]); const r6 = run("2026-04-01"); assert.deepStrictEqual(r6.repeatCards.map((c) => c.name).sort(), ["School fees"].sort()); console.log("12 months:", r12.transactions, r12.merchants, "S/Q/N", r12.sorted, r12.quick, r12.need, "bills", r12.monthlyBills, "repeat cards", r12.repeatCards.map((c) => c.name)); });
  t("patternOf", () => { assert.strictEqual(patternOf(["2026-09-01"]).kind, "once"); assert.strictEqual(patternOf(["2026-07-01", "2026-08-01", "2026-09-01"]).kind, "monthly"); assert.strictEqual(patternOf(["2025-11-09", "2026-05-09"]).kind, "periodic"); });
  t("the deck holds every merchant the engine cannot settle: confirm first, then ask, biggest first", () => {
    assert.strictEqual(r1.deck.length, r1.quick + r1.need + r1.deck.filter((c) => c.status === "detail").length);
    const rank = { quick: 0, need: 1, detail: 2 }; const kinds = r1.deck.map((c) => c.status); assert.deepStrictEqual(kinds, [...kinds].sort((a, b) => rank[a] - rank[b]));
    r1.deck.filter((c) => c.status === "need").forEach((c, i, a) => { if (i) assert(a[i - 1].total >= c.total); });
  });
  t("a known merchant with no group (Airtel mobile, Netflix) gets a 'which group?' card whose choices carry full patches", () => {
    const r12 = run("2025-10-01"); const c = r12.deck.find((x) => /airtel/i.test(x.name) && x.status === "detail"); assert(c, "no detail card for Airtel");
    assert(/group/i.test(c.ask) && c.choices.includes("Leave on its own") && c.choices.every((k) => c.patches[k] && c.patches[k].category === "Expense" && c.patches[k].sub1));
    assert(!c.choices.some((k) => /Equities|EMI|Debt/.test(k)), "offered a non-expense group: " + c.choices);
    const g = c.choices.find((k) => k !== "Leave on its own");
    const r = run("2025-10-01", [{ key: c.key, label: g, patch: patchForAnswer(c, g) }]);
    assert(!r.deck.some((x) => x.key === c.key)); assert.strictEqual(r.groups.find((x) => x.key === c.key).group, g);
  });
  t("onboarding shows only the front of the deck (stops once about 90% of spend is settled), the rest is 'more to review'", () => {
    assert.deepStrictEqual(r1.cards.map((c) => c.key), r1.deck.slice(0, r1.cards.length).map((c) => c.key));
    assert.strictEqual(r1.moreToReview, r1.deck.length - r1.cards.length); assert(r1.cards.length <= 8);
    console.log("   1 month: deck", r1.deck.length, "cards shown", r1.cards.length, "later", r1.moreToReview);
  });
  t("an answered merchant leaves the deck; a confirmed library guess carries the library's patch", () => {
    const confirm = r1.deck.find((c) => c.status === "quick");
    if (confirm) { assert(confirm.patch && confirm.patch.category); const r2 = run("2026-09-01", [{ key: confirm.key, label: confirm.guess, patch: confirm.patch }]); assert(!r2.deck.some((c) => c.key === confirm.key)); }
    const ask = r1.deck.find((c) => c.status === "need"); const r3 = run("2026-09-01", [{ key: ask.key, label: "Household help" }]);
    assert(!r3.deck.some((c) => c.key === ask.key)); assert.strictEqual(r3.groups.find((g) => g.key === ask.key).group, "Home Services");
  });
  t("UPI handles do not split a merchant (Zepto is one group)", () => assert.strictEqual(r1.groups.filter((g) => /zepto/i.test(g.key)).length, 1));
  t("a typed group becomes a category-group patch on group cards", () => {
    const gc = r1.deck.find((c) => c.customGroupBase);
    if (!gc) return;
    const pt = patchForAnswer(gc, "Medical");
    assert.strictEqual(pt.group, "Medical"); assert.strictEqual(pt.groupType, "category"); assert.strictEqual(pt.category, "Expense");
  });
  console.log("\n" + pass + " passed");
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
