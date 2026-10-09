// Waiting for an account (backlog #131) and groups on rules (#133): the card remembers the account is not added yet, a matching account added later offers a one-tap link; a rule with a group puts new merchants in it.
// Seeds a person with two rules that file one merchant two ways.
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path");
(async () => {
  if (!process.env.NO_BUILD) execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }); const p = await ctx.newPage();
  let fail = 0; p.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 300)); });
  const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const txt = () => p.evaluate(() => document.body.innerText);
  const U = (n, who) => "UPI/80000000000" + n + "/ " + who + " /x@kotakpay /KKBK0001/ 1/PAY/ 80000000000" + n + "/";
  const base = { accountId: "acc1", direction: "debit", purpose: "Personal", importBatchId: "b1" };
  const data = { accounts: [{ id: "acc1", institution: "Bank", nickname: "Bank", type: "bank", uploadHistory: [] }],
    transactions: [
      { id: "s1", date: "2026-08-13", description: U(1, "SCAPIA"), amount: 20000, merchant: "SCAPIA", category: "Transfer", subCategory: "Debt Payment", frequencyClass: "Recurring", frequency: "Monthly", ...base },
      { id: "s2", date: "2026-09-13", description: U(2, "SCAPIA"), amount: 83074, merchant: "SCAPIA", category: "Transfer", subCategory: "Debt Payment", frequencyClass: "Recurring", frequency: "Monthly", ...base },
      { id: "w1", date: "2026-09-20", description: U(3, "THIRD WAVE CAFE"), amount: 450, merchant: "THIRD WAVE CAFE", category: "Expense", subCategory: "Personal", frequencyClass: "Irregular", control: "Flexible", ...base },
    ],
    rules: [{ id: "rw", pattern: "third wave", category: "Expense", subCategory: "Personal", frequencyClass: "Irregular", control: "Flexible", purpose: "Personal", group: "Eating out", source: "learned", priority: 1010 }],
    merchantAliases: [], budgets: {}, cashBuffer: 0, holdingSnapshots: [], goals: [], debtSchedules: [], otherInvestments: [] };
  await ctx.addInitScript((d) => { if (localStorage.getItem("seeded")) return; localStorage.setItem("seeded", "1");
    localStorage.setItem("being-wealthy:appData", JSON.stringify(d)); localStorage.setItem("being-wealthy:experience", JSON.stringify("new")); localStorage.setItem("being-wealthy:hasSeenTutorial", "true"); }, data);
  await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(2500);
  const saved = async () => p.evaluate(() => JSON.parse(localStorage.getItem("being-wealthy:appData")));
  await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  let s = await saved();
  ok("a merchant matched by a rule with a group joins that group, with no card", s.merchantAliases.some((g) => g.canonical === "Eating out" && g.variants.includes("THIRD WAVE CAFE")), s.merchantAliases);
  ok("Home has one merchant to finish (Scapia's account)", /Finish sorting 1 merchant\b/.test(await txt()));
  await p.click('button:has-text("Review")'); await p.waitForTimeout(700);
  await p.click('[data-field="linkedAccountId"] button:has-text("added yet")');
  await p.click(".qcard button.btn.teal"); await p.waitForTimeout(800);
  s = await saved();
  ok("the rows are marked as waiting for the account, by name", s.transactions.filter((t) => /^s/.test(t.id)).every((t) => t.noLinkedAccount && t.pendingAccountName === "SCAPIA" && !t.linkedAccountId));
  ok("the waiting note is kept in the knowledge store", (s.knowledgeStore.pending || []).length === 1 && s.knowledgeStore.pending[0].rowIds.length === 2, s.knowledgeStore.pending);
  await p.waitForTimeout(3500);
  ok("nothing is asked again; Home has nothing to finish", !/Finish sorting/.test(await txt()));
  // the person adds the account later
  await p.evaluate(() => { const d = JSON.parse(localStorage.getItem("being-wealthy:appData")); d.accounts.push({ id: "acc2", institution: "Federal Bank", nickname: "Scapia Federal Card", type: "creditCard", uploadHistory: [] }); localStorage.setItem("being-wealthy:appData", JSON.stringify(d)); });
  await p.reload(); await p.waitForTimeout(2500); await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  ok("no popup appears when an account is added", !(await p.$('[data-testid="link-offer"]')));
  ok("Home now has one merchant to finish: the waiting Scapia payments came back as a card", /Finish sorting 1 merchant\b/.test(await txt()));
  await p.click('button:has-text("Review")'); await p.waitForSelector("text=You added", { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(500);
  ok("the card says which account was added, with it pre-selected", /You added Scapia Federal Card/.test(await txt()) && (await p.getAttribute('[data-field="linkedAccountId"] .chip.sel', "aria-pressed")) === "true" && /Scapia Federal Card/.test(await p.textContent('[data-field="linkedAccountId"] .chip.sel')));
  await p.click(".qcard button.btn.teal"); await p.waitForTimeout(2000);
  s = await saved();
  ok("one tap links the payments to the new account and the note is gone", s.transactions.filter((t) => /^s/.test(t.id)).every((t) => t.linkedAccountId === "acc2" && !t.noLinkedAccount) && (s.knowledgeStore.pending || []).length === 0, s.knowledgeStore.pending);
  await b.close(); console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED"); process.exit(fail ? 1 : 0);
})();
