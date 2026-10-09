// Remark rules (backlog #166): a rule made from a remark applies to any payment whose remark has the same words, whoever the payee is.
(async () => {
  const assert = require("assert");
  const { callEngine } = require("../../golden/load-engine.cjs");
  const { remarkKeyOf, remarkRuleHits } = await import("./remark.js");
  let pass = 0; const t = (n, f) => { f(); pass++; console.log("ok -", n); };
  const upi = (payee, remark, ref = "600000000011") => `UPI/${ref}/ ${payee} /X@YBL /SBIN0000001/ 000000001/${remark}/ ${ref}/BRANCH/`;
  const rule = (extra) => ({ id: "rm1", pattern: "rapido communite", scope: "remark", remarkKey: remarkKeyOf("RAPIDO COMMUNITE"), category: "Expense", subCategory: "Personal", group: "Transport", source: "learned", priority: 500, ...extra });
  const m = (desc, rules) => callEngine("matchRule", [desc, rules]);
  t("the key is the words, upper case, once each, in alphabetical order", () => { assert.strictEqual(remarkKeyOf("Rapido Communite"), "COMMUNITE RAPIDO"); assert.strictEqual(remarkKeyOf("COMMUNITE  rapido!"), "COMMUNITE RAPIDO"); assert.strictEqual(remarkKeyOf(null), ""); });
  t("a remark rule matches the same words in either order, for any payee", () => {
    const r = [rule()]; assert.strictEqual(m(upi("BASUDEV MALLIK", "RAPIDO COMMUNITE"), r).id, "rm1"); assert.strictEqual(m(upi("OTHER PERSON", "COMMUNITE RAPIDO", "600000000022"), r).id, "rm1"); });
  t("'Rapido' alone and 'Communite Rapido' are different remarks: a word the person added is never ignored", () => {
    const r = [rule()]; assert.strictEqual(m(upi("A B", "RAPIDO"), r), null); assert.strictEqual(m(upi("A B", "RAPIDO COMMUNITE SCHOOL"), r), null);
    const solo = [rule({ id: "rm2", pattern: "rapido", remarkKey: remarkKeyOf("RAPIDO") })]; assert.strictEqual(m(upi("A B", "RAPIDO COMMUNITE"), solo), null); assert.strictEqual(m(upi("A B", "Rapido"), solo).id, "rm2"); });
  t("a typo is a different remark (no guess)", () => assert.strictEqual(m(upi("A B", "RQPIDO COMMUNITE"), [rule()]), null));
  t("a remark rule never reads the rest of the line: the words in a handle or payee do not trigger it", () => {
    assert.strictEqual(m("UPI/600000000033/ RAPIDO COMMUNITE /RAPIDO@YBL /SBIN0000001/ 1/PAY/ 600000000033/B/", [rule()]), null); assert.strictEqual(m("NEFT RAPIDO COMMUNITE SOMETHING", [rule()]), null); });
  t("a rule for the payee outranks the remark rule", () => {
    const payee = { id: "p1", pattern: "mamata adak", category: "Expense", subCategory: "Household", source: "learned", priority: 1012 };
    assert.strictEqual(m(upi("MAMATA ADAK", "RAPIDO COMMUNITE"), [rule(), payee]).id, "p1"); assert.strictEqual(m(upi("SOMEONE ELSE", "RAPIDO COMMUNITE", "600000000044"), [rule(), payee]).id, "rm1"); });
  t("remarkRuleHits is false for a plain rule and for a line with no remark", () => { assert.strictEqual(remarkRuleHits({ pattern: "x" }, upi("A", "RAPIDO COMMUNITE")), false); assert.strictEqual(remarkRuleHits(rule(), "NEFT SOMETHING"), false); });
  console.log(pass + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
