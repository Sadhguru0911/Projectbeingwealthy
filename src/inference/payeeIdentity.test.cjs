(async () => {
  const m = await import(require("path").join(__dirname, "payeeIdentity.js"));
  let fail = 0; const eq = (l, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log((ok ? "[PASS] " : "[FAIL] ") + l, ok ? "" : JSON.stringify(a) + " != " + JSON.stringify(b)); };
  const lib = (n) => (/INDIAN OIL|IOCL/i.test(n) ? "Indian Oil (IOCL)" : null);
  const id = m.makeIdentity(lib);
  eq("case does not matter", id("GOOGLE PLAY"), id("Google Play"));
  eq("a bank prefix does not matter", id("Google Cloud Utib"), id("GOOGLE CLOUD"));
  eq("two Google services stay two", id("GOOGLE PLAY") === id("GOOGLE CLOUD"), false);
  eq("a repeated word is one", id("SCAPIA SCAPIA"), id("Scapia"));
  eq("HDFC ERGO is not HDFC LIFE", id("HDFC ERGO") === id("HDFC LIFE"), false);
  eq("library name and bank text meet", id("Indian Oil (IOCL)"), id("UPI INDIAN OIL CORPORATION LTD"));
  eq("empty is empty", id(""), "");
  const aliases = [{ id: "a", canonical: "Cooking Gas", variants: ["UPI INDIAN OIL", "MR SURESH"] }, { id: "b", canonical: "Fuel", variants: ["Indian Oil (IOCL)"] }];
  eq("same payee in two groups is found", [...m.groupsByIdentity(aliases, id).values()].filter((v) => v.length > 1).length, 1);
  eq("a group lists each payee once", m.payeesOfGroup({ variants: ["GOOGLE PLAY", "Google Play", "GOOGLE CLOUD"] }, id).map((p) => p.spellings.length), [2, 1]);
  const merged = m.mergeAliasesOwnFirst([aliases[0]], [{ id: "x", canonical: "Fuel", variants: ["Indian Oil (IOCL)", "Shell"] }], id);
  eq("own group wins; the library only adds what is new", merged.map((g) => g.canonical + ":" + g.variants.join(",")), ["Cooking Gas:UPI INDIAN OIL,MR SURESH", "Fuel:Shell"]);
  process.exit(fail ? 1 : 0);
})();
