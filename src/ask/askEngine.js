/**
 * Ask (backlog #75): a port of the 29 Sep journey prototype's Ask - same questions, same answer sections
 * (Based on / How I know / Your options / What I don't know / What would change this / What was sent to the
 * AI), same wording - but every figure comes from the REAL engine's numbers (passed in as `facts`), not from
 * the prototype's scripted story. So Ask can never contradict the Home card it explains.
 *
 * Pure functions, no React, no App.jsx imports. `facts` (built by App.jsx from what Home already computed):
 *   asOf            "YYYY-MM-DD"  today
 *   cash            number        cash today (null if unverified)
 *   cushion         number        cash cushion (0 / null when not set)
 *   months          number        distinct months of history
 *   firstMonth/lastMonth "YYYY-MM" the history window
 *   lastTxnDate     "YYYY-MM-DD"
 *   projection      computeCashProjection(...) result, or null
 *   commitments     computeRecurringCommitments(...) result
 *   transactions    the person's transactions
 *   accounts        the person's accounts
 *   goal            { name, target, targetDate, monthsLeft, sipPlannedMonthly } | null
 *   invested        number        invested today (holdings), 0 when none
 */

const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
export function fmtINR(n) { return (n < 0 ? "−" : "") + "₹" + Math.round(Math.abs(n)).toLocaleString("en-IN"); }
export function fmtK(n) {
  n = Math.abs(n);
  if (n >= 100000) { const l = (n / 100000).toFixed(2).replace(/\.?0+$/, ""); return "₹" + l + "L"; }
  return "₹" + Math.round(n / 1000) + "K";
}
export function fmtDay(iso) { return parseInt(iso.slice(8, 10), 10) + " " + MN[parseInt(iso.slice(5, 7), 10) - 1]; }
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

// ---- month arithmetic. idx 11 = the last month of history, idx 0 = eleven months before it (the prototype's own scale)
function addMonths(key, n) { const [y, m] = key.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); }
function monthLabel(key) { return MN[parseInt(key.slice(5, 7), 10) - 1] + " " + key.slice(0, 4); }
function idxKey(f, i) { return addMonths(f.lastMonth, i - 11); }
function idxLabel(f, i) { return monthLabel(idxKey(f, i)); }
function rangeLabel(f, a, b) {
  const la = idxLabel(f, a), lb = idxLabel(f, b);
  if (la === lb) return la;
  return (la.split(" ")[1] === lb.split(" ")[1] ? la.split(" ")[0] : la) + "–" + lb;
}
function idxOfMonth(f, key) { const [y1, m1] = key.split("-").map(Number), [y2, m2] = f.lastMonth.split("-").map(Number); return 11 - ((y2 - y1) * 12 + (m2 - m1)); }
const histLo = (f) => 12 - f.months;

// ---- the engine: category spend, summed only over the months that exist in the person's history
const CATS = {
  "Eating out": /eat(ing)? ?out|restaurant|dining|zomato|swiggy|food delivery/,
  "Groceries": /grocer|blinkit|zepto|bigbasket|supermarket/,
};
const isSpend = (t) => t.direction === "debit" && t.category !== "Income" && t.category !== "Investment";
function cardAccountIds(f) { return new Set((f.accounts || []).filter((a) => a.type === "creditCard").map((a) => a.id)); }
// card bills paid from the bank are not spending (the card purchases are, once the card is added) - never counted twice
function isCountedSpend(f, t) { return isSpend(t) && !(t.category === "Transfer" && t.linkedAccountId && cardAccountIds(f).has(t.linkedAccountId)); }
function textOf(t) { return ((t.merchant || "") + " " + (t.description || "")).toLowerCase(); }
function monthSpend(f, key, pred) { return f.transactions.filter((t) => t.date.slice(0, 7) === key && isCountedSpend(f, t) && (!pred || pred(t))).reduce((s, t) => s + Math.abs(t.amount), 0); }

function runSpend(f, cat, from, to) {
  const lo = Math.max(from, histLo(f), 0), hi = Math.min(to, 11), months = hi >= lo ? hi - lo + 1 : 0;
  let sum = 0;
  for (let i = lo; i <= hi && months; i++) sum += monthSpend(f, idxKey(f, i), (t) => CATS[cat].test(textOf(t)));
  const req = to - from + 1;
  return {
    category: cat, requested: { from: idxLabel(f, from), to: idxLabel(f, to), months: req },
    covered: months ? { from: idxLabel(f, lo), to: idxLabel(f, hi), months, label: rangeLabel(f, lo, hi) } : null,
    missing_months: req - months, total: sum, monthly_avg: months ? Math.round(sum / months) : null,
    status: months === 0 ? "none" : (months < req ? "partial" : "full"),
  };
}

/** Stands in for the small AI step that reads a question; a few simple rules do the job (as in the prototype). */
export function parseQuestion(f, text) {
  const t = text.toLowerCase();
  let cat = null, period = null, assumption = null, m;
  if (/eat(ing)? ?out|restaurant|dining|zomato|swiggy|food delivery/.test(t)) cat = "Eating out";
  else if (/grocer|blinkit|zepto|bigbasket|supermarket/.test(t)) cat = "Groceries";
  if (!cat || !/spen|paid|pay |cost|how much/.test(t)) return null;
  const yr = parseInt(f.lastMonth.slice(0, 4), 10);
  if (/last year|previous year/.test(t)) {
    period = { from: idxOfMonth(f, (yr - 1) + "-01"), to: idxOfMonth(f, (yr - 1) + "-12"), label: "calendar " + (yr - 1) };
    assumption = "I took “last year” to mean calendar " + (yr - 1) + ".";
  } else if (/this year/.test(t)) {
    const from = idxOfMonth(f, yr + "-01");
    period = { from, to: 11, label: "this year so far (" + rangeLabel(f, from, 11) + ")" };
  } else if (/last month/.test(t)) period = { from: 11, to: 11, label: "last month (" + idxLabel(f, 11) + ")" };
  else if (/(last|past) 12 months|past year/.test(t)) period = { from: 0, to: 11, label: "the last 12 months (" + rangeLabel(f, 0, 11) + ")" };
  else if ((m = t.match(/(last|past) (\d+) months/))) { const n = parseInt(m[2], 10); period = { from: 12 - n, to: 11, label: "the last " + n + " months" }; }
  return { cat, period, assumption };
}

// ---- forecast helpers (real projection, dates not day offsets)
function lowInfo(f) {
  const p = f.projection;
  if (!p || !p.dailyStates || !p.dailyStates.length) return null;
  return { low: p.projectedMinimumCash, lowDate: p.projectedMinimumCashDate, days: p.dailyStates, endDate: p.dailyStates[p.dailyStates.length - 1].date };
}
function lowWith(days, d0, amt) { let m = Infinity; days.forEach((d) => { const v = d.balance - (d.date >= d0 ? amt : 0); if (v < m) m = v; }); return m; }
function safeAfter(days, d0) { let m = Infinity; days.forEach((d) => { if (d.date >= d0 && d.balance < m) m = d.balance; }); return m; }
function incomeEvents(f) { return (f.projection.events || []).filter((e) => e.amount > 0 && e.date).sort((a, b) => a.date.localeCompare(b.date)); }
function outflowEvents(f) { return (f.projection.events || []).filter((e) => e.amount < 0 && e.date).sort((a, b) => a.amount - b.amount); }
function nextIncomeAfter(f, date) { return incomeEvents(f).find((e) => e.date > date) || null; }
function monthlyIncome(f) {
  const c = (f.commitments || []).filter((x) => x.category === "Income" && (!x.frequency || x.frequency === "Monthly"));
  return c.reduce((s, x) => s + x.lastAmount, 0);
}
function monthsOfHistoryKeys(f) { const out = []; for (let i = histLo(f); i <= 11; i++) out.push(idxKey(f, i)); return out; }
function normalMonth(f) {
  const keys = monthsOfHistoryKeys(f);
  const inc = keys.map((k) => f.transactions.filter((t) => t.date.slice(0, 7) === k && t.category === "Income" && t.direction === "credit").reduce((s, t) => s + t.amount, 0));
  const sp = keys.map((k) => monthSpend(f, k));
  const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);
  return { income: avg(inc), spending: avg(sp) };
}
function investCommitment(f) { return (f.commitments || []).filter((c) => c.category === "Investment").sort((a, b) => b.lastAmount - a.lastAmount)[0] || null; }

export function corePack(f) {
  const li = lowInfo(f), nm = f.months >= 3 && li ? normalMonth(f) : null;
  const accts = ["bank_savings"];
  (f.accounts || []).forEach((a) => { if (a.type === "creditCard") accts.push("credit_card"); else if (a.type === "debt") accts.push("loan"); else if (a.type === "demat") accts.push("investments"); });
  const age = f.lastTxnDate ? Math.max(0, Math.round((new Date(f.asOf) - new Date(f.lastTxnDate)) / 86400000)) : 0;
  return {
    as_of: f.asOf, data_age_days: age,
    data_covers: rangeLabel(f, histLo(f), 11) + " (" + plural(f.months, "month") + ")",
    accounts: Array.from(new Set(accts)), cash_today: f.cash, cushion: f.cushion || null,
    forecast: f.months >= 3 && li ? { horizon_days: li.days.length, lowest_point: li.low, lowest_date: fmtDay(li.lowDate) } : null,
    normal_month: nm, open_questions: [],
  };
}
function baseNums(f) {
  const li = lowInfo(f), n = ["Cash today " + fmtINR(f.cash || 0)];
  if (f.months >= 3 && li) n.push("Lowest " + fmtINR(li.low));
  if (f.cushion) n.push("Your cushion " + fmtINR(f.cushion));
  n.push(plural(f.months, "month") + " of history");
  return n;
}

// ---- the questions
export const ASKS = {
  lowest: { mode: "Explain", q: "When is my cash at its lowest, and why?", min: 3, build(f) {
    const li = lowInfo(f), inc = nextIncomeAfter(f, li.lowDate);
    // the biggest planned outflows before the low point, by name (a bill that repeats is summed, not listed three times)
    const grouped = {};
    outflowEvents(f).filter((e) => e.date <= li.lowDate).forEach((e) => { const g = grouped[e.name] || (grouped[e.name] = { name: e.name, sum: 0, n: 0, date: e.date }); g.sum += Math.abs(e.amount); g.n += 1; });
    const big = Object.values(grouped).sort((a, b) => b.sum - a.sum).slice(0, 3);
    const causes = [];
    if (inc) causes.push("Your income arrives on " + fmtDay(inc.date) + ", after the period’s last outflows.");
    big.forEach((g) => causes.push(esc(g.name) + " " + fmtINR(g.sum) + (g.n > 1 ? " across " + g.n + " payments before then." : " around " + fmtDay(g.date) + ".")));
    causes.push("Everything else on its usual dates, plus a normal month of everyday spending.");
    const dont = ["Anything unplanned — I’ve assumed a normal month of everyday spending."];
    if (f.months < 12) dont.push("Bills that come once a year, which a shorter history can’t show.");
    const inv = investCommitment(f);
    const change = [];
    if (inv) change.push("Skipping one " + esc(inv.name) + " investment would add " + fmtINR(inv.lastAmount) + " to that day.");
    if (f.cushion) change.push("A different cushion changes how this reads, not the number itself.");
    const dayBefore = inc && (new Date(inc.date) - new Date(li.lowDate)) / 86400000 === 1;
    return {
      a: "Your cash is lowest on " + fmtDay(li.lowDate) + ", at " + fmtINR(li.low) + ".",
      b: (inc ? (dayBefore ? "That’s the day before your " + fmtDay(inc.date) + " income lands, and it comes after the biggest outflows of the period." : "That’s just before your next income lands on " + fmtDay(inc.date) + ", after the biggest outflows of the period.") : "That’s the lowest point in the three months I can see."),
      why: causes, dont, change,
      bundle: { question: "lowest_point_explanation", lowest_point: li.low, lowest_date: fmtDay(li.lowDate), planned_big_outflows: big.map((g) => ({ name: g.name, total: g.sum, payments: g.n })), income_next: inc ? fmtDay(inc.date) : null },
    };
  } },
  afford: { mode: "Decide", q: "Can I afford a ₹1,00,000 purchase next month?", min: 3, build(f) {
    const li = lowInfo(f), amt = 100000, cushion = f.cushion || 0;
    const d1 = addMonths(f.asOf.slice(0, 7), 1) + "-01", d2 = addMonths(f.asOf.slice(0, 7), 2) + "-01";
    const now = lowWith(li.days, d1, amt), dec = lowWith(li.days, d2, amt);
    const safe1 = safeAfter(li.days, d1) - cushion, safe2 = safeAfter(li.days, d2) - cushion;
    const ok = now >= cushion, already = li.low < cushion;
    const a = ok ? "Yes, comfortably." : (already ? "Not without going further below your cushion." : "Not comfortably.");
    const b = "A ₹1,00,000 purchase around " + fmtDay(d1) + " would take your lowest point from " + fmtINR(li.low) + " to " + fmtINR(now) +
      (cushion ? ", which is " + fmtK(Math.abs(cushion - now)) + (now < cushion ? " below" : " above") + " your " + fmtINR(cushion) + " cushion." : ".");
    const opts = [];
    if (safe1 > 0) opts.push("Up to about " + fmtK(safe1) + " on " + fmtDay(d1) + " keeps you above your cushion.");
    if (safe2 > 0) opts.push("After " + fmtDay(d2) + ", up to about " + fmtK(safe2) + " would work.");
    opts.push("The same ₹1,00,000 on " + fmtDay(d2) + " would leave you near " + fmtINR(dec) + " by " + fmtDay(li.endDate) + ".");
    return {
      a, b, why: ["A purchase lowers every day after it by the same amount.", "Your lowest day is " + fmtDay(li.lowDate) + " — so that’s where it bites."], opts,
      dont: ["Anything you haven’t told me is coming — a bonus, or a new expense.", "Whether spending stays at a normal month’s level."],
      change: [cushion ? "A different cushion changes how “comfortable” is judged, not the numbers themselves." : "Setting a cash cushion tells me what “comfortable” means for you."],
      bundle: { question: "affordability", purchase: amt, lowest_before: li.low, ["lowest_if_bought_" + fmtDay(d1).replace(" ", "_").toLowerCase()]: now, ["lowest_if_bought_" + fmtDay(d2).replace(" ", "_").toLowerCase()]: dec, safe_amount_first: Math.max(0, safe1), safe_amount_second: Math.max(0, safe2) },
    };
  } },
  income: { mode: "Decide", q: "What if my income drops 20%?", min: 3, build(f) {
    const li = lowInfo(f), cushion = f.cushion || 0, inc = incomeEvents(f), cutMonthly = Math.round(0.2 * monthlyIncome(f));
    let nl = Infinity;
    li.days.forEach((d) => { const cut = inc.filter((e) => e.date <= d.date).reduce((s, e) => s + 0.2 * e.amount, 0); if (d.balance - cut < nl) nl = d.balance - cut; });
    const inv = investCommitment(f);
    return {
      a: cushion ? (nl >= cushion ? "You’d still stay above your cushion." : "You’d dip below your cushion.") : (nl >= 0 ? "You’d still stay above zero." : "You’d run out of cash."),
      b: "A 20% lower income means " + fmtINR(cutMonthly) + " less each month. Over the next three months your lowest point would fall from " + fmtINR(li.low) + " to " + fmtINR(nl) + ".",
      why: ["Each of the next " + (inc.length || 3) + " times your income lands would be lower, and that builds up."],
      opts: inv ? ["Pausing one " + esc(inv.name) + " investment adds " + fmtINR(inv.lastAmount) + " a month."] : [],
      dont: ["Whether your bills or spending would change if income fell."], change: ["How long the drop lasts — a one-month dip matters far less than a lasting one."],
      bundle: { question: "income_scenario", income_change_pct: -20, monthly_income_change: -cutMonthly, lowest_before: li.low, lowest_after: nl },
    };
  } },
  where: { mode: "Explain", q: "Where did my money go this month?", min: 1, build(f) {
    const key = f.lastMonth, label = monthLabel(key);
    const txns = f.transactions.filter((t) => t.date.slice(0, 7) === key && isCountedSpend(f, t));
    const total = txns.reduce((s, t) => s + Math.abs(t.amount), 0);
    const invested = f.transactions.filter((t) => t.date.slice(0, 7) === key && t.category === "Investment" && t.direction === "debit").reduce((s, t) => s + Math.abs(t.amount), 0);
    const by = {};
    // A merchant group (Sub Category 2: Grocery, Eating Out...) is the unit people think in; fall back to the merchant itself.
    const groupOf = (t) => { const g = (f.aliases || []).find((x) => x.variants.includes(t.merchant)); return g ? g.canonical : t.merchant || t.description; };
    txns.forEach((t) => { const k = groupOf(t); by[k] = (by[k] || 0) + Math.abs(t.amount); });
    const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const rest = total - top.reduce((s, x) => s + x[1], 0);
    const why = top.map(([k, v]) => esc(k) + " " + fmtINR(v));
    if (rest > 0) why.push("Everything else " + fmtINR(rest));
    const cats = {}; top.forEach(([k, v]) => { cats[k] = v; }); if (rest > 0) cats.Other = rest;
    return {
      a: fmtINR(total) + " went out in " + label.split(" ")[0] + ".",
      b: invested > 0 ? "Plus " + fmtINR(invested) + " you put into investing, which I count as investing, not spending." : "That’s everything I can see leaving your accounts that month.",
      why, dont: ["What the “everything else” is made of — I’ve only sorted the merchants I recognise."], change: ["Reviewing the merchants that need you would break it down further."],
      bundle: { question: "spending_breakdown", month: label, spending: total, invested, categories: cats },
    };
  } },
  bills: { mode: "Explain", q: "Which payments look like monthly bills?", min: 1, build(f) {
    const once = f.months < 2;
    const cards = cardAccountIds(f);
    const list = (f.commitments || []).filter((c) => !cards.has(c.accountId) && c.category !== "Income" && (!c.frequency || c.frequency === "Monthly")).sort((a, b) => b.lastAmount - a.lastAmount)
      .map((c) => [c.name, c.lastAmount, c.pattern && c.pattern.expectedDay ? "the " + ordinal(c.pattern.expectedDay) : null]);
    const n = list.length;
    return {
      a: once ? (n ? plural(n, "payment") + " look" + (n === 1 ? "s" : "") + " like monthly bills, but I’ve only seen each once." : "I haven’t seen enough to call anything a monthly bill yet.") : (n === 1 ? "One bill repeats every month." : n + " bills repeat every month."),
      b: once ? "One month can’t confirm a pattern, so I’m not calling any of them recurring yet." : "They show up on steady dates with steady amounts.",
      why: list.map((x) => esc(x[0]) + " · " + fmtINR(x[1]) + (x[2] ? " · around " + x[2] : "")),
      dont: once ? ["Whether any of these will repeat."] : ["Bills that only come once or twice a year."], change: ["Another month confirms these; a full year shows the yearly ones."],
      bundle: { question: "recurring_bills", pattern_strength: once ? "seen_once" : "recurring", bills: list.map((x) => ({ name: x[0], amount: x[1], timing: x[2] || "varies" })) },
    };
  } },
  card: { mode: "Explain", q: "What is my card bill made of?", min: 1, build(f) {
    const ids = cardAccountIds(f), key = f.lastMonth;
    const txns = f.transactions.filter((t) => ids.has(t.accountId) && t.date.slice(0, 7) === key && t.direction === "debit");
    const total = txns.reduce((s, t) => s + Math.abs(t.amount), 0);
    const by = {}; // A merchant group (Sub Category 2: Grocery, Eating Out...) is the unit people think in; fall back to the merchant itself.
    const groupOf = (t) => { const g = (f.aliases || []).find((x) => x.variants.includes(t.merchant)); return g ? g.canonical : t.merchant || t.description; };
    txns.forEach((t) => { const k = groupOf(t); by[k] = (by[k] || 0) + Math.abs(t.amount); });
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
    const card = (f.accounts || []).find((a) => a.type === "creditCard");
    return {
      a: "Your " + esc(card ? card.nickname || "card" : "card") + " spending last month was " + fmtINR(total) + ", in " + plural(rows.length, "kind") + ".",
      b: "These are last month’s card purchases, which settle from your bank on the card’s next bill.",
      why: rows.map(([k, v]) => esc(k) + " " + fmtINR(v)),
      dont: ["I count the purchases as spending when they happen, and the payment as settling a balance — never twice."], change: ["Nothing to do; this is what’s already scheduled."],
      bundle: { question: "card_bill_breakdown", bill: total, categories: Object.fromEntries(rows) },
    };
  } },
  eating: { mode: "Explain", q: "Why is eating out above my usual?", min: 3, build(f) {
    const re = CATS["Eating out"], last = f.lastMonth, keys = monthsOfHistoryKeys(f).filter((k) => k !== last);
    const inMonth = (k) => f.transactions.filter((t) => t.date.slice(0, 7) === k && isCountedSpend(f, t) && re.test(textOf(t)));
    const lastTx = inMonth(last), lastTotal = lastTx.reduce((s, t) => s + Math.abs(t.amount), 0);
    const normal = keys.length ? Math.round(keys.map((k) => inMonth(k).reduce((s, t) => s + Math.abs(t.amount), 0)).reduce((s, x) => s + x, 0) / keys.length) : 0;
    const diff = lastTotal - normal;
    const by = {}; lastTx.forEach((t) => { const k = t.merchant || t.description; by[k] = (by[k] || 0) + Math.abs(t.amount); });
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
    return {
      a: diff > 0 ? "Eating out was " + fmtINR(lastTotal) + " last month, about " + fmtINR(diff) + " above a normal month." : "Eating out was " + fmtINR(lastTotal) + " last month, about in line with a normal month.",
      b: rows[0] ? "Most of it is " + esc(rows[0][0]) + "." : "Nothing stands out.",
      why: rows.map(([k, v]) => esc(k) + " " + fmtINR(v)), dont: ["Whether this is a one-off or a new habit — that needs more months."],
      change: diff > 0 ? ["If it stays at this level, a normal month gets about " + fmtINR(diff) + " more expensive."] : [],
      bundle: { question: "category_change", category: "Eating out", last_month: lastTotal, normal_month: normal, difference: diff, top_merchants: rows.slice(0, 3).map(([k, v]) => ({ name: k, amount: v })) },
    };
  } },
  goal: { mode: "Decide", q: "Am I on track for my home goal?", min: 3, build(f) {
    const g = f.goal, left = Math.max(1, g.monthsLeft), need = Math.round((g.target - f.invested) / left / 100) * 100, sip = g.sipPlannedMonthly || 0, gap = need - sip;
    return {
      a: gap <= 0 ? "Yes, you’re on track." : "Close, but about " + fmtINR(gap) + " a month short.",
      b: "Your goal is " + fmtINR(g.target) + " by " + g.targetDate + ". With " + fmtINR(f.invested) + " invested today, you’d need about " + fmtINR(need) + " a month; your SIP is " + fmtINR(sip) + ".",
      why: ["Goal " + fmtINR(g.target) + " · " + plural(left, "month") + " left", "Invested so far " + fmtINR(f.invested), "Monthly SIP " + fmtINR(sip)],
      dont: ["Market returns — I’ve assumed none, so this is a cautious estimate."], change: ["Raising the SIP by " + fmtINR(Math.max(gap, 0)) + ", or moving the date out a few months."],
      bundle: { question: "goal_progress", target: g.target, target_date: g.targetDate, invested_now: f.invested, monthly_needed: need, monthly_sip: sip, assumed_returns: 0 },
    };
  } },
  spendly: { mode: "Explain", q: "How much did I spend on eating out last year?", min: 1, free: true },
};
function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

/** Which suggestion chips to show, and which ids can run at all with this data. */
export function canAnswer(f, id) {
  if (f.months < ASKS[id].min) return false;
  if (["lowest", "afford", "income"].includes(id)) return !!lowInfo(f);
  if (id === "card") return cardAccountIds(f).size > 0;
  if (id === "goal") return !!f.goal && f.invested > 0;
  return true;
}
export function suggestions(f) {
  const hasCard = cardAccountIds(f).size > 0;
  const ids = f.months >= 3 ? ["afford", "income", "lowest", "spendly", "where"] : ["where", "bills", "spendly"];
  if (hasCard && f.months >= 3) ids.push("card");
  if (f.goal && f.invested > 0 && f.months >= 3) ids.push("goal");
  return ids.filter((id) => canAnswer(f, id)).slice(0, 6);
}

const NEVER = "Never sent: transaction rows, account numbers, your statements. Merchant names go only when a question needs them, and you would see them here. In this demo nothing is actually sent — this shows what the real app would send.";
function sentHTML(steps) {
  return '<details class="sent"><summary>What was sent to the AI</summary><div class="sbody">' +
    steps.map((st, i) => '<div class="sstep"><b>' + (i + 1) + ". " + st.title + "</b><pre>" + esc(JSON.stringify(st.payload, null, 1)) + "</pre></div>").join("") +
    '<p class="snote">' + NEVER + "</p></div></details>";
}
export function answerHTML(f, d, mode) {
  const list = (k, items) => (items && items.length ? '<div class="r"><div class="k">' + k + "</div><ul>" + items.map((x) => "<li>" + x + "</li>").join("") + "</ul></div>" : "");
  return '<div class="ans"><span class="mode">' + mode + '</span><p class="a1">' + d.a + '</p><p class="a2">' + d.b + "</p>" +
    '<div class="r"><div class="k">Based on</div><div class="nums">' + (d.nums || baseNums(f)).map((x) => "<span>" + x + "</span>").join("") + "</div></div>" +
    list("How I know", d.why) + list("Your options", d.opts) + list("What I don’t know", d.dont) + list("What would change this", d.change) +
    (d.follow && d.follow.length ? '<div class="r"><div class="k">Try instead</div><div class="chips">' + d.follow.map((x) => '<button class="chip" data-fu="' + esc(x) + '">' + esc(x) + "</button>").join("") + "</div></div>" : "") +
    (d.steps ? sentHTML(d.steps) : "") + "</div>";
}
function cannedAnswer(f, id) {
  const d = ASKS[id].build(f);
  d.steps = [{ title: "Sent to the AI (the core pack, then facts for this question)", payload: { core: corePack(f), this_question: d.bundle } }];
  return d;
}
function spendAnswer(f, text, pq) {
  const res = runSpend(f, pq.cat, pq.period.from, pq.period.to), cat = pq.cat.toLowerCase();
  let a, b, alt = null; const why = [], dont = [], change = [], follow = [];
  if (res.status === "full") { a = "You spent " + fmtINR(res.total) + " on " + cat + " in " + pq.period.label + "."; b = "That’s about " + fmtINR(res.monthly_avg) + " a month."; }
  else if (res.status === "partial") { a = "I only have part of that period."; b = "For " + res.covered.label + " — " + res.covered.months + " of the " + res.requested.months + " months you asked about — you spent " + fmtINR(res.total) + " on " + cat + ", about " + fmtINR(res.monthly_avg) + " a month."; }
  else { alt = runSpend(f, pq.cat, histLo(f), 11); a = "I don’t have that period yet."; b = "Your history starts in " + idxLabel(f, histLo(f)) + ". In the months I do have (" + rangeLabel(f, histLo(f), 11) + ") you spent " + fmtINR(alt.total) + " on " + cat + ", about " + fmtINR(alt.monthly_avg) + " a month."; }
  if (pq.assumption) why.push(pq.assumption);
  why.push(pq.cat === "Groceries" ? "“Groceries” counts supermarkets and quick-commerce apps such as Blinkit and Zepto." : "“Eating out” counts restaurants and food-delivery apps such as Zomato and Swiggy.");
  const used = res.covered ? res.covered.months : (alt ? alt.covered.months : 0);
  why.push("I added up " + plural(used, "month") + " of your statements that fall in the period.");
  if (res.status !== "full") dont.push("Months before your history starts — I can’t know those.");
  dont.push("Anything paid in cash, or from an account I don’t have.");
  if (res.status !== "full") change.push("Adding earlier statements fills in the missing months.");
  if (res.status !== "full" && f.months < 12) follow.push(f.months === 1 ? "How much did I spend on " + cat + " last month?" : "How much did I spend on " + cat + " in the last " + f.months + " months?");
  if (pq.assumption && f.months >= 12) follow.push("How much did I spend on " + cat + " in the last 12 months?");
  const nums = ["As of " + f.asOf, "Data covers " + rangeLabel(f, histLo(f), 11)];
  const steps = [
    { title: "Sent to the AI: read this question (no financial data)", payload: { task: "read_question", question: text, today: f.asOf, category_names: Object.keys(CATS), intents: ["spend_in_period", "compare_periods", "explain_change"] } },
    { title: "Answered on your device (the AI answers: intent = spend_in_period)", payload: res },
    { title: "Sent to the AI: write the answer", payload: { question: text, result: res, core: corePack(f) } },
  ];
  return { a, b, why, dont, change, follow, nums, steps };
}
const unsupportedHTML = () => '<div class="ans"><p class="a2">In the real app I’d answer that from your numbers. This demo can answer spending questions about a category over a period — for example “How much did I spend on groceries last month?” — and the suggestions below.</p></div>';
function clarifyHTML(pq) {
  const cat = pq.cat.toLowerCase();
  const opts = [["Last month", "last month?"], ["Last 3 months", "in the last 3 months?"], ["Last 12 months", "in the last 12 months?"], ["Last year", "last year?"]];
  return '<div class="ans"><p class="a1">Over what period?</p><p class="a2">I can add up ' + cat + ' for any period I have data for.</p><div class="chips" style="margin-top:12px">' +
    opts.map((o) => '<button class="chip" data-fu="How much did I spend on ' + cat + " " + o[1] + '">' + o[0] + "</button>").join("") + "</div></div>";
}

/** A thread message is { q, id } (a canned question) or { q, free: true, pq }. Returns its HTML. */
export function msgHTML(f, m) {
  const uq = '<div class="uq">' + esc(m.q) + "</div>";
  if (!m.free) return uq + answerHTML(f, cannedAnswer(f, m.id), ASKS[m.id].mode);
  if (!m.pq) return uq + unsupportedHTML();
  if (!m.pq.period) return uq + clarifyHTML(m.pq);
  return uq + answerHTML(f, spendAnswer(f, m.q, m.pq), "Explain");
}
/** The question's own text - the card question names the real amount, as the prototype's does. */
export function askQ(f, id) {
  if (id === "card") {
    const ids = cardAccountIds(f);
    const total = f.transactions.filter((t) => ids.has(t.accountId) && t.date.slice(0, 7) === f.lastMonth && t.direction === "debit").reduce((x, t) => x + Math.abs(t.amount), 0);
    return "What is my " + fmtINR(total) + " card spend made of?";
  }
  return ASKS[id].q;
}
/** Builds the thread message for a canned id or a free-text question. */
export function messageFor(f, idOrText, isText) {
  if (isText) return { q: idOrText, free: true, pq: parseQuestion(f, idOrText) };
  if (ASKS[idOrText].free) return { q: ASKS[idOrText].q, free: true, pq: parseQuestion(f, ASKS[idOrText].q) };
  return { q: askQ(f, idOrText), id: idOrText };
}
export const ASK_INTRO = "Ask me anything about your money. I’ll show what I know, how I know it, and what I don’t know yet. Try one of these, or type your own question about spending in a category:";
export const ASK_PROMISE = "Every number comes from your statements. I never make one up.";
