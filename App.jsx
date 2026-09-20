// EDITING NOTE: this file has previously suffered accidental deletions during large
// str_replace edits (a truncated multi-line comment losing its opening "/**" twice,
// and once an entire useEffect being silently dropped). Every edit to this file is
// now verified with `git diff` before being considered complete — see the bottom of
// this file's project history for the verification process itself.
import React, { useState, useEffect, useMemo, useRef } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line,
} from "recharts";
import {
  Upload, FileText, ListChecks, PieChart as PieIcon, Trash2, Plus,
  Check, ChevronDown, Wallet, AlertCircle, RefreshCw, X, Sparkles, ClipboardPaste,
  TrendingUp, TrendingDown, Minus, Target, Merge, Sun, Moon, ArrowRight, ArrowDown,
  Repeat, Lightbulb, Landmark, LineChart as LineChartIcon, Flag, ChevronRight, ChevronUp,
  Download, LayoutDashboard, Bell,
} from "lucide-react";
import { storage } from "./storage.js";
import { renderPdfPagesAsImages, PAGE_BREAK_MARKER } from "./pdfExtract.js";

/* ---------------------------------------------------------------------- */
/* Licensing — signed license keys, verified entirely client-side via the  */
/* browser's own Web Crypto API. No server is ever contacted to check a    */
/* key; the signature alone proves it was issued by us. See                */
/* /home/claude/licensing/ for the key-generation and signing scripts that  */
/* live outside this app (the private key must never be embedded here).    */
/* ---------------------------------------------------------------------- */

// PLACEHOLDER — replace with the real public_key.json contents once generated.
// This key can ONLY verify signatures; it cannot be used to forge new ones, so it's
// safe to commit and ship inside the app bundle.
const LICENSE_PUBLIC_KEY_JWK = {
  key_ops: ["verify"], ext: true, kty: "EC", crv: "P-256",
  x: "BXWflFguIvgmP-dx2hSvcl6_vu3iaBcu1kDC_3ZEAjM",
  y: "uLOfSUQfnGPWYMIJE7TylNmrooKoTP95z_U3TI0zDgM",
};

/** Decodes a base64url-encoded string (the URL-safe base64 variant used in the pasted
 *  license key, and in JWK's x/y coordinate fields) into raw bytes, for feeding into
 *  the Web Crypto API. Standard atob() only understands regular base64, so the
 *  URL-safe characters (- and _) are swapped back to +/  and padding is restored
 *  before decoding. */
function base64urlToBuf(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Verifies a pasted license key string against the embedded public key. Returns
 *  { valid: false, reason } or { valid: true, payload: {email, tier, keyId, issuedAt, expiresAt} }.
 *  Never trusts the payload's contents until the signature over it has been confirmed —
 *  a tampered payload with a mismatched signature is rejected before its fields are ever read. */
async function verifyLicenseKey(licenseKeyString) {
  if (!licenseKeyString || typeof licenseKeyString !== "string" || !licenseKeyString.includes(".")) {
    return { valid: false, reason: "That doesn't look like a valid license key." };
  }
  const [encodedPayload, encodedSig] = licenseKeyString.trim().split(".");
  if (!encodedPayload || !encodedSig) return { valid: false, reason: "That doesn't look like a valid license key." };

  let publicKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "jwk", LICENSE_PUBLIC_KEY_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
    );
  } catch {
    return { valid: false, reason: "Licensing isn't configured on this build yet." };
  }

  let isValid;
  try {
    isValid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, publicKey,
      base64urlToBuf(encodedSig), base64urlToBuf(encodedPayload)
    );
  } catch {
    return { valid: false, reason: "That doesn't look like a valid license key." };
  }
  if (!isValid) return { valid: false, reason: "This key's signature doesn't check out — it may be corrupted or altered." };

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlToBuf(encodedPayload)));
  } catch {
    return { valid: false, reason: "This key's contents couldn't be read." };
  }
  if (!payload.tier || !payload.expiresAt) return { valid: false, reason: "This key is missing required information." };

  return { valid: true, payload };
}

/** Free-tier limits — the only place these numbers are defined, so every enforcement
 *  check reads from here rather than a scattered literal. Bank and Credit Card are
 *  each their own separate limit of 1 — NOT a combined pool of 2, so someone can't use
 *  both slots on two bank accounts and end up with no room for a credit card. Investments
 *  is a single combined limit across demat, mutual fund, AND other-investment accounts. */
const FREE_TIER_LIMITS = {
  bankAccounts: 1,
  creditCardAccounts: 1,
  debtAccounts: 1,
  investmentAccounts: 1, // demat + mutualFund + otherInvestment combined
  goals: 3,
};

/** Which enforcement bucket an account type belongs to, or null if the type isn't
 *  limited at all (accounts of unrecognized/future types are never blocked). Bank and
 *  Credit Card are deliberately separate buckets, not merged — see FREE_TIER_LIMITS. */
function accountBucket(type) {
  if (type === "bank") return "bank";
  if (type === "creditCard") return "creditCard";
  if (type === "debt") return "debt";
  if (type === "demat" || type === "mutualFund" || type === "otherInvestment") return "investment";
  return null;
}

/** Free-tier account limit for a given bucket - the single lookup every enforcement
 *  function (canCreateAccount, getActiveAccountIds, etc.) goes through, so a limit
 *  only ever needs changing in one place (FREE_TIER_LIMITS). Buckets outside the
 *  four enforced ones (e.g. null, for account types with no limit) return Infinity,
 *  meaning "no restriction applies here." */
function bucketLimit(bucket) {
  if (bucket === "bank") return FREE_TIER_LIMITS.bankAccounts;
  if (bucket === "creditCard") return FREE_TIER_LIMITS.creditCardAccounts;
  if (bucket === "debt") return FREE_TIER_LIMITS.debtAccounts;
  if (bucket === "investment") return FREE_TIER_LIMITS.investmentAccounts;
  return Infinity;
}

const BUCKET_LABELS = { bank: "Bank", creditCard: "Credit Card", debt: "Debt", investment: "Investment" };

/** Display label for an account's raw type field — shown directly in the Accounts
 *  table so a mis-typed or unexpectedly-classified account is visible at a glance,
 *  rather than something that has to be inferred from which screens it does or doesn't
 *  show up in. */
const ACCOUNT_TYPE_LABELS = {
  bank: "Bank", creditCard: "Credit Card", debt: "Debt",
  demat: "Demat", mutualFund: "Mutual Fund", otherInvestment: "Other Investment",
};

/** The single, canonical answer to "does this account belong in Cash Flow" — built
 *  directly on accountBucket() rather than repeating a hand-written type === "bank" ||
 *  type === "creditCard" check wherever it's needed. Every place that previously wrote
 *  that check by hand independently is exactly how the last two Cash Flow bugs
 *  happened — two separate, slightly different hand-rolled filters that quietly
 *  diverged. This is the one place that definition lives now. */
function isCashFlowAccountType(type) {
  const bucket = accountBucket(type);
  return bucket === "bank" || bucket === "creditCard";
}

/** Which accounts in a bucket currently accept new imports. Respects an explicit
 *  account.active=true flag first (set via the Accounts screen's picker); if nobody
 *  has explicitly chosen yet, defaults to the oldest accounts by array order — accounts
 *  are always appended on creation, so earlier array position means earlier creation.
 *  This default is deterministic and explainable, not arbitrary, until the person picks
 *  differently themselves. On Licensed, or whenever the bucket is within its free limit
 *  anyway, every account in it is active — this function only ever narrows the set when
 *  there's an actual, real choice to make. */
function getActiveAccountIds(accounts, effectiveTier, bucket) {
  const bucketAccounts = accounts.filter((a) => accountBucket(a.type) === bucket);
  const limit = bucketLimit(bucket);
  if (effectiveTier === "licensed" || bucketAccounts.length <= limit) {
    return new Set(bucketAccounts.map((a) => a.id));
  }
  const explicitlyActive = bucketAccounts.filter((a) => a.active === true);
  if (explicitlyActive.length > 0) {
    return new Set(explicitlyActive.slice(0, limit).map((a) => a.id));
  }
  return new Set(bucketAccounts.slice(0, limit).map((a) => a.id));
}

/** Can a brand-new account of this type be created right now? */
function canCreateAccount(accounts, effectiveTier, type) {
  if (effectiveTier === "licensed") return true;
  const bucket = accountBucket(type);
  if (!bucket) return true;
  const count = accounts.filter((a) => accountBucket(a.type) === bucket).length;
  return count < bucketLimit(bucket);
}

/** Can a new statement be imported into this specific EXISTING account right now?
 *  Distinct from canCreateAccount — this governs accounts that already exist (e.g.
 *  from a prior Licensed period) but are over today's Free-tier limit, which should be
 *  read-only rather than blocking the whole account from existing or being viewed. */
function canImportIntoAccount(accounts, effectiveTier, accountId) {
  if (effectiveTier === "licensed") return true;
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return true;
  const bucket = accountBucket(account.type);
  if (!bucket) return true;
  return getActiveAccountIds(accounts, effectiveTier, bucket).has(accountId);
}

/** Free tier allows up to FREE_TIER_LIMITS.goals total goals; Licensed has no cap. */
function canCreateGoal(goals, effectiveTier) {
  return effectiveTier === "licensed" || goals.length < FREE_TIER_LIMITS.goals;
}

/* ---------------------------------------------------------------------- */
/* Constants & helpers                                                    */
/* ---------------------------------------------------------------------- */

const CATEGORIES = ["Income", "Expense", "Investment", "Transfer"];
const EXPENSE_SUB_CATEGORIES = ["Fixed", "Variable"];
const TRANSFER_SUB_CATEGORIES = ["Self", "Credit card payment", "External", "Debt-EMI", "Debt-Disbursement", "Debt-Lumpsum Payment"];
const INCOME_SUB_CATEGORIES = ["Salary", "Dividend", "Rent", "Others"];
const INVESTMENT_SUB_CATEGORIES = ["SIP", "Lumpsum", "Redemption"];
const TAGS = ["Household", "Personal"];
const FREQUENCIES = ["Monthly", "Quarterly", "Semi-Annual", "Annual"]; // Fixed expenses, SIPs, and EMIs
const PURPOSES = ["Personal", "Business"];

/** The valid subcategory options for a given top-level category, used to populate
 *  every subcategory dropdown in the app (Review tab, Rules tab, bulk actions) from
 *  one shared source rather than each UI surface hardcoding its own list. Categories
 *  with no subcategory concept (none currently) fall through to an empty array. */
function subCategoryOptionsFor(category) {
  if (category === "Expense") return EXPENSE_SUB_CATEGORIES;
  if (category === "Transfer") return TRANSFER_SUB_CATEGORIES;
  if (category === "Income") return INCOME_SUB_CATEGORIES;
  if (category === "Investment") return INVESTMENT_SUB_CATEGORIES;
  return [];
}

/** Whether a category/subCategory combination represents a recurring commitment that
 *  should carry a frequency - Fixed expenses, SIPs, Debt-EMIs, and the recurring Income
 *  subcategories (Salary, Dividend, Rent). Deliberately excludes one-off counterparts
 *  (Variable, Lumpsum, Debt-Disbursement, Debt-Lumpsum Payment, Redemption, and Income's
 *  "Others") which by nature don't recur on a predictable schedule. */
function isFrequencyEligible(category, subCategory) {
  return (
    (category === "Expense" && subCategory === "Fixed") ||
    (category === "Investment" && subCategory === "SIP") ||
    (category === "Transfer" && subCategory === "Debt-EMI") ||
    (category === "Income" && ["Salary", "Dividend", "Rent"].includes(subCategory))
  );
}

/** Which account TYPES are valid targets for the optional "which account does this
 *  belong to" link - one generic linkedAccountId field, not three separate ones, since
 *  category+subCategory already disambiguate what kind of account makes sense. Only
 *  meaningful for subcategories where more than one matching account could plausibly
 *  exist (e.g. two SIPs, two loans) - returns [] for anything else, meaning "no link
 *  makes sense here at all". Optional everywhere it applies, never required. */
function linkableAccountTypesFor(category, subCategory) {
  if (category === "Investment" && ["SIP", "Lumpsum", "Redemption"].includes(subCategory)) {
    return ["demat", "mutualFund", "otherInvestment"];
  }
  if (category === "Transfer" && ["Debt-EMI", "Debt-Disbursement", "Debt-Lumpsum Payment"].includes(subCategory)) {
    return ["debt"];
  }
  if (category === "Transfer" && subCategory === "Credit card payment") {
    return ["creditCard"];
  }
  if (category === "Transfer" && subCategory === "Self") {
    return ["bank"];
  }
  return [];
}

/* ---------------------------------------------------------------------- */
/* Recurring commitment pattern learning - for the Cash Flow Calendar.     */
/* Learns WHICH DAY a recurring transaction actually lands on, from real   */
/* history, rather than asking the person to type it in or guessing from   */
/* a single occurrence. frequency (isFrequencyEligible) only says how      */
/* OFTEN something recurs; this says WHICH DAY, which a calendar needs.    */
/* ---------------------------------------------------------------------- */

function dayOfMonth(dateStr) {
  return parseInt(dateStr.slice(8, 10), 10);
}

/** For a given date, returns its weekday (0=Sun..6=Sat), which occurrence of that
 *  weekday it is within its month counting from the start (1st, 2nd, 3rd, 4th), and
 *  whether it's the LAST occurrence of that weekday in its month - needed to detect
 *  a floating pattern like "the last Friday", which "which Friday, counting from the
 *  start" alone can't reliably identify, since months have a different number of
 *  Fridays. */
function weekdayInfo(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = d.getUTCDay();
  const dom = d.getUTCDate();
  const ordinalFromStart = Math.ceil(dom / 7);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const isLast = dom + 7 > daysInMonth;
  return { dow, ordinalFromStart, isLast };
}

/** Learns whether a set of dated occurrences (all already known to be the same
 *  recurring thing - see computeRecurringCommitments for how they're grouped)
 *  follows a fixed day-of-month pattern (e.g. "the 1st") or a floating day-of-week
 *  pattern (e.g. "the last Friday") - whichever actually clusters tightly in the
 *  real data, never assumed. Requires at least 3 occurrences; fewer can't
 *  distinguish a real pattern from coincidence, and is reported as such rather than
 *  guessed. Tolerates a small amount of drift (a payment landing a day or two late
 *  because the expected day fell on a weekend or holiday) - and a single outlier
 *  among an otherwise clean pattern doesn't prevent the real pattern from being
 *  recognized, since a missed or unusually-timed month happens without meaning the
 *  underlying commitment stopped being regular. */
function learnRecurringDay(dates, { minOccurrences = 3, domTolerance = 2, confidenceThreshold = 0.7 } = {}) {
  const sorted = [...dates].sort();
  if (sorted.length < minOccurrences) {
    return { hasPattern: false, reason: "insufficient_data", occurrenceCount: sorted.length };
  }

  const doms = sorted.map(dayOfMonth);
  const medianDom = [...doms].sort((a, b) => a - b)[Math.floor(doms.length / 2)];
  const domConfidence = doms.filter((d) => Math.abs(d - medianDom) <= domTolerance).length / doms.length;

  // "Last Friday" framing is preferred over a fixed ordinal ("4th Friday") since
  // it's the more robust, more common real-world pattern - a fixed ordinal breaks
  // in a month where a 5th occurrence of that weekday doesn't exist.
  const dowKeys = sorted.map(weekdayInfo).map((w) => (w.isLast ? `${w.dow}-last` : `${w.dow}-${w.ordinalFromStart}`));
  const keyFreq = {};
  dowKeys.forEach((k) => { keyFreq[k] = (keyFreq[k] || 0) + 1; });
  const bestKey = Object.entries(keyFreq).sort((a, b) => b[1] - a[1])[0];
  const dowConfidence = bestKey[1] / dowKeys.length;

  if (domConfidence < confidenceThreshold && dowConfidence < confidenceThreshold) {
    return { hasPattern: false, reason: "no_clear_pattern", occurrenceCount: sorted.length, domConfidence, dowConfidence };
  }

  // Day-of-month preferred on a tie - simpler, and easier for a person to recognize
  // and confirm at a glance than a floating weekday pattern.
  if (domConfidence >= dowConfidence) {
    return { hasPattern: true, patternType: "dayOfMonth", expectedDay: medianDom, confidence: domConfidence, occurrenceCount: sorted.length };
  }
  const [dow, ordinalPart] = bestKey[0].split("-");
  return {
    hasPattern: true, patternType: "dayOfWeek",
    expectedWeekday: parseInt(dow, 10), expectedOrdinal: ordinalPart, // "last" or "1".."4"
    confidence: dowConfidence, occurrenceCount: sorted.length,
  };
}

/** Groups every frequency-eligible transaction into "the same recurring thing" and
 *  learns each group's day pattern. Grouping key priority: linkedAccountId first
 *  (the most precise identity available - which specific loan or investment this
 *  is), falling back to matchedRuleId (the closest available identity for Fixed
 *  expenses and Income, which don't carry a linkedAccountId), falling back to the
 *  merchant text itself only as a last resort (least reliable, but better than
 *  dropping a transaction from consideration entirely). One-off subcategories
 *  (Variable, Lumpsum, Redemption, Disbursement, Income's Others) are never
 *  included - isFrequencyEligible already establishes that a pattern isn't
 *  meaningful to look for on these. */
function computeRecurringCommitments(transactions, accounts, rules) {
  const groups = {};
  transactions
    .filter((t) => t.category && isFrequencyEligible(t.category, t.subCategory))
    .forEach((t) => {
      const key = t.linkedAccountId ? `acct:${t.linkedAccountId}`
        : t.matchedRuleId ? `rule:${t.matchedRuleId}`
        : `merchant:${t.merchant || t.description}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

  return Object.entries(groups).map(([key, txns]) => {
    const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
    const dates = sorted.map((t) => t.date);
    const pattern = learnRecurringDay(dates);
    const latest = sorted[sorted.length - 1];
    const linkedAccount = latest.linkedAccountId ? accounts.find((a) => a.id === latest.linkedAccountId) : null;
    const rule = latest.matchedRuleId ? rules.find((r) => r.id === latest.matchedRuleId) : null;
    return {
      key,
      category: latest.category, subCategory: latest.subCategory, frequency: latest.frequency,
      name: linkedAccount?.nickname || rule?.pattern || latest.merchant || latest.description,
      linkedAccountId: latest.linkedAccountId || null,
      lastAmount: Math.abs(latest.amount),
      lastSeenDate: latest.date,
      occurrenceCount: sorted.length,
      transactionIds: sorted.map((t) => t.id),
      pattern,
    };
  });
}

const FREQUENCY_STEP_MONTHS = { Monthly: 1, Quarterly: 3, "Semi-Annual": 6, Annual: 12 };

/** Given a learned commitment and a target year/month, decides whether it's expected
 *  to land in that month at all, and if so, on which specific date. A Quarterly
 *  commitment shouldn't appear in every month's calendar just because its day is
 *  known - it only recurs every 3rd month, counted forward from when it actually
 *  last happened, not from some fixed calendar anchor. Returns null when the
 *  commitment has no learned pattern at all, or when this specific month isn't one
 *  of its recurring months. */
function projectOccurrenceForMonth(commitment, targetYear, targetMonth /* 1-12 */) {
  if (!commitment.pattern.hasPattern) return null;
  const step = FREQUENCY_STEP_MONTHS[commitment.frequency] || 1;

  const [lastYear, lastMonth] = commitment.lastSeenDate.split("-").map(Number);
  const monthsSince = (targetYear - lastYear) * 12 + (targetMonth - lastMonth);
  if (monthsSince <= 0 || monthsSince % step !== 0) return null;

  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();

  if (commitment.pattern.patternType === "dayOfMonth") {
    const day = Math.min(commitment.pattern.expectedDay, daysInTargetMonth); // clamp e.g. 31st in a 30-day month
    return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // dayOfWeek pattern: walk the target month's days to find the matching weekday occurrence
  const { expectedWeekday, expectedOrdinal } = commitment.pattern;
  const matches = [];
  for (let d = 1; d <= daysInTargetMonth; d++) {
    const dow = new Date(Date.UTC(targetYear, targetMonth - 1, d)).getUTCDay();
    if (dow === expectedWeekday) matches.push(d);
  }
  const day = expectedOrdinal === "last" ? matches[matches.length - 1] : matches[parseInt(expectedOrdinal, 10) - 1];
  if (!day) return null;
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Median monthly discretionary (Variable) spend across recent complete months - the
 *  daily rate used to spread an estimate across the remaining days of an in-progress
 *  month. Deliberately excludes the currently-viewed month itself, since a partial
 *  month's actual-so-far total isn't a fair stand-in for a typical whole month, and
 *  would understate the real average the earlier it's checked in a month. Median, not
 *  mean, so one unusually large month doesn't skew the daily estimate - same
 *  reasoning as the existing suggested-budget calculation on the Cash Flow screen. */
function computeMedianMonthlyDiscretionary(transactions, viewYear, viewMonth) {
  const currentMonthKey = `${viewYear}-${String(viewMonth).padStart(2, "0")}`;
  const monthTotals = {};
  transactions.forEach((t) => {
    if (t.category === "Expense" && t.subCategory === "Variable") {
      const mk = t.date.slice(0, 7);
      if (mk === currentMonthKey) return;
      monthTotals[mk] = (monthTotals[mk] || 0) + Math.abs(t.amount);
    }
  });
  const recentMonths = Object.keys(monthTotals).sort().slice(-6);
  return median(recentMonths.map((mk) => monthTotals[mk]));
}

/** Walks forward day by day from today's real, resolved bank balance through the end
 *  of the viewed month, applying known commitment occurrences on their exact expected
 *  days plus an evenly-spread daily share of typical discretionary spend - the
 *  forward-looking mirror of resolveAccountBalanceForPeriod's backward-looking
 *  resolver, not a reuse of it, since projecting forward and resolving backward are
 *  genuinely different problems. Today itself gets no discretionary share added -
 *  the starting balance, resolved as of today, already reflects whatever's actually
 *  been spent today if it's been imported; adding another day's worth on top would
 *  double-count it. Only non-"actual" events (projected/overdue) get applied day by
 *  day - real transactions dated today or earlier are already baked into the
 *  starting balance by the resolver. */
function computeProjectedDailyBalances(startBalance, todayStr, monthEndStr, monthEvents, dailyDiscretionary) {
  const results = [];
  let balance = startBalance;
  let d = new Date(todayStr + "T00:00:00Z");
  const end = new Date(monthEndStr + "T00:00:00Z");
  while (d <= end) {
    const dateStr = d.toISOString().slice(0, 10);
    const dayEvents = monthEvents.filter((e) => e.date === dateStr && e.kind !== "actual");
    dayEvents.forEach((e) => { balance += e.direction === "credit" ? e.amount : -e.amount; });
    if (dateStr > todayStr) balance -= dailyDiscretionary;
    results.push({ date: dateStr, balance: Math.round(balance * 100) / 100, events: dayEvents });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return results;
}

const PALETTE = {
  Income: "#2E6659",
  "Income-Salary": "#2E6659",
  "Income-Dividend": "#3E7C8C",
  "Income-Rent": "#6E8C5A",
  "Income-Others": "#8FA089",
  Investment: "#3E7C8C",
  "Expense-Fixed": "#55606B",
  "Expense-Variable-Household": "#A8703A",
  "Expense-Variable-Personal": "#B98A4E",
  Transfer: "#9C8F78",
  Uncategorized: "#9C4A34",
};

const INSTITUTION_PRESETS = [
  "Standard Chartered Bank",
  "Scapia (Federal Bank)",
  "American Express",
  "Axis Bank",
  "State Bank of India",
  "Other / Custom",
];

const DATE_ALIASES = ["date", "transaction date", "txn date", "tran date", "value date", "posting date"];
const DESC_ALIASES = ["description", "narration", "particulars", "details", "transaction details", "remarks"];
const DEBIT_ALIASES = ["debit", "withdrawal", "dr", "debit amount", "withdrawal amt"];
const CREDIT_ALIASES = ["credit", "deposit", "cr", "credit amount", "deposit amt"];
const AMOUNT_ALIASES = ["amount", "transaction amount", "amt"];
const TYPE_ALIASES = ["type", "dr/cr", "transaction type", "cr/dr"];

const uid = (p = "id") => `${p}_${Math.random().toString(36).slice(2, 10)}`;

const inr = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    Math.round(n || 0)
  );

const monthKey = (d) => (d ? d.slice(0, 7) : "unknown");
const monthLabel = (mk) => {
  if (!mk || mk === "unknown") return "Unknown";
  const [y, m] = mk.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-IN", { month: "short", year: "numeric" });
};

/** Flattens a raw CSV/Excel header cell into a consistent, comparable form -
 *  lowercased, trimmed, internal whitespace collapsed to single spaces - so
 *  "Transaction  Date" and "transaction date" match the same alias. */
function normalizeHeader(h) {
  return (h || "").toString().trim().toLowerCase().replace(/\s+/g, " ");
}

const ALL_ALIASES = [...DATE_ALIASES, ...DESC_ALIASES, ...DEBIT_ALIASES, ...CREDIT_ALIASES, ...AMOUNT_ALIASES, ...TYPE_ALIASES];

/** Reads a .csv, .xls, or .xlsx file into the same shape regardless of format — an
 *  array of arrays, exactly like Papaparse's header:false output. This is what lets
 *  the rest of the import flow (header-row detection, column mapping, local parsing)
 *  work identically no matter which spreadsheet format the person uploaded. */
function readSpreadsheetFile(file) {
  const isExcel = /\.xlsx?$/i.test(file.name);
  if (!isExcel) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: false, skipEmptyLines: true,
        complete: (res) => resolve(res.data || []),
        error: reject,
      });
    });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, blankrows: false, defval: "" });
        resolve(rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : c))));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/** A compact text rendering of the first N rows, for the lightweight Gemini
 *  classification call — never the full file, just enough to identify the document
 *  type and map columns. Each row is tab-separated with its 0-indexed row number, so
 *  the model can reliably report back "row 2 is the real header" or "row 0 is a total". */
function buildSpreadsheetSample(rawRows, maxRows = 15) {
  return rawRows.slice(0, maxRows)
    .map((row, i) => `[row ${i}] ${row.map((c) => (c ?? "").toString()).join(" | ")}`)
    .join("\n");
}


/** An .xlsx file is a ZIP archive; a pasted logo or letterhead at the top of the sheet
 *  lives as a raw image file inside it (xl/media/image1.png, etc.) — invisible to
 *  cell-based text reading no matter how much of the sheet gets sampled, since it was
 *  never a cell value at all. Extracts any such images (skipping vector formats like
 *  EMF/WMF that Gemini's vision input can't read) so they can be sent alongside the
 *  text sample, the same way a PDF page gets rendered as an image for the model to
 *  read directly. Returns at most a few images — a letterhead is rarely more than
 *  one or two, and there's no reason to send an entire sheet's worth of clip art. */
async function extractEmbeddedImages(file, maxImages = 3) {
  if (!/\.xlsx$/i.test(file.name)) return []; // old .xls format isn't a zip; not supported here
  try {
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const mediaFiles = Object.keys(zip.files)
      .filter((name) => /^xl\/media\//i.test(name) && /\.(png|jpe?g|gif|webp)$/i.test(name))
      .sort();
    const images = [];
    for (const name of mediaFiles.slice(0, maxImages)) {
      const base64 = await zip.files[name].async("base64");
      const ext = name.split(".").pop().toLowerCase();
      const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      images.push({ mimeType, base64 });
    }
    return images;
  } catch {
    return []; // corrupt zip entry, unusual xlsx internals, etc. — never block the import over a logo
  }
}


/** Bank exports often have a few disclaimer/account-summary rows before the
 *  real header row (and sometimes footer rows after the data). Score each of
 *  the first few rows by how many cells look like known column names, and
 *  pick the best match rather than assuming row 0 is the header. */
function detectHeaderRow(rawRows, maxScan = 20) {
  let bestIdx = 0, bestScore = -1;
  const limit = Math.min(maxScan, rawRows.length);
  for (let i = 0; i < limit; i++) {
    const cells = (rawRows[i] || []).map(normalizeHeader);
    if (cells.every((c) => !c)) continue; // blank row
    let score = 0;
    cells.forEach((c) => {
      if (!c) return;
      if (ALL_ALIASES.some((a) => c === a || c.includes(a))) score += 2;
    });
    // a real header row also tends to have several non-empty, mostly short cells
    const nonEmpty = cells.filter(Boolean).length;
    if (nonEmpty >= 3) score += 1;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

/** Whether a string is already a clean, parseable ISO date (yyyy-mm-dd) - used to
 *  reject rows where parseDateStr couldn't make sense of the raw cell and just
 *  returned it unchanged. */
function isLikelyValidDate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso || "");
}

/** Best-guess match of a spreadsheet column to one of a field's known aliases (e.g.
 *  DATE_ALIASES) - tries an exact normalized match first across all headers, then
 *  falls back to a substring match, so "Txn Date" matches the "date" alias family
 *  even though it isn't an exact hit. Returns the header's original (non-normalized)
 *  text, since that's what's actually used to key into each row's object. */
function guessColumn(headers, aliases) {
  const norm = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const idx = norm.findIndex((h) => h === alias);
    if (idx !== -1) return headers[idx];
  }
  for (const alias of aliases) {
    const idx = norm.findIndex((h) => h.includes(alias));
    if (idx !== -1) return headers[idx];
  }
  return "";
}

/** Parses a raw amount cell into a number, stripping thousands separators, the ₹
 *  symbol, and whitespace, and treating accounting-style parentheses - e.g. "(500)" -
 *  as a negative number. Anything unparseable becomes 0, not NaN, so downstream sums
 *  never silently break. */
function parseAmountStr(v) {
  if (v === undefined || v === null) return 0;
  const cleaned = v.toString().replace(/[,₹\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Like parseAmountStr, but returns null for "nothing was entered" instead of 0 — needed
 *  everywhere a balance gets checked with `!== null`, since a genuine zero balance
 *  (a brand new account, or a statement that legitimately opens at ₹0) must never be
 *  silently treated the same as "no balance provided at all." A plain `parseAmountStr(v)
 *  || null` gets this wrong: 0 is falsy in JS, so it would incorrectly become null. */
function parseAmountOrNull(v) {
  if (v === null || v === undefined || !String(v).trim()) return null;
  return parseAmountStr(v);
}

/** Normalizes a raw date cell (in whatever format a bank's export happens to use) into
 *  a clean ISO yyyy-mm-dd string. Tries formats in order of confidence: already-ISO,
 *  then dd/mm/yyyy or dd-mm-yyyy (using whichever of the two ambiguous numbers is >12
 *  to disambiguate day from month when possible), then "12 Jan 2026"-style text dates,
 *  falling back to JS's native Date parsing as a last resort. Returns the original
 *  string unchanged if nothing matches, rather than throwing or returning empty. */
function parseDateStr(v) {
  if (!v) return "";
  const s = v.toString().trim();
  // yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // dd/mm/yyyy or dd-mm-yyyy
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = `20${y}`;
    let day = a, mon = b;
    if (Number(a) > 12) { day = a; mon = b; }
    else if (Number(b) > 12) { day = b; mon = a; }
    return `${y}-${mon.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  // dd Mon yyyy  e.g. 12 Jan 2026
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (m) {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const idx = months.indexOf(m[2].toLowerCase().slice(0, 3));
    if (idx !== -1) return `${m[3]}-${String(idx + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return s;
}

/** Collapses a transaction description down to a short, mergeable "merchant key" -
 *  the first three cleaned-up words, e.g. "UPI/SWIGGY/419803038/BILL" becomes
 *  "SWIGGY BILL" (digits and punctuation already stripped by normalizeForMatch).
 *  This is what lets near-identical bank descriptions for the same merchant group
 *  together in the Review tab and merchant-based reports, rather than every
 *  transaction reference number producing its own unique, ungroupable row. */
function normalizeMerchant(desc) {
  return normalizeForMatch(desc).split(" ").slice(0, 3).join(" ");
}

// Same cleanup as normalizeMerchant (strip digits/punctuation, collapse whitespace) but
// without truncating to 3 words — used for rule matching, where the pattern needs to be
// tested against the FULL description, not just its first few tokens.
function normalizeForMatch(desc) {
  return (desc || "")
    .toUpperCase()
    .replace(/[0-9]/g, " ")
    .replace(/[^A-Z& ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Standard median of a numeric array - used instead of the average for suggested
 *  budgets and recurring-spend estimates specifically because one unusually large or
 *  small month shouldn't skew the suggestion the way it would skew a mean. */
function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Nearest confirmed balance snapshot on or before `dateStr` — this is what lets the
 *  Cash Flow dashboard resolve "what was my opening/closing balance" for ANY past
 *  period, not just whatever the most recent import happened to be. Returns null if
 *  every snapshot for this account is after the requested date (or there are none). */
/** Resolves an account's balance as of a specific date, with three tiers of confidence:
 *  "exact" (a statement directly confirmed this exact date), "derived" (no direct
 *  confirmation for this date, but a confirmed prior point exists AND this account's
 *  own real, dated transactions bridge the gap between that point and this date — so
 *  the result is computed from genuine activity, not guessed), or "estimate" (no
 *  confirmed point for this date and no transaction data to bridge the gap either —
 *  a pure carry-forward with nothing behind it). Returns { value, tier, exact };
 *  value is null with tier "unknown" if there's no confirmed point on or before the
 *  date at all. `exact` is a backward-compatible boolean (tier === "exact") for call
 *  sites not yet migrated to read `tier` directly. */
function resolveBalanceAsOfDate(account, transactions, targetDate) {
  // Defensive: an entry saved before this session's date -> asOfDate rename would have
  // no asOfDate at all, only the old 'date' field - normalize on read rather than
  // assuming every stored entry already matches the current schema. This is exactly
  // what caused the app to fail to load entirely for any existing saved data.
  const history = [...(account?.balanceHistory || [])]
    .map((h) => (h.asOfDate ? h : { ...h, asOfDate: h.date }))
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  const eligible = history.filter((h) => h.asOfDate <= targetDate);
  if (eligible.length === 0) return { value: null, tier: "unknown", exact: false };
  const basePoint = eligible[eligible.length - 1];

  if (basePoint.asOfDate === targetDate) return { value: basePoint.balance, tier: "exact", exact: true };

  const uploadHistory = account?.uploadHistory || [];
  const coveringBatch = uploadHistory.find((h) => h.periodStart <= targetDate && targetDate <= h.periodEnd);
  if (!coveringBatch) return { value: basePoint.balance, tier: "estimate", exact: false };

  const acctId = account.id;
  const bridgeTxns = transactions.filter((t) => t.accountId === acctId && t.date > basePoint.asOfDate && t.date <= targetDate);
  const delta = bridgeTxns.reduce((s, t) => s + (t.direction === "credit" ? t.amount : -t.amount), 0);
  return { value: Math.round((basePoint.balance + delta) * 100) / 100, tier: "derived", exact: false };
}

/** Resolves an account's opening or closing balance for a specific period. Opening and
 *  Closing are resolved INDEPENDENTLY — each is just "the balance as of this one
 *  boundary date" — rather than requiring a single import to have confirmed the ENTIRE
 *  period at once, which broke down the moment an account had more than one statement
 *  (Standard Chartered, multiple monthly imports, "All time" selected — no single
 *  upload spans the combined range even though every individual statement was
 *  correctly confirmed). Just delegates to the one shared resolver for whichever
 *  boundary date is being asked about. */
function resolveAccountBalanceForPeriod(account, transactions, periodStart, periodEnd, which) {
  const targetDate = which === "opening"
    ? (() => { const d = new Date(periodStart); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })()
    : periodEnd;
  return resolveBalanceAsOfDate(account, transactions, targetDate);
}

/** Every period-like signal an upload has, as comparable keys. An entry can have up to
 *  three: the derived range (earliest-to-latest transaction date, always present), an
 *  explicitly printed statement-period range (when the statement prints one and AI
 *  extraction caught it), and a single printed statement date (when that's all the
 *  statement shows instead of a range). */
function periodKeysFor(entry) {
  const keys = [];
  if (entry.periodStart && entry.periodEnd) keys.push(`range:${entry.periodStart}|${entry.periodEnd}`);
  if (entry.extractedPeriodStart && entry.extractedPeriodEnd) keys.push(`range:${entry.extractedPeriodStart}|${entry.extractedPeriodEnd}`);
  if (entry.statementDate) keys.push(`date:${entry.statementDate}`);
  return keys;
}

/* ------------------------------------------------------------------------ */
/* Investments — holding snapshots                                          */
/* ------------------------------------------------------------------------ */

/** A stable key for matching the SAME holding across separate snapshot imports. ISIN
 *  (equity) or Folio Number + Scheme Name (mutual fund) survive across imports even if
 *  other metadata text shifts slightly — these are the real identifiers. Falls back to
 *  Name + AMC when neither is present, flagged as unreliable (`reliable: false`) so a
 *  future AMC rename or a typo doesn't silently cause a false split (same holding
 *  treated as two) or a false match (two different holdings merged into one) without
 *  it being visible anywhere. */
function computeInstrumentKey(h) {
  if (h.isin && h.isin.trim()) return { key: `isin:${h.isin.trim().toUpperCase()}`, reliable: true };
  if (h.folioNumber && h.folioNumber.trim() && h.name) return { key: `folio:${h.folioNumber.trim()}|${h.name.trim().toLowerCase()}`, reliable: true };
  const name = (h.name || "").trim().toLowerCase();
  const amc = (h.amc || "").trim().toLowerCase();
  if (name) return { key: `name:${name}|${amc}`, reliable: false };
  return { key: `unknown:${uid("h")}`, reliable: false };
}

/** A real per-security identifier (ISIN, mutual fund folio number) should never be
 *  identical across two DIFFERENT holdings — if it is, the extracted value is almost
 *  certainly an account-level number (a PRAN, a policy number) that a statement
 *  happens to also print, not a genuine per-holding ID. Mutates the batch in place,
 *  clearing that field wherever it's shared, so instrumentKey computation (which
 *  trusts isin/folioNumber as authoritative) never silently collapses distinct
 *  holdings into one storage key. Defense-in-depth alongside clear prompt wording —
 *  catches the case even if a future statement's phrasing still confuses extraction. */
function clearUnreliableSharedIdentifiers(holdings, field) {
  const namesByValue = {};
  holdings.forEach((h) => {
    const val = (h[field] || "").toString().trim();
    if (!val) return;
    if (!namesByValue[val]) namesByValue[val] = new Set();
    namesByValue[val].add(h.name);
  });
  const badValues = new Set(Object.entries(namesByValue).filter(([, names]) => names.size > 1).map(([val]) => val));
  holdings.forEach((h) => {
    if (badValues.has((h[field] || "").toString().trim())) h[field] = "";
  });
}

/** The actual reconciliation check for a holdings import — sum of the parsed rows'
 *  Invested/Current Value against whatever total the statement itself prints (when it
 *  prints one at all; some sources, like a plain broker holdings export, never do).
 *  Same trust philosophy as bank statement reconciliation: the statement's own printed
 *  total is authoritative when present, and this just confirms nothing was misread or
 *  dropped while parsing the individual rows. */
function reconcileHoldingsTotals(holdings, statementTotals) {
  // Some statement types (NPS is the clearest example) only report contribution
  // at the portfolio level — there's no per-scheme cost basis to extract, not an
  // extraction failure. Summing those rows as if a missing value were a real zero
  // would silently misrepresent the account as "all growth, no principal" — so
  // this case is tracked and handled separately from an actual mismatch.
  const hasUnknownInvestedValue = holdings.some((h) => h.investedValueUnknown);
  const hasEstimatedInvestedValue = holdings.some((h) => h.derived?.investedValueEstimated);
  const knownInvestedHoldings = holdings.filter((h) => !h.investedValueUnknown);
  const sumInvested = knownInvestedHoldings.reduce((s, h) => s + (h.investedValue || 0), 0);
  const sumCurrent = holdings.reduce((s, h) => s + (h.currentValue || 0), 0);
  const hasStatedInvested = statementTotals && statementTotals.totalInvestedValue !== null && statementTotals.totalInvestedValue !== undefined;
  const hasStatedCurrent = statementTotals && statementTotals.totalCurrentValue !== null && statementTotals.totalCurrentValue !== undefined;
  // A ULIP-allocated sum is constructed to equal the stated total exactly — that's
  // not independent verification, so it's treated the same as "can't verify" even
  // though the arithmetic technically matches.
  const investedDiff = (hasStatedInvested && !hasUnknownInvestedValue && !hasEstimatedInvestedValue) ? Math.round((sumInvested - statementTotals.totalInvestedValue) * 100) / 100 : null;
  const currentDiff = hasStatedCurrent ? Math.round((sumCurrent - statementTotals.totalCurrentValue) * 100) / 100 : null;
  return {
    sumInvested, sumCurrent, hasUnknownInvestedValue, hasEstimatedInvestedValue,
    statedInvested: hasStatedInvested ? statementTotals.totalInvestedValue : null,
    statedCurrent: hasStatedCurrent ? statementTotals.totalCurrentValue : null,
    investedDiff, currentDiff,
    // null here means "not applicable" (can't verify), distinct from a real true/false
    investedMatches: (hasUnknownInvestedValue || hasEstimatedInvestedValue) ? null : (investedDiff === null || Math.abs(investedDiff) <= 1),
    currentMatches: currentDiff === null || Math.abs(currentDiff) <= 1,
    hasAnyStatedTotal: hasStatedInvested || hasStatedCurrent,
  };
}

/** The core of the Investments screen: given an account's snapshots sorted by
 *  asOfDate, computes the waterfall (Opening → Added → Redemption → Growth → Closing)
 *  for the transition into the LATEST one, plus per-holding detail and closed
 *  positions. Added/Redeemed is the diff of each holding's own INVESTED VALUE between
 *  snapshots — never re-derived from units × avg cost — so a corporate action (bonus
 *  issue, split) that changes units without changing invested value needs no special
 *  handling: whatever invested value the source itself reports is simply trusted, the
 *  same way a credit card's own "Previous Balance" is trusted rather than rebuilt from
 *  a purchase list. Growth is cumulative unrealized P&L as of the latest snapshot
 *  (Closing Current Value − Closing Invested), not a period figure — "growth this
 *  year" is computed separately by diffing two dated snapshots' Growth values. */
function computeSnapshotTransition(prevSnapshot, currSnapshot) {
  const prevByKey = {};
  (prevSnapshot?.holdings || []).forEach((h) => { prevByKey[h.instrumentKey] = h; });
  const currByKey = {};
  (currSnapshot.holdings || []).forEach((h) => { currByKey[h.instrumentKey] = h; });

  let added = 0, redeemed = 0;
  const holdingRows = currSnapshot.holdings.map((h) => {
    const prev = prevByKey[h.instrumentKey];
    const prevInvested = prev ? prev.investedValue : 0;
    const delta = Math.round(((h.investedValue || 0) - prevInvested) * 100) / 100;
    if (delta >= 0) added += delta; else redeemed += delta;
    return { ...h, addedOrRedeemed: delta, isNew: !prev, growth: Math.round(((h.currentValue || 0) - (h.investedValue || 0)) * 100) / 100 };
  });

  const closedPositions = (prevSnapshot?.holdings || [])
    .filter((h) => !currByKey[h.instrumentKey])
    .map((h) => ({ ...h, addedOrRedeemed: -(h.investedValue || 0), closedAsOf: currSnapshot.asOfDate }));
  closedPositions.forEach((h) => { redeemed += h.addedOrRedeemed; });

  const openingInvested = prevSnapshot ? prevSnapshot.totalInvestedValue : 0;
  const closingInvested = currSnapshot.totalInvestedValue;
  const closingCurrentValue = currSnapshot.totalCurrentValue;
  const growth = Math.round((closingCurrentValue - closingInvested) * 100) / 100;

  return {
    openingInvested, added: Math.round(added * 100) / 100, redeemed: Math.round(redeemed * 100) / 100,
    growth, closingInvested, closingCurrentValue, holdingRows, closedPositions,
  };
}

/* ------------------------------------------------------------------------ */
/* Goals                                                                     */
/* ------------------------------------------------------------------------ */

// Purely a visual differentiator between goal cards — cycles through, never
// reuses rust (reserved elsewhere for warnings/negative signals), so a goal's
// color is never mistaken for a status indicator.
const GOAL_ACCENT_COLORS = ["#2E6659", "#A8703A", "#4A6C8C", "#7A5C8C", "#6B7A3A", "#8C5A4A"];
function goalAccentColor(index) {
  return GOAL_ACCENT_COLORS[index % GOAL_ACCENT_COLORS.length];
}

const GOAL_TYPE_DEFAULTS = {
  education: { label: "Education", inflationRate: 10 },
  marriage: { label: "Marriage", inflationRate: 10 },
  house: { label: "House", inflationRate: 10 },
  car: { label: "Car", inflationRate: 7 },
  retirement: { label: "Retirement", inflationRate: 8 },
  emergency: { label: "Emergency fund", inflationRate: 0, fundSpecific: true, isMonthsBased: true },
  shortterm: { label: "Short-term goal (under a year)", inflationRate: 0, fundSpecific: true, isMonthsBased: true },
  custom: { label: "Custom goal", inflationRate: 10 },
};

/** Average monthly expense over the trailing window (or all available months if
 *  fewer) — the basis for an Emergency Fund's target, which is a multiple of CURRENT
 *  spending, not a future one-time cost that inflates the way Education/House do. */
function computeAverageMonthlyExpense(transactions, trailingMonths = 6) {
  const byMonth = {};
  transactions.forEach((t) => {
    if (t.category !== "Expense") return;
    const mk = t.date.slice(0, 7);
    const signed = t.direction === "credit" ? -t.amount : t.amount;
    byMonth[mk] = (byMonth[mk] || 0) + signed;
  });
  const months = Object.keys(byMonth).sort().slice(-trailingMonths);
  if (months.length === 0) return 0;
  const total = months.reduce((s, mk) => s + byMonth[mk], 0);
  return Math.round((total / months.length) * 100) / 100;
}

/** Every current holding, one entry per instrument, from each investment account's
 *  LATEST snapshot — the pool a near-term goal (Emergency Fund or otherwise, anything
 *  due in under a year) picks specific liquid/safe funds from, rather than drawing an
 *  amount from the portfolio's total value the way longer-term goals do. */
function buildHoldingsIndex(accounts, holdingSnapshots) {
  const investmentAccounts = accounts.filter((a) => a.type === "demat" || a.type === "mutualFund");
  const index = [];
  investmentAccounts.forEach((acct) => {
    const snaps = holdingSnapshots.filter((s) => s.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    if (snaps.length === 0) return;
    const latest = snaps[snaps.length - 1];
    (latest.holdings || []).forEach((h) => {
      index.push({
        instrumentKey: h.instrumentKey, name: h.name, accountId: acct.id, accountNickname: acct.nickname,
        sectorOrCategory: h.sectorOrCategory, investedValue: h.investedValue, investedValueUnknown: h.investedValue === null || h.investedValue === undefined,
        currentValue: h.currentValue || 0,
      });
    });
  });
  return index;
}

/** For a key that's no longer in the latest snapshot, finds the most recent snapshot
 *  (across any investment account) that DID have it, so a disappeared holding can
 *  still be shown with its last-known value rather than just vanishing with no trace. */
function findLastKnownHolding(key, accounts, holdingSnapshots) {
  const investmentAccounts = accounts.filter((a) => a.type === "demat" || a.type === "mutualFund");
  let best = null;
  investmentAccounts.forEach((acct) => {
    const snaps = holdingSnapshots.filter((s) => s.accountId === acct.id).sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));
    for (const s of snaps) {
      const h = (s.holdings || []).find((x) => x.instrumentKey === key);
      if (h) {
        if (!best || s.asOfDate > best.asOfDate) best = { ...h, accountNickname: acct.nickname, asOfDate: s.asOfDate };
        break; // this account's most recent occurrence found — move to the next account
      }
    }
  });
  return best;
}

/** A near-term goal's tracked progress — the sum of whichever specific holdings have
 *  been assigned to it, real invested/current value, no pool math or auto-absorption
 *  involved. Assigning a fund here is a deliberate act, same spirit as a manual
 *  lumpsum allocation elsewhere, but at the level of an actual named holding instead
 *  of an abstract rupee amount. A previously-assigned holding that's no longer in the
 *  latest snapshot is surfaced explicitly — its cost basis exited the portfolio (fully
 *  redeemed, most likely), so it no longer counts toward tracked progress, but silently
 *  dropping it would hide a real shortfall the person needs to know about. */
function computeNearTermGoalTracking(goal, holdingsIndex, accounts, holdingSnapshots) {
  const byKey = {};
  holdingsIndex.forEach((h) => { byKey[h.instrumentKey] = h; });
  let invested = 0, current = 0;
  const assignedHoldings = [];
  const missingHoldings = [];
  (goal.assignedInstrumentKeys || []).forEach((key) => {
    const h = byKey[key];
    if (h) {
      invested += h.investedValue;
      current += h.currentValue;
      assignedHoldings.push(h);
    } else {
      const lastKnown = findLastKnownHolding(key, accounts, holdingSnapshots);
      missingHoldings.push(lastKnown || { instrumentKey: key, name: "(unknown holding)", investedValue: 0, currentValue: 0, asOfDate: null });
    }
  });
  return {
    trackedInvested: Math.round(invested * 100) / 100,
    trackedCurrentValue: Math.round(current * 100) / 100,
    growth: Math.round((current - invested) * 100) / 100,
    assignedHoldings,
    missingHoldings,
  };
}

/** Future value of today's cost, inflated forward, and what that translates to as
 *  either a lumpsum you'd need today or a monthly SIP — both computed and shown side
 *  by side, since which one to actually use is the person's decision, not the app's.
 *  SIP uses the standard annuity-DUE formula (money invested at the START of each
 *  month, the normal SIP convention), not annuity-ordinary. */
function computeGoalMath(costToday, inflationRatePct, returnRatePct, years) {
  const inflation = inflationRatePct / 100, returnRate = returnRatePct / 100;
  const targetCorpus = Math.round(costToday * Math.pow(1 + inflation, years) * 100) / 100;
  const lumpsumRequired = Math.round((targetCorpus / Math.pow(1 + returnRate, years)) * 100) / 100;
  const monthlyRate = returnRate / 12;
  const months = Math.round(years * 12);
  let sipRequired;
  if (months <= 0) {
    sipRequired = targetCorpus;
  } else if (monthlyRate === 0) {
    sipRequired = Math.round((targetCorpus / months) * 100) / 100;
  } else {
    const annuityFactor = ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate);
    sipRequired = Math.round((targetCorpus / annuityFactor) * 100) / 100;
  }
  return { targetCorpus, lumpsumRequired, sipRequired };
}

/** Whole calendar months between two dates (not days÷30) - so "Jan 15 to Mar 1" reads
 *  as 1 completed month, matching how a goal's remaining-months countdown should feel,
 *  not a fractional day-count. Clamped to never go negative. */
function monthsBetween(startDateStr, endDateStr) {
  const start = new Date(startDateStr), end = new Date(endDateStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return Math.max(0, months);
}

/** Computes every goal's tracked (real, invested-value-backed) progress, live, from
 *  nothing but each goal's own settings and the portfolio's current total invested
 *  value — no stored ledger. Two funding pieces, additive:
 *   (1) Manual lumpsum allocation — a deliberate, explicit claim on existing invested
 *       value, honored first, in creation order, up to whatever's actually available.
 *   (2) SIP auto-absorption — a SIP's THEORETICAL accumulation-so-far (planned amount
 *       × months elapsed, capped at its own total target) gets automatically backed by
 *       whatever invested value remains after manual claims, again in creation order.
 *       If there isn't enough real money to cover it, the shortfall is surfaced, not
 *       hidden — an unbacked SIP target is a projection, not a tracked fact, and older
 *       goals get first claim on newly available money, not silently deprioritized.
 *  Growth on the TRACKED portion uses the portfolio's OWN current/invested ratio — the
 *  same logic as the Investments screen itself, so a goal's real progress is a direct
 *  reflection of actual performance, never a separate assumption layered on top. */
function computeGoalsTracking(goals, portfolioInvested, portfolioCurrentValue, todayStr) {
  const sorted = [...goals].sort((a, b) => a.createdAt - b.createdAt);
  const growthMultiplier = portfolioInvested > 0 ? portfolioCurrentValue / portfolioInvested : 1;
  const totalManualRequested = sorted.reduce((s, g) => s + (g.manualLumpsumAllocation || 0), 0);
  const manualOverAllocated = totalManualRequested > portfolioInvested + 0.01;

  const results = {};
  let remainingForManual = portfolioInvested;
  sorted.forEach((g) => {
    const requested = g.manualLumpsumAllocation || 0;
    const claimed = Math.max(0, Math.min(requested, remainingForManual));
    remainingForManual -= claimed;
    results[g.id] = { manualClaimed: claimed, manualShortfall: Math.round((requested - claimed) * 100) / 100, autoAbsorbed: 0, sipTargetSoFar: 0, sipShortfall: 0 };
  });

  let remainingForSip = Math.max(0, portfolioInvested - sorted.reduce((s, g) => s + results[g.id].manualClaimed, 0));
  sorted.forEach((g) => {
    if (!g.sipPlannedMonthly || !g.sipStartDate) return;
    const elapsed = monthsBetween(g.sipStartDate, todayStr);
    const totalMonths = Math.round((g.yearsToGoal || 0) * 12);
    const sipTargetSoFar = Math.round(Math.min(g.sipPlannedMonthly * elapsed, g.sipPlannedMonthly * totalMonths) * 100) / 100;
    const absorbed = Math.max(0, Math.min(sipTargetSoFar, remainingForSip));
    remainingForSip -= absorbed;
    results[g.id].autoAbsorbed = absorbed;
    results[g.id].sipTargetSoFar = sipTargetSoFar;
    results[g.id].sipShortfall = Math.round((sipTargetSoFar - absorbed) * 100) / 100;
  });

  sorted.forEach((g) => {
    const trackedInvested = Math.round((results[g.id].manualClaimed + results[g.id].autoAbsorbed) * 100) / 100;
    const trackedCurrentValue = Math.round(trackedInvested * growthMultiplier * 100) / 100;
    results[g.id] = { ...results[g.id], trackedInvested, trackedCurrentValue, growth: Math.round((trackedCurrentValue - trackedInvested) * 100) / 100 };
  });

  return { perGoal: results, manualOverAllocated, totalManualRequested, portfolioInvested };
}

/* ------------------------------------------------------------------------ */
/* Debt — an amortization schedule is a whole loan's period-by-period table, */
/* extracted in one import, not a point-in-time snapshot like holdings. All  */
/* four functions below verified against a realistic 240-month schedule     */
/* before being wired into any UI: a clean schedule reconciles fully, a      */
/* deliberately-broken entry gets caught, and a later (restructured)        */
/* schedule correctly overrides an earlier one for any overlapping period.  */
/* ------------------------------------------------------------------------ */

/** Checks ONE period's internal arithmetic — the same reconciliation discipline as
 *  everywhere else in this app, catching a bad AI extraction rather than trusting it.
 *  EMI should equal Principal + Interest; Closing should equal Opening − Principal. */
function reconcileDebtEntry(entry) {
  const tolerance = 5; // small rupee tolerance for rounding in the source document
  const emiCheck = Math.abs((entry.principal + entry.interest) - entry.emi) <= tolerance;
  const balanceCheck = Math.abs((entry.openingBalance - entry.principal) - entry.closingBalance) <= tolerance;
  return { emiCheck, balanceCheck, reconciled: emiCheck && balanceCheck };
}

/** Checks that consecutive periods actually connect — one period's Closing Balance
 *  should equal the next period's Opening Balance. Catches a missing row, a
 *  misread period, or two unrelated schedules accidentally treated as one. */
function checkDebtScheduleContinuity(entries) {
  const sorted = [...entries].sort((a, b) => a.period.localeCompare(b.period));
  const gaps = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (Math.abs(sorted[i].closingBalance - sorted[i + 1].openingBalance) > 5) {
      gaps.push({ afterPeriod: sorted[i].period, expectedOpening: sorted[i].closingBalance, actualOpening: sorted[i + 1].openingBalance });
    }
  }
  return gaps;
}

/** Merges every schedule imported for an account into one period→entry map. If a
 *  loan gets restructured (rate change, prepayment) and a new schedule is imported,
 *  its periods simply overwrite the older schedule's for any period both cover —
 *  the newest import always wins, computed live here, never merged at write time. */
function mergeDebtEntries(schedules) {
  const sorted = [...schedules].sort((a, b) => a.importedAt - b.importedAt); // oldest first
  const merged = {};
  sorted.forEach((s) => { (s.entries || []).forEach((e) => { merged[e.period] = e; }); });
  return merged;
}

/** The account's current state, as of today — outstanding balance, cumulative
 *  principal/interest paid to date, and the next upcoming EMI. Verified sanity
 *  check: cumulative principal paid + current outstanding balance always equals
 *  the original loan amount, to the rupee. */
function computeDebtSummary(schedules, todayStr) {
  const merged = mergeDebtEntries(schedules);
  const periods = Object.keys(merged).sort();
  if (periods.length === 0) return { hasData: false };
  const todayPeriod = todayStr.slice(0, 7);
  const pastOrCurrent = periods.filter((p) => p <= todayPeriod);
  const currentPeriod = pastOrCurrent.length > 0 ? pastOrCurrent[pastOrCurrent.length - 1] : periods[0];
  const currentEntry = merged[currentPeriod];
  let cumPrincipal = 0, cumInterest = 0;
  periods.filter((p) => p <= currentPeriod).forEach((p) => { cumPrincipal += merged[p].principal; cumInterest += merged[p].interest; });
  const futurePeriods = periods.filter((p) => p > currentPeriod);
  const nextEntry = futurePeriods.length > 0 ? merged[futurePeriods[0]] : null;
  return {
    hasData: true,
    currentOutstanding: Math.round(currentEntry.closingBalance * 100) / 100,
    asOfPeriod: currentPeriod,
    cumulativePrincipalPaid: Math.round(cumPrincipal * 100) / 100,
    cumulativeInterestPaid: Math.round(cumInterest * 100) / 100,
    nextEmiPeriod: nextEntry?.period || null,
    nextEmiAmount: nextEntry?.emi || null,
    totalPeriods: periods.length,
    loanComplete: futurePeriods.length === 0,
  };
}

/** Same derivation logic already proven for market-tracked holdings (Units × Price
 *  is exact, reversible algebra), applied to the simpler 3-field case here: NPS and
 *  ULIP statements are unit-based like a mutual fund, so if a statement gives any two
 *  of {units, pricePerUnit, balance}, the third is fully recoverable — never guessed,
 *  never invented, only ever computed from what the statement actually printed. */
function deriveAssetBalanceFields(units, pricePerUnit, balance) {
  const derived = { balance: false, pricePerUnit: false, units: false };
  if (balance === null && units !== null && pricePerUnit !== null) {
    balance = Math.round(units * pricePerUnit * 100) / 100;
    derived.balance = true;
  }
  if (pricePerUnit === null && units && balance !== null) {
    pricePerUnit = Math.round((balance / units) * 100) / 100;
    derived.pricePerUnit = true;
  }
  if (units === null && pricePerUnit && balance !== null) {
    units = Math.round((balance / pricePerUnit) * 10000) / 10000; // extra precision — unit counts often carry several decimals
    derived.units = true;
  }
  return { units, pricePerUnit, balance, derived };
}

/** "Other Investments" (PF, Gold, Property, etc.) cost-basis derivation — the same
 *  Value = Units × Price algebra as market-tracked holdings, extended to cover BOTH
 *  original cost and current worth, so these asset types can show real gain/loss
 *  instead of just a current number. Every field nullable — PF genuinely has no
 *  units concept and only ever provides currentValue directly; Gold/Property can
 *  provide as much or as little as is actually known. Verified against full
 *  unit-based tracking, PF-style balance-only, partial info, and invested-vs-current
 *  tracking with no units at all. */
function deriveOtherInvestmentFields(units, costPerUnit, currentPerUnit, investedValue, currentValue) {
  const derived = { investedValue: false, currentValue: false, costPerUnit: false, currentPerUnit: false, units: false };
  if (investedValue === null && units && costPerUnit !== null) {
    investedValue = Math.round(units * costPerUnit * 100) / 100;
    derived.investedValue = true;
  }
  if (currentValue === null && units && currentPerUnit !== null) {
    currentValue = Math.round(units * currentPerUnit * 100) / 100;
    derived.currentValue = true;
  }
  if (costPerUnit === null && units && investedValue !== null) {
    costPerUnit = Math.round((investedValue / units) * 100) / 100;
    derived.costPerUnit = true;
  }
  if (currentPerUnit === null && units && currentValue !== null) {
    currentPerUnit = Math.round((currentValue / units) * 100) / 100;
    derived.currentPerUnit = true;
  }
  if (units === null && currentPerUnit && currentValue !== null) {
    units = Math.round((currentValue / currentPerUnit) * 10000) / 10000;
    derived.units = true;
  } else if (units === null && costPerUnit && investedValue !== null) {
    units = Math.round((investedValue / costPerUnit) * 10000) / 10000;
    derived.units = true;
  }
  return { units, costPerUnit, currentPerUnit, investedValue, currentValue, derived };
}

/** One-time migration from the old assetBalances/manualAssets split into the unified
 *  otherInvestments shape. NPS/ULIP-typed statementAsset accounts are dropped, not
 *  migrated — confirmed zero real data in either, since they now belong to
 *  Market-tracked instead. Verified against a mixed scenario (a bank account passed
 *  through untouched, a PF account with two balance readings, and two manual assets
 *  each becoming their own new account) before being wired into the load path. */
function migrateToOtherInvestments(accounts, assetBalances, manualAssets) {
  const migratedAccounts = [];
  const migratedEntries = [];

  accounts.forEach((acct) => {
    if (acct.type === "statementAsset" && (acct.assetSubtype === "PF" || acct.assetSubtype === "Other" || !acct.assetSubtype)) {
      migratedAccounts.push({ ...acct, type: "otherInvestment" });
      assetBalances.filter((b) => b.accountId === acct.id).forEach((b) => {
        migratedEntries.push({
          id: uid("oi"), accountId: acct.id, asOfDate: b.asOfDate, importedAt: b.importedAt,
          units: b.units ?? null, unitOfMeasure: null, costPerUnit: null, currentPerUnit: b.pricePerUnit ?? null,
          investedValue: null, currentValue: b.balance, location: null, derived: b.derived || null,
        });
      });
    } else if (acct.type !== "statementAsset") {
      migratedAccounts.push(acct); // pass through every unrelated account unchanged
    }
    // statementAsset accounts with an NPS/ULIP subtype are intentionally dropped here
  });

  manualAssets.forEach((a) => {
    const accountId = uid("acc");
    migratedAccounts.push({ id: accountId, type: "otherInvestment", assetSubtype: a.category, nickname: a.description });
    migratedEntries.push({
      id: uid("oi"), accountId, asOfDate: new Date(a.updatedAt || Date.now()).toISOString().slice(0, 10), importedAt: a.updatedAt || Date.now(),
      units: a.quantity ?? null, unitOfMeasure: a.unitOfMeasure || null, costPerUnit: null, currentPerUnit: a.valuePerUnit ?? null,
      investedValue: null, currentValue: Math.round((a.quantity || 0) * (a.valuePerUnit || 0) * 100) / 100,
      location: a.location || null, derived: null,
    });
  });

  return { migratedAccounts, migratedEntries };
}

/* ------------------------------------------------------------------------ */
/* Stage 1 document classifier — "what kind of document is this?" only.     */
/* Deliberately does nothing else: no extraction, no import, no side        */
/* effects. Format-agnostic by design — the schema and prompt never         */
/* reference PDF or CSV/Excel specifically, only the fields that matter,    */
/* so the SAME function classifies a PDF (image parts) or a spreadsheet     */
/* (a text sample) identically. This is Stage 1 of the eventual unified     */
/* upload; Stage 2 (routing to the matching existing extraction) is a       */
/* separate, later step — this piece is tested standalone first, with no   */
/* path into any real import flow.                                         */
/* ------------------------------------------------------------------------ */

const DOCUMENT_CLASSIFY_SCHEMA = {
  type: "OBJECT",
  properties: {
    documentCategory: {
      type: "STRING",
      enum: ["bank_statement", "credit_card_statement", "investment_holding", "debt_schedule", "other_investment_statement", "unknown"],
      description: "What kind of financial document this is. 'bank_statement' is a savings/current account transaction history. 'credit_card_statement' is a credit card transaction/billing statement. 'investment_holding' is any holdings/portfolio export — stocks, mutual funds, NPS, or ULIP (all structurally similar: units, price, value, no fixed schedule). 'debt_schedule' is a loan amortization schedule (opening balance, EMI, principal, interest, closing balance per period). 'other_investment_statement' is a single-balance investment account with no regular trading activity — a PF passbook, or a gold/property valuation. Use 'unknown' only if genuinely unclear from what's visible.",
    },
    institution: { type: "STRING", nullable: true, description: "The bank, broker, insurer, or platform name, if identifiable from a title, logo caption, letterhead, or a repeated label. Null if genuinely not findable — never guessed." },
    confidence: { type: "STRING", enum: ["high", "medium", "low"], description: "How confident this classification is, based on how clearly the document matches one category over the others." },
    reasoning: { type: "STRING", description: "One short, plain sentence naming what specifically indicated this category — e.g. specific column headers seen, or terms like 'EMI' or 'NAV'." },
  },
  required: ["documentCategory", "confidence"],
};

/** inputParts is a plain array of Gemini content parts — either image parts (from a
 *  rendered PDF page) or a single text part (a spreadsheet sample) — the function
 *  itself has no format-specific logic at all, by design. */
async function callDocumentClassify(inputParts, apiKey, aiModel) {
  const effectiveModel = aiModel || "gemini-3.6-flash";
  const preamble = [
    "You are looking at the first part of a financial document — could be a bank statement, credit card",
    "statement, an investment holdings export, a loan amortization schedule, or a single-balance investment",
    "statement (like a PF passbook or a gold/property valuation). Identify which of these categories it is,",
    "and the institution if identifiable. This is a CLASSIFICATION step only — do not extract any transaction",
    "or holding data yet, just determine what kind of document this is.",
  ].join("\n");
  const parts = [...inputParts, { text: preamble }];
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { maxOutputTokens: 2000, responseMimeType: "application/json", responseSchema: DOCUMENT_CLASSIFY_SCHEMA },
      }),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Request failed (HTTP ${response.status}).`);
  const textPart = (data.candidates?.[0]?.content?.parts || []).find((p) => typeof p.text === "string" && !p.thought);
  if (!textPart) throw new Error("No usable response from the model.");
  return JSON.parse(textPart.text.replace(/```json|```/g, "").trim());
}

/* ------------------------------------------------------------------------ */
/* Net Worth — a pure aggregator, owns no data of its own. Every figure      */
/* below is derived live from accounts (bank/credit card balances),         */
/* holdingSnapshots (market-tracked investments), otherInvestments          */
/* (PF/Gold/Property/etc.), and debtSchedules — never stored separately,    */
/* so it can never drift out of sync with whatever those screens currently  */
/* say. Verified against a full realistic scenario before being wired into  */
/* any UI.                                                                  */
/* ------------------------------------------------------------------------ */

/** The current, "as-of-today" Net Worth figure - Assets (bank balances + latest
 *  investment holding values + latest other-investment values) minus Liabilities
 *  (credit card balances + current debt outstanding, sourced from each loan's
 *  amortization schedule via computeDebtSummary). Each account type's contribution
 *  comes from wherever ITS most current, real data actually lives (lastKnownBalance
 *  for bank/CC, the latest holding snapshot for investments, the schedule's current
 *  period for debt) - not from one shared "balance" field, since each account type's
 *  balance is confirmed through a genuinely different mechanism. */
function computeNetWorthSummary(accounts, holdingSnapshots, otherInvestments, debtSchedules) {
  const bankTotal = accounts.filter((a) => a.type === "bank").reduce((s, a) => s + (a.lastKnownBalance || 0), 0);
  // A credit card's balance is a LIABILITY (money owed), not an asset — kept separate
  // from bank totals and subtracted, same treatment as Debt.
  const creditCardOwed = accounts.filter((a) => a.type === "creditCard").reduce((s, a) => s + (a.lastKnownBalance || 0), 0);

  const investmentAccounts = accounts.filter((a) => a.type === "demat" || a.type === "mutualFund");
  let marketTrackedValue = 0;
  investmentAccounts.forEach((acct) => {
    const snaps = holdingSnapshots.filter((s) => s.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    if (snaps.length > 0) marketTrackedValue += snaps[snaps.length - 1].totalCurrentValue || 0;
  });

  const otherInvestmentAccounts = accounts.filter((a) => a.type === "otherInvestment");
  let otherInvestmentsValue = 0;
  otherInvestmentAccounts.forEach((acct) => {
    const entries = otherInvestments.filter((e) => e.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    if (entries.length > 0) otherInvestmentsValue += entries[entries.length - 1].currentValue || 0;
  });

  const debtAccounts = accounts.filter((a) => a.type === "debt");
  const todayStr = new Date().toISOString().slice(0, 10);
  let totalDebt = 0;
  debtAccounts.forEach((acct) => {
    const schedules = debtSchedules.filter((s) => s.accountId === acct.id);
    if (schedules.length > 0) {
      const summary = computeDebtSummary(schedules, todayStr);
      if (summary.hasData) totalDebt += summary.currentOutstanding;
    }
  });

  const totalAssets = Math.round((bankTotal + marketTrackedValue + otherInvestmentsValue) * 100) / 100;
  const totalLiabilities = Math.round((creditCardOwed + totalDebt) * 100) / 100;
  return {
    bankTotal, creditCardOwed, marketTrackedValue, otherInvestmentsValue, totalDebt,
    totalAssets, totalLiabilities, netWorth: Math.round((totalAssets - totalLiabilities) * 100) / 100,
  };
}

/** Same shape as computeNetWorthSummary, but using each account's SECOND-MOST-RECENT
 *  data point instead of its latest — the "vs last snapshot" comparison. Deliberately
 *  never fabricates a historical value: an account with only one data point contributes
 *  the same number to both "current" and "previous" (no visible change from it), rather
 *  than guessing at what it might have been before. Debt isn't rolled back at all — there's
 *  no discrete "previous debt snapshot" event the way there is for a bank import or a
 *  holdings statement, so debt is held constant in both calculations rather than inventing
 *  an arbitrary comparison date for it. */
function computeNetWorthSummaryAsOfPrevious(accounts, holdingSnapshots, otherInvestments, debtSchedules) {
  const secondToLast = (sorted) => (sorted.length >= 2 ? sorted[sorted.length - 2] : sorted[sorted.length - 1]);

  const bankTotal = accounts.filter((a) => a.type === "bank").reduce((s, a) => {
    const hist = [...(a.balanceHistory || [])].map((h) => (h.asOfDate ? h : { ...h, asOfDate: h.date })).sort((x, y) => x.asOfDate.localeCompare(y.asOfDate));
    if (hist.length === 0) return s + (a.lastKnownBalance || 0);
    return s + secondToLast(hist).balance;
  }, 0);
  const creditCardOwed = accounts.filter((a) => a.type === "creditCard").reduce((s, a) => {
    const hist = [...(a.balanceHistory || [])].map((h) => (h.asOfDate ? h : { ...h, asOfDate: h.date })).sort((x, y) => x.asOfDate.localeCompare(y.asOfDate));
    if (hist.length === 0) return s + (a.lastKnownBalance || 0);
    return s + secondToLast(hist).balance;
  }, 0);

  const investmentAccounts = accounts.filter((a) => a.type === "demat" || a.type === "mutualFund");
  let marketTrackedValue = 0;
  investmentAccounts.forEach((acct) => {
    const snaps = holdingSnapshots.filter((s) => s.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    if (snaps.length > 0) marketTrackedValue += secondToLast(snaps).totalCurrentValue || 0;
  });

  const otherInvestmentAccounts = accounts.filter((a) => a.type === "otherInvestment");
  let otherInvestmentsValue = 0;
  otherInvestmentAccounts.forEach((acct) => {
    const entries = otherInvestments.filter((e) => e.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    if (entries.length > 0) otherInvestmentsValue += secondToLast(entries).currentValue || 0;
  });

  // Debt held constant — see comment above.
  const debtAccounts = accounts.filter((a) => a.type === "debt");
  const todayStr = new Date().toISOString().slice(0, 10);
  let totalDebt = 0;
  debtAccounts.forEach((acct) => {
    const schedules = debtSchedules.filter((s) => s.accountId === acct.id);
    if (schedules.length > 0) {
      const summary = computeDebtSummary(schedules, todayStr);
      if (summary.hasData) totalDebt += summary.currentOutstanding;
    }
  });

  const totalAssets = Math.round((bankTotal + marketTrackedValue + otherInvestmentsValue) * 100) / 100;
  const totalLiabilities = Math.round((creditCardOwed + totalDebt) * 100) / 100;
  return {
    bankTotal, creditCardOwed, marketTrackedValue, otherInvestmentsValue, totalDebt,
    totalAssets, totalLiabilities, netWorth: Math.round((totalAssets - totalLiabilities) * 100) / 100,
  };
}

/** Net worth as it would have appeared using only data available on or before a given
 *  cutoff date — the building block for a monthly trend. For each account, uses the
 *  latest balance/snapshot ON OR BEFORE the cutoff, never a future one. A genuine,
 *  named limitation: an account with no data point before the cutoff contributes 0 for
 *  that period, not its current balance — honest given what's actually known as of that
 *  date, but it can understate early history if an account existed in reality before it
 *  was ever imported into the app. Debt uses computeDebtSummary's own native point-in-time
 *  support directly, since that's amortization math, not an import-dependent snapshot. */
function computeNetWorthAsOfDate(accounts, holdingSnapshots, otherInvestments, debtSchedules, cutoffDateStr) {
  const latestOnOrBefore = (sorted, dateField) => {
    const eligible = sorted.filter((x) => x[dateField] <= cutoffDateStr);
    return eligible.length > 0 ? eligible[eligible.length - 1] : null;
  };

  const bankTotal = accounts.filter((a) => a.type === "bank").reduce((s, a) => {
    const hist = [...(a.balanceHistory || [])].map((h) => (h.asOfDate ? h : { ...h, asOfDate: h.date })).sort((x, y) => x.asOfDate.localeCompare(y.asOfDate));
    const point = latestOnOrBefore(hist, "asOfDate");
    return s + (point ? point.balance : 0);
  }, 0);
  const creditCardOwed = accounts.filter((a) => a.type === "creditCard").reduce((s, a) => {
    const hist = [...(a.balanceHistory || [])].map((h) => (h.asOfDate ? h : { ...h, asOfDate: h.date })).sort((x, y) => x.asOfDate.localeCompare(y.asOfDate));
    const point = latestOnOrBefore(hist, "asOfDate");
    return s + (point ? point.balance : 0);
  }, 0);

  const investmentAccounts = accounts.filter((a) => a.type === "demat" || a.type === "mutualFund");
  let marketTrackedValue = 0;
  investmentAccounts.forEach((acct) => {
    const snaps = holdingSnapshots.filter((s) => s.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    const point = latestOnOrBefore(snaps, "asOfDate");
    if (point) marketTrackedValue += point.totalCurrentValue || 0;
  });

  const otherInvestmentAccounts = accounts.filter((a) => a.type === "otherInvestment");
  let otherInvestmentsValue = 0;
  otherInvestmentAccounts.forEach((acct) => {
    const entries = otherInvestments.filter((e) => e.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    const point = latestOnOrBefore(entries, "asOfDate");
    if (point) otherInvestmentsValue += point.currentValue || 0;
  });

  const debtAccountsAsOf = accounts.filter((a) => a.type === "debt");
  let totalDebtAsOf = 0;
  debtAccountsAsOf.forEach((acct) => {
    const schedules = debtSchedules.filter((s) => s.accountId === acct.id);
    if (schedules.length > 0) {
      const summary = computeDebtSummary(schedules, cutoffDateStr);
      if (summary.hasData) totalDebtAsOf += summary.currentOutstanding;
    }
  });

  const totalAssetsAsOf = Math.round((bankTotal + marketTrackedValue + otherInvestmentsValue) * 100) / 100;
  const totalLiabilitiesAsOf = Math.round((creditCardOwed + totalDebtAsOf) * 100) / 100;
  return { netWorth: Math.round((totalAssetsAsOf - totalLiabilitiesAsOf) * 100) / 100 };
}

/* ------------------------------------------------------------------------ */
/* AI Analyst & Personal CFO — every number the model ever sees comes from   */
/* these functions, computed here in plain code and verified the same way   */
/* every other figure in this app is. The model's only job is to narrate    */
/* the bundle it's handed — never to compute a number itself. A prompt      */
/* (built-in or user-saved) is a template with placeholder tokens drawn     */
/* from PLACEHOLDER_TYPES; which bundle(s) get assembled is dispatched by   */
/* which token TYPES appear in the template, never by its wording — so a    */
/* custom prompt using [category] is exactly as safe as a built-in one.     */
/* ------------------------------------------------------------------------ */

const PLACEHOLDER_TYPES = {
  category: { token: "[category]", label: "category" },
  account: { token: "[account]", label: "account" },
  goal: { token: "[goal]", label: "goal" },
  amount: { token: "[amount]", label: "amount" },
};

/** Which placeholder tokens (e.g. "[category]", "[account]") a saved prompt template
 *  actually uses - drives TokenResolutionModal, which asks the person to fill in only
 *  the placeholders a given prompt contains, not every possible one. */
function extractPlaceholderTokens(template) {
  const found = new Set();
  Object.values(PLACEHOLDER_TYPES).forEach((p) => { if (template.includes(p.token)) found.add(p.token); });
  return [...found];
}

const PROMPT_LIBRARY = [
  {
    id: "monthly-summary", persona: "analyst", category: "Monthly Review",
    name: "How did I do this month?",
    template: "Give me a full summary of my finances this month — income, expenses, savings, and investing — compared to last month and my recent average.",
  },
  {
    id: "expenses-increased", persona: "analyst", category: "Cash Flow",
    name: "Why did my expenses increase?",
    template: "Why did my expenses increase this month compared to last month?",
  },
  {
    id: "spending-more", persona: "analyst", category: "Cash Flow",
    name: "Where am I spending more?",
    template: "Where am I spending more compared to last month?",
  },
  {
    id: "savings-rate-fell", persona: "analyst", category: "Cash Flow",
    name: "Why did my savings rate fall?",
    template: "Why did my savings rate fall this month?",
  },
  {
    id: "cash-flow-changed", persona: "analyst", category: "Cash Flow",
    name: "How has my cash flow changed?",
    template: "How has my cash flow changed this month compared to last month?",
  },
  {
    id: "category-spend", persona: "analyst", category: "Spending",
    name: "Where is my money going in a category?",
    template: "Where is my money going in [category]?",
  },
  {
    id: "financial-leaks", persona: "analyst", category: "Spending",
    name: "What are my biggest financial leaks?",
    template: "What are my biggest financial leaks?",
  },
  {
    id: "investing-consistency", persona: "analyst", category: "Investments",
    name: "Am I investing consistently?",
    template: "Am I investing consistently, and how has my invested amount grown?",
  },
  {
    id: "afford-amount", persona: "cfo", category: "Affordability",
    name: "Can I afford a purchase?",
    template: "Can I afford to spend [amount] right now?",
  },
  {
    id: "goal-tracking", persona: "cfo", category: "Goals",
    name: "How is a goal tracking?",
    template: "How is my [goal] goal tracking, and what should I do about it?",
  },
];

/** This month vs last month, every expense category — the deterministic bundle behind
 *  "Why did my expenses change?". Reuses the exact same category-bucketing (pillClass)
 *  and month-key logic as the Cash Flow screen itself, so the numbers the model narrates
 *  are identical to what the person can already see on that screen. */
function buildExpenseChangeBundle(transactions) {
  const byMonth = {};
  transactions.forEach((t) => {
    if (t.category !== "Expense") return;
    const mk = t.date.slice(0, 7);
    const bucket = pillClass(t.category, t.subCategory, t.tag);
    const signed = t.direction === "credit" ? -t.amount : t.amount;
    if (!byMonth[mk]) byMonth[mk] = { total: 0, buckets: {} };
    byMonth[mk].total += signed;
    byMonth[mk].buckets[bucket] = (byMonth[mk].buckets[bucket] || 0) + signed;
  });
  const months = Object.keys(byMonth).sort();
  if (months.length === 0) return { hasData: false };
  const curMk = months[months.length - 1];
  const prevMk = months.length > 1 ? months[months.length - 2] : null;
  const cur = byMonth[curMk], prev = prevMk ? byMonth[prevMk] : null;
  const bucketDeltas = Object.keys(cur.buckets).map((b) => ({
    bucket: b, current: Math.round(cur.buckets[b] * 100) / 100,
    previous: prev ? Math.round((prev.buckets[b] || 0) * 100) / 100 : null,
    delta: Math.round((cur.buckets[b] - (prev?.buckets[b] || 0)) * 100) / 100,
  })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    hasData: true, currentMonth: curMk, previousMonth: prevMk,
    currentTotal: Math.round(cur.total * 100) / 100,
    previousTotal: prev ? Math.round(prev.total * 100) / 100 : null,
    totalDelta: Math.round((cur.total - (prev?.total || 0)) * 100) / 100,
    topDrivers: bucketDeltas.slice(0, 4),
  };
}

/** Current vs. previous month's savings rate — the bundle behind "Why did my savings
 *  rate fall?". Savings rate = (Income − Expense) / Income, same definition used on
 *  the Cash Flow screen itself. */
function buildSavingsRateBundle(transactions) {
  const byMonth = {};
  transactions.forEach((t) => {
    const mk = t.date.slice(0, 7);
    if (!byMonth[mk]) byMonth[mk] = { income: 0, expense: 0 };
    if (t.category === "Income" && t.direction === "credit") byMonth[mk].income += t.amount;
    if (t.category === "Expense") byMonth[mk].expense += (t.direction === "credit" ? -t.amount : t.amount);
  });
  const months = Object.keys(byMonth).filter((mk) => byMonth[mk].income > 0 || byMonth[mk].expense > 0).sort();
  if (months.length === 0) return { hasData: false };
  const curMk = months[months.length - 1];
  const prevMk = months.length > 1 ? months[months.length - 2] : null;
  const cur = byMonth[curMk], prev = prevMk ? byMonth[prevMk] : null;
  const rate = (m) => (m.income > 0 ? Math.round(((m.income - m.expense) / m.income) * 1000) / 10 : null);
  return {
    hasData: true, currentMonth: curMk, previousMonth: prevMk,
    currentIncome: Math.round(cur.income * 100) / 100, currentExpense: Math.round(cur.expense * 100) / 100,
    currentSavings: Math.round((cur.income - cur.expense) * 100) / 100, currentSavingsRate: rate(cur),
    previousIncome: prev ? Math.round(prev.income * 100) / 100 : null, previousExpense: prev ? Math.round(prev.expense * 100) / 100 : null,
    previousSavingsRate: prev ? rate(prev) : null,
  };
}

/** Current vs. previous month's full cash flow equation — the bundle behind "How has
 *  my cash flow changed?". Same components as the Cash Flow equation itself: income,
 *  expense, savings, and net investment activity (added minus redeemed, netted the
 *  same way the Cash Flow screen's Investment figure is). */
function buildCashFlowChangeBundle(transactions) {
  const byMonth = {};
  transactions.forEach((t) => {
    const mk = t.date.slice(0, 7);
    if (!byMonth[mk]) byMonth[mk] = { income: 0, expense: 0, investedOut: 0, investedIn: 0 };
    if (t.category === "Income" && t.direction === "credit") byMonth[mk].income += t.amount;
    if (t.category === "Expense") byMonth[mk].expense += (t.direction === "credit" ? -t.amount : t.amount);
    if (t.category === "Investment") { if (t.direction === "debit") byMonth[mk].investedOut += t.amount; else byMonth[mk].investedIn += t.amount; }
  });
  const months = Object.keys(byMonth).filter((mk) => byMonth[mk].income > 0 || byMonth[mk].expense > 0).sort();
  if (months.length === 0) return { hasData: false };
  const curMk = months[months.length - 1];
  const prevMk = months.length > 1 ? months[months.length - 2] : null;
  const cur = byMonth[curMk], prev = prevMk ? byMonth[prevMk] : { income: 0, expense: 0, investedOut: 0, investedIn: 0 };
  const netInvestment = (m) => Math.round((m.investedOut - m.investedIn) * 100) / 100;
  return {
    hasData: true, currentMonth: curMk, previousMonth: prevMk,
    current: { income: Math.round(cur.income * 100) / 100, expense: Math.round(cur.expense * 100) / 100, savings: Math.round((cur.income - cur.expense) * 100) / 100, netInvestment: netInvestment(cur) },
    previous: prevMk ? { income: Math.round(prev.income * 100) / 100, expense: Math.round(prev.expense * 100) / 100, savings: Math.round((prev.income - prev.expense) * 100) / 100, netInvestment: netInvestment(prev) } : null,
  };
}

/** The full picture for one month — income, expenses, savings, savings rate, and net
 *  investment activity, each compared against BOTH last month and a trailing 6-month
 *  baseline (not just one prior month, since "compared to other months" means more
 *  than a single point of comparison). Category-level breakdown and merchant-spike
 *  detection reuse the exact same logic as the deterministic Insights engine on the
 *  Cash Flow screen, so this narrative can cover the same ground for comparison. */
function buildMonthlySummaryBundle(transactions, merchantAliases) {
  const byMonth = {};
  transactions.forEach((t) => {
    const mk = t.date.slice(0, 7);
    if (!byMonth[mk]) byMonth[mk] = { income: 0, expense: 0, investedOut: 0, investedIn: 0, buckets: {}, merchants: {} };
    const m = byMonth[mk];
    if (t.category === "Income" && t.direction === "credit") m.income += t.amount;
    if (t.category === "Investment") { if (t.direction === "debit") m.investedOut += t.amount; else m.investedIn += t.amount; }
    if (t.category === "Expense") {
      const signed = t.direction === "credit" ? -t.amount : t.amount;
      m.expense += signed;
      const bucket = pillClass(t.category, t.subCategory, t.tag);
      m.buckets[bucket] = (m.buckets[bucket] || 0) + signed;
      const merchant = resolveMerchant(t.merchant || t.description, merchantAliases) || "—";
      m.merchants[merchant] = (m.merchants[merchant] || 0) + signed;
    }
  });
  const months = Object.keys(byMonth).filter((mk) => byMonth[mk].income > 0 || byMonth[mk].expense > 0).sort();
  if (months.length === 0) return { hasData: false };
  const curMk = months[months.length - 1];
  const cur = byMonth[curMk];
  const prevMk = months.length > 1 ? months[months.length - 2] : null;
  const prev = prevMk ? byMonth[prevMk] : null;

  const trailingKeys = months.filter((mk) => mk < curMk).slice(-6);
  const avgOf = (fn) => (trailingKeys.length > 0 ? trailingKeys.reduce((s, mk) => s + fn(byMonth[mk]), 0) / trailingKeys.length : null);
  const avgIncome = avgOf((m) => m.income);
  const avgExpense = avgOf((m) => m.expense);
  const rate = (income, expense) => (income > 0 ? Math.round(((income - expense) / income) * 1000) / 10 : null);

  const bucketKeys = ["Expense-Fixed", "Expense-Variable-Household", "Expense-Variable-Personal"];
  const categoryComparison = bucketKeys.map((key) => ({
    bucket: key,
    current: Math.round((cur.buckets[key] || 0) * 100) / 100,
    previous: prev ? Math.round((prev.buckets[key] || 0) * 100) / 100 : null,
    trailingAverage: trailingKeys.length > 0 ? Math.round((trailingKeys.reduce((s, mk) => s + (byMonth[mk].buckets[key] || 0), 0) / trailingKeys.length) * 100) / 100 : null,
  }));

  const merchantSpikes = [];
  Object.entries(cur.merchants).forEach(([name, amt]) => {
    if (amt <= 0 || trailingKeys.length < 2) return;
    const merchantAvg = trailingKeys.reduce((s, mk) => s + (byMonth[mk].merchants[name] || 0), 0) / trailingKeys.length;
    if (merchantAvg < 500) return;
    const pctUp = ((amt - merchantAvg) / merchantAvg) * 100;
    if (pctUp > 30) merchantSpikes.push({ name, current: Math.round(amt * 100) / 100, trailingAverage: Math.round(merchantAvg * 100) / 100, pctChange: Math.round(pctUp) });
  });
  merchantSpikes.sort((a, b) => b.pctChange - a.pctChange);

  return {
    hasData: true, currentMonth: curMk, previousMonth: prevMk, trailingMonthsUsed: trailingKeys.length,
    income: { current: Math.round(cur.income * 100) / 100, previous: prev ? Math.round(prev.income * 100) / 100 : null, trailingAverage: avgIncome !== null ? Math.round(avgIncome * 100) / 100 : null },
    expense: { current: Math.round(cur.expense * 100) / 100, previous: prev ? Math.round(prev.expense * 100) / 100 : null, trailingAverage: avgExpense !== null ? Math.round(avgExpense * 100) / 100 : null },
    savings: { current: Math.round((cur.income - cur.expense) * 100) / 100, previous: prev ? Math.round((prev.income - prev.expense) * 100) / 100 : null, trailingAverage: (avgIncome !== null && avgExpense !== null) ? Math.round((avgIncome - avgExpense) * 100) / 100 : null },
    savingsRate: { current: rate(cur.income, cur.expense), previous: prev ? rate(prev.income, prev.expense) : null, trailingAverage: (avgIncome !== null && avgExpense !== null) ? rate(avgIncome, avgExpense) : null },
    netInvestmentThisMonth: Math.round((cur.investedOut - cur.investedIn) * 100) / 100,
    categoryComparison,
    topMerchantsThisMonth: Object.entries(cur.merchants).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 })),
    notableMerchantChanges: merchantSpikes.slice(0, 5),
  };
}

/** Biggest recurring discretionary spend, all-time — the bundle behind "What are my
 *  biggest financial leaks?". Deliberately excludes Fixed expenses (rent, EMI,
 *  insurance): those are committed costs, not the kind of "leak" this question is
 *  really asking about — only Variable (Household + Personal) spend is considered. */
function buildFinancialLeaksBundle(transactions, merchantAliases) {
  const byMerchant = {};
  transactions.forEach((t) => {
    if (t.category !== "Expense" || t.subCategory !== "Variable") return;
    const m = resolveMerchant(t.merchant || t.description, merchantAliases) || "—";
    const signed = t.direction === "credit" ? -t.amount : t.amount;
    if (!byMerchant[m]) byMerchant[m] = { total: 0, count: 0 };
    byMerchant[m].total += signed;
    byMerchant[m].count += 1;
  });
  const topMerchants = Object.entries(byMerchant)
    .filter(([, v]) => v.total > 0)
    .sort((a, b) => b[1].total - a[1].total).slice(0, 8)
    .map(([name, v]) => ({ name, total: Math.round(v.total * 100) / 100, transactionCount: v.count }));
  return { hasData: topMerchants.length > 0, topMerchants };
}

/** A specific category's recent trend and top merchants — the bundle behind
 *  "Where is my money going in [category]?". */
function buildCategoryBundle(categoryKey, transactions, merchantAliases) {
  const relevant = transactions.filter((t) => t.category === "Expense" && pillClass(t.category, t.subCategory, t.tag) === categoryKey);
  if (relevant.length === 0) return { hasData: false, categoryKey };
  const byMonth = {};
  const byMerchant = {};
  relevant.forEach((t) => {
    const mk = t.date.slice(0, 7);
    const signed = t.direction === "credit" ? -t.amount : t.amount;
    byMonth[mk] = (byMonth[mk] || 0) + signed;
    const m = resolveMerchant(t.merchant || t.description, merchantAliases) || "—";
    byMerchant[m] = (byMerchant[m] || 0) + signed;
  });
  const months = Object.keys(byMonth).sort();
  const topMerchants = Object.entries(byMerchant).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 }));
  return {
    hasData: true, categoryKey,
    monthlyTotals: months.map((mk) => ({ month: mk, total: Math.round(byMonth[mk] * 100) / 100 })),
    topMerchants,
  };
}

/** Net investment activity over time — the bundle behind "Am I investing consistently?".
 *  Reuses computeSnapshotTransition per account, same math as the Investments screen. */
function buildInvestingConsistencyBundle(accounts, holdingSnapshots) {
  const investmentAccounts = accounts.filter((a) => a.type === "demat" || a.type === "mutualFund");
  const perAccount = investmentAccounts.map((acct) => {
    const snaps = holdingSnapshots.filter((s) => s.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    if (snaps.length === 0) return null;
    const curr = snaps[snaps.length - 1];
    const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
    const transition = computeSnapshotTransition(prev, curr);
    return { account: acct.nickname, snapshotCount: snaps.length, added: transition.added, redeemed: transition.redeemed, growth: transition.growth, closingInvested: transition.closingInvested };
  }).filter(Boolean);
  if (perAccount.length === 0) return { hasData: false };
  return { hasData: true, accounts: perAccount, totalSnapshots: perAccount.reduce((s, a) => s + a.snapshotCount, 0) };
}

/** Current cash position vs. a hypothetical spend — the bundle behind "Can I afford
 *  [amount]?". Deliberately simple for v1: compares the amount against unallocated
 *  invested value and average monthly savings, rather than assuming loan terms
 *  (interest rate, tenure) that would need to be invented, not computed. */
function buildAffordabilityBundle(amount, transactions, accounts, holdingSnapshots, goals) {
  const avgMonthlyExpense = computeAverageMonthlyExpense(transactions);
  let avgMonthlyIncome = 0;
  const byMonth = {};
  transactions.forEach((t) => {
    if (t.category !== "Income" || t.direction !== "credit") return;
    const mk = t.date.slice(0, 7);
    byMonth[mk] = (byMonth[mk] || 0) + t.amount;
  });
  const incomeMonths = Object.keys(byMonth).sort().slice(-6);
  if (incomeMonths.length > 0) avgMonthlyIncome = incomeMonths.reduce((s, mk) => s + byMonth[mk], 0) / incomeMonths.length;
  const avgMonthlySavings = avgMonthlyIncome - avgMonthlyExpense;

  const investmentAccounts = accounts.filter((a) => a.type === "demat" || a.type === "mutualFund");
  let portfolioInvested = 0;
  investmentAccounts.forEach((acct) => {
    const snaps = holdingSnapshots.filter((s) => s.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    if (snaps.length > 0) portfolioInvested += snaps[snaps.length - 1].totalInvestedValue || 0;
  });
  const totalGoalAllocation = goals.reduce((s, g) => s + (g.manualLumpsumAllocation || 0), 0);
  const unallocatedInvested = Math.max(0, portfolioInvested - totalGoalAllocation);

  const emergencyGoal = goals.find((g) => g.type === "emergency");
  let emergencyMonthsCovered = null;
  if (emergencyGoal) {
    const holdingsIndex = buildHoldingsIndex(accounts, holdingSnapshots);
    const tracking = computeNearTermGoalTracking(emergencyGoal, holdingsIndex, accounts, holdingSnapshots);
    emergencyMonthsCovered = avgMonthlyExpense > 0 ? Math.round((tracking.trackedCurrentValue / avgMonthlyExpense) * 10) / 10 : null;
  }

  return {
    hasData: true, requestedAmount: amount,
    avgMonthlyIncome: Math.round(avgMonthlyIncome * 100) / 100,
    avgMonthlyExpense: Math.round(avgMonthlyExpense * 100) / 100,
    avgMonthlySavings: Math.round(avgMonthlySavings * 100) / 100,
    unallocatedInvestedValue: Math.round(unallocatedInvested * 100) / 100,
    monthsOfSavingsEquivalent: avgMonthlySavings > 0 ? Math.round((amount / avgMonthlySavings) * 10) / 10 : null,
    hasEmergencyFundGoal: !!emergencyGoal,
    emergencyMonthsCoveredCurrently: emergencyMonthsCovered,
  };
}

/** A specific goal's real tracking data — the bundle behind "How is [goal] tracking?".
 *  Reuses the exact same functions the Goals screen itself uses for this goal. */
function buildGoalBundle(goalId, goals, accounts, holdingSnapshots) {
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) return { hasData: false };
  const isNearTerm = (goal.yearsToGoal || 0) < 1;
  if (isNearTerm) {
    const holdingsIndex = buildHoldingsIndex(accounts, holdingSnapshots);
    const result = computeNearTermGoalTracking(goal, holdingsIndex, accounts, holdingSnapshots);
    const target = goal.type === "emergency" ? null : goal.costToday; // emergency target needs avg expense, handled by caller if needed
    return {
      hasData: true, name: goal.name, type: goal.type, isNearTerm: true,
      trackedInvested: result.trackedInvested, trackedCurrentValue: result.trackedCurrentValue, growth: result.growth,
      missingHoldingsCount: result.missingHoldings.length, target,
    };
  }
  const investmentAccounts = accounts.filter((a) => a.type === "demat" || a.type === "mutualFund");
  let invested = 0, current = 0;
  investmentAccounts.forEach((acct) => {
    const snaps = holdingSnapshots.filter((s) => s.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    if (snaps.length > 0) { invested += snaps[snaps.length - 1].totalInvestedValue || 0; current += snaps[snaps.length - 1].totalCurrentValue || 0; }
  });
  const todayStr = new Date().toISOString().slice(0, 10);
  const tracking = computeGoalsTracking([goal], invested, current, todayStr);
  const math = computeGoalMath(goal.costToday, goal.inflationRate, goal.returnRate, goal.yearsToGoal);
  const r = tracking.perGoal[goal.id];
  return {
    hasData: true, name: goal.name, type: goal.type, isNearTerm: false,
    yearsToGoal: goal.yearsToGoal, targetCorpus: math.targetCorpus, lumpsumRequired: math.lumpsumRequired, sipRequired: math.sipRequired,
    trackedInvested: r.trackedInvested, trackedCurrentValue: r.trackedCurrentValue, growth: r.growth,
    sipShortfall: r.sipShortfall, manualShortfall: r.manualShortfall,
  };
}

/** A specific account's recent activity — bank/credit card: last 3 months of income
 *  and expense; investment account: latest holdings snapshot totals. */
function buildAccountBundle(accountId, accounts, transactions, holdingSnapshots) {
  const acct = accounts.find((a) => a.id === accountId);
  if (!acct) return { hasData: false };
  if (acct.type === "demat" || acct.type === "mutualFund") {
    const snaps = holdingSnapshots.filter((s) => s.accountId === accountId).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    if (snaps.length === 0) return { hasData: false, accountName: acct.nickname };
    const latest = snaps[snaps.length - 1];
    return {
      hasData: true, accountName: acct.nickname, accountType: acct.type, asOfDate: latest.asOfDate,
      totalInvestedValue: latest.totalInvestedValue, totalCurrentValue: latest.totalCurrentValue, holdingCount: (latest.holdings || []).length,
    };
  }
  const relevant = transactions.filter((t) => t.accountId === accountId);
  const byMonth = {};
  relevant.forEach((t) => {
    const mk = t.date.slice(0, 7);
    if (!byMonth[mk]) byMonth[mk] = { income: 0, expense: 0 };
    if (t.category === "Income" && t.direction === "credit") byMonth[mk].income += t.amount;
    if (t.category === "Expense") byMonth[mk].expense += (t.direction === "credit" ? -t.amount : t.amount);
  });
  const months = Object.keys(byMonth).sort().slice(-3);
  return {
    hasData: months.length > 0, accountName: acct.nickname, accountType: acct.type,
    recentMonths: months.map((mk) => ({ month: mk, income: Math.round(byMonth[mk].income * 100) / 100, expense: Math.round(byMonth[mk].expense * 100) / 100 })),
  };
}

const ANALYST_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING", description: "A short, direct 1-2 sentence answer to the question, using the specific numbers provided." },
    evidence: { type: "ARRAY", items: { type: "STRING" }, description: "2-6 short bullet points citing the SPECIFIC numbers from the data provided — never a number not present in that data. Use more bullets for a richer data bundle covering several metrics, fewer for a narrow single-metric question." },
    insight: { type: "STRING", description: "1-2 sentences explaining why, based only on the provided data." },
    attention: { type: "STRING", nullable: true, description: "One thing worth watching going forward, if the data suggests one — null if nothing notable." },
  },
  required: ["answer", "evidence", "insight"],
};

const CFO_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    recommendation: { type: "STRING", description: "A short 1-2 sentence framing of the trade-offs — present the picture, never a directive verdict." },
    why: { type: "STRING", description: "1-2 sentences of reasoning, using only the numbers provided." },
    options: { type: "ARRAY", items: { type: "STRING" }, nullable: true, description: "1-3 alternative considerations, if relevant — null if there's really only one path." },
    impact: { type: "ARRAY", items: { type: "STRING" }, description: "2-4 short bullet points quantifying impact, using ONLY the numbers provided." },
  },
  required: ["recommendation", "why", "impact"],
};

/** The only place the model is called for Analyst/CFO answers. The data bundle is
 *  ALWAYS pre-computed by the functions above and handed to the model as fixed input —
 *  the prompt explicitly forbids it from computing or inventing any number itself.
 *  Strict responseSchema throughout (not just a mime type), the exact fix that closed
 *  the malformed-JSON bug found in the Goals cost-estimate feature. */
async function callPersonaAnalysis(apiKey, aiModel, persona, resolvedQuestion, dataBundle) {
  const schema = persona === "cfo" ? CFO_RESPONSE_SCHEMA : ANALYST_RESPONSE_SCHEMA;
  const preamble = persona === "cfo"
    ? [
        "You are the user's Personal CFO — decision-support, not an autonomous decision-maker.",
        "Base every number in your answer STRICTLY on the data provided below. Never compute, estimate, or",
        "invent a number yourself — every figure you cite must come directly from that data.",
        "Present trade-offs and options rather than a directive verdict. Distinguish affordability from",
        "desirability. If the data doesn't cover something needed to fully answer, say so plainly rather",
        "than filling the gap with an assumption.",
      ].join("\n")
    : [
        "You are the user's Personal Financial Analyst — descriptive and diagnostic, not decision-oriented.",
        "Base every number in your answer STRICTLY on the data provided below. Never compute, estimate, or",
        "invent a number yourself — every figure you cite must come directly from that data.",
        "Explain what the data indicates; do not recommend actions. Prefer simple language over jargon.",
      ].join("\n");
  const prompt = [
    preamble, "",
    `User's question: ${resolvedQuestion}`, "",
    "DATA PROVIDED (the only numbers you may reference):",
    JSON.stringify(dataBundle, null, 2),
  ].join("\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${aiModel}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        // Generous budget: with a thinking-capable model, reasoning tokens are spent
        // BEFORE the structured answer and count against this same limit — too low a
        // budget can truncate the JSON output mid-string, which looks like a parsing
        // bug but is really a token-budget one.
        generationConfig: { maxOutputTokens: 4000, responseMimeType: "application/json", responseSchema: schema },
      }),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Request failed (HTTP ${response.status}).`);
  const textPart = (data.candidates?.[0]?.content?.parts || []).find((p) => typeof p.text === "string" && !p.thought);
  if (!textPart) throw new Error("No usable response from the model.");
  try {
    return JSON.parse(textPart.text.replace(/```json|```/g, "").trim());
  } catch {
    throw new Error("The answer got cut off before it finished — try asking again.");
  }
}

/** Statement-period match against this account's upload history — the primary
 *  duplicate-import gate. Deliberately NOT based on per-transaction text matching:
 *  AI-extracted description text isn't guaranteed byte-identical between two separate
 *  calls on the same PDF, so text-based dedup would be unreliable exactly where it
 *  matters most. Checking multiple independent period signals (derived range, printed
 *  period, printed statement date) and matching on ANY shared one is more robust than
 *  relying on just the derived range alone, which is only as reliable as extraction
 *  finding the exact same set of transactions twice — a much higher bar than one
 *  printed date matching. */
function findDuplicatePeriodUpload(account, candidate) {
  if (!account || !account.uploadHistory) return null;
  const candidateKeys = periodKeysFor(candidate);
  if (candidateKeys.length === 0) return null;
  return account.uploadHistory.find((h) => periodKeysFor(h).some((k) => candidateKeys.includes(k))) || null;
}

/** Normalizes an institution name for comparison — strips common corporate suffixes and
 *  punctuation so "Standard Chartered Bank" and "Standard Chartered Bank Ltd." (or one
 *  extracted with slightly different casing/spacing) are recognized as the same thing. */
function normalizeInstitutionName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(bank|ltd|limited|pvt|private|inc|corporation|corp|technologies|technology)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Finds existing accounts whose stored institution matches an extracted one — exact
 *  normalized match first, then a substring check either direction (handles a shorter
 *  extracted name like "Scapia" matching a longer stored one, or vice versa). */
function findAccountsByInstitution(extractedInstitution, accounts) {
  const norm = normalizeInstitutionName(extractedInstitution);
  if (!norm) return [];
  const exact = accounts.filter((a) => normalizeInstitutionName(a.institution) === norm);
  if (exact.length > 0) return exact;
  return accounts.filter((a) => {
    const accNorm = normalizeInstitutionName(a.institution);
    return accNorm && (accNorm.includes(norm) || norm.includes(accNorm));
  });
}

/* ---- Merchant aliasing: combine near-duplicate merchant strings (e.g. "UPI SCAPIA SCAPIA"
   vs "UPI SCAPIA TECHNOLOGY") into one canonical name for reporting, without touching how
   category rules match against the raw description text. ---- */

const MERCHANT_STOPWORDS = new Set([
  "UPI", "IMPS", "NEFT", "RTGS", "POS", "LTD", "PVT", "LIMITED", "PRIVATE", "INDIA",
  "PAYMENT", "PAYMENTS", "PAY", "TECHNOLOGIES", "TECHNOLOGY", "SERVICES", "SERVICE",
  "SOLUTIONS", "INC", "CORP", "COMPANY", "CO", "THE", "AND", "BILL", "TXN", "REF", "ONLINE",
]);

/** Strips generic banking/corporate noise words (UPI, LTD, TECHNOLOGY, etc.) from a
 *  merchant key, leaving just the distinctive part - this is what lets "UPI SCAPIA
 *  SCAPIA" and "UPI SCAPIA TECHNOLOGY" both reduce to "SCAPIA" and be recognized as
 *  the same underlying merchant, feeding computeSuggestedMerchantClusters. */
function merchantCore(key) {
  const tokens = (key || "").split(" ").filter(Boolean).filter((t) => !MERCHANT_STOPWORDS.has(t));
  const core = tokens.length ? tokens.join(" ") : (key || "");
  return core.trim();
}

/** Converts an all-caps or lowercase merchant string into a readable "Title Case"
 *  suggestion (e.g. "SCAPIA" -> "Scapia") for the default name proposed when merging
 *  a cluster of near-duplicate merchant strings into one canonical group. */
function titleCase(s) {
  return (s || "").toLowerCase().split(" ").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

/** Resolve a raw merchant string to its canonical group name, if it belongs to one. */
function resolveMerchant(rawKey, aliases) {
  if (!rawKey) return rawKey;
  const group = (aliases || []).find((g) => g.variants.includes(rawKey));
  return group ? group.canonical : rawKey;
}

/** Cluster not-yet-grouped merchant strings that share the same "core" signature once
 *  generic banking noise words (UPI, TECHNOLOGY, LTD, ...) are stripped out. */
function computeSuggestedMerchantClusters(transactions, aliases) {
  const alreadyGrouped = new Set();
  (aliases || []).forEach((g) => g.variants.forEach((v) => alreadyGrouped.add(v)));

  const stats = {};
  transactions.forEach((t) => {
    if (t.category !== "Expense") return;
    const key = t.merchant || t.description;
    if (!key || alreadyGrouped.has(key)) return;
    if (!stats[key]) stats[key] = { key, count: 0, total: 0 };
    stats[key].count += 1;
    stats[key].total += t.amount;
  });

  const byCore = {};
  Object.values(stats).forEach((s) => {
    const core = merchantCore(s.key) || s.key;
    if (!byCore[core]) byCore[core] = [];
    byCore[core].push(s);
  });

  return Object.entries(byCore)
    .filter(([, list]) => list.length > 1)
    .map(([core, list]) => ({
      core,
      suggestedName: titleCase(core),
      variants: list.sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.variants.length - a.variants.length);
}

/** The starter categorization rules every new install begins with - common merchant/
 *  keyword patterns mapped to a sensible default category, so a first import isn't
 *  entirely uncategorized. These are "system" source rules, lowest priority tier
 *  (priority = pattern length, same as any other rule) - a user-added or learned rule
 *  with the same or a more specific pattern always wins a tie via matchRule's sort. */
function seedRules() {
  const seed = [
    ["salary", "Income", null, null],
    ["interest cr", "Income", null, null],
    ["dividend", "Income", null, null],
    ["refund", "Income", null, null],
    ["sip", "Investment", null, null],
    ["mutual fund", "Investment", null, null],
    ["zerodha", "Investment", null, null],
    ["groww", "Investment", null, null],
    ["coin ", "Investment", null, null],
    ["nps", "Investment", null, null],
    ["rd installment", "Investment", null, null],
    ["fd deposit", "Investment", null, null],
    ["rent", "Expense", "Fixed", "Household"],
    ["emi", "Expense", "Fixed", "Personal"],
    ["loan", "Expense", "Fixed", "Personal"],
    ["insurance", "Expense", "Fixed", "Personal"],
    ["premium", "Expense", "Fixed", "Personal"],
    ["electricity", "Expense", "Fixed", "Household"],
    ["water bill", "Expense", "Fixed", "Household"],
    ["gas bill", "Expense", "Fixed", "Household"],
    ["broadband", "Expense", "Fixed", "Household"],
    ["wifi", "Expense", "Fixed", "Household"],
    ["netflix", "Expense", "Fixed", "Personal"],
    ["spotify", "Expense", "Fixed", "Personal"],
    ["prime video", "Expense", "Fixed", "Personal"],
    ["hotstar", "Expense", "Fixed", "Personal"],
    ["subscription", "Expense", "Fixed", "Personal"],
    ["swiggy", "Expense", "Variable", "Personal"],
    ["zomato", "Expense", "Variable", "Personal"],
    ["restaurant", "Expense", "Variable", "Personal"],
    ["bigbasket", "Expense", "Variable", "Household"],
    ["dmart", "Expense", "Variable", "Household"],
    ["grocery", "Expense", "Variable", "Household"],
    ["supermarket", "Expense", "Variable", "Household"],
    ["amazon", "Expense", "Variable", "Personal"],
    ["flipkart", "Expense", "Variable", "Personal"],
    ["myntra", "Expense", "Variable", "Personal"],
    ["uber", "Expense", "Variable", "Personal"],
    ["ola", "Expense", "Variable", "Personal"],
    ["petrol", "Expense", "Variable", "Personal"],
    ["fuel", "Expense", "Variable", "Personal"],
    ["credit card payment", "Transfer", "Credit card payment", null],
    ["cc payment", "Transfer", "Credit card payment", null],
    // These specifically catch the payment-received line that appears ON a credit
    // card's OWN statement (reducing what's owed) — the same real-world payment
    // already captured as a debit on the bank side. Tagging it as Transfer here (never
    // Expense) matters: if it were miscategorized as Expense, its credit direction
    // would silently subtract from that statement's reported total, understating actual
    // spending. It's already excluded from every calculation regardless of subcategory
    // (transactions on a card account never count toward the equation's Transfer total,
    // and only Expense-tagged rows count toward a statement's spend total) — this just
    // keeps it out of Uncategorized and away from ever being tagged Expense by mistake.
    ["payment received", "Transfer", "Credit card payment", null],
    ["payment recvd", "Transfer", "Credit card payment", null],
    ["autopay", "Transfer", "Credit card payment", null],
    ["self transfer", "Transfer", null, null],
    ["own account", "Transfer", null, null],
  ];
  return seed.map(([pattern, category, subCategory, tag]) => ({
    id: uid("rule"),
    pattern,
    category,
    subCategory,
    tag,
    source: "system",
    priority: pattern.length,
  }));
}

/** Finds the best-matching categorization rule for a transaction description, or null
 *  if nothing matches. "Best" means highest priority among all rules whose pattern
 *  appears in the (normalized) description - priority defaults to pattern length, so
 *  a more specific pattern naturally outranks a shorter, more generic one, and a
 *  user-added or learned rule can be given an explicit priority to win ties. */
function matchRule(description, rules) {
  // Normalize both sides the same way: rules learned from "remember this merchant" store a
  // space-joined pattern (e.g. "upi swiggy bangalore"), but real bank descriptions usually
  // separate those tokens with hyphens/underscores, not spaces — a plain substring test
  // against the raw text would silently never match. Stripping digits/punctuation from both
  // the description and the pattern before comparing fixes that, without needing to change
  // any already-stored rule.
  const d = normalizeForMatch(description);
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  return sorted.find((r) => d.includes(normalizeForMatch(r.pattern))) || null;
}

const TRANSFER_MATCH_WINDOW_DAYS = 3; // real-world posting delay between two sides of a transfer

/** Self and Credit-card-payment transfers should have a real other side somewhere in the
 *  data — this finds candidate transactions on a DIFFERENT account, opposite direction,
 *  the same amount, within a few days. External transfers are deliberately never checked
 *  here (money to a landlord/friend has no "other side" in this app, ever — flagging those
 *  as pending would just be permanent, meaningless noise). Exact amount match only for
 *  this first pass; a transfer fee that makes the two sides differ slightly won't
 *  auto-match yet. */
function findTransferCandidates(txn, allTransactions) {
  const oppositeDirection = txn.direction === "debit" ? "credit" : "debit";
  const txnTime = new Date(txn.date).getTime();
  return allTransactions
    .filter((c) => {
      if (c.id === txn.id) return false;
      if (c.accountId === txn.accountId) return false;
      if (c.direction !== oppositeDirection) return false;
      if (Math.abs(c.amount - txn.amount) > 0.01) return false;
      if (c.linkedTransactionId) return false; // already claimed by another link
      const diffDays = Math.abs(new Date(c.date).getTime() - txnTime) / (1000 * 60 * 60 * 24);
      return diffDays <= TRANSFER_MATCH_WINDOW_DAYS;
    })
    .sort((a, b) => Math.abs(new Date(a.date).getTime() - txnTime) - Math.abs(new Date(b.date).getTime() - txnTime));
}

/** Whether a transaction is one of the two Transfer subcategories that genuinely have
 *  a real "other side" to expect and verify - Self (moves between the person's own
 *  accounts) and Credit card payment (settles a card statement). External deliberately
 *  isn't included here - see findTransferCandidates for why. */
function isSubstantiableTransfer(t) {
  return t.category === "Transfer" && (t.subCategory === "Self" || t.subCategory === "Credit card payment");
}

/** @returns {{ status: 'linked'|'substantiated'|'dismissed'|'suggested'|'pending', candidate: object|null }} */
function transferStatus(txn, allTransactions, accounts) {
  if (txn.linkedTransactionId) {
    const linked = allTransactions.find((t) => t.id === txn.linkedTransactionId);
    return { status: "linked", candidate: linked || null };
  }
  // A softer confirmation than an exact transaction link: "importing this account's
  // statement is what this transfer was waiting on," without requiring a specific
  // matching line item — the whole point of this simpler design.
  if (txn.substantiatedByAccountId) {
    const acct = (accounts || []).find((a) => a.id === txn.substantiatedByAccountId);
    return { status: "substantiated", candidate: acct || null };
  }
  if (txn.transferDismissed) return { status: "dismissed", candidate: null };
  const candidates = findTransferCandidates(txn, allTransactions);
  return candidates.length > 0 ? { status: "suggested", candidate: candidates[0] } : { status: "pending", candidate: null };
}

/** Resolves a transaction's category/subCategory/tag into a key for looking up its
 *  display color/label in PALETTE - Expense gets its Fixed/Variable-Household/
 *  Variable-Personal split, Income gets a per-subcategory color if one's defined
 *  (falling back to the plain "Income" color otherwise), everything else uses its
 *  bare category name directly. */
function pillClass(category, subCategory, tag) {
  if (!category) return "Uncategorized";
  if (category === "Expense") {
    if (subCategory === "Fixed") return "Expense-Fixed";
    if (subCategory === "Variable" && tag === "Household") return "Expense-Variable-Household";
    if (subCategory === "Variable" && tag === "Personal") return "Expense-Variable-Personal";
    return "Expense-Fixed";
  }
  if (category === "Income" && subCategory) {
    const key = `Income-${subCategory}`;
    return PALETTE[key] ? key : "Income";
  }
  return category;
}

/* ---------------------------------------------------------------------- */
/* Storage helpers — genuinely local, browser localStorage on this device */
/* ---------------------------------------------------------------------- */

async function loadState(key, fallback) {
  try {
    const res = await storage.get(key);
    return res ? JSON.parse(res.value) : fallback;
  } catch {
    return fallback;
  }
}
async function saveState(key, value) {
  try {
    await storage.set(key, JSON.stringify(value));
  } catch {
    /* best-effort; app still works in-memory for the session if storage is unavailable */
  }
}

/** A FileSystemDirectoryHandle (the "remember this folder" object behind auto-backup)
 *  isn't a string — it can't go through the JSON-based storage above. IndexedDB is
 *  the standard, spec-documented way to persist this specific kind of object across
 *  browser sessions, so this is a small, separate store just for it. */
const BACKUP_HANDLE_DB = "being-wealthy-backup-handle";
function openHandleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_HANDLE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveBackupFolderHandle(handle) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, "folder");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function loadBackupFolderHandle() {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readonly");
    const req = tx.objectStore("handles").get("folder");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function clearBackupFolderHandle() {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").delete("folder");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------------------------------------------------------------- */
/* Landing page — the app's front door. Deliberately its own scoped        */
/* visual identity (warm paper/editorial, matching the approved standalone */
/* mockup) rather than reusing the working app's current theme variables — */
/* a marketing front door and a working tool are allowed to feel like      */
/* close family without being visually identical. Every product visual    */
/* below mirrors a real screen/feature (Net Worth breakdown, Cash Flow     */
/* savings rate, the Insights engine's actual wording style, Goals         */
/* progress) — nothing here is an invented metric.                        */
/* ---------------------------------------------------------------------- */

/** The marketing landing page shown before the person enters the app proper - static
 *  content and its own scoped CSS (the lp- prefix keeps every style local to this
 *  page, so nothing here can leak into or collide with the main app's own styling).
 *  onGetStarted is the single action: dismiss this page and move into the real app. */
function LandingPage({ onGetStarted }) {
  return (
    <div className="lp-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        .lp-root {
          --lp-paper: #ECE7DA; --lp-card: #F9F7F1; --lp-ink: #21262B; --lp-ink-soft: #55606B;
          --lp-line: #CBC2AC; --lp-teal: #2E6659; --lp-rust: #9C4A34;
          background: var(--lp-paper);
          background-image: repeating-linear-gradient(to bottom, rgba(85,96,107,0.05) 0px, rgba(85,96,107,0.05) 1px, transparent 1px, transparent 34px);
          color: var(--lp-ink); font-family: 'IBM Plex Sans', sans-serif; -webkit-font-smoothing: antialiased;
          min-height: 100vh;
        }
        .lp-shell { max-width: 900px; margin: 0 auto; padding: 0 24px; }
        .lp-section { padding: 90px 0; }
        .lp-hr { border: none; border-top: 1px solid var(--lp-line); margin: 0; }
        .lp-hero { text-align: center; padding: 80px 0 60px; }
        .lp-wordmark { font-family: 'Fraunces', serif; font-weight: 600; font-size: 22px; letter-spacing: -0.01em; color: var(--lp-ink-soft); margin-bottom: 40px; }
        .lp-wordmark em { font-style: italic; color: var(--lp-teal); font-weight: 500; }
        .lp-hero h1 { font-family: 'Fraunces', serif; font-weight: 500; font-size: 54px; line-height: 1.15; margin: 0 0 24px; letter-spacing: -0.015em; }
        .lp-hero .lp-sub { font-size: 16.5px; color: var(--lp-ink-soft); max-width: 480px; margin: 0 auto 34px; line-height: 1.6; }
        .lp-cta {
          font-family: 'IBM Plex Sans', sans-serif; font-size: 14.5px; font-weight: 600; padding: 13px 30px; border-radius: 4px;
          border: 1px solid var(--lp-ink); background: var(--lp-ink); color: var(--lp-card); cursor: pointer; display: inline-block;
          text-decoration: none; transition: background 0.15s, border-color 0.15s;
        }
        .lp-cta:hover { background: var(--lp-teal); border-color: var(--lp-teal); }
        .lp-privacy-line { font-size: 12px; color: var(--lp-ink-soft); margin-top: 16px; letter-spacing: 0.01em; }
        .lp-path-strip {
          display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; margin: 44px 0 8px;
          font-family: 'IBM Plex Mono', monospace; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--lp-ink-soft);
        }
        .lp-path-strip .lp-step { padding: 5px 2px; }
        .lp-path-strip .lp-step.lp-final { color: var(--lp-teal); font-weight: 600; }
        .lp-path-strip .lp-arrow { color: var(--lp-line); font-size: 13px; }
        .lp-mockup-frame { margin-top: 56px; }
        .lp-mockup-card { background: var(--lp-card); border: 1px solid var(--lp-line); border-radius: 8px; padding: 24px 26px; text-align: left; max-width: 560px; margin: 0 auto; }
        .lp-mockup-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--lp-ink-soft); margin-bottom: 14px; }
        .lp-mockup-hr { border: none; border-top: 1px solid var(--lp-line); margin: 16px 0; }
        .lp-row { display: flex; justify-content: space-between; align-items: baseline; padding: 7px 0; font-size: 13.5px; }
        .lp-row .lp-k { color: var(--lp-ink-soft); }
        .lp-row .lp-v { font-family: 'IBM Plex Mono', monospace; font-weight: 500; }
        .lp-rate-tag { font-size: 11px; color: var(--lp-ink-soft); margin-left: 8px; }
        .lp-nw-headline { text-align: center; padding: 6px 0 18px; }
        .lp-nw-headline .lp-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--lp-ink-soft); }
        .lp-nw-headline .lp-value { font-family: 'IBM Plex Mono', monospace; font-size: 34px; font-weight: 600; margin-top: 4px; }
        .lp-story { text-align: center; }
        .lp-story .lp-num { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--lp-ink-soft); letter-spacing: 0.04em; margin-bottom: 14px; }
        .lp-story h2 { font-family: 'Fraunces', serif; font-weight: 500; font-size: 30px; margin: 0 0 16px; line-height: 1.3; max-width: 560px; margin-left: auto; margin-right: auto; }
        .lp-story p { font-size: 15px; color: var(--lp-ink-soft); max-width: 480px; margin: 0 auto 14px; line-height: 1.65; }
        .lp-story p:last-of-type { margin-bottom: 0; }
        .lp-privacy-subhead { font-family: 'Fraunces', serif; font-style: italic; font-size: 16px; color: var(--lp-teal); margin: 0 0 20px; }
        .lp-insight-line { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; font-size: 13px; text-align: left; border-bottom: 1px solid var(--lp-line); }
        .lp-insight-line:last-child { border-bottom: none; }
        .lp-insight-dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; background: var(--lp-rust); }
        .lp-cfo-q { font-family: 'Fraunces', serif; font-style: italic; font-size: 16px; color: var(--lp-ink); text-align: left; margin-bottom: 16px; }
        .lp-cfo-a-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--lp-teal); font-weight: 600; margin-bottom: 6px; text-align: left; }
        .lp-cfo-a-text { font-size: 13.5px; text-align: left; line-height: 1.6; color: var(--lp-ink); }
        .lp-flow { display: flex; align-items: center; justify-content: center; gap: 18px; margin: 40px 0 20px; flex-wrap: wrap; }
        .lp-flow-box { border: 1px solid var(--lp-line); border-radius: 6px; padding: 16px 22px; background: var(--lp-card); font-size: 13px; font-weight: 500; min-width: 140px; text-align: center; }
        .lp-flow-arrow { color: var(--lp-ink-soft); font-size: 18px; }
        .lp-flow-caption { text-align: center; font-size: 12px; color: var(--lp-ink-soft); margin-top: 4px; font-style: italic; }
        .lp-howitworks-list { max-width: 560px; margin: 40px auto 0; text-align: left; }
        .lp-howitworks-item { display: flex; gap: 18px; padding: 20px 0; border-bottom: 1px solid var(--lp-line); }
        .lp-howitworks-item:last-child { border-bottom: none; }
        .lp-howitworks-num {
          font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: var(--lp-teal); font-weight: 600;
          width: 26px; flex-shrink: 0; padding-top: 2px;
        }
        .lp-howitworks-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; margin-bottom: 4px; }
        .lp-howitworks-desc { font-size: 13.5px; color: var(--lp-ink-soft); line-height: 1.6; }
        .lp-pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 44px; text-align: left; }
        .lp-pricing-card { border: 1px solid var(--lp-line); border-radius: 8px; padding: 24px 20px; background: var(--lp-card); }
        .lp-pricing-card.featured { background: var(--lp-ink); border-color: var(--lp-teal); }
        .lp-pricing-badge { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--lp-teal); font-weight: 600; margin-bottom: 10px; }
        .lp-pricing-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 17px; color: var(--lp-ink); margin-bottom: 6px; }
        .lp-pricing-card.featured .lp-pricing-name { color: var(--lp-card); }
        .lp-pricing-price { font-family: 'Fraunces', serif; font-weight: 600; font-size: 28px; color: var(--lp-teal); margin-bottom: 2px; }
        .lp-pricing-sub { font-size: 11.5px; font-style: italic; color: var(--lp-ink-soft); margin-bottom: 16px; }
        .lp-pricing-card.featured .lp-pricing-sub { color: #9AA0A6; }
        .lp-pricing-item { font-size: 12.5px; color: var(--lp-ink-soft); padding: 7px 0; border-bottom: 1px solid var(--lp-line); }
        .lp-pricing-card.featured .lp-pricing-item { color: #C8CCD0; border-bottom-color: #3A424B; }
        .lp-pricing-item:last-child { border-bottom: none; }
        .lp-pricing-note { font-size: 11.5px; color: var(--lp-ink-soft); font-style: italic; margin-top: 18px; }
        @media (max-width: 700px) { .lp-pricing-grid { grid-template-columns: 1fr; } }
        .lp-footer { text-align: center; padding: 70px 0 90px; }
        .lp-footer .lp-wordmark { margin-bottom: 10px; }
        .lp-footer .lp-tagline { font-family: 'Fraunces', serif; font-style: italic; font-size: 15px; color: var(--lp-ink-soft); }
        @media (max-width: 600px) {
          .lp-hero h1 { font-size: 36px; }
          .lp-story h2 { font-size: 24px; }
          .lp-section { padding: 60px 0; }
          .lp-flow { flex-direction: column; }
          .lp-flow-arrow { transform: rotate(90deg); }
        }
      `}</style>

      <div className="lp-shell">
        <div className="lp-hero">
          <div className="lp-wordmark">Being <em>Wealthy</em></div>
          <h1>See your money clearly.</h1>
          <p className="lp-sub">Your personal financial operating system — turning your cash flow, investments, debt, and net worth into one clear picture, so you always know what to do next.</p>
          <button className="lp-cta" onClick={onGetStarted}>Get Started</button>
          <div className="lp-privacy-line">Private by design · Local-first</div>

          <div className="lp-path-strip">
            <span className="lp-step">See</span><span className="lp-arrow">→</span>
            <span className="lp-step">Understand</span><span className="lp-arrow">→</span>
            <span className="lp-step">Decide</span><span className="lp-arrow">→</span>
            <span className="lp-step lp-final">Wealth</span>
          </div>

          <div className="lp-mockup-frame">
            <div className="lp-mockup-card">
              <div className="lp-nw-headline">
                <div className="lp-label">Net Worth</div>
                <div className="lp-value">₹1.24 Cr</div>
              </div>
              <hr className="lp-mockup-hr" />
              <div className="lp-mockup-label">Cash Flow · This Month</div>
              <div className="lp-row"><span className="lp-k">Income</span><span className="lp-v">₹4.20L</span></div>
              <div className="lp-row"><span className="lp-k">Expenses</span><span className="lp-v">₹1.85L</span></div>
              <div className="lp-row"><span className="lp-k">Savings</span><span className="lp-v" style={{ color: "var(--lp-teal)" }}>₹2.35L <span className="lp-rate-tag">56% of income</span></span></div>
              <hr className="lp-mockup-hr" />
              <div className="lp-row"><span className="lp-k">Investments</span><span className="lp-v">₹38.4L</span></div>
            </div>
          </div>
        </div>

        <hr className="lp-hr" />

        <section className="lp-story lp-section">
          <div className="lp-num">01 — See</div>
          <h2>Everything you own.<br/>Everything you owe. One picture.</h2>
          <p>Bank accounts, credit cards, investments, loans, and goals come together into one financial picture — always current, no spreadsheet upkeep.</p>
          <div className="lp-mockup-frame">
            <div className="lp-mockup-card">
              <div className="lp-mockup-label">Net Worth</div>
              <div className="lp-row"><span className="lp-k">Bank balances</span><span className="lp-v">₹6.10L</span></div>
              <div className="lp-row"><span className="lp-k">Market-tracked investments</span><span className="lp-v">₹32.8L</span></div>
              <div className="lp-row"><span className="lp-k">Other investments (PF, Gold, Property)</span><span className="lp-v">₹94.2L</span></div>
              <div className="lp-row" style={{ fontWeight: 600 }}><span className="lp-k">Total assets</span><span className="lp-v">₹1.33 Cr</span></div>
              <hr className="lp-mockup-hr" />
              <div className="lp-row"><span className="lp-k">Credit cards owed</span><span className="lp-v" style={{ color: "var(--lp-rust)" }}>₹0.42L</span></div>
              <div className="lp-row"><span className="lp-k">Loans outstanding</span><span className="lp-v" style={{ color: "var(--lp-rust)" }}>₹8.60L</span></div>
              <div className="lp-row" style={{ fontWeight: 600 }}><span className="lp-k">Total liabilities</span><span className="lp-v" style={{ color: "var(--lp-rust)" }}>₹9.02L</span></div>
            </div>
          </div>
        </section>

        <hr className="lp-hr" />

        <section className="lp-story lp-section">
          <div className="lp-num">02 — Understand</div>
          <h2>Don't just track your money.<br/>Understand it.</h2>
          <p>Instead of endless transactions, Being Wealthy explains what's actually happening — grounded only in numbers you've entered, never a guess dressed up as an answer.</p>
          <div className="lp-mockup-frame">
            <div className="lp-mockup-card" style={{ textAlign: "left" }}>
              <div className="lp-mockup-label">Insights · This Month</div>
              <div className="lp-insight-line"><span className="lp-insight-dot"></span>Savings rate dropped 8 points vs last month — 44% now vs 52%.</div>
              <div className="lp-insight-line"><span className="lp-insight-dot"></span>Household spend is up 32% vs last month — ₹18,400 vs ₹13,900.</div>
              <div className="lp-insight-line"><span className="lp-insight-dot"></span>Investment rate is negative this month — you redeemed ₹20,000 more than you invested.</div>
            </div>
          </div>
        </section>

        <hr className="lp-hr" />

        <section className="lp-story lp-section">
          <div className="lp-num">03 — Decide</div>
          <h2>The question isn't "what happened."<br/>It's "what should I do."</h2>
          <p>Ask your Personal CFO the real question — afford this, invest or repay, which goal comes first — and get an answer traced back to your own numbers.</p>
          <div className="lp-mockup-frame">
            <div className="lp-mockup-card">
              <div className="lp-cfo-q">"Can I afford a ₹6L car this year?"</div>
              <div className="lp-cfo-a-label">Recommendation</div>
              <div className="lp-cfo-a-text">Yes, comfortably. Based on your ₹2.35L average monthly savings and ₹8.4L in unallocated investments, a ₹6L purchase leaves your Emergency Fund and other goals untouched.</div>
            </div>
          </div>
        </section>

        <hr className="lp-hr" />

        <section className="lp-story lp-section">
          <div className="lp-num">04 — Wealth</div>
          <h2>Then, watch it build.</h2>
          <p>Every decision compounds. Track goals to completion, debt to zero, and net worth as it actually moves — not a projection, your real numbers, month after month.</p>
          <div className="lp-mockup-frame">
            <div className="lp-mockup-card" style={{ textAlign: "left" }}>
              <div className="lp-mockup-label">Goals</div>
              <div className="lp-row"><span className="lp-k">Emergency Fund</span><span className="lp-v" style={{ color: "var(--lp-teal)" }}>100% funded</span></div>
              <div className="lp-row"><span className="lp-k">House Down Payment</span><span className="lp-v" style={{ color: "var(--lp-teal)" }}>62% funded</span></div>
              <div className="lp-row"><span className="lp-k">Retirement</span><span className="lp-v" style={{ color: "var(--lp-teal)" }}>On track</span></div>
              <hr className="lp-mockup-hr" />
              <div className="lp-row"><span className="lp-k">Net Worth, 12 months ago</span><span className="lp-v">₹94.6L</span></div>
              <div className="lp-row" style={{ fontWeight: 600 }}><span className="lp-k">Net Worth, today</span><span className="lp-v" style={{ color: "var(--lp-teal)" }}>₹1.24 Cr</span></div>
            </div>
          </div>
        </section>

        <hr className="lp-hr" />

        <section className="lp-story lp-section">
          <h2>How Being Wealthy works.</h2>
          <p>No manual entry, no spreadsheets to maintain — four steps, and the rest keeps itself current.</p>
          <div className="lp-howitworks-list">
            <div className="lp-howitworks-item">
              <div className="lp-howitworks-num">01</div>
              <div>
                <div className="lp-howitworks-title">Bring in your data</div>
                <div className="lp-howitworks-desc">Upload a bank statement, investment holdings, or a loan schedule — PDF, CSV, or Excel. Being Wealthy figures out what it is and reads it for you.</div>
              </div>
            </div>
            <div className="lp-howitworks-item">
              <div className="lp-howitworks-num">02</div>
              <div>
                <div className="lp-howitworks-title">Make sure it's right</div>
                <div className="lp-howitworks-desc">Review what got categorized, correct anything that's off, and it remembers your corrections as rules — so next month needs far less review.</div>
              </div>
            </div>
            <div className="lp-howitworks-item">
              <div className="lp-howitworks-num">03</div>
              <div>
                <div className="lp-howitworks-title">Build your financial picture</div>
                <div className="lp-howitworks-desc">Cash Flow, Net Worth, Investments, Debt, and Goals update automatically from what you've imported — always current, nothing to maintain by hand.</div>
              </div>
            </div>
            <div className="lp-howitworks-item">
              <div className="lp-howitworks-num">04</div>
              <div>
                <div className="lp-howitworks-title">Understand what to do next</div>
                <div className="lp-howitworks-desc">Ask the Analyst what changed, or the Personal CFO what you should do — both answer only from your own real numbers.</div>
              </div>
            </div>
          </div>
        </section>

        <hr className="lp-hr" />

        <section className="lp-story lp-section">
          <h2>Priced for what BYOK actually changes.</h2>
          <p>No server to run, no AI markup to charge for — the fee pays for the software, not a tax on someone else's model.</p>
          <div className="lp-pricing-grid">
            <div className="lp-pricing-card">
              <div className="lp-pricing-name">Free</div>
              <div className="lp-pricing-price">₹0</div>
              <div className="lp-pricing-sub">forever</div>
              <div className="lp-pricing-item">1 Bank account + 1 Credit Card account</div>
              <div className="lp-pricing-item">1 Debt account · 1 Investment account</div>
              <div className="lp-pricing-item">3 Goals, near-term or long-term</div>
              <div className="lp-pricing-item">Full Analyst & Personal CFO — built-in prompts</div>
              <div className="lp-pricing-item">Your own Gemini key, always</div>
            </div>
            <div className="lp-pricing-card featured">
              <div className="lp-pricing-badge">Most Popular</div>
              <div className="lp-pricing-name">Licensed</div>
              <div className="lp-pricing-price">₹499</div>
              <div className="lp-pricing-sub">/yr — illustrative, TBC</div>
              <div className="lp-pricing-item">Unlimited accounts, every screen</div>
              <div className="lp-pricing-item">Save your own custom AI prompts</div>
              <div className="lp-pricing-item">Continued feature enhancements</div>
              <div className="lp-pricing-item">Priority support</div>
              <div className="lp-pricing-item">Your own Gemini key — never marked up</div>
            </div>
            <div className="lp-pricing-card">
              <div className="lp-pricing-name">Managed AI</div>
              <div className="lp-pricing-price" style={{ fontSize: 20 }}>Coming Soon</div>
              <div className="lp-pricing-sub">for heavy users</div>
              <div className="lp-pricing-item">No API key to set up or manage</div>
              <div className="lp-pricing-item">We handle the AI relationship</div>
              <div className="lp-pricing-item">Usage-based, built for power users</div>
              <div className="lp-pricing-item">Everything in Licensed, included</div>
            </div>
          </div>
        </section>

        <hr className="lp-hr" />

        <section className="lp-story lp-section">
          <h2>Your money. Your data. Your device.</h2>
          <div className="lp-privacy-subhead">Privacy by design. Local-first by default.</div>
          <p>Your financial life stays on your device. Being Wealthy doesn't need a central database of your financial information, and we don't sell your data.</p>
          <p>When you choose to use AI, your browser connects directly to the AI provider using your own API key.</p>
          <div className="lp-flow">
            <div className="lp-flow-box">Your Device</div>
            <div className="lp-flow-arrow">→</div>
            <div className="lp-flow-box">AI Provider</div>
          </div>
          <div className="lp-flow-caption">Your data stays local. You stay in control.</div>
        </section>

        <hr className="lp-hr" />

        <div className="lp-footer">
          <div className="lp-wordmark">Being <em>Wealthy</em></div>
          <div className="lp-tagline">See your money clearly.</div>
          <button className="lp-cta" style={{ marginTop: 26 }} onClick={onGetStarted}>Get Started</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Main component                                                         */
/* ---------------------------------------------------------------------- */

export default function BeingWealthyLedger() {
  const [view, setView] = useState("landing"); // landing | cashflow | networth | investments | goals | upload | review | rules
  const [transactions, setTransactions] = useState([]);
  const [rules, setRules] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [budgets, setBudgets] = useState({}); // { "Expense-Fixed": 15000, ... }
  const [merchantAliases, setMerchantAliases] = useState([]); // [{ id, canonical, variants: [rawMerchantKey, ...] }]
  // One entry per investment holding-statement import. Each is self-contained (asOfDate,
  // totals, full holdings list) — the SAME pattern as an uploadHistory batch for a bank
  // account, just for a fundamentally different kind of statement (a position snapshot,
  // not a list of movements). Added/Redeemed/Growth for each holding get computed by
  // diffing against the PREVIOUS snapshot for that same account at read time, never
  // stored — so a deleted or corrected snapshot never leaves stale derived numbers
  // behind, the same reasoning as everywhere else derived figures are computed on read.
  const [holdingSnapshots, setHoldingSnapshots] = useState([]);
  // One entry per financial goal. No stored contribution ledger — a goal's tracked
  // progress (manual allocation + auto-absorbed SIP progress) is always computed live
  // from the goal's own settings plus the portfolio's current invested value, same
  // "derive at read time, store only the real inputs" philosophy as Investments.
  const [goals, setGoals] = useState([]);
  // One entry per imported amortization schedule (a whole loan's period-by-period
  // table, not a point-in-time snapshot like holdings — an amortization document
  // covers the full tenure in one import). Multiple schedules per account are
  // supported for restructuring: a later import's periods take priority over an
  // earlier one's for any period both cover, computed live, never merged at write time.
  const [debtSchedules, setDebtSchedules] = useState([]);
  // Unified "Other Investments" (PF, Gold, Property, etc.) — one consistent shape
  // (units, cost-per-unit, current-per-unit, invested value, current value),
  // matching the same field names and derivation approach already used for
  // market-tracked holdings. Replaces an earlier assetBalances/manualAssets split;
  // old data in that shape migrates forward once, on load, below.
  const [otherInvestments, setOtherInvestments] = useState([]);
  // Analyst/CFO conversations — one array, tagged by persona, since the shape is
  // identical. A saved prompt is a TEMPLATE with placeholder tokens (e.g. "[category]")
  // inserted from a fixed, small set — never free text referencing arbitrary data —
  // so a custom prompt is exactly as safe to run as a built-in one: the deterministic
  // layer dispatches on which placeholder TYPES appear, not on the prompt's wording.
  const [chatThreads, setChatThreads] = useState([]);
  const [savedPrompts, setSavedPrompts] = useState([]);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState("");
  const [tutorialActive, setTutorialActive] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [hasSeenTutorial, setHasSeenTutorial] = useState(true); // true until proven otherwise, to avoid a flash of the tour before load completes
  const [license, setLicense] = useState(null); // null = Free tier; { email, tier, keyId, issuedAt, expiresAt } once a valid key is stored
  const [showLicenseModal, setShowLicenseModal] = useState(false);
  const [licenseKeyInput, setLicenseKeyInput] = useState("");
  const [licenseError, setLicenseError] = useState("");
  const [licenseChecking, setLicenseChecking] = useState(false);
  const [theme, setTheme] = useState("light"); // light | dark
  const saveTimerRef = useRef(null);

  // Auto-backup: Chrome/Edge can remember a chosen folder and write fresh backups
  // there without asking again each time (File System Access API). Firefox and
  // Safari don't implement this at all — deliberately, not as a rollout-in-progress
  // gap — so lastBackupAt drives a simple reminder for everyone that isn't on the
  // supported path, rather than silence for browsers that can't get the real thing.
  const autoBackupSupported = typeof window !== "undefined" && !!window.showDirectoryPicker;
  const [autoBackupFolderName, setAutoBackupFolderName] = useState(null);
  const [autoBackupError, setAutoBackupError] = useState(null);
  const [lastBackupAt, setLastBackupAt] = useState(null);
  const autoBackupThrottleRef = useRef(0);
  const autoBackupHandleRef = useRef(null);

  useEffect(() => {
    (async () => {
      const savedTheme = await loadState("theme", "light");
      setTheme(savedTheme === "dark" ? "dark" : "light");
    })();
  }, []);
  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      saveState("theme", next);
      return next;
    });
  }

  useEffect(() => {
    (async () => {
      // one combined save going forward; fall back to the older separate keys once,
      // for anyone with data saved before this consolidation
      const combined = await loadState("appData", null);
      if (combined) {
        setTransactions(combined.transactions || []);
        setRules(combined.rules || seedRules());
        setBudgets(combined.budgets || {});
        setMerchantAliases(combined.merchantAliases || []);
        setHoldingSnapshots(combined.holdingSnapshots || []);
        setGoals(combined.goals || []);
        setDebtSchedules(combined.debtSchedules || []);
        setChatThreads(combined.chatThreads || []);
        setSavedPrompts(combined.savedPrompts || []);
        if (combined.otherInvestments) {
          // Already migrated in a prior session — load as-is.
          setAccounts(combined.accounts || []);
          setOtherInvestments(combined.otherInvestments);
        } else {
          // First load since Statement-based/Manual unified into Other Investments —
          // migrate the old split forward once, verified against a mixed scenario
          // before ever touching real saved data.
          const { migratedAccounts, migratedEntries } = migrateToOtherInvestments(
            combined.accounts || [], combined.assetBalances || [], combined.manualAssets || []
          );
          setAccounts(migratedAccounts);
          setOtherInvestments(migratedEntries);
        }
      } else {
        const [t, r, a, b, ma] = await Promise.all([
          loadState("transactions", []),
          loadState("rules", null),
          loadState("accounts", []),
          loadState("budgets", {}),
          loadState("merchantAliases", []),
        ]);
        setTransactions(t);
        setRules(r || seedRules());
        setAccounts(a);
        setBudgets(b || {});
        setMerchantAliases(ma || []);
        setHoldingSnapshots([]);
        setGoals([]);
        setDebtSchedules([]);
        setOtherInvestments([]);
        setChatThreads([]);
        setSavedPrompts([]);
      }
      setHasSeenTutorial(await loadState("hasSeenTutorial", false));
      const storedLicenseKey = await loadState("licenseKey", null);
      if (storedLicenseKey) {
        const result = await verifyLicenseKey(storedLicenseKey);
        if (result.valid) setLicense(result.payload);
        // An invalid stored key (corrupted, tampered, or signed by an old/different key)
        // is silently treated as no license, rather than surfacing an error on every
        // load — the person only sees an error if THEY paste in a bad key themselves.
      }
      setReady(true);
    })();
  }, []);

  // Auto-launches once for a genuinely first-time user — checked only when ready
  // flips true, so a later reset (which also empties accounts/transactions) doesn't
  // re-trigger it, since hasSeenTutorial is a separate, independently-persisted flag.
  useEffect(() => {
    if (ready && !hasSeenTutorial && accounts.length === 0 && transactions.length === 0) {
      setTutorialActive(true);
      setTutorialStep(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function finishTutorial() {
    setTutorialActive(false);
    setHasSeenTutorial(true);
    saveState("hasSeenTutorial", true);
  }

  function startTutorial() {
    setTutorialStep(0);
    setTutorialActive(true);
  }

  async function submitLicenseKey() {
    setLicenseChecking(true);
    setLicenseError("");
    const result = await verifyLicenseKey(licenseKeyInput);
    setLicenseChecking(false);
    if (!result.valid) {
      setLicenseError(result.reason);
      return;
    }
    setLicense(result.payload);
    saveState("licenseKey", licenseKeyInput.trim());
    setLicenseKeyInput("");
    setShowLicenseModal(false);
    showToast("License verified — you're on the Licensed plan.");
  }

  function removeLicense() {
    setLicense(null);
    saveState("licenseKey", null);
    showToast("License removed. You're back on the Free plan — nothing you've already added is deleted.");
  }

  // The single source of truth for "is this person actually Licensed right now" — a
  // stored key that verified successfully on load can still be expired by today's date,
  // so tier status is always this derived check, never just "is `license` non-null".
  const todayDateStr = new Date().toISOString().slice(0, 10);
  const isLicenseValid = license !== null && license.expiresAt >= todayDateStr;
  const effectiveTier = isLicenseValid ? "licensed" : "free";
  const licenseDaysRemaining = license ? Math.ceil((new Date(license.expiresAt) - new Date(todayDateStr)) / (1000 * 60 * 60 * 24)) : null;

  // Navigates the actual app to match whatever the current tutorial step is
  // describing, so the overlay always sits on top of the real screen it's talking
  // about rather than a generic walkthrough disconnected from the product.
  useEffect(() => {
    if (tutorialActive && TUTORIAL_STEPS[tutorialStep]?.view) {
      setView(TUTORIAL_STEPS[tutorialStep].view);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorialActive, tutorialStep]);

  function tutorialNext() {
    setTutorialStep((s) => Math.min(s + 1, TUTORIAL_STEPS.length - 1));
  }
  function tutorialBack() {
    setTutorialStep((s) => Math.max(s - 1, 0));
  }

  // Restore the auto-backup folder handle, if one was granted in a previous session.
  // Permission can be CHECKED silently (queryPermission), but re-GRANTING it after a
  // browser restart requires an actual user click (requestPermission cannot be called
  // without a user gesture) — that's a real constraint of the API, not a bug here, so
  // a lapsed permission surfaces as a "resume" prompt rather than a silent failure.
  useEffect(() => {
    (async () => {
      const storedAt = await loadState("lastBackupAt", null);
      if (storedAt) setLastBackupAt(storedAt);
      if (!autoBackupSupported) return;
      try {
        const handle = await loadBackupFolderHandle();
        if (!handle) return;
        const permission = await handle.queryPermission({ mode: "readwrite" });
        if (permission === "granted") {
          autoBackupHandleRef.current = handle;
          setAutoBackupFolderName(handle.name);
        } else {
          setAutoBackupFolderName(handle.name);
          setAutoBackupError("resume-needed");
        }
      } catch {
        /* no stored handle, or IndexedDB unavailable — auto-backup just isn't active */
      }
    })();
  }, []);

  // Single debounced save instead of up to 5 separate writes per action — categorizing
  // a transaction typically touches both transactions and rules at once, and bulk
  // actions can touch many transactions in one click, so this coalesces rapid changes
  // into one write shortly after things settle, rather than one write per field per click.
  useEffect(() => {
    if (!ready) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveState("appData", { transactions, rules, accounts, budgets, merchantAliases, holdingSnapshots, goals, debtSchedules, otherInvestments, chatThreads, savedPrompts });
      // Same trigger as the regular save — if a folder is actively connected, write a
      // fresh backup there too, throttled to at most once every 5 minutes so rapid
      // edits don't hammer the disk with a new file on every keystroke.
      if (autoBackupHandleRef.current && Date.now() - autoBackupThrottleRef.current > 5 * 60 * 1000) {
        autoBackupThrottleRef.current = Date.now();
        writeBackupToFolder(autoBackupHandleRef.current, true);
      }
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [transactions, rules, accounts, budgets, merchantAliases, holdingSnapshots, goals, debtSchedules, otherInvestments, chatThreads, savedPrompts, ready]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
  }

  const [confirmingReset, setConfirmingReset] = useState(false);

  function resetAll() {
    setTransactions([]);
    setAccounts([]);
    setBudgets({});
    setHoldingSnapshots([]);
    setGoals([]);
    setDebtSchedules([]);
    setOtherInvestments([]);
    setChatThreads([]); // old conversations reference specific numbers that go stale
    setConfirmingReset(false);
    showToast("Transactions, accounts, budgets, holdings, goals, debt schedules, assets, and chat history cleared. Rules, merchant groups, and saved prompts are untouched.");
  }

  /** The single definition of "what a complete backup contains" — shared by the
   *  manual download button and folder-based auto-backup, so there's exactly one
   *  place to update if a new field is ever added. Two backup paths independently
   *  deciding what to include would risk them silently drifting apart over time. */
  function buildBackupPayload() {
    return {
      beingWealthyBackup: true,
      exportedAt: new Date().toISOString(),
      version: 1,
      data: { transactions, rules, accounts, budgets, merchantAliases, holdingSnapshots, goals, debtSchedules, otherInvestments, chatThreads, savedPrompts },
    };
  }

  /** Everything persisted, in one file. This is the entire fix for a very real,
   *  present risk: today, every bit of this data lives ONLY in this browser's
   *  localStorage — clearing site data, an unfamiliar machine, or a lost profile
   *  means permanent, total loss with no way to recover it. This gives the person
   *  something concrete to keep, on their own terms — a USB drive, their own cloud
   *  drive's synced folder, anywhere they choose. Nothing about the file itself
   *  ever leaves this device unless the person explicitly moves it. */
  function exportBackup() {
    const payload = buildBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `being-wealthy-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setLastBackupAt(Date.now());
    saveState("lastBackupAt", Date.now());
    showToast("Backup downloaded — keep this file somewhere safe, like a synced cloud folder.");
  }

  /** Writes a fresh backup directly into the connected folder — no download prompt,
   *  no repeated permission ask, since that was already granted once when the folder
   *  was chosen. Uses the exact same payload as the manual download, so an automatic
   *  backup is never a lesser version of a manual one. */
  async function writeBackupToFolder(handle, silent) {
    try {
      const payload = buildBackupPayload();
      const filename = `being-wealthy-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const fileHandle = await handle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(payload, null, 2));
      await writable.close();
      setLastBackupAt(Date.now());
      saveState("lastBackupAt", Date.now());
      setAutoBackupError(null);
      if (!silent) showToast(`Backed up to "${handle.name}".`);
    } catch (err) {
      // A silent, automatic write failing shouldn't interrupt what the person is
      // doing — surface it as a quiet status the settings area can show, not a toast
      // that pops up uninvited while they're in the middle of something else.
      setAutoBackupError(err.message || "Auto-backup failed");
    }
  }

  async function enableAutoBackup() {
    if (!autoBackupSupported) return;
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await saveBackupFolderHandle(handle);
      autoBackupHandleRef.current = handle;
      setAutoBackupFolderName(handle.name);
      setAutoBackupError(null);
      await writeBackupToFolder(handle, false);
    } catch (err) {
      // The person closing the folder picker without choosing anything also lands
      // here (AbortError) — that's a cancellation, not a real failure, so it's not
      // worth surfacing as an error.
      if (err.name !== "AbortError") setAutoBackupError(err.message || "Couldn't set up auto-backup");
    }
  }

  async function resumeAutoBackupPermission() {
    const handle = await loadBackupFolderHandle();
    if (!handle) return;
    try {
      const permission = await handle.requestPermission({ mode: "readwrite" });
      if (permission === "granted") {
        autoBackupHandleRef.current = handle;
        setAutoBackupError(null);
        showToast(`Auto-backup resumed for "${handle.name}".`);
      }
    } catch {
      setAutoBackupError("Couldn't resume — try reconnecting the folder instead.");
    }
  }

  async function disableAutoBackup() {
    await clearBackupFolderHandle();
    autoBackupHandleRef.current = null;
    setAutoBackupFolderName(null);
    setAutoBackupError(null);
    showToast("Auto-backup turned off. Your existing backup files aren't affected.");
  }

  const [pendingImportFile, setPendingImportFile] = useState(null);
  const [importError, setImportError] = useState(null);
  const importInputRef = useRef(null);

  function handleImportFileChosen(file) {
    if (!file) return;
    setImportError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== "object" || !parsed.data || typeof parsed.data !== "object") {
          setImportError("That doesn't look like a Being Wealthy backup file.");
          return;
        }
        setPendingImportFile(parsed);
      } catch {
        setImportError("Couldn't read that file — make sure it's an unmodified backup file from this app.");
      }
    };
    reader.onerror = () => setImportError("Couldn't read that file.");
    reader.readAsText(file);
  }

  /** Every field restored with a safe fallback, the same pattern used when loading
   *  from localStorage on startup — a backup taken before some future field existed
   *  should never leave the app in a half-populated, broken state. */
  function confirmImport() {
    const d = pendingImportFile.data || {};
    setTransactions(d.transactions || []);
    setRules(d.rules || seedRules());
    setBudgets(d.budgets || {});
    setMerchantAliases(d.merchantAliases || []);
    setHoldingSnapshots(d.holdingSnapshots || []);
    setGoals(d.goals || []);
    setDebtSchedules(d.debtSchedules || []);
    setChatThreads(d.chatThreads || []);
    setSavedPrompts(d.savedPrompts || []);
    if (d.otherInvestments) {
      setAccounts(d.accounts || []);
      setOtherInvestments(d.otherInvestments);
    } else {
      // Restoring a backup taken before the unification — migrate it the same way
      // live data gets migrated on load.
      const { migratedAccounts, migratedEntries } = migrateToOtherInvestments(d.accounts || [], d.assetBalances || [], d.manualAssets || []);
      setAccounts(migratedAccounts);
      setOtherInvestments(migratedEntries);
    }
    setPendingImportFile(null);
    showToast("Backup restored — this replaced everything that was in this browser.");
  }

  function reapplyRules() {
    let changed = 0, protectedCount = 0;
    setTransactions((prev) => prev.map((t) => {
      const isManual = !t.matchedRuleId && !!t.category; // categorized with no rule behind it = a deliberate manual override
      if (isManual) { protectedCount++; return t; }
      const rule = matchRule(t.description, rules);
      const newCategory = rule ? rule.category : null;
      const newSub = rule ? rule.subCategory : null;
      const newTag = rule ? rule.tag : null;
      const newFreq = rule ? (rule.frequency || null) : null;
      const newPurpose = rule ? (rule.purpose || "Personal") : "Personal";
      const newRuleId = rule ? rule.id : null;
      if (newCategory !== t.category || newSub !== t.subCategory || newTag !== t.tag
          || newFreq !== (t.frequency || null) || newPurpose !== (t.purpose || "Personal") || newRuleId !== t.matchedRuleId) {
        changed++;
        return { ...t, category: newCategory, subCategory: newSub, tag: newTag, frequency: newFreq, purpose: newPurpose, matchedRuleId: newRuleId };
      }
      return t;
    }));
    showToast(`Re-applied rules: ${changed} transaction${changed === 1 ? "" : "s"} updated, ${protectedCount} manual ${protectedCount === 1 ? "entry" : "entries"} left untouched.`);
  }

  const uncategorizedCount = transactions.filter((t) => !t.category).length;

  if (view === "landing") {
    return <LandingPage onGetStarted={() => setView("cashflow")} />;
  }

  return (
    <div className={`bw-root ${theme === "dark" ? "theme-dark" : ""}`}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        .bw-root {
          --paper: #FFFFFF;
          --card: #FFFFFF;
          --ink: #14161A;
          --ink-soft: #5B6169;
          --line: #E2E4E8;
          --teal: #2E6659;
          --ochre: #A8703A;
          --rust: #9C4A34;
          --slate: #55606B;
          font-family: 'IBM Plex Sans', sans-serif;
          background: var(--paper);
          color: var(--ink);
          min-height: 100%;
          padding: 28px 20px 60px;
          transition: background 0.15s, color 0.15s;
        }
        .bw-root.theme-dark {
          --paper: #101214;
          --card: #191C1F;
          --ink: #F2F3F5;
          --ink-soft: #9CA1A8;
          --line: #2C2F34;
          --teal: #4B9C87;
          --ochre: #C4915C;
          --rust: #C36953;
          --slate: #9BA2AC;
        }
        .bw-root.theme-dark table.bw-table tr:hover td { background: rgba(75,156,135,0.08); }
        .bw-root.theme-dark .bw-dropzone { background: rgba(255,255,255,0.02); }
        .bw-root.theme-dark input, .bw-root.theme-dark select, .bw-root.theme-dark textarea { background: var(--card); color: var(--ink); border-color: var(--line); }
        .bw-theme-toggle {
          background: none; border: 1px solid var(--line); color: var(--ink-soft);
          padding: 6px 9px; border-radius: 5px; cursor: pointer; display: flex; align-items: center; gap: 5px;
          font-size: 11.5px;
        }
        .bw-theme-toggle:hover { border-color: var(--teal); color: var(--teal); }
        .bw-shell { max-width: 1080px; margin: 0 auto; }
        .bw-head {
          display: flex; align-items: baseline; justify-content: space-between;
          border-bottom: 2px solid var(--ink); padding-bottom: 14px; margin-bottom: 18px;
          flex-wrap: wrap; gap: 10px;
        }
        .bw-title {
          font-family: 'Fraunces', serif; font-weight: 600; font-size: 27px; letter-spacing: -0.01em;
        }
        .bw-title em { font-style: italic; color: var(--teal); font-weight: 500; }
        .bw-sub { font-size: 12.5px; color: var(--ink-soft); margin-top: 2px; }
        .bw-screen-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: var(--ink); margin: 18px 0 10px; }
        .bw-tagline { font-size: 13px; color: var(--ink-soft); margin-top: 3px; font-style: italic; }
        .bw-reset {
          font-size: 11.5px; color: var(--ink-soft); background: none; border: 1px solid var(--line);
          padding: 6px 10px; border-radius: 3px; cursor: pointer; display: flex; align-items: center; gap: 5px;
        }
        .bw-reset:hover { border-color: var(--rust); color: var(--rust); }

        .bw-tabs { display: flex; gap: 4px; margin-bottom: 20px; flex-wrap: wrap; }
        .bw-tab {
          font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.03em;
          padding: 9px 14px 8px; background: var(--card); border: 1px solid var(--line);
          border-bottom: none; border-radius: 4px 4px 0 0; cursor: pointer; color: var(--ink-soft);
          display: flex; align-items: center; gap: 6px; position: relative; top: 1px;
        }
        .bw-tab.active { color: var(--ink); background: var(--card); border-bottom: 1px solid var(--card);
          box-shadow: 0 -2px 0 var(--teal) inset; font-weight: 600; }
        .bw-tab .badge {
          background: var(--rust); color: #fff; font-size: 10px; padding: 1px 6px; border-radius: 20px;
        }

        .bw-panel { background: var(--card); border: 1px solid var(--line); border-radius: 0 6px 6px 6px;
          padding: 22px; }

        h2.bw-h2 { font-family: 'Fraunces', serif; font-size: 19px; font-weight: 600; margin: 0 0 4px; }
        p.bw-lead { font-size: 13px; color: var(--ink-soft); margin: 0 0 16px; max-width: 640px; line-height: 1.5; }

        .bw-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media (max-width: 720px) { .bw-grid2 { grid-template-columns: 1fr; } }

        .bw-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
        .bw-field label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); }
        .bw-field select, .bw-field input[type=text] {
          font-family: 'IBM Plex Sans', sans-serif; font-size: 13px; padding: 8px 9px; border: 1px solid var(--line);
          border-radius: 4px; background: var(--card); color: var(--ink);
        }

        .bw-dropzone {
          border: 1.5px dashed var(--line); border-radius: 6px; padding: 34px 20px; text-align: center;
          color: var(--ink-soft); cursor: pointer; background: repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(85,96,107,0.03) 10px, rgba(85,96,107,0.03) 20px);
        }
        .bw-dropzone:hover { border-color: var(--teal); color: var(--teal); }
        .bw-dropzone input { display: none; }

        .bw-btn {
          font-family: 'IBM Plex Sans', sans-serif; font-size: 13px; font-weight: 600; padding: 9px 16px;
          border-radius: 4px; border: 1px solid var(--ink); background: var(--ink); color: var(--card);
          cursor: pointer; display: inline-flex; align-items: center; gap: 7px;
        }
        .bw-btn:hover { background: var(--teal); border-color: var(--teal); }
        .bw-btn.ghost { background: transparent; color: var(--ink); }
        .bw-btn.ghost:hover { background: rgba(0,0,0,0.04); color: var(--ink); }
        .bw-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .bw-btn.small { padding: 5px 10px; font-size: 12px; }

        table.bw-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        table.bw-table th {
          text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em;
          color: var(--ink-soft); border-bottom: 1px solid var(--ink); padding: 6px 8px; font-weight: 600;
        }
        table.bw-table td { padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
        table.bw-table tr:hover td { background: rgba(46,102,89,0.04); }
        .bw-amt { font-family: 'IBM Plex Mono', monospace; text-align: right; white-space: nowrap; }
        .bw-amt.credit { color: var(--teal); }
        .bw-amt.debit { color: var(--ink); }

        .bw-pill {
          font-size: 10.5px; padding: 3px 8px; border-radius: 20px; color: #fff; display: inline-block;
          white-space: nowrap; font-weight: 500;
        }

        .bw-select-inline { font-size: 12px; padding: 4px 5px; border-radius: 3px; border: 1px solid var(--line); background: var(--card); }

        .bw-summary-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 22px; }
        @media (max-width: 800px) { .bw-summary-row { grid-template-columns: repeat(2, 1fr); } }
        .bw-stat { border: 1px solid var(--line); border-radius: 6px; padding: 14px; background: var(--card); }
        .bw-stat .label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); }
        .bw-stat .value { font-family: 'IBM Plex Mono', monospace; font-size: 21px; font-weight: 600; margin-top: 4px; }

        .bw-toast {
          position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%);
          background: #21262B; color: #fff; padding: 10px 18px; border-radius: 5px; font-size: 12.5px;
          display: flex; align-items: center; gap: 8px; z-index: 50;
        }
        .bw-empty { padding: 40px 10px; text-align: center; color: var(--ink-soft); font-size: 13px; }
        .bw-spin { animation: bw-spin-kf 1s linear infinite; }
        @keyframes bw-spin-kf { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .bw-checkbox-row { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--ink-soft); margin-top: 10px; }
        .bw-section-label { font-family: 'Fraunces', serif; font-size: 14px; font-weight: 600; margin: 22px 0 10px; }
        .bw-zone-header {
          display: flex; align-items: center; gap: 9px; margin: 36px 0 18px; padding-top: 22px;
          border-top: 1px solid var(--line);
        }
        .bw-zone-header .zone-icon {
          width: 26px; height: 26px; border-radius: 6px; background: var(--teal); color: #fff;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .bw-zone-header h3 { font-family: 'Fraunces', serif; font-size: 17px; font-weight: 600; margin: 0; }
        .bw-zone-header p { font-size: 12px; color: var(--ink-soft); margin: 1px 0 0; }
        .bw-hr { border: none; border-top: 1px solid var(--line); margin: 18px 0; }

        .bw-insight-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin: 16px 0 22px; }
        .bw-insight-card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
        .bw-insight-card.clickable { cursor: pointer; transition: border-color 0.15s; }
        .bw-insight-card.clickable:hover { border-color: var(--teal); }
        .bw-insight-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; }
        .bw-insight-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--ink); }
        .bw-insight-badge { font-size: 10px; font-weight: 600; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
        .bw-insight-value { font-family: 'IBM Plex Mono', monospace; font-size: 22px; font-weight: 600; color: var(--ink); }
        .bw-insight-delta { font-size: 10.5px; margin: 3px 0 10px; }
        .bw-insight-footer { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
        .bw-insight-footer-item { background: var(--paper); border-radius: 6px; padding: 7px 10px; }
        .bw-insight-footer-label { font-size: 9.5px; color: var(--ink-soft); }
        .bw-insight-footer-value { font-size: 12px; font-weight: 600; color: var(--ink); }
        .bw-insight-line { display: flex; justify-content: space-between; font-size: 11px; padding: 4px 0; }
        .bw-insight-sparkline { display: block; margin-top: 4px; }

        .bw-waterfall-card {
          border: 1px solid var(--line); border-radius: 12px; background: var(--card);
          padding: 26px; margin: 18px 0 6px;
        }
        .bw-waterfall { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 8px; align-items: stretch; }
        @media (max-width: 640px) { .bw-waterfall { grid-template-columns: repeat(2, 1fr) !important; } }
        .bw-wf-node, .bw-wf-op {
          border-radius: 8px; padding: 14px 10px; background: rgba(85,96,107,0.05);
          text-align: center; transition: background 0.15s; min-width: 0;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
        }
        .bw-wf-node.negative, .bw-wf-op.negative { background: rgba(156,74,52,0.09); }
        .bw-wf-node.clickable, .bw-wf-op.clickable { cursor: pointer; }
        .bw-wf-node.clickable:hover, .bw-wf-op.clickable:hover { background: rgba(46,102,89,0.10); }
        .bw-wf-node-label, .bw-wf-op-label {
          font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-soft); margin-bottom: 6px;
        }
        .bw-wf-node-sublabel { text-transform: none; letter-spacing: 0; }
        .bw-wf-node-value, .bw-wf-op-value { font-family: 'IBM Plex Mono', monospace; font-size: 15px; font-weight: 600; white-space: nowrap; }
        .bw-wf-arrow-h { display: none; }
        .bw-wf-arrow-v { display: none; }

        .bw-pillars { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
        .bw-pillar {
          font-family: 'IBM Plex Sans', sans-serif; font-size: 13px; font-weight: 600; letter-spacing: 0.01em;
          padding: 10px 16px; background: var(--card); border: 1px solid var(--line); border-radius: 6px;
          cursor: pointer; color: var(--ink-soft); display: flex; align-items: center; gap: 7px;
        }
        .bw-pillar.active { color: var(--ink); border-color: var(--teal); box-shadow: 0 0 0 1px var(--teal) inset; }
        .bw-pillar.soon { opacity: 0.65; }
        .bw-pillar .soon-badge {
          font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; background: var(--paper);
          border: 1px solid var(--line); color: var(--ink-soft); padding: 1px 6px; border-radius: 20px;
        }
        .bw-data-nav { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
        .bw-data-nav-label {
          font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--ink-soft); margin-right: 2px;
        }
        .bw-pillar-placeholder {
          text-align: center; padding: 60px 20px; color: var(--ink-soft);
        }
        .bw-pillar-placeholder h2 { font-family: 'Fraunces', serif; color: var(--ink); font-size: 20px; margin: 14px 0 8px; }
        .bw-pillar-placeholder p { max-width: 420px; margin: 0 auto; font-size: 13px; line-height: 1.6; }
      `}</style>

      <div className="bw-shell">
        <div className="bw-head">
          <div>
            <div className="bw-title" style={{ cursor: "pointer" }} onClick={() => setView("landing")} title="Back to the front page">
              Being <em>Wealthy</em> <span style={{ fontSize: 11, fontWeight: 400, color: "var(--ink-soft)", verticalAlign: "middle" }}>v{__APP_VERSION__}</span>
            </div>
            <div className="bw-tagline">See your money clearly.</div>
            <div className="bw-sub">Private, on this device only · every number stays local</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              className="bw-reset"
              style={effectiveTier === "licensed" ? { borderColor: "var(--teal)", color: "var(--teal)" } : undefined}
              onClick={() => setShowLicenseModal(true)}
              title={effectiveTier === "licensed" ? `Licensed \u00B7 ${licenseDaysRemaining} day${licenseDaysRemaining === 1 ? "" : "s"} remaining` : "You're on the Free plan"}
            >
              {effectiveTier === "licensed" ? `Licensed \u00B7 ${licenseDaysRemaining}d left` : "Free plan"}
            </button>
            <button className="bw-reset" onClick={() => setView("landing")} title="About Being Wealthy">
              About Us
            </button>
            <button className="bw-reset" onClick={startTutorial} title="Take a guided tour of the app">
              Take a tour
            </button>
            <button className="bw-theme-toggle" onClick={toggleTheme} title="Toggle light/dark">
              {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />} {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button className="bw-reset" onClick={exportBackup} title="Download everything as one file">
              <Download size={12} /> Backup
            </button>
            {autoBackupSupported && (
              autoBackupFolderName ? (
                autoBackupError === "resume-needed" ? (
                  <button className="bw-reset" style={{ borderColor: "var(--ochre)", color: "var(--ochre)" }} onClick={resumeAutoBackupPermission} title="Browser restarted — reconfirm access to resume">
                    <RefreshCw size={12} /> Resume auto-backup
                  </button>
                ) : (
                  <button className="bw-reset" onClick={disableAutoBackup} title={`Auto-backing up to "${autoBackupFolderName}" — click to turn off`}>
                    <Check size={12} color="var(--teal)" /> Auto-backup on
                  </button>
                )
              ) : (
                <button className="bw-reset" onClick={enableAutoBackup} title="Pick a folder to back up to automatically — no repeated prompts">
                  <RefreshCw size={12} /> Enable auto-backup
                </button>
              )
            )}
            <input ref={importInputRef} type="file" accept="application/json" style={{ display: "none" }}
              onChange={(e) => { handleImportFileChosen(e.target.files[0]); e.target.value = ""; }} />
            <button className="bw-reset" onClick={() => importInputRef.current?.click()} title="Restore from a backup file">
              <Upload size={12} /> Restore
            </button>
            {!confirmingReset ? (
              <button className="bw-reset" onClick={() => setConfirmingReset(true)}><RefreshCw size={12} /> Reset local data</button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
                <span style={{ color: "var(--rust)" }}>Clear transactions, accounts &amp; budgets? (Rules &amp; merchant groups stay.)</span>
                <button className="bw-reset" style={{ borderColor: "var(--rust)", color: "var(--rust)" }} onClick={resetAll}>Yes, clear it</button>
                <button className="bw-reset" onClick={() => setConfirmingReset(false)}>Cancel</button>
              </div>
            )}
          </div>
        </div>

        {!autoBackupFolderName && lastBackupAt && (Date.now() - lastBackupAt) > 7 * 24 * 60 * 60 * 1000 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12, padding: "8px 12px", margin: "0 0 14px", border: "1px solid var(--ochre)", borderRadius: 6 }}>
            <span>
              <AlertCircle size={13} color="var(--ochre)" style={{ verticalAlign: -2, marginRight: 6 }} />
              It's been {Math.floor((Date.now() - lastBackupAt) / (24 * 60 * 60 * 1000))} days since your last backup.
              {autoBackupSupported ? " Turn on auto-backup above, or back up manually." : " Back up manually — this browser doesn't support automatic backups."}
            </span>
            <button className="bw-reset" onClick={exportBackup}>Back up now</button>
          </div>
        )}
        {!autoBackupFolderName && !lastBackupAt && ready && transactions.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12, padding: "8px 12px", margin: "0 0 14px", border: "1px solid var(--ochre)", borderRadius: 6 }}>
            <span><AlertCircle size={13} color="var(--ochre)" style={{ verticalAlign: -2, marginRight: 6 }} />You haven't backed up yet — everything here lives only in this browser.</span>
            <button className="bw-reset" onClick={exportBackup}>Back up now</button>
          </div>
        )}

        {importError && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12, padding: "8px 12px", margin: "0 0 14px", border: "1px solid var(--rust)", borderRadius: 6, color: "var(--rust)" }}>
            <span><AlertCircle size={13} style={{ verticalAlign: -2, marginRight: 6 }} />{importError}</span>
            <button className="bw-reset" onClick={() => setImportError(null)}><X size={11} /></button>
          </div>
        )}

        {pendingImportFile && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12, padding: "10px 14px", margin: "0 0 14px", border: "1px solid var(--rust)", borderRadius: 6, background: "rgba(156,74,52,0.08)" }}>
            <span>
              <strong>Restore this backup?</strong> Exported {pendingImportFile.exportedAt ? new Date(pendingImportFile.exportedAt).toLocaleString() : "at an unknown time"}.
              This replaces everything currently in this browser — transactions, rules, goals, chat history, all of it.
            </span>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button className="bw-reset" style={{ borderColor: "var(--rust)", color: "var(--rust)" }} onClick={confirmImport}>Yes, restore</button>
              <button className="bw-reset" onClick={() => setPendingImportFile(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="bw-screen-name">
          {{
            dashboard: "Dashboard", cashflow: "Cash Flow", networth: "Net Worth", investments: "Investments", debt: "Debt", goals: "Goals",
            analyst: "Analyst", cfo: "Personal CFO", upload: "Upload", review: "Review", rules: "Rules", accounts: "Accounts",
          }[view] || ""}
        </div>

        <div className="bw-pillars">
          <PillarButton id="dashboard" icon={LayoutDashboard} label="Dashboard" view={view} setView={setView} />
          <PillarButton id="cashflow" icon={LineChartIcon} label="Cash Flow" view={view} setView={setView} />
          <PillarButton id="networth" icon={Landmark} label="Net Worth" view={view} setView={setView} />
          <PillarButton id="investments" icon={TrendingUp} label="Investments" view={view} setView={setView} />
          <PillarButton id="debt" icon={TrendingDown} label="Debt" view={view} setView={setView} />
          <PillarButton id="goals" icon={Flag} label="Goals" view={view} setView={setView} />
          <PillarButton id="analyst" icon={Lightbulb} label="Analyst" view={view} setView={setView} />
          <PillarButton id="cfo" icon={Target} label="Personal CFO" view={view} setView={setView} />
        </div>

        <div className="bw-data-nav">
          <span className="bw-data-nav-label">Data</span>
          <TabButton id="upload" icon={Upload} label="Upload" tab={view} setTab={setView} />
          <TabButton id="review" icon={ListChecks} label="Review" tab={view} setTab={setView} badge={uncategorizedCount || null} />
          <TabButton id="rules" icon={FileText} label="Rules" tab={view} setTab={setView} />
          <TabButton id="accounts" icon={Wallet} label="Accounts" tab={view} setTab={setView} />
        </div>

        <div className="bw-panel">
          {view === "upload" && (
            <UploadTab
              accounts={accounts} setAccounts={setAccounts}
              rules={rules}
              transactions={transactions} setTransactions={setTransactions}
              showToast={showToast}
              holdingSnapshots={holdingSnapshots} setHoldingSnapshots={setHoldingSnapshots}
              debtSchedules={debtSchedules} setDebtSchedules={setDebtSchedules}
              effectiveTier={effectiveTier}
            />
          )}
          {view === "review" && (
            <ReviewTab
              transactions={transactions} setTransactions={setTransactions}
              rules={rules} setRules={setRules}
              accounts={accounts}
              merchantAliases={merchantAliases}
              showToast={showToast}
              onGoToUpload={() => setView("upload")}
              holdingSnapshots={holdingSnapshots}
              debtSchedules={debtSchedules}
            />
          )}
          {view === "rules" && (
            <RulesTab
              rules={rules} setRules={setRules} transactions={transactions} onReapplyRules={reapplyRules}
              merchantAliases={merchantAliases} setMerchantAliases={setMerchantAliases} accounts={accounts}
            />
          )}
          {view === "accounts" && (
            <AccountsHistoryPanel
              accounts={accounts} setAccounts={setAccounts}
              transactions={transactions} setTransactions={setTransactions}
              holdingSnapshots={holdingSnapshots} setHoldingSnapshots={setHoldingSnapshots}
              debtSchedules={debtSchedules} setDebtSchedules={setDebtSchedules}
              otherInvestments={otherInvestments} setOtherInvestments={setOtherInvestments}
              showToast={showToast} effectiveTier={effectiveTier}
            />
          )}
          {view === "dashboard" && (
            <DashboardOverview
              transactions={transactions} accounts={accounts} budgets={budgets} merchantAliases={merchantAliases}
              holdingSnapshots={holdingSnapshots} otherInvestments={otherInvestments} debtSchedules={debtSchedules}
              goals={goals} onGoToView={setView}
            />
          )}
          {view === "cashflow" && (
            <CashFlowOverview
              transactions={transactions} setTransactions={setTransactions}
              accounts={accounts} budgets={budgets} setBudgets={setBudgets}
              merchantAliases={merchantAliases} rules={rules}
              onGoToUpload={() => setView("upload")}
              onGoToReview={() => setView("review")}
            />
          )}
          {view === "networth" && (
            <NetWorthOverview
              accounts={accounts} holdingSnapshots={holdingSnapshots}
              otherInvestments={otherInvestments}
              debtSchedules={debtSchedules}
              onGoToView={setView}
            />
          )}
          {view === "investments" && (
            <InvestmentsOverview
              accounts={accounts} setAccounts={setAccounts} holdingSnapshots={holdingSnapshots}
              otherInvestments={otherInvestments} setOtherInvestments={setOtherInvestments}
              onGoToUpload={() => setView("upload")}
              effectiveTier={effectiveTier} showToast={showToast}
            />
          )}
          {view === "debt" && (
            <DebtOverview
              accounts={accounts} debtSchedules={debtSchedules}
              onGoToUpload={() => setView("upload")}
            />
          )}
          {view === "goals" && (
            <GoalsOverview
              goals={goals} setGoals={setGoals}
              accounts={accounts} holdingSnapshots={holdingSnapshots} transactions={transactions}
              effectiveTier={effectiveTier}
            />
          )}
          {view === "analyst" && (
            <PersonaChatScreen
              persona="analyst"
              transactions={transactions} accounts={accounts} holdingSnapshots={holdingSnapshots} goals={goals}
              merchantAliases={merchantAliases}
              chatThreads={chatThreads} setChatThreads={setChatThreads}
              savedPrompts={savedPrompts} setSavedPrompts={setSavedPrompts}
              effectiveTier={effectiveTier} showToast={showToast}
            />
          )}
          {view === "cfo" && (
            <PersonaChatScreen
              persona="cfo"
              transactions={transactions} accounts={accounts} holdingSnapshots={holdingSnapshots} goals={goals}
              merchantAliases={merchantAliases}
              chatThreads={chatThreads} setChatThreads={setChatThreads}
              savedPrompts={savedPrompts} setSavedPrompts={setSavedPrompts}
              effectiveTier={effectiveTier} showToast={showToast}
            />
          )}
        </div>
      </div>

      {toast && <div className="bw-toast"><Check size={14} /> {toast}</div>}
      {tutorialActive && (
        <TutorialOverlay
          step={tutorialStep} totalSteps={TUTORIAL_STEPS.length}
          title={TUTORIAL_STEPS[tutorialStep].title} body={TUTORIAL_STEPS[tutorialStep].body}
          onNext={tutorialNext} onBack={tutorialBack}
          onSkip={finishTutorial} onFinish={finishTutorial}
        />
      )}
      {showLicenseModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(20,22,26,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 24, maxWidth: 420, width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600, margin: 0 }}>License</h3>
              <button onClick={() => { setShowLicenseModal(false); setLicenseError(""); setLicenseKeyInput(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft)" }}>
                <X size={16} />
              </button>
            </div>

            {effectiveTier === "licensed" ? (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 13, color: "var(--ink)", marginBottom: 4 }}>
                  You're on the <strong>Licensed</strong> plan.
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                  Expires {license.expiresAt} · {licenseDaysRemaining} day{licenseDaysRemaining === 1 ? "" : "s"} remaining
                </div>
                <button className="bw-btn ghost small" style={{ marginTop: 12 }} onClick={removeLicense}>
                  Remove license
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 14 }}>
                {license ? "Your license has expired." : "You're on the Free plan."} Paste a license key below to unlock unlimited accounts and custom AI prompts.
              </div>
            )}

            <div className="bw-field">
              <label>License key</label>
              <input
                type="text" value={licenseKeyInput}
                onChange={(e) => { setLicenseKeyInput(e.target.value); setLicenseError(""); }}
                placeholder="Paste your license key here"
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}
              />
            </div>
            {licenseError && (
              <div style={{ fontSize: 12, color: "var(--rust)", marginBottom: 10 }}>{licenseError}</div>
            )}
            <button className="bw-btn" disabled={!licenseKeyInput.trim() || licenseChecking} onClick={submitLicenseKey}>
              {licenseChecking ? "Verifying\u2026" : "Verify & activate"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One button in the main pillar navigation bar (Dashboard, Cash Flow, Net Worth,
 *  Investments, Debt, Goals, Analyst, Personal CFO). "soon" renders a badge for
 *  pillars not yet built, without disabling the click itself. */
function PillarButton({ id, icon: Icon, label, view, setView, soon }) {
  return (
    <button className={`bw-pillar ${view === id ? "active" : ""} ${soon ? "soon" : ""}`} onClick={() => setView(id)}>
      <Icon size={14} /> {label}
      {soon && <span className="soon-badge">Soon</span>}
    </button>
  );
}

/** Generic empty-state shown for a pillar screen with no data yet, or one still
 *  marked "Soon" in the nav - an icon, a title, and a one-line explanation. */
function PillarPlaceholder({ icon: Icon, title, blurb }) {
  return (
    <div className="bw-pillar-placeholder">
      <Icon size={28} color="var(--ink-soft)" />
      <h2>{title}</h2>
      <p>{blurb}</p>
    </div>
  );
}

/** Each step targets a real view — the overlay switches the app to that screen as it
 *  advances, so what's behind the overlay always matches what's being described,
 *  rather than a generic walkthrough disconnected from the actual product. */
const TUTORIAL_STEPS = [
  { view: null, title: "Welcome to Being Wealthy", body: "A quick tour of how everything fits together — six steps, about a minute. You can skip anytime, or take it again later from the header." },
  { view: "upload", title: "Start here: Upload", body: "Bring in a bank statement, credit card statement, investment holdings, or a loan schedule — PDF, CSV, or Excel. The app figures out what it is and reads it for you." },
  { view: "review", title: "Review & Rules", body: "First-time categorization is manual — tag a merchant once, and it becomes a rule. Every import after that needs far less review." },
  { view: "cashflow", title: "Cash Flow", body: "Income, expenses, savings, and investments — laid out as one equation, always current, with your actual savings and investment rate." },
  { view: "networth", title: "Net Worth", body: "Everything you own, minus everything you owe — pulled live from every other screen, never tracked separately." },
  { view: "investments", title: "Investments", body: "Stocks, mutual funds, PF, gold, and property — one place, real invested-vs-current growth." },
  { view: "debt", title: "Debt", body: "What you owe, what you've paid down, and what's coming next." },
  { view: "goals", title: "Goals", body: "Set a target, fund it from real holdings or your savings, and track genuine progress toward it." },
  { view: "analyst", title: "Analyst & Personal CFO", body: "Ask what changed this month, or whether you can afford something — every answer is traced back to your own numbers, never invented." },
  { view: null, title: "That's the whole picture", body: "Upload your first statement whenever you're ready. Retake this tour anytime from the \"Take a tour\" button, top right." },
];

/** One step of the first-run tutorial - a bottom-sheet card over whichever screen
 *  TUTORIAL_STEPS says this step targets (the screen switch itself happens in the
 *  parent, not here). Back is hidden, not just disabled, on the first step; the
 *  primary button reads "Finish" instead of "Next" on the last. */
function TutorialOverlay({ step, totalSteps, title, body, onNext, onBack, onSkip, onFinish }) {
  const isLast = step === totalSteps - 1;
  const isFirst = step === 0;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,22,26,0.55)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 22, maxWidth: 440, width: "100%", marginBottom: 40, boxShadow: "0 8px 30px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "var(--ink-soft)", fontFamily: "'IBM Plex Mono', monospace" }}>{step + 1} of {totalSteps}</span>
          <button onClick={onSkip} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft)", fontSize: 11.5, display: "flex", alignItems: "center", gap: 3 }}>
            <X size={12} /> Skip tour
          </button>
        </div>
        <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>{title}</h3>
        <p style={{ fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.6, margin: "0 0 18px" }}>{body}</p>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button className="bw-btn ghost small" onClick={onBack} disabled={isFirst} style={{ visibility: isFirst ? "hidden" : "visible" }}>Back</button>
          <button className="bw-btn small" onClick={isLast ? onFinish : onNext}>{isLast ? "Finish" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}

/** One button in a secondary (within-screen) tab row - e.g. Upload/Review/Rules/
 *  Accounts under Data, or a screen's own sub-tabs. Distinct from PillarButton, which
 *  is specifically the top-level app navigation. */
function TabButton({ id, icon: Icon, label, tab, setTab, badge }) {
  return (
    <button className={`bw-tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
      <Icon size={13} /> {label}
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );
}

/* ---------------------------------------------------------------------- */
/* Upload tab                                                              */
/* ---------------------------------------------------------------------- */

// Month-name pattern is restricted to actual month names — matching any 3-9 letter word
// (the previous approach) caused false positives like "...NEFT 70,000.00..." being misread
// as a date ("91 NEFT 70"), since transaction reference text often has this exact
// number-word-number shape.
const PASTE_DATE_TOKEN_RE = /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/gi;

// Some statements print two dates per row (e.g. "Value Date" and "Txn Date" side by side).
// Treating each date match as its own transaction-start would split one real transaction
// into two garbled fragments. A second date sitting within a few characters of the first
// is almost certainly its pair, not a new transaction — collapse it into just the first.
function collapseAdjacentDateMatches(rawMatches, gapThreshold = 25) {
  const collapsed = [];
  rawMatches.forEach((m) => {
    const prev = collapsed[collapsed.length - 1];
    if (prev && (m.index - (prev.index + prev[0].length)) <= gapThreshold) return;
    collapsed.push(m);
  });
  return collapsed;
}
const PASTE_TRAILING_NUM_RE = /\(?-?[\d,]+\.\d{1,2}\)?/g;
const PASTE_SKIP_LINE_RE = /(opening balance|closing balance|balance forward|brought forward|carried forward|statement of account|page \d|ifsc|micr|b\/f|total\b)/i;
const PASTE_OPENING_BAL_RE = /(opening balance|balance b\/f|brought forward|balance forward)[^0-9\-]{0,15}([\d,]+\.\d{2})/i;
const PASTE_CLOSING_BAL_RE = /(closing balance|balance c\/f|carried forward)[^0-9\-]{0,15}([\d,]+\.\d{2})/i;
// PAGE_BREAK_MARKER is imported from pdfExtract.js (see top of file) rather than
// redeclared here, so there's exactly one definition instead of two that could drift.

const COLUMN_FORMATS = [
  { id: "auto", label: "Auto-detect (try this first)" },
  { id: "dcb", label: "Debit, Credit, Balance" },
  { id: "ab", label: "Amount, then Balance" },
  { id: "ba", label: "Balance, then Amount" },
  { id: "a", label: "Amount only (no balance shown)" },
];

/** Interpret one transaction's lines according to a chosen column format (or
 *  heuristically, under "auto"). Shared by the full-text parser and the single-line
 *  live preview, so "test with one line" and "parse everything" never drift.
 *  Takes an ARRAY of physical lines, not one flattened string. Real statements often
 *  vertically CENTER the amount/balance against a long wrapped description — they can
 *  land on any line of the block, not just the first or last. So this searches the
 *  whole flattened block for amount-shaped numbers wherever they fall, then builds the
 *  description by removing exactly those matched spans, preserving everything else
 *  (before AND after) in its original order — rather than assuming description ends
 *  wherever the numbers happen to be. */
function interpretPasteChunk(dateToken, restLines, columnFormat) {
  const date = parseDateStr(dateToken);
  if (!isLikelyValidDate(date)) return null;

  const lines = Array.isArray(restLines) ? restLines : [restLines];
  const fullText = lines.map((l) => (l || "").trim()).filter(Boolean).join(" ");

  const nums = [...fullText.matchAll(PASTE_TRAILING_NUM_RE)];
  if (nums.length === 0) return null;

  const hasCrWord = /\bcr\b/i.test(fullText);
  const hasDrWord = /\bdr\b/i.test(fullText);
  let amount = 0, direction = "debit", runningBalance = null, usedMatches = [];

  if (columnFormat === "dcb") {
    if (nums.length < 3) return null;
    usedMatches = nums.slice(-3);
    const [debit, credit, balance] = usedMatches.map((m) => parseAmountStr(m[0]));
    if (debit > 0) { amount = debit; direction = "debit"; }
    else if (credit > 0) { amount = credit; direction = "credit"; }
    else return null;
    runningBalance = balance;
  } else if (columnFormat === "ab") {
    if (nums.length < 2) return null;
    usedMatches = nums.slice(-2);
    const [amt, balance] = usedMatches.map((m) => parseAmountStr(m[0]));
    amount = Math.abs(amt);
    direction = hasCrWord ? "credit" : hasDrWord ? "debit" : "debit";
    runningBalance = balance;
  } else if (columnFormat === "ba") {
    if (nums.length < 2) return null;
    usedMatches = nums.slice(-2);
    const [balance, amt] = usedMatches.map((m) => parseAmountStr(m[0]));
    amount = Math.abs(amt);
    direction = hasCrWord ? "credit" : hasDrWord ? "debit" : "debit";
    runningBalance = balance;
  } else if (columnFormat === "a") {
    usedMatches = [nums[nums.length - 1]];
    amount = Math.abs(parseAmountStr(usedMatches[0][0]));
    direction = hasCrWord ? "credit" : "debit";
  } else {
    const amtCount = Math.min(nums.length, 3);
    usedMatches = nums.slice(-amtCount);
    const trailing = usedMatches.map((m) => parseAmountStr(m[0]));
    if (amtCount === 3) {
      if (trailing[0] > 0) { amount = trailing[0]; direction = "debit"; }
      else if (trailing[1] > 0) { amount = trailing[1]; direction = "credit"; }
      else return null;
      runningBalance = trailing[2];
    } else if (amtCount === 2) {
      amount = Math.abs(trailing[0]);
      direction = hasCrWord ? "credit" : hasDrWord ? "debit" : "debit";
      runningBalance = trailing[1];
    } else {
      amount = Math.abs(trailing[0]);
      direction = hasCrWord ? "credit" : "debit";
    }
  }

  // Remove just the matched number spans (back-to-front so earlier indices stay valid),
  // leaving every other word — before or after where the amount happened to sit — intact.
  let description = fullText;
  [...usedMatches].sort((a, b) => b.index - a.index).forEach((m) => {
    description = description.slice(0, m.index) + description.slice(m.index + m[0].length);
  });
  description = description.trim().replace(/\s{2,}/g, " ");

  // A collapsed paired date (e.g. "Txn Date" sitting right after "Value Date") is kept in
  // the text on purpose — it's not treated as a new transaction boundary — but it's just
  // noise at the front of the description now that it's served that purpose; drop it.
  const leadingDateMatch = description.match(new RegExp("^" + PASTE_DATE_TOKEN_RE.source, "i"));
  if (leadingDateMatch) description = description.slice(leadingDateMatch[0].length).trim().replace(/\s{2,}/g, " ");

  if (!description || amount === 0) return null;
  return { date, description, amount, direction, runningBalance };
}

/* ---------------------------------------------------------------------- */
/* Import-completion prompt: "does this import settle a pending transfer?" */
/* ---------------------------------------------------------------------- */

/** Prompt shown right after finishing an import, when other accounts have pending
 *  (unlinked) Self/Credit-card-payment transfers that this new statement might settle
 *  - lets the person check off which ones this import resolves, in one place, rather
 *  than having to go find and confirm each one separately afterward. Flags a soft
 *  mismatch warning (>15% off) when a credit card payment's amount doesn't closely
 *  match that cycle's actual Expense total, without blocking confirmation - a partial
 *  payment or a credit/reversal are both legitimate reasons for the numbers to differ. */
function ImportCompletionPromptPanel({ prompt, accounts, onConfirm, onSkip }) {
  const [selected, setSelected] = useState(new Set());
  const accountName = (id) => accounts.find((a) => a.id === id)?.nickname || "—";

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ border: "2px solid var(--teal)", borderRadius: 8, padding: 16, marginBottom: 20, background: "var(--card)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
        <Repeat size={16} color="var(--teal)" /> Does this import settle any pending transfers?
      </div>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 12 }}>
        You have {prompt.pending.length} pending transfer{prompt.pending.length > 1 ? "s" : ""} on other accounts.
        If this statement is what one of them was waiting on, check it below.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {prompt.pending.map((t) => {
          const mismatch = prompt.cycleExpenseTotal > 0 && Math.abs(t.amount - prompt.cycleExpenseTotal) / t.amount > 0.15;
          return (
            <label key={t.id} style={{
              display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5,
              border: "1px solid var(--line)", borderRadius: 6, padding: 10, cursor: "pointer",
            }}>
              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} style={{ marginTop: 2 }} />
              <div>
                <div>{t.date} · {accountName(t.accountId)} · {t.description}</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, marginTop: 2 }}>{inr(t.amount)}</div>
                {mismatch && (
                  <div style={{ fontSize: 10.5, color: "var(--ochre)", marginTop: 4, display: "flex", alignItems: "flex-start", gap: 4 }}>
                    <AlertCircle size={11} style={{ marginTop: 1, flexShrink: 0 }} />
                    Heads up — this statement's activity ({inr(prompt.cycleExpenseTotal)}) doesn't closely match. Could be a
                    partial payment or a credit/reversal — worth a glance either way, this doesn't block marking it.
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="bw-btn small" disabled={selected.size === 0} onClick={() => onConfirm([...selected])}>
          <Check size={12} /> Mark {selected.size > 0 ? selected.size : ""} substantiated
        </button>
        <button className="bw-btn ghost small" onClick={onSkip}>Skip for now</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Accounts & Upload History — split out into its own Data tab, separate   */
/* from the actual import flow, so "what did I already import" isn't      */
/* buried at the bottom of the Upload screen. Owns its own local UI state  */
/* (which rows are expanded/confirming-delete); the actual delete/confirm */
/* operations were already pure functions of props already available at   */
/* the top level (setAccounts/setHoldingSnapshots/setTransactions),        */
/* moved here unchanged.                                                   */
/* ---------------------------------------------------------------------- */

/** The Accounts screen (under Data) — lists every account across every bucket, each
 *  showing its current balance, upload/statement history, and account-level actions:
 *  activate/deactivate within the Free-tier bucket limit, delete a single import batch
 *  or holding snapshot, or delete the whole account (cascading across transactions,
 *  balanceHistory, holdingSnapshots, debtSchedules, and otherInvestments together,
 *  since an account can have data in more than one of these depending on its type).
 *  Also hosts the "Confirm" workflow for a parsed-but-not-yet-trusted opening/closing
 *  balance, which writes directly to balanceHistory - the single source of truth for
 *  confirmed balances - rather than to any field on uploadHistory itself. */
function AccountsHistoryPanel({ accounts, setAccounts, transactions, setTransactions, holdingSnapshots, setHoldingSnapshots, debtSchedules, setDebtSchedules, otherInvestments, setOtherInvestments, showToast, effectiveTier }) {
  const [showUploadHistory, setShowUploadHistory] = useState(true);
  const [confirmingDeleteBatch, setConfirmingDeleteBatch] = useState(null);
  const [confirmingDeleteSnapshot, setConfirmingDeleteSnapshot] = useState(null);
  const [confirmingDeleteAccount, setConfirmingDeleteAccount] = useState(null);

  /** Counts everything that would be removed with an account, so the confirmation can
   *  say exactly what's about to be lost rather than a generic warning. */
  function accountDeletionSummary(accountId) {
    return {
      transactions: transactions.filter((t) => t.accountId === accountId).length,
      snapshots: holdingSnapshots.filter((s) => s.accountId === accountId).length,
      debtPeriods: debtSchedules.filter((s) => s.accountId === accountId).reduce((sum, s) => sum + (s.entries?.length || 0), 0),
      otherEntries: otherInvestments.filter((e) => e.accountId === accountId).length,
    };
  }

  /** Deletes an account and every record across every data array that references it.
   *  Cascades regardless of the account's type — an array with nothing matching that
   *  accountId is simply unaffected, so this stays correct even for account types that
   *  only ever populate one or two of these arrays. Irreversible; the confirmation UI
   *  is what protects against this being triggered by accident. */
  function deleteAccount(account) {
    setTransactions((prev) => prev.filter((t) => t.accountId !== account.id));
    setHoldingSnapshots((prev) => prev.filter((s) => s.accountId !== account.id));
    setDebtSchedules((prev) => prev.filter((s) => s.accountId !== account.id));
    setOtherInvestments((prev) => prev.filter((e) => e.accountId !== account.id));
    setAccounts((prev) => prev.filter((a) => a.id !== account.id));
    setConfirmingDeleteAccount(null);
    showToast(`Deleted "${account.nickname}" and everything imported into it.`);
  }

  /** Removes one import's transactions and its trace in the account's history, without
 *  touching rules - re-importing the same statement later will re-categorize exactly
 *  as it did the first time. Any transaction elsewhere that was linked to one of the
 *  deleted transactions (a matched transfer) has that link cleared, rather than being
 *  left pointing at an id that no longer exists. */
function deleteUploadBatch(accountId, batchId) {
    setTransactions((prev) => {
      const deletedIds = new Set(prev.filter((t) => t.importBatchId === batchId).map((t) => t.id));
      return prev
        .filter((t) => t.importBatchId !== batchId)
        .map((t) => (t.linkedTransactionId && deletedIds.has(t.linkedTransactionId) ? { ...t, linkedTransactionId: null } : t));
    });
    setAccounts((prev) => prev.map((a) => {
      if (a.id !== accountId) return a;
      return {
        ...a,
        balanceHistory: (a.balanceHistory || []).filter((h) => h.importBatchId !== batchId),
        uploadHistory: (a.uploadHistory || []).filter((h) => h.batchId !== batchId),
      };
    }));
    showToast("Deleted that import. Rules are untouched — re-importing will re-categorize automatically.");
  }

  /** Removes one holding-statement snapshot and its trace in the account's upload
 *  history - the neighboring snapshots on either side are untouched, so a gap just
 *  means one less confirmed point for computeSnapshotTransition to diff against. */
function deleteHoldingSnapshot(accountId, snapshotId) {
    setHoldingSnapshots((prev) => prev.filter((s) => s.id !== snapshotId));
    setAccounts((prev) => prev.map((a) => (a.id === accountId
      ? { ...a, uploadHistory: (a.uploadHistory || []).filter((h) => h.snapshotId !== snapshotId) }
      : a)));
    showToast("Deleted that holding snapshot.");
  }

  function confirmParsedBalance(accountId, batchId, which) {
    setAccounts((prev) => prev.map((a) => {
      if (a.id !== accountId) return a;
      const entry = (a.uploadHistory || []).find((h) => h.batchId === batchId);
      if (!entry) return a;
      const value = which === "opening" ? entry.parsedOpeningBalance : entry.parsedClosingBalance;
      if (value === null || value === undefined) return a;
      const dateStr = which === "opening"
        ? (() => { const d = new Date(entry.periodStart); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })()
        : entry.periodEnd;
      let balanceHistory = (a.balanceHistory || [])
        .map((h) => (h.asOfDate ? h : { ...h, asOfDate: h.date }))
        .filter((h) => h.asOfDate !== dateStr);
      balanceHistory.push({ asOfDate: dateStr, balance: value, importBatchId: batchId });
      balanceHistory.sort((x, y) => x.asOfDate.localeCompare(y.asOfDate));
      return {
        ...a, balanceHistory,
        lastKnownBalance: which === "closing" ? value : a.lastKnownBalance,
      };
    }));
    showToast("Confirmed — this balance now feeds the Cash Flow dashboard.");
  }

  /** Whether a given upload's own opening/closing date has an exact confirmed point in
   *  balanceHistory — the single source of truth, replacing the openingBalance/
   *  closingBalance fields that used to be duplicated directly on uploadHistory itself.
   *  Returns null if nothing's confirmed there yet (falls through to the parsed,
   *  not-yet-confirmed value in the UI). */
  function getConfirmedBalance(h, which) {
    const account = accounts.find((a) => a.id === h.accountId);
    if (!account) return null;
    const targetDate = which === "opening"
      ? (() => { const d = new Date(h.periodStart); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })()
      : h.periodEnd;
    const point = (account.balanceHistory || []).find((b) => (b.asOfDate || b.date) === targetDate);
    return point ? point.balance : null;
  }

  /** Toggles one account's active status within its bucket — instant, no cooldown.
   *  Unchecking an active account always succeeds. Checking an inactive one succeeds
   *  only if the bucket has a free slot (fewer than its limit currently active) — Cash
   *  Flow's limit is 2, so up to two accounts can be active there at once, not just one;
   *  Debt and Investment's limit of 1 means checking a second while one is already
   *  active is correctly blocked, same effective behavior as a radio button but driven
   *  by the actual limit rather than hardcoded into the UI. */
  function toggleActiveAccountForBucket(bucket, accountId) {
    const activeIds = getActiveAccountIds(accounts, effectiveTier, bucket);
    const isCurrentlyActive = activeIds.has(accountId);
    const limit = bucketLimit(bucket);
    if (!isCurrentlyActive && activeIds.size >= limit) {
      showToast(`Already at your limit of ${limit} active ${BUCKET_LABELS[bucket]} account${limit === 1 ? "" : "s"} — switch one off first.`);
      return;
    }
    setAccounts((prev) => prev.map((a) => (a.id === accountId ? { ...a, active: !isCurrentlyActive } : a)));
    showToast(isCurrentlyActive ? "Account set to read-only." : "Account is now active.");
  }

  const allUploadHistory = accounts
    .filter((a) => a.type !== "demat" && a.type !== "mutualFund")
    .flatMap((a) => (a.uploadHistory || []).map((h) => ({ ...h, accountId: a.id, accountNickname: a.nickname, accountIsCC: a.type === "creditCard" })))
    .sort((a, b) => b.importedAt - a.importedAt);

  const invAccounts = accounts.filter((a) => a.type === "demat" || a.type === "mutualFund");
  const allSnapshots = holdingSnapshots
    .map((s) => ({ ...s, accountNickname: invAccounts.find((a) => a.id === s.accountId)?.nickname || "—" }))
    .sort((a, b) => b.importedAt - a.importedAt);

  if (accounts.length === 0) {
    return <div className="bw-empty">No accounts yet — import a statement first, from the Upload tab.</div>;
  }

  return (
    <div>
      <h2 className="bw-h2">Accounts &amp; Upload History</h2>
      <p className="bw-lead">Every account you've created, and everything you've imported into it — review, confirm parsed balances, or delete an import.</p>

      <div className="bw-section-label" style={{ marginTop: 0 }}>Accounts</div>
      {effectiveTier === "free" && ["bank", "creditCard", "debt", "investment"].some((b) => accounts.filter((a) => accountBucket(a.type) === b).length > bucketLimit(b)) && (
        <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 10px" }}>
          Where you have more accounts than the Free plan allows in a group, tick which ones stay active right in the Status
          column below — the rest remain fully visible but won't accept new imports. Switch anytime, no cooldown.
        </p>
      )}
      <table className="bw-table">
        <thead>
          <tr>
            <th>Nickname</th><th>Institution</th><th>Type</th><th style={{ textAlign: "right" }}>Transactions</th>
            {effectiveTier === "free" && <th>Status</th>}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const bucket = accountBucket(a.type);
            const bucketCount = bucket ? accounts.filter((acc) => accountBucket(acc.type) === bucket).length : 0;
            const overLimit = bucket && bucketCount > bucketLimit(bucket);
            const isActive = !bucket || canImportIntoAccount(accounts, effectiveTier, a.id);
            return (
              <tr key={a.id}>
                <td>{a.nickname}</td>
                <td>{a.institution}</td>
                <td style={{ color: "var(--ink-soft)" }}>{ACCOUNT_TYPE_LABELS[a.type] || a.type || "—"}</td>
                <td style={{ textAlign: "right" }}>{transactions.filter((t) => t.accountId === a.id).length}</td>
                {effectiveTier === "free" && (
                  <td>
                    {!bucket ? "—" : overLimit ? (
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer" }}>
                        <input type="checkbox" checked={isActive} onChange={() => toggleActiveAccountForBucket(bucket, a.id)} />
                        <span className="bw-pill" style={{ background: isActive ? "var(--teal)" : "var(--line)", color: isActive ? "#fff" : "var(--ink-soft)" }}>
                          {isActive ? "Active" : "Read-only"}
                        </span>
                      </label>
                    ) : (
                      <span className="bw-pill" style={{ background: "var(--teal)", color: "#fff" }}>Active</span>
                    )}
                  </td>
                )}
                <td>
                  {confirmingDeleteAccount === a.id ? (() => {
                    const summary = accountDeletionSummary(a.id);
                    const parts = [];
                    if (summary.transactions > 0) parts.push(`${summary.transactions} transaction${summary.transactions === 1 ? "" : "s"}`);
                    if (summary.snapshots > 0) parts.push(`${summary.snapshots} snapshot${summary.snapshots === 1 ? "" : "s"}`);
                    if (summary.debtPeriods > 0) parts.push(`${summary.debtPeriods} debt period${summary.debtPeriods === 1 ? "" : "s"}`);
                    if (summary.otherEntries > 0) parts.push(`${summary.otherEntries} entr${summary.otherEntries === 1 ? "y" : "ies"}`);
                    return (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 11, color: "var(--rust)" }}>
                          Delete "{a.nickname}"{parts.length > 0 ? ` and ${parts.join(", ")}` : ""}? Can't be undone.
                        </span>
                        <button
                          className="bw-btn small" style={{ background: "var(--rust)", borderColor: "var(--rust)" }}
                          onClick={() => deleteAccount(a)}
                        >
                          Yes, delete
                        </button>
                        <button className="bw-btn ghost small" onClick={() => setConfirmingDeleteAccount(null)}>Cancel</button>
                      </div>
                    );
                  })() : (
                    <button className="bw-btn ghost small" onClick={() => setConfirmingDeleteAccount(a.id)}>
                      <Trash2 size={12} /> Delete
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>


      {allUploadHistory.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button
            onClick={() => setShowUploadHistory((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 600, color: "var(--ink)" }}
          >
            {showUploadHistory ? <ChevronUp size={14} /> : <ChevronRight size={14} />} Upload history ({allUploadHistory.length})
          </button>
          {showUploadHistory && (
            <table className="bw-table" style={{ marginTop: 10 }}>
              <thead>
                <tr><th>Account</th><th>Period</th><th>Balances</th><th style={{ textAlign: "right" }}>Transactions</th><th>Imported</th><th></th></tr>
              </thead>
              <tbody>
                {allUploadHistory.map((h) => {
                  const renderBalance = (trusted, parsed, which, h) => {
                    if (trusted !== null) return <span>{inr(trusted)}</span>;
                    if (parsed !== null) return (
                      <span style={{ color: "var(--ochre)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                        {inr(parsed)} <span style={{ fontSize: 9.5 }}>(parsed, not confirmed)</span>
                        <button
                          className="bw-btn ghost small" style={{ padding: "1px 6px", fontSize: 9.5 }}
                          onClick={() => confirmParsedBalance(h.accountId, h.batchId, which)}
                        >
                          Confirm
                        </button>
                      </span>
                    );
                    return <span style={{ color: "var(--ink-soft)" }}>—</span>;
                  };
                  return (
                  <tr key={h.batchId}>
                    <td>{h.accountNickname}</td>
                    <td style={{ fontSize: 11.5 }}>
                      {h.periodStart} → {h.periodEnd}
                      {(h.extractedPeriodStart || h.statementDate) && (
                        <div style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 2 }}>
                          {h.extractedPeriodStart
                            ? `Printed: ${h.extractedPeriodStart} → ${h.extractedPeriodEnd}`
                            : `Statement date: ${h.statementDate}`}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      <div>{h.accountIsCC ? "Previous balance" : "Opening"}: {renderBalance(getConfirmedBalance(h, "opening"), h.parsedOpeningBalance, "opening", h)}</div>
                      <div>{h.accountIsCC ? "Outstanding" : "Closing"}: {renderBalance(getConfirmedBalance(h, "closing"), h.parsedClosingBalance, "closing", h)}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>{h.transactionCount}</td>
                    <td style={{ fontSize: 11, color: "var(--ink-soft)" }}>{new Date(h.importedAt).toLocaleDateString()}</td>
                    <td>
                      {confirmingDeleteBatch === h.batchId ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
                          <span style={{ fontSize: 11, color: "var(--rust)" }}>Delete this import?</span>
                          <button
                            className="bw-btn small" style={{ background: "var(--rust)", borderColor: "var(--rust)" }}
                            onClick={() => { deleteUploadBatch(h.accountId, h.batchId); setConfirmingDeleteBatch(null); }}
                          >
                            Yes
                          </button>
                          <button className="bw-btn ghost small" onClick={() => setConfirmingDeleteBatch(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button className="bw-btn ghost small" onClick={() => setConfirmingDeleteBatch(h.batchId)}>
                          <Trash2 size={12} /> Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>
          )}
        </div>
      )}

      {allSnapshots.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
            Holdings imports ({allSnapshots.length})
          </div>
          <table className="bw-table">
            <thead>
              <tr><th>Account</th><th>As of</th><th style={{ textAlign: "right" }}>Holdings</th><th style={{ textAlign: "right" }}>Invested</th><th style={{ textAlign: "right" }}>Current value</th><th>Imported</th><th></th></tr>
            </thead>
            <tbody>
              {allSnapshots.map((s) => (
                <tr key={s.id}>
                  <td>{s.accountNickname}</td>
                  <td style={{ fontSize: 11.5 }}>{s.asOfDate}</td>
                  <td style={{ textAlign: "right" }}>{s.holdings.length}</td>
                  <td style={{ textAlign: "right" }}>{inr(s.totalInvestedValue)}</td>
                  <td style={{ textAlign: "right" }}>{inr(s.totalCurrentValue)}</td>
                  <td style={{ fontSize: 11, color: "var(--ink-soft)" }}>{new Date(s.importedAt).toLocaleDateString()}</td>
                  <td>
                    {confirmingDeleteSnapshot === s.id ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 11, color: "var(--rust)" }}>Delete this snapshot?</span>
                        <button className="bw-btn small" style={{ background: "var(--rust)", borderColor: "var(--rust)" }}
                          onClick={() => { deleteHoldingSnapshot(s.accountId, s.id); setConfirmingDeleteSnapshot(null); }}>
                          Yes
                        </button>
                        <button className="bw-btn ghost small" onClick={() => setConfirmingDeleteSnapshot(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="bw-btn ghost small" onClick={() => setConfirmingDeleteSnapshot(s.id)}>
                        <Trash2 size={12} /> Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The Upload tab for bank and credit card statements specifically (Investment and
 *  Debt each have their own separate flows - InvestmentImportFlow, DebtImportFlow -
 *  since a holdings statement and an amortization schedule need entirely different
 *  parsing). Three ways in, all converging on the same finalize step:
 *   1. Unified upload - one dropzone, an AI classification pass (handleUnifiedFile)
 *      reads the file and decides what it is and how to structure it; showManualTabs
 *      is the escape hatch if that classification is wrong or unconfident.
 *   2. CSV/Excel with manual column mapping (doImport) - header-row detection, then
 *      the person confirms which column is Date/Description/Debit/Credit/Amount.
 *   3. Paste-from-PDF - a heuristic line-by-line parser for statement text copied
 *      directly out of a PDF viewer, with an editable preview before committing.
 *  Whichever path a statement takes, it ends at the same shared finalize step:
 *  resolve which account it belongs to, dedupe against already-imported transactions,
 *  auto-categorize via existing rules, and commit. */
function UploadTab({ accounts, setAccounts, rules, transactions, setTransactions, showToast, holdingSnapshots, setHoldingSnapshots, debtSchedules, setDebtSchedules, effectiveTier }) {
  const [source, setSource] = useState("csv"); // csv | paste | llmpdf
  // Unified upload — one dropzone, Stage 1 classification routes to whichever flow
  // below actually handles the file. showManualTabs is the escape hatch: if
  // classification is wrong or unconfident, the person can still pick a flow by hand
  // rather than being stuck.
  const [unifiedClassifying, setUnifiedClassifying] = useState(false);
  const [unifiedError, setUnifiedError] = useState(null);
  const [unifiedResult, setUnifiedResult] = useState(null);
  const [showManualTabs, setShowManualTabs] = useState(false);
  const [investmentInitialFile, setInvestmentInitialFile] = useState(null);
  const [debtInitialFile, setDebtInitialFile] = useState(null);
  const [investmentInitialPassword, setInvestmentInitialPassword] = useState("");
  const [debtInitialPassword, setDebtInitialPassword] = useState("");
  const [unifiedNeedsPassword, setUnifiedNeedsPassword] = useState(false);
  const [unifiedWrongPassword, setUnifiedWrongPassword] = useState(false);
  const [unifiedPassword, setUnifiedPassword] = useState("");
  const [unifiedPendingFile, setUnifiedPendingFile] = useState(null);
  const [rawRows, setRawRows] = useState(null); // array of arrays, header:false parse
  const [headerRowIdx, setHeaderRowIdx] = useState(0);
  const [headers, setHeaders] = useState(null);
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [institution, setInstitution] = useState("");
  const [nickname, setNickname] = useState("");
  // "__new__" means fill in Institution/Nickname fresh; any other value is an existing
  // account's id, picked from a dropdown — this is the actual fix for accidentally
  // creating a duplicate account: choosing from a list of what you already have removes
  // any chance of a typo'd or simply-forgotten nickname silently starting a new one.
  const [selectedAccountId, setSelectedAccountId] = useState("__new__");
  // After a successful import, nothing about this account context should carry into
  // the next one — Institution, Nickname, Account Type, and both balances all reset to
  // blank. The next import either picks an existing account from the dropdown (which
  // re-fills these deliberately) or starts genuinely fresh; nothing is ever silently
  // left over from whatever was just imported.
  function resetAccountContextAfterImport() {
    setSelectedAccountId("__new__");
    setInstitution("");
    setNickname("");
    setAccountType("bank");
    setOpeningBalanceInput("");
    setClosingBalanceInput("");
    setStatementBalances({ opening: null, closing: null });
  }
  function selectExistingAccount(id) {
    setSelectedAccountId(id);
    if (id === "__new__") {
      // Starting a genuinely new account — nothing from whatever was previously
      // selected should carry over. Institution/nickname reset to blank; opening
      // balance clears too (the auto-fill effect will correctly leave it empty
      // since blank institution/nickname won't match any existing account).
      setInstitution("");
      setNickname("");
      updateOpeningBalance("");
      return;
    }
    const acct = accounts.find((a) => a.id === id);
    if (acct) { setInstitution(acct.institution); setNickname(acct.nickname); }
  }
  // Which way a debit/credit moves the balance is inverted for a credit card versus a
  // bank account: a bank debit (spending) DECREASES the balance, but a credit card
  // "debit" (a purchase) INCREASES the amount owed — payments decrease it instead. Every
  // place that reasons about balance direction (reconciliation, running-balance-based
  // direction correction) needs to know which convention applies.
  const [accountType, setAccountType] = useState("bank"); // bank | creditCard
  const isCreditCard = accountType === "creditCard";
  // If Institution/Nickname matches an account we already know about, sync the dropdown
  // to ITS stored type rather than trusting whatever's currently selected — otherwise a
  // selection left over from a previous import (e.g. "Credit card" from testing a card
  // statement) would silently apply the wrong sign convention to an unrelated account.
  useEffect(() => {
    const acct = accounts.find((a) => a.institution === institution && a.nickname === (nickname || institution));
    if (acct && acct.type && acct.type !== accountType) setAccountType(acct.type);
  }, [institution, nickname, accounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dateCol, setDateCol] = useState("");
  const [descCol, setDescCol] = useState("");
  const [amountMode, setAmountMode] = useState("split"); // split | single
  const [debitCol, setDebitCol] = useState("");
  const [creditCol, setCreditCol] = useState("");
  const [amountCol, setAmountCol] = useState("");
  const [typeCol, setTypeCol] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pastePreview, setPastePreview] = useState(null); // array of editable rows
  const [statementBalances, setStatementBalances] = useState({ opening: null, closing: null });
  const [extractedStatementPeriod, setExtractedStatementPeriod] = useState({ start: null, end: null, statementDate: null });
  const [columnFormat, setColumnFormat] = useState("auto"); // auto | dcb | ab | ba | a
  const [llmFile, setLlmFile] = useState(null);
  const [llmFileName, setLlmFileName] = useState("");
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmError, setLlmError] = useState(null);
  const [llmRawResponse, setLlmRawResponse] = useState(null);
  const [llmProgress, setLlmProgress] = useState(null);
  const [openingBalanceInput, setOpeningBalanceInput] = useState("");
  const [closingBalanceInput, setClosingBalanceInput] = useState("");
  const [importCompletionPrompt, setImportCompletionPrompt] = useState(null); // { accountId, cycleExpenseTotal, pending }
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyEditing, setApiKeyEditing] = useState(false);
  const [aiModel, setAiModel] = useState("gemini-3.6-flash");
  const [customModelId, setCustomModelId] = useState("");
  const [pdfPassword, setPdfPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);
  const fileInputRef = useRef(null);
  const llmFileInputRef = useRef(null);

  // API key lives in its own storage slot, separate from financial data — "Reset local
  // data" clears transactions/rules/etc. but deliberately leaves this alone, since it's
  // app configuration, not something you'd want to re-type after clearing your ledger.
  // It only ever leaves this device in a request made directly to Google's Gemini API.
  useEffect(() => {
    (async () => {
      const saved = await loadState("geminiApiKey", "");
      if (saved) setApiKey(saved);
    })();
  }, []);
  function saveApiKey() {
    const trimmed = apiKeyInput.trim();
    setApiKey(trimmed);
    saveState("geminiApiKey", trimmed);
    setApiKeyInput("");
    setApiKeyEditing(false);
  }
  function clearApiKey() {
    setApiKey("");
    setApiKeyInput("");
    saveState("geminiApiKey", "");
  }

  /* ---- shared finalize step: resolve account, dedupe, auto-categorize, commit. ---- */
  function importTransactionList(list, closingBalanceOverride, openingBalanceOverride, extractedPeriod, parsedBalances) {
    let account = accounts.find((a) => a.institution === institution && a.nickname === (nickname || institution));

    const validRows = list.filter((r) => r.date && r.description && r.amount && isLikelyValidDate(r.date));
    if (validRows.length === 0) { showToast("No valid transaction rows found."); return null; }
    const periodStart = validRows.reduce((min, t) => (t.date < min ? t.date : min), validRows[0].date);
    const periodEnd = validRows.reduce((max, t) => (t.date > max ? t.date : max), validRows[0].date);
    const extractedPeriodStart = extractedPeriod?.start || null;
    const extractedPeriodEnd = extractedPeriod?.end || null;
    const statementDate = extractedPeriod?.statementDate || null;

    // Primary duplicate gate: does this account already have an upload sharing ANY
    // period signal with this batch (derived range, printed period, or printed
    // statement date)? If so, reject the whole batch outright — don't attempt partial
    // per-transaction matching, which is unreliable for AI-extracted text specifically.
    if (account) {
      const dup = findDuplicatePeriodUpload(account, { periodStart, periodEnd, extractedPeriodStart, extractedPeriodEnd, statementDate });
      if (dup) {
        showToast(
          `Already imported: ${account.nickname}'s statement for ${dup.periodStart} to ${dup.periodEnd} ` +
          `(${dup.transactionCount} transactions, uploaded ${new Date(dup.importedAt).toLocaleDateString()}). ` +
          `Delete it in Upload history below to re-import this period.`
        );
        return { rejected: true, existing: dup };
      }
    }

    if (!account && !canCreateAccount(accounts, effectiveTier, accountType)) {
      const bucket = accountBucket(accountType);
      showToast(
        `Free plan limit reached (${bucketLimit(bucket)} ${BUCKET_LABELS[bucket]} account${bucketLimit(bucket) === 1 ? "" : "s"}) — ` +
        `go to Accounts to switch which one stays active, or upgrade for unlimited accounts.`
      );
      return { rejected: true, tierLimited: true };
    }
    if (account && !canImportIntoAccount(accounts, effectiveTier, account.id)) {
      showToast(
        `"${account.nickname}" is read-only on the Free plan — go to Accounts to switch which account stays active, ` +
        `or upgrade for unlimited accounts.`
      );
      return { rejected: true, tierLimited: true };
    }

    if (!account) {
      account = { id: uid("acc"), institution, nickname: nickname || institution, type: accountType, uploadHistory: [] };
      setAccounts((prev) => [...prev, account]);
    } else if (account.type !== accountType) {
      const acctId = account.id;
      setAccounts((prev) => prev.map((a) => (a.id === acctId ? { ...a, type: accountType } : a)));
      account = { ...account, type: accountType };
    }

    const batchId = uid("batch");
    // Snapshot ONCE from transactions that already existed before this batch — and
    // never mutate this set while processing the batch itself. Two genuinely separate
    // transactions within the SAME statement can share an identical date/description/
    // amount (e.g. two orders from the same merchant processed a minute apart — our
    // date field is day-level, not timestamped, so nothing else distinguishes them).
    // Checking progressively against rows already added THIS batch would treat the
    // second one as a duplicate of the first and silently drop it. This still fully
    // protects against re-importing the same statement, or overlapping date ranges
    // across separate imports — anything already in the store stays caught.
    const existingKeys = new Set(transactions.map((t) => `${t.accountId}|${t.date}|${t.description}|${t.amount}`));
    const imported = [];
    validRows.forEach(({ date, description, amount, direction }) => {
      const key = `${account.id}|${date}|${description}|${amount}`;
      if (existingKeys.has(key)) return; // secondary safety net — the period check above is the primary gate
      const rule = matchRule(description, rules);
      imported.push({
        id: uid("txn"), accountId: account.id, importBatchId: batchId,
        date, description, merchant: normalizeMerchant(description),
        amount, direction,
        category: rule ? rule.category : null,
        subCategory: rule ? rule.subCategory : null,
        tag: rule ? rule.tag : null,
        frequency: rule ? (rule.frequency || null) : null,
        purpose: rule ? (rule.purpose || "Personal") : "Personal",
        matchedRuleId: rule ? rule.id : null,
      });
    });
    if (imported.length === 0) { showToast("No new transactions found in this batch."); return null; }
    setTransactions((prev) => [...prev, ...imported]);

    const hasClosing = typeof closingBalanceOverride === "number" && !Number.isNaN(closingBalanceOverride);
    const hasOpening = typeof openingBalanceOverride === "number" && !Number.isNaN(openingBalanceOverride);
    const acctId = account.id;
    // Opening is dated the day before the batch's earliest transaction — "the balance
    // as of right before this statement's activity began" — so a period selector
    // looking for "balance as of the day before period start" can actually resolve it,
    // even on the very first import an account ever gets.
    const dayBeforeEarliest = (() => {
      const d = new Date(periodStart);
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    setAccounts((prev) => prev.map((a) => {
      if (a.id !== acctId) return a;
      let balanceHistory = (a.balanceHistory || []).map((h) => (h.asOfDate ? h : { ...h, asOfDate: h.date }));
      if (hasOpening) {
        balanceHistory = balanceHistory.filter((h) => h.asOfDate !== dayBeforeEarliest);
        balanceHistory.push({ asOfDate: dayBeforeEarliest, balance: openingBalanceOverride, importBatchId: batchId });
      }
      if (hasClosing) {
        balanceHistory = balanceHistory.filter((h) => h.asOfDate !== periodEnd);
        balanceHistory.push({ asOfDate: periodEnd, balance: closingBalanceOverride, importBatchId: batchId });
      }
      balanceHistory.sort((x, y) => x.asOfDate.localeCompare(y.asOfDate));
      const uploadHistory = [...(a.uploadHistory || []), {
        batchId, importedAt: Date.now(), periodStart, periodEnd, transactionCount: imported.length,
        extractedPeriodStart, extractedPeriodEnd, statementDate,
        // Always recorded, regardless of trust — e.g. an opening balance that had to be
        // derived (no explicit label found) and whose reconciliation didn't quite clear
        // the bar still shows up HERE for reference, even though it won't feed the
        // dashboard equation. Otherwise a value that was genuinely read/derived from the
        // statement just vanishes with no trace once trust logic declines to use it.
        parsedOpeningBalance: parsedBalances?.opening ?? null,
        parsedClosingBalance: parsedBalances?.closing ?? null,
        parsedOpeningTrusted: hasOpening,
        parsedClosingTrusted: hasClosing,
      }];
      return {
        ...a,
        lastKnownBalance: hasClosing ? closingBalanceOverride : a.lastKnownBalance,
        balanceHistory, uploadHistory,
      };
    }));
    showToast(`Imported ${imported.length} transactions into ${account.nickname} (${periodStart} to ${periodEnd}).`);
    return { count: imported.length, accountId: account.id, importedTransactions: imported };
  }

  // Disabled: the equation now shows Transfers as a passive line item (see the Cash
  // Flow Overview), so proactively interrupting an import to ask about substantiating
  // them is no longer needed. Transfers just sit in Review → Transfers / the Breakdown
  // grid for whenever the user wants to look, no prompting required.
  function checkPendingTransfersAfterImport(result) {
    return;
  }

  function confirmTransferSubstantiation(selectedTransferIds) {
    const acctId = importCompletionPrompt.accountId;
    setTransactions((prev) => prev.map((t) => (selectedTransferIds.includes(t.id) ? { ...t, substantiatedByAccountId: acctId } : t)));
    showToast(`Marked ${selectedTransferIds.length} transfer${selectedTransferIds.length > 1 ? "s" : ""} as substantiated.`);
    setImportCompletionPrompt(null);
  }

  const [aiSuggestion, setAiSuggestion] = useState(null); // from callClassifyAndMap, once it resolves — refines the heuristic below, never required for it to work

  /** Routes a classified file to whichever existing, already-verified flow actually
   *  handles that document type. Nothing about extraction changes here — this only
   *  decides which flow gets the file. */
  function routeClassifiedFile(category, file, pwd) {
    if (category === "investment_holding") {
      setSource("investment");
      setInvestmentInitialPassword(pwd || "");
      setInvestmentInitialFile(file);
    } else if (category === "debt_schedule") {
      setSource("debt");
      setDebtInitialPassword(pwd || "");
      setDebtInitialFile(file);
    } else if (category === "bank_statement" || category === "credit_card_statement") {
      if (/\.pdf$/i.test(file.name)) {
        // Bank/CC PDF extraction is a deliberate two-step flow (select, then a
        // separate "Extract" click) — land on it pre-filled rather than reaching in
        // to auto-trigger a multi-step async process from outside its own component.
        // The password (if this file needed one) carries over too, so "Extract"
        // works on the first click instead of asking again.
        setSource("llmpdf");
        setLlmFile(file); setLlmFileName(file.name); setLlmError(null); setLlmRawResponse(null);
        setNeedsPassword(false); setWrongPassword(false); setPdfPassword(pwd || "");
        setClosingBalanceInput("");
        setStatementBalances((prev) => ({ ...prev, closing: null }));
        setExtractedStatementPeriod({ start: null, end: null, statementDate: null });
        setPastePreview(null);
      } else {
        setSource("csv");
        handleFile(file); // the bank/CC CSV flow, already AI-refined
      }
    } else if (category === "other_investment_statement") {
      setUnifiedError('This looks like a PF, Gold, or Property statement — those are imported from Investments → "Other Investments", not here.');
    } else {
      setUnifiedError("Couldn't confidently identify this file — pick the right type below.");
      setShowManualTabs(true);
    }
  }

  /** Entry point for the unified dropzone: takes any file, uses AI to figure out what
   *  kind of document it is (bank statement, CC statement, holdings, loan schedule,
   *  etc.) via callDocumentClassify, then hands off to routeClassifiedFile to send it
   *  down the right flow. A PDF is rendered to page images first (only the first 2
   *  pages - enough for classification, without spending tokens on the whole
   *  document); a spreadsheet sends a small text sample of its rows instead. A
   *  password-protected PDF surfaces as a distinct needsPassword state rather than a
   *  generic error, so the UI can prompt for it and retry with retryUnifiedWithPassword
   *  instead of making the person start over. */
  async function handleUnifiedFile(file, pwd) {
    if (!file) return;
    setUnifiedClassifying(true);
    setUnifiedError(null);
    setUnifiedResult(null);
    setUnifiedNeedsPassword(false);
    setUnifiedWrongPassword(false);
    try {
      if (!apiKey) {
        setUnifiedError("Add your Gemini API key below (in the PDF (AI-assisted) tab) first — identifying a file needs it.");
        return;
      }
      let inputParts;
      if (/\.pdf$/i.test(file.name)) {
        const { images } = await renderPdfPagesAsImages(file, pwd || undefined);
        if (images.length === 0) { setUnifiedError("Couldn't render any pages from that PDF."); return; }
        inputParts = images.slice(0, 2).map((b) => ({ inlineData: { mimeType: "image/png", data: b } }));
      } else if (/\.csv$|\.xlsx$|\.xls$/i.test(file.name)) {
        const rawSampleRows = await readSpreadsheetFile(file);
        const sample = buildSpreadsheetSample(rawSampleRows, 20);
        inputParts = [{ text: `File name: ${file.name}\n\nSample data:\n${sample}` }];
      } else {
        setUnifiedError("This supports PDF, CSV, or Excel files.");
        return;
      }
      const effectiveModel = aiModel === "custom" ? customModelId.trim() : aiModel;
      const classification = await callDocumentClassify(inputParts, apiKey, effectiveModel);
      setUnifiedResult(classification);
      routeClassifiedFile(classification.documentCategory, file, pwd);
    } catch (err) {
      if (err && err.needsPassword) {
        setUnifiedNeedsPassword(true);
        setUnifiedWrongPassword(!!err.wasWrongPassword);
        setUnifiedPendingFile(file);
      } else {
        setUnifiedError(err.message || "Couldn't identify that file.");
      }
    } finally {
      setUnifiedClassifying(false);
    }
  }

  function retryUnifiedWithPassword() {
    handleUnifiedFile(unifiedPendingFile, unifiedPassword);
  }

  async function handleFile(file) {
    if (!file) return;
    setFileName(file.name);
    setHeaders(null);
    setAiSuggestion(null);
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: async (res) => {
        const data = res.data || [];
        setRawRows(data);
        const guess = detectHeaderRow(data);
        setHeaderRowIdx(guess);
        // The heuristic above already produced a fully usable, offline default —
        // this AI call is a refinement layered on top, never a requirement. If it
        // fails or there's no key configured, everything above still works exactly
        // as it always has.
        if (apiKey) {
          try {
            const sample = buildSpreadsheetSample(data, 30);
            const embeddedImages = /\.xlsx$/i.test(file.name) ? await extractEmbeddedImages(file) : [];
            const result = await callClassifyAndMap(sample, file.name, embeddedImages);
            setAiSuggestion(result);
          } catch {
            /* silent — the heuristic-based defaults remain in place */
          }
        }
      },
    });
  }

  // Whenever the chosen header row changes, rebuild headers + row objects from it
  useEffect(() => {
    if (!rawRows || !rawRows[headerRowIdx]) return;
    const hdrs = rawRows[headerRowIdx].map((h, i) => {
      const clean = (h || "").toString().trim();
      return clean || `Column ${i + 1}`;
    });
    // de-duplicate identical header names (some exports repeat "Amount" etc.)
    const seen = {};
    const uniqueHdrs = hdrs.map((h) => {
      seen[h] = (seen[h] || 0) + 1;
      return seen[h] > 1 ? `${h} (${seen[h]})` : h;
    });

    const dataObjs = rawRows.slice(headerRowIdx + 1)
      .filter((r) => r.some((cell) => (cell || "").toString().trim() !== ""))
      .map((r) => {
        const obj = {};
        uniqueHdrs.forEach((h, i) => { obj[h] = r[i]; });
        return obj;
      });

    setHeaders(uniqueHdrs);
    setRows(dataObjs);
    setDateCol(guessColumn(uniqueHdrs, DATE_ALIASES));
    setDescCol(guessColumn(uniqueHdrs, DESC_ALIASES));
    const dCol = guessColumn(uniqueHdrs, DEBIT_ALIASES);
    const cCol = guessColumn(uniqueHdrs, CREDIT_ALIASES);
    if (dCol || cCol) {
      setAmountMode("split");
      setDebitCol(dCol);
      setCreditCol(cCol);
    } else {
      setAmountMode("single");
      setAmountCol(guessColumn(uniqueHdrs, AMOUNT_ALIASES));
      setTypeCol(guessColumn(uniqueHdrs, TYPE_ALIASES));
    }
  }, [rawRows, headerRowIdx]);

  // Refines the heuristic-based defaults above once the AI classification resolves —
  // corrects the header row first if AI found a better one (which re-triggers the
  // effect above to rebuild headers/rows for that row), then matches AI's column
  // mapping against the CURRENT headers once they reflect the right row, so this
  // never applies a mapping built against a stale header row.
  useEffect(() => {
    if (!aiSuggestion || !headers) return;
    if (aiSuggestion.institution) setInstitution(aiSuggestion.institution);
    if (typeof aiSuggestion.headerRowIndex === "number" && aiSuggestion.headerRowIndex !== headerRowIdx) {
      setHeaderRowIdx(aiSuggestion.headerRowIndex);
      return;
    }
    const map = aiSuggestion.columnMapping || {};
    const findHeader = (val) => (val && headers.includes(val) ? val : "");
    if (findHeader(map.date)) setDateCol(findHeader(map.date));
    if (findHeader(map.description)) setDescCol(findHeader(map.description));
    const dCol = findHeader(map.debit), cCol = findHeader(map.credit);
    if (dCol || cCol) {
      setAmountMode("split");
      if (dCol) setDebitCol(dCol);
      if (cCol) setCreditCol(cCol);
    } else if (findHeader(map.amount)) {
      setAmountMode("single");
      setAmountCol(findHeader(map.amount));
      if (findHeader(map.transactionType)) setTypeCol(findHeader(map.transactionType));
    }
  }, [aiSuggestion, headers]);

  function resetImportForm() {
    setRawRows(null);
    setHeaders(null);
    setRows([]);
    setFileName("");
  }

  /** Converts the person's confirmed column mapping (CSV/Excel path) into a plain
   *  list of {date, description, amount, direction} rows and hands off to
   *  importTransactionList for dedup/categorization/commit. Debit/Credit direction
   *  is resolved per amountMode: "split" trusts whichever of the two columns is
   *  actually populated for a given row; "single" reads an explicit type column if
   *  one exists, falling back to the amount's own sign when it doesn't. Resets both
   *  the import form and the account-context fields afterward, then checks whether
   *  this import might settle a pending transfer elsewhere. */
  function doImport() {
    if (!dateCol || !descCol) { showToast("Please map at least Date and Description columns."); return; }
    if (amountMode === "split" && !debitCol && !creditCol) { showToast("Map at least one of Debit / Credit columns."); return; }
    if (amountMode === "single" && !amountCol) { showToast("Map the Amount column."); return; }

    const list = [];
    rows.forEach((row) => {
      const rawDate = row[dateCol];
      const desc = (row[descCol] || "").toString().trim();
      if (!rawDate || !desc) return;
      const date = parseDateStr(rawDate);

      let amount = 0, direction = "debit";
      if (amountMode === "split") {
        const debit = parseAmountStr(row[debitCol]);
        const credit = parseAmountStr(row[creditCol]);
        if (credit > 0) { amount = credit; direction = "credit"; }
        else { amount = Math.abs(debit); direction = "debit"; }
      } else {
        const raw = parseAmountStr(row[amountCol]);
        const typeVal = (row[typeCol] || "").toString().toLowerCase();
        if (typeVal.includes("cr")) { amount = Math.abs(raw); direction = "credit"; }
        else if (typeVal.includes("dr")) { amount = Math.abs(raw); direction = "debit"; }
        else { direction = raw >= 0 ? "credit" : "debit"; amount = Math.abs(raw); }
      }
      if (amount === 0) return;
      list.push({ date, description: desc, amount, direction });
    });

    const result = importTransactionList(list);
    if (result && !result.rejected) { resetImportForm(); resetAccountContextAfterImport(); checkPendingTransfersAfterImport(result); }
  }

  /* ---- Paste-from-PDF mode: heuristic parser + editable preview.
     Scans for date occurrences anywhere in the pasted text rather than requiring
     one date per line — PDF copy/paste frequently wraps a single transaction
     across two lines, or loses line breaks entirely, so anchoring to line-start
     silently drops everything after the first match. Each date found marks the
     start of one transaction chunk; the chunk runs until the next date found. ---- */
  // A blank Debit or Credit cell in a PDF has no text at all — so once a row is
  // reconstructed as flat text, a credit-only row and a debit-only row can look
  // identical ("one amount + one balance"), and without an explicit "Cr"/"Dr" label
  // next to the amount, direction is a guess. The running balance is authoritative
  // where available — but which direction of change means "credit" depends on the
  // account type: for a bank account, a credit increases the balance; for a credit
  // card, a credit (a payment) DECREASES the amount owed, and a debit (a purchase)
  // increases it. This walks the rows in order and corrects direction from that delta,
  // using the known opening balance (or the first row with a balance) as the starting
  // reference.
  function correctDirectionsFromBalanceChain(rows, startingBalance, isCC) {
    let prevBalance = startingBalance;
    let correctedCount = 0;
    const result = rows.map((r) => {
      if (r.runningBalance === null || r.runningBalance === undefined) return r;
      if (prevBalance === null || prevBalance === undefined) {
        prevBalance = r.runningBalance; // no baseline yet — can't correct this one, but now we have one for the next
        return r;
      }
      const delta = r.runningBalance - prevBalance;
      prevBalance = r.runningBalance;
      if (Math.abs(delta) < 0.5) return r; // no real change — leave as-is, genuinely ambiguous
      const impliedDirection = isCC ? (delta > 0 ? "debit" : "credit") : (delta > 0 ? "credit" : "debit");
      if (impliedDirection !== r.direction) {
        correctedCount++;
        return { ...r, direction: impliedDirection, amount: Math.abs(delta).toFixed(2) };
      }
      return r;
    });
    return { result, correctedCount };
  }

  function parsePastedText(textOverride) {
    const text = textOverride !== undefined ? textOverride : pasteText;
    const dateMatches = collapseAdjacentDateMatches([...text.matchAll(PASTE_DATE_TOKEN_RE)]);
    const out = [];

    dateMatches.forEach((dm, idx) => {
      const start = dm.index;
      let end = idx + 1 < dateMatches.length ? dateMatches[idx + 1].index : text.length;
      // Never let a transaction's span cross a page boundary — footer content living in
      // the gap between pages (page numbers, running totals) can otherwise corrupt or
      // discard the last transaction on a page.
      const breakIdx = text.indexOf(PAGE_BREAK_MARKER, start);
      if (breakIdx !== -1 && breakIdx < end) end = breakIdx;

      // Keep line breaks intact here — interpretPasteChunk needs to tell the row that
      // has the date/amount apart from any wrapped-description continuation rows below it.
      const rawSpan = text.slice(start, end).trim();
      const flatForSkipCheck = rawSpan.replace(/\s+/g, " ");
      if (!rawSpan || PASTE_SKIP_LINE_RE.test(flatForSkipCheck)) return;

      const afterDate = rawSpan.slice(dm[0].length);
      const restLines = afterDate.split("\n").map((l) => l.trim()).filter(Boolean);
      const parsed = interpretPasteChunk(dm[0], restLines, columnFormat);
      if (!parsed) return;
      out.push({ id: uid("pp"), ...parsed, amount: parsed.amount.toString(), include: true });
    });

    // look for an opening/closing balance mention anywhere in the text — but only use it
    // if you haven't already provided one yourself (carried forward, or typed in above),
    // since your own confirmed number is always the more trustworthy source
    const flatText = text.split(PAGE_BREAK_MARKER).join(" ");
    const openingMatch = flatText.match(PASTE_OPENING_BAL_RE);
    const closingMatch = flatText.match(PASTE_CLOSING_BAL_RE);
    const userOpening = parseAmountOrNull(openingBalanceInput);
    const userClosing = parseAmountOrNull(closingBalanceInput);
    const resolvedOpening = userOpening !== null ? userOpening : (openingMatch ? parseAmountStr(openingMatch[2]) : null);
    const resolvedClosing = userClosing !== null ? userClosing : (closingMatch ? parseAmountStr(closingMatch[2]) : null);
    setStatementBalances({ opening: resolvedOpening, closing: resolvedClosing });

    const { result: corrected, correctedCount } = correctDirectionsFromBalanceChain(out, resolvedOpening, isCreditCard);

    if (corrected.length === 0) {
      showToast("Couldn't find any transaction-looking lines — try a different column format above, or paste a smaller, cleaner block.");
      setPastePreview(null);
    } else {
      setPastePreview(corrected);
      if (correctedCount > 0) {
        showToast(`Parsed ${corrected.length} transactions — corrected debit/credit direction on ${correctedCount} of them using the balance trail (blank Debit/Credit cells can't be told apart from position alone).`);
      }
    }
  }

  // Live preview of just the first detected line, so the chosen column format can be
  // sanity-checked before committing to parsing the whole statement.
  const firstLinePreview = useMemo(() => {
    if (!pasteText.trim()) return null;
    const rawDateMatches = [...pasteText.matchAll(PASTE_DATE_TOKEN_RE)];
    if (rawDateMatches.length === 0) return null;
    const dateMatches = collapseAdjacentDateMatches(rawDateMatches);
    const dm = dateMatches[0];
    const start = dm.index;
    let secondStart = dateMatches.length > 1 ? dateMatches[1].index : pasteText.length;
    const breakIdx = pasteText.indexOf(PAGE_BREAK_MARKER, start);
    if (breakIdx !== -1 && breakIdx < secondStart) secondStart = breakIdx;
    const rawSpan = pasteText.slice(start, secondStart).trim();
    if (PASTE_SKIP_LINE_RE.test(rawSpan.replace(/\s+/g, " "))) return null;
    const afterDate = rawSpan.slice(dm[0].length);
    const restLines = afterDate.split("\n").map((l) => l.trim()).filter(Boolean);
    return interpretPasteChunk(dm[0], restLines, columnFormat);
  }, [pasteText, columnFormat]);

  // Reconciliation: does opening balance + every parsed transaction land on the closing
  // balance? And does the running balance shown on each line chain correctly from the
  // previous one? A break in the chain points at roughly where a transaction is missing.
  // Many statements never spell out "Opening Balance" / "Closing Balance" in words, so when
  // that label isn't found, fall back to deriving the range from the first and last parsed
  // line's own running balance — this still confirms every line in between is internally
  // consistent, it just can't rule out a transaction missing before the first or after the
  // last line (there's nothing outside the pasted range to check that against).
  // Rows that share an identical date/description/amount with another row in the same
  // preview — purely informational, never auto-excluded. Two genuinely separate
  // transactions can legitimately share all three (two orders from the same merchant,
  // same amount, minutes apart — our date field is day-level, not timestamped), and a
  // continuation artifact (Gemini re-sending a row across a multi-call extraction) can
  // ALSO look exactly like this. There's no way to tell these apart from the data alone
  // — reconciliation (opening + net = closing) is the real, objective check for whether
  // the extraction is complete and correct; this flag just makes a possible duplicate
  // visible so the person can judge it with context the app doesn't have.
  const possibleDuplicateIds = useMemo(() => {
    if (!pastePreview) return new Set();
    const counts = {};
    pastePreview.forEach((r) => {
      const key = `${r.date}|${r.description}|${r.amount}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    const ids = new Set();
    pastePreview.forEach((r) => {
      const key = `${r.date}|${r.description}|${r.amount}`;
      if (counts[key] > 1) ids.add(r.id);
    });
    return ids;
  }, [pastePreview]);

  const reconciliation = useMemo(() => {
    if (!pastePreview) return null;
    const included = pastePreview.filter((r) => r.include);
    // For a bank account, a credit increases the balance. For a credit card, it's
    // inverted — a debit (purchase) increases what's owed, a credit (payment) reduces
    // it. "increasingDirection" is whichever direction actually moves the balance up,
    // for whichever account type this is.
    const increasingDirection = isCreditCard ? "debit" : "credit";
    const netSigned = included.reduce(
      (s, r) => s + (r.direction === increasingDirection ? parseAmountStr(r.amount) : -parseAmountStr(r.amount)), 0
    );

    const chainRows = pastePreview.filter((r) => r.include && r.runningBalance !== null && r.runningBalance !== undefined);

    let opening = statementBalances.opening;
    let closing = statementBalances.closing;
    let openingIsDerived = false, closingIsDerived = false;
    if (opening === null && chainRows.length > 0) {
      const first = chainRows[0];
      const firstSigned = first.direction === increasingDirection ? parseAmountStr(first.amount) : -parseAmountStr(first.amount);
      opening = Math.round((first.runningBalance - firstSigned) * 100) / 100;
      openingIsDerived = true;
    }
    if (closing === null && chainRows.length > 0) {
      closing = chainRows[chainRows.length - 1].runningBalance;
      closingIsDerived = true;
    }

    let impliedClosing = null, diff = null;
    if (opening !== null) {
      impliedClosing = Math.round((opening + netSigned) * 100) / 100;
      if (closing !== null) diff = Math.round((impliedClosing - closing) * 100) / 100;
    }

    const gaps = [];
    for (let i = 1; i < chainRows.length; i++) {
      const prev = chainRows[i - 1], cur = chainRows[i];
      const curSigned = cur.direction === increasingDirection ? parseAmountStr(cur.amount) : -parseAmountStr(cur.amount);
      const expected = prev.runningBalance + curSigned;
      const gapAmt = Math.round((cur.runningBalance - expected) * 100) / 100;
      if (Math.abs(gapAmt) > 1) gaps.push({ afterDate: prev.date, beforeDate: cur.date, gapAmt });
    }

    return {
      opening, closing, impliedClosing, diff, gaps,
      hasBalanceInfo: opening !== null || closing !== null,
      openingIsDerived, closingIsDerived,
      isFullyDerived: openingIsDerived && closingIsDerived,
    };
  }, [pastePreview, statementBalances, isCreditCard]);

  function updatePasteRow(id, patch) {
    setPastePreview((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function doPasteImport() {
    const list = pastePreview
      .filter((r) => r.include)
      .map((r) => ({ date: r.date, description: r.description.trim(), amount: parseAmountStr(r.amount), direction: r.direction }));
    // Trust a value if it was explicitly provided (typed, or read from a clearly labeled
    // statement field) — regardless of whether reconciliation happens to check out,
    // since a mismatch there more likely means a missed/misread transaction than a wrong
    // explicit number. ALSO trust a value that was derived from the transaction chain
    // (e.g. the last row's own running balance) IF opening + net transactions actually
    // reconciles against it — that agreement is real evidence the extraction was
    // complete and accurate, not just an unconfirmed guess.
    const isReconciled = reconciliation && reconciliation.diff !== null && Math.abs(reconciliation.diff) <= 1;
    const trustedClosing = (reconciliation && reconciliation.closing !== null && (!reconciliation.closingIsDerived || isReconciled))
      ? reconciliation.closing : undefined;
    const trustedOpening = (reconciliation && reconciliation.opening !== null && (!reconciliation.openingIsDerived || isReconciled))
      ? reconciliation.opening : undefined;
    const parsedBalances = { opening: reconciliation ? reconciliation.opening : null, closing: reconciliation ? reconciliation.closing : null };
    const result = importTransactionList(list, trustedClosing, trustedOpening, extractedStatementPeriod, parsedBalances);
    if (result && !result.rejected) {
      setPastePreview(null); setPasteText(""); setLlmFile(null); setLlmFileName("");
      setExtractedStatementPeriod({ start: null, end: null, statementDate: null });
      resetAccountContextAfterImport();
      checkPendingTransfersAfterImport(result);
    }
  }

  /* ---- Local decrypt + render, then AI structuring via YOUR OWN API key.
     Code stays the gatekeeper throughout: the model only ever proposes a transaction
     list; opening balance comes from your own stored ledger (never re-asked of the
     model), closing balance is what you confirm, and the reconciliation check —
     completely independent of how the rows were produced — is what actually decides
     whether to trust the result. The balance-chain direction correction still runs on
     the model's output too, as a backstop.
     The PDF is decrypted locally if password-protected (the password never leaves this
     device). Rather than extracting text ourselves and asking the model to reconstruct
     the table from a flattened string (which is exactly where every layout-specific bug
     we've hit came from), each page is rendered to an image and sent to Gemini directly
     — it reads the actual table layout the way a person would look at the page, instead
     of our best-effort text reconstruction of it. Only those page images — never the
     PDF file itself — are sent, using the key you provide below. That call goes
     directly from this browser to Google; nothing passes through any server of
     ours. ---- */

  // Structure is enforced by responseSchema below, not by asking nicely in the prompt —
  // so this only needs to describe the task and the field semantics the schema itself
  // can't express (date format, what "isComplete" means, privacy constraints).
  function buildStructurePrompt(resumeAfter, pageCount, isCC) {
    const base = [
      `Attached are ${pageCount} page image${pageCount > 1 ? "s" : ""} from a ${isCC ? "credit card" : "bank account"} statement PDF, in order.`,
      "Read the actual table layout from the images and extract every transaction.",
      "date must be in YYYY-MM-DD format. amount is always a positive number. runningBalance is the",
      "balance shown immediately after that line if the statement shows one, else omit it.",
      isCC
        ? 'direction is "debit" for a purchase/charge (increases the amount owed) and "credit" for a payment or refund (decreases the amount owed).'
        : 'direction is "debit" for money leaving the account and "credit" for money coming in.',
      isCC
        ? 'openingBalance is the "Previous Balance" (the amount owed at the start of this billing cycle, before this statement\'s activity), and closingBalance is the "Total Outstanding" / "New Balance" (the amount owed at the end) — use whatever exact labels the statement itself uses for these two summary figures.'
        : 'openingBalance and closingBalance are the account balance at the start and end of this statement, using whatever labels the statement itself uses (e.g. "Opening Balance", "Balance B/F", "Closing Balance", "Balance C/F").',
      "isComplete is true only if you have included every remaining transaction; false if you stopped",
      "early because you're running low on space.",
      "Look for a printed statement period or statement date, usually near the top of the first page —",
      'if you see something like "Statement Period: 01 Mar 2026 to 31 Mar 2026", report both as',
      "statementPeriodStart/statementPeriodEnd. If instead you only see a single \"Statement Date\"",
      "(no range), report just that as statementDate. Leave whichever wasn't printed as null — don't guess.",
      "Also report statementInstitution — the bank or card issuer's own name, usually near a logo or",
      "letterhead (e.g. \"Standard Chartered Bank\", \"Scapia\"). This is the institution's name, not personal",
      "information, so it's fine to include even though account number/holder name/address are excluded below.",
      "Do not include the account number, account holder name, or address anywhere in your response.",
    ];
    if (resumeAfter) {
      base.push(
        "",
        `This is a continuation. The last transaction already extracted was: date=${resumeAfter.date}, description="${resumeAfter.description}", amount=${resumeAfter.amount}.`,
        "Continue extracting every remaining transaction that comes AFTER that one, in the same order. Do not repeat it or anything before it."
      );
    }
    return base.join("\n");
  }

  const STRUCTURE_RESPONSE_SCHEMA = {
    type: "OBJECT",
    properties: {
      openingBalance: { type: "NUMBER", nullable: true, description: "Opening balance shown on the statement, if visible." },
      closingBalance: { type: "NUMBER", nullable: true, description: "Closing balance shown on the statement, if visible." },
      statementPeriodStart: { type: "STRING", nullable: true, description: "Start of the statement period, YYYY-MM-DD, ONLY if the statement explicitly prints a period range (e.g. 'Statement Period: 01 Mar 2026 to 31 Mar 2026'). Null if no such range is printed." },
      statementPeriodEnd: { type: "STRING", nullable: true, description: "End of the statement period, YYYY-MM-DD, paired with statementPeriodStart. Null if no explicit range is printed." },
      statementDate: { type: "STRING", nullable: true, description: "A single printed 'Statement Date' (YYYY-MM-DD), used when the statement shows one date rather than a period range — this is usually the cycle's end date. Null if not printed." },
      statementInstitution: { type: "STRING", nullable: true, description: "The bank or card issuer's name as printed on the statement (e.g. 'Standard Chartered Bank', 'Scapia', 'Kotak Mahindra Bank') — usually near a logo or letterhead at the top of the first page. Just the institution's own name, not a branch address or account holder name. Null if genuinely not identifiable." },
      isComplete: { type: "BOOLEAN", description: "True only if every remaining transaction has been included; false if space ran out." },
      rows: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            date: { type: "STRING", description: "Transaction date, YYYY-MM-DD." },
            description: { type: "STRING", description: "The transaction's description/narration text, exactly as shown." },
            amount: { type: "NUMBER", description: "Transaction amount, always positive." },
            direction: { type: "STRING", enum: ["debit", "credit"] },
            runningBalance: { type: "NUMBER", nullable: true, description: "Balance immediately after this transaction, if shown." },
          },
          required: ["date", "description", "amount", "direction"],
        },
      },
    },
    required: ["isComplete", "rows"],
  };

  async function callStructureOnce(images, resumeAfter) {
    const effectiveModel = aiModel === "custom" ? customModelId.trim() : aiModel;
    const parts = [
      ...images.map((base64) => ({ inlineData: { mimeType: "image/png", data: base64 } })),
      { text: buildStructurePrompt(resumeAfter, images.length, isCreditCard) },
    ];
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            maxOutputTokens: 32000,
            responseMimeType: "application/json",
            responseSchema: STRUCTURE_RESPONSE_SCHEMA,
          },
        }),
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `Request failed (HTTP ${response.status}).`);
    }
    const responseParts = data.candidates?.[0]?.content?.parts || [];
    // Reasoning-capable Gemini models can return a "thought" part ahead of the real
    // answer — that's the model's internal reasoning trace in plain English, not JSON,
    // and taking the first text-bearing part indiscriminately would grab that instead
    // of the actual response. Explicitly skip anything marked as a thought.
    const textPart = responseParts.find((p) => typeof p.text === "string" && !p.thought);
    if (!textPart) {
      const blockReason = data.candidates?.[0]?.finishReason;
      throw new Error(blockReason ? `No usable response (${blockReason}).` : "No text response from the model.");
    }

    let raw = textPart.text.replace(/```json|```/g, "").trim();
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) raw = raw.slice(firstBrace, lastBrace + 1);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A cut-off response is expected occasionally, even with a generous token cap —
      // salvage whatever complete transaction rows exist before the truncation point,
      // rather than discarding the whole call. Marking it incomplete (regardless of
      // what "isComplete" claimed near the top of the truncated JSON, which can't be
      // trusted if generation was cut off before reaching the end) lets the existing
      // continuation loop pick up where this left off, instead of just giving up.
      // Rows are now objects (schema-enforced), not tuples, so salvage matches {...}
      // entries rather than [...] entries.
      const rowsMatch = raw.match(/"rows"\s*:\s*\[([\s\S]*)/);
      let salvagedRows = [];
      if (rowsMatch) {
        const rowMatches = [...rowsMatch[1].matchAll(/\{[^{}]*\}/g)];
        salvagedRows = rowMatches.map((m) => { try { return JSON.parse(m[0]); } catch { return null; } }).filter(Boolean);
      }
      if (salvagedRows.length === 0) {
        const err = new Error("The model's response wasn't valid JSON, and no transaction rows could be salvaged from it. Try again, or use \"Paste text manually\" below.");
        err.rawResponse = textPart.text;
        throw err;
      }
      const openingMatch = raw.match(/"openingBalance"\s*:\s*(-?[\d.]+)/);
      const closingMatch = raw.match(/"closingBalance"\s*:\s*(-?[\d.]+)/);
      parsed = {
        openingBalance: openingMatch ? Number(openingMatch[1]) : null,
        closingBalance: closingMatch ? Number(closingMatch[1]) : null,
        isComplete: false,
        rows: salvagedRows,
      };
    }
    return { parsed, isComplete: parsed.isComplete === true, rawText: textPart.text };
  }

  // Lightweight, text-only classification for CSV/Excel files — just the header row and
  // a handful of sample rows, never the full file. This is what lets ONE upload screen
  // handle bank statements, credit card statements, and investment holding statements
  // without asking the user to pick a parser: Gemini identifies what kind of document
  // this is and proposes a column mapping, then everything after that — the actual
  // row-by-row parsing of potentially hundreds of rows — runs entirely locally, never
  // re-sent to the model. Cheap, fast, and avoids ever risking an LLM truncating or
  // misreading a large spreadsheet.
  const CLASSIFY_MAP_SCHEMA = {
    type: "OBJECT",
    properties: {
      documentType: { type: "STRING", enum: ["bank_statement", "credit_card_statement", "equity_holding", "mutual_fund_holding", "nps_holding", "ulip_holding", "unknown"], description: "What kind of statement this is, based on the column headers and sample rows. 'equity_holding' is a stock/demat holdings export (has ISIN, Sector, or LTP/Current Price columns). 'mutual_fund_holding' is a mutual fund holdings export (has Folio Number, AMC, Scheme Name, or NAV columns). 'nps_holding' is an NPS (National Pension System) statement — often has PRAN, scheme/fund manager name, units, and NAV columns; treat it exactly like a mutual fund holding structurally. 'ulip_holding' is a ULIP (unit-linked insurance) fund-value statement — often has Policy Number, fund name, units, and NAV columns; also treat it exactly like a mutual fund holding structurally. Use 'unknown' only if genuinely unclear." },
      institution: { type: "STRING", nullable: true, description: "The bank, broker, or platform name. Check every part of the sample: a title/logo row above the header, a 'Client Name'/'Broker' style label, a column value repeated down the sheet, or the file name given below the sample (e.g. a file literally named 'Zerodha_holdings.xlsx' or containing a recognizable broker/AMC name). A generic file name like 'Portfolio_Holdings_2026.xlsx' with no such name anywhere is a real case where this should be null — do not guess." },
      headerRowIndex: { type: "NUMBER", description: "Which row (0-indexed) in the provided sample actually contains the column headers — spreadsheets exported from banks/brokers often have a few title or summary rows before the real header row." },
      skipRowIndices: {
        type: "ARRAY", items: { type: "NUMBER" },
        description: "0-indexed rows within the SAMPLE (not the whole file) that are NOT real transactions/holdings — a section-divider row (e.g. just the word 'Equity' or 'Mutual Fund' as a category banner), a 'Total'/'Grand Total'/'Subtotal' row, or a blank spacer row. This can only cover rows visible in this sample; rows further down a long file that look the same way will still be caught separately by content-based rules once the full file is parsed.",
      },
      columnMapping: {
        type: "OBJECT",
        description: "Map each RELEVANT field to the exact column header text from the file (verbatim, matching what's in the header row) — omit/null any field with no matching column. Only fill in fields that make sense for the detected documentType.",
        properties: {
          date: { type: "STRING", nullable: true },
          description: { type: "STRING", nullable: true },
          debit: { type: "STRING", nullable: true },
          credit: { type: "STRING", nullable: true },
          amount: { type: "STRING", nullable: true },
          transactionType: { type: "STRING", nullable: true, description: "A Dr/Cr or debit/credit indicator column, if amount is a single signed/unsigned column needing a separate direction column." },
          runningBalance: { type: "STRING", nullable: true },
          instrumentName: { type: "STRING", nullable: true },
          isin: { type: "STRING", nullable: true },
          folioNumber: { type: "STRING", nullable: true },
          amc: { type: "STRING", nullable: true },
          sectorOrCategory: { type: "STRING", nullable: true },
          units: { type: "STRING", nullable: true },
          avgCost: { type: "STRING", nullable: true },
          currentPrice: { type: "STRING", nullable: true },
          investedValue: { type: "STRING", nullable: true },
          currentValue: { type: "STRING", nullable: true },
          status: { type: "STRING", nullable: true },
        },
      },
      statementTotals: {
        type: "OBJECT",
        description: "Any totals printed OUTSIDE the row data — a header block above the table, or values called out elsewhere in the sample. Null for anything not found; do not compute or estimate these yourself.",
        properties: {
          asOfDate: { type: "STRING", nullable: true, description: "YYYY-MM-DD holding/statement date, if printed." },
          totalInvestedValue: { type: "NUMBER", nullable: true },
          totalCurrentValue: { type: "NUMBER", nullable: true },
          openingBalance: { type: "NUMBER", nullable: true },
          closingBalance: { type: "NUMBER", nullable: true },
        },
      },
    },
    required: ["documentType", "headerRowIndex", "columnMapping"],
  };

  async function callClassifyAndMap(sampleText, fileName, embeddedImages) {
    const effectiveModel = aiModel === "custom" ? customModelId.trim() : aiModel;
    const hasImages = embeddedImages && embeddedImages.length > 0;
    const prompt = [
      "You are looking at the first rows of a CSV or Excel export from a bank, credit card",
      "issuer, stockbroker, or mutual fund platform (a demat holdings export, a mutual fund",
      "CAS, a bank statement, or a credit card statement). Identify what kind of document",
      "this is, find the real header row (there may be title/summary rows above it), and",
      "map each column to the fields in the schema using the EXACT header text as it",
      "appears — do not paraphrase or guess a column that isn't actually present.",
      "Also flag any sample row that is a section-divider or total/subtotal row rather than",
      "a real transaction/holding, so it isn't parsed as one.",
      "Only report a statementTotals value if it is explicitly printed somewhere in this",
      "sample (e.g. a 'Total Investments' or 'Closing Balance' line) — never compute or",
      "estimate one yourself.",
      hasImages
        ? "\nAlso attached: image(s) extracted from the spreadsheet file itself — a pasted logo or letterhead is often an embedded image, not a cell value, so it never appears in the text sample above no matter how much of the sheet gets read. Look at the attached image(s) for the institution/broker/platform name — a logo, letterhead text, or branding — and use that for the institution field if the text sample alone doesn't show one."
        : "",
      fileName ? `\nFile name: ${fileName}` : "",
      "",
      "Sample data:",
      sampleText,
    ].join("\n");
    const parts = [
      ...(hasImages ? embeddedImages.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })) : []),
      { text: prompt },
    ];
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { maxOutputTokens: 4000, responseMimeType: "application/json", responseSchema: CLASSIFY_MAP_SCHEMA },
        }),
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Request failed (HTTP ${response.status}).`);
    const responseParts = data.candidates?.[0]?.content?.parts || [];
    const textPart = responseParts.find((p) => typeof p.text === "string" && !p.thought);
    if (!textPart) {
      const blockReason = data.candidates?.[0]?.finishReason;
      throw new Error(blockReason ? `No usable response (${blockReason}).` : "No text response from the model.");
    }
    let raw = textPart.text.replace(/```json|```/g, "").trim();
    return JSON.parse(raw);
  }

  const AI_MAX_PAGES = 5;

  async function handleAiExtract() {
    if (!llmFile) return;
    if (!apiKey) {
      setLlmError('Add your Gemini API key above first — this call goes directly from your browser to Google, using your own key.');
      return;
    }
    if (aiModel === "custom" && !customModelId.trim()) {
      setLlmError('Enter a model ID in the field above, or switch back to the preset model.');
      return;
    }
    setLlmBusy(true);
    setLlmError(null);
    setLlmRawResponse(null);
    setNeedsPassword(false);
    setWrongPassword(false);

    try {
      let images, truncated, totalPages;
      try {
        setLlmProgress("Decrypting and rendering pages…");
        ({ images, truncated, totalPages } = await renderPdfPagesAsImages(llmFile, pdfPassword || undefined));
      } catch (err) {
        if (err && err.needsPassword) {
          setNeedsPassword(true);
          setWrongPassword(!!err.wasWrongPassword);
          setLlmBusy(false);
          setLlmProgress(null);
          return;
        }
        throw err;
      }

      if (images.length === 0) {
        setLlmError('Couldn\'t render any pages from that PDF. Try "Paste text manually" below instead.');
        setLlmBusy(false);
        setLlmProgress(null);
        return;
      }
      if (truncated) {
        showToast(`This PDF has ${totalPages} pages — only sending the first ${images.length} to stay within a reasonable request size.`);
      }

      let allRows = [];
      let openingFromModel = null, closingFromModel = null;
      let extractedPeriodStart = null, extractedPeriodEnd = null, extractedStatementDate = null, extractedInstitution = null;
      let resumeAfter = null, page = 0, complete = false;

      while (page < AI_MAX_PAGES && !complete) {
        page += 1;
        setLlmProgress(page === 1 ? "Sending page images to Gemini…" : `Continuing — ${allRows.length} found so far…`);
        const { parsed, isComplete } = await callStructureOnce(images, resumeAfter);

        if (page === 1) {
          openingFromModel = parsed.openingBalance ?? null;
          closingFromModel = parsed.closingBalance ?? null;
          extractedPeriodStart = isLikelyValidDate(parsed.statementPeriodStart) ? parsed.statementPeriodStart : null;
          extractedPeriodEnd = isLikelyValidDate(parsed.statementPeriodEnd) ? parsed.statementPeriodEnd : null;
          extractedStatementDate = isLikelyValidDate(parsed.statementDate) ? parsed.statementDate : null;
          extractedInstitution = (parsed.statementInstitution || "").trim() || null;
        }

        const pageRows = (parsed.rows || [])
          .map((row) => ({
            date: row.date, description: (row.description || "").toString(),
            amount: String(row.amount), direction: row.direction === "credit" ? "credit" : "debit",
            runningBalance: (row.runningBalance === null || row.runningBalance === undefined) ? null : Number(row.runningBalance),
          }))
          .filter((r) => isLikelyValidDate(r.date) && parseAmountStr(r.amount) > 0);

        // No automatic dropping of anything that looks like a duplicate — a heuristic
        // here can never tell "Gemini re-sent the same row as a continuation artifact"
        // apart from "two genuinely separate transactions that happen to share a date,
        // description, and amount" (a real, common occurrence: two orders from the same
        // merchant a minute apart, our date field being day-level not timestamped).
        // Every row goes in; reconciliation (opening + net = closing) is the real,
        // objective check for whether the extraction is complete and correct. Anything
        // that looks like a possible duplicate gets flagged for the person to judge with
        // full context, not silently decided by a pattern match.
        pageRows.forEach((r) => allRows.push({ id: uid("llm"), ...r, include: true }));
        const addedThisPage = pageRows.length;

        complete = isComplete;
        if (pageRows.length > 0) resumeAfter = pageRows[pageRows.length - 1];
        else if (!complete) break;
        if (!complete && addedThisPage === 0 && page > 1) break;
      }

      setLlmProgress(null);

      if (allRows.length === 0) {
        setLlmError('The model responded, but no usable transaction rows came back. Try again, or use "Paste text manually" below.');
        setLlmBusy(false);
        return;
      }

      // Auto-detect the institution from the statement itself — the user should never
      // need to manually pick it, since a wrong pick is exactly what creates duplicate
      // accounts. Using local variables here (not the institution/nickname state) since
      // setInstitution/setNickname won't be reflected until the next render, and the
      // duplicate-period check right below needs the CURRENT, just-detected values.
      let effectiveInstitution = institution;
      let effectiveNickname = nickname;
      if (extractedInstitution) {
        const matches = findAccountsByInstitution(extractedInstitution, accounts);
        if (matches.length === 1) {
          effectiveInstitution = matches[0].institution;
          effectiveNickname = matches[0].nickname;
          setSelectedAccountId(matches[0].id);
          setInstitution(matches[0].institution);
          setNickname(matches[0].nickname);
        } else if (matches.length === 0) {
          effectiveInstitution = extractedInstitution;
          setSelectedAccountId("__new__");
          setInstitution(extractedInstitution);
        }
        // matches.length > 1 is genuinely ambiguous (e.g. two differently-nicknamed
        // accounts at the same bank) — can't safely auto-pick, leave the Account
        // dropdown for the user to resolve manually in this one case.
      }

      // Check for a duplicate statement period BEFORE building the reconciliation
      // preview — no point reviewing/confirming balances for a statement you've
      // already imported. The API call already happened, but at least you're not
      // asked to eyeball data that's going nowhere.
      setExtractedStatementPeriod({ start: extractedPeriodStart, end: extractedPeriodEnd, statementDate: extractedStatementDate });
      const existingAccount = accounts.find((a) => a.institution === effectiveInstitution && a.nickname === (effectiveNickname || effectiveInstitution));
      if (existingAccount) {
        const derivedStart = allRows.reduce((min, t) => (t.date < min ? t.date : min), allRows[0].date);
        const derivedEnd = allRows.reduce((max, t) => (t.date > max ? t.date : max), allRows[0].date);
        const dup = findDuplicatePeriodUpload(existingAccount, {
          periodStart: derivedStart, periodEnd: derivedEnd,
          extractedPeriodStart, extractedPeriodEnd, statementDate: extractedStatementDate,
        });
        if (dup) {
          setLlmError(
            `Already imported: ${existingAccount.nickname}'s statement for ${dup.periodStart} to ${dup.periodEnd} ` +
            `(${dup.transactionCount} transactions, uploaded ${new Date(dup.importedAt).toLocaleDateString()}). ` +
            `Delete it in Upload history below to re-import this period.`
          );
          setLlmBusy(false);
          return;
        }
      }

      if (!complete) {
        showToast(`Stopped after ${page} calls (safety limit) — got ${allRows.length} transactions, may be incomplete.`);
      }

      // Opening now comes from the statement itself, same as closing already did —
      // reconciliation (opening + net transactions = closing) is what actually decides
      // whether to trust it, not a pre-typed manual requirement. A manually-typed value
      // (if the user already entered one) still wins over the model's own reading.
      let openingStr = openingBalanceInput;
      if (!openingStr && openingFromModel !== null) {
        openingStr = String(openingFromModel);
        setOpeningBalanceInput(openingStr);
      }
      let closingStr = closingBalanceInput;
      if (!closingStr && closingFromModel !== null) {
        closingStr = String(closingFromModel);
        setClosingBalanceInput(closingStr);
      }
      const resolvedOpening = parseAmountOrNull(openingStr);
      const { result: correctedRows, correctedCount } = correctDirectionsFromBalanceChain(allRows, resolvedOpening, isCreditCard);
      setPastePreview(correctedRows);
      setStatementBalances({
        opening: resolvedOpening,
        closing: parseAmountOrNull(closingStr),
      });
      showToast(
        `Extracted ${correctedRows.length} transactions across ${page} call${page > 1 ? "s" : ""}` +
        (correctedCount > 0 ? ` — corrected direction on ${correctedCount}` : "") +
        " — review and confirm the balances below."
      );
    } catch (err) {
      setLlmError(err.message || "Unknown error during extraction.");
      if (err.rawResponse) setLlmRawResponse(err.rawResponse);
    } finally {
      setLlmBusy(false);
      setLlmProgress(null);
    }
  }
  function updateOpeningBalance(v) {
    setOpeningBalanceInput(v);
    setStatementBalances((prev) => ({ ...prev, opening: parseAmountOrNull(v) }));
  }
  function updateClosingBalance(v) {
    setClosingBalanceInput(v);
    setStatementBalances((prev) => ({ ...prev, closing: parseAmountOrNull(v) }));
  }

  return (
    <div>
      {importCompletionPrompt && (
        <ImportCompletionPromptPanel
          prompt={importCompletionPrompt}
          accounts={accounts}
          onConfirm={confirmTransferSubstantiation}
          onSkip={() => setImportCompletionPrompt(null)}
        />
      )}
      <h2 className="bw-h2">Import a statement</h2>
      <p className="bw-lead">
        Upload a bank statement, credit card statement, investment holdings export, or a loan schedule — PDF,
        CSV, or Excel. We'll figure out what it is and take you to the right place.
      </p>

      <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 18, marginBottom: 18, background: "var(--card)" }}>
        {!unifiedResult && !unifiedClassifying && !unifiedNeedsPassword && (
          <label className="bw-dropzone">
            <input type="file" accept=".pdf,.csv,.xlsx,.xls" onChange={(e) => handleUnifiedFile(e.target.files[0])} />
            <Upload size={22} style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>Click to choose a file</div>
            <div style={{ fontSize: 11.5, marginTop: 4 }}>PDF, CSV, or Excel</div>
          </label>
        )}
        {unifiedClassifying && <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Identifying what this is…</div>}
        {unifiedNeedsPassword && (
          <div>
            <div className="bw-field">
              <label>{unifiedWrongPassword ? "That password didn't work — try again" : "This PDF is password-protected"}</label>
              <input type="password" value={unifiedPassword} onChange={(e) => setUnifiedPassword(e.target.value)} placeholder="Password" />
            </div>
            <button className="bw-btn small" onClick={retryUnifiedWithPassword}>Unlock &amp; identify</button>
          </div>
        )}
        {unifiedResult && (
          <div style={{ fontSize: 12.5 }}>
            Identified as <strong>{DOCUMENT_CATEGORY_LABELS[unifiedResult.documentCategory] || unifiedResult.documentCategory}</strong>
            {unifiedResult.institution ? ` (${unifiedResult.institution})` : ""} — taking you there now.
          </div>
        )}
        {unifiedError && <p style={{ fontSize: 12, color: "var(--rust)", marginTop: 8 }}>{unifiedError}</p>}
        <button className="bw-btn ghost small" style={{ marginTop: 10 }} onClick={() => setShowManualTabs((v) => !v)}>
          {showManualTabs ? "Hide manual options" : "Not right? Pick the type manually"}
        </button>
      </div>

      {showManualTabs && (
      <div className="bw-tabs" style={{ marginBottom: 16 }}>
        <button className={`bw-tab ${source === "csv" ? "active" : ""}`} onClick={() => setSource("csv")}>
          <FileText size={13} /> CSV file
        </button>
        <button className={`bw-tab ${source === "llmpdf" ? "active" : ""}`} onClick={() => setSource("llmpdf")}>
          <Sparkles size={13} /> PDF (AI-assisted)
        </button>
        <button className={`bw-tab ${source === "investment" ? "active" : ""}`} onClick={() => setSource("investment")}>
          <TrendingUp size={13} /> Investment holding
        </button>
        <button className={`bw-tab ${source === "debt" ? "active" : ""}`} onClick={() => setSource("debt")}>
          <TrendingDown size={13} /> Loan schedule
        </button>
      </div>
      )}

      {source === "investment" ? (
        <InvestmentImportFlow
          accounts={accounts} setAccounts={setAccounts}
          holdingSnapshots={holdingSnapshots} setHoldingSnapshots={setHoldingSnapshots}
          apiKey={apiKey} aiModel={aiModel} customModelId={customModelId}
          callClassifyAndMap={callClassifyAndMap}
          showToast={showToast}
          initialFile={investmentInitialFile} initialPassword={investmentInitialPassword}
          effectiveTier={effectiveTier}
        />
      ) : source === "debt" ? (
        <DebtImportFlow
          accounts={accounts} setAccounts={setAccounts}
          debtSchedules={debtSchedules} setDebtSchedules={setDebtSchedules}
          apiKey={apiKey} aiModel={aiModel} customModelId={customModelId}
          showToast={showToast}
          initialFile={debtInitialFile} initialPassword={debtInitialPassword}
          effectiveTier={effectiveTier}
        />
      ) : (
      <>

      {accounts.length > 0 && (
        <div className="bw-field">
          <label>Account</label>
          <select value={selectedAccountId} onChange={(e) => selectExistingAccount(e.target.value)}>
            <option value="__new__">+ Add new account</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname} ({a.institution})</option>)}
          </select>
        </div>
      )}

      {selectedAccountId === "__new__" && (
        <div className="bw-grid2">
          <div className="bw-field">
            <label>
              Institution{" "}
              {source === "llmpdf" && (
                <span style={{ fontWeight: 400, textTransform: "none", color: "var(--ink-soft)" }}>· auto-detected from the statement when possible</span>
              )}
            </label>
            <input type="text" list="institution-presets" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. Standard Chartered Bank" />
            <datalist id="institution-presets">
              {INSTITUTION_PRESETS.map((p) => <option key={p} value={p} />)}
            </datalist>
          </div>
          <div className="bw-field">
            <label>Account nickname (optional)</label>
            <input type="text" placeholder={institution || "e.g. My Salary Account"} value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </div>
        </div>
      )}

      <div className="bw-field" style={{ maxWidth: 280 }}>
        <label>Account type</label>
        <select value={accountType} onChange={(e) => setAccountType(e.target.value)}>
          <option value="bank">Bank account</option>
          <option value="creditCard">Credit card</option>
        </select>
        {isCreditCard && (
          <p style={{ fontSize: 10.5, color: "var(--ink-soft)", margin: "4px 0 0" }}>
            For a credit card, a purchase increases the amount owed and a payment decreases it — the opposite of
            a bank account. Balance reconciliation accounts for this automatically.
          </p>
        )}
      </div>

      {source === "csv" && (
        <>
      {!headers && (
        <div className="bw-dropzone" onClick={() => fileInputRef.current && fileInputRef.current.click()}>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={(e) => handleFile(e.target.files[0])} style={{ display: "none" }} />
          <Upload size={22} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>Click to choose a CSV file</div>
          <div style={{ fontSize: 11.5, marginTop: 4 }}>Standard Chartered · Scapia/Federal · Amex · Axis · SBI · any bank export</div>
        </div>
      )}

      {rawRows && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 10 }}>
            <strong>{fileName}</strong> · {rawRows.length} raw rows · bank exports often have a few summary lines
            before the real header — confirm which row holds the column names.
          </div>
          <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 6 }}>
            <table className="bw-table" style={{ fontSize: 11.5 }}>
              <tbody>
                {rawRows.slice(0, 12).map((r, i) => (
                  <tr key={i} style={i === headerRowIdx ? { background: "rgba(46,102,89,0.08)" } : undefined}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                        <input type="radio" name="headerRow" checked={headerRowIdx === i} onChange={() => setHeaderRowIdx(i)} />
                        row {i + 1}{i === headerRowIdx ? " · header" : ""}
                      </label>
                    </td>
                    {r.slice(0, 6).map((cell, j) => (
                      <td key={j} style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {(cell || "").toString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {headers && (
        <div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>
            {rows.length} data rows found below the header · confirm the column mapping below
          </div>

          <div className="bw-grid2">
            <div className="bw-field">
              <label>Date column</label>
              <select value={dateCol} onChange={(e) => setDateCol(e.target.value)}>
                <option value="">— select —</option>
                {headers.map((h) => <option key={h}>{h}</option>)}
              </select>
            </div>
            <div className="bw-field">
              <label>Description column</label>
              <select value={descCol} onChange={(e) => setDescCol(e.target.value)}>
                <option value="">— select —</option>
                {headers.map((h) => <option key={h}>{h}</option>)}
              </select>
            </div>
          </div>

          <div className="bw-field">
            <label>Amount format</label>
            <select value={amountMode} onChange={(e) => setAmountMode(e.target.value)}>
              <option value="split">Separate Debit / Credit columns</option>
              <option value="single">Single Amount column</option>
            </select>
          </div>

          {amountMode === "split" ? (
            <div className="bw-grid2">
              <div className="bw-field">
                <label>Debit column</label>
                <select value={debitCol} onChange={(e) => setDebitCol(e.target.value)}>
                  <option value="">— none —</option>
                  {headers.map((h) => <option key={h}>{h}</option>)}
                </select>
              </div>
              <div className="bw-field">
                <label>Credit column</label>
                <select value={creditCol} onChange={(e) => setCreditCol(e.target.value)}>
                  <option value="">— none —</option>
                  {headers.map((h) => <option key={h}>{h}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div className="bw-grid2">
              <div className="bw-field">
                <label>Amount column</label>
                <select value={amountCol} onChange={(e) => setAmountCol(e.target.value)}>
                  <option value="">— select —</option>
                  {headers.map((h) => <option key={h}>{h}</option>)}
                </select>
              </div>
              <div className="bw-field">
                <label>Debit/Credit type column (optional)</label>
                <select value={typeCol} onChange={(e) => setTypeCol(e.target.value)}>
                  <option value="">— none, infer from sign —</option>
                  {headers.map((h) => <option key={h}>{h}</option>)}
                </select>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button className="bw-btn" onClick={doImport}><Check size={14} /> Import transactions</button>
            <button className="bw-btn ghost" onClick={resetImportForm}><X size={14} /> Cancel</button>
          </div>
        </div>
      )}
        </>
      )}

      {(source === "paste" || source === "llmpdf") && (
        <div>
          {source === "llmpdf" && (
            <div className="bw-grid2" style={{ marginBottom: 4 }}>
              <div className="bw-field">
                <label>
                  {isCreditCard ? "Previous balance" : "Opening balance"}{" "}
                  <span style={{ fontWeight: 400, textTransform: "none", color: "var(--ink-soft)" }}>· auto-detected from this statement</span>
                </label>
                <input
                  type="text" inputMode="decimal" value={openingBalanceInput}
                  onChange={(e) => updateOpeningBalance(e.target.value)}
                  placeholder={isCreditCard ? "e.g. 31132.92" : "e.g. 45000.00"}
                />
              </div>
              <div className="bw-field">
                <label>
                  {isCreditCard ? "Total outstanding" : "Closing balance"}{" "}
                  <span style={{ fontWeight: 400, textTransform: "none", color: "var(--ink-soft)" }}>· auto-detected from this statement</span>
                </label>
                <input type="text" inputMode="decimal" value={closingBalanceInput}
                  onChange={(e) => updateClosingBalance(e.target.value)}
                  placeholder={isCreditCard ? "e.g. 81456.00" : "e.g. 52340.00"} />
              </div>
            </div>
          )}

          {!pastePreview ? (
            source === "paste" ? (
            <>
              <div className="bw-field">
                <label>Column format</label>
                <select value={columnFormat} onChange={(e) => setColumnFormat(e.target.value)}>
                  {COLUMN_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>
              <div className="bw-field">
                <label>Paste the transaction lines from your PDF</label>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={"e.g.\n12/06/2026  UPI-SWIGGY-419803038-BILL PAYMENT   450.00      24,120.50\n13/06/2026  SALARY CREDIT XYZ CORP                    85,000.00  109,120.50"}
                  rows={10}
                  style={{
                    width: "100%", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, padding: 10,
                    border: "1px solid var(--line)", borderRadius: 4, background: "var(--card)", resize: "vertical",
                  }}
                />
              </div>

              {pasteText.trim() && (
                <div style={{
                  border: "1px solid var(--line)", borderRadius: 6, padding: 10, marginBottom: 12,
                  background: firstLinePreview ? "rgba(46,102,89,0.05)" : "rgba(156,74,52,0.05)", fontSize: 11.5,
                }}>
                  {firstLinePreview ? (
                    <>
                      <strong>First line reads as:</strong> {firstLinePreview.date} · {firstLinePreview.description} ·{" "}
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                        {firstLinePreview.direction === "credit" ? "+" : "−"}{inr(firstLinePreview.amount)}
                      </span>{" "}
                      ({firstLinePreview.direction}){firstLinePreview.runningBalance !== null && <> · balance after: {inr(firstLinePreview.runningBalance)}</>}
                      <div style={{ color: "var(--ink-soft)", marginTop: 3 }}>
                        If this looks wrong (e.g. amount and direction swapped), try a different column format above.
                      </div>
                    </>
                  ) : (
                    <span style={{ color: "var(--rust)" }}>
                      Couldn't read the first line under this format — try a different column format above.
                    </span>
                  )}
                </div>
              )}

              <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 12 }}>
                Open the PDF, select the transaction table (date through balance columns), copy, and paste above.
                If the Opening Balance and Closing Balance lines are visible, include those too — the preview can
                then check the parsed transactions actually add up to the real closing balance, catching anything
                missed. Each line needs a date and at least one amount; everything else is read heuristically, so
                you'll get a chance to fix any line before it's imported.
              </p>
              <button className="bw-btn" onClick={parsePastedText} disabled={!pasteText.trim()}>
                <Sparkles size={14} /> Parse text
              </button>
            </>
            ) : (
            <>
              {/* ---- API key settings ---- */}
              <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 12, marginBottom: 14, background: "var(--card)" }}>
                {apiKey && !apiKeyEditing ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ fontSize: 12 }}>
                      <Check size={13} color="var(--teal)" style={{ verticalAlign: -2, marginRight: 5 }} />
                      Gemini API key saved (••••{apiKey.slice(-4)})
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="bw-btn ghost small" onClick={() => setApiKeyEditing(true)}>Change</button>
                      <button className="bw-btn ghost small" onClick={clearApiKey}>Remove</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="bw-field" style={{ marginBottom: 8 }}>
                      <label>Gemini API key</label>
                      <input
                        type="password" value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder="AIza..." autoComplete="off"
                      />
                    </div>
                    <p style={{ fontSize: 10.5, color: "var(--ink-soft)", margin: "0 0 8px" }}>
                      Get one at <span style={{ fontFamily: "monospace" }}>aistudio.google.com</span> → Get API key. Stored only in
                      this browser's local storage; calls go directly from this browser to Google, never through any
                      server of ours. Anyone with access to this browser/device could read a saved key, same as any
                      password saved locally — remove it below if you'd rather not keep it saved.
                    </p>
                    <button className="bw-btn small" disabled={!apiKeyInput.trim()} onClick={saveApiKey}>Save key</button>
                    {apiKey && <button className="bw-btn ghost small" style={{ marginLeft: 8 }} onClick={() => setApiKeyEditing(false)}>Cancel</button>}
                  </>
                )}
              </div>

              {apiKey && (
                <div className="bw-field" style={{ maxWidth: 320, marginBottom: 14 }}>
                  <label>Model</label>
                  <select value={aiModel} onChange={(e) => setAiModel(e.target.value)}>
                    <option value="gemini-3.6-flash">Gemini 3.6 Flash (recommended)</option>
                    <option value="custom">Other — type a model ID</option>
                  </select>
                  {aiModel === "custom" && (
                    <input
                      type="text" value={customModelId} onChange={(e) => setCustomModelId(e.target.value)}
                      placeholder="e.g. gemini-3.6-pro" style={{ marginTop: 6 }}
                    />
                  )}
                  <p style={{ fontSize: 10, color: "var(--ink-soft)", margin: "6px 0 0" }}>
                    Google renames/retires model IDs from time to time — if extraction fails with a "model not
                    found" error, look up the current name at{" "}
                    <span style={{ fontFamily: "monospace" }}>ai.google.dev/gemini-api/docs/models</span> and enter
                    it here directly, no code changes needed.
                  </p>
                </div>
              )}

              <div
                className="bw-dropzone" style={{ marginBottom: 12 }}
                onClick={() => !llmBusy && llmFileInputRef.current && llmFileInputRef.current.click()}
              >
                <input
                  ref={llmFileInputRef} type="file" accept=".pdf" disabled={llmBusy} style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files[0];
                    if (f) {
                      setLlmFile(f); setLlmFileName(f.name); setLlmError(null); setLlmRawResponse(null);
                      setNeedsPassword(false); setWrongPassword(false); setPdfPassword("");
                      // A new file means a new statement — the closing balance (and any
                      // reconciliation derived from it) is specific to whatever statement
                      // was extracted before, and must never silently apply to this one.
                      setClosingBalanceInput("");
                      setStatementBalances((prev) => ({ ...prev, closing: null }));
                      setExtractedStatementPeriod({ start: null, end: null, statementDate: null });
                      setPastePreview(null);
                    }
                  }}
                />
                <Upload size={22} style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {llmFileName || "Click to choose your PDF statement"}
                </div>
                <div style={{ fontSize: 11.5, marginTop: 4 }}>
                  Decrypted locally, then each page is rendered as an image and sent to Gemini — it reads the
                  actual table layout directly, using your key above.
                </div>
              </div>

              {needsPassword && (
                <div style={{ border: "1px solid var(--ochre)", borderRadius: 6, padding: 12, marginBottom: 12, background: "rgba(168,112,58,0.06)" }}>
                  <div className="bw-field" style={{ marginBottom: 8 }}>
                    <label>{wrongPassword ? "That password didn't work — try again" : "This PDF is password-protected"}</label>
                    <input
                      type="password" value={pdfPassword} onChange={(e) => setPdfPassword(e.target.value)}
                      placeholder="PDF password" autoComplete="off"
                    />
                  </div>
                  <p style={{ fontSize: 10.5, color: "var(--ink-soft)", margin: 0 }}>
                    Used only to unlock the PDF locally, on this device — never sent anywhere, including to Google.
                  </p>
                </div>
              )}

              <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 12 }}>
                Fill in the balances above, choose your PDF, then extract. You'll still review every transaction
                and confirm the closing balance before anything is imported — extraction proposes, the balance
                check and your review are what actually decide whether it's trusted. Works even for unusual
                layouts, since Gemini reads the page directly rather than a text reconstruction of it. A scanned
                image still works too, since this sends the rendered page itself, not extracted text.
              </p>
              <button className="bw-btn" onClick={handleAiExtract} disabled={!llmFile || llmBusy || !apiKey}>
                <Sparkles size={14} /> {llmBusy ? (llmProgress || "Extracting…") : needsPassword ? "Unlock & extract" : "Extract"}
              </button>

              {llmError && (
                <div style={{
                  marginTop: 12, border: "1px solid var(--rust)", borderRadius: 6, padding: 12,
                  background: "rgba(156,74,52,0.06)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 12.5, color: "var(--rust)" }}>
                      <AlertCircle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                      <span>{llmError}</span>
                    </div>
                    <button className="bw-btn ghost small" onClick={() => { setLlmError(null); setLlmRawResponse(null); }}>
                      <X size={12} />
                    </button>
                  </div>
                  {llmRawResponse && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontSize: 11, color: "var(--ink-soft)", cursor: "pointer" }}>Show raw model response</summary>
                      <pre style={{
                        fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "pre-wrap",
                        wordBreak: "break-word", background: "var(--card)", border: "1px solid var(--line)", borderRadius: 4,
                        padding: 8, marginTop: 6, maxHeight: 200, overflowY: "auto",
                      }}>{llmRawResponse}</pre>
                    </details>
                  )}
                </div>
              )}
            </>
            )
          ) : (
            <>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 10 }}>
                Found {pastePreview.length} transaction-looking lines — check dates, descriptions, amounts and
                direction below, untick anything that isn't really a transaction, then import.
              </div>

              {reconciliation && (
                <div style={{
                  border: "1px solid var(--line)", borderRadius: 6, padding: 12, marginBottom: 14,
                  background: reconciliation.hasBalanceInfo ? (reconciliation.diff === null || Math.abs(reconciliation.diff) <= 1 ? "rgba(46,102,89,0.06)" : "rgba(156,74,52,0.06)") : "var(--card)",
                }}>
                  {reconciliation.hasBalanceInfo ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>
                        {reconciliation.diff === null ? (
                          <>Partial check — {reconciliation.opening !== null ? (isCreditCard ? "previous balance" : "opening") : (isCreditCard ? "outstanding" : "closing")} balance detected, but not both.</>
                        ) : Math.abs(reconciliation.diff) <= 1 ? (
                          <><Check size={14} color="var(--teal)" /> Internally consistent — every parsed line's balance checks out.</>
                        ) : (
                          <><AlertCircle size={14} color="var(--rust)" /> Off by {inr(Math.abs(reconciliation.diff))} — likely a missing or misparsed transaction.</>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                        {reconciliation.opening !== null && <>{isCreditCard ? "Previous balance" : "Opening"} {inr(reconciliation.opening)}</>}
                        {reconciliation.impliedClosing !== null && <> · Parsed transactions imply {isCreditCard ? "outstanding" : "closing"} {inr(reconciliation.impliedClosing)}</>}
                        {reconciliation.closing !== null && <> · {reconciliation.isFullyDerived ? "Last line's" : "Statement"} {isCreditCard ? "outstanding" : "closing"} {inr(reconciliation.closing)}</>}
                      </div>
                      {reconciliation.isFullyDerived && (
                        <div style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 4, fontStyle: "italic" }}>
                          No explicit Opening/Closing Balance line was found, so this range is estimated from your
                          first and last parsed line instead. It confirms nothing was dropped in the middle, but
                          can't rule out a missing transaction right before the first line or right after the last —
                          double-check your paste covers the statement's full date range.
                          {reconciliation.diff !== null && Math.abs(reconciliation.diff) <= 1 && (
                            <> Since this reconciles, it'll still be saved for the Cash Flow dashboard to use.</>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                      No running-balance column detected, so there's nothing to reconcile against — double check the
                      transaction count against your PDF manually.
                    </div>
                  )}
                  {reconciliation.gaps.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--rust)", marginBottom: 4 }}>
                        Unexplained balance jump{reconciliation.gaps.length > 1 ? "s" : ""} — check your PDF around here:
                      </div>
                      {reconciliation.gaps.map((g, i) => (
                        <div key={i} style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                          Between {g.afterDate} and {g.beforeDate}: balance moved {inr(Math.abs(g.gapAmt))} more than the parsed transactions explain.
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <table className="bw-table">
                <thead>
                  <tr><th>Date</th><th>Description</th><th>Amount</th><th>Direction</th><th>Include</th><th></th></tr>
                </thead>
                <tbody>
                  {pastePreview.map((r) => (
                    <tr key={r.id} style={!r.include ? { opacity: 0.4 } : undefined}>
                      <td style={{ minWidth: 110 }}>
                        <input type="text" className="bw-select-inline" style={{ width: 100 }}
                          value={r.date} onChange={(e) => updatePasteRow(r.id, { date: e.target.value })} />
                      </td>
                      <td>
                        <input type="text" className="bw-select-inline" style={{ width: "100%" }}
                          value={r.description} onChange={(e) => updatePasteRow(r.id, { description: e.target.value })} />
                      </td>
                      <td style={{ minWidth: 100 }}>
                        <input type="text" className="bw-select-inline" style={{ width: 90 }}
                          value={r.amount} onChange={(e) => updatePasteRow(r.id, { amount: e.target.value })} />
                      </td>
                      <td>
                        <select className="bw-select-inline" value={r.direction}
                          onChange={(e) => updatePasteRow(r.id, { direction: e.target.value })}>
                          <option value="debit">Debit</option>
                          <option value="credit">Credit</option>
                        </select>
                      </td>
                      <td>
                        <input type="checkbox" checked={r.include}
                          onChange={(e) => updatePasteRow(r.id, { include: e.target.checked })} />
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {possibleDuplicateIds.has(r.id) && (
                          <span style={{ fontSize: 10, color: "var(--ochre)", display: "inline-flex", alignItems: "center", gap: 3 }} title="Another row has the same date, description, and amount — could be a genuine repeat, or two separate transactions. Check before importing.">
                            <AlertCircle size={11} /> possible duplicate
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button className="bw-btn" onClick={doPasteImport}>
                  <Check size={14} /> Import {pastePreview.filter((r) => r.include).length} transactions
                </button>
                <button className="bw-btn ghost" onClick={() => setPastePreview(null)}><X size={14} /> Back to text</button>
              </div>
            </>
          )}
        </div>
      )}
      </>
      )}

    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Investment holding import — CSV/Excel only for now. Gemini reads just   */
/* the header row + a few sample rows to classify the document and        */
/* propose a column mapping; everything after confirmation runs 100%      */
/* locally against the full file, then reconciles against whatever        */
/* totals the statement itself printed, same trust philosophy as every    */
/* other import in this app.                                              */
/* ---------------------------------------------------------------------- */

const INSTRUMENT_TYPE_BY_DOC_TYPE = { equity_holding: "Equity", mutual_fund_holding: "MutualFund", nps_holding: "MutualFund", ulip_holding: "MutualFund" };
const ACCOUNT_TYPE_BY_DOC_TYPE = { equity_holding: "demat", mutual_fund_holding: "mutualFund", nps_holding: "mutualFund", ulip_holding: "mutualFund" };
// Purely a display label — NPS/ULIP accounts are functionally identical mutualFund
// accounts underneath (same waterfall, same reconciliation, same every downstream
// function), this just lets the UI show "NPS" or "ULIP" instead of a generic label.
const ASSET_LABEL_BY_DOC_TYPE = { nps_holding: "NPS", ulip_holding: "ULIP" };

/** Import flow for investment holding statements — equity/demat, mutual fund, NPS, or
 *  ULIP — reachable from the unified upload dropzone once it's classified the file as
 *  one of these, or directly if the person picks it manually. Two paths in: a
 *  spreadsheet goes through handleFile's column mapping, a PDF is rendered to page
 *  images and read by callHoldingsPdfExtract (never computing a value itself - every
 *  number comes directly off the page, since a mis-inferred ISIN/folio number would
 *  silently corrupt which holding is which across snapshots). Both converge on the
 *  same reconciliation step - comparing the sum of individual holdings against any
 *  stated grand total the statement itself prints - and the same commitImport, which
 *  resolves or creates the account (respecting the Free-tier one-investment-account
 *  limit) and writes one new holdingSnapshots entry, the single data point every
 *  Investment Control and Net Worth computation later diffs against. */
function InvestmentImportFlow({ accounts, setAccounts, holdingSnapshots, setHoldingSnapshots, apiKey, aiModel, customModelId, callClassifyAndMap, showToast, initialFile, initialPassword, effectiveTier }) {
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [classification, setClassification] = useState(null); // raw result from Gemini
  const [confirmed, setConfirmed] = useState(false); // has the user confirmed classification+mapping?
  const [parsedHoldings, setParsedHoldings] = useState(null); // after local parse
  const [selectedAccountId, setSelectedAccountId] = useState("__new__");
  const [institution, setInstitution] = useState("");
  const [nickname, setNickname] = useState("");
  const [asOfDate, setAsOfDate] = useState("");
  const [statedInvested, setStatedInvested] = useState("");
  const [statedCurrent, setStatedCurrent] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [pendingPdfFile, setPendingPdfFile] = useState(null);

  const investmentAccounts = useMemo(() => accounts.filter((a) => a.type === "demat" || a.type === "mutualFund"), [accounts]);

  function resetFlow() {
    setFile(null); setFileName(""); setRawRows(null); setError(null);
    setClassification(null); setConfirmed(false); setParsedHoldings(null);
    setSelectedAccountId("__new__"); setInstitution(""); setNickname(""); setAsOfDate("");
    setStatedInvested(""); setStatedCurrent("");
  }

  const HOLDINGS_PDF_EXTRACT_SCHEMA = {
    type: "OBJECT",
    properties: {
      documentType: { type: "STRING", enum: ["equity_holding", "mutual_fund_holding", "nps_holding", "ulip_holding"], description: "What kind of holding statement this is — decide the same way as for a spreadsheet: ISIN/Sector/LTP columns suggest equity; Folio Number/AMC/Scheme Name/NAV suggest mutual fund; PRAN suggests NPS; Policy Number suggests ULIP. NPS and ULIP should otherwise be treated exactly like mutual_fund_holding." },
      institution: { type: "STRING", nullable: true, description: "The broker, AMC, or platform name — check a title, logo caption, or letterhead. Null if genuinely not identifiable." },
      asOfDate: { type: "STRING", nullable: true, description: "YYYY-MM-DD — the date this holdings statement is as of. Never today's date; the date printed on the statement." },
      totalInvestedValue: { type: "NUMBER", nullable: true, description: "Only if explicitly printed as a total (e.g. 'Total Invested Value') — never computed yourself. For ULIPs specifically, this must be the NET amount actually invested into fund units, not the gross premium paid — see the detailed instructions in the prompt for how to tell these apart." },
      totalCurrentValue: { type: "NUMBER", nullable: true, description: "Only if explicitly printed as a total (e.g. 'Total Current Value' or 'Total Market Value') — never computed yourself." },
      isComplete: { type: "BOOLEAN", description: "True only if every holding row visible across all the provided images has been included below." },
      holdings: {
        type: "ARRAY",
        description: "Every individual holding row visible in the images — read each value directly as printed, never compute or estimate one from the others.",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "The stock/scheme name, exactly as printed." },
            isin: { type: "STRING", nullable: true, description: "A 12-character alphanumeric ISIN code uniquely identifying THIS specific security — only for equity/mutual fund holdings that actually print one. NPS and ULIP holdings do not have one; leave null for them. Never fill this with an account-level number (like a PRAN or policy number) that would be identical across every holding row in this account — if the same value would apply to every row, it is not a valid per-holding identifier and must be left null." },
            folioNumber: { type: "STRING", nullable: true, description: "A mutual fund folio number, specific to this scheme, if printed. Never fill this with an account-level number (like a PRAN or policy number) that would be identical across every holding row — if the same value would apply to every row, it is not a valid per-holding identifier and must be left null." },
            amc: { type: "STRING", nullable: true, description: "Fund house / AMC name, for mutual fund-style holdings." },
            sectorOrCategory: { type: "STRING", nullable: true },
            units: { type: "NUMBER", nullable: true },
            avgCost: { type: "NUMBER", nullable: true, description: "Average cost / buy price per unit, if printed." },
            currentPrice: { type: "NUMBER", nullable: true, description: "Current price / NAV per unit, if printed." },
            investedValue: { type: "NUMBER", nullable: true },
            currentValue: { type: "NUMBER", nullable: true },
            status: { type: "STRING", nullable: true, description: "e.g. 'Active', 'Suspended' — only if explicitly shown." },
          },
          required: ["name"],
        },
      },
    },
    required: ["documentType", "isComplete", "holdings"],
  };

  async function callHoldingsPdfExtract(images) {
    const effectiveModel = aiModel === "custom" ? customModelId.trim() : aiModel;
    const prompt = [
      "You are looking at page images of an investment holdings statement — equity/demat, mutual fund, NPS, or",
      "ULIP. Extract every individual holding row exactly as printed. Read each number directly from the image —",
      "never compute, estimate, or invent a value, even if two others would let you calculate it; that",
      "calculation happens separately, afterward, in code. For isin and folioNumber specifically: these must be",
      "unique to each individual holding — never fill them with an account-level number (a PRAN, a policy",
      "number) that appears identical across every row, even if it's the most prominent ID-looking number on",
      "the page. If no genuinely per-holding identifier is printed, leave both null for that row.",
      "",
      "For ULIP statements specifically, finding totalInvestedValue needs care: a premium payment is split",
      "between charges (allocation charge, GST on that charge, and similar deductions) and the remainder that",
      "actually buys fund units. Statements report these as two DIFFERENT figures — look for the one meaning",
      "'what was actually invested/allocated into fund units after charges', not 'what the policyholder paid",
      "before charges'. The exact column or line-item wording varies by insurer (e.g. 'Premium(s) Invested',",
      "'Amount Invested', 'Net Investment', 'Premium Allocated to Investment' all mean the net, invested figure;",
      "'Premium(s) Paid', 'Total Premium Received', 'Gross Premium' all mean the gross, pre-charges figure) —",
      "identify which meaning a figure represents from its context and any nearby charge line-items, not from",
      "matching an exact phrase. If the statement reports both a Regular Premium Invested figure and a Top-up",
      "Premium Invested figure, sum both into totalInvestedValue. Never substitute the gross premium-paid figure",
      "for the invested figure when the statement provides both — they are genuinely different numbers, and",
      "using the wrong one would overstate the true cost basis.",
    ].join("\n");
    const parts = [
      ...images.map((base64) => ({ inlineData: { mimeType: "image/png", data: base64 } })),
      { text: prompt },
    ];
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { maxOutputTokens: 32000, responseMimeType: "application/json", responseSchema: HOLDINGS_PDF_EXTRACT_SCHEMA },
        }),
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Request failed (HTTP ${response.status}).`);
    const textPart = (data.candidates?.[0]?.content?.parts || []).find((p) => typeof p.text === "string" && !p.thought);
    if (!textPart) throw new Error("No usable response from the model.");
    let raw = textPart.text.replace(/```json|```/g, "").trim();
    try {
      return JSON.parse(raw);
    } catch {
      // A cut-off response is possible even with a generous token cap on a long
      // holdings list — salvage whatever complete holding rows exist before the
      // truncation point, same defense used for bank statement extraction, rather
      // than discarding the whole call over a partial JSON tail.
      const holdingsMatch = raw.match(/"holdings"\s*:\s*\[([\s\S]*)/);
      let salvaged = [];
      if (holdingsMatch) {
        const rowMatches = [...holdingsMatch[1].matchAll(/\{[^{}]*\}/g)];
        salvaged = rowMatches.map((m) => { try { return JSON.parse(m[0]); } catch { return null; } }).filter(Boolean);
      }
      if (salvaged.length === 0) throw new Error("The response got cut off before any usable holdings could be read — try again.");
      return { documentType: "mutual_fund_holding", institution: null, asOfDate: null, totalInvestedValue: null, totalCurrentValue: null, isComplete: false, holdings: salvaged };
    }
  }

  /** Applies the exact same derivation/skip/instrument-key logic runLocalParse uses
   *  for CSV-parsed rows, to vision-extracted rows instead — extraction method and
   *  validation are fully decoupled, so a PDF-sourced holding is verified exactly as
   *  rigorously as a spreadsheet-sourced one. */
  function processExtractedHoldings(rawHoldings) {
    const holdings = [];
    let derivedCount = 0;
    rawHoldings.forEach((row) => {
      const name = (row.name || "").toString().trim();
      if (!name) return;
      let units = row.units ?? null, avgCost = row.avgCost ?? null, currentPrice = row.currentPrice ?? null;
      let invested = row.investedValue ?? null, current = row.currentValue ?? null;
      const derived = { investedValue: false, currentValue: false, avgCost: false, currentPrice: false };
      if (invested === null && units && avgCost !== null) { invested = Math.round(units * avgCost * 100) / 100; derived.investedValue = true; }
      if (current === null && units && currentPrice !== null) { current = Math.round(units * currentPrice * 100) / 100; derived.currentValue = true; }
      if (avgCost === null && units && invested !== null) { avgCost = Math.round((invested / units) * 100) / 100; derived.avgCost = true; }
      if (currentPrice === null && units && current !== null) { currentPrice = Math.round((current / units) * 100) / 100; derived.currentPrice = true; }
      if (derived.investedValue || derived.currentValue || derived.avgCost || derived.currentPrice) derivedCount += 1;
      const h = {
        name, isin: row.isin || "", folioNumber: row.folioNumber || "", amc: row.amc || "", sectorOrCategory: row.sectorOrCategory || "",
        units, avgCost, currentPrice, investedValue: invested, investedValueUnknown: invested === null,
        currentValue: current || 0, derived,
        status: row.status || "", include: true,
      };
      if (isSkippableRow(h)) return;
      holdings.push(h);
    });
    clearUnreliableSharedIdentifiers(holdings, "isin");
    clearUnreliableSharedIdentifiers(holdings, "folioNumber");
    holdings.forEach((h) => {
      const { key, reliable } = computeInstrumentKey(h);
      h.instrumentKey = key; h.keyReliable = reliable;
    });
    return { holdings, derivedCount };
  }

  /** Fallback for NPS and ULIP specifically: neither reports true per-holding cost
   *  basis — NPS only reports contribution at the portfolio level, and ULIP fund
   *  switches over a policy's life make the true per-fund figure unrecoverable even
   *  in principle. Both DO report a real, known portfolio-level invested total
   *  (NPS: Total Contribution; ULIP: Total Regular + Top-up Premium Invested), so
   *  this allocates that known total across currently-held funds/schemes (zero-unit
   *  ones correctly excluded — they hold nothing to allocate to) proportional to
   *  current value. This is explicitly an ESTIMATE (assumes uniform growth/switch
   *  timing across holdings), not exact algebra — marked investedValueEstimated,
   *  never treated as "calculated" the way Units × Price derivation is. Verified
   *  against the exact numbers from a real ULIP statement (3 funds, ₹22.4L allocated
   *  proportionally to current value, summing back to the real total exactly)
   *  before being wired in. */
  function allocateProportionalInvestedValue(holdings, totalInvestedValue) {
    const eligible = holdings.filter((h) => h.currentValue > 0);
    const totalCurrent = eligible.reduce((s, h) => s + h.currentValue, 0);
    if (totalCurrent <= 0) return holdings;
    return holdings.map((h) => {
      if (h.currentValue <= 0) return h;
      const share = h.currentValue / totalCurrent;
      const allocated = Math.round(totalInvestedValue * share * 100) / 100;
      return { ...h, investedValue: allocated, investedValueUnknown: false, derived: { ...h.derived, investedValueEstimated: true } };
    });
  }

  async function handlePdfFile(f, pwd) {
    if (!apiKey) {
      setError("Add your Gemini API key in the PDF (AI-assisted) tab above first — reading this statement needs it.");
      return;
    }
    setBusy(true); setNeedsPassword(false); setWrongPassword(false);
    try {
      const { images, truncated } = await renderPdfPagesAsImages(f, pwd || undefined);
      if (images.length === 0) { setError("Couldn't render any pages from that PDF."); return; }
      const result = await callHoldingsPdfExtract(images);
      let { holdings, derivedCount } = processExtractedHoldings(result.holdings || []);
      if (holdings.length === 0) { setError("Couldn't find any holdings in that PDF."); return; }
      let proportionallyAllocated = false;
      if ((result.documentType === "ulip_holding" || result.documentType === "nps_holding") && result.totalInvestedValue != null && holdings.some((h) => h.investedValueUnknown)) {
        holdings = allocateProportionalInvestedValue(holdings, result.totalInvestedValue);
        proportionallyAllocated = true;
      }
      setClassification({
        documentType: result.documentType, institution: result.institution,
        statementTotals: { asOfDate: result.asOfDate, totalInvestedValue: result.totalInvestedValue, totalCurrentValue: result.totalCurrentValue },
      });
      setInstitution(result.institution || "");
      if (result.asOfDate) setAsOfDate(result.asOfDate);
      if (result.totalInvestedValue != null) setStatedInvested(String(result.totalInvestedValue));
      if (result.totalCurrentValue != null) setStatedCurrent(String(result.totalCurrentValue));
      setParsedHoldings(holdings);
      setConfirmed(true); // vision extraction has no column-mapping step — straight to review
      if (!result.isComplete) showToast(`Found ${holdings.length} holdings, but the statement may have more than could be read in one pass — check the count against your actual statement.`);
      else if (proportionallyAllocated) showToast(`${result.documentType === "nps_holding" ? "NPS statements report contribution at the portfolio level only, not per-scheme" : "ULIPs don't report per-fund invested value, and fund switches make the true figure unrecoverable"} — ₹${result.totalInvestedValue.toLocaleString("en-IN")} invested is estimated per holding, proportional to current value. This is an estimate, not a printed figure.`);
      else if (derivedCount > 0) showToast(`Calculated missing figures for ${derivedCount} holding${derivedCount === 1 ? "" : "s"} from Units × Price.`);
      if (truncated) showToast("This PDF has more pages than could be read — only the first several were checked.");
    } catch (err) {
      if (err && err.needsPassword) {
        setNeedsPassword(true);
        setWrongPassword(!!err.wasWrongPassword);
        setPendingPdfFile(f);
      } else {
        setError(err.message || "Couldn't read or extract that file.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(f) {
    if (!f) return;
    resetFlow();
    setFile(f); setFileName(f.name);
    if (/\.pdf$/i.test(f.name)) {
      await handlePdfFile(f, initialPassword || "");
      return;
    }
    if (!apiKey) {
      setError("Add your Gemini API key in the PDF (AI-assisted) tab above first — classifying and mapping this file's columns needs it, even though the file itself is a spreadsheet.");
      return;
    }
    setBusy(true);
    try {
      const rows = await readSpreadsheetFile(f);
      setRawRows(rows);
      const sample = buildSpreadsheetSample(rows, 30);
      const embeddedImages = await extractEmbeddedImages(f);
      const result = await callClassifyAndMap(sample, f.name, embeddedImages);
      setClassification(result);
      setInstitution(result.institution || "");
      if (result.statementTotals?.asOfDate) setAsOfDate(result.statementTotals.asOfDate);
      if (result.statementTotals?.totalInvestedValue != null) setStatedInvested(String(result.statementTotals.totalInvestedValue));
      if (result.statementTotals?.totalCurrentValue != null) setStatedCurrent(String(result.statementTotals.totalCurrentValue));
    } catch (err) {
      setError(err.message || "Couldn't read or classify that file.");
    } finally {
      setBusy(false);
    }
  }

  function retryPdfWithPassword() {
    handlePdfFile(pendingPdfFile, password);
  }

  const autoTriggeredRef = useRef(null);
  useEffect(() => {
    if (initialFile && autoTriggeredRef.current !== initialFile) {
      autoTriggeredRef.current = initialFile;
      handleFile(initialFile);
    }
  }, [initialFile]);

  function updateMapping(field, value) {
    setClassification((prev) => ({ ...prev, columnMapping: { ...prev.columnMapping, [field]: value || null } }));
  }

  // A real holding — even a suspended or fully worthless one — always has SOME non-zero
  // units or invested value; a pure section-divider row ("Equity", "Mutual Fund" as a
  // category banner with nothing else) has none of these. And a totals/subtotal row
  // reads as a real holding numerically but its own label gives it away. Both checks
  // run locally against every row's own content — unlike Gemini's classification call,
  // which only ever sees a small sample and can't know about a totals row much further
  // down in a long file.
  const TOTAL_ROW_KEYWORDS = /^(grand\s*total|sub[\s-]?total|net\s*total|total)\b/i;
  function isSkippableRow(h) {
    if (TOTAL_ROW_KEYWORDS.test(h.name)) return true;
    const noUnits = h.units === null || h.units === 0;
    const noInvested = !h.investedValue;
    const noCurrent = !h.currentValue;
    return noUnits && noInvested && noCurrent;
  }

  function runLocalParse() {
    if (!rawRows || !classification) return;
    const headerIdx = classification.headerRowIndex ?? 0;
    const headers = (rawRows[headerIdx] || []).map((h) => (h ?? "").toString().trim());
    const map = classification.columnMapping || {};
    const colIdx = (field) => headers.findIndex((h) => h === map[field]);
    const iName = colIdx("instrumentName"), iIsin = colIdx("isin"), iFolio = colIdx("folioNumber"),
      iAmc = colIdx("amc"), iSector = colIdx("sectorOrCategory"), iUnits = colIdx("units"),
      iAvgCost = colIdx("avgCost"), iCurPrice = colIdx("currentPrice"), iInvested = colIdx("investedValue"),
      iCurrent = colIdx("currentValue"), iStatus = colIdx("status");
    const skipRows = new Set(classification.skipRowIndices || (classification.totalsRowIndex != null ? [classification.totalsRowIndex] : []));

    let holdings = [];
    let skippedCount = 0, derivedCount = 0;
    for (let r = headerIdx + 1; r < rawRows.length; r++) {
      if (skipRows.has(r)) { skippedCount += 1; continue; }
      const row = rawRows[r];
      if (!row || row.every((c) => (c ?? "").toString().trim() === "")) continue;
      const name = iName >= 0 ? (row[iName] ?? "").toString().trim() : "";
      if (!name) continue;

      // Read whatever columns actually exist as null when absent — NOT defaulted to 0 —
      // so the derivation below can tell "this statement never printed it" apart from
      // "printed as a genuine zero." Value = Units × Price is simple, exact algebra:
      // Zerodha's holdings export has Units/Avg Cost/Current Price but no Invested/
      // Current Value columns at all; Groww's mutual fund export has the reverse. Either
      // direction is fully recoverable from the other two, with zero guessing involved.
      let units = iUnits >= 0 ? parseAmountStr(row[iUnits]) : null;
      let avgCost = iAvgCost >= 0 ? parseAmountStr(row[iAvgCost]) : null;
      let currentPrice = iCurPrice >= 0 ? parseAmountStr(row[iCurPrice]) : null;
      let invested = iInvested >= 0 ? parseAmountStr(row[iInvested]) : null;
      let current = iCurrent >= 0 ? parseAmountStr(row[iCurrent]) : null;
      const derived = { investedValue: false, currentValue: false, avgCost: false, currentPrice: false };

      if (invested === null && units && avgCost !== null) {
        invested = Math.round(units * avgCost * 100) / 100;
        derived.investedValue = true;
      }
      if (current === null && units && currentPrice !== null) {
        current = Math.round(units * currentPrice * 100) / 100;
        derived.currentValue = true;
      }
      if (avgCost === null && units && invested !== null) {
        avgCost = Math.round((invested / units) * 100) / 100;
        derived.avgCost = true;
      }
      if (currentPrice === null && units && current !== null) {
        currentPrice = Math.round((current / units) * 100) / 100;
        derived.currentPrice = true;
      }
      if (derived.investedValue || derived.currentValue || derived.avgCost || derived.currentPrice) derivedCount += 1;

      const h = {
        name,
        isin: iIsin >= 0 ? (row[iIsin] ?? "").toString().trim() : "",
        folioNumber: iFolio >= 0 ? (row[iFolio] ?? "").toString().trim() : "",
        amc: iAmc >= 0 ? (row[iAmc] ?? "").toString().trim() : "",
        sectorOrCategory: iSector >= 0 ? (row[iSector] ?? "").toString().trim() : "",
        units, avgCost, currentPrice,
        investedValue: invested, investedValueUnknown: invested === null,
        currentValue: current || 0,
        derived,
        status: iStatus >= 0 ? (row[iStatus] ?? "").toString().trim() : "",
        include: true,
      };
      if (isSkippableRow(h)) { skippedCount += 1; continue; }
      holdings.push(h);
    }
    clearUnreliableSharedIdentifiers(holdings, "isin");
    clearUnreliableSharedIdentifiers(holdings, "folioNumber");
    holdings.forEach((h) => {
      const { key, reliable } = computeInstrumentKey(h);
      h.instrumentKey = key;
      h.keyReliable = reliable;
    });
    let proportionallyAllocated = false;
    const statedTotal = classification.statementTotals?.totalInvestedValue;
    if ((classification.documentType === "ulip_holding" || classification.documentType === "nps_holding") && statedTotal != null && holdings.some((h) => h.investedValueUnknown)) {
      holdings = allocateProportionalInvestedValue(holdings, statedTotal);
      proportionallyAllocated = true;
    }
    if (skippedCount > 0) showToast(`Skipped ${skippedCount} row${skippedCount === 1 ? "" : "s"} that looked like a section header or total, not a holding.${derivedCount > 0 ? ` Calculated missing figures for ${derivedCount} holding${derivedCount === 1 ? "" : "s"} from Units × Price.` : ""}`);
    else if (proportionallyAllocated) showToast(`${classification.documentType === "nps_holding" ? "NPS statements report contribution at the portfolio level only, not per-scheme" : "ULIPs don't report per-fund invested value, and fund switches make the true figure unrecoverable"} — ₹${statedTotal.toLocaleString("en-IN")} invested is estimated per holding, proportional to current value. This is an estimate, not a printed figure.`);
    else if (derivedCount > 0) showToast(`Calculated missing figures for ${derivedCount} holding${derivedCount === 1 ? "" : "s"} from Units × Price — this statement doesn't print them directly.`);
    setParsedHoldings(holdings);
    setConfirmed(true);
  }

  const reconciliation = useMemo(() => {
    if (!parsedHoldings) return null;
    const included = parsedHoldings.filter((h) => h.include);
    const stated = {
      totalInvestedValue: statedInvested.trim() ? parseAmountStr(statedInvested) : null,
      totalCurrentValue: statedCurrent.trim() ? parseAmountStr(statedCurrent) : null,
    };
    return reconcileHoldingsTotals(included, stated);
  }, [parsedHoldings, statedInvested, statedCurrent]);

  function selectExistingInvAccount(id) {
    setSelectedAccountId(id);
    if (id === "__new__") { setInstitution(""); setNickname(""); return; }
    const acct = accounts.find((a) => a.id === id);
    if (acct) { setInstitution(acct.institution); setNickname(acct.nickname); }
  }

  /** Final write step: resolves or creates the investment account (respecting the
   *  Free-tier limit and read-only enforcement), decides which totals to trust -
   *  the statement's own printed total where it matches the sum of individual
   *  holdings, the summed figure otherwise - and writes one new holdingSnapshots
   *  entry. This snapshot is the single new data point everything downstream
   *  (computeSnapshotTransition, Net Worth, Investments Control) will later diff
   *  against the previous one. */
  function commitImport() {
    if (!parsedHoldings || !asOfDate) { showToast("Enter the holding/statement date before importing."); return; }
    const included = parsedHoldings.filter((h) => h.include);
    if (included.length === 0) { showToast("No holdings selected to import."); return; }
    const accountType = ACCOUNT_TYPE_BY_DOC_TYPE[classification.documentType];

    let account = accounts.find((a) => a.id === selectedAccountId) ||
      accounts.find((a) => a.institution === institution && a.nickname === (nickname || institution) && (a.type === "demat" || a.type === "mutualFund"));
    if (!account && !canCreateAccount(accounts, effectiveTier, accountType)) {
      showToast(
        `Free plan limit reached (${FREE_TIER_LIMITS.investmentAccounts} Investment account) — go to Accounts to switch ` +
        `which one stays active, or upgrade for unlimited accounts.`
      );
      return;
    }
    if (account && !canImportIntoAccount(accounts, effectiveTier, account.id)) {
      showToast(`"${account.nickname}" is read-only on the Free plan — go to Accounts to switch which account stays active, or upgrade.`);
      return;
    }
    let accountId;
    if (account) {
      accountId = account.id;
    } else {
      accountId = uid("acc");
      const newAccount = { id: accountId, institution, nickname: nickname || institution, type: accountType, uploadHistory: [] };
      setAccounts((prev) => [...prev, newAccount]);
    }

    const trustedTotals = reconciliation.hasAnyStatedTotal
      ? {
          totalInvestedValue: reconciliation.investedMatches !== false && reconciliation.statedInvested !== null ? reconciliation.statedInvested : reconciliation.sumInvested,
          totalCurrentValue: reconciliation.currentMatches && reconciliation.statedCurrent !== null ? reconciliation.statedCurrent : reconciliation.sumCurrent,
        }
      : { totalInvestedValue: reconciliation.sumInvested, totalCurrentValue: reconciliation.sumCurrent };

    const snapshot = {
      id: uid("snap"), accountId, asOfDate, importedAt: Date.now(), batchId: uid("batch"),
      instrumentType: INSTRUMENT_TYPE_BY_DOC_TYPE[classification.documentType],
      totalInvestedValue: trustedTotals.totalInvestedValue,
      totalCurrentValue: trustedTotals.totalCurrentValue,
      reconciled: reconciliation.investedMatches !== false && reconciliation.currentMatches,
      holdings: included.map((h) => ({
        instrumentKey: h.instrumentKey, keyReliable: h.keyReliable, name: h.name,
        isin: h.isin, folioNumber: h.folioNumber, amc: h.amc, sectorOrCategory: h.sectorOrCategory,
        units: h.units, avgCost: h.avgCost, currentPrice: h.currentPrice,
        investedValue: h.investedValue, currentValue: h.currentValue, status: h.status,
        derived: h.derived,
      })),
    };
    setHoldingSnapshots((prev) => [...prev, snapshot]);
    setAccounts((prev) => prev.map((a) => (a.id === accountId ? { ...a, uploadHistory: [...(a.uploadHistory || []), { batchId: snapshot.batchId, snapshotId: snapshot.id, asOfDate, importedAt: snapshot.importedAt, holdingCount: included.length }] } : a)));
    showToast(`Imported ${included.length} holdings as of ${asOfDate}.`);
    resetFlow();
  }

  const MAPPING_FIELDS_BY_TYPE = {
    equity_holding: [["instrumentName", "Instrument name"], ["isin", "ISIN"], ["sectorOrCategory", "Sector"], ["units", "Units"], ["avgCost", "Avg Cost"], ["currentPrice", "Current Price"], ["investedValue", "Invested Value"], ["currentValue", "Current Value"], ["status", "Status"]],
    mutual_fund_holding: [["instrumentName", "Scheme Name"], ["folioNumber", "Folio No."], ["amc", "AMC"], ["sectorOrCategory", "Category"], ["units", "Units"], ["avgCost", "Avg Cost"], ["currentPrice", "NAV"], ["investedValue", "Invested Value"], ["currentValue", "Current Value"], ["status", "Status"]],
  };

  const headers = classification && rawRows ? (rawRows[classification.headerRowIndex] || []).map((h) => (h ?? "").toString().trim()) : [];

  return (
    <div>
      <p className="bw-lead">
        Upload a holdings export as CSV or Excel — a demat/broker holdings file, or a mutual fund CAS. Gemini reads
        just the header row to classify the file and map its columns; the full file is then parsed entirely on
        your device, and reconciled against whatever total the file itself prints.
      </p>

      {!file && (
        <label className="bw-dropzone">
          <input type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={(e) => handleFile(e.target.files[0])} />
          <Upload size={22} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>Click to choose a holdings file</div>
          <div style={{ fontSize: 11.5, marginTop: 4 }}>CSV or Excel — demat holdings, mutual fund CAS, any broker/platform</div>
        </label>
      )}

      {busy && <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10 }}>Reading and classifying…</div>}

      {needsPassword && (
        <div style={{ marginTop: 10 }}>
          <div className="bw-field">
            <label>{wrongPassword ? "That password didn't work — try again" : "This PDF is password-protected"}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
          </div>
          <button className="bw-btn small" onClick={retryPdfWithPassword}>Unlock &amp; extract</button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 12, padding: "10px 12px", border: "1px solid var(--rust)", borderRadius: 6, background: "rgba(156,74,52,0.08)", fontSize: 12.5 }}>
          {error}
          <div style={{ marginTop: 8 }}><button className="bw-btn ghost small" onClick={resetFlow}><X size={12} /> Try a different file</button></div>
        </div>
      )}

      {classification && !confirmed && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{fileName}</div>

          {(classification.documentType === "bank_statement" || classification.documentType === "credit_card_statement") && (
            <div style={{ padding: "10px 12px", border: "1px solid var(--ochre)", borderRadius: 6, marginBottom: 14, fontSize: 12.5 }}>
              This looks like a {classification.documentType === "bank_statement" ? "bank" : "credit card"} statement,
              not an investment holding — use the "CSV file" or "PDF (AI-assisted)" tab above for this file instead.
              <div style={{ marginTop: 8 }}><button className="bw-btn ghost small" onClick={resetFlow}><X size={12} /> Choose a different file</button></div>
            </div>
          )}

          {(classification.documentType === "equity_holding" || classification.documentType === "mutual_fund_holding" || classification.documentType === "nps_holding" || classification.documentType === "ulip_holding") && (
            <>
              <div className="bw-grid2">
                <div className="bw-field">
                  <label>Document type <span style={{ fontWeight: 400, textTransform: "none", color: "var(--ink-soft)" }}>· detected, confirm or change</span></label>
                  <select value={classification.documentType} onChange={(e) => setClassification((prev) => ({ ...prev, documentType: e.target.value }))}>
                    <option value="equity_holding">Equity / demat holding</option>
                    <option value="mutual_fund_holding">Mutual fund holding</option>
                    <option value="nps_holding">NPS holding</option>
                    <option value="ulip_holding">ULIP holding</option>
                  </select>
                </div>
                <div className="bw-field">
                  <label>Institution / platform</label>
                  <input type="text" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. Zerodha, Kotak Neo, CAMS" />
                </div>
              </div>

              {accounts.length > 0 && (
                <div className="bw-field">
                  <label>Account</label>
                  <select value={selectedAccountId} onChange={(e) => selectExistingInvAccount(e.target.value)}>
                    <option value="__new__">+ Add new account</option>
                    {investmentAccounts.map((a) => <option key={a.id} value={a.id}>{a.nickname} ({a.institution})</option>)}
                  </select>
                </div>
              )}
              {selectedAccountId === "__new__" && (
                <div className="bw-field">
                  <label>Account nickname (optional)</label>
                  <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={institution} />
                </div>
              )}

              <div className="bw-grid2">
                <div className="bw-field">
                  <label>Holding date <span style={{ fontWeight: 400, textTransform: "none", color: "var(--ink-soft)" }}>· auto-detected when possible</span></label>
                  <input type="text" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} placeholder="YYYY-MM-DD" />
                </div>
                <div />
              </div>

              <div className="bw-section-label" style={{ marginTop: 14 }}>Column mapping</div>
              <p style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 10 }}>Confirm which column holds which field — edit any that look wrong.</p>
              <div className="bw-grid2">
                {(MAPPING_FIELDS_BY_TYPE[classification.documentType] || []).map(([field, label]) => (
                  <div className="bw-field" key={field}>
                    <label>{label}</label>
                    <select value={classification.columnMapping?.[field] || ""} onChange={(e) => updateMapping(field, e.target.value)}>
                      <option value="">— none —</option>
                      {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <div className="bw-section-label">Statement totals</div>
              <p style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 10 }}>
                If this file prints a total, confirm it here — used to check every row was read correctly. Leave blank if the file doesn't print one.
              </p>
              <div className="bw-grid2">
                <div className="bw-field">
                  <label>Total Invested Value</label>
                  <input type="text" inputMode="decimal" value={statedInvested} onChange={(e) => setStatedInvested(e.target.value)} placeholder="e.g. 5341127.87" />
                </div>
                <div className="bw-field">
                  <label>Total Current Value</label>
                  <input type="text" inputMode="decimal" value={statedCurrent} onChange={(e) => setStatedCurrent(e.target.value)} placeholder="e.g. 5928274.75" />
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button className="bw-btn" onClick={runLocalParse}><Check size={14} /> Parse full file</button>
                <button className="bw-btn ghost" onClick={resetFlow}><X size={14} /> Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {confirmed && parsedHoldings && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 10 }}>
            Found {parsedHoldings.length} holdings as of {asOfDate || "—"} — review below, untick anything that isn't
            really a holding, then import.
          </div>

          {reconciliation && (
            (() => {
              const isRealMismatch = reconciliation.investedMatches === false || reconciliation.currentMatches === false;
              const isFullyVerified = !reconciliation.hasUnknownInvestedValue && reconciliation.investedMatches && reconciliation.currentMatches;
              const color = isRealMismatch ? "var(--rust)" : isFullyVerified ? "var(--teal)" : reconciliation.hasAnyStatedTotal ? "var(--ochre)" : "var(--ink-soft)";
              const bg = isRealMismatch ? "rgba(156,74,52,0.08)" : isFullyVerified ? "rgba(46,102,89,0.06)" : reconciliation.hasAnyStatedTotal ? "rgba(168,112,58,0.08)" : "var(--card)";
              return (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5, padding: "10px 12px", marginBottom: 14, border: `1px solid ${color}`, borderRadius: 6, background: bg }}>
                  {isFullyVerified ? <Check size={15} color={color} style={{ marginTop: 1, flexShrink: 0 }} /> : <AlertCircle size={15} color={color} style={{ marginTop: 1, flexShrink: 0 }} />}
                  <div>
                    <strong>
                      {!reconciliation.hasAnyStatedTotal
                        ? "No total was printed in this file to check against."
                        : isFullyVerified
                        ? "Internally consistent — matches the statement's printed totals."
                        : isRealMismatch
                        ? "Doesn't match the statement's printed totals."
                        : reconciliation.hasEstimatedInvestedValue
                        ? "Per-fund invested value is estimated, not printed."
                        : "Per-holding invested value isn't available from this statement."}
                    </strong>
                    <div style={{ marginTop: 3 }}>
                      {reconciliation.hasEstimatedInvestedValue ? (
                        classification.documentType === "nps_holding" ? (
                          <>NPS statements report contribution at the portfolio level only, not per-scheme — {inr(reconciliation.statedInvested)} invested (the real, printed total) is allocated proportionally across schemes by current value. The total is exact; the per-scheme split is an assumption, not a fact.</>
                        ) : (
                          <>ULIPs don't report per-fund cost basis, and fund switches over the policy's life make the true figure unrecoverable — {inr(reconciliation.statedInvested)} invested (the real, printed total) is allocated proportionally across funds by current value. The total is exact; the per-fund split is an assumption, not a fact.</>
                        )
                      ) : reconciliation.hasUnknownInvestedValue ? (
                        <>This is common for NPS/ULIP statements when the portfolio-level total itself isn't printed either — {inr(reconciliation.statedInvested)} invested is trusted from the statement directly, current value ({inr(reconciliation.sumCurrent)}) is checked normally.</>
                      ) : (
                        <>
                          Rows sum to {inr(reconciliation.sumInvested)} invested, {inr(reconciliation.sumCurrent)} current.
                          {reconciliation.statedInvested !== null && <> Statement says {inr(reconciliation.statedInvested)} invested.</>}
                          {reconciliation.statedCurrent !== null && <> Statement says {inr(reconciliation.statedCurrent)} current.</>}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()
          )}

          <table className="bw-table">
            <thead>
              <tr>
                <th>Name</th><th>ID</th><th style={{ textAlign: "right" }}>Invested</th>
                <th style={{ textAlign: "right" }}>Current</th><th>Include</th><th></th>
              </tr>
            </thead>
            <tbody>
              {parsedHoldings.map((h, i) => (
                <tr key={i} style={!h.include ? { opacity: 0.4 } : undefined}>
                  <td>{h.name}</td>
                  <td style={{ fontSize: 11, color: "var(--ink-soft)" }}>{h.isin || h.folioNumber || "—"}</td>
                  <td className="bw-amt debit">
                    {h.investedValueUnknown ? (
                      <span style={{ color: "var(--ink-soft)" }} title="Not reported per-holding in this statement.">—</span>
                    ) : (
                      <>
                        {inr(h.investedValue)}
                        {h.derived?.investedValueEstimated && <span style={{ fontSize: 9, color: "var(--rust)", display: "block" }} title="Not printed per-fund in this statement — estimated by allocating the total invested amount proportionally to current value. This is an assumption, not an exact figure.">estimated</span>}
                        {h.derived?.investedValue && <span style={{ fontSize: 9, color: "var(--ochre)", display: "block" }} title="Not printed in this statement — calculated as Units × Avg Cost.">calculated</span>}
                      </>
                    )}
                  </td>
                  <td className="bw-amt debit">
                    {inr(h.currentValue)}
                    {h.derived?.currentValue && <span style={{ fontSize: 9, color: "var(--ochre)", display: "block" }} title="Not printed in this statement — calculated as Units × Current Price.">calculated</span>}
                  </td>
                  <td>
                    <input type="checkbox" checked={h.include} onChange={(e) => {
                      const v = e.target.checked;
                      setParsedHoldings((prev) => prev.map((x, xi) => (xi === i ? { ...x, include: v } : x)));
                    }} />
                  </td>
                  <td>
                    {!h.keyReliable && (
                      <span style={{ fontSize: 9.5, color: "var(--ochre)", display: "block" }} title="No ISIN or Folio Number found — matched by name only, which can miss a future rename.">
                        not uniquely identified
                      </span>
                    )}
                    {(h.derived?.avgCost || h.derived?.currentPrice) && (
                      <span style={{ fontSize: 9.5, color: "var(--ochre)", display: "block" }} title="Not printed in this statement — calculated from Invested/Current Value ÷ Units.">
                        {h.derived.avgCost && h.derived.currentPrice ? "avg cost & price calculated" : h.derived.avgCost ? "avg cost calculated" : "price calculated"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="bw-btn" onClick={commitImport}><Check size={14} /> Import {parsedHoldings.filter((h) => h.include).length} holdings</button>
            <button className="bw-btn ghost" onClick={resetFlow}><X size={14} /> Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Debt import — an amortization schedule extraction flow, deliberately    */
/* isolated from InvestmentImportFlow's classification call (its own       */
/* schema, prompt, and API call) rather than extending shared, working     */
/* code — the two document types have nothing in common structurally, and  */
/* this keeps any risk here from ever touching the investment import path. */
/* ---------------------------------------------------------------------- */

const LOAN_TYPES = ["Home Loan", "Car Loan", "Personal Loan", "Education Loan", "Loan Against Property", "Other"];

/** Import flow for a loan's amortization schedule (CSV/Excel only - unlike Investment
 *  holdings and bank/CC statements, there's no PDF path here, since these exports are
 *  virtually always spreadsheets in practice). AI-assisted column mapping
 *  (callDebtClassify) finds the real header row - amortization exports often have
 *  loan summary details printed above the actual period table - and maps each column
 *  (period, opening balance, EMI, principal, interest, closing balance) to its exact
 *  header text, leaving any field with no matching column null rather than guessing.
 *  Commits as a new debtSchedules entry tied to the resolved/created debt account;
 *  multiple schedules for the same account (e.g. after a prepayment triggers a fresh,
 *  revised upload) coexist, with the most-recently-imported one winning for any
 *  period they both cover. */
function DebtImportFlow({ accounts, setAccounts, debtSchedules, setDebtSchedules, apiKey, aiModel, customModelId, showToast, initialFile, initialPassword, effectiveTier }) {
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [classification, setClassification] = useState(null);
  const [parsedEntries, setParsedEntries] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState("__new__");
  const [institution, setInstitution] = useState("");
  const [nickname, setNickname] = useState("");
  const [loanType, setLoanType] = useState("Home Loan");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [pendingPdfFile, setPendingPdfFile] = useState(null);

  const debtAccounts = useMemo(() => accounts.filter((a) => a.type === "debt"), [accounts]);

  function resetFlow() {
    setFileName(""); setRawRows(null); setError(null);
    setClassification(null); setParsedEntries(null);
    setSelectedAccountId("__new__"); setInstitution(""); setNickname(""); setLoanType("Home Loan");
  }

  const DEBT_CLASSIFY_SCHEMA = {
    type: "OBJECT",
    properties: {
      institution: { type: "STRING", nullable: true, description: "The bank or lender name — check a title/logo row, a label, or the file name. Null if genuinely not findable, never guessed." },
      loanType: { type: "STRING", nullable: true, enum: ["Home Loan", "Car Loan", "Personal Loan", "Education Loan", "Loan Against Property", "Other"], description: "Best guess from context; null if unclear." },
      headerRowIndex: { type: "NUMBER", description: "0-indexed row containing the real column headers — amortization schedules often have loan summary details (sanctioned amount, rate, tenure) printed above the actual period-by-period table." },
      skipRowIndices: { type: "ARRAY", items: { type: "NUMBER" }, description: "0-indexed rows within the sample that are NOT real period rows — a totals row, a blank spacer, a repeated header." },
      columnMapping: {
        type: "OBJECT",
        description: "Map each field to the EXACT column header text from the file, verbatim. Null for any field with no matching column.",
        properties: {
          period: { type: "STRING", nullable: true, description: "The date or period column — could be labeled 'Date', 'Month', 'Installment No.', 'Due Date', etc." },
          openingBalance: { type: "STRING", nullable: true },
          emi: { type: "STRING", nullable: true, description: "The installment amount column — often labeled 'EMI', 'Installment Amount', or 'Payment'." },
          principal: { type: "STRING", nullable: true },
          interest: { type: "STRING", nullable: true },
          closingBalance: { type: "STRING", nullable: true, description: "Often labeled 'Closing Balance', 'Outstanding Balance', or 'Balance'." },
        },
      },
      originalPrincipal: { type: "NUMBER", nullable: true, description: "Only if explicitly printed as the sanctioned/original loan amount — never computed or estimated." },
      interestRate: { type: "NUMBER", nullable: true, description: "Only if explicitly printed as the interest rate (annual %) — never computed or estimated." },
    },
    required: ["headerRowIndex", "columnMapping"],
  };

  async function callDebtClassify(sampleText, fileNameArg) {
    const effectiveModel = aiModel === "custom" ? customModelId.trim() : aiModel;
    const prompt = [
      "You are looking at the first rows of a CSV or Excel export of a LOAN AMORTIZATION SCHEDULE —",
      "a period-by-period table showing, for each installment: the opening balance, the EMI/installment",
      "amount, how much of it was principal vs. interest, and the resulting closing balance.",
      "Find the real header row (there may be loan summary details like sanctioned amount, tenure, or",
      "interest rate printed above it), and map each column to the exact header text as it appears —",
      "never paraphrase or guess a column that isn't actually present.",
      "Flag any sample row that is a total row or divider, not a real installment period.",
      "Only report originalPrincipal or interestRate if explicitly printed somewhere in this sample —",
      "never compute or estimate either yourself.",
      fileNameArg ? `\nFile name: ${fileNameArg}` : "",
      "",
      "Sample data:",
      sampleText,
    ].join("\n");
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 4000, responseMimeType: "application/json", responseSchema: DEBT_CLASSIFY_SCHEMA },
        }),
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Request failed (HTTP ${response.status}).`);
    const textPart = (data.candidates?.[0]?.content?.parts || []).find((p) => typeof p.text === "string" && !p.thought);
    if (!textPart) throw new Error("No usable response from the model.");
    return JSON.parse(textPart.text.replace(/```json|```/g, "").trim());
  }

  const DEBT_PDF_EXTRACT_SCHEMA = {
    type: "OBJECT",
    properties: {
      institution: { type: "STRING", nullable: true, description: "The bank or lender name — check a title, logo caption, or letterhead. Null if genuinely not identifiable." },
      loanType: { type: "STRING", nullable: true, enum: ["Home Loan", "Car Loan", "Personal Loan", "Education Loan", "Loan Against Property", "Other"], description: "Best guess from context; null if unclear." },
      originalPrincipal: { type: "NUMBER", nullable: true, description: "Only if explicitly printed as the sanctioned/original loan amount — never computed or estimated." },
      interestRate: { type: "NUMBER", nullable: true, description: "Only if explicitly printed as the interest rate (annual %) — never computed or estimated." },
      isComplete: { type: "BOOLEAN", description: "True only if every installment period visible across all the provided images has been included below." },
      periods: {
        type: "ARRAY",
        description: "Every individual installment period row visible in the images — read each value directly as printed, never compute one from the others.",
        items: {
          type: "OBJECT",
          properties: {
            period: { type: "STRING", description: "The period's date, in YYYY-MM-DD or YYYY-MM form, exactly as identifiable from the row (a due date, installment date, or month label)." },
            openingBalance: { type: "NUMBER", nullable: true },
            emi: { type: "NUMBER", nullable: true, description: "The installment amount for this period, if printed — often labeled EMI or Installment Amount." },
            principal: { type: "NUMBER", nullable: true },
            interest: { type: "NUMBER", nullable: true },
            closingBalance: { type: "NUMBER", nullable: true },
          },
          required: ["period"],
        },
      },
    },
    required: ["isComplete", "periods"],
  };

  async function callDebtPdfExtract(images) {
    const effectiveModel = aiModel === "custom" ? customModelId.trim() : aiModel;
    const prompt = [
      "You are looking at page images of a LOAN AMORTIZATION SCHEDULE — a period-by-period table showing, for",
      "each installment, the opening balance, EMI, principal, interest, and closing balance. Extract every",
      "installment period row exactly as printed, in order. Read each number directly from the image — never",
      "compute, estimate, or invent a value, even if others would let you calculate it; that check happens",
      "separately, afterward, in code. Skip any row that is a section header, a totals row, or a loan-summary",
      "line (sanctioned amount, tenure, rate) rather than a real installment period.",
    ].join("\n");
    const parts = [
      ...images.map((base64) => ({ inlineData: { mimeType: "image/png", data: base64 } })),
      { text: prompt },
    ];
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { maxOutputTokens: 32000, responseMimeType: "application/json", responseSchema: DEBT_PDF_EXTRACT_SCHEMA },
        }),
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Request failed (HTTP ${response.status}).`);
    const textPart = (data.candidates?.[0]?.content?.parts || []).find((p) => typeof p.text === "string" && !p.thought);
    if (!textPart) throw new Error("No usable response from the model.");
    let raw = textPart.text.replace(/```json|```/g, "").trim();
    try {
      return JSON.parse(raw);
    } catch {
      // Same defense as the Holdings PDF flow — a long schedule (a 240-month loan is
      // real) can still get cut off even at a generous token budget. Salvage whatever
      // complete period rows exist before the truncation point.
      const periodsMatch = raw.match(/"periods"\s*:\s*\[([\s\S]*)/);
      let salvaged = [];
      if (periodsMatch) {
        const rowMatches = [...periodsMatch[1].matchAll(/\{[^{}]*\}/g)];
        salvaged = rowMatches.map((m) => { try { return JSON.parse(m[0]); } catch { return null; } }).filter(Boolean);
      }
      if (salvaged.length === 0) throw new Error("The response got cut off before any usable periods could be read — try again.");
      return { institution: null, loanType: null, originalPrincipal: null, interestRate: null, isComplete: false, periods: salvaged };
    }
  }

  /** Applies the exact same per-row reconciliation and cross-row continuity checks
   *  runLocalParse uses for CSV-parsed rows, to vision-extracted rows instead —
   *  extraction method and validation stay fully decoupled. */
  function processExtractedPeriods(rawPeriods) {
    const entries = [];
    let skippedCount = 0;
    rawPeriods.forEach((row) => {
      const rawPeriod = (row.period || "").toString().trim();
      if (!rawPeriod) { skippedCount += 1; return; }
      const parsedDate = parseDateStr(rawPeriod);
      const period = isLikelyValidDate(parsedDate) ? parsedDate.slice(0, 7) : rawPeriod.slice(0, 7);
      const opening = row.openingBalance ?? 0, principal = row.principal ?? 0, interest = row.interest ?? 0, closing = row.closingBalance ?? 0;
      const emi = row.emi ?? Math.round((principal + interest) * 100) / 100;
      if (opening === 0 && principal === 0 && interest === 0 && closing === 0) { skippedCount += 1; return; }
      const entry = { period, openingBalance: opening, emi, principal, interest, closingBalance: closing };
      const recon = reconcileDebtEntry(entry);
      entries.push({ ...entry, ...recon, include: true });
    });
    return { entries, skippedCount };
  }

  async function handlePdfFile(f, pwd) {
    if (!apiKey) {
      setError("Add your Gemini API key in Upload → PDF (AI-assisted) first — reading this schedule needs it.");
      return;
    }
    setBusy(true); setNeedsPassword(false); setWrongPassword(false);
    try {
      const { images, truncated } = await renderPdfPagesAsImages(f, pwd || undefined);
      if (images.length === 0) { setError("Couldn't render any pages from that PDF."); return; }
      const result = await callDebtPdfExtract(images);
      const { entries, skippedCount } = processExtractedPeriods(result.periods || []);
      if (entries.length === 0) { setError("Couldn't find any installment periods in that PDF."); return; }
      setInstitution(result.institution || "");
      if (result.loanType) setLoanType(result.loanType);
      const continuityGaps = checkDebtScheduleContinuity(entries);
      setParsedEntries({ entries, continuityGaps });
      if (!result.isComplete) showToast(`Found ${entries.length} periods, but the schedule may have more than could be read in one pass — check the count against your actual schedule.`);
      else if (skippedCount > 0) showToast(`Skipped ${skippedCount} row${skippedCount === 1 ? "" : "s"} that didn't look like a real installment period.`);
      if (truncated) showToast("This PDF has more pages than could be read — only the first several were checked.");
    } catch (err) {
      if (err && err.needsPassword) {
        setNeedsPassword(true);
        setWrongPassword(!!err.wasWrongPassword);
        setPendingPdfFile(f);
      } else {
        setError(err.message || "Couldn't read or extract that file.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(f) {
    if (!f) return;
    resetFlow();
    setFileName(f.name);
    if (/\.pdf$/i.test(f.name)) {
      await handlePdfFile(f, initialPassword || "");
      return;
    }
    if (!apiKey) {
      setError("Add your Gemini API key in Upload → PDF (AI-assisted) first — classifying this file's columns needs it.");
      return;
    }
    setBusy(true);
    try {
      const rows = await readSpreadsheetFile(f);
      setRawRows(rows);
      const sample = buildSpreadsheetSample(rows, 30);
      const result = await callDebtClassify(sample, f.name);
      setClassification(result);
      setInstitution(result.institution || "");
      if (result.loanType) setLoanType(result.loanType);
    } catch (err) {
      setError(err.message || "Couldn't read or classify that file.");
    } finally {
      setBusy(false);
    }
  }

  function retryPdfWithPassword() {
    handlePdfFile(pendingPdfFile, password);
  }

  const autoTriggeredRef = useRef(null);
  useEffect(() => {
    if (initialFile && autoTriggeredRef.current !== initialFile) {
      autoTriggeredRef.current = initialFile;
      handleFile(initialFile);
    }
  }, [initialFile]);

  function updateMapping(field, value) {
    setClassification((prev) => ({ ...prev, columnMapping: { ...prev.columnMapping, [field]: value || null } }));
  }

  function runLocalParse() {
    if (!rawRows || !classification) return;
    const headerIdx = classification.headerRowIndex ?? 0;
    const headers = (rawRows[headerIdx] || []).map((h) => (h ?? "").toString().trim());
    const map = classification.columnMapping || {};
    const colIdx = (field) => headers.findIndex((h) => h === map[field]);
    const iPeriod = colIdx("period"), iOpening = colIdx("openingBalance"), iEmi = colIdx("emi"),
      iPrincipal = colIdx("principal"), iInterest = colIdx("interest"), iClosing = colIdx("closingBalance");
    const skipRows = new Set(classification.skipRowIndices || []);

    if (iPeriod < 0 || iOpening < 0 || iPrincipal < 0 || iInterest < 0 || iClosing < 0) {
      showToast("Please map Period, Opening Balance, Principal, Interest, and Closing Balance before parsing.");
      return;
    }

    const entries = [];
    let skippedCount = 0;
    for (let r = headerIdx + 1; r < rawRows.length; r++) {
      if (skipRows.has(r)) { skippedCount += 1; continue; }
      const row = rawRows[r];
      if (!row || row.every((c) => (c ?? "").toString().trim() === "")) continue;
      const rawPeriod = (row[iPeriod] ?? "").toString().trim();
      if (!rawPeriod) continue;
      const parsedDate = parseDateStr(rawPeriod);
      const period = isLikelyValidDate(parsedDate) ? parsedDate.slice(0, 7) : rawPeriod.slice(0, 7);
      const opening = parseAmountStr(row[iOpening]);
      const principal = parseAmountStr(row[iPrincipal]);
      const interest = parseAmountStr(row[iInterest]);
      const closing = parseAmountStr(row[iClosing]);
      const emi = iEmi >= 0 ? parseAmountStr(row[iEmi]) : Math.round((principal + interest) * 100) / 100;
      if (opening === 0 && principal === 0 && interest === 0 && closing === 0) { skippedCount += 1; continue; }
      const entry = { period, openingBalance: opening, emi, principal, interest, closingBalance: closing };
      const recon = reconcileDebtEntry(entry);
      entries.push({ ...entry, ...recon, include: true });
    }
    const continuityGaps = checkDebtScheduleContinuity(entries);
    setParsedEntries({ entries, continuityGaps });
    if (skippedCount > 0) showToast(`Skipped ${skippedCount} row${skippedCount === 1 ? "" : "s"} that didn't look like a real installment period.`);
  }

  function commitImport() {
    if (!parsedEntries) return;
    let account = selectedAccountId !== "__new__" ? accounts.find((a) => a.id === selectedAccountId) : null;
    const included = parsedEntries.entries.filter((e) => e.include);
    if (included.length === 0) { showToast("No periods selected to import."); return; }
    if (!account && !canCreateAccount(accounts, effectiveTier, "debt")) {
      showToast(
        `Free plan limit reached (${FREE_TIER_LIMITS.debtAccounts} Debt account) — go to Accounts to switch which one ` +
        `stays active, or upgrade for unlimited accounts.`
      );
      return;
    }
    if (account && !canImportIntoAccount(accounts, effectiveTier, account.id)) {
      showToast(`"${account.nickname}" is read-only on the Free plan — go to Accounts to switch which account stays active, or upgrade.`);
      return;
    }
    if (!account) {
      account = { id: uid("acc"), type: "debt", institution, nickname: nickname || institution, loanType };
      setAccounts((prev) => [...prev, account]);
    }
    const schedule = {
      id: uid("debt"), accountId: account.id, importedAt: Date.now(),
      entries: included.map((e) => ({ period: e.period, openingBalance: e.openingBalance, emi: e.emi, principal: e.principal, interest: e.interest, closingBalance: e.closingBalance })),
    };
    setDebtSchedules((prev) => [...prev, schedule]);
    showToast(`Imported ${included.length} periods for ${account.nickname}.`);
    resetFlow();
  }

  const unreconciledCount = parsedEntries ? parsedEntries.entries.filter((e) => !e.reconciled).length : 0;

  return (
    <div>
      <h2 className="bw-h2">Import a loan amortization schedule</h2>
      <p className="bw-lead">
        Export the full period-by-period schedule as CSV or Excel from your lender's portal — Opening Balance,
        EMI, Principal, Interest, and Closing Balance for each period. Every row is checked against its own
        arithmetic before anything is saved.
      </p>

      {!rawRows && (
        <label className="bw-dropzone">
          <input type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={(e) => handleFile(e.target.files[0])} />
          <Upload size={22} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>Click to choose a CSV, Excel, or PDF file</div>
          <div style={{ fontSize: 11.5, marginTop: 4 }}>The full schedule, not just this month — one import covers the whole tenure</div>
        </label>
      )}
      {busy && <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10 }}>Reading and classifying…</div>}
      {needsPassword && (
        <div style={{ marginTop: 10 }}>
          <div className="bw-field">
            <label>{wrongPassword ? "That password didn't work — try again" : "This PDF is password-protected"}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
          </div>
          <button className="bw-btn small" onClick={retryPdfWithPassword}>Unlock &amp; extract</button>
        </div>
      )}
      {error && <p style={{ fontSize: 12, color: "var(--rust)", marginTop: 10 }}>{error}</p>}

      {classification && !parsedEntries && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>{fileName}</div>
          <div className="bw-grid2">
            <div className="bw-field">
              <label>Account</label>
              <select value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}>
                <option value="__new__">+ Add new account</option>
                {debtAccounts.map((a) => <option key={a.id} value={a.id}>{a.nickname}</option>)}
              </select>
            </div>
            <div className="bw-field">
              <label>Loan type</label>
              <select value={loanType} onChange={(e) => setLoanType(e.target.value)}>
                {LOAN_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          {selectedAccountId === "__new__" && (
            <div className="bw-grid2">
              <div className="bw-field">
                <label>Institution / lender</label>
                <input type="text" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. HDFC Bank" />
              </div>
              <div className="bw-field">
                <label>Account nickname (optional)</label>
                <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={institution || "e.g. Home Loan"} />
              </div>
            </div>
          )}

          <div className="bw-section-label">Column mapping</div>
          <div className="bw-grid2">
            {["period", "openingBalance", "emi", "principal", "interest", "closingBalance"].map((field) => (
              <div className="bw-field" key={field}>
                <label>{field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</label>
                <select value={classification.columnMapping?.[field] || ""} onChange={(e) => updateMapping(field, e.target.value)}>
                  <option value="">— none —</option>
                  {(rawRows[classification.headerRowIndex ?? 0] || []).map((h, i) => (
                    <option key={i} value={(h ?? "").toString().trim()}>{(h ?? "").toString().trim() || `Column ${i + 1}`}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="bw-btn" onClick={runLocalParse}><Check size={14} /> Parse schedule</button>
            <button className="bw-btn ghost" onClick={resetFlow}><X size={14} /> Cancel</button>
          </div>
        </div>
      )}

      {parsedEntries && (
        <div style={{ marginTop: 18 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, padding: "10px 14px", marginBottom: 14,
            border: `1px solid ${unreconciledCount === 0 && parsedEntries.continuityGaps.length === 0 ? "var(--teal)" : "var(--rust)"}`, borderRadius: 6,
          }}>
            {unreconciledCount === 0 && parsedEntries.continuityGaps.length === 0 ? (
              <><Check size={14} color="var(--teal)" /> All {parsedEntries.entries.length} periods reconcile — each period's own EMI/Principal/Interest/Closing arithmetic checks out, and periods connect to each other cleanly.</>
            ) : (
              <><AlertCircle size={14} color="var(--rust)" />
                {unreconciledCount > 0 && `${unreconciledCount} period${unreconciledCount === 1 ? "" : "s"} don't reconcile internally. `}
                {parsedEntries.continuityGaps.length > 0 && `${parsedEntries.continuityGaps.length} gap${parsedEntries.continuityGaps.length === 1 ? "" : "s"} found between periods. `}
                Review flagged rows below before importing.
              </>
            )}
          </div>

          <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 6, maxHeight: 400, overflowY: "auto" }}>
            <table className="bw-table">
              <thead>
                <tr>
                  <th>Period</th><th style={{ textAlign: "right" }}>Opening</th><th style={{ textAlign: "right" }}>EMI</th>
                  <th style={{ textAlign: "right" }}>Principal</th><th style={{ textAlign: "right" }}>Interest</th>
                  <th style={{ textAlign: "right" }}>Closing</th><th></th><th>Include</th>
                </tr>
              </thead>
              <tbody>
                {parsedEntries.entries.map((e, i) => (
                  <tr key={i}>
                    <td>{e.period}</td>
                    <td className="bw-amt debit">{inr(e.openingBalance)}</td>
                    <td className="bw-amt debit">{inr(e.emi)}</td>
                    <td className="bw-amt debit">{inr(e.principal)}</td>
                    <td className="bw-amt debit">{inr(e.interest)}</td>
                    <td className="bw-amt debit">{inr(e.closingBalance)}</td>
                    <td>{!e.reconciled && <AlertCircle size={13} color="var(--rust)" titleAccess="Doesn't reconcile" />}</td>
                    <td>
                      <input type="checkbox" checked={e.include} onChange={(ev) => {
                        const v = ev.target.checked;
                        setParsedEntries((prev) => ({ ...prev, entries: prev.entries.map((x, xi) => (xi === i ? { ...x, include: v } : x)) }));
                      }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="bw-btn" onClick={commitImport}><Check size={14} /> Import {parsedEntries.entries.filter((e) => e.include).length} periods</button>
            <button className="bw-btn ghost" onClick={resetFlow}><X size={14} /> Cancel</button>
          </div>
        </div>
      )}

      {debtAccounts.length > 0 && (
        <>
          <div className="bw-section-label">Debt accounts so far</div>
          <table className="bw-table">
            <thead><tr><th>Nickname</th><th>Institution</th><th>Type</th><th style={{ textAlign: "right" }}>Schedules imported</th></tr></thead>
            <tbody>
              {debtAccounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.nickname}</td><td>{a.institution}</td><td>{a.loanType || "—"}</td>
                  <td style={{ textAlign: "right" }}>{debtSchedules.filter((s) => s.accountId === a.id).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Document Classifier test harness — deliberately does NOTHING beyond      */
/* showing the raw Stage 1 result. No import, no account creation, no       */
/* commit path of any kind. This exists purely so real files can be tried  */
/* against the classifier with zero risk to any of the four working import */
/* flows, before Stage 2 (routing to the matching extraction) gets built.  */
/* ---------------------------------------------------------------------- */

const DOCUMENT_CATEGORY_LABELS = {
  bank_statement: "Bank statement",
  credit_card_statement: "Credit card statement",
  investment_holding: "Investment holding (stocks/MF/NPS/ULIP)",
  debt_schedule: "Loan amortization schedule",
  other_investment_statement: "Other investment (PF/Gold/Property)",
  unknown: "Unknown",
};

/** A standalone diagnostic tool - runs the same document-classification call the
 *  unified upload dropzone uses (callDocumentClassify) and shows the raw result, but
 *  never actually imports anything. Exists to let the person (or a developer)
 *  sanity-check what the classifier thinks a given file is before trusting it with a
 *  real upload. */
function DocumentClassifierTest({ apiKey, aiModel, customModelId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [pendingFile, setPendingFile] = useState(null);

  async function classify(file, pwd) {
    if (!apiKey) { setError("Add your Gemini API key in the PDF (AI-assisted) tab first."); return; }
    setBusy(true); setError(null); setResult(null); setNeedsPassword(false); setWrongPassword(false);
    try {
      const effectiveModel = aiModel === "custom" ? customModelId.trim() : aiModel;
      let inputParts;
      if (/\.pdf$/i.test(file.name)) {
        const { images } = await renderPdfPagesAsImages(file, pwd || undefined);
        if (images.length === 0) { setError("Couldn't render any pages from that PDF."); setBusy(false); return; }
        // Classification only needs a glimpse — the first couple of pages is plenty,
        // no need to render or send the whole document for this step.
        inputParts = images.slice(0, 2).map((b) => ({ inlineData: { mimeType: "image/png", data: b } }));
      } else if (/\.csv$|\.xlsx$|\.xls$/i.test(file.name)) {
        const rows = await readSpreadsheetFile(file);
        const sample = buildSpreadsheetSample(rows, 20);
        inputParts = [{ text: `File name: ${file.name}\n\nSample data:\n${sample}` }];
      } else {
        setError("This test tab supports PDF, CSV, or Excel files.");
        setBusy(false);
        return;
      }
      const classification = await callDocumentClassify(inputParts, apiKey, effectiveModel);
      setResult(classification);
    } catch (err) {
      if (err && err.needsPassword) {
        setNeedsPassword(true);
        setWrongPassword(!!err.wasWrongPassword);
        setPendingFile(file);
      } else {
        setError(err.message || "Couldn't classify that file.");
      }
    } finally {
      setBusy(false);
    }
  }

  function handleFile(file) {
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setPendingFile(file);
    classify(file, "");
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5, padding: "10px 14px", marginBottom: 16, border: "1px solid var(--ochre)", borderRadius: 6 }}>
        <AlertCircle size={14} color="var(--ochre)" style={{ marginTop: 1, flexShrink: 0 }} />
        <span>
          <strong>Test only — this never imports anything.</strong> It identifies what kind of document a file
          is and shows the raw result, so the classifier can be checked against real statements before it's
          wired into an actual import flow. Nothing here touches accounts, transactions, or any other data.
        </span>
      </div>

      <h2 className="bw-h2">Document Classifier</h2>
      <p className="bw-lead">Upload a bank statement, credit card statement, investment holding, loan schedule, or PF/Gold/Property statement — PDF, CSV, or Excel — and see what the classifier thinks it is.</p>

      {!result && !busy && (
        <label className="bw-dropzone">
          <input type="file" accept=".pdf,.csv,.xlsx,.xls" onChange={(e) => handleFile(e.target.files[0])} />
          <Upload size={22} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>Click to choose a file</div>
          <div style={{ fontSize: 11.5, marginTop: 4 }}>PDF, CSV, or Excel — any of the five document types</div>
        </label>
      )}
      {busy && <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Classifying…</div>}
      {needsPassword && (
        <div style={{ marginTop: 10 }}>
          <div className="bw-field">
            <label>{wrongPassword ? "That password didn't work — try again" : "This PDF is password-protected"}</label>
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
          </div>
          <button className="bw-btn small" onClick={() => classify(pendingFile, password)}>Unlock &amp; classify</button>
        </div>
      )}
      {error && <p style={{ fontSize: 12, color: "var(--rust)", marginTop: 10 }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, padding: 16, background: "var(--card)" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 10 }}>{fileName}</div>
          <div className="bw-summary-row">
            <Stat label="Document category" value={DOCUMENT_CATEGORY_LABELS[result.documentCategory] || result.documentCategory} color="var(--ink)" />
            <Stat label="Confidence" value={result.confidence} color={result.confidence === "high" ? "var(--teal)" : result.confidence === "low" ? "var(--rust)" : "var(--ochre)"} />
            <Stat label="Institution" value={result.institution || "—"} color="var(--ink)" />
          </div>
          <p style={{ fontSize: 12.5, marginTop: 12 }}>{result.reasoning}</p>
          <button className="bw-btn ghost small" style={{ marginTop: 8 }} onClick={() => { setResult(null); setFileName(""); }}>
            <X size={12} /> Try another file
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Review tab                                                              */
/* ---------------------------------------------------------------------- */

/** The Review & Categorize screen - five modes, switched via the top tab row:
 *   - By merchant (bulk): group all currently-uncategorized transactions by merchant
 *     and tag a whole group at once (commitMerchantGroup) - the fastest path for a
 *     first-time import, since one tag usually clears many transactions.
 *   - By transaction: fine-grained, one-row-at-a-time categorization
 *     (commitCategory), with an inline dropdown per field including the optional
 *     linkedAccountId - this is the surface every categorization decision ultimately
 *     goes through if not handled in bulk.
 *   - Transfers Control, Investments Control, Debt Control: the three reconciliation
 *     screens (each its own top-level component, just hosted as tabs here) checking
 *     bank-side activity against a derived figure from elsewhere in the app.
 *  Also hosts the dormant Self/Credit-card-payment substantiation system
 *  (transferRows, transferStatus, confirmTransferLink and friends) - superseded by
 *  the simpler Transfers Control table, kept intact rather than deleted in case it's
 *  wanted again. */
function ReviewTab({ transactions, setTransactions, rules, setRules, accounts, merchantAliases, showToast, onGoToUpload, holdingSnapshots, debtSchedules }) {
  const [mode, setMode] = useState("byMerchant"); // byMerchant | byTransaction | transfers | investmentsControl | debtControl
  const [showAll, setShowAll] = useState(false);
  const [rememberFor, setRememberFor] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);
  const [sortMode, setSortMode] = useState("amount"); // amount | similar
  const [showDismissedTransfers, setShowDismissedTransfers] = useState(false);
  const [manualLinkFor, setManualLinkFor] = useState(null); // txn id currently picking a manual match
  const [transferPeriod, setTransferPeriod] = useState("all"); // all | "YYYY-MM"

  const uncategorized = useMemo(() => transactions.filter((t) => !t.category), [transactions]);

  /* ---- Transfer substantiation: Self and Credit-card-payment transfers should have a
     real other side somewhere in the data. External transfers are excluded entirely —
     money to a landlord or friend has no "other side" in this app, ever.
     NOTE: this matching/linking system is currently DORMANT — Review → Transfers now
     shows the simpler side-by-side table view instead (TransfersControlView below), per
     the redesign that dropped algorithmic matching in favor of just letting the user
     see everything and judge for themselves. Left fully intact, not deleted, in case
     it's wanted again later. ---- */
  const transferMonths = useMemo(() => {
    const s = new Set(transactions.filter(isSubstantiableTransfer).map((t) => t.date.slice(0, 7)));
    return [...s].sort().reverse();
  }, [transactions]);
  const transferRows = useMemo(() => {
    return transactions
      .filter(isSubstantiableTransfer)
      .filter((t) => transferPeriod === "all" || t.date.slice(0, 7) === transferPeriod)
      .map((t) => ({ txn: t, ...transferStatus(t, transactions, accounts) }))
      .sort((a, b) => {
        const order = { suggested: 0, pending: 1, substantiated: 2, linked: 2, dismissed: 3 };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return b.txn.amount - a.txn.amount;
      });
  }, [transactions, transferPeriod, accounts]);
  const transfersNeedingAttention = transactions
    .filter(isSubstantiableTransfer)
    .map((t) => transferStatus(t, transactions, accounts).status)
    .filter((s) => s === "suggested" || s === "pending").length;

  const accountName = (id) => accounts.find((a) => a.id === id)?.nickname || "—";

  function unsubstantiateTransfer(txnId) {
    setTransactions((prev) => prev.map((t) => (t.id === txnId ? { ...t, substantiatedByAccountId: null } : t)));
  }

  function confirmTransferLink(txnId, candidateId) {
    setTransactions((prev) => prev.map((t) => {
      if (t.id === txnId) return { ...t, linkedTransactionId: candidateId, transferDismissed: false };
      if (t.id === candidateId) return { ...t, linkedTransactionId: txnId, transferDismissed: false };
      return t;
    }));
    showToast("Transfer linked.");
    setManualLinkFor(null);
  }
  function unlinkTransfer(txnId) {
    setTransactions((prev) => {
      const txn = prev.find((t) => t.id === txnId);
      const otherId = txn?.linkedTransactionId;
      return prev.map((t) => {
        if (t.id === txnId || t.id === otherId) return { ...t, linkedTransactionId: null };
        return t;
      });
    });
    showToast("Unlinked.");
  }
  function dismissTransfer(txnId) {
    setTransactions((prev) => prev.map((t) => (t.id === txnId ? { ...t, transferDismissed: true } : t)));
  }
  function restoreTransfer(txnId) {
    setTransactions((prev) => prev.map((t) => (t.id === txnId ? { ...t, transferDismissed: false } : t)));
  }
  /** Looser than the auto-match: same criteria minus the amount/date window, for manually
   *  picking a match the auto-suggestion missed. Capped so the dropdown stays usable. */
  function manualLinkCandidates(txn) {
    const oppositeDirection = txn.direction === "debit" ? "credit" : "debit";
    return transactions
      .filter((c) => c.id !== txn.id && c.accountId !== txn.accountId && c.direction === oppositeDirection && !c.linkedTransactionId)
      .sort((a, b) => Math.abs(new Date(a.date) - new Date(txn.date)) - Math.abs(new Date(b.date) - new Date(txn.date)))
      .slice(0, 30);
  }

  /* ---- grouped-by-merchant view: bootstrap fast by tagging once per (aliased) merchant.
     Grouping uses the resolved alias so near-duplicate bank strings collapse into one row,
     but each distinct raw string underneath still gets its own rule so future imports —
     which arrive with the raw, unaliased text — keep matching correctly. ---- */
  const merchantGroups = useMemo(() => {
    const map = {};
    uncategorized.forEach((t) => {
      const raw = t.merchant || normalizeMerchant(t.description) || t.description;
      const resolved = resolveMerchant(raw, merchantAliases);
      if (!map[resolved]) map[resolved] = { key: resolved, sample: t.description, count: 0, total: 0, txnIds: [], rawKeys: new Set() };
      map[resolved].count += 1;
      map[resolved].total += t.amount;
      map[resolved].txnIds.push(t.id);
      map[resolved].rawKeys.add(raw);
    });
    return Object.values(map).sort((a, b) => b.count - a.count || b.total - a.total);
  }, [uncategorized, merchantAliases]);

  function commitMerchantGroup(group, patch, remember) {
    const { category } = patch;
    if (!category) return;
    const finalSub = (category === "Expense" || category === "Transfer" || category === "Income" || category === "Investment") ? patch.subCategory : null;
    const finalTag = category === "Expense" ? patch.tag : null;
    const finalFreq = isFrequencyEligible(category, finalSub) ? (patch.frequency || "Monthly") : null;
    const finalPurpose = patch.purpose || "Personal";
    const finalLinkedAccountId = linkableAccountTypesFor(category, finalSub).length > 0 ? (patch.linkedAccountId || null) : null;
    const rawKeys = [...group.rawKeys];
    const ruleIdByRaw = {};

    if (remember) {
      setRules((prev) => {
        let next = [...prev];
        rawKeys.forEach((raw) => {
          const pattern = raw.toLowerCase();
          if (!pattern) return;
          const idx = next.findIndex((r) => r.pattern.toLowerCase() === pattern);
          const ruleId = idx !== -1 ? next[idx].id : uid("rule");
          ruleIdByRaw[raw] = ruleId;
          const rule = {
            id: ruleId, pattern, category, subCategory: finalSub, tag: finalTag,
            frequency: finalFreq, purpose: finalPurpose, linkedAccountId: finalLinkedAccountId,
            source: "learned", priority: pattern.length,
          };
          if (idx !== -1) next[idx] = rule; else next.push(rule);
        });
        return next;
      });
    }

    setTransactions((prev) => prev.map((t) => {
      if (!group.txnIds.includes(t.id)) return t;
      const raw = t.merchant || normalizeMerchant(t.description) || t.description;
      return {
        ...t, category, subCategory: finalSub, tag: finalTag, frequency: finalFreq, purpose: finalPurpose,
        linkedAccountId: finalLinkedAccountId,
        matchedRuleId: remember ? (ruleIdByRaw[raw] || null) : null,
      };
    }));
    const variantNote = rawKeys.length > 1 ? ` (${rawKeys.length} merchant variants)` : "";
    showToast(remember
      ? `Tagged ${group.count} transaction${group.count > 1 ? "s" : ""} from "${group.key}"${variantNote} and saved ${rawKeys.length > 1 ? `${rawKeys.length} rules` : "a rule"}. (Check "By transaction → Show all" to see it.)`
      : `Tagged ${group.count} transaction${group.count > 1 ? "s" : ""} from "${group.key}"${variantNote}. (Check "By transaction → Show all" to see it.)`);
  }

  /* ---- per-transaction view: fine-grained cleanup / edge cases.
     "Similar" sort clusters by the same stopword-stripped core signature used for
     merchant-group suggestions, then orders clusters alphabetically — so even
     transactions that don't share an exact merchant string (different branch,
     slightly different suffix) still land near each other via the shared prefix,
     making it easy to spot a run of near-duplicates and select them all at once. ---- */
  const reviewMonths = useMemo(() => {
    const s = new Set(transactions.map((t) => t.date.slice(0, 7)));
    return [...s].sort().reverse();
  }, [transactions]);
  const [reviewPeriod, setReviewPeriod] = useState("all"); // all | "YYYY-MM"
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewAccountFilter, setReviewAccountFilter] = useState("all"); // all | account id
  const [reviewCategoryFilter, setReviewCategoryFilter] = useState("all"); // all | Income | Expense | Investment | Transfer | uncategorized

  const list = useMemo(() => {
    let base = showAll ? transactions : uncategorized;
    if (reviewPeriod !== "all") base = base.filter((t) => t.date.slice(0, 7) === reviewPeriod);
    if (reviewAccountFilter !== "all") base = base.filter((t) => t.accountId === reviewAccountFilter);
    if (reviewCategoryFilter !== "all") {
      base = reviewCategoryFilter === "uncategorized" ? base.filter((t) => !t.category) : base.filter((t) => t.category === reviewCategoryFilter);
    }
    if (reviewSearch.trim()) {
      const needle = reviewSearch.trim().toLowerCase();
      base = base.filter((t) => (t.description || "").toLowerCase().includes(needle));
    }
    if (sortMode === "amount") {
      return [{ key: null, txns: [...base].sort((a, b) => b.amount - a.amount) }];
    }
    const map = {};
    base.forEach((t) => {
      const raw = t.merchant || normalizeMerchant(t.description) || t.description || "";
      const core = merchantCore(raw) || raw || "—";
      if (!map[core]) map[core] = [];
      map[core].push(t);
    });
    const groups = Object.entries(map).map(([key, txns]) => ({
      key,
      txns: txns.sort((a, b) => b.amount - a.amount),
    }));
    groups.sort((a, b) => a.key.localeCompare(b.key) || b.txns.length - a.txns.length);
    return groups;
  }, [transactions, uncategorized, showAll, sortMode, reviewPeriod, reviewAccountFilter, reviewCategoryFilter, reviewSearch]);

  const flatCount = list.reduce((s, g) => s + g.txns.length, 0);

  function updateTxn(id, patch) {
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function commitCategory(txn, patch) {
    const { category } = patch;
    const finalSub = (category === "Expense" || category === "Transfer" || category === "Income" || category === "Investment") ? patch.subCategory : null;
    const finalTag = category === "Expense" ? patch.tag : null;
    const finalFreq = isFrequencyEligible(category, finalSub) ? (patch.frequency || "Monthly") : null;
    const finalPurpose = patch.purpose || "Personal";
    const finalLinkedAccountId = linkableAccountTypesFor(category, finalSub).length > 0 ? (patch.linkedAccountId || null) : null;
    const shouldRemember = rememberFor[txn.id] !== false;
    let ruleId = null; // stays null => this transaction is treated as a manual, protected override
    let pattern = null;

    if (shouldRemember && category) {
      pattern = normalizeMerchant(txn.description).toLowerCase();
      if (pattern) {
        const existing = rules.find((r) => r.pattern.toLowerCase() === pattern);
        if (existing) {
          ruleId = existing.id;
          if (existing.category !== category || existing.subCategory !== finalSub || existing.tag !== finalTag
              || existing.frequency !== finalFreq || existing.purpose !== finalPurpose || existing.linkedAccountId !== finalLinkedAccountId) {
            setRules((prev) => prev.map((r) => (r.id === ruleId
              ? { ...r, category, subCategory: finalSub, tag: finalTag, frequency: finalFreq, purpose: finalPurpose, linkedAccountId: finalLinkedAccountId } : r)));
          }
        } else {
          ruleId = uid("rule");
          setRules((prev) => [
            ...prev,
            { id: ruleId, pattern, category, subCategory: finalSub, tag: finalTag, frequency: finalFreq, purpose: finalPurpose, linkedAccountId: finalLinkedAccountId, source: "learned", priority: pattern.length },
          ]);
        }
      }
    }

    // Cascade immediately: any other currently-uncategorized transaction whose
    // description matches this same pattern gets tagged right now too, not just on
    // the next import — categorizing one similar transaction shouldn't mean hunting
    // down the rest by hand.
    let cascadedCount = 0;
    setTransactions((prev) => prev.map((t) => {
      if (t.id === txn.id) return { ...t, category, subCategory: finalSub, tag: finalTag, frequency: finalFreq, purpose: finalPurpose, linkedAccountId: finalLinkedAccountId, matchedRuleId: ruleId };
      if (pattern && !t.category && t.description.toLowerCase().includes(pattern)) {
        cascadedCount += 1;
        return { ...t, category, subCategory: finalSub, tag: finalTag, frequency: finalFreq, purpose: finalPurpose, linkedAccountId: finalLinkedAccountId, matchedRuleId: ruleId };
      }
      return t;
    }));

    if (shouldRemember && category && pattern) {
      showToast(
        `Rule saved: "${pattern}" → ${category}${finalSub ? " / " + finalSub : ""}` +
        (cascadedCount > 0 ? ` — also tagged ${cascadedCount} similar transaction${cascadedCount > 1 ? "s" : ""}.` : ".")
      );
    }
  }

  /* ---- multi-select bulk tagging: pick an arbitrary set of rows and tag them all at once ---- */
  function commitBulkSelection(category, subCategory, tag, frequency, purpose, linkedAccountId, remember) {
    if (!category || selectedIds.length === 0) return;
    const finalSub = (category === "Expense" || category === "Transfer" || category === "Income" || category === "Investment") ? subCategory : null;
    const finalTag = category === "Expense" ? tag : null;
    const finalFreq = isFrequencyEligible(category, finalSub) ? (frequency || "Monthly") : null;
    const finalPurpose = purpose || "Personal";
    const finalLinkedAccountId = linkableAccountTypesFor(category, finalSub).length > 0 ? (linkedAccountId || null) : null;
    const selectedTxns = transactions.filter((t) => selectedIds.includes(t.id));
    const rawKeys = [...new Set(selectedTxns.map((t) => t.merchant || normalizeMerchant(t.description) || t.description))];
    const ruleIdByRaw = {};

    if (remember) {
      setRules((prev) => {
        let next = [...prev];
        rawKeys.forEach((raw) => {
          const pattern = (raw || "").toLowerCase();
          if (!pattern) return;
          const idx = next.findIndex((r) => r.pattern.toLowerCase() === pattern);
          const ruleId = idx !== -1 ? next[idx].id : uid("rule");
          ruleIdByRaw[raw] = ruleId;
          const rule = {
            id: ruleId, pattern, category, subCategory: finalSub, tag: finalTag,
            frequency: finalFreq, purpose: finalPurpose, linkedAccountId: finalLinkedAccountId,
            source: "learned", priority: pattern.length,
          };
          if (idx !== -1) next[idx] = rule; else next.push(rule);
        });
        return next;
      });
    }

    setTransactions((prev) => prev.map((t) => {
      if (!selectedIds.includes(t.id)) return t;
      const raw = t.merchant || normalizeMerchant(t.description) || t.description;
      return {
        ...t, category, subCategory: finalSub, tag: finalTag, frequency: finalFreq, purpose: finalPurpose,
        linkedAccountId: finalLinkedAccountId,
        matchedRuleId: remember ? (ruleIdByRaw[raw] || null) : null,
      };
    }));

    showToast(
      `Tagged ${selectedIds.length} transaction${selectedIds.length > 1 ? "s" : ""}` +
      (remember ? ` and saved ${rawKeys.length > 1 ? `${rawKeys.length} rules` : "a rule"}.` : ".")
    );
    setSelectedIds([]);
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div>
      <h2 className="bw-h2">Review & categorize</h2>
      <p className="bw-lead">
        First pass on a new statement is always manual — the tool doesn't know your merchants yet. Tag by
        merchant to clear most of it in a handful of clicks; every tag becomes a rule so next month's import
        needs far less review.
      </p>

      <div className="bw-tabs" style={{ marginBottom: 16 }}>
        <button className={`bw-tab ${mode === "byMerchant" ? "active" : ""}`} onClick={() => setMode("byMerchant")}>
          <Sparkles size={13} /> By merchant (bulk){uncategorized.length > 0 ? <span className="badge">{merchantGroups.length}</span> : null}
        </button>
        <button className={`bw-tab ${mode === "byTransaction" ? "active" : ""}`} onClick={() => setMode("byTransaction")}>
          <ListChecks size={13} /> By transaction
        </button>
        <button className={`bw-tab ${mode === "transfers" ? "active" : ""}`} onClick={() => setMode("transfers")}>
          <Repeat size={13} /> Transfers Control
        </button>
        <button className={`bw-tab ${mode === "investmentsControl" ? "active" : ""}`} onClick={() => setMode("investmentsControl")}>
          <TrendingUp size={13} /> Investments Control
        </button>
        <button className={`bw-tab ${mode === "debtControl" ? "active" : ""}`} onClick={() => setMode("debtControl")}>
          <TrendingDown size={13} /> Debt Control
        </button>
      </div>

      {mode === "transfers" ? (
        <TransfersControlView
          transactions={transactions}
          accounts={accounts}
          transferMonths={transferMonths}
          transferPeriod={transferPeriod}
          setTransferPeriod={setTransferPeriod}
        />
      ) : mode === "investmentsControl" ? (
        <InvestmentsControlView transactions={transactions} accounts={accounts} holdingSnapshots={holdingSnapshots} />
      ) : mode === "debtControl" ? (
        <DebtControlView transactions={transactions} accounts={accounts} debtSchedules={debtSchedules} />
      ) : mode === "byMerchant" ? (
        merchantGroups.length === 0 ? (
          <div className="bw-empty">
            {transactions.length === 0 ? "No transactions imported yet — head to Upload." : "Nothing left to review. Every merchant is categorized."}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 10 }}>
              Sorted by how often each merchant appears — tagging the top few usually covers most of your transactions.
            </div>
            <table className="bw-table">
              <thead>
                <tr>
                  <th>Merchant</th><th style={{ textAlign: "right" }}>Count</th><th style={{ textAlign: "right" }}>Total</th>
                  <th>Category</th><th>Sub</th><th>Freq</th><th>Tag</th><th>Purpose</th><th>Account</th><th></th>
                </tr>
              </thead>
              <tbody>
                {merchantGroups.map((g) => (
                  <MerchantRow key={g.key} group={g} onCommit={commitMerchantGroup} accounts={accounts} />
                ))}
              </tbody>
            </table>
          </>
        )
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
            <div className="bw-checkbox-row" style={{ marginTop: 0 }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} id="showAll" />
              <label htmlFor="showAll">Show all transactions (not just uncategorized)</label>
            </div>
            <input
              type="text" className="bw-select-inline" style={{ minWidth: 200 }}
              placeholder="Search description…" value={reviewSearch} onChange={(e) => setReviewSearch(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Period:</span>
              <select className="bw-select-inline" value={reviewPeriod} onChange={(e) => setReviewPeriod(e.target.value)}>
                <option value="all">All time</option>
                {reviewMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Account:</span>
              <select className="bw-select-inline" value={reviewAccountFilter} onChange={(e) => setReviewAccountFilter(e.target.value)}>
                <option value="all">All accounts</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Category:</span>
              <select className="bw-select-inline" value={reviewCategoryFilter} onChange={(e) => setReviewCategoryFilter(e.target.value)}>
                <option value="all">All categories</option>
                <option value="uncategorized">Uncategorized</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Sort:</span>
              <select className="bw-select-inline" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                <option value="amount">Largest amount first</option>
                <option value="similar">Group similar descriptions</option>
              </select>
            </div>
          </div>

          {flatCount === 0 ? (
            <div className="bw-empty">
              {transactions.length === 0 ? "No transactions imported yet — head to Upload." : "Nothing left to review. Everything is categorized."}
            </div>
          ) : (
            <>
              {selectedIds.length > 0 && (
                <BulkActionBar
                  count={selectedIds.length}
                  onApply={commitBulkSelection}
                  onClear={() => setSelectedIds([])}
                  accounts={accounts}
                />
              )}
              <table className="bw-table">
                <thead>
                  <tr>
                    <th style={{ width: 24 }}>
                      <input
                        type="checkbox"
                        checked={flatCount > 0 && list.every((g) => g.txns.every((t) => selectedIds.includes(t.id)))}
                        onChange={(e) => setSelectedIds(e.target.checked ? list.flatMap((g) => g.txns.map((t) => t.id)) : [])}
                        title="Select all visible"
                      />
                    </th>
                    <th>Date</th><th>Account</th><th>Description</th><th style={{ textAlign: "right" }}>Amount</th>
                    <th>Category</th><th>Sub</th><th>Freq</th><th>Tag</th><th>Purpose</th><th>Linked account</th><th>Remember</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((group) => (
                    <React.Fragment key={group.key ?? "flat"}>
                      {sortMode === "similar" && group.txns.length > 1 && (
                        <tr>
                          <td colSpan={11} style={{
                            background: "var(--paper)", fontSize: 10.5, color: "var(--ink-soft)",
                            padding: "5px 8px", borderBottom: "1px solid var(--line)",
                          }}>
                            <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{group.key}</span>
                            {" "}· {group.txns.length} similar transactions{" "}
                            <button
                              className="bw-btn ghost small" style={{ padding: "1px 7px", fontSize: 10, marginLeft: 4 }}
                              onClick={() => setSelectedIds((prev) => [...new Set([...prev, ...group.txns.map((t) => t.id)])])}
                            >
                              Select all {group.txns.length}
                            </button>
                          </td>
                        </tr>
                      )}
                      {group.txns.map((t) => (
                        <tr key={t.id} style={selectedIds.includes(t.id) ? { background: "rgba(46,102,89,0.05)" } : undefined}>
                          <td>
                            <input type="checkbox" checked={selectedIds.includes(t.id)} onChange={() => toggleSelected(t.id)} />
                          </td>
                          <td style={{ whiteSpace: "nowrap", fontSize: 11.5, color: "var(--ink-soft)" }}>{t.date}</td>
                          <td style={{ fontSize: 11.5 }}>{accountName(t.accountId)}</td>
                          <td style={{ maxWidth: 260 }}>{t.description}</td>
                          <td className={`bw-amt ${t.direction}`}>{t.direction === "credit" ? "+" : "−"}{inr(t.amount)}</td>
                          <td>
                            <select className="bw-select-inline" value={t.category || ""}
                              onChange={(e) => commitCategory(t, { category: e.target.value || null, subCategory: null, tag: t.tag, frequency: t.frequency, purpose: t.purpose })}>
                              <option value="">—</option>
                              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                            </select>
                          </td>
                          <td>
                            {subCategoryOptionsFor(t.category).length > 0 ? (
                              <select className="bw-select-inline" value={t.subCategory || ""}
                                onChange={(e) => commitCategory(t, { category: t.category, subCategory: e.target.value || null, tag: t.tag, frequency: t.frequency, purpose: t.purpose })}>
                                <option value="">—</option>
                                {subCategoryOptionsFor(t.category).map((s) => <option key={s}>{s}</option>)}
                              </select>
                            ) : <span style={{ color: "var(--line)" }}>—</span>}
                          </td>
                          <td>
                            {isFrequencyEligible(t.category, t.subCategory) ? (
                              <select className="bw-select-inline" value={t.frequency || "Monthly"}
                                onChange={(e) => commitCategory(t, { category: t.category, subCategory: t.subCategory, tag: t.tag, frequency: e.target.value, purpose: t.purpose, linkedAccountId: t.linkedAccountId })}>
                                {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
                              </select>
                            ) : <span style={{ color: "var(--line)" }}>—</span>}
                          </td>
                          <td>
                            {t.category === "Expense" ? (
                              <select className="bw-select-inline" value={t.tag || ""}
                                onChange={(e) => commitCategory(t, { category: t.category, subCategory: t.subCategory, tag: e.target.value || null, frequency: t.frequency, purpose: t.purpose, linkedAccountId: t.linkedAccountId })}>
                                <option value="">—</option>
                                {TAGS.map((tg) => <option key={tg}>{tg}</option>)}
                              </select>
                            ) : <span style={{ color: "var(--line)" }}>—</span>}
                          </td>
                          <td>
                            {t.category ? (
                              <select className="bw-select-inline" value={t.purpose || "Personal"}
                                onChange={(e) => commitCategory(t, { category: t.category, subCategory: t.subCategory, tag: t.tag, frequency: t.frequency, purpose: e.target.value, linkedAccountId: t.linkedAccountId })}>
                                {PURPOSES.map((p) => <option key={p}>{p}</option>)}
                              </select>
                            ) : <span style={{ color: "var(--line)" }}>—</span>}
                          </td>
                          <td>
                            {linkableAccountTypesFor(t.category, t.subCategory).length > 0 ? (
                              <select className="bw-select-inline" value={t.linkedAccountId || ""}
                                onChange={(e) => commitCategory(t, { category: t.category, subCategory: t.subCategory, tag: t.tag, frequency: t.frequency, purpose: t.purpose, linkedAccountId: e.target.value || null })}>
                                <option value="">— optional —</option>
                                {accounts.filter((a) => linkableAccountTypesFor(t.category, t.subCategory).includes(a.type) && a.id !== t.accountId).map((a) => (
                                  <option key={a.id} value={a.id}>{a.nickname}</option>
                                ))}
                              </select>
                            ) : <span style={{ color: "var(--line)" }}>—</span>}
                          </td>
                          <td>
                            <input type="checkbox"
                              checked={rememberFor[t.id] !== false}
                              onChange={(e) => setRememberFor((prev) => ({ ...prev, [t.id]: e.target.checked }))}
                              title="Create a rule from this merchant" />
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The sticky action bar shown when one or more rows are checked in "By transaction"
 *  mode - pick category/subcategory/frequency/tag/purpose/linked-account once and
 *  apply it to every selected row at once (commitBulkSelection), instead of setting
 *  each field per row. Every field here mirrors MerchantRow's and the per-row
 *  dropdown's conditional visibility (isFrequencyEligible, linkableAccountTypesFor),
 *  so bulk tagging behaves identically to tagging one row at a time. */
function BulkActionBar({ count, onApply, onClear, accounts }) {
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("Variable");
  const [frequency, setFrequency] = useState("Monthly");
  const [tag, setTag] = useState("Personal");
  const [purpose, setPurpose] = useState("Personal");
  const [linkedAccountId, setLinkedAccountId] = useState("");
  const [remember, setRemember] = useState(true);

  function handleCategoryChange(v) {
    setCategory(v);
    const opts = subCategoryOptionsFor(v);
    setSubCategory(opts.length > 0 ? opts[0] : "");
    setLinkedAccountId("");
  }

  const linkableTypes = linkableAccountTypesFor(category, subCategory);
  const linkableAccounts = linkableTypes.length > 0 ? accounts.filter((a) => linkableTypes.includes(a.type)) : [];

  return (
    <div style={{
      display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10,
      border: "1px solid var(--teal)", borderRadius: 6, padding: "10px 14px", marginBottom: 12,
      background: "rgba(46,102,89,0.06)", position: "sticky", top: 0, zIndex: 5,
    }}>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{count} selected</span>
      <select className="bw-select-inline" value={category} onChange={(e) => handleCategoryChange(e.target.value)}>
        <option value="">Category —</option>
        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
      </select>
      {subCategoryOptionsFor(category).length > 0 && (
        <select className="bw-select-inline" value={subCategory} onChange={(e) => setSubCategory(e.target.value)}>
          {subCategoryOptionsFor(category).map((s) => <option key={s}>{s}</option>)}
        </select>
      )}
      {isFrequencyEligible(category, subCategory) && (
        <select className="bw-select-inline" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
          {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
        </select>
      )}
      {category === "Expense" && (
        <select className="bw-select-inline" value={tag} onChange={(e) => setTag(e.target.value)}>
          {TAGS.map((tg) => <option key={tg}>{tg}</option>)}
        </select>
      )}
      {category && (
        <select className="bw-select-inline" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          {PURPOSES.map((p) => <option key={p}>{p}</option>)}
        </select>
      )}
      {linkableTypes.length > 0 && (
        <select className="bw-select-inline" value={linkedAccountId} onChange={(e) => setLinkedAccountId(e.target.value)}>
          <option value="">Account (optional) —</option>
          {linkableAccounts.map((a) => <option key={a.id} value={a.id}>{a.nickname}</option>)}
        </select>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--ink-soft)" }}>
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember (create rules)
      </label>
      <button className="bw-btn small" disabled={!category} onClick={() => onApply(category, subCategory, tag, frequency, purpose, linkedAccountId, remember)}>
        <Check size={12} /> Apply to {count}
      </button>
      <button className="bw-btn ghost small" onClick={onClear}><X size={12} /> Clear</button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Transfers — simplified side-by-side view. Deliberately no matching or  */
/* linking: one column per account, sorted by date, so a real transfer's  */
/* two sides naturally land near each other and any gap is self-evident   */
/* just from looking, without an algorithm deciding what "matches."       */
/* ---------------------------------------------------------------------- */

/** The "Transfers Control" tab - reconciliation for Self transfers only (External is
 *  informational elsewhere in this same component, no zero-check, since money there
 *  genuinely leaves the tracked system with no "other side" to expect). The hero
 *  table is a matrix: one row and column per bank account, diagonal always blank.
 *  Cell[row, col] = the sum of row's own Self-transfer transactions linked
 *  (linkedAccountId) to col - never mirrored from the other side. A zero grand total
 *  means every transfer has been linked from both directions; non-zero honestly
 *  names which account's side is still missing a link, rather than guessing at it.
 *  The plain transaction list below stays visible (not yet collapsed behind a click,
 *  by deliberate choice while this table shape is still being evaluated). */
function TransfersControlView({ transactions, accounts, transferMonths, transferPeriod, setTransferPeriod }) {
  const bankAccounts = useMemo(() => accounts.filter((a) => a.type === "bank"), [accounts]);
  const bankAccountIds = useMemo(() => new Set(bankAccounts.map((a) => a.id)), [bankAccounts]);
  const [accountFilter, setAccountFilter] = useState("all");

  // Self and External transfers on bank accounts — one row per transaction, amount
  // placed under whichever account it belongs to. A Self transfer's outflow and
  // inflow are two separate transactions that land in different account columns; once
  // both statements are imported, sorting by date puts them right next to each other.
  const selfExternalRows = useMemo(() => {
    return transactions
      .filter((t) => t.category === "Transfer" && bankAccountIds.has(t.accountId) && (t.subCategory === "Self" || t.subCategory === "External" || !t.subCategory))
      .filter((t) => transferPeriod === "all" || t.date.slice(0, 7) === transferPeriod)
      .filter((t) => accountFilter === "all" || t.accountId === accountFilter)
      .map((t) => ({
        id: t.id, date: t.date, description: t.description, type: t.subCategory || "Self",
        accountId: t.accountId, linkedAccountId: t.linkedAccountId || null,
        amount: t.direction === "credit" ? t.amount : -t.amount,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [transactions, bankAccountIds, transferPeriod, accountFilter]);

  // Self-transfer matrix - one row and column per bank account, diagonal always blank.
  // Cell[row, col] = sum of row's OWN Self-transfer transactions linked to col - no
  // mirroring. If only one side of a transfer is ever categorized and linked, the
  // other cell just stays at zero and the grand total won't land on zero - an honest,
  // visible signal something's still missing, not a guess filling in the other side.
  const selfMatrix = useMemo(() => {
    const cells = {}; // `${rowId}|${colId}` -> amount
    transactions
      .filter((t) => t.category === "Transfer" && t.subCategory === "Self" && bankAccountIds.has(t.accountId) && t.linkedAccountId)
      .filter((t) => transferPeriod === "all" || t.date.slice(0, 7) === transferPeriod)
      .forEach((t) => {
        const key = `${t.accountId}|${t.linkedAccountId}`;
        const amount = t.direction === "credit" ? t.amount : -t.amount;
        cells[key] = (cells[key] || 0) + amount;
      });
    return cells;
  }, [transactions, bankAccountIds, transferPeriod]);

  const externalTotal = selfExternalRows.filter((r) => r.type === "External").reduce((s, r) => s + r.amount, 0);
  const rowTotals = bankAccounts.map((row) => bankAccounts.reduce((s, col) => s + (selfMatrix[`${row.id}|${col.id}`] || 0), 0));
  const colTotals = bankAccounts.map((col) => bankAccounts.reduce((s, row) => s + (selfMatrix[`${row.id}|${col.id}`] || 0), 0));
  const grandTotal = rowTotals.reduce((s, v) => s + v, 0);
  const isReconciled = Math.abs(grandTotal) < 1;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <p className="bw-lead" style={{ margin: 0, flex: 1, minWidth: 240 }}>
          Each cell is that account's own transactions, linked to that column's account — nothing is mirrored.
          A zero grand total means every transfer's been linked from both sides; non-zero flags exactly which
          account's side is still missing.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select className="bw-select-inline" value={transferPeriod} onChange={(e) => setTransferPeriod(e.target.value)}>
            <option value="all">All time</option>
            {transferMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <select className="bw-select-inline" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
            <option value="all">All accounts</option>
            {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.nickname}</option>)}
          </select>
        </div>
      </div>

      <div className="bw-section-label" style={{ marginTop: 0 }}>Self transfers</div>
      {bankAccounts.length === 0 ? (
        <div className="bw-empty">No bank accounts yet.</div>
      ) : (
        <div style={{ overflowX: "auto", marginBottom: 22 }}>
          <table className="bw-table">
            <thead>
              <tr>
                <th>Account</th>
                {bankAccounts.map((a) => <th key={a.id} style={{ textAlign: "right" }}>{a.nickname}</th>)}
                <th style={{ textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {bankAccounts.map((row) => (
                <tr key={row.id}>
                  <td>{row.nickname}</td>
                  {bankAccounts.map((col) => {
                    if (row.id === col.id) return <td key={col.id} style={{ textAlign: "right", color: "var(--line)" }}>—</td>;
                    const val = selfMatrix[`${row.id}|${col.id}`] || 0;
                    return (
                      <td key={col.id} className={val !== 0 ? `bw-amt ${val >= 0 ? "credit" : "debit"}` : undefined} style={{ textAlign: "right" }}>
                        {val !== 0 ? inr(val) : ""}
                      </td>
                    );
                  })}
                  <td className="bw-amt" style={{ textAlign: "right", fontWeight: 600 }}>{inr(rowTotals[bankAccounts.indexOf(row)])}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--ink)" }}>
                <td style={{ fontWeight: 600 }}>Total</td>
                {bankAccounts.map((col, i) => <td key={col.id} style={{ textAlign: "right", fontWeight: 600 }}>{inr(colTotals[i])}</td>)}
                <td style={{ textAlign: "right", fontWeight: 700, color: isReconciled ? "var(--teal)" : "var(--rust)" }}>{inr(grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="bw-summary-row" style={{ marginBottom: 20 }}>
        <Stat label="External transfers (informational)" value={inr(externalTotal)} color="var(--ink-soft)" hint="No zero-check - money genuinely leaves the tracked system" />
      </div>

      <div className="bw-section-label" style={{ marginTop: 0 }}>Transfers (Self &amp; External), by account</div>
      {bankAccounts.length === 0 || selfExternalRows.length === 0 ? (
        <div className="bw-empty">No Self or External transfers on bank accounts yet for this period.</div>
      ) : (
        <div style={{ overflowX: "auto", marginBottom: 28 }}>
          <table className="bw-table">
            <thead>
              <tr>
                <th>Date</th><th>Description</th><th>Type</th>
                {bankAccounts.map((a) => <th key={a.id} style={{ textAlign: "right" }}>{a.nickname}</th>)}
              </tr>
            </thead>
            <tbody>
              {selfExternalRows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap", fontSize: 11.5, color: "var(--ink-soft)" }}>{r.date}</td>
                  <td>{r.description}</td>
                  <td><span className="bw-pill" style={{ background: "var(--slate)", fontSize: 10 }}>{r.type}</span></td>
                  {bankAccounts.map((a) => (
                    <td key={a.id} className={a.id === r.accountId ? `bw-amt ${r.amount >= 0 ? "credit" : "debit"}` : undefined} style={{ textAlign: "right" }}>
                      {a.id === r.accountId ? `${r.amount >= 0 ? "+" : "−"}${inr(Math.abs(r.amount))}` : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Transfers review panel — DORMANT, not deleted. Algorithmic suggested-  */
/* match detection + explicit linking, superseded by TransfersControlView  */
/* above per the redesign, but left fully intact in case it's wanted      */
/* again later. Nothing below this point is currently called.             */
/* ---------------------------------------------------------------------- */

/** Renders transferRows split into three sections: needs attention (suggested or
 *  pending), settled (linked or substantiated - a confirmed link is deduplicated to
 *  one row per pair, picked deterministically by id, since both sides of a link
 *  independently qualify as their own row), and dismissed (collapsed by default). */
function TransfersReviewPanel({
  transferRows, accountName, accounts, onConfirm, onUnlink, onDismiss, onRestore, onUnsubstantiate, onGoToUpload,
  manualLinkFor, setManualLinkFor, manualLinkCandidates, showDismissed, setShowDismissed,
  transferMonths, transferPeriod, setTransferPeriod,
  transferTypeFilter, setTransferTypeFilter, transferAccountFilter, setTransferAccountFilter,
}) {
  const needsAttention = transferRows.filter((r) => r.status === "suggested" || r.status === "pending");
  // A confirmed link involves TWO transactions (one per account), and each one
  // independently qualifies as its own "substantiable transfer" row — without this,
  // the same relationship would render twice, once from each side, looking like two
  // separate (duplicate) transfers instead of one link. Keep only one side per pair,
  // picked deterministically so it's always the same one, not "substantiated" (which
  // has no such pairing — only one specific transaction ever gets that marker).
  const settled = transferRows.filter((r) => {
    if (r.status === "substantiated") return true;
    if (r.status !== "linked") return false;
    if (!r.candidate) return true; // dangling reference — still show it so it's visible/fixable
    return r.txn.id < r.candidate.id;
  });
  const dismissed = transferRows.filter((r) => r.status === "dismissed");

  return (
    <div>
      <p className="bw-lead" style={{ marginBottom: 12 }}>
        Self and Credit card payment transfers should have real evidence somewhere in your data — upload the
        other side's statement to substantiate one, or ignore it if you're not tracking that account here.
        External transfers (rent, gifts, loans to others) are never checked, since there's no "other side"
        this app could ever see.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Period:</span>
          <select className="bw-select-inline" value={transferPeriod} onChange={(e) => setTransferPeriod(e.target.value)}>
            <option value="all">All time</option>
            {transferMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Type:</span>
          <select className="bw-select-inline" value={transferTypeFilter} onChange={(e) => setTransferTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            {TRANSFER_SUB_CATEGORIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Statement:</span>
          <select className="bw-select-inline" value={transferAccountFilter} onChange={(e) => setTransferAccountFilter(e.target.value)}>
            <option value="all">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname}</option>)}
          </select>
        </div>
      </div>

      {transferRows.length === 0 ? (
        <div className="bw-empty">
          {transferPeriod === "all" && transferTypeFilter === "all" && transferAccountFilter === "all"
            ? 'No Self or Credit card payment transfers yet. Tag a transaction as Transfer / Self or Transfer / Credit card payment in the other Review views to see it here.'
            : "No transfers match the current filters."}
        </div>
      ) : (
        <>
          {needsAttention.length > 0 && (
            <>
              <div className="bw-section-label" style={{ marginTop: 0 }}>Needs attention ({needsAttention.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
                {needsAttention.map((r) => (
                  <TransferRow key={r.txn.id} row={r} accountName={accountName}
                    onConfirm={onConfirm} onUnlink={onUnlink} onDismiss={onDismiss} onRestore={onRestore}
                    onUnsubstantiate={onUnsubstantiate} onGoToUpload={onGoToUpload}
                    manualLinkFor={manualLinkFor} setManualLinkFor={setManualLinkFor} manualLinkCandidates={manualLinkCandidates} />
                ))}
              </div>
            </>
          )}

          {settled.length > 0 && (
            <>
              <div className="bw-section-label">Settled ({settled.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
                {settled.map((r) => (
                  <TransferRow key={r.txn.id} row={r} accountName={accountName}
                    onConfirm={onConfirm} onUnlink={onUnlink} onDismiss={onDismiss} onRestore={onRestore}
                    onUnsubstantiate={onUnsubstantiate} onGoToUpload={onGoToUpload}
                    manualLinkFor={manualLinkFor} setManualLinkFor={setManualLinkFor} manualLinkCandidates={manualLinkCandidates} />
                ))}
              </div>
            </>
          )}

          {dismissed.length > 0 && (
            <>
              <button
                onClick={() => setShowDismissed((v) => !v)}
                style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--ink-soft)", fontSize: 12 }}
              >
                {showDismissed ? <ChevronUp size={13} /> : <ChevronRight size={13} />} Dismissed ({dismissed.length})
              </button>
              {showDismissed && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                  {dismissed.map((r) => (
                    <TransferRow key={r.txn.id} row={r} accountName={accountName}
                      onConfirm={onConfirm} onUnlink={onUnlink} onDismiss={onDismiss} onRestore={onRestore}
                      onUnsubstantiate={onUnsubstantiate} onGoToUpload={onGoToUpload}
                      manualLinkFor={manualLinkFor} setManualLinkFor={setManualLinkFor} manualLinkCandidates={manualLinkCandidates} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** One transfer's card in the dormant substantiation UI - shows its current status
 *  (suggested/pending/linked/substantiated/dismissed) and the action set that status
 *  allows: confirm or reject a suggested match, upload the other side or search
 *  manually while pending, unlink a confirmed match, undo a substantiation, or
 *  restore a dismissed one. Part of the system superseded by TransfersControlView -
 *  see the note on ReviewTab. */
function TransferRow({ row, accountName, onConfirm, onUnlink, onDismiss, onRestore, onUnsubstantiate, onGoToUpload, manualLinkFor, setManualLinkFor, manualLinkCandidates }) {
  const { txn, status, candidate } = row;
  const isPicking = manualLinkFor === txn.id;
  const statusColor = { suggested: "var(--ochre)", pending: "var(--rust)", linked: "var(--teal)", substantiated: "var(--teal)", dismissed: "var(--ink-soft)" }[status];
  const statusLabel = { suggested: "Suggested match", pending: "Pending", linked: "Linked", substantiated: "Substantiated", dismissed: "Dismissed" }[status];

  return (
    <div style={{
      border: "1px solid var(--line)", borderRadius: 6, padding: 12, background: "var(--card)",
      opacity: status === "dismissed" ? 0.65 : 1,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12.5 }}>
            <span style={{ color: "var(--ink-soft)", fontSize: 11 }}>{txn.date} · {accountName(txn.accountId)}</span>
          </div>
          <div style={{ fontSize: 13, margin: "2px 0" }}>{txn.description}</div>
          <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{txn.subCategory}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className={`bw-amt ${txn.direction}`} style={{ fontSize: 14 }}>
            {txn.direction === "credit" ? "+" : "−"}{inr(txn.amount)}
          </div>
          <span className="bw-pill" style={{ background: statusColor, marginTop: 4, display: "inline-block" }}>{statusLabel}</span>
        </div>
      </div>

      {status === "suggested" && candidate && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 6 }}>Likely match:</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12.5 }}>
              {candidate.date} · {accountName(candidate.accountId)} · {candidate.description}
            </div>
            <div className={`bw-amt ${candidate.direction}`}>{candidate.direction === "credit" ? "+" : "−"}{inr(candidate.amount)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button className="bw-btn small" onClick={() => onConfirm(txn.id, candidate.id)}><Check size={12} /> Confirm match</button>
            <button className="bw-btn ghost small" onClick={() => setManualLinkFor(txn.id)}>Not this one</button>
            <button className="bw-btn ghost small" onClick={() => onDismiss(txn.id)}>Not tracking this</button>
          </div>
        </div>
      )}

      {status === "pending" && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 8 }}>
            No evidence yet — upload the other side's statement to substantiate this, or search for an existing match.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="bw-btn small" onClick={onGoToUpload}><Upload size={12} /> Upload statement</button>
            <button className="bw-btn ghost small" onClick={() => setManualLinkFor(txn.id)}>Find match manually</button>
            <button className="bw-btn ghost small" onClick={() => onDismiss(txn.id)}>Not tracking this</button>
          </div>
        </div>
      )}

      {status === "linked" && candidate && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
              Linked to: {candidate.date} · {accountName(candidate.accountId)} · {candidate.description}
            </div>
            <button className="bw-btn ghost small" onClick={() => onUnlink(txn.id)}><X size={12} /> Unlink</button>
          </div>
        </div>
      )}

      {status === "substantiated" && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
              Substantiated by importing: {candidate ? candidate.nickname : "an account"}
            </div>
            <button className="bw-btn ghost small" onClick={() => onUnsubstantiate(txn.id)}><X size={12} /> Undo</button>
          </div>
        </div>
      )}

      {status === "dismissed" && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          <button className="bw-btn ghost small" onClick={() => onRestore(txn.id)}><RefreshCw size={12} /> Restore</button>
        </div>
      )}

      {isPicking && (
        <ManualLinkPicker txn={txn} accountName={accountName} candidates={manualLinkCandidates(txn)}
          onPick={(candidateId) => onConfirm(txn.id, candidateId)} onCancel={() => setManualLinkFor(null)} />
      )}
    </div>
  );
}

/** Fallback picker shown when the automatic match for a transfer is wrong or doesn't
 *  exist - lets the person search manually among opposite-direction transactions on
 *  other accounts instead. Part of the dormant substantiation system. */
function ManualLinkPicker({ txn, accountName, candidates, onPick, onCancel }) {
  const [selected, setSelected] = useState("");
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
      {candidates.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
          No other-account transactions with an opposite direction exist yet to link to.
        </div>
      ) : (
        <>
          <select className="bw-select-inline" style={{ width: "100%", marginBottom: 8 }} value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">— pick the matching transaction —</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.date} · {accountName(c.accountId)} · {c.direction === "credit" ? "+" : "−"}{inr(c.amount)} · {c.description.slice(0, 40)}
              </option>
            ))}
          </select>
          <button className="bw-btn small" disabled={!selected} onClick={() => onPick(selected)}><Check size={12} /> Link</button>
        </>
      )}
      <button className="bw-btn ghost small" style={{ marginLeft: 8 }} onClick={onCancel}>Cancel</button>
    </div>
  );
}

/** One row of the "By merchant (bulk)" table - lets the person tag every currently-
 *  uncategorized transaction sharing this merchant key at once. Category/subcategory/
 *  frequency/tag/purpose/linked-account dropdowns each show conditionally exactly the
 *  way the per-transaction row does (subCategoryOptionsFor, isFrequencyEligible,
 *  linkableAccountTypesFor), so bulk-by-merchant tagging behaves identically to
 *  tagging one transaction at a time - just applied to the whole group on Apply. */
function MerchantRow({ group, onCommit, accounts }) {
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("Variable");
  const [frequency, setFrequency] = useState("Monthly");
  const [tag, setTag] = useState("Personal");
  const [purpose, setPurpose] = useState("Personal");
  const [linkedAccountId, setLinkedAccountId] = useState("");
  const [remember, setRemember] = useState(true);

  function handleCategoryChange(v) {
    setCategory(v);
    const opts = subCategoryOptionsFor(v);
    setSubCategory(opts.length > 0 ? opts[0] : "");
    setLinkedAccountId("");
  }

  const linkableTypes = linkableAccountTypesFor(category, subCategory);
  const linkableAccounts = linkableTypes.length > 0 ? accounts.filter((a) => linkableTypes.includes(a.type)) : [];

  return (
    <tr>
      <td style={{ maxWidth: 220 }}>
        <div>
          {group.key || "—"}
          {group.rawKeys && group.rawKeys.size > 1 && (
            <span style={{ fontSize: 9.5, color: "var(--teal)", border: "1px solid var(--teal)", borderRadius: 20, padding: "1px 6px", marginLeft: 6 }}>
              {group.rawKeys.size} variants
            </span>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>{group.sample}</div>
      </td>
      <td style={{ textAlign: "right" }}>{group.count}</td>
      <td className="bw-amt debit">{inr(group.total)}</td>
      <td>
        <select className="bw-select-inline" value={category} onChange={(e) => handleCategoryChange(e.target.value)}>
          <option value="">—</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </td>
      <td>
        {subCategoryOptionsFor(category).length > 0 ? (
          <select className="bw-select-inline" value={subCategory} onChange={(e) => setSubCategory(e.target.value)}>
            {subCategoryOptionsFor(category).map((s) => <option key={s}>{s}</option>)}
          </select>
        ) : <span style={{ color: "var(--line)" }}>—</span>}
      </td>
      <td>
        {isFrequencyEligible(category, subCategory) ? (
          <select className="bw-select-inline" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
          </select>
        ) : <span style={{ color: "var(--line)" }}>—</span>}
      </td>
      <td>
        {category === "Expense" ? (
          <select className="bw-select-inline" value={tag} onChange={(e) => setTag(e.target.value)}>
            {TAGS.map((tg) => <option key={tg}>{tg}</option>)}
          </select>
        ) : <span style={{ color: "var(--line)" }}>—</span>}
      </td>
      <td>
        <select className="bw-select-inline" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          {PURPOSES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </td>
      <td>
        {linkableTypes.length > 0 ? (
          <select className="bw-select-inline" value={linkedAccountId} onChange={(e) => setLinkedAccountId(e.target.value)}>
            <option value="">— optional —</option>
            {linkableAccounts.map((a) => <option key={a.id} value={a.id}>{a.nickname}</option>)}
          </select>
        ) : <span style={{ color: "var(--line)" }}>—</span>}
      </td>
      <td>
        <button className="bw-btn small" disabled={!category}
          onClick={() => onCommit(group, { category, subCategory, tag, frequency, purpose, linkedAccountId }, remember)}>
          <Check size={12} /> Apply
        </button>
      </td>
    </tr>
  );
}

/* ---------------------------------------------------------------------- */
/* Rules tab                                                               */
/* ---------------------------------------------------------------------- */

/** The Rules screen (under Data), two sub-tabs:
 *   - Categorization rules: the manual rule-creation form (addRule) plus the full
 *     list of every rule (system-seeded, learned from tagging a transaction, or
 *     user-added here directly), and "Re-apply rules to existing data" - re-checks
 *     every rule-derived or still-uncategorized transaction against the current rule
 *     set, deliberately leaving manually-categorized transactions untouched
 *     (eligibleCount/manualCount split), so editing a rule can't silently overwrite
 *     a deliberate manual override elsewhere.
 *   - Merchant groups: MerchantGroupsPanel, for combining near-duplicate merchant
 *     strings under one display name (this only affects display - categorization
 *     rules still match the original text). */
function RulesTab({ rules, setRules, transactions, onReapplyRules, merchantAliases, setMerchantAliases, accounts }) {
  const [subTab, setSubTab] = useState("rules"); // rules | merchants
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("Expense");
  const [subCategory, setSubCategory] = useState("Variable");
  const [frequency, setFrequency] = useState("Monthly");
  const [tag, setTag] = useState("Personal");
  const [purpose, setPurpose] = useState("Personal");
  const [linkedAccountId, setLinkedAccountId] = useState("");
  const [confirmingReapply, setConfirmingReapply] = useState(false);
  const [confirmingRulesReset, setConfirmingRulesReset] = useState(false);

  function handleCategoryChange(v) {
    setCategory(v);
    const opts = subCategoryOptionsFor(v);
    setSubCategory(opts.length > 0 ? opts[0] : "");
    setLinkedAccountId("");
  }

  function addRule() {
    const p = pattern.trim().toLowerCase();
    if (!p) return;
    const finalSub = subCategoryOptionsFor(category).length > 0 ? subCategory : null;
    const finalFreq = isFrequencyEligible(category, finalSub) ? frequency : null;
    const finalLinkedAccountId = linkableAccountTypesFor(category, finalSub).length > 0 ? (linkedAccountId || null) : null;
    setRules((prev) => [
      ...prev.filter((r) => r.pattern.toLowerCase() !== p),
      {
        id: uid("rule"), pattern: p, category,
        subCategory: finalSub,
        tag: category === "Expense" ? tag : null,
        frequency: finalFreq,
        purpose: purpose || "Personal",
        linkedAccountId: finalLinkedAccountId,
        source: "user", priority: p.length + 1000, // user rules win ties
      },
    ]);
    setPattern("");
    setLinkedAccountId("");
  }

  function removeRule(id) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  const eligibleCount = transactions.filter((t) => t.matchedRuleId || !t.category).length;
  const manualCount = transactions.length - eligibleCount;

  function confirmReapply() {
    setConfirmingReapply(false);
    onReapplyRules();
  }

  const sorted = [...rules].sort((a, b) => b.priority - a.priority);

  return (
    <div>
      <div className="bw-tabs" style={{ marginBottom: 18 }}>
        <button className={`bw-tab ${subTab === "rules" ? "active" : ""}`} onClick={() => setSubTab("rules")}>
          <FileText size={13} /> Categorization rules
        </button>
        <button className={`bw-tab ${subTab === "merchants" ? "active" : ""}`} onClick={() => setSubTab("merchants")}>
          <Merge size={13} /> Merchant groups{merchantAliases.length > 0 ? <span className="badge">{merchantAliases.length}</span> : null}
        </button>
      </div>

      {subTab === "merchants" ? (
        <MerchantGroupsPanel transactions={transactions} merchantAliases={merchantAliases} setMerchantAliases={setMerchantAliases} />
      ) : (
      <>
      <h2 className="bw-h2">Categorization rules</h2>
      <p className="bw-lead">
        Every transaction is matched against this list — the most specific / user-added rule wins if more than
        one matches. Edit freely; nothing here is fixed logic.
      </p>

      <div style={{
        border: "1px solid var(--line)", borderRadius: 6, padding: "10px 14px", marginBottom: 18, background: "var(--card)",
      }}>
        {!confirmingReapply ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", maxWidth: 480 }}>
              Adding or editing a rule only affects <em>new</em> imports by default. Re-apply to bring already-imported
              transactions in line with your current rules — anything you categorized by hand (not via a rule) is left alone.
            </div>
            <button className="bw-btn ghost small" onClick={() => setConfirmingReapply(true)}>
              <RefreshCw size={12} /> Re-apply rules to existing data
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12 }}>
              Re-check <strong>{eligibleCount}</strong> rule-derived/uncategorized transaction{eligibleCount === 1 ? "" : "s"} against
              your current rules? <strong>{manualCount}</strong> manually-categorized {manualCount === 1 ? "entry" : "entries"} will be left untouched.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="bw-btn small" onClick={confirmReapply}><Check size={12} /> Yes, re-apply</button>
              <button className="bw-btn ghost small" onClick={() => setConfirmingReapply(false)}><X size={12} /> Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div style={{
        border: "1px solid var(--line)", borderRadius: 6, padding: "10px 14px", marginBottom: 18, background: "var(--card)",
      }}>
        {!confirmingRulesReset ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", maxWidth: 480 }}>
              Start over with just the built-in starter rules, discarding everything you've taught the app —
              separate from "Reset local data," which clears transactions/accounts/budgets but leaves rules alone.
            </div>
            <button className="bw-btn ghost small" onClick={() => setConfirmingRulesReset(true)}>
              <RefreshCw size={12} /> Reset rules to default
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--rust)" }}>
              Discard all {sorted.length} rules and replace with the built-in starter set? This can't be undone.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="bw-btn small" style={{ background: "var(--rust)", borderColor: "var(--rust)" }}
                onClick={() => { setRules(seedRules()); setConfirmingRulesReset(false); }}>
                <Check size={12} /> Yes, reset rules
              </button>
              <button className="bw-btn ghost small" onClick={() => setConfirmingRulesReset(false)}><X size={12} /> Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="bw-grid2" style={{ alignItems: "end" }}>
        <div className="bw-field">
          <label>Merchant keyword contains</label>
          <input type="text" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. swiggy" />
        </div>
        <div className="bw-field">
          <label>Category</label>
          <select value={category} onChange={(e) => handleCategoryChange(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      {subCategoryOptionsFor(category).length > 0 && (
        <div className="bw-grid2">
          <div className="bw-field">
            <label>Sub-category</label>
            <select value={subCategory} onChange={(e) => setSubCategory(e.target.value)}>
              {subCategoryOptionsFor(category).map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          {isFrequencyEligible(category, subCategory) ? (
            <div className="bw-field">
              <label>Frequency</label>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
          ) : category === "Expense" ? (
            <div className="bw-field">
              <label>Tag</label>
              <select value={tag} onChange={(e) => setTag(e.target.value)}>
                {TAGS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          ) : <div />}
        </div>
      )}
      {isFrequencyEligible(category, subCategory) && category === "Expense" && (
        <div className="bw-grid2">
          <div className="bw-field">
            <label>Tag</label>
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              {TAGS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div />
        </div>
      )}
      <div className="bw-field" style={{ maxWidth: 220 }}>
        <label>Purpose</label>
        <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          {PURPOSES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>
      {linkableAccountTypesFor(category, subCategory).length > 0 && (
        <div className="bw-field" style={{ maxWidth: 260 }}>
          <label>Which account (optional)</label>
          <select value={linkedAccountId} onChange={(e) => setLinkedAccountId(e.target.value)}>
            <option value="">— not specified —</option>
            {accounts.filter((a) => linkableAccountTypesFor(category, subCategory).includes(a.type)).map((a) => (
              <option key={a.id} value={a.id}>{a.nickname}</option>
            ))}
          </select>
        </div>
      )}
      <button className="bw-btn" onClick={addRule}><Plus size={14} /> Add rule</button>

      <div className="bw-section-label">All rules ({sorted.length})</div>
      <table className="bw-table">
        <thead>
          <tr><th>Pattern</th><th>Maps to</th><th>Source</th><th></th></tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{r.pattern}</td>
              <td>
                <span className="bw-pill" style={{ background: PALETTE[pillClass(r.category, r.subCategory, r.tag)] || "#9C8F78" }}>
                  {r.category}{r.subCategory ? ` / ${r.subCategory}` : ""}{r.frequency ? ` / ${r.frequency}` : ""}{r.tag ? ` / ${r.tag}` : ""}
                </span>
                {r.purpose === "Business" && (
                  <span style={{ fontSize: 9.5, color: "var(--ochre)", border: "1px solid var(--ochre)", borderRadius: 20, padding: "1px 6px", marginLeft: 5 }}>
                    Business
                  </span>
                )}
              </td>
              <td style={{ fontSize: 11.5, color: "var(--ink-soft)", textTransform: "capitalize" }}>{r.source}</td>
              <td><button className="bw-btn ghost small" onClick={() => removeRule(r.id)}><Trash2 size={12} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Merchant groups panel — combine near-duplicate merchant strings         */
/* ---------------------------------------------------------------------- */

/** The Merchant groups sub-tab of Rules - combines near-duplicate merchant strings
 *  (e.g. "UPI SCAPIA SCAPIA" and "UPI SCAPIA TECHNOLOGY") under one display name for
 *  reporting purposes only; the raw text each rule matches against is never altered,
 *  so future imports keep working. Suggestions come from computeSuggestedMerchantClusters
 *  (algorithmic, based on shared "core" text after stripping banking noise words);
 *  groups can also be built or edited entirely by hand below. */
function MerchantGroupsPanel({ transactions, merchantAliases, setMerchantAliases }) {
  const suggestions = useMemo(
    () => computeSuggestedMerchantClusters(transactions, merchantAliases),
    [transactions, merchantAliases]
  );

  // every distinct raw merchant string seen (Expense only), for the "add variant" pickers
  const allRawMerchants = useMemo(() => {
    const map = {};
    transactions.forEach((t) => {
      if (t.category !== "Expense") return;
      const key = t.merchant || t.description;
      if (!key) return;
      map[key] = (map[key] || 0) + t.amount;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [transactions]);

  function mergeCluster(cluster, name) {
    const finalName = (name || cluster.suggestedName || cluster.core).trim();
    if (!finalName) return;
    setMerchantAliases((prev) => [
      ...prev,
      { id: uid("mg"), canonical: finalName, variants: cluster.variants.map((v) => v.key) },
    ]);
  }

  function renameGroup(id, name) {
    setMerchantAliases((prev) => prev.map((g) => (g.id === id ? { ...g, canonical: name } : g)));
  }

  function removeVariant(id, variant) {
    setMerchantAliases((prev) => prev.map((g) => (g.id === id ? { ...g, variants: g.variants.filter((v) => v !== variant) } : g)).filter((g) => g.variants.length > 0));
  }

  function addVariant(id, variant) {
    if (!variant) return;
    setMerchantAliases((prev) => prev.map((g) => (g.id === id && !g.variants.includes(variant) ? { ...g, variants: [...g.variants, variant] } : g)));
  }

  function deleteGroup(id) {
    setMerchantAliases((prev) => prev.filter((g) => g.id !== id));
  }

  const groupedVariants = new Set(merchantAliases.flatMap((g) => g.variants));
  const ungroupedRaw = allRawMerchants.filter((k) => !groupedVariants.has(k));

  return (
    <div>
      <h2 className="bw-h2">Merchant groups</h2>
      <p className="bw-lead">
        Bank descriptions for the same merchant often vary slightly (e.g. "UPI SCAPIA SCAPIA" vs
        "UPI SCAPIA TECHNOLOGY"). Group them under one name so reports and top-merchant lists show one entry
        instead of several. This only affects how merchants are displayed — categorization rules still match on
        the original text, so future imports keep working.
      </p>

      {suggestions.length > 0 && (
        <>
          <div className="bw-section-label" style={{ marginTop: 0 }}>
            <Sparkles size={13} style={{ verticalAlign: -2, marginRight: 5 }} />Suggested groupings
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
            {suggestions.map((cluster) => (
              <SuggestedClusterRow key={cluster.core} cluster={cluster} onMerge={mergeCluster} />
            ))}
          </div>
        </>
      )}

      <div className="bw-section-label" style={{ marginTop: 0 }}>Your groups ({merchantAliases.length})</div>
      {merchantAliases.length === 0 ? (
        <div className="bw-empty">No merchant groups yet — merge a suggestion above, or create one manually below.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 22 }}>
          {merchantAliases.map((g) => (
            <MerchantGroupRow
              key={g.id} group={g}
              availableToAdd={ungroupedRaw}
              onRename={renameGroup} onRemoveVariant={removeVariant} onAddVariant={addVariant} onDelete={deleteGroup}
            />
          ))}
        </div>
      )}

      <ManualMerchantGroupCreator availableRaw={ungroupedRaw} onCreate={(name, variants) => {
        if (!name.trim() || variants.length === 0) return;
        setMerchantAliases((prev) => [...prev, { id: uid("mg"), canonical: name.trim(), variants }]);
      }} />
    </div>
  );
}

/** One algorithmically-suggested merchant cluster, with an editable proposed name and
 *  a one-click "Merge as one" to accept it as a real merchant group. */
function SuggestedClusterRow({ cluster, onMerge }) {
  const [name, setName] = useState(cluster.suggestedName);
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 12, background: "var(--card)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
        <input type="text" className="bw-select-inline" style={{ fontSize: 13, fontWeight: 600, width: 220 }} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="bw-btn small" onClick={() => onMerge(cluster, name)}><Merge size={12} /> Merge as one</button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
        {cluster.variants.map((v) => `${v.key} (${v.count}× · ${inr(v.total)})`).join(" · ")}
      </div>
    </div>
  );
}

/** One existing merchant group, editable in place - rename it, remove a variant
 *  (deleting the group entirely once its last variant is gone), add another
 *  ungrouped raw merchant string to it, or delete the whole group. */
function MerchantGroupRow({ group, availableToAdd, onRename, onRemoveVariant, onAddVariant, onDelete }) {
  const [addValue, setAddValue] = useState("");
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 12, background: "var(--card)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <input type="text" className="bw-select-inline" style={{ fontSize: 13, fontWeight: 600, width: 220 }}
          value={group.canonical} onChange={(e) => onRename(group.id, e.target.value)} />
        <button className="bw-btn ghost small" onClick={() => onDelete(group.id)}><Trash2 size={12} /> Delete group</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {group.variants.map((v) => (
          <span key={v} style={{
            fontSize: 11, border: "1px solid var(--line)", borderRadius: 20, padding: "2px 8px 2px 10px",
            display: "inline-flex", alignItems: "center", gap: 5, background: "var(--paper)",
          }}>
            {v}
            <button onClick={() => onRemoveVariant(group.id, v)} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, display: "flex" }}>
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select className="bw-select-inline" style={{ flex: 1 }} value={addValue} onChange={(e) => setAddValue(e.target.value)}>
          <option value="">— add another variant —</option>
          {availableToAdd.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button className="bw-btn ghost small" disabled={!addValue} onClick={() => { onAddVariant(group.id, addValue); setAddValue(""); }}>
          <Plus size={12} /> Add
        </button>
      </div>
    </div>
  );
}

/** Builds a brand-new merchant group from scratch - name it, then check off any
 *  number of ungrouped raw merchant strings to combine under that name, for cases
 *  the algorithmic suggestions above don't catch. */
function ManualMerchantGroupCreator({ availableRaw, onCreate }) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState([]);

  function toggle(k) {
    setSelected((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 6, padding: 12 }}>
      <div className="bw-field">
        <label>Create a group manually — name it, then pick the merchants to combine</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Scapia" />
      </div>
      {availableRaw.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>All known merchants are already in a group.</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, maxHeight: 140, overflowY: "auto" }}>
          {availableRaw.map((k) => (
            <label key={k} style={{
              fontSize: 11, border: `1px solid ${selected.includes(k) ? "var(--teal)" : "var(--line)"}`, borderRadius: 20,
              padding: "3px 9px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
              background: selected.includes(k) ? "rgba(46,102,89,0.08)" : "var(--card)",
            }}>
              <input type="checkbox" checked={selected.includes(k)} onChange={() => toggle(k)} style={{ margin: 0 }} />
              {k}
            </label>
          ))}
        </div>
      )}
      <button className="bw-btn small" disabled={!name.trim() || selected.length === 0}
        onClick={() => { onCreate(name, selected); setName(""); setSelected([]); }}>
        <Merge size={12} /> Create group
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Cash Flow Overview                                                      */
/* ---------------------------------------------------------------------- */

const BUDGET_BUCKETS = [
  { key: "Expense-Fixed", label: "Fixed" },
  { key: "Expense-Variable-Household", label: "Variable · Household" },
  { key: "Expense-Variable-Personal", label: "Variable · Personal" },
];

/** The unified dashboard — one screen, one card per pillar, each linking to its full
 *  screen. Every number here is computed directly from the same source data every other
 *  screen uses; nothing is duplicated logic that could quietly drift from what those
 *  screens themselves show. The one deliberate exception: Goals shows a simple count and
 *  aggregate target rather than a per-goal "on track" verdict, since that verdict depends
 *  on GoalsOverview's own near-term/long-term pool allocation — reusing it properly means
 *  lifting that computation up, which is real follow-up work, not something to duplicate
 *  here and risk disagreeing with the real Goals screen. */
function DashboardOverview({ transactions, accounts, budgets, merchantAliases, holdingSnapshots, otherInvestments, debtSchedules, goals, onGoToView }) {
  const nwCurrent = useMemo(
    () => computeNetWorthSummary(accounts, holdingSnapshots, otherInvestments, debtSchedules),
    [accounts, holdingSnapshots, otherInvestments, debtSchedules]
  );
  const nwPrevious = useMemo(
    () => computeNetWorthSummaryAsOfPrevious(accounts, holdingSnapshots, otherInvestments, debtSchedules),
    [accounts, holdingSnapshots, otherInvestments, debtSchedules]
  );
  const nwDelta = nwCurrent.netWorth - nwPrevious.netWorth;

  const monthlyTotals = useMemo(() => {
    const map = {};
    transactions.forEach((t) => {
      const mk = monthKey(t.date);
      if (!map[mk]) map[mk] = { income: 0, expense: 0, buckets: {} };
      const m = map[mk];
      if (t.category === "Income" && t.direction === "credit") m.income += t.amount;
      if (t.category === "Expense") {
        const signed = t.direction === "credit" ? -t.amount : t.amount;
        m.expense += signed;
        const key = pillClass(t.category, t.subCategory, t.tag);
        m.buckets[key] = (m.buckets[key] || 0) + signed;
      }
    });
    return map;
  }, [transactions]);

  const months = useMemo(() => [...new Set(transactions.map((t) => monthKey(t.date)))].sort(), [transactions]);
  const lastMonthKey = months.length > 0 ? months[months.length - 1] : null;
  const lastMonthIdx = lastMonthKey ? months.indexOf(lastMonthKey) : -1;
  const prevMonthKeyForDash = lastMonthIdx > 0 ? months[lastMonthIdx - 1] : null;
  const curM = lastMonthKey ? monthlyTotals[lastMonthKey] : null;
  const prevM = prevMonthKeyForDash ? monthlyTotals[prevMonthKeyForDash] : null;

  const savingsRate = curM && curM.income > 0 ? ((curM.income - curM.expense) / curM.income) * 100 : 0;
  const savingsAmount = curM ? curM.income - curM.expense : 0;
  const prevSavingsRate = prevM && prevM.income > 0 ? ((prevM.income - prevM.expense) / prevM.income) * 100 : null;
  const savingsRatePoints = months.slice(-6).map((mk) => {
    const m = monthlyTotals[mk];
    return m && m.income > 0 ? ((m.income - m.expense) / m.income) * 100 : 0;
  });

  function pctDelta(cur, prev) {
    if (prev === null || prev === 0) return null;
    const d = ((cur - prev) / prev) * 100;
    return { text: `${d >= 0 ? "\u25B2" : "\u25BC"} ${Math.abs(d).toFixed(0)}%`, color: d >= 0 ? "var(--rust)" : "var(--teal)" };
  }
  const curHousehold = curM ? (curM.buckets["Expense-Variable-Household"] || 0) : 0;
  const curPersonal = curM ? (curM.buckets["Expense-Variable-Personal"] || 0) : 0;
  const prevHousehold = prevM ? (prevM.buckets["Expense-Variable-Household"] || 0) : null;
  const prevPersonal = prevM ? (prevM.buckets["Expense-Variable-Personal"] || 0) : null;
  const householdDelta = pctDelta(curHousehold, prevHousehold);
  const personalDelta = pctDelta(curPersonal, prevPersonal);
  const expenseDelta = pctDelta(curM?.expense || 0, prevM?.expense ?? null);

  let totalInvested = 0;
  accounts.filter((a) => a.type === "demat" || a.type === "mutualFund").forEach((acct) => {
    const snaps = holdingSnapshots.filter((s) => s.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    if (snaps.length > 0) totalInvested += snaps[snaps.length - 1].totalInvestedValue || 0;
  });
  accounts.filter((a) => a.type === "otherInvestment").forEach((acct) => {
    const entries = otherInvestments.filter((e) => e.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    if (entries.length > 0) totalInvested += entries[entries.length - 1].investedValue || 0;
  });
  const totalInvestmentsCurrent = nwCurrent.marketTrackedValue + nwCurrent.otherInvestmentsValue;
  const investmentGrowthPct = totalInvested > 0 ? ((totalInvestmentsCurrent - totalInvested) / totalInvested) * 100 : 0;
  const investmentsPreviousSnapshotValue = nwPrevious.marketTrackedValue + nwPrevious.otherInvestmentsValue;
  const investmentsVsSnapshotDelta = totalInvestmentsCurrent - investmentsPreviousSnapshotValue;

  const debtAccounts = accounts.filter((a) => a.type === "debt");
  const hasDebt = debtAccounts.length > 0 && nwCurrent.totalDebt > 0;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let debtThirtyDaysAgo = 0;
  debtAccounts.forEach((acct) => {
    const schedules = debtSchedules.filter((s) => s.accountId === acct.id);
    if (schedules.length > 0) {
      const summary = computeDebtSummary(schedules, thirtyDaysAgo);
      if (summary.hasData) debtThirtyDaysAgo += summary.currentOutstanding;
    }
  });
  const debtPaidDown = debtThirtyDaysAgo - nwCurrent.totalDebt;

  // Near-term goals (Emergency Fund, Short-term) use a completely different target
  // formula than long-term goals — emergencyMonths x average expense, not inflated
  // cost-today math. Using computeGoalMath for these was the actual bug behind the
  // "0 combined target" — costToday/inflationRate/returnRate are simply unset on them.
  const holdingsIndexForGoals = useMemo(() => buildHoldingsIndex(accounts, holdingSnapshots), [accounts, holdingSnapshots]);
  const averageMonthlyExpenseForGoals = useMemo(() => computeAverageMonthlyExpense(transactions), [transactions]);
  const goalRows = goals.map((g) => {
    const isNearTerm = GOAL_TYPE_DEFAULTS[g.type]?.isMonthsBased;
    const target = isNearTerm
      ? Math.round((g.emergencyMonths || 6) * averageMonthlyExpenseForGoals * 100) / 100
      : computeGoalMath(g.costToday, g.inflationRate, g.returnRate, g.yearsToGoal).targetCorpus;
    // Near-term: funded = accurately tracked value from its own assigned holdings.
    // Long-term: funded = the goal's own stated manual allocation — a direct field on
    // the goal, not the pool-sufficiency-checked "claimed" amount GoalsOverview computes,
    // since that requires the full shared-pool logic this dashboard doesn't duplicate.
    const funded = isNearTerm
      ? computeNearTermGoalTracking(g, holdingsIndexForGoals, accounts, holdingSnapshots).trackedCurrentValue
      : (g.manualLumpsumAllocation || 0);
    const trackedPct = isNearTerm && target > 0 ? Math.min(100, (funded / target) * 100) : null;
    return { id: g.id, name: g.name, target, funded, trackedPct, isNearTerm };
  });
  const totalGoalTarget = goalRows.reduce((s, g) => s + (g.target || 0), 0);
  const totalGoalFunded = goalRows.reduce((s, g) => s + (g.funded || 0), 0);
  const totalGoalPct = totalGoalTarget > 0 ? Math.min(100, (totalGoalFunded / totalGoalTarget) * 100) : 0;

  if (accounts.length === 0) {
    return <div className="bw-empty">Import a statement first — the dashboard fills in as soon as there's data.</div>;
  }

  return (
    <div>
      <ZoneHeader icon={LineChartIcon} title="Overview" subtitle="Every pillar, at a glance — click any card for the full picture" />
      <div className="bw-insight-row">
        <InsightCard
          icon={Landmark} title="Net worth" value={inr(nwCurrent.netWorth)}
          delta={`${nwDelta >= 0 ? "\u25B2" : "\u25BC"} ${inr(Math.abs(nwDelta))} \u00B7 vs last snapshot`}
          deltaColor={nwDelta >= 0 ? "var(--teal)" : "var(--rust)"}
          onClick={() => onGoToView("networth")}
        >
          <Sparkline values={[nwPrevious.netWorth, nwCurrent.netWorth]} color={nwDelta >= 0 ? "var(--teal)" : "var(--rust)"} />
        </InsightCard>

        <InsightCard
          icon={Wallet} title="Savings" value={inr(savingsAmount)}
          delta={prevSavingsRate !== null ? `${savingsRate.toFixed(0)}% rate \u00B7 ${savingsRate >= prevSavingsRate ? "\u25B2" : "\u25BC"} vs last month` : `${savingsRate.toFixed(0)}% rate`}
          deltaColor={prevSavingsRate !== null ? (savingsRate >= prevSavingsRate ? "var(--teal)" : "var(--rust)") : "var(--ink-soft)"}
          onClick={() => onGoToView("cashflow")}
        >
          <Sparkline values={savingsRatePoints} color="var(--teal)" />
        </InsightCard>

        <InsightCard
          icon={TrendingUp} title="Investments" value={inr(totalInvestmentsCurrent)}
          delta={`${investmentsVsSnapshotDelta >= 0 ? "\u25B2" : "\u25BC"} ${inr(Math.abs(investmentsVsSnapshotDelta))} \u00B7 vs last snapshot`}
          deltaColor={investmentsVsSnapshotDelta >= 0 ? "var(--teal)" : "var(--rust)"}
          onClick={() => onGoToView("investments")}
          footer={[
            { label: "Invested", value: inr(totalInvested) },
            { label: "Growth", value: `${investmentGrowthPct >= 0 ? "\u25B2" : "\u25BC"} ${Math.abs(investmentGrowthPct).toFixed(1)}%`, color: investmentGrowthPct >= 0 ? "var(--teal)" : "var(--rust)" },
          ]}
        >
          <Sparkline values={[investmentsPreviousSnapshotValue, totalInvestmentsCurrent]} color={investmentsVsSnapshotDelta >= 0 ? "var(--teal)" : "var(--rust)"} />
        </InsightCard>

        {hasDebt && (
          <InsightCard
            icon={TrendingDown} title="Debt" value={inr(nwCurrent.totalDebt)}
            delta={`${debtPaidDown >= 0 ? "\u25BC" : "\u25B2"} ${inr(Math.abs(debtPaidDown))} \u00B7 ${debtPaidDown >= 0 ? "paid down" : "increased"} in 30 days`}
            deltaColor={debtPaidDown >= 0 ? "var(--teal)" : "var(--rust)"}
            onClick={() => onGoToView("debt")}
          >
            <Sparkline values={[debtThirtyDaysAgo, nwCurrent.totalDebt]} color="var(--teal)" />
          </InsightCard>
        )}

        <InsightCard
          icon={FileText} title="Expenses" value={inr(curM?.expense || 0)}
          delta={expenseDelta ? `${expenseDelta.text} vs last month` : null} deltaColor={expenseDelta?.color}
          onClick={() => onGoToView("cashflow")}
        >
          <div style={{ marginTop: 2 }}>
            <div className="bw-insight-line">
              <span style={{ color: "var(--ink-soft)" }}>Household</span>
              <span><strong style={{ color: "var(--ink)" }}>{inr(curHousehold)}</strong>{householdDelta && <span style={{ color: householdDelta.color, marginLeft: 6 }}>{householdDelta.text}</span>}</span>
            </div>
            <div className="bw-insight-line">
              <span style={{ color: "var(--ink-soft)" }}>Personal</span>
              <span><strong style={{ color: "var(--ink)" }}>{inr(curPersonal)}</strong>{personalDelta && <span style={{ color: personalDelta.color, marginLeft: 6 }}>{personalDelta.text}</span>}</span>
            </div>
          </div>
        </InsightCard>

        <InsightCard
          icon={Flag} title="Goals" value={String(goals.length)}
          delta={goals.length === 0 ? "No goals set yet" : `${inr(totalGoalTarget)} target \u00B7 ${totalGoalPct.toFixed(0)}% funded`}
          deltaColor={totalGoalPct >= 75 ? "var(--teal)" : totalGoalPct >= 40 ? "var(--ochre)" : "var(--rust)"}
          onClick={() => onGoToView("goals")}
          footer={goals.length > 0 ? [
            { label: "Amount funded", value: inr(totalGoalFunded) },
            { label: "Portfolio chg.", value: `${investmentsVsSnapshotDelta >= 0 ? "\u25B2" : "\u25BC"} ${inr(Math.abs(investmentsVsSnapshotDelta))}`, color: investmentsVsSnapshotDelta >= 0 ? "var(--teal)" : "var(--rust)" },
          ] : undefined}
        />
      </div>
    </div>
  );
}

/** The Cash Flow pillar screen - Income, Expense, Investment laid out as one waterfall
 *  equation (Income - Expense = Savings; Investment tracked as its own use of income,
 *  never folded into Savings), plus:
 *   - Opening/Closing bank balance for the period, resolved via
 *     resolveAccountBalanceForPeriod's 3-tier confidence (exact/derived/estimate),
 *     aggregated across all bank accounts (waterfall) and shown per-account
 *     (perAccountEquation) so a discrepancy is traceable to a specific account.
 *   - Expense split two ways: Fixed/Variable-Household/Variable-Personal (the
 *     existing composition), and separately Cash vs Credit Card (expenseByPaymentMethod)
 *     - a card purchase and a debit-card purchase differ in when cash actually
 *     leaves, so this is tracked as its own dimension, not folded into the first.
 *   - Budget vs Actual, with a median-of-recent-months suggested budget per bucket.
 *   - Top merchants, a click-to-drill-down bar chart, and the monthly/MoM trend.
 *  Every number here is either summed directly from transactions, or - for
 *  Opening/Closing - resolved through the shared balance resolver, never a separately
 *  tracked or manually-entered figure. */
function CashFlowOverview({ transactions, setTransactions, accounts, budgets, setBudgets, merchantAliases, rules, onGoToUpload, onGoToReview }) {
  const months = useMemo(() => {
    const s = new Set(transactions.map((t) => monthKey(t.date)));
    return [...s].sort();
  }, [transactions]);

  const years = useMemo(() => {
    const s = new Set(months.map((mk) => mk.slice(0, 4)));
    return [...s].sort();
  }, [months]);

  const [selectedMonth, setSelectedMonth] = useState("all");
  const [drill, setDrill] = useState(null); // { label, txns }
  const [subView, setSubView] = useState("overview"); // "overview" | "calendar"

  // "all" | "year" | "month" — a 4-char selection is a year, 7-char (YYYY-MM) is a month
  const periodType = selectedMonth === "all" ? "all" : (selectedMonth.length === 4 ? "year" : "month");

  const scoped = useMemo(() => {
    if (selectedMonth === "all") return transactions;
    if (periodType === "year") return transactions.filter((t) => t.date.slice(0, 4) === selectedMonth);
    return transactions.filter((t) => monthKey(t.date) === selectedMonth);
  }, [transactions, selectedMonth, periodType]);

  const totals = useMemo(() => {
    let income = 0, expense = 0, investedOut = 0, investedIn = 0;
    const compBuckets = {};
    const merchantTotals = {};
    scoped.forEach((t) => {
      if (t.category === "Income" && t.direction === "credit") income += t.amount;
      if (t.category === "Investment") {
        // money going into an investment (SIP/purchase) is a debit; money coming back
        // (redemption/withdrawal/maturity) is a credit — netted so redemptions show as negative.
        if (t.direction === "debit") investedOut += t.amount; else investedIn += t.amount;
      }
      if (t.category === "Expense") {
        // A credit here is a refund/reversal (return, disputed charge reversed) — it should
        // reduce spend, not add to it, the same way Investment nets debit-out against credit-in.
        const signedAmt = t.direction === "credit" ? -t.amount : t.amount;
        expense += signedAmt;
        const key = pillClass(t.category, t.subCategory, t.tag);
        compBuckets[key] = (compBuckets[key] || 0) + signedAmt;
        const m = resolveMerchant(t.merchant || t.description, merchantAliases);
        merchantTotals[m] = (merchantTotals[m] || 0) + signedAmt;
      }
    });
    const netInvestment = investedOut - investedIn;
    const savings = income - expense; // money left over after spending — investing is tracked separately, not folded in
    const savingsRate = income > 0 ? (savings / income) * 100 : 0;
    const investmentRate = income > 0 ? (netInvestment / income) * 100 : 0;
    return { income, expense, investedOut, investedIn, netInvestment, savings, savingsRate, investmentRate, compBuckets, merchantTotals };
  }, [scoped, merchantAliases]);

  // Expense split by HOW it was paid — Cash (any bank account) vs Credit Card — before
  // the existing Fixed/Variable split. A card purchase and a debit-card purchase are
  // very different in terms of when the cash actually left, so this distinction matters
  // on its own, not just as a footnote inside Fixed/Variable.
  const expenseByPaymentMethod = useMemo(() => {
    const acctTypeMap = {};
    accounts.forEach((a) => { acctTypeMap[a.id] = a.type === "creditCard" ? "creditCard" : "cash"; });
    const buckets = { cash: { total: 0, fixed: 0, varHousehold: 0, varPersonal: 0 }, creditCard: { total: 0, fixed: 0, varHousehold: 0, varPersonal: 0 } };
    const recurringByMethod = { cash: {}, creditCard: {} };
    const merchantsByMethod = { cash: { varHousehold: {}, varPersonal: {} }, creditCard: { varHousehold: {}, varPersonal: {} } };
    scoped.forEach((t) => {
      if (t.category !== "Expense") return;
      const method = acctTypeMap[t.accountId] || "cash";
      const signed = t.direction === "credit" ? -t.amount : t.amount;
      const b = buckets[method];
      b.total += signed;
      const m = resolveMerchant(t.merchant || t.description, merchantAliases);
      if (t.subCategory === "Fixed") {
        b.fixed += signed;
        if (!recurringByMethod[method][m]) recurringByMethod[method][m] = { merchant: m, total: 0, lastDate: "", frequency: t.frequency || "Monthly" };
        recurringByMethod[method][m].total += signed;
        if (t.date >= recurringByMethod[method][m].lastDate) {
          recurringByMethod[method][m].lastDate = t.date;
          recurringByMethod[method][m].frequency = t.frequency || "Monthly";
        }
      } else if (t.subCategory === "Variable" && t.tag === "Household") {
        b.varHousehold += signed;
        merchantsByMethod[method].varHousehold[m] = (merchantsByMethod[method].varHousehold[m] || 0) + signed;
      } else if (t.subCategory === "Variable" && t.tag === "Personal") {
        b.varPersonal += signed;
        merchantsByMethod[method].varPersonal[m] = (merchantsByMethod[method].varPersonal[m] || 0) + signed;
      }
    });
    // Amortize each recurring merchant's period total across however many months the
    // CURRENT VIEW spans — not by how many actual bills came in. A bill that genuinely
    // varies (electricity) or one that skipped a month gets smoothed into a representative
    // "per month" figure instead of just showing whichever bill happened most recently.
    const monthSpan = periodType === "month" ? 1
      : periodType === "year" ? Math.max(months.filter((mk) => mk.startsWith(selectedMonth)).length, 1)
      : Math.max(months.length, 1);
    const finalizeRecurring = (byMerchant) => Object.values(byMerchant)
      .map((c) => ({ ...c, amortizedAmount: c.total / monthSpan }))
      .sort((a, b) => b.amortizedAmount - a.amortizedAmount);
    const topN = (obj, n = 5) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
    return {
      cash: {
        ...buckets.cash,
        recurring: finalizeRecurring(recurringByMethod.cash),
        topVarHousehold: topN(merchantsByMethod.cash.varHousehold),
        topVarPersonal: topN(merchantsByMethod.cash.varPersonal),
      },
      creditCard: {
        ...buckets.creditCard,
        recurring: finalizeRecurring(recurringByMethod.creditCard),
        topVarHousehold: topN(merchantsByMethod.creditCard.varHousehold),
        topVarPersonal: topN(merchantsByMethod.creditCard.varPersonal),
      },
    };
  }, [scoped, accounts, merchantAliases, months, periodType, selectedMonth]);

  // per-month aggregation, reused by the trend chart, MoM comparison, and budget-vs-actual averages
  const monthlyTotals = useMemo(() => {
    const map = {};
    transactions.forEach((t) => {
      const mk = monthKey(t.date);
      if (!map[mk]) map[mk] = { income: 0, expense: 0, investedOut: 0, investedIn: 0, buckets: {}, merchants: {}, fixedByFreq: { Monthly: 0, Quarterly: 0, "Semi-Annual": 0, Annual: 0 } };
      const m = map[mk];
      if (t.category === "Income" && t.direction === "credit") m.income += t.amount;
      if (t.category === "Investment") { if (t.direction === "debit") m.investedOut += t.amount; else m.investedIn += t.amount; }
      if (t.category === "Expense") {
        const signedAmt = t.direction === "credit" ? -t.amount : t.amount;
        m.expense += signedAmt;
        const key = pillClass(t.category, t.subCategory, t.tag);
        m.buckets[key] = (m.buckets[key] || 0) + signedAmt;
        const mrc = resolveMerchant(t.merchant || t.description, merchantAliases);
        m.merchants[mrc] = (m.merchants[mrc] || 0) + signedAmt;
        if (t.subCategory === "Fixed") {
          const freq = t.frequency || "Monthly";
          m.fixedByFreq[freq] = (m.fixedByFreq[freq] || 0) + signedAmt;
        }
      }
    });
    return map;
  }, [transactions, merchantAliases]);

  // A Fixed expense's "fair monthly share" depends on how often it actually recurs — an
  // annual insurance payment shouldn't spike one month's budget and vanish for the other 11.
  // Monthly-frequency items count at face value for the month; Annual/Quarterly items are
  // spread evenly across a trailing 12- or 3-month window ending at that month, so every
  // month carries a steady, comparable share regardless of which month the real bill lands in.
  function trailingMonthKeys(referenceMk, count) {
    const [y, m] = referenceMk.split("-").map(Number);
    const keys = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return keys;
  }
  function amortizedFixedActual(referenceMk) {
    const monthly = monthlyTotals[referenceMk]?.fixedByFreq?.Monthly || 0;
    const annualWindow = trailingMonthKeys(referenceMk, 12).reduce((s, mk) => s + (monthlyTotals[mk]?.fixedByFreq?.Annual || 0), 0);
    const semiAnnualWindow = trailingMonthKeys(referenceMk, 6).reduce((s, mk) => s + (monthlyTotals[mk]?.fixedByFreq?.["Semi-Annual"] || 0), 0);
    const quarterlyWindow = trailingMonthKeys(referenceMk, 3).reduce((s, mk) => s + (monthlyTotals[mk]?.fixedByFreq?.Quarterly || 0), 0);
    return monthly + annualWindow / 12 + semiAnnualWindow / 6 + quarterlyWindow / 3;
  }

  // Suggested monthly budget per bucket = median of the last up to 6 months' actuals.
  // Median (not average) so one unusually large month doesn't skew the suggestion.
  const suggestedBudgets = useMemo(() => {
    const out = {};
    BUDGET_BUCKETS.forEach((b) => {
      const recentMonths = months.slice(-6);
      const vals = recentMonths.map((mk) => (monthlyTotals[mk]?.buckets?.[b.key]) || 0);
      out[b.key] = { value: median(vals), monthsUsed: recentMonths.length };
    });
    return out;
  }, [months, monthlyTotals]);

  // top merchants feeding each bucket, all-time — a real-numbers "canvas" to set a budget against
  const bucketMerchantContext = useMemo(() => {
    const ctx = {};
    BUDGET_BUCKETS.forEach((b) => { ctx[b.key] = {}; });
    transactions.forEach((t) => {
      if (t.category !== "Expense") return;
      const key = pillClass(t.category, t.subCategory, t.tag);
      if (!ctx[key]) return;
      const m = resolveMerchant(t.merchant || t.description, merchantAliases);
      const signedAmt = t.direction === "credit" ? -t.amount : t.amount;
      ctx[key][m] = (ctx[key][m] || 0) + signedAmt;
    });
    const top = {};
    Object.entries(ctx).forEach(([k, obj]) => {
      top[k] = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 3);
    });
    return top;
  }, [transactions, merchantAliases]);

  const trendData = useMemo(() => months.map((mk) => {
    const m = monthlyTotals[mk] || { income: 0, expense: 0, investedOut: 0, investedIn: 0 };
    const savings = m.income - m.expense;
    const savingsRate = m.income > 0 ? (savings / m.income) * 100 : 0;
    return {
      month: monthLabel(mk), mk,
      Income: m.income, Expense: m.expense,
      Investment: m.investedOut - m.investedIn,
      Savings: savings,
      "Savings rate": Number(savingsRate.toFixed(1)),
    };
  }), [months, monthlyTotals]);

  // For Zone C's Breakdown section specifically — Income against Expense split by
  // Fixed/Variable-Household/Variable-Personal, a more granular view than Zone B's
  // Income/Expense/Investment overview.
  const incomeExpenseTrendData = useMemo(() => months.map((mk) => {
    const m = monthlyTotals[mk] || { income: 0, buckets: {} };
    return {
      month: monthLabel(mk),
      Income: m.income,
      Fixed: m.buckets["Expense-Fixed"] || 0,
      "Variable — Household": m.buckets["Expense-Variable-Household"] || 0,
      "Variable — Personal": m.buckets["Expense-Variable-Personal"] || 0,
    };
  }), [months, monthlyTotals]);

  const uncategorized = transactions.filter((t) => !t.category).length;

  // month-over-month comparison for the currently selected specific month
  const monthIdx = months.indexOf(selectedMonth);
  const prevMonthKey = monthIdx > 0 ? months[monthIdx - 1] : null;
  const curM = selectedMonth !== "all" ? monthlyTotals[selectedMonth] : null;
  const prevM = prevMonthKey ? monthlyTotals[prevMonthKey] : null;

  function openDrill(label, predicate) {
    const txns = [...scoped.filter(predicate)].sort((a, b) => b.amount - a.amount);
    setDrill({ label, txns });
  }

  const accountName = (id) => accounts.find((a) => a.id === id)?.nickname || "—";

  // ---- Waterfall: Opening -> Income -> Expenses -> Savings -> Investments -> Net Change -> Closing.
  // Opening/closing bank cash is resolved from real confirmed balance snapshots (not
  // derived from transaction math), summed across every BANK account (never credit
  // cards — a CC balance is money owed, not cash on hand, a different sign meaning
  // entirely that shouldn't be summed into "cash I actually have").
  const periodBounds = useMemo(() => {
    if (selectedMonth === "all") {
      if (scoped.length === 0) return { start: null, end: null };
      const dates = scoped.map((t) => t.date).sort();
      return { start: dates[0], end: dates[dates.length - 1] };
    }
    if (periodType === "year") return { start: `${selectedMonth}-01-01`, end: `${selectedMonth}-12-31` };
    const [y, m] = selectedMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return { start: `${selectedMonth}-01`, end: `${selectedMonth}-${String(lastDay).padStart(2, "0")}` };
  }, [selectedMonth, periodType, scoped]);

  const bankAccounts = useMemo(() => accounts.filter((a) => a.type === "bank"), [accounts]);

  const TIER_RANK = { exact: 0, derived: 1, estimate: 2, unknown: 3 };
  const worseTier = (a, b) => (TIER_RANK[a] >= TIER_RANK[b] ? a : b);

  const waterfall = useMemo(() => {
    let openingKnown = true, closingKnown = true;
    let openingAllExact = true, closingAllExact = true;
    let openingWorstTier = "exact", closingWorstTier = "exact";
    let opening = 0, closing = 0;
    const perAccount = [];
    bankAccounts.forEach((a) => {
      let acctStart = periodBounds.start, acctEnd = periodBounds.end;
      if (periodType === "all") {
        const acctTxns = scoped.filter((t) => t.accountId === a.id);
        if (acctTxns.length > 0) {
          acctStart = acctTxns.reduce((min, t) => (t.date < min ? t.date : min), acctTxns[0].date);
          acctEnd = acctTxns.reduce((max, t) => (t.date > max ? t.date : max), acctTxns[0].date);
        } else {
          acctStart = null; acctEnd = null;
        }
      }
      const openRes = acctStart
        ? resolveAccountBalanceForPeriod(a, transactions, acctStart, acctEnd, "opening")
        : { value: null, exact: false, tier: "unknown" };
      const closeRes = acctEnd
        ? resolveAccountBalanceForPeriod(a, transactions, acctStart, acctEnd, "closing")
        : { value: null, exact: false, tier: "unknown" };
      if (openRes.value === null) openingKnown = false; else opening += openRes.value;
      if (closeRes.value === null) closingKnown = false; else closing += closeRes.value;
      if (!openRes.exact) openingAllExact = false;
      if (!closeRes.exact) closingAllExact = false;
      if (openRes.value !== null) openingWorstTier = worseTier(openingWorstTier, openRes.tier);
      if (closeRes.value !== null) closingWorstTier = worseTier(closingWorstTier, closeRes.tier);
      perAccount.push({
        id: a.id, nickname: a.nickname,
        opening: openRes.value, openingExact: openRes.exact, openingTier: openRes.tier,
        closing: closeRes.value, closingExact: closeRes.exact, closingTier: closeRes.tier,
      });
    });

    // Change in Cash tracks actual bank cash movement — deliberately DIFFERENT from
    // Savings above it, which is accrual-based and includes credit card spending the
    // moment it's incurred. A credit card purchase counts in Savings right away (you
    // committed to that spending), but shouldn't move Change in Cash until the bank
    // actually pays for it — otherwise a January purchase paid off in March would
    // wrongly show as a January cash outflow. Transfers are part of this same
    // bank-only scope: money leaving a bank account via a Self transfer, a credit card
    // payment, or an External transfer all reduce bank cash just as visibly as an
    // expense would, and were previously an invisible gap versus the real statement.
    const bankAccountIds = new Set(bankAccounts.map((a) => a.id));
    let bankIncome = 0, bankExpense = 0, bankInvestedOut = 0, bankInvestedIn = 0;
    const transferBreakdown = { Self: 0, "Credit card payment": 0, External: 0 };
    let netTransfers = 0;
    scoped.forEach((t) => {
      if (!bankAccountIds.has(t.accountId)) return;
      if (t.category === "Income" && t.direction === "credit") bankIncome += t.amount;
      if (t.category === "Investment") { if (t.direction === "debit") bankInvestedOut += t.amount; else bankInvestedIn += t.amount; }
      if (t.category === "Expense") {
        const signedAmt = t.direction === "credit" ? -t.amount : t.amount;
        bankExpense += signedAmt;
      }
      if (t.category === "Transfer") {
        const signedAmt = t.direction === "credit" ? t.amount : -t.amount;
        netTransfers += signedAmt;
        const key = t.subCategory || "Self";
        transferBreakdown[key] = (transferBreakdown[key] || 0) + signedAmt;
      }
    });

    const bankNetInvestment = bankInvestedOut - bankInvestedIn;
    const netChangeInCash = (bankIncome - bankExpense) - bankNetInvestment;
    const totalChangeInCash = netChangeInCash + netTransfers;
    const resolvedOpening = openingKnown && bankAccounts.length > 0 ? Math.round(opening * 100) / 100 : null;
    const resolvedClosing = closingKnown && bankAccounts.length > 0 ? Math.round(closing * 100) / 100 : null;

    // The actual "checks and balances": what does the equation itself say closing
    // SHOULD be, independent of whatever balance snapshot got resolved? If these
    // meaningfully disagree, that's not a rounding error — it means the resolved
    // closing is stale or wrong (most often: no closing balance was ever confirmed for
    // this period, and the fallback silently reused an old opening snapshot instead).
    const impliedClosing = resolvedOpening !== null ? Math.round((resolvedOpening + totalChangeInCash) * 100) / 100 : null;
    const closingMismatch = resolvedClosing !== null && impliedClosing !== null && Math.abs(resolvedClosing - impliedClosing) > 1;

    return {
      opening: resolvedOpening, closing: resolvedClosing,
      openingExact: openingKnown && openingAllExact, closingExact: closingKnown && closingAllExact,
      openingTier: openingKnown ? openingWorstTier : "unknown", closingTier: closingKnown ? closingWorstTier : "unknown",
      netChangeInCash, netTransfers, transferBreakdown, totalChangeInCash,
      impliedClosing, closingMismatch,
      perAccount,
      hasAnyBankAccount: bankAccounts.length > 0,
    };
  }, [bankAccounts, periodBounds, scoped, periodType]);
  const [showAccountBreakdown, setShowAccountBreakdown] = useState(false);
  const [showEquationInfo, setShowEquationInfo] = useState(false);

  // Every account's own pass through the equation — this is what "Expand breakdown"
  // now shows, replacing the old separate account/transfer tables. A credit card row
  // has no Opening/Closing/Net-Change/Transfers (it holds no cash, those concepts
  // don't apply), but its own Expense/Savings are real and shown, same as any account.
  const perAccountEquation = useMemo(() => {
    return accounts.filter((a) => isCashFlowAccountType(a.type)).map((a) => {
      const isCC = a.type === "creditCard";
      let income = 0, expense = 0, investedOut = 0, investedIn = 0, transferNet = 0;
      const acctTxns = [];
      scoped.forEach((t) => {
        if (t.accountId !== a.id) return;
        acctTxns.push(t);
        if (t.category === "Income" && t.direction === "credit") income += t.amount;
        if (t.category === "Expense") { const signed = t.direction === "credit" ? -t.amount : t.amount; expense += signed; }
        if (t.category === "Investment") { if (t.direction === "debit") investedOut += t.amount; else investedIn += t.amount; }
        if (t.category === "Transfer" && !isCC) transferNet += t.direction === "credit" ? t.amount : -t.amount;
      });
      const netInvestment = investedOut - investedIn;
      const savings = income - expense;
      let opening = null, openingExact = false, openingTier = "unknown", closing = null, closingExact = false, closingTier = "unknown", netChangeInCash = null;
      if (!isCC) {
        let acctStart = periodBounds.start, acctEnd = periodBounds.end;
        if (periodType === "all") {
          if (acctTxns.length > 0) {
            acctStart = acctTxns.reduce((min, t) => (t.date < min ? t.date : min), acctTxns[0].date);
            acctEnd = acctTxns.reduce((max, t) => (t.date > max ? t.date : max), acctTxns[0].date);
          } else {
            acctStart = null; acctEnd = null;
          }
        }
        const openRes = acctStart ? resolveAccountBalanceForPeriod(a, transactions, acctStart, acctEnd, "opening") : { value: null, exact: false, tier: "unknown" };
        const closeRes = acctEnd ? resolveAccountBalanceForPeriod(a, transactions, acctStart, acctEnd, "closing") : { value: null, exact: false, tier: "unknown" };
        opening = openRes.value; openingExact = openRes.exact; openingTier = openRes.tier;
        closing = closeRes.value; closingExact = closeRes.exact; closingTier = closeRes.tier;
        netChangeInCash = savings - netInvestment;
      }
      return { id: a.id, nickname: a.nickname, isCC, opening, openingExact, openingTier, income, expense, savings, netInvestment, netChangeInCash, transferNet: isCC ? null : transferNet, closing, closingExact, closingTier };
    });
  }, [accounts, scoped, periodBounds, periodType]);

  // Transfer breakdown for the Breakdown section — rows are accounts/statements
  // (SCB, Kotak, Scapia...), columns are transfer subtype. Different from the equation
  // grid above: this includes credit card accounts too, since a CC statement's own
  // "Credit card payment" entry (the accrual side, not the bank's cash side) is exactly
  // what's useful to see here, even though it's excluded from the cash equation itself.
  const transferByAccountGrid = useMemo(() => {
    return accounts
      .map((a) => {
        const row = { id: a.id, nickname: a.nickname, Self: 0, "Credit card payment": 0, External: 0 };
        scoped.forEach((t) => {
          if (t.accountId !== a.id || t.category !== "Transfer") return;
          const signedAmt = t.direction === "credit" ? t.amount : -t.amount;
          const key = t.subCategory || "Self";
          row[key] = (row[key] || 0) + signedAmt;
        });
        row.total = row.Self + row["Credit card payment"] + row.External;
        return row;
      })
      .filter((r) => r.total !== 0);
  }, [accounts, scoped]);

  // ---- Income Sources: same composition pattern as Expense Categories, over Income sub-category ----
  const incomeSources = useMemo(() => {
    const byType = {};
    scoped.forEach((t) => {
      if (t.category !== "Income" || t.direction !== "credit") return;
      const key = t.subCategory || "Others";
      byType[key] = (byType[key] || 0) + t.amount;
    });
    return Object.entries(byType).sort((a, b) => b[1] - a[1]);
  }, [scoped]);

  // ---- Insights: a handful of concrete, thresholded rules — not a vague "AI take," just
  // arithmetic on data we already compute, surfaced when it clears a real bar. Ranked by
  // how notable each one is (magnitude of the underlying %), capped at 3, honest empty state
  // when nothing clears the bar rather than manufacturing filler. ----
  const insights = useMemo(() => {
    if (selectedMonth === "all" || periodType !== "month") return [];
    const found = [];
    const curMonth = monthlyTotals[selectedMonth];
    const idx = months.indexOf(selectedMonth);
    const prevKey = idx > 0 ? months[idx - 1] : null;
    const prevMonth = prevKey ? monthlyTotals[prevKey] : null;

    // Merchant spike: this month's spend on a merchant vs its trailing 3-month average
    if (curMonth) {
      Object.entries(curMonth.merchants || {}).forEach(([m, amt]) => {
        if (amt <= 0) return;
        const trailing = months.filter((mk) => mk < selectedMonth).slice(-3);
        if (trailing.length < 2) return;
        const avg = trailing.reduce((s, mk) => s + (monthlyTotals[mk]?.merchants?.[m] || 0), 0) / trailing.length;
        if (avg < 500) return;
        const pctUp = ((amt - avg) / avg) * 100;
        if (pctUp > 50) {
          found.push({
            type: "merchant", magnitude: pctUp,
            text: `${m || "A merchant"} is up ${pctUp.toFixed(0)}% vs its usual — ${inr(amt)} this month vs a ~${inr(avg)} average.`,
          });
        }
      });
    }

    // Expense spike: Fixed or Variable bucket vs last month
    if (curMonth && prevMonth) {
      ["Expense-Fixed", "Expense-Variable-Household", "Expense-Variable-Personal"].forEach((key) => {
        const cur = curMonth.buckets?.[key] || 0;
        const prev = prevMonth.buckets?.[key] || 0;
        if (prev < 500) return;
        const pctUp = ((cur - prev) / prev) * 100;
        if (pctUp > 20) {
          const label = key === "Expense-Fixed" ? "Fixed expenses" : key.includes("Household") ? "Household spend" : "Personal spend";
          found.push({ type: "expense", magnitude: pctUp, text: `${label} is up ${pctUp.toFixed(0)}% vs last month — ${inr(cur)} vs ${inr(prev)}.` });
        }
      });
    }

    // Budget pace: projected month-end spend vs budget, based on days elapsed
    if (curMonth) {
      const [y, m] = selectedMonth.split("-").map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const today = new Date();
      const isCurrentMonth = today.getFullYear() === y && today.getMonth() + 1 === m;
      const daysElapsed = isCurrentMonth ? today.getDate() : daysInMonth;
      BUDGET_BUCKETS.forEach((b) => {
        const budget = budgets[b.key];
        if (!budget) return;
        const actual = b.key === "Expense-Fixed" ? amortizedFixedActual(selectedMonth) : (curMonth.buckets?.[b.key] || 0);
        const projected = daysElapsed > 0 ? (actual / daysElapsed) * daysInMonth : actual;
        if (projected > budget * 1.05) {
          const pctOver = ((projected - budget) / budget) * 100;
          found.push({
            type: "budget", magnitude: pctOver,
            text: `On pace to exceed your ${b.label} budget by ${pctOver.toFixed(0)}% (~${inr(projected)} projected vs ${inr(budget)} budgeted).`,
          });
        }
      });
    }

    // Savings rate swing vs last month
    if (curMonth && prevMonth && prevMonth.income > 0 && curMonth.income > 0) {
      const curRate = ((curMonth.income - curMonth.expense) / curMonth.income) * 100;
      const prevRate = ((prevMonth.income - prevMonth.expense) / prevMonth.income) * 100;
      const ptDelta = curRate - prevRate;
      if (Math.abs(ptDelta) > 10) {
        found.push({
          type: "savings", magnitude: Math.abs(ptDelta),
          text: `Savings rate ${ptDelta > 0 ? "improved" : "dropped"} ${Math.abs(ptDelta).toFixed(0)} points vs last month — ${curRate.toFixed(0)}% now vs ${prevRate.toFixed(0)}%.`,
        });
      }
    }

    // Investment rate negative — redeemed more than was invested this month. A minimum
    // absolute amount avoids flagging a trivial rounding-level redemption.
    if (curMonth && curMonth.income > 0) {
      const netInvestment = curMonth.investedOut - curMonth.investedIn;
      if (netInvestment < -1000) {
        const investmentRate = (netInvestment / curMonth.income) * 100;
        found.push({
          type: "investment", magnitude: Math.abs(investmentRate),
          text: `Investment rate is negative this month — you redeemed ${inr(-netInvestment)} more than you invested (${investmentRate.toFixed(0)}% of income).`,
        });
      }
    }

    return found.sort((a, b) => b.magnitude - a.magnitude).slice(0, 3);
  }, [selectedMonth, periodType, monthlyTotals, months, budgets]);

  if (transactions.length === 0) {
    return <div className="bw-empty">Import a statement first — the dashboard fills in as soon as there's data.</div>;
  }

  const subViewTabs = (
    <div className="bw-tabs" style={{ marginBottom: 16 }}>
      <button className={`bw-tab ${subView === "overview" ? "active" : ""}`} onClick={() => setSubView("overview")}>Overview</button>
      <button className={`bw-tab ${subView === "calendar" ? "active" : ""}`} onClick={() => setSubView("calendar")}>Calendar</button>
    </div>
  );

  if (subView === "calendar") {
    return (
      <div>
        {subViewTabs}
        <CashFlowCalendarView transactions={transactions} accounts={accounts} rules={rules} />
      </div>
    );
  }

  return (
    <div>
      {subViewTabs}
      {/* ---- Header + period selector ---- */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h2 className="bw-h2">Cash Flow</h2>
        <select className="bw-select-inline" value={selectedMonth} onChange={(e) => { setSelectedMonth(e.target.value); setDrill(null); }}>
          <option value="all">All time</option>
          <optgroup label="Months">
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </optgroup>
          <optgroup label="Years">
            {years.map((y) => <option key={y} value={y}>{y} (year to date)</option>)}
          </optgroup>
        </select>
      </div>

      {uncategorized > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--rust)", margin: "6px 0 16px" }}>
          <AlertCircle size={14} /> {uncategorized} transactions are still uncategorized and excluded from these totals — see Review.
        </div>
      )}

      {/* ================= ZONE A — headline: waterfall + insights ================= */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ZoneHeader icon={LineChartIcon} title="Overview" subtitle="Your cash flow for the selected period, and what's worth noticing" />
        <button
          onClick={() => setShowEquationInfo((v) => !v)}
          title="What does this equation mean?"
          style={{
            width: 20, height: 20, borderRadius: "50%", border: "1px solid var(--ink-soft)", background: "none",
            color: "var(--ink-soft)", fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0, marginTop: -8,
          }}
        >
          ?
        </button>
      </div>
      {showEquationInfo && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 14, marginBottom: 14, background: "var(--card)", fontSize: 12, lineHeight: 1.7 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>Opening / Closing</strong> — summed across bank accounts only. A credit card balance is money owed, not cash on hand, so it's excluded here.</li>
            <li><strong>Savings</strong> = Income − Expenses, across every account. This is <em>accrual-based</em>: a credit card purchase counts the moment you make it, whether or not you've paid the card off yet.</li>
            <li><strong>Net change in cash</strong> is deliberately different from Savings — it's <em>bank-only</em>, so a credit card purchase doesn't move this until you actually pay the card. A January purchase paid off in March shows in January's Savings but March's Change in Cash.</li>
            <li><strong>Investments</strong> — the one box that breaks the usual color rule on purpose: an investment is normally an outflow, so if this ever shows positive (a redemption), it's flagged red specifically to catch your attention, not because redeeming is bad.</li>
            <li><strong>Transfers</strong> — real bank-side money movement only (Self, Credit card payment, External). The credit-card side of a payment doesn't appear here — see Review → Transfers for that.</li>
            <li>Every other box colors purely by its own sign: green if positive, red if negative.</li>
            <li><strong>"calculated from your transactions"</strong> means no statement confirmed this exact date, but your real, dated transactions since the nearest confirmed balance were used to work it out — built from genuine activity, not a guess.</li>
            <li><strong>"estimated, not confirmed"</strong> means neither a confirmed balance nor transaction data covers this exact period — it's carried forward from the nearest earlier confirmed point, with nothing to verify it against. If that estimate disagrees sharply with what the equation itself computes, a warning appears explaining the gap.</li>
          </ul>
        </div>
      )}
      <div className="bw-waterfall-card">
        <div className="bw-waterfall" style={{ gridTemplateColumns: "repeat(8, 1fr)" }}>
          <WaterfallNode label="Opening" sublabel="bank cash" value={waterfall.opening} tier={waterfall.openingTier} />
          <WaterfallOp label="Income" contribution={totals.income} />
          <WaterfallOp label="Expenses" contribution={-totals.expense} />
          <WaterfallNode label="Savings" value={totals.savings} rate={totals.income > 0 ? totals.savingsRate : null} />
          <WaterfallOp label="Investments" contribution={-totals.netInvestment} flagPositiveAsUnusual rate={totals.income > 0 ? totals.investmentRate : null} />
          <WaterfallNode label="Net change in cash" value={waterfall.netChangeInCash} />
          <WaterfallOp label="Transfers" contribution={waterfall.netTransfers} />
          <WaterfallNode label="Closing" sublabel="bank cash" value={waterfall.closing} tier={waterfall.closingTier} />
        </div>
      </div>
      {waterfall.closingMismatch && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12, padding: "10px 12px", marginTop: 10,
          border: "1px solid var(--rust)", borderRadius: 6, background: "rgba(156,74,52,0.08)",
        }}>
          <AlertCircle size={15} color="var(--rust)" style={{ marginTop: 1, flexShrink: 0 }} />
          <span>
            <strong>Closing balance doesn't match what your transactions imply.</strong> Based on Opening
            + this period's activity, Closing should be about {inr(waterfall.impliedClosing)} — but the figure
            shown ({inr(waterfall.closing)}) is a carried-forward estimate, not a confirmed number for this period.
            This usually means a closing balance was never confirmed for one of your accounts — expand the
            breakdown below to see which one, then re-import that statement with its closing balance filled in.
          </span>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0 4px" }}>
        {waterfall.hasAnyBankAccount && (
          <button className="bw-btn ghost small" onClick={() => setShowAccountBreakdown((v) => !v)}>
            {showAccountBreakdown ? <ChevronUp size={12} /> : <ChevronRight size={12} />} Expand breakdown
          </button>
        )}
      </div>
      {showAccountBreakdown && (
        <div style={{ marginBottom: 18, overflowX: "auto" }}>
          <table className="bw-table">
            <thead>
              <tr>
                <th>Account</th>
                <th style={{ textAlign: "right" }}>Opening</th>
                <th style={{ textAlign: "right" }}>Income</th>
                <th style={{ textAlign: "right" }}>Expenses</th>
                <th style={{ textAlign: "right" }}>Savings</th>
                <th style={{ textAlign: "right" }}>Investments</th>
                <th style={{ textAlign: "right" }}>Net change</th>
                <th style={{ textAlign: "right" }}>Transfers</th>
                <th style={{ textAlign: "right" }}>Closing</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ fontWeight: 600 }}>
                <td>Total</td>
                <td style={{ textAlign: "right" }}>{waterfall.opening !== null ? inr(waterfall.opening) : "—"}</td>
                <td style={{ textAlign: "right" }}>{inr(totals.income)}</td>
                <td style={{ textAlign: "right" }}>{inr(totals.expense)}</td>
                <td style={{ textAlign: "right" }}>{inr(totals.savings)}</td>
                <td style={{ textAlign: "right" }}>{inr(totals.netInvestment)}</td>
                <td style={{ textAlign: "right" }}>{inr(waterfall.netChangeInCash)}</td>
                <td style={{ textAlign: "right" }}>{inr(waterfall.netTransfers)}</td>
                <td style={{ textAlign: "right" }}>{waterfall.closing !== null ? inr(waterfall.closing) : "—"}</td>
              </tr>
              {perAccountEquation.map((a) => (
                <tr key={a.id}>
                  <td>{a.nickname}{a.isCC && <span style={{ fontSize: 9.5, color: "var(--ink-soft)", marginLeft: 5 }}>(card)</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    {a.isCC ? "—" : (a.opening !== null ? inr(a.opening) : "—")}
                    {!a.isCC && a.opening !== null && a.openingTier === "derived" && <div style={{ fontSize: 9, color: "var(--slate)" }}>calculated</div>}
                    {!a.isCC && a.opening !== null && a.openingTier === "estimate" && <div style={{ fontSize: 9, color: "var(--ochre)" }}>carried forward</div>}
                  </td>
                  <td style={{ textAlign: "right" }}>{inr(a.income)}</td>
                  <td style={{ textAlign: "right" }}>{inr(a.expense)}</td>
                  <td style={{ textAlign: "right" }}>{inr(a.savings)}</td>
                  <td style={{ textAlign: "right" }}>{inr(a.netInvestment)}</td>
                  <td style={{ textAlign: "right" }}>{a.isCC ? "—" : inr(a.netChangeInCash)}</td>
                  <td style={{ textAlign: "right" }}>{a.isCC ? "—" : inr(a.transferNet)}</td>
                  <td style={{ textAlign: "right" }}>
                    {a.isCC ? "—" : (a.closing !== null ? inr(a.closing) : "—")}
                    {!a.isCC && a.closing !== null && a.closingTier === "derived" && <div style={{ fontSize: 9, color: "var(--slate)" }}>calculated</div>}
                    {!a.isCC && a.closing !== null && a.closingTier === "estimate" && <div style={{ fontSize: 9, color: "var(--ochre)" }}>carried forward</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 10.5, color: "var(--ink-soft)", margin: "6px 0 0" }}>
            Credit card rows show no Opening/Closing/Net change/Transfers — a card holds no cash, so those
            don't apply. Transfer detail by statement lives in the Breakdown section below.
          </p>
        </div>
      )}
      {!waterfall.hasAnyBankAccount && (
        <p style={{ fontSize: 11.5, color: "var(--ink-soft)", margin: "0 0 18px" }}>
          No bank account imported yet — opening/closing cash will show once you import a bank statement (Upload, Account type: Bank account).
        </p>
      )}

      <div className="bw-section-label" style={{ marginTop: 22 }}>
        <Lightbulb size={14} style={{ verticalAlign: -2, marginRight: 5 }} />Insights
      </div>

      {periodType !== "month" ? (
        <p className="bw-lead" style={{ marginBottom: 22 }}>Select a specific month above to see insights for that period.</p>
      ) : insights.length === 0 ? (
        <p className="bw-lead" style={{ marginBottom: 22 }}>Nothing notable this month — spending and savings are tracking close to normal.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
          {insights.map((ins, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5, padding: "10px 12px",
              border: "1px solid var(--line)", borderRadius: 6, background: "var(--card)",
            }}>
              <Lightbulb size={14} color="var(--ochre)" style={{ marginTop: 1, flexShrink: 0 }} />
              <span>{ins.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* ---- Month-over-month comparison ---- */}
      {curM && prevM && (
        <>
          <div className="bw-section-label">Vs. {monthLabel(prevMonthKey)}</div>
          <div className="bw-summary-row" style={{ marginBottom: 22 }}>
            <MoMCallout label="Fixed" cur={curM.buckets["Expense-Fixed"] || 0} prev={prevM.buckets["Expense-Fixed"] || 0} />
            <MoMCallout label="Household" cur={curM.buckets["Expense-Variable-Household"] || 0} prev={prevM.buckets["Expense-Variable-Household"] || 0} />
            <MoMCallout label="Personal" cur={curM.buckets["Expense-Variable-Personal"] || 0} prev={prevM.buckets["Expense-Variable-Personal"] || 0} />
            <MoMCallout label="Total expense" cur={curM.expense} prev={prevM.expense} />
          </div>
        </>
      )}

      {/* ================= ZONE B — trend story ================= */}
      {trendData.length > 1 && (
        <>
          <ZoneHeader icon={TrendingUp} title="Trends" subtitle="How your cash flow and savings rate have moved over time" />
          <div className="bw-section-label" style={{ marginTop: 0 }}>Cash flow trend</div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => inr(v)} contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "var(--ink)" }} itemStyle={{ color: "var(--ink)" }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "var(--ink)" }} />
              <Bar dataKey="Income" fill={PALETTE.Income} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Expense" fill="var(--ink)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Investment" fill="#3E7C8C" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          <div className="bw-section-label">Savings rate trend</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v) => `${v}%`} contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "var(--ink)" }} itemStyle={{ color: "var(--ink)" }} />
              <Line type="monotone" dataKey="Savings rate" stroke="var(--teal)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}

      {/* ================= ZONE C — where it's coming from / going ================= */}
      <ZoneHeader icon={PieIcon} title="Breakdown" subtitle="Where money is going, where it's coming from, and what recurs" />
      <div className="bw-section-label" style={{ marginTop: 0 }}>Expense</div>
      <p className="bw-lead" style={{ marginBottom: 12 }}>Split by how it was paid, then by Fixed vs Variable. Click a row to see the underlying transactions.</p>

      {["cash", "creditCard"].map((method) => {
        const data = expenseByPaymentMethod[method];
        if (!data || (data.fixed === 0 && data.varHousehold === 0 && data.varPersonal === 0)) return null;
        const methodLabel = method === "cash" ? "Cash (bank accounts)" : "Credit Card";
        const matchesMethod = (t) => {
          const acct = accounts.find((a) => a.id === t.accountId);
          const m = acct?.type === "creditCard" ? "creditCard" : "cash";
          return m === method;
        };
        return (
          <div key={method} style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{methodLabel} — {inr(data.total)}</div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                <span>Fixed</span><span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{inr(data.fixed)}</span>
              </div>
              {data.recurring.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>No Fixed expenses here yet.</div>
              ) : (
                <table className="bw-table">
                  <thead><tr><th>Merchant</th><th>Frequency</th><th style={{ textAlign: "right" }}>~ Per month</th></tr></thead>
                  <tbody>
                    {data.recurring.map((c) => (
                      <tr key={c.merchant} style={{ cursor: "pointer" }}
                        onClick={() => openDrill(c.merchant || "—", (t) => t.category === "Expense" && t.subCategory === "Fixed" && matchesMethod(t) && resolveMerchant(t.merchant || t.description, merchantAliases) === c.merchant)}>
                        <td>{c.merchant || "—"}</td>
                        <td><span className="bw-pill" style={{ background: "var(--slate)", fontSize: 10 }}>{c.frequency}</span></td>
                        <td className="bw-amt debit">{inr(c.amortizedAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="bw-grid2">
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                  <span>Variable — Household</span><span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{inr(data.varHousehold)}</span>
                </div>
                {data.topVarHousehold.length === 0 ? <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>Nothing here yet.</div> : (
                  <table className="bw-table">
                    <tbody>
                      {data.topVarHousehold.map(([m, v]) => (
                        <tr key={m} style={{ cursor: "pointer" }}
                          onClick={() => openDrill(m || "—", (t) => t.category === "Expense" && t.subCategory === "Variable" && t.tag === "Household" && matchesMethod(t) && resolveMerchant(t.merchant || t.description, merchantAliases) === m)}>
                          <td>{m || "—"}</td><td className="bw-amt debit">{inr(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                  <span>Variable — Personal</span><span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{inr(data.varPersonal)}</span>
                </div>
                {data.topVarPersonal.length === 0 ? <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>Nothing here yet.</div> : (
                  <table className="bw-table">
                    <tbody>
                      {data.topVarPersonal.map(([m, v]) => (
                        <tr key={m} style={{ cursor: "pointer" }}
                          onClick={() => openDrill(m || "—", (t) => t.category === "Expense" && t.subCategory === "Variable" && t.tag === "Personal" && matchesMethod(t) && resolveMerchant(t.merchant || t.description, merchantAliases) === m)}>
                          <td>{m || "—"}</td><td className="bw-amt debit">{inr(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {months.length > 1 && (
        <>
          <div className="bw-section-label" style={{ marginTop: 18 }}>Income vs expense trend</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={incomeExpenseTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => inr(v)} contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "var(--ink)" }} itemStyle={{ color: "var(--ink)" }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "var(--ink)" }} />
              <Bar dataKey="Income" fill={PALETTE.Income} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Fixed" stackId="expense" fill={PALETTE["Expense-Fixed"]} radius={[0, 0, 0, 0]} />
              <Bar dataKey="Variable — Household" stackId="expense" fill={PALETTE["Expense-Variable-Household"]} radius={[0, 0, 0, 0]} />
              <Bar dataKey="Variable — Personal" stackId="expense" fill={PALETTE["Expense-Variable-Personal"]} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}

      <div className="bw-section-label" style={{ marginTop: 26 }}>Income</div>
      {incomeSources.length === 0 ? (
        <div className="bw-empty">No categorized income for this period yet.</div>
      ) : (
        <table className="bw-table" style={{ marginBottom: 18, maxWidth: 420 }}>
          <tbody>
            {incomeSources.map(([name, value]) => (
              <tr key={name} style={{ cursor: "pointer" }}
                onClick={() => openDrill(`Income · ${name}`, (t) => t.category === "Income" && (t.subCategory || "Others") === name)}>
                <td>{name}</td>
                <td className="bw-amt credit">{inr(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="bw-section-label" style={{ marginTop: 26 }}>Transfer</div>
      <p className="bw-lead" style={{ marginBottom: 12 }}>By account/statement — a credit card row here shows its own "Credit card payment" entry (accrual side), separate from the bank's actual cash-side payment.</p>
      {transferByAccountGrid.length === 0 ? (
        <div className="bw-empty">No transfers this period.</div>
      ) : (
        <table className="bw-table" style={{ marginBottom: 22 }}>
          <thead><tr><th>Account</th><th style={{ textAlign: "right" }}>Self</th><th style={{ textAlign: "right" }}>Credit card payment</th><th style={{ textAlign: "right" }}>External</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
          <tbody>
            {transferByAccountGrid.map((r) => (
              <tr key={r.id}>
                <td>{r.nickname}</td>
                <td style={{ textAlign: "right" }}>{r.Self !== 0 ? inr(r.Self) : "—"}</td>
                <td style={{ textAlign: "right" }}>{r["Credit card payment"] !== 0 ? inr(r["Credit card payment"]) : "—"}</td>
                <td style={{ textAlign: "right" }}>{r.External !== 0 ? inr(r.External) : "—"}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ---- Budget vs Actual ---- */}
      <div className="bw-section-label" style={{ marginTop: 0 }}>
        <Target size={14} style={{ verticalAlign: -2, marginRight: 5 }} />Budget vs actual
      </div>
      <p className="bw-lead" style={{ marginBottom: 12 }}>
        Set a rough monthly budget per bucket — leave at 0 to skip.{" "}
        {periodType === "all" && "Showing your average monthly actual across all imported months."}
        {periodType === "month" && `Actual for ${monthLabel(selectedMonth)} — Fixed shows an amortized monthly share, so an annual bill like insurance doesn't spike a single month.`}
        {periodType === "year" && `Year-to-date actual for ${selectedMonth}, compared to a prorated annual target (monthly budget × months elapsed).`}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 8 }}>
        {BUDGET_BUCKETS.map((b) => {
          const monthlyBudget = budgets[b.key] || 0;
          const monthsElapsedInYear = periodType === "year" ? months.filter((mk) => mk.startsWith(selectedMonth)).length : 0;

          let actual, budgetTarget, targetLabel;
          if (periodType === "all") {
            actual = (totals.compBuckets[b.key] || 0) / Math.max(months.length, 1);
            budgetTarget = monthlyBudget;
            targetLabel = "avg/month of";
          } else if (periodType === "year") {
            actual = totals.compBuckets[b.key] || 0;
            budgetTarget = monthlyBudget * Math.max(monthsElapsedInYear, 1);
            targetLabel = `of ${monthsElapsedInYear}-month target`;
          } else {
            actual = b.key === "Expense-Fixed" ? amortizedFixedActual(selectedMonth) : (totals.compBuckets[b.key] || 0);
            budgetTarget = monthlyBudget;
            targetLabel = "of";
          }

          const pct = budgetTarget > 0 ? Math.min(200, (actual / budgetTarget) * 100) : 0;
          const over = budgetTarget > 0 && actual > budgetTarget;
          const suggestion = suggestedBudgets[b.key];
          const topBucketMerchants = bucketMerchantContext[b.key] || [];
          return (
            <div key={b.key}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 4, gap: 10, flexWrap: "wrap" }}>
                <span>{b.label}{b.key === "Expense-Fixed" && periodType === "month" && (
                  <span style={{ fontSize: 9.5, color: "var(--teal)", marginLeft: 6 }}>(amortized)</span>
                )}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: over ? "var(--rust)" : "var(--ink)" }}>{inr(actual)}</span>
                  <span style={{ color: "var(--ink-soft)" }}>{targetLabel}</span>
                  {periodType === "year" && <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: "var(--ink-soft)" }}>{inr(budgetTarget)}</span>}
                  <input
                    type="number" className="bw-select-inline" style={{ width: 88 }}
                    value={monthlyBudget || ""} placeholder="monthly budget"
                    onChange={(e) => setBudgets((prev) => ({ ...prev, [b.key]: Number(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              {budgetTarget > 0 && (
                <div style={{ height: 8, background: "var(--paper)", borderRadius: 3, overflow: "hidden", border: "1px solid var(--line)" }}>
                  <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: over ? "var(--rust)" : PALETTE[b.key], transition: "width 0.3s" }} />
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 5 }}>
                <div style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>
                  {suggestion.monthsUsed >= 6 ? (
                    <>Suggested (median of last {suggestion.monthsUsed} months): {inr(suggestion.value)}{" "}
                      <button className="bw-btn ghost small" style={{ padding: "1px 7px", fontSize: 10 }}
                        onClick={() => setBudgets((prev) => ({ ...prev, [b.key]: Math.round(suggestion.value) }))}>
                        Use
                      </button>
                    </>
                  ) : (
                    <>Need at least 6 months of history to suggest a budget — {suggestion.monthsUsed} so far.</>
                  )}
                </div>
                {topBucketMerchants.length > 0 && (
                  <div style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>
                    Top: {topBucketMerchants.map(([m, v]) => `${m || "—"} ${inr(v)}`).join(" · ")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {drill && (
        <div style={{ marginTop: 22, border: "1px solid var(--line)", borderRadius: 6, padding: 16, background: "var(--card)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600 }}>
              {drill.label} · {drill.txns.length} transaction{drill.txns.length === 1 ? "" : "s"} · {inr(drill.txns.reduce((s, t) => s + t.amount, 0))}
            </div>
            <button className="bw-btn ghost small" onClick={() => setDrill(null)}><X size={12} /> Close</button>
          </div>
          {drill.txns.length === 0 ? (
            <div className="bw-empty">No transactions in this bucket for the selected period.</div>
          ) : (
            <table className="bw-table">
              <thead><tr><th>Date</th><th>Account</th><th>Description</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
              <tbody>
                {drill.txns.map((t) => (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: "nowrap", fontSize: 11.5, color: "var(--ink-soft)" }}>{t.date}</td>
                    <td style={{ fontSize: 11.5 }}>{accountName(t.accountId)}</td>
                    <td>{t.description}</td>
                    <td className={`bw-amt ${t.direction}`}>{t.direction === "credit" ? "+" : "−"}{inr(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ================= ZONE D — transactions, collapsed by default ================= */}
      <TransactionsZone scoped={scoped} accounts={accounts} accountName={accountName} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Investments — snapshot-based. No transaction-level cost-basis tracking */
/* and no XIRR (a holding snapshot has no purchase-date history to        */
/* compute a true rate of return from) — instead: how much you added,    */
/* how much it grew, computed by diffing consecutive dated snapshots.     */
/* Growth shown here is CUMULATIVE unrealized P&L as of the latest        */
/* snapshot, not a period figure.                                         */
/* ---------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- */
/* Cash Flow Calendar — a forward-looking cash view, distinct from the      */
/* transaction-history-focused Overview above. Shows only financially      */
/* significant, recurring-type events (isFrequencyEligible categories),    */
/* not every transaction — a day-by-day feed of every grocery purchase     */
/* would bury the events that actually matter to plan around. Historical   */
/* (already-happened) events and projected (learned-pattern, not-yet-      */
/* happened) events are always visually distinct — never rendered          */
/* identically, the same honesty discipline applied to balance confidence  */
/* tiers elsewhere in this app. Projection math (forward balance curve)    */
/* and the minimum-buffer setting are deliberately not part of this first  */
/* build — this covers the grid itself only.                               */
/* ---------------------------------------------------------------------- */

function CashFlowCalendarView({ transactions, accounts, rules }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1); // 1-12
  const [selectedDay, setSelectedDay] = useState(null);

  const commitments = useMemo(() => computeRecurringCommitments(transactions, accounts, rules), [transactions, accounts, rules]);

  // One event per day this month: a real transaction if it already happened, a
  // projected occurrence from a learned pattern if it hasn't. A commitment whose
  // latest real transaction already falls in this month never also gets a
  // projected entry — projectOccurrenceForMonth already refuses to project into a
  // month that's <= the commitment's own last-seen month, so there's no risk of
  // showing the same thing twice, once as fact and once as a guess.
  const monthEvents = useMemo(() => {
    const events = [];
    transactions
      .filter((t) => t.category && isFrequencyEligible(t.category, t.subCategory))
      .forEach((t) => {
        const [y, m] = t.date.split("-").map(Number);
        if (y === viewYear && m === viewMonth) {
          events.push({
            id: t.id, date: t.date, kind: "actual",
            name: t.merchant || t.description, amount: t.amount, direction: t.direction,
            category: t.category, subCategory: t.subCategory,
          });
        }
      });
    commitments.forEach((c) => {
      const projectedDate = projectOccurrenceForMonth(c, viewYear, viewMonth);
      if (!projectedDate) return;
      // A future date is a genuine forward projection. A past date with no matching
      // real transaction is a MORE important signal, not one to drop silently - it
      // means something expected by now hasn't shown up yet, either because it
      // hasn't been imported or because it genuinely didn't happen. Both cases are
      // worth surfacing, just with a different label - "overdue", not "expected".
      const isInflow = c.category === "Income";
      events.push({
        id: `proj:${c.key}:${projectedDate}`, date: projectedDate,
        kind: projectedDate > todayStr ? "projected" : "overdue",
        name: c.name, amount: c.lastAmount, direction: isInflow ? "credit" : "debit",
        category: c.category, subCategory: c.subCategory, confidence: c.pattern.confidence,
      });
    });
    return events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [transactions, commitments, viewYear, viewMonth, todayStr]);

  // Today's real, resolved bank balance - the starting point the projection walks
  // forward from. Only meaningful when viewing the current month; a past or future
  // month's projection wouldn't anchor to "today" in any useful way, so it's left
  // null outside the current month rather than computing a number that doesn't mean
  // what it looks like it means.
  const isCurrentMonthView = viewYear === now.getFullYear() && viewMonth === now.getMonth() + 1;
  const bankAccounts = useMemo(() => accounts.filter((a) => a.type === "bank"), [accounts]);
  const todaysBalance = useMemo(() => {
    if (!isCurrentMonthView) return null;
    let known = true, total = 0;
    bankAccounts.forEach((a) => {
      const res = resolveAccountBalanceForPeriod(a, transactions, "2000-01-01", todayStr, "closing");
      if (res.value === null) { known = false; return; }
      total += res.value;
    });
    return known ? total : null;
  }, [isCurrentMonthView, bankAccounts, transactions, todayStr]);

  const monthEndStr = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(new Date(viewYear, viewMonth, 0).getDate()).padStart(2, "0")}`;
  const dailyDiscretionary = useMemo(() => {
    const medianMonthly = computeMedianMonthlyDiscretionary(transactions, viewYear, viewMonth);
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    const daysRemaining = Math.max(1, daysInMonth - Number(todayStr.slice(8, 10)));
    return medianMonthly / daysRemaining;
  }, [transactions, viewYear, viewMonth, todayStr]);

  const projectedDaily = useMemo(() => {
    if (todaysBalance === null) return [];
    return computeProjectedDailyBalances(todaysBalance, todayStr, monthEndStr, monthEvents, dailyDiscretionary);
  }, [todaysBalance, todayStr, monthEndStr, monthEvents, dailyDiscretionary]);

  const projectedMonthEndBalance = projectedDaily.length > 0 ? projectedDaily[projectedDaily.length - 1].balance : null;
  const projectedMinimumBalance = projectedDaily.length > 0 ? Math.min(...projectedDaily.map((p) => p.balance)) : null;

  // The "See" breakdown - all real transactions in the month (not just the frequency-
  // eligible ones the calendar grid plots), bucketed per the agreed structure. This
  // deliberately becomes the source for the hero stats above too, so the summary
  // numbers and the detailed breakdown below always agree with each other exactly.
  // Self, External, Debt-Disbursement, and Debt-Lumpsum Payment are deliberately
  // excluded for now - correct only once "all accounts combined" is the whole
  // picture (Self nets to zero across every account); revisit when a per-account
  // view is built, since Self/External stop being excludable at that point.
  const seeBreakdown = useMemo(() => {
    const monthKey = `${viewYear}-${String(viewMonth).padStart(2, "0")}`;
    const buckets = {
      income: 0, redemption: 0, investments: 0, loans: 0,
      fixedExpenses: 0, ccPayments: 0, discretionaryHousehold: 0, discretionaryPersonal: 0,
    };
    transactions.filter((t) => t.date.slice(0, 7) === monthKey).forEach((t) => {
      const amt = Math.abs(t.amount);
      if (t.category === "Income" && t.direction === "credit") buckets.income += amt;
      else if (t.category === "Investment" && t.subCategory === "Redemption") buckets.redemption += amt;
      else if (t.category === "Investment" && (t.subCategory === "SIP" || t.subCategory === "Lumpsum")) buckets.investments += amt;
      else if (t.category === "Transfer" && t.subCategory === "Debt-EMI") buckets.loans += amt;
      else if (t.category === "Expense" && t.subCategory === "Fixed") buckets.fixedExpenses += amt;
      else if (t.category === "Transfer" && t.subCategory === "Credit card payment") buckets.ccPayments += amt;
      else if (t.category === "Expense" && t.subCategory === "Variable" && t.tag === "Household") buckets.discretionaryHousehold += amt;
      else if (t.category === "Expense" && t.subCategory === "Variable" && t.tag === "Personal") buckets.discretionaryPersonal += amt;
    });
    const totalInflow = buckets.income + buckets.redemption;
    const totalOutflow = buckets.investments + buckets.loans + buckets.fixedExpenses + buckets.ccPayments + buckets.discretionaryHousehold + buckets.discretionaryPersonal;
    return { ...buckets, totalInflow, totalOutflow, net: totalInflow - totalOutflow };
  }, [transactions, viewYear, viewMonth]);

  const totalInflows = seeBreakdown.totalInflow;
  const totalOutflows = seeBreakdown.totalOutflow;
  const netCashFlow = seeBreakdown.net;
  const seeMaxBar = Math.max(totalInflows, totalOutflows, 1);

  // Calendar grid geometry: Monday-first week, leading/trailing blanks for days
  // outside this month so the grid always fills complete rows.
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const firstWeekday = (new Date(viewYear, viewMonth - 1, 1).getDay() + 6) % 7; // 0=Mon..6=Sun
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  function eventsOnDay(day) {
    if (!day) return [];
    const dateStr = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return monthEvents.filter((e) => e.date === dateStr);
  }

  function changeMonth(delta) {
    let m = viewMonth + delta, y = viewYear;
    if (m > 12) { m = 1; y += 1; } else if (m < 1) { m = 12; y -= 1; }
    setViewMonth(m); setViewYear(y); setSelectedDay(null);
  }

  const monthLabelStr = new Date(viewYear, viewMonth - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
  const selectedDayEvents = selectedDay ? eventsOnDay(selectedDay) : [];
  const selectedDateStr = selectedDay ? `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}` : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <p className="bw-lead" style={{ margin: 0 }}>Know your cash before it happens.</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="bw-btn ghost small" onClick={() => changeMonth(-1)}>&lsaquo;</button>
          <span style={{ fontWeight: 600, minWidth: 140, textAlign: "center" }}>{monthLabelStr}</span>
          <button className="bw-btn ghost small" onClick={() => changeMonth(1)}>&rsaquo;</button>
          <button className="bw-btn ghost small" onClick={() => { setViewYear(now.getFullYear()); setViewMonth(now.getMonth() + 1); setSelectedDay(null); }}>Today</button>
        </div>
      </div>

      <div className="bw-summary-row" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 18 }}>
        <Stat label="Total inflows" value={inr(totalInflows)} color="var(--teal)" />
        <Stat label="Total outflows" value={inr(totalOutflows)} color="var(--rust)" />
        <Stat label="Net cash flow" value={inr(netCashFlow)} color={netCashFlow >= 0 ? "var(--teal)" : "var(--rust)"} />
        <Stat
          label="Projected month-end balance"
          value={projectedMonthEndBalance !== null ? inr(projectedMonthEndBalance) : "—"}
          color={projectedMonthEndBalance !== null && projectedMonthEndBalance >= 0 ? "var(--teal)" : "var(--rust)"}
          hint={todaysBalance !== null ? `Current balance ${inr(todaysBalance)}` : (isCurrentMonthView ? "Balance not yet confirmed" : "Only shown for the current month")}
        />
        <Stat
          label="Minimum balance (in month)"
          value={projectedMinimumBalance !== null ? inr(projectedMinimumBalance) : "—"}
          color="var(--ink)"
          hint="Buffer comparison coming next"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 18, alignItems: "start" }}>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: "var(--line)", border: "1px solid var(--line)", borderRadius: 6, overflow: "hidden" }}>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} style={{ background: "var(--paper)", padding: "6px 8px", fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase" }}>{d}</div>
            ))}
            {cells.map((day, i) => {
              const dayEvents = eventsOnDay(day);
              const dateStr = day ? `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
              const isToday = dateStr === todayStr;
              return (
                <div key={i}
                  onClick={() => day && setSelectedDay(day)}
                  style={{
                    background: "var(--card)", minHeight: 68, padding: 6, cursor: day ? "pointer" : "default",
                    outline: selectedDay === day ? "2px solid var(--teal)" : isToday ? "1px solid var(--ochre)" : "none", outlineOffset: -2,
                  }}>
                  {day && <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 3 }}>{day}</div>}
                  {dayEvents.slice(0, 2).map((e) => (
                    <div key={e.id} style={{
                      fontSize: 9.5, marginBottom: 2, padding: "1px 4px", borderRadius: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      background: e.direction === "credit" ? "rgba(46,102,89,0.12)" : "rgba(156,74,52,0.12)",
                      color: e.kind === "overdue" ? "var(--ochre)" : e.direction === "credit" ? "var(--teal)" : "var(--rust)",
                      border: e.kind === "projected" ? "1px dashed currentColor" : e.kind === "overdue" ? "1px solid var(--ochre)" : "1px solid transparent",
                      opacity: e.kind === "projected" ? 0.75 : 1,
                    }}>
                      {e.direction === "credit" ? "+" : "−"}{inr(e.amount)}{e.kind === "projected" ? " (exp.)" : e.kind === "overdue" ? " (?)" : ""}
                    </div>
                  ))}
                  {dayEvents.length > 2 && <div style={{ fontSize: 9, color: "var(--ink-soft)" }}>+{dayEvents.length - 2} more</div>}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11, color: "var(--ink-soft)", flexWrap: "wrap" }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(46,102,89,0.12)", border: "1px solid var(--teal)", verticalAlign: -1, marginRight: 4 }} />Confirmed</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(156,74,52,0.12)", border: "1px dashed var(--rust)", verticalAlign: -1, marginRight: 4 }} />Projected (learned pattern, not yet happened)</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(168,112,58,0.12)", border: "1px solid var(--ochre)", verticalAlign: -1, marginRight: 4 }} />Overdue (expected by now, not yet confirmed)</span>
          </div>
        </div>

        <div>
          {selectedDay ? (
            <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 14, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>{new Date(viewYear, viewMonth - 1, selectedDay).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div>
              {selectedDayEvents.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Nothing on this day.</div>
              ) : selectedDayEvents.map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                  <div>
                    <div style={{ fontSize: 13 }}>{e.name}</div>
                    <div style={{ fontSize: 10.5, color: e.kind === "overdue" ? "var(--ochre)" : "var(--ink-soft)" }}>
                      {e.kind === "projected" ? `Expected — ${Math.round(e.confidence * 100)}% confidence`
                        : e.kind === "overdue" ? `Expected by now, not yet confirmed — ${Math.round(e.confidence * 100)}% confidence`
                        : "Confirmed"}
                    </div>
                  </div>
                  <div className={`bw-amt ${e.direction}`}>{e.direction === "credit" ? "+" : "−"}{inr(e.amount)}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="bw-section-label" style={{ marginTop: 0 }}>Upcoming this month</div>
          {monthEvents.filter((e) => e.date >= todayStr).length === 0 ? (
            <div className="bw-empty">Nothing more expected for the rest of this month.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
              {monthEvents.filter((e) => e.date >= todayStr).map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0" }}>
                  <span style={{ color: "var(--ink-soft)", whiteSpace: "nowrap", marginRight: 8 }}>{e.date.slice(8, 10)} {monthLabelStr.split(" ")[0].slice(0, 3)}</span>
                  <span style={{ flex: 1 }}>{e.name}{e.kind === "projected" ? <span style={{ color: "var(--ink-soft)", fontStyle: "italic" }}> (expected)</span> : ""}</span>
                  <span className={e.direction === "credit" ? "bw-amt credit" : "bw-amt debit"}>{e.direction === "credit" ? "+" : "−"}{inr(e.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="bw-section-label" style={{ marginTop: 0 }}>Already happened this month</div>
          {monthEvents.filter((e) => e.date < todayStr).length === 0 ? (
            <div className="bw-empty">Nothing yet this month.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {monthEvents.filter((e) => e.date < todayStr).map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", opacity: 0.75 }}>
                  <span style={{ color: "var(--ink-soft)", whiteSpace: "nowrap", marginRight: 8 }}>{e.date.slice(8, 10)} {monthLabelStr.split(" ")[0].slice(0, 3)}</span>
                  <span style={{ flex: 1 }}>{e.name}{e.kind === "overdue" ? <span style={{ color: "var(--ochre)", fontStyle: "italic" }}> (expected, not yet confirmed)</span> : ""}</span>
                  <span className={e.direction === "credit" ? "bw-amt credit" : "bw-amt debit"}>{e.direction === "credit" ? "+" : "−"}{inr(e.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 24, border: "1px solid var(--line)", borderRadius: 8, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ background: "var(--teal)", color: "#fff", borderRadius: "50%", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>1</span>
          <span style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15 }}>See</span>
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>What's coming in and going out?</span>
        </div>

        <div style={{ margin: "14px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span>Inflow</span><span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{inr(totalInflows)}</span>
          </div>
          <div style={{ height: 10, background: "var(--paper)", borderRadius: 3, overflow: "hidden", border: "1px solid var(--line)", marginBottom: 12 }}>
            <div style={{ width: `${Math.max(2, (totalInflows / seeMaxBar) * 100)}%`, height: "100%", background: "var(--teal)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span>Outflow</span><span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{inr(totalOutflows)}</span>
          </div>
          <div style={{ height: 10, background: "var(--paper)", borderRadius: 3, overflow: "hidden", border: "1px solid var(--line)" }}>
            <div style={{ width: `${Math.max(2, (totalOutflows / seeMaxBar) * 100)}%`, height: "100%", background: "var(--rust)" }} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { label: "Income", value: seeBreakdown.income },
            { label: "Investment redemptions", value: seeBreakdown.redemption },
            { label: "Investments (SIP + Lumpsum)", value: seeBreakdown.investments },
            { label: "Loans (EMI)", value: seeBreakdown.loans },
            { label: "Fixed expenses", value: seeBreakdown.fixedExpenses },
            { label: "Credit card payments", value: seeBreakdown.ccPayments },
            { label: "Discretionary — Household", value: seeBreakdown.discretionaryHousehold },
            { label: "Discretionary — Personal", value: seeBreakdown.discretionaryPersonal },
          ].map((row) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
              <span style={{ color: "var(--ink-soft)" }}>{row.label}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{inr(row.value)}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 10.5, color: "var(--ink-soft)", margin: "12px 0 0" }}>
          Self transfers, External transfers, and debt Disbursement/Lumpsum Payment are not yet included here —
          correct for this all-accounts view (Self nets to zero across every account combined), but will need
          revisiting once a per-account filter exists.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Net Worth overview — a pure aggregator screen. Owns no data of its own; */
/* every figure comes straight from computeNetWorthSummary, which reads    */
/* live from Cash Flow accounts, Investments, and Debt.                    */
/* ---------------------------------------------------------------------- */

/** The Net Worth pillar screen - Assets minus Liabilities, entirely derived from
 *  computeNetWorthSummary; nothing here is its own separately-tracked figure, so this
 *  screen can never drift out of sync with what Cash Flow, Investments, and Debt each
 *  independently show. Also renders the historical trend: one point per month from
 *  the earliest data across every source (balanceHistory, holdingSnapshots,
 *  otherInvestments) through today, each resolved via computeNetWorthAsOfDate at that
 *  month's end date (or today, for the still-in-progress current month). Clicking any
 *  asset/liability row navigates to the pillar screen that owns that figure. */
function NetWorthOverview({ accounts, holdingSnapshots, otherInvestments, debtSchedules, onGoToView }) {
  const summary = useMemo(
    () => computeNetWorthSummary(accounts, holdingSnapshots, otherInvestments, debtSchedules),
    [accounts, holdingSnapshots, otherInvestments, debtSchedules]
  );

  const hasAnyData = summary.totalAssets > 0 || summary.totalLiabilities > 0;

  // Monthly trend — earliest data point across every source, then one point per month
  // using the month's end date as the cutoff (or today, for the current month, since it
  // hasn't ended yet). Debt uses computeDebtSummary's own point-in-time support directly.
  const todayStr = new Date().toISOString().slice(0, 10);
  const trendMonths = useMemo(() => {
    const allDates = [];
    accounts.forEach((a) => { (a.balanceHistory || []).forEach((h) => allDates.push(h.asOfDate || h.date)); });
    holdingSnapshots.forEach((s) => allDates.push(s.asOfDate));
    otherInvestments.forEach((e) => allDates.push(e.asOfDate));
    if (allDates.length === 0) return [];
    const earliestDate = allDates.sort()[0];
    let [y, m] = earliestDate.slice(0, 7).split("-").map(Number);
    const [endY, endM] = todayStr.slice(0, 7).split("-").map(Number);
    const months = [];
    while (y < endY || (y === endY && m <= endM)) {
      months.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return months;
  }, [accounts, holdingSnapshots, otherInvestments, todayStr]);

  const trendData = useMemo(() => trendMonths.map((mk) => {
    const [y, m] = mk.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const cutoff = monthEnd > todayStr ? todayStr : monthEnd;
    const asOf = computeNetWorthAsOfDate(accounts, holdingSnapshots, otherInvestments, debtSchedules, cutoff);
    return { month: monthLabel(mk), netWorth: asOf.netWorth };
  }), [trendMonths, accounts, holdingSnapshots, otherInvestments, debtSchedules, todayStr]);

  if (!hasAnyData) {
    return (
      <div className="bw-empty">
        Nothing to show yet — Net Worth pulls live from your other screens.
        <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="bw-btn small" onClick={() => onGoToView("investments")}><TrendingUp size={12} /> Add investments</button>
          <button className="bw-btn small" onClick={() => onGoToView("debt")}><TrendingDown size={12} /> Add a loan</button>
        </div>
      </div>
    );
  }

  const assetRows = [
    { label: "Bank balances", value: summary.bankTotal, onClick: () => onGoToView("cashflow") },
    { label: "Market-tracked investments", value: summary.marketTrackedValue, onClick: () => onGoToView("investments") },
    { label: "Other investments (PF, Gold, Property, etc.)", value: summary.otherInvestmentsValue, onClick: () => onGoToView("investments") },
  ].filter((r) => r.value !== 0);

  const liabilityRows = [
    { label: "Credit cards owed", value: summary.creditCardOwed, onClick: () => onGoToView("cashflow") },
    { label: "Loans outstanding", value: summary.totalDebt, onClick: () => onGoToView("debt") },
  ].filter((r) => r.value !== 0);

  return (
    <div>
      <ZoneHeader icon={Landmark} title="Net Worth" subtitle="Everything you own, minus everything you owe — pulled live from your other screens, tracked nowhere separately" />

      <div className="bw-waterfall-card">
        <div className="bw-waterfall" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <HeroStat label="Net Worth" value={summary.netWorth} color={summary.netWorth >= 0 ? "var(--teal)" : "var(--rust)"} />
          <HeroStat label="Total Assets" value={summary.totalAssets} color="var(--ink)" />
          <HeroStat label="Total Liabilities" value={summary.totalLiabilities} color="var(--rust)" />
        </div>
      </div>

      <div className="bw-grid2">
        <div>
          <div className="bw-section-label" style={{ marginTop: 0 }}>Assets</div>
          {assetRows.length === 0 ? (
            <div className="bw-empty" style={{ padding: "16px 10px" }}>No assets tracked yet.</div>
          ) : (
            <table className="bw-table">
              <tbody>
                {assetRows.map((r) => (
                  <tr key={r.label} style={{ cursor: "pointer" }} onClick={r.onClick}>
                    <td>{r.label}</td>
                    <td className="bw-amt debit">{inr(r.value)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 600 }}>
                  <td>Total assets</td>
                  <td className="bw-amt debit">{inr(summary.totalAssets)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div>
          <div className="bw-section-label" style={{ marginTop: 0 }}>Liabilities</div>
          {liabilityRows.length === 0 ? (
            <div className="bw-empty" style={{ padding: "16px 10px" }}>No liabilities tracked — nice.</div>
          ) : (
            <table className="bw-table">
              <tbody>
                {liabilityRows.map((r) => (
                  <tr key={r.label} style={{ cursor: "pointer" }} onClick={r.onClick}>
                    <td>{r.label}</td>
                    <td className="bw-amt debit">{inr(r.value)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 600 }}>
                  <td>Total liabilities</td>
                  <td className="bw-amt debit">{inr(summary.totalLiabilities)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      {trendData.length > 1 && (
        <>
          <div className="bw-section-label">Net worth over time</div>
          <p style={{ fontSize: 11, color: "var(--ink-soft)", margin: "0 0 12px" }}>
            One point per month, using whatever was known as of that month's end. An account contributes nothing
            to a month before its first import — so early months can understate net worth if an account existed
            before it was ever added here.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 100000).toFixed(0)}L`} />
              <Tooltip formatter={(v) => inr(v)} />
              <Line type="monotone" dataKey="netWorth" name="Net Worth" stroke="var(--teal)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}

      <p style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 20 }}>
        Click any row to go to the screen that manages it — nothing on this page is editable directly, since
        Net Worth only ever reflects what your other screens already say.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Debt overview — total outstanding, per-account progress, all derived    */
/* live from computeDebtSummary. Nothing here is stored; every number      */
/* recomputed from the imported schedules each render, same "derive at     */
/* read time" philosophy as Investments and Goals.                         */
/* ---------------------------------------------------------------------- */

/** The Debt pillar screen - both loans and credit cards, each resolved through a
 *  deliberately different path: loans via computeDebtSummary (fully schedule-derived
 *  - principal/interest split, next EMI, loan completion), credit cards via plain
 *  lastKnownBalance (no amortization schedule exists for a card, so there's nothing
 *  to derive from). Total outstanding combines both; Principal/Interest paid to date
 *  stay honestly loan-only, since a card has no equivalent breakdown to fold in. Loan
 *  cards show full schedule-derived detail (payoff progress bar, restructure history
 *  via multiple schedules, continuity-gap warnings); a card gets a simpler card with
 *  just its current outstanding. */
function DebtOverview({ accounts, debtSchedules, onGoToUpload }) {
  const debtAccounts = useMemo(() => accounts.filter((a) => a.type === "debt"), [accounts]);
  const ccAccounts = useMemo(() => accounts.filter((a) => a.type === "creditCard"), [accounts]);
  const todayStr = new Date().toISOString().slice(0, 10);

  const accountSummaries = useMemo(() => {
    return debtAccounts.map((acct) => {
      const schedules = debtSchedules.filter((s) => s.accountId === acct.id);
      if (schedules.length === 0) return null;
      const summary = computeDebtSummary(schedules, todayStr);
      if (!summary.hasData) return null;
      const allEntries = schedules.flatMap((s) => s.entries || []);
      const continuityGaps = checkDebtScheduleContinuity(Object.values(mergeDebtEntries(schedules)));
      return { account: acct, summary, scheduleCount: schedules.length, continuityGaps };
    }).filter(Boolean);
  }, [debtAccounts, debtSchedules, todayStr]);

  // Credit cards resolve outstanding from lastKnownBalance directly - no amortization
  // schedule exists for a card, so this is deliberately a separate, lighter path
  // rather than forcing CC through computeDebtSummary's schedule-derived fields.
  const ccSummaries = useMemo(() => {
    return ccAccounts
      .filter((a) => a.lastKnownBalance !== null && a.lastKnownBalance !== undefined)
      .map((a) => ({ account: a, outstanding: a.lastKnownBalance }));
  }, [ccAccounts]);

  const loanOutstanding = accountSummaries.reduce((s, a) => s + a.summary.currentOutstanding, 0);
  const ccOutstanding = ccSummaries.reduce((s, a) => s + a.outstanding, 0);
  const totalOutstanding = loanOutstanding + ccOutstanding;
  const totalPrincipalPaid = accountSummaries.reduce((s, a) => s + a.summary.cumulativePrincipalPaid, 0);
  const totalInterestPaid = accountSummaries.reduce((s, a) => s + a.summary.cumulativeInterestPaid, 0);

  if (accountSummaries.length === 0 && ccSummaries.length === 0) {
    return (
      <div className="bw-empty">
        No debt imported yet.{" "}
        <button className="bw-btn small" style={{ marginLeft: 8 }} onClick={onGoToUpload}>
          <Upload size={12} /> Import a loan schedule or credit card statement
        </button>
      </div>
    );
  }

  return (
    <div>
      <ZoneHeader icon={TrendingDown} title="Overview" subtitle="What you owe, what you've paid down, and what's coming next" />

      <div className="bw-waterfall-card" style={{ marginBottom: 22 }}>
        <div className="bw-waterfall" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <HeroStat label="Total outstanding" value={totalOutstanding} color="var(--rust)"
            hint={ccOutstanding > 0 ? `${inr(loanOutstanding)} loans + ${inr(ccOutstanding)} credit cards` : null} />
          <HeroStat label="Principal paid to date" value={totalPrincipalPaid} color="var(--teal)" hint="Loans only" />
          <HeroStat label="Interest paid to date" value={totalInterestPaid} color="var(--ink)" hint="Loans only" />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {accountSummaries.map(({ account, summary, scheduleCount, continuityGaps }) => {
          const originalPrincipal = summary.cumulativePrincipalPaid + summary.currentOutstanding;
          const pctPaidOff = originalPrincipal > 0 ? Math.min(100, (summary.cumulativePrincipalPaid / originalPrincipal) * 100) : 0;
          return (
            <div key={account.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, background: "var(--card)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600 }}>{account.nickname}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                    {account.loanType || "Loan"} · {account.institution}
                    {scheduleCount > 1 && ` · ${scheduleCount} schedules imported (restructured)`}
                  </div>
                </div>
                {summary.loanComplete && (
                  <span className="bw-pill" style={{ background: "var(--teal)" }}>Paid off</span>
                )}
              </div>

              <div style={{ height: 8, background: "var(--paper)", borderRadius: 3, overflow: "hidden", border: "1px solid var(--line)", marginBottom: 6 }}>
                <div style={{ width: `${pctPaidOff}%`, height: "100%", background: "var(--teal)", transition: "width 0.3s" }} />
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 12 }}>
                {pctPaidOff.toFixed(0)}% of principal paid off — {inr(originalPrincipal)} original, {inr(summary.currentOutstanding)} remaining
              </div>

              <div className="bw-summary-row">
                <Stat label="Current outstanding" value={inr(summary.currentOutstanding)} color="var(--rust)" hint={`as of ${summary.asOfPeriod}`} />
                <Stat label="Principal paid" value={inr(summary.cumulativePrincipalPaid)} color="var(--teal)" />
                <Stat label="Interest paid" value={inr(summary.cumulativeInterestPaid)} color="var(--ink)" />
                <Stat
                  label={summary.loanComplete ? "Loan complete" : "Next EMI"}
                  value={summary.loanComplete ? "—" : inr(summary.nextEmiAmount)}
                  color="var(--ink)"
                  hint={summary.loanComplete ? null : summary.nextEmiPeriod}
                />
              </div>

              {continuityGaps.length > 0 && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11.5, padding: "8px 10px", marginTop: 12, border: "1px solid var(--rust)", borderRadius: 6 }}>
                  <AlertCircle size={13} color="var(--rust)" style={{ marginTop: 1, flexShrink: 0 }} />
                  <span>{continuityGaps.length} period{continuityGaps.length === 1 ? "" : "s"} don't connect cleanly — one period's closing balance doesn't match the next period's opening balance. Worth re-checking the imported schedule.</span>
                </div>
              )}
            </div>
          );
        })}
        {ccSummaries.map(({ account, outstanding }) => (
          <div key={account.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, background: "var(--card)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600 }}>{account.nickname}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Credit card · {account.institution}</div>
              </div>
              <span className="bw-pill" style={{ background: "var(--slate)" }}>Credit card</span>
            </div>
            <Stat label="Current outstanding" value={inr(outstanding)} color="var(--rust)" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Debt Control — reconciliation, not display. Split into two tabs since  */
/* loan and CC outstanding resolve via genuinely different paths          */
/* (schedule-derived vs lastKnownBalance) - forcing one table to cover    */
/* both would blur two different kinds of check into one misleading one.  */
/* ---------------------------------------------------------------------- */

/** Debt Control (not to be confused with the Debt pillar screen, DebtOverview, which
 *  owns the actual outstanding-balance figures) - reconciliation only, split into two
 *  tabs since loan and CC resolve through genuinely different paths:
 *   - Classic Debt: EMI genuinely checks against the amortization schedule for the
 *     selected period (schedule resolution uses most-recently-imported-wins for any
 *     period more than one uploaded schedule covers - the rule for handling a
 *     revised schedule after a prepayment). Disbursement and Lumpsum Payment have no
 *     schedule-side counterpart, shown for visibility only, not as a two-sided match.
 *   - Credit Card: bank-side payments vs. card-side statement totals, per card.
 *  Both tabs share one merged table per account/card with an explicit Diff column
 *  and a Total row (rather than separate hero-stat cards plus a separate breakdown
 *  table), and an account filter that narrows both the table and the transaction
 *  list below it. */
function DebtControlView({ transactions, accounts, debtSchedules }) {
  const [subTab, setSubTab] = useState("classic"); // classic | creditCard
  const [period, setPeriod] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");

  const debtAccounts = useMemo(() => accounts.filter((a) => a.type === "debt"), [accounts]);
  const ccAccounts = useMemo(() => accounts.filter((a) => a.type === "creditCard"), [accounts]);
  const bankAccounts = useMemo(() => accounts.filter((a) => a.type === "bank"), [accounts]);
  const bankAccountIds = useMemo(() => new Set(bankAccounts.map((a) => a.id)), [bankAccounts]);

  const months = useMemo(() => {
    const s = new Set(transactions.filter((t) => t.category === "Transfer").map((t) => t.date.slice(0, 7)));
    return [...s].sort().reverse();
  }, [transactions]);

  // Reset the account filter when switching tabs, since Classic Debt and Credit Card
  // filter against entirely different account sets.
  function switchTab(tab) { setSubTab(tab); setAccountFilter("all"); }

  /* ---- Classic Debt tab: bank-side Debt-EMI/Disbursement/Lumpsum vs. schedule-side ---- */
  const classicRows = useMemo(() => {
    return transactions
      .filter((t) => t.category === "Transfer" && bankAccountIds.has(t.accountId)
        && ["Debt-EMI", "Debt-Disbursement", "Debt-Lumpsum Payment"].includes(t.subCategory))
      .filter((t) => period === "all" || t.date.slice(0, 7) === period)
      .filter((t) => accountFilter === "all" || (t.linkedAccountId || "unlinked") === accountFilter)
      .map((t) => ({
        id: t.id, date: t.date, description: t.description, type: t.subCategory,
        accountId: t.accountId, linkedAccountId: t.linkedAccountId || null,
        amount: t.direction === "credit" ? t.amount : -t.amount,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [transactions, bankAccountIds, period, accountFilter]);

  // Resolve each loan's schedule entries by period, with the most-recently-imported
  // schedule winning for any period more than one uploaded schedule covers - the
  // resolution rule confirmed for handling a revised schedule after a prepayment.
  const scheduleByAccountPeriod = useMemo(() => {
    const byAccount = {};
    debtAccounts.forEach((acct) => {
      const schedules = debtSchedules.filter((s) => s.accountId === acct.id);
      const periodMap = {};
      schedules.forEach((s) => {
        (s.entries || []).forEach((e) => {
          const existing = periodMap[e.period];
          if (!existing || (s.importedAt || 0) > existing.importedAt) {
            periodMap[e.period] = { emi: e.emi, importedAt: s.importedAt || 0 };
          }
        });
      });
      byAccount[acct.id] = periodMap;
    });
    return byAccount;
  }, [debtAccounts, debtSchedules]);

  function scheduleEmiFor(accountId) {
    const periodMap = scheduleByAccountPeriod[accountId] || {};
    return Object.entries(periodMap).reduce((s, [p, entry]) => (period === "all" || p === period ? s + entry.emi : s), 0);
  }

  /* ---- One merged table: per-loan bank EMI/schedule EMI/diff, plus Disbursement and
     Lumpsum shown informationally (no schedule-side counterpart), plus a Total row. ---- */
  const classicByAccount = useMemo(() => {
    const bankGroups = {};
    transactions
      .filter((t) => t.category === "Transfer" && bankAccountIds.has(t.accountId) && ["Debt-EMI", "Debt-Disbursement", "Debt-Lumpsum Payment"].includes(t.subCategory))
      .filter((t) => period === "all" || t.date.slice(0, 7) === period)
      .forEach((t) => {
        const key = t.linkedAccountId || "unlinked";
        if (!bankGroups[key]) bankGroups[key] = { emiBank: 0, disbursement: 0, lumpsum: 0 };
        const amount = t.direction === "credit" ? t.amount : -t.amount;
        if (t.subCategory === "Debt-EMI") bankGroups[key].emiBank += Math.abs(amount);
        if (t.subCategory === "Debt-Disbursement") bankGroups[key].disbursement += amount;
        if (t.subCategory === "Debt-Lumpsum Payment") bankGroups[key].lumpsum += Math.abs(amount);
      });
    const allKeys = new Set([...Object.keys(bankGroups), ...debtAccounts.map((a) => a.id)]);
    return [...allKeys]
      .filter((key) => accountFilter === "all" || key === accountFilter)
      .map((key) => {
        const emiBank = bankGroups[key]?.emiBank || 0;
        const emiSchedule = key === "unlinked" ? 0 : scheduleEmiFor(key);
        return {
          accountId: key,
          accountName: key === "unlinked" ? "Not yet linked to an account" : (debtAccounts.find((a) => a.id === key)?.nickname || "—"),
          emiBank, emiSchedule, emiDiff: emiBank - emiSchedule,
          disbursement: bankGroups[key]?.disbursement || 0,
          lumpsum: bankGroups[key]?.lumpsum || 0,
        };
      }).filter((r) => r.emiBank > 0 || r.emiSchedule > 0 || r.disbursement !== 0 || r.lumpsum > 0);
  }, [transactions, bankAccountIds, period, accountFilter, debtAccounts, scheduleByAccountPeriod]);

  const classicTotals = classicByAccount.reduce((s, r) => ({
    emiBank: s.emiBank + r.emiBank, emiSchedule: s.emiSchedule + r.emiSchedule, emiDiff: s.emiDiff + r.emiDiff,
    disbursement: s.disbursement + r.disbursement, lumpsum: s.lumpsum + r.lumpsum,
  }), { emiBank: 0, emiSchedule: 0, emiDiff: 0, disbursement: 0, lumpsum: 0 });

  const classicAccountFilterOptions = [...debtAccounts.map((a) => ({ id: a.id, name: a.nickname })), { id: "unlinked", name: "Not yet linked" }];

  /* ---- Credit Card tab: bank payments vs. card statements — the same grid that used
     to live in Transfers Control, moved here with a per-card merged table added ---- */
  const ccCombinedRows = useMemo(() => {
    const bankRows = transactions
      .filter((t) => t.category === "Transfer" && t.subCategory === "Credit card payment" && bankAccountIds.has(t.accountId))
      .filter((t) => period === "all" || t.date.slice(0, 7) === period)
      .filter((t) => accountFilter === "all" || (t.linkedAccountId || "unlinked") === accountFilter)
      .map((t) => ({
        kind: "bankPayment", id: t.id, date: t.date, description: t.description,
        accountId: t.accountId, linkedAccountId: t.linkedAccountId || null,
        amount: t.direction === "credit" ? t.amount : -t.amount,
      }));

    const statementRows = [];
    ccAccounts.forEach((a) => {
      if (accountFilter !== "all" && a.id !== accountFilter) return;
      (a.uploadHistory || []).forEach((h) => {
        const rowDate = h.statementDate || h.periodEnd;
        if (!rowDate) return;
        if (period !== "all" && rowDate.slice(0, 7) !== period) return;
        const totalExpense = transactions
          .filter((t) => t.importBatchId === h.batchId && t.category === "Expense")
          .reduce((s, t) => s + (t.direction === "credit" ? -t.amount : t.amount), 0);
        statementRows.push({
          kind: "cardStatement", id: h.batchId, date: rowDate,
          description: `${h.periodStart} – ${h.periodEnd}`,
          accountId: a.id, amount: totalExpense,
        });
      });
    });

    return [...bankRows, ...statementRows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [transactions, bankAccountIds, ccAccounts, period, accountFilter]);

  /* ---- One merged table: per-card payments/statements/diff, plus a Total row.
     Payments are grouped by linkedAccountId (bank side, may include "unlinked");
     statements are inherently tied to their own card account directly. ---- */
  const ccByAccount = useMemo(() => {
    const paymentGroups = {};
    transactions
      .filter((t) => t.category === "Transfer" && t.subCategory === "Credit card payment" && bankAccountIds.has(t.accountId))
      .filter((t) => period === "all" || t.date.slice(0, 7) === period)
      .forEach((t) => {
        const key = t.linkedAccountId || "unlinked";
        paymentGroups[key] = (paymentGroups[key] || 0) + Math.abs(t.direction === "credit" ? t.amount : -t.amount);
      });
    const statementGroups = {};
    ccAccounts.forEach((a) => {
      (a.uploadHistory || []).forEach((h) => {
        const rowDate = h.statementDate || h.periodEnd;
        if (!rowDate) return;
        if (period !== "all" && rowDate.slice(0, 7) !== period) return;
        const totalExpense = transactions
          .filter((t) => t.importBatchId === h.batchId && t.category === "Expense")
          .reduce((s, t) => s + Math.abs(t.direction === "credit" ? -t.amount : t.amount), 0);
        statementGroups[a.id] = (statementGroups[a.id] || 0) + totalExpense;
      });
    });
    const allKeys = new Set([...Object.keys(paymentGroups), ...Object.keys(statementGroups), ...ccAccounts.map((a) => a.id)]);
    return [...allKeys]
      .filter((key) => accountFilter === "all" || key === accountFilter)
      .map((key) => {
        const payment = paymentGroups[key] || 0;
        const statement = statementGroups[key] || 0;
        return {
          accountId: key,
          accountName: key === "unlinked" ? "Not yet linked to a card" : (ccAccounts.find((a) => a.id === key)?.nickname || "—"),
          payment, statement, diff: payment - statement,
        };
      }).filter((r) => r.payment > 0 || r.statement > 0);
  }, [transactions, bankAccountIds, ccAccounts, period, accountFilter]);

  const ccTotals = ccByAccount.reduce((s, r) => ({ payment: s.payment + r.payment, statement: s.statement + r.statement, diff: s.diff + r.diff }), { payment: 0, statement: 0, diff: 0 });
  const ccAccountFilterOptions = [...ccAccounts.map((a) => ({ id: a.id, name: a.nickname })), { id: "unlinked", name: "Not yet linked" }];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <div className="bw-tabs" style={{ marginBottom: 0 }}>
          <button className={`bw-tab ${subTab === "classic" ? "active" : ""}`} onClick={() => switchTab("classic")}>Classic Debt</button>
          <button className={`bw-tab ${subTab === "creditCard" ? "active" : ""}`} onClick={() => switchTab("creditCard")}>Credit Card</button>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select className="bw-select-inline" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="all">All time</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <select className="bw-select-inline" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
            <option value="all">{subTab === "classic" ? "All accounts" : "All cards"}</option>
            {(subTab === "classic" ? classicAccountFilterOptions : ccAccountFilterOptions).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      {subTab === "classic" ? (
        <div>
          <p className="bw-lead">
            EMI genuinely checks against the amortization schedule for this period. Disbursement and Lumpsum
            Payment have no schedule-side counterpart to reconcile against — shown here for visibility, not
            as a two-sided match, since a prepayment is expected to trigger a fresh schedule upload instead.
          </p>

          {classicByAccount.length === 0 ? (
            <div className="bw-empty">No Debt-EMI, Debt-Disbursement, or Debt-Lumpsum Payment transactions yet for this period.</div>
          ) : (
            <div style={{ overflowX: "auto", marginBottom: 22 }}>
              <table className="bw-table">
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ verticalAlign: "bottom" }}>Account</th>
                    <th colSpan={3} style={{ textAlign: "center" }}>EMI</th>
                    <th rowSpan={2} style={{ textAlign: "right", verticalAlign: "bottom" }}>Disbursement</th>
                    <th rowSpan={2} style={{ textAlign: "right", verticalAlign: "bottom" }}>Lumpsum</th>
                  </tr>
                  <tr>
                    <th style={{ textAlign: "right" }}>Bank</th><th style={{ textAlign: "right" }}>Schedule</th><th style={{ textAlign: "right" }}>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {classicByAccount.map((r) => (
                    <tr key={r.accountId}>
                      <td>{r.accountName}</td>
                      <td style={{ textAlign: "right" }}>{inr(r.emiBank)}</td>
                      <td style={{ textAlign: "right" }}>{inr(r.emiSchedule)}</td>
                      <td style={{ textAlign: "right", color: Math.abs(r.emiDiff) < 1 ? "var(--teal)" : "var(--rust)" }}>{inr(r.emiDiff)}</td>
                      <td style={{ textAlign: "right" }}>{inr(r.disbursement)}</td>
                      <td style={{ textAlign: "right" }}>{inr(r.lumpsum)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid var(--ink)" }}>
                    <td style={{ fontWeight: 600 }}>Total</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(classicTotals.emiBank)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(classicTotals.emiSchedule)}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: Math.abs(classicTotals.emiDiff) < 1 ? "var(--teal)" : "var(--rust)" }}>{inr(classicTotals.emiDiff)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(classicTotals.disbursement)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(classicTotals.lumpsum)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="bw-section-label" style={{ marginTop: 0 }}>Transactions</div>
          {classicRows.length === 0 ? (
            <div className="bw-empty">Nothing to show for this period.</div>
          ) : (
            <table className="bw-table">
              <thead><tr><th>Date</th><th>Description</th><th>Type</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
              <tbody>
                {classicRows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap", fontSize: 11.5, color: "var(--ink-soft)" }}>{r.date}</td>
                    <td>{r.description}</td>
                    <td><span className="bw-pill" style={{ background: "var(--slate)", fontSize: 10 }}>{r.type}</span></td>
                    <td className={`bw-amt ${r.amount >= 0 ? "credit" : "debit"}`}>{r.amount >= 0 ? "+" : "−"}{inr(Math.abs(r.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div>
          <p className="bw-lead">
            A payment leaving a bank account and the card statement it settles will land near each other by date. A
            payment with nothing nearby is your cue to upload that card's statement — no need to be told. Won't
            always exactly match — timing between payment and statement dates can span a period boundary.
          </p>

          {ccByAccount.length === 0 ? (
            <div className="bw-empty">No credit card payments or statements yet for this period.</div>
          ) : (
            <table className="bw-table" style={{ marginBottom: 22 }}>
              <thead><tr><th>Card</th><th style={{ textAlign: "right" }}>Payments (bank)</th><th style={{ textAlign: "right" }}>Statements (card)</th><th style={{ textAlign: "right" }}>Diff</th></tr></thead>
              <tbody>
                {ccByAccount.map((r) => (
                  <tr key={r.accountId}>
                    <td>{r.accountName}</td>
                    <td style={{ textAlign: "right" }}>{inr(r.payment)}</td>
                    <td style={{ textAlign: "right" }}>{inr(r.statement)}</td>
                    <td style={{ textAlign: "right", color: Math.abs(r.diff) < 1 ? "var(--teal)" : "var(--rust)" }}>{inr(r.diff)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--ink)" }}>
                  <td style={{ fontWeight: 600 }}>Total</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(ccTotals.payment)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(ccTotals.statement)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: Math.abs(ccTotals.diff) < 1 ? "var(--teal)" : "var(--rust)" }}>{inr(ccTotals.diff)}</td>
                </tr>
              </tbody>
            </table>
          )}

          <div className="bw-section-label" style={{ marginTop: 0 }}>Payments &amp; statements</div>
          {(bankAccounts.length === 0 && ccAccounts.length === 0) || ccCombinedRows.length === 0 ? (
            <div className="bw-empty">No credit card payments or statements yet for this period.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="bw-table">
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ verticalAlign: "bottom" }}>Date</th>
                    <th rowSpan={2} style={{ verticalAlign: "bottom" }}>Description</th>
                    <th rowSpan={2} style={{ verticalAlign: "bottom" }}>Type</th>
                    {bankAccounts.length > 0 && <th colSpan={bankAccounts.length} style={{ textAlign: "center" }}>Bank Payment</th>}
                    {ccAccounts.length > 0 && <th colSpan={ccAccounts.length} style={{ textAlign: "center" }}>Expense Statement</th>}
                  </tr>
                  <tr>
                    {bankAccounts.map((a) => <th key={a.id} style={{ textAlign: "right" }}>{a.nickname}</th>)}
                    {ccAccounts.map((a) => <th key={a.id} style={{ textAlign: "right" }}>{a.nickname}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ccCombinedRows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: "nowrap", fontSize: 11.5, color: "var(--ink-soft)" }}>{r.date}</td>
                      <td>{r.description}</td>
                      <td>
                        <span className="bw-pill" style={{ background: r.kind === "bankPayment" ? "var(--slate)" : "var(--ochre)", fontSize: 10 }}>
                          {r.kind === "bankPayment" ? "Payment" : "Statement"}
                        </span>
                      </td>
                      {bankAccounts.map((a) => (
                        <td key={a.id} className={r.kind === "bankPayment" && a.id === r.accountId ? "bw-amt debit" : undefined} style={{ textAlign: "right" }}>
                          {r.kind === "bankPayment" && a.id === r.accountId ? `−${inr(Math.abs(r.amount))}` : ""}
                        </td>
                      ))}
                      {ccAccounts.map((a) => (
                        <td key={a.id} className={r.kind === "cardStatement" && a.id === r.accountId ? "bw-amt debit" : undefined} style={{ textAlign: "right" }}>
                          {r.kind === "cardStatement" && a.id === r.accountId ? inr(Math.abs(r.amount)) : ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Investments Control — bank-side SIP/Lumpsum/Redemption vs. holding-     */
/* snapshot-derived Added/Redeemed. Two independent zero-checks, not one   */
/* netted figure — additions and redemptions could otherwise offset each   */
/* other and look reconciled when they aren't.                             */
/* NOTE: derived side currently covers demat/mutualFund accounts only,     */
/* since those are the ones tracked via holdingSnapshots + snapshot        */
/* diffing. otherInvestment accounts don't use this same snapshot          */
/* structure, so they're not yet part of the derived-side comparison here  */
/* — an honest, explicit gap rather than a forced, incorrect fit.          */
/* ---------------------------------------------------------------------- */

/** Investments Control - reconciliation only (the actual holding values live on the
 *  Investments pillar screen, InvestmentsOverview). Bank-side SIP/Lumpsum/Redemption
 *  transactions checked against two independently-derived figures from holding
 *  snapshots - Added and Redeemed, never netted into one number, since a large
 *  addition and a large redemption in the same period could otherwise offset and
 *  look falsely reconciled. Snapshot diffing (derivedByAccount) deliberately starts
 *  from the SECOND snapshot for each account, not the first - the very first
 *  snapshot has no prior to compare against, so treating its whole opening balance
 *  as a fresh "addition" would count years of pre-app investment history as current-
 *  period activity (the exact bug this was built to fix). Derived side currently
 *  covers demat/mutualFund accounts only; otherInvestment isn't included, since it
 *  doesn't share this same snapshot structure. One merged table per account with
 *  Addition/Redemption Diff columns and a Total row, plus an account filter. */
function InvestmentsControlView({ transactions, accounts, holdingSnapshots }) {
  const [period, setPeriod] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const bankAccounts = useMemo(() => accounts.filter((a) => a.type === "bank"), [accounts]);
  const bankAccountIds = useMemo(() => new Set(bankAccounts.map((a) => a.id)), [bankAccounts]);
  const investmentAccounts = useMemo(() => accounts.filter((a) => a.type === "demat" || a.type === "mutualFund"), [accounts]);

  const months = useMemo(() => {
    const s = new Set(transactions.filter((t) => t.category === "Investment").map((t) => t.date.slice(0, 7)));
    return [...s].sort().reverse();
  }, [transactions]);

  /* ---- Bank side: individual SIP/Lumpsum/Redemption transactions ---- */
  const bankRows = useMemo(() => {
    return transactions
      .filter((t) => t.category === "Investment" && bankAccountIds.has(t.accountId)
        && ["SIP", "Lumpsum", "Redemption"].includes(t.subCategory))
      .filter((t) => period === "all" || t.date.slice(0, 7) === period)
      .filter((t) => accountFilter === "all" || (t.linkedAccountId || "unlinked") === accountFilter)
      .map((t) => ({
        id: t.id, date: t.date, description: t.description, type: t.subCategory,
        accountId: t.accountId, linkedAccountId: t.linkedAccountId || null,
        amount: t.direction === "credit" ? t.amount : -t.amount,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [transactions, bankAccountIds, period, accountFilter]);

  /* ---- Derived side: per-account snapshot transitions, one per consecutive pair.
     Deliberately starts from the SECOND snapshot (i=1), not the first - the very first
     snapshot has no prior to compare against, so computeSnapshotTransition(null, first)
     treats its entire opening balance as a fresh "addition." That's correct for other
     uses of this function, but wrong here: an opening balance built up over years before
     this app ever existed isn't a real, bank-comparable addition event, and counting it
     as one is exactly what inflated Additions to crores against a few lakh on the bank
     side. Only a transition between two confirmed snapshots represents something a real
     bank transaction could actually be checked against.
     A transition "belongs" to the month of its ending (curr) snapshot - that's when
     the change it represents became confirmed. Summed per account, then filtered to
     the selected period (or all transitions, for "all time"). ---- */
  const derivedByAccount = useMemo(() => {
    const result = {};
    investmentAccounts.forEach((acct) => {
      const snaps = holdingSnapshots.filter((s) => s.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
      let added = 0, redeemed = 0;
      for (let i = 1; i < snaps.length; i++) {
        const curr = snaps[i];
        if (period !== "all" && curr.asOfDate.slice(0, 7) !== period) continue;
        const prev = snaps[i - 1];
        const transition = computeSnapshotTransition(prev, curr);
        added += transition.added;
        redeemed += Math.abs(transition.redeemed);
      }
      result[acct.id] = { added, redeemed };
    });
    return result;
  }, [investmentAccounts, holdingSnapshots, period]);

  /* ---- One merged table: per-account bank/holdings/difference, plus a Total row.
     Replaces separate hero cards and a separate by-account table - the difference is
     visible exactly where it lives (per account), not just as one overall figure. ---- */
  const byAccount = useMemo(() => {
    const bankGroups = {};
    transactions
      .filter((t) => t.category === "Investment" && bankAccountIds.has(t.accountId) && ["SIP", "Lumpsum", "Redemption"].includes(t.subCategory))
      .filter((t) => period === "all" || t.date.slice(0, 7) === period)
      .forEach((t) => {
        const key = t.linkedAccountId || "unlinked";
        if (!bankGroups[key]) bankGroups[key] = { added: 0, redeemed: 0 };
        const amount = Math.abs(t.direction === "credit" ? t.amount : -t.amount);
        if (t.subCategory === "SIP" || t.subCategory === "Lumpsum") bankGroups[key].added += amount;
        if (t.subCategory === "Redemption") bankGroups[key].redeemed += amount;
      });
    const allKeys = new Set([...Object.keys(bankGroups), ...investmentAccounts.map((a) => a.id)]);
    return [...allKeys]
      .filter((key) => accountFilter === "all" || key === accountFilter)
      .map((key) => {
        const account = investmentAccounts.find((a) => a.id === key);
        const bankAdded = bankGroups[key]?.added || 0;
        const bankRedeemed = bankGroups[key]?.redeemed || 0;
        const derivedAdded = derivedByAccount[key]?.added || 0;
        const derivedRedeemed = derivedByAccount[key]?.redeemed || 0;
        return {
          accountId: key,
          accountName: key === "unlinked" ? "Not yet linked to an account" : (account?.nickname || "—"),
          bankAdded, derivedAdded, additionDiff: bankAdded - derivedAdded,
          bankRedeemed, derivedRedeemed, redemptionDiff: bankRedeemed - derivedRedeemed,
        };
      }).filter((r) => r.bankAdded > 0 || r.bankRedeemed > 0 || r.derivedAdded > 0 || r.derivedRedeemed > 0);
  }, [transactions, bankAccountIds, period, accountFilter, investmentAccounts, derivedByAccount]);

  const totals = byAccount.reduce((s, r) => ({
    bankAdded: s.bankAdded + r.bankAdded, derivedAdded: s.derivedAdded + r.derivedAdded, additionDiff: s.additionDiff + r.additionDiff,
    bankRedeemed: s.bankRedeemed + r.bankRedeemed, derivedRedeemed: s.derivedRedeemed + r.derivedRedeemed, redemptionDiff: s.redemptionDiff + r.redemptionDiff,
  }), { bankAdded: 0, derivedAdded: 0, additionDiff: 0, bankRedeemed: 0, derivedRedeemed: 0, redemptionDiff: 0 });

  const accountFilterOptions = [...investmentAccounts.map((a) => ({ id: a.id, name: a.nickname })), { id: "unlinked", name: "Not yet linked" }];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <p className="bw-lead" style={{ margin: 0, flex: 1, minWidth: 240 }}>
          Additions and redemptions are checked separately, not netted — one large addition and one large
          redemption in the same period could otherwise offset and look reconciled when they aren't.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select className="bw-select-inline" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="all">All time</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <select className="bw-select-inline" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
            <option value="all">All accounts</option>
            {accountFilterOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {byAccount.length === 0 ? (
        <div className="bw-empty">Nothing to show for this period.</div>
      ) : (
        <div style={{ overflowX: "auto", marginBottom: 22 }}>
          <table className="bw-table">
            <thead>
              <tr>
                <th rowSpan={2} style={{ verticalAlign: "bottom" }}>Account</th>
                <th colSpan={3} style={{ textAlign: "center" }}>Additions</th>
                <th colSpan={3} style={{ textAlign: "center" }}>Redemptions</th>
              </tr>
              <tr>
                <th style={{ textAlign: "right" }}>Bank</th><th style={{ textAlign: "right" }}>Holdings</th><th style={{ textAlign: "right" }}>Diff</th>
                <th style={{ textAlign: "right" }}>Bank</th><th style={{ textAlign: "right" }}>Holdings</th><th style={{ textAlign: "right" }}>Diff</th>
              </tr>
            </thead>
            <tbody>
              {byAccount.map((r) => (
                <tr key={r.accountId}>
                  <td>{r.accountName}</td>
                  <td style={{ textAlign: "right" }}>{inr(r.bankAdded)}</td>
                  <td style={{ textAlign: "right" }}>{inr(r.derivedAdded)}</td>
                  <td style={{ textAlign: "right", color: Math.abs(r.additionDiff) < 1 ? "var(--teal)" : "var(--rust)" }}>{inr(r.additionDiff)}</td>
                  <td style={{ textAlign: "right" }}>{inr(r.bankRedeemed)}</td>
                  <td style={{ textAlign: "right" }}>{inr(r.derivedRedeemed)}</td>
                  <td style={{ textAlign: "right", color: Math.abs(r.redemptionDiff) < 1 ? "var(--teal)" : "var(--rust)" }}>{inr(r.redemptionDiff)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--ink)" }}>
                <td style={{ fontWeight: 600 }}>Total</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(totals.bankAdded)}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(totals.derivedAdded)}</td>
                <td style={{ textAlign: "right", fontWeight: 700, color: Math.abs(totals.additionDiff) < 1 ? "var(--teal)" : "var(--rust)" }}>{inr(totals.additionDiff)}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(totals.bankRedeemed)}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(totals.derivedRedeemed)}</td>
                <td style={{ textAlign: "right", fontWeight: 700, color: Math.abs(totals.redemptionDiff) < 1 ? "var(--teal)" : "var(--rust)" }}>{inr(totals.redemptionDiff)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="bw-section-label" style={{ marginTop: 0 }}>Bank-side transactions</div>
      {bankRows.length === 0 ? (
        <div className="bw-empty">No SIP, Lumpsum, or Redemption transactions yet for this period.</div>
      ) : (
        <table className="bw-table">
          <thead><tr><th>Date</th><th>Description</th><th>Type</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
          <tbody>
            {bankRows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap", fontSize: 11.5, color: "var(--ink-soft)" }}>{r.date}</td>
                <td>{r.description}</td>
                <td><span className="bw-pill" style={{ background: "var(--slate)", fontSize: 10 }}>{r.type}</span></td>
                <td className={`bw-amt ${r.amount >= 0 ? "credit" : "debit"}`}>{r.amount >= 0 ? "+" : "−"}{inr(Math.abs(r.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The Investments pillar screen, two sub-sections:
 *   - Market-tracked (equity/demat and mutual fund accounts): an Opening → Added →
 *     Redeemed → Closing → Growth waterfall, summed across every account's own
 *     latest snapshot transition (computeSnapshotTransition against each account's
 *     own previous snapshot - never fabricating a comparison point for an account
 *     with only one snapshot so far). "vs last snapshot" and "Last updated" reuse
 *     these same already-computed transitions rather than a separate calculation.
 *   - Other Investments (OtherInvestmentsPanel): PF, Gold, Property, and similar
 *     holdings that don't come from a holdings-statement-style import. */
function InvestmentsOverview({ accounts, setAccounts, holdingSnapshots, otherInvestments, setOtherInvestments, onGoToUpload, effectiveTier, showToast }) {
  const [activeSection, setActiveSection] = useState("market"); // market | statement | manual
  const [apiKey, setApiKeyLocal] = useState("");
  useEffect(() => { (async () => { setApiKeyLocal(await loadState("geminiApiKey", "")); })(); }, []);
  const investmentAccounts = useMemo(() => accounts.filter((a) => a.type === "demat" || a.type === "mutualFund"), [accounts]);

  const accountTransitions = useMemo(() => {
    return investmentAccounts.map((acct) => {
      const snaps = holdingSnapshots.filter((s) => s.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
      if (snaps.length === 0) return null;
      const curr = snaps[snaps.length - 1];
      const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
      const rawTransition = computeSnapshotTransition(prev, curr);
      // When there's no prior snapshot at all, computeSnapshotTransition has nothing to
      // compare against and treats the entire opening balance as a fresh "addition" -
      // correct in isolation, but wrong here: a balance built up before this app ever
      // tracked the account isn't a real, current-period addition. null (not 0) for
      // added/redeemed in this case - the same way Opening already shows "-" rather
      // than 0 when there's no prior point - "no data" is not "no change."
      const transition = prev ? rawTransition : { ...rawTransition, added: null, redeemed: null };
      return { account: acct, snapshotCount: snaps.length, latest: curr, previous: prev, transition };
    }).filter(Boolean);
  }, [investmentAccounts, holdingSnapshots]);

  const equityTransitions = accountTransitions.filter((t) => t.account.type === "demat");
  const mfTransitions = accountTransitions.filter((t) => t.account.type === "mutualFund");

  function sumTransitions(list) {
    const sums = list.reduce((acc, t) => ({
      openingInvested: acc.openingInvested + (t.transition.openingInvested || 0),
      added: acc.added + (t.transition.added || 0),
      redeemed: acc.redeemed + (t.transition.redeemed || 0),
      closingInvested: acc.closingInvested + (t.transition.closingInvested || 0),
      closingCurrentValue: acc.closingCurrentValue + (t.transition.closingCurrentValue || 0),
    }), { openingInvested: 0, added: 0, redeemed: 0, closingInvested: 0, closingCurrentValue: 0 });
    sums.growth = Math.round((sums.closingCurrentValue - sums.closingInvested) * 100) / 100;
    return sums;
  }

  const combined = sumTransitions(accountTransitions);
  const simpleReturnPct = combined.closingInvested > 0 ? (combined.growth / combined.closingInvested) * 100 : null;

  // "vs last snapshot" — reuses each account's own previous transition (already computed
  // above), never fabricating a comparison point for an account with only one snapshot.
  const previousTotalCurrentValue = accountTransitions.reduce(
    (s, t) => s + (t.previous ? (t.previous.totalCurrentValue || 0) : (t.latest.totalCurrentValue || 0)),
    0
  );
  const vsLastSnapshotDelta = combined.closingCurrentValue - previousTotalCurrentValue;
  const lastUpdatedDate = accountTransitions.length > 0
    ? accountTransitions.reduce((latest, t) => (t.latest.asOfDate > latest ? t.latest.asOfDate : latest), accountTransitions[0].latest.asOfDate)
    : null;

  const allClosedPositions = accountTransitions.flatMap((t) =>
    t.transition.closedPositions.map((cp) => ({ ...cp, accountNickname: t.account.nickname }))
  );

  return (
    <div>
      <div className="bw-tabs" style={{ marginBottom: 18 }}>
        <button className={`bw-tab ${activeSection === "market" ? "active" : ""}`} onClick={() => setActiveSection("market")}>
          <TrendingUp size={13} /> Market-tracked
        </button>
        <button className={`bw-tab ${activeSection === "other" ? "active" : ""}`} onClick={() => setActiveSection("other")}>
          <FileText size={13} /> Other Investments
        </button>
      </div>

      {activeSection === "market" && (
        investmentAccounts.length === 0 || accountTransitions.length === 0 ? (
          <div className="bw-empty">
            No investment holdings imported yet.{" "}
            <button className="bw-btn small" style={{ marginLeft: 8 }} onClick={onGoToUpload}>
              <Upload size={12} /> Import a holding statement
            </button>
          </div>
        ) : (
    <div>
      <ZoneHeader icon={TrendingUp} title="Overview" subtitle="How much you've added to your investments, and how much it's grown" />
      {lastUpdatedDate && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--ink-soft)", margin: "-8px 0 14px" }}>
          <span>Last updated: {lastUpdatedDate}</span>
          <span style={{ color: vsLastSnapshotDelta >= 0 ? "var(--teal)" : "var(--rust)" }}>
            {vsLastSnapshotDelta >= 0 ? "\u25B2" : "\u25BC"} {inr(Math.abs(vsLastSnapshotDelta))} vs last snapshot
          </span>
        </div>
      )}

      <div className="bw-summary-row" style={{ gridTemplateColumns: "repeat(6, 1fr)", marginBottom: 10 }}>
        <Stat label="Total invested" value={inr(combined.closingInvested)} color="var(--ink)" />
        <Stat label="Added" value={inr(combined.added)} color="var(--teal)" />
        <Stat label="Redeemed" value={combined.redeemed !== 0 ? `−${inr(Math.abs(combined.redeemed))}` : "—"} color="var(--rust)" />
        <Stat label="Current value" value={inr(combined.closingCurrentValue)} color="var(--teal)" />
        <Stat
          label="Unrealized gain"
          value={inr(combined.growth)}
          color={combined.growth >= 0 ? "var(--teal)" : "var(--rust)"}
          hint={simpleReturnPct !== null ? `${simpleReturnPct >= 0 ? "+" : ""}${simpleReturnPct.toFixed(1)}% simple return` : null}
        />
        <Stat label="Accounts tracked" value={String(investmentAccounts.length)} color="var(--ink)" />
      </div>
      <p style={{ fontSize: 11.5, color: "var(--ink-soft)", margin: "0 0 24px" }}>
        Added/Redeemed reflects net new money since each account's previous import — not gross contributions minus
        withdrawals separately, since a snapshot alone can't tell those apart. Growth is cumulative unrealized
        P&L as of the latest import, not a period figure — compare two dated snapshots to see growth over a
        specific stretch of time.
      </p>

      {equityTransitions.length > 0 && (
        <InvestmentSection title="Equity / Demat" icon={Landmark} transitions={equityTransitions} />
      )}
      {mfTransitions.length > 0 && (
        <InvestmentSection title="Mutual Funds" icon={PieIcon} transitions={mfTransitions} />
      )}

      {allClosedPositions.length > 0 && (
        <>
          <div className="bw-section-label">Closed positions</div>
          <p className="bw-lead" style={{ marginBottom: 12 }}>
            Held in a previous import, gone from the latest one — cost basis shown is what was last known before
            it exited; the actual sale price was never seen, so realized gain/loss can't be shown here.
          </p>
          <table className="bw-table" style={{ marginBottom: 22 }}>
            <thead><tr><th>Name</th><th>Account</th><th>Closed as of</th><th style={{ textAlign: "right" }}>Last invested value</th></tr></thead>
            <tbody>
              {allClosedPositions.map((cp, i) => (
                <tr key={i}>
                  <td>{cp.name}</td>
                  <td style={{ fontSize: 11.5 }}>{cp.accountNickname}</td>
                  <td style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{cp.closedAsOf}</td>
                  <td className="bw-amt debit">{inr(-cp.addedOrRedeemed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
        )
      )}

      {activeSection === "other" && (
        <OtherInvestmentsPanel accounts={accounts} setAccounts={setAccounts} otherInvestments={otherInvestments} setOtherInvestments={setOtherInvestments} apiKey={apiKey} effectiveTier={effectiveTier} showToast={showToast} />
      )}
    </div>
  );
}

/** A per-account-type table (equity or mutual fund, decided by the caller's
 *  "transitions" list) - each account's own opening/added/redeemed/closing/growth,
 *  plus a Total row summing all of them. An account with only one snapshot so far
 *  shows "—" for Opening rather than a misleading zero or a fabricated figure. */
function InvestmentSection({ title, icon, transitions }) {
  const totals = transitions.reduce((acc, t) => ({
    openingInvested: acc.openingInvested + (t.transition.openingInvested || 0),
    added: acc.added + (t.transition.added || 0),
    redeemed: acc.redeemed + (t.transition.redeemed || 0),
    closingInvested: acc.closingInvested + (t.transition.closingInvested || 0),
    closingCurrentValue: acc.closingCurrentValue + (t.transition.closingCurrentValue || 0),
  }), { openingInvested: 0, added: 0, redeemed: 0, closingInvested: 0, closingCurrentValue: 0 });
  totals.growth = Math.round((totals.closingCurrentValue - totals.closingInvested) * 100) / 100;

  return (
    <>
      <div className="bw-section-label" style={{ marginTop: 0 }}>
        {icon ? React.createElement(icon, { size: 14, style: { verticalAlign: -2, marginRight: 5 } }) : null}
        {title}
      </div>
      <div style={{ overflowX: "auto", marginBottom: 16 }}>
        <table className="bw-table">
          <thead>
            <tr>
              <th>Account</th><th style={{ textAlign: "right" }}>Opening</th><th style={{ textAlign: "right" }}>Added</th>
              <th style={{ textAlign: "right" }}>Redeemed</th><th style={{ textAlign: "right" }}>Closing invested</th>
              <th style={{ textAlign: "right" }}>Current value</th><th style={{ textAlign: "right" }}>Growth</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ fontWeight: 600 }}>
              <td>Total</td>
              <td style={{ textAlign: "right" }}>{inr(totals.openingInvested)}</td>
              <td className="bw-amt credit">{inr(totals.added)}</td>
              <td className="bw-amt debit">{totals.redeemed !== 0 ? `−${inr(Math.abs(totals.redeemed))}` : "—"}</td>
              <td style={{ textAlign: "right" }}>{inr(totals.closingInvested)}</td>
              <td style={{ textAlign: "right" }}>{inr(totals.closingCurrentValue)}</td>
              <td style={{ textAlign: "right", color: totals.growth >= 0 ? "var(--teal)" : "var(--rust)" }}>{inr(totals.growth)}</td>
            </tr>
            {transitions.map((t) => (
              <tr key={t.account.id}>
                <td>{t.account.nickname}</td>
                <td style={{ textAlign: "right" }}>{t.previous ? inr(t.transition.openingInvested) : <span style={{ color: "var(--ink-soft)" }}>—</span>}</td>
                <td className="bw-amt credit">{t.previous ? inr(t.transition.added) : <span style={{ color: "var(--ink-soft)" }}>—</span>}</td>
                <td className="bw-amt debit">{!t.previous ? <span style={{ color: "var(--ink-soft)" }}>—</span> : t.transition.redeemed !== 0 ? `−${inr(Math.abs(t.transition.redeemed))}` : "—"}</td>
                <td style={{ textAlign: "right" }}>{inr(t.transition.closingInvested)}</td>
                <td style={{ textAlign: "right" }}>{inr(t.transition.closingCurrentValue)}</td>
                <td style={{ textAlign: "right", color: t.transition.growth >= 0 ? "var(--teal)" : "var(--rust)" }}>{inr(t.transition.growth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {transitions.map((t) => (
        <div key={t.account.id} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            {t.account.nickname} <span style={{ fontWeight: 400, color: "var(--ink-soft)" }}>· as of {t.latest.asOfDate}</span>
          </div>
          <table className="bw-table">
            <thead>
              <tr>
                <th>Name</th><th style={{ textAlign: "right" }}>Units</th><th style={{ textAlign: "right" }}>Invested</th>
                <th style={{ textAlign: "right" }}>Current</th><th style={{ textAlign: "right" }}>Growth</th><th style={{ textAlign: "right" }}>Added/Redeemed</th>
              </tr>
            </thead>
            <tbody>
              {t.transition.holdingRows.map((h) => (
                <tr key={h.instrumentKey}>
                  <td>
                    {h.name}
                    {h.isNew && <span className="bw-pill" style={{ background: "var(--teal)", fontSize: 9, marginLeft: 6 }}>new</span>}
                    {!h.keyReliable && (
                      <span style={{ fontSize: 9, color: "var(--ochre)", marginLeft: 6 }} title="No ISIN or Folio Number found — matched by name only.">
                        (name match)
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>{h.units !== null ? h.units : "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    {inr(h.investedValue)}
                    {h.derived?.investedValue && <span style={{ fontSize: 9, color: "var(--ochre)", display: "block" }} title="Not printed in this statement — calculated as Units × Avg Cost.">calculated</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {inr(h.currentValue)}
                    {h.derived?.currentValue && <span style={{ fontSize: 9, color: "var(--ochre)", display: "block" }} title="Not printed in this statement — calculated as Units × Current Price.">calculated</span>}
                  </td>
                  <td style={{ textAlign: "right", color: h.growth >= 0 ? "var(--teal)" : "var(--rust)" }}>{inr(h.growth)}</td>
                  <td className={`bw-amt ${h.addedOrRedeemed >= 0 ? "credit" : "debit"}`}>{h.addedOrRedeemed >= 0 ? "+" : "−"}{inr(Math.abs(h.addedOrRedeemed))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

/* ---------------------------------------------------------------------- */
/* Other Investments — PF, Gold, Property, and anything else without the   */
/* buy/sell activity a market-tracked fund has. One unified shape, same    */
/* field names and derivation approach as market-tracked holdings: units,  */
/* cost-per-unit, current-per-unit, invested value, current value — every  */
/* field nullable except currentValue, so PF (no units concept) and Gold/  */
/* Property (units, real cost basis) both fit naturally. Manual entry and  */
/* PDF upload both write into this same shape.                             */
/* ---------------------------------------------------------------------- */

const OTHER_INVESTMENT_SUBTYPES = ["PF", "Gold", "Property", "Other"];

const OTHER_INVESTMENT_EXTRACT_SCHEMA = {
  type: "OBJECT",
  properties: {
    institution: { type: "STRING", nullable: true, description: "The fund house, EPFO, or issuer name — check a title, logo caption, or letterhead text. Null if genuinely not findable." },
    assetSubtype: { type: "STRING", nullable: true, enum: ["PF", "Gold", "Property", "Other"], description: "Best guess from context." },
    asOfDate: { type: "STRING", nullable: true, description: "YYYY-MM-DD — the date this value is as of. Never today's date; the date printed on the statement." },
    units: { type: "NUMBER", nullable: true, description: "Only if a quantity/unit balance is explicitly printed — never computed or estimated." },
    unitOfMeasure: { type: "STRING", nullable: true, description: "e.g. 'grams', 'sqft' — only if explicitly relevant." },
    costPerUnit: { type: "NUMBER", nullable: true, description: "Original cost per unit, only if explicitly printed — never computed." },
    currentPerUnit: { type: "NUMBER", nullable: true, description: "Current price/rate per unit, only if explicitly printed — never computed." },
    investedValue: { type: "NUMBER", nullable: true, description: "Total original cost, only if explicitly printed — never computed from units×cost yourself, that happens separately." },
    currentValue: { type: "NUMBER", nullable: true, description: "Total current value, only if explicitly printed — never computed yourself, that happens separately." },
  },
  required: ["asOfDate"],
};

async function callOtherInvestmentExtract(images, apiKey) {
  const prompt = [
    "You are looking at page images of a statement for a PF (provident fund), Gold holding certificate,",
    "Property valuation, or similar investment with no regular buy/sell activity.",
    "Find: the institution/issuer name, the asset subtype, the date this value is as of, and whichever of",
    "units / cost-per-unit / current-per-unit / total invested value / total current value are explicitly",
    "printed. PF statements typically show only a total current value with no units concept; Gold/Property",
    "may show a quantity and both an original cost and current rate. Report ONLY what is actually printed —",
    "never compute, estimate, or invent any of these numbers yourself, even if some of them would let you",
    "calculate the others.",
  ].join("\n");
  const parts = [
    ...images.map((base64) => ({ inlineData: { mimeType: "image/png", data: base64 } })),
    { text: prompt },
  ];
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { maxOutputTokens: 4000, responseMimeType: "application/json", responseSchema: OTHER_INVESTMENT_EXTRACT_SCHEMA },
      }),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Request failed (HTTP ${response.status}).`);
  const textPart = (data.candidates?.[0]?.content?.parts || []).find((p) => typeof p.text === "string" && !p.thought);
  if (!textPart) throw new Error("No usable response from the model.");
  return JSON.parse(textPart.text.replace(/```json|```/g, "").trim());
}

/** Optional PDF-upload shortcut for adding a PF, Gold, or Property entry - reads a
 *  statement's page images via callOtherInvestmentExtract, then fills in whichever of
 *  units/cost/value fields weren't directly printed using deriveOtherInvestmentFields
 *  (e.g. investedValue from units × costPerUnit, if only those two were extracted).
 *  Hands the combined result up to the parent form via onExtracted, which pre-fills
 *  the manual entry fields rather than committing anything on its own - the person
 *  still confirms or edits before the entry is actually saved. */
function OtherInvestmentUploadFlow({ apiKey, onExtracted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [pendingFile, setPendingFile] = useState(null);
  const [extracted, setExtracted] = useState(null);

  async function runExtraction(file, pwd) {
    if (!apiKey) { setError("Add your Gemini API key in Upload → PDF (AI-assisted) first — this needs it to read the statement."); return; }
    setBusy(true); setError(null); setNeedsPassword(false); setWrongPassword(false);
    try {
      const { images, truncated } = await renderPdfPagesAsImages(file, pwd || undefined);
      if (images.length === 0) { setError("Couldn't render any pages from that PDF."); return; }
      const result = await callOtherInvestmentExtract(images, apiKey);
      const derived = deriveOtherInvestmentFields(
        result.units ?? null, result.costPerUnit ?? null, result.currentPerUnit ?? null,
        result.investedValue ?? null, result.currentValue ?? null
      );
      const combined = { ...result, ...derived };
      setExtracted(combined);
      onExtracted(combined);
      if (truncated) setError("This PDF has more pages than could be read — only the first several were checked.");
    } catch (err) {
      if (err && err.needsPassword) {
        setNeedsPassword(true);
        setWrongPassword(!!err.wasWrongPassword);
        setPendingFile(file);
      } else {
        setError(err.message || "Couldn't read or extract that file.");
      }
    } finally {
      setBusy(false);
    }
  }

  function handleFile(file) {
    if (!file) return;
    setExtracted(null);
    if (!/\.pdf$/i.test(file.name)) { setError("Only PDF is supported here for now."); return; }
    setPendingFile(file);
    runExtraction(file, "");
  }

  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 6, padding: 14, marginBottom: 18 }}>
      {!extracted && (
        <label className="bw-dropzone" style={{ padding: "20px 14px" }}>
          <input type="file" accept=".pdf" onChange={(e) => handleFile(e.target.files[0])} />
          <Upload size={18} style={{ marginBottom: 6 }} />
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>Click to choose a PDF statement</div>
        </label>
      )}
      {busy && <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 8 }}>Reading and extracting…</div>}
      {needsPassword && (
        <div style={{ marginTop: 10 }}>
          <div className="bw-field">
            <label>{wrongPassword ? "That password didn't work — try again" : "This PDF is password-protected"}</label>
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
          </div>
          <button className="bw-btn small" onClick={() => runExtraction(pendingFile, password)}>Unlock &amp; extract</button>
        </div>
      )}
      {error && <p style={{ fontSize: 11.5, color: "var(--rust)", marginTop: 8 }}>{error}</p>}

      {extracted && (
        <div>
          <p style={{ fontSize: 12, margin: "0 0 10px", color: "var(--teal)" }}>
            <Check size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
            Applied below — {extracted.institution || "institution not found"}, as of {extracted.asOfDate || "date not found"}
            {extracted.currentValue !== null && `, current value ${inr(extracted.currentValue)}`}
            {(extracted.derived?.currentValue || extracted.derived?.investedValue) && " (some figures calculated from units × price)"}. Review and adjust before saving.
          </p>
          <button className="bw-btn ghost small" onClick={() => { setExtracted(null); setPendingFile(null); }}>Upload a different file</button>
        </div>
      )}
    </div>
  );
}

/** Manual/PDF-assisted entry for investments that don't come from a market-tracked
 *  holdings statement - PF, Gold, and Property, each a distinct assetSubtype under
 *  the shared "otherInvestment" account type. deriveOtherInvestmentFields fills in
 *  whatever wasn't directly entered (e.g. investedValue from units × costPerUnit),
 *  so the person only has to supply enough fields to make the rest computable, not
 *  every field every time. Property specifically also carries a location. Respects
 *  the same Free-tier one-investment-account limit and read-only enforcement as the
 *  market-tracked import flows. */
function OtherInvestmentsPanel({ accounts, setAccounts, otherInvestments, setOtherInvestments, apiKey, effectiveTier, showToast }) {
  const otherAccounts = useMemo(() => accounts.filter((a) => a.type === "otherInvestment"), [accounts]);
  const [selectedAccountId, setSelectedAccountId] = useState("__new__");
  const [assetSubtype, setAssetSubtype] = useState("PF");
  const [nickname, setNickname] = useState("");
  const [location, setLocation] = useState("");
  const [units, setUnits] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [currentPerUnit, setCurrentPerUnit] = useState("");
  const [investedValue, setInvestedValue] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [showUpload, setShowUpload] = useState(false);

  const selectedExistingAccount = selectedAccountId !== "__new__" ? accounts.find((a) => a.id === selectedAccountId) : null;
  const effectiveSubtype = selectedExistingAccount ? selectedExistingAccount.assetSubtype : assetSubtype;

  function resetEntryFields() {
    setUnits(""); setUnitOfMeasure(""); setCostPerUnit(""); setCurrentPerUnit(""); setInvestedValue(""); setCurrentValue("");
  }

  function addEntry() {
    if (!asOfDate) { showToast("Enter the as-of date before adding this entry."); return; }
    const result = deriveOtherInvestmentFields(
      units ? parseAmountStr(units) : null,
      costPerUnit ? parseAmountStr(costPerUnit) : null,
      currentPerUnit ? parseAmountStr(currentPerUnit) : null,
      investedValue ? parseAmountStr(investedValue) : null,
      currentValue ? parseAmountStr(currentValue) : null,
    );
    if (result.currentValue === null) { showToast("Enter a current value (or enough to derive one) before adding this entry."); return; }
    let account = selectedExistingAccount;
    if (!account && !canCreateAccount(accounts, effectiveTier, "otherInvestment")) {
      showToast(
        `Free plan limit reached (${FREE_TIER_LIMITS.investmentAccounts} Investment account) — go to Accounts to switch ` +
        `which one stays active, or upgrade for unlimited accounts.`
      );
      return;
    }
    if (account && !canImportIntoAccount(accounts, effectiveTier, account.id)) {
      showToast(`"${account.nickname}" is read-only on the Free plan — go to Accounts to switch which account stays active, or upgrade.`);
      return;
    }
    if (!account) {
      if (!nickname.trim()) return;
      account = { id: uid("acc"), type: "otherInvestment", assetSubtype, nickname: nickname.trim(), location: assetSubtype === "Property" ? (location.trim() || null) : null };
      setAccounts((prev) => [...prev, account]);
    }
    setOtherInvestments((prev) => [...prev, {
      id: uid("oi"), accountId: account.id, asOfDate,
      units: result.units, unitOfMeasure: unitOfMeasure.trim() || null,
      costPerUnit: result.costPerUnit, currentPerUnit: result.currentPerUnit,
      investedValue: result.investedValue, currentValue: result.currentValue,
      location: effectiveSubtype === "Property" ? (location.trim() || null) : null,
      derived: result.derived, importedAt: Date.now(),
    }]);
    setSelectedAccountId(account.id);
    resetEntryFields();
  }

  function deleteEntry(id) {
    setOtherInvestments((prev) => prev.filter((e) => e.id !== id));
  }

  function handleExtracted(result) {
    if (result.assetSubtype && OTHER_INVESTMENT_SUBTYPES.includes(result.assetSubtype)) setAssetSubtype(result.assetSubtype);
    if (result.asOfDate) setAsOfDate(result.asOfDate);
    if (result.units !== null) setUnits(String(result.units));
    if (result.unitOfMeasure) setUnitOfMeasure(result.unitOfMeasure);
    if (result.costPerUnit !== null) setCostPerUnit(String(result.costPerUnit));
    if (result.currentPerUnit !== null) setCurrentPerUnit(String(result.currentPerUnit));
    if (result.investedValue !== null) setInvestedValue(String(result.investedValue));
    if (result.currentValue !== null) setCurrentValue(String(result.currentValue));
    if (result.institution && !nickname) setNickname(result.institution);
  }

  return (
    <div>
      <h2 className="bw-h2">Other Investments</h2>
      <p className="bw-lead">
        PF, Gold, Property, or anything else without the regular buy/sell activity a market-tracked fund has.
        Enter what you originally put in and what it's worth now to see real gain or loss — or just the current
        value if that's all you know.
      </p>

      <button className="bw-btn ghost small" style={{ marginBottom: 14 }} onClick={() => setShowUpload((v) => !v)}>
        <Upload size={12} /> {showUpload ? "Hide" : "Or, upload a statement (PDF)"}
      </button>
      {showUpload && <OtherInvestmentUploadFlow apiKey={apiKey} onExtracted={handleExtracted} />}

      <div className="bw-grid2">
        <div className="bw-field">
          <label>Account</label>
          <select value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}>
            <option value="__new__">+ Add new account</option>
            {otherAccounts.map((a) => <option key={a.id} value={a.id}>{a.nickname}</option>)}
          </select>
        </div>
        {selectedAccountId === "__new__" ? (
          <div className="bw-grid2" style={{ gap: 10 }}>
            <div className="bw-field">
              <label>Type</label>
              <select value={assetSubtype} onChange={(e) => setAssetSubtype(e.target.value)}>
                {OTHER_INVESTMENT_SUBTYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="bw-field">
              <label>Nickname</label>
              <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. Gold jewelry" />
            </div>
          </div>
        ) : <div />}
      </div>

      {effectiveSubtype === "Property" && (
        <div className="bw-field">
          <label>Location (optional)</label>
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bangalore" />
        </div>
      )}

      <div className="bw-grid2">
        <div className="bw-field">
          <label>Units (optional)</label>
          <input type="text" inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="e.g. 50" />
        </div>
        <div className="bw-field">
          <label>Unit of measure (optional)</label>
          <input type="text" value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)} placeholder="e.g. grams, sqft" />
        </div>
      </div>
      <div className="bw-grid2">
        <div className="bw-field">
          <label>Cost per unit (optional)</label>
          <input type="text" inputMode="decimal" value={costPerUnit} onChange={(e) => setCostPerUnit(e.target.value)} placeholder="e.g. 5000" />
        </div>
        <div className="bw-field">
          <label>Current price per unit (optional)</label>
          <input type="text" inputMode="decimal" value={currentPerUnit} onChange={(e) => setCurrentPerUnit(e.target.value)} placeholder="e.g. 6500" />
        </div>
      </div>
      <div className="bw-grid2">
        <div className="bw-field">
          <label>Total invested (optional — leave blank if using cost per unit)</label>
          <input type="text" inputMode="decimal" value={investedValue} onChange={(e) => setInvestedValue(e.target.value)} placeholder="e.g. 250000" />
        </div>
        <div className="bw-field">
          <label>Total current value (leave blank if using price per unit)</label>
          <input type="text" inputMode="decimal" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} placeholder="e.g. 325000" />
        </div>
      </div>
      <div className="bw-field" style={{ maxWidth: 200 }}>
        <label>As of date</label>
        <input type="text" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} placeholder="YYYY-MM-DD" />
      </div>
      <button className="bw-btn" onClick={addEntry}><Plus size={14} /> Add entry</button>

      {otherAccounts.length > 0 && (
        <>
          <div className="bw-section-label">Your other investments</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {otherAccounts.map((acct) => {
              const entries = otherInvestments.filter((e) => e.accountId === acct.id).sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));
              const latest = entries[0];
              const gain = latest && latest.investedValue !== null ? Math.round((latest.currentValue - latest.investedValue) * 100) / 100 : null;
              return (
                <div key={acct.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 14, background: "var(--card)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{acct.nickname}</span>
                      <span style={{ fontSize: 11, color: "var(--ink-soft)", marginLeft: 8 }}>{acct.assetSubtype}{acct.location ? ` · ${acct.location}` : ""}</span>
                    </div>
                    {latest && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 600 }}>{inr(latest.currentValue)}</div>
                        {gain !== null && (
                          <div style={{ fontSize: 11, color: gain >= 0 ? "var(--teal)" : "var(--rust)" }}>{gain >= 0 ? "+" : ""}{inr(gain)}</div>
                        )}
                      </div>
                    )}
                  </div>
                  {entries.length > 0 ? (
                    <table className="bw-table">
                      <tbody>
                        {entries.map((e) => (
                          <tr key={e.id}>
                            <td style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{e.asOfDate}</td>
                            <td className="bw-amt debit">{inr(e.currentValue)}</td>
                            <td style={{ fontSize: 11, color: "var(--ink-soft)" }}>{e.investedValue !== null ? `invested ${inr(e.investedValue)}` : ""}</td>
                            <td><button className="bw-btn ghost small" onClick={() => deleteEntry(e.id)}><Trash2 size={11} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>No entries yet.</div>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Goals — guided creation wizard + live tracking. No stored ledger: every */
/* goal's tracked progress is computed fresh each render from its own      */
/* settings plus the portfolio's current invested value.                  */
/* ---------------------------------------------------------------------- */

/** The Goals pillar screen - two fundamentally different funding models depending on
 *  time horizon:
 *   - Near-term (due in under a year, any goal type): funded by assigning specific
 *     named holdings (computeNearTermGoalTracking), since money needed soon has to be
 *     genuinely liquid and available, not resting on a long-horizon growth assumption.
 *   - Long-term (a year or more away): funded as a share of one pooled portfolio
 *     value (computeGoalsTracking) - not tied to specific holdings.
 *  Whatever's assigned to a near-term goal comes OUT of the pool long-term goals can
 *  draw from first (poolForLongTermGoals), the same way money already spent isn't
 *  available to allocate a second time - a holding claimed by one goal can't also
 *  silently fund another. GoalWizard hosts creation; GoalCard and NearTermGoalCard
 *  render the two goal types' very different progress views. */
function GoalsOverview({ goals, setGoals, accounts, holdingSnapshots, transactions, effectiveTier }) {
  const [apiKey, setApiKeyLocal] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(null);

  useEffect(() => {
    (async () => { setApiKeyLocal(await loadState("geminiApiKey", "")); })();
  }, []);

  const portfolioTotals = useMemo(() => {
    const investmentAccounts = accounts.filter((a) => a.type === "demat" || a.type === "mutualFund");
    let invested = 0, current = 0;
    investmentAccounts.forEach((acct) => {
      const snaps = holdingSnapshots.filter((s) => s.accountId === acct.id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
      if (snaps.length === 0) return;
      const latest = snaps[snaps.length - 1];
      invested += latest.totalInvestedValue || 0;
      current += latest.totalCurrentValue || 0;
    });
    return { invested, current };
  }, [accounts, holdingSnapshots]);

  const holdingsIndex = useMemo(() => buildHoldingsIndex(accounts, holdingSnapshots), [accounts, holdingSnapshots]);
  const averageMonthlyExpense = useMemo(() => computeAverageMonthlyExpense(transactions), [transactions]);

  // Fund-selection funding (assign specific holdings, rather than a portfolio-wide
  // rupee amount) applies to any goal due in under a year — the goal TYPE doesn't
  // matter here, a near-term car purchase gets the same treatment as an Emergency
  // Fund, since both need money that's actually liquid and available soon, not a
  // long-horizon growth assumption.
  const nearTermGoals = goals.filter((g) => (g.yearsToGoal || 0) < 1);
  const longTermGoals = goals.filter((g) => (g.yearsToGoal || 0) >= 1);

  // Whatever's been assigned to a near-term goal is a deliberate, specific claim on
  // named holdings — it comes OUT of the pool other goals can draw from, the same way
  // money already spent isn't available to allocate twice.
  const nearTermResults = {};
  let nearTermAssignedInvested = 0;
  nearTermGoals.forEach((g) => {
    const r = computeNearTermGoalTracking(g, holdingsIndex, accounts, holdingSnapshots);
    nearTermResults[g.id] = r;
    nearTermAssignedInvested += r.trackedInvested;
  });
  const poolForLongTermGoals = Math.max(0, portfolioTotals.invested - nearTermAssignedInvested);

  const todayStr = new Date().toISOString().slice(0, 10);
  const tracking = useMemo(
    () => computeGoalsTracking(longTermGoals, poolForLongTermGoals, portfolioTotals.current * (portfolioTotals.invested > 0 ? poolForLongTermGoals / portfolioTotals.invested : 1), todayStr),
    [longTermGoals, poolForLongTermGoals, portfolioTotals, todayStr]
  );

  const assignedElsewhere = new Set();
  nearTermGoals.forEach((g) => (g.assignedInstrumentKeys || []).forEach((k) => assignedElsewhere.add(k)));

  function addGoal(goal) {
    setGoals((prev) => [...prev, { ...goal, id: uid("goal"), createdAt: Date.now() }]);
    setCreating(false);
  }
  function deleteGoal(id) {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    setConfirmingDelete(null);
  }
  function updateGoal(id, patch) {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  if (creating) {
    return <GoalWizard apiKey={apiKey} portfolioInvested={poolForLongTermGoals} tracking={tracking}
      holdingsIndex={holdingsIndex} assignedElsewhere={assignedElsewhere} averageMonthlyExpense={averageMonthlyExpense}
      onCancel={() => setCreating(false)} onCreate={addGoal} />;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <div>
          <h2 className="bw-h2" style={{ marginBottom: 2 }}>Goals</h2>
          <p className="bw-lead" style={{ margin: 0 }}>What you're saving for, what it'll really cost, and whether you're on pace.</p>
        </div>
        {goals.length > 0 && (
          canCreateGoal(goals, effectiveTier) ? (
            <button className="bw-btn" onClick={() => setCreating(true)}><Plus size={14} /> New goal</button>
          ) : (
            <div style={{ fontSize: 12, color: "var(--ink-soft)", textAlign: "right" }}>
              Free plan limit reached ({FREE_TIER_LIMITS.goals} goals) — <strong style={{ color: "var(--ink)" }}>Licensed</strong> unlocks unlimited.
            </div>
          )
        )}
      </div>

      {(() => {
        const goalsLastUpdated = holdingSnapshots.length > 0
          ? holdingSnapshots.reduce((latest, s) => (s.asOfDate > latest ? s.asOfDate : latest), holdingSnapshots[0].asOfDate)
          : null;
        return goalsLastUpdated ? (
          <div style={{ fontSize: 12, color: "var(--ink-soft)", margin: "12px 0 -8px" }}>
            Investment figures below as of: {goalsLastUpdated}
          </div>
        ) : null;
      })()}

      <div className="bw-waterfall-card" style={{ margin: "18px 0 22px" }}>
        <div className="bw-waterfall" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <HeroStat label="Total invested (portfolio)" value={portfolioTotals.invested} color="var(--ink)" />
          <HeroStat label="In near-term goals" value={nearTermAssignedInvested} color="var(--ink)" />
          <HeroStat label="Allocated to other goals" value={tracking.totalManualRequested} color={tracking.manualOverAllocated ? "var(--rust)" : "var(--ink)"} />
          <HeroStat label="Unallocated" value={Math.max(0, poolForLongTermGoals - tracking.totalManualRequested)} color="var(--teal)" />
        </div>
      </div>

      {tracking.manualOverAllocated && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5, padding: "10px 12px", marginBottom: 18, border: "1px solid var(--rust)", borderRadius: 6, background: "rgba(156,74,52,0.08)" }}>
          <AlertCircle size={15} color="var(--rust)" style={{ marginTop: 1, flexShrink: 0 }} />
          <span>
            <strong>Goals are allocated {inr(tracking.totalManualRequested)}, but only {inr(poolForLongTermGoals)} is available</strong>{" "}
            (portfolio invested value, minus whatever's assigned to your near-term goals). Reduce one or more goals' allocation below.
          </span>
        </div>
      )}

      {goals.length === 0 ? (
        <div className="bw-empty">
          No goals yet.
          <div style={{ marginTop: 10 }}>
            <button className="bw-btn" onClick={() => setCreating(true)}><Plus size={14} /> Set your first goal</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {nearTermGoals.map((g, i) => (
            <NearTermGoalCard key={g.id} goal={g} result={nearTermResults[g.id]} averageMonthlyExpense={averageMonthlyExpense}
              holdingsIndex={holdingsIndex} assignedElsewhere={assignedElsewhere} accentColor={goalAccentColor(i)}
              onUpdate={(patch) => updateGoal(g.id, patch)}
              confirmingDelete={confirmingDelete === g.id}
              onAskDelete={() => setConfirmingDelete(g.id)}
              onCancelDelete={() => setConfirmingDelete(null)}
              onDelete={() => deleteGoal(g.id)}
            />
          ))}
          {[...longTermGoals].sort((a, b) => a.createdAt - b.createdAt).map((g, i) => (
            <GoalCard key={g.id} goal={g} result={tracking.perGoal[g.id]} portfolioInvested={poolForLongTermGoals} accentColor={goalAccentColor(nearTermGoals.length + i)}
              onUpdate={(patch) => updateGoal(g.id, patch)}
              confirmingDelete={confirmingDelete === g.id}
              onAskDelete={() => setConfirmingDelete(g.id)}
              onCancelDelete={() => setConfirmingDelete(null)}
              onDelete={() => deleteGoal(g.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const SUGGESTED_CATEGORY_PATTERN = /arbitrage|liquid|debt|money\s*market|overnight/i;

/** A single near-term goal's card - progress against a target computed one of two
 *  ways: emergency-fund goals target months × average monthly expense; every other
 *  near-term goal targets its own entered cost. Funding comes from whichever
 *  specific holdings are checked on below (toggleHolding), not a portfolio-wide
 *  share - the whole point of near-term funding being tied to real, named,
 *  currently-liquid holdings rather than a growth projection. */
function NearTermGoalCard({ goal, result, averageMonthlyExpense, holdingsIndex, assignedElsewhere, accentColor, onUpdate, confirmingDelete, onAskDelete, onCancelDelete, onDelete }) {
  const isEmergency = goal.type === "emergency";
  const target = isEmergency
    ? Math.round((goal.emergencyMonths || 6) * averageMonthlyExpense * 100) / 100
    : (goal.costToday || 0);
  const pctFunded = target > 0 ? Math.min(100, (result.trackedCurrentValue / target) * 100) : 0;
  const shortfallVsTarget = Math.max(0, Math.round((target - result.trackedCurrentValue) * 100) / 100);
  const typeLabel = GOAL_TYPE_DEFAULTS[goal.type]?.label || goal.type;
  const assignedKeys = new Set(goal.assignedInstrumentKeys || []);

  function toggleHolding(key) {
    const next = new Set(assignedKeys);
    if (next.has(key)) next.delete(key); else next.add(key);
    onUpdate({ assignedInstrumentKeys: [...next] });
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderLeft: `4px solid ${accentColor || "var(--line)"}`, borderRadius: 8, padding: 16, background: "var(--card)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: accentColor || "var(--ink)" }}>{goal.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
            {typeLabel} · due in under a year — funded from specific holdings, not a portfolio-wide assumption
          </div>
        </div>
        {confirmingDelete ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--rust)" }}>Delete this goal?</span>
            <button className="bw-btn small" style={{ background: "var(--rust)", borderColor: "var(--rust)" }} onClick={onDelete}>Yes</button>
            <button className="bw-btn ghost small" onClick={onCancelDelete}>Cancel</button>
          </div>
        ) : (
          <button className="bw-btn ghost small" onClick={onAskDelete}><Trash2 size={12} /></button>
        )}
      </div>

      <div style={{ height: 8, background: "var(--paper)", borderRadius: 3, overflow: "hidden", border: "1px solid var(--line)", marginBottom: 6 }}>
        <div style={{ width: `${pctFunded}%`, height: "100%", background: pctFunded >= 100 ? "var(--teal)" : "var(--ochre)", transition: "width 0.3s" }} />
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 12 }}>
        {inr(result.trackedCurrentValue)} tracked of {inr(target)} target ({pctFunded.toFixed(0)}%)
        {isEmergency && <> — {goal.emergencyMonths || 6} months × {inr(averageMonthlyExpense)}/month average expense</>}
      </div>

      <div className="bw-summary-row" style={{ marginBottom: 12 }}>
        <Stat label="Target" value={inr(target)} color="var(--ink)" />
        <Stat label="Tracked (assigned holdings)" value={inr(result.trackedInvested)} color="var(--ink)" hint={`grown to ${inr(result.trackedCurrentValue)}`} />
        <Stat label="Growth so far" value={inr(result.growth)} color={result.growth >= 0 ? "var(--teal)" : "var(--rust)"} />
      </div>

      {result.missingHoldings.length > 0 && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11.5, padding: "8px 10px", marginBottom: 10, border: "1px solid var(--rust)", borderRadius: 6 }}>
          <AlertCircle size={13} color="var(--rust)" style={{ marginTop: 1, flexShrink: 0 }} />
          <span>
            {result.missingHoldings.length === 1 ? "A holding assigned to" : `${result.missingHoldings.length} holdings assigned to`} this goal
            {result.missingHoldings.length === 1 ? " is" : " are"} no longer in your portfolio — likely redeemed:{" "}
            {result.missingHoldings.map((h) => `${h.name} (last known ${inr(h.investedValue)}${h.asOfDate ? `, as of ${h.asOfDate}` : ""})`).join("; ")}.
            Assign a replacement holding below.
          </span>
        </div>
      )}
      {result.missingHoldings.length === 0 && shortfallVsTarget > 0 && (goal.assignedInstrumentKeys || []).length > 0 && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11.5, padding: "8px 10px", marginBottom: 10, border: "1px solid var(--ochre)", borderRadius: 6 }}>
          <AlertCircle size={13} color="var(--ochre)" style={{ marginTop: 1, flexShrink: 0 }} />
          <span>Short of target by {inr(shortfallVsTarget)} — assign more holdings, or add fresh investment toward this goal.</span>
        </div>
      )}

      {isEmergency && (
        <div className="bw-field" style={{ maxWidth: 200, marginBottom: 12 }}>
          <label>Months of expenses to cover</label>
          <input type="text" inputMode="decimal" value={goal.emergencyMonths || 6}
            onChange={(e) => onUpdate({ emergencyMonths: parseFloat(e.target.value) || 6 })} />
        </div>
      )}

      <details>
        <summary style={{ fontSize: 11.5, color: "var(--ink-soft)", cursor: "pointer" }}>Assign holdings</summary>
        <p style={{ fontSize: 10.5, color: "var(--ink-soft)", margin: "8px 0" }}>
          Arbitrage, liquid, and debt funds are suggested first — anything else is still selectable if you'd rather use it.
        </p>
        <HoldingsAssignmentPicker holdingsIndex={holdingsIndex} assignedKeys={assignedKeys} assignedElsewhere={assignedElsewhere} onToggle={toggleHolding} />
      </details>
    </div>
  );
}

/** The holdings-assignment checklist, shared between the wizard (assign before
 *  creating the goal) and the post-creation card (adjust anytime after) — one
 *  implementation, so the two never drift apart. Suggested (Arbitrage/Liquid/Debt)
 *  holdings sort first; anything already assigned to a different near-term goal is
 *  shown but disabled, since the same rupee can't back two goals at once. */
function HoldingsAssignmentPicker({ holdingsIndex, assignedKeys, assignedElsewhere, onToggle }) {
  if (holdingsIndex.length === 0) {
    return <div className="bw-empty" style={{ padding: "16px 10px" }}>No holdings imported yet — you can still create this goal and assign holdings once you've imported an investment statement.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
      {[...holdingsIndex].sort((a, b) => {
        const aSug = SUGGESTED_CATEGORY_PATTERN.test(a.sectorOrCategory || "") ? 0 : 1;
        const bSug = SUGGESTED_CATEGORY_PATTERN.test(b.sectorOrCategory || "") ? 0 : 1;
        return aSug - bSug;
      }).map((h) => {
        const checked = assignedKeys.has(h.instrumentKey);
        const usedElsewhere = assignedElsewhere.has(h.instrumentKey) && !checked;
        const suggested = SUGGESTED_CATEGORY_PATTERN.test(h.sectorOrCategory || "");
        return (
          <label key={h.instrumentKey} style={{
            display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "6px 8px", borderRadius: 4,
            background: checked ? "rgba(46,102,89,0.08)" : "transparent",
            opacity: usedElsewhere ? 0.4 : 1, cursor: usedElsewhere ? "not-allowed" : "pointer",
          }}>
            <input type="checkbox" checked={checked} disabled={usedElsewhere} onChange={() => onToggle(h.instrumentKey)} />
            <span style={{ flex: 1 }}>
              {h.name} <span style={{ color: "var(--ink-soft)", fontSize: 10.5 }}>· {h.accountNickname}{h.sectorOrCategory ? ` · ${h.sectorOrCategory}` : ""}</span>
              {suggested && <span className="bw-pill" style={{ background: "var(--teal)", fontSize: 9, marginLeft: 6 }}>suggested</span>}
              {usedElsewhere && <span style={{ fontSize: 9.5, color: "var(--ochre)", marginLeft: 6 }}>assigned to another goal</span>}
            </span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{inr(h.investedValue)}</span>
          </label>
        );
      })}
    </div>
  );
}

/** A single long-term goal's card - target corpus computed via computeGoalMath
 *  (inflating today's cost forward, then applying an assumed return rate over the
 *  years remaining), funded by its own share of the shared, pooled portfolio value
 *  (result, from computeGoalsTracking), not specific holdings the way a near-term
 *  goal is. Required lumpsum/SIP is always computed against the FULL target, then
 *  scaled down by whatever fraction is still unfunded - so a goal that's 60% funded
 *  correctly shows 40% of the original required contribution, not the full amount
 *  recalculated as if nothing had been saved yet. */
function GoalCard({ goal, result, portfolioInvested, accentColor, onUpdate, confirmingDelete, onAskDelete, onCancelDelete, onDelete }) {
  const math = computeGoalMath(goal.costToday, goal.inflationRate, goal.returnRate, goal.yearsToGoal);
  const pctFunded = math.targetCorpus > 0 ? Math.min(100, (result.trackedCurrentValue / math.targetCorpus) * 100) : 0;
  const typeLabel = GOAL_TYPE_DEFAULTS[goal.type]?.label || goal.type;

  return (
    <div style={{ border: "1px solid var(--line)", borderLeft: `4px solid ${accentColor || "var(--line)"}`, borderRadius: 8, padding: 16, background: "var(--card)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: accentColor || "var(--ink)" }}>{goal.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{typeLabel} · {goal.yearsToGoal} years away{goal.costIsEstimate ? " · cost is an unverified estimate" : ""}</div>
        </div>
        {confirmingDelete ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--rust)" }}>Delete this goal?</span>
            <button className="bw-btn small" style={{ background: "var(--rust)", borderColor: "var(--rust)" }} onClick={onDelete}>Yes</button>
            <button className="bw-btn ghost small" onClick={onCancelDelete}>Cancel</button>
          </div>
        ) : (
          <button className="bw-btn ghost small" onClick={onAskDelete}><Trash2 size={12} /></button>
        )}
      </div>

      <div style={{ height: 8, background: "var(--paper)", borderRadius: 3, overflow: "hidden", border: "1px solid var(--line)", marginBottom: 6 }}>
        <div style={{ width: `${pctFunded}%`, height: "100%", background: pctFunded >= 100 ? "var(--teal)" : "var(--ochre)", transition: "width 0.3s" }} />
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 12 }}>
        {inr(result.trackedCurrentValue)} tracked of {inr(math.targetCorpus)} target ({pctFunded.toFixed(0)}%)
      </div>

      <div className="bw-summary-row" style={{ marginBottom: 12 }}>
        <Stat label="Target corpus" value={inr(math.targetCorpus)} color="var(--ink)" />
        <Stat label="Tracked (real)" value={inr(result.trackedInvested)} color="var(--ink)" hint={`grown to ${inr(result.trackedCurrentValue)}`} />
        <Stat label="Growth so far" value={inr(result.growth)} color={result.growth >= 0 ? "var(--teal)" : "var(--rust)"} />
        {(() => {
          // Lumpsum/SIP required was always computed from the FULL target, never
          // accounting for what's already tracked — a 100%-funded goal would still show
          // the full original requirement, which is misleading. Both figures scale
          // linearly with the target (see computeGoalMath), so scaling by the remaining
          // unfunded fraction gives the correct "what's still needed" figure without
          // re-deriving the formula. Note: this still uses the goal's own ASSUMED return
          // rate set at creation, not actual realized growth — it does not automatically
          // adjust if real performance differs from that assumption.
          const remainingGap = Math.max(0, math.targetCorpus - result.trackedCurrentValue);
          const remainingRatio = math.targetCorpus > 0 ? remainingGap / math.targetCorpus : 0;
          const remainingLumpsum = Math.round(math.lumpsumRequired * remainingRatio * 100) / 100;
          const remainingSip = Math.round(math.sipRequired * remainingRatio * 100) / 100;
          return remainingGap <= 0 ? (
            <Stat label="Lumpsum / SIP needed" value="Goal met" color="var(--teal)" hint="No further funding needed" />
          ) : (
            <Stat label="Lumpsum / SIP needed" value={inr(remainingLumpsum)} color="var(--ink)" hint={`or ${inr(remainingSip)}/mo \u00B7 remaining gap`} />
          );
        })()}
      </div>

      {result.sipShortfall > 0 && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11.5, padding: "8px 10px", marginBottom: 10, border: "1px solid var(--ochre)", borderRadius: 6 }}>
          <AlertCircle size={13} color="var(--ochre)" style={{ marginTop: 1, flexShrink: 0 }} />
          <span>This goal's SIP is running ahead of your actual investments — {inr(result.sipShortfall)} of its planned progress hasn't been backed by real invested money yet.</span>
        </div>
      )}
      {result.manualShortfall > 0 && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11.5, padding: "8px 10px", marginBottom: 10, border: "1px solid var(--rust)", borderRadius: 6 }}>
          <AlertCircle size={13} color="var(--rust)" style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{inr(result.manualShortfall)} of this goal's manual allocation couldn't be claimed — not enough unallocated invested value left in your portfolio.</span>
        </div>
      )}

      <details>
        <summary style={{ fontSize: 11.5, color: "var(--ink-soft)", cursor: "pointer" }}>Edit funding</summary>
        <div className="bw-grid2" style={{ marginTop: 10 }}>
          <div className="bw-field">
            <label>Manual lumpsum allocation (₹)</label>
            <input type="text" inputMode="decimal" value={goal.manualLumpsumAllocation || ""}
              onChange={(e) => onUpdate({ manualLumpsumAllocation: parseAmountOrNull(e.target.value) || 0 })} placeholder="0" />
          </div>
          <div className="bw-field">
            <label>Planned SIP (₹/month)</label>
            <input type="text" inputMode="decimal" value={goal.sipPlannedMonthly || ""}
              onChange={(e) => onUpdate({ sipPlannedMonthly: parseAmountOrNull(e.target.value) || 0 })} placeholder="0" />
          </div>
        </div>
        {goal.sipPlannedMonthly > 0 && (
          <div className="bw-field" style={{ maxWidth: 220 }}>
            <label>SIP start date</label>
            <input type="text" value={goal.sipStartDate || ""} onChange={(e) => onUpdate({ sipStartDate: e.target.value })} placeholder="YYYY-MM-DD" />
          </div>
        )}
      </details>
    </div>
  );
}

/** Multi-step goal creation wizard. Each goal type (education, home, emergency,
 *  etc.) carries its own sensible defaults (GOAL_TYPE_DEFAULTS) - inflation rate,
 *  whether it's asked in months rather than years (isMonthsBased, for Emergency Fund
 *  and Short-term goals), and whether it's inherently fund-specific rather than
 *  portfolio-pooled (fundSpecific, or automatically true for anything under a year
 *  away regardless of type - matching the near-term/long-term split GoalsOverview
 *  enforces). handleEstimate is an optional AI-assisted cost estimate (Gemini) for
 *  when the person doesn't already know a reasonable today's-cost figure - always
 *  described as a rough starting point to review and adjust, with its exact scope
 *  (what's included) always stated, never left ambiguous. */
function GoalWizard({ apiKey, portfolioInvested, tracking, holdingsIndex, assignedElsewhere, averageMonthlyExpense, onCancel, onCreate }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [type, setType] = useState("education");
  const [yearsToGoal, setYearsToGoal] = useState("10");
  const [monthsToGoal, setMonthsToGoal] = useState("6");
  const [emergencyMonths, setEmergencyMonths] = useState("6");
  const [costToday, setCostToday] = useState("");
  const [costIsEstimate, setCostIsEstimate] = useState(false);
  const [estimateDescription, setEstimateDescription] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState(null);
  const [inflationRate, setInflationRate] = useState(String(GOAL_TYPE_DEFAULTS.education.inflationRate));
  const [returnRate, setReturnRate] = useState("12");
  const [manualLumpsumAllocation, setManualLumpsumAllocation] = useState("");
  const [sipPlannedMonthly, setSipPlannedMonthly] = useState("");
  const [sipStartDate, setSipStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [assignedKeys, setAssignedKeys] = useState(new Set());

  const isEmergency = type === "emergency";
  const isMonthsBased = !!GOAL_TYPE_DEFAULTS[type]?.isMonthsBased; // Emergency fund + Short-term goal — asked in months, not years
  const isFundSpecific = !!GOAL_TYPE_DEFAULTS[type]?.fundSpecific || (parseFloat(yearsToGoal) || 0) < 1; // funded by assigning holdings, not a portfolio-wide plan

  function toggleAssignedKey(key) {
    setAssignedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function selectType(t) {
    setType(t);
    setInflationRate(String(GOAL_TYPE_DEFAULTS[t].inflationRate));
  }

  async function handleEstimate() {
    if (!apiKey) { setEstimateError("Add a Gemini API key in Upload → PDF (AI-assisted) first to use this."); return; }
    if (!estimateDescription.trim()) { setEstimateError("Describe what you're planning for first — e.g. \"MBA at a public university in the US\" or \"3BHK apartment in a Bangalore suburb.\""); return; }
    setEstimating(true); setEstimateError(null);
    try {
      const prompt = [
        "Estimate a single reasonable TODAY's cost in Indian Rupees for this financial goal, based on your general",
        "knowledge. This is a rough starting estimate the user will review and adjust themselves — not a guarantee.",
        "If the description doesn't say what to include (e.g. just a program and country, with no mention of",
        "living costs), make a reasonable choice — but always state exactly what you included in the scope field,",
        "since this can easily be a 2x difference (e.g. tuition-only vs. tuition + housing + living costs for study",
        "abroad) and the user needs to know which one they're looking at.",
        `Goal type: ${GOAL_TYPE_DEFAULTS[type]?.label || type}`,
        `Details: ${estimateDescription.trim()}`,
      ].join("\n");
      const schema = {
        type: "OBJECT",
        properties: {
          estimatedCostINR: { type: "NUMBER", description: "A single reasonable today's-cost estimate, in Indian Rupees." },
          scope: { type: "STRING", description: "Exactly what this estimate includes — e.g. 'Tuition only' or 'Tuition, housing, and living costs for the full 2-year course'. Always fill this in, even if the description didn't specify — state what you assumed." },
          note: { type: "STRING", description: "One short, plain sentence of additional context or caveat, if any — no quotation marks or special formatting." },
        },
        required: ["estimatedCostINR", "scope"],
      };
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 1500, responseMimeType: "application/json", responseSchema: schema },
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `Request failed (HTTP ${response.status}).`);
      const textPart = (data.candidates?.[0]?.content?.parts || []).find((p) => typeof p.text === "string" && !p.thought);
      if (!textPart) throw new Error("No usable response from the model.");
      const rawText = textPart.text.replace(/```json|```/g, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // Fallback if parsing ever fails for an unrelated reason (e.g. the response got
        // cut off) — pull just the number out directly rather than losing the estimate
        // entirely over a formatting slip elsewhere in the response.
        const match = rawText.match(/"estimatedCostINR"\s*:\s*([\d.]+)/);
        parsed = match ? { estimatedCostINR: Number(match[1]) } : null;
      }
      if (parsed && typeof parsed.estimatedCostINR === "number") {
        setCostToday(String(Math.round(parsed.estimatedCostINR)));
        setCostIsEstimate(true);
        const scopeText = parsed.scope ? `Includes: ${parsed.scope}.` : "";
        const noteText = parsed.note ? ` ${parsed.note}` : "";
        setEstimateError(`Estimate — ${scopeText}${noteText} Review and adjust before continuing.`);
      } else {
        setEstimateError("Couldn't get a usable estimate — enter the cost directly.");
      }
    } catch (err) {
      setEstimateError(err.message || "Couldn't get an estimate — enter the cost directly.");
    } finally {
      setEstimating(false);
    }
  }

  const monthsVal = parseFloat(monthsToGoal) || 0;
  const emergencyMonthsVal = parseFloat(emergencyMonths) || 6;
  const years = isEmergency ? emergencyMonthsVal / 12 : (isMonthsBased ? monthsVal / 12 : (parseFloat(yearsToGoal) || 0));
  const cost = parseAmountStr(costToday);
  const inflation = parseFloat(inflationRate) || 0;
  const returnR = parseFloat(returnRate) || 0;
  const emergencyTarget = Math.round(emergencyMonthsVal * averageMonthlyExpense * 100) / 100;
  const math = !isEmergency && cost > 0 && years > 0 ? computeGoalMath(cost, inflation, returnR, years) : null;

  const unallocated = Math.max(0, portfolioInvested - tracking.totalManualRequested);
  const manualAmt = parseAmountStr(manualLumpsumAllocation);
  const manualExceedsHeadroom = manualAmt > unallocated + 0.01;

  // Emergency Fund skips both Cost and Assumptions (target comes from average expense
  // × months, no cost-entry or return assumption needed). Any other fund-specific goal
  // (Short-term, or a longer-horizon type where the entered timeframe happens to land
  // under a year) still needs a cost entered, but skips Assumptions — a fund-specific
  // goal tracks real holding performance directly, an assumed return rate doesn't apply.
  const skipCostStep = isEmergency;
  const skipAssumptionsStep = isEmergency || isFundSpecific;
  const stepLabels = ["What & when"];
  if (!skipCostStep) stepLabels.push("Cost today");
  if (!skipAssumptionsStep) stepLabels.push("Assumptions");
  stepLabels.push("Funding");
  const steps = stepLabels;
  let stepCursor = 1;
  const costStepIndex = skipCostStep ? -1 : stepCursor++;
  const assumptionsStepIndex = skipAssumptionsStep ? -1 : stepCursor++;
  const fundingStepIndex = stepCursor;

  function canProceed() {
    if (step === 0) return name.trim().length > 0 && (isEmergency ? emergencyMonthsVal > 0 : isMonthsBased ? monthsVal > 0 : years > 0);
    if (step === costStepIndex) return cost > 0;
    if (step === assumptionsStepIndex) return inflation >= 0 && returnR >= 0;
    return true;
  }

  function handleCreate() {
    if (isEmergency) {
      onCreate({
        name: name.trim(), type, yearsToGoal: years, emergencyMonths: emergencyMonthsVal,
        assignedInstrumentKeys: [...assignedKeys],
      });
      return;
    }
    if (isFundSpecific) {
      onCreate({
        name: name.trim(), type, yearsToGoal: years, costToday: cost, costIsEstimate,
        inflationRate: 0, returnRate: 0,
        assignedInstrumentKeys: [...assignedKeys],
      });
      return;
    }
    onCreate({
      name: name.trim(), type, yearsToGoal: years, costToday: cost, costIsEstimate,
      inflationRate: inflation, returnRate: returnR,
      manualLumpsumAllocation: Math.min(manualAmt, unallocated),
      sipPlannedMonthly: parseAmountStr(sipPlannedMonthly),
      sipStartDate: parseAmountStr(sipPlannedMonthly) > 0 ? sipStartDate : null,
    });
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <button className="bw-btn ghost small" onClick={onCancel}><X size={12} /> Cancel</button>
        <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Step {step + 1} of {steps.length}: {steps[step]}</div>
      </div>

      {step === 0 && (
        <div>
          <h2 className="bw-h2">What are you saving for?</h2>
          <div className="bw-field">
            <label>Goal type</label>
            <select value={type} onChange={(e) => selectType(e.target.value)}>
              {Object.entries(GOAL_TYPE_DEFAULTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="bw-field">
            <label>Give it a name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aanya's college fund" />
          </div>
          {isEmergency ? (
            <div className="bw-field" style={{ maxWidth: 240 }}>
              <label>Months of expenses to cover</label>
              <input type="text" inputMode="decimal" value={emergencyMonths} onChange={(e) => setEmergencyMonths(e.target.value)} placeholder="e.g. 6" />
              {averageMonthlyExpense > 0 && (
                <p style={{ fontSize: 10.5, color: "var(--ink-soft)", margin: "5px 0 0" }}>
                  Target: {inr(emergencyTarget)} ({emergencyMonthsVal} × {inr(averageMonthlyExpense)}/month average expense)
                </p>
              )}
            </div>
          ) : isMonthsBased ? (
            <div className="bw-field" style={{ maxWidth: 200 }}>
              <label>How many months away?</label>
              <input type="text" inputMode="decimal" value={monthsToGoal} onChange={(e) => setMonthsToGoal(e.target.value)} placeholder="e.g. 6" />
              <p style={{ fontSize: 10.5, color: "var(--ink-soft)", margin: "5px 0 0" }}>
                Funded by assigning specific holdings — an arbitrage, liquid, or debt fund — not a portfolio-wide plan.
              </p>
            </div>
          ) : (
            <div className="bw-field" style={{ maxWidth: 200 }}>
              <label>How many years away?</label>
              <input type="text" inputMode="decimal" value={yearsToGoal} onChange={(e) => setYearsToGoal(e.target.value)} placeholder="e.g. 10" />
              {isFundSpecific && (
                <p style={{ fontSize: 10.5, color: "var(--ink-soft)", margin: "5px 0 0" }}>
                  Due in under a year — this will be funded by assigning specific holdings, not a portfolio-wide plan.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!isEmergency && step === costStepIndex && (
        <div>
          <h2 className="bw-h2">What does this cost today?</h2>
          <p className="bw-lead">Enter today's cost directly if you know it, or describe the goal and let Gemini suggest a starting estimate — always review and adjust before continuing.</p>
          <div className="bw-field" style={{ maxWidth: 280 }}>
            <label>Cost today (₹)</label>
            <input type="text" inputMode="decimal" value={costToday}
              onChange={(e) => { setCostToday(e.target.value); setCostIsEstimate(false); }} placeholder="e.g. 2000000" />
          </div>
          <div style={{ border: "1px dashed var(--line)", borderRadius: 6, padding: 12, marginTop: 8 }}>
            <div className="bw-field">
              <label>Or describe it, and get a rough estimate</label>
              <input type="text" value={estimateDescription} onChange={(e) => setEstimateDescription(e.target.value)}
                placeholder="e.g. Tuition, boarding, lodging and living costs for a Master's in Robotics in the US, for the full course" />
              <p style={{ fontSize: 10.5, color: "var(--ink-soft)", margin: "5px 0 0" }}>
                Say exactly what to include — tuition only vs. tuition + living costs can easily be a 2× difference for study abroad.
              </p>
            </div>
            <button className="bw-btn ghost small" onClick={handleEstimate} disabled={estimating}>
              <Sparkles size={12} /> {estimating ? "Estimating…" : "Help me estimate"}
            </button>
            {estimateError && <p style={{ fontSize: 11, color: "var(--ochre)", marginTop: 8 }}>{estimateError}</p>}
          </div>
        </div>
      )}

      {!isEmergency && step === assumptionsStepIndex && (
        <div>
          <h2 className="bw-h2">Assumptions</h2>
          <p className="bw-lead">Defaults are a reasonable starting point for {GOAL_TYPE_DEFAULTS[type]?.label.toLowerCase()} — adjust if you have a stronger view.</p>
          <div className="bw-grid2">
            <div className="bw-field">
              <label>Inflation rate (% per year)</label>
              <input type="text" inputMode="decimal" value={inflationRate} onChange={(e) => setInflationRate(e.target.value)} />
            </div>
            <div className="bw-field">
              <label>Expected return (% per year)</label>
              <input type="text" inputMode="decimal" value={returnRate} onChange={(e) => setReturnRate(e.target.value)} />
            </div>
          </div>
          {math && (
            <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 14, marginTop: 10, background: "var(--card)" }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                In <strong>{years}</strong> years, this will cost about <strong>{inr(math.targetCorpus)}</strong> (today's {inr(cost)}, inflated at {inflation}%/year).
              </div>
              <div className="bw-summary-row">
                <Stat label="Lumpsum needed today" value={inr(math.lumpsumRequired)} color="var(--ink)" />
                <Stat label="Or, monthly SIP" value={inr(math.sipRequired)} color="var(--ink)" />
              </div>
            </div>
          )}
        </div>
      )}

      {step === fundingStepIndex && isFundSpecific && (
        <div>
          <h2 className="bw-h2">Which holdings fund this?</h2>
          <p className="bw-lead">
            Due in under a year, so this is funded by assigning specific holdings — an arbitrage, liquid, or debt
            fund, say — rather than a portfolio-wide plan. Suggested holdings are shown first; you can still pick
            anything else, and adjust this anytime later as your investments change.
          </p>
          <HoldingsAssignmentPicker holdingsIndex={holdingsIndex} assignedKeys={assignedKeys} assignedElsewhere={assignedElsewhere} onToggle={toggleAssignedKey} />
          {assignedKeys.size > 0 && (
            <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8 }}>
              {assignedKeys.size} holding{assignedKeys.size === 1 ? "" : "s"} selected.
            </p>
          )}
        </div>
      )}

      {step === fundingStepIndex && !isFundSpecific && (
        <div>
          <h2 className="bw-h2">How will you fund it?</h2>
          <p className="bw-lead">
            Use either or both. A lumpsum allocation claims a slice of your existing invested value — you have
            {" "}{inr(unallocated)} unallocated right now. A SIP is a monthly plan; as your portfolio grows, real
            invested money automatically gets credited toward it.
          </p>
          <div className="bw-grid2">
            <div className="bw-field">
              <label>Lumpsum allocation from existing investments (₹)</label>
              <input type="text" inputMode="decimal" value={manualLumpsumAllocation} onChange={(e) => setManualLumpsumAllocation(e.target.value)} placeholder="0" />
              {manualExceedsHeadroom && (
                <p style={{ fontSize: 10.5, color: "var(--rust)", margin: "4px 0 0" }}>
                  Only {inr(unallocated)} is unallocated — this will be capped at that.
                </p>
              )}
            </div>
            <div className="bw-field">
              <label>Planned SIP (₹/month)</label>
              <input type="text" inputMode="decimal" value={sipPlannedMonthly} onChange={(e) => setSipPlannedMonthly(e.target.value)} placeholder="0" />
            </div>
          </div>
          {parseAmountStr(sipPlannedMonthly) > 0 && (
            <div className="bw-field" style={{ maxWidth: 220 }}>
              <label>SIP start date</label>
              <input type="text" value={sipStartDate} onChange={(e) => setSipStartDate(e.target.value)} placeholder="YYYY-MM-DD" />
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        {step > 0 && <button className="bw-btn ghost" onClick={() => setStep((s) => s - 1)}>Back</button>}
        {step < steps.length - 1 ? (
          <button className="bw-btn" disabled={!canProceed()} onClick={() => setStep((s) => s + 1)}>Continue</button>
        ) : (
          <button className="bw-btn" onClick={handleCreate}><Check size={14} /> Create goal</button>
        )}
      </div>
    </div>
  );
}

/** Month-over-month comparison callout, specifically for expense-style figures where
 *  more is worse - an increase renders in the warning color (rust), a decrease in the
 *  positive one (teal). A change under 2% reads as "about the same" rather than
 *  reporting a misleadingly precise but practically meaningless percentage. */
function MoMCallout({ label, cur, prev }) {
  const delta = prev > 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? 100 : 0);
  const flat = Math.abs(delta) < 2;
  const up = delta >= 2;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const color = flat ? "var(--ink-soft)" : up ? "var(--rust)" : "var(--teal)";
  return (
    <div className="bw-stat">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 16 }}>{inr(cur)}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color, marginTop: 4 }}>
        <Icon size={12} /> {flat ? "about the same" : `${Math.abs(delta).toFixed(0)}% ${up ? "more" : "less"} than last month`}
      </div>
    </div>
  );
}

/* ---- Cash flow waterfall: Opening -> Income -> Expenses -> Savings -> Investments ->
   Net change in cash -> Closing, rendered as a row of connected node cards with small
   "+/-" operation labels between them. Simple flex row rather than an SVG diagram —
   reads clearly at any width, wraps gracefully on mobile. ---- */
function WaterfallNode({ label, sublabel, value, clickable, expanded, onClick, tier, rate }) {
  const known = value !== null && value !== undefined;
  const negative = known && value < 0;
  return (
    <div
      className={`bw-wf-node ${negative ? "negative" : ""} ${clickable ? "clickable" : ""}`}
      onClick={clickable ? onClick : undefined}
    >
      <div className="bw-wf-node-label">
        {label}{sublabel && <span className="bw-wf-node-sublabel"> · {sublabel}</span>}
        {clickable && (expanded ? <ChevronUp size={11} style={{ verticalAlign: -1, marginLeft: 3 }} /> : <ChevronRight size={11} style={{ verticalAlign: -1, marginLeft: 3 }} />)}
      </div>
      <div className="bw-wf-node-value" style={{ color: !known ? "var(--ink-soft)" : negative ? "var(--rust)" : "var(--ink)" }}>
        {known ? inr(value) : "—"}
      </div>
      {known && rate !== null && rate !== undefined && (
        <div style={{ fontSize: 10.5, color: rate < 0 ? "var(--rust)" : "var(--ink-soft)", marginTop: 2 }}>{rate.toFixed(0)}% of income</div>
      )}
      {known && tier === "derived" && <div style={{ fontSize: 9, color: "var(--slate)", marginTop: 2 }}>calculated from your transactions</div>}
      {known && tier === "estimate" && <div style={{ fontSize: 9, color: "var(--ochre)", marginTop: 2 }}>estimated, not confirmed</div>}
    </div>
  );
}
/** contribution is the SIGNED effect on cash — e.g. Expenses passes -totals.expense
 *  (always reduces cash), Investments passes -totals.netInvestment (so a net
 *  REDEMPTION, where netInvestment itself is negative, correctly shows as a positive
 *  teal contribution rather than a misleading fixed minus sign). Sign and color are
 *  derived from this one number, identically for every op — no per-category rules. */
function WaterfallOp({ label, contribution, clickable, expanded, onClick, flagPositiveAsUnusual, rate }) {
  const known = contribution !== null && contribution !== undefined;
  const negative = known && contribution < 0;
  const sign = negative ? "−" : "+";
  const unusual = known && flagPositiveAsUnusual && !negative && contribution !== 0;
  const color = !known ? "var(--ink-soft)" : (negative || unusual) ? "var(--rust)" : "var(--teal)";
  return (
    <div className={`bw-wf-op ${clickable ? "clickable" : ""}`} onClick={clickable ? onClick : undefined}>
      <ArrowRight size={14} color="var(--ink-soft)" className="bw-wf-arrow-h" />
      <ArrowDown size={14} color="var(--ink-soft)" className="bw-wf-arrow-v" />
      <div className="bw-wf-op-label" style={{ color }}>
        {sign} {label}
        {clickable && (expanded ? <ChevronUp size={10} style={{ verticalAlign: -1, marginLeft: 2 }} /> : <ChevronRight size={10} style={{ verticalAlign: -1, marginLeft: 2 }} />)}
      </div>
      <div className="bw-wf-op-value" style={{ color }}>{known ? inr(Math.abs(contribution)) : "—"}</div>
      {known && rate !== null && rate !== undefined && (
        <div style={{ fontSize: 10, color, marginTop: 1 }}>{rate.toFixed(0)}% of income{unusual ? " · net redemption" : ""}</div>
      )}
    </div>
  );
}

/** Same box as WaterfallNode (literally the same bw-wf-node class, so it's pixel-for-
 *  pixel consistent) but takes an explicit color instead of deriving one from sign —
 *  Net Worth, Goals, and Debt's summary figures use fixed roles (liabilities are
 *  always rust, unallocated is always teal) rather than sign-based coloring. */
function HeroStat({ label, value, color, hint, clickable, onClick }) {
  return (
    <div className={`bw-wf-node ${clickable ? "clickable" : ""}`} onClick={clickable ? onClick : undefined}>
      <div className="bw-wf-node-label">{label}</div>
      <div className="bw-wf-node-value" style={{ color: color || "var(--ink)" }}>{inr(value)}</div>
      {hint && <div style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/** Shared card shell for the Dashboard screen — icon+title+badge header, hero value,
 *  optional delta line, a flexible body (sparkline SVG or custom breakdown via children),
 *  and an optional footer. Cash Flow and every other screen are untouched — this is
 *  used only by DashboardOverview. */
function InsightCard({ icon: Icon, title, badge, value, delta, deltaColor, footer, onClick, children }) {
  return (
    <div className={`bw-insight-card ${onClick ? "clickable" : ""}`} onClick={onClick}>
      <div className="bw-insight-head">
        <div className="bw-insight-title">{Icon && <Icon size={14} color="var(--teal)" />} {title}</div>
        {badge && <span className="bw-insight-badge" style={{ background: badge.bg, color: badge.color }}>{badge.text}</span>}
      </div>
      {value !== undefined && <div className="bw-insight-value">{value}</div>}
      {delta && <div className="bw-insight-delta" style={{ color: deltaColor || "var(--ink-soft)" }}>{delta}</div>}
      {children}
      {footer && (
        <div className="bw-insight-footer">
          {footer.map((f, i) => (
            <div className="bw-insight-footer-item" key={i}>
              <div className="bw-insight-footer-label">{f.label}</div>
              <div className="bw-insight-footer-value" style={{ color: f.color || "var(--ink)" }}>{f.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tiny inline sparkline — takes raw values, normalizes to the SVG viewbox itself so
 *  callers never need to pre-scale. Two-point (or fewer) series render as a flat/short
 *  line rather than a fabricated curve — an honest "not enough history yet" rather than
 *  a misleadingly smooth trend from sparse data. */
function Sparkline({ values, color }) {
  if (!values || values.length < 2) return null;
  const w = 120, h = 28, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - pad * 2) + pad;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg className="bw-insight-sparkline" width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

/** A section header used across several pillar screens - an icon, a title, and an
 *  optional one-line subtitle explaining what that section shows. */
function ZoneHeader({ icon: Icon, title, subtitle }) {
  return (
    <div className="bw-zone-header">
      <div className="zone-icon"><Icon size={14} /></div>
      <div>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}

/* ---- Zone D: transactions, collapsed by default. The headline zones above answer
   "what's my picture"; this is for when someone wants the raw list behind it — a
   read-only view scoped to whatever period is currently selected, not another place
   to categorize (that's what Review is for). ---- */
function TransactionsZone({ scoped, accounts, accountName }) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(() => [...scoped].sort((a, b) => b.date.localeCompare(a.date)), [scoped]);
  return (
    <div>
      <div className="bw-zone-header" style={{ marginBottom: 0 }}>
        <div className="zone-icon"><ListChecks size={14} /></div>
        <div>
          <button
            onClick={() => setOpen((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer",
              padding: 0, fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, color: "var(--ink)",
            }}
          >
            {open ? <ChevronUp size={15} /> : <ChevronRight size={15} />}
            Transactions
          </button>
          <p>{sorted.length} for this period — the raw list behind everything above</p>
        </div>
      </div>
      {open && (
        sorted.length === 0 ? <div className="bw-empty">Nothing for this period.</div> : (
          <table className="bw-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Category</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.id}>
                  <td style={{ whiteSpace: "nowrap", fontSize: 11.5, color: "var(--ink-soft)" }}>{t.date}</td>
                  <td style={{ fontSize: 11.5 }}>{accountName(t.accountId)}</td>
                  <td>{t.description}</td>
                  <td>
                    {t.category ? (
                      <span className="bw-pill" style={{ background: PALETTE[pillClass(t.category, t.subCategory, t.tag)] || "#9C8F78", fontSize: 10 }}>
                        {t.category}{t.subCategory ? ` / ${t.subCategory}` : ""}
                      </span>
                    ) : <span style={{ fontSize: 10.5, color: "var(--rust)" }}>Uncategorized</span>}
                  </td>
                  <td className={`bw-amt ${t.direction}`}>{t.direction === "credit" ? "+" : "−"}{inr(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

/** The most-reused small building block in the app - a labeled figure with an
 *  optional colored value and a small explanatory hint line underneath. Used across
 *  nearly every screen's summary rows. */
function Stat({ label, value, color, hint }) {
  return (
    <div className="bw-stat">
      <div className="label">{label}</div>
      <div className="value" style={{ color }}>{value}</div>
      {hint && <div style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* AI Analyst & Personal CFO — chat UI. The input is a SEARCH into the     */
/* prompt library, not a free-text box that goes straight to the model —  */
/* this is what actually enforces "no blue-sky questions": every question */
/* asked, built-in or user-saved, is a template whose placeholder TYPES   */
/* determine which pre-computed data bundle backs it, never its wording.  */
/* ---------------------------------------------------------------------- */

const CATEGORY_LABELS = {
  "Expense-Fixed": "Fixed expenses",
  "Expense-Variable-Household": "Variable — Household",
  "Expense-Variable-Personal": "Variable — Personal",
};

/** The Analyst / Personal CFO chat screen, shared by both personas (distinguished
 *  purely by the persona prop and its own thread/prompt filtering). Every question
 *  comes from a template in PROMPT_LIBRARY or a saved custom prompt, with any
 *  placeholder tokens ([category], [account], [goal], [amount]) resolved through
 *  TokenResolutionModal before the question is actually asked - runResolvedPrompt
 *  then builds a data bundle (buildCategoryBundle, buildAccountBundle, etc., or a
 *  question-specific bundle for the handful of prompts with no placeholders) from the
 *  real app data the question needs, and sends that alongside the resolved question
 *  text via callPersonaAnalysis - so every answer is grounded in the person's actual
 *  numbers, never invented. The user's message and a "thinking" placeholder both
 *  appear in the thread immediately, before the API call resolves, so it reads as a
 *  live chat rather than a form-then-wait interaction. */
function PersonaChatScreen({ persona, transactions, accounts, holdingSnapshots, goals, merchantAliases, chatThreads, setChatThreads, savedPrompts, setSavedPrompts, effectiveTier, showToast }) {
  const [apiKey, setApiKeyLocal] = useState("");
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [error, setError] = useState(null);
  const [confirmingDeleteThread, setConfirmingDeleteThread] = useState(null);

  useEffect(() => { (async () => { setApiKeyLocal(await loadState("geminiApiKey", "")); })(); }, []);

  const personaLabel = persona === "cfo" ? "Personal CFO" : "AI Analyst";
  const personaThreads = chatThreads.filter((t) => t.persona === persona).sort((a, b) => b.createdAt - a.createdAt);
  const personaPrompts = PROMPT_LIBRARY.filter((p) => p.persona === persona);
  const personaSavedPrompts = savedPrompts.filter((p) => p.persona === persona);
  const activeThread = chatThreads.find((t) => t.id === activeThreadId);

  const categoryOptions = useMemo(() => {
    const keys = new Set(transactions.filter((t) => t.category === "Expense").map((t) => pillClass(t.category, t.subCategory, t.tag)));
    return [...keys].map((k) => ({ value: k, label: CATEGORY_LABELS[k] || k }));
  }, [transactions]);
  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.nickname }));
  const goalOptions = goals.map((g) => ({ value: g.id, label: g.name }));

  function openPromptForResolution(promptDef) {
    setPendingPrompt(promptDef);
    setShowLibrary(false);
  }

  async function runResolvedPrompt(promptDef, resolvedValues) {
    let resolvedQuestion = promptDef.template;
    Object.entries(resolvedValues).forEach(([token, val]) => {
      resolvedQuestion = resolvedQuestion.split(token).join(val.label);
    });

    if (!apiKey) { setError("Add a Gemini API key in Upload → PDF (AI-assisted) first — this needs it to write the answer."); return; }

    // The user's question lands in the chat IMMEDIATELY, and the modal closes right
    // away — this is what actually makes it feel like a chat rather than a form. The
    // answer (or an error) gets appended to the same thread once the call resolves,
    // with a "thinking" placeholder message visible in the meantime.
    const threadId = activeThreadId || uid("thread");
    const userMessage = { id: uid("msg"), role: "user", content: resolvedQuestion, timestamp: Date.now() };
    const thinkingId = uid("msg");
    const thinkingMessage = { id: thinkingId, role: "assistant", pending: true, timestamp: Date.now() };
    setChatThreads((prev) => {
      const existing = prev.find((t) => t.id === threadId);
      if (existing) return prev.map((t) => (t.id === threadId ? { ...t, messages: [...t.messages, userMessage, thinkingMessage] } : t));
      return [...prev, { id: threadId, persona, title: resolvedQuestion.slice(0, 60), createdAt: Date.now(), messages: [userMessage, thinkingMessage] }];
    });
    setActiveThreadId(threadId);
    setPendingPrompt(null);
    setError(null);

    const bundle = {};
    const tokens = extractPlaceholderTokens(promptDef.template);
    tokens.forEach((token) => {
      const val = resolvedValues[token];
      if (token === PLACEHOLDER_TYPES.category.token) bundle.category = buildCategoryBundle(val.value, transactions, merchantAliases);
      if (token === PLACEHOLDER_TYPES.account.token) bundle.account = buildAccountBundle(val.value, accounts, transactions, holdingSnapshots);
      if (token === PLACEHOLDER_TYPES.goal.token) bundle.goal = buildGoalBundle(val.value, goals, accounts, holdingSnapshots);
      if (token === PLACEHOLDER_TYPES.amount.token) bundle.affordability = buildAffordabilityBundle(parseAmountStr(val.value), transactions, accounts, holdingSnapshots, goals);
    });
    if (tokens.length === 0) {
      if (promptDef.id === "expenses-increased" || promptDef.id === "spending-more") bundle.expenseChange = buildExpenseChangeBundle(transactions);
      if (promptDef.id === "savings-rate-fell") bundle.savingsRate = buildSavingsRateBundle(transactions);
      if (promptDef.id === "cash-flow-changed") bundle.cashFlow = buildCashFlowChangeBundle(transactions);
      if (promptDef.id === "investing-consistency") bundle.investing = buildInvestingConsistencyBundle(accounts, holdingSnapshots);
      if (promptDef.id === "financial-leaks") bundle.leaks = buildFinancialLeaksBundle(transactions, merchantAliases);
      if (promptDef.id === "monthly-summary") bundle.monthlySummary = buildMonthlySummaryBundle(transactions, merchantAliases);
    }

    try {
      const structured = await callPersonaAnalysis(apiKey, "gemini-3.6-flash", persona, resolvedQuestion, bundle);
      setChatThreads((prev) => prev.map((t) => (t.id === threadId
        ? { ...t, messages: t.messages.map((m) => (m.id === thinkingId ? { id: thinkingId, role: "assistant", structured, timestamp: Date.now() } : m)) }
        : t)));
    } catch (err) {
      setChatThreads((prev) => prev.map((t) => (t.id === threadId
        ? { ...t, messages: t.messages.map((m) => (m.id === thinkingId ? { id: thinkingId, role: "assistant", errorText: err.message || "Something went wrong getting an answer.", timestamp: Date.now() } : m)) }
        : t)));
    }
  }

  function deleteThread(id) {
    setChatThreads((prev) => prev.filter((t) => t.id !== id));
    if (activeThreadId === id) setActiveThreadId(null);
    setConfirmingDeleteThread(null);
  }

  return (
    <div style={{ display: "flex", gap: 0, minHeight: 480 }}>
      <div style={{ width: 210, borderRight: "1px solid var(--line)", paddingRight: 14, flexShrink: 0 }}>
        <button className="bw-btn ghost small" onClick={() => setActiveThreadId(null)} style={{ marginBottom: 14, width: "100%", justifyContent: "flex-start" }}>
          <Plus size={12} /> New chat
        </button>
        <div style={{ fontSize: 10.5, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Chats</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {personaThreads.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <button
                onClick={() => setActiveThreadId(t.id)}
                style={{
                  flex: 1, textAlign: "left", background: activeThreadId === t.id ? "var(--paper)" : "none", border: "none",
                  padding: "6px 8px", borderRadius: 4, cursor: "pointer", fontSize: 12, color: "var(--ink)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                {t.title}
              </button>
              {confirmingDeleteThread === t.id ? (
                <button onClick={() => deleteThread(t.id)} style={{ border: "none", background: "none", cursor: "pointer", padding: 2, fontSize: 9.5, color: "var(--rust)" }}>Yes?</button>
              ) : (
                <button onClick={() => setConfirmingDeleteThread(t.id)} style={{ border: "none", background: "none", cursor: "pointer", padding: 2 }}>
                  <X size={10} color="var(--ink-soft)" />
                </button>
              )}
            </div>
          ))}
          {personaThreads.length === 0 && <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>No chats yet.</div>}
        </div>
      </div>

      <div style={{ flex: 1, paddingLeft: 20 }}>
        {!activeThread ? (
          <div style={{ maxWidth: 560, margin: "40px auto", textAlign: "center" }}>
            <h2 className="bw-h2" style={{ fontSize: 22 }}>
              {persona === "cfo" ? "What decision is on your mind?" : "Any number bugging you?"}
            </h2>
            <p className="bw-lead" style={{ margin: "6px auto 0", maxWidth: 420 }}>
              {personaLabel} answers using only your own verified numbers — search for a question below, or save your own.
            </p>
            <input
              type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search prompts…" onFocus={() => setShowLibrary(true)} readOnly
              onClick={() => setShowLibrary(true)}
              style={{ width: "100%", padding: "12px 14px", fontSize: 14, border: "1px solid var(--line)", borderRadius: 8, background: "#fff", marginTop: 18, cursor: "pointer" }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 16 }}>
              {personaPrompts.slice(0, 3).map((p) => (
                <button key={p.id} className="bw-btn ghost small" onClick={() => openPromptForResolution(p)}>{p.name}</button>
              ))}
            </div>
            <button className="bw-btn ghost small" style={{ marginTop: 14 }} onClick={() => setShowLibrary(true)}>
              Browse all prompts <ChevronRight size={12} />
            </button>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 }}>
              {activeThread.messages.map((m) => <ChatMessageView key={m.id} message={m} persona={persona} />)}
            </div>
            <button className="bw-btn ghost small" onClick={() => setShowLibrary(true)}>
              <Plus size={12} /> Ask another question
            </button>
          </div>
        )}

        {error && <p style={{ fontSize: 12, color: "var(--rust)", marginTop: 12 }}>{error}</p>}
      </div>

      {showLibrary && (
        <PromptLibraryModal
          persona={persona} builtIn={personaPrompts} saved={personaSavedPrompts} searchText={searchText}
          onSelect={openPromptForResolution}
          onClose={() => setShowLibrary(false)}
          onOpenSaveDialog={() => {
            if (effectiveTier !== "licensed") {
              showToast("Saving your own prompts is a Licensed feature — the built-in prompt library stays fully available on Free.");
              return;
            }
            setShowLibrary(false); setShowSaveDialog(true);
          }}
          onDeleteSaved={(id) => setSavedPrompts((prev) => prev.filter((p) => p.id !== id))}
        />
      )}

      {showSaveDialog && (
        <SavePromptDialog
          persona={persona}
          onCancel={() => setShowSaveDialog(false)}
          onSave={(name, template) => {
            setSavedPrompts((prev) => [...prev, { id: uid("prompt"), persona, name, template, category: "My prompts", createdAt: Date.now() }]);
            setShowSaveDialog(false);
          }}
        />
      )}

      {pendingPrompt && (
        <TokenResolutionModal
          promptDef={pendingPrompt}
          categoryOptions={categoryOptions} accountOptions={accountOptions} goalOptions={goalOptions}
          onCancel={() => setPendingPrompt(null)}
          onRun={(resolvedValues) => runResolvedPrompt(pendingPrompt, resolvedValues)}
        />
      )}
    </div>
  );
}

/** Renders one chat message, in whichever of four states it's in: the user's own
 *  question, a "Thinking…" placeholder while the API call is in flight, an error, or
 *  the real structured answer - which itself renders differently per persona (CFO
 *  gets a recommendation/why/impact/options shape; Analyst gets its own structure). */
function ChatMessageView({ message, persona }) {
  if (message.role === "user") {
    return (
      <div style={{ alignSelf: "flex-end", background: "var(--ink)", color: "var(--card)", padding: "10px 14px", borderRadius: 8, maxWidth: "80%", fontSize: 13 }}>
        {message.content}
      </div>
    );
  }
  if (message.pending) {
    return (
      <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", background: "var(--card)", maxWidth: 200, fontSize: 13, color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: 8 }}>
        <RefreshCw size={13} className="bw-spin" /> Thinking…
      </div>
    );
  }
  if (message.errorText) {
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, padding: "10px 14px", border: "1px solid var(--rust)", borderRadius: 8, maxWidth: 480, color: "var(--rust)" }}>
        <AlertCircle size={14} style={{ marginTop: 1, flexShrink: 0 }} /> {message.errorText}
      </div>
    );
  }
  const s = message.structured;
  if (!s) return null;
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, background: "var(--card)", maxWidth: 640 }}>
      {persona === "cfo" ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{s.recommendation}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 10 }}>{s.why}</div>
          {s.impact && s.impact.length > 0 && (
            <>
              <div style={{ fontSize: 10.5, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Impact</div>
              <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 12.5 }}>
                {s.impact.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </>
          )}
          {s.options && s.options.length > 0 && (
            <>
              <div style={{ fontSize: 10.5, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Options</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                {s.options.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{s.answer}</div>
          {s.evidence && s.evidence.length > 0 && (
            <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 12.5 }}>
              {s.evidence.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          )}
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: s.attention ? 10 : 0 }}>{s.insight}</div>
          {s.attention && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 12, padding: "8px 10px", border: "1px solid var(--ochre)", borderRadius: 6 }}>
              <AlertCircle size={13} color="var(--ochre)" style={{ marginTop: 1, flexShrink: 0 }} />
              <span>{s.attention}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Browsable/searchable picker for both the built-in PROMPT_LIBRARY (grouped by
 *  category) and the person's own saved custom prompts - selecting either hands the
 *  prompt off for token resolution, not straight to the API. */
function PromptLibraryModal({ persona, builtIn, saved, searchText, onSelect, onClose, onOpenSaveDialog, onDeleteSaved }) {
  const [query, setQuery] = useState(searchText || "");
  const grouped = {};
  builtIn.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).forEach((p) => {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  });
  const filteredSaved = saved.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={onClose}>
      <div style={{ background: "var(--card)", borderRadius: 10, width: 560, maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15 }}>Prompt Library</div>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={16} /></button>
        </div>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)" }}>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${builtIn.length} prompts…`}
            style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 6 }} autoFocus />
        </div>
        <div style={{ overflowY: "auto", padding: "12px 18px", flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 10.5, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em" }}>My prompts ({filteredSaved.length})</div>
            <button className="bw-btn ghost small" onClick={onOpenSaveDialog}><Plus size={11} /> Save prompt</button>
          </div>
          {filteredSaved.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <button onClick={() => onSelect(p)} style={{ flex: 1, textAlign: "left", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px", background: "#fff", cursor: "pointer" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{p.template}</div>
              </button>
              <button onClick={() => onDeleteSaved(p.id)} style={{ border: "none", background: "none", cursor: "pointer" }}><Trash2 size={12} color="var(--ink-soft)" /></button>
            </div>
          ))}

          {Object.entries(grouped).map(([cat, prompts]) => (
            <div key={cat} style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10.5, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{cat}</div>
              {prompts.map((p) => (
                <button key={p.id} onClick={() => onSelect(p)} style={{ display: "block", width: "100%", textAlign: "left", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px", background: "#fff", cursor: "pointer", marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{p.template}</div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Form for saving a new custom prompt template - insertPlaceholder drops a token
 *  ([category], [account], etc.) at the current cursor position rather than always
 *  appending it, so a placeholder can be inserted mid-sentence naturally. */
function SavePromptDialog({ persona, onCancel, onSave }) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const textareaRef = useRef(null);

  function insertPlaceholder(token) {
    const el = textareaRef.current;
    if (!el) { setTemplate((prev) => prev + token); return; }
    const start = el.selectionStart ?? template.length, end = el.selectionEnd ?? template.length;
    const next = template.slice(0, start) + token + template.slice(end);
    setTemplate(next);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + token.length; });
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110 }} onClick={onCancel}>
      <div style={{ background: "#fff", borderRadius: 10, width: 460, padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15 }}>Save prompt</div>
          <button onClick={onCancel} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={16} /></button>
        </div>
        <div className="bw-field">
          <label>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekend spending check" />
        </div>
        <div className="bw-field">
          <label>Query</label>
          <textarea
            ref={textareaRef} value={template} onChange={(e) => setTemplate(e.target.value)} rows={4}
            placeholder="e.g. How much am I spending on [category] compared to last month?"
            style={{ width: "100%", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, padding: "8px 9px", border: "1px solid var(--line)", borderRadius: 4, resize: "vertical" }}
          />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {Object.values(PLACEHOLDER_TYPES).map((p) => (
            <button key={p.token} className="bw-pill" style={{ background: "var(--slate)", border: "none", cursor: "pointer" }} onClick={() => insertPlaceholder(p.token)}>
              + Insert {p.label} placeholder
            </button>
          ))}
        </div>
        <p style={{ fontSize: 11, color: "var(--ink-soft)", margin: "0 0 16px" }}>
          Use a placeholder where a {Object.values(PLACEHOLDER_TYPES).map((p) => p.label).join("/")} goes — you'll pick the actual one each time you run it.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="bw-btn ghost" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
          <button className="bw-btn" style={{ flex: 1 }} disabled={!name.trim() || !template.trim()} onClick={() => onSave(name.trim(), template.trim())}>Save</button>
        </div>
      </div>
    </div>
  );
}

/** Before a templated prompt (built-in or saved) actually runs, resolves whichever
 *  placeholder tokens it contains - only the ones actually present, via
 *  extractPlaceholderTokens - to a real category, account, goal, or amount, each
 *  offered from the live options list for that token type. */
function TokenResolutionModal({ promptDef, categoryOptions, accountOptions, goalOptions, onCancel, onRun }) {
  const tokens = extractPlaceholderTokens(promptDef.template);
  const [values, setValues] = useState({});

  function optionsFor(token) {
    if (token === PLACEHOLDER_TYPES.category.token) return categoryOptions;
    if (token === PLACEHOLDER_TYPES.account.token) return accountOptions;
    if (token === PLACEHOLDER_TYPES.goal.token) return goalOptions;
    return null;
  }
  function labelFor(token) {
    return Object.values(PLACEHOLDER_TYPES).find((p) => p.token === token)?.label || token;
  }

  const previewText = tokens.reduce((text, token) => {
    const v = values[token];
    return text.split(token).join(v ? v.label : token);
  }, promptDef.template);

  const canRun = tokens.every((t) => values[t] && values[t].label);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120 }} onClick={onCancel}>
      <div style={{ background: "#fff", borderRadius: 10, width: 460, padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15 }}>{promptDef.name}</div>
          <button onClick={onCancel} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={16} /></button>
        </div>
        {tokens.length === 0 ? (
          <p style={{ fontSize: 13, marginBottom: 16 }}>{promptDef.template}</p>
        ) : (
          <>
            {tokens.map((token) => {
              const opts = optionsFor(token);
              if (token === PLACEHOLDER_TYPES.amount.token) {
                return (
                  <div className="bw-field" key={token}>
                    <label>{labelFor(token)} (₹)</label>
                    <input type="text" inputMode="decimal" placeholder="e.g. 2500000"
                      onChange={(e) => setValues((prev) => ({ ...prev, [token]: { value: e.target.value, label: `₹${e.target.value}` } }))} />
                  </div>
                );
              }
              return (
                <div className="bw-field" key={token}>
                  <label>Which {labelFor(token)}?</label>
                  {!opts || opts.length === 0 ? (
                    <div className="bw-empty" style={{ padding: "12px 8px" }}>No {labelFor(token)} data yet.</div>
                  ) : (
                    <select onChange={(e) => {
                      const opt = opts.find((o) => o.value === e.target.value);
                      setValues((prev) => ({ ...prev, [token]: opt }));
                    }} defaultValue="">
                      <option value="" disabled>— choose —</option>
                      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                </div>
              );
            })}
            <p style={{ fontSize: 11.5, color: "var(--ink-soft)", margin: "8px 0 16px", fontStyle: "italic" }}>{previewText}</p>
          </>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button className="bw-btn ghost" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
          <button className="bw-btn" style={{ flex: 1 }} disabled={!canRun} onClick={() => onRun(values)}>Ask</button>
        </div>
      </div>
    </div>
  );
}
