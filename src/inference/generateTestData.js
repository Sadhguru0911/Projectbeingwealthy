/**
 * Deterministic, labelled commitment-group test data for accuracy measurement
 * (Inference Engine Phase D, backlog #46). See INFERENCE_ENGINE_DESIGN.md §10.
 *
 * SCOPE NOTE: this is narrower than the full demo dataset the migration plan's
 * onboarding/Home demo needs (#39 - which also requires card, loan, holdings and
 * goal data for the Home/domain screens themselves). Accuracy measurement only
 * needs labelled BANK TRANSACTIONS with a known-correct answer - a genuine subset
 * of #39's scope, buildable now without waiting on the rest.
 *
 * WHAT "GROUND TRUTH" MEANS HERE - important, and easy to get wrong. This does NOT
 * mean "the engine must correctly predict the unknowable future of a merchant from
 * limited history" - no system can honestly do that, and DESIGN.md's entire premise
 * is refusing to pretend otherwise (the single-sighting rule exists specifically to
 * stop the engine from guessing). Ground truth here means two different, both fair,
 * both meaningful things:
 *   1. For known merchants (drawn from the REAL live Merchant Library, not invented
 *      fictional data), does the engine correctly read back the library's own
 *      category - i.e. does identity.js/classify.js correctly consume real library
 *      data without a wiring bug. The library's own correctness was already
 *      reviewed separately (backlog #47); this only tests whether the engine
 *      reads it right.
 *   2. Given N occurrences with a known interval pattern, does the engine produce
 *      the confidence tier DESIGN.md itself specifies for N occurrences (Insufficient
 *      at 1, Medium at 2-regular, High at 3+-regular, Irregular for non-regular
 *      intervals) - i.e. does the pipeline correctly and CONSISTENTLY apply its own
 *      stated rules. This catches implementation bugs, not prediction failures.
 */

// A realistic 12-month history, ending "today" for measurement purposes.
export const HISTORY_END = "2026-09-28";
const MONTHS = ["2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08","2026-09"];

function monthlyDates(day, count) {
  return MONTHS.slice(-count).map((m) => m + "-" + String(day).padStart(2, "0"));
}

/**
 * Each scenario: a raw description pattern (as it would appear on a statement), an
 * amount series, and what SHOULD happen given that evidence. `expectHasClassification`
 * and `expectCategory` are checked only when identity resolves via the real library
 * (case 1 above); `expectFrequencyTierAtEnd` is checked against classify.js's own
 * stated rules for the given occurrence count and interval regularity (case 2).
 */
export const SCENARIOS = [
  // --- Known merchants, clearly Recurring (12 monthly sightings, steady amount) ---
  { id: "zepto-monthly", rawText: "UPI-ZEPTO-9182736450", dates: monthlyDates(12, 12), amounts: Array(12).fill(1200).map((a, i) => a + (i % 3) * 40),
    knownMerchant: "Zepto", expectCategory: "Expense", expectFrequencyTier: "High", expectFrequencyValue: "Recurring" },
  { id: "netflix-monthly", rawText: "NETFLIX.COM 4009", dates: monthlyDates(5, 12), amounts: Array(12).fill(649),
    knownMerchant: "Netflix", expectCategory: "Expense", expectFrequencyTier: "High", expectFrequencyValue: "Recurring" },
  { id: "zerodha-monthly", rawText: "NEFT-ZERODHA BROKING LTD", dates: monthlyDates(7, 12), amounts: Array(12).fill(30000),
    knownMerchant: "Zerodha", expectCategory: "Investment", expectFrequencyTier: "High", expectFrequencyValue: "Recurring" },

  // --- Known merchant, seen twice (6-month interval) - the Asha school-fee case ---
  { id: "school-fee-twice", rawText: "UPI-DPS SCHOOL FEES-778812", dates: ["2025-11-09","2026-05-09"], amounts: [60000, 60000],
    knownMerchant: null, expectCategory: null, expectFrequencyTier: "Medium", expectFrequencyValue: "Recurring" },

  // --- Known merchant, seen ONCE - must stay Insufficient, never guessed ---
  { id: "lenskart-once", rawText: "UPI-LENSKART SOLUTIONS-556213", dates: ["2026-06-14"], amounts: [4200],
    knownMerchant: "Lenskart", expectCategory: "Expense", expectFrequencyTier: "Insufficient", expectFrequencyValue: null },

  // --- Irregular, real spending pattern (eating out) - multiple sightings, no
  // regular interval, varying amounts ---
  { id: "eating-out-irregular", rawText: "UPI-ZOMATO ONLINE-", dates: ["2025-10-04","2025-11-19","2026-01-02","2026-03-28","2026-07-15"], amounts: [1200,3400,800,2100,1800],
    knownMerchant: "Zomato", expectCategory: "Expense", expectFrequencyTier: "Medium", expectFrequencyValue: "Irregular" },

  // --- Category-withheld merchants (Merchant Library v2 overrides, backlog #47) -
  // MUST NEVER resolve a category or auto-apply, REGARDLESS of occurrence count.
  // This is the single most important case for a payment-processor/rail: seeing it
  // 12 times must not wear down the engine's refusal to guess. ---
  // NOTE: frequency IS correctly computed here even though category stays withheld -
  // that is the intended, tested behaviour (identity.js's core principle: WHO and
  // WHAT-TO-DO-ABOUT-IT are independent questions - a payment rail's dates are real
  // evidence about timing even though its category is permanently withheld). Only
  // mustNeverAutoApply is asserted; frequency is deliberately left unchecked here
  // rather than asserting an unnecessarily narrow expectation.
  { id: "razorpay-frequent", rawText: "UPI-RAZORPAY-VARIOUS", dates: monthlyDates(15, 12), amounts: [4500,2200,6100,1800,3300,5000,2700,4100,3900,2200,5600,3100],
    knownMerchant: "Razorpay", expectCategory: null, mustNeverAutoApply: true },
  { id: "phonepe-frequent", rawText: "UPI-PHONEPE-RANDOM MERCHANT", dates: monthlyDates(20, 8), amounts: [500,1200,300,800,2100,150,900,600],
    knownMerchant: "PhonePe", expectCategory: null, mustNeverAutoApply: true },

  // --- Genuinely unknown merchants (not in the library, not a system rule, no
  // fictional invented "brand knowledge" - tests the honest Unresolved path) ---
  { id: "unknown-local-shop-once", rawText: "UPI-SHREE GANESH KIRANA STORE-9988", dates: ["2026-08-02"], amounts: [650],
    knownMerchant: null, expectCategory: null, expectFrequencyTier: "Insufficient", expectFrequencyValue: null },
  // Regression coverage for backlog #48, now fixed: "SERVICE" contains the substring
  // "VI" (ser-VI-ce), the live library's short pattern for Vodafone Idea. Before the
  // fix (word-boundary matching for short patterns, see normalizedPatternMatches in
  // App.jsx), this fictional local tiffin service was misidentified as a telecom
  // bill - found by this exact scenario, not invented after the fact. Kept in the
  // suite permanently so a future regression here is caught immediately.
  { id: "unknown-local-shop-recurring", rawText: "UPI-RAMESH TIFFIN SERVICE-4471", dates: monthlyDates(1, 6), amounts: Array(6).fill(3000),
    knownMerchant: null, expectCategory: null, expectFrequencyTier: "High", expectFrequencyValue: "Recurring" },
];
