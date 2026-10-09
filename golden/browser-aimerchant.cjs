// Backlog #158: the PDF read also asks Gemini for a merchant name per row. It is stored beside the row as aiMerchant, for comparison only;
// the app's own merchant key, rules and groups are untouched. Gemini is mocked here (no network).
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path"), fs = require("fs");
(async () => {
  if (!process.env.NO_BUILD) execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const pdf = process.env.TEST_PDF || "/tmp/cmp/stmt.pdf";
  const b = await chromium.launch(); let fail = 0; const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const p = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage(); p.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 150)); });
  const bodies = [];
  await p.route("**/generativelanguage.googleapis.com/**", async (route) => {
    const body = route.request().postData() || ""; bodies.push(body);
    const out = /CLASSIFICATION step/.test(body) ? { documentCategory: "bank_statement", institution: "Test Bank", confidence: "high", reasoning: "headers" }
      : { openingBalance: 10000, closingBalance: 10500, statementPeriodStart: "2026-09-01", statementPeriodEnd: "2026-09-30", statementInstitution: "Test Bank", isComplete: true, rows: [
        { date: "2026-09-02", description: "UPI/111111111111/ FIROJA BEGUM /X@IBL/RAPIDO", amount: 500, direction: "debit", runningBalance: 9500, aiMerchant: "Firoja Begum", counterpartyType: "person" },
        { date: "2026-09-05", description: "NACH CR IW: 2026MA COAL INDIA LTD", amount: 1000, direction: "credit", runningBalance: 10500, aiMerchant: "Coal India Ltd", counterpartyType: "merchant" }] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: "STOP" }] }) });
  });
  await p.addInitScript(() => { window.__BW_FAKE_PDF = { numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 40, height: 40 }), render: () => ({ promise: Promise.resolve() }), getTextContent: async () => ({ items: [] }) }) }; });
  await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(700);
  await p.click('button:has-text("Start")'); const c = p.waitForEvent("filechooser"); await p.click('button:has-text("Choose a file")'); (await c).setFiles(pdf); await p.waitForTimeout(1500);
  await p.fill('input[aria-label="Gemini API key"]', "test-key-123"); await p.click('button:has-text("Save and continue")');
  await p.waitForFunction(() => /Question 1 of|You added|imported/i.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(3000);
  ok("the request asks for aiMerchant", bodies.some((x) => /aiMerchant/.test(x) && /Attached are/.test(x)), bodies.length);
  const saved = await p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  const all = JSON.stringify(saved);
  ok("aiMerchant stored beside the row", /aiMerchant\\?":\\?"Firoja Begum/.test(all) && /aiMerchant\\?":\\?"Coal India Ltd/.test(all), all.slice(0, 200));
  ok("a new user's rows are keyed by the AI name (legal suffix dropped)", /aiKey\\?":\\?"COAL INDIA\\?"/.test(all) && /aiKey\\?":\\?"FIROJA BEGUM\\?"/.test(all), all.match(/aiKey[^,]*/g));
  ok("... marked as read under the AI rule, and the display name is the AI name", /aiRegime\\?":true/.test(all) && /"merchant\\?":\\?"Coal India/.test(all) && !/Iw Ma Coal/.test(all), (all.match(/"merchant\\?":\\?"[^"\\]*/g) || []).slice(0, 4));
  ok("person / merchant flag stored", /counterpartyType\\?":\\?"person/.test(all) && /counterpartyType\\?":\\?"merchant/.test(all));
  // An existing user (rows held that were not read under the AI rule): the AI name is the display name only; keys, rules and groups are left alone.
  const ctx2 = await b.newContext({ viewport: { width: 1100, height: 900 } }); const p2 = await ctx2.newPage(); p2.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 150)); });
  await p2.route("**/generativelanguage.googleapis.com/**", async (route) => {
    const body = route.request().postData() || "";
    const out = /CLASSIFICATION step/.test(body) ? { documentCategory: "bank_statement", institution: "Bank", confidence: "high", reasoning: "headers" }
      : { openingBalance: 10000, closingBalance: 11000, statementPeriodStart: "2026-09-01", statementPeriodEnd: "2026-09-30", statementInstitution: "Bank", isComplete: true, rows: [
        { date: "2026-09-05", description: "NACH CR IW: 2026MA COAL INDIA LTD", amount: 1000, direction: "credit", runningBalance: 11000, aiMerchant: "Coal India Ltd", counterpartyType: "merchant" }] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: "STOP" }] }) });
  });
  const row = (id, date, d, amount, extra) => ({ id, date, description: d, amount, accountId: "acc1", direction: "debit", purpose: "Personal", importBatchId: "b1", frequencyClass: "Irregular", ...extra });
  const Tr = (id, date) => row(id, date, "NEFT SELF TRANSFER TO RAMESH KUMAR " + id, 20000, { merchant: "RAMESH KUMAR", category: "Transfer", subCategory: "Self", frequencyClass: "Recurring", frequency: "Monthly" });
  const Ex = (id, date) => row(id, date, "UPI/1/SHOP " + id + "/x", 500, { merchant: "SHOP", category: "Expense", subCategory: "Personal", control: "Flexible" });
  const data = { accounts: [{ id: "acc1", institution: "Bank", nickname: "Bank", type: "bank", uploadHistory: [] }],
    transactions: [Tr("t1", "2026-06-10"), Tr("t2", "2026-07-10"), Tr("t3", "2026-08-10"), Ex("e1", "2026-06-05"), Ex("e2", "2026-07-05"), Ex("e3", "2026-08-05"), Ex("e4", "2026-09-05")],
    rules: [], merchantAliases: [{ id: "g", canonical: "Shops", type: "category", variants: ["SHOP"] }], budgets: {}, cashBuffer: 0, holdingSnapshots: [], goals: [], debtSchedules: [], otherInvestments: [] };
  await ctx2.addInitScript((d) => { window.__BW_FAKE_PDF = { numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 40, height: 40 }), render: () => ({ promise: Promise.resolve() }), getTextContent: async () => ({ items: [] }) }) };
    if (localStorage.getItem("seeded")) return; localStorage.setItem("seeded", "1"); localStorage.setItem("being-wealthy:appData", JSON.stringify(d)); localStorage.setItem("being-wealthy:experience", JSON.stringify("new")); localStorage.setItem("being-wealthy:hasSeenTutorial", "true"); }, data);
  await p2.goto("file://" + path.join(__dirname, "appharness/index.html")); await p2.waitForTimeout(2500);
  await p2.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  await p2.click('button:has-text("Add another account")').catch(() => {}); await p2.waitForTimeout(800);
  const c2 = p2.waitForEvent("filechooser"); await p2.click('button:has-text("Choose a file")'); (await c2).setFiles(pdf); await p2.waitForTimeout(1500);
  if (await p2.$('input[aria-label="Gemini API key"]')) { await p2.fill('input[aria-label="Gemini API key"]', "test-key-123"); await p2.click('button:has-text("Save and continue")'); }
  await p2.waitForTimeout(8000);
  if (process.env.DBG) console.log((await p2.evaluate(() => document.body.innerText)).slice(0, 700));
  const s2 = JSON.parse(await p2.evaluate(() => localStorage.getItem("being-wealthy:appData"))); const nt = s2.transactions.find((x) => /COAL INDIA/.test(x.description));
  ok("existing user: the new row is imported with the AI name recorded", !!nt && nt.aiMerchant === "Coal India Ltd", nt);
  ok("... but it is NOT keyed by the AI name (existing keys, rules and groups are left alone)", !!nt && !nt.aiKey && !nt.aiRegime && !/^Coal India$/.test(nt.merchant), nt && nt.merchant);
  await p2.goto("file://" + path.join(__dirname, "appharness/index.html")); await p2.waitForTimeout(2000);
  await p2.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {}); await p2.click('button:has-text("Review")'); await p2.waitForTimeout(1500);
  await p2.click('button:has-text("Open the full Review table instead")', { timeout: 3000 }).catch(() => {}); await p2.waitForTimeout(800);
  await p2.click('button:has-text("By transaction")', { timeout: 3000 }).catch(() => {}); await p2.waitForTimeout(800);
  if (process.env.DBG) console.log((await p2.evaluate(() => document.body.innerText)).slice(560, 1800));
  const dn = await p2.$$eval('[data-testid="display-name"]', (e) => e.map((x) => x.textContent));
  ok("Review's transaction list shows the display name above the description", dn.some((x) => /Coal India Ltd/.test(x)), dn);
  await b.close(); console.log(fail ? "FAILED" : "ALL PASSED"); process.exit(fail ? 1 : 0);
})();
