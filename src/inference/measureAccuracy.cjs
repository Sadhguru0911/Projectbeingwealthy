#!/usr/bin/env node
/**
 * Accuracy measurement (Inference Engine Phase D, backlog #46). See
 * INFERENCE_ENGINE_DESIGN.md §8's accuracy bar and §10.
 *
 * Runs the REAL pipeline - real matchRule/findLibraryEntry/learnRecurringDay (via
 * the golden harness, the actual compiled App.jsx, not a reimplementation) combined
 * with the real identity.js / classify.js / route.js - against the labelled
 * scenarios in generateTestData.js, and reports:
 *   - COVERAGE: of everything with real evidence, how much got any action besides
 *     "unresolved."
 *   - AUTO-APPLY PRECISION: of what the engine says WOULD auto-apply (wouldAutoApply
 *     true, i.e. what Phase C's gate is currently hiding behind autoApplyEnabled),
 *     how much is actually correct - the specific number the ≥98% bar (proposed,
 *     pending sign-off) applies to. Reported SEPARATELY from coverage, per §8/§10 -
 *     a system with low coverage but perfect precision is very different from one
 *     with high coverage and shaky precision, and blending them into one number
 *     would hide which problem (if either) actually exists.
 *
 * Run: node src/inference/measureAccuracy.cjs
 */
const { callEngine } = require("../../golden/load-engine.cjs");

async function main() {
  const { resolveIdentity } = await import("./identity.js");
  const { classifyCommitment } = await import("./classify.js");
  const { routeCommitment, ACTION } = await import("./route.js");
  const { SCENARIOS } = await import("./generateTestData.js");

  const rules = callEngine("seedRules", []);

  const results = SCENARIOS.map((sc) => {
    const ruleMatch = callEngine("matchRule", [sc.rawText, rules]);
    const libraryEntry = callEngine("findLibraryEntry", [sc.rawText]);
    const identity = resolveIdentity({ ruleMatch, libraryEntry, clusterMatch: false });

    const rdr = sc.dates.length >= 1 ? callEngine("learnRecurringDay", [sc.dates]) : null;
    const abr = sc.amounts.length >= 1 ? callEngine("computeAmountBehavior", [sc.amounts]) : null;
    const classification = classifyCommitment({ occurrenceCount: sc.dates.length, recurringDayResult: rdr, amountBehaviorResult: abr });

    const routing = routeCommitment({ identity, classification, autoApplyEnabled: true }); // gate ON for measurement - see file header

    // --- Score against ground truth ---
    const checks = [];
    if (sc.expectCategory !== undefined) {
      const actualCategory = identity.hasClassification ? (libraryEntry ? libraryEntry.category : (ruleMatch ? ruleMatch.category : null)) : null;
      checks.push({ name: "category", ok: actualCategory === sc.expectCategory, expected: sc.expectCategory, actual: actualCategory });
    }
    if (sc.expectFrequencyTier !== undefined) {
      checks.push({ name: "frequencyTier", ok: classification.frequency.confidence === sc.expectFrequencyTier, expected: sc.expectFrequencyTier, actual: classification.frequency.confidence });
    }
    if (sc.expectFrequencyValue !== undefined) {
      checks.push({ name: "frequencyValue", ok: classification.frequency.value === sc.expectFrequencyValue, expected: sc.expectFrequencyValue, actual: classification.frequency.value });
    }
    if (sc.mustNeverAutoApply) {
      checks.push({ name: "mustNeverAutoApply", ok: routing.wouldAutoApply === false, expected: false, actual: routing.wouldAutoApply });
    }
    const allOk = checks.every((c) => c.ok);

    return { id: sc.id, routing, checks, allOk, knownBug: sc.knownBug || null };
  });

  // --- Report ---
  console.log("=== Per-scenario results ===\n");
  let failCount = 0, knownBugCount = 0;
  results.forEach((r) => {
    if (r.allOk) {
      console.log(`[PASS] ${r.id}  (action: ${r.routing.action}, wouldAutoApply: ${r.routing.wouldAutoApply})`);
    } else if (r.knownBug) {
      knownBugCount++;
      console.log(`[KNOWN BUG] ${r.id}  (action: ${r.routing.action}, wouldAutoApply: ${r.routing.wouldAutoApply}) - tracked: ${r.knownBug}`);
      r.checks.filter((c) => !c.ok).forEach((c) => console.log(`    ${c.name}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`));
    } else {
      failCount++;
      console.log(`[FAIL] ${r.id}  (action: ${r.routing.action}, wouldAutoApply: ${r.routing.wouldAutoApply})`);
      r.checks.filter((c) => !c.ok).forEach((c) => console.log(`    ${c.name}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`));
    }
  });

  const withEvidence = results.filter((r) => r.routing.action !== ACTION.UNRESOLVED || true); // all scenarios have at least one occurrence, i.e. "real evidence" exists
  const resolved = results.filter((r) => r.routing.action !== ACTION.UNRESOLVED);
  const coverage = resolved.length / results.length;

  const wouldAuto = results.filter((r) => r.routing.wouldAutoApply);
  const wouldAutoCorrect = wouldAuto.filter((r) => r.allOk);
  const precision = wouldAuto.length ? wouldAutoCorrect.length / wouldAuto.length : null;

  console.log("\n=== Summary ===");
  console.log(`Scenarios: ${results.length}`);
  console.log(`Coverage (resolved beyond "unresolved"): ${resolved.length}/${results.length} = ${(coverage * 100).toFixed(1)}%`);
  console.log(`Auto-apply candidates (wouldAutoApply=true): ${wouldAuto.length}`);
  console.log(`Auto-apply precision: ${wouldAuto.length ? `${wouldAutoCorrect.length}/${wouldAuto.length} = ${(precision * 100).toFixed(1)}%` : "n/a - no candidates in this dataset"}`);
  console.log(`Unexpected failures: ${failCount}/${results.length}`);
  console.log(`Known, tracked bugs (not counted as unexpected): ${knownBugCount}/${results.length}`);

  if (failCount > 0) {
    console.log("\nNOTE: unexpected failures above are implementation-consistency bugs to fix, not a");
    console.log("verdict on whether auto-apply should ship - this dataset is too small (10 scenarios)");
    console.log("to be the real accuracy bar. It exists to catch pipeline bugs cheaply; the real Phase");
    console.log("D measurement needs the full demo dataset (#39) once it exists at real scale.");
  }
  if (knownBugCount > 0) {
    console.log("\nNOTE: known-bug scenarios are LEFT FAILING on purpose (see generateTestData.js) so");
    console.log("they stay visible until the real fix lands, rather than being silently adjusted to");
    console.log("match the wrong behaviour.");
  }
}

main();
