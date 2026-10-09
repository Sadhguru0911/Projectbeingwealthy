/**
 * Frequency / Control / Amount classification (Inference Engine Phase B, backlog #46).
 * See INFERENCE_ENGINE_DESIGN.md §3 (single-sighting rule), §6 (mechanics), §6a (the
 * single question mechanism).
 *
 * Same architecture as identity.js (Phase A): a pure module, zero App.jsx dependency.
 * Existing App.jsx functions already do real work correctly and are not duplicated -
 * their results are taken as input:
 *   - learnRecurringDay(dates) - interval/day-of-month pattern detection. Verified
 *     against the real function before writing this file: at ONE sighting it already
 *     returns `recurs: true` (confidenceTier "estimate") - it does NOT itself enforce
 *     the single-sighting rule. This module adds that guard explicitly; it is not a
 *     redundant restatement of something the existing function already does.
 *   - computeAmountBehavior(amounts) - variance-based Fixed/Variable detection. Also
 *     verified before writing this file: it is ALREADY correctly single-sighting-safe
 *     on its own (observationCount < 2 returns "Not Yet Determined", confidence null) -
 *     no gap to fix here, just a vocabulary mapping into this module's shared
 *     {value, confidence, reason} shape so all three dimensions read the same way.
 *
 * The questionnaire's category-level Control prior (moved here from an earlier, now-
 * corrected draft that had the Merchant Library carry it - see DESIGN.md §4/§12) is
 * passed in as plain data (`questionnairePrior`), not fetched by this module. Building
 * the actual UI/storage to collect that answer is separate, larger scope (onboarding,
 * backlog #38) - this module only defines the data shape it consumes.
 */

export const FREQUENCY = { RECURRING: "Recurring", IRREGULAR: "Irregular", ONE_TIME: "One-time" };
export const CONTROL = { COMMITTED: "Committed", FLEXIBLE: "Flexible" };
export const CONFIDENCE = { HIGH: "High", MEDIUM: "Medium", LOW: "Low", INSUFFICIENT: "Insufficient" };

/**
 * Frequency classification. The single-sighting rule (§3) is enforced HERE,
 * explicitly, regardless of what learnRecurringDay's own `recurs` flag says - one
 * occurrence is never enough on its own, however strong any prior is.
 *
 * @param {number} occurrenceCount
 * @param {Object|null} recurringDayResult - learnRecurringDay(dates)'s return value,
 *   or null if not yet computed / not applicable.
 * @param {"confirmed-recurring"|"confirmed-oneoff"|null} personAnswer - the person's
 *   direct answer to "does this repeat?" (§6a). The strongest possible evidence: it
 *   resolves Frequency at High confidence immediately, without waiting for a second
 *   sighting.
 */
function classifyFrequency({ occurrenceCount = 0, recurringDayResult = null, personAnswer = null }) {
  if (personAnswer === "confirmed-recurring") {
    return { value: FREQUENCY.RECURRING, confidence: CONFIDENCE.HIGH, reason: "You told us this repeats." };
  }
  if (personAnswer === "confirmed-oneoff") {
    return { value: FREQUENCY.ONE_TIME, confidence: CONFIDENCE.HIGH, reason: "You told us this was a one-off." };
  }

  // The guard: no amount of prior or pattern-shape can promote a single sighting to
  // Recurring. This deliberately ignores recurringDayResult.recurs at occurrenceCount
  // < 2, because that flag is not single-sighting-aware (see file header).
  if (occurrenceCount < 2) {
    return { value: null, confidence: CONFIDENCE.INSUFFICIENT, reason: "Only seen once so far." };
  }

  const hasPattern = !!(recurringDayResult && recurringDayResult.hasPattern);
  if (!hasPattern) {
    return {
      value: FREQUENCY.IRREGULAR,
      confidence: occurrenceCount >= 3 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
      reason: "Seen " + occurrenceCount + " times, but not on a regular interval.",
    };
  }
  if (occurrenceCount >= 3) {
    return { value: FREQUENCY.RECURRING, confidence: CONFIDENCE.HIGH, reason: "Seen " + occurrenceCount + " times on a steady interval." };
  }
  // occurrenceCount === 2, regular interval: a real pattern, but only two data points -
  // matches DESIGN.md §5's "Medium ... still learning this pattern" tier exactly.
  return { value: FREQUENCY.RECURRING, confidence: CONFIDENCE.MEDIUM, reason: "Seen twice on the same interval - still confirming." };
}

/**
 * Control classification. Per DESIGN.md §6 step 4: questionnaire category answer,
 * else a default (Expense/Variable defaults to Flexible unless told otherwise). No
 * Merchant Library involvement (§4's correction).
 *
 * A prior alone (questionnaire answered, no confirming history) reaches Medium, not
 * High - a stated intention is real evidence, but sustained, unbroken payment history
 * is stronger evidence of something actually being treated as a commitment. This
 * mirrors the same "prior vs. evidence" shape used for Frequency and for identity
 * confidence elsewhere in this engine, applied consistently here too.
 *
 * @param {Object|null} questionnairePrior - { control: "Committed"|"Flexible" } for
 *   this transaction's category, or null if unanswered.
 * @param {number} occurrenceCount
 * @param {boolean} unbrokenHistory - true if every expected occurrence in the
 *   observed window actually happened (no gaps, no reductions) - the caller computes
 *   this from the transaction history; not derived here.
 */
function classifyControl({ questionnairePrior = null, occurrenceCount = 0, unbrokenHistory = false }) {
  if (questionnairePrior && questionnairePrior.control) {
    const confirmed = occurrenceCount >= 3 && unbrokenHistory;
    return {
      value: questionnairePrior.control,
      confidence: confirmed ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM,
      reason: confirmed
        ? "You told us this category is " + questionnairePrior.control.toLowerCase() + ", and history confirms it."
        : "You told us this category is " + questionnairePrior.control.toLowerCase() + ".",
    };
  }
  return {
    value: CONTROL.FLEXIBLE,
    confidence: CONFIDENCE.LOW,
    reason: "No preference given yet - defaulting to flexible.",
  };
}

/**
 * Maps computeAmountBehavior's existing, already-correct return shape into this
 * module's shared {value, confidence, reason} vocabulary. No new logic - see file
 * header for why this dimension needed no fix, only a vocabulary translation.
 */
function classifyAmountBehavior(amountBehaviorResult) {
  if (!amountBehaviorResult || amountBehaviorResult.amountBehavior === "Not Yet Determined") {
    return { value: null, confidence: CONFIDENCE.INSUFFICIENT, reason: "Only seen once so far." };
  }
  const { amountBehavior, confidence, observationCount } = amountBehaviorResult;
  return {
    value: amountBehavior,
    confidence: confidence || CONFIDENCE.LOW,
    reason: amountBehavior === "Fixed"
      ? "Steady amount across " + observationCount + " occurrences."
      : "Amount varies across " + observationCount + " occurrences.",
  };
}

/**
 * Combines all three dimensions for one commitment group. Each dimension is
 * independent, with its own confidence - never blended into one score (a rule
 * already locked for the UI in earlier onboarding work, enforced here at the data
 * layer too, so no caller can accidentally blend them back together).
 */
export function classifyCommitment({
  occurrenceCount = 0,
  recurringDayResult = null,
  personAnswer = null,
  questionnairePrior = null,
  unbrokenHistory = false,
  amountBehaviorResult = null,
} = {}) {
  return {
    frequency: classifyFrequency({ occurrenceCount, recurringDayResult, personAnswer }),
    control: classifyControl({ questionnairePrior, occurrenceCount, unbrokenHistory }),
    amountBehavior: classifyAmountBehavior(amountBehaviorResult),
  };
}

/**
 * §6a: the single question mechanism ("does this repeat?"). Onboarding's inline card
 * and ongoing review's follow-up question are one mechanism - this is that shared
 * trigger condition, used by both. Fires only when the single-sighting rule has
 * already blocked a confident Frequency classification AND the transaction looks
 * significant enough to be worth asking about rather than silently waiting for a
 * second sighting. `isLargeOrUnusual` is computed by the caller (e.g. compared
 * against the person's typical transaction size) rather than guessed here as an
 * absolute rupee figure - this module has no basis to know what counts as large for
 * a given person.
 */
export function shouldAskDoesThisRepeat({ occurrenceCount = 0, isLargeOrUnusual = false, personAnswer = null } = {}) {
  if (personAnswer) return false; // already answered
  return occurrenceCount === 1 && isLargeOrUnusual;
}
