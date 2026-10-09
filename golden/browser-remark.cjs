// Backlog #165/#166: a UPI payment's remark is shown on the review card exactly as written; payments to different people with the SAME remark
// (words in any order) are ONE card; answering it makes a remark rule that sorts all of them; "Rapido" and "Communite Rapido" are different remarks;
// a typo or unknown remark suggests nothing but is shown.
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path");
(async () => {
  if (!process.env.NO_BUILD) execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const b = await chromium.launch(); let fail = 0; const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }); const p = await ctx.newPage(); p.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 150)); });
  const upi = (n, payee, remark) => `UPI/6000000000${n}/ ${payee} /X${n}@YBL /SBIN0000001/ 00000000${n}/${remark}/ 6000000000${n}/BRANCH/`;
  const row = (id, date, d, amount) => ({ id, date, description: d, amount, aiRegime: true, aiKey: d.split("/")[2].trim(), counterpartyType: "person", accountId: "acc1", direction: "debit", purpose: "Personal", importBatchId: "b1", merchant: "", category: null, subCategory: null });
  const data = { accounts: [{ id: "acc1", institution: "Bank", nickname: "Bank", type: "bank", uploadHistory: [] }],
    transactions: [
      row("t1", "2026-09-01", upi("11", "BASUDEV MALLIK", "RAPIDO COMMUNITE"), 120), row("t2", "2026-09-02", upi("12", "BASUDEV MALLIK", "COMMUNITE RAPIDO"), 140),
      row("t6", "2026-09-06", upi("16", "SECOND DRIVER", "RAPIDO COMMUNITE"), 160), row("t7", "2026-09-07", upi("17", "THIRD DRIVER", "Communite Rapido"), 180),
      row("t8", "2026-09-08", upi("18", "SOLO DRIVER", "RAPIDO"), 100),
      row("t3", "2026-09-03", upi("13", "TYPO PERSON", "RQPIDO COMMUNITE"), 90),
      row("t4", "2026-09-04", upi("14", "LALITHA KUMARI", "UNCLE DELIVERY COMMUNITE"), 200),
      row("t5", "2026-09-05", upi("15", "ESHA BANSAL", "FOOD"), 300),
    ], rules: [], merchantAliases: [], budgets: {}, cashBuffer: 0, holdingSnapshots: [], goals: [], debtSchedules: [], otherInvestments: [] };
  await ctx.addInitScript((d) => { if (localStorage.getItem("seeded")) return; localStorage.setItem("seeded", "1");
    localStorage.setItem("being-wealthy:appData", JSON.stringify(d)); localStorage.setItem("being-wealthy:experience", JSON.stringify("new")); localStorage.setItem("being-wealthy:hasSeenTutorial", "true"); }, data);
  await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(2500);
  await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  await p.click('button:has-text("Review")'); await p.waitForSelector(".qcard", { timeout: 8000 }).catch(() => {});
  const readCard = () => p.evaluate(() => ({ name: (document.querySelector(".qcard .mname") || {}).textContent, meta: (document.querySelector(".qcard .mmeta") || {}).textContent, remarks: [...document.querySelectorAll('[data-testid="card-remarks"] > div:not([data-testid="remark-hint"]) > b')].map((x) => x.textContent), hint: (document.querySelector('[data-testid="remark-hint"]') || {}).textContent || null }));
  const names = []; const cards = {};
  for (let i = 0; i < 8; i++) { const c = await readCard(); if (!c.name) break; names.push(c.name); cards[c.name] = c; const skip = await p.$('button:has-text("Not sure")'); if (!skip) break;
    if (/RAPIDO COMMUNITE|COMMUNITE RAPIDO/.test(c.name)) break; await skip.click(); await p.waitForTimeout(450); }
  const rc = Object.values(cards).find((c) => /^Remark: .*(RAPIDO COMMUNITE|COMMUNITE RAPIDO)$/i.test(c.name || ""));
  ok("the Rapido-Communite remark is ONE card for the different drivers, named by the remark", !!rc && !/basudev|driver/i.test(rc.name), names);
  ok("... it says how many payments and how many different payees", !!rc && /4 payments/.test(rc.meta) && /3 different payees/.test(rc.meta), rc && rc.meta);
  ok("... both word orders are shown as written", !!rc && rc.remarks.some((x) => x === "RAPIDO COMMUNITE") && rc.remarks.some((x) => /communite rapido/i.test(x)), rc && rc.remarks);
  ok("... and Transport is pointed to, to be confirmed", !!rc && /Transport/.test(rc.hint || ""), rc && rc.hint);
  // answer it: category, Sub Category 1, the suggested group, then whatever else is asked
  await p.click('[data-field="category"] .chip:has-text("Expense")'); await p.waitForTimeout(300);
  await p.click('[data-field="subCategory"] .chip:has-text("Personal")'); await p.waitForTimeout(300);
  await p.click('[data-field="group"] .chip[data-suggested="true"]'); await p.waitForTimeout(300);
  for (let k = 0; k < 6; k++) { const need = await p.$$eval("[data-field]", (e) => e.filter((x) => x.getAttribute("data-field") !== "linkedAccountId" && !x.querySelector(".chip.sel") && x.querySelector(".chip")).map((x) => x.getAttribute("data-field"))); if (!need.length) break; await p.click(`[data-field="${need[0]}"] .chip`); await p.waitForTimeout(250); }
  await p.click(".qcard button.btn.teal"); await p.waitForTimeout(1500);
  await p.waitForTimeout(2500);
  const s = JSON.parse(await p.evaluate(() => localStorage.getItem("being-wealthy:appData"))); const T = (id) => s.transactions.find((t) => t.id === id);
  const rr = s.rules.find((r) => r.scope === "remark");
  ok("a rule was made from the remark (not from a driver's name)", !!rr && rr.remarkKey === "COMMUNITE RAPIDO" && rr.group === "Transport" && rr.priority < 1000, rr);
  ok("all four payments, to three different people, are sorted by that one answer", ["t1", "t2", "t6", "t7"].every((id) => T(id).category === "Expense" && T(id).subCategory === "Personal" && T(id).matchedRuleId === rr.id), ["t1", "t2", "t6", "t7"].map((id) => [T(id).category, T(id).subCategory]));
  ok("'Rapido' on its own is a different remark: not sorted by that rule", !T("t8").category && T("t8").matchedRuleId !== rr.id, T("t8"));
  ok("the typo and the unknown remark are untouched", !T("t3").category && !T("t4").category, [T("t3").category, T("t4").category]);
  // the rest of the deck: shown remarks, hints
  await p.click('button:has-text("Review")').catch(() => {}); await p.waitForTimeout(800);
  const left = {}; for (let i = 0; i < 8; i++) { const c = await readCard(); if (!c.name) break; left[c.name] = c; const skip = await p.$('button:has-text("Not sure")'); if (!skip) break; await skip.click(); await p.waitForTimeout(450); }
  const L = (re) => Object.values(left).find((c) => re.test(c.name || ""));
  ok("'Rapido' alone is its own card", !!L(/^Remark: RAPIDO$/i), Object.keys(left));
  ok("typo remark: its own card, shown exactly as typed, nothing suggested", !!L(/RQPIDO COMMUNITE/) && !L(/RQPIDO COMMUNITE/).hint, L(/RQPIDO COMMUNITE/));
  ok("unknown remark: its own card, shown, nothing suggested", !!L(/UNCLE DELIVERY COMMUNITE/) && !L(/UNCLE DELIVERY COMMUNITE/).hint, L(/UNCLE DELIVERY COMMUNITE/));
  ok("food remark points to Eating Out", !!L(/^Remark: FOOD$/) && /Eating Out/.test(L(/^Remark: FOOD$/).hint || ""), L(/^Remark: FOOD$/));
  // the Rules tab names it plainly
  await p.click('button:has-text("Rules")'); await p.waitForTimeout(800);
  const rt = await p.evaluate(() => document.body.innerText);
  ok("the Rules tab shows it as a remark rule", /Remark:\s*(rapido communite|communite rapido)/i.test(rt), rt.slice(-400));
  await b.close(); console.log(fail ? "FAILED" : "ALL PASSED"); process.exit(fail ? 1 : 0);
})();
