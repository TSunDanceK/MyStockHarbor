// Is a foreign private issuer's FILED EPS per ordinary share, or per ADS?
//
// ── WHY THIS IS A MEASUREMENT AND NOT A READING OF THE FILINGS ─────────────
// #489 suppressed the market cap for HDB, IBN, TSM, BABA and ASML because the
// cover-page share count is in ORDINARY shares while every price on this site
// is per ADS. The open question it recorded was whether the P/E beside it has
// the same defect, and that turns entirely on which unit `EarningsPerShare-
// Diluted` is filed in. It is NOT safe to assume symmetry with the share
// count: the share count is a count of ordinary shares by definition, whereas
// EPS is whatever the filer chose to state, and 20-F filers differ.
//
// ── THE TEST IS INTERNAL TO THE FILING, WHICH IS WHY IT IS TRUSTWORTHY ─────
// No ADS ratio is looked up, asserted or hardcoded. The filing states three
// numbers for the same period and they must be consistent:
//
//   epsDiluted x sharesDiluted / netIncome
//
// `sharesDiluted` is a count of ORDINARY shares. So:
//
//   ratio ~ 1   EPS is per ORDINARY share -> same unit as the share count,
//               DIFFERENT unit from the price. THE P/E IS DEFECTIVE.
//   ratio ~ N   EPS is per ADS, where N is the ADS ratio the filer used ->
//               SAME unit as the price. The P/E is correct and must be left
//               alone.
//
// The ratio falls out of the filer's own arithmetic, so a filer that changed
// its ADS ratio, or that never had one, is described by its own numbers rather
// than by a table someone maintained.
//
// ── STRICTNESS, FOR THE REASON THE STOOQ PARSER WAS STRICT ────────────────
// Every operand must come from the SAME period AND the SAME accession. Mixing
// a restated net income with an original share count produces a ratio that is
// neither 1 nor N and means nothing. A period missing any of the three is
// skipped and counted, never defaulted. A filer whose periods disagree with
// each other is reported as DISAGREEING rather than averaged into a verdict --
// an average of 1 and 5 is 3, which is not a unit anything is filed in.
//
//   relay task: ads-eps-unit   (read-only, uncredentialled, no dump needed)
import { emitPayload } from "./lib/relay-capture.mjs";

const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; provider evaluation)";

const SYMBOLS = ["HDB", "IBN", "TSM", "BABA", "ASML"];

// The three tags, in the same spelling lib/server/secFields.ts resolves.
const NET_INCOME = "NetIncomeLoss";
const SHARES_DILUTED = "WeightedAverageNumberOfDilutedSharesOutstanding";
const EPS_DILUTED = "EarningsPerShareDiluted";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  // sec.gov's fair-access policy wants a declared, identifying User-Agent and a
  // modest rate. Both are honoured; nothing here pretends to be a browser.
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) return { ok: false, status: res.status };
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return { ok: false, status: res.status, contentType: ct };
  return { ok: true, body: await res.json() };
}

/** Every (end, accn) a tag reports, keyed so three tags can be intersected. */
function byPeriod(facts, tag) {
  const out = new Map();
  const units = facts?.facts?.["us-gaap"]?.[tag]?.units;
  if (!units) return out;
  for (const rows of Object.values(units)) {
    for (const r of rows) {
      // QUARTERS AND YEARS BOTH QUALIFY -- the unit question is the same for
      // either, and a filer with only annual data (common for 20-F) would
      // otherwise yield nothing at all.
      if (!r.end || !r.accn || r.val === null || r.val === undefined) continue;
      out.set(`${r.start ?? ""}|${r.end}|${r.accn}|${r.fy}|${r.fp}`, r.val);
    }
  }
  return out;
}

const results = [];

for (const symbol of SYMBOLS) {
  const tickers = await getJson("https://www.sec.gov/files/company_tickers.json");
  if (!tickers.ok) {
    results.push({ symbol, verdict: "UNRESOLVED", why: `ticker map ${tickers.status}` });
    continue;
  }
  const hit = Object.values(tickers.body).find(
    (r) => String(r.ticker).toUpperCase() === symbol
  );
  if (!hit) {
    results.push({ symbol, verdict: "UNRESOLVED", why: "not in company_tickers.json" });
    continue;
  }
  const cik = String(hit.cik_str).padStart(10, "0");

  await sleep(250);
  const facts = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!facts.ok) {
    results.push({ symbol, cik, verdict: "UNRESOLVED", why: `companyfacts ${facts.status}` });
    continue;
  }

  const ni = byPeriod(facts.body, NET_INCOME);
  const sh = byPeriod(facts.body, SHARES_DILUTED);
  const eps = byPeriod(facts.body, EPS_DILUTED);

  const ratios = [];
  let skipped = 0;
  for (const [key, epsVal] of eps) {
    const niVal = ni.get(key);
    const shVal = sh.get(key);
    if (niVal === undefined || shVal === undefined) { skipped++; continue; }
    // A near-zero net income makes the ratio explode; those periods say nothing
    // about the unit and are dropped rather than allowed to dominate.
    if (!Number.isFinite(niVal) || Math.abs(niVal) < 1e6 || !shVal || !epsVal) { skipped++; continue; }
    ratios.push({ key, ratio: (epsVal * shVal) / niVal, eps: epsVal, shares: shVal, netIncome: niVal });
  }

  if (!ratios.length) {
    results.push({
      symbol, cik, verdict: "NO OVERLAPPING PERIODS", skipped,
      counts: { netIncome: ni.size, sharesDiluted: sh.size, epsDiluted: eps.size },
      note: "the three tags never co-occur on one accession; this filer cannot be judged from companyfacts",
    });
    continue;
  }

  ratios.sort((a, b) => a.ratio - b.ratio);
  const median = ratios[Math.floor(ratios.length / 2)].ratio;
  const min = ratios[0].ratio;
  const max = ratios[ratios.length - 1].ratio;

  // A UNIT IS A SMALL INTEGER OR IT IS NOT A UNIT. 0.9-1.1 is "per ordinary";
  // anything clustering near an integer >= 2 is "per ADS at that ratio".
  const near = (x, t) => Math.abs(x - t) / t < 0.1;
  const spread = max / min;
  let verdict;
  if (spread > 1.25) {
    verdict = "DISAGREES ACROSS PERIODS";
  } else if (near(median, 1)) {
    verdict = "PER ORDINARY SHARE -> P/E IS DEFECTIVE";
  } else {
    const implied = Math.round(median);
    verdict = implied >= 2 && near(median, implied)
      ? `PER ADS (implied ratio ${implied}) -> P/E IS CORRECT`
      : "INCONCLUSIVE — ratio is not near a whole number";
  }

  results.push({
    symbol, cik, verdict,
    periods: ratios.length, skipped,
    ratio: { median: +median.toFixed(4), min: +min.toFixed(4), max: +max.toFixed(4) },
    sample: ratios.slice(-3).map((r) => ({
      period: r.key, eps: r.eps, sharesDiluted: r.shares, netIncome: r.netIncome,
      ratio: +r.ratio.toFixed(4),
    })),
  });
  await sleep(250);
}

console.log("\n=== ADS EPS UNIT PROBE ===");
for (const r of results) {
  console.log(`${r.symbol.padEnd(5)} ${r.verdict}${r.ratio ? `  median ${r.ratio.median} (${r.periods} periods, ${r.ratio.min}..${r.ratio.max})` : ""}`);
}
console.log(
  "\nratio ~ 1 => EPS is per ORDINARY share, price is per ADS, the P/E is wrong by the ADS ratio." +
  "\nratio ~ N => EPS is per ADS, same unit as the price, the P/E is correct and must NOT be suppressed."
);

emitPayload("ads-eps-unit", JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
