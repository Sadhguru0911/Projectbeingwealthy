/**
 * Unit tests for classify.js (Inference Engine Phase B). Plain Node, no bundling -
 * classify.js has zero App.jsx dependency by design, same as identity.js.
 *
 * Run: node src/inference/classify.test.cjs
 */
const assert = require("assert");

async function main() {
  const { classifyCommitment, shouldAskDoesThisRepeat, FREQUENCY, CONTROL, CONFIDENCE } =
    await import("./classify.js");

  let pass = 0, fail = 0;
  function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { pass++; }
    else { fail++; console.log("FAIL:", label, "\n  expected:", JSON.stringify(expected), "\n  actual:  ", JSON.stringify(actual)); }
  }

  // --- THE critical guard: one sighting is never Recurring, even if the raw
  // learnRecurringDay-shaped input optimistically says recurs:true (verified against
  // the real function before writing classify.js - this is not a hypothetical case,
  // it is exactly what learnRecurringDay actually returns at occurrenceCount 1). ---
  check(
    "one sighting, even with recurs:true from the raw pattern detector -> Insufficient, not Recurring",
    classifyCommitment({
      occurrenceCount: 1,
      recurringDayResult: { recurs: true, hasPattern: true, confidenceTier: "estimate", occurrenceCount: 1 },
    }).frequency,
    { value: null, confidence: CONFIDENCE.INSUFFICIENT, reason: "Only seen once so far." }
  );

  // --- A person's direct answer overrides the single-sighting rule entirely - the
  // strongest possible evidence, per DESIGN.md SS3/SS6a. ---
  check(
    "one sighting + person confirms it repeats -> Recurring, High, no waiting required",
    classifyCommitment({ occurrenceCount: 1, personAnswer: "confirmed-recurring" }).frequency,
    { value: FREQUENCY.RECURRING, confidence: CONFIDENCE.HIGH, reason: "You told us this repeats." }
  );
  check(
    "one sighting + person says one-off -> One-time, High",
    classifyCommitment({ occurrenceCount: 1, personAnswer: "confirmed-oneoff" }).frequency.value,
    FREQUENCY.ONE_TIME
  );

  // --- Two sightings, regular interval -> Recurring but still Medium (still
  // confirming), matching DESIGN.md SS5's confidence table exactly. ---
  check(
    "two sightings, regular interval -> Recurring, Medium",
    classifyCommitment({
      occurrenceCount: 2,
      recurringDayResult: { hasPattern: true },
    }).frequency,
    { value: FREQUENCY.RECURRING, confidence: CONFIDENCE.MEDIUM, reason: "Seen twice on the same interval - still confirming." }
  );

  // --- Three or more sightings, regular interval -> High. ---
  check(
    "three sightings, regular interval -> Recurring, High",
    classifyCommitment({ occurrenceCount: 3, recurringDayResult: { hasPattern: true } }).frequency.value,
    FREQUENCY.RECURRING
  );
  check(
    "...confidence is High",
    classifyCommitment({ occurrenceCount: 3, recurringDayResult: { hasPattern: true } }).frequency.confidence,
    CONFIDENCE.HIGH
  );

  // --- Multiple sightings, irregular interval -> Irregular, not Recurring. ---
  check(
    "three sightings, irregular interval -> Irregular",
    classifyCommitment({ occurrenceCount: 3, recurringDayResult: { hasPattern: false } }).frequency.value,
    FREQUENCY.IRREGULAR
  );

  // --- Control: no questionnaire answer -> defaults Flexible at Low confidence, per
  // DESIGN.md SS6 step 4 ("Expense/Variable defaults to Flexible unless told
  // otherwise"). ---
  check(
    "no questionnaire prior -> Flexible, Low",
    classifyCommitment({}).control,
    { value: CONTROL.FLEXIBLE, confidence: CONFIDENCE.LOW, reason: "No preference given yet - defaulting to flexible." }
  );

  // --- Control: questionnaire prior alone (no confirming history) -> Medium, not
  // High. A stated intention is real evidence, but not as strong as sustained history. ---
  check(
    "questionnaire says Committed, but only 1 occurrence (no confirming history) -> Medium",
    classifyCommitment({ questionnairePrior: { control: "Committed" }, occurrenceCount: 1, unbrokenHistory: false }).control,
    { value: "Committed", confidence: CONFIDENCE.MEDIUM, reason: "You told us this category is committed." }
  );

  // --- Control: questionnaire prior AND sustained unbroken history -> High. ---
  check(
    "questionnaire says Committed, 3+ occurrences, unbroken -> High",
    classifyCommitment({ questionnairePrior: { control: "Committed" }, occurrenceCount: 4, unbrokenHistory: true }).control,
    { value: "Committed", confidence: CONFIDENCE.HIGH, reason: "You told us this category is committed, and history confirms it." }
  );

  // --- Amount behaviour: passthrough of the ALREADY single-sighting-safe existing
  // function's shape (computeAmountBehavior returns "Not Yet Determined" at n<2 -
  // verified before writing this file, no fix needed here, just vocabulary mapping). ---
  check(
    "amountBehaviorResult 'Not Yet Determined' -> Insufficient",
    classifyCommitment({ amountBehaviorResult: { amountBehavior: "Not Yet Determined", confidence: null } }).amountBehavior,
    { value: null, confidence: CONFIDENCE.INSUFFICIENT, reason: "Only seen once so far." }
  );
  check(
    "amountBehaviorResult 'Fixed', High -> passed through with a reason",
    classifyCommitment({ amountBehaviorResult: { amountBehavior: "Fixed", confidence: "High", observationCount: 6 } }).amountBehavior,
    { value: "Fixed", confidence: "High", reason: "Steady amount across 6 occurrences." }
  );

  // --- Dimensions are independent: a High-confidence Frequency does not leak into a
  // Low-confidence Control or an Insufficient Amount Behaviour, and vice versa. ---
  const mixed = classifyCommitment({
    occurrenceCount: 5,
    recurringDayResult: { hasPattern: true }, // -> Frequency High
    amountBehaviorResult: { amountBehavior: "Not Yet Determined", confidence: null }, // -> Amount Insufficient
  });
  check("mixed case: Frequency is High despite Amount being Insufficient", mixed.frequency.confidence, CONFIDENCE.HIGH);
  check("mixed case: Amount stays Insufficient despite Frequency being High", mixed.amountBehavior.confidence, CONFIDENCE.INSUFFICIENT);
  check("mixed case: Control (unanswered) stays Low, independent of the other two", mixed.control.confidence, CONFIDENCE.LOW);

  // --- shouldAskDoesThisRepeat: the SS6a trigger ---
  check(
    "one sighting + looks large/unusual -> should ask",
    shouldAskDoesThisRepeat({ occurrenceCount: 1, isLargeOrUnusual: true }),
    true
  );
  check(
    "one sighting + NOT large/unusual -> should not ask (just wait for a 2nd sighting)",
    shouldAskDoesThisRepeat({ occurrenceCount: 1, isLargeOrUnusual: false }),
    false
  );
  check(
    "two sightings, even if large -> should not ask (evidence already exists)",
    shouldAskDoesThisRepeat({ occurrenceCount: 2, isLargeOrUnusual: true }),
    false
  );
  check(
    "already answered -> never ask again",
    shouldAskDoesThisRepeat({ occurrenceCount: 1, isLargeOrUnusual: true, personAnswer: "confirmed-recurring" }),
    false
  );

  console.log(`\n${pass}/${pass + fail} passed.`);
  if (fail > 0) process.exit(1);
}

main();
