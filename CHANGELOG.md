# Change Log

## 9 Oct 2026 (twenty-fifth pass, 0.6.3.0) - remark rules; payments with the same remark are one review card (backlog #166)

Why: each driver paid with the same remark (e.g. "Communite Rapido") was its own review card, and answering one did not clear the others. The user asked for a rule tied to the remark, similar remarks clubbed into one card, "Rapido" and "Communite Rapido" treated as different, and no remark dropped.
Changed: `src/inference/remark.js` (`remarkKeyOf`: the remark's words, sorted, any order, so "Communite Rapido" = "Rapido Communite" but "Rapido" differs; `remarkRuleHits`). `src/App.jsx` (rule scope "remark" matched through `ruleTest`; `applyMerchantAnswer` makes a remark rule, priority 500, below payee rules and above the library; a card is clubbed by remark only when the row has a remark, is not a merchant, has no library hit and no non-remark rule; Rules tab shows "Remark: ..."; editing recomputes the key). `needsYou.js`, `ruleStats.js` (conflict and dead-rule checks understand remark rules), `OnboardingFlow.jsx` (card shows remarks with counts, "N different payees", group hint shown first as suggested).
Not changed: rows without an AI key keep whole-line library lookup until migration (#162); typos such as "RQPIDO" are shown as their own remark with no hint; NEFT/IMPS/NACH remarks (#167).
Tests: `remarkRules.test.cjs` (7), `browser-remark.cjs` rewritten, `browser-existing-user` expectation updated (that card is now "Remark: CAR WASH"). All unit and browser suites pass, 99 hooks identical. `browser-offers` failed about 1 in 20 runs (card declined before a reload sometimes returns); cause not found, logged as #168.

## 9 Oct 2026 (twenty-fourth pass, 0.6.2.0) - UPI remarks shown on review cards and in the list; a remark can suggest a group (backlog #165)

Why: a payment to a person (e.g. an auto/cab driver) carries the real meaning in the remark the payer typed; the user wants the whole remark shown, and the card to point at the right group for confirmation.
Changed: `src/inference/remark.js` (new: `remarkOf` finds the remark as the field just before the payment reference repeats, which works whatever the number of fields in front; system words and gateway codes give none. `remarkTheme` matches whole words in any order to a small word list -> a group the library already has: Transport, Eating Out, Health & Pharmacy, Home Services, Gas). `src/inference/needsYou.js` (each card carries the remarks of its payments, as written, most common first). `src/App.jsx` (the card's group suggestion uses the remark only where the library knows nothing and the row is not a merchant; Review's By-transaction list shows "Remark: ..." under the description). `src/onboarding/OnboardingFlow.jsx` (the card shows every remark, up to 3 plus a count; the suggested group is offered first, marked suggested, never pre-chosen).
Not changed: no rule is created from a remark yet (one confirmation does not yet clear the other payees with the same remark - proposed as #166); NEFT/IMPS remarks (need the AI field); typos ("RQPIDO") suggest nothing but are shown.
Tests: `remark.test.cjs` (8), `browser-remark.cjs`; two reload-timing waits lengthened in `browser-groups` (intermittent save-before-reload race in the test). All unit and browser suites pass, 99 hooks identical.

## 9 Oct 2026 (twenty-third pass, 0.6.1.0) - library looks up the name, and never makes a group for a merchant a rule already covers (backlog #153, #161)

Why: user does not want the library matching the whole line (it caused wrong matches), and library groups were appearing for merchants the person's own rules already handle, or with no transaction behind them.
Changed: `src/inference/onboardingResult.js` and `src/demo/labelStatement.js` (a row with an AI key is looked up in the library by that name only; rows without one keep the whole-line lookup until they are migrated, so nothing changes for existing data; a merchant covered by the person's own or a learned rule gets no library group - if the rule carries a group, that group is used). `src/App.jsx` (Review's group suggestion uses the name for AI-keyed rows). New `src/demo/libraryOnKey.test.cjs` (6). `golden/browser-pending.cjs`: wait before reload lengthened (intermittent save-before-reload race in the test, not the app).
Not changed: rule matching (still on the description, so the 394 learned rules keep working); no migration (step 3); CSV/Excel (step 4).
Tests: all unit and browser suites pass, 99 hooks identical.

## 9 Oct 2026 (twenty-second pass, 0.6.0.0) - AI merchant name is the key and the display name for new PDF rows (backlog #158, #160)

Why: the September trial showed Gemini's merchant names are cleaner than the parser's on NACH, IMPS/NEFT and person-payee lines; the user agreed a phased move (step 1 of 4).
Changed: `src/inference/aiMerchant.js` (new: `aiKeyFor` trusts an AI name only if its words, after upper-casing, dropping punctuation, honorifics and the legal suffix, appear consecutively in the line; `counterpartyOf`; the Gemini prompt text with the Google Play / Google Cloud / Amazon / NACH / NEFT rules and "null is better than a guess"). `src/App.jsx` (schema + prompt ask for `aiMerchant` and `counterpartyType`; import uses the AI name as the key only while every transaction held was imported under this rule, marked `aiRegime`, so an existing user's keys, rules and groups are untouched; Review's transaction list shows the display name above the description with a small "person" tag; rules made from a row use its key). `src/inference/onboardingResult.js`, `src/demo/labelStatement.js` (a row's `aiKey` is its merchant key).
Not changed: library matching still reads the whole line (step 2); no migration of existing data (step 3); CSV/Excel never go to Gemini (step 4).
Tests: new `aiMerchant.test.cjs` (11); `browser-aimerchant.cjs` covers a new user (AI key, display name, flag) and an existing user (display only); all unit and browser suites pass, 99 hooks identical.

## 9 Oct 2026 (twenty-first pass, 0.5.3.0) - AI merchant name recorded beside PDF rows, comparison only (backlog #158)

Why: user wants to compare what Gemini returns as the merchant with what the app's own parser gives, on the same statement, before deciding anything (see #157).
Changed: `src/App.jsx` (the PDF read asks Gemini for an optional `aiMerchant` per row; it is carried through the preview and import and stored on the transaction as `aiMerchant`). Nothing reads it: merchant keys, rules, groups and categories are unchanged. New test `golden/browser-aimerchant.cjs` (mocked Gemini, real flow); test stub `golden/appharness/stub-pdfjs.js` can now supply a fake PDF when a test sets `window.__BW_FAKE_PDF`.
Not changed: CSV/Excel imports (they never go to Gemini).

## 9 Oct 2026 (twentieth pass, 0.5.2.0) - wrapped conflict text, Delete group restored (backlog #153-#156)

Why: user asked for transactions not to be cut in the conflicts view and for Delete group to come back; two investigations (#153, #154) are written up in the backlog, not yet fixed.
Changed: `src/App.jsx` (conflict and peek rows wrap and show the full text; MerchantGroupRow shows a labelled Delete group button); tests browser-groups and browser-conflicts extended.

## 8 Oct 2026 (nineteenth pass, 0.5.1.0) - roll back spellings / tidy list; chips with counts and a cross (backlog #147-#148)

Why: user found the 0.5.0.0 groups screen too complicated and asked to go back to the old chip layout, adding a delete on each merchant and its transaction count.
Changed: `src/App.jsx` (MerchantGroupRow chips show name, count and a cross; removeVariant also clears a rule's group for that merchant; own-first merge by exact text). Removed: payee-identity matching, spellings lines, the To tidy list, `payeeIdentity.js`. Kept from 0.5.0.0: the add-account flow and the reconciliation banner.
Tests: browser-groups rewritten for chips; all unit tests and every browser suite pass (99 hooks identical both paths).

## 8 Oct 2026 (eighteenth pass, 0.5.0.0) - payee identity in groups, group tidy and remove, add-account flow, reconciliation banner (backlog #147-#152)

Why: user examples (Insurance Premium vs Insurance, Fuel vs Cooking Gas, Google Play/Cloud spellings) and requests of 8 Oct 19:56-20:09.
Changed: new `inference/payeeIdentity.js` (+test); `groupRules.js` (identity param); `csvGuess.js` (breaks); `App.jsx` (group lookups by identity, own-first merge of library groups, Merchant groups panel: payees, Remove, To tidy list; add-account state; unreconciled hold for PDF and CSV in the intake); `OnboardingFlow.jsx` (add mode, banner, toast). No stored data is migrated.
Tests: payeeIdentity unit; browser-groups and browser-reconcile new; browser-nextsteps extended; all other suites pass (99 hooks identical both paths).

## 8 Oct 2026 (seventeenth pass, 0.4.0.1) - old waiting notes baselined (backlog #145-#147)

Why: an existing user was asked whether a personal transfer came from Scapia, an account they already had.
Changed: `knowledgeStore.js` (`baselinePending`, `baseline` flag on new notes, 4 new tests), `src/App.jsx` (one load-time effect), `golden/browser-offers.cjs` seeds `baseline: true`.
Tests: knowledgeStore 43/43, browser-offers and browser-pending pass.

## 8 Oct 2026 (sixteenth pass, 0.4.0.0) - conflicts view, repair with transactions, account offers, Dismiss removed (backlog #140-#144)

Why: user decisions of 8 Oct 16:21-16:35.
Changed: `src/App.jsx` (computeConflicts, ConflictsView, Conflicts tab/banner on Review, Home step "N conflicts to check", Rules-tab overlap section removed, repair list with transactions, offer flow), `HomeScreen.jsx` (no Dismiss), `knowledgeStore.js` (pending offers, accepted conflicts), `ruleStats.js`, `needsYou.js`, `OnboardingFlow.jsx`; tests browser-conflicts rewritten, browser-offers new.
Tests: all unit tests, golden 6/6, execute-component (96 hooks, identical both paths), and every browser suite pass.

## 8 Oct 2026 (fifteenth pass, 0.3.2.0) - Next steps card, rule conflicts, edit rule (backlog #135-#139)

Why: user screenshots: Next steps should look like the demo (one card, one button, Snooze only); conflicting rules need the underlying transactions and a Keep both option; rules need Edit.
Changed: `src/App.jsx` (grouped Next steps card, snooze of several items, TxnPeek, RuleEditor, Keep both, See them / See the transactions), `src/home/HomeScreen.jsx` (richer card rows, Snooze only), `src/inference/ruleStats.js` (overlap ids, keepBoth).
Tests: conflicts unit (ids, keepBoth); browser-nextsteps and browser-conflicts extended (peek, keep both, edit); all other suites re-run and pass.

## 8 Oct 2026 (fourteenth pass, 0.3.1.0) - groups on rules; accounts not added yet (backlog #131, #133)

Why: user agreed to put groups on rules and to keep "account not added yet" in the knowledge store with a one-tap link when it is added.
Changed: new `src/inference/groupRules.js` (+ test); `knowledgeStore.js` (pending-account notes, matching, resolve/decline; tests); `needsYou.js` (waiting rows are not asked again); `src/App.jsx` (rule.group saved from cards, healGroups effect, link offers derived from notes + accounts, "waiting for X" tag in Review, group shown in Rules); `OnboardingFlow.jsx` (new wording, name box). The earlier 0.3.0.0 choice that waiting rows stop counting as incomplete is reversed: they still count in Review's table.
Tests: browser-pending (new), browser-existing-user updated; all other suites re-run and pass (93 hooks, identical both paths).

## 8 Oct 2026 (thirteenth pass, 0.3.0.0) - groups, conflicts, Next steps, "Does this repeat?" (backlog #122, #127, #129-#134)

Why: user decisions on the questions raised after 0.2.0.0.
Changed: new `src/inference/groupSuggest.js`, `conflicts.js` (+ `overlappingRules` in `ruleStats.js`), tests; `src/App.jsx` (Group is a required field on live data with no default, group-aware completeness `missingWithGroup`, card options and saving of groups, "Other" -> "Others", ConflictsPanel in Review, overlapping-rules section in Rules, repeat cards at the end of the deck, Next step actions and Snooze); `src/inference/needsYou.js` (group field), `missingObjects.js` (bank-account detection, demo-voice wording, action addStatement), `knowledgeStore.js` (snooze); `src/home/HomeScreen.jsx` (Snooze, step action); `src/onboarding/OnboardingFlow.jsx` (FieldsCard: group chips + New group, "I don't have this account"; statement screen shows why).
Tests added/updated: groupSuggest, conflicts, missingObjects, knowledgeStore units; browser-conflicts, browser-nextsteps, browser-repeat; browser-existing-user and browser-app-demo updated (5 cards; demo deck now 5).
Verified: all unit tests, golden 6/6, execute-component (91 hooks, identical both paths), live-upload, existing-user, intake-edges, card-first, engine-journey, onboarding, app-demo, conflicts, nextsteps, repeat.
Not changed: demo deck, Cash Flow overview, same-name payee collisions, hyphen-style UPI.

## 7 Oct 2026 (twelfth pass, 0.2.0.0) - payee identity, one definition of "needs you", healing, rule counts (backlog #123-#126, #128)

Why: user decisions on the rule-gap review: merchant = Payee; missing linked account still incomplete; one definition for cards and Review; re-apply rules after save/import; show rule counts, surface and repair dead rules; remove starter rules.
Changed: `src/inference/merchantIdentity.js`, `healRows.js`, `ruleStats.js`, `needsYou.js` (new, each with tests); `src/App.jsx` (payee identity + one-time migration, starter rules removed, heal effect, handEdited flags, field cards on Home, Rules tab counts + dead-rules section); `src/onboarding/OnboardingFlow.jsx` (FieldsCard); `src/inference/onboardingResult.js`, `src/demo/labelStatement.js` (compat with starter-rule removal). Tests: golden/browser-existing-user.cjs (new), live-upload updated, browser-app-demo loop widened (demo deck now 5 cards).
Verified: all unit tests, golden 6/6, execute-component, live-upload, existing-user, intake-edges, card-first, app-demo, engine-journey, onboarding.
Not changed (posed as questions): group options on cards, auto-linking accounts, rule-conflict visibility.

## 7 Oct 2026 (eleventh pass, 0.1.9.0) - returning people are not held on the welcome screen (backlog #121-#122)

Why: user: an onboarded person has no way to the homepage and is locked in until a statement is uploaded.
Changed: `src/App.jsx` (open on Home when data exists; `hasOwnData`/`goHome`; title returns to Home; `onGoHome` passed to the flow), `src/onboarding/OnboardingFlow.jsx` (Welcome shows "Welcome back - Go to my Home" when given `onGoHome`). Extended `golden/browser-live-upload.cjs` (reload now really lands on Home).
Verified: all unit tests, golden 6/6, live-upload (30 checks), intake-edges, card-first, execute-component (88 hooks, identical on both paths). Note: the earlier "nothing answered is asked again after reload" check was vacuous (the reload landed on the welcome screen); it is a real check now.

## 7 Oct 2026 (tenth pass, 0.1.8.0) - one rule book for import, review cards and Review (backlog #116-#120)

Why: user (existing, onboarded): Home showed 231 cards while Review showed 59 pending; own rules left Sub Category 1 blank on a new statement; a dividend appeared as a gas expense; cards showed no sign and no transactions.
Changed: `src/App.jsx` (`liveEngine`; `labelImport`/`relabelLive`/`deckForHome` use it; `reviewPreset` -> `ReviewTab presetSearch`), `src/demo/labelStatement.js` (hierarchy answer > own/learned rule > library > starter rule; rule class/cadence/control/purpose/link honoured), `src/inference/onboardingResult.js` (own rules settle a merchant; credits never take Expense guesses; signed meta; `samples`), `src/onboarding/OnboardingFlow.jsx` (sample rows + "See in Review" on cards). Added `src/demo/userRules.test.cjs`; extended `golden/browser-live-upload.cjs`.
Verified: all unit tests, golden 6/6, live-upload (26 checks), intake-edges, card-first, execute-component (87 hooks, identical on both paths).

## 7 Oct 2026 (ninth pass, 0.1.7.0) - any statement accepted as the first one (backlog #113-#115)

Why: user: "any statement should be allowed, nothing should be disallowed until our system rejects it". I had added a decline for card, holdings and loan statements without being asked.
Changed: `src/App.jsx` (`intakeRoute`, csv-map effect, `onIntakeStatus` handoff, `labelImport`/`relabelLive`/`onFirstImport` card-aware, column guess ignores "Card No", card sign convention, `guessInstitutionFromFile`), `src/demo/labelStatement.js` (`cardAccounts` opt). Added `golden/browser-card-first.cjs`, `golden/fixtures-live-card.csv`.
Verified: card-first browser test, live-upload (24 checks), intake-edges, unit tests, golden 6/6, execute-component (85 hooks).

## 7 Oct 2026 (eighth pass, 0.1.6.0) - first statement read in place, profile kept, priorities up to 3 (backlog #106-#112)

Why: user asked (1) answered profile questions to be saved and not re-asked, (2) the two questions asked while the statement is read, (3) Home to ask unanswered ones, (4) 'What matters most' choose up to 3, (5) 'Choose a file' to open the file picker and read in place instead of the old upload screen, with password / key / problems on the same screen, real (not scripted) progress, and no opening-balance ask.
Changed: `src/App.jsx` (`UploadTab` intake mode: `runIntake`, `intakeRoute`, effects chain for CSV and PDF, status emitted from real state; `doImport` reads a Balance column; `doImport`/`doPasteImport` return results; landing view hosts the upload engine hidden; `intake*` state, `pickStatement`, `priorities`/`profileAt` state and persistence); `src/onboarding/OnboardingFlow.jsx` (`Statement` file picker, new `Intake` screen, `PriorityPicker`, Q1/Q2 embeddable, Start goes to the statement); `src/home/HomeScreen.jsx` (priority card uses the picker); new `src/intake/csvGuess.js` + test; harness: `golden/browser-live-upload.cjs` rewritten for the new flow, new `golden/browser-intake-edges.cjs`, `golden/browser/entry.jsx` + `browser-onboarding.cjs` updated, `golden/load-engine.cjs` and `golden/execute-component.cjs` copy `src/intake`. Version 0.1.6.0. `execute-component` hook count is 85 (identical on both render paths).

## 6 Oct 2026 (seventh pass, 0.1.5.0 continued) - the live (own-statement) journey, backlog #72 / #100-#105

Why: user asked for the live upload version with the same payoffs, review cards, etc.
Changed: `src/App.jsx` (`labelImport` labels every import with `labelStatementFull`; `onFirstImport` starts the journey; `realJourney` / `realAnswers` state, answers saved as `cardAnswers`; `relabelLive`, `mergeLabelOutputs`; `realJourneySource` incl. a forecast from the person's own rows and `BalanceAsk` balance recording; `deckForHome` / `askFacts` no longer demo-only; `finishJourney` persists answers as rules); `src/onboarding/OnboardingFlow.jsx` (`startAt`, live Reading screen, `BalanceAsk`, own-statement repeat answers, memoised Payoff markup); `src/onboarding/journeyFromEngine.js` (live hooks: found / periodic / axis / cash note); `tools/extract_journey.py` + regenerated `journeyTemplates.generated.js` (live hooks, chart scale, `TODAY` from the engine); `src/demo/labelStatement.js` (`batchId`, repeat-answer cadence); `src/inference/onboardingResult.js` (repeat answers, `REPEAT_CADENCE`); harness `stub-papaparse.js` now parses real CSV; new `golden/browser-live-upload.cjs` + `fixtures-live-statement.csv`.
Verified: live browser test, demo browser test, journey/onboarding browser tests, unit tests, golden 6/6, CSS structure. `execute-component` hook count is now 77 (identical on both render paths; was 73 before this and the earlier passes).

## 6 Oct 2026 (sixth pass, 0.1.5.0)

Why: user reported (1) 'Does this repeat?' answers not saving, (2) no way to define a group when none fits, (3) Ask launcher showed the old cash-dip answer.
Changed: `src/App.jsx` (`deckForHome` drops repeat cards already answered via feeAns/insAns); `src/inference/onboardingResult.js` (group cards carry `customGroupBase`; `patchForAnswer` turns a typed name into a category-group patch); `src/onboarding/OnboardingFlow.jsx` (`Quick`: 'Name your own' input on group cards); `src/ask/AskLayer.jsx` (launcher button opens a fresh thread) and `src/home/HomeScreen.jsx` ('Why?' starts a fresh thread when the panel is closed); tests + browser-app-demo assertions.

## 6 Oct 2026 (correction to the fifth pass, 0.1.4.1)

Why: the user pointed out that Recurring means 'happens once every period of its cadence'; whether the amount is fixed or varies is a separate field. My 0.1.4.0 rule also required the amount to stay within 1.6x, which was wrong.
Changed: `src/demo/labelStatement.js` and `src/inference/onboardingResult.js` (`isBill`): Recurring = at most about one payment per month in each month it appears; amount no longer matters. `package.json` 0.1.4.1.

## 6 Oct 2026 (fifth pass) - Ask and Cash Flow on the demo data (0.1.4.0)

Why: finish the demo's Ask and Cash Flow screens before moving to the live path.
Changed: `src/demo/labelStatement.js` (Recurring only for one steady payment a month, else Irregular), `src/demo/sliceDemo.js` (bank opening balance for the window), `src/App.jsx` (Variable bucket = any non-Recurring Household / Personal expense in the Cash Flow breakdown, its drill-downs and the calendar month totals; 'not split yet' note; Ask facts carry merchant groups), `src/ask/askEngine.js` ('where did my money go' by group), `package.json` 0.1.4.0.
Tests: labelStatement 24, askEngine 32, browser-app-demo now also ties Home lowest point = Ask lowest point, Cash Flow opening + flows = closing = Rs 1,86,000, Fixed + Variable = expenses after every card is answered.
Not done: #95 (past-month forecast row), #88, #90, #72.

## 6 Oct 2026 (fourth pass) - Sub Category 1 / 2 asked by the cards, Review tab opens the deck

Why: user screenshots of the demo: expenses had no Sub Category 1, Airtel / Netflix etc. stayed 'Other' and no card asked, the Review count (13) did not match Home or open cards, and a Toit answer did not show in Review.
Changed: `src/demo/labelStatement.js` (Sub Category 1 = Household / Personal from answer, library or rule tag, not Fixed / Variable; Income kind; `merchantLocked`; learned rule carries it), `src/inference/onboardingResult.js` (patches use `sub1`; `patchForAnswer`; detail cards for group / Household; library entries with no category are asked, not guessed), `src/App.jsx` (`refreshMerchantKey` skips locked merchants; answers use `patchForAnswer`; Review tab opens the deck in the demo and its badge counts merchants; deck gets 'open the full table'), `src/onboarding/OnboardingFlow.jsx` (same), `package.json` 0.1.3.0.
Tests: `labelStatement` 22, `onboardingResult` 16, and `golden/browser-app-demo.cjs` now answers every card in the real App and checks Toit = Eating Out in Review, Sub Category 1 on every expense, Airtel asked for a group, only account-link rows left incomplete.
Not done: #88 (account-link cards), #90 (answers across reload), #72 (real upload), Ask / Cash Flow eyeball.

## 6 Oct 2026 (third pass) - Review entry to the deck, real-App browser test

Why: user ran the demo and saw no review cards in Review and no merchant groups. Reproduced in the real App: the Review tab's by-merchant list is empty once rows are labelled. Groups were created (12) on the current code, so the screenshot likely came from an older build.
Added: `golden/appharness/*` (stubs + build.sh) and `golden/browser-app-demo.cjs` (runs the real App through the demo).
Changed: `src/App.jsx` (ReviewTab gets `deckCount`/`onOpenDeck`; its empty state offers the deck); `package.json` version 0.1.2.0 (visible build stamp).
Not done: real-upload deck (#72). Verified: all suites, golden 6/6, hooks 73, both browser tests plus the new app test.

## 6 Oct 2026 (second pass) - library groups at import, shared review deck, engine-driven Payoff

Why: user decisions on #82 (show the real deficit) and the proposal: library + starter rules complete categorisation and groups at import; the rest goes to review cards by merchant; Home reopens the same cards.

Added: `src/demo/labelStatement.js` group/alias/rule output (`labelStatementFull`); `ReviewDeck` (OnboardingFlow.jsx); `engineHooks` in `journeyFromEngine.js`; asserted engine-hook patches in `tools/extract_journey.py` (templates regenerated, prototype md5 pin unchanged); `golden/inproc-engine.cjs`; Home "Finish sorting N merchants" button.
Changed: App.jsx (deck state, `answerDeckCard`, learned rules/aliases after slicing, `DEMO_JOURNEY_SOURCE.forecast`); HomeScreen.jsx (deck props); OnboardingFlow.jsx (Quick takes cards, memoised `{__html}` on the Next screen); `sliceDemo.js` (aliases/rules passthrough); Asha statement spend scaled to the salary.
Not done: real upload path (#72); visual check of Home/Review/Ask (#84); root fix for #83; Subscriptions group deliberately not added.
Verified: all engine suites, golden 6/6, hook count 73 on both render paths, scripted and engine browser tests pass, App compiles.

## 6 Oct 2026 - engine-driven journey (backlog #77-#80, new #81-#84)

Why: the onboarding payoff and review cards were a script; Home/Review/Ask ran the engine on pre-labelled data, so the two disagreed. Goal: the demo statement goes through the same engine a real upload would.

Added
- `src/demo/ashaStatement.js` - Asha as raw bank/card rows (no labels). Test: `ashaStatement.test.cjs`. Test-only key: `ashaAnswerKey.cjs`.
- `src/inference/onboardingResult.js` - what the engine knows about a statement: Sorted / Quick / Need, repeat pattern from sightings, coverage by spend, review cards. Test: `onboardingResult.test.cjs`.
- `src/inference/merchantLibrary.additions.js` - 13 library entries found missing (spread into `MERCHANT_LIBRARY` in App.jsx).
- `src/demo/labelStatement.js` - labels raw rows at import: single-sighting rule, cadence from dates, EMI/card bill as debt payments, links only to added accounts. Test: `labelStatement.test.cjs`.
- `src/onboarding/journeyFromEngine.js` - builds the journey's numbers and cards per history length.
- `golden/browser-engine-journey.cjs`, `golden/browser/entry-engine.jsx` - real-browser check that Sorted and the cards equal the engine's output.
- `CHANGELOG.md`.

Changed
- `src/App.jsx`: import the new modules; `MERCHANT_LIBRARY` spreads the additions; `normalizeMerchant` added to the test-export footer; `DEMO_JOURNEY_SOURCE`; `finishJourney` / `applyDemoStory` slice with the labeller and keep card answers; OnboardingFlow gets `journeySource`.
- `src/onboarding/OnboardingFlow.jsx`: optional engine-driven journey (`journeySource`), card answers recorded and passed to `onFinish`, review deck frozen on open, button reads "that matter most" when more than the shown cards need review. Scripted path unchanged when no source is given.
- `src/demo/sliceDemo.js`: optional `labeller` argument and raw-row path; fee/insurance predicates also match the new merchant names. Old behaviour unchanged without a labeller (37 tests unchanged).
- `src/demo/generateDemoData.js`: also returns `rawRows`.
- `golden/load-engine.cjs`: exports `buildBundle`. `golden/browser-onboarding.cjs`: finish payload now includes `answers`.

Not changed / not done: live import rules for a real upload (#72), Payoff/forecast/stepper text (#81), story arithmetic (#82), `normalizeMerchant` handles (#83), visual check of Home/Review/Ask on new data (#84).

Verified: engine suites (classify 19, identity 18, route 22, reviewStatus 6, missingObjects 12, knowledgeStore 23, homeTrafficControl 11, sliceDemo 37, askEngine 31, ashaStatement 10, onboardingResult 11, labelStatement 12), golden 6/6, hook count 70 on both render paths, scripted browser onboarding ALL PASSED, engine browser journey ALL PASSED, App compiles.
