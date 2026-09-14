// How predictable is a filer's results date from its own filing history?
//
// THE QUESTION THIS ANSWERS, AND WHY IT IS NOT A DETAIL. The earnings calendar's
// forward half currently comes from FMP's earnings-calendar feed. If the site is
// to leave FMP (claude/BUILD-BRIEF-earnings-off-fmp-2026-09-13.md), the forward
// dates have to come from somewhere free, and §4 of that brief proposes "filing
// cadence" as the fallback, labelled hedged. Nothing has measured whether that
// fallback is good enough to put in front of a reader. This does.
//
// READ-ONLY BY CONSTRUCTION. No Redis client is imported, no FMP endpoint is
// touched, and nothing is written outside the run log. It runs in the relay's
// read-only job, which references no secrets at all.
//
// WHY IT RUNS ON A RUNNER. The agent sandbox is refused data.sec.gov with
// 403 CONNECT (re-confirmed 2026-09-14 against the proxy's own failure log), so
// this cannot be measured locally. Same reason as every other sec-* relay task.
//
// ── THE MEASUREMENT ────────────────────────────────────────────────────────
//   B1  every 8-K whose `items` contains 2.02, with its filingDate. For foreign
//       private issuers, 6-K instead, deduplicated on accn.
//   B2  pair each results date with its fiscal period end, compute the lag, then
//       walk forward: at filing n predict n+1 as (period end) + median(lag 1..n).
//   B3  the signed-error distribution, domestic vs FPI.
//   B4  how often the prediction lands past the statutory deadline.
//
// A FAILED FETCH IS REPORTED AS A FAILURE, never as an absence. A symbol whose
// submissions call 403s and a symbol that genuinely files no 2.02 look identical
// in a count of "symbols with no results dates", and only one of them is a fact
// about the filer. They are tallied separately throughout.
import fs from "node:fs";

const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (contact@mystockharbor.com)";
const HEADERS = { "user-agent": UA, accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86_400_000;

// SEC's published policy is 10 requests/second. 150ms is ~6.7/s, the same
// spacing scripts/sec-probe.mjs settled on.
const SPACING_MS = 150;

// ── The sample ─────────────────────────────────────────────────────────────
//
// ROLES ARE THE SELECTION INTENT, NOT A MEASUREMENT. "mega-cap to sub-500M" is
// how these were chosen; this script has no market-cap source (that would mean
// FMP) so it cannot verify the size spread and does not claim to. What it DOES
// verify and report per symbol is the filer class and the fiscal year end, both
// of which come from the submissions payload itself.
const SAMPLE = [
  // 40 domestic 10-Q filers, mega-cap down to small-cap.
  ["AAPL", "domestic"], ["MSFT", "domestic"], ["NVDA", "domestic"], ["AMZN", "domestic"],
  ["GOOGL", "domestic"], ["META", "domestic"], ["JPM", "domestic"], ["WMT", "domestic"],
  ["XOM", "domestic"], ["JNJ", "domestic"], ["PG", "domestic"], ["KO", "domestic"],
  ["ORCL", "domestic"], ["ADBE", "domestic"], ["CRM", "domestic"], ["AMD", "domestic"],
  ["INTC", "domestic"], ["CSCO", "domestic"], ["QCOM", "domestic"], ["TXN", "domestic"],
  ["COST", "domestic"], ["NKE", "domestic"], ["FDX", "domestic"], ["DE", "domestic"],
  ["MU", "domestic"], ["AVGO", "domestic"], ["HPQ", "domestic"], ["JBL", "domestic"],
  ["PLAB", "domestic"], ["AEHR", "domestic"], ["AOSL", "domestic"], ["DAKT", "domestic"],
  ["UFPT", "domestic"], ["CTS", "domestic"], ["CRAI", "domestic"], ["NPK", "domestic"],
  ["DLTH", "domestic"], ["IRMD", "domestic"], ["VUZI", "domestic"], ["KOPN", "domestic"],
  // 10 foreign private issuers (6-K / 20-F). ARM is required by the brief.
  ["ARM", "fpi"], ["ASML", "fpi"], ["TSM", "fpi"], ["SAP", "fpi"], ["BABA", "fpi"],
  ["SONY", "fpi"], ["NVO", "fpi"], ["AZN", "fpi"], ["INFY", "fpi"], ["SE", "fpi"],
  // 10 seeded from the probe's own non-calendar fiscal-year set (FY ends of
  // 31 Mar, 26 Sep, 3 Sep, 31 Oct, 31 Dec measured 2026-09-13). Several also
  // appear above; the fiscal-year segment is reported from the payload's own
  // fiscalYearEnd rather than from this tag, so the overlap costs nothing.
  ["TSN", "noncal"], ["JEF", "noncal"], ["CAG", "noncal"], ["GIS", "noncal"],
  ["MKC", "noncal"], ["TTC", "noncal"], ["LZB", "noncal"], ["SJM", "noncal"],
  ["ADI", "noncal"], ["KMX", "noncal"],
];

// ── CIK resolution, offline ────────────────────────────────────────────────
// data/sec/company-tickers.json is committed (relay run 47), so resolving a
// ticker costs no request and cannot fail differently on the runner.
const TICKERS_FILE = "data/sec/company-tickers.json";
if (!fs.existsSync(TICKERS_FILE)) {
  console.error(`FATAL: ${TICKERS_FILE} is missing on this ref. Nothing can be resolved.`);
  process.exit(1);
}
const tickersRaw = JSON.parse(fs.readFileSync(TICKERS_FILE, "utf8"));
const cikByTicker = new Map();
for (const row of tickersRaw.data ?? []) {
  const [cik, , ticker] = row;
  if (ticker) cikByTicker.set(String(ticker).toUpperCase(), String(cik).padStart(10, "0"));
}
console.log(`[b] ticker file: ${Object.keys(cikByTicker).length || cikByTicker.size} entries`);
console.log(`[b] user-agent: ${JSON.stringify(UA)}`);
console.log(`[b] sample: ${SAMPLE.length} symbols`);
console.log("");

// ── Fetch ──────────────────────────────────────────────────────────────────
async function getJson(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: HEADERS });
    const text = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, status: res.status, ms, bytes: text.length, error: `HTTP ${res.status}` };
    try {
      return { ok: true, status: res.status, ms, bytes: text.length, body: JSON.parse(text) };
    } catch (e) {
      return { ok: false, status: res.status, ms, bytes: text.length, error: `unparseable JSON: ${e.message}` };
    }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, bytes: 0, error: `network: ${e.message}` };
  }
}

/** Flatten a submissions `filings.recent`-shaped column store into row objects. */
function rows(block) {
  const n = block?.accessionNumber?.length ?? 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      accn: block.accessionNumber[i],
      form: block.form?.[i] ?? "",
      filingDate: block.filingDate?.[i] ?? "",
      reportDate: block.reportDate?.[i] ?? "",
      items: block.items?.[i] ?? "",
    });
  }
  return out;
}

const parse = (d) => (d ? Date.parse(`${d}T00:00:00.000Z`) : NaN);
const days = (a, b) => Math.round((a - b) / DAY);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

// ── Per-symbol collection ──────────────────────────────────────────────────
const results = [];
const fetchFailures = [];
let totalBytes = 0;
let totalRequests = 0;
let totalMs = 0;

for (const [symbol, tag] of SAMPLE) {
  const cik = cikByTicker.get(symbol);
  if (!cik) {
    fetchFailures.push({ symbol, why: "no CIK in company-tickers.json" });
    console.log(`[b] ${symbol.padEnd(6)} SKIP   no CIK in the ticker file`);
    continue;
  }

  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const res = await getJson(url);
  totalRequests++; totalBytes += res.bytes; totalMs += res.ms;
  await sleep(SPACING_MS);

  if (!res.ok) {
    fetchFailures.push({ symbol, why: res.error });
    console.log(`[b] ${symbol.padEnd(6)} FAIL   ${res.error} · ${res.ms}ms`);
    continue;
  }

  const body = res.body;
  let all = rows(body?.filings?.recent ?? {});

  // `recent` holds roughly the last 1,000 filings. A heavy filer can exhaust its
  // 2.02 history inside that window; the older pages live in filings.files[].
  // Only paged when the recent block is short of the bar, and capped, because
  // every page is another request against a 10/sec policy.
  const extraFiles = body?.filings?.files ?? [];
  let pagesRead = 0;
  const countResults = (rs) =>
    tag === "fpi"
      ? rs.filter((r) => r.form === "6-K").length
      : rs.filter((r) => r.form === "8-K" && String(r.items).includes("2.02")).length;

  for (const f of extraFiles) {
    if (countResults(all) >= 12 || pagesRead >= 2) break;
    const pres = await getJson(`https://data.sec.gov/submissions/${f.name}`);
    totalRequests++; totalBytes += pres.bytes; totalMs += pres.ms;
    pagesRead++;
    await sleep(SPACING_MS);
    if (pres.ok) all = all.concat(rows(pres.body ?? {}));
    else console.log(`[b] ${symbol.padEnd(6)} WARN   extra page ${f.name}: ${pres.error}`);
  }

  // Filer class from the payload, not from the sample tag.
  const forms = new Set(all.map((r) => r.form));
  const isFpi = (forms.has("20-F") || forms.has("40-F")) && !forms.has("10-Q");
  const category = body?.category ?? "";
  const fyEnd = body?.fiscalYearEnd ?? "";

  // ── B1: results dates ───────────────────────────────────────────────────
  let pairs = []; // { periodEnd, resultsDate, lag }
  let rawCount = 0;
  let unpairable = 0;

  if (isFpi) {
    // 6-K, deduplicated on accn. ARM files them in same-day pairs, so where a
    // day carries more than one, keep the one whose reportDate reads as a
    // period reference rather than a same-day event notice.
    const seen = new Set();
    const sixK = all
      .filter((r) => r.form === "6-K" && !seen.has(r.accn) && seen.add(r.accn))
      .filter((r) => r.reportDate && r.filingDate)
      .filter((r) => days(parse(r.filingDate), parse(r.reportDate)) >= 20);
    rawCount = sixK.length;

    const byDay = new Map();
    for (const r of sixK) {
      const cur = byDay.get(r.filingDate);
      // Later reportDate = the closest preceding period end = the results 6-K.
      if (!cur || parse(r.reportDate) > parse(cur.reportDate)) byDay.set(r.filingDate, r);
    }

    // NO CALENDAR QUARTERS ASSUMED (brief §3.4: measured fiscal year ends include
    // 26 Sep and 3 Sep). A period end is accepted because it sits a QUARTER's
    // distance from the last accepted one, not because it lands on 31 March.
    const ordered = [...byDay.values()].sort((a, b) => parse(a.reportDate) - parse(b.reportDate));
    let lastEnd = null;
    for (const r of ordered) {
      const p = parse(r.reportDate);
      if (lastEnd !== null) {
        const gap = days(p, lastEnd);
        if (gap < 60 || gap > 120) { unpairable++; continue; }
      }
      lastEnd = p;
      pairs.push({ periodEnd: r.reportDate, resultsDate: r.filingDate, lag: days(parse(r.filingDate), p) });
    }
  } else {
    // Period ends come from the periodic reports, whose reportDate IS the
    // fiscal period end. The 8-K's own reportDate is the press-release event.
    const periodEnds = [...new Set(
      all.filter((r) => /^10-[QK]/.test(r.form) && r.reportDate).map((r) => r.reportDate)
    )].map(parse).filter(Number.isFinite).sort((a, b) => a - b);

    const seen = new Set();
    const eight = all
      .filter((r) => r.form === "8-K" && String(r.items).includes("2.02"))
      .filter((r) => r.filingDate && !seen.has(r.accn) && seen.add(r.accn));
    rawCount = eight.length;

    // One results date per day: a company can file two 2.02 8-Ks on one day.
    const byDay = new Map();
    for (const r of eight) if (!byDay.has(r.filingDate)) byDay.set(r.filingDate, r);

    for (const r of [...byDay.values()].sort((a, b) => parse(a.filingDate) - parse(b.filingDate))) {
      const R = parse(r.filingDate);
      let P = null;
      for (const p of periodEnds) {
        if (p <= R && days(R, p) <= 120) { if (P === null || p > P) P = p; }
      }
      if (P === null) { unpairable++; continue; }
      pairs.push({
        periodEnd: new Date(P).toISOString().slice(0, 10),
        resultsDate: r.filingDate,
        lag: days(R, P),
      });
    }
    // One results date per fiscal period. A period that picked up two (an
    // original and a correction) would otherwise contribute a zero-length gap.
    const byPeriod = new Map();
    for (const p of pairs) if (!byPeriod.has(p.periodEnd)) byPeriod.set(p.periodEnd, p);
    pairs = [...byPeriod.values()].sort((a, b) => parse(a.periodEnd) - parse(b.periodEnd));
  }

  results.push({ symbol, isFpi, category, fyEnd, pairs, rawCount, unpairable, pagesRead });
  console.log(
    `[b] ${symbol.padEnd(6)} OK     ${isFpi ? "FPI " : "DOM "} fy=${fyEnd} ` +
    `raw=${String(rawCount).padStart(3)} usable=${String(pairs.length).padStart(3)} ` +
    `unpairable=${unpairable} pages=+${pagesRead} ${res.ms}ms ${(res.bytes / 1024).toFixed(1)}KB ` +
    `cat=${JSON.stringify(category)}`
  );
}

console.log("");
console.log(`[b] requests: ${totalRequests} · bytes: ${(totalBytes / 1024).toFixed(1)} KB · ` +
  `mean latency: ${totalRequests ? Math.round(totalMs / totalRequests) : 0}ms`);

// ── B2: walk-forward prediction ────────────────────────────────────────────
//
// At filing n, predict n+1 as (n+1's period end) + median(lag over 1..n).
// The period end of the NEXT filing is taken as known, exactly as specified.
// That is generous — in production it would itself be projected — so every
// error below is a FLOOR on the error a shipped predictor would carry.
const MIN_USABLE = 8;
const SEED = 3; // predictions start once the median has three lags behind it

const excluded = results.filter((r) => r.pairs.length < MIN_USABLE);
const included = results.filter((r) => r.pairs.length >= MIN_USABLE);

const preds = [];
for (const r of included) {
  for (let n = SEED; n < r.pairs.length; n++) {
    const hist = r.pairs.slice(0, n).map((p) => p.lag);
    const next = r.pairs[n];
    const predicted = parse(next.periodEnd) + Math.round(median(hist)) * DAY;
    const actual = parse(next.resultsDate);
    preds.push({
      symbol: r.symbol,
      isFpi: r.isFpi,
      category: r.category,
      periodEnd: next.periodEnd,
      error: days(predicted, actual), // signed: + = predicted late
      predicted,
      periodEndMs: parse(next.periodEnd),
    });
  }
}

const seg = (xs) => {
  if (!xs.length) return null;
  const abs = xs.map((p) => Math.abs(p.error)).sort((a, b) => a - b);
  const within = (k) => xs.filter((p) => Math.abs(p.error) <= k).length;
  const p90 = abs[Math.min(abs.length - 1, Math.ceil(0.9 * abs.length) - 1)];
  const tail = xs.filter((p) => Math.abs(p.error) > 14);
  const byS = new Map();
  for (const t of tail) byS.set(t.symbol, (byS.get(t.symbol) ?? 0) + 1);
  return {
    n: xs.length,
    symbols: new Set(xs.map((p) => p.symbol)).size,
    medAbs: median(abs),
    w3: within(3), w7: within(7),
    p90,
    tailN: tail.length,
    tailSymbols: [...byS.entries()].sort((a, b) => b[1] - a[1]),
    medSigned: median(xs.map((p) => p.error)),
  };
};

const dom = seg(preds.filter((p) => !p.isFpi));
const fpi = seg(preds.filter((p) => p.isFpi));
const all = seg(preds);

// ── B4: statutory deadline ─────────────────────────────────────────────────
// 40 days after period end for large accelerated filers, 45 otherwise.
const deadlineDays = (category) => (/large accelerated/i.test(category ?? "") ? 40 : 45);
const past = preds.filter((p) => days(p.predicted, p.periodEndMs) > deadlineDays(p.category));
const pastBySeg = {
  dom: past.filter((p) => !p.isFpi).length,
  fpi: past.filter((p) => p.isFpi).length,
};
const pastBySymbol = new Map();
for (const p of past) pastBySymbol.set(p.symbol, (pastBySymbol.get(p.symbol) ?? 0) + 1);
// Of the predictions that overshot the deadline, how many were ALSO wrong by
// more than 3 days? A clamp only helps where the prediction was actually bad.
const pastAndWrong = past.filter((p) => Math.abs(p.error) > 3).length;

// ── Report. PRINTED LAST, because the run log is read from its tail. ────────
const row = (label, s) =>
  s
    ? `| ${label} | ${s.n} | ${s.symbols} | ${s.medAbs} | ${pct(s.w3, s.n)} | ${pct(s.w7, s.n)} | ${s.p90} | ${s.tailN} (${pct(s.tailN, s.n)}) |`
    : `| ${label} | 0 | 0 | — | — | — | — | — |`;

console.log(`
================================================================
RESULTS-DATE PREDICTABILITY — ${new Date().toISOString()}
================================================================

B1 — COVERAGE
  sample                       ${SAMPLE.length}
  fetched OK                   ${results.length}
  fetch/resolve failures       ${fetchFailures.length}${fetchFailures.length ? `  (${fetchFailures.map((f) => `${f.symbol}: ${f.why}`).join("; ")})` : ""}
  classified FPI from payload  ${results.filter((r) => r.isFpi).length}
  classified domestic          ${results.filter((r) => !r.isFpi).length}

  symbols with < ${MIN_USABLE} usable results dates: ${excluded.length} of ${results.length} (${pct(excluded.length, results.length)})
${excluded.length ? excluded.map((r) => `    ${r.symbol.padEnd(6)} ${r.isFpi ? "FPI" : "DOM"} usable=${r.pairs.length} raw=${r.rawCount} unpairable=${r.unpairable}`).join("\n") : "    (none)"}

  These are EXCLUDED from B2/B3. The count is itself the finding: a filer the
  history cannot cover is one the forward calendar cannot predict at all.

B2/B3 — SIGNED ERROR, predicted minus actual (+ = predicted too late)
  ${preds.length} predictions over ${included.length} symbols, seeded after ${SEED} lags.

| segment | preds | symbols | median abs err (d) | within ±3 | within ±7 | p90 abs (d) | out by >14d |
|---|---|---|---|---|---|---|---|
${row("domestic", dom)}
${row("FPI", fpi)}
${row("all", all)}

  median SIGNED error — domestic ${dom ? dom.medSigned : "—"}d · FPI ${fpi ? fpi.medSigned : "—"}d
  (a non-zero signed median is a systematic bias, not noise)

  TAIL — where the >14d misses sit:
    domestic  ${dom && dom.tailSymbols.length ? dom.tailSymbols.map(([s, c]) => `${s}×${c}`).join(" ") : "(none)"}
    FPI       ${fpi && fpi.tailSymbols.length ? fpi.tailSymbols.map(([s, c]) => `${s}×${c}`).join(" ") : "(none)"}
    Concentrated in a few filers = clampable per symbol. Spread evenly = the
    method is wrong, not the filers.

B4 — PREDICTIONS PAST THE STATUTORY DEADLINE
  rule: period end + 40d (large accelerated) / +45d (all others), from the payload's own "category" field
  past deadline        ${past.length} of ${preds.length} (${pct(past.length, preds.length)})
    domestic           ${pastBySeg.dom}
    FPI                ${pastBySeg.fpi}
  of those, also wrong by >3d   ${pastAndWrong} (${pct(pastAndWrong, past.length || 1)})
  filers that fire     ${[...pastBySymbol.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => `${s}×${c}`).join(" ") || "(none)"}

  A prediction past the deadline is knowably wrong before it is published, so
  it is clampable for free. This is how often that clamp would fire.

NOT A PRODUCT DECISION. Numbers only, per the brief.
================================================================
`);
