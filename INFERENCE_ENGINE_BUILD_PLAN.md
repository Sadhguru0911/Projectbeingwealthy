# Inference Engine — Phase-wise Build Plan

Companion to INFERENCE_ENGINE_DESIGN.md. New logic lives in `src/inference/` — new files, not
edits scattered through `App.jsx` — so every change stays small and reviewable, per the project's
standing change-control discipline.

This track starts immediately (it is logic, not visuals) and runs **alongside**, not after, the
onboarding/Home restyling work. Onboarding's first-run "Sorted / Worth a quick look / Need your
input" screen cannot honestly ship without at least Phase A below.

---

## Phase A — Identity resolution + the two-axis confidence model

**Goal:** every transaction gets an identity tier (§2a), without changing any existing auto-apply
behaviour yet (there is none today — everything stays suggestion-only).

- `src/inference/identity.js`: tiered identity resolution (Confirmed → High → Medium → Low →
  Unresolved), replacing the current binary `findLibraryEntry` match with a scored result.
- **Corrected from an earlier draft of this plan** (see DESIGN.md §4/§12): the Merchant Library
  does NOT gain a frequency/control prior — that field belongs on the questionnaire's
  category-level mapping instead, built in Phase B where it's actually consumed. Phase A stays
  scoped to identity + category/sub only.
- Unit tests against a fixed set of real-world-shaped raw strings (exact match, fuzzy cluster,
  unresolved) with expected tiers.

**Exit check:** every transaction in the demo dataset gets an identity tier; spot-check against
ground truth.

---

## Phase B — Frequency, Control, and Amount classification with per-dimension confidence

**Goal:** the engine can look at a **commitment group's raw history** — not just transactions
already marked Recurring — and produce Frequency, Control, and Amount classifications, each with
its own confidence, honoring the single-sighting rule (§3).

- `src/inference/classify.js`: takes a commitment group's transactions + Merchant Library prior +
  questionnaire prior (if any) → returns `{ category, frequency, control, amountBehavior }`, each
  with its own confidence tier and a plain-language reason.
- Wires into the existing `commitmentGroupKey` grouping — no change to how groups are formed.
- The "does this repeat?" question mechanism (§6a) built once, used by both onboarding and
  ongoing review.

**Exit check:** run against the demo dataset's labelled history at 1/3/6/12 months and confirm the
classification (and its confidence) changes the way §3 and §6 describe as history grows — this is
the same story the onboarding prototype already demonstrates, now backed by real logic instead of
scripted reveals.

---

## Phase C — Overall confidence, automation routing, and the review queue

**Goal:** combine identity/category + Frequency confidence into one routing decision (§8) - not
Control or Amount Behaviour, which remain computed and shown but don't gate routing (see §6's
correction, found and fixed during this phase's own implementation testing) - and build
the review queue exactly as §9 specifies.

- `src/inference/route.js`: `{ action: 'auto' | 'provisional' | 'suggest' | 'unresolved', reason }`.
- Review queue: grouped by commitment, ordered by materiality, every Low/Medium card carries a
  reason string.
- `importBatchId`-scoped review for ongoing imports (§9); unscoped (whole first batch) for
  onboarding — same component, a scope parameter.
- Auto-apply stays **off** behind a flag until Phase D's accuracy bar is measured and cleared.

**Exit check:** the Sorted / Worth a quick look / Need your input counts on a test import match
hand-verified expectations.

---

## Phase D — Accuracy measurement and the auto-apply gate

**Goal:** turn Confirmed/High auto-apply on for real, but only once measured.

- Ground-truth labels finalized on the demo dataset (depends on the demo dataset generator
  existing at sufficient breadth — bank, card, loan, holdings, goal).
- Coverage and accuracy computed and reported separately (§10).
- Auto-apply flag flips on only once accuracy clears the agreed bar (proposed ≥98%, confirm with
  you before this gates anything).
- A second pass against redacted real statement data, since synthetic data cannot fully stand in
  for real-world messiness.

**Exit check:** a documented accuracy number you sign off on, before any auto-apply reaches a real
user.

---

## Phase E — Questionnaire integration and conflict reconciliation

**Goal:** the category-level questionnaire (§7) becomes a real prior, stored, and reconciled
against evidence, including the conflict-surfacing case from the original design document.

- Financial Profile store: category-level answers, stamped "you said."
- Reconciliation: evidence that contradicts a stated prior raises a targeted question rather than
  silently overriding either side.

**Exit check:** the worked example from the original document (person says "shopping is regular,"
history shows sporadic large purchases) produces the documented conflict question, not a silent
guess either way.

---

## Sequencing against the rest of the roadmap

- Phases A–C are logic-only and can proceed in parallel with the visual restyling work (tokens,
  shell, Home) — they do not block each other.
- Onboarding's first-run "We've organised your money" screen needs Phase C at minimum to be
  honest; it should not ship earlier than that.
- Phase D's accuracy bar is a hard gate on auto-apply specifically — everything else (suggestions,
  the review queue, the questionnaire) can ship without waiting for it.
- Phase E can trail behind A–D; the questionnaire enriches priors but nothing else depends on it.

## Open decisions needed from you

1. Confirm the proposed **98% accuracy bar** for auto-apply, or set a different one.
2. Confirm the **demo dataset generator** (bank, card, loan, holdings, goal, with ground-truth
   labels) is being built as part of this track, not assumed to already exist.
3. Whether Phase E (questionnaire) should be pulled earlier — it currently trails because nothing
   else strictly depends on it, but it does affect Control confidence quality sooner if built
   earlier.
