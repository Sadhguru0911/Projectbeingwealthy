(async () => {
  const assert = require("assert");
  const { payeeKey, migrateMerchantIdentity } = await import("./merchantIdentity.js");
  let pass = 0; const t = (n, f) => { f(); pass++; console.log("ok -", n); };
  const D = {
    nasreen: "2601-041550514208 NASREEN MIRZA IDBI BANK SCBLN52026090100571816 NEFT IBKL0000005 C21 VAISHNAVI ORCHIDS",
    scapia: "UPI/625600058739/ SCAPIA/SCAPIA.BDGP@KOTAKPAY /KKBK0JPUPIA/ 06410910000417/PAY/ 625600058739/",
    scapia2: "UPI/619466267562/ SCAPIA/SCAPIA.BDPG@KOTAKPAY /KKBK0JPUPIA/ 06410910000417/PAY/ 619466267562/",
    mamata: "UPI/624637571604/ MAMATA ADAK /MAMATHAADHOK@OKHDFCBANK /PUNB0059820/ 6928000100037376/COOK/ 624637571604/PUNBKAKDWIP/",
    mamataOtherApp: "UPI/700000000001/ MAMATA ADAK /MAMATA.ADAK@YBL /SBIN0000001/ 1/COOKING SALARY/ 700000000001/X/",
    jagadish: "UPI/624627672100/ JAGADISH ./SHETTYJ937@OKSBI /SBIN0016212/ 00000032504043036/CAR WASH/ 624627672100/SBI KASAVANAHALLI BANG",
    uncle: "UPI/627023592955/ MR. KUMAR M S/KUMARAMS1990- 1@OKHDFCBANK/IDIB000R52 814862630/UNCLE DELIVERY COMMUNITE/ 627023592955/IDIBRAJA RAJESWARI NAG",
    bhar: "UPI/625638067492/ B N BHARATHALAKSHMI /MAHESH131980-3@OKSBI /UBIN08297 297510100028854/CAB FROM AIRPORT/ 625638067492 /UBINDOMMASANDRA/",
    hyphen: "UPI-SWIGGY-swiggy@icici-306995", atm: "ATM CASH WDL-529144-BLR",
  };
  t("NEFT: the payee, not the payee's bank", () => assert.strictEqual(payeeKey(D.nasreen), "NASREEN MIRZA"));
  t("one payee is one merchant whatever the VPA handle (Scapia BDGP / BDPG)", () => { assert.strictEqual(payeeKey(D.scapia), "SCAPIA"); assert.strictEqual(payeeKey(D.scapia2), "SCAPIA"); });
  t("same payee through another app and with another remark is the same merchant", () => assert.strictEqual(payeeKey(D.mamata), payeeKey(D.mamataOtherApp)));
  t("trailing dots and honorifics are dropped", () => { assert.strictEqual(payeeKey(D.jagadish), "JAGADISH"); assert.strictEqual(payeeKey(D.uncle), "KUMAR M S"); });
  t("single-letter initials are kept", () => assert.strictEqual(payeeKey(D.bhar), "B N BHARATHALAKSHMI"));
  t("other layouts are left to the older way (null)", () => { assert.strictEqual(payeeKey(D.hyphen), null); assert.strictEqual(payeeKey(D.atm), null); assert.strictEqual(payeeKey(""), null); });
  const fns = { legacyKey: (d) => "OLD " + d.slice(0, 8), newKey: payeeKey, legacyName: (d) => "Old " + d.slice(0, 8), newName: (d) => "New " + payeeKey(d) };
  const txs = [
    { id: 1, description: D.mamata, merchant: "OLD UPI/6246" },
    { id: 2, description: D.scapia, merchant: "Old UPI/6256", merchantLocked: true },
    { id: 3, description: D.hyphen, merchant: "swiggy" },
    { id: 4, description: D.mamata, merchant: "Edited by hand" },
  ];
  const r = migrateMerchantIdentity(txs, [{ canonical: "Help", variants: ["OLD UPI/6246", "Other"] }, { canonical: "Cards", variants: ["Old UPI/6256"] }], fns);
  t("migration renames rows that carry the old key and leaves the rest", () => { assert.strictEqual(r.transactions[0].merchant, "MAMATA ADAK"); assert.strictEqual(r.transactions[1].merchant, "New SCAPIA"); assert.strictEqual(r.transactions[2].merchant, "swiggy"); assert.strictEqual(r.transactions[3].merchant, "Edited by hand"); assert.strictEqual(r.changed, 2); });
  t("merchant groups follow the rename and keep unrelated members", () => { assert.deepStrictEqual(r.aliases[0].variants, ["MAMATA ADAK", "Other"]); assert.deepStrictEqual(r.aliases[1].variants, ["New SCAPIA"]); });
  console.log(pass + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
