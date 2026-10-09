(async () => {
  const assert = require("assert");
  const { aiKeyFor, counterpartyOf, AI_MERCHANT_PROMPT } = await import("./aiMerchant.js");
  let pass = 0; const t = (n, f) => { f(); pass++; console.log("ok -", n); };
  const L = {
    gplay: "UPI/833939512456/ GOOGLE/PLAYSTORE1. BD@AXISBANK/UTIB0000100/ 10001291013140 /MANDATEEXECUTE/",
    gcloud: "UPI/283392722476/ GOOGLE CLOUD /GOOGLECLOUD@AXISBANK /UTIB0000553/ 10001291013140",
    myntra: "IMPS 625416350346 911111111111 MYNTRA DESIGNS PRIVATE LIMITED HSB 0B235083-493",
    nach: "14884613 NACH CR IW: 20260904MA00010005309 IDFC FIRST BANK LIMI NACH0000000000",
    kumar: "UPI/627023592955/ MR. KUMAR M S/KUMARAMS1990- 1@OKHDFCBANK/IDIB000R52",
    amp: "2601-021639566800 JAGJIT SINGH &AMP; SONS JEWELLERS AXIS BANK SCBLN5 NEFT",
  };
  t("a name found in the line is the key, upper case", () => assert.strictEqual(aiKeyFor("Google Cloud", L.gcloud), "GOOGLE CLOUD"));
  t("Google Play and Google Cloud stay different keys", () => assert.notStrictEqual(aiKeyFor("Google Play", L.gplay.replace("GOOGLE/PLAYSTORE1", "GOOGLE PLAY /PLAYSTORE")), aiKeyFor("Google Cloud", L.gcloud)));
  t("legal suffix is dropped: Private Limited / Pvt Ltd give one key", () => { assert.strictEqual(aiKeyFor("Myntra Designs Private Limited", L.myntra), "MYNTRA DESIGNS"); assert.strictEqual(aiKeyFor("MYNTRA DESIGNS PVT LTD", L.myntra), "MYNTRA DESIGNS"); });
  t("honorific dropped, punctuation ignored", () => assert.strictEqual(aiKeyFor("MR. KUMAR M S", L.kumar), "KUMAR M S"));
  t("a name that is NOT in the line is rejected (no invented merchants)", () => { assert.strictEqual(aiKeyFor("Rapido", L.kumar), null); assert.strictEqual(aiKeyFor("Google Play", L.gcloud), null); });
  t("words must be consecutive in the line", () => assert.strictEqual(aiKeyFor("Idfc Bank", L.nach), null));
  t("a brand shortened to its parent is rejected when the line prints more", () => assert.strictEqual(aiKeyFor("Google Cloud Platform", L.gcloud), null));
  t("generic words and numbers are not names", () => { assert.strictEqual(aiKeyFor("UPI", L.gcloud), null); assert.strictEqual(aiKeyFor("12345", "UPI 12345"), null); assert.strictEqual(aiKeyFor(null, L.gcloud), null); assert.strictEqual(aiKeyFor("", L.gcloud), null); });
  t("&AMP; in the line does not break matching", () => assert.strictEqual(aiKeyFor("Jagjit Singh Sons", L.amp), "JAGJIT SINGH SONS"));
  t("counterpartyOf accepts only the three values", () => { assert.strictEqual(counterpartyOf("Person"), "person"); assert.strictEqual(counterpartyOf("merchant"), "merchant"); assert.strictEqual(counterpartyOf("bank"), null); assert.strictEqual(counterpartyOf(undefined), null); });
  t("the prompt names the cases that went wrong", () => { const p = AI_MERCHANT_PROMPT.join(" "); ["Google Play", "Google Cloud", "Amazon Prime", "NACH", "never 'Google'"].forEach((w) => assert.ok(p.includes(w) || p.toLowerCase().includes(w.toLowerCase()), w)); });
  console.log(pass + " passed");
})();
