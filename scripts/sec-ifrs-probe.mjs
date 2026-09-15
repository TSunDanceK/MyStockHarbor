// DOES THE PAGE READ IFRS FILINGS, AND WHAT IS LEFT WHEN IT DOES.
//
// ── THE CLAIM THIS EXISTS TO SETTLE ─────────────────────────────────────────
// The earnings page told readers a company "does not file the financial data
// this page is built from" whenever the extraction came back empty. For a
// foreign private issuer that is FALSE: companyfacts namespaces facts by
// taxonomy, the filer's complete statements are in the payload under
// `ifrs-full`, and the field definitions simply did not read that namespace.
// 10 of 40 sampled symbols hit it, all FPIs (AEG AZN BEPH KGC MFC MT NWG OTLY
// RYAAY VIV), and 49 of the 55 periodic filers in the measured window were 6-K
// filers -- i.e. the same population.
//
// So this probe answers three questions with evidence rather than assertion:
//
//   1. HOW MANY OF THE TEN NOW RESOLVE with IFRS_CHAIN in place. Same shipped
//      extractor, same differencing, same identities -- nothing reimplemented.
//   2. WHICH MAPPED TAGS NEVER HIT. A chain entry that matches nothing in any
//      real payload is a guess that reads as knowledge, and it should be
//      deleted rather than left looking verified.
//   3. WHICH ifrs-full TAGS THESE FILERS PUBLISH THAT NOTHING MAPS. That list
//      is the next correction, ranked by how many filers carry it, so the table
//      is extended from what filers actually tag rather than from memory of the
//      taxonomy.
//
// AND IT REPORTS THE RESIDUE EXPLICITLY. A filer that still extracts to nothing
// after this is either non-USD (the unit guard refuses a EUR figure in a USD
// field, deliberately) or genuinely untagged -- and only the second may be
// described to a reader as a fact about the company.
//
// Read-only: no credential, no Redis, no dump. Runs on a runner because the
// agent sandbox is refused data.sec.gov with 403 CONNECT.
//
//   node scripts/sec-ifrs-probe.mjs "AZN,RYAAY,HSBC,..."
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

// THE MEASURED TEN FIRST, then universe FPIs the brief named. The ten are the
// ones the 25% figure came from, so "how many of the 10-of-40 resolve" has to
// be answerable from this run without arithmetic across two runs.
const MEASURED_TEN = "AEG,AZN,BEPH,KGC,MFC,MT,NWG,OTLY,RYAAY,VIV";
const NAMED_UNIVERSE = "HSBC,GSK,NVS,BIDU,SAN,LYG,VALE,ZTO,ABEV";
// A us-gaap CONTROL, and it is not decoration. Every number below would look
// the same if the extractor had silently broken for everyone, so one known-good
// filer has to come back unchanged in the same run.
const CONTROL = "AAPL";
const SYMBOLS = (process.argv[2] || process.env.SYMBOLS ||
  `${MEASURED_TEN},${NAMED_UNIVERSE},${CONTROL}`)
  .split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

const UA =
  process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; ifrs coverage probe)";

// ── lift the shipped modules ────────────────────────────────────────────────
const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
const extractSrc = fs
  .readFileSync("lib/server/secExtract.ts", "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "");
const sec = await lift([fieldsSrc, extractSrc].join("\n"));
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);
const { SEC_FIELDS, extractCompanyFacts, checkIdentities, identityRates,
        unreadableReason, readableTaxonomies } = sec;

// PRE-NETWORK SMOKE, CALLING rather than typeof-ing: a lift that is missing a
// transitive callee still exposes the symbol and throws only when the line
// runs. This one specifically exercises the IFRS path, so a broken mapping
// fails here rather than after nineteen fetches.
try {
  const e = extractCompanyFacts("SMOKE", {
    cik: 1,
    facts: { "ifrs-full": { Assets: { units: { USD: [
      { end: "2026-06-30", val: 7, accn: "a", filed: "2026-07-01" },
    ] } } } },
  });
  if (e.instants.length !== 1) throw new Error("the ifrs-full path produced no instant");
  const v = e.instants[0].values[SEC_FIELDS.findIndex((f) => f.key === "totalAssets")];
  if (v?.val !== 7) throw new Error(`ifrs-full Assets read back as ${JSON.stringify(v)}`);
  if (unreadableReason(["dei"]).kind !== "none") throw new Error("dei-only should be 'none'");
  if (unreadableReason(["dei", "ifrs-full"]).kind !== "none")
    throw new Error("ifrs-full is readable now and must not report as unread");
  if (unreadableReason(["dei", "jpfr-t-cte"]).kind !== "unread-taxonomy")
    throw new Error("an unknown financial namespace must report as unread");
} catch (err) {
  console.error(`FATAL: pre-network smoke failed — ${String(err?.message ?? err)}`);
  process.exit(2);
}
console.log(`readable taxonomies: ${[...readableTaxonomies()].join(", ")}`);

const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function companyFacts(cik) {
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Which chain entries are IFRS, by field, so a hit can be attributed.
const IFRS_TAGS = new Set();
const MAPPED_BY_FIELD = new Map();
for (const f of SEC_FIELDS) {
  if (!f.ifrsChain?.length) continue;
  MAPPED_BY_FIELD.set(f.key, f.ifrsChain);
  for (const t of f.ifrsChain) IFRS_TAGS.add(t);
}
console.log(`mapped ifrs-full tags: ${IFRS_TAGS.size} across ${MAPPED_BY_FIELD.size} of ${SEC_FIELDS.length} fields\n`);

const tagsThatHit = new Set();
const unmappedByFiler = new Map();   // ifrs-full tag -> filers publishing it
const rows = [];

for (const symbol of SYMBOLS) {
  const cik = tickerMap.get(symbol)?.cik;
  if (!cik) { console.log(`  ${symbol.padEnd(6)} no CIK in the committed ticker file`); continue; }
  try {
    const facts = await companyFacts(cik);
    const namespaces = Object.keys(facts.facts ?? {}).sort();
    const ex = extractCompanyFacts(symbol, facts);
    const rates = identityRates(checkIdentities(ex));

    // WHICH TAGS ACTUALLY WON, read off the extraction rather than off the
    // payload: a tag present but never selected is not a tag this page uses.
    let ifrsCells = 0;
    let usGaapCells = 0;
    for (const list of [ex.quarters, ex.years, ex.instants]) {
      for (const p of list) {
        for (const c of p.values) {
          if (!c?.tag) continue;
          if (IFRS_TAGS.has(c.tag)) { ifrsCells++; tagsThatHit.add(c.tag); }
          else usGaapCells++;
        }
      }
    }

    // The ifrs-full tags this filer publishes in USD that nothing maps. USD
    // only: a EUR-only tag is not a mapping gap, it is the currency guard.
    const published = facts.facts?.["ifrs-full"] ?? {};
    const unmapped = [];
    for (const [tag, node] of Object.entries(published)) {
      if (IFRS_TAGS.has(tag)) continue;
      const units = Object.keys(node?.units ?? {});
      if (!units.some((u) => u === "USD" || u === "shares" || u.startsWith("USD/"))) continue;
      unmapped.push(tag);
      if (!unmappedByFiler.has(tag)) unmappedByFiler.set(tag, new Set());
      unmappedByFiler.get(tag).add(symbol);
    }

    const empty = ex.quarters.length === 0 && ex.years.length === 0 && ex.instants.length === 0;
    const why = empty ? unreadableReason(namespaces) : null;
    rows.push({ symbol, namespaces, q: ex.quarters.length, y: ex.years.length,
                i: ex.instants.length, ifrsCells, usGaapCells, rates, empty, why,
                unmapped: unmapped.length });
    console.log(
      `  ${symbol.padEnd(6)} ns=[${namespaces.join(",")}]  ` +
      `q${ex.quarters.length} y${ex.years.length} i${ex.instants.length}  ` +
      `cells: ifrs ${ifrsCells} / us-gaap ${usGaapCells}  ` +
      `unmapped-ifrs-tags ${unmapped.length}` +
      (empty ? `  EMPTY (${why.kind}${why.taxonomies ? `: ${why.taxonomies.join(",")}` : ""})` : "")
    );
  } catch (err) {
    console.log(`  ${symbol.padEnd(6)} FAILED — ${String(err?.message ?? err)}`);
  }
  await sleep(150);   // well inside SEC's 10/s fair-access ceiling
}

// ── the three answers ───────────────────────────────────────────────────────
const ten = new Set(MEASURED_TEN.split(","));
const tenRows = rows.filter((r) => ten.has(r.symbol));
const tenResolved = tenRows.filter((r) => !r.empty);

console.log(`\n1. THE MEASURED TEN`);
console.log(`   ${tenResolved.length} of ${tenRows.length} now extract something.`);
for (const r of tenRows) {
  console.log(
    `   ${r.symbol.padEnd(6)} ${r.empty ? "STILL EMPTY" : "resolves"}  ` +
    `q${r.q} y${r.y} i${r.i}  ifrs-cells ${r.ifrsCells}` +
    (r.empty ? `  — ${r.why.kind}${r.why.taxonomies ? ` (${r.why.taxonomies.join(",")})` : ""}` : "")
  );
}

console.log(`\n2. MAPPED TAGS THAT NEVER HIT — guesses reading as knowledge`);
const never = [...IFRS_TAGS].filter((t) => !tagsThatHit.has(t)).sort();
console.log(`   ${never.length} of ${IFRS_TAGS.size}:`);
for (const t of never) {
  const owner = [...MAPPED_BY_FIELD].find(([, c]) => c.includes(t))?.[0];
  console.log(`   ${t}  (${owner})`);
}

console.log(`\n3. UNMAPPED ifrs-full TAGS, by how many filers publish them`);
const ranked = [...unmappedByFiler].sort((a, b) => b[1].size - a[1].size).slice(0, 40);
for (const [tag, filers] of ranked) {
  console.log(`   ${String(filers.size).padStart(2)}  ${tag}`);
}

console.log(`\n4. THE RESIDUE — only these may be described as a fact about the filer`);
const residue = rows.filter((r) => r.empty);
if (!residue.length) console.log("   none: every probed filer extracted something.");
for (const r of residue) {
  console.log(`   ${r.symbol.padEnd(6)} ${r.why.kind}  ns=[${r.namespaces.join(",")}]`);
}

const control = rows.find((r) => r.symbol === CONTROL);
console.log(`\n5. THE us-gaap CONTROL`);
console.log(control
  ? `   ${CONTROL}: q${control.q} y${control.y} i${control.i}, ifrs-cells ${control.ifrsCells} ` +
    `(MUST be 0), identities ${JSON.stringify(control.rates)}`
  : `   ${CONTROL} did not return — this run cannot tell a broken extractor from a real gap.`);
