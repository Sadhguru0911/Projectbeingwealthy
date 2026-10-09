// Merchant groups (0.5.1.0): chips with a count and a cross; removing a merchant works and a rule does not put it back.
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path");
(async () => {
  if (!process.env.NO_BUILD) execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 } }); const p = await ctx.newPage();
  let fail = 0; p.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 300)); });
  const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const txt = () => p.evaluate(() => document.body.innerText);
  const full = { accountId: "acc1", direction: "debit", purpose: "Personal", category: "Expense", subCategory: "Personal", frequencyClass: "Irregular", control: "Flexible", importBatchId: "b1" };
  const T = (id, m, d) => ({ id, date: "2026-09-" + String(10 + id).padStart(2, "0"), description: d, amount: 100 + id, merchant: m, ...full });
  const data = { accounts: [{ id: "acc1", institution: "Bank", nickname: "Bank", type: "bank", uploadHistory: [] }],
    transactions: [T(1, "GOOGLE PLAY", "UPI/282259412281/ GOOGLE PLAY /PLAYSTORE@AXISBANK /UTIB0000553/ 1/MANDATE/ 282259412281/"), T(2, "Google Play", "UPI/282259412282/ GOOGLE PLAY /PLAYSTORE@AXISBANK /UTIB0000553/ 1/MANDATE/ 282259412282/"), T(3, "GOOGLE CLOUD", "UPI/282259412283/ GOOGLE CLOUD /GOOGLECLOUD@AXISBANK /UTIB0000553/ 1/MANDATE/ 282259412283/"), T(4, "Google Cloud Utib", "UPI/282259412284/ GOOGLE CLOUD /GOOGLECLOUD@AXISBANK /UTIB0000553/ 1/MANDATE/ 282259412284/"),
      T(5, "Indian Oil (IOCL)", "UPI/282259412285/ INDIAN OIL /IOCL@YBL /YESB0000001/ 1/FUEL/ 282259412285/"), T(6, "UPI INDIAN OIL", "UPI/282259412286/ INDIAN OIL CORPORATION /LPG@YBL /YESB0000001/ 1/GAS/ 282259412286/")],
    rules: [{ id: "rg", pattern: "google play", category: "Expense", subCategory: "Personal", frequencyClass: "Irregular", control: "Flexible", purpose: "Personal", group: "Tech", source: "learned", priority: 1011 }],
    merchantAliases: [{ id: "g1", canonical: "Tech", type: "category", variants: ["GOOGLE PLAY", "Google Play", "GOOGLE CLOUD", "Google Cloud Utib"] }, { id: "g2", canonical: "Fuel", type: "category", variants: ["Indian Oil (IOCL)"] }, { id: "g3", canonical: "Cooking Gas", type: "category", variants: ["UPI INDIAN OIL"] }],
    budgets: {}, cashBuffer: 0, holdingSnapshots: [], goals: [], debtSchedules: [], otherInvestments: [] };
  data.transactions[0].matchedRuleId = "rg"; data.transactions[1].matchedRuleId = "rg";
  await ctx.addInitScript((d) => { if (localStorage.getItem("seeded")) return; localStorage.setItem("seeded", "1");
    localStorage.setItem("being-wealthy:appData", JSON.stringify(d)); localStorage.setItem("being-wealthy:experience", JSON.stringify("new")); localStorage.setItem("being-wealthy:hasSeenTutorial", "true"); }, data);
  await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(2500);
  const saved = async () => p.evaluate(() => JSON.parse(localStorage.getItem("being-wealthy:appData")));
  await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  await p.click('text=Finish later', { timeout: 1500 }).catch(() => {});
  await p.click('button:has-text("Rules")'); await p.waitForTimeout(500);
  await p.click('button:has-text("Merchant groups")'); await p.waitForTimeout(600);
  const chips = (await p.$$('[data-testid="group-chip"]')).length;
  ok("every merchant is one chip with a cross (4 in Tech, 1 in Fuel, 1 in Cooking Gas)", chips === 6, chips);
  const t0 = await txt();
  ok("each chip shows how many transactions carry it (the library-style names carry none)", /GOOGLE PLAY\s*\u00B7 2/.test(t0) && /Google Play\s*\u00B7 0/.test(t0) && /Indian Oil \(IOCL\)\s*\u00B7 0/.test(t0));
  ok("no tidy list and no spellings line", !(await p.$('[data-testid="group-tidy"]')) && !/spellings:/.test(t0));
  // remove one merchant: the group stays and a rule does not put it back
  await p.click('[data-testid="remove-variant"] >> nth=1'); await p.waitForTimeout(800); // "Google Play", which no transaction carries
  let s = await saved();
  let tech = s.merchantAliases.find((x) => x.canonical === "Tech");
  ok("removing a merchant keeps the group and the others", tech && tech.variants.join() === "GOOGLE PLAY,GOOGLE CLOUD,Google Cloud Utib", tech && tech.variants);
  await p.click('[data-testid="remove-variant"] >> nth=0'); await p.waitForTimeout(800); // "GOOGLE PLAY", which the rule named
  s = await saved(); tech = s.merchantAliases.find((x) => x.canonical === "Tech");
  ok("the rule that named the group forgets it so it is not put back", !s.rules.find((r) => r.id === "rg").group && tech.variants.join() === "GOOGLE CLOUD,Google Cloud Utib", [s.rules[0].group, tech.variants]);
  await p.waitForTimeout(2500); await p.reload(); await p.waitForTimeout(2500); await p.click('button:has-text("Skip tour")', { timeout: 1500 }).catch(() => {});
  s = await saved(); ok("after a reload it is still out", !s.merchantAliases.find((x) => x.canonical === "Tech").variants.some((v) => /play/i.test(v)), s.merchantAliases[0].variants);
  // removing the last merchant takes the group with it; Delete group removes a whole group
  await p.click('button:has-text("Rules")'); await p.waitForTimeout(500); await p.click('button:has-text("Merchant groups")'); await p.waitForTimeout(500);
  ok("each group has a visible Delete group button", /Delete group/.test(await txt()) && (await p.$$('[data-testid="delete-group"]')).length >= 1);
  await p.click('[data-testid="group-chip"]:has-text("UPI INDIAN OIL") >> [data-testid="remove-variant"]'); await p.waitForTimeout(600);
  s = await saved(); ok("removing the last merchant of a group removes the group", !s.merchantAliases.some((x) => x.canonical === "Cooking Gas"), s.merchantAliases.map((x) => x.canonical));
  await p.click('[data-testid="delete-group"] >> nth=0'); await p.waitForTimeout(600);
  s = await saved(); ok("Delete group removes the whole group", s.merchantAliases.length === 0 || !s.merchantAliases.some((x) => x.canonical === "Tech"), s.merchantAliases.map((x) => x.canonical));
  await b.close(); console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED"); process.exit(fail ? 1 : 0);
})();
