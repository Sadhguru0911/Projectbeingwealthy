/**
 * Home Traffic Control (backlog #57) - the "control room" asked for directly:
 * one explicit module that governs everything that reaches Home, rather than
 * selection logic scattered across separate useMemo blocks in App.jsx that
 * each made their own ad hoc decisions. Before this, Knowledge Store items
 * (missing objects) and forecast-derived signals (a cash dip, a card bill due,
 * a goal shortfall) were combined by string-pushing into the same array with
 * no shared ranking at all - whichever check happened to run first effectively
 * won. That's exactly the kind of "Home discovers intelligence instead of
 * consuming it" the project's own design documents warn against.
 *
 * Every signal reaching Home - regardless of which engine produced it - is
 * normalized into ONE shape here first, then ranked together on ONE scale.
 * Nothing downstream (App.jsx, HomeScreen.jsx) ever sees a Knowledge Item or
 * a forecast object directly; they only ever see what this module decided.
 */

/**
 * @typedef {Object} HomeCandidate
 * @property {string} id - stable identity. Only present (non-null) for
 *   candidates backed by a real, persisted, dismissable thing (a Knowledge
 *   Item). Forecast-derived candidates (a cash dip, a bill due) are
 *   recomputed fresh every time and have nothing persisted to dismiss, so
 *   their id is null - HomeScreen already uses this to decide whether to
 *   show a Dismiss control at all.
 * @property {string} title
 * @property {string} body
 * @property {number} score - 0 to 1, comparable ACROSS every source. See each
 *   normalizer below for exactly how a given source's score was chosen and why.
 * @property {Object|null} action - { label, act } | null
 */

/** Converts a Knowledge Item (knowledgeStore.js's shape) into the shared
 *  candidate shape. Its own priority.score, computed when the item was
 *  created, is used as-is - no renormalization, since it was already designed
 *  to be on a comparable 0-1 scale. */
export function fromKnowledgeItem(item) {
  // `evidence` is flattened to plain strings here, deliberately - the Knowledge
  // Item's own evidence shape ({type, count, samples}) is richer than any
  // candidate needs to carry; the calculation drawer (backlog #41) just needs
  // something short and real to show on click, uniform across every source
  // regardless of which engine produced it.
  const ev = (item.evidence || []).flatMap((e) => [`${e.count} matching transactions`, ...(e.samples || []).slice(0, 3)]);
  return { id: item.id, title: item.claim.title, body: item.claim.description, score: item.priority.score, action: item.action, evidence: ev };
}

/**
 * Forecast-derived candidates don't come from the Knowledge Store (they're
 * not persisted, dismissed, or deduplicated - see the file header), so they
 * need an explicit, reasoned score assigned here rather than inheriting one.
 * Every number below is a deliberate call, not a placeholder:
 *   - A cash dip below the person's own cushion is the single most materially
 *     consequential thing Home can say - it can mean a real, near-term
 *     problem. Scored above essentially anything a missing-object detector
 *     would produce (those top out around 0.8-0.95, but only for the
 *     strongest, most-confirmed detections - a cushion breach deserves to
 *     outrank even those by default).
 *   - A card bill due soon is a real, useful reminder, but low-stakes and
 *     already expected - scored comparably to a solid missing-object finding,
 *     not above it.
 *   - A goal running behind its own plan is informative but not urgent -
 *     scored a little lower; worth knowing, not worth leading with.
 */
export function cashDipCandidate({ date, amount, cushionDelta, evidence }) {
  return { id: null, title: `A dip around ${date}`, body: `Cash falls to ${amount}, ${cushionDelta}.`, score: 0.95, action: null, evidence: evidence || [], why: "lowest" };
}
export function cardBillDueCandidate({ title, body, evidence }) {
  return { id: null, title, body, score: 0.6, action: null, evidence: evidence || [], why: "card" };
}
export function goalShortfallCandidate({ title, body, evidence }) {
  return { id: null, title, body, score: 0.45, action: null, evidence: evidence || [], why: "goal" };
}

/**
 * The single decision point. REBUILT after direct, specific feedback that the
 * earlier "one Next Step slot, everything else into a 3-item Attention
 * overflow" design was structurally wrong: a real, well-established missing-
 * card finding was being silently dropped because it lost a scoring
 * competition against an UNRELATED genuine risk signal (a cash dip) for the
 * same handful of slots - found directly, by counting four real debt-payment
 * commitments in the person's own data against only one or two ever reaching
 * the screen.
 *
 * The actual distinction was never "the single best thing" vs "everything
 * else" - it's "things to DO" vs "things that HAPPENED." Partitioned on that
 * basis now, as two independently-ranked lists, not one slot plus overflow:
 *   - nextSteps: every candidate that carries a real action - a missing
 *     account, an unset cash cushion. Each is something to configure or add,
 *     never something that merely happened. Not silently capped - a person
 *     with four real untracked cards should see four real suggestions, not
 *     one, with the rest invisibly dropped.
 *   - attention: every candidate WITHOUT an action - a cash dip, a goal
 *     falling behind, a card bill due soon. These are genuine risk or change
 *     signals, reserved for exactly that per direct instruction (cash
 *     shortfall, unusual spending, goal behind, a large upcoming commitment,
 *     an investment allocation change, a major relationship change) - never
 *     a disguised request for the person to go add something. Capped at
 *     `attentionLimit` (default 3) - this list is meant to stay genuinely
 *     short; unlike nextSteps, "a lot of real things changed at once" is
 *     itself worth summarizing rather than enumerating in full.
 * Pure function - no knowledge of React, App.jsx, or where any candidate
 * originally came from. Fully testable with plain fixture arrays.
 */
export function selectHomeFeed(candidates, { attentionLimit = 3 } = {}) {
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const nextSteps = ranked.filter((c) => c.action);
  const attention = ranked.filter((c) => !c.action).slice(0, attentionLimit);
  return { nextSteps, attention };
}
