# Gap review: what the inference engine knows vs what the demo shows

> **Status, 6 Oct 2026 (after the first build pass).** Closed: D1-D4 (raw Asha statement, `src/demo/ashaStatement.js`), F1/F2/F8/F9 for the demo (`labelStatement.js`, `onboardingResult.js`), F3/F4 (cards generated from the engine, answers fed back), F5 for Reading / Sorted. Measured now at 1 month: 68 transactions, 30 merchants, 22 sorted / 1 quick / 7 need you, 79% of spending covered (the old script said 68 / 31 and 19 / 8 / 4, 71%). Still open: the Payoff "What I can see now" rows, forecast chart and stepper text are still scripted (#81, includes the Airtel row); the story's "normal month" arithmetic cannot be true (#82); the real upload path does not use the new labeller (#72); Netflix / "Subscription" group left as the library has it (known, ungrouped).


6 Oct 2026. Every number below was measured by running Asha's data through the real functions (`seedRules`, `matchRule`, `findLibraryEntry`, `learnRecurringDay`, `computeAmountBehavior`, `summarizeReviewStatus`), not read off the code and assumed.

## 1. Bottom line

1. **Three screens, three different sources of truth.** The onboarding screens (Reading, Sorted, Payoff, review cards) show numbers *scripted in the prototype*. Home, Review and Ask run the *real engine* on Asha's generated data. And the generated data is not a statement: it is a **pre-labelled answer key** (category, frequency, control, linked account already filled in), so the engine never infers anything in the demo.
2. **The live import path assigns "Recurring" on a single sighting.** `seedRules` + `matchRule` give `frequencyClass` from a keyword alone (netflix, rent, salary, loan, insurance, broadband, zerodha). The single-sighting rule exists (`classify.js`) but is applied only to Home's counts, not at import, not in Review, not in commitments or the forecast.
3. **The engine's honest answer at one month is 0 sorted / 0 quick / 12 need you** (every merchant "only seen once"). The story says 19 / 8 / 4, 71% covered. Both cannot be right, and the router's design (it gates "Sorted" on frequency) conflicts with the agreed prototype (where "Sorted" means *we know what it is*, and "does it repeat" is a separate, later question).
4. **The review cards are a fixed list that writes nothing.** Zepto "8 payments last 21 Aug", Blinkit, "Sri Krishna Sweets", "UPI · R Sharma" are not in Asha's data. Answers only show a toast ("Remembered... sorted automatically next time"); no rule, alias or transaction changes. So the promise is false today, and "Subscription" is not a group the engine has.
5. **Asha's statement is too small and too fake to exercise the engine**: 12 bank transactions in September (story: 68), 148 over 12 months (story: 820), 14 distinct merchants (story: 78), and descriptions like `SAMPLE BROKER SIP-ZERODHA STYLE` that match a rule only by accident.

## 2. Where each screen gets its numbers

| Screen | Source | At 1 month it says |
|---|---|---|
| Reading / Sorted / Payoff / "What I can see now" | Scripted `DATA` table from the prototype | 68 transactions, 31 merchants, 19 sorted, 8 quick, 4 need you, 71% covered, "5 payments look like monthly bills" |
| Quick review cards | Scripted `QUICK` list (same for every history length) | Zepto 8 payments, Blinkit, Netflix 6 payments, BESCOM 5 payments, R Sharma, Sri Krishna Sweets |
| Home, Review, Ask (demo) | Real engine on generated, pre-labelled data | 12 transactions, "Review the 11 still incomplete", cadence unset on everything |
| Real user, first import | Seed rules + library, then Review | 7 of 12 get a frequency at first sight; 5 get nothing; all still "incomplete" (no cadence) |

## 3. Direct answers

**Does the engine assign frequency without establishing a pattern?** Yes, at import. Of Asha's 12 September transactions, 7 are given a frequency class by a keyword rule with one sighting: Salary, Rent, Home loan EMI, Netflix, SIP, Internet (Recurring) and Zomato (Irregular). Review then shows them as "Happens regularly" while the payoff screen says "I've only seen each once". `isFullyCategorized` also requires a cadence (`frequency`), which no rule sets, so they all count as "incomplete" even at 12 months with 12 clean sightings.

**Why do review cards show merchants that aren't in the data?** The cards are the prototype's static list. Real September data has Zepto (1 payment, ₹9,500, not 8 / ₹6,511), Netflix (1 payment, ₹649, not 6 / ₹3,894), BESCOM (1 payment, ₹4,200, not 5 / ₹19,240). Blinkit, R Sharma and Sri Krishna Sweets do not exist. The one real eating-out item (Zomato, ₹8,300, rule-matched as Irregular) is never asked about.

**Why don't answers like "Netflix → Subscription" show up as groups, or change the transactions?** Nothing is written. The card handler only raises a toast; `finishJourney` passes back only the school-fee and insurance answers. Also, the engine has no "Subscription" group: the library *does* know Netflix (Expense / Personal, High confidence) but gives it **no group on purpose** (its note: "deliberately NOT grouped with other OTT services"), so there is nothing for a "Subscription" answer to attach to. The prototype's card ("A monthly subscription") and the library's own design decision point in opposite directions. The "Change" list (Transport, Bills & utilities, Health, Subscription) uses labels that aren't the engine's vocabulary (category / sub-category / tag / group / class / control / cadence / purpose / linked account).

**Isn't this what the inference engine is supposed to do?** Yes, and the pieces exist (identity, classify, route, library, review status). They are just not the thing the demo runs on.

## 4. Evidence

### 4a. Live import rules vs the generator's answer key (Asha's raw descriptions)

| Raw description | Generator says | Live starter rule says | Library knows brand? |
|---|---|---|---|
| NETFLIX.COM # | Expense / Recurring / Flexible | Expense / Recurring / Flexible | yes, but no group (by design) |
| UPI-RENT-LANDLORD-# | Expense / Recurring / Committed | same | yes, keyword only, no group |
| SALARY CREDIT SAMPLE EMPLOYER | Income / Recurring | same | yes, generic keyword, no group |
| UPI-HOME LOAN EMI-SAMPLE BANK | **Transfer / Debt Payment**, linked to loan | **Expense** / Recurring (via "loan") | no |
| UPI-SAMPLE CARD BILL PAYMENT-BBPS | Transfer / Debt Payment, linked to card | **no rule** | no |
| UPI-SAMPLE BROKER SIP-ZERODHA STYLE | Investment / Add, linked | Investment / Add (only because of the word "zerodha") | yes |
| UPI-SAMPLE INTERNET BROADBAND-# | Flexible | **Committed** (via "broadband") | no |
| UPI-ZEPTO-# | Recurring | **no rule** | yes (Grocery) |
| UPI-GOLDS GYM-# | Recurring / Flexible | **no rule** | yes (Fitness) |
| UPI-BESCOM BILL PAYMENT-BBPS | Recurring / Committed | **no rule** | yes (Electricity) |
| UPI-SAMPLE SCHOOL BUS FEE-# / UPI-DPS SCHOOL FEES-# | Recurring / Committed | **no rule** | no |
| UPI-ZOMATO ONLINE-# | Irregular / Flexible | Irregular / Flexible | yes (Eating Out) |
| Card: MYNTRA / SWIGGY / SAMPLE FUEL | Recurring / Flexible | **Irregular** / Flexible | yes / yes / no |
| Card: MAKEMYTRIP | Recurring / Flexible | **no rule** | yes (Travel) |
| UPI-SAMPLE GENERAL INSURANCE-CAR-# | Recurring (1 sighting) | Recurring (via "insurance") | no |

Library matches are only *suggestions*; they are never applied to the transaction, so 36 of the 148 bank rows stay unlabelled even though the library recognises the brand.

### 4b. The engine's own router vs the story

| History | Router: sorted / quick / need you | Story: sorted / quick / need you |
|---|---|---|
| 1 month | **0 / 0 / 12** (all "only seen once") | 19 / 8 / 4 |
| 12 months | 9 / 1 / 4 (of 14 merchants) | 58 / 13 / 7 (of 78) |

### 4c. Size and shape of the statement

| | Asha (generated) | Story |
|---|---|---|
| September bank transactions | 12 | 68 |
| 12-month bank transactions | 148 | 820 |
| Distinct merchants | 14 (18 with card) | 31 at 1 month, 78 at 12 |
| Long tail (UPI to people, small shops, cash) | none | implied (R Sharma, Sri Krishna Sweets) |

Card transactions also store the **category as the merchant** (`merchant: "Shopping" / "Eating out" / "Travel" / "Fuel"`), so Review's merchant groups cannot show Myntra, Swiggy or MakeMyTrip. A real import sets `merchant = normalizeMerchant(description)`.

## 5. Gap register

### Data gaps

| # | Gap | Severity |
|---|---|---|
| D1 | Statement is too small and too regular (12 / month, no long tail, no cash, no UPI-to-person) | Critical |
| D2 | Data is stored **pre-labelled** (category, class, control, links, clean merchant). Demo never runs inference | Critical |
| D3 | Fake merchant text ("SAMPLE ...", "ZERODHA STYLE", "RENT-LANDLORD"); rules match by accident, so the starter rules and library are not really exercised | High |
| D4 | Card rows use category names as merchants | High |
| D5 | Scripted story numbers (counts, coverage, "known", card lists) have no source in the data | High |
| D6 | Generator labels disagree with live rules (EMI, card bill, broadband control, card spends) so what Review shows is not what a real user would get | High |
| D7 | Aligned and worth keeping: school fee (9 Nov, 9 May), car insurance (14 Nov), salary on the 1st, ₹1,86,000 cash | n/a |

### Feature gaps

| # | Gap | Severity |
|---|---|---|
| F1 | Single-sighting rule not enforced at import, Review, commitments, forecast (two truths for "recurring") | Critical |
| F2 | Router gates "Sorted" on frequency, so a first statement can never show Sorted; conflicts with the agreed prototype (Sorted = we know what it is) | Critical |
| F3 | Review cards are static and not generated from the engine's quick / need-you items | Critical |
| F4 | Card answers write nothing (no rule, alias, transaction update); "sorted next time" is untrue | Critical |
| F5 | Payoff / Sorted counts and coverage % are scripted, not computed | High |
| F6 | No bridge from card vocabulary (Grocery, Subscription, Eating out) to the data model | High |
| F7 | Library recognises brands but its suggestions are not applied to transactions; Netflix is known but deliberately ungrouped, so the "Subscription" card has no group to land in (product decision needed); EMI text is not in the library | High |
| F8 | Cadence (`frequency`) is never inferred, even with 12 steady sightings, so everything is "incomplete" forever | High |
| F9 | Starter rules mis-model EMI ("loan" → Expense) and miss card-bill text ("CARD BILL PAYMENT") | Medium |
| F10 | Real path (#72) not wired, so a real statement would give a different experience from the demo | High |
| F11 | Counting units differ: cards count merchants, Home counts transactions, payoff counts "need you" groups | Medium |

## 6. Decisions I need from you

1. **What does "Sorted" mean?** Recommendation: *we know what it is* (merchant / category from a rule or the library), independent of whether it repeats. Frequency becomes a separate, visible line ("seen once, looks monthly, confirm with another month"). This matches the prototype and makes 1 month useful.
2. **Keyword rules at first sighting.** Recommendation: a rule may set category, tag and control immediately, but `frequencyClass` stays "seen once" until a second sighting or the person's answer. Display it as "looks monthly", never "Happens regularly".
3. **Asha's statement.** Recommendation: regenerate as *raw rows only* (date, description, amount, direction), about 60 to 70 a month, real brands (Swiggy, Zomato, Zepto, Blinkit, BigBasket, DMart, Amazon, Flipkart, Myntra, Uber, Rapido, IRCTC, MakeMyTrip, Netflix, Spotify, Airtel, ACT Fibernet, BESCOM, Apollo Pharmacy, Cult.fit, ICICI Lombard, a card issuer via CRED, Zerodha/Groww SIP), UPI to people and shops (R Sharma, Sri Krishna Sweets, domestic help), ATM cash, and the two surprise bills. The answer key moves to a test-only file and is never stored.

## 7. Proposed build order

1. **Data** (D1-D6): new raw statement + test-only answer key; golden test that rule + library coverage lands where the story says it should, or the story is rewritten to the measured numbers.
2. **Engine** (F1, F2, F7, F8, F9): two-axis routing, single-sighting rule at import, library decision on subscriptions (group them or change the card) and an EMI entry, apply library suggestions, auto-cadence at three or more steady sightings, fix EMI / card-bill rules.
3. **Screens** (F3-F6, F11): Reading, Sorted, Payoff and Quick numbers computed from engine output; cards generated per history length from the engine's quick / need-you items with real counts, amounts and dates; every answer writes a rule or alias and the engine re-runs, so "sorted next time" becomes true; Home, Review and Ask read the same result.
4. **Real path** (F10, #72): the same code, fed by an uploaded statement.

Acceptance test for every stage: *each figure on Payoff, Quick, Home and Ask equals the engine's output for the same data*, enforced by a golden test, not by eye.
