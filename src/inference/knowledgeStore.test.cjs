/**
 * Tests for knowledgeStore.js. The first stateful module in this engine, so
 * these are sequence-of-operations tests (state at T1, then T2, then T3),
 * not fixed-input/fixed-output tests like every prior module - every
 * function is still pure (same store + same inputs -> same new store), so
 * sequences are simulated explicitly rather than relying on real time.
 * Run: node src/inference/knowledgeStore.test.cjs
 */
async function main() {
  const { emptyStore, reconcileMissingObjects, dismissKnowledgeItem, pruneKnowledgeStore, activeKnowledgeItems, RESOLUTION_STATE, RESOLUTION_RESULT } = await import("./knowledgeStore.js");

  let pass = 0, fail = 0;
  function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) pass++;
    else { fail++; console.log("FAIL:", label, "\n  expected:", JSON.stringify(expected), "\n  actual:  ", JSON.stringify(actual)); }
  }

  const sbiFinding = (count) => ({
    type: "creditCard", name: "SBI Card", title: "You appear to have a SBI Card account",
    body: `We noticed ${count} payments...`, evidenceCount: count,
    sampleDescriptions: ["UPI-SBI CARD-1"], confidence: count >= 4 ? "High" : "Medium",
    action: { label: "Add SBI Card statement", act: "upload" },
  });

  // --- T1: first detection, 6 payments ---
  let store = emptyStore();
  store = reconcileMissingObjects(store, [sbiFinding(6)], "2026-09-01T00:00:00Z");
  const items1 = Object.values(store.items);
  check("T1: exactly one item created", items1.length, 1);
  check("T1: deterministic, readable ID", items1[0].id, "missing_object:creditCard:sbi-card");
  check("T1: unresolved", items1[0].resolution.state, RESOLUTION_STATE.UNRESOLVED);
  check("T1: evidence count matches", items1[0].evidence[0].count, 6);

  // --- T2: same card, now 7 payments (one more month passed) - must UPDATE, not duplicate ---
  store = reconcileMissingObjects(store, [sbiFinding(7)], "2026-10-01T00:00:00Z");
  const items2 = Object.values(store.items);
  check("T2: still exactly one item (not duplicated)", items2.length, 1);
  check("T2: same ID as T1", items2[0].id, items1[0].id);
  check("T2: evidence count updated", items2[0].evidence[0].count, 7);
  check("T2: createdAt preserved from T1, not overwritten", items2[0].createdAt, "2026-09-01T00:00:00Z");
  check("T2: updatedAt reflects the new reconciliation", items2[0].updatedAt, "2026-10-01T00:00:00Z");

  // --- T3: person adds the SBI Card account - detector no longer finds it ->
  // must auto-resolve, not stay unresolved forever ---
  store = reconcileMissingObjects(store, [], "2026-10-15T00:00:00Z");
  const items3 = Object.values(store.items);
  check("T3: still exactly one item (resolved, not deleted)", items3.length, 1);
  check("T3: auto-resolved", items3[0].resolution.state, RESOLUTION_STATE.RESOLVED);
  check("T3: resolved BY the system, not a person", items3[0].resolution.resolvedBy, "system");
  check("T3: resolution result is object_created", items3[0].resolution.result, RESOLUTION_RESULT.OBJECT_CREATED);
  check("T3: resolved item no longer in activeKnowledgeItems", activeKnowledgeItems(store).length, 0);

  // --- Dismissal: a SEPARATE scenario - person says "not for me" ---
  let store2 = emptyStore();
  store2 = reconcileMissingObjects(store2, [sbiFinding(6)], "2026-09-01T00:00:00Z");
  const idToKill = Object.keys(store2.items)[0];
  store2 = dismissKnowledgeItem(store2, idToKill, "2026-09-05T00:00:00Z");
  check("dismissed item has dismissed state", store2.items[idToKill].resolution.state, RESOLUTION_STATE.DISMISSED);
  check("dismissed item not in activeKnowledgeItems", activeKnowledgeItems(store2).length, 0);

  // --- Critical: a dismissed item reappearing in findings must NOT flip back
  // to unresolved (the person already said no) - only evidence refreshes ---
  store2 = reconcileMissingObjects(store2, [sbiFinding(8)], "2026-10-01T00:00:00Z");
  check("dismissed item STAYS dismissed even when the pattern is seen again", store2.items[idToKill].resolution.state, RESOLUTION_STATE.DISMISSED);
  check("...but evidence still refreshes (for the record, not for re-surfacing)", store2.items[idToKill].evidence[0].count, 8);
  check("dismissed item still excluded from active list after reappearing", activeKnowledgeItems(store2).length, 0);

  // --- Pruning: resolved item older than 90 days is removed; within window is kept ---
  let store3 = emptyStore();
  store3 = reconcileMissingObjects(store3, [sbiFinding(6)], "2026-01-01T00:00:00Z");
  store3 = reconcileMissingObjects(store3, [], "2026-01-10T00:00:00Z"); // auto-resolved here
  const prunedTooEarly = pruneKnowledgeStore(store3, "2026-02-01T00:00:00Z"); // 22 days later - within window
  check("resolved item within 90 days is NOT pruned", Object.keys(prunedTooEarly.items).length, 1);
  const prunedLater = pruneKnowledgeStore(store3, "2026-05-01T00:00:00Z"); // ~111 days later - past window
  check("resolved item past 90 days IS pruned", Object.keys(prunedLater.items).length, 0);

  // --- Dismissed items are NEVER pruned, regardless of age ---
  let store4 = emptyStore();
  store4 = reconcileMissingObjects(store4, [sbiFinding(6)], "2026-01-01T00:00:00Z");
  const anId = Object.keys(store4.items)[0];
  store4 = dismissKnowledgeItem(store4, anId, "2026-01-02T00:00:00Z");
  const prunedDismissed = pruneKnowledgeStore(store4, "2027-01-01T00:00:00Z"); // a full year later
  check("dismissed item survives pruning indefinitely", Object.keys(prunedDismissed.items).length, 1);

  // --- Ranking: higher priority (more evidence / higher confidence) sorts first ---
  let store5 = emptyStore();
  const loanFinding = { type: "loan", name: "loan", title: "...", body: "...", evidenceCount: 2, sampleDescriptions: [], confidence: "Medium", action: { label: "Add loan", act: "upload" } };
  store5 = reconcileMissingObjects(store5, [sbiFinding(6), loanFinding], "2026-09-01T00:00:00Z");
  const ranked = activeKnowledgeItems(store5);
  check("higher-evidence/confidence item (6x SBI Card, High) ranks before lower (2x loan, Medium)", ranked[0].type, "creditCard");

  // --- Snooze: hidden until the date, back by itself afterwards; a dismissal stays permanent ---
  const { snoozeKnowledgeItem } = await import("./knowledgeStore.js");
  const idS = ranked[0].id;
  const sn = snoozeKnowledgeItem(store5, idS, "2026-10-10T00:00:00Z", "2026-09-10T00:00:00Z");
  check("a snoozed item is hidden before the date", activeKnowledgeItems(sn, "2026-09-20T00:00:00Z").some((i) => i.id === idS), false);
  check("...and comes back after it", activeKnowledgeItems(sn, "2026-10-11T00:00:00Z").some((i) => i.id === idS), true);
  const sn2 = reconcileMissingObjects(sn, [sbiFinding(7), loanFinding], "2026-09-11T00:00:00Z");
  check("re-detecting the same finding does not undo the snooze", activeKnowledgeItems(sn2, "2026-09-20T00:00:00Z").some((i) => i.id === idS), false);

  // --- Waiting for an account: name match first, then the others one at a time ---
  const ks = await import("./knowledgeStore.js");
  let ps = ks.addPendingAccount(ks.emptyStore(), { name: "Scapia", rowIds: ["a", "b"], knownAccountIds: ["bank1"] }, "2026-10-08T00:00:00Z");
  ps = ks.addPendingAccount(ps, { name: " scapia ", rowIds: ["b", "c"] }, "2026-10-09T00:00:00Z");
  ps = ks.addPendingAccount(ps, { name: "CRED", rowIds: ["d"], knownAccountIds: ["bank1"] }, "2026-10-09T00:00:00Z");
  check("the same name adds to one note", ps.pending.find((n) => n.key === "scapia").rowIds, ["a", "b", "c"]);
  check("a note keeps the store's items intact", ps.items, {});
  const types = () => ["creditCard"];
  const acc = (id, nickname, type = "creditCard") => ({ id, nickname, type });
  check("accounts that already existed are never offered", ks.pendingOffers(ps, [{ id: "bank1", nickname: "Scapia bank", type: "creditCard" }], types), []);
  let off = ks.pendingOffers(ps, [acc("n1", "Scapia Federal Card")], types);
  check("a new account is offered the note whose name matches first", off.map((o) => o.note.key), ["scapia"]);
  ps = ks.declinePendingAccount(ps, "scapia", "n1");
  off = ks.pendingOffers(ps, [acc("n1", "Scapia Federal Card")], types);
  check("a no brings the next waiting note", off.map((o) => o.note.key), ["cred"]);
  ps = ks.declinePendingAccount(ps, "cred", "n1");
  check("when every note said no nothing is asked", ks.pendingOffers(ps, [acc("n1", "Scapia Federal Card")], types), []);
  check("...until another account is added", ks.pendingOffers(ps, [acc("n1", "Scapia Federal Card"), acc("n2", "HDFC Millennia")], types).map((o) => o.account.id + ":" + o.note.key), ["n2:scapia"]);
  check("a note of a kind the account cannot hold is not offered", ks.pendingOffers(ps, [acc("n3", "Savings", "bank")], types), []);
  const yes = ks.confirmPendingAccount(ks.addPendingAccount(ks.emptyStore(), { name: "Scapia", rowIds: ["a"], knownAccountIds: [] }, "t"), "scapia", "n1");
  check("a yes resolves the note", yes.pending, []);
  let two = ks.addPendingAccount(ks.addPendingAccount(ks.emptyStore(), { name: "Scapia", rowIds: ["a"], knownAccountIds: [] }, "t"), { name: "CRED", rowIds: ["b"], knownAccountIds: [] }, "t");
  two = ks.confirmPendingAccount(two, "scapia", "n1");
  check("...and the other notes are not asked about that account again", ks.pendingOffers(two, [acc("n1", "Scapia Federal Card")], types), []);
  check("reconciling findings keeps the notes", reconcileMissingObjects(ps, [], "2026-10-10T00:00:00Z").pending.length, 2);
  let ac = ks.acceptConflict(ks.emptyStore(), "SCAPIA", "A|B");
  check("an accepted conflict stays accepted while it looks the same", ks.isConflictAccepted(ac, "SCAPIA", "A|B"), true);
  check("...and is asked again when a new way of filing appears", ks.isConflictAccepted(ac, "SCAPIA", "A|B|C"), false);

  const old = { ...ks.emptyStore(), pending: [{ key: "scapia", name: "Scapia", rowIds: ["a"], declined: [] }] };
  const bl = ks.baselinePending(old, ["c1", "c2"]);
  check("an older waiting note treats today's accounts as answered", bl.pending[0].declined, ["c1", "c2"]);
  check("so none is offered", ks.pendingOffers(bl, [{ id: "c1", nickname: "Scapia", type: "creditCard" }], () => ["creditCard"]), []);
  check("a later account is still offered", ks.pendingOffers(bl, [{ id: "c3", nickname: "Scapia", type: "creditCard" }], () => ["creditCard"]).length, 1);
  check("baselining twice changes nothing", ks.baselinePending(bl, ["c1", "c2", "c3"]), bl);
  console.log(`\n${pass}/${pass + fail} passed.`);
  if (fail > 0) process.exit(1);
}

main();
