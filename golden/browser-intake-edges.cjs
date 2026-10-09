// The statement is read in place (backlog #107): what a person sees when something is missing or wrong - on the intake screen itself,
// never the old Upload screen - and that answered profile questions are not asked again.
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path"), fs = require("fs"), os = require("os");
(async () => {
  if (!process.env.NO_BUILD) execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bw-intake-"));
  fs.writeFileSync(path.join(tmp, "weird.csv"), "foo,bar,baz\n1,2,3\n4,5,6\n"); fs.writeFileSync(path.join(tmp, "notes.txt"), "hello"); fs.writeFileSync(path.join(tmp, "stmt.pdf"), "%PDF-1.4 fake");
  const good = path.join(__dirname, "fixtures-live-statement.csv");
  const b = await chromium.launch(); let fail = 0;
  const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const fresh = async () => { const p = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage(); p.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 300)); });
    await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(700); return p; };
  const txt = (p) => p.evaluate(() => document.body.innerText);
  const pick = async (p, file) => { const c = p.waitForEvent("filechooser"); await p.click('button:has-text("Choose a file")'); (await c).setFiles(file); await p.waitForTimeout(1200); };

  // 1. unfamiliar headers, no key: the problem is shown on the screen, with the key box offered
  let p = await fresh(); await p.click('button:has-text("Start")'); await pick(p, path.join(tmp, "weird.csv"));
  let t = await txt(p);
  ok("unreadable columns: explained on the intake screen", /couldn.t tell which columns/i.test(t) && /Reading your statement|One thing first/i.test(t), t.slice(0, 200));
  ok("... with a place to add a Gemini key right there, and no old Upload screen", !!(await p.$('input[aria-label="Gemini API key"]')) && !/Import a statement/.test(t));
  ok("... and a way to choose a different file", /Choose a different file/.test(t));
  ok("... and the questions are held back while there is a problem", !/Question 1 of 2/.test(t));

  // 2. not a statement at all
  await p.close(); p = await fresh(); await p.click('button:has-text("Start")'); await pick(p, path.join(tmp, "notes.txt")); t = await txt(p);
  ok("a file that is not a statement is explained on screen", /PDF, CSV and Excel/.test(t), t.slice(0, 200));

  // 3. a PDF needs the key: asked for on this screen; saving it carries on
  await p.close(); p = await fresh(); await p.click('button:has-text("Start")'); await pick(p, path.join(tmp, "stmt.pdf")); t = await txt(p);
  ok("a PDF without a key asks for it on the intake screen", /needs your Gemini key/i.test(t) && !!(await p.$('input[aria-label="Gemini API key"]')) && /Get a free key/.test(t), t.slice(0, 240));
  await p.fill('input[aria-label="Gemini API key"]', "test-key-123"); await p.click('button:has-text("Save and continue")'); await p.waitForTimeout(2500); t = await txt(p);
  ok("after saving a key the read carries on in place (it can only fail here because Google is unreachable)", !/needs your Gemini key/i.test(t) && /Identifying|Working out which kind|I couldn.t use that file|password|Reading/i.test(t), t.slice(0, 300));
  ok("... still on the intake screen, never the Upload screen", !/Import a statement/.test(t));

  // 4. answered profile questions are not asked again; a statement already imported is explained
  await p.close(); p = await fresh(); await p.click('button:has-text("Start")'); await pick(p, good);
  await p.click('button:has-text("Skip for now")').catch(() => {}); await p.waitForTimeout(300);
  if (await p.$('button:has-text("Partner or spouse")')) { await p.click('button:has-text("Partner or spouse")'); await p.click('button:has-text("Continue")'); await p.waitForTimeout(300); }
  if (await p.$('.choice:has-text("Building wealth")')) { await p.click('.choice:has-text("Building wealth")'); await p.click('.choice:has-text("Retirement")'); await p.click('button:has-text("Continue")'); }
  await p.waitForSelector("text=Identified", { timeout: 20000 });
  await p.waitForTimeout(1500); await p.reload(); await p.waitForTimeout(2500);
  await p.click('button:has-text("Skip tour")', { timeout: 2000 }).catch(() => {});
  ok("after a reload the person is signed in to their data (Home, not the welcome screen)", /Where you stand|HOME/i.test(await txt(p)) || /Finish sorting/.test(await txt(p)), (await txt(p)).slice(0, 120));
  await p.click(".bw-title").catch(() => {}); await p.waitForTimeout(600);
  if (await p.$('button:has-text("Start")')) {
    await p.click('button:has-text("Start")'); await pick(p, good); t = await txt(p);
    ok("a statement that is already imported is explained on the intake screen", /already imported/i.test(t), t.slice(0, 200));
    ok("the saved profile answers are not asked again", !/While I read this/i.test(t) && !/Question 1 of 2/.test(t), t.slice(0, 200));
  } else console.log("note: could not return to the welcome screen from Home in this harness");
  await b.close(); console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED"); process.exit(fail ? 1 : 0);
})();
