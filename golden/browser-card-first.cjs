// Any statement is accepted as the first one (backlog #113): a credit-card CSV is read in place, filed as a card account, and continues into the journey.
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path");
(async () => {
  if (!process.env.NO_BUILD) execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
  let fail = 0; p.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 300)); });
  const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const txt = () => p.evaluate(() => document.body.innerText);
  await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(800);
  await p.click('button:has-text("Start")'); await p.waitForTimeout(500);
  const chooser = p.waitForEvent("filechooser"); await p.click('button:has-text("Choose a file")');
  await (await chooser).setFiles(path.join(__dirname, "fixtures-live-card.csv"));
  await p.waitForSelector("text=While I read this", { timeout: 8000 }).catch(async () => { console.log("SCREEN:", (await txt()).slice(0, 600)); process.exit(1); });
  await p.waitForTimeout(2500);
  let t = await txt();
  ok("a card statement is not declined", !/Start with a bank account statement|looks like a credit card statement/.test(t), t.slice(0, 300));
  ok("it is saved (49 transactions)", /Saved 49 transactions/.test(t), t.slice(0, 400));
  const acc = await p.evaluate(() => { try { return Object.keys(localStorage).map((k) => k + "=" + (localStorage.getItem(k) || "").slice(0, 0)).join(","); } catch (e) { return ""; } });
  const types = await p.evaluate(() => { const out = []; for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); const a = v && (v.accounts || (Array.isArray(v) ? v : null)); if (Array.isArray(a)) a.forEach((x) => x && x.type && out.push(x.type)); } catch (e) {} } return out; });
  ok("filed as a credit card account", types.includes("creditCard"), { types, acc });
  if (await p.$('button:has-text("Partner or spouse")')) { await p.click('button:has-text("Partner or spouse")'); await p.click('button:has-text("Continue")'); await p.waitForTimeout(300); }
  if (await p.$('button:has-text("Building wealth")')) { await p.click('.choice:has-text("Building wealth")'); await p.click('button:has-text("Continue")'); await p.waitForTimeout(500); }
  await p.waitForSelector("text=Identified", { timeout: 25000 });
  t = await txt(); console.log("READING:", t.slice(0, 300).replace(/\n/g, " | "));
  ok("the journey starts on the card's own rows", /Identified/.test(t) && !/Asha/.test(t));
  await b.close(); console.log(fail ? "FAILED " + fail : "ALL OK"); process.exit(fail ? 1 : 0);
})();
