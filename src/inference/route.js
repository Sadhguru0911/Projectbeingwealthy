/**
 * Automation routing and review queue mechanics (Inference Engine Phase C, backlog
 * #46). See INFERENCE_ENGINE_DESIGN.md §6 steps 6-7, §8, §9.
 *
 * Same architecture as Phases A/B: pure, zero App.jsx dependency. Combines the
 * outputs of identity.js (Phase A) and classify.js (Phase B) - imported from those
 * sibling modules, never from App.jsx.
 */

import { IDENTITY_TIER } from "./identity.js";
import { CONFIDENCE } from "./classify.js";

export const ACTION = {
  AUTO: "auto",             // Sorted
  PROVISIONAL: "provisional", // Worth a quick look
  SUGGEST: "suggest",         // Need your input
  UNRESOLVED: "unresolved",   // Need your input (nothing to suggest yet)
};

// One combined ranking across both vocabularies (identity's tiers and classify.js's
// per-dimension confidence) - DESIGN.md §6 step 6 explicitly calls for ONE overall
// confidence spanning identity AND classification, not two separate decisions. Lower
// number = stronger. Insufficient and Unresolved are deliberately the same rank: both
// mean "nothing to act on," whichever vocabulary produced them.
const RANK = {
  [IDENTITY_TIER.CONFIRMED]: 0,
  [IDENTITY_TIER.HIGH]: 1,
  [CONFIDENCE.HIGH]: 1,
  [IDENTITY_TIER.MEDIUM]: 2,
  [CONFIDENCE.MEDIUM]: 2,
  [IDENTITY_TIER.LOW]: 3,
  [CONFIDENCE.LOW]: 3,
  [IDENTITY_TIER.UNRESOLVED]: 4,
  [CONFIDENCE.INSUFFICIENT]: 4,
};

function rankOf(tier) { return RANK[tier] !== undefined ? RANK[tier] : 4; }

/** The weakest (highest-rank) tier among the given list. Ties keep the first one
 *  encountered, so callers that check tier-of-each-dimension against the returned
 *  weakest value still find at least one true match even when several dimensions
 *  tie for weakest. */
function weakestTier(tiers) {
  return tiers.reduce((worst, t) => (rankOf(t) > rankOf(worst) ? t : worst), tiers[0]);
}

const ACTION_BY_TIER = {
  [IDENTITY_TIER.CONFIRMED]: ACTION.AUTO,
  [CONFIDENCE.HIGH]: ACTION.AUTO,
  [IDENTITY_TIER.HIGH]: ACTION.AUTO,
  [CONFIDENCE.MEDIUM]: ACTION.PROVISIONAL,
  [IDENTITY_TIER.MEDIUM]: ACTION.PROVISIONAL,
  [CONFIDENCE.LOW]: ACTION.SUGGEST,
  [IDENTITY_TIER.LOW]: ACTION.SUGGEST,
  [CONFIDENCE.INSUFFICIENT]: ACTION.UNRESOLVED,
  [IDENTITY_TIER.UNRESOLVED]: ACTION.UNRESOLVED,
};

/**
 * Combines one commitment group's identity resolution (Phase A) and classification
 * (Phase B) into a single routing decision, per §8's table.
 *
 * Routing is gated by category (via identity) and Frequency ONLY - not Control or
 * Amount Behaviour. This was corrected during this phase's own implementation
 * testing: gating on all four dimensions meant a well-known merchant with a clean,
 * regular history still routed to "suggest" rather than "auto," because Control
 * defaults to Low confidence whenever the (not-yet-built) questionnaire is
 * unanswered - which is true for every category, for every real user, indefinitely.
 * That would leave the Sorted bucket permanently empty, defeating the engine's
 * entire purpose. See DESIGN.md §6's note for the full reasoning. Control and
 * Amount Behaviour are still fully computed and returned (`classification.control`,
 * `classification.amountBehavior` on the input are untouched, and both remain
 * available to the caller/UI) - they simply don't block a transaction from being
 * Sorted, because an unanswered profile question is a different kind of "unknown"
 * from genuine per-transaction uncertainty.
 *
 * @param {Object} identity - resolveIdentity()'s return value.
 * @param {Object} classification - classifyCommitment()'s return value.
 * @param {boolean} autoApplyEnabled - governance gate for Phase D (§8's accuracy
 *   bar). Defaults false: even a tier that computes to "auto" is downgraded to
 *   "provisional" in the returned `action` until this is explicitly turned on, per
 *   Phase C's own stated scope ("auto-apply stays off behind a flag until Phase D's
 *   accuracy bar is measured and cleared"). `wouldAutoApply` still reports the raw,
 *   ungated tier-based answer, because Phase D's accuracy measurement needs to know
 *   what WOULD have been auto-applied in order to measure it - gating only the
 *   effect, never hiding the underlying signal from the one place that needs it.
 */
export function routeCommitment({ identity, classification, autoApplyEnabled = false }) {
  // Category/sub confidence piggybacks on identity's own tier UNLESS classification
  // was deliberately withheld (Merchant Library v2, backlog #47 - Razorpay, PhonePe,
  // LIC, etc: identity can be completely confident while classification is
  // intentionally absent). This is identity.js's own core principle (see its header
  // comment) carried through to the routing layer: a withheld classification caps
  // THIS dimension at Insufficient without ever downgrading identity itself.
  const categoryTier = identity.hasClassification ? identity.tier : CONFIDENCE.INSUFFICIENT;

  // Gating dimensions only - see the function-level comment above for why Control
  // and Amount Behaviour are deliberately excluded here.
  const gatingDims = [
    { name: "category", tier: categoryTier, reason: identity.hasClassification ? identity.reason : "Classification isn't available for " + (identity.label || "this merchant") + " - only what it is, not what category it belongs in." },
    { name: "frequency", tier: classification.frequency.confidence, reason: classification.frequency.reason },
  ];

  const overall = weakestTier(gatingDims.map((d) => d.tier));
  const weakestDims = gatingDims.filter((d) => d.tier === overall);

  const rawAction = ACTION_BY_TIER[overall] || ACTION.UNRESOLVED;
  const wouldAutoApply = rawAction === ACTION.AUTO;
  const action = (rawAction === ACTION.AUTO && !autoApplyEnabled) ? ACTION.PROVISIONAL : rawAction;

  return {
    action,
    wouldAutoApply,
    overall,
    // Named per §9: "every Low/Medium card names why" - the specific weakest link(s),
    // not a generic "confidence is low." Primary reason first for a single-sentence
    // display; the full list for a more detailed view if a caller wants it.
    reason: weakestDims[0].reason,
    reasons: weakestDims.map((d) => d.reason),
    weakestDimensions: weakestDims.map((d) => d.name),
    // Control and Amount Behaviour are informational, not gating - surfaced here so
    // a caller/UI can still show them (and their own confidence) without needing to
    // re-read `classification` separately.
    control: classification.control,
    amountBehavior: classification.amountBehavior,
  };
}

/**
 * Groups an array of routed commitments into the three review buckets (§9),
 * ordered by financial materiality (amount x frequency) within each bucket, so a
 * ₹60,000 twice-yearly item surfaces before a ₹200 uncertain one. Grouping by
 * commitment itself (which specific merchant, or account-linked group) is the
 * caller's job via App.jsx's existing commitmentGroupKey - this function only sorts
 * and buckets whatever groups it is given; it does not form them.
 *
 * @param {Array<{ commitmentKey, routing, amountPerOccurrence, occurrencesPerYear }>} items
 *   `amountPerOccurrence` is the typical amount of a single occurrence (e.g. the
 *   median seen so far), not a running sum - materiality is this annualized
 *   (amountPerOccurrence x occurrencesPerYear), matching §9's own worked example.
 * @param {string|null} importBatchId - when given, scopes materiality display to
 *   this batch only (the caller has already filtered `items` to the batch; this
 *   parameter exists so the returned object can honestly label its own scope,
 *   per §9's onboarding-vs-ongoing distinction - not to do the filtering itself).
 */
export function buildReviewQueue(items, importBatchId = null) {
  const materiality = (it) => it.amountPerOccurrence * (it.occurrencesPerYear || 1);
  const sorted = [...items].sort((a, b) => materiality(b) - materiality(a));

  const buckets = { sorted: [], worthAQuickLook: [], needsYourInput: [] };
  sorted.forEach((it) => {
    if (it.routing.action === ACTION.AUTO) buckets.sorted.push(it);
    else if (it.routing.action === ACTION.PROVISIONAL) buckets.worthAQuickLook.push(it);
    else buckets.needsYourInput.push(it); // suggest + unresolved share the same bucket, per §8's table
  });

  return {
    scope: importBatchId ? "batch" : "all",
    importBatchId,
    ...buckets,
    counts: { sorted: buckets.sorted.length, worthAQuickLook: buckets.worthAQuickLook.length, needsYourInput: buckets.needsYourInput.length },
  };
}
