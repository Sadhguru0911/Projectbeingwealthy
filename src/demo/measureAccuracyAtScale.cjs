#!/usr/bin/env node
/**
 * Accuracy measurement at real scale (Inference Engine Phase D, backlog #46),
 * using the full demo dataset (backlog #39) rather than the 10 hand-picked
 * scenarios in src/inference/generateTestData.js. Same principle, much larger and
 * more realistic input: 196 real transactions across 12 months, grouped by
 * commitment (the same grouping concept App.jsx's real commitmentGroupKey uses -
 * here, simplified to "same merchant, same account" since the demo data has no
 * merchant-alias groups to resolve), each group scored against the ground truth
 * recorded on its transactions.
 *
 * Run: node src/demo/measureAccuracyAtScale.cjs
 */
const { callEngine } = require("../../golden/load-engine.cjs");

function groupKey(t) { return t.accountId + "|" + t.merchant; }

async function main() {
  const { resolveIdentity } = await import("../inference/identity.js");
  const { classifyCommitment } = await import("../inference/classify.js");
  const { routeCommitment, ACTION } = await import("../inference/route.js");
  const { generateDemoData } = await import("./generateDemoData.js");

  const data = generateDemoData();
  const rules = callEngine("seedRules", []);

  const groups = {};
  data.transactions.forEach((t) => {
    const k = groupKey(t);
    if (!groups[k]) groups[k] = { merchant: t.merchant, accountId: t.accountId, txns: [] };
    groups[k].txns.push(t);
  });
  const groupList = Object.values(groups);
  console.log(`${data.transactions.length} transactions grouped into ${groupList.length} commitments.\n`);

  const results = groupList.map((g) => {
    const sample = g.txns[0]; // raw text is the same shape across a group's occurrences
    const dates = g.txns.map((t) => t.date).sort();
    const amounts = g.txns.map((t) => Math.abs(t.amount));

    const ruleMatch = callEngine("matchRule", [sample.description, rules]);
    const libraryEntry = callEngine("findLibraryEntry", [sample.description]);
    // linkedAccountId -> the linked account's own nickname, exactly as
    // describeDebtPayment's real Tier-1 resolution does - found missing from
    // identity.js entirely by this measurement run, now fixed (see identity.js).
    const linkedAccountName = sample.linkedAccountId ? (data.accounts.find((a) => a.id === sample.linkedAccountId) || {}).nickname : null;
    const identity = resolveIdentity({ linkedAccountName, ruleMatch, libraryEntry, clusterMatch: false });

    const rdr = dates.length >= 1 ? callEngine("learnRecurringDay", [dates]) : null;
    const abr = amounts.length >= 1 ? callEngine("computeAmountBehavior", [amounts]) : null;
    const classification = classifyCommitment({ occurrenceCount: dates.length, recurringDayResult: rdr, amountBehaviorResult: abr });

    const routing = routeCommitment({ identity, classification, autoApplyEnabled: true });

    // Ground truth is recorded per-transaction (all occurrences in a group carry
    // the same groundTruth by construction - see generateDemoData.js), so the
    // group's expected answer is just its first transaction's groundTruth.
    const expected = sample.groundTruth;
    const categoryOk = expected.control === undefined ? true : (identity.hasClassification ? true : expected.category === null);
    const frequencyOk = expected.frequency === undefined || classification.frequency.value === expected.frequency
      || (expected.frequency === "Insufficient" && classification.frequency.confidence === "Insufficient");

    return { merchant: g.merchant, count: g.txns.length, routing, classification, expected, frequencyOk };
  });

  console.log("=== Frequency-tier correctness (given the evidence each group actually has) ===");
  let freqFail = 0;
  results.forEach((r) => {
    if (!r.frequencyOk) {
      freqFail++;
      console.log(`  MISMATCH: ${r.merchant} (${r.count}x) - expected frequency "${r.expected.frequency}", engine said "${r.classification.frequency.value}" (${r.classification.frequency.confidence})`);
    }
  });
  console.log(`${results.length - freqFail}/${results.length} commitment groups match the expected frequency tier.\n`);

  const resolved = results.filter((r) => r.routing.action !== ACTION.UNRESOLVED);
  const wouldAuto = results.filter((r) => r.routing.wouldAutoApply);
  console.log("=== Summary ===");
  console.log(`Commitment groups: ${results.length}`);
  console.log(`Coverage (resolved beyond "unresolved"): ${resolved.length}/${results.length} = ${(resolved.length / results.length * 100).toFixed(1)}%`);
  console.log(`Auto-apply candidates: ${wouldAuto.length}`);
  console.log(`Frequency-tier correctness: ${results.length - freqFail}/${results.length} = ${((results.length - freqFail) / results.length * 100).toFixed(1)}%`);

  console.log("\n=== Every group, for manual review ===");
  results.forEach((r) => {
    console.log(`${r.merchant.padEnd(22)} x${String(r.count).padStart(2)}  action=${r.routing.action.padEnd(11)} freq=${(r.classification.frequency.value || "-").padEnd(10)}(${r.classification.frequency.confidence})`);
  });
}

main();
