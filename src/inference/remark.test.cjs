(async () => {
  const assert = require("assert");
  const { remarkOf, remarkTheme } = await import("./remark.js");
  let pass = 0; const t = (n, f) => { f(); pass++; console.log("ok -", n); };
  // real shapes from a user's statement (field counts vary: 8, 9 and 10 fields)
  const L = {
    rapido10: "UPI/638867630398/ MR PUNADEV KUMAR /PUNDEVK64@YBL/CBIN0284557/ 0000003963811026/RAPIDO COMMUNITE/ 638867630398/CBINTINKONI/",
    unc9: "UPI/601588993073/ LALITHA/REDDYLM158@OKSBI /KARB0000857/ 9992505061647401/UNCLE DELIVERY COMMUNITE/ 601588993073/",
    unc8: "UPI/637130088397/\nVINOD KUMAR G SUBRAMANY\n/VINODKIIN@OKICICI/ICIC0000\n060401510316/UNCLE DELIVERY\nCOMMUNITE/\n637130088397/ICICI BK BANGALORE\n(SA",
    flip: "UPI/601264187606/\nAQUIB AHMED/AQUIBKHAN9986-\n1@OKHDFCBANK/IOBA0000633\n063301000033664/COMMUNITE\nUNCLE DELIVERY/\n601264187606/INDIAN OVERSEAS\nBANK K",
    typo: "UPI/700000000002/ SOMEONE /S@YBL /X0001/ 123/RQPIDO COMMUNITE/ 700000000002/B/",
    school: "UPI/602077994897/ A B /U143@YBL /KARB0000910/ 9102500101537101/RAPIDO SCHOOL DROP/ 602077994897/KARNATAKA BANK LTD BEL",
    mandate: "UPI/833939512456/ GOOGLE/PLAYSTORE1. BD@AXISBANK/UTIB0000100/ 10001291013140 /MANDATEEXECUTE/ 833939512456/AXIS BK MADHAPUR/",
    gateway: "UPI/637835790523/ SNABB/SNABBIONLINE@AXL /UTIB0AXLUPI/ 002261100000025/PAYMENT FOR EE1BCF3B6D9742629A323D 637835790523/",
    neft: "2601-041552554600 NASREEN MIRZA IDBI BANK SCBLN52026010400522781 NEFT IBKL0000005",
  };
  t("the remark is found whatever the number of fields before it", () => { assert.strictEqual(remarkOf(L.rapido10), "RAPIDO COMMUNITE"); assert.strictEqual(remarkOf(L.unc9), "UNCLE DELIVERY COMMUNITE"); });
  t("a remark the bank wrapped over lines is joined, in the person's own word order", () => { assert.strictEqual(remarkOf(L.unc8), "UNCLE DELIVERY COMMUNITE"); assert.strictEqual(remarkOf(L.flip), "COMMUNITE UNCLE DELIVERY"); });
  t("the whole remark is kept as written, typo included", () => { assert.strictEqual(remarkOf(L.typo), "RQPIDO COMMUNITE"); assert.strictEqual(remarkOf(L.school), "RAPIDO SCHOOL DROP"); });
  t("system words and gateway codes are not a remark; non-UPI lines have none", () => { assert.strictEqual(remarkOf(L.mandate), null); assert.strictEqual(remarkOf(L.gateway), null); assert.strictEqual(remarkOf(L.neft), null); assert.strictEqual(remarkOf(""), null); assert.strictEqual(remarkOf(null), null); });
  t("words in any order point to the same group", () => { assert.strictEqual(remarkTheme("RAPIDO COMMUNITE").group, "Transport"); assert.strictEqual(remarkTheme("COMMUNITE RAPIDO").group, "Transport"); assert.strictEqual(remarkTheme("Car Wash C21").group, "Home Services"); assert.strictEqual(remarkTheme("GAS CYLINDER").group, "Gas"); });
  t("a typo or an unknown remark suggests nothing (the remark is still shown by the caller)", () => { assert.strictEqual(remarkTheme("RQPIDO COMMUNITE"), null); assert.strictEqual(remarkTheme("UNCLE DELIVERY COMMUNITE"), null); assert.strictEqual(remarkTheme(null), null); });
  t("whole words only: 'AUTOPAY' is not 'AUTO'; 'COOKIES' is not 'COOK'", () => { assert.strictEqual(remarkTheme("MONTHLY AUTOPAY. CANCEL ANYTIME."), null); assert.strictEqual(remarkTheme("COOKIES"), null); });
  t("two themes: the more specific comes first and the other is listed as also", () => { const r = remarkTheme("RAPIDO FOOD"); assert.strictEqual(r.group, "Transport"); assert.deepStrictEqual(r.also, ["food"]); });
  console.log(pass + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
