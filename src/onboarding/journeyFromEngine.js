/**
 * The journey's numbers and review cards, computed by the engine (backlog #79). Replaces the prototype's
 * scripted DATA / QUICK tables: same fields, same wording, but every figure is read from
 * computeOnboardingResult(statement window, answers). Pure.
 */
import { computeOnboardingResult, isBill, fmtMoney, fmtDate } from "../inference/onboardingResult.js";
import { labelStatementFull } from "../demo/labelStatement.js";

export const STEPS = [1, 2, 3, 6, 12];
const ord = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

export function startOf(historyEnd, months) {
  const [y, m] = historyEnd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - (months - 1), 1)).toISOString().slice(0, 10);
}

function lines(r, h) {
  const inc = r.income;
  const word = inc && /salary/i.test(inc.name) ? "salary" : "income";
  const incomeLine = !inc ? "We could not see a regular income yet"
    : h === 1 ? "Spotted your income — a <b>" + word + "</b> of " + inr(inc.amount) + " on " + inc.day + " " + MON[Number(r.from.slice(5, 7)) - 1]
    : h === 2 ? "Spotted your income — <b>" + word + " on the " + ord(inc.day) + "</b>, both months"
    : h === 3 ? "Spotted your income — <b>" + word + " on the " + ord(inc.day) + "</b>, every month"
    : "Spotted your income — <b>" + word + " on the " + ord(inc.day) + "</b>, " + inr(inc.amount);
  const billsLine = h === 1 ? "Found <b>" + plural(r.lookMonthly, "payment", "payments") + "</b> that look like monthly bills — we’ll confirm once we see another month"
    : h === 2 ? "Found <b>" + plural(r.bills, "payment", "payments") + "</b> that showed up in both months"
    : h === 3 ? "Found <b>" + plural(r.monthlyBills, "bill", "bills") + "</b> that repeat every month"
    : h === 6 ? "Found <b>" + plural(r.monthlyBills, "bill", "bills") + "</b> that repeat every month" + (r.periodic ? ", and <b>" + r.periodic + "</b> that comes twice a year" : "")
    : "Found <b>" + plural(r.monthlyBills, "bill", "bills") + "</b> that repeat monthly" + (r.periodic + r.repeatCards.length ? " and <b>" + (r.periodic + r.repeatCards.length) + "</b> that come once or twice a year" : "");
  return { incomeLine, billsLine };
}

/** statement rows (bank only, as at this point in the story), engine, history end, answers -> everything the screens read. */
export function buildJourney(rows, engine, historyEnd, answers = [], live = null) {
  const byH = {};
  STEPS.forEach((h) => {
    const from = startOf(historyEnd, h);
    const r = computeOnboardingResult(rows.filter((x) => x.date >= from), engine, answers, historyEnd);
    byH[h] = { result: r, data: { tx: r.transactions, merchants: r.merchants, sorted: r.sorted, quick: r.quick, need: r.need, cov: r.cov, span: r.span, known: r.sorted + r.quick,
      toReview: r.toReview, moreToReview: r.moreToReview, ...lines(r, h) } };
  });
  // Labelled rows per window: the figures the Payoff and the stepper show (snapshot, a normal month, seasons) are read from them.
  STEPS.forEach((h) => { byH[h].txns = labelStatementFull(rows.filter((x) => x.date >= startOf(historyEnd, h)), engine, answers, { linked: {} }).transactions; });
  return { byH, engineHooks: (forecast) => engineHooks(byH, historyEnd, forecast, live && { ...live, answers }), data: (h) => byH[h].data, cards: (h) => [...byH[h].result.cards, ...byH[h].result.repeatCards], result: (h) => byH[h].result };
}

// ---------------------------------------------------------------------------------------------------------------
// Hooks for the prototype's Payoff / "What more history unlocks" templates (journeyTemplates.generated.js ENG):
// every figure those screens used to hold as script is computed here from the engine's own output.
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
const debits = (t) => t.filter((x) => x.direction === "debit");
const credits = (t) => t.filter((x) => x.direction === "credit");
const monthsIn = (t) => new Set(t.map((x) => x.date.slice(0, 7))).size || 1;
const medianDay = (g) => { const d = g.dates.map((x) => Number(x.slice(8, 10))).sort((a, b) => a - b); return d[Math.floor(d.length / 2)]; };
const dayOffset = (iso, from) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000);
const addDays = (iso, n) => { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)); return d.toISOString().slice(0, 10); };
const isOnceBig = (g) => g.count === 1 && g.direction === "debit" && g.total >= 20000 && g.source !== "answer";
const addMonths = (iso, n) => { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + n, +iso.slice(8, 10))); return d.toISOString().slice(0, 10); };

export function engineHooks(byH, historyEnd, forecast, L = null) {
  const h0 = (L && L.h) || 1; // the window a live journey reads (the months actually uploaded)
  const res = (h) => byH[h].result;
  const lookKeys = new Set(res(1).groups.filter((g) => g.direction === "debit" && g.count === 1 && g.ruleSaysRecurring).map((g) => g.key));
  const billRows = (h) => {
    const gs = h === 1 ? res(1).groups.filter((g) => lookKeys.has(g.key)) : res(h).groups.filter(isBill);
    return gs.sort((a, b) => b.total / b.count - a.total / a.count).map((g) => {
      const avg = g.total / g.count, varies = g.max > g.min * 1.05;
      return [g.name, varies ? fmtMoney(g.min) + "\u2013" + Math.round(g.max).toLocaleString("en-IN") : fmtMoney(avg), varies ? "amount varies" : "around the " + ord(medianDay(g)), !L && h === 2 && !lookKeys.has(g.key)];
    });
  };
  const normal = (h) => {
    const t = byH[h].txns, m = monthsIn(t), inn = sum(credits(t), (x) => x.amount) / m, out = sum(debits(t), (x) => x.amount) / m, net = inn - out;
    return { inn: fmtMoney(inn), out: fmtMoney(out), net: fmtMoney(Math.abs(net)), label: net >= 0 ? "Left over" : "Short by" };
  };
  const monthlySpendExInvest = () => { const t = byH[3].txns; return sum(debits(t).filter((x) => x.category !== "Investment"), (x) => x.amount) / monthsIn(t); };
  const cush = (() => { const m = Math.round(monthlySpendExInvest() / 1000) * 1000; return { "1": m, "3": 3 * m, "6": 6 * m }; })();
  const memo = {};
  const fcRaw = (h, fee, ins) => {
    const k = h + "|" + fee + "|" + ins;
    if (!memo[k]) memo[k] = forecast(h, fee, ins, L && L.answers);
    return memo[k];
  };
  const find = (h, name) => res(h).groups.find((g) => g.name === name);
  const money = (n) => fmtMoney(n);
  const season = () => {
    const t = byH[12].txns.filter((x) => x.direction === "debit" && x.category === "Expense" && x.control === "Flexible");
    const by = {}; t.forEach((x) => { by[x.date.slice(5, 7)] = (by[x.date.slice(5, 7)] || 0) + x.amount; });
    const fest = ((by["10"] || 0) + (by["11"] || 0)) / 2, rest = sum(Object.keys(by).filter((m) => m !== "10" && m !== "11"), (m) => by[m]) / Math.max(1, Object.keys(by).length - 2);
    const pct = rest ? Math.round((100 * (fest - rest)) / rest) : 0;
    return pct >= 10 ? "Spending ran about <b>" + pct + "% higher</b> in October\u2013November last year \u2014 the festive season." : "Spending was steady through the year, with no strong season standing out yet.";
  };
  return {
    cush,
    bills: billRows,
    snapshot: () => { const t = byH[h0].txns, inn = sum(credits(t), (x) => x.amount), out = sum(debits(t), (x) => x.amount), net = inn - out;
      return { income: fmtMoney(inn), spending: fmtMoney(out), spendLabel: "Money out (incl. EMI, card bill, SIP)", net: fmtMoney(Math.abs(net)), netLabel: net >= 0 ? "Net cash generated" : "More went out than came in",
        transactions: String(t.length), lookRecurring: String(res(h0).lookMonthly), discretionary: fmtMoney(sum(debits(t).filter((x) => x.category === "Expense" && x.control === "Flexible"), (x) => x.amount)) }; },
    normal,
    note: (h) => {
      if (h === 2) { const n = billRows(2), carried = n.filter((r) => !r[3]).length; return "<b>" + n.length + "</b> payments now show up in both months, including " + carried + " of the " + lookKeys.size + " that looked like monthly bills. Your salary arrived on the " + ord(res(2).income ? res(2).income.day : 1) + " both months."; }
      if (h === 6) { const f = find(6, "School fees"); if (!f) return null; const a = fcRaw(6, undefined, undefined), b = fcRaw(6, "6m", undefined);
        return "A " + money(f.total) + " school fee turned up in " + MONTHS_LONG[+f.last.slice(5, 7) - 1] + ". I\u2019d only seen it once, so I asked Asha whether it repeats \u2014 every 6 months, she said. I\u2019ve planned for it around " + fmtDate(addMonths(f.last, 6)) + ", which pulls the lowest point down from " + money(a.low) + " to " + money(b.low) + "."; }
      if (h === 12) { const ins = find(12, "ICICI Lombard"); if (!ins) return null; const c = fcRaw(12, "6m", "year");
        return "Last " + MONTHS_LONG[+ins.last.slice(5, 7) - 1] + "\u2019s " + money(ins.total) + " car-insurance premium is now visible; Asha confirmed it repeats every year, so it\u2019s in the forecast. The school fee is now confirmed by history. The lowest point falls to " + money(c.low) + "."; }
      return null;
    },
    season,
    rich: () => { const t = byH[h0].txns, one = (xs) => xs.length === 1;
      const card = t.filter((x) => x.category === "Transfer" && /CARD/i.test(x.description)), emi = t.filter((x) => x.category === "Transfer" && /EMI|LOAN/i.test(x.description)), sip = t.filter((x) => x.category === "Investment");
      const avg = (xs) => (xs.length ? sum(xs, (x) => x.amount) / xs.length : 0);
      return [["Credit card", "We noticed " + (one(card) ? "a payment" : card.length + " payments") + " to a credit card" + (one(card) ? "" : ", about " + money(avg(card)) + " a month") + (one(card) ? " of " + money(avg(card)) : "") + ". That statement would show what " + (one(card) ? "it" : "they") + " paid for."],
        ["Loans", "We noticed a home-loan EMI of " + money(avg(emi)) + (one(emi) ? "" : " a month") + ". The loan schedule shows what you still owe."],
        ["Investments", "We noticed " + (one(sip) ? "a SIP" : "SIPs") + " of " + money(avg(sip)) + (one(sip) ? "" : " a month") + ". Your holdings show what " + (one(sip) ? "it has" : "they\u2019ve") + " grown to."]]; },
    ...(L ? {
      // The own-statement journey (backlog #72): same screens, the person's own figures.
      live: true,
      today: L.today,
      cashNote: () => "as of " + fmtDate(historyEnd) + (L.accountName ? " \u00B7 " + L.accountName : ""),
      axis: () => [["Today", 0, "start"], [fmtDate(addDays(historyEnd, 64)), 64, "middle"], [fmtDate(addDays(historyEnd, 90)), 90, "end"]],
      found: (h) => {
        const r = res(h), inc = r.income;
        if (h === 2) return "<b>" + r.bills + "</b> payments showed up in both months" + (inc ? ", and your salary arrived on the " + ord(inc.day) + " each time" : "") + ".";
        if (h === 3) return "<b>" + r.monthlyBills + "</b> " + (r.monthlyBills === 1 ? "bill repeats" : "bills repeat") + " every month. A normal month is clear, and I can give a first, early forecast.";
        const once = r.groups.filter(isOnceBig), asked = once.filter((g) => !!L.answers.find((a) => a.key === "repeat:" + g.key));
        const tail = once.length ? " " + once.length + (once.length === 1 ? " large payment turned up only once" : " large payments turned up only once") + (asked.length === once.length ? " \u2014 and you have told me about " + (once.length === 1 ? "it" : "them") + "." : " \u2014 your review cards ask whether " + (once.length === 1 ? "it repeats" : "they repeat") + ".") : "";
        return "<b>" + r.monthlyBills + "</b> " + (r.monthlyBills === 1 ? "bill repeats" : "bills repeat") + " every month." + (r.periodic ? " <b>" + r.periodic + "</b> come" + (r.periodic === 1 ? "s" : "") + " once or twice a year." : "") + tail;
      },
      // Bills that come once or twice a year: the ones history has confirmed, and the large payments seen once (answered on the review cards).
      periodic: (h) => {
        const r = res(h), conf = r.groups.filter((g) => g.direction === "debit" && g.pattern.kind === "periodic"), once = r.groups.filter(isOnceBig);
        const bill = (name, sub, em, ok, small) => '<div class="bill"><div><b>' + name + "</b><span>" + sub + '</span></div><div class="rt"><em class="' + (ok ? "ok" : "") + '">' + em + "</em><small>" + small + "</small></div></div>";
        const rows = conf.map((g) => bill(g.name, fmtMoney(g.total / g.count) + " \u00B7 paid " + g.count + " times, last " + fmtDate(g.last), "Recurring", true, "Confirmed by history"))
          .concat(once.map((g) => { const a = L.answers.find((x) => x.key === "repeat:" + g.key); const lab = a ? a.label : null;
            return bill(g.name, fmtMoney(g.total) + " \u00B7 seen once, on " + fmtDate(g.last), lab && lab !== "Not sure" ? lab : "Seen once", !!lab && lab !== "Not sure" && lab !== "One-off",
              lab ? (lab === "One-off" ? "You said it is a one-off \u2014 not planned for" : lab === "Not sure" ? "Not sure yet \u2014 not planned for" : "You told me \u2014 planned for") : "Pattern not established \u00B7 your review card asks"); }));
        return '<div class="sec"><div class="sh">Bills that come once or twice a year</div>' + (rows.length ? rows.join("") : '<p class="note">None seen yet in this history.</p>') + (h >= 12 ? "" : '<p class="note">A full year would show the rest.</p>') + "</div>";
      },
    } : {}),
    ...(forecast ? {
      fc: (h, fee, ins) => { const p = fcRaw(h, fee, ins); const pts = p.states.map((d) => [dayOffset(d.date, historyEnd), d.balance / 1000]).filter((x) => x[0] >= 0 && x[0] <= 90);
        return { pts, low: Math.round(p.low), band: h >= 12 ? 8 : h >= 6 ? 16 : 30 }; },
      lowdate: (h, fee, ins) => fmtDate(fcRaw(h, fee, ins).lowDate),
    } : {}),
  };
}
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
