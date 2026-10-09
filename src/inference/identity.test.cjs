/**
 * Unit tests for identity.js (Inference Engine Phase A). Plain Node, no bundling -
 * identity.js has zero App.jsx dependency by design (see its header comment), so
 * this can run directly, unlike golden/ which specifically needs to load the real
 * compiled App.jsx.
 *
 * Run: node src/inference/identity.test.cjs
 */
const assert = require("assert");

async function main() {
  const { resolveIdentity, IDENTITY_TIER, tierAtLeast } = await import("./identity.js");

  let pass = 0, fail = 0;
  function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { pass++; }
    else { fail++; console.log("FAIL:", label, "\n  expected:", JSON.stringify(expected), "\n  actual:  ", JSON.stringify(actual)); }
  }

  // --- Confirmed: a linked account (a structural fact, stronger than any text
  // match) - found missing entirely during Phase D testing at realistic scale, not
  // present in the original design review. Must win even when a rule/library match
  // is ALSO present (an EMI transaction could easily also match a generic "EMI"
  // system rule - the linked account should still take precedence). ---
  check(
    "a linked account -> Confirmed, regardless of any other match present",
    resolveIdentity({
      linkedAccountName: "Home Loan",
      ruleMatch: { source: "system", pattern: "emi" },
      libraryEntry: { merchant: "Some Bank", identityConfidence: "Medium", category: "Expense" },
    }).tier,
    IDENTITY_TIER.CONFIRMED
  );
  check("...and reports the account name as its label", resolveIdentity({ linkedAccountName: "Sample Card" }).label, "Sample Card");
  check("...and always carries a classification (a linked-account transaction is never ambiguous)", resolveIdentity({ linkedAccountName: "Home Loan" }).hasClassification, true);

  // --- Confirmed: a person's own rule, either typed or learned from a correction ---
  check(
    "user-typed rule -> Confirmed",
    resolveIdentity({ ruleMatch: { source: "user", pattern: "my landlord" } }).tier,
    IDENTITY_TIER.CONFIRMED
  );
  check(
    "learned rule (from a past correction) -> Confirmed",
    resolveIdentity({ ruleMatch: { source: "learned", pattern: "decathlon" } }).tier,
    IDENTITY_TIER.CONFIRMED
  );

  // --- High: system seed rule, or library match with High identity confidence ---
  check(
    "system seed rule -> High",
    resolveIdentity({ ruleMatch: { source: "system", pattern: "rent" } }).tier,
    IDENTITY_TIER.HIGH
  );
  check(
    "library match, identityConfidence High -> High",
    resolveIdentity({ libraryEntry: { merchant: "Zepto", identityConfidence: "High", category: "Expense" } }).tier,
    IDENTITY_TIER.HIGH
  );

  // --- The important case: identity confidence is independent of classification
  // availability. A category:null library entry (Razorpay, PhonePe, LIC - Merchant
  // Library v2, backlog #47) must still resolve identity at High if its
  // identityConfidence says High - we can be completely sure WHO this is while
  // being completely unsure WHAT CATEGORY it belongs in. These are different
  // questions; conflating them would be a real bug, not just a style choice. ---
  check(
    "category:null library entry (Razorpay-style) still resolves identity at High",
    resolveIdentity({ libraryEntry: { merchant: "Razorpay", identityConfidence: "High", category: null } }).tier,
    IDENTITY_TIER.HIGH
  );
  check(
    "...and correctly reports hasClassification: false for that same entry",
    resolveIdentity({ libraryEntry: { merchant: "Razorpay", identityConfidence: "High", category: null } }).hasClassification,
    false
  );

  // --- Medium: library Medium confidence, or a fuzzy text-cluster match with no
  // brand knowledge behind it at all ---
  check(
    "library match, identityConfidence Medium -> Medium",
    resolveIdentity({ libraryEntry: { merchant: "Decathlon", identityConfidence: "Medium", category: "Expense" } }).tier,
    IDENTITY_TIER.MEDIUM
  );
  check(
    "text-cluster match only, no library/rule backing -> Medium",
    resolveIdentity({ clusterMatch: true }).tier,
    IDENTITY_TIER.MEDIUM
  );

  // --- Unresolved: nothing matched at all ---
  check(
    "nothing provided -> Unresolved",
    resolveIdentity({}).tier,
    IDENTITY_TIER.UNRESOLVED
  );
  check(
    "explicit nulls/false -> Unresolved",
    resolveIdentity({ ruleMatch: null, libraryEntry: null, clusterMatch: false }).tier,
    IDENTITY_TIER.UNRESOLVED
  );

  // --- Precedence: a Confirmed rule wins even if a library entry is ALSO present
  // (e.g. the person overrode what the library would have suggested) ---
  check(
    "user rule takes precedence over an also-present library match",
    resolveIdentity({
      ruleMatch: { source: "user", pattern: "my gym" },
      libraryEntry: { merchant: "CultFit", identityConfidence: "High", category: "Expense" },
    }).tier,
    IDENTITY_TIER.CONFIRMED
  );
  check(
    "...and reports the rule's label, not the library's",
    resolveIdentity({
      ruleMatch: { source: "user", pattern: "my gym" },
      libraryEntry: { merchant: "CultFit", identityConfidence: "High", category: "Expense" },
    }).label,
    "my gym"
  );

  // --- tierAtLeast helper: ordering sanity ---
  check("Confirmed is at least High", tierAtLeast(IDENTITY_TIER.CONFIRMED, IDENTITY_TIER.HIGH), true);
  check("Medium is NOT at least High", tierAtLeast(IDENTITY_TIER.MEDIUM, IDENTITY_TIER.HIGH), false);
  check("a tier is always at least itself", tierAtLeast(IDENTITY_TIER.LOW, IDENTITY_TIER.LOW), true);

  console.log(`\n${pass}/${pass + fail} passed.`);
  if (fail > 0) process.exit(1);
}

main();
