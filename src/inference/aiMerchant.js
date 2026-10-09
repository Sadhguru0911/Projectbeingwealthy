/**
 * The merchant name Gemini reads off a PDF statement row (backlog #158/#160). Pure.
 *  - aiKeyFor(aiName, description): the key a row is identified by, or null when the name cannot be trusted. A name is trusted only if,
 *    after tidying (upper case, punctuation gone, legal suffix gone), it appears in the line as whole consecutive words. So Gemini can
 *    never invent a merchant that a rule then attaches to, and a rule written from the key will find the line again.
 *  - counterpartyOf(v): "merchant" | "person" | "unclear" | null.
 */
const LEGAL = new Set(["PRIVATE", "PVT", "LIMITED", "LTD", "LLP", "INC", "CORP", "CORPORATION", "CO"]);
const HONORIFIC = new Set(["MR", "MRS", "MS", "MISS", "SHRI", "SMT"]);
const GENERIC = new Set(["UPI", "IMPS", "NEFT", "RTGS", "NACH", "ACH", "PAYMENT", "PAYMENTS", "TRANSFER", "BANK", "PAY", "MERCHANT", "UNKNOWN", "NULL", "NA", "NONE", "PERSON", "CREDIT", "DEBIT", "INTEREST"]);
const words = (s) => String(s || "").toUpperCase().replace(/&AMP;?/g, " ").replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean);
export function aiKeyFor(aiName, description) {
  let w = words(aiName);
  while (w.length > 1 && HONORIFIC.has(w[0])) w.shift();
  while (w.length > 1 && LEGAL.has(w[w.length - 1])) w.pop();
  if (!w.length) return null;
  const key = w.join(" ");
  if (key.length < 3 || /^\d+$/.test(key.replace(/ /g, "")) || (w.length === 1 && GENERIC.has(w[0]))) return null;
  const line = " " + words(description).join(" ") + " ";
  return line.includes(" " + key + " ") ? key : null;
}
export function counterpartyOf(v) {
  const s = String(v || "").toLowerCase().trim();
  return s === "merchant" || s === "person" || s === "unclear" ? s : null;
}
/** The instructions Gemini gets for the merchant name, with the cases that went wrong in real statements. */
export const AI_MERCHANT_PROMPT = [
  "For every row also give aiMerchant and counterpartyType.",
  "aiMerchant is the name of the business or person on the other side of this transaction, copied from the row's description text.",
  "RULES FOR aiMerchant:",
  "1. Use only words that appear in that row's description, in the same order. Never invent, translate, shorten to a brand you know, or add a name that is not printed in the row.",
  "2. Give the most specific name the line prints. Do not shorten it to the parent company. Examples: a Play Store line gives 'Google Play' (or 'Google Play Store' if that is what is printed), never 'Google'; 'GOOGLE CLOUD' gives 'Google Cloud'; 'SWIGGY INSTAMART' gives 'Swiggy Instamart', never 'Swiggy'; 'AMAZON PAY' gives 'Amazon Pay', 'AMAZON PRIME' gives 'Amazon Prime', and a line that only prints 'AMAZON INDIA' gives 'Amazon India'. The same business must always get the same name in every row.",
  "3. Drop reference numbers, UTR/IFSC codes, bank handles (the part after @), card numbers, dates, branch names and the words UPI, IMPS, NEFT, NACH, PAYMENT, TRANSFER. Keep the payee's own words, including 'Private Limited' or 'Ltd' if printed.",
  "4. UPI lines look like UPI/<ref>/<PAYEE>/<vpa@bank>/<ifsc>/<account>/<remark>/...: the payee is the part after the reference number. If the payee is a bare ID or phone number, use the remark only if it clearly names a business that is printed in the row; otherwise give null.",
  "5. NACH / ECS / mandate lines (e.g. 'NACH CR IW: 2026MA... COAL INDIA LTD ...'): the name is the company after the mandate reference code, for example 'Coal India Ltd'. Interest, dividend and 'IW'/'MA' codes are not part of the name.",
  "6. NEFT / IMPS / RTGS lines: the name is the beneficiary or remitter (the person or company), not the bank that carries it. 'SAMEER GUPTA UJJIVAN SMALL FINANCE BANK' gives 'Sameer Gupta' when the bank is only the carrier; 'JANA SMALL FINANCE BANK LTD' gives 'Jana Small Finance Bank Ltd' when the bank itself is the counterparty.",
  "7. Card swipes and e-commerce lines (POS, ECOM): the shop name, without the card number, city or country. Gateway prefixes such as RAZORPAY*, PAYU*, BILLDESK* are not the merchant; use the name after them.",
  "8. Cheque, ATM, cash, charges, interest and tax lines: use null unless a counterparty name is printed.",
  "9. If you cannot find a name that follows rules 1-8, use null. A null is better than a guess.",
  "counterpartyType is 'merchant' for a shop, company, service, bank, platform or institution; 'person' for an individual's name; 'unclear' when you cannot tell. Judge from the name and the line only.",
];
