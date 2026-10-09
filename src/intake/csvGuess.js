/**
 * Reading a bank CSV / spreadsheet without anyone typing balances (onboarding intake, backlog #107).
 * Pure: when the file carries a running Balance column, the opening and closing balances it implies (trusted only when the
 * balance chain actually adds up). Column mapping itself is the app's existing guessColumn (no AI, no key needed).
 */
const norm = (h) => String(h == null ? "" : h).toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * list: [{ date: "YYYY-MM-DD", amount, direction }] in FILE order; balances: the running balance printed on each row (number | null).
 * Returns { opening, closing, trusted } or null. Trusted = the chain (each balance = previous +/- the row) holds for nearly every row.
 */
export function balancesFromList(list, balances) {
  if (!list.length || balances.length !== list.length || balances.filter((b) => typeof b === "number" && !Number.isNaN(b)).length < list.length * 0.9) return null;
  const asc = list[0].date <= list[list.length - 1].date;
  const idx = list.map((_, i) => i); if (!asc) idx.reverse();
  const signed = (r) => (r.direction === "credit" ? r.amount : -r.amount);
  const first = idx[0], last = idx[idx.length - 1];
  const opening = Math.round((balances[first] - signed(list[first])) * 100) / 100, closing = balances[last];
  let good = 0, seen = 0;
  for (let k = 1; k < idx.length; k++) { const a = balances[idx[k - 1]], b = balances[idx[k]]; if (typeof a !== "number" || typeof b !== "number") continue; seen++; if (Math.abs(a + signed(list[idx[k]]) - b) <= 1) good++; }
  return { opening, closing, trusted: seen > 0 && good >= seen * 0.98, breaks: seen - good, seen };
}

/** A quick read of whether a sheet's header row / first lines look like a credit-card statement rather than a bank account. */
export function looksLikeCard(headers, sampleText = "") {
  const t = norm(headers.join(" ")) + " " + norm(sampleText);
  return /credit card|card no|card number|minimum amount due|total amount due|payment due date|credit limit/.test(t);
}
