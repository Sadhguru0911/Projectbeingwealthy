/**
 * Demo mode UI wiring (backlog #39). The architecture decision this implements,
 * locked earlier: "the demo has no screens of its own." It runs the real app
 * against a sandboxed storage namespace, seeded with the real demo dataset
 * (generateDemoData.js), by swapping the prefix storage.js reads/writes through -
 * nothing in App.jsx's own state logic, rendering, or save/load effects changes at
 * all. Entering or exiting demo mode is: seed (or clear) the demo namespace, flip
 * one flag, reload the page. The app's own existing bootstrap effect does the rest,
 * completely unmodified.
 *
 * SCOPE, stated precisely: this wires demo mode into the app AS IT EXISTS TODAY -
 * the current Dashboard/Cash Flow/Net Worth/Debt/Goals screens, reached through the
 * current LandingPage. It does NOT wire the new Home/onboarding screens from the
 * design prototypes (journey-prototype-v1 and friends) - those aren't built into
 * the live app yet (separate, later phases of the migration plan, #45). A person
 * entering demo mode today sees Asha's data populate today's real screens; the
 * "Asha's story" stepper (moving her history forward month by month) from the
 * prototypes is not part of this - that belongs to the onboarding/history screen
 * this app doesn't have yet, not to the storage-layer mechanism built here.
 *
 * The DEMO_FLAG and the "being-wealthy-demo:" prefix are duplicated (not imported)
 * from storage.js, deliberately: storage.js's prefix decision has to happen at
 * plain module-load time with no dependencies, before anything else in the app
 * exists to import from - see its own comment. Both are tiny, static, unlikely to
 * drift, and kept in sync by this comment pointing at the other file.
 */

const DEMO_FLAG = "being-wealthy-demo-active";
const DEMO_PREFIX = "being-wealthy-demo:";

export function isDemoActive() {
  return typeof window !== "undefined" && window.localStorage.getItem(DEMO_FLAG) === "1";
}

/** Strips the ground-truth/testing-only annotations generateDemoData.js attaches
 *  (groundTruth) before this becomes real, loadable app state - those fields exist
 *  for src/demo/measureAccuracyAtScale.cjs, not for the shipped UI, and leaving
 *  them on the object would be silent, unused clutter in every real transaction a
 *  demo visitor's browser devtools could inspect. */
function stripGroundTruth(t) {
  const { groundTruth, ...rest } = t;
  return rest;
}

/** Converts generateDemoData()'s output into the EXACT shape App.jsx's own
 *  bootstrap effect reads from the "appData" key - every field name and the
 *  overall structure copied directly from that effect's own save call, not
 *  guessed. rules is deliberately OMITTED (not set to [], which is truthy and
 *  would suppress it) so the app's own existing `combined.rules || seedRules()`
 *  fallback fires naturally - a demo visitor sees exactly the seed rules a real
 *  new install would have, not a special demo-only rule set. */
function toAppData(data) {
  return {
    transactions: data.transactions.map(stripGroundTruth),
    accounts: data.accounts,
    budgets: {},
    cashBuffer: 0,
    merchantAliases: [],
    holdingSnapshots: data.holdingSnapshots,
    goals: data.goals,
    debtSchedules: data.debtSchedules,
    otherInvestments: data.otherInvestments,
    chatThreads: [],
    savedPrompts: [],
    // The prototype's startDemo() presets Asha's answers (partner + daughter; saving for a home) so
    // Home never asks the sample person her own profile questions.
    household: { me: true, partner: true, kids: true },
    priority: "home",
    householdAnswered: true,
  };
}

/** Seeds the demo storage namespace and flips the flag. Deliberately synchronous,
 *  direct localStorage writes (not the async `storage` object, and not through
 *  loadState/saveState) - this runs BEFORE the page that will read it has loaded,
 *  so there is no running App instance to route a call through yet; it has to
 *  write to exactly the same place storage.js will read from once the reload
 *  happens, which is why the prefix is duplicated here (see the file header). */
export async function enterDemoMode() {
  const { generateDemoData } = await import("./generateDemoData.js");
  const data = generateDemoData();
  const appData = toAppData(data);
  window.localStorage.setItem(DEMO_PREFIX + "appData", JSON.stringify(appData));
  // A fresh demo session should feel like a fresh install in every other respect
  // too - no stale tutorial/theme/license state bleeding in from a PRIOR demo
  // session (there shouldn't be one, since exitDemoMode clears the namespace, but
  // this is a genuine explicit reset, not just relying on that).
  window.localStorage.removeItem(DEMO_PREFIX + "hasSeenTutorial");
  window.localStorage.removeItem(DEMO_PREFIX + "schemaVersion");
  window.localStorage.setItem(DEMO_FLAG, "1");
  window.location.reload();
}

/** Clears the ENTIRE demo namespace (not just the flag) before reloading back to
 *  real data - so a later "enter demo" starts genuinely fresh, never picking up
 *  whatever a previous visitor (or the same person, an hour earlier) left behind
 *  from clicking around inside the demo. Real data was never touched by any of
 *  this - it lives under a completely different prefix that demo mode never
 *  writes to - so exiting is purely about cleaning up the demo's own namespace. */
export function exitDemoMode() {
  const keys = Object.keys(window.localStorage).filter((k) => k.startsWith(DEMO_PREFIX));
  keys.forEach((k) => window.localStorage.removeItem(k));
  window.localStorage.removeItem(DEMO_FLAG);
  window.location.reload();
}
