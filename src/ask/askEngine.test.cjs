/** Tests for askEngine.js. Run: node src/ask/askEngine.test.cjs */
(async () => {
  const A = await import("./askEngine.js");
  let pass = 0, fail = 0;
  const check = (l, a, e) => { const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : (fail++, console.log("FAIL:", l, "\n  expected:", JSON.stringify(e), "\n  actual:  ", JSON.stringify(a))); };
  // a tiny hand-checkable world: 3 months (Jul-Sep 2026), asOf 2026-09-28, a 10-day projection
  const days = [];
  const bal = [100, 100, 90, 90, 40, 40, 40, 140, 140, 130].map((x) => x * 1000);
  for (let i = 0; i < 10; i++) days.push({ date: "2026-10-" + String(i + 1).padStart(2, "0"), balance: bal[i], events: [] });
  const events = [
    { date: "2026-10-03", amount: -10000, name: "Rent", source: "recurring" },
    { date: "2026-10-05", amount: -50000, name: "School <Fee>", source: "recurring" },
    { date: "2026-10-08", amount: 100000, name: "Salary", source: "recurring" },
  ];
  const tx = (id, date, merchant, amount, extra = {}) => ({ id, accountId: "acc_bank", date, merchant, description: merchant, amount: Math.abs(amount), direction: amount < 0 ? "debit" : "credit", category: amount < 0 ? "Expense" : "Income", ...extra });
  const transactions = [
    tx("1", "2026-07-02", "Zomato", -1000), tx("2", "2026-08-02", "Zomato", -2000), tx("3", "2026-09-02", "Zomato", -3000),
    tx("4", "2026-09-03", "Rent", -10000), tx("5", "2026-09-04", "Salary", 100000), tx("6", "2026-09-05", "SIP", -5000, { category: "Investment" }),
    tx("7", "2026-09-06", "Zepto", -500),
  ];
  const f = { asOf: "2026-09-28", cash: 100000, cushion: 50000, months: 3, firstMonth: "2026-07", lastMonth: "2026-09", lastTxnDate: "2026-09-06",
    projection: { dailyStates: days, projectedMinimumCash: 40000, projectedMinimumCashDate: "2026-10-05", events },
    commitments: [{ name: "Rent", category: "Expense", lastAmount: 10000, pattern: { expectedDay: 3 } }, { name: "Salary", category: "Income", lastAmount: 100000 }, { name: "SIP", category: "Investment", lastAmount: 5000 }],
    transactions, accounts: [{ id: "acc_bank", type: "bank" }], goal: null, invested: 0 };

  check("fmtDay", A.fmtDay("2026-11-30"), "30 Nov");
  check("fmtK lakh / thousand", [A.fmtK(250000), A.fmtK(8000)], ["₹2.5L", "₹8K"]);
  check("suggestions, 3 months, no card/goal", A.suggestions(f), ["afford", "income", "lowest", "spendly", "where"]);
  check("suggestions, 1 month", A.suggestions({ ...f, months: 1 }), ["where", "bills", "spendly"]);
  check("suggestions never offer a forecast question without a projection", A.suggestions({ ...f, projection: null }).filter((x) => ["afford", "income", "lowest"].includes(x)), []);
  check("card suggestion only when a card account exists", A.suggestions({ ...f, accounts: [{ id: "c", type: "creditCard" }] }).includes("card"), true);
  check("goal suggestion needs goal AND investments", [A.suggestions({ ...f, goal: { target: 1 } }).includes("goal"), A.suggestions({ ...f, goal: { target: 1 }, invested: 5 }).includes("goal")], [false, true]);

  const lo = A.ASKS.lowest.build(f);
  check("lowest: a", lo.a, "Your cash is lowest on 5 Oct, at ₹40,000.");
  check("lowest: income named after the low", lo.b.includes("8 Oct"), true);
  check("lowest: biggest outflow first, escaped", lo.why[1], "School &lt;Fee&gt; ₹50,000 around 5 Oct.");
  const af = A.ASKS.afford.build(f);   // asOf is 28 Sep, so "next month" starts 1 Oct: every day of the world is after it
  check("afford: purchase date is the 1st of next month", af.b.includes("around 1 Oct"), true);
  check("afford: lowest 40,000 minus 1,00,000 = -60,000, shown with a minus sign", af.b.includes("from \u20B940,000 to \u2212\u20B960,000"), true);
  const inc = A.ASKS.income.build(f);
  check("income: 20% of the one salary event, from 8 Oct on", inc.b.includes("₹20,000 less each month") && inc.b.includes("from ₹40,000 to ₹40,000"), true);
  const wh = A.ASKS.where.build(f);
  check("where: Sept spending excludes SIP and income", wh.a, "₹13,500 went out in Sep.");
  check("where: investing reported separately", wh.b.includes("₹5,000"), true);
  const whg = A.ASKS.where.build({ ...f, aliases: [{ id: "g1", canonical: "Eating Out", type: "category", variants: ["Zomato", "Zepto"] }] });
  check("where: merchants in one group are one line (Zomato + Zepto -> Eating Out)", whg.why.includes("Eating Out ₹3,500"), true);
  const bl = A.ASKS.bills.build(f);
  check("bills: income is not a bill", bl.why.length, 2);
  check("bills: timing text", bl.why[0], "Rent · ₹10,000 · around the 3rd");
  // free text
  const pq = (t) => A.parseQuestion(f, t);
  check("parse: no category -> null", pq("what is the weather"), null);
  check("parse: category without a period", pq("how much did I spend on eating out").period, null);
  check("parse: last month = idx 11", pq("how much did I spend on groceries last month").period.from, 11);
  check("parse: last year = calendar 2025 (with the assumption stated)", [pq("how much did I spend on eating out last year").period.label, pq("how much did I spend on eating out last year").assumption], ["calendar 2025", "I took “last year” to mean calendar 2025."]);
  check("parse: last 3 months", pq("how much did I spend on eating out in the last 3 months").period, { from: 9, to: 11, label: "the last 3 months" });
  const html = (t) => A.msgHTML(f, A.messageFor(f, t, true));
  check("spend: full period adds Jul-Sep", html("how much did I spend on eating out in the last 3 months").includes("You spent ₹6,000 on eating out in the last 3 months."), true);
  check("spend: last month only Sep", html("how much did I spend on eating out last month").includes("₹3,000"), true);
  check("spend: a year ago -> says it has no such data and shows what it has", html("how much did I spend on eating out last year").includes("I don’t have that period yet."), true);
  check("spend: 12 months is partial (3 of 12)", html("how much did I spend on eating out in the last 12 months").includes("3 of the 12 months"), true);
  check("unsupported question is answered honestly, never invented", html("what is the weather").includes("I’d answer that from your numbers"), true);
  check("clarifier offers four periods", (html("how much did I spend on eating out").match(/data-fu=/g) || []).length, 4);
  // structure
  const full = A.msgHTML(f, A.messageFor(f, "lowest"));
  check("answer has the prototype's sections in order", ["Based on", "How I know", "What I don’t know", "What would change this", "What was sent to the AI"].map((s) => full.indexOf(s)).every((x, i, a) => x > -1 && (i === 0 || x > a[i - 1])), true);
  check("core pack carries real numbers only", A.corePack(f).forecast, { horizon_days: 10, lowest_point: 40000, lowest_date: "5 Oct" });
  check("typed question is escaped in the thread", A.msgHTML(f, A.messageFor(f, "<b>hi</b>", true)).includes("&lt;b&gt;hi"), true);
  console.log(`${pass}/${pass + fail} passed.`); process.exit(fail ? 1 : 0);
})();
