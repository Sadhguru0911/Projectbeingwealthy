/**
 * Identity resolution (Inference Engine Phase A, backlog #46).
 * See INFERENCE_ENGINE_DESIGN.md §2a, §6 step 1.
 *
 * Answers exactly one question: "how sure are we WHO this transaction is with" —
 * never "what should we do about it." Category/sub classification, frequency,
 * control and amount behaviour are separate questions with their own confidence,
 * built in later phases (§4's reconciliation model). Deliberately does not import
 * anything from App.jsx: App.jsx's existing matchRule() and findLibraryEntry()
 * already do the actual text matching correctly and are not duplicated here (that
 * would risk the two copies drifting apart) - this module takes their RESULTS as
 * plain input and only does the tier-assignment/scoring layer on top. This also
 * keeps identity.js a pure, dependency-free module: no circular import risk with
 * App.jsx, and trivially unit-testable with plain fixture objects, no bundling
 * step required (unlike golden/, which specifically exists to test App.jsx's own
 * internals and therefore does need to load the real compiled file).
 *
 * Tiers, strongest to weakest:
 *   Confirmed  - a rule this specific person made or corrected (source "user" or
 *                "learned"). The strongest possible signal: a direct, deliberate
 *                instruction from this person, not pre-authored generic knowledge.
 *   High       - a system seed rule (source "system"), or a Merchant Library match
 *                with identityConfidence "High". Both are pre-authored (not
 *                person-specific) but exact, vetted pattern matches.
 *   Medium     - a Merchant Library match with identityConfidence "Medium", or a
 *                text-cluster match (near-duplicate merchant strings grouped by
 *                shared substring, with no brand knowledge behind them at all).
 *   Low        - reserved for a future weaker signal source; not reachable from
 *                today's inputs, kept as an explicit tier rather than silently
 *                folded into Unresolved, per DESIGN.md's confidence-tier table.
 *   Unresolved - nothing matched.
 *
 * IMPORTANT: identity tier is about WHO, not WHAT TO DO. A Merchant Library entry
 * with category === null (Merchant Library v2, backlog #47 - Razorpay, PhonePe,
 * LIC, and others where classification is deliberately withheld) still resolves
 * identity at whatever its identityConfidence says - we may be completely sure
 * this is Razorpay while being completely unsure what category it belongs in.
 * Conflating the two would silently downgrade a confident identity match just
 * because classification happens to be withheld, which is a different, later
 * question (see DESIGN.md §4's reconciliation model, and §8's automation policy,
 * which is where category-availability actually matters).
 */

export const IDENTITY_TIER = {
  CONFIRMED: "Confirmed",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNRESOLVED: "Unresolved",
};

// A GAP FOUND BY TESTING AT REALISTIC SCALE (src/demo/measureAccuracyAtScale.cjs),
// not by design review: a transaction with a linkedAccountId (e.g. an EMI payment
// linked to its own loan account, a card bill linked to its own card account) is
// the STRONGEST identity signal the real app has - stronger than any text pattern,
// since it's a structural fact about the transaction, not a guess from its
// description. App.jsx's own describeDebtPayment already treats this as its most
// trusted tier ("linked account - use its own nickname, fully trustworthy"), but
// Phase A never gave resolveIdentity a way to receive or honour it, meaning every
// linked-account transaction was falling through to Unresolved - not because
// nothing recognized it, but because nothing was ASKED to.

const TIER_ORDER = [
  IDENTITY_TIER.CONFIRMED,
  IDENTITY_TIER.HIGH,
  IDENTITY_TIER.MEDIUM,
  IDENTITY_TIER.LOW,
  IDENTITY_TIER.UNRESOLVED,
];

/** True if tier a is at least as strong as tier b. */
export function tierAtLeast(a, b) {
  return TIER_ORDER.indexOf(a) <= TIER_ORDER.indexOf(b);
}

/**
 * @param {Object} inputs
 * @param {string|null} inputs.linkedAccountName - the nickname of the account this
 *   transaction is structurally linked to (e.g. "Home Loan", "Sample Card"), if
 *   any. The strongest possible signal - checked first, ahead of any rule or
 *   library match. Always carries a category (a linked-account transaction is, by
 *   construction, a debt payment / transfer to that account - never ambiguous).
 * @param {Object|null} inputs.ruleMatch - the result of App.jsx's matchRule(), or
 *   null. Only `.source` and `.pattern` are read here.
 * @param {Object|null} inputs.libraryEntry - the result of App.jsx's
 *   findLibraryEntry(), or null. Only `.merchant`, `.identityConfidence` and
 *   `.category` are read here (category only to report a "classification also
 *   available" flag, never to affect the tier itself - see the header comment).
 * @param {boolean} inputs.clusterMatch - true if this raw text was matched into a
 *   text-based near-duplicate cluster (no library or rule backing).
 * @returns {{ tier: string, source: string, label: string, reason: string,
 *             hasClassification: boolean }}
 */
export function resolveIdentity({ linkedAccountName = null, ruleMatch = null, libraryEntry = null, clusterMatch = false } = {}) {
  if (linkedAccountName) {
    return {
      tier: IDENTITY_TIER.CONFIRMED,
      source: "linkedAccount",
      label: linkedAccountName,
      reason: "This is a payment toward your " + linkedAccountName + " account.",
      hasClassification: true,
    };
  }
  if (ruleMatch && (ruleMatch.source === "user" || ruleMatch.source === "learned")) {
    return {
      tier: IDENTITY_TIER.CONFIRMED,
      source: "rule:" + ruleMatch.source,
      label: ruleMatch.pattern,
      reason: ruleMatch.source === "user"
        ? "You created a rule for this."
        : "Learned from a correction you made before.",
      hasClassification: true, // a rule always carries a category by construction
    };
  }

  if (ruleMatch && ruleMatch.source === "system") {
    return {
      tier: IDENTITY_TIER.HIGH,
      source: "rule:system",
      label: ruleMatch.pattern,
      reason: "Matches a known keyword pattern.",
      hasClassification: true,
    };
  }

  if (libraryEntry && libraryEntry.identityConfidence === "High") {
    return {
      tier: IDENTITY_TIER.HIGH,
      source: "library",
      label: libraryEntry.merchant,
      reason: "Recognized as " + libraryEntry.merchant + ".",
      hasClassification: libraryEntry.category != null,
    };
  }

  if (libraryEntry && libraryEntry.identityConfidence === "Medium") {
    return {
      tier: IDENTITY_TIER.MEDIUM,
      source: "library",
      label: libraryEntry.merchant,
      reason: "Looks like " + libraryEntry.merchant + ", but worth a glance.",
      hasClassification: libraryEntry.category != null,
    };
  }

  if (clusterMatch) {
    return {
      tier: IDENTITY_TIER.MEDIUM,
      source: "cluster",
      label: null,
      reason: "Text matches other transactions you've already grouped.",
      hasClassification: false,
    };
  }

  return {
    tier: IDENTITY_TIER.UNRESOLVED,
    source: "none",
    label: null,
    reason: "Nothing recognized this.",
    hasClassification: false,
  };
}
