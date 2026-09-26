# Being Wealthy — Backlog & Roadmap

A living reference of what's been decided, what's parked, and what's not started yet.
Add to this freely — it's meant to grow. Each item has enough context to make sense
months later, not just a one-line title.

**How to use this**: pick items to discuss and prioritize, not a strict queue. Update an
item's status as it moves. Delete or archive items that are no longer relevant rather
than letting them go stale.

**On merging**: items below are combined only where they're genuinely the same build
effort or share underlying logic — not just because they touch the same screen. Where
two items are related but still separate deliverables, that's called out in Notes
instead of forcing them into one row.

---

## Backlog — Single List, Ordered by Priority

| # | Item | Type | Priority | Effort | Status | Notes |
|---|------|------|----------|--------|--------|-------|
| 1 | Cash Flow account breakdown wrongly includes holding accounts | **Bug Fix** | **Critical** | S–M | ✅ Complete | App is currently displaying financially incorrect information — wrong output shown as correct, not a missing feature. Pattern confirmed (3 unfiltered `accountName` lookups by ID); exact source not yet pinned down. |
| 2 | Block holdings import if "as of date" is missing | **Bug Fix** (validation gap) | **Critical** | S | ✅ Complete | `asOfDate` is load-bearing for vs-last-snapshot comparisons, the net worth trend chart, and near-term goal tracking. A bad import today could silently corrupt all three. |
| 3 | Unified Entitlements Registry (Licensing) | Feature | High | L | Pending | Designed, not started — build in one full pass per agreement. One master list covering feature switches AND numeric limits, tier-rank comparison (`free < licensed < premium`) so Premium auto-inherits Licensed. Migrates `FREE_TIER_LIMITS` + the prompt-saving check into one place. |
| 4 | Licensing backend + reminder system | Feature | High | XL | Pending | **Merged**: DB (Supabase) + serverless webhook (payment → signed key → email) + GitHub Actions daily reminder job + transactional email service + in-app notification bell. Genuinely one project. The bell specifically could ship slightly ahead of the rest — it only needs the already-working signed-key expiry data, no backend required. |
| 5 | Accounts table — show Account Type column | Feature | High | S | ✅ Complete | Nickname/Institution/Transactions/Status shown today, but not the actual `type` field. Bumped to High specifically because it would have sped up spotting both real enforcement bugs found this session (combined Bank+CC bucket, single-select picker). |
| 6 | Monthly snapshot cadence + "no change" fallback | Feature | High | M | Pending | If holdings aren't re-imported regularly, "vs last snapshot" and the net worth trend chart could show a stale picture without saying so. Proposal: explicit "No change since last month" messaging rather than a silently-stale number. Related to #2 (both about snapshot trustworthiness) but a different mechanism — staleness messaging, not import-time validation. |
| 7 | Notification engine — flag missing statement periods | Feature | Med-High | L | Pending | Encourages discipline by detecting gaps and prompting the person to upload what's missing, rather than passively showing stale data. Surfaces through the same bell as #4 (one notification surface, not two). **Depends on** the resolver redesign (asOfDate timeline, tier 1/2/3 confidence) being built first — gap detection is a natural byproduct of that resolver knowing exactly where confirmed-or-derivable data runs out. **Open questions, unresolved:** (1) Grace window — how many days into a new month before last month counts as "missing," given statements aren't issued instantly at month-end. (2) Dormant vs. forgotten — needs a real per-account "mark as inactive, stop asking" mechanism, not just a snooze that reappears, or the bell trains people to ignore it. (3) Debt is the cleanest place to prototype first — its EMI schedule already defines the exact expected periods in advance, so "missing" is provable against a known schedule rather than inferred as "probably monthly" the way bank/investment gaps have to be. |
| 8 | AI-powered actionable insights | Feature | Med-High | M–L | Pending | **Merged**: Dashboard Insight+Action card + "CFO always gives clear actionables." Genuinely the same underlying logic — solving CFO's actionable-answer pattern well could directly power the Dashboard card, not be built twice. Needs a design call: live AI call renders the card, or a rule-based approximation stands in. |
| 9 | Dashboard narrative + Cash Flow card (4-way expense split) | Feature | Medium | M | Pending | **Merged**: "give the Dashboard a story" + the Expenses card's split (currently Household/Personal only; asked-for version adds Fixed/Variable too — four categories, not two) + Income shown alongside. The narrative question needs defining before the card rebuild. |
| 10 | AI response quality (prompt library + Analyst depth) | Feature | Medium | S–M | Pending | **Merged**: both are prompt-engineering/content work, not structural changes — expanding the built-in prompt library's quality, and making Analyst answers more thorough rather than surface-level. |
| 11 | Financial health/discipline scorecard | Feature | Medium | M | Pending | Needs criteria defined first (savings rate? emergency fund coverage? debt-to-income? goal funding?) — a design conversation before there's anything to build. Thematically close to #9 (Dashboard storytelling) but kept separate — this needs its own criteria-definition step first. |
| 12 | Insurance screen (life + health) | Feature | Medium | L | Pending | Adding `type: "insurance"` itself is trivial (one line in `accountBucket()`). Real work: new screen, data model (premium, cover amount, term, nominee?), and deciding whether it shares the "investment" bucket's limit or gets its own. |
| 13 | Delete an account + its transactions, with warning | Feature | Medium | M | Pending | Deleting a single import batch already exists; deleting a whole account doesn't. Needs genuinely clear, hard-to-misfire confirmation UX given irreversibility and potential cascading data (accounts, transactions, snapshots, schedules all reference the account). |
| 14 | Long-term Goals — precise per-goal tracking on Dashboard | Feature | Medium | M | Pending | Dashboard's Goals card intentionally shows aggregate-only for long-term goals. Real fix: lift `GoalsOverview`'s near-term/long-term pool-allocation logic out into a standalone function both screens call, rather than duplicating an approximation that could disagree with the real Goals screen. |
| 15 | Cash Flow "Money Flow" view | Feature | Medium | M–L | Pending | Fully designed in an earlier session, never built. Thematically related to #9 (both about richer cash flow storytelling) but a different screen — kept separate. |
| 16 | Code Quality & Testing tooling | Feature (infra) | Medium | M–L | Pending | **Merged**: ESLint (static analysis) → Vitest unit tests (specifically `computeGoalMath`, `computeNetWorthSummary`, `computeDebtSummary`, `computeGoalsTracking` — every real bug this session was a wrong calculation, which only real tests catch) → Playwright (browser-level checks, would have caught the vertical-waterfall CSS bug) → wire all three into the existing GitHub Actions pipeline. Paused mid-build to prioritize finishing enforcement. |
| 17 | Pitch deck pricing slide out of sync | Bug Fix (content) | Medium | S | Pending | `.pptx` deck still says "2 Cash Flow accounts, combined" — factually wrong since the Bank/Credit Card split into two separate 1-account limits. |
| 18 | Other Investments — CSV/Excel upload | Feature | Low-Med | M | Pending | Currently PDF-only for Other Investments (PF, gold, property); every other account type supports CSV/Excel/PDF already. |
| 19 | Upload History — per-category expand/collapse | Feature | Low-Med | S | Pending | Currently one flat collapsible list. Asked-for: separate expand/collapse per category (Bank, Credit Card, Investment holdings, Debt, future Insurance). UI reorganization only. |
| 20 | Per-holding waterfall — investedValue null handling | Bug Fix / Feature | Low | S–M | Pending | `computeSnapshotTransition` has a known gap surfacing `investedValue: null` for NPS/ULIP holdings. Needs a display-design decision (how to show "unknown invested value") before the fix itself. |
| 21 | App logo | Feature | Low | S | Pending | Pure branding/visual asset, no functional or data-model impact. Doesn't block anything else on this list. |
| 22 | Transaction-level investment data | Feature | Low | L | Pending | Mentioned as a future direction, more granular than snapshot-based tracking. Not yet scoped in any real detail. |
| 23 | Trailing-average smoothing for recurring commitments | Feature | Low | M | Pending | Future refinement to how recurring expenses are surfaced/predicted. Not yet scoped in detail. |
| 24 | Managed AI tier | Feature | Low (for now) | XL | Pending | "Coming Soon" only today. Needs its own proxy server + per-user metering + pricing model — the largest single initiative on this list. Revisit the Google-login question (see Parked) specifically when this gets scoped for real. |
| 25 | Desktop app packaging | Feature | Low | L | Pending | Tauri mentioned as an option. Undecided whether this wraps the hosted web app as-is or is a fully separate build. |
| 26 | Mobile companion | Feature | Low | L | Pending | Capacitor mentioned as an option. Not started. |
| 27 | SQLite migration | Feature | Low | L | Pending | For datasets larger than localStorage comfortably handles. No defined trigger/threshold yet for when this actually becomes necessary. |
| 28 | Apply asOfDate resolver + accounting period concept beyond Cash Flow | Feature | Medium | M | Pending | Cash Flow's resolver redesign and period-boundary logic (this session) is being built scoped to Cash Flow only. Net Worth, Investments, and Debt still use their own separate point-in-time logic (`computeNetWorthAsOfDate`, etc.) and haven't been migrated to the shared resolver yet. Real follow-up once Cash Flow's version is proven working. |
| 29 | Add Quarter and 6-month period filter options, across all screens | Feature | Medium | M–L | Pending | Cash Flow's filter already supports All time/Month/Year via `periodType` — Quarter and 6-month are the two genuinely missing granularities, and this asks for them everywhere, not just Cash Flow. **Depends on #28** — stock-type screens (Net Worth, Investments, Debt) need the shared resolver in place first, since "Quarter" on those screens means resolving a stock value as of the quarter's end boundary, not summing flows the way Cash Flow does. **Open question, unresolved:** does "6 months" mean a *rolling* trailing window (any 6 months back from today, recalculated daily) or a *fixed* calendar half (H1 = Jan–Jun, H2 = Jul–Dec, like a fiscal half-year)? These behave completely differently for both flow-summing and stock-boundary resolution, and the answer needs deciding before this is buildable, not assumed. |
| 30 | Split App.jsx into multiple files | Tech Debt | Low | L | Pending | App.jsx is 663KB / ~11,850 lines, past Babel's 500KB threshold for preserving original code formatting during transform — confirmed via the dev-server warning: "[BABEL] Note: The code generator has deoptimised the styling of App.jsx as it exceeds the max of 500KB." Not a functional bug — the app compiles and runs correctly regardless (esbuild has no equivalent complaint) — but it's a real, growing cost to dev-server rebuild speed as the file keeps growing with every new feature. Real fix is splitting by domain (licensing, Cash Flow components, Investments components, Debt components, shared helpers, etc.) into separate files. Deliberately not undertaken casually: a refactor of this scale on a file this large, this deep into a working, extensively-verified session, carries real risk of subtly breaking something already correct — deserves its own dedicated, careful pass, not a quick fix squeezed between feature work. |
| 31 | Category taxonomy extension — SIP/Lumpsum/Redemption, Debt-EMI/Debt-Disbursement/Debt-Lumpsum Payment, frequency for Investment/SIP + Debt-EMI + Income Salary/Dividend/Rent | Feature | High | M | ✅ Complete | Investment gets its own subcategories (was uncategorized); Debt folded into Transfer's subcategories rather than becoming its own top-level category, prefixed `Debt-` specifically to avoid colliding with Investment's bare "Lumpsum." Frequency eligibility extended via a shared `isFrequencyEligible` helper rather than repeating the same condition in four places. Caught and fixed two real bugs along the way: three of the four categorization UI surfaces (MerchantRow, BulkActionBar, RulesTab) still had a stale hardcoded `Expense/Fixed`-only check left over from before this helper existed, silently blocking Investment/SIP, Debt-EMI, and Income frequency selection in the UI despite the underlying logic being correct; and `commitBulkSelection` turned out to be genuinely live (wired via `onApply={commitBulkSelection}`, missed by an initial direct-call search), so changing its parameter order without updating the caller would have broken real, working bulk-categorization functionality. |
| 32 | `linkedAccountId` — optional account-linking on transactions | Feature | High | M | ✅ Complete | One generic field, not three — category+subCategory (via `linkableAccountTypesFor`) determine which account types are valid options, so a single field covers Investment's SIP/Lumpsum/Redemption, Transfer's Debt-EMI/Debt-Disbursement/Debt-Lumpsum Payment, and Transfer's Credit card payment. Wired into all four categorization commit paths and all three UI surfaces. Always optional, never forced, revisitable later — matching the "let it reconcile, don't gate on it" philosophy decided for the multi-loan/multi-SIP disambiguation question. |
| 33 | Debt pillar screen widened to include credit cards | Feature | High | S | ✅ Complete | Was hard-gated to loan accounts with an amortization schedule, silently excluding CC entirely even though CC outstanding already fed Net Worth's liabilities the same way loan outstanding does. Total outstanding now combines both (with a breakdown hint); Principal/Interest paid to date stay honestly loan-only, since CC has no equivalent breakdown to fold in. CC resolves via `lastKnownBalance` directly — a deliberately separate, lighter path from `computeDebtSummary`'s schedule-derived fields, not forced through the same function. |
| 34 | Three Control screens — Investments Control, Transfers Control, Debt Control | Feature | High | L | ✅ Complete | Named specifically to avoid colliding with the existing Investments/Debt pillar screens. Each reconciles bank-side activity against a derived figure, flagging non-zero as "something's missing" rather than owning any number itself. **Investments Control**: bank-side SIP/Lumpsum/Redemption vs. two independent derived figures (`added`/`redeemed` from `computeSnapshotTransition`, deliberately not netted, so one addition and one redemption in the same period can't offset and look falsely reconciled) — derived side currently covers demat/mutualFund only, `otherInvestment` explicitly not yet included since it doesn't share the same snapshot structure. **Transfers Control**: narrowed to Self/External only; Self has a genuine zero-sum check (every outflow should match an inflow elsewhere), External is informational only since it leaves the tracked system entirely. **Debt Control**: two tabs — Classic Debt (EMI genuinely checks against the schedule for that period, resolving overlapping schedules via most-recently-imported-wins; Disbursement/Lumpsum Payment shown informationally, no schedule-side counterpart) and Credit Card (the bank-payment-vs-statement grid moved here from Transfers Control, with the overall-total and by-card views added to match the other Control screens' shape). All three currently live as tabs within Review's existing mode switcher rather than dedicated top-level Data screens — a pragmatic, lower-risk placement choice; the original "under Data" framing could still be revisited if a more prominent location is wanted later. |
| 35 | Credit card outstanding-balance equation as an actual reconciliation check | Feature | Medium | S–M | Pending | `Previous Outstanding − Payments/Debits + Transactions(Purchases) = Current Outstanding` was confirmed as the correct formula, but isn't yet implemented as its own explicit check anywhere — Debt Control's Credit Card tab currently checks bank payments against statement expense totals, which is a related but different comparison. |
| 36 | Debt-Disbursement / Debt-Lumpsum Payment schedule-side reconciliation | Feature | Low (deferred) | Unscoped | Pending | Deliberately not designed yet — "let's see how it works in reality and evolve as we go." A Lumpsum prepayment is expected to trigger a fresh schedule upload (handled — most-recently-imported-wins resolution is built), but whether/how Disbursement and the prepayment event itself should get their own reconciliation check against real usage is still open. |

**Effort key**: S = small (hours), M = medium (a session or two), L = large (multi-session,
real design work), XL = large + needs new external infrastructure/accounts outside the
app itself.

---

## Parked — Revisit Later, Not Decided Against

These aren't in the priority list above because they're deliberately not being worked
toward right now — but the reasoning for *why* is worth keeping visible, not just the
fact that they're paused.

### Code obfuscation beyond minification
Real option, real trade-offs (bundle size, harder self-debugging, small risk of
introducing subtle bugs in financial calculations). Deprioritized in favor of cheaper
wins already done (private repo, explicit LICENSE file, sourcemap hardening). Revisit
if code copying becomes an actual observed problem, not preemptively.

### Google account login
Deliberately not built for Free/Licensed — a signed key proves entitlement without
needing to know who someone is. The one legitimate reason to reconsider: if Managed
AI's (#23) usage metering genuinely can't work without it. Even then, a lighter-weight
identity (an emailed token, closer to how AI providers hand out API keys) was suggested
as possibly a better fit than full OAuth.

### Consolidate migration guards into a single schemaVersion check
Currently three separate per-transaction functions run on every load — `migrateOne`
(guarded: skips anything that already has `frequencyClass`), `refreshMerchantKey` and
`backfillMissingFrequency` (both unguarded, safe to re-run unconditionally since they
only ever fill a gap or recompute a derived value, never overwrite a deliberate
choice). This is standard, expected practice for an app with no backend to track "which
installs are on which schema version" — a restored backup, an old browser profile, or a
machine not opened in months could load old-shape data at any point, and this is what
makes that self-healing rather than silently stuck. Confirmed as not a problem to ship
as-is. The real upgrade, if ever wanted: one `schemaVersion` field stored on the whole
data blob, checked once per load (`if (version < CURRENT) runMigrations()`) instead of
scattered per-function guards — cleaner, one place to reason about, easier to extend as
more migrations accumulate over time. An architectural improvement, not a fix for
something broken — revisit if/when the number of migration functions grows enough that
tracking them individually gets unwieldy, not preemptively.

### Goal funding-gap detection for long-term goal types
The Forecasting Engine's goal-funding-gap check (is a goal's planned SIP actually
happening, or has it silently stopped) works cleanly today for exactly two goal
types — Emergency Fund and Short-term — because those are the only ones with
`assignedInstrumentKeys`, a real link to specific holdings. The check itself needs no
new data model: compare a linked instrument's `investedValue` (cost basis, so it only
moves on real contributions/redemptions, never on market price swings) across
consecutive `holdingSnapshots` against the goal's required SIP rate from
`computeGoalMath`.
Every other goal type (education, marriage, house, car, retirement, custom) has no
such link — they're funded from `computeGoalsTracking`'s pooled "SIP auto-absorption"
across the whole portfolio's invested value, not a specific assigned instrument. A
per-goal funding-gap check doesn't have anything to attribute to for these; the only
thing checkable today is a portfolio-wide aggregate ("is total invested value growing
at roughly the sum of all long-term goals' required rates"), which can tell you
something is off but not which goal is actually underfunded. Deliberately scoped out
of V1 for this reason — revisit once there's a per-goal instrument link (or equivalent)
for the pooled goal types too, not as a blind aggregate check in the meantime.

---

## Completed (for reference — remove entries here once genuinely irrelevant)

- Free/Licensed tier enforcement across all five account-creation/import flows (Cash
  Flow, Debt, Investment holdings, Other Investments, Goals)
- Bank and Credit Card split into separate 1-account limits (was a combined pool of 2 —
  found to be wrong via live testing)
- Account picker UI, folded directly into the Accounts table's Status column
- Signed license key system (ECDSA P-256, fully client-side verification, no network
  call required to check a key)
- License entry/status modal, version display, custom-prompt-saving gate
- Unified Dashboard (six pillar summary cards, net worth "vs last snapshot" using
  point-in-time reconstruction, monthly net worth trend chart)
- CSS structure checker (`check_css_structure.cjs`) — catches malformed CSS inside
  style template literals that JS-only compile checks can't see; part of the standard
  verification routine now
