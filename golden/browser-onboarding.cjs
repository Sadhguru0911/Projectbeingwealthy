#!/usr/bin/env node
/**
 * Real-browser check of the onboarding + demo journey (backlog #70). Unlike every other check in this
 * project, this actually RENDERS the real OnboardingFlow component (bundled with real React, automatic
 * JSX runtime like Vite) in Chromium and clicks through it - the check that would have caught the
 * unstyled question cards, which no compile or stub-based check could see.
 * Run: node golden/browser-onboarding.cjs        (needs the globally installed playwright + react)
 * Fonts load from Google; in a sandbox with no network they fall back, which this check tolerates.
 */
const path = require("path"), { execFileSync } = require("child_process");
const NODE_MODULES = "/home/claude/.npm-global/lib/node_modules";
const dir = path.join(__dirname, "browser");
execFileSync(path.join(NODE_MODULES, "tsx/node_modules/.bin/esbuild"), ["entry.jsx", "--bundle", "--format=iife", "--platform=browser", "--jsx=automatic", "--define:process.env.NODE_ENV=\"production\"", "--loader:.js=jsx", "--outfile=bundle.js"], { cwd: dir, env: { ...process.env, NODE_PATH: NODE_MODULES }, stdio: "pipe" });
const { chromium } = require(path.join(NODE_MODULES, "playwright"));
let fail = 0; const ok = (label, cond, extra) => { if (!cond) { fail++; console.log("FAIL:", label, extra === undefined ? "" : JSON.stringify(extra)); } else console.log("ok  :", label); };
(async () => {
  const browser = await chromium.launch(); const url = "file://" + path.join(dir, "index.html");
  const errs = (p, a) => { p.on("pageerror", (e) => a.push(e.message)); };
  // ---- real path: welcome -> Q1 -> Q2 -> statement
  let page = await browser.newPage({ viewport: { width: 1100, height: 900 } }); let pe = []; errs(page, pe);
  await page.goto(url); await page.waitForTimeout(400);
  ok("welcome shows both paths", (await page.$$(".path")).length === 2);
  ok("welcome headline uses the prototype's curly apostrophe", (await page.textContent("h1 em")).includes("what\u2019s coming next"));
  await page.click('button:text-is("Start")'); await page.waitForSelector("h2:has-text('Add your bank statement')");
  ok("Start goes straight to the statement (the profile questions are asked while it is read)", (await page.$$("button.choice")).length === 0);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".onb-root")).backgroundColor);
  ok("paper background (not white) - the reported bug", bg === "rgb(236, 231, 218)", bg);
  const btnBg = await page.evaluate(() => getComputedStyle(document.querySelector("button.btn")).backgroundColor);
  ok("Choose a file button is styled (not a default grey button)", btnBg === "rgb(33, 38, 43)", btnBg);
  ok("statement has both expandable sections", (await page.$$(".onb-root details")).length === 2);
  ok("no prototype-only controls leaked into the product", (await page.$$(".protoctl")).length === 0 && !(await page.content()).includes("Restart prototype"));
  const chooser = page.waitForEvent("filechooser"); await page.click('button:has-text("Choose a file")'); const fc = await chooser;
  ok("Choose a file opens the system file picker on this screen (not the Upload view)", !!fc && !(await page.evaluate(() => !!window.__upload)));
  await fc.setFiles({ name: "apr-statement.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2") }); await page.waitForTimeout(300);
  ok("the chosen file is handed to the reader", await page.evaluate(() => window.__picked === "apr-statement.csv"), await page.evaluate(() => window.__picked));
  await page.goBack().catch(() => {}); await page.goto(url); await page.click('button:text-is("Start")'); await page.waitForSelector("h2:has-text('Add your bank statement')");
  const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(["a,b\n1,2"], "sept-statement.csv", { type: "text/csv" })); return d; });
  await page.dispatchEvent(".drop", "drop", { dataTransfer: dt }); await page.waitForTimeout(300);
  ok("a statement DROPPED on the zone is read too", await page.evaluate(() => window.__picked === "sept-statement.csv"), await page.evaluate(() => window.__picked));
  await page.goto(url); await page.click('button:text-is("Start")'); await page.waitForSelector("h2:has-text('Add your bank statement')");
  await page.click('button:has-text("No statement handy")'); ok("demo link hands off to the real demo entry", await page.evaluate(() => !!window.__demoClicked));
  ok("no page errors on the real path", pe.length === 0, pe); await page.close();
  // ---- demo path: Meet Asha -> reading -> sorted -> 6 cards -> finish
  page = await browser.newPage({ viewport: { width: 1100, height: 900 } }); pe = []; errs(page, pe);
  await page.goto(url + "?demo=1"); await page.waitForTimeout(400);
  ok("demo starts at Meet Asha", (await page.textContent("h2")) === "Meet Asha");
  ok("demo pill shown", (await page.textContent(".demopill")).includes("sample data, not yours"));
  await page.click('button:has-text("Read Asha")'); await page.waitForSelector("h2:has-text('organised')", { timeout: 15000 }); await page.waitForTimeout(1400);
  ok("sorted numbers match the prototype (19 / 8 / 4)", JSON.stringify(await page.$$eval(".legend .n", (e) => e.map((x) => x.textContent))) === '["19","8","4"]');
  ok("'Review the 12 that need you'", (await page.textContent("button.btn.big")) === "Review the 12 that need you");
  await page.click("button.btn.big"); await page.waitForSelector(".qcard");
  const names = [];
  for (let n = 0; n < 6; n++) {
    names.push(await page.textContent(".mname"));
    if (n < 4) await page.click('button:has-text("Looks right")'); else if (n === 4) await page.click('.chips .chip:has-text("Rent")'); else await page.click('button.link:has-text("Not sure")');
    await page.waitForTimeout(650);
  }
  ok("six review cards in the prototype's order", JSON.stringify(names) === JSON.stringify(["Zepto", "Blinkit", "Netflix", "Bangalore Electricity (BESCOM)", "UPI \u00B7 R Sharma", "Sri Krishna Sweets"]), names);
  // ---- payoff (Asha, 1 month)
  await page.waitForSelector("h2:has-text('where you stand')");
  await page.waitForTimeout(1500);
  ok("payoff cash counts up to the prototype's Rs 1,86,000", (await page.textContent("#cash")) === "\u20B91,86,000", await page.textContent("#cash"));
  const snap = await page.$$eval(".snap .v", (e) => e.map((x) => x.textContent));
  ok("payoff first-look snapshot numbers match the prototype", JSON.stringify(snap) === JSON.stringify(["\u20B91,10,000", "\u20B996,000", "\u20B914,000", "68", "5", "\u20B931,000"]), snap);
  ok("payoff shows the locked forecast at 1 month", (await page.textContent(".locked")).includes("unlocks with 3 months"));
  ok("payoff offers the bridge to the person's own money (demo only)", (await page.$$("#bridge1")).length === 1);
  // ---- next: what more history unlocks, with the stepper
  await page.click('button:has-text("See what I know so far")'); await page.waitForSelector("#journey"); await page.waitForTimeout(400);
  ok("next is the wide layout", await page.$eval(".wrap", (e) => e.classList.contains("wide")));
  ok("stepper starts at 1 month (September) with the prototype's button", (await page.textContent(".histhead")).includes("1 month") && (await page.textContent("#stepbtn")).includes("Asha adds August"));
  ok("ladder has 4 stages, first one current", (await page.$$eval(".lseg", (e) => e.length)) === 4 && (await page.$eval(".lseg.cur span", (e) => e.textContent)) === "Snapshot");
  await page.click(".lseg:nth-child(2)"); ok("tapping a stage opens its explanation", (await page.textContent("#stagebox")).includes("Usually around 2 months"));
  const lowAt = async () => { const t = await page.textContent("#journey"); const m = t.match(/Lowest point:\s*(\u20B9[\d,]+)/); return m ? m[1] : null; };
  const stops = [];
  for (const [btn, h] of [["Asha adds August", 2], ["Asha adds July", 3], ["Asha adds April to June", 6], ["Asha adds the six months before that", 12]]) {
    await page.click("#stepbtn"); await page.waitForTimeout(300);
    stops.push([h, (await page.textContent(".histhead")).match(/(\d+) month/)[1], await lowAt(), (await page.$eval(".lseg.cur span", (e) => e.textContent))]);
  }
  ok("stepper walks 2 -> 3 -> 6 -> 12 months", JSON.stringify(stops.map((x) => x[1])) === '["2","3","6","12"]', stops);
  ok("lowest point per stop follows the prototype's story (none, 1,72,400, 1,12,400, 70,400)", JSON.stringify(stops.map((x) => x[2])) === JSON.stringify([null, "\u20B91,72,400", "\u20B91,12,400", "\u20B970,400"]), stops.map((x) => x[2]));
  ok("ladder stage per stop (Emerging, Reliable, Reliable, Stronger)", JSON.stringify(stops.map((x) => x[3])) === JSON.stringify(["Emerging patterns", "Reliable patterns", "Reliable patterns", "Stronger forecasts"]), stops.map((x) => x[3]));
  ok("at 12 months the stepper says it is the fullest view", (await page.textContent(".histhead + .hist + .actions")).includes("full year"));
  await page.click("#resetH"); await page.waitForTimeout(300);
  ok("'Start Asha over at one month' resets", (await page.textContent(".histhead")).includes("1 month"));
  await page.click("#jump6"); await page.waitForTimeout(300);
  ok("'Jump to six months' works", (await page.textContent(".histhead")).includes("6 month"));
  await page.click("#addmonths"); ok("'Add more months' in the demo shows the prototype's toast (no upload)", (await page.textContent(".onb-toast")).includes("opens the upload screen") && !(await page.evaluate(() => !!window.__upload)));
  await page.click("#stepbtn"); await page.waitForTimeout(300);   // 6 -> 12
  await page.click('button:has-text("Your dashboard is ready")');
  const fin = await page.evaluate(() => window.__finished);
  ok("dashboard handoff carries months and Asha's answers", JSON.stringify(fin) === JSON.stringify({ demo: true, h: 12, feeAns: "6m", insAns: "year", answers: [] }), fin);
  await page.evaluate(() => { window.__exited = false; });
  await page.click("#bridge2").catch(() => {});
  ok("no page errors on the demo path", pe.length === 0, pe);
  await browser.close();
  console.log(fail === 0 ? "\nALL PASSED" : "\n" + fail + " FAILED"); process.exit(fail ? 1 : 0);
})();
