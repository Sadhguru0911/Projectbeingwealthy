// Real (own-statement) path through the REAL App in a browser (backlog #72): welcome -> questions -> upload a CSV statement ->
// reading -> sorted -> review cards -> payoff -> patterns -> Home -> deck/Review/Ask/Cash Flow, all from the person's own rows.
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path");
(async () => {
  if (!process.env.NO_BUILD) execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
  let fail = 0; p.on("pageerror", (e) => { fail++; console.log("PAGE ERROR:", e.message.slice(0, 300)); });
  const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const txt = () => p.evaluate(() => document.body.innerText);
  const inr = (x) => +String(x).replace(/[₹,\s]/g, "");
  await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(800);
  await p.click('button:has-text("Start")'); await p.waitForTimeout(500);
  ok("Start goes straight to adding the statement (no questions first)", /Add your bank statement/.test(await txt()) && !/Question 1 of 2/.test(await txt()));
  // "Choose a file" opens the system file picker on this very screen - it never opens the old upload screen
  const chooser = p.waitForEvent("filechooser"); await p.click('button:has-text("Choose a file")');
  const fc = await chooser; await fc.setFiles(path.join(__dirname, "fixtures-live-statement.csv"));
  await p.waitForSelector("text=While I read this", { timeout: 8000 });
  ok("the file is read on an onboarding screen, not the old Upload screen", !/Import a statement|Dashboard\s*\n\s*Cash Flow/.test(await txt()));
  ok("the two profile questions are asked while the statement is read", /While I read this/i.test(await txt()) && /Who.s part of your financial life/.test(await txt()));
  ok("progress shows the real steps taken (opened the file, found columns, saved N transactions)", /Opening fixtures-live-statement\.csv/.test(await txt()) && /Finding the date, description and amount columns/.test(await txt()) && /Saved 423 transactions/.test(await txt()), (await txt()).slice(0, 300));
  // answer Q1, then Q2 with FOUR picks: only three are allowed
  if (await p.$('button:has-text("Partner or spouse")')) { await p.click('button:has-text("Partner or spouse")'); await p.click('button:has-text("Continue")'); await p.waitForTimeout(300); }
  if (await p.$('button:has-text("Building wealth")')) {
    for (const l of ["Building financial security", "Building wealth", "Buying a home", "Retirement"]) await p.click('.choice:has-text("' + l + '")').catch(() => {});
    const pressed = await p.$$eval(".choice[aria-pressed=true]", (x) => x.length);
    ok("priorities allow at most 3 and show a counter", pressed === 3 && /3 of 3 chosen/.test(await txt()), pressed);
    await p.click('button:has-text("Continue")'); await p.waitForTimeout(500);
  }
  await p.waitForSelector("text=Identified", { timeout: 25000 }); await p.waitForTimeout(300);
  let t = await txt(); const readingText = t; console.log("READING:", t.slice(0, 300).replace(/\n/g, " | "));
  ok("the read statement opens the journey (reading screen), on the person's own rows", /Identified/.test(t), t.slice(0, 200));
  await p.waitForSelector("h2:has-text('organised')", { timeout: 15000 }); await p.waitForTimeout(1300);
  t = await txt(); console.log("SORTED:", t.slice(0, 500).replace(/\n/g, " | "));
  await p.click("button.btn.big"); await p.waitForSelector(".qcard");
  ok("Reading screen speaks about the person's own statement", !/Asha|Sample Bank|demo/i.test(readingText), readingText.slice(0, 160));
  // Answer the cards a person would (the first choice; "Looks right" on a guess)
  const asked = []; let guard = 0;
  while ((await p.$(".qcard")) && guard++ < 40) {
    const name = await p.textContent(".mname"); asked.push(name + " :: " + ((await p.$(".ask")) ? await p.textContent(".ask") : "guess"));
    if (await p.$(".guess")) await p.click('button:has-text("Looks right")'); else await p.click(".chips .chip >> nth=0");
    await p.waitForTimeout(430);
  }
  console.log("ASKED", asked);
  ok("review cards ran on the person's own merchants", asked.length >= 3, asked.length);
  ok("a CSV with a running Balance column is never asked for a balance", !(await p.$('input[aria-label="Closing balance"]')), null);
  await p.waitForSelector(".headline, .snap", { timeout: 15000 }); await p.waitForTimeout(1600);
  t = await txt(); console.log("PAYOFF:", t.slice(0, 900).replace(/\n/g, " | "));
  ok("payoff shows the person's own cash today (1,86,000), not a sample bank", /1,86,000/.test(t) && !/Sample Bank|Asha[’']s/.test(t), t.slice(0, 300));
  ok("payoff has a cash forecast with a lowest point (6 months of history)", /Lowest point/.test(t), null);
  await p.click('button:has-text("See what I know")'); await p.waitForTimeout(800);
  t = await txt(); console.log("NEXT:", t.slice(0, 1800).replace(/\n/g, " | "));
  ok("patterns screen is about the person's own history, no Asha script", !/Asha[’']s|Sample Bank/.test(t), (/.{40}(Asha[’']s|Sample Bank).{40}/.exec(t.replace(/\n/g, " ")) || [])[0]);
  ok("once-or-twice-a-year section comes from the engine and reflects the answer given on the card", /once or twice a year/i.test(t) && /School fees/.test(t) && /You told me/.test(t), null);
  await p.click('button:has-text("Your dashboard is ready")'); await p.waitForTimeout(2500);
  t = await txt();
  const home = /Finish sorting (\d+) merchants?/.exec(t);
  console.log("HOME has:", /Finish sorting/.test(t), /LOWEST POINT\s*\n\s*(₹[\d,]+)/.exec(t));
  ok("Home offers 'Finish sorting N merchants' for what the cards left", !!home, null);
  const homeLow = /LOWEST POINT\s*\n\s*(₹[\d,]+)/.exec(t); ok("Home shows a lowest point", !!homeLow);
  await p.click('button:has-text("Skip tour")', { timeout: 2000 }).catch(() => {}); await p.waitForTimeout(300);
  // Ask: generic launcher, and the same lowest point as Home
  await p.click('button:has-text("Ask about your money")'); await p.waitForTimeout(500);
  const launcher = await p.textContent(".askpanel"), launcherBody = await p.textContent(".askpanel .ab");
  ok("Ask opens as a generic launcher with canned questions", !/lowest|cushion/i.test(launcherBody) && (await p.$$(".askpanel .chip")).length >= 3, launcher.slice(0, 160));
  await p.click('button:has-text("When is my cash at its lowest")'); await p.waitForTimeout(500);
  const askLow = /at (₹[\d,]+)\./.exec(await txt()); ok("Ask's lowest point equals Home's", askLow && homeLow && inr(askLow[1]) === inr(homeLow[1]), [askLow && askLow[1], homeLow && homeLow[1]]);
  await p.click('button[aria-label="Close"], button:has-text("×")').catch(() => {}); await p.waitForTimeout(300);
  // Review opens the deck; the answered repeat card does not come back
  await p.click('button:has-text("Review")'); await p.waitForTimeout(700);
  const hasDeck = !!(await p.$(".qcard"));
  ok("Review opens the cards for what is still unsorted", hasDeck && (await p.textContent(".qcount span")).includes("of " + home[1]), home && home[1]);
  // Each card shows its real transactions with signs, and links to them in Review
  const sampleTxt = await p.textContent('[data-testid="card-samples"]').catch(() => ""); const cardName = await p.textContent(".mname");
  ok("a card shows the actual transactions underneath, each with a sign", /[\u2212+]₹[\d,]+/.test(sampleTxt) && /[\u2212+]₹/.test(await p.textContent(".mmeta")), sampleTxt.slice(0, 160));
  await p.click('button:has-text("in Review")'); await p.waitForTimeout(700);
  ok("'See in Review' opens Review's transaction table filtered to that merchant", (await p.inputValue('input[placeholder^="Search description"]')) === cardName && !(await p.$(".qcard")), cardName);
  await p.click('button:has-text("Review")'); await p.waitForTimeout(700);
  // Every card asks only what its rows still lack; answer each one the way a person would (first choice)
  const left = []; let g2 = 0;
  while ((await p.$(".qcard")) && g2++ < 120) {
    const nm = await p.textContent(".mname"); const fields = [];
    for (let k = 0; k < 8; k++) {
      let acted = false;
      for (const bl of await p.$$("[data-field]")) {
        const f = await bl.getAttribute("data-field"); if (!fields.includes(f)) fields.push(f);
        if (f === "linkedAccountId") continue;
        if (!(await bl.$(".chip.sel"))) { await (await bl.$(".chip")).click(); acted = true; break; }
      }
      if (!acted) break;
    }
    left.push(nm + " :: " + fields.join(","));
    await p.click(".qcard button.btn.teal"); await p.waitForTimeout(430);
  }
  console.log("CARDS ASKED", left);
  ok("cards ask only for missing fields (never 'what is this' for a merchant that already has a category)", left.length > 0 && left.every((x) => !/ :: $/.test(x)), left);
  ok("the 'Does this repeat?' question is not a Home card any more", !left.some((x) => /repeat/i.test(x)), left);
  await p.click('button:has-text("Review")'); await p.waitForTimeout(700);
  // What is left after answering everything is only what cannot be answered yet: the account link (no card / loan / SIP account has been added)
  const linkOnly = !!(await p.$(".qcard")) && (await p.$$("[data-field]")).length === 1 && (await (await p.$("[data-field]")).getAttribute("data-field")) === "linkedAccountId";
  ok("after answering, only merchants that still lack an account link remain (they keep counting as not complete)", linkOnly || !(await p.$(".qcard")), left.length);
  if (await p.$('button:has-text("Open the full Review table")')) await p.click('button:has-text("Open the full Review table")'); await p.waitForTimeout(500);
  ok("the Review tab shows the table", /Review & categorize/.test(await txt()));
  await p.click('button:has-text("Cash Flow")'); await p.waitForTimeout(1200);
  const cf = await txt(); const pick = (re) => { const m = re.exec(cf); return m ? inr(m[1]) : NaN; };
  const open = pick(/OPENING · bank cash\s*\n\s*(₹[\d,]+)/), inc = pick(/\+ INCOME\s*\n\s*(₹[\d,]+)/), exp = pick(/− EXPENSES\s*\n\s*(₹[\d,]+)/), inv = pick(/− INVESTMENTS\s*\n\s*(₹[\d,]+)/), trf = pick(/− TRANSFERS\s*\n\s*(₹[\d,]+)/), close = pick(/CLOSING · bank cash\s*\n\s*(₹[\d,]+)/);
  console.log("CASHFLOW", { open, inc, exp, inv, trf, close });
  ok("Cash Flow: closing equals the balance the person gave (1,86,000)", close === 186000, close);
  ok("Cash Flow: opening + income - expenses - investments - transfers = closing", open + inc - exp - inv - trf === close, { open, inc, exp, inv, trf, close });
  // Answers survive a reload (saved as rules on the device)
  await p.reload(); await p.waitForTimeout(2500);
  await p.click('button:has-text("Skip tour")').catch(() => {});
  await p.click('button:has-text("Review")').catch(() => {}); await p.waitForTimeout(700);
  const afterCount = (await p.$(".qcount span")) ? +/of (\d+)/.exec(await p.textContent(".qcount span"))[1] : 0;
  const afterFields = (await p.$(".qcard")) ? await p.$$eval("[data-field]", (els) => els.map((e) => e.getAttribute("data-field"))) : [];
  ok("after a reload nothing already answered is asked again (only the account-link merchants remain)", afterCount === left.filter((x) => / :: linkedAccountId$/.test(x)).length && afterFields.every((f) => f === "linkedAccountId"), { afterCount, afterFields });
  // A returning person with data is taken to Home, never held on the welcome screen
  if (await p.$(".qcard")) { await p.click(".onb-root .back"); await p.waitForTimeout(400); }
  const back = await txt();
  ok("reopening the app with data goes straight to Home (not the welcome screen)", !/Start with my money/.test(back) && /Ask about your money|LOWEST POINT|Cash Flow/.test(back), back.slice(0, 200));
  await p.click('button:has-text("About Us")'); await p.waitForTimeout(500);
  ok("the front page offers a returning person 'Go to my Home'", /Welcome back/i.test(await txt()) && !!(await p.$('button:has-text("Go to my Home")')));
  await p.click('button:has-text("Go to my Home")'); await p.waitForTimeout(600);
  ok("'Go to my Home' opens the app", !/Start with my money/.test(await txt()) && /Cash Flow/.test(await txt()));
  await p.click(".bw-title"); await p.waitForTimeout(500);
  ok("clicking the title returns to Home, not the welcome screen", !/Start with my money/.test(await txt()));
  await b.close();
  console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED"); process.exit(fail ? 1 : 0);
})();
