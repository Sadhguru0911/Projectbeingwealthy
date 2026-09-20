# Being Wealthy — Screen-by-Screen Functionality Reference

Every screen below is documented from the actual component code (`src/App.jsx`), cross-checked
against the inline comments added during this project's code-commenting pass — not from design
discussion alone. Where a screen's behavior isn't obvious from its name, the reasoning is
included, not just the mechanics.

Navigation is two-tier: the main pillar bar (Dashboard, Cash Flow, Net Worth, Investments, Debt,
Goals, Analyst, Personal CFO), plus a separate "Data" area (Upload, Review, Rules, Accounts)
reached from within the app, covering the underlying data the pillars all read from.

---

## Data screens

### Upload (`UploadTab`)

Bank and credit card statement import specifically — Investment and Debt each have their own
separate flows, since a holdings statement and an amortization schedule need entirely different
parsing.

Three ways in, all converging on the same finalize step:
1. **Unified upload** — one dropzone; an AI classification pass (`handleUnifiedFile` →
   `callDocumentClassify`) reads the file and decides what it is and how to structure it. A PDF
   is rendered to page images first (only the first 2 pages, enough for classification without
   spending tokens on the whole document); a spreadsheet sends a text sample of its rows. A
   password-protected PDF surfaces as a distinct state, prompting for the password and retrying,
   rather than a generic failure.
2. **CSV/Excel with manual column mapping** (`doImport`) — header-row detection (bank exports
   often have summary lines before the real header), then the person confirms which column is
   Date/Description/Debit/Credit/Amount.
3. **Paste-from-PDF** — a heuristic line-by-line parser for statement text copied directly from
   a PDF viewer, with an editable preview before committing.

Whichever path a statement takes, the shared finalize step resolves which account it belongs to,
dedupes against already-imported transactions, auto-categorizes via existing rules, and commits.
`ImportCompletionPromptPanel` then checks whether this import might settle a pending transfer
elsewhere, letting the person confirm which ones it resolves in one place.

### Review & Categorize (`ReviewTab`)

Five modes, switched via the top tab row:

- **By merchant (bulk)** (`MerchantRow`, `commitMerchantGroup`) — groups all currently-
  uncategorized transactions by merchant and tags a whole group at once. The fastest path for a
  first-time import, since one tag usually clears many transactions.
- **By transaction** (`commitCategory`) — fine-grained, one-row-at-a-time categorization with an
  inline dropdown per field, including the optional linked-account picker. This is the surface
  every categorization decision ultimately goes through if not handled in bulk, and every field's
  conditional visibility (`isFrequencyEligible`, `linkableAccountTypesFor`) is mirrored exactly
  across all three UI surfaces (this one, By merchant, and the bulk action bar) so tagging
  behaves identically no matter which surface is used.
- **Transfers Control**, **Investments Control**, **Debt Control** — the three reconciliation
  screens, each its own top-level component, hosted here as tabs (documented in their own
  section below).

Also hosts the dormant Self/Credit-card-payment substantiation system (`TransfersReviewPanel`,
`transferStatus`, `confirmTransferLink`) — a more elaborate linked/suggested/pending status
system, superseded by the simpler Transfers Control table but kept fully intact in case it's
wanted again later. Nothing in it is currently reachable from the UI.

### Rules (`RulesTab`)

Two sub-tabs:
- **Categorization rules** — the manual rule-creation form, the full rule list (system-seeded,
  learned, or user-added), and "Re-apply rules to existing data," which re-checks every
  rule-derived or still-uncategorized transaction against the current rule set while
  deliberately leaving manually-categorized transactions untouched — a rule edit can never
  silently overwrite a deliberate manual override elsewhere.
- **Merchant groups** (`MerchantGroupsPanel`) — combines near-duplicate merchant strings (e.g.
  "UPI SCAPIA SCAPIA" and "UPI SCAPIA TECHNOLOGY") under one display name for reporting. Purely
  cosmetic: categorization rules always match the original, ungrouped text. Suggestions come
  algorithmically (`computeSuggestedMerchantClusters`); groups can also be built entirely by
  hand.

### Accounts (`AccountsHistoryPanel`)

Lists every account across every bucket with its current balance, upload/statement history, and
account-level actions: activate/deactivate within the Free-tier bucket limit, delete a single
import batch or holding snapshot, or delete the whole account (cascading across transactions,
`balanceHistory`, `holdingSnapshots`, `debtSchedules`, and `otherInvestments` together, since one
account can have data in more than one of these depending on its type).

Also hosts the "Confirm" workflow for a parsed-but-not-yet-trusted opening/closing balance —
writes directly to `balanceHistory`, the single source of truth for confirmed balances, never to
any field on `uploadHistory` itself.

---

## Pillar screens

### Dashboard (`DashboardOverview`)

One card per pillar, each linking through to its full screen. Every number is computed directly
from the same source data every other screen uses — nothing here is duplicated logic that could
quietly drift from what those screens themselves show. The one deliberate exception: the Goals
card shows a simple count and aggregate target rather than a per-goal "on track" verdict, since
that verdict depends on the Goals screen's own near-term/long-term pool allocation logic —
reusing it properly means lifting that computation up, tracked as real follow-up work rather than
duplicated here at risk of disagreeing with the actual Goals screen.

### Cash Flow (`CashFlowOverview`)

Income, Expense, Investment laid out as one waterfall equation — Income − Expense = Savings;
Investment tracked as its own use of income, never folded into Savings. Plus:

- **Opening/Closing bank balance** for the selected period, resolved via
  `resolveAccountBalanceForPeriod`'s 3-tier confidence (exact/derived/estimate), aggregated
  across all bank accounts for the headline figure and shown per-account
  (`perAccountEquation`) so any discrepancy is traceable to a specific account.
- **Expense split two ways**: Fixed/Variable-Household/Variable-Personal (the composition pie),
  and separately Cash vs. Credit Card (`expenseByPaymentMethod`) — a card purchase and a
  debit-card purchase differ in *when* cash actually leaves the bank, so this is tracked as its
  own dimension, not folded into the first split.
- **Budget vs. Actual**, with a median-of-recent-months suggested budget per bucket (median, not
  mean, so one unusually large month doesn't skew the suggestion).
- Top merchants, a click-to-drill-down composition chart, and the monthly/month-over-month trend.

Every figure here is either summed directly from `transactions`, or — for Opening/Closing —
resolved through the shared balance resolver; nothing is a separately tracked or manually
entered number.

### Net Worth (`NetWorthOverview`)

Assets minus Liabilities, entirely derived from `computeNetWorthSummary` — nothing here is its
own separately-tracked figure, so this screen can never drift out of sync with what Cash Flow,
Investments, and Debt each independently show. The historical trend renders one point per month,
from the earliest data across every source (`balanceHistory`, `holdingSnapshots`,
`otherInvestments`) through today, each resolved via `computeNetWorthAsOfDate` at that month's
end date (or today, for the still-in-progress current month). Clicking any asset/liability row
navigates to the pillar screen that actually owns that figure.

### Investments (`InvestmentsOverview`)

Two sub-sections:
- **Market-tracked** (equity/demat and mutual fund accounts) — an Opening → Added → Redeemed →
  Closing → Growth waterfall, summed across every account's own latest snapshot transition
  (`computeSnapshotTransition` against each account's own previous snapshot — never fabricating
  a comparison point for an account with only one snapshot so far).
- **Other Investments** (`OtherInvestmentsPanel`) — PF, Gold, Property, and similar holdings that
  don't come from a holdings-statement-style import; manual entry with an optional PDF-assisted
  shortcut (`OtherInvestmentUploadFlow`) that fills in whichever fields weren't directly
  extracted from a statement.

### Debt (`DebtOverview`)

Both loans and credit cards, resolved through deliberately different paths: loans via
`computeDebtSummary` (fully schedule-derived — principal/interest split, next EMI, loan
completion), credit cards via plain `lastKnownBalance` (no amortization schedule exists for a
card, so there's nothing to derive from). Total outstanding combines both; Principal/Interest
paid to date stay honestly loan-only, since a card has no equivalent breakdown to fold in. Loan
cards show full schedule-derived detail (payoff progress, restructure history when more than one
schedule exists, continuity-gap warnings); a card gets a simpler card with just its current
outstanding.

### Goals (`GoalsOverview`)

Two fundamentally different funding models depending on time horizon:
- **Near-term** (due in under a year, any goal type) — funded by assigning specific named
  holdings (`computeNearTermGoalTracking`), since money needed soon has to be genuinely liquid
  and available, not resting on a long-horizon growth assumption. Emergency Fund goals target
  months × average monthly expense; every other near-term goal targets its own entered cost.
- **Long-term** (a year or more away) — funded as a share of one pooled portfolio value
  (`computeGoalsTracking`), not tied to specific holdings. Target corpus is computed by inflating
  today's cost forward and applying an assumed return rate over the years remaining.

Whatever's assigned to a near-term goal comes *out* of the pool long-term goals can draw from
first — money already claimed by one goal can't also silently fund another, the same way money
already spent isn't available to allocate a second time. Required lumpsum/SIP contributions are
always computed against the *full* target, then scaled by whatever fraction is still unfunded —
so a goal that's 60% funded correctly shows 40% of the original required contribution, not the
full amount recalculated as if nothing had been saved yet.

### Analyst / Personal CFO (`PersonaChatScreen`)

Shared component for both personas, distinguished purely by which persona is passed in (each
filters its own threads and prompt library separately). Every question comes from a template in
the built-in prompt library or a saved custom prompt, with any placeholder tokens (`[category]`,
`[account]`, `[goal]`, `[amount]`) resolved through a picker before the question is actually
asked. The resolved question is sent alongside a data bundle built from the real numbers that
question needs (e.g. `buildCategoryBundle`, `buildAccountBundle`) — so every answer is grounded
in the person's actual data, never invented. The user's message and a "Thinking…" placeholder
both appear in the thread immediately, before the API call resolves, so it reads as a live chat
rather than a form-then-wait interaction.

---

## Control screens (reconciliation only)

All three deliberately never own a number — every figure they show is either summed directly
from `transactions` or read from a pillar screen's own already-computed figure. They exist
purely to answer "does this reconcile," and are named "X Control" specifically to avoid
colliding with the Investments/Debt pillar screens, which do own their numbers.

### Transfers Control (`TransfersControlView`)

Reconciliation for **Self** transfers only — External is shown separately as informational,
with no zero-check, since money there genuinely leaves the tracked system with no "other side"
to ever expect.

The hero table is a matrix: one row and column per bank account, diagonal always blank.
`Cell[row, col]` = the sum of `row`'s own Self-transfer transactions linked (`linkedAccountId`)
to `col` — **never mirrored from the other side**. A zero grand total means every transfer has
been linked from both directions; a non-zero total honestly names which account's side is still
missing a link, rather than guessing at it. If only one side of a real transfer is ever
categorized and linked, the corresponding cell on the other side simply stays blank — that's the
control working as intended, not a bug.

### Investments Control (`InvestmentsControlView`)

Bank-side SIP/Lumpsum/Redemption transactions checked against two **independently-derived**
figures from holding snapshots — Added and Redeemed, never netted into one number, since a large
addition and a large redemption in the same period could otherwise offset and look falsely
reconciled.

Snapshot diffing deliberately starts from the *second* snapshot for each account, not the first
— the very first snapshot has no prior to compare against, so treating its entire opening
balance as a fresh "addition" would count years of pre-app investment history as current-period
activity (the exact bug this screen was built to catch and fix). Derived-side coverage is
currently demat/mutualFund only; `otherInvestment` isn't included, since it doesn't share this
same snapshot structure — a deliberate, stated gap rather than a silent one.

One merged table per account, with Addition/Redemption Diff columns and a Total row (rather than
separate hero-stat cards plus a separate breakdown table), plus an account filter that narrows
both the table and the transaction list below it.

### Debt Control (`DebtControlView`)

Two tabs, since loan and credit card debt resolve through genuinely different paths:

- **Classic Debt** — Debt-EMI genuinely checks against the amortization schedule for the
  selected period, resolving overlapping schedules via most-recently-imported-wins (the rule
  for handling a revised schedule uploaded after a prepayment). Debt-Disbursement and
  Debt-Lumpsum Payment have no schedule-side counterpart to reconcile against — shown for
  visibility only, not as a two-sided match, since a prepayment is expected to trigger a fresh
  schedule upload rather than being checked against the existing one. This is a deliberately
  deferred design decision, expected to evolve with real usage.
- **Credit Card** — bank-side payments checked against card-side statement totals, per card.
  This is the same bank-payment-vs-statement grid that originally lived in Transfers Control,
  moved here once Debt was widened to include credit cards, with the overall-total and
  by-card/Diff views added to match the other Control screens' shape.

Both tabs share the same merged-table-with-Diff-column-and-Total-row shape as Investments
Control, and an account filter that resets appropriately when switching tabs (Classic Debt and
Credit Card filter against entirely different account sets).


