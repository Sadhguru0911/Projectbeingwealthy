/** TEST-ONLY answer key for src/demo/ashaStatement.js (backlog #77). Never imported by the app: the
 *  engine must work these out itself. Order matters: first matching pattern wins. */
module.exports = [
  ["SALARY", { category: "Income", cadence: "Monthly" }],
  ["HOME LOAN EMI", { category: "Transfer", subCategory: "Debt Payment", control: "Committed", cadence: "Monthly" }],
  ["CREDIT CARD PAYMENT", { category: "Transfer", subCategory: "Debt Payment", control: "Committed", cadence: "Monthly" }],
  ["ZERODHA", { category: "Investment", subCategory: "Add", cadence: "Monthly" }],
  ["RENT", { category: "Expense", control: "Committed", cadence: "Monthly" }],
  ["SCHOOLBUS", { category: "Expense", control: "Committed", cadence: "Monthly" }],
  ["SCHOOL FEES", { category: "Expense", control: "Committed", cadence: "Semi-Annual" }],
  ["GENERAL INSURANCE", { category: "Expense", control: "Committed", cadence: "Annual" }],
  ["BESCOM", { category: "Expense", control: "Committed", cadence: "Monthly" }],
  ["NETFLIX", { category: "Expense", control: "Flexible", cadence: "Monthly" }],
  ["ACT FIBERNET", { category: "Expense", control: "Committed", cadence: "Monthly" }],
  ["AIRTEL", { category: "Expense", control: "Committed", cadence: "Monthly" }],
  ["CULT.FIT", { category: "Expense", control: "Flexible", cadence: "Monthly" }],
  ["R SHARMA", { category: "Expense", control: "Committed", cadence: "Weekly-ish" }],
  ["ATM CASH", { category: "Expense", control: "Flexible", cadence: "Irregular" }],
];
