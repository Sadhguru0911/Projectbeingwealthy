/**
 * The full demo dataset (backlog #39, feeding Inference Engine Phase D, backlog
 * #46). "Asha" - the same persona used throughout every onboarding/Home prototype
 * this project has built - 34, Bengaluru, supports a partner and daughter, saving
 * to buy a home. 12 months of history (Oct 2025 - Sep 2026), across every account
 * type the real app models: bank, credit card, home loan, investments, and a goal.
 *
 * SCOPE, stated precisely so it isn't oversold: this delivers the DATA #39 needs.
 * It does NOT deliver #39's UI wiring (the sandboxed storage swap, the Demo pill,
 * "Asha's story" stepper, or actually plugging this into the real app's screens) -
 * that remains separate work. What this unblocks directly is Phase D's accuracy
 * measurement, which only ever needed labelled data, not the demo UI itself (see
 * the note already recorded against #46's Phase D entry).
 *
 * Every shape here is copied EXACTLY from the real functions that will consume it
 * (computeNetWorthSummary, computeDebtSummary, computeGoalsTracking, and the
 * transaction shape produced by the real CSV-import path) - verified by actually
 * running this data through those real functions before this shipped, not assumed
 * from reading their signatures. See verifyAgainstRealEngine.cjs alongside this
 * file for that verification.
 *
 * GROUND TRUTH, same principle as src/inference/generateTestData.js: never "what
 * will genuinely happen in the future" (unknowable, and this engine's entire
 * premise is refusing to pretend otherwise), always "given this many occurrences
 * with this interval pattern, what SHOULD the engine honestly conclude." Every
 * transaction records its intended category/frequency/control as the ANSWER KEY,
 * separate from the raw text the engine actually has to work from.
 */

import { rawAshaStatement } from "./ashaStatement.js";

const START = "2025-10-01"; // 12 months back from HISTORY_END
export const HISTORY_END = "2026-09-28";
const MONTHS = ["2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08","2026-09"];

function d(monthIdx, day) { return MONTHS[monthIdx] + "-" + String(day).padStart(2, "0"); }
function round(n) { return Math.round(n * 100) / 100; }

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
// balanceHistory is what the REAL "verified cash" calculation actually reads
// (computeAggregateCashBalance -> resolveBalanceAsOfDate) - found by testing the
// full forecast chain against this data, not by reading the function signature
// alone: lastKnownBalance (below) feeds computeNetWorthSummary, but is a
// COMPLETELY SEPARATE field this different calculation never looks at at all. One
// exact-dated entry at HISTORY_END means resolveBalanceAsOfDate finds a direct
// match and returns the real number, rather than "unknown" (null) - which is what
// actually happened here before this was added, silently anchoring an otherwise-
// working forecast at nothing.
export const ACCOUNTS = [
  { id: "acc_bank", institution: "Sample Bank", nickname: "Sample Bank Savings", type: "bank", lastKnownBalance: 186000, uploadHistory: [],
    balanceHistory: [{ asOfDate: HISTORY_END, balance: 186000 }] },
  { id: "acc_card", institution: "Sample Card", nickname: "Sample Card", type: "creditCard", lastKnownBalance: 18400, uploadHistory: [],
    balanceHistory: [{ asOfDate: HISTORY_END, balance: 18400 }] },
  { id: "acc_loan", institution: "Sample Bank", nickname: "Home Loan", type: "debt", loanType: "Home Loan" },
  { id: "acc_demat", institution: "Sample Broker", nickname: "Sample Broker Demat", type: "demat", uploadHistory: [] },
];

// ---------------------------------------------------------------------------
// Bank account transactions - the monthly rhythm, plus the two "surprise" bills
// that only a longer history reveals (the same story every prototype has told).
// ---------------------------------------------------------------------------
function bankTransactions() {
  const txns = [];
  let n = 0;
  const push = (fields) => { txns.push({ id: "txn_bank_" + (++n), accountId: "acc_bank", importBatchId: "demo_batch", ...fields }); };

  MONTHS.forEach((_, i) => {
    push({ date: d(i, 1), description: "SALARY CREDIT SAMPLE EMPLOYER", merchant: "Salary", amount: 110000, direction: "credit",
      category: "Income", subCategory: null, frequencyClass: "Recurring", control: null, purpose: "Personal",
      groundTruth: { frequency: "Recurring", control: null } });

    push({ date: d(i, 3), description: "UPI-RENT-LANDLORD-778812", merchant: "Rent", amount: 32000, direction: "debit",
      category: "Expense", subCategory: "Fixed", frequencyClass: "Recurring", control: "Committed", purpose: "Personal",
      groundTruth: { frequency: "Recurring", control: "Committed" } });

    push({ date: d(i, 5), description: "UPI-HOME LOAN EMI-SAMPLE BANK", merchant: "Home Loan EMI", amount: 25000, direction: "debit",
      category: "Transfer", subCategory: "Debt Payment", frequencyClass: "Recurring", control: "Committed", purpose: "Personal",
      linkedAccountId: "acc_loan", groundTruth: { frequency: "Recurring", control: "Committed" } });

    push({ date: d(i, 5), description: "UPI-SAMPLE CARD BILL PAYMENT-BBPS", merchant: "Sample Card Bill", amount: cardBillFor(i), direction: "debit",
      category: "Transfer", subCategory: "Debt Payment", frequencyClass: "Recurring", control: "Committed", purpose: "Personal",
      linkedAccountId: "acc_card", groundTruth: { frequency: "Recurring", control: "Committed" } });

    push({ date: d(i, 7), description: "UPI-SAMPLE BROKER SIP-ZERODHA STYLE", merchant: "SIP", amount: 30000, direction: "debit",
      category: "Investment", subCategory: "Add", frequencyClass: "Recurring", control: null, purpose: "Personal",
      linkedAccountId: "acc_demat", groundTruth: { frequency: "Recurring", control: null } });

    push({ date: d(i, 5), description: "NETFLIX.COM 4009", merchant: "Netflix", amount: 649, direction: "debit",
      category: "Expense", subCategory: "Fixed", frequencyClass: "Recurring", control: "Flexible", purpose: "Personal",
      groundTruth: { frequency: "Recurring", control: "Flexible" } });

    push({ date: d(i, 15), description: "UPI-SAMPLE INTERNET BROADBAND-9988", merchant: "Internet", amount: 999, direction: "debit",
      category: "Expense", subCategory: "Fixed", frequencyClass: "Recurring", control: "Flexible", purpose: "Personal",
      groundTruth: { frequency: "Recurring", control: "Flexible" } });

    push({ date: d(i, 1), description: "UPI-SAMPLE SCHOOL BUS FEE-4471", merchant: "School Bus", amount: 2400, direction: "debit",
      category: "Expense", subCategory: "Fixed", frequencyClass: "Recurring", control: "Committed", purpose: "Household",
      groundTruth: { frequency: "Recurring", control: "Committed" } });

    push({ date: d(i, 10), description: "UPI-GOLDS GYM-2231", merchant: "Gym", amount: 1500, direction: "debit",
      category: "Expense", subCategory: "Fixed", frequencyClass: "Recurring", control: "Flexible", purpose: "Personal",
      groundTruth: { frequency: "Recurring", control: "Flexible" } });

    const elecAmt = 3000 + (i % 4) * 400;
    push({ date: d(i, 12), description: "UPI-BESCOM BILL PAYMENT-BBPS", merchant: "Electricity", amount: elecAmt, direction: "debit",
      category: "Expense", subCategory: "Fixed", frequencyClass: "Recurring", control: "Committed", purpose: "Household",
      groundTruth: { frequency: "Recurring", control: "Committed" } });

    const groceryAmt = 9000 + (i % 5) * 500;
    push({ date: d(i, 6), description: "UPI-ZEPTO-9182736450", merchant: "Zepto", amount: groceryAmt, direction: "debit",
      category: "Expense", subCategory: "Variable", frequencyClass: "Recurring", control: "Flexible", purpose: "Household",
      groundTruth: { frequency: "Recurring", control: "Flexible" } });
  });

  // Eating out: irregular in both timing and amount - a real Variable/Irregular
  // pattern, not a monthly rhythm, exactly as the design's own worked examples use.
  const eatingOutHits = [[0,4,1200],[0,19,3400],[1,2,800],[2,28,2100],[3,15,1800],[4,9,2700],[5,22,1600],
    [6,3,4100],[7,17,900],[8,25,3300],[9,11,1400],[10,29,2600],[11,4,8300]];
  eatingOutHits.forEach(([mi, day, amt]) => {
    push({ date: d(mi, day), description: "UPI-ZOMATO ONLINE-" + (5000 + mi * 137 + day), merchant: "Zomato", amount: amt, direction: "debit",
      category: "Expense", subCategory: "Variable", frequencyClass: "Irregular", control: "Flexible", purpose: "Personal",
      groundTruth: { frequency: "Irregular", control: "Flexible" } });
  });

  // The twice-yearly school fee - the exact Asha scenario every prototype has used.
  // `frequency: "Semi-Annual"` is REQUIRED, not optional decoration: App.jsx's real
  // forecasting engine (FREQUENCY_STEP_MONTHS, computeRecurringCommitments reading
  // `latest.frequency` directly off the transaction) already correctly steps a
  // dated commitment forward by its OWN cadence - Semi-Annual by 6 months, Annual by
  // 12 - and has done so since an earlier session's fix (confirmed by reading that
  // session's transcript after this exact field was found missing here: leaving it
  // unset silently falls back to step=1/monthly, which is a gap in this generator,
  // not a forecasting bug - see BACKLOG.md #49's correction).
  push({ date: d(1, 9), description: "UPI-DPS SCHOOL FEES-778812", merchant: "School Fee", amount: 60000, direction: "debit",
    category: "Expense", subCategory: "Fixed", frequencyClass: "Recurring", frequency: "Semi-Annual", control: "Committed", purpose: "Household",
    groundTruth: { frequency: "Recurring", control: "Committed", note: "6-month cadence - only 2 sightings in this 12-month window, so the honest engine tier at first sighting is Insufficient, not Recurring; this is intentional, matching src/inference/generateTestData.js's school-fee-twice scenario exactly." } });
  push({ date: d(7, 9), description: "UPI-DPS SCHOOL FEES-778813", merchant: "School Fee", amount: 60000, direction: "debit",
    category: "Expense", subCategory: "Fixed", frequencyClass: "Recurring", frequency: "Semi-Annual", control: "Committed", purpose: "Household",
    groundTruth: { frequency: "Recurring", control: "Committed" } });

  // The once-yearly car insurance premium - only ONE sighting in a 12-month window,
  // deliberately: this is what a 12-month history can NOT yet confirm as recurring
  // without either a second year or the person's own answer, matching DESIGN.md SS3
  // (the NEW inference engine's own single-sighting rule - a separate, correct
  // system from App.jsx's existing forecasting engine, which this frequency field
  // feeds instead). `frequency: "Annual"` for the same reason as School Fee above.
  push({ date: d(1, 14), description: "UPI-SAMPLE GENERAL INSURANCE-CAR-5521", merchant: "Car Insurance", amount: 42000, direction: "debit",
    category: "Expense", subCategory: "Fixed", frequencyClass: "Recurring", frequency: "Annual", control: "Committed", purpose: "Personal",
    groundTruth: { frequency: "Insufficient", control: "Committed", note: "Only 1 sighting in 12 months - the honest engine answer here is Insufficient, not Recurring, even though a person would know it's an annual premium. This is the single-sighting rule working as intended, not a gap." } });

  return txns.sort((a, b) => a.date.localeCompare(b.date));
}

function cardBillFor(monthIdx) {
  // Matches the card breakdown numbers already used in the Home prototype (Shopping
  // 6900 + Eating out 5200 + Travel 4000 + Fuel 2300 = 18400), with light month-to-
  // month variation so it isn't suspiciously identical every month.
  return round(18400 * (0.9 + ((monthIdx * 37) % 20) / 100));
}

// ---------------------------------------------------------------------------
// Credit card transactions - what the bank-side "Sample Card Bill Payment" is
// actually settling. Only Expense (purchases), never a second copy of the payment
// itself - matching the app's own guardrail against double-counting card spend.
// ---------------------------------------------------------------------------
function cardTransactions() {
  const txns = [];
  let n = 0;
  const push = (fields) => { txns.push({ id: "txn_card_" + (++n), accountId: "acc_card", importBatchId: "demo_batch_card", ...fields }); };
  // Real, recognizable brands used wherever the real library has a matching entry
  // (verified live before use, not assumed) - Fuel deliberately stays a generic
  // station name, since real fuel purchases are very often at an unbranded local
  // pump, not a national chain; keeping one legitimately-generic case here matches
  // realistic statement diversity rather than making every single line resolve.
  const cats = [
    ["Shopping", "UPI-MYNTRA", 6900],
    ["Eating out", "UPI-SWIGGY", 5200],
    ["Travel", "UPI-MAKEMYTRIP", 4000],
    ["Fuel", "UPI-SAMPLE FUEL STATION", 2300],
  ];
  MONTHS.forEach((_, i) => {
    cats.forEach(([label, desc, base], ci) => {
      push({ date: d(i, 8 + ci * 5), description: desc + "-" + (1000 + i * 13 + ci), merchant: label, amount: round(base * (0.85 + ((i + ci) % 4) / 10)), direction: "debit",
        category: "Expense", subCategory: "Variable", frequencyClass: "Recurring", control: "Flexible", purpose: "Personal",
        groundTruth: { frequency: "Recurring", control: "Flexible" } });
    });
  });
  return txns.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Home loan schedule - matches computeDebtSummary's real expected shape exactly
// (schedules -> entries keyed by period, each with principal/interest/emi/
// closingBalance). Principal share grows slowly each month, interest shrinks,
// exactly like a real amortization schedule - not just a flat repeat.
// ---------------------------------------------------------------------------
function loanSchedule() {
  let balance = 1892000; // outstanding at the start of this window
  const monthlyRate = 0.085 / 12;
  const entries = [];
  MONTHS.forEach((m) => {
    const interest = round(balance * monthlyRate);
    const principal = round(25000 - interest);
    const closingBalance = round(balance - principal);
    entries.push({ period: m, principal, interest, emi: 25000, closingBalance });
    balance = closingBalance;
  });
  return [{ accountId: "acc_loan", importedAt: Date.parse(START), entries }];
}

// ---------------------------------------------------------------------------
// Investment holdings - monthly SIP additions into the demat account, growing at
// a modest, believable rate (not a straight line - real markets aren't).
// ---------------------------------------------------------------------------
function holdingSnapshots() {
  const snaps = [];
  let invested = 0, value = 0;
  const monthlyReturnFactor = [1.02, 0.99, 1.03, 1.01, 0.97, 1.04, 1.02, 1.00, 1.03, 0.98, 1.02, 1.03];
  MONTHS.forEach((m, i) => {
    invested += 30000;
    value = round((value + 30000) * monthlyReturnFactor[i]);
    snaps.push({ id: "snap_" + i, accountId: "acc_demat", asOfDate: m + "-28", importedAt: Date.parse(m + "-28"),
      totalCurrentValue: value, totalInvested: invested });
  });
  return snaps;
}

// ---------------------------------------------------------------------------
// The goal - matches every prototype's numbers exactly (Buying a home, target
// 12,00,000 by Mar 2028, SIP 30,000/month, already invested per holdingSnapshots).
// ---------------------------------------------------------------------------
function goal() {
  // sipStartDate deliberately matches the FIRST SIP transaction actually generated
  // (Oct 2025, see bankTransactions above) - not an earlier, invented date. Lining
  // these up matters: a mismatch would make computeGoalsTracking's "SIP target so
  // far" assume months of contributions this dataset doesn't actually contain,
  // producing a shortfall that has nothing to do with the transactions themselves.
  //
  // inflationRate/returnRate are stored ON the goal - computeGoalMath is called as
  // (costToday, inflationRate, returnRate, yearsToGoal), confirmed against the real
  // call sites before writing this (an earlier ad-hoc verification of this same
  // dataset used the wrong argument order - harmless there since it never touched
  // saved data, but worth fixing properly here since this DOES become real,
  // loadable app state).
  return {
    id: "goal_home", name: "Buying a home", type: "Home", createdAt: Date.parse(d(0, 1)),
    yearsToGoal: 2.5, costToday: 1200000, costIsEstimate: false,
    inflationRate: 6, returnRate: 10,
    sipPlannedMonthly: 30000, sipStartDate: d(0, 7),
    manualLumpsumAllocation: 0,
  };
}

export function generateDemoData() {
  return {
    accounts: ACCOUNTS,
    transactions: [...bankTransactions(), ...cardTransactions()],
    debtSchedules: loanSchedule(),
    holdingSnapshots: holdingSnapshots(),
    otherInvestments: [],
    goals: [goal()],
    historyEnd: HISTORY_END,
    rawRows: rawAshaStatement(), // the same story as raw bank rows (backlog #77); labelled by the engine when a labeller is used
  };
}
