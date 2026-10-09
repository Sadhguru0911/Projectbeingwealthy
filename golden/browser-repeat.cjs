// "Does this repeat?" on Review (backlog #130): asked for a large one-off payment, not for one already marked Recurring, and not counted as "needs you".

const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path");
(async () => {
  if (!process.env.NO_BUILD) execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }); const p = await ctx.newPage();
  let fail = 0; p.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 300)); });
  const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const txt = () => p.evaluate(() => document.body.innerText);
  const row = (id, date, d, amount, extra) => ({ id, date, description: d, amount, accountId: "acc1", direction: "debit", purpose: "Personal", importBatchId: "b1", category: "Expense", subCategory: "Household", control: "Flexible", frequencyClass: "One-Time", ...extra });
  const U = (n, who) => "UPI/70000000000" + n + "/ " + who + " /x@oksbi /SBIN0001/ 1/PAY/ 70000000000" + n + "/";
  const months = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const txns = months.map((m, i) => row("s" + i, m + "-05", U(i, "GROCER"), 800, { merchant: "GROCER", frequencyClass: "Irregular" }));
  txns.push(row("fee", "2026-04-20", U(21, "SCHOOL FEES"), 60000, { merchant: "SCHOOL FEES" }));
  txns.push(row("ins", "2026-05-20", U(22, "CAR INSURANCE"), 42000, { merchant: "CAR INSURANCE", frequencyClass: "Recurring", frequency: "Annual" }));
  const data = { accounts: [{ id: "acc1", institution: "Bank", nickname: "Bank", type: "bank", uploadHistory: [] }], transactions: txns, rules: [],
    merchantAliases: [{ id: "g1", canonical: "Shops", type: "category", variants: ["GROCER"] }, { id: "g2", canonical: "Education", type: "category", variants: ["SCHOOL FEES"] }, { id: "g3", canonical: "Insurance", type: "category", variants: ["CAR INSURANCE"] }],
    budgets: {}, cashBuffer: 0, holdingSnapshots: [], goals: [], debtSchedules: [], otherInvestments: [] };
  await ctx.addInitScript((d) => { if (localStorage.getItem("seeded")) return; localStorage.setItem("seeded", "1");
    localStorage.setItem("being-wealthy:appData", JSON.stringify(d)); localStorage.setItem("being-wealthy:experience", JSON.stringify("new")); localStorage.setItem("being-wealthy:hasSeenTutorial", "true"); }, data);
  await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(2500);
  await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  let t = await txt();
  ok("Home does not say anything needs the person (a repeat question is not 'needs you')", !/Finish sorting/.test(t), (/Finish sorting[^\n]*/.exec(t) || [])[0]);
  await p.click('button:has-text("Review")'); await p.waitForTimeout(800);
  t = await txt();
  ok("Review offers the one payment that might repeat (the school fee, not the insurance already marked Recurring)", !!(await p.$('[data-testid="repeat-check"]')) && /1 large payment might repeat/.test(t), (/\d+ large payment[^\n]*/.exec(t) || [])[0]);
  await p.click('[data-testid="repeat-check"]'); await p.waitForTimeout(600);
  const card = await p.textContent(".qcard");
  ok("the card asks 'Does this repeat?' about the school fee", /Does this repeat\?/.test(card) && /SCHOOL FEES/i.test(card) && !/INSURANCE/i.test(card), card.slice(0, 160));
  await p.click('.qcard button.chip:has-text("One-off")'); await p.waitForTimeout(1500);
  await p.reload(); await p.waitForTimeout(2500); await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  await p.click('button:has-text("Review")'); await p.waitForTimeout(800);
  ok("once answered it is not asked again", !(await p.$('[data-testid="repeat-check"]')));
  await b.close(); console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED"); process.exit(fail ? 1 : 0);
})();
