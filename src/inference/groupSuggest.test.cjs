const path = require("path");
(async () => {
  const { suggestGroup } = await import(path.join(__dirname, "groupSuggest.js"));
  let fail = 0; const eq = (l, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log((ok ? "[PASS] " : "[FAIL] ") + l, ok ? "" : JSON.stringify(a) + " != " + JSON.stringify(b)); };
  const groups = [{ canonical: "Grocery", variants: ["ZEPTO", "BLINKIT", "MORE RETAIL"] }, { canonical: "Rent", variants: ["RAMESH KUMAR"] }, { canonical: "Others", variants: ["X"] }];
  eq("library group that already exists is used", suggestGroup({ merchant: "DMART", description: "UPI/1/DMART" }, groups, { group: "Grocery" }), { group: "Grocery", existing: true, why: "library" });
  eq("library group not yet created is offered as new", suggestGroup({ merchant: "Toit", description: "x" }, groups, { group: "Eating Out" }), { group: "Eating Out", existing: false, why: "library" });
  eq("closest by payee words", suggestGroup({ merchant: "MORE SUPERMARKET", description: "UPI/1/MORE SUPERMARKET" }, groups, null), { group: "Grocery", existing: true, why: "similar" });
  eq("remarks hint (rent) picks the Rent group", suggestGroup({ merchant: "SURESH BABU", description: "UPI/22/SURESH BABU/Oct rent" }, groups, null), { group: "Rent", existing: true, why: "similar" });
  eq("nothing close -> no suggestion", suggestGroup({ merchant: "QWERTY", description: "UPI/9/QWERTY" }, groups, null), null);
  eq("Others is never suggested", suggestGroup({ merchant: "X", description: "x" }, groups, { group: "Others" }), null);
  process.exit(fail ? 1 : 0);
})();
