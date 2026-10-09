// Next steps (backlog #127-#130): another bank account is noticed from own-account transfers, the button opens the add-a-statement screen with the reason, Snooze hides it.

const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path");
(async () => {
  if (!process.env.NO_BUILD) execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }); const p = await ctx.newPage();
  let fail = 0; p.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 300)); });
  const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const txt = () => p.evaluate(() => document.body.innerText);
  const row = (id, date, d, amount, extra) => ({ id, date, description: d, amount, accountId: "acc1", direction: "debit", purpose: "Personal", importBatchId: "b1", frequencyClass: "Irregular", ...extra });
  const T = (id, date) => row(id, date, "NEFT SELF TRANSFER TO RAMESH KUMAR " + id, 20000, { merchant: "RAMESH KUMAR", category: "Transfer", subCategory: "Self", frequencyClass: "Recurring", frequency: "Monthly" });
  const E = (id, date) => row(id, date, "UPI/1/SHOP " + id + "/x", 500, { merchant: "SHOP", category: "Expense", subCategory: "Personal", control: "Flexible" });
  const data = { accounts: [{ id: "acc1", institution: "Bank", nickname: "Bank", type: "bank", uploadHistory: [] }],
    transactions: [T("t1", "2026-06-10"), T("t2", "2026-07-10"), T("t3", "2026-08-10"), E("e1", "2026-06-05"), E("e2", "2026-07-05"), E("e3", "2026-08-05"), E("e4", "2026-09-05")],
    rules: [], merchantAliases: [{ id: "g", canonical: "Shops", type: "category", variants: ["SHOP"] }], budgets: {}, cashBuffer: 0, holdingSnapshots: [], goals: [], debtSchedules: [], otherInvestments: [] };
  await ctx.addInitScript((d) => { if (localStorage.getItem("seeded")) return; localStorage.setItem("seeded", "1");
    localStorage.setItem("being-wealthy:appData", JSON.stringify(d)); localStorage.setItem("being-wealthy:experience", JSON.stringify("new")); localStorage.setItem("being-wealthy:hasSeenTutorial", "true"); }, data);
  await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(2500);
  await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  let t = await txt();
  ok("Home's Next steps is one card, 'Want to make the picture richer?', with a row for the bank account", /Want to make the picture richer\?/.test(t) && /Bank accounts/.test(t) && /3 transfers to accounts that look like yours/.test(t));
  const hasDismiss = await p.evaluate(() => { const c = [...document.querySelectorAll(".hv2-card")].find((x) => x.innerText.includes("richer")); return !!c && c.innerText.includes("Dismiss"); });
  ok("it has one button and only Snooze (no Dismiss)", (await p.$$('button:has-text("Add another account")')).length === 1 && !!(await p.$('button:has-text("Snooze")')) && !hasDismiss);
  await p.click('button:has-text("Add another account")'); await p.waitForTimeout(800);
  t = await txt();
  ok("the button opens the add-a-statement screen (not the Upload tab) and says why", /Drop a statement here/.test(t) && !!(await p.$('[data-testid="statement-why"]')) && /Bank accounts: /.test(t));
  ok("no profile questions are asked while adding another account", !/While I read this/.test(t));
  // a statement whose running balance breaks is flagged with a banner the person can overrule
  const fs = require("fs"), os = require("os");
  const good = fs.readFileSync(path.join(__dirname, "fixtures-live-statement.csv"), "utf8").split("\n");
  const broken = path.join(os.tmpdir(), "broken-statement.csv"); fs.writeFileSync(broken, [good[0], good[1], ...good.slice(3)].join("\n"));
  let chooser = p.waitForEvent("filechooser"); await p.click('button:has-text("Choose a file")'); (await chooser).setFiles(broken);
  await p.waitForSelector('[data-testid="unreconciled"]', { timeout: 10000 }).catch(() => {});
  t = await txt();
  ok("a statement that does not add up shows a banner that stays, with both choices", !!(await p.$('[data-testid="unreconciled"]')) && /doesn.t add up/.test(t) && /Check the file/.test(t) && !!(await p.$('[data-testid="continue-anyway"]')));
  ok("nothing was imported while it waits", !(await p.evaluate(() => (JSON.parse(localStorage.getItem("being-wealthy:appData")).transactions || []).some((x) => /ACMEWORKS/.test(x.description)))));
  await p.click('[data-testid="continue-anyway"]'); await p.waitForTimeout(2500);
  t = await txt();
  ok("Continue anyway moves on (the banner is gone; this test person is on the free plan, so the one-bank-account limit answers next)", !(await p.$('[data-testid="unreconciled"]')) && /account limit is reached|Where you stand/.test(t), t.slice(-300));
  await p.reload(); await p.waitForTimeout(2500); await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  await p.click('button:has-text("Snooze")'); await p.waitForTimeout(2500);
  ok("Snooze hides the step", !/Want to make the picture richer/.test(await txt()));
  await p.reload(); await p.waitForTimeout(2500); await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  ok("after a reload it is still snoozed", !/Want to make the picture richer/.test(await txt()));
  await b.close(); console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED"); process.exit(fail ? 1 : 0);
})();
