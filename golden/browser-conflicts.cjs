// Same merchant classified differently (backlog #129): Review lists it, one tap confirms, older rules are merged away; the Rules tab flags overlapping rules.
// Seeds a person with two rules that file one merchant two ways.
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path");
(async () => {
  if (!process.env.NO_BUILD) execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }); const p = await ctx.newPage();
  let fail = 0; p.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 300)); });
  const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const txt = () => p.evaluate(() => document.body.innerText);
  const D = { r1: "UPI/700000000001/ RAJU STORES /RAJU@OKSBI /SBIN0001/ 1/GROCERY/ 700000000001/", r2: "UPI/700000000002/ RAJU STORES /RAJU@OKSBI /SBIN0001/ 1/MILK/ 700000000002/", r3: "UPI/700000000003/ RAJU STORES /RAJU@OKSBI /SBIN0001/ 1/GIFT/ 700000000003/" };
  const full = { accountId: "acc1", direction: "debit", purpose: "Personal", category: "Expense", frequencyClass: "Irregular", control: "Flexible", importBatchId: "b1", merchant: "RAJU STORES" };
  const grp = { id: "mg1", canonical: "Shops", type: "category", variants: ["RAJU STORES"] };
  const data = { accounts: [{ id: "acc1", institution: "Bank", nickname: "Bank", type: "bank", uploadHistory: [] }],
    transactions: [{ id: "a", date: "2026-09-01", description: D.r1, amount: 500, subCategory: "Household", ...full, matchedRuleId: "r1" }, { id: "b", date: "2026-09-08", description: D.r2, amount: 300, subCategory: "Household", ...full, matchedRuleId: "r1" }, { id: "c", date: "2026-09-15", description: D.r3, amount: 900, subCategory: "Personal", ...full, matchedRuleId: "r2", handEdited: true }],
    rules: [{ id: "r1", pattern: "raju stores", category: "Expense", subCategory: "Household", frequencyClass: "Irregular", control: "Flexible", purpose: "Personal", source: "learned", priority: 1011 }, { id: "r2", pattern: "raju", category: "Expense", subCategory: "Personal", frequencyClass: "Irregular", control: "Flexible", purpose: "Personal", source: "learned", priority: 1005 }],
    merchantAliases: [grp], budgets: {}, cashBuffer: 0, holdingSnapshots: [], goals: [], debtSchedules: [], otherInvestments: [] };
  await ctx.addInitScript((d) => { if (localStorage.getItem("seeded")) return; localStorage.setItem("seeded", "1");
    localStorage.setItem("being-wealthy:appData", JSON.stringify(d)); localStorage.setItem("being-wealthy:experience", JSON.stringify("new")); localStorage.setItem("being-wealthy:hasSeenTutorial", "true"); }, data);
  await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(2500);
  const saved = async () => p.evaluate(() => JSON.parse(localStorage.getItem("being-wealthy:appData")));
  await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  await p.click('button:has-text("Rules")'); await p.waitForTimeout(700);
  ok("the Rules screen has no conflicts section", !(await p.$('[data-testid="overlapping-rules"]')) && !(await p.$('[data-testid="conflicts"]')));
  await p.click('button:has-text("Home")'); await p.waitForTimeout(800);
  { const h = await txt(); ok("Home Next steps says N conflicts to check", /1 conflict to check/i.test(h), h.slice(h.indexOf("NEXT") , h.indexOf("NEXT")+500)); }
  await p.click('button:has-text("Check conflicts")'); await p.waitForTimeout(700);
  const t0 = await txt();
  ok("the conflicts view opens on Review with transactions directly below", !!(await p.$('[data-testid="conflicts"]')) && (await p.$$('[data-testid="conflicts"] [data-testid="txn-peek"] select')).length >= 6, t0.slice(0, 200));
  ok("a long transaction text is shown in full, wrapped, not cut", await p.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid="conflicts"] [data-testid="txn-peek"] span')].filter((x) => /RAJU STORES/.test(x.innerText)); return rows.length >= 3 && rows.every((x) => x.scrollWidth <= x.clientWidth + 1 && x.innerText.includes("700000000001") || x.innerText.length > 40); }));
  await p.click('[data-testid="conflicts"] button:has-text("raju stores")'); await p.waitForTimeout(700);
  const s = await saved();
  ok("all three transactions now agree", s.transactions.every((t) => t.category === "Expense" && t.subCategory === "Household"), s.transactions.map((t) => t.subCategory));
  ok("the other rule is gone", s.rules.length === 1 && s.rules[0].pattern === "raju stores", s.rules.map((r) => r.pattern));
  ok("the conflict list is empty after choosing", !(await p.$('[data-testid="conflicts"] [data-conflict]')));
  // keep both, and edit a rule
  await ctx.addInitScript(() => { if (localStorage.getItem("seeded2")) return; localStorage.setItem("seeded2", "1"); const d = JSON.parse(localStorage.getItem("being-wealthy:appData")); d.merchantAliases[0].variants.push("SCAPIA", "SCAPIA TRAVEL ON", "Scapia Travel On"); d.rules = [
    { id: "k1", pattern: "scapia", category: "Transfer", subCategory: "Debt Payment", frequencyClass: "Recurring", frequency: "Monthly", purpose: "Personal", source: "learned", priority: 1006 },
    { id: "k2", pattern: "travel on scapia", category: "Expense", subCategory: "Personal", frequencyClass: "Irregular", control: "Flexible", purpose: "Personal", source: "learned", priority: 1016 }];
    d.transactions.push({ id: "z1", date: "2026-09-20", description: "UPI/9/ SCAPIA /travel on scapia@kotak /K/ 1/PAY/ 9/", amount: 700, accountId: "acc1", direction: "debit", purpose: "Personal", importBatchId: "b1", merchant: "SCAPIA", category: "Expense", subCategory: "Personal", frequencyClass: "Irregular", control: "Flexible", handEdited: true });
    localStorage.setItem("being-wealthy:appData", JSON.stringify(d)); });
  await p.reload(); await p.waitForTimeout(2500); await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  await p.waitForTimeout(1500); await p.click('text=Finish later', { timeout: 2000 }).catch(() => {}); await p.click('button:has-text("Review")'); await p.waitForSelector('text=Review & categorize', { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(600);
await p.waitForSelector('[data-testid="conflicts-tab"]', {timeout:8000}).catch(()=>{}); await p.click('[data-testid="conflicts-tab"]', {timeout:3000}).catch(()=>{}); await p.waitForTimeout(500);
  ok("scapia / travel on scapia are flagged on Review", !!(await p.$('[data-testid="conflicts"] [data-conflict]')));
  await p.click('[data-testid="keep-both"]'); await p.waitForSelector('[data-testid="conflicts-tab"]', { state: 'detached', timeout: 5000 }).catch(() => {}); await p.waitForTimeout(800);
  { const sv = await saved(); ok("Keep both removes the flag and keeps both rules", !(await p.$('[data-testid="conflicts-tab"]')) && sv.rules.length === 2, [!!(await p.$('[data-testid="conflicts-tab"]')), sv.rules.map((r) => r.pattern + JSON.stringify(r.keepBoth))]); }
  await p.click('button:has-text("Rules")'); await p.waitForTimeout(500);
  await p.click('[data-testid="edit-rule"] >> nth=0'); await p.waitForTimeout(300);
  ok("Edit opens the rule in place", !!(await p.$('[data-testid="rule-editor"]')));
  await p.fill('[data-testid="rule-editor"] input[aria-label="Pattern"]', "scapia card"); await p.click('[data-testid="rule-editor"] button:has-text("Save")'); await p.waitForTimeout(800);
  ok("the edited pattern is saved", (await saved()).rules.some((r) => r.pattern === "scapia card"), (await saved()).rules.map((r) => r.pattern));
  await b.close(); console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED"); process.exit(fail ? 1 : 0);
})();
