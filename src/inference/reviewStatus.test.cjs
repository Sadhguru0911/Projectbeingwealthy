/**
 * Unit tests for reviewStatus.js. Plain Node, no bundling - pure module, no
 * App.jsx dependency, same as identity/classify/route.
 * Run: node src/inference/reviewStatus.test.cjs
 */
async function main() {
  const { summarizeReviewStatus } = await import("./reviewStatus.js");

  let pass = 0, fail = 0;
  function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) pass++;
    else { fail++; console.log("FAIL:", label, "\n  expected:", JSON.stringify(expected), "\n  actual:  ", JSON.stringify(actual)); }
  }

  const groups = [
    // Confident identity, established frequency -> Sorted
    { key: "a", name: "Zepto", occurrenceCount: 4, libraryEntry: { merchant: "Zepto", identityConfidence: "High", category: "Expense" }, recurringDayResult: { hasPattern: true } },
    // Confirmed via linked account -> Sorted, regardless of anything else
    { key: "b", name: "Home Loan", occurrenceCount: 4, linkedAccountName: "Home Loan", recurringDayResult: { hasPattern: true } },
    // Identity resolved (Medium confidence), only 2 sightings -> Worth a quick look
    // (both category and frequency land at Medium - identity alone isn't enough;
    // an UNRESOLVED identity, even with a clean frequency pattern, correctly stays
    // "needs your input" - see group "e" and the real Ramesh-Tiffin-Service case
    // this mirrors, backlog #48).
    { key: "c", name: "School Fee", occurrenceCount: 2, libraryEntry: { merchant: "Sample School", identityConfidence: "Medium", category: "Expense" }, recurringDayResult: { hasPattern: true } },
    // Category deliberately withheld (Razorpay-style) -> Needs your input
    { key: "d", name: "Razorpay", occurrenceCount: 5, libraryEntry: { merchant: "Razorpay", identityConfidence: "High", category: null }, recurringDayResult: { hasPattern: true } },
    // Nothing matched at all -> Needs your input
    { key: "e", name: "Unknown Local Shop", occurrenceCount: 1 },
  ];

  const result = summarizeReviewStatus(groups);
  check("counts", result.counts, { sorted: 2, worthAQuickLook: 1, needsYourInput: 2 });
  check("items carry the group key/name through", result.items.map((i) => i.key), ["a", "b", "c", "d", "e"]);
  check("linked-account group correctly resolves Confirmed identity", result.items[1].routing.action, "auto");
  check("withheld-category group correctly stays unresolved despite frequent sightings", result.items[3].routing.action, "unresolved");

  // --- Regression test for a real production bug, reported directly: a
  // transaction already categorized by the person (via a rule OR a protected
  // manual override with no rule at all) must be treated as Confirmed identity,
  // never re-derived from raw text as if nothing were known about it. This is
  // App.jsx's OWN job (constructing the right ruleMatch before calling into this
  // file), not reviewStatus.js's - so this test exercises the exact synthetic
  // ruleMatch shape App.jsx now constructs for a manual override
  // ({ source: "user", pattern, category, subCategory }), proving the hierarchy
  // - user/learned decisions outrank a fresh automated guess - actually holds
  // once fed through. Before the fix, App.jsx passed ruleMatch: null for this
  // exact case, which resolved as Unresolved / needsYourInput despite the
  // transaction being fully, correctly categorized already.
  const alreadyCategorizedNoRule = [{
    key: "manual-override", name: "Obscure Local Business", occurrenceCount: 4,
    ruleMatch: { source: "user", pattern: "UPI-OBSCURE LOCAL BIZ", category: "Expense", subCategory: "Household" },
    recurringDayResult: { hasPattern: true },
  }];
  const manualResult = summarizeReviewStatus(alreadyCategorizedNoRule);
  check("a manually-categorized transaction with no rule/library match resolves Sorted, not needs-input", manualResult.counts, { sorted: 1, worthAQuickLook: 0, needsYourInput: 0 });
  check("...identity correctly reports Confirmed, not Unresolved", manualResult.items[0].routing.action, "auto");

  console.log(`\n${pass}/${pass + fail} passed.`);
  if (fail > 0) process.exit(1);
}

main();
