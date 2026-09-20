// WHAT TWELVE STORED QUARTERS COST, MEASURED — A2's report, before any change.
//
// THE DEFECT IT SIZES. The growth table shows four permanent "not on file"
// rows on EVERY symbol: eight quarters are stored, so the oldest four have no
// prior-year quarter inside the window. Nothing is missing from SEC — the
// window is too small to contain its own comparison.
//
// Storing twelve and rendering the newest eight gives every rendered row a
// reachable prior year. This measures what that costs, against real payloads,
// before anything is built.
//
// FOUR VARIANTS, because the current code COUPLES them and that is a finding:
// `instants` is sliced by keepQuarters too (secExtract.ts:643), so raising the
// quarter window silently triples nothing and doubles the balance-sheet series
// as well. Measured separately so the quarter cost can be paid without the
// instant cost if that is the call.
//
// Read-only: no credential, no Redis, no dump. Runs on a runner because the
// agent sandbox is refused data.sec.gov with 403 CONNECT.
//
//   node scripts/sec-window-size-probe.mjs "AAPL,KGC,AZN"
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

// AAPL dense 10-Q, KGC annual-only (the window must be a no-op for it), AZN
// half-yearly with a hole (the window cannot manufacture a prior year).
const SYMBOLS = (process.argv[2] || process.env.SYMBOLS || "AAPL,KGC,AZN")
  .split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; window size probe)";

const strip = (f) =>
  fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");
const sec = await lift([
  fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/secFactCodec.ts"),
  strip("lib/server/secEarningsView.ts"),
].join("\n"));
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);
const { extractCompanyFacts, encodeFactSet, buildSecEarningsView, secFieldsHash,
        secChainsHash, priorYearOf } = sec;

// PRE-NETWORK SMOKE. Calls the thing, and specifically calls it WITH an opts
// argument — the parameter this whole probe turns on.
try {
  const one = { end: "2026-03-31", val: 1, accn: "a", filed: "2026-04-01", start: "2026-01-01" };
  const e = extractCompanyFacts("SMOKE", { cik: 1, facts: { "us-gaap": { Revenues: { units: { USD: [one] } } } } }, { quarters: 12 });
  if (e.quarters.length !== 1) throw new Error("opts-aware extract produced no quarter");
  if (typeof secFieldsHash() !== "string") throw new Error("no secFieldsHash");
} catch (err) {
  console.error(`FATAL: pre-network smoke failed — ${String(err?.message ?? err)}`);
  process.exit(2);
}

// THE HASHES, PRINTED ONCE AND THE SAME FOR EVERY VARIANT. This is the claim
// A2 asks about: does the window move the gate a reader uses? It cannot —
// secFieldsHash hashes the KEY LIST and secChainsHash the tag chains, and a
// retention window is neither. Printed rather than argued.
console.log(`secFieldsHash: ${secFieldsHash()}   secChainsHash: ${secChainsHash()}`);
console.log("(both are inputs to the stored record's gate; neither depends on the window)\n");

const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bytes = (o) => Buffer.byteLength(JSON.stringify(o), "utf8");
const pad = (n) => String(n).padStart(7);

const VARIANTS = [
  ["q8  i8   (today)", { quarters: 8 }],
  ["q12 i12  (coupled — what a bare bump gives)", { quarters: 12 }],
  ["q12 i8   (decoupled — quarters only)", { quarters: 12, instants: 8 }],
  ["q16 i8   (headroom, not proposed)", { quarters: 16, instants: 8 }],
];

for (const symbol of SYMBOLS) {
  const cik = tickerMap.get(symbol)?.cik;
  if (!cik) { console.log(`${symbol}: no CIK`); continue; }
  let facts;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    facts = await res.json();
  } catch (err) { console.log(`${symbol}: FAILED — ${String(err?.message ?? err)}`); continue; }

  console.log(`${"=".repeat(74)}\n${symbol}`);
  let baseline = null;
  for (const [label, opts] of VARIANTS) {
    // `instants` is not an option today; the probe emulates the decoupling by
    // trimming after the fact, which is exactly what the proposed change does.
    const ex = extractCompanyFacts(symbol, facts, { quarters: opts.quarters });
    if (opts.instants != null) ex.instants = ex.instants.slice(0, opts.instants);
    const set = encodeFactSet(ex);
    const n = bytes(set);
    baseline ??= n;
    const view = buildSecEarningsView(set);
    // THE WHOLE POINT OF THE CHANGE, counted: of the newest 8 rows, how many
    // can reach a prior-year period? Rendered rows only — storing more is
    // pointless if the rendered window cannot use them.
    const rendered = set.quarters.slice(0, 8);
    const reach = rendered.filter((p) => priorYearOf(set.quarters, p) !== null).length;
    console.log(
      `  ${label.padEnd(44)} ${pad(n)} B  ${n === baseline ? "     " : `${n > baseline ? "+" : ""}${(((n / baseline) - 1) * 100).toFixed(1)}%`}` +
      `  q=${String(set.quarters.length).padStart(2)} y=${set.years.length} i=${String(set.instants.length).padStart(2)}` +
      `  prior-year reachable: ${reach}/${Math.min(8, rendered.length)}` +
      `${view ? "" : "  (no view — annual-only)"}`
    );
  }
  await sleep(150);
}

console.log(`\nNOTE: sizes are the JSON the store writes. Upstash bills by command, not
by byte, so the cost that matters is bandwidth per render — one GET per page.`);
