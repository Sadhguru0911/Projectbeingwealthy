// Waiting cards come back one at a time when an account is added (backlog #131): name match first, "not this account" brings the next, all no => they keep waiting.
// Seeds a person with two rules that file one merchant two ways.
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path");
(async () => {
  if (!process.env.NO_BUILD) execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }); const p = await ctx.newPage();
  let fail = 0; p.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 300)); });
  const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const txt = () => p.evaluate(() => document.body.innerText);
  const U = (n, who) => "UPI/90000000000" + n + "/ " + who + " /x@kotakpay /KKBK0001/ 1/PAY/ 90000000000" + n + "/";
  const base = { accountId: "acc1", direction: "debit", purpose: "Personal", importBatchId: "b1", category: "Transfer", subCategory: "Debt Payment", frequencyClass: "Recurring", frequency: "Monthly", noLinkedAccount: true };
  const rows = [
    { id: "s1", date: "2026-09-13", description: U(1, "SCAPIA"), amount: 83074, merchant: "SCAPIA", pendingAccountName: "SCAPIA", ...base },
    { id: "c1", date: "2026-09-14", description: U(2, "CRED"), amount: 5000, merchant: "CRED", pendingAccountName: "CRED", ...base }];
  const data = { accounts: [{ id: "acc1", institution: "Bank", nickname: "Bank", type: "bank", uploadHistory: [] }, { id: "acc2", institution: "HDFC", nickname: "HDFC Millennia", type: "creditCard", uploadHistory: [] }],
    transactions: rows, rules: [], merchantAliases: [], budgets: {}, cashBuffer: 0, holdingSnapshots: [], goals: [], debtSchedules: [], otherInvestments: [],
    knowledgeStore: { schemaVersion: 1, items: {}, pending: [
      { key: "scapia", name: "SCAPIA", rowIds: ["s1"], declined: ["acc1"], baseline: true }, { key: "cred", name: "CRED", rowIds: ["c1"], declined: ["acc1"], baseline: true }] } };
  await ctx.addInitScript((d) => { if (localStorage.getItem("seeded")) return; localStorage.setItem("seeded", "1");
    localStorage.setItem("being-wealthy:appData", JSON.stringify(d)); localStorage.setItem("being-wealthy:experience", JSON.stringify("new")); localStorage.setItem("being-wealthy:hasSeenTutorial", "true"); }, data);
  await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(2500);
  const saved = async () => p.evaluate(() => JSON.parse(localStorage.getItem("being-wealthy:appData")));
  await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  ok("HDFC Millennia was added after the notes: one card is asked, not two", /Finish sorting 1 merchant\b/.test(await txt()));
  await p.click('button:has-text("Review")'); await p.waitForTimeout(800);
  const first = await p.textContent(".mname");
  ok("the first card is a waiting merchant, with the new account pre-selected", /SCAPIA|CRED/.test(first) && /You added HDFC Millennia/.test(await txt()), first);
  await p.click('[data-field="linkedAccountId"] button:has-text("Not this account")'); await p.click(".qcard button.btn.teal"); await p.waitForTimeout(1500);
  await p.click("body"); await p.waitForTimeout(500);
  ok("Home still has one to finish: the next waiting merchant is now the one asked", /Finish sorting 1 merchant\b/.test(await txt()));
  await p.click('button:has-text("Review")'); await p.waitForTimeout(800);
  ok("it is the other waiting merchant, with the same account", !!(await p.$(".qcard")) && (await p.textContent(".mname")) !== first && /You added HDFC Millennia/.test(await txt()), await p.textContent(".mname").catch(() => ""));
  await p.click('[data-field="linkedAccountId"] button:has-text("Not this account")'); await p.click(".qcard button.btn.teal"); await p.waitForTimeout(1500);
  await p.waitForTimeout(1500);
  const s = await saved();
  ok("when every card said no they keep waiting (nothing linked, notes kept)", s.transactions.every((t) => !t.linkedAccountId && t.noLinkedAccount) && (s.knowledgeStore.pending || []).length === 2 && s.knowledgeStore.pending.every((n) => n.declined.includes("acc2")), s.knowledgeStore.pending);
  await p.reload(); await p.waitForTimeout(2500); await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  ok("and nothing is asked until another account is added", !/Finish sorting/.test(await txt()));
  await b.close(); console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED"); process.exit(fail ? 1 : 0);
})();
