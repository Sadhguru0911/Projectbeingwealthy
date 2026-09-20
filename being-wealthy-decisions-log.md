# Being Wealthy — Decisions Log & Roadmap

*Compiled as a reference document. Reflects everything agreed, built, or deliberately parked across the project's history.*

---

## Core philosophy (established from the start, still holds)

- Privacy-first, local-first personal finance tool
- Eliminate user decisions wherever possible (auto-detect, auto-classify, auto-fill)
- Reconciliation is the trust mechanism, not algorithmic inference
- **The AI never computes — it only narrates numbers a deterministic function has already computed and verified.** Every calculation in the app (Cash Flow equation, Investment waterfall, Goal math, EMI/affordability) is plain, tested code. Gemini's role is limited to: reading printed documents, classifying content, mapping columns, and writing narrative explanations of pre-computed numbers.
- Never invent or estimate missing data; always flag what's estimated vs. confirmed

---

## Features built and shipped

### Cash Flow
- Savings vs. Change-in-Cash distinction (accrual-based across all accounts vs. bank-only)
- Per-account equation breakdown, Transfer view (side-by-side, not algorithmic matching)
- Deterministic, thresholded "Insights" engine (merchant spikes, category spikes, budget pace) — rule-based, no LLM

### Cash Flow — balance resolver rewrite and 3-tier confidence
- **The problem this fixed**: a bank account with multiple monthly statement imports showed Opening/Closing as "estimated, not confirmed" even under "All time," because the old logic required one single upload to span the *entire* combined range — which never exists once more than one statement is imported.
- **The fix**: `resolveBalanceAsOfDate` resolves Opening and Closing *independently* — Opening = nearest confirmed point on-or-before the range's start, Closing = nearest point on-or-before the end — rather than requiring one upload to cover the whole thing.
- **3-tier confidence, replacing a flat binary confirmed/estimated**: **exact** (a statement directly confirmed this date), **derived** (no direct confirmation, but real transactions bridge the gap from the nearest confirmed prior point — computed, not guessed), **estimate** (pure carry-forward, no transaction data to bridge). The UI shows "calculated from your transactions" for derived, distinct from "estimated, not confirmed" for a pure guess — never rendered identically.
- **`balanceHistory[].date` renamed to `asOfDate`** across all read/write sites (14 spots) — the old name was ambiguous next to `uploadHistory`'s own date fields.
- **A serious production bug this rename caused, and the honest account of it**: the app crashed entirely on load for any existing saved data, since old-format `balanceHistory` entries (saved before the rename) had no `asOfDate` field at all, and `.localeCompare` on `undefined` throws. Traced to the exact line, then found **four more independently-vulnerable locations** doing the same unprotected sort elsewhere in the codebase (Net Worth's own balance resolution, a trend-months calculation, two write paths) — all fixed with the same defensive normalization (`h.asOfDate || h.date`), verified against the exact real-world mixed old/new-format scenario before considering it resolved.
- **`uploadHistory`'s redundant `openingBalance`/`closingBalance` fields removed** — `balanceHistory` is now the single source of truth for a confirmed balance; the Confirm-button UI was redesigned (not just patched) to look up `balanceHistory` directly (`getConfirmedBalance`) rather than reading a duplicated field that could silently disagree with it.

### Investments
- Holding snapshots model (not transaction-level cost basis)
- Snapshot-to-snapshot waterfall (Opening → Added → Redeemed → Growth → Closing)
- Import flow: CSV/Excel → Gemini classification → local parse → reconciliation → commit
- Embedded-image extraction (JSZip) for institution logos not present as text
- Field derivation: Units × Price relationships auto-computed when a statement omits one (e.g., Zerodha has no Invested/Current Value; Groww MF has no Avg Cost/NAV) — always labeled "calculated," never silently substituted

### Goals
- Future value / present value / SIP math, verified against hand-computed examples
- Long-term goals: portfolio-lumpsum allocation + optional SIP, with auto-absorption of SIP progress into tracked lumpsum in creation-order priority when new invested money becomes available
- Near-term goals (< 1 year, by time horizon not by type): funded by assigning **specific named holdings** (e.g., an arbitrage/liquid fund), not a portfolio-wide percentage — Emergency Fund is one type of near-term goal, "Short-term goal" is the general-purpose type for anything else due soon
- Required flags, all implemented: over-allocation warning, a disappeared/redeemed holding surfaced explicitly (not silently dropped), a goal's tracked funding falling short of its target

### Debt
- New pillar; amortization schedule import (CSV/Excel), isolated classification path (own schema, own prompt — never touching the working investment/bank classification)
- Per-period reconciliation (EMI = Principal + Interest; Closing = Opening − Principal) and cross-period continuity checks, both verified against a realistic 240-month schedule before shipping
- Restructuring support: a later-imported schedule's periods take priority over an earlier one's for any period both cover, computed live at read time, never merged into storage

### Investments — expanded to three sections, and Net Worth
- Investments restructured into **Market-tracked** (unchanged), **Statement-based** (PF/NPS/ULIP), and **Manual** (Gold/Property/etc.) — done by wrapping the existing, working market-tracked logic rather than rewriting it
- Statement-based and Manual both feed a new **Net Worth** pillar — a pure aggregator with no stored data of its own; every figure (bank balances, market-tracked investments, statement-based balances, manual assets, minus credit card debt and loan balances) is computed live from the other screens each render, verified against a full realistic scenario
- Statement-based assets support manual balance entry (all subtypes) and PDF upload with AI extraction (reuses the proven image-rendering PDF pipeline from bank statements, including the same password-handling flow) — an isolated, direct-facts extraction schema (not a column mapping, since these are narrative documents), deliberately designed to reference nothing PDF-specific so a future CSV/Excel path could produce the same output shape
- NPS and ULIP specifically support units + price-per-unit alongside a flat balance, since both have real underlying fund investments (unlike PF, which has no unit/NAV concept) — reuses the same Units × Price derivation logic already verified for market-tracked holdings, adapted to the simpler 3-field case

### AI Analyst & Personal CFO
- Two personas, same underlying deterministic-bundle architecture, different framing (descriptive/diagnostic vs. decision-support)
- Prompt library with a constrained placeholder-token system (`[category]`, `[account]`, `[goal]`, `[amount]`) — this is the actual safety mechanism: which pre-computed data bundle backs a question is dispatched by *which token types* appear in it, never by its wording, so a user-saved custom prompt is exactly as safe as a built-in one
- Live prompt set: Why did my expenses increase? / Where am I spending more? / Why did my savings rate fall? / How has my cash flow changed? / Where is my money going in a category? / What are my biggest financial leaks? / Am I investing consistently? / Can I afford a purchase? / How is a goal tracking? / **How did I do this month?** (comprehensive summary, income/expense/savings/investing vs. last month *and* a trailing 6-month baseline)
- Structured, schema-constrained output throughout (Analyst: Answer/Evidence/Insight/Attention; CFO: Recommendation/Why/Options/Impact)
- Chat UX: selecting a prompt sends it into the thread immediately with a live "thinking" indicator, rather than waiting on the whole round-trip before anything appears

**Explicitly not built, and why:**
- "What's changed in my net worth?" — omitted deliberately; the Net Worth screen doesn't exist yet, and faking that number would violate the core "never invent data" rule
- Scenario analysis ("what if my income fell 20%?") — flagged as valuable but deferred until the rest of the playbook is solid
- CFO's affordability check deliberately avoids inventing loan/EMI assumptions (interest rate, tenure) — compares a hypothetical spend against real unallocated invested value and average savings instead

### Category taxonomy extension, and `linkedAccountId`
- **Investment** gets real subcategories for the first time — `SIP`, `Lumpsum`, `Redemption` — matching the pattern Income already used (specific, meaningful labels, not a generic Fixed/Variable).
- **Debt folded into Transfer's subcategories**, not given its own top-level category — `Debt-EMI`, `Debt-Disbursement`, `Debt-Lumpsum Payment`, deliberately `Debt-`-prefixed to avoid colliding with Investment's bare `Lumpsum`. The reasoning that won out over a separate Debt category: an EMI transaction's principal portion isn't an expense (it converts cash into reduced liability, the same logic that already kept Investment separate from Expense) — but rather than split a single bank transaction into interest (expense) and principal (not expense), which a bank statement never tells you how to do, the cash-movement side is treated as a pure Transfer, and interest is sourced separately from the amortization schedule — the same principle credit cards already used (a purchase, not the later payment, is the real expense).
- **`linkedAccountId`** — one generic optional field, not three separate ones. `linkableAccountTypesFor(category, subCategory)` determines which account types are valid link targets, so a single field covers Investment's SIP/Lumpsum/Redemption, Transfer's Debt-EMI/Debt-Disbursement/Debt-Lumpsum Payment, and Transfer's Credit card payment. Always optional, never forced at categorization time, revisitable later — the explicit design answer to "which loan/investment/card does this transaction belong to when more than one exists": don't gate categorization on it, let the person see it reconciles (or doesn't) under the relevant Control screen instead.
- **Self transfers also got `linkedAccountId`**, extending the same field to a fourth case — links to another bank account, enabling the Transfers Control matrix table (below) instead of relying on visual date-proximity alone.
- **Frequency extended** via a shared `isFrequencyEligible` helper (replacing a hardcoded `Expense/Fixed`-only check repeated in four places) to also cover `Investment/SIP`, `Transfer/Debt-EMI`, and Income's `Salary`/`Dividend`/`Rent` — deliberately excluding Income's `Others` and every one-off Transfer/Investment subcategory, which by nature don't recur on a predictable schedule.

### Three Control screens — Investments Control, Transfers Control, Debt Control
- **The core idea**: a "control account," in the accounting sense — a screen whose only job is checking whether a bank-side figure and an independently-derived figure agree, flagging non-zero as "something's missing" rather than a place that owns or displays any number itself. Named "X Control" specifically to avoid colliding with the Investments/Debt *pillar* screens, which do own their numbers — a real naming collision, confirmed against the actual navigation code before the rename.
- **Investments Control** — bank-side SIP/Lumpsum/Redemption vs. two *independently* derived figures from holding snapshots (Added, Redeemed) — deliberately never netted into one number, since a large addition and a large redemption in the same period could otherwise offset and look falsely reconciled.
- **Transfers Control** — narrowed to Self/External only once Debt and Credit Card moved to Debt Control. Self transfers get a genuinely new table shape: a matrix, one row and column per bank account, diagonal blank. `Cell[row, col]` = that account's own transactions linked to that column — **no mirroring between the two sides**. This went through several iterations before landing (an initial two-column "inflow/outflow" idea, then a "reflected value" idea that risked double-counting if both sides eventually got linked, before settling on the current no-mirroring version) — verified against the person's own worked numerical example (11/11 checks passing, including a fully-reconciled zero grand total) before being considered correct.
- **Debt Control**, two tabs since loan and credit-card debt resolve through genuinely different paths (schedule-derived vs. plain `lastKnownBalance`) — Classic Debt (EMI checks against the schedule; Disbursement/Lumpsum shown informationally, deliberately deferred pending real-world usage) and Credit Card (the bank-payment-vs-statement grid, moved here once Debt was widened to include cards).
- **Merged-table redesign**: all three screens' original design (separate hero-stat cards plus a separate by-account breakdown table) was rebuilt into one merged table per screen — per-account rows with an explicit Diff column and a Total row, plus a consistent account filter across all three, so a reconciliation gap is visible exactly where it lives rather than only as one vague overall figure.
- **Debt schedule resolution for overlapping periods**: `debtSchedules` is append-only, not replace-on-reupload (a revised schedule after a prepayment coexists with the original). For any period more than one schedule covers, the most-recently-imported one wins — already-passed months naturally stay on the original schedule, since a later revision has no entries for periods before it existed.
- **Debt pillar screen widened to include credit cards** — previously hard-gated to loan accounts with a schedule, silently excluding CC entirely even though CC outstanding already fed Net Worth the same way loan outstanding does. Total outstanding now combines both; Principal/Interest paid to date stay honestly loan-only, since CC has no equivalent breakdown to fold in.

### Real bugs found and fixed this session (worth remembering the root causes)
- **Malformed JSON from missing `responseSchema`**: any Gemini call using only `responseMimeType: "application/json"` without a strict schema is meaningfully more likely to produce invalid JSON (an unescaped quote inside a free-text field). Fixed in the Goals cost-estimate feature; the lesson was applied everywhere else from that point on.
- **Grabbing a "thought" part instead of the answer**: a thinking-capable model can return internal reasoning as a separate response part; without filtering `!p.thought`, code can accidentally try to parse that reasoning text as the JSON answer. Found and fixed in two places.
- **Token-budget truncation**: reasoning tokens count against the same `maxOutputTokens` ceiling as the actual answer — too low a budget can cut the JSON off mid-string (looks like a parsing bug, is actually a budget problem). Fixed by raising budgets across all Gemini calls in the app.

### Real bugs found and fixed in a later session (Debt/Investment/Control screens work)
- **Investments Control counted years of pre-app investment history as a current-period addition**: `computeSnapshotTransition(null, firstSnapshot)` correctly treats an account's very first snapshot as having no prior to compare against — but summing "added" across *every* transition for "All time" included that first one, meaning an account's entire opening balance (built up over years before this app existed) was counted as if it happened in the current reconciliation period. This produced a visibly absurd number (crores of "additions" against a few lakh on the bank side) that made the bug obvious from a screenshot. Fixed by starting the sum from the second snapshot; verified against the exact real account's numbers before considering it fixed.
- **A stale hardcoded frequency check silently blocked the whole taxonomy extension above**: three of the four categorization UI surfaces (bulk-by-merchant, the bulk action bar, the Rules-tab manual form) still checked `category === "Expense" && subCategory === "Fixed"` directly, left over from before the shared `isFrequencyEligible` helper existed — meaning Investment/SIP, Debt-EMI, and Income frequency selection were never actually offered in those UIs, despite the underlying logic being correct. A fourth surface (the main per-transaction row in "By transaction" mode — likely the most-used surface of all) was missed entirely in the first pass and only found because the person reported the dropdown simply wasn't there.
- **A parameter-order mismatch that would have broken real, live functionality**: `commitBulkSelection` was assumed to be dead/unused code (a direct-call search found nothing), so its parameter order was changed freely while adding `linkedAccountId`. It was actually wired in via `onApply={commitBulkSelection}` (a reference the direct-call search missed) — the live bulk-categorization feature would have silently passed the "remember" checkbox's value into the linkedAccountId slot had this not been caught before shipping.
- **A sandbox reset mid-session lost all git commit history** (not the code — the last verified zip export always matched the committed source exactly, so no actual work was lost) but confirmed a real, worth-remembering limitation: git history lives only in the ephemeral build sandbox, never in an exported zip. Recovery was: restore from the last zip, `git init` fresh, continue committing from that point.

---

---

## Process & tooling, established this session as standing practice

- **Verification discipline for every single code edit, no exceptions**: `git diff` (confirm exactly the intended lines changed, nothing unintended), a CSS structure checker script (catches malformed CSS inside template literals — a real, previously-encountered failure mode), and a real `esbuild` compile — in that order, before every commit. Established after a sandbox reset mid-session proved that git history itself is not durable (see the bugs section above); the file *content*, verified this way at every step, is what actually stayed safe.
- **Standing code-commenting practice, now recorded as a persistent preference**: every new or changed function gets a thorough explanatory comment — what it does *and* why, including non-obvious reasoning — as a default, not only when explicitly requested. A full pass was done across every one of the app's ~127 top-level functions to bring the roughly half that predated this practice up to the same standard, each individually verified and committed, catching two real, separate bugs along the way (an indentation slip, and the stale-frequency-check surfaces described above) purely by the discipline of reading each function carefully before describing it.
- **Three companion reference documents**, kept alongside this log rather than folded into it, since each gets referenced differently and keeping them separate keeps each one actually usable on its own:
  - `being-wealthy-data-model.md` — every core data structure's real, verified field-by-field schema, with realistic examples, plus a Mermaid architecture/data-flow diagram
  - `being-wealthy-screens-reference.md` — what every screen actually does and computes, verified against the component code
  - This document — the *why* behind decisions, which the other two deliberately don't attempt to capture

---

## Design decisions made, explicitly deferred for later implementation

### Cash Flow "Views" system
- A "View" switcher added to Cash Flow, defaulting to today's Overview
- New "Money Flow" view: three stacked report blocks —
  1. Income/Investment-Redeemed/Transfer-In vs. Expense/Transfer-Out/Investment-Made, bank-scoped, expandable by Bank Account **and** Month together
  2. Income/Expenses/Savings/Savings-Rate table, expandable by Month
  3. Expense Breakdown, **one dimension at a time** (Business/`purpose`, Cash vs. Credit, Category, or Subcategory), drilling all the way to the transaction level
- Deliberately a curated set of report types with constrained expansion dimensions, not a fully generic pivot-table builder — the reasoning: a generic builder would let someone construct a combination that looks plausible but is quietly wrong, reopening exactly the kind of bug (e.g., CC double-counting) that took real design work to close elsewhere in the app
- **Status: fully designed, confirmed, not yet built.**

### Cash Flow Calendar
- The vision, from a detailed product document: map cash flow onto an actual calendar, with three distinct layers of increasing complexity — a historical day-by-day view (cheap, buildable now from existing transaction dates), a recurring-commitments overlay (which fixed expenses/SIPs/EMIs land on which day), and a forward-looking balance projection with a "danger zone" warning for a day the projected balance might dip uncomfortably low.
- **Real gaps this surfaced, now addressed elsewhere**: `frequency` alone doesn't give a calendar a *day* to plot on — only how often something recurs, not which day. Income had no recurrence signal at all before this discussion (this directly motivated extending `frequency` to Income's Salary/Dividend/Rent, described above). A forward balance projection needs its own new algorithm — the mirror image of the backward-looking resolver, not a reuse of it — plus a new "minimum cash buffer" person-set preference that doesn't exist anywhere in the app yet.
- **A "Recurring Commitments" screen concept** emerged from this discussion — activated by how someone categorizes a transaction (marking something Fixed/SIP/EMI with a frequency spins up a reviewable, editable commitment record, separate from any single transaction, reusing the existing Rules-matching engine to recognize the next month's occurrence as the same commitment rather than creating a duplicate) — genuinely superseded in shape by the Control-screens work above, which solved the same underlying "is this the same recurring thing showing up again" problem for SIP/EMI/Self specifically, but the Recurring Commitments idea for the *calendar/day* concept remains undesigned.
- **Status: extensively discussed, the resulting `linkedAccountId`/taxonomy work was built, but the calendar view itself — day-by-day layout, the recurring overlay, and the forward projection with danger-zone warning — remains fully undesigned in UI terms and entirely unbuilt.**

### Packaging & distribution
- **Tauri** chosen for desktop packaging (Windows/Mac installers) — reconsidered from an initial Electron lean once it became clear Tauri's official plugins (SQLite, filesystem, auto-update) can be called directly from JavaScript, meaning little to no custom Rust code is actually required for this app's needs
- Rejected alternatives and why: **Electron** (heavier, but was briefly the leading choice before the Rust-requirement correction); **PWA** (too little — no true native install, no real SQLite); **Neutralino.js** (too lightly battle-tested for an app holding real financial data)
- **Mobile (via Capacitor)** — sequenced as a distinct later phase, after desktop is proven; will need real responsive-design work since current layouts assume desktop widths, plus a native SQLite plugin
- Auto-updates: both Tauri and the rejected alternatives have this solved as standard infrastructure (a hosted version manifest + built-in updater) — not something to build from scratch
- **Status: direction agreed; actual scaffolding/build not started. Noted limitation: this needs to be built and tested on a real machine with the Rust toolchain and network access — not fully verifiable in the current sandboxed build environment.**

### Local database migration
- **SQLite** chosen over Postgres — the deciding factor is operational weight: Postgres is a running server process someone would need installed and kept alive; SQLite is just a file on disk, bundled into the app itself, with zero setup step for the user
- Direct consequence: backup becomes "copy the file"
- **Status: schema/migration not yet designed or built.**

### Backup strategy
- The app will never integrate directly with a cloud provider's API (Dropbox/Drive/OneDrive) — instead, the user points the app at a folder on their own machine (which can itself be a cloud-synced folder), and the app writes a backup file there; the user's existing sync client does the actual cloud part
- **Immediate, smaller first step (agreed to build before the Tauri/SQLite migration)**: a plain export-to-file / import-from-file feature in the current browser app, to close the real today's-risk that no backup mechanism currently exists at all
- **Status: the simple browser-based export/import is the next thing to build. The fuller folder-based backup comes with the SQLite migration.**

### Upload screen unification
- Current state: **4 separate tabs** — CSV file, Paste from PDF, PDF (AI-assisted), Investment holding — each with its own flow, rather than one unified entry point
- Direction discussed: a single dropzone/upload experience that detects what kind of file/content it's given, rather than making the user pre-select which of 4 tabs matches their file
- **Design principle established, to carry into that eventual unification**: the *file format should never determine the data* — extraction schemas should be built around the target fields (what we want to know), never around the input format (PDF vs. CSV vs. Excel). The statement-based asset (PF/NPS/ULIP) extraction schema was deliberately built this way as a working precedent — it asks for facts (institution, date, units, price, balance) with no mention of PDF anywhere in its shape, so a future CSV/Excel path for the same asset types could produce the identical output without any downstream code changing. Worth using as the template when unification is actually designed.
- Related, smaller deferred items from the same discussion:
  - The **Paste from PDF** tab (manual text-paste heuristic parser) was under consideration for retirement once unification happens, but hasn't been retired
  - **PDF-based investment holding statements** (as opposed to CSV/Excel) currently just show a "use CSV/Excel instead" message — AI extraction for PDF holdings statements specifically was never built
- **Status: fully discussed, not designed in detail, not built.** This is a real, standing item — flagging it as a gap in this log's first version was itself a good catch.

### Other smaller parked items (from earlier in the project, worth not losing track of)
- **Trailing-average smoothing for recurring commitments** (e.g., a fairer way to detect/amortize a recurring fixed expense than a raw single-month figure) — parked as a discussion, no design agreed
- **Transaction-level investment data feeding into positional holdings** — noted as a "Phase 2" idea (today's Investments feature works purely off holding snapshots, not individual buy/sell transactions) — not designed, not scheduled

### Central AI backend with metered tiers
- Reasoning locked in: a **hybrid** approach (BYOK for extraction, shared backend for narration) was considered and explicitly rejected — not just for being confusing, but because it's structurally incapable of enforcing usage tiers. BYOK traffic is invisible to any system the product owner controls, so a "10 statements/month free" limit can't be enforced on that path no matter what.
- Therefore: **all** AI traffic (extraction and narration) would need to flow through one central backend for metering/tiers to be possible at all
- Envisioned shape: free tier (e.g., 10 statements/month, anonymous device ID, no personal data), premium tier (more statements + Analyst/CFO access)
- Data-handling design: the backend holds no financial data at rest — statement content passes through to Vertex and back transiently; its only persistent state is usage counts per identity
- Hosting direction: Google Cloud Run suggested (stays in the same ecosystem as Vertex, scales automatically, billed on actual usage)
- **Status: fully designed, explicitly parked. For the current testing phase, the product owner's own Gemini API key will be shared directly with testers instead — the existing BYOK code path stays as-is for now.**

### Identity/licensing for the premium tier
- Three options weighed:
  - **A — Anonymous device ID + license key**: zero personal data, but premium status doesn't survive a reinstall or new device unless the user has saved their own key
  - **B — "Sign in with Google," used narrowly to look up license status only** (no profile, no preferences, no activity history) — **this is the option chosen**, once account/billing work resumes. Honest caveat on record: even this minimal version means a Google identifier (likely an email) touches the backend, which is genuinely personal data under frameworks like India's DPDP Act — a real, if small, step into the data-handling territory the product owner wants to minimize
  - **C — A full account system** (profiles, preferences, history) — considered and rejected as unneeded scope
- **Status: direction agreed (Option B). Explicitly parked along with the central AI backend — not part of the current testing-phase build.**

---

## Open questions still without a firm decision

- Exact SQLite schema design (translating today's localStorage shape into real tables) — not yet started
- Whether Vertex/Agent Platform's *default* 30–55 day operational log retention is acceptable long-term, or whether true zero-data-retention needs to be arranged directly with Google Cloud (this was flagged as something the product owner should verify directly with Google, not something confirmable from documentation alone)
- Timing/sequencing of the Money Flow Cash Flow view relative to the packaging/scaling work — no explicit priority order given between the two workstreams

---

## Immediate next step (agreed)

The full, live, prioritized backlog is `BACKLOG.md`, not this document — it now carries a
Status column (Complete/Pending) and 36 tracked items. The two most relevant open threads as of
this update: **Cash Flow Calendar** (extensively designed above, entirely unbuilt — the
day-by-day layout, recurring overlay, and danger-zone projection), and the still-unresolved
export-to-file / import-from-file backup feature noted in earlier versions of this log, which
remains a real, present data-loss risk that hasn't yet been addressed.
