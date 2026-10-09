/**
 * Unit tests for missingObjects.js. Plain Node, no bundling - pure module.
 * Rewritten after a real, serious false-positive was reported directly: a
 * peer-to-peer transfer naming the RECIPIENT's bank (e.g. "SAMEER GUPTA
 * KOTAK MAHINDRA BANK") was being read as evidence of a missing card, purely
 * because the bank's name appeared in the text - with no check on what KIND
 * of transaction it even was. Card/loan detection is now built entirely on
 * computeRecurringCommitments's real, validated output (category, subCategory,
 * linkedAccountId, confidence tier), never on scanning raw transaction text.
 * Run: node src/inference/missingObjects.test.cjs
 */
async function main() {
  const { detectMissingObjects, OBJECT_TYPE } = await import("./missingObjects.js");

  let pass = 0, fail = 0;
  function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) pass++;
    else { fail++; console.log("FAIL:", label, "\n  expected:", JSON.stringify(expected), "\n  actual:  ", JSON.stringify(actual)); }
  }

  const debit = (description) => ({ description, direction: "debit" });
  const credit = (description) => ({ description, direction: "credit" });
  const noAccounts = { trackedCardIssuers: [], hasLoan: false, trackedInvestmentPlatforms: [] };
  const noLibraryMatch = () => null;
  const matchCardIssuer = (text) => {
    if (!text) return null;
    if (/SBI CARD/i.test(text)) return { name: "SBI Card", isIntermediary: false };
    if (/\bCRED\b/i.test(text)) return { name: "CRED", isIntermediary: true };
    return null;
  };

  // --- REGRESSION (the real reported bug): a peer-to-peer transfer naming
  // the RECIPIENT's bank must NOT be flagged, even with many occurrences -
  // because computeRecurringCommitments correctly classifies it as an
  // ordinary Transfer, not Transfer/Debt Payment. ---
  const kotakTxns = [{ id: "t1", description: "SAMEER GUPTA KOTAK MAHINDRA BANK LTD IMPS P2A" }, { id: "t2", description: "SAMEER GUPTA KOTAK MAHINDRA BANK LTD IMPS P2A" }];
  const kotakCommitment = { category: "Transfer", subCategory: "External", name: "Sameer Gupta", rawMerchant: "Sameer Gupta", linkedAccountId: null, occurrenceCount: 12, transactionIds: ["t1", "t2"], pattern: { confidenceTier: "confirmed" } };
  const r1 = detectMissingObjects({ transactions: kotakTxns, commitments: [kotakCommitment], accountFlags: noAccounts, matchCardIssuer, matchLibraryEntry: noLibraryMatch });
  check("a peer-to-peer transfer (category Transfer/External, not Debt Payment) is never flagged as a missing card", r1.filter((x) => x.type === OBJECT_TYPE.CREDIT_CARD).length, 0);

  // --- The SBI Card example, from the real commitment shape, exactly as
  // shown on the person's own Recurring screen: "Well-established pattern" ---
  const sbiTxns = [{ id: "s1", description: "SBI CARD BILL PAYMENT" }, { id: "s2", description: "SBI CARD BILL PAYMENT" }, { id: "s3", description: "SBI CARD BILL PAYMENT" }];
  const sbiCommitment = { category: "Transfer", subCategory: "Debt Payment", name: "SBI Card Payment", rawMerchant: "SBI CARDS SBICARDP", linkedAccountId: null, occurrenceCount: 3, transactionIds: ["s1", "s2", "s3"], pattern: { confidenceTier: "confirmed" } };
  const r2 = detectMissingObjects({ transactions: sbiTxns, commitments: [sbiCommitment], accountFlags: noAccounts, matchCardIssuer, matchLibraryEntry: noLibraryMatch });
  check("SBI Card: a real Debt Payment commitment, confirmed pattern -> High confidence, named specifically", r2[0], { type: OBJECT_TYPE.CREDIT_CARD, name: "SBI Card", title: "SBI Card: 3 payments, and nothing behind them yet", body: "You have paid SBI Card 3 times, but all I can see is the money leaving your bank, not what it was for. Add the card's statement and those payments become real spending, with what you bought and what is still owed.", evidenceCount: 3, sampleDescriptions: ["SBI CARD BILL PAYMENT", "SBI CARD BILL PAYMENT", "SBI CARD BILL PAYMENT"], confidence: "High", action: { label: "Add SBI Card statement", act: "addStatement" } });

  // --- REGRESSION (the real reported bug): CRED is a payment app, not an
  // issuer - must produce the generic question, never "You appear to have a
  // CRED account," and must NEVER borrow a bank name from elsewhere in the
  // text (the real reported case: a CRED payment's UPI handle happened to
  // mention Axis, and was wrongly read as an Axis card). ---
  const credTxns = [{ id: "c1", description: "CRED CLUB PAYMENT" }];
  const credCommitment = { category: "Transfer", subCategory: "Debt Payment", name: "CRED", rawMerchant: "CRED CRED CLUB", linkedAccountId: null, occurrenceCount: 12, transactionIds: ["c1"], pattern: { confidenceTier: "emerging" } };
  const r3 = detectMissingObjects({ transactions: credTxns, commitments: [credCommitment], accountFlags: noAccounts, matchCardIssuer, matchLibraryEntry: noLibraryMatch });
  check("CRED (an intermediary, not an issuer) asks the generic question, never names a specific bank", r3[0].title, "A card I can't name is being paid");
  check("...and confidence is never High - the identity is genuinely uncertain here", r3[0].confidence, "Medium");

  // --- Already-tracked issuer -> correctly suppressed ---
  const r4 = detectMissingObjects({ transactions: sbiTxns, commitments: [sbiCommitment], accountFlags: { trackedCardIssuers: ["SBI Card"], hasLoan: false, trackedInvestmentPlatforms: [] }, matchCardIssuer, matchLibraryEntry: noLibraryMatch });
  check("already-tracked SBI Card -> suppressed", r4.filter((x) => x.type === OBJECT_TYPE.CREDIT_CARD).length, 0);

  // --- Already has a LINKED account on the commitment itself -> never even a candidate ---
  const linkedCommitment = { ...sbiCommitment, linkedAccountId: "acc_real_card" };
  const r5 = detectMissingObjects({ transactions: sbiTxns, commitments: [linkedCommitment], accountFlags: noAccounts, matchCardIssuer, matchLibraryEntry: noLibraryMatch });
  check("a commitment that already has a linkedAccountId is never flagged as missing", r5.filter((x) => x.type === OBJECT_TYPE.CREDIT_CARD).length, 0);

  // --- Loan: keyword evidence on the commitment, not raw text scanning ---
  const emiTxns = [{ id: "e1", description: "HOME LOAN EMI" }, { id: "e2", description: "HOME LOAN EMI" }];
  const loanCommitment = { category: "Transfer", subCategory: "Debt Payment", name: "Home Loan EMI", rawMerchant: "HOME LOAN EMI", linkedAccountId: null, occurrenceCount: 2, transactionIds: ["e1", "e2"], pattern: { confidenceTier: "established" } };
  const r6 = detectMissingObjects({ transactions: emiTxns, commitments: [loanCommitment], accountFlags: noAccounts, matchCardIssuer, matchLibraryEntry: noLibraryMatch });
  check("a real EMI-named commitment -> loan suggested", r6.some((x) => x.type === OBJECT_TYPE.LOAN), true);

  // --- Single-sighting rule still applies at the commitment level ---
  const oneOffCommitment = { ...sbiCommitment, occurrenceCount: 1, transactionIds: ["s1"] };
  const r7 = detectMissingObjects({ transactions: sbiTxns, commitments: [oneOffCommitment], accountFlags: noAccounts, matchCardIssuer, matchLibraryEntry: noLibraryMatch });
  check("single occurrence -> no suggestion, even if classified Debt Payment", r7.filter((x) => x.type === OBJECT_TYPE.CREDIT_CARD).length, 0);

  // --- Investment and insurance detection unchanged by this rebuild - still
  // real, still from the Merchant Library, still direction-aware where it matters ---
  const zerodhaTxns = [debit("UPI-ZERODHA-1"), debit("UPI-ZERODHA-2")];
  const matchLib = (d) => (/ZERODHA/i.test(d) ? { merchant: "Zerodha", merchantType: "Investment Platform" } : /ACKO/i.test(d) ? { merchant: "ACKO", merchantType: "Merchant", group: "Insurance Premium" } : null);
  const r8 = detectMissingObjects({ transactions: zerodhaTxns, commitments: [], accountFlags: noAccounts, matchCardIssuer: () => null, matchLibraryEntry: matchLib });
  check("investment detection still works, unchanged by the card/loan rebuild", r8.some((x) => x.type === OBJECT_TYPE.INVESTMENT), true);

  // --- REGRESSION (reported bug): an investment already tracked under a
  // REAL account - correctly linked via linkedAccountId on the transactions
  // themselves - must never be flagged, even when the account's own nickname
  // doesn't happen to textually match the Merchant Library's canonical name
  // (the real reported case: a real mutualFund-type account, correctly
  // linked, still wrongly suggested as missing because name-matching alone
  // missed it). ---
  const linkedAxisTxns = [
    { id: "a1", description: "AXIS MUTUAL FUND REDEMPTION", linkedAccountId: "acc_real_mf" },
    { id: "a2", description: "AXIS MUTUAL FUND REDEMPTION", linkedAccountId: "acc_real_mf" },
  ];
  const matchLibAxis = (d) => (/AXIS MUTUAL FUND/i.test(d) ? { merchant: "Axis Mutual Fund", merchantType: "Investment Platform" } : null);
  // Deliberately an EMPTY trackedInvestmentPlatforms - simulating the real
  // reported scenario where name-matching alone would have failed.
  const r8b = detectMissingObjects({ transactions: linkedAxisTxns, commitments: [], accountFlags: noAccounts, matchCardIssuer: () => null, matchLibraryEntry: matchLibAxis });
  check("an investment already linked via linkedAccountId is never flagged, even if name-matching would have missed it", r8b.filter((x) => x.type === OBJECT_TYPE.INVESTMENT).length, 0);

  // --- The same transactions, NOT linked -> correctly still flagged ---
  const unlinkedAxisTxns = linkedAxisTxns.map((t) => ({ ...t, linkedAccountId: null }));
  const r8c = detectMissingObjects({ transactions: unlinkedAxisTxns, commitments: [], accountFlags: noAccounts, matchCardIssuer: () => null, matchLibraryEntry: matchLibAxis });
  check("the same evidence, genuinely unlinked, is still correctly flagged", r8c.some((x) => x.name === "Axis Mutual Fund"), true);

  const commissionTxns = [credit("NEFT-HDFC ERGO COMMISSION-1"), credit("NEFT-HDFC ERGO COMMISSION-2")];
  const matchLibIns = (d) => (/HDFC ERGO/i.test(d) ? { merchant: "HDFC ERGO", merchantType: "Merchant", group: "Insurance Premium" } : null);
  const r9 = detectMissingObjects({ transactions: commissionTxns, commitments: [], accountFlags: noAccounts, matchCardIssuer: () => null, matchLibraryEntry: matchLibIns });
  check("insurance commission (credit) still correctly never mistaken for a premium", r9.filter((x) => x.type === OBJECT_TYPE.INSURANCE).length, 0);

  // --- Another bank account: repeated "Self" transfers with no account behind them ---
  const selfTx = (id, linked) => ({ id, category: "Transfer", subCategory: "Self", merchant: "RAMESH KUMAR", description: "NEFT RAMESH KUMAR", linkedAccountId: linked || null });
  const rb = detectMissingObjects({ transactions: [selfTx("a"), selfTx("b")], commitments: [], accountFlags: noAccounts, matchCardIssuer: () => null, matchLibraryEntry: noLibraryMatch });
  check("two own-account transfers with no account behind them -> a bank-account finding", rb.filter((x) => x.type === OBJECT_TYPE.BANK_ACCOUNT).length, 1);
  check("...asking for that account's statement", rb[0].action, { label: "Add that account's statement", act: "addStatement" });
  check("a single transfer is not enough", detectMissingObjects({ transactions: [selfTx("a")], commitments: [], accountFlags: noAccounts, matchCardIssuer: () => null, matchLibraryEntry: noLibraryMatch }).length, 0);
  check("transfers already linked to an account are not flagged", detectMissingObjects({ transactions: [selfTx("a", "x"), selfTx("b", "x")], commitments: [], accountFlags: noAccounts, matchCardIssuer: () => null, matchLibraryEntry: noLibraryMatch }).length, 0);

  console.log(`\n${pass}/${pass + fail} passed.`);
  if (fail > 0) process.exit(1);
}

main();
