const path = require("path");
(async () => {
  const { healGroups } = await import(path.join(__dirname, "groupRules.js"));
  let fail = 0; const eq = (l, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log((ok ? "[PASS] " : "[FAIL] ") + l, ok ? "" : JSON.stringify(a) + " != " + JSON.stringify(b)); };
  const rules = [{ id: "r", pattern: "cafe", group: "Eating out" }];
  const match = (d, rs) => rs.find((r) => d.toLowerCase().includes(r.pattern)) || null;
  const tx = (id, m, d, category = "Expense") => ({ id, merchant: m, description: d, category });
  const aliases = [{ id: "g1", canonical: "Groceries", type: "category", variants: ["ZEPTO"] }];
  const r1 = healGroups([tx(1, "THIRD WAVE", "UPI/x/Third Wave CAFE/y")], rules, aliases, match);
  eq("a merchant the rule matches joins the rule's group (created if new)", r1.aliases.map((g) => g.canonical + ":" + g.variants.join(",")), ["Groceries:ZEPTO", "Eating out:THIRD WAVE"]);
  const r2 = healGroups([tx(1, "ZEPTO", "ZEPTO CAFE")], rules, aliases, match);
  eq("a merchant already in a group is not moved", r2.changed, 0);
  eq("...and the same array comes back", r2.aliases === aliases, true);
  eq("transfers are never grouped", healGroups([tx(1, "X", "X CAFE", "Transfer")], rules, aliases, match).changed, 0);
  const r3 = healGroups([tx(1, "BLUE TOKAI", "BLUE TOKAI CAFE")], rules, r1.aliases, match);
  eq("joins an existing group by name", r3.aliases.find((g) => g.canonical === "Eating out").variants, ["THIRD WAVE", "BLUE TOKAI"]);
  process.exit(fail ? 1 : 0);
})();
