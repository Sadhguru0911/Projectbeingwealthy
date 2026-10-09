/**
 * Library additions found missing when Asha's raw statement was run through the engine (backlog #78).
 * Same entry shape as merchantLibrary.v2.js; spread into App.jsx's MERCHANT_LIBRARY after v2. Each pattern was
 * checked for no overlap with an existing v2 pattern. Amazon is deliberately NOT added: v2 withholds a category
 * for it on purpose (the right category depends on the purchase, not the brand).
 */
const E = (merchant, patterns, group, sub = "Personal", extra = {}) => ({ merchant, patterns, merchantType: "Merchant", category: "Expense", sub, group, groupType: "category", identityConfidence: "High", classificationConfidence: "High", ...extra });

export const MERCHANT_LIBRARY_ADDITIONS = [
  // Home-loan EMI is a debt payment (moves money to a loan), not a spend - the old "loan" keyword rule got this wrong.
  E("Home loan EMI", ["HOME LOAN EMI", "HOUSING LOAN EMI"], "EMI & Debt Repayment", "Household", { category: "Transfer" }),
  E("Cafe Coffee Day", ["CAFE COFFEE DAY", "COFFEE DAY"], "Eating Out"),
  E("Google Play", ["GOOGLE PLAY", "GOOGLEPLAY"], null), // no group on purpose: the person is revising the library's subscription groups
  E("HP Petrol Pump", ["HP PETROL", "HINDUSTAN PETROLEUM"], "Fuel"),
  E("ICICI Lombard", ["ICICI LOMBARD"], "Insurance Premium", "Household"),
  E("School fees", ["SCHOOL FEES", "SCHOOL FEE"], "Education", "Household"),
  E("School bus / transport", ["SCHOOLBUS", "SCHOOL BUS"], "Education", "Household"),
  E("IKEA", ["IKEA"], "Shopping", "Household"),
  E("Pepperfry", ["PEPPERFRY"], "Shopping", "Household"),
  E("Fabindia", ["FABINDIA"], "Shopping"),
  E("Crossword", ["CROSSWORD BOOKS"], "Shopping"),
  E("Tanishq", ["TANISHQ"], "Shopping"),
  E("PVR Cinemas", ["PVR CINEMAS", "PVR INOX"], "Entertainment"),
];
export default MERCHANT_LIBRARY_ADDITIONS;
