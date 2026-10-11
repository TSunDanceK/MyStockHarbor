// FRED'S CSV ENDPOINT FOR THE H.10 SERIES — the same four questions, asked of
// the source that actually publishes H.10 in machine-readable form.
//
// ── WHY THIS EXISTS SEPARATELY FROM fx-source-probe ───────────────────────
// That probe hit the raw federalreserve.gov release pages and a DDP URL whose
// `series=` hash was GUESSED. Every one returned 200 with text/html and the
// Fed's site chrome as the body, and the DDP URL returned 200 with an empty
// body. That is evidence the URLs were wrong, NOT evidence H.10 is
// unavailable, and recording it as the latter would have inverted an explicit
// decision on the strength of a bad guess.
//
// fredgraph.csv is the documented clean-CSV endpoint for the same H.10-sourced
// series, so this asks H.10's data the four questions before anything is
// concluded about it.
//
// ── THE FOUR, AND WHY EACH FAILS QUIETLY ──────────────────────────────────
//   1. A daily series six years back (SEC_YEAR_WINDOW is 6).
//   2. A non-trading day. FRED does not omit the row — it emits "." — which is
//      a DIFFERENT failure from ECB's missing row and a worse one: "." parses
//      to NaN silently, or to 0 under a careless Number() guard, and 0 is a
//      conversion rate that turns every figure into zero without erroring.
//   3. Every business day across a span, for the average the brief requires.
//   4. DIRECTION, read off the data rather than remembered. DEXUSEU is USD per
//      EUR (multiply) while DEXCAUS is CAD per USD (divide) — the two H.10
//      series disagree with each other, exactly as H.10 and ECB do.
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor fx probe";
const FRED = (id, extra = "") =>
  `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}${extra}`;

const get = async (url) => {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" } });
    return { ok: res.ok, status: res.status, ms: Date.now() - t0,
             ct: res.headers.get("content-type") ?? "", body: await res.text() };
  } catch (e) { return { ok: false, status: 0, ms: Date.now() - t0, err: String(e?.message ?? e) }; }
};

// A 200 CARRYING HTML IS NOT DATA — the rule fetchCompanyFacts already applies,
// and the one that would have caught the federalreserve.gov results as junk
// instead of as an empty series.
const looksLikeCsv = (r) =>
  r.ok && !/^\s*<!DOCTYPE|^\s*<html/i.test(r.body ?? "") &&
  /^[A-Za-z_]+,[A-Za-z0-9_]+/.test((r.body ?? "").trim().split("\n")[0] ?? "");

const rows = (body) =>
  body.trim().split("\n").slice(1)
    .map((l) => l.split(","))
    .filter((c) => c.length >= 2)
    .map(([date, val]) => ({ date: date.trim(), raw: (val ?? "").trim() }));

const report = async (label, url) => {
  const r = await get(url);
  console.log(`\n${label}`);
  console.log(`  ${url}`);
  console.log(`  status ${r.status} ${r.ok ? "OK" : "FAIL"} ${r.ms}ms ct=${r.ct}${r.err ? ` err=${r.err}` : ""}`);
  if (!r.ok) return null;
  if (!looksLikeCsv(r)) {
    console.log(`  NOT CSV — a 200 carrying HTML is not data. head: ${(r.body ?? "").slice(0, 200).replace(/\s+/g, " ")}`);
    return null;
  }
  const all = rows(r.body);
  console.log(`  header: ${r.body.trim().split("\n")[0]}`);
  console.log(`  ${all.length} data row(s)`);
  return all;
};

console.log("=".repeat(74));
console.log("FRED — fredgraph.csv, the H.10-sourced series");
console.log("=".repeat(74));

const SPAN = "&cosd=2019-01-01&coed=2026-12-31";
for (const [id, meaning] of [["DEXUSEU", "U.S. dollars to one EURO"], ["DEXCAUS", "Canadian dollars to one U.S. DOLLAR"]]) {
  const all = await report(`${id} — ${meaning}, 2019-01-01 onward`, FRED(id, SPAN));
  if (!all?.length) { console.log("  (nothing parseable — the four questions cannot be answered from this)"); continue; }
  const dots = all.filter((x) => x.raw === ".").length;
  const num = all.filter((x) => x.raw !== "." && Number.isFinite(Number(x.raw)));
  console.log(`  1. RANGE: ${all[0].date} .. ${all[all.length - 1].date}  (${num.length} numeric, ${dots} "." placeholders)`);
  console.log(`     first numeric: ${num[0]?.date} = ${num[0]?.raw}   last: ${num[num.length - 1]?.date} = ${num[num.length - 1]?.raw}`);
  // 2. THE NON-TRADING DAY. Printed as the RAW cell, because the whole point is
  //    that it is "." and not an absence — Number(".") is NaN, and a guard that
  //    coerced it to 0 would zero every converted figure without erroring.
  const sunday = all.find((x) => x.date === "2024-06-30");
  console.log(`  2. 2024-06-30 (a Sunday): ${sunday ? `row present, raw cell = ${JSON.stringify(sunday.raw)}` : "NO ROW AT ALL"}`);
  if (sunday) console.log(`     Number(${JSON.stringify(sunday.raw)}) = ${Number(sunday.raw)}  <- NaN, never 0, if the guard is Number.isFinite`);
  // 3. THE WEEK, every cell, so the average's inputs are visible rather than summarised.
  const week = all.filter((x) => x.date >= "2024-06-24" && x.date <= "2024-07-01");
  console.log(`  3. 2024-06-24..2024-07-01: ${week.length} row(s) — ${week.map((x) => `${x.date.slice(5)}=${x.raw}`).join(" ")}`);
  const wkNum = week.filter((x) => Number.isFinite(Number(x.raw)) && x.raw !== ".");
  if (wkNum.length) {
    const avg = wkNum.reduce((a, b) => a + Number(b.raw), 0) / wkNum.length;
    console.log(`     mean of the ${wkNum.length} numeric cells = ${avg.toFixed(6)}`);
  }
}

console.log("\n" + "=".repeat(74));
console.log("4. DIRECTION — read off the data, for the two filers the brief names");
console.log("=".repeat(74));
// ONE UNIT OF THE FILER'S CURRENCY, IN USD. Printed for both, because the two
// H.10 series point opposite ways and the wrong one is a plausible number
// (~1.2x or ~0.8x) rather than an error.
const one = async (id) => {
  const all = await report(`${id} spot check`, FRED(id, "&cosd=2026-09-01&coed=2026-12-31"));
  const n = all?.filter((x) => x.raw !== "." && Number.isFinite(Number(x.raw)));
  return n?.length ? n[n.length - 1] : null;
};
const eu = await one("DEXUSEU");
const ca = await one("DEXCAUS");
if (eu) console.log(`\n  RYAAY (EUR): DEXUSEU ${eu.date} = ${eu.raw} USD per EUR  ->  EUR->USD MULTIPLIES. 1 EUR = $${Number(eu.raw).toFixed(4)}`);
if (ca) console.log(`  CNI   (CAD): DEXCAUS ${ca.date} = ${ca.raw} CAD per USD  ->  CAD->USD DIVIDES.   1 CAD = $${(1 / Number(ca.raw)).toFixed(4)}`);
console.log(`\n  The two series point OPPOSITE WAYS. DEXUSEU is USD-per-foreign and`);
console.log(`  DEXCAUS is foreign-per-USD, so a single "rate" field with one`);
console.log(`  multiply would be right for RYAAY and wrong for CNI by ~1.96x.`);
