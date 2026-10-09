# Being Wealthy — Inference Engine: Design & Build Plan

Status: design finalized, pending build. This is the reference document for the engine that
sorts a statement automatically. Frictionless onboarding, Home, and "Help me learn" all depend
on it — this is why it is being treated as the core of the app, not a feature alongside it.

---

## 1. Why this exists

A person imports a statement. Every transaction needs, eventually: a Category, a Sub-category,
a Frequency (Recurring / Irregular / One-time), a Control (Committed / Flexible), and an Amount
behaviour (Fixed / Variable). Asking for all five on every transaction is exactly the friction
onboarding is designed to remove.

The engine's job is to get as many of these right as it honestly can, say plainly when it can't,
and never guess in a way that quietly misleads the person or the forecast.

**Governing rule, restated from every other conversation on this app:** it is better to say "I
don't know yet" than to be confidently wrong. A wrong auto-classification that feeds silently
into a forecast is worse than an unclassified transaction sitting in a queue.

---

## 2. The two confidence axes (the piece that was missing)

Two different questions get asked of every transaction, and they must never be merged into one
score:

### 2a. Identity confidence — "What is this, really?"

Bank statement text is noisy: `UPI-3847-SWGY-BLR`, `NEFT/HDFC0001/RENT`, a person's name. Identity
resolution is the step that turns that string into a real-world counterparty — a known brand, a
known person, a known institution — *before* anything is decided about category or behaviour.

Tiers:

| Tier | What it means | Example |
|---|---|---|
| Confirmed | Exact match to a rule already created from this person's own correction, or a linked account | Matches an existing user rule |
| High | Clean match to a Merchant Library pattern, unambiguous | `SWGY` → Swiggy |
| Medium | Matches a text cluster of near-duplicate strings sharing a core signature, not yet confirmed as one entity | `UPI SCAPIA SCAPIA` / `UPI SCAPIA TECHNOLOGY` |
| Low | A library pattern matches loosely, or only a person's name is present | A generic UPI payment to an individual |
| Unresolved | Nothing matches | Anything else |

This axis answers "who/what is this" and nothing else. It does **not** by itself decide Category,
Frequency, or Control.

### 2b. Classification confidence — "How sure am I about Category / Frequency / Control / Amount?"

Once identity is resolved (or accepted as unresolved), each of these four dimensions gets its
**own** confidence, computed from its own evidence. They are shown and corrected independently.

| Dimension | Evidence it depends on |
|---|---|
| Category / Sub-category | Merchant Library prior, rule match, text pattern, identity confidence |
| Frequency | Count of occurrences, regularity of interval, questionnaire prior |
| Control | Category-level questionnaire answer, Merchant Library prior, category norms |
| Amount behaviour | Variance across observed occurrences (existing `computeAmountBehaviors` logic) |

**Why two axes, concretely:** we can be completely sure a transaction is Swiggy (identity:
High) while being quite unsure whether this particular Swiggy charge is a recurring subscription
pattern or an irregular takeaway order (frequency: Low). Conflating the two would show one
confident-looking badge over a shaky classification. Keeping them separate means "Change" on a
review card can target the one thing that's actually uncertain, not force a person to re-decide
everything about a transaction we already know perfectly well.

A transaction's overall review-queue confidence is the **lower** of its identity confidence and
its weakest classification dimension — a great category guess built on an unresolved identity is
still a weak card.

---

## 3. The single-sighting rule

One occurrence is **never** promoted to Frequency = Recurring on its own — not from a large
amount, not from a strong Merchant Library prior (a "typically biannual" library hint on a school
fee does not, by itself, conclude Recurring). Promotion requires either:

- a second sighting with a plausible matching interval, or
- the person's direct answer to "Does this repeat?"

This is why a single big, infrequent-looking payment always generates that question rather than a
silent guess — see §6.

---

## 4. Three sources, one reconciliation

Restating the original architecture, with the two additions above folded in:

```
Merchant Library ──┐
                    ├──► Identity resolution ──► Category/Sub prior
Transaction History ┤
                    ├──► Classification (Frequency, Control, Amount, Category)
Questionnaire ──────┘        with its own confidence
     (also seeds the
      Frequency/Control
      prior, per category)
                              │
                              ▼
                    Auto-classify / Provisional / Ask / Leave unresolved
```

- **Merchant Library** answers "what is this" and carries a *prior* for category/sub only. **Not**
  frequency or control (revised — see §12: an earlier draft of this section had the library carry
  a typical-frequency/control prior per merchant; reviewing the actual Merchant Library data
  showed this conflates two different jobs, and a category-level default belongs with the
  questionnaire below, which already owns category-level priors for exactly this reason). A prior,
  never a conclusion on its own.
- **Questionnaire** answers "how does this person manage this kind of spending" — a prior,
  captured at the category level (see §7), never overriding history that disagrees with it. This
  is also where the frequency/control default lives (Rent-category → typically Recurring,
  Committed; Dining-category → typically Irregular, Flexible) — not in the Merchant Library.
- **Transaction history** is the evidence that validates or challenges both priors.
- **Reconciliation** combines all three, per dimension, into a confidence tier, which then decides
  the automation action (§8).

---

## 5. What already exists vs. what is new

Verified against the actual codebase, not memory:

**Already built:**
- Recurring-day timing inference with confidence tiers (`learnRecurringDay`) — but only ever
  runs on transactions a rule or a person has *already* marked Recurring. It does not discover
  recurrence from raw history.
- Fixed vs. Variable amount behaviour with confidence (`computeAmountBehaviors`).
- A ~80-entry Merchant Library, matched by simple substring, gated by a static per-entry
  confidence field — this is the piece being extended with identity-match tiers and a
  frequency/control prior (§2a, §4).
- Text clustering of near-duplicate merchant strings, and a library-aware clustering pass for
  brands sharing no text (Zepto/Blinkit) — both suggestion-only, never auto-applied.
- Rules (user-typed and learned from corrections), with priority and protected manual overrides.
- A document-type classifier (bank vs. card vs. investment sub-types) at import time.

**Designed, not built:**
- Inferring Frequency and Control from raw history — today these are set by a rule, the person,
  or one-time legacy migration only.
- Identity-match confidence as its own scored axis (§2a).
- Classification confidence for Category (only forecast-pattern confidence exists today).
- Confidence-driven automation — nothing is auto-applied today; every Library/cluster match is a
  suggestion a person must accept.
- The Sorted / Worth a quick look / Need your input summary, and a review queue ordered by
  anything other than amount.
- The questionnaire as a stored, reconcilable prior.

---

## 6. Mechanics: from raw transaction to a decision

For each transaction (or, more precisely, each **commitment group** — see §9 on why grouping
matters before classification):

1. **Resolve identity.** Check rules (Confirmed) → Merchant Library (High/Medium, per §2a) →
   text clusters (Medium) → nothing (Low/Unresolved).
2. **Gather evidence.** Count occurrences of this commitment group, their interval regularity,
   their amount variance.
3. **Apply priors.** The questionnaire's category-level prior (if answered) — the only source of
   a frequency/control prior; see §4's revision. The Merchant Library's prior applies to
   category/sub only.
4. **Classify each dimension**, independently, with its own confidence:
   - **Category/Sub:** from rule → library → cluster → unresolved.
   - **Frequency:** Recurring only with ≥2 regular-interval sightings or a person's answer;
     otherwise Irregular (if interval is clearly not regular) or Insufficient (if only one
     sighting and no questionnaire prior strongly suggests otherwise — in which case a single
     large or unusual sighting escalates to a direct question, §6a).
   - **Control:** from questionnaire category answer → default (Expense/Variable defaults to
     Flexible unless told otherwise). No library involvement — see §4.
   - **Amount behaviour:** existing variance-based logic.
5. **Reconcile with the questionnaire.** If the questionnaire says "groceries are regular" but
   evidence shows one purchase every few months with a large gap, do not silently accept either —
   surface the conflict as a targeted question (this is the doc's existing "conflict" case,
   preserved as-is).
6. **Compute overall confidence** = lowest of (identity/category, Frequency) only. **Not** Control
   or Amount Behaviour (corrected after Phase C's implementation testing surfaced a real problem
   with the original, broader reading of this step - see the note below the mechanics list).
7. **Route by confidence** (§8).

**Why Control and Amount Behaviour don't gate routing.** An earlier version of this step read
"weakest classification dimension" as spanning all four dimensions. Tested against a realistic
scenario before shipping: a well-known merchant (Zepto) with four clean, regular months of
history - category and frequency both genuinely High - still routed to "suggest," not "auto,"
because Control defaults to Low confidence whenever the questionnaire hasn't been answered (§7).
Since the questionnaire doesn't exist as a built feature yet, and even once it does most
categories will go unanswered for a long time, this would leave the Sorted bucket permanently
empty for every real user - the opposite of this engine's entire purpose. The fix: routing
(Sorted / Worth a quick look / Need your input) is gated by category and Frequency only - the two
dimensions the actual review-queue use cases center on throughout this project (a school fee's
category is obvious; it needs review specifically because its Frequency is uncertain). Control and
Amount Behaviour remain fully computed, shown, and used downstream (forecasting, "what could you
cut back on") - they just don't block a transaction from being Sorted. Variable amounts are often
the normal, expected state for a category (groceries, eating out) and should never read as
"needs review" on that basis alone; an unanswered Control question is a profile gap, not a
per-transaction uncertainty, and treating it as one would conflate two different kinds of
"unknown."

### 6a. The single question mechanism

Onboarding's inline "does this repeat?" card and the original document's "Frequency uncertainty"
follow-up question are **one mechanism**, not two. It fires whenever a transaction's amount or
category profile suggests it *could* be a real commitment, but the single-sighting rule (§3)
blocks a confident Frequency classification. It is used identically whether triggered during
first import or ten imports later.

---

## 7. The questionnaire as a prior, not truth

Unchanged from the original document's principle, restated precisely: the questionnaire is
captured at the **category level** ("groceries are usually regular," "dining out I can cut back
on"), never per-merchant. It seeds the prior for every merchant later discovered in that category.
History evidence that contradicts it triggers a targeted question rather than either silently
overriding the person's stated intent or silently ignoring the data.

---

## 8. Automation policy

| Confidence | Action | Counts as |
|---|---|---|
| Confirmed / High | Auto-apply | Sorted |
| Medium | Apply provisionally, flagged, one tap to confirm | Worth a quick look |
| Low | Suggest only, nothing applied | Need your input |
| Insufficient | Leave unclassified, ask only if the amount/context warrants it (§6a) | Need your input |

A correction at any tier **always** becomes a user-specific rule (Confirmed identity going
forward) and is never silently overwritten by a later library or clustering pass — the existing
three-level hierarchy (global library → user rules → transaction override) is preserved exactly.

**The bar before auto-apply ships:** measured precision on the demo dataset's ground-truth labels
must clear an agreed threshold (proposed: ≥98% correct on what actually gets auto-applied,
measured separately from what merely gets suggested) before High-confidence auto-apply is turned
on for real users. Below that bar, High-confidence items still show in Sorted but are not silently
trusted by the forecast without this check passing.

---

## 9. Review queue mechanics

- **Grouped by commitment** (the existing `commitmentGroupKey` — a specific merchant, or an
  account-linked group), not rolled up to a broad category. Category is shown as an attribute on
  the card, not the grouping key.
- **Ordered by financial materiality** (amount × frequency) within a confidence tier, so a
  ₹60,000 twice-yearly item surfaces before a ₹200 uncertain one.
- **Every Low/Medium card names why**: "only two transactions observed," "amount varies by more
  than 15%," etc. — the same how-I-know discipline used everywhere else in this app.
- **Never pre-creates merchant groups** before real statement text exists — reaffirming the
  already-locked decision; this engine only ever reacts to transactions actually imported.

### Onboarding vs. ongoing upload — one mechanism, two honest differences

The mechanism is **identical and literally shared** — same engine, same review card component,
same "does this repeat?" prompts. Never a onboarding-only lookalike. Two deliberate, named
differences:

1. **Framing only.** Onboarding wraps the same screens in first-run copy (privacy trust card, two
   intro questions, "here's your first picture"). A returning person skips the wrapper, not the
   mechanism.
2. **Scope.** Ongoing review is scoped to the new import batch only (`importBatchId` already
   exists in the codebase, currently used only to delete a bad import — reusing it for review
   scope is a small addition, not new infrastructure). A two-year user is never asked to
   re-review their whole history. Onboarding's queue is naturally "the one batch that exists so
   far," so no special-casing is needed there.

---

## 10. Testing and the accuracy bar

The demo dataset (already planned to cover bank, card, loan, holdings, and a goal) carries
**ground-truth labels** for every transaction: what it really is, whether it really repeats, what
it should be classified as. This lets us:

- measure auto-sort **coverage** (% of transactions/commitment groups the engine reaches a
  confident verdict on) and **accuracy** (% of those verdicts that are correct) separately,
- gate High-confidence auto-apply behind the accuracy bar in §8,
- catch regressions automatically whenever the engine changes, the same way `check_css_structure.cjs`
  catches structural regressions today.

A second, lighter check runs against real (redacted) statement data before wider rollout, since a
synthetic dataset cannot fully represent real-world messiness.

---

## 11. What this explicitly does not do

Restating the original document's guardrails, unchanged:

- Never forces Frequency/Control/Amount selection for every category up front.
- Never treats the questionnaire as more reliable than observed history.
- Never invents a classification when evidence is insufficient.
- Never exposes the internal tier names (Confirmed/High/Medium/Low) to the person — only plain
  language, per the translation layer already built.
- Never lets the Merchant Library learn a *specific person's* preference — that always becomes a
  user-specific rule instead (§8).

---

## 12. Merchant Library v2 — identity vs. classification, Merchant Type, processor layer

A separate review of the Merchant Library specifically (139-entry workbook) converged on the same
identity/classification split as §2a/§2b, arrived at independently, plus real additions verified
against the codebase: today's `MERCHANT_LIBRARY` has **one** confidence field covering both "is
this really Zepto" and "should Zepto be Grocery," and card issuers (`SBI CARDS`) are handled by a
separate, disconnected `CARD_ISSUER_PATTERNS` list — exactly the symptom of a missing **Merchant
Type** field.

**Adopted as-is:**
- Split identity confidence from classification confidence (formalizing §2a/§2b as the library's
  own two fields, not just the engine's).
- Add **Merchant Type** (Merchant / Service Provider / Financial Institution / Investment Platform
  / Payment Processor / Payment Aggregator / Card Issuer / Transfer Counterparty / Individual /
  Government / Employer / Unknown). This **replaces** `CARD_ISSUER_PATTERNS`, folding it into one
  typed model instead of a parallel side-list.
- A **payment-processor detection layer** ahead of merchant classification (raw text → processor
  check → merchant extraction → library match), seeded with BillDesk/Razorpay/PayU/Juspay/
  Cashfree/CCAvenue/Pine Labs. A processor match caps identity confidence at Medium, since the real
  merchant is obscured behind it.
- Merchant-specific sub-rules (Amazon Prime vs. Amazon Fresh vs. Amazon.in), generalizing the
  pattern the existing Swiggy / Swiggy Instamart split already uses.
- Keep the library coarse (no deep category trees) and never permanently encode Household vs.
  Personal in it — confirmation that Sub Category 2 is the right home for that, not a new
  mechanism.

**Adopted with a refinement:**
- "Financial Event Type" (Debt Payment, Card Payment, Refund, Fee, Interest, Dividend) is **not** a
  new fourth field — it folds into the existing Category / Sub Category 2 vocabulary, which already
  carries this distinction. A parallel taxonomy would duplicate it.
- "Ambiguity" (Low/Med/High) is **derived** from the identity/classification confidence split, not
  hand-authored — a third opinion that can drift out of sync with the two confidences it
  summarizes is worse than computing it.
- "Requires User Confirmation" is exactly the automation-policy table in §8, using the library's
  two confidences as one more input — not a new mechanism.

**Revises §4's frequency/control prior placement:** rather than the Merchant Library carrying a
per-merchant frequency/control prior directly, the cleaner home for a *category-level* Control
default is the questionnaire's category mapping (§7) — keeps the library doing one job (identity +
classification); behaviour stays owned by questionnaire-prior-plus-history.

**Migration:** existing entries need one pass to add `merchantType` and split the single
`confidence` field into `identityConfidence` / `classificationConfidence` (copying the current
value into both is a sufficient starting point, not a full re-authoring of all ~139 entries by
hand). `CARD_ISSUER_PATTERNS` entries migrate in as `merchantType: "Card Issuer"`.
