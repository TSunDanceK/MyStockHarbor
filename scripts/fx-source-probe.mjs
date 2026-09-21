// WHAT THE RATE SOURCES ACTUALLY SERVE — measured from a runner, not assumed.
//
// ── WHY THIS RUNS ON A RUNNER AND NOT IN THE AGENT SANDBOX ─────────────────
// Re-tested 2026-09-20: `www.federalreserve.gov` and `data.ecb.europa.eu` both
// return `403 CONNECT tunnel failed` from the agent proxy, the same class of
// denial as `data.sec.gov`. So no rate can be fetched, and no conversion
// verified, from a Claude session. The relay is the only place this can be
// measured, exactly as it is for SEC.
//
// ── WHAT HAS TO BE TRUE BEFORE A CONVERSION LAYER IS WORTH BUILDING ────────
// The brief fixes four things that are properties of the SOURCE, not of our
// code, and every one of them can fail quietly:
//
//   1. A DAILY SERIES GOING BACK FAR ENOUGH. "Spot on the balance-sheet date"
//      needs the rate on a date up to six years old (SEC_YEAR_WINDOW is 6).
//      A source serving only the current rate cannot do it at all.
//   2. A RATE ON A NON-TRADING DAY. Balance-sheet dates land on weekends and
//      holidays constantly — 2025-12-31 is a Wednesday but 2025-06-30 is fine
//      while 2024-06-30 is a Sunday. The source will have NO row. The rule for
//      which neighbouring day to use has to be decided, and it has to be the
//      same rule forever or a historical figure moves.
//   3. AN AVERAGE OVER A DURATION. Income-statement lines cover a quarter or a
//      year, and the brief says average rate. That means every business day in
//      the span, not the two endpoints.
//   4. DIRECTION. H.10 quotes SOME currencies as currency-per-USD and others as
//      USD-per-currency, and getting it backwards is a plausible-looking number
//      off by a factor of ~1.2 rather than an error. This prints the raw quote
//      and the implied USD value of 1 unit so the direction is READ, not
//      remembered.
//
// Prints what each endpoint returns. Decides nothing.
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor fx probe";

const get = async (url, kind = "text") => {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" } });
    const body = kind === "json" ? await res.json().catch(() => null) : await res.text();
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, body,
             ct: res.headers.get("content-type") ?? "" };
  } catch (e) { return { ok: false, status: 0, ms: Date.now() - t0, err: String(e?.message ?? e) }; }
};

const head = (s, n = 400) => (typeof s === "string" ? s.slice(0, n).replace(/\s+/g, " ") : JSON.stringify(s)?.slice(0, n));

console.log("=".repeat(74));
console.log("FED H.10 — the primary source the brief names");
console.log("=".repeat(74));

// The H.10 historical per-currency text files, and the Data Download Program.
// Both are tried because the first is stable and human-published while the
// second is the machine-readable one; which exists decides the fetcher.
const H10 = [
  ["EUR hist (dat00_eu)", "https://www.federalreserve.gov/releases/h10/hist/dat00_eu.htm"],
  ["CAD hist (dat00_ca)", "https://www.federalreserve.gov/releases/h10/hist/dat00_ca.htm"],
  ["GBP hist (dat00_uk)", "https://www.federalreserve.gov/releases/h10/hist/dat00_uk.htm"],
  ["H.10 current release", "https://www.federalreserve.gov/releases/h10/current/"],
  ["DDP CSV (EUR, 6y)",
   "https://www.federalreserve.gov/datadownload/Output.aspx?rel=H10&series=bf20ca9a2e5b30b2d3f0d4d0b9b1c0f5&lastobs=&from=01/01/2019&to=12/31/2026&filetype=csv&label=include&layout=seriescolumn"],
];
for (const [name, url] of H10) {
  const r = await get(url);
  console.log(`\n${name}`);
  console.log(`  ${url}`);
  console.log(`  status ${r.status} ${r.ok ? "OK" : "FAIL"} ${r.ms}ms ct=${r.ct}${r.err ? ` err=${r.err}` : ""}`);
  if (r.ok) console.log(`  head: ${head(r.body)}`);
}

console.log("\n" + "=".repeat(74));
console.log("ECB — the fallback the brief names");
console.log("=".repeat(74));
// ECB quotes everything against the EURO, never against the dollar. So a
// CAD->USD rate from ECB is a CROSS of two ECB series (USD/EUR and CAD/EUR),
// not a lookup — which is a real difference from H.10 and is why the fallback
// cannot simply be swapped in field-for-field.
const ECB = [
  ["USD per EUR, daily, 6y", "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=2019-01-01&format=csvdata"],
  ["CAD per EUR, daily, 6y", "https://data-api.ecb.europa.eu/service/data/EXR/D.CAD.EUR.SP00.A?startPeriod=2019-01-01&format=csvdata"],
  ["USD per EUR, one day (2024-06-30, a Sunday)",
   "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=2024-06-30&endPeriod=2024-06-30&format=csvdata"],
  ["USD per EUR, that week", "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=2024-06-24&endPeriod=2024-07-01&format=csvdata"],
];
for (const [name, url] of ECB) {
  const r = await get(url);
  console.log(`\n${name}`);
  console.log(`  ${url}`);
  console.log(`  status ${r.status} ${r.ok ? "OK" : "FAIL"} ${r.ms}ms ct=${r.ct}${r.err ? ` err=${r.err}` : ""}`);
  if (r.ok) {
    const lines = String(r.body).trim().split("\n");
    console.log(`  ${lines.length} line(s). header: ${lines[0]?.slice(0, 180)}`);
    for (const l of lines.slice(1, 4)) console.log(`    ${l.slice(0, 180)}`);
    if (lines.length > 5) console.log(`    ... last: ${lines[lines.length - 1]?.slice(0, 180)}`);
  }
}

console.log("\n" + "=".repeat(74));
console.log("THE FOUR QUESTIONS, ANSWERED FROM WHAT CAME BACK ABOVE");
console.log("=".repeat(74));
console.log("Read them off the output rather than trusting this summary:");
console.log("  1. daily series >= 6 years back?      — does the 6y pull return early rows");
console.log("  2. a row on a non-trading day?        — the 2024-06-30 Sunday pull: empty or a row");
console.log("  3. can an average over a span be had? — the week pull: one row per business day");
console.log("  4. direction?                         — ECB D.USD.EUR is USD PER EURO,");
console.log("     so EUR -> USD is MULTIPLY by it. H.10 for CAD is CAD PER USD, so");
console.log("     CAD -> USD is DIVIDE. The two sources disagree in direction and that");
console.log("     is the single easiest thing to get backwards.");
