// CAPTURE A REAL STORED FACT SET, verifiably, for a check to render.
//
// WHY THIS EXISTS. The checks that matter here are about RENDERED OUTPUT — does
// the growth table reach a prior year on all eight rows, does a hidden source
// render nothing, does an internal term reach a reader. None of that can be
// asserted from a hand-built fixture, because a fixture author choosing the
// periods is choosing the answer. So the fixture is a REAL set: fetched from
// companyfacts, run through the SHIPPED extractor and encoder, and committed.
//
// SEC DATA, NOT FMP. The frozen FMP dump stays out of the repo; this is the
// same class of artefact as data/sec/window-fixture-20260908-11.json.
//
// GETTING IT HERE. Actions artifacts download via a blob host the agent sandbox
// cannot reach, so the set is printed gzip+base64 with a SHA-256 of the
// PLAINTEXT. Decoding locally and re-hashing proves the committed file is
// byte-identical to what the runner produced — the transport is checkable
// rather than trusted.
//
// Read-only: no credential, no Redis, no dump.
//
//   node scripts/sec-fixture-capture.mjs "AAPL,KGC"
import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const SYMBOLS = (process.argv[2] || process.env.SYMBOLS || "AAPL,KGC")
  .split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; fixture capture)";

const strip = (f) =>
  fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");
const sec = await lift([
  fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip("lib/server/secExtract.ts"),
  // secExtract reads reportingCurrency / unitKeysFor from secCurrency, which
  // reads fxRates; absent, the lift refuses the unit as not closed.
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"),
].join("\n"));
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);
const { extractCompanyFacts, encodeFactSet, SEC_QUARTER_WINDOW } = sec;

try {
  if (SEC_QUARTER_WINDOW !== 12) throw new Error(`window is ${SEC_QUARTER_WINDOW}, expected 12`);
} catch (err) {
  console.error(`FATAL: pre-network smoke failed — ${String(err?.message ?? err)}`);
  process.exit(2);
}

const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

for (const symbol of SYMBOLS) {
  const cik = tickerMap.get(symbol)?.cik;
  if (!cik) { console.log(`${symbol}: no CIK`); continue; }
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
  });
  if (!res.ok) { console.log(`${symbol}: HTTP ${res.status}`); continue; }
  const set = encodeFactSet(extractCompanyFacts(symbol, await res.json()));
  // `at` is a timestamp and would make the fixture differ on every capture for
  // no reason a check cares about. Pinned so a re-capture is a real diff.
  set.at = 0;
  const plain = JSON.stringify(set);
  const sha = crypto.createHash("sha256").update(plain).digest("hex");
  const packed = zlib.gzipSync(Buffer.from(plain, "utf8"), { level: 9 }).toString("base64");
  console.log(`\n===== ${symbol}  q=${set.quarters.length} y=${set.years.length} i=${set.instants.length} w=${set.w}`);
  console.log(`----- sha256(plaintext) ${sha}`);
  console.log(`----- bytes ${plain.length} -> gz+b64 ${packed.length}`);
  console.log(`----- BEGIN ${symbol}`);
  for (let i = 0; i < packed.length; i += 180) console.log(packed.slice(i, i + 180));
  console.log(`----- END ${symbol}`);
  await new Promise((r) => setTimeout(r, 150));
}
