// Minimal CSV parser for the browser harness (the real papaparse is not installable here). Quoted fields, header:false only.
function rows(text) {
  const out = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x !== "")) out.push(row); row = []; }
    else cur += c; }
  if (cur !== "" || row.length) { row.push(cur); if (row.some((x) => x !== "")) out.push(row); }
  return out;
}
export default { parse: (input, opts = {}) => {
  const done = (text) => { const data = rows(text); if (opts.complete) opts.complete({ data, errors: [], meta: {} }); return { data }; };
  if (typeof input === "string") return done(input);
  if (input && input.text) { input.text().then(done); return undefined; }
  return done("");
}, unparse: () => "" };
