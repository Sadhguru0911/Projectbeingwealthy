// A statement that does not reconcile is flagged in onboarding with a banner that stays; Continue anyway imports it (0.5.0.0).
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path"), fs = require("fs"), os = require("os");
(async () => {
  if (!process.env.NO_BUILD) execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }); const p = await ctx.newPage();
  let fail = 0; p.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 300)); });
  const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const txt = () => p.evaluate(() => document.body.innerText);
  const good = fs.readFileSync(path.join(__dirname, "fixtures-live-statement.csv"), "utf8").split("\n");
  const broken = path.join(os.tmpdir(), "broken-onb.csv"); fs.writeFileSync(broken, [good[0], good[1], ...good.slice(3)].join("\n"));
  await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(800);
  await p.click('button:has-text("Start")'); await p.waitForTimeout(500);
  const chooser = p.waitForEvent("filechooser"); await p.click('button:has-text("Choose a file")'); (await chooser).setFiles(broken);
  await p.waitForSelector('[data-testid="unreconciled"]', { timeout: 10000 }).catch(() => {});
  ok("onboarding shows the banner", !!(await p.$('[data-testid="unreconciled"]')) && /doesn.t add up/.test(await txt()));
  ok("it offers Check the file and Continue anyway", /Check the file/.test(await txt()) && !!(await p.$('[data-testid="continue-anyway"]')));
  ok("a short message appears too", /doesn.t add up\. Please check it/.test(await p.evaluate(() => document.querySelector(".onb-toast").innerText)));
  ok("nothing is imported while it waits", !(await p.evaluate(() => { const d = localStorage.getItem("being-wealthy:appData"); return d && (JSON.parse(d).transactions || []).length > 0; })));
  await p.click('[data-testid="continue-anyway"]'); await p.waitForSelector("text=Your statement is read", { timeout: 10000 }).catch(() => {});
  ok("Continue anyway imports and the journey goes on", /Your statement is read|Saved \d+ transactions/.test(await txt()));
  await b.close(); console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED"); process.exit(fail ? 1 : 0);
})();
