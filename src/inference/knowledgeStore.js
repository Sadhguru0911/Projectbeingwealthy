/**
 * Knowledge Store (backlog #56), built from the combined design worked through
 * directly: the V1 Concrete Proposal's Knowledge Item schema and storage
 * principles ("don't snapshot the money" - only derived conclusions persist,
 * never a copy of financial history), plus the Context/Relationship
 * discussion's corrections (lowest MEANINGFUL level; Context ≠ Relationship).
 * This file builds the Knowledge Item/Store layer only - Context and
 * Relationship are deliberately NOT built here, per the agreed sequencing:
 * prove the Knowledge plumbing first, on the detector that already exists and
 * is already tested (missingObjects.js), before adding the richer structural
 * model on top.
 *
 * This is the first STATEFUL module in this engine - everything before it
 * (identity.js, classify.js, route.js, reviewStatus.js, missingObjects.js) is
 * a pure function with no memory. A Knowledge Store is memory by definition:
 * what was known before affects what's true now (the same ID must be updated,
 * not duplicated, when new evidence arrives). Every function here stays pure
 * anyway - takes the current store state and returns a new one - so it's
 * still fully testable with fixed inputs and fixed expected outputs; the
 * statefulness lives in the CALLER persisting the result, not in this module
 * itself holding anything.
 */

export const RESOLUTION_STATE = { UNRESOLVED: "unresolved", RESOLVED: "resolved", DISMISSED: "dismissed" };
export const RESOLUTION_RESULT = {
  USER_CONFIRMED: "user_confirmed",
  FALSE_POSITIVE: "false_positive",
  LINKED_TO_EXISTING_OBJECT: "linked_to_existing_object",
  OBJECT_CREATED: "object_created",
  DISMISSED: "dismissed",
};

const STORE_SCHEMA_VERSION = 1;
const ITEM_VERSION = 1;

// Resolved items are kept for 90 days (so the system remembers what was
// already resolved and never re-surfaces it), then pruned. Dismissed items
// keep their dismissal indefinitely - re-surfacing something a person
// explicitly said "not for me" to would be worse than never detecting it at
// all. Both numbers are explicit, named constants, not implied anywhere.
const RESOLVED_RETENTION_DAYS = 90;

function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

/** A fingerprint built from stable, canonical identifiers only - never from
 *  evidence values (counts, amounts, dates) that change as new data arrives,
 *  and never from raw transaction text (which can vary across statement
 *  formats for the same real-world entity - "SBI CARD" vs "SBI Card
 *  Payment"). missingObjects.js's `name` field is already the canonical,
 *  matched name (from CARD_ISSUER_PATTERNS / the Merchant Library), which is
 *  exactly the right basis for this. */
function fingerprint(family, type, name) {
  return `${family}:${type}:${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

export function emptyStore() {
  return { schemaVersion: STORE_SCHEMA_VERSION, items: {} };
}

/** Converts one missingObjects.js finding into a Knowledge Item, in the V1
 *  Concrete Proposal's own schema. `now` is an explicit parameter (never read
 *  from Date.now() internally) specifically so sequences of calls across
 *  simulated time are deterministic and testable - the whole point of a
 *  stateful module needing a different testing discipline than the pure
 *  functions built so far. */
export function missingObjectToKnowledgeItem(finding, now) {
  const id = fingerprint("missing_object", finding.type, finding.name);
  return {
    id,
    version: ITEM_VERSION,
    family: "missing_object",
    type: finding.type,
    subject: { name: finding.name },
    claim: { title: finding.title, description: finding.body },
    evidence: [{ type: "transaction_pattern", count: finding.evidenceCount, samples: finding.sampleDescriptions }],
    inference: { statement: finding.title, confidence: finding.confidence === "High" ? 0.9 : finding.confidence === "Medium" ? 0.65 : 0.4 },
    status: RESOLUTION_STATE.UNRESOLVED,
    priority: { score: (finding.confidence === "High" ? 0.8 : finding.confidence === "Medium" ? 0.5 : 0.25) + Math.min(finding.evidenceCount * 0.02, 0.15), reason: `${finding.evidenceCount} matching transactions, ${finding.confidence} confidence` },
    action: finding.action,
    userInteraction: { acknowledged: false, confirmed: null, dismissed: false },
    resolution: { state: RESOLUTION_STATE.UNRESOLVED, resolvedBy: null, resolvedAt: null, result: null },
    source: { producer: "missingObjects", producerVersion: "1.0" },
    fingerprint: id.split(":").slice(2).join(":"),
    createdAt: now,
    updatedAt: now,
    lastEvaluatedAt: now,
  };
}

/**
 * The main reconciliation pass, run every time Home needs current state
 * (cheap, since missingObjects.js's detection itself is cheap - see the file
 * header on when this runs). For each CURRENT finding: create a new item, or
 * update the existing one at the SAME id with fresh evidence - never
 * duplicate. For each EXISTING unresolved missing_object item with NO
 * matching current finding (because the account now exists, so the detector
 * correctly stopped reporting it): auto-resolve it as "object_created" -
 * this is the generic resolution path backlog #55 needed, not a one-off
 * SBI-Card-specific mechanism.
 *
 * @param {Object} store - the current store (from emptyStore() or loaded state)
 * @param {Array} findings - detectMissingObjects()'s current output
 * @param {string} now - ISO timestamp, injected (see missingObjectToKnowledgeItem)
 */
export function reconcileMissingObjects(store, findings, now) {
  const items = { ...store.items };
  const currentIds = new Set();

  findings.forEach((finding) => {
    const id = fingerprint("missing_object", finding.type, finding.name);
    currentIds.add(id);
    const existing = items[id];
    if (existing && existing.resolution.state !== RESOLUTION_STATE.UNRESOLVED) {
      // Already resolved or dismissed - a finding re-appearing (e.g. a
      // dismissed false positive the person still hasn't fixed) must NOT
      // silently flip back to unresolved. Only evidence/lastEvaluatedAt
      // refresh; the person's own prior answer is preserved.
      items[id] = { ...existing, evidence: missingObjectToKnowledgeItem(finding, now).evidence, lastEvaluatedAt: now };
      return;
    }
    if (existing) {
      // Update in place - same id, fresh evidence/confidence/priority, never
      // a duplicate. createdAt is preserved from the original.
      const fresh = missingObjectToKnowledgeItem(finding, now);
      items[id] = { ...fresh, createdAt: existing.createdAt, version: existing.version, userInteraction: existing.userInteraction, updatedAt: now };
    } else {
      items[id] = missingObjectToKnowledgeItem(finding, now);
    }
  });

  // Auto-resolve: an unresolved missing_object item whose underlying
  // condition no longer holds (the account now exists, so detectMissingObjects
  // correctly stopped reporting it this pass).
  Object.values(items).forEach((item) => {
    if (item.family === "missing_object" && item.resolution.state === RESOLUTION_STATE.UNRESOLVED && !currentIds.has(item.id)) {
      items[item.id] = {
        ...item,
        status: RESOLUTION_STATE.RESOLVED,
        resolution: { state: RESOLUTION_STATE.RESOLVED, resolvedBy: "system", resolvedAt: now, result: RESOLUTION_RESULT.OBJECT_CREATED },
        updatedAt: now,
      };
    }
  });

  return { ...store, items };
}

/** A person explicitly dismissing an item - "not for me, stop asking." Kept
 *  indefinitely (see RESOLVED_RETENTION_DAYS's comment above), never pruned
 *  on a timer, since the whole point is to never re-surface it. */
export function dismissKnowledgeItem(store, id, now) {
  const item = store.items[id];
  if (!item) return store;
  return {
    ...store,
    items: {
      ...store.items,
      [id]: { ...item, status: RESOLUTION_STATE.DISMISSED, userInteraction: { ...item.userInteraction, dismissed: true }, resolution: { state: RESOLUTION_STATE.DISMISSED, resolvedBy: "user", resolvedAt: now, result: RESOLUTION_RESULT.DISMISSED }, updatedAt: now },
    },
  };
}

/** "Not now": hides an item until `until` (ISO) without answering it. It comes back by itself afterwards. Unlike a dismissal it is not permanent. */
export function snoozeKnowledgeItem(store, id, until, now) {
  const item = store.items[id];
  if (!item) return store;
  return { ...store, items: { ...store.items, [id]: { ...item, userInteraction: { ...item.userInteraction, snoozedUntil: until }, updatedAt: now } } };
}

/* ---- Accounts the person said they have not added yet ("waiting for an account"). Kept beside the items (store.pending), never shown as a Home step by itself. ---- */
const wordsOf = (s) => String(s || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3);

/** Remembers that these transactions are waiting for an account called `name`. Same name -> the rows are added to the same note.
 *  knownAccountIds: the accounts that exist now - they are not the account being waited for, so they are never offered. */
export function addPendingAccount(store, { name, rowIds, knownAccountIds }, now) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return store;
  const list = store.pending || [];
  const ex = list.find((n) => n.key === key);
  const note = ex
    ? { ...ex, rowIds: [...new Set([...ex.rowIds, ...rowIds])], declined: [...new Set([...(ex.declined || []), ...(knownAccountIds || [])])], updatedAt: now }
    : { key, name: String(name).trim(), rowIds: [...rowIds], declined: [...(knownAccountIds || [])], baseline: true, createdAt: now, updatedAt: now };
  return { ...store, pending: [...list.filter((n) => n.key !== key), note] };
}

/** Waiting notes from before accounts were recorded against them: every account that exists now is treated as already answered, so only accounts
 *  added later raise a question. Runs once per note (baseline flag). Returns the same store when nothing changes. */
export function baselinePending(store, accountIds) {
  const list = store.pending || [];
  if (!list.some((n) => !n.baseline)) return store;
  return { ...store, pending: list.map((n) => (n.baseline ? n : { ...n, baseline: true, declined: [...new Set([...(n.declined || []), ...accountIds])] })) };
}

/** Does an account's name or institution share a word with a note's name? */
export function nameMatches(note, account) {
  const nw = wordsOf(note.name);
  const aw = new Set(wordsOf((account.nickname || "") + " " + (account.institution || "")));
  return nw.some((w) => aw.has(w));
}

/**
 * Which waiting note is being asked about for each account right now. For every account the notes are tried in order: the ones whose name
 * matches first, then the rest (of a kind the account can hold). A note an account was refused for (declined) is skipped, so a "no" brings
 * the next candidate, and when every candidate said no nothing is asked until another account is added.
 *   typesOf(note) -> the account types its payments could be linked to.
 * Returns [{ note, account }] - at most one note per account, and a note is asked about for one account at a time.
 */
export function pendingOffers(store, accounts, typesOf) {
  const out = [], used = new Set();
  (accounts || []).forEach((a) => {
    const cands = (store.pending || []).filter((n) => !used.has(n.key) && !(n.declined || []).includes(a.id) && typesOf(n).includes(a.type));
    cands.sort((x, y) => Number(nameMatches(y, a)) - Number(nameMatches(x, a)));
    if (cands[0]) { out.push({ note: cands[0], account: a }); used.add(cands[0].key); }
  });
  return out;
}

/** "Yes, it is this account": the note is done, and no other waiting note is asked about this account again. */
export function confirmPendingAccount(store, key, accountId) {
  return { ...store, pending: (store.pending || []).filter((n) => n.key !== key).map((n) => ({ ...n, declined: [...new Set([...(n.declined || []), accountId])] })) };
}
/** "No, not this account": this note is not offered this account again. */
export function declinePendingAccount(store, key, accountId) { return { ...store, pending: (store.pending || []).map((n) => (n.key === key ? { ...n, declined: [...new Set([...(n.declined || []), accountId])] } : n)) }; }
export function resolvePendingAccount(store, key) { return { ...store, pending: (store.pending || []).filter((n) => n.key !== key) }; }

/* ---- Conflicts the person accepted ("these are different on purpose"). The signature changes when a new way of filing appears, which asks again. ---- */
export function acceptConflict(store, key, signature) {
  return { ...store, acceptedConflicts: { ...(store.acceptedConflicts || {}), [key]: signature } };
}
export const isConflictAccepted = (store, key, signature) => !!store.acceptedConflicts && store.acceptedConflicts[key] === signature;

/** Removes resolved items older than the retention window. Dismissed items
 *  are NEVER pruned by this (see above). Active/unresolved items are never
 *  pruned either - only a real resolution or dismissal makes an item
 *  eligible for removal at all. */
export function pruneKnowledgeStore(store, now) {
  const items = {};
  Object.values(store.items).forEach((item) => {
    if (item.resolution.state === RESOLUTION_STATE.RESOLVED && item.resolution.resolvedAt) {
      if (daysBetween(item.resolution.resolvedAt, now) > RESOLVED_RETENTION_DAYS) return; // prune
    }
    items[item.id] = item;
  });
  return { ...store, items };
}

/** What Home actually consumes - active (unresolved) items only, ranked by
 *  priority score. Thin prioritization, per the V1 proposal's SS13: Home
 *  decides what to SHOW, the store already decided what's worth knowing. */
export function activeKnowledgeItems(store, now = new Date().toISOString()) {
  return Object.values(store.items)
    .filter((item) => item.resolution.state === RESOLUTION_STATE.UNRESOLVED)
    .filter((item) => !(item.userInteraction && item.userInteraction.snoozedUntil && item.userInteraction.snoozedUntil > now))
    .sort((a, b) => b.priority.score - a.priority.score);
}
