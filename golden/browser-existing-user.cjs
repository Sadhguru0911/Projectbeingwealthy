// An existing, onboarded person (backlog #123-#126): old rows heal from their own rules, UPI payees become one merchant, the starter rules are gone,
// rules that match nothing are found and repaired, and the cards and Review count come from one definition.
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path");
(async () => {
  if (!process.env.NO_BUILD) execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }); const p = await ctx.newPage();
  let fail = 0; p.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 300)); });
  const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const txt = () => p.evaluate(() => document.body.innerText);
  const D = {
    mamata: "UPI/624637571604/ MAMATA ADAK /MAMATHAADHOK@OKHDFCBANK /PUNB0059820/ 6928000100037376/COOK/ 624637571604/PUNBKAKDWIP/",
    sidda: "UPI/626488984634/ SIDDALINGAPPA /SHREYASHARSHA0488@YBL /SBIN0032295/ 00000040840530067/COOKING GAS CYLINDER/ 626488984634/SBIN SARJAPUR ROAD BAN",
    scapia1: "UPI/625600058739/ SCAPIA/SCAPIA.BDGP@KOTAKPAY /KKBK0JPUPIA/ 06410910000417/PAY/ 625600058739/",
    scapia2: "UPI/619466267562/ SCAPIA/SCAPIA.BDPG@KOTAKPAY /KKBK0JPUPIA/ 06410910000417/PAY/ 619466267562/",
    jagadish: "UPI/624627672100/ JAGADISH ./SHETTYJ937@OKSBI /SBIN0016212/ 00000032504043036/CAR WASH/ 624627672100/SBI KASAVANAHALLI BANG",
    amazon: "UPI-AMAZON PAY INDIA-amazon@apl-5551", swiggy: "UPI-SWIGGY-swiggy@icici-306995",
  };
  const base = { accountId: "acc1", direction: "debit", purpose: "Personal" };
  const row = (id, date, d, amount, extra) => ({ id, date, description: d, amount, importBatchId: "b1", merchant: "", ...base, ...extra });
  const data = {
    accounts: [{ id: "acc1", institution: "Standard Chartered Bank", nickname: "Standard Chartered Bank", type: "bank", uploadHistory: [] }],
    transactions: [
      row("t1", "2026-09-03", D.mamata, 5000, { merchant: "MAMATA ADAK MAMATHAADHOK", category: "Expense", subCategory: null, frequencyClass: "Irregular", control: "Flexible", matchedRuleId: "r_mamata" }), // imported while rules were ignored
      row("t2", "2026-09-21", D.sidda, 1100, { merchant: "SIDDALINGAPPA SHREYASHARSHA YBL", category: "Expense", subCategory: null, frequencyClass: "One-Time", matchedRuleId: "r_sidda" }),
      row("t3", "2026-07-13", D.scapia1, 83074, { merchant: "SCAPIA SCAPIA BDGP", category: "Transfer", subCategory: "Debt Payment", frequencyClass: "Recurring", frequency: "Monthly", matchedRuleId: "r_scapia" }),
      row("t4", "2026-08-13", D.scapia2, 20000, { merchant: "SCAPIA SCAPIA BDPG", category: "Transfer", subCategory: "Debt Payment", frequencyClass: "Recurring", frequency: "Monthly", matchedRuleId: "r_scapia" }),
      row("t5", "2026-09-03", D.jagadish, 400, { merchant: "JAGADISH SHETTYJ OKSBI", category: "Expense", subCategory: "Personal", frequencyClass: "Irregular", control: "Flexible" }), // edited by hand: no rule behind it
      row("t6", "2026-09-05", D.amazon, 900, { merchant: "AMAZON PAY INDIA" }),
      row("t7", "2026-09-06", D.swiggy, 300, { merchant: "Swiggy (food delivery)", category: "Expense", subCategory: "Personal", frequencyClass: "Irregular", control: "Flexible", matchedRuleId: "r_dead", merchantLocked: true }),
    ],
    rules: [
      { id: "s1", pattern: "amazon", category: "Expense", subCategory: null, tag: "Personal", frequencyClass: "Irregular", control: "Flexible", source: "system", priority: 6 },
      { id: "r_mamata", pattern: "upi mamata adak", category: "Expense", subCategory: "Household", frequencyClass: "Recurring", frequency: "Monthly", control: "Committed", purpose: "Personal", source: "learned", priority: 1015 },
      { id: "r_sidda", pattern: "upi siddalingappa shreyasharsha", category: "Expense", subCategory: "Household", frequencyClass: "Recurring", frequency: "Monthly", control: "Committed", purpose: "Personal", source: "learned", priority: 1031 },
      { id: "r_scapia", pattern: "upi scapia scapia", category: "Transfer", subCategory: "Debt Payment", frequencyClass: "Recurring", frequency: "Monthly", purpose: "Personal", source: "learned", priority: 1017 },
      { id: "r_jag", pattern: "upi jagadish shettyj", category: "Expense", subCategory: "Household", frequencyClass: "Recurring", frequency: "Monthly", control: "Committed", purpose: "Personal", source: "learned", priority: 1021 },
      { id: "r_dead", pattern: "swiggy (food delivery)", category: "Expense", subCategory: "Personal", frequencyClass: "Irregular", control: "Flexible", purpose: "Personal", source: "learned", priority: 1022 },
    ],
    merchantAliases: [{ id: "mg1", canonical: "Household help", type: "category", variants: ["MAMATA ADAK MAMATHAADHOK", "Other"] }],
    budgets: {}, cashBuffer: 0, holdingSnapshots: [], goals: [], debtSchedules: [], otherInvestments: [],
  };
  await ctx.addInitScript((d) => { if (localStorage.getItem("seeded")) return; localStorage.setItem("seeded", "1");
    localStorage.setItem("being-wealthy:appData", JSON.stringify(d)); localStorage.setItem("being-wealthy:experience", JSON.stringify("new")); localStorage.setItem("being-wealthy:hasSeenTutorial", "true"); }, data);
  await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(2500);
  const saved = async () => p.evaluate(() => JSON.parse(localStorage.getItem("being-wealthy:appData")));
  let s = await saved(); const T = (id) => s.transactions.find((t) => t.id === id);
  ok("the person lands on Home", !/Start with my money/.test(await txt()));
  ok("the starter rules are gone (only the person's own and learned rules remain)", !s.rules.some((r) => r.source === "system") && s.rules.length === 5, s.rules.map((r) => r.id));
  ok("rows imported while rules were ignored are healed from the person's rules (Household / Recurring / Monthly / Committed)", T("t1").subCategory === "Household" && T("t1").frequencyClass === "Recurring" && T("t1").frequency === "Monthly" && T("t1").control === "Committed" && T("t2").subCategory === "Household" && T("t2").control === "Committed", [T("t1"), T("t2")].map((t) => [t.subCategory, t.frequencyClass, t.frequency, t.control]));
  ok("a row edited by hand is left alone even though a rule says otherwise", T("t5").subCategory === "Personal", T("t5").subCategory);
  ok("UPI rows are identified by their payee (one Scapia, however the handle reads)", T("t3").merchant === T("t4").merchant && T("t3").merchant === "SCAPIA", [T("t3").merchant, T("t4").merchant]);
  ok("a merchant group follows the rename and keeps its other members", s.merchantAliases[0].variants.includes("MAMATA ADAK") && s.merchantAliases[0].variants.includes("Other"), s.merchantAliases[0].variants);
  // Cards and Review: one definition. Pending rows = 2 Scapia (no account link) + 1 Amazon (nothing known) -> 2 merchants.
  await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  const home = await txt(); const fin = /Finish sorting (\d+) merchants?/.exec(home);
  ok("Home says 5 merchants need the person (Scapia's account, and four merchants with no group yet)", !!fin && fin[1] === "5", fin && fin[0]);
  await p.click('button:has-text("Review")'); await p.waitForTimeout(700);
  ok("Review opens the same 5 cards", (await p.textContent(".qcount span")).includes("of 5"));
  const fieldsOf = async () => (await p.$$eval("[data-field]", (e) => e.map((x) => x.getAttribute("data-field")))).join(",");
  const name0 = await p.textContent(".mname"), f0 = await fieldsOf();
  ok("the Scapia card asks only for the account (everything else is known)", /Scapia/i.test(name0) && f0 === "linkedAccountId", [name0, f0]);
  ok("the account question offers 'an account I haven't added yet'", !!(await p.$('[data-field="linkedAccountId"] button:has-text("added yet")')));
  await p.click('[data-field="linkedAccountId"] button:has-text("added yet")');
  ok("asking what the account is called, filled in with the merchant", (await p.inputValue('[data-testid="pending-account-name"]').catch(() => "")) === "SCAPIA");
  await p.click(".qcard button.btn.teal"); await p.waitForTimeout(600);
  s = await saved();
  ok("saying there is no such account is remembered, so it is not asked again", T("t3").noLinkedAccount === true && T("t4").noLinkedAccount === true && !T("t3").linkedAccountId, [T("t3"), T("t4")].map((t) => t.noLinkedAccount));
  const seen = [];
  for (let g = 0; g < 5 && (await p.$(".qcard")); g++) { const n = await p.textContent(".mname"); const f = await fieldsOf(); seen.push(n + " :: " + f);
    if (/Jagadish|CAR WASH/i.test(n)) { ok("a merchant with no group is asked for its group (Jagadish is now one card by his remark, CAR WASH)", /group/.test(f), f); await p.click('[data-field="group"] button[data-testid="new-group"]'); await p.fill('[data-testid="new-group-input"]', "Gifts"); await p.click('[data-field="group"] button:has-text("Add")'); await p.click(".qcard button.btn.teal"); await p.waitForTimeout(500); break; }
    await p.click(".qcard .qbtns .link").catch(() => {}); await p.waitForTimeout(450); }
  s = await saved();
  ok("a new group made on the card is saved with the merchant in it", s.merchantAliases.some((g) => g.canonical === "Gifts" && g.variants.some((v) => /JAGADISH/i.test(v))), s.merchantAliases.map((g) => g.canonical));
  ok("the group is remembered on the rule too", s.rules.some((r) => r.group === "Gifts"), s.rules.map((r) => r.id + ":" + r.group));
  ok("no merchant is put in 'Other'/'Others' by default", !s.merchantAliases.some((g) => /^others?$/i.test(g.canonical) && g.variants.some((v) => /SCAPIA|SIDDA|AMAZON|SWIGGY/i.test(v))), s.merchantAliases.map((g) => g.canonical));
  console.log("SEEN", JSON.stringify(seen)); const asked = seen;
    await p.keyboard.press("Escape"); if (await p.$(".qcard")) await p.click(".onb-root .back").catch(() => {});
  await p.waitForTimeout(300);
  // Rules tab: counts and dead rules
  await p.click('button:has-text("Rules")'); await p.waitForTimeout(700);
  let rt = await txt();
  ok("the Rules tab shows a Transactions column and lists the dead rule below", /Transactions/i.test(rt) && !!(await p.$('[data-testid="dead-rules"]')) && /Rules that match no transaction \(1\)/i.test(rt), rt.slice(0, 300));
  const peek = await p.textContent('[data-dead-rule="r_dead"]');
  ok("the dead rule shows the proposed pattern and the transaction it was made for before anything is applied", /swiggy \(food delivery\)/.test(peek) && /→ swiggy/.test(peek) && /UPI-SWIGGY/.test(peek), peek.slice(0, 200));
  await p.click('[data-testid="dead-rules"] button:has-text("Apply")'); await p.waitForTimeout(600);
  rt = await txt(); s = await saved();
  ok("Repair rebuilds the dead rule from the transaction it was made for, and it now matches", !(await p.$('[data-testid="dead-rules"]')) && s.rules.some((r) => r.id === "r_dead" && /swiggy/.test(r.pattern) && !/\(/.test(r.pattern)), s.rules.find((r) => r.id === "r_dead"));
  await b.close(); console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED"); process.exit(fail ? 1 : 0);
})();
