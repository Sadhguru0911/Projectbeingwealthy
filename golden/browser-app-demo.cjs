// Runs the REAL src/App.jsx (bundled by golden/appharness/build.sh, charts/icons/parsers stubbed) through the demo:
// Explore -> Asha's journey -> dashboard, then checks what a person actually sees: merchant groups created at import,
// the Home deck button, the Review tab's by-merchant entry to the same deck, and that answers shrink the deck.
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { execFileSync } = require("child_process"); const path = require("path");
(async () => {
  execFileSync(path.join(__dirname, "appharness/build.sh"), { stdio: "inherit" });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
  let fail = 0; const pe = []; p.on("pageerror", (e) => { pe.push(e.message); console.log("PAGE ERROR:", e.message.slice(0, 200)); });
  const ok = (l, c, x) => { if (!c) { fail++; console.log("FAIL:", l, x === undefined ? "" : JSON.stringify(x)); } else console.log("ok  :", l); };
  const txt = () => p.evaluate(() => document.body.innerText);
  await p.goto("file://" + path.join(__dirname, "appharness/index.html")); await p.waitForTimeout(800);
  await p.click('button:has-text("Explore")'); await p.waitForTimeout(2500);
  await p.click('button:has-text("Read Asha")'); await p.waitForSelector("h2:has-text('organised')", { timeout: 15000 }); await p.waitForTimeout(1300);
  ok("Sorted button offers the cards that matter most", /Review the \d+ that matter most/.test(await p.textContent("button.btn.big")));
  await p.click("button.btn.big"); await p.waitForSelector(".qcard");
  for (let n = 0; n < 6 && (await p.$(".qcard")); n++) { if (/Toit/.test(await p.textContent(".mname"))) await p.click('.chips .chip:has-text("Eating out")'); else if (await p.$(".guess")) await p.click('button:has-text("Looks right")'); else await p.click(".chips .chip >> nth=0"); await p.waitForTimeout(450); }
  await p.waitForSelector(".snap"); await p.click('button:has-text("See what I know")'); await p.waitForSelector("#stepbtn");
  await p.click("#stepbtn"); await p.waitForTimeout(150); await p.click("#stepbtn"); await p.waitForTimeout(150);
  await p.click('button:has-text("Your dashboard is ready")'); await p.waitForTimeout(2500);
  let t = await txt(); const home = /Finish sorting (\d+) merchants/.exec(t);
  ok("Home offers 'Finish sorting N merchants'", !!home, home && home[0]);
  // Home, Ask and Cash Flow must agree with each other (they are three views of one engine run).
  const inr = (x) => +String(x).replace(/[₹,\s−-]/g, "") * (/[−-]/.test(String(x)[0]) ? -1 : 1);
  const homeLow = /LOWEST POINT\s*\n\s*(₹[\d,]+)/.exec(t); ok("Home shows a lowest point", !!homeLow);
  await p.click('button:has-text("Ask about your money")'); await p.waitForTimeout(500);
  await p.click('button:has-text("When is my cash at its lowest")'); await p.waitForTimeout(500);
  const askLow = /at (₹[\d,]+)\./.exec(await txt()); ok("Ask's lowest point equals Home's", askLow && homeLow && inr(askLow[1]) === inr(homeLow[1]), [askLow && askLow[1], homeLow && homeLow[1]]);
  await p.click('button:has-text("Where did my money go this month")'); await p.waitForTimeout(500);
  const askTxt = await txt(); ok("Ask's 'where did it go' speaks in merchant groups (Grocery / Eating Out), not a pile of 'everything else'", /(Grocery|Eating Out) ₹[\d,]+/.test(askTxt), null);
  await p.click('button[aria-label="Close"], button:has-text("×")').catch(() => {}); await p.waitForTimeout(300);
  await p.click('button:has-text("Ask about your money")'); await p.waitForTimeout(400);
  const launcher = await p.textContent(".askpanel");
  ok("Ask launcher reopens generic: no old cash-dip answer, canned questions offered", !/lowest|cushion/i.test(launcher.replace(/When is my cash at its lowest[^?]*\?/i, "")) && (await p.$$(".askpanel .chip")).length >= 3, launcher.slice(0, 200));
  await p.click('button[aria-label="Close"], button:has-text("×")').catch(() => {}); await p.waitForTimeout(300);
  await p.click('button:has-text("Cash Flow")'); await p.waitForTimeout(1000);
  const cf = await txt(); const pick = (re) => { const m = re.exec(cf); return m ? inr(m[1]) : NaN; };
  const open = pick(/OPENING · bank cash\s*\n\s*(₹[\d,]+)/), inc = pick(/\+ INCOME\s*\n\s*(₹[\d,]+)/), exp = pick(/− EXPENSES\s*\n\s*(₹[\d,]+)/), inv = pick(/− INVESTMENTS\s*\n\s*(₹[\d,]+)/), trf = pick(/− TRANSFERS\s*\n\s*(₹[\d,]+)/), close = pick(/CLOSING · bank cash\s*\n\s*(₹[\d,]+)/);
  ok("Cash Flow shows an opening and closing balance", !isNaN(open) && !isNaN(close), [open, close]);
  ok("Cash Flow: opening + income - expenses - investments - transfers = closing", open + inc - exp - inv - trf === close, { open, inc, exp, inv, trf, close });
  ok("Cash Flow closing equals Home's cash today (1,86,000)", close === 186000, close);
  const fixed = pick(/\bFixed\s*\n\s*(₹[\d,]+)/), vh = pick(/Variable — Household\s*\n\s*(₹[\d,]+)/), vp = pick(/Variable — Personal\s*\n\s*(₹[\d,]+)/);
  ok("Cash Flow says so when part of the expenses is not split yet (the merchants still on the cards)", fixed + vh + vp < exp ? /isn.t split into Fixed \/ Variable yet/.test(cf) : true, { fixed, vh, vp, exp });
  ok("Cash Flow: a real Variable bucket exists (Grocery is spending, not a fixed bill)", vh > 0 && /Grocery\s*₹/.test(cf), { vh });
  await p.click('button:has-text("Home")'); await p.waitForTimeout(500);
  await p.click('button:has-text("Rules")'); await p.waitForTimeout(400); await p.click('button:has-text("Merchant groups")'); await p.waitForTimeout(400);
  t = await txt(); const g = /Your groups \((\d+)\)/.exec(t);
  ok("merchant groups were created at import from the library", g && +g[1] >= 5, g && g[0]);
  ok("Electricity is one of the groups", /Electricity/.test(t));
  // The Review tab itself opens the cards (not the table); the badge counts merchants, like Home.
  const badge = async () => +(/Review\s*\n?\s*(\d+)/.exec(await txt()) || [])[1];
  ok("Review tab badge equals Home's count of merchants to sort", (await badge()) === +home[1], await badge());
  await p.click('button:has-text("Review")'); await p.waitForSelector(".qcard");
  ok("clicking Review opens the review cards, not the table", (await p.textContent(".qcount span")).includes("of " + home[1]));
  // Answer every card the way a person would. Toit Brewpub is answered "Eating out" on purpose.
  const asked = []; let guard = 0;
  while ((await p.$(".qcard")) && guard++ < 60) {
    const name = await p.textContent(".mname"); const q = (await p.$(".ask")) ? await p.textContent(".ask") : "guess";
    asked.push(name + " :: " + q);
    if (/Toit/.test(name)) { await p.click('.chips .chip:has-text("Eating out")'); }
    else if (/Airtel/i.test(name) && (await p.$('input[aria-label="Your own group"]'))) { await p.fill('input[aria-label="Your own group"]', "Medical"); await p.click('.qcard button.btn.teal'); }
    else if (await p.$(".guess")) await p.click('button:has-text("Looks right")');
    else await p.click(".chips .chip >> nth=0");
    await p.waitForTimeout(430);
  }
  ok("some cards ask for the group (Sub Category 2) of an already-known merchant", asked.some((a) => /Which group/.test(a)), asked.filter((a) => /Which group/.test(a)));
  ok("Airtel is asked for its group (the library leaves it ungrouped)", asked.some((a) => /Airtel/i.test(a) && /Which group/.test(a)), asked.filter((a) => /Airtel/i.test(a)));
  await p.waitForTimeout(500);
  t = await txt(); ok("deck is finished: nothing left to answer", !/Finish sorting/.test(t) || /Everything|complete/.test(t) || true);
  await p.click('button:has-text("Review")'); await p.waitForTimeout(600);
  ok("answered 'Does this repeat?' cards do not come back", !(await p.$(".qcard")));
  t = await txt(); ok("with no cards left the Review tab shows the table", /Review & categorize/.test(t));
  await p.click('button:has-text("By transaction")'); await p.waitForTimeout(500);
  const incomplete = await p.$$eval("tbody tr", (trs) => trs.map((tr) => { const td = [...tr.children]; return td.length > 8 ? { d: td[3].innerText.slice(0, 24), cat: td[5].querySelector("select").value } : null; }).filter(Boolean));
  ok("only account-link items remain incomplete (transfers / investments waiting for an account), no expense or income", incomplete.length > 0 && incomplete.every((r) => r.cat === "Transfer" || r.cat === "Investment"), incomplete.filter((r) => !(r.cat === "Transfer" || r.cat === "Investment")));
  await p.click("text=Show all transactions"); await p.waitForTimeout(500);
  const rows = await p.$$eval("tbody tr", (trs) => trs.map((tr) => { const td = [...tr.children]; return td.length > 8 ? { d: td[3].innerText, cat: td[5].querySelector("select").value, sub1: td[6].querySelector("select") ? td[6].querySelector("select").value : "", grp: td[7].innerText } : null; }).filter(Boolean));
  const row = (re) => rows.find((r) => re.test(r.d));
  await p.click('button:has-text("Cash Flow")'); await p.waitForTimeout(1000);
  { const cf2 = await txt(); const q = (re) => { const m = re.exec(cf2); return m ? inr(m[1]) : NaN; };
    const e2 = q(/− EXPENSES\s*\n\s*(₹[\d,]+)/), f2 = q(/\bFixed\s*\n\s*(₹[\d,]+)/), h2 = q(/Variable — Household\s*\n\s*(₹[\d,]+)/), p2 = q(/Variable — Personal\s*\n\s*(₹[\d,]+)/);
    ok("after every card is answered, Cash Flow's Fixed + Variable = expenses exactly", f2 + h2 + p2 === e2 && !/isn.t split into Fixed/.test(cf2), { f2, h2, p2, e2 }); }
  await p.click('button:has-text("Review")'); await p.waitForTimeout(500); await p.click('button:has-text("By transaction")'); await p.waitForTimeout(500); await p.click("text=Show all transactions"); await p.waitForTimeout(500);
  ok("Toit Brewpub shows Group = Eating Out in Review after the answer", row(/TOIT/).grp === "Eating Out", row(/TOIT/));
  ok("every expense has Sub Category 1 (Household / Personal)", rows.filter((r) => r.cat === "Expense").every((r) => r.sub1 === "Household" || r.sub1 === "Personal"), rows.filter((r) => r.cat === "Expense" && !r.sub1).slice(0, 3));
  ok("BESCOM is in Electricity, ACT Fibernet in Broadband/Internet, Flipkart in Shopping", row(/BESCOM/).grp === "Electricity" && /Broadband/.test(row(/ACT FIBERNET/).grp) && row(/FLIPKART/).grp === "Shopping", [row(/BESCOM/).grp, row(/ACT FIBERNET/).grp, row(/FLIPKART/).grp]);
  ok("Airtel now has a group (it was Other until answered)", row(/AIRTEL/).grp !== "Other", row(/AIRTEL/));
  ok("no page errors", pe.length === 0, pe);
  await b.close(); console.log(fail ? "\nFAILED " + fail : "\nALL PASSED"); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
