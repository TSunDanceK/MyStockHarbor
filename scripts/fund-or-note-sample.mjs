// Does a `fund-or-note` symbol's query EVER return usable news?
//
//   relay task "fund-or-note"   (read-only job; no credentials referenced)
//
// ── THE DECISION THIS EXISTS TO SETTLE ────────────────────────────────────
// assessCompanyName returns `fund-or-note` for a name that is an instrument
// description rather than a company, and its own comment says such names
// "should never reach a per-symbol news query". gnewsProvider disagrees in
// code: the verdict is logged as an override candidate and the query is sent
// anyway. One of the two is wrong, and which one cannot be settled by reading
// either file.
//
// THE POPULATION IS 90, NOT 11. Measured against the committed snapshot
// (data/company-names.json, 2,610 names) with the real normaliser and the real
// assessor: 2,504 ok, 90 fund-or-note, 10 too-short, 6 single-common-word. The
// 11 that PR #463 added are an eighth of the population; the other 79 have been
// querying this way for as long as the adapter has shipped.
//
// ── WHY THE VERDICT IS NOT SAFE TO TURN INTO A SKIP ──────────────────────
// The marker regex fires on THREE different things, and only one of them is an
// instrument:
//
//   1. a real operating company whose UNITS are the tradeable line
//      ET "Energy Transfer LP Common Units", MPLX, WES, SUN, CQP, BIP --
//      large-cap MLPs with continuous coverage
//   2. a real company with a security word in its OWN NAME
//      PFBC "Preferred Bank" (a commercial bank; raw name is
//      "Preferred Bank - Common Stock"), MSDL "Morgan Stanley Direct Lending
//      Fund", BXSL "Blackstone Secured Lending Fund" -- BDCs whose COMMON
//      STOCK trades
//   3. a genuine instrument with no news of its own
//      TBB "AT&T Inc. 5.350% Global Notes due 2066", the junior subordinated
//      debentures, the preferreds
//
// A skip keyed on this verdict deletes the news leg of (1) and (2) to save the
// fetch on (3). That is the trade to measure before making, not after.
//
// ── IT PRINTS. IT DOES NOT DECIDE. ───────────────────────────────────────
// Two queries per symbol, and the PAIR is the measurement:
//
//   LIVE    exactly what gnewsProvider sends today: `"<normalised>" stock`
//   PARENT  the same symbol with the instrument clause cut off
//
// LIVE=0 PARENT=0  the symbol has no news; a skip costs nothing
// LIVE=0 PARENT>0  the QUERY is wrong, not the symbol -- a skip would delete
//                  news that a better normaliser would find
// LIVE>0           "warn but try" is right as it stands for this symbol
//
// Headlines are printed so a human classifies them. This script does not grade
// its own queries (claude/traps/two-validators-for-one-value.md).
//
// The name pairs below were generated from the committed snapshot by running
// the REAL lib/server/news/companyName.ts through tsc -- not by a mirror of it.
// The read-only relay job runs no `npm ci`, so it has no TypeScript to load
// that module with, and a hand-written mirror is the duplication this repo has
// already paid for twice. Literals instead, with the query printed next to
// every result so the dispatch is auditable against the source.

const LOCALE = "hl=en-US&gl=US&ceid=US:en";
const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; fund-or-note query measurement)";

// CONTROLS ARE `ok`-VERDICT NAMES, and they are the measuring-nothing guard.
// Most queries below are EXPECTED to come back empty, so an aggregate pool
// threshold would be satisfied by the controls alone while every real query
// failed silently. The guard has to be that the controls specifically worked.
const CONTROL_SYMBOLS = new Set(["AAPL", "KO"]);

const SUBJECTS = [
  { symbol: "ET", live: "Energy Transfer LP Common Units", parent: "Energy Transfer" },
  { symbol: "MPLX", live: "MPLX LP Common Units Representing Limited Partner Interests", parent: "MPLX" },
  { symbol: "WES", live: "Western Midstream Partners, LP Common Units Representing Limited Partner Interests", parent: "Western Midstream Partners" },
  { symbol: "SUN", live: "Sunoco LP Common Units representing limited partner interests", parent: "Sunoco" },
  { symbol: "CQP", live: "Cheniere Energy Partners, LP Common Units", parent: "Cheniere Energy Partners" },
  { symbol: "BIP", live: "Brookfield Infrastructure Partners LP Limited Partnership Units", parent: "Brookfield Infrastructure Partners" },
  { symbol: "MSDL", live: "Morgan Stanley Direct Lending Fund", parent: "Morgan Stanley Direct Lending Fund" },
  { symbol: "BXSL", live: "Blackstone Secured Lending Fund Common Shares of Beneficial Interest", parent: "Blackstone Secured Lending Fund" },
  { symbol: "PFBC", live: "Preferred Bank", parent: "Preferred Bank" },
  { symbol: "TBB", live: "AT&T Inc. 5.350% Global Notes due 2066", parent: "AT&T" },
  { symbol: "UNMA", live: "Unum Group 6.250% Junior Subordinated Notes due 2058", parent: "Unum" },
  { symbol: "PFH", live: "Prudential Financial, Inc. 4.125% Junior Subordinated Notes due 2060", parent: "Prudential Financial" },
  { symbol: "DUKB", live: "Duke Energy Corporation 5.625% Junior Subordinated Debentures due 2078", parent: "Duke Energy" },
  { symbol: "SOJC", live: "Southern Company (The) Series 2017B 5.25% Junior Subordinated Notes due December 1, 2077", parent: "Southern" },
  { symbol: "CMS-PB", live: "CMS Energy Corporation Preferred Stock", parent: "CMS Energy" },
  { symbol: "CTA-PA", live: "EIDP, Inc. Preferred Stock $3.50 Series", parent: "EIDP" },
  { symbol: "MER-PK", live: "Bank of America Corporation Income Capital Obligation Notes initially due December 15, 2066", parent: "Bank of America" },
  { symbol: "EP-PC", live: "El Paso Corporation Preferred Stock", parent: "El Paso" },
  { symbol: "FITB-PM", live: "Fifth Third Bancorp Depositary Shares Representing a 1/40th Ownership Interest in a Share of 6.875% Fixed-Rate Reset Non-Cumulative Perpetual Preferred Stock, Series M", parent: "Fifth Third Bancorp" },
  { symbol: "PBR-A", live: "Petroleo Brasileiro S.A. Petrobras American Depositary Shares representing Preferred Shares", parent: "Petroleo Brasileiro S.A. Petrobras" },
  { symbol: "AAPL", live: "Apple", parent: "Apple" },
  { symbol: "KO", live: "Coca-Cola", parent: "Coca-Cola" },
];

const strip = (s) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Titles for one query, or null if the fetch itself failed. */
async function poolFor(name) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}" stock`)}&${LOCALE}`;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) {
      console.log(`      HTTP ${res.status}`);
      return null;
    }
    const xml = await res.text();
    return xml.split("<item>").slice(1)
      .map((b) => strip((b.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? ""))
      .filter(Boolean);
  } catch (err) {
    console.log(`      FETCH FAILED: ${String(err)}`);
    return null;
  }
}

const results = [];
for (const s of SUBJECTS) {
  console.log(`\n===== ${s.symbol}${CONTROL_SYMBOLS.has(s.symbol) ? "   [CONTROL, verdict ok]" : ""}`);

  console.log(`  LIVE    q="${s.live}" stock`);
  const live = await poolFor(s.live);
  await sleep(400);
  console.log(`          pool=${live === null ? "FETCH-FAILED" : live.length}`);
  for (const t of (live ?? []).slice(0, 5)) console.log(`           · ${t}`);

  // Skipped when the cut changed nothing -- two identical queries measure one
  // thing twice and would read as agreement.
  let parent = null;
  if (s.parent !== s.live) {
    console.log(`  PARENT  q="${s.parent}" stock`);
    parent = await poolFor(s.parent);
    await sleep(400);
    console.log(`          pool=${parent === null ? "FETCH-FAILED" : parent.length}`);
    for (const t of (parent ?? []).slice(0, 5)) console.log(`           · ${t}`);
  } else {
    console.log(`  PARENT  (identical to LIVE -- the clause cut changed nothing)`);
  }

  results.push({ ...s, live: live?.length ?? null, parent: s.parent !== s.live ? parent?.length ?? null : null });
}

// ── THE GUARD ────────────────────────────────────────────────────────────
// An empty pool is a legitimate RESULT for most rows here, so "everything was
// empty" cannot be distinguished from "the feed refused us" by totals alone.
// The controls are ordinary company names that must return news; if they do
// not, nothing above is a measurement.
const badControls = results.filter((r) => CONTROL_SYMBOLS.has(r.symbol) && !(r.live > 0));
if (badControls.length) {
  console.error(
    `\nFATAL: control symbol(s) ${badControls.map((r) => r.symbol).join(", ")} returned no pool. ` +
      `Google News did not answer, so every count above is an artefact rather than a measurement.`
  );
  process.exit(1);
}

console.log(`\n\n===== SUMMARY (pool sizes; - = not queried)`);
console.log(`  ${"symbol".padEnd(10)} ${"LIVE".padEnd(6)} ${"PARENT".padEnd(7)} verdict-if-skipped`);
for (const r of results) {
  if (CONTROL_SYMBOLS.has(r.symbol)) continue;
  const verdict =
    r.live > 0 ? "warn-but-try IS right here"
    : r.parent > 0 ? "SKIP WOULD DELETE REAL NEWS — the query is wrong, not the symbol"
    : "no news either way — skip costs nothing";
  console.log(`  ${r.symbol.padEnd(10)} ${String(r.live ?? "-").padEnd(6)} ${String(r.parent ?? "-").padEnd(7)} ${verdict}`);
}
