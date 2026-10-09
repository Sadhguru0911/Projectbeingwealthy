/**
 * Asha's statement as a bank would actually send it: RAW ROWS ONLY (backlog #77).
 * Every row is { id, accountId, date, description, amount, direction } - nothing else. No category, no
 * frequency, no control, no clean merchant name, no links. The engine has to work all of that out
 * (rules + library + the single-sighting rule); the answer key lives in ashaAnswerKey.cjs, test-only.
 *
 * Realistic on purpose: real brands (so the starter rules and the library are exercised honestly), UPI to
 * people and small shops, ATM cash, a long tail that rotates month to month, and the two surprise bills
 * (school fee May and Nov, car insurance each Nov) that only a longer history reveals.
 *
 * Deterministic: a fixed seed, no Date.now(), no Math.random().
 */
export const ASHA_HISTORY_END = "2026-09-28";
const MONTHS = ["2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08","2026-09"];

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const pad = (n) => String(n).padStart(2, "0");
const ref = (r, len = 10) => String(Math.floor(r() * Math.pow(10, len))).padStart(len, "0");

// [description stem, base amount, spread, per-month day list or fn]. Anything with spread>0 varies by month.
const FIXED = [
  // [description(r), amount(i,r), day, direction]
  (i, r) => ({ day: 1, d: "NEFT CR-ACMEWORKS TECHNOLOGIES PVT LTD-SALARY", amt: 110000, dir: "credit" }),
  (i, r) => ({ day: 1, d: "UPI-SUNITA SHARMA-SCHOOLBUS-sunita.sharma@okicici", amt: 2400 }),
  (i, r) => ({ day: 3, d: "UPI-RAMESH KUMAR-RENT-ramesh.kumar@okhdfcbank", amt: 32000 }),
  (i, r) => ({ day: 5, d: "ACH D-HDFC BANK HOME LOAN EMI-" + "50200123", amt: 25000 }),
  (i, r) => ({ day: 5, d: "BILLDESK*HDFC CREDIT CARD PAYMENT-" + ref(r, 8), amt: cardBill(i) }),
  (i, r) => ({ day: 5, d: "NETFLIX.COM MUMBAI IN-" + ref(r, 4), amt: 649 }),
  (i, r) => ({ day: 7, d: "ACH D-ZERODHA BROKING SIP-" + ref(r, 6), amt: 30000 }),
  (i, r) => ({ day: 10, d: "UPI-CULT.FIT-cultfit@axisbank-" + ref(r, 6), amt: 1500 }),
  (i, r) => ({ day: 12, d: "BESCOM BILL PAYMENT-BBPS-" + ref(r, 8), amt: 3000 + (i % 4) * 400 }),
  (i, r) => ({ day: 15, d: "ACT FIBERNET-BBPS-" + ref(r, 8), amt: 999 }),
  (i, r) => ({ day: 18, d: "AIRTEL POSTPAID-BBPS-" + ref(r, 8), amt: 799 }),
];
function cardBill(i) { return Math.round(18400 * (0.9 + ((i * 37) % 20) / 100)); }

// Weekly household help paid by UPI to a person: 4 payments of Rs 1,000 a month (R Sharma).
const HELP = (r) => [3, 10, 17, 24].map((day) => ({ day, d: "UPI-R SHARMA-ASHA HELP-rsharma@oksbi-" + ref(r, 6), amt: 1000 }));

// Groceries / quick commerce, food, travel, shopping: how often and how much they appear per month.
const FLOW = [
  ["UPI-ZEPTO-zepto@axisbank-", 13, 300, 8, 0.0],
  ["UPI-BLINKIT-blinkit@hdfcbank-", 6, 230, 4, 0.0],
  ["UPI-BIGBASKET-bigbasket@icici-", 2, 600, 2, 0.0],
  ["UPI-DMART READY-dmart@okaxis-", 1, 1200, 1, 0.3],
  ["UPI-SWIGGY-swiggy@icici-", 8, 200, 5, 0.0],
  ["UPI-ZOMATO ONLINE-zomato@hdfcbank-", 5, 230, 3, 0.0],
  ["UPI-UBER INDIA-uber@axisbank-", 4, 150, 3, 0.0],
  ["UPI-RAPIDO-rapido@ybl-", 6, 60, 3, 0.0],
  ["UPI-AMAZON PAY INDIA-amazon@apl-", 2, 500, 2, 0.0],
  ["UPI-FLIPKART-flipkart@axb-", 1, 800, 1, 0.5],
  ["UPI-IRCTC-irctc@sbi-", 1, 900, 1, 0.7],
  ["UPI-SRI KRISHNA SWEETS-srikrishna@ybl-", 1, 200, 1, 0.0],
];

// A long tail that rotates month to month, so the merchant count keeps growing with history.
const TAIL = [
  "UPI-HOTEL MEGHANA FOODS", "UPI-CAFE COFFEE DAY", "UPI-NANDINI MILK", "UPI-MEDPLUS PHARMACY", "UPI-DECATHLON SPORTS",
  "UPI-LIFESTYLE STORES", "UPI-BOOKS & BEYOND", "UPI-TOYS R US BLR", "UPI-RELIANCE FRESH", "UPI-MORE SUPERMARKET",
  "UPI-VIJAYA CLINIC", "UPI-DR RAO DENTAL", "UPI-BANGALORE ONE", "UPI-IKEA INDIA", "UPI-PVR CINEMAS",
  "UPI-BOOKMYSHOW", "UPI-SPOTIFY INDIA", "UPI-GOOGLE PLAY", "UPI-PRIYA TAILORS", "UPI-KUMAR AUTO CARE",
  "UPI-GREEN LEAF VEG", "UPI-NAMMA CHAI", "UPI-LAKSHMI DEVI", "UPI-MOHAN KUMAR", "UPI-SURESH PLUMBER",
  "UPI-HP PETROL PUMP", "UPI-INDIAN OIL FUEL", "UPI-SHELL FUEL", "UPI-BATA SHOWROOM", "UPI-WESTSIDE",
  "UPI-CROSSWORD BOOKS", "UPI-FABINDIA", "UPI-TANISHQ JEWELLERS", "UPI-NYKAA", "UPI-MAINLAND CHINA",
  "UPI-TRUFFLES ICE AND SPICE", "UPI-VIDYARTHI BHAVAN", "UPI-BLR AIRPORT PARKING", "UPI-NAMMA METRO BMRCL", "UPI-OLA CABS",
  "UPI-URBAN COMPANY", "UPI-PEPPERFRY", "UPI-HOMETOWN FURNITURE", "UPI-LENSKART", "UPI-HIMALAYA WELLNESS",
  "UPI-SANKEY WATER TANKER", "UPI-KRISHNA FLOWERS", "UPI-ST MARYS BAKERY", "UPI-MTR FOODS", "UPI-FRESHMENU",
  "UPI-CURRY LEAF DINERS", "UPI-SHIVAJI MOBILES",
];

export function rawBankRows() {
  const rows = [];
  let n = 0;
  const push = (date, description, amount, direction = "debit") =>
    rows.push({ id: "txn_bank_" + (++n), accountId: "acc_bank", date, description, amount, direction });
  MONTHS.forEach((m, i) => {
    const r = rng(1000 + i * 7);
    const day = (x) => m + "-" + pad(Math.min(x, m === "2026-09" ? 28 : 28));
    FIXED.forEach((f) => { const o = f(i, r); push(day(o.day), o.d, o.amt, o.dir || "debit"); });
    HELP(r).forEach((o) => push(day(o.day), o.d, o.amt));
    FLOW.forEach(([stem, count, base, _c, skipChance]) => {
      if (skipChance && r() < skipChance) return;
      const c = Math.max(1, Math.round(count * (0.7 + r() * 0.6)));
      for (let k = 0; k < c; k++) push(day(1 + Math.floor(r() * 27)), stem + ref(r, 6), Math.round((base * (0.5 + r()) ) / 10) * 10);
    });
    // 7 tail merchants each month, rotating
    for (let k = 0; k < 7; k++) {
      const name = TAIL[(i * 5 + k * 3) % TAIL.length];
      push(day(1 + Math.floor(r() * 27)), name + "-" + ref(r, 6), Math.round((100 + r() * 600) / 10) * 10);
    }
    // ATM cash once a month
    push(day(4), "ATM CASH WDL-" + ref(r, 6) + "-BLR", 2000);
    // Eating out surprise (Sep): a big one-off meal, as the earlier data had
    if (i === 11) push(day(4), "UPI-TOIT BREWPUB-toit@icici-" + ref(r, 6), 8300);
  });
  // the twice-yearly school fee and once-a-year car insurance
  push("2025-11-09", "UPI-DPS SCHOOL FEES-778812", 60000);
  push("2026-05-09", "UPI-DPS SCHOOL FEES-778813", 60000);
  push("2025-11-14", "ICICI LOMBARD GENERAL INSURANCE-CAR-5521", 42000);
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function rawCardRows() {
  const rows = [];
  let n = 0;
  MONTHS.forEach((m, i) => {
    const r = rng(5000 + i * 11);
    const push = (day, description, amount) =>
      rows.push({ id: "txn_card_" + (++n), accountId: "acc_card", date: m + "-" + pad(day), description, amount, direction: "debit" });
    push(8, "MYNTRA DESIGNS BANGALORE-" + ref(r, 6), Math.round(6900 * (0.85 + (i % 4) / 10)));
    push(13, "SWIGGY BANGALORE-" + ref(r, 6), Math.round(5200 * (0.85 + ((i + 1) % 4) / 10)));
    push(18, "MAKEMYTRIP INDIA PVT LTD-" + ref(r, 6), Math.round(4000 * (0.85 + ((i + 2) % 4) / 10)));
    push(23, "HP PETROL PUMP KORAMANGALA-" + ref(r, 6), Math.round(2300 * (0.85 + ((i + 3) % 4) / 10)));
  });
  return rows;
}

export function rawAshaStatement() {
  return [...rawBankRows(), ...rawCardRows()];
}
