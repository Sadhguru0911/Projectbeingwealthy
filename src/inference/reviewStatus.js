/**
 * Summarizes review status (Sorted / Worth a quick look / Need your input) for a
 * real person's transactions - the first live use of identity.js/classify.js/
 * route.js (Phases A-C, backlog #46) inside the actual app, not just measurement
 * scripts. Feeds Home's "patterns" card (backlog #41/#45).
 *
 * Same architecture as every inference-engine module so far: pure, and imports
 * only from its own sibling files (identity.js, classify.js, route.js - safe,
 * no circularity) - never from App.jsx. App.jsx already has matchRule,
 * findLibraryEntry, commitmentGroupKey, learnRecurringDay and computeAmountBehavior
 * in scope (the same functions computeRecurringCommitments already uses for a
 * closely related purpose), so App.jsx does the grouping and the real-function
 * calls, and passes the results in here as plain data - this file only does the
 * identity/classification/routing and the bucketing on top.
 */

import { resolveIdentity } from "./identity.js";
import { classifyCommitment } from "./classify.js";
import { routeCommitment, ACTION } from "./route.js";

/**
 * @param {Array} groups - one entry per commitment group, already formed by the
 *   caller (App.jsx, using its own commitmentGroupKey - grouping itself is NOT
 *   this function's job, only what happens once groups exist). Each entry:
 *   { key, name, occurrenceCount, ruleMatch, libraryEntry, linkedAccountName,
 *     recurringDayResult, amountBehaviorResult, amountPerOccurrence,
 *     occurrencesPerYear }
 * @returns {{ counts: {sorted, worthAQuickLook, needsYourInput}, items: Array }}
 *   `items` carries enough per-group detail (routing, reason) for a future review
 *   queue UI to use directly - Home's card only needs the counts today, but this
 *   avoids needing a second pass to build a real review screen later.
 */
export function summarizeReviewStatus(groups) {
  const items = groups.map((g) => {
    const identity = resolveIdentity({
      linkedAccountName: g.linkedAccountName || null,
      ruleMatch: g.ruleMatch || null,
      libraryEntry: g.libraryEntry || null,
      clusterMatch: !!g.clusterMatch,
    });
    const classification = classifyCommitment({
      occurrenceCount: g.occurrenceCount,
      recurringDayResult: g.recurringDayResult || null,
      amountBehaviorResult: g.amountBehaviorResult || null,
      questionnairePrior: g.questionnairePrior || null,
      unbrokenHistory: !!g.unbrokenHistory,
    });
    const routing = routeCommitment({ identity, classification, autoApplyEnabled: true });
    return { key: g.key, name: g.name, occurrenceCount: g.occurrenceCount, routing, classification };
  });

  const counts = { sorted: 0, worthAQuickLook: 0, needsYourInput: 0 };
  items.forEach((it) => {
    if (it.routing.action === ACTION.AUTO) counts.sorted++;
    else if (it.routing.action === ACTION.PROVISIONAL) counts.worthAQuickLook++;
    else counts.needsYourInput++;
  });

  return { counts, items };
}
