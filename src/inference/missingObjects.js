/**
 * Missing financial object detection (core product philosophy, shared directly:
 * "these transactions reveal the probable existence of a financial object that
 * is missing from the user's model" - the SBI Card example). Generalizes what
 * backlog #52's fix started (evidence-required credit-card/loan suggestions on
 * Home) into the pattern the philosophy actually asks for: compare what the
 * data shows against what the model currently represents, across every object
 * type real evidence exists for - not just the two this project happened to
 * build first.
 *
 * Deliberately NOT overengineered (the philosophy's own instruction, §13):
 * simple observable evidence -> robust inference -> confidence -> explainable
 * surfacing. No opaque scores, no ML - every result names exactly which real
 * transactions it's based on, and the confidence tier is derived from a small,
 * inspectable rule, never a black box.
 *
 * Every result keeps Observation / Inference / Confidence / Action as separate
 * fields (philosophy §8), never blurred into one sentence:
 *   evidenceCount + sampleDescriptions = the OBSERVATION (what was actually seen)
 *   title                              = the INFERENCE (what it probably means)
 *   confidence                         = how sure, and why
 *   action (nullable)                  = what to do about it - null when no real
 *                                         destination exists yet (see insurance,
 *                                         below) rather than a button to nowhere
 */

export const OBJECT_TYPE = { CREDIT_CARD: "creditCard", LOAN: "loan", INVESTMENT: "investment", INSURANCE: "insurance", BANK_ACCOUNT: "bankAccount" };

function groupByKey(items, keyFn) {
  const groups = {};
  items.forEach((it) => { const k = keyFn(it); if (!groups[k]) groups[k] = []; groups[k].push(it); });
  return groups;
}

/**
 * @param {Array} transactions - real transactions (still used directly by
 *   investment/insurance detection below, and to resolve sample descriptions
 *   for commitment-based evidence).
 * @param {Array} commitments - computeRecurringCommitments()'s real output -
 *   card/loan detection is now built ENTIRELY on this, not on scanning raw
 *   transaction text (see the rebuild note below).
 * @param {Object} accountFlags - { trackedCardIssuers, hasLoan, trackedInvestmentPlatforms } -
 *   what the model already represents, computed by the caller from real
 *   accounts. Card and investment are PER-ENTITY (an array of canonical names
 *   already tracked - e.g. ["HDFC"]), not a blanket boolean - found and fixed
 *   after direct feedback: a blanket "do you have ANY credit card account"
 *   check meant that once ANY card was tracked, every OTHER real, different,
 *   untracked card went completely undetected forever.
 * @param {function} matchCardIssuer - (text) => { name, isIntermediary } | null,
 *   real evidence via CARD_ISSUER_PATTERNS (the caller supplies this, since it
 *   lives in App.jsx). `isIntermediary` (e.g. CRED - a payment app that can
 *   settle any card, not an issuer itself) matters here: matching it is real
 *   evidence of SOME card, never grounds to name a specific, possibly-wrong
 *   issuer.
 * @param {function} matchLibraryEntry - (description) => library entry | null,
 *   real evidence via the live Merchant Library.
 */
export function detectMissingObjects({ transactions, commitments, accountFlags, matchCardIssuer, matchLibraryEntry }) {
  const results = [];
  const trackedCards = new Set((accountFlags.trackedCardIssuers || []).map((n) => n.toLowerCase()));
  const trackedPlatforms = new Set((accountFlags.trackedInvestmentPlatforms || []).map((n) => n.toLowerCase()));
  const txnById = {};
  (transactions || []).forEach((t) => { if (t.id) txnById[t.id] = t; });

  // --- Card and loan: REBUILT, after direct, specific false positives were
  // reported against real data - peer-to-peer transfers naming a recipient's
  // bank (e.g. "SAMEER GUPTA KOTAK MAHINDRA BANK") were being read as card-
  // issuer evidence, purely because the bank's name appeared somewhere in the
  // raw text, with no check on what KIND of transaction it even was. The real
  // recurring-commitment engine (computeRecurringCommitments) already
  // classifies this correctly and with real confidence tiers ("Well-
  // established pattern" for SBI Card, confirmed directly against the
  // person's own Recurring screen) - that engine is now the ONLY evidence
  // source here. A commitment already classified Transfer/Debt Payment, with
  // no linked account, is real, validated, interval-confirmed evidence; an
  // incidental bank name inside an ordinary transfer's text is not, and is no
  // longer consulted at all. ---
  {
    const debtCommitments = (commitments || []).filter((c) => c.category === "Transfer" && c.subCategory === "Debt Payment" && !c.linkedAccountId);
    debtCommitments.forEach((c) => {
      if (c.occurrenceCount < 2) return; // single-sighting rule, same as everywhere else in this engine
      const sampleDescriptions = (c.transactionIds || []).slice(0, 3).map((id) => txnById[id]?.description).filter(Boolean);
      const established = c.pattern && (c.pattern.confidenceTier === "confirmed" || c.pattern.confidenceTier === "established");
      const confidence = established ? "High" : "Medium";
      const issuer = matchCardIssuer(c.name) || matchCardIssuer(c.rawMerchant);

      if (issuer && !issuer.isIntermediary) {
        // A real, nameable issuer - the strongest, most specific case.
        if (trackedCards.has(issuer.name.toLowerCase())) return; // this specific issuer already tracked
        results.push({
          type: OBJECT_TYPE.CREDIT_CARD, name: issuer.name,
          title: `${issuer.name}: ${c.occurrenceCount} payments, and nothing behind them yet`,
          body: `You have paid ${issuer.name} ${c.occurrenceCount} times, but all I can see is the money leaving your bank, not what it was for. Add the card's statement and those payments become real spending, with what you bought and what is still owed.`,
          evidenceCount: c.occurrenceCount, sampleDescriptions, confidence,
          action: { label: `Add ${issuer.name} statement`, act: "addStatement" },
        });
        return;
      }

      const loanLike = /\b(emi|loan)\b/i.test(c.name || "") || /\b(emi|loan)\b/i.test(c.rawMerchant || "");
      if (loanLike) {
        if (accountFlags.hasLoan) return;
        results.push({
          type: OBJECT_TYPE.LOAN, name: "loan",
          title: "An EMI with no loan behind it",
          body: `${c.name} has gone out ${c.occurrenceCount} times as an EMI. Add the loan and I can show how much is still owed and when it ends, which changes what I forecast.`,
          evidenceCount: c.occurrenceCount, sampleDescriptions, confidence,
          action: { label: "Add loan schedule", act: "addStatement" },
        });
        return;
      }

      // Neither a nameable issuer nor a loan keyword - including an
      // intermediary match like CRED, which is real evidence of SOME card but
      // never grounds to guess which one. Ask the honest, generic question
      // instead of naming a possibly-wrong issuer from an incidental mention
      // elsewhere in the text (the exact failure mode reported: a CRED
      // payment's UPI handle happening to mention Axis Bank was read as
      // "you have an Axis card").
      results.push({
        type: OBJECT_TYPE.CREDIT_CARD, name: c.name,
        title: "A card I can't name is being paid",
        body: `${c.name} looks like a card bill (${c.occurrenceCount} payments), but I can't tell which card. Add its statement and I can show what the spending was and what is left to pay.`,
        evidenceCount: c.occurrenceCount, sampleDescriptions, confidence: "Medium", // never High - identity is genuinely uncertain here
        action: { label: "Add credit card", act: "addStatement" },
      });
    });
  }

  // --- Investment platform: real, previously-unused evidence - the Merchant
  // Library already types ~20 real platforms (Zerodha, Groww, mutual fund
  // houses, NPS, digital gold...) as "Investment Platform". A recurring debit
  // to one of these, with no demat/investment account represented, is exactly
  // the "missing object" pattern the philosophy describes - this was sitting
  // in already-built data, unused, until this pass. ---
  {
    // Deliberately NOT direction-filtered, unlike card/loan/insurance: a
    // redemption (credit) is just as real evidence of an investment relationship
    // with this platform as a contribution (debit) is - both indicate the person
    // actually holds something there. Direction only matters where one direction
    // would mean something entirely different (a premium vs. a commission, an
    // EMI vs. a refund) - that's not true here.
    //
    // Filtered on the TRANSACTION's own `linkedAccountId`, not just the
    // separate account-nickname-vs-Merchant-Library name match (`trackedPlatforms`,
    // below) - found directly: a real Axis Mutual Fund holding, correctly
    // tracked under a real `mutualFund`-type account, was still wrongly
    // suggested as missing, because the ACCOUNT's own nickname didn't happen
    // to textually resemble "Axis Mutual Fund" the way the Merchant Library
    // names it in transaction text - an unreliable coincidence to depend on.
    // A transaction already linked to a real account is real, structural
    // evidence the relationship is already represented, regardless of what
    // that account happens to be called - the exact same principle already
    // used for card/loan detection above (`!c.linkedAccountId`), applied
    // here at the transaction level since investment detection has no
    // commitment-level check to lean on.
    const invHits = transactions.filter((t) => !t.linkedAccountId).map((t) => ({ t, entry: matchLibraryEntry(t.description) })).filter((x) => x.entry && x.entry.merchantType === "Investment Platform");
    const byPlatform = groupByKey(invHits, (x) => x.entry.merchant);
    Object.entries(byPlatform).forEach(([name, hits]) => {
      if (hits.length < 2) return;
      if (trackedPlatforms.has(name.toLowerCase())) return; // this specific platform already tracked - others may not be
      results.push({
        type: OBJECT_TYPE.INVESTMENT,
        name,
        title: `${name}: money goes in, but I can't see what it became`,
        body: `${hits.length} payments went to ${name}. Add its statement and your net worth will include what they have grown to.`,
        evidenceCount: hits.length,
        sampleDescriptions: hits.slice(0, 3).map((x) => x.t.description),
        confidence: hits.length >= 4 ? "High" : "Medium",
        action: { label: "Add investments", act: "addStatement" },
      });
    });
  }

  // --- Another bank account: money repeatedly moved to / from an account of the person's own (a "Self" transfer) that no account stands for.
  // Needs two or more sightings, like every other detector here. ---
  {
    const selfHits = (transactions || []).filter((t) => t.category === "Transfer" && t.subCategory === "Self" && !t.linkedAccountId);
    const byOther = groupByKey(selfHits, (t) => (t.merchant || t.description || "").toString());
    Object.entries(byOther).forEach(([name, hits]) => {
      if (hits.length < 2) return;
      results.push({
        type: OBJECT_TYPE.BANK_ACCOUNT, name,
        title: "Money moves to an account I can't see",
        body: `${hits.length} transfers go to ${name}, which looks like another account of yours. Add its statement and the transfers match up, so they stop looking like money that left.`,
        evidenceCount: hits.length, sampleDescriptions: hits.slice(0, 3).map((t) => t.description),
        confidence: hits.length >= 4 ? "High" : "Medium",
        action: { label: "Add that account's statement", act: "addStatement" },
      });
    });
  }

  // --- Insurance: real evidence exists (10 real insurer entries in the
  // library), but deliberately surfaced WITHOUT an `action` - there is
  // currently no insurance/protection object type anywhere in this app's data
  // model, so "Add your policy" would be a button pointing at a screen that
  // does not exist. Per the philosophy's own instruction (§12: "if a data
  // model captures facts but cannot create relationships, tell me"), this is
  // recorded as a real, named gap (backlog #53) rather than papered over with
  // a non-functional CTA. Annual-cadence items genuinely may show only ONE
  // occurrence within typical imported history - a single real library match
  // is still worth surfacing, at Low confidence and framed as observational
  // only, not the same 2-sighting bar the others use (which exists to guard
  // against false patterns, not against genuinely-rare-but-real annual bills). ---
  {
    // Direction-checked (unlike the investment case above) because this
    // specific bug was reported directly: a CREDIT from an insurer - commission
    // income, not a premium - matched the same Merchant Library entry
    // ("HDFC ERGO", tagged Insurance Premium for its far more common use as
    // something a person PAYS) and was wrongly surfaced as "you appear to hold
    // a policy." The library entry describes the merchant; it says nothing
    // about which direction THIS transaction moved, and the two mean entirely
    // different things.
    const insHits = transactions.filter((t) => t.direction === "debit").map((t) => ({ t, entry: matchLibraryEntry(t.description) })).filter((x) => x.entry && (x.entry.group || "").toLowerCase().includes("insurance premium"));
    const byInsurer = groupByKey(insHits, (x) => x.entry.merchant);
    Object.entries(byInsurer).forEach(([name, hits]) => {
      results.push({
        type: OBJECT_TYPE.INSURANCE,
        name,
        title: `You appear to hold a ${name} policy`,
        body: `We noticed ${hits.length} payment${hits.length === 1 ? "" : "s"} to ${name}. Being Wealthy doesn't yet have a way to track insurance policies as their own object - this is an observation only.`,
        evidenceCount: hits.length,
        sampleDescriptions: hits.slice(0, 3).map((x) => x.t.description),
        confidence: hits.length >= 2 ? "Medium" : "Low",
        action: null,
      });
    });
  }

  // Prioritized by confidence then evidence count (materiality proxy) - never
  // shown as an undifferentiated list, per the philosophy's own instruction
  // (§7) that intelligence must rank, not just enumerate.
  const rank = { High: 0, Medium: 1, Low: 2 };
  return results.sort((a, b) => (rank[a.confidence] - rank[b.confidence]) || (b.evidenceCount - a.evidenceCount));
}
