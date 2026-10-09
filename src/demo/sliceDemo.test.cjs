/** Tests for sliceDemo.js. Run: node src/demo/sliceDemo.test.cjs */
(async () => {
  const { generateDemoData } = await import("./generateDemoData.js");
  const { sliceDemoJourney, startPeriodFor } = await import("./sliceDemo.js");
  let pass = 0, fail = 0;
  const check = (l, a, e) => { const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : (fail++, console.log("FAIL:", l, "\n  expected:", JSON.stringify(e), "\n  actual:  ", JSON.stringify(a))); };
  const data = generateDemoData();
  // the windows the prototype itself labels (RANGE): 1=Sep, 2=Aug-Sep, 3=Jul-Sep, 6=Apr-Sep, 12=Oct 2025-Sep 2026
  check("window 1", startPeriodFor("2026-09-28", 1), "2026-09");
  check("window 2", startPeriodFor("2026-09-28", 2), "2026-08");
  check("window 3", startPeriodFor("2026-09-28", 3), "2026-07");
  check("window 6", startPeriodFor("2026-09-28", 6), "2026-04");
  check("window 12", startPeriodFor("2026-09-28", 12), "2025-10");
  for (const h of [1, 2, 3, 6, 12]) {
    const s = sliceDemoJourney(data, h, {});
    const months = new Set(s.transactions.map((t) => t.date.slice(0, 7))).size;
    check(`h=${h}: exactly ${h} month(s) of transactions`, months, h);
    check(`h=${h}: only the bank account remains`, s.accounts.map((a) => a.id), ["acc_bank"]);
    check(`h=${h}: nothing belonging to the card/loan/demat accounts leaks in`, s.transactions.filter((t) => t.accountId !== "acc_bank").length, 0);
    check(`h=${h}: nothing is linked to an account that no longer exists`, s.transactions.filter((t) => t.linkedAccountId && t.linkedAccountId !== "acc_bank").length, 0);
  }
  const fee = (s) => s.transactions.filter((t) => t.merchant === "School Fee");
  check("h=3: school fee not yet in the window", fee(sliceDemoJourney(data, 3, {})).length, 0);
  check("h=6 unanswered: single sighting is NOT planned for (modelled One-Time - see #71)", fee(sliceDemoJourney(data, 6, {})).map((t) => [t.frequencyClass, t.frequency]), [["One-Time", null]]);
  check("h=6 answered every 6 months: becomes Semi-Annual", fee(sliceDemoJourney(data, 6, { feeAns: "6m" })).map((t) => [t.frequencyClass, t.frequency]), [["Recurring", "Semi-Annual"]]);
  check("h=6 answered one-off: One-Time", fee(sliceDemoJourney(data, 6, { feeAns: "once" })).map((t) => [t.frequencyClass, t.frequency]), [["One-Time", null]]);
  check("h=12: school fee seen twice - confirmed by history regardless of answers", fee(sliceDemoJourney(data, 12, {})).map((t) => [t.frequencyClass, t.frequency]), [["Recurring", "Semi-Annual"], ["Recurring", "Semi-Annual"]]);
  const ins = (s) => s.transactions.filter((t) => t.merchant === "Car Insurance");
  check("h=6: last November's insurance is outside the window", ins(sliceDemoJourney(data, 6, {})).length, 0);
  check("h=12 unanswered: insurance single sighting not planned for", ins(sliceDemoJourney(data, 12, {})).map((t) => t.frequencyClass), ["One-Time"]);
  check("h=12 answered every year: Annual", ins(sliceDemoJourney(data, 12, { insAns: "year" })).map((t) => t.frequency), ["Annual"]);
  check("the source dataset is not mutated", data.transactions.filter((t) => t.merchant === "Car Insurance")[0].frequency, "Annual");
    { const s = sliceDemoJourney(data, 12, { card: true });
    check("story: card added -> account + its transactions + links kept", [s.accounts.map((a) => a.id), s.transactions.some((t) => t.accountId === "acc_card"), s.transactions.some((t) => t.linkedAccountId === "acc_card")], [["acc_bank", "acc_card"], true, true]); }
  { const s = sliceDemoJourney(data, 6, { loan: true, inv: true, goalSet: true });
    check("story: loan+inv+goal -> schedules, holdings (in window), goal present", [s.accounts.map((a) => a.id), s.debtSchedules.length, s.holdingSnapshots.length > 0 && s.holdingSnapshots.every((x) => x.asOfDate.slice(0, 7) >= "2026-04"), s.goals.length], [["acc_bank", "acc_loan", "acc_demat"], 1, true, 1]);
    check("story: card still absent when not added", s.transactions.filter((t) => t.accountId === "acc_card").length, 0); }
console.log(`\n${pass}/${pass + fail} passed.`); if (fail) process.exit(1);
})();
