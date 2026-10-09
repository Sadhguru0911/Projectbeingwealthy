/**
 * Unit tests for route.js (Inference Engine Phase C). Plain Node, no bundling.
 * Run: node src/inference/route.test.cjs
 */
async function main() {
  const { routeCommitment, buildReviewQueue, ACTION } = await import("./route.js");
  const { resolveIdentity } = await import("./identity.js");
  const { classifyCommitment, CONFIDENCE } = await import("./classify.js");

  let pass = 0, fail = 0;
  function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { pass++; }
    else { fail++; console.log("FAIL:", label, "\n  expected:", JSON.stringify(expected), "\n  actual:  ", JSON.stringify(actual)); }
  }

  // --- Strong everything, auto-apply OFF (the default, and Phase C's own stated
  // scope: nothing auto-applies for real until Phase D's accuracy bar clears) ---
  const strongIdentity = resolveIdentity({ libraryEntry: { merchant: "Zepto", identityConfidence: "High", category: "Expense" } });
  const strongClassification = classifyCommitment({
    occurrenceCount: 4,
    recurringDayResult: { hasPattern: true },
    amountBehaviorResult: { amountBehavior: "Fixed", confidence: "High", observationCount: 4 },
    questionnairePrior: { control: "Flexible" },
    unbrokenHistory: true,
  });
  const r1 = routeCommitment({ identity: strongIdentity, classification: strongClassification }); // autoApplyEnabled defaults false
  check("strong everything, gate OFF -> action is provisional, not auto", r1.action, ACTION.PROVISIONAL);
  check("...but wouldAutoApply correctly reports true (Phase D needs this signal)", r1.wouldAutoApply, true);

  // --- Same inputs, gate explicitly ON -> actually auto ---
  const r2 = routeCommitment({ identity: strongIdentity, classification: strongClassification, autoApplyEnabled: true });
  check("strong everything, gate ON -> action is auto", r2.action, ACTION.AUTO);
  check("...wouldAutoApply still true, consistent with action", r2.wouldAutoApply, true);

  // --- THE key case: confident identity, but classification deliberately withheld
  // (Merchant Library v2 - Razorpay, PhonePe, LIC). Must NOT auto-apply, must NOT
  // even reach "suggest" - there's genuinely nothing to suggest a category as. ---
  const razorpayIdentity = resolveIdentity({ libraryEntry: { merchant: "Razorpay", identityConfidence: "High", category: null } });
  const razorpayClassification = classifyCommitment({ occurrenceCount: 1 }); // fresh, nothing else known
  const r3 = routeCommitment({ identity: razorpayIdentity, classification: razorpayClassification, autoApplyEnabled: true });
  check("confident identity + withheld classification -> unresolved, even with the gate ON", r3.action, ACTION.UNRESOLVED);
  check("...wouldAutoApply is false (correctly - there is nothing to auto-apply)", r3.wouldAutoApply, false);
  check("...the weakest dimension is correctly identified as 'category', not identity itself", r3.weakestDimensions.includes("category"), true);

  // --- Weakest-link reason naming: when frequency is the weak point, the reason
  // should be ABOUT frequency, not a generic message or the wrong dimension ---
  const okIdentity = resolveIdentity({ libraryEntry: { merchant: "Zepto", identityConfidence: "High", category: "Expense" } });
  const oneSightingClassification = classifyCommitment({ occurrenceCount: 1 }); // frequency + amount both Insufficient
  const r4 = routeCommitment({ identity: okIdentity, classification: oneSightingClassification });
  check("one sighting -> overall Insufficient (frequency/amount, not identity, are the weak link)", r4.overall, "Insufficient");
  check("...weakest dimensions correctly exclude 'category' (identity itself was fine)", r4.weakestDimensions.includes("category"), false);
  check("...reason mentions the actual weak point", r4.reason, "Only seen once so far.");

  // --- THE bug found and fixed during this phase's own testing: strong category and
  // Frequency, but Control UNANSWERED (the realistic default for every real user
  // until the questionnaire exists) must NOT drag routing down to "suggest." This is
  // a permanent regression test for exactly that failure - if Control or Amount
  // Behaviour ever gate routing again, this must fail. ---
  const wellKnownIdentity = resolveIdentity({ libraryEntry: { merchant: "Zepto", identityConfidence: "High", category: "Expense" } });
  const cleanHistoryNoProfileAnswer = classifyCommitment({
    occurrenceCount: 4,
    recurringDayResult: { hasPattern: true },
    amountBehaviorResult: { amountBehavior: "Variable", confidence: "Medium", observationCount: 4 },
    // deliberately NO questionnairePrior - the realistic default for every category
    // until the person has answered the (not yet built) questionnaire.
  });
  check("Control unanswered (Low) does NOT gate routing", cleanHistoryNoProfileAnswer.control.confidence, CONFIDENCE.LOW);
  const r5 = routeCommitment({ identity: wellKnownIdentity, classification: cleanHistoryNoProfileAnswer, autoApplyEnabled: true });
  check("well-known merchant + clean regular history, Control unanswered -> STILL auto (the actual bug this test guards)", r5.action, ACTION.AUTO);
  check("...overall is High, not dragged down by Control's Low", r5.overall, CONFIDENCE.HIGH);
  check("...Control's own Low confidence is still reported for the UI, just not gating", r5.control.confidence, CONFIDENCE.LOW);

  // --- Variable amounts (normal for a category like groceries) must not, on their
  // own, hold a transaction back from Sorted either - the same principle, applied to
  // Amount Behaviour instead of Control. ---
  check("Amount Behaviour ('Variable', Medium) also does not gate - confirmed by the same r5 result above", r5.amountBehavior.value, "Variable");

  // --- buildReviewQueue: bucketing ---
  const items = [
    { commitmentKey: "sorted-one", routing: { action: ACTION.AUTO }, amountPerOccurrence: 100, occurrencesPerYear: 12 },
    { commitmentKey: "quicklook-one", routing: { action: ACTION.PROVISIONAL }, amountPerOccurrence: 100, occurrencesPerYear: 12 },
    { commitmentKey: "needsinput-one", routing: { action: ACTION.SUGGEST }, amountPerOccurrence: 100, occurrencesPerYear: 12 },
    { commitmentKey: "needsinput-two", routing: { action: ACTION.UNRESOLVED }, amountPerOccurrence: 100, occurrencesPerYear: 12 },
  ];
  const q = buildReviewQueue(items);
  check("bucketing: 1 sorted", q.counts.sorted, 1);
  check("bucketing: 1 worth a quick look", q.counts.worthAQuickLook, 1);
  check("bucketing: suggest + unresolved share needsYourInput (2 total)", q.counts.needsYourInput, 2);

  // --- buildReviewQueue: materiality ordering - a large infrequent item outranks a
  // small frequent one, matching DESIGN.md SS9's own worked example exactly
  // (a Rs 60,000 twice-yearly item before a Rs 200 uncertain one). ---
  const materialityItems = [
    { commitmentKey: "small-frequent", routing: { action: ACTION.SUGGEST }, amountPerOccurrence: 200, occurrencesPerYear: 12 }, // Rs 2,400/yr
    { commitmentKey: "large-infrequent", routing: { action: ACTION.SUGGEST }, amountPerOccurrence: 60000, occurrencesPerYear: 2 }, // Rs 120,000/yr
  ];
  const q2 = buildReviewQueue(materialityItems);
  check("large-infrequent (Rs 1,20,000/yr) surfaces before small-frequent (Rs 2,400/yr)",
    q2.needsYourInput.map((i) => i.commitmentKey),
    ["large-infrequent", "small-frequent"]
  );

  // --- scope labeling ---
  check("no importBatchId -> scope 'all'", buildReviewQueue([]).scope, "all");
  check("importBatchId given -> scope 'batch', reported honestly", buildReviewQueue([], "batch-123").scope, "batch");
  check("...and the batch id is carried through", buildReviewQueue([], "batch-123").importBatchId, "batch-123");

  console.log(`\n${pass}/${pass + fail} passed.`);
  if (fail > 0) process.exit(1);
}

main();
