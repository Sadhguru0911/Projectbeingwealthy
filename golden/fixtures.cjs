/**
 * Fixed, realistic sample inputs for each golden-number test case. Kept
 * separate from the runner so a future phase can add more cases without
 * touching the harness itself.
 */
module.exports = [
  {
    fn: "computeGoalMath",
    label: "5-year goal, moderate inflation/return",
    args: [1000000, 6, 10, 5],
  },
  {
    fn: "computeGoalMath",
    label: "18-month goal, zero assumed return (matches Ask's cautious-estimate convention)",
    args: [1200000, 6, 0, 1.5],
  },
  {
    fn: "learnRecurringDay",
    label: "four clean monthly-on-the-5th dates",
    args: [["2026-01-05", "2026-02-05", "2026-03-06", "2026-04-05"]],
  },
  {
    fn: "learnRecurringDay",
    label: "two widely-spaced dates (should NOT read as a confirmed monthly pattern)",
    args: [["2026-01-09", "2026-05-14"]],
  },
  {
    fn: "computeDebtSummary",
    label: "a home loan, 3 periods imported, today mid-schedule",
    args: [
      [
        {
          importedAt: 1,
          entries: [
            { period: "2026-07", principal: 8000, interest: 17000, emi: 25000, closingBalance: 1892000 },
            { period: "2026-08", principal: 8060, interest: 16940, emi: 25000, closingBalance: 1883940 },
            { period: "2026-09", principal: 8121, interest: 16879, emi: 25000, closingBalance: 1875819 },
          ],
        },
      ],
      "2026-09-28",
    ],
  },
  {
    fn: "computeNetWorthSummary",
    label: "one bank account, one credit card, one demat account with a snapshot",
    args: [
      [
        { id: "a1", type: "bank", lastKnownBalance: 186000 },
        { id: "a2", type: "creditCard", lastKnownBalance: 18400 },
        { id: "a3", type: "demat" },
      ],
      [{ accountId: "a3", asOfDate: "2026-09-20", totalCurrentValue: 560000 }],
      [],
      [],
    ],
  },
];
