#!/usr/bin/env node
/** Real-browser check that the demo journey shows what the ENGINE computes from Asha's raw statement (backlog #79/#80):
 *  every figure on Sorted, every review card, and card answers feeding back, compared with an independent node
 *  run of the same engine. Run: node golden/browser-engine-journey.cjs */
const path = require("path"), fs = require("fs"), { execFileSync } = require("child_process");
const NM = "/home/claude/.npm-global/lib/node_modules";
const dir = path.join(__dirname, "browser");
const { callEngine } = require("./load-engine.cjs");
const E = require("./inproc-engine.cjs"); // the real App functions, in-process (forecast needs them)
(async () => {
  const { rawBankRows, ASHA_HISTORY_END } = await import("../src/demo/ashaStatement.js");
  const { computeOnboardingResult, stripHandle } = await import("../src/inference/onboardingResult.js");
  const rows = rawBankRows(), map = {}, norm = {};
  const rules = callEngine("seedRules", []);
  rows.forEach((r) => { const k = r.description.replace(/\d+/g, "#"); if (map[k]) return;
    map[k] = { rule: callEngine("matchRule", [r.description, rules]), lib: callEngine("findLibraryEntry", [r.description]) };
    const sd = stripHandle(r.description); norm[sd.replace(/\d+/g, "#")] = callEngine("normalizeMerchant", [sd]); });
  // The cash forecasts the Payoff / stepper will ask for, computed by the app's OWN forecast function (DEMO_JOURNEY_SOURCE.forecast).
  const FCS = {};
  [[3, "6m", "year"], [6, "6m", "year"], [12, "6m", "year"], [6, undefined, undefined], [6, "6m", undefined]].forEach(([h, f, i]) => { FCS[h + "|" + f + "|" + i] = E.demoJourneySource.forecast(h, f, i); });
  fs.writeFileSync(path.join(dir, "forecasts.js"), "window.__FORECASTS=" + JSON.stringify(FCS) + ";");
  fs.writeFileSync(path.join(dir, "engineMap.js"), "window.__ENGINE_MAP=" + JSON.stringify({ desc: map, norm }) + ";");
  const eng = { matchRule: (d) => map[d.replace(/\d+/g, "#")].rule, seedRules: () => rules, findLibraryEntry: (d) => map[d.replace(/\d+/g, "#")].lib, normalizeMerchant: (d) => norm[d.replace(/\d+/g, "#")] };
  const expect = computeOnboardingResult(rows.filter((r) => r.date >= "2026-09-01"), eng, []);
  execFileSync(path.join(NM, "tsx/node_modules/.bin/esbuild"), ["entry-engine.jsx", "--bundle", "--format=iife", "--platform=browser", "--jsx=automatic", "--define:process.env.NODE_ENV=\"production\"", "--outfile=bundle-engine.js", "--log-level=error"], { cwd: dir, env: { ...process.env, NODE_PATH: NM } });
  fs.writeFileSync(path.join(dir, "index-engine.html"), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="engineMap.js"></script><script src="forecasts.js"></script><script src="bundle-engine.js"></script></body></html>');
  const { chromium } = require(path.join(NM, "playwright"));
  let fail = 0; const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }); const pe = [];
  page.on("pageerror", (e) => { pe.push(e.message); console.log("PAGE ERROR:", e.message); });
  await page.goto("file://" + path.join(dir, "index-engine.html")); await page.waitForTimeout(400);
  await page.click('button:has-text("Read Asha")'); await page.waitForSelector("h2:has-text('organised')", { timeout: 15000 }); await page.waitForTimeout(1400);
  ok("legend shows the engine's sorted / quick / need", JSON.stringify(await page.$$eval(".legend .n", (e) => e.map((x) => x.textContent))) === JSON.stringify([String(expect.sorted), String(expect.quick), String(expect.need)]), expect);
  ok("hint shows the engine's merchants and transactions", (await page.textContent("p.hint")).includes(expect.merchants + " merchants") && (await page.textContent("p.hint")).includes(expect.transactions + " transactions"));
  ok("coverage is the engine's", (await page.textContent("p.muted")).includes(expect.cov + "% of your spending"));
  const label = expect.moreToReview > 0 ? "Review the " + expect.toReview + " that matter most" : "Review the " + expect.toReview + " that need you";
  ok("review button count equals the cards that will be shown", (await page.textContent("button.btn.big")) === label, label);
  await page.click("button.btn.big"); await page.waitForSelector(".qcard");
  const want = [...expect.cards, ...expect.repeatCards], names = [], metas = [];
  let answered = 0;
  for (let n = 0; n < want.length; n++) {
    names.push(await page.textContent(".mname")); metas.push(await page.textContent(".mmeta"));
    const hasGuess = await page.$(".guess");
    if (hasGuess) { await page.click('button:has-text("Looks right")'); answered++; }
    else if (n % 2 === 0) { await page.click(".chips .chip >> nth=0"); answered++; } else await page.click('button.link:has-text("Not sure")');
    await page.waitForTimeout(420);
  }
  ok("cards are the engine's, in order, with real names", JSON.stringify(names) === JSON.stringify(want.map((c) => c.name)), names);
  ok("card meta carries the real count, amount and date", JSON.stringify(metas) === JSON.stringify(want.map((c) => c.meta)), metas);
  ok("no invented merchants (Airtel/Blinkit script) unless in the statement", names.every((n) => expect.groups.some((g) => g.name === n)));
  // ---- Payoff: every number on it is read from the statement, and it ties (income - money out = net)
  await page.waitForSelector(".snap", { timeout: 8000 });
  const sep = rows.filter((r) => r.date >= "2026-09-01"), sumOf = (xs) => xs.reduce((a, r) => a + r.amount, 0);
  const inn = sumOf(sep.filter((r) => r.direction === "credit")), out = sumOf(sep.filter((r) => r.direction === "debit"));
  const inr = (n) => "\u20B9" + Math.round(n).toLocaleString("en-IN");
  const cells = await page.$$eval(".snap > div", (els) => els.map((e) => [e.querySelector(".v").textContent, e.querySelector(".l").textContent]));
  const cell = (label) => (cells.find((c) => c[1].startsWith(label)) || [])[0];
  ok("payoff income = the statement's credits", cell("Income") === inr(inn), cells);
  ok("payoff money out = the statement's debits", cell("Money out") === inr(out), cells);
  ok("payoff net ties: income minus money out (shown as a shortfall when negative)", cell(out > inn ? "More went out" : "Net cash") === inr(Math.abs(inn - out)), cells);
  ok("payoff transaction count = the statement's", cell("Transactions") === String(sep.length), cells);
  ok("the old scripted figures are gone (96,000 / 14,000 / 31,000)", !cells.some((c) => /96,000|14,000|31,000/.test(c[0])), cells);
  await page.click('button:has-text("See what I know")'); await page.waitForSelector("#stepbtn");
  const names1 = await page.$$eval(".ev .bill b", (e) => e.map((x) => x.textContent));
  ok("1 month: 'bills that repeat' rows are merchants in the statement", names1.length > 0 && names1.every((n) => expect.groups.some((g) => g.name === n)), names1);
  const stepTo = async (h) => { while ((await page.textContent(".histhead b")) !== h + " month" + (h > 1 ? "s" : "")) { await page.click("#stepbtn"); } await page.waitForTimeout(150); };
  await stepTo(3);
  const months3 = new Set(rows.filter((r) => r.date >= "2026-07-01").map((r) => r.date.slice(0, 7))).size;
  const in3 = sumOf(rows.filter((r) => r.date >= "2026-07-01" && r.direction === "credit")) / months3, out3 = sumOf(rows.filter((r) => r.date >= "2026-07-01" && r.direction === "debit")) / months3;
  const nm = await page.$$eval(".snap.three > div", (els) => els.map((e) => [e.querySelector(".v").textContent, e.querySelector(".l").textContent]));
  ok("3 months: a normal month's In / Out equal the statement's monthly averages", nm[0][0] === inr(in3) && nm[1][0] === inr(out3), nm);
  ok("3 months: the third figure is the real gap, labelled honestly", nm[2][0] === inr(Math.abs(in3 - out3)) && nm[2][1] === (in3 >= out3 ? "Left over" : "Short by"), nm);
  const lowcap = () => page.textContent(".lowcap b", { timeout: 4000 });
  const fcs = E.demoJourneySource ? JSON.parse(fs.readFileSync(path.join(dir, "forecasts.js"), "utf8").replace("window.__FORECASTS=", "").replace(/;$/, "")) : {};
  ok("3 months: lowest point equals the app's own forecast", (await lowcap()) === inr(Math.round(fcs["3|6m|year"].low)), await lowcap());
  await stepTo(6); ok("6 months: lowest point equals the app's forecast (school fee planned)", (await lowcap()) === inr(Math.round(fcs["6|6m|year"].low)), await lowcap());
  const note6 = await page.textContent(".newstrip");
  ok("6 months: the note quotes the real before / after lowest points", note6.includes(inr(Math.round(fcs["6|undefined|undefined"].low))) && note6.includes(inr(Math.round(fcs["6|6m|undefined"].low))), note6);
  await stepTo(12); ok("12 months: lowest point equals the app's forecast", (await lowcap()) === inr(Math.round(fcs["12|6m|year"].low)), await lowcap());
  const body12 = await page.textContent("#journey");
  ok("12 months: no invented '22% higher' festive claim for a statement without one", !body12.includes("22%"));
  ok("none of the prototype's scripted lowest points leak through", !/1,72,400|1,12,400|70,400/.test(await page.textContent("#journey")));
  ok("no page errors", pe.length === 0, pe);
  await browser.close();
  console.log(fail ? "\nFAILED " + fail : "\nALL PASSED"); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
