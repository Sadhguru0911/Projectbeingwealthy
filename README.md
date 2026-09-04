# Being Wealthy — Cash Flow

A private, local-only personal finance tool. Import bank/card statements
(CSV, AI-assisted PDF, or pasted PDF text), auto-categorize with rules
that learn from you, and see your income, spending, savings, and
investment picture on one Cash Flow dashboard. Net Worth, Investments,
and Goals are designed in but not yet built — the navigation already
shows where they'll go.

## What's in here

- **Import**: CSV with flexible column mapping, PDF via AI-assisted extraction
  (see below), or paste text manually as a zero-setup fallback.
- **PDF via AI-assisted extraction**: the PDF is decrypted locally if
  password-protected (the password never leaves this device), then each
  page is rendered to an image locally via `pdfjs-dist`. Only those page
  images — never the PDF file itself — are sent to Gemini for structuring,
  using an API key you provide (`src/App.jsx`, "PDF (AI-assisted)" tab).
  That request goes directly from your browser to Google; nothing passes
  through any server of ours. Sending page images (rather than text we
  extracted ourselves) means Gemini reads the actual table layout directly
  — wrapped descriptions, vertically-centered amounts, paired date
  columns, inconsistent page footers, even scanned pages — instead of
  inheriting every bug in a hand-built text parser's reconstruction of it.
  A purely local heuristic parser is still used for the "Paste from PDF"
  tab as a zero-cost, zero-setup fallback for anyone without an API key.
  The response is structurally enforced via Gemini's `responseSchema` (not
  just asked for nicely in the prompt), and if a response is still cut off
  by the output token limit, complete transaction rows are salvaged from
  what came through and the remainder is fetched in a follow-up call
  automatically, rather than the whole extraction failing.
- **Institution auto-detection**: for AI-assisted imports, Gemini also reads
  the bank/card issuer's name printed on the statement itself. If it
  matches exactly one existing account, that account is selected
  automatically — no manual institution pick, which is exactly what used
  to cause duplicate accounts (a forgotten nickname, or a wrong pick from
  a dropdown, silently starting a second account for the same bank). A
  genuinely new institution auto-fills as free text instead of requiring
  a preset selection. CSV and pasted-text imports still need manual
  entry (there's no statement page to read a name from), but now default
  to picking from your existing accounts list rather than free-typing
  Institution/Nickname each time.
- **Duplicate statement protection**: every import is checked against that
  account's upload history using up to three independent signals — the
  derived transaction date range, a printed statement-period range, and
  a printed statement date — matching on ANY shared signal. Multiple
  signals matter because AI-extracted text isn't guaranteed identical
  between two separate calls on the same PDF: if a second extraction
  attempt misses one transaction, the derived range alone would shift and
  silently miss a real duplicate — but a printed statement date read
  correctly from the page still catches it. For AI-assisted imports, this
  check happens right after Gemini responds, before you're even shown a
  reconciliation preview to review. Upload → "Upload history"
  (collapsible) lists every import with its period(s) and lets you delete
  one if you need to re-import — deleting removes exactly that batch's
  transactions and balance snapshots, but never touches your rules, so
  re-importing re-categorizes automatically from what you've already
  taught the app.
- **Balance reconciliation, fully automated for AI-assisted imports**:
  opening and closing balance are both read directly off the statement
  (Gemini extracts whatever label the statement itself uses — "Opening
  Balance"/"Closing Balance" for a bank account, "Previous Balance"/
  "Total Outstanding" from a credit card's Account Summary box), with no
  manual typing required. The app checks that Opening + net transactions
  = Closing, and that check — not a pre-typed requirement — is what
  decides whether to trust the result: an explicit value is trusted
  regardless (a mismatch there more likely means a missed transaction
  than a wrong stated number), while a value derived from the running
  balance chain is only trusted if the reconciliation actually holds. A
  clear warning appears if it doesn't. It also corrects debit/credit
  direction using the running balance itself where available — a blank
  Debit or Credit cell in a PDF has no text for extraction to see, so a
  credit-only row and a debit-only row can otherwise look identical.
  This runs the same way regardless of whether rows came from AI
  extraction or the local heuristic parser — code is always the final
  check, not the model. **Credit card accounts are supported explicitly**
  (Upload → Account type): a credit card's balance moves opposite to a
  bank account (a purchase increases what's owed, a payment decreases
  it), and every place that reasons about balance direction accounts for
  that inversion automatically once you mark an account as a credit card.
- **No transaction is ever auto-dropped as a "likely duplicate."** Two
  genuinely separate transactions can share the exact same date,
  description, and amount (two orders from the same merchant a minute
  apart — the date field is day-level, not timestamped), and there's no
  way to reliably tell that apart from an actual extraction artifact
  (Gemini occasionally re-sending the same row when a long statement
  needs multiple continuation calls) using the data alone. Every row
  Gemini returns gets included; reconciliation is the real, objective
  check for whether the extraction is complete and correct. Anything
  that shares a date/description/amount with another row in the same
  preview gets a small "possible duplicate" flag so it's easy to spot,
  but the include/exclude decision is always left to the person
  reviewing, with the full context of the rest of the statement.
- **Per-account "All time" resolution**: when viewing All time with
  accounts of different ages (an older account with data going back
  further than a newer one), each account resolves its own opening and
  closing balance using its OWN transaction date range — not a single
  combined range across every account. A shared range would otherwise
  ask "what was this newer account's balance before it even existed,"
  which can never resolve to anything. A specific month or year still
  uses one shared calendar boundary across every account, since that
  actually is meaningful uniformly.
- **Upload history always records what was parsed**, independent of
  whether reconciliation trusted it enough to feed the Cash Flow
  equation. If an opening balance had to be derived (no explicit label
  found) and reconciliation didn't quite clear the bar, it doesn't just
  silently vanish — Upload history shows it labeled "parsed, not
  confirmed," with a one-click Confirm to promote it into real balance
  history once you've reviewed the number and trust it, no need to
  delete and re-import the whole statement over one figure.
- **Nothing carries over between imports**: Institution, Nickname,
  Account Type, and both balance fields all reset to blank the moment an
  import completes — never silently left over for the next one. Picking
  up where you left off for the SAME account is one click via the
  Account dropdown (Upload → Account); starting a genuinely different
  account always begins from a clean slate, which is what prevents a
  forgotten field from quietly attaching one statement's data to the
  wrong account.
- **Categorization**: rule-based, with bulk "by merchant" tagging, a
  similarity-grouped view for spotting near-duplicates, multi-select bulk
  actions, and instant cascading — tagging one transaction retroactively
  tags every other currently-uncategorized transaction that matches.
- **Categories**: Income / Expense / Investment / Transfer, with Expense
  split into Fixed/Variable + Household/Personal, Income split into
  Salary/Dividend/Rent/Others, Transfer split into Self/Credit card
  payment/External, a Business/Personal purpose flag on any transaction,
  and a Monthly/Annual/Quarterly frequency on Fixed expenses (so an
  annual insurance bill doesn't spike one month's budget).
- **Merchant groups**: combine near-duplicate merchant strings (e.g. two
  slightly different bank descriptions for the same merchant) under one
  canonical name, with auto-suggested clusters to confirm or edit.
- **Transfers — side-by-side, no matching required**: Review → Transfers
  shows two tables, one column per account, sorted by date. The top
  table covers Self and External transfers on bank accounts — a real
  transfer's outflow and inflow are two separate transactions that land
  in different account columns, so once both statements are imported,
  they naturally appear on the same or nearby date without anything
  needing to explicitly link them. The bottom table covers credit cards:
  a payment leaving a bank account (a real Transfer transaction) sits
  next to that card's statement summary (one row per import, with its
  period and total expense — there's no per-transaction "transfer" on the
  card side, since a purchase is an Expense, not a Transfer). A payment
  with no nearby statement is exactly as visible as a gap in a
  spreadsheet — no algorithm or notification needed to point it out.
  (An earlier algorithmic matching/linking system — suggested matches,
  confirm/unlink, substantiation prompts — is still fully present in the
  code, just not currently used by this view, in case it's wanted again.)
- **Cash Flow Overview**: a real cash-flow equation — Opening → Income →
  Expenses → Savings → Investments → Net Change in Cash → **Transfers** →
  Closing. Transfers (Self, Credit card payment, External) are a genuine
  term in the equation now, not an afterthought — money moving between
  your own accounts, paying off a card, or going out externally all
  visibly account for the gap between computed and actual closing balance
  that used to be invisible. Every box's color and sign follow its own
  actual value, uniformly — an investment redemption or a net transfer
  inflow correctly shows as a positive, not a fixed minus sign that would
  otherwise misrepresent it. One "Expand breakdown" control reveals both
  the per-account balances (each clearly labeled "from this statement" or
  "carried forward, not confirmed") and the transfer amounts by subtype.
  A first-ever import for any account requires an opening balance before
  extraction can proceed, so every later period has a real number to
  resolve against — not just a carried-forward guess. Below the equation:
  up to 3 automatically-surfaced insights (a merchant spending spike, a
  Fixed or Variable expense jump vs last month, budget pace projection, or
  a savings-rate swing), each only shown when it clears a real threshold —
  an honest "nothing notable" when nothing does. Further down: cash flow
  and savings-rate trends, expense categories, an Income vs Expense
  (Fixed/Variable) monthly trend, income sources, recurring (Fixed)
  commitments, budget vs actual, and a collapsed transaction list for the
  selected period.
- **Light/dark theme**, toggleable from the header, persisted across
  sessions.
- **Two-tier navigation**: a pillar switcher (Cash Flow live; Net Worth,
  Investments, and Goals shown as "Soon," each with a one-line preview of
  what's planned) sits above a separate Data section (Upload/Review/Rules)
  that stays available regardless of which pillar you're viewing.

## Privacy

Everything runs entirely in your browser, on this machine. All data —
transactions, rules, budgets, merchant groups, account balance history,
your theme preference — is stored in your browser's `localStorage`, under
the key `being-wealthy:appData` (your Gemini API key lives in its own
separate slot, `geminiApiKey`, deliberately not cleared by "Reset local
data"). Nothing is uploaded anywhere, there is no server, no account, and
no network calls except an optional Google Fonts CSS request for the
display typefaces (no personal data is included in that request) and,
when you actively use AI-assisted extraction, the page images sent
directly to Google's API. If you want fully offline operation, delete the
`@import url('https://fonts.googleapis.com/...')` line near the top of
`src/App.jsx` — the app will fall back to your system fonts.

Because data lives in this browser's localStorage, it is tied to *this
browser, on this machine*. It won't sync to another device, and clearing
your browser's site data for this app will erase it. If you want a backup
or want to move to another machine, that's a natural next feature to add.

## Setup

Requires [Node.js](https://nodejs.org) 18 or later.

```bash
npm install
npm run dev
```

Then open the URL it prints (usually `http://localhost:5173`).

### Setting up AI-assisted PDF extraction (optional)

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with a Google account, then click **"Get API key"** (usually in
   the left sidebar) → **"Create API key"**
3. Copy the key (starts with `AIza...`)
4. In the app, go to Upload → **"PDF (AI-assisted)"** tab → paste it into
   the API key field → **Save key**

The key is stored only in this browser's localStorage — never sent
anywhere except directly to Google's API when you actually use this
feature. Usage is billed to your own Google account; Google AI Studio
currently offers a free tier for Gemini API usage, and for a typical
monthly statement the cost (if you exceed the free tier) is very small.

The model picker defaults to **Gemini 3.6 Flash**. Gemini's model IDs
change fairly often as Google ships new versions and retires old ones —
this app has already hit that once (an earlier default, `gemini-2.5-flash`,
stopped being available to new users). Rather than hardcode a second
model name that risks the same breakage, the picker has a **"Other — type
a model ID"** option: if extraction ever fails with a "model not found"
style error, look up the current model name at
[ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)
and type it in directly — no code changes or new build needed.

## Production build (optional)

If you'd rather not run a dev server every time:

```bash
npm run build
npm run preview
```

`npm run build` produces a static `dist/` folder. `npm run preview` serves
it locally so you can confirm it works, but you can also open
`dist/index.html` directly or host the `dist/` folder with any static file
server if you ever want to self-host it.

## Project structure

```
src/
  App.jsx        the whole application (upload, review, rules, Cash Flow
                 dashboard, and the pillar/data navigation shell)
  storage.js     the local-storage adapter — this is the only place that
                 touches persistence; swap it out if you ever want a
                 different storage backend (e.g. a local file, IndexedDB)
  pdfExtract.js  local PDF decryption, text extraction, and page-image
                 rendering via pdfjs-dist — everything the AI-assisted and
                 Paste-from-PDF flows need happens here, on this machine
  main.jsx       React entry point
```

## Next steps worth considering

- A "backup / restore" button that exports all localStorage data as a
  single JSON file you can save and re-import — useful before clearing
  browser data, or to move to a new machine.
- Swapping `localStorage` for `IndexedDB` if your transaction history grows
  large (localStorage has a ~5–10MB practical ceiling depending on browser).
- Very long statements (more than ~20 pages) are currently capped in
  `pdfExtract.js` (`MAX_RENDER_PAGES`) to keep the request size reasonable —
  worth revisiting if that limit is ever actually hit in practice.
- The Gemini model dropdown is hardcoded to a specific model name string,
  which providers periodically rename or retire — the "Other — type a
  model ID" option exists specifically so this doesn't require a code
  change, but the default itself may need updating over time.
- The waterfall's Opening/Closing cash figures depend on real balance
  snapshots — accounts imported before this feature existed won't show
  them until you re-import their most recent statement once.
- Net Worth, Investments, and Goals are designed (data model, navigation)
  but not built — natural next pillars once Cash Flow has been used for a
  while.

