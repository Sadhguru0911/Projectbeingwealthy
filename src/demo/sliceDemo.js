/**
 * Slices Asha's generated 12-month dataset to the history the journey's stepper chose (backlog #70).
 * The prototype's stepper moves Asha from 1 month to 12; here that means the REAL engine runs on the real
 * generated data for that many months, instead of a second, scripted set of numbers.
 *
 * Asha has only added her bank statement at this point in her story (the journey's own "Want to make the
 * picture richer? Credit card / Loans / Investments" step is about exactly that), so the card, loan and
 * demat accounts - and everything that belongs to them - are left out; bank-side payments that point at
 * them are un-linked, so the detectors (not a script) discover what is missing.
 *
 * Her two once-seen bills follow what she told the journey: a single sighting never becomes a planned
 * bill on its own (the rule enforced everywhere in this engine) - it needs her answer or a second sighting.
 * Pure function: same inputs, same output; `now`/randomness never read.
 */
const OTHER_ACCOUNTS = new Set(["acc_card", "acc_loan", "acc_demat"]);

export function startPeriodFor(historyEnd, months) {
  const [y, m] = historyEnd.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - (months - 1), 1));
  return d.toISOString().slice(0, 7);
}

const FEE_ANS = { "6m": { frequencyClass: "Recurring", frequency: "Semi-Annual" }, year: { frequencyClass: "Recurring", frequency: "Annual" }, once: { frequencyClass: "One-Time", frequency: null } };
const INS_ANS = { year: { frequencyClass: "Recurring", frequency: "Annual" }, once: { frequencyClass: "One-Time", frequency: null } };

// Demo Home's "Asha's story" (backlog #74): she can add her other accounts one by one. `answers.card/loan/inv`
// keep that account (and everything belonging to it); `answers.goalSet` keeps her goal target.
const ADDED = { card: "acc_card", loan: "acc_loan", inv: "acc_demat" };

/** The bank account's balance at the START of the window, worked back from the known closing balance and the window's own
 *  transactions, so Cash Flow can show Opening and Closing for any period inside it (rather than "-"). */
function withOpeningBalance(acct, txns) {
  const mine = txns.filter((t) => t.accountId === acct.id).sort((x, y) => x.date.localeCompare(y.date));
  if (!mine.length || !acct.balanceHistory || !acct.balanceHistory.length) return acct;
  const close = acct.balanceHistory[acct.balanceHistory.length - 1];
  const net = mine.reduce((sum, t) => sum + (t.direction === "credit" ? t.amount : -t.amount), 0);
  const first = new Date(mine[0].date + "T00:00:00Z"); first.setUTCDate(first.getUTCDate() - 1);
  const opening = { asOfDate: first.toISOString().slice(0, 10), balance: Math.round((close.balance - net) * 100) / 100 };
  return { ...acct, balanceHistory: [opening, ...acct.balanceHistory], uploadHistory: [{ periodStart: mine[0].date, periodEnd: mine[mine.length - 1].date }] };
}

export function sliceDemoJourney(data, months, answers = {}, labeller = null) {
  const start = startPeriodFor(data.historyEnd, months);
  const inWindow = (date) => date.slice(0, 7) >= start;
  const kept = new Set(Object.keys(ADDED).filter((k) => answers[k]).map((k) => ADDED[k]));
  const dropped = (id) => OTHER_ACCOUNTS.has(id) && !kept.has(id);
  // With a labeller (backlog #78) the window of RAW rows is labelled by the engine - single sightings, cadence and
  // links all come from what that window can actually show. Without one, the pre-labelled rows are used as before.
  // The labeller may return the rows, or { transactions, merchantAliases, rules } (library groups applied at import and the
  // learned rules behind the person's card answers).
  const labelled = labeller && data.rawRows
    ? labeller(data.rawRows.filter((t) => !dropped(t.accountId) && inWindow(t.date)), { linked: { loan: kept.has("acc_loan"), card: kept.has("acc_card"), demat: kept.has("acc_demat") } })
    : null;
  const transactions = labelled
    ? (Array.isArray(labelled) ? labelled : labelled.transactions)
    : data.transactions
      .filter((t) => !dropped(t.accountId) && inWindow(t.date))
      .map((t) => (dropped(t.linkedAccountId) ? { ...t, linkedAccountId: null } : t));

  // Count sightings WITHIN the window to decide whether a once-seen bill is "confirmed by history".
  const sightings = (pred) => transactions.filter(pred).length;
  const isFee = (t) => t.merchant === "School Fee" || t.merchant === "School fees";
  const isIns = (t) => t.merchant === "Car Insurance" || t.merchant === "ICICI Lombard";
  const apply = (t, pred, ansMap, ans) => {
    if (!pred(t)) return t;
    if (sightings(pred) >= 2) return t;                       // seen twice: history confirms it, keep as generated
    const a = ansMap[ans];
    if (a) return { ...t, ...a };
    // Unanswered single sighting: "not planned for yet", as the journey says. Modelled as One-Time, NOT as
    // Irregular/Recurring-without-cadence, because the engine's stream run-rate (computeStreamRunRate)
    // divides by the span between a stream's first and last active month - one sighting spans one month,
    // so a once-seen Rs 60,000 is forecast as Rs 60,000 EVERY month (measured: lowest point -Rs 41,807 at
    // 6 months instead of +Rs 1,34,452). That is a real engine flaw, logged as backlog #71 - this is a
    // deliberate workaround for the demo story, not a statement that the person called it a one-off.
    return { ...t, frequencyClass: "One-Time", frequency: null };
  };
  const adjusted = transactions.map((t) => apply(apply(t, isFee, FEE_ANS, answers.feeAns), isIns, INS_ANS, answers.insAns));

  return {
    transactions: adjusted,
    merchantAliases: (labelled && labelled.merchantAliases) || [],
    rules: (labelled && labelled.rules) || [],
    accounts: data.accounts.filter((a) => !dropped(a.id)).map((a) => (labelled && a.id === "acc_bank" ? withOpeningBalance(a, adjusted) : a)),
    holdingSnapshots: answers.inv ? data.holdingSnapshots.filter((x) => inWindow(x.asOfDate)) : [],
    debtSchedules: answers.loan ? data.debtSchedules : [],
    otherInvestments: answers.inv ? data.otherInvestments : [],
    goals: answers.goalSet ? data.goals : [],
  };
}
