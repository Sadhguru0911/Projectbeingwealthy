/**
 * Tests for homeTrafficControl.js. Plain Node, no bundling.
 * Rewritten after direct feedback that "one Next Step slot, everything else
 * into a 3-item Attention overflow" silently dropped real findings - a real,
 * well-established missing-card finding lost a scoring competition against
 * an unrelated cash-dip warning for the same handful of slots. Rebuilt as two
 * independently-ranked lists: nextSteps (has an action - a thing to DO,
 * uncapped) and attention (no action - a thing that HAPPENED, capped).
 * Run: node src/inference/homeTrafficControl.test.cjs
 */
async function main() {
  const { selectHomeFeed, fromKnowledgeItem, cashDipCandidate, cardBillDueCandidate, goalShortfallCandidate } = await import("./homeTrafficControl.js");

  let pass = 0, fail = 0;
  function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) pass++;
    else { fail++; console.log("FAIL:", label, "\n  expected:", JSON.stringify(expected), "\n  actual:  ", JSON.stringify(actual)); }
  }

  const fakeKnowledgeItem = (id, score, hasAction = true) => ({
    id, claim: { title: `Item ${id}`, description: "..." },
    priority: { score }, action: hasAction ? { label: "Do something", act: "upload" } : null,
    evidence: [],
  });

  // --- REGRESSION (the real reported bug): four real, actionable findings
  // must ALL appear as next steps, never truncated by competing against
  // unrelated risk signals for a shared handful of slots. ---
  const fourCards = ["sbi", "scapia", "cred", "amex"].map((id, i) => fromKnowledgeItem(fakeKnowledgeItem(id, 0.9 - i * 0.05)));
  const dip = cashDipCandidate({ date: "2026-12-01", amount: "x", cushionDelta: "y" }); // no action
  const feed1 = selectHomeFeed([...fourCards, dip]);
  check("all four real actionable findings appear as next steps - none silently dropped", feed1.nextSteps.length, 4);
  check("the cash dip (no action) never displaces a real next step - it's a different list entirely", feed1.attention.length, 1);
  check("next steps are ranked by score, highest first", feed1.nextSteps.map((c) => c.id), ["sbi", "scapia", "cred", "amex"]);

  // --- A candidate with no action NEVER appears in nextSteps, regardless of score ---
  const insurance = fromKnowledgeItem(fakeKnowledgeItem("ins-1", 0.95, false)); // highest score, no action
  const loan = fromKnowledgeItem(fakeKnowledgeItem("loan-1", 0.5, true));
  const feed2 = selectHomeFeed([insurance, loan]);
  check("an action-less candidate, even at the highest score, never appears in nextSteps", feed2.nextSteps.map((c) => c.id), ["loan-1"]);
  check("...it appears in attention instead", feed2.attention.map((c) => c.id), ["ins-1"]);

  // --- attention stays capped (unlike nextSteps) - it's meant to stay a short summary ---
  const manyRiskSignals = [1, 2, 3, 4, 5].map((n) => cardBillDueCandidate({ title: `t${n}`, body: "b" }));
  const feed3 = selectHomeFeed(manyRiskSignals, { attentionLimit: 3 });
  check("attention respects its cap even with more real signals available", feed3.attention.length, 3);
  check("nextSteps has no such cap", feed3.nextSteps.length, 0);

  // --- empty input ---
  const feed4 = selectHomeFeed([]);
  check("no candidates -> empty next steps", feed4.nextSteps, []);
  check("no candidates -> empty attention", feed4.attention, []);

  // --- normalizers still produce the expected shape ---
  check("cardBillDueCandidate has no action (a risk signal, not a thing to configure)", cardBillDueCandidate({ title: "t", body: "b" }).action, null);
  check("goalShortfallCandidate score is lower than a card-bill reminder", goalShortfallCandidate({ title: "t", body: "b" }).score < cardBillDueCandidate({ title: "t", body: "b" }).score, true);

  console.log(`\n${pass}/${pass + fail} passed.`);
  if (fail > 0) process.exit(1);
}

main();
