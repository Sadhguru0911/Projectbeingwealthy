# Being Wealthy — Core Product Philosophy

Shared directly, 30 Sep 2026, as a standing operating principle, not a one-off feature request.
First applied in backlog #54 (generalized missing-financial-object detection). Referenced here so
it's a durable check against every future session, not a memory of one conversation.

## What this is not, and what it is

Not an expense tracker, budgeting app, investment tracker, net-worth calculator, or dashboard of
metrics. Those are inputs and capabilities. **Being Wealthy is a financial intelligence system** —
it builds an increasingly accurate understanding of the person's financial life and continuously
surfaces what matters: facts, patterns, relationships, changes, risks, opportunities.

## The pipeline

`SOURCE → FACT → OBJECT/EVENT → RELATIONSHIP → STATE → PATTERN → INTELLIGENCE → DECISION SUPPORT`

Never stop at "we classified the transaction." Ask what it, together with the person's history,
actually reveals. Never stop at "we detected a recurring payment." Ask what financial object,
commitment, or relationship the pattern represents.

## The standing example: missing financial objects

If transactions show recurring SBI Card payments but no SBI Card account is tracked, the insight
isn't "SBI Card is a merchant" — it's "these transactions reveal the probable existence of a
financial object missing from the user's model." Generalizes beyond credit cards: recurring EMI →
probable missing loan; recurring premiums → probable insurance policy; recurring SIP debits to a
known platform → probable missing investment account; recurring salary → probable income source;
and so on. Compare what the data shows against what the model currently represents, continuously.

Built once, generalized in #54, `src/inference/missingObjects.js`. Extend this file — or its
pattern — rather than building a parallel, narrower check next time a new object type comes up.

## Four things that must never blur together (§8)

- **Observation**: what was actually seen ("6 SBI Card payments in 6 months")
- **Inference**: what it probably means ("you likely have an SBI Card account not yet tracked")
- **Confidence**: how sure, and *why* — always explainable, never an opaque score
- **Decision support**: what to do about it — and if there's genuinely no real destination for
  that action yet (see backlog #53, insurance), say so and surface the observation anyway, rather
  than force a button that points nowhere or silently drop the insight.

## Prioritize, never enumerate (§7)

Not every true observation is worth surfacing. Rank by confidence, materiality, relevance,
novelty, actionability, persistence, whether the person already knows it. "Netflix went up ₹50" is
true and low-priority. "Cash falls below your buffer in December" is highly material. Home should
show a handful of ranked things that matter, not everything the engine happened to notice.

## Don't overengineer (§13)

Simple observable evidence → robust inference → confidence → explainable surfacing. Not complex
models, opaque scores, or unnecessary ML. Every insight should be able to answer "why are you
telling me this?" in one plain sentence citing real evidence. A false-positive guard belongs in
the design (e.g. loan detection staying keyword-evidenced rather than "large + recurring + unlinked
alone," which would mistake a legitimate rent payment for a loan) — simplicity is not laziness
about correctness.

## The standing checklist, before implementing anything (§15)

A. What do we know? B. What can we infer? C. What are we missing? D. What relationships exist?
E. What has changed? F. What matters? G. What should the user know? H. What should Home surface?
I. What should Analyst explain? J. What should CFO help decide? K. What should the user be asked?
L. What should the system learn from the answer?

## The test (§16)

*"If the person never opened this screen, would Being Wealthy still notice something important
and tell them?"* If no, the intelligence layer is missing, not just the screen.

## The standing instruction (§12)

Don't wait to be asked "is this good?" — evaluate proactively, every session, whether the product
is actually becoming this. If an implementation request would produce a weaker product, or a data
model can't support the relationship it implies, or a metric is shown without meaning, say so
before building it, not after.

## What's real today vs. still ahead (kept current, not a snapshot)

**Built**: identity/classification/routing engine with per-dimension confidence (#46, Phases A–C);
generalized missing-object detection across four types, ranked, with honest no-action cases (#54).

**Not yet built, named plainly rather than implied complete**: material-change detection ("what's
changed since last month"); a full cross-domain relationship model (income source → employer,
SIP → goal, EMI → debt → cash flow) beyond the missing-object layer; a prioritization layer
spanning *all* insight types together, not just missing-objects ranked among themselves; Analyst
actually explaining the "why" behind what Home surfaces; CFO/Money Coach decision support; a
protection/insurance object type (#53). Ask/Money Coach remains real, separate, unstarted work
(#42).
