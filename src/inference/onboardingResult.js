/**
 * What the engine knows about a statement, in the vocabulary of the onboarding journey (backlog #78/#79).
 * Pure, no App.jsx import: the caller injects the App's own classifiers, so the SAME rules + library run in
 * the demo and for a real upload:  { matchRule, seedRules, findLibraryEntry, normalizeMerchant }.
 *
 * Two separate questions per merchant (the agreed fix, GAP_REVIEW decision 1 & 2):
 *   1. Do we know WHAT it is?   -> Sorted | Quick look | Need you      (identity + category)
 *   2. Does it REPEAT?          -> "seen once" | "in N months" | "monthly"   (pattern, from sightings only)
 * A keyword rule may set the category at first sight but NEVER the repeat pattern: a single sighting is
 * "seen once" however recognisable the name is.
 *
 * Everything the screens show (counts, coverage, cards) is read from the return value of this one function.
 */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (iso) => Number(iso.slice(8, 10)) + " " + MON[Number(iso.slice(5, 7)) - 1];
export const fmtMoney = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const title = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// What we ask when we have no guess.
const ASK_CHOICES = ["Household help", "Family", "Eating out", "Groceries", "Shopping", "Transport", "Something else"];
const ASK_PATCHES = {}; // filled below, once CHOICE_PATCH exists

/** A UPI handle (name@bank) repeats the brand and would split one merchant in two; drop it before making the key. */
export const stripHandle = (d) => d.replace(/[A-Za-z0-9._]+@[A-Za-z0-9._]+/g, " ");

/** Library groups that are bills you cannot easily skip: a merchant in one of these defaults to Committed. */
export const COMMITTED_GROUPS = new Set(["Electricity", "Broadband/Internet", "Insurance Premium", "Education", "EMI & Debt Repayment", "Housing & Maintenance", "Water", "Gas", "DTH/Cable TV"]);

/** What each card choice means in the app's own terms (the same fields Review's bulk apply writes). No Subscription group:
 *  the library is being revised (see backlog), so "Subscription" is just a Flexible personal expense for now. */
// `sub1` is Sub Category 1 for an Expense: Household or Personal. (`purpose` in the app is Personal / Business - a different field.)
const X = (sub1, control, group = null) => ({ category: "Expense", sub1, control, group, groupType: "category" });
export const CHOICE_PATCH = {
  "Household help": X("Household", "Committed", "Home Services"), Rent: X("Household", "Committed", "Housing & Maintenance"),
  Family: X("Personal", "Committed"), Friends: X("Personal", "Flexible"), Gifts: X("Personal", "Flexible"),
  "Eating out": X("Personal", "Flexible", "Eating Out"), Groceries: X("Household", "Flexible", "Grocery"), Grocery: X("Household", "Flexible", "Grocery"),
  Shopping: X("Personal", "Flexible", "Shopping"), Transport: X("Personal", "Flexible", "Transport"), Health: X("Personal", "Flexible", "Health & Pharmacy"),
  "Bills & utilities": X("Household", "Committed"), Subscription: X("Personal", "Flexible"), "Something else": X("Personal", "Flexible"),
};
ASK_CHOICES.forEach((c) => { ASK_PATCHES[c] = CHOICE_PATCH[c]; });
/** What confirming the library's own guess means. */
export function libraryPatch(lib) {
  if (!lib) return null;
  return { category: lib.category, sub1: lib.category === "Expense" ? (lib.sub || null) : null, control: lib.category === "Expense" ? (COMMITTED_GROUPS.has(lib.group) ? "Committed" : "Flexible") : null, group: lib.group || null, groupType: lib.groupType || "category" };
}
/** What each "Does this repeat?" choice means for a merchant's cadence (own-statement journey). */
export const REPEAT_CADENCE = { "Every 6 months": { frequencyClass: "Recurring", frequency: "Semi-Annual" }, "Every year": { frequencyClass: "Recurring", frequency: "Annual" }, "One-off": { frequencyClass: "One-Time", frequency: null } };
/** The patch an answer stands for: its own, or the one its choice label means. */
export const answerPatch = (a) => (a && (a.patch || CHOICE_PATCH[a.label])) || null;
/** What answering `choice` on `card` means: confirming the guess, or the card's own patch for that choice, or the generic one. */
export const patchForAnswer = (card, choice) => (choice === card.guess ? card.patch : card.patches && card.patches[choice])
  || (card.customGroupBase && choice ? { ...card.customGroupBase, group: String(choice).trim(), groupType: "category" } : undefined);

function monthsBetween(a, b) { return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)); }

/** A readable name from a normalised key: no bank-rail words, no repeated word (a UPI handle repeats the brand), ATM spelt out. */
export function displayName(key) {
  if (/^atm cash/i.test(key)) return "ATM cash withdrawals";
  const seen = new Set();
  const words = key.split(" ").filter((w) => !/^(upi|neft|ach|bbps|imps)$/i.test(w) && w && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()));
  return title(words.join(" ") || key);
}

/** The repeat pattern, from sightings alone. */
export function patternOf(dates) {
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))].sort();
  if (dates.length < 2 || months.length < 2) return { kind: "once", months: months.length, label: "Seen once · pattern not established" };
  const gaps = months.slice(1).map((m, i) => monthsBetween(months[i], m));
  const steady = gaps.every((g) => g === 1);
  if (steady && months.length >= 3) return { kind: "monthly", months: months.length, label: "Every month" };
  if (steady) return { kind: "twice", months: months.length, label: "Seen in " + months.length + " months" };
  if (gaps.length === 1 && gaps[0] >= 5) return { kind: "periodic", months: months.length, label: "Seen " + months.length + " times, " + gaps[0] + " months apart" };
  return { kind: "irregular", months: months.length, label: "Comes and goes" };
}

function spanText(a, b) {
  const yr = a.slice(0, 4) !== b.slice(0, 4);
  return fmtDate(a) + (yr ? " " + a.slice(0, 4) : "") + " to " + fmtDate(b) + (yr ? " " + b.slice(0, 4) : "");
}

/** Share of SPENDING (debits that are not transfers or investments) that sits in Sorted merchants. */
function coverage(list) {
  const spend = list.filter((g) => g.direction === "debit" && g.category !== "Transfer" && g.category !== "Investment");
  const all = spend.reduce((a, g) => a + g.total, 0);
  const done = spend.filter((g) => g.status === "sorted").reduce((a, g) => a + g.total, 0);
  return all ? Math.round((100 * done) / all) : 0;
}

/** A "bill": one payment a month, of a steady size. (Zepto is monthly too, but it is shopping, not a bill.) */
export const isBill = (g) => g.direction === "debit" && g.pattern.months >= 2 && g.count <= g.pattern.months * 1.2;

/**
 * rows: raw statement rows. answers: [{ key, label, category? }] written by the review cards (a card answer
 * becomes a rule for that merchant key, so the next run sorts it).
 */
export function computeOnboardingResult(rows, engine, answers = [], asOf = null) {
  const { matchRule, seedRules, findLibraryEntry, normalizeMerchant } = engine;
  const rules = seedRules();
  const answered = new Map(answers.map((a) => [a.key, a]));
  const bankRows = rows;
  const groups = new Map();
  const memo = new Map();
  const classify = (description, aiKey) => {
    const k = description.replace(/\d+/g, "#") + (aiKey ? "|" + aiKey : "");
    if (!memo.has(k)) memo.set(k, { key: aiKey || normalizeMerchant(stripHandle(description)), rule: matchRule(description, rules), lib: findLibraryEntry(aiKey || description) }); // a row read by the AI is looked up in the library by its name, not by the whole line (#161) // a row read by the AI is identified by its AI name (#160)
    return memo.get(k);
  };
  for (const r of bankRows) {
    const c = classify(r.description, r.aiKey);
    // A credit (a dividend, a refund) is never an Expense: the library's expense guess for the merchant does not apply to it.
    if (!groups.has(c.key)) groups.set(c.key, { key: c.key, rule: c.rule, lib: r.direction === "credit" && c.lib && c.lib.category === "Expense" ? null : c.lib, rows: [], direction: r.direction });
    groups.get(c.key).rows.push(r);
  }
  const list = [...groups.values()].map((g) => {
    const dates = g.rows.map((r) => r.date).sort();
    const total = g.rows.reduce((s, r) => s + r.amount, 0);
    const name = g.lib && g.lib.merchant ? g.lib.merchant : g.rule && g.rule.pattern ? title(g.rule.pattern) : displayName(g.key); // a recognised keyword (salary, rent) names the thing better than a payee
    const ans = answered.get(g.key) || answered.get(name.toLowerCase());
    // Do we know WHAT it is?
    let status, source, guess, conf;
    if (ans) { status = "sorted"; source = "answer"; guess = ans.label; conf = "Confirmed"; }
    else if (g.rule && g.rule.pattern && g.rule.source && g.rule.source !== "system") { status = "sorted"; source = "rule"; guess = g.rule.subCategory || g.rule.category; conf = "High"; } // the person's own / learned rule outranks the library
    else if (g.lib && g.lib.identityConfidence === "High" && g.lib.classificationConfidence === "High") { status = "sorted"; source = "library"; guess = g.lib.group || g.lib.sub || g.lib.category; conf = "High"; }
    else if (g.rule && g.rule.category && g.rule.category !== "Expense") { status = "sorted"; source = "rule"; guess = g.rule.category; conf = "High"; } // income, transfers, investments: structural
    else if (g.rule && g.rule.pattern) { status = "sorted"; source = "rule"; guess = g.rule.tag || g.rule.subCategory || g.rule.category; conf = "High"; }
    else if (g.lib && g.lib.category) { status = "quick"; source = "library"; guess = g.lib.group || g.lib.sub || g.lib.category; conf = g.lib.classificationConfidence; }
    else if (g.direction === "credit") { status = "sorted"; source = "credit"; guess = "Income"; conf = "High"; } // money in is never asked about as if it were spending
    else { status = "need"; source = "none"; guess = null; conf = null; }
    const userRule = g.rule && g.rule.source && g.rule.source !== "system" ? g.rule : null;
    const amts = g.rows.map((r) => r.amount);
    const ap = answerPatch(ans);
    // What an EXPENSE still lacks once we know what it is: its group (Sub Category 2) and Household / Personal (Sub Category 1).
    // A person's own answer settles both (a "leave on its own" answer is an answer for the group).
    const cat = ap ? ap.category : userRule ? userRule.category : g.rule && g.rule.category !== "Expense" ? g.rule.category : g.lib && g.lib.category ? g.lib.category : g.rule ? g.rule.category : null;
    const sub1 = ap ? ap.sub1 || null : userRule ? userRule.subCategory || userRule.tag || null : (g.lib && g.lib.category === "Expense" && g.lib.sub) || (g.rule && g.rule.tag) || null;
    const grp = ap ? ap.group || null : userRule ? null : g.lib ? g.lib.group || null : null;
    const needs = !ans && g.direction === "debit" && cat === "Expense" && status !== "quick" && status !== "need" ? [...(grp || userRule ? [] : ["group"]), ...(sub1 ? [] : ["sub1"])] : []; // a rule the person made already settles the group question
    return { key: g.key, sub1, needs, rows: g.rows, finalCat: cat, name, status, source, guess, conf, tag: g.lib ? g.lib.sub : null, group: ap ? ap.group : g.lib ? g.lib.group : null, groupFrom: ap ? "answer" : g.lib && g.lib.group ? "library" : null, hasUserRule: !!userRule, ruleGroup: userRule ? userRule.group || null : null, patch: libraryPatch(g.lib), min: Math.min(...amts), max: Math.max(...amts), count: g.rows.length, total, last: dates[dates.length - 1], dates,
      direction: g.direction, ruleSaysRecurring: !!(g.rule && g.rule.frequencyClass === "Recurring") || !!(g.lib && COMMITTED_GROUPS.has(g.lib.group)), category: ap ? ap.category : g.rule ? g.rule.category : g.lib ? g.lib.category : null, pattern: patternOf(dates) };
  });
  const sorted = list.filter((g) => g.status === "sorted"), quick = list.filter((g) => g.status === "quick"), need = list.filter((g) => g.status === "need");
  const txIn = (gs) => gs.reduce((s, g) => s + g.count, 0);
  const allDates = bankRows.map((r) => r.date).sort();

  // The DECK: one card per merchant we cannot fully settle, biggest spend first (confirm the guess, then ask), with real
  // counts/amounts/dates. Onboarding shows the front of it until most of the spend is settled; Home opens all of it.
  const byTotal = (a, b) => b.total - a.total;
  // Amounts carry their sign: money out is "\u2212", money in is "+". The card also shows the latest real rows, so the person can see what they are answering about.
  const net = (g) => g.rows.reduce((s, r) => s + (r.direction === "credit" ? r.amount : -r.amount), 0);
  const signed = (n) => (n < 0 ? "\u2212" : "+") + fmtMoney(Math.abs(n));
  const samples = (g) => [...g.rows].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3).map((r) => ({ id: r.id, date: fmtDate(r.date), text: String(r.description).replace(/\s+/g, " ").slice(0, 90), amount: r.direction === "credit" ? r.amount : -r.amount, signed: signed(r.direction === "credit" ? r.amount : -r.amount) }));
  const card = (g) => ({ key: g.key, name: g.name, meta: g.count + (g.count === 1 ? " payment" : " payments") + " \u00B7 " + signed(net(g)) + " \u00B7 last " + fmtDate(g.last), samples: samples(g), more: Math.max(0, g.count - 3),
    guess: g.guess, tag: g.tag, conf: g.conf, patch: g.patch, patches: g.guess ? undefined : ASK_PATCHES, choices: g.guess ? null : ASK_CHOICES, status: g.status, total: g.total, direction: g.direction });
  // Groups worth offering when a known merchant has none: those already in this statement, biggest spend first.
  const groupSpend = new Map();
  list.forEach((g) => { if (g.group && g.direction === "debit" && g.finalCat === "Expense") groupSpend.set(g.group, (groupSpend.get(g.group) || 0) + g.total); });
  const offered = [...groupSpend.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((e) => e[0]);
  const NONE = "Leave on its own";
  const detail = (g) => {
    const base = { category: "Expense", sub1: g.sub1 || "Personal", control: g.patch ? g.patch.control : "Flexible" };
    const patches = {};
    if (g.needs.includes("group")) {
      offered.forEach((o) => { patches[o] = { ...base, group: o, groupType: "category" }; });
      patches[NONE] = { ...base, group: null, groupType: null };
      return { ...card(g), guess: null, ask: "Which group does this belong to?", choices: Object.keys(patches), patches, status: "detail", customGroupBase: base };
    }
    ["Household", "Personal"].forEach((o) => { patches[o] = { ...base, sub1: o, group: g.group, groupType: "category" }; });
    return { ...card(g), guess: null, ask: "Is this for the household or for you?", choices: Object.keys(patches), patches, status: "detail" };
  };
  const detailCards = list.filter((g) => g.needs.length).sort(byTotal).map(detail);
  const deck = [...quick.sort(byTotal), ...need.sort(byTotal)].map(card).concat(detailCards);
  const spendOf = (g) => (g.direction === "debit" && g.category !== "Transfer" && g.category !== "Investment" ? g.total : 0);
  const allSpend = list.reduce((a, g) => a + spendOf(g), 0), COVER_TARGET = 0.9, MAX_CARDS = 8;
  let resolved = sorted.reduce((a, g) => a + spendOf(g), 0), taken = 0;
  const cards = [];
  for (const c of deck) {
    if (taken >= MAX_CARDS || (allSpend && resolved / allSpend >= COVER_TARGET && taken >= 3)) break;
    cards.push(c); taken++; if (c.status !== "detail" && c.direction === "debit") resolved += c.total; // a detail card (group / Household) is about a merchant already known
  }
  // "Does this repeat?" - a large single sighting that no rule recognises as a planned bill.
  // Only once the window is long enough (6+ months) that a monthly bill WOULD have repeated: a big bill seen
  // exactly once in that time is genuinely ambiguous (yearly? half-yearly? one-off?). Shorter windows cannot
  // tell, and say so on the payoff screen instead ("we'll confirm once we see another month").
  const windowMonths = allDates.length ? monthsBetween(allDates[0], allDates[allDates.length - 1]) + 1 : 0;
  const repeatAnswered = new Set(answers.filter((a) => String(a.key).startsWith("repeat:")).map((a) => String(a.key).slice(7)));
  const repeatCards = (windowMonths < 6 ? [] : list).filter((g) => g.count === 1 && g.direction === "debit" && g.total >= 20000 && g.source !== "answer" && !repeatAnswered.has(g.key))
    .map((g) => ({ key: g.key, name: g.name, meta: "1 payment · " + signed(net(g)) + " · " + fmtDate(g.last), samples: samples(g), more: 0, guess: null, ask: "Does this repeat?", repeat: true, choices: ["Every 6 months", "Every year", "One-off", "Not sure"] }));

  const income = list.filter((g) => g.direction === "credit").sort(byTotal)[0] || null;
  const bills = list.filter(isBill);
  const monthlyBills = bills.filter((g) => g.pattern.kind === "monthly");
  const periodic = list.filter((g) => g.direction === "debit" && g.pattern.kind === "periodic" && g.total / g.count >= 10000); // big bills that come every few months
  const lookMonthly = list.filter((g) => g.direction === "debit" && g.count === 1 && g.ruleSaysRecurring);
  return {
    transactions: bankRows.length, merchants: list.length, sorted: sorted.length, quick: quick.length, need: need.length,
    cov: coverage(list),
    span: allDates.length ? spanText(allDates[0], asOf || allDates[allDates.length - 1]) : "",
    from: allDates[0] || null, to: allDates[allDates.length - 1] || null,
    income: income && { name: income.name, amount: Math.round(income.total / income.count), day: Number(income.dates[0].slice(8, 10)), pattern: income.pattern },
    bills: bills.length, monthlyBills: monthlyBills.length, periodic: periodic.length, lookMonthly: lookMonthly.length,
    groups: list, deck, cards, repeatCards, moreToReview: deck.length - cards.length, toReview: cards.length + repeatCards.length,
  };
}
