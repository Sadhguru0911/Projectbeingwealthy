/**
 * The remark a person typed when paying by UPI (backlog #165). Pure.
 *  - remarkOf(description): the remark exactly as the bank printed it, or null. A UPI line reads
 *      UPI/<ref>/<PAYEE>/<vpa>/<ifsc>/<account>/<REMARK>/<ref again>/<branch>
 *    but the number of fields in front of the remark varies with the bank, so it is found as "the field just before the reference
 *    repeats". System words (UPI, PAY, MANDATEEXECUTE ...) are not a person's remark and give null.
 *  - remarkTheme(remark): a SUGGESTION only: the group a remark's words point to, or null. Words are matched in any order, whole words only,
 *    so "RAPIDO COMMUNITE" and "COMMUNITE RAPIDO" agree and a typo ("RQPIDO") matches nothing - the remark is still shown.
 */
const SYSTEM_REMARKS = new Set(["UPI", "PAY", "PAYMENT", "MANDATEEXECUTE", "UPIINTENT", "COLLECT", "PAYVIARAZORPAY", "PAY VIA RAZORPAY", "SENT USING PAYTM UPI", "PAYMENT FROM PHONEPE", "PAYMENT FROM PHONE"]);
export function remarkOf(description) {
  const s = String(description || "").replace(/\s+/g, " ").trim();
  if (!/^UPI\//i.test(s)) return null;
  const p = s.split("/").map((x) => x.trim());
  const digits = (x) => String(x).replace(/\D/g, "");
  const ref = digits(p[1] || "");
  if (ref.length < 6) return null;
  const at = p.findIndex((x, i) => i > 2 && digits(x) === ref && x.replace(/[\d\s]/g, "") === "");
  if (at < 3) return null;
  const r = p[at - 1];
  if (!r || /^[\d\s]+$/.test(r) || SYSTEM_REMARKS.has(r.toUpperCase())) return null;
  if (/^(PAYMENT FOR|PAY TO|PAID VIA|R\d\d )/i.test(r) && /[A-Z]*\d[A-Z\d]{8,}/.test(r)) return null; // gateway text carrying a code, not a typed remark
  return r;
}
// [required words (all, any order), group the library already has, label shown to the person]
const VOCAB = [
  [["RAPIDO"], "Transport", "Rapido"], [["UBER"], "Transport", "Uber"], [["OLA"], "Transport", "Ola"], [["AUTO"], "Transport", "auto"], [["CAB"], "Transport", "cab"], [["TAXI"], "Transport", "taxi"],
  [["PARKING"], "Transport", "parking"], [["TOLL"], "Transport", "toll"], [["FASTAG"], "Transport", "FASTag"],
  [["GAS", "CYLINDER"], "Gas", "gas cylinder"],
  [["MEDICINE"], "Health & Pharmacy", "medicine"], [["MEDICINES"], "Health & Pharmacy", "medicine"], [["MEDICAL"], "Health & Pharmacy", "medical"], [["DOCTOR"], "Health & Pharmacy", "doctor"],
  [["AMBULANCE"], "Health & Pharmacy", "ambulance"], [["BLOOD", "TEST"], "Health & Pharmacy", "blood test"], [["HOMEOPATHY"], "Health & Pharmacy", "homeopathy"], [["PHARMACY"], "Health & Pharmacy", "pharmacy"], [["HOSPITAL"], "Health & Pharmacy", "hospital"],
  [["COOK"], "Home Services", "cook"], [["MAID"], "Home Services", "maid"], [["ELECTRICIAN"], "Home Services", "electrician"], [["PLUMBER"], "Home Services", "plumber"], [["REPAIR"], "Home Services", "repair"],
  [["GARDENING"], "Home Services", "gardening"], [["GARDENER"], "Home Services", "gardener"], [["GARDNER"], "Home Services", "gardener"], [["IRONING"], "Home Services", "ironing"], [["CAR", "WASH"], "Home Services", "car wash"], [["CARWASH"], "Home Services", "car wash"], [["LAUNDRY"], "Home Services", "laundry"], [["CARPENTER"], "Home Services", "carpenter"],
  [["FOOD"], "Eating Out", "food"], [["LUNCH"], "Eating Out", "lunch"], [["DINNER"], "Eating Out", "dinner"], [["BREAKFAST"], "Eating Out", "breakfast"], [["SAMOSA"], "Eating Out", "samosa"], [["COFFEE"], "Eating Out", "coffee"], [["CHAI"], "Eating Out", "chai"], [["SNACKS"], "Eating Out", "snacks"], [["JUICE"], "Eating Out", "juice"], [["BIRYANI"], "Eating Out", "biryani"],
];
export function remarkTheme(remark) {
  if (!remark) return null;
  const words = new Set(String(remark).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean));
  const hits = VOCAB.filter(([req]) => req.every((w) => words.has(w)));
  if (!hits.length) return null;
  const [, group, label] = hits[0]; // the list is ordered most specific first (a named service before a general word)
  return { group, label, also: [...new Set(hits.slice(1).map((h) => h[2]))] };
}

/** The identity of a remark for clubbing and for remark rules: its words, upper case, each once, in alphabetical order - so "Rapido Communite" and
 *  "Communite Rapido" are the same remark, while "Rapido" alone is a different one (a word the person added is a difference, never ignored). */
export function remarkKeyOf(remark) {
  if (!remark) return "";
  return [...new Set(String(remark).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean))].sort().join(" ");
}
/** A rule made from a remark (scope "remark") applies to a payment whose remark has exactly the same words. Never reads the rest of the line. */
export function remarkRuleHits(rule, description) {
  if (!rule || rule.scope !== "remark" || !rule.remarkKey) return false;
  const k = remarkKeyOf(remarkOf(description));
  return !!k && k === rule.remarkKey;
}
