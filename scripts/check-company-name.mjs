// The company-name normaliser, against the REAL universe.
//
// WHAT THIS IS FOR. Step 3 of claude/news-adapter-spec-2026-09-13.md queries
// Google News with `"${cleanName}" stock`, and Google News has no notion of a
// ticker — so the query term is the entire relevance mechanism. The spec measured
// 97-98% precision for "Micron Technology" and 86% for "MU". A normaliser that
// quietly leaves "Common Stock" on the end, or reduces a name to a common English
// word, spends that difference without failing anything.
//
// THE FIXTURE IS REAL, and it had to be. scripts/fixtures/company-names.txt holds
// 155 verbatim Nasdaq Trader Security Names pulled through the relay. The single
// most important thing it proved is that the spec's own algorithm is incomplete:
// only about half of these use the " - " separator the spec says to cut at. An
// invented fixture would have contained the spec's shape and nothing else, and
// this check would have passed while the live query stayed wrong
// (claude/traps/two-validators-for-one-value.md).
//
// THE REAL MODULE IS RUN, not a paraphrase: companyName.ts has one import and it
// is inlined from source below.
//
//   node scripts/check-company-name.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- load module
// cleanName lives in lib/server/companyNames.ts, which imports nothing, so it is
// inlined rather than stubbed — the instrument-suffix rule is most of what is
// being tested here and a stub would test the stub.
const companyNamesSrc = read("lib/server/companyNames.ts").replace(/^export /gm, "");
let src = read("lib/server/news/companyName.ts").replace(
  /^import \{ cleanName \} from "@\/lib\/server\/companyNames";$/m,
  () => companyNamesSrc
);

if (/^import /m.test(src)) {
  console.error("FAIL: an import survived inlining — the module would not load.");
  console.error(src.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}

const js = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const norm = (s) => m.normaliseCompanyName(s);

// ---------------------------------------------------------------- the fixture
const fixture = { COVERED: new Map(), SYSTEMATIC: new Map() };
{
  let section = null;
  for (const line of read("scripts/fixtures/company-names.txt").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (t === "COVERED" || t === "SYSTEMATIC") { section = t; continue; }
    const i = t.indexOf("|");
    if (i < 0 || !section) continue;
    fixture[section].set(t.slice(0, i), t.slice(i + 1));
  }
}
const ALL = new Map([...fixture.COVERED, ...fixture.SYSTEMATIC]);
check(
  "the fixture is the real sample, not a handful of examples",
  fixture.COVERED.size >= 50 && ALL.size >= 150,
  `${fixture.COVERED.size} covered + ${fixture.SYSTEMATIC.size} systematic = ${ALL.size}`
);

console.log("\n=== 1. Every symbol this site publishes on ===\n");
// EVERY ONE ASSERTED, not spot-checked. These are the names the live query will
// actually be built from, so a regression on any single one is a regression on a
// page that exists.
const EXPECTED_COVERED = {
  AAL: "American Airlines", AAPL: "Apple", ACHR: "Archer Aviation",
  AMZN: "Amazon.com", ASTS: "AST SpaceMobile", AVAV: "AeroVironment",
  AVGO: "Broadcom", BA: "Boeing", BABA: "Alibaba", BBAI: "BigBear.ai",
  CELH: "Celsius", CHWY: "Chewy", CLSK: "CleanSpark", COIN: "Coinbase Global",
  COST: "Costco Wholesale", CVNA: "Carvana", CVX: "Chevron", DIS: "Walt Disney",
  DKNG: "DraftKings", GEV: "GE Vernova", GME: "GameStop", HUM: "Humana",
  INTC: "Intel", IONQ: "IonQ", ISRG: "Intuitive Surgical", MARA: "MARA",
  META: "Meta Platforms", MRVL: "Marvell Technology", MSFT: "Microsoft",
  MSTR: "Strategy", MU: "Micron Technology", NIO: "NIO", NKE: "Nike",
  NOC: "Northrop Grumman", NOW: "ServiceNow", NVDA: "NVIDIA", ONDS: "Ondas",
  ORCL: "Oracle", PFE: "Pfizer", PLTR: "Palantir Technologies",
  QBTS: "D-Wave Quantum", QS: "QuantumScape", RCL: "Royal Caribbean Cruises",
  RGTI: "Rigetti Computing", RIOT: "Riot Platforms", SOFI: "SoFi Technologies",
  SOUN: "SoundHound AI", TMUS: "T-Mobile US", TSLA: "Tesla",
  TXN: "Texas Instruments", UHS: "Universal Health Services", VRT: "Vertiv",
  VZ: "Verizon Communications", WFC: "Wells Fargo", ZS: "Zscaler",
};
let wrong = [];
for (const [symbol, raw] of fixture.COVERED) {
  const expected = EXPECTED_COVERED[symbol];
  if (expected === undefined) { wrong.push(`${symbol}: no expectation written`); continue; }
  const got = norm(raw);
  if (got !== expected) wrong.push(`${symbol}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
}
check(
  `all ${fixture.COVERED.size} covered names normalise to the expected term`,
  wrong.length === 0,
  wrong.slice(0, 4).join(" · ")
);

console.log("\n=== 2. The shapes the spec's algorithm alone would miss ===\n");
// THE FINDING THIS FILE EXISTS TO PIN. The spec says "strip everything from ' - '
// onward". These names have no " - " at all, and a dash-only normaliser leaves
// the instrument clause attached — which is the whole defect.
const NO_DASH = {
  "Chevron Corporation Common Stock": "Chevron",
  "Nike, Inc. Common Stock": "Nike",
  "GameStop Corporation Common Stock": "GameStop",
  "Caterpillar, Inc. Common Stock": "Caterpillar",
  "Chewy, Inc. Class A Common Stock": "Chewy",
};
for (const [raw, expected] of Object.entries(NO_DASH)) {
  check(`no separator: ${JSON.stringify(raw.slice(0, 38))}`, norm(raw) === expected, `got ${JSON.stringify(norm(raw))}`);
}
check(
  "a parenthetical between the name and the clause",
  norm("Boeing Company (The) Common Stock") === "Boeing" &&
    norm("Walt Disney Company (The) Common Stock") === "Walt Disney"
);
check(
  "an ADR share-ratio clause is not part of the company's name",
  norm("Alibaba Group Holding Limited American Depositary Shares each representing eight Ordinary share") === "Alibaba",
  `got ${JSON.stringify(norm("Alibaba Group Holding Limited American Depositary Shares each representing eight Ordinary share"))}`
);
check(
  "a name the directory states twice is not returned twice",
  norm("Grupo Aeroportuario Del Pacifico, S.A. B. de C.V. Grupo Aeroportuario Del Pacifico, S.A. de C.V. (each representing 10 Series B shares)")
    .startsWith("Grupo Aeroportuario Del Pacifico")
);

console.log("\n=== 3. Suffix stripping does not eat the name ===\n");
// The bug longest-first ordering exists to prevent: "Corp" matching inside
// "Corporation" would turn "Costco Wholesale Corporation" into "…oration".
check("a longer suffix is not truncated by a shorter one", norm("Costco Wholesale Corporation - Common Stock") === "Costco Wholesale");
check("...nor Incorporated by Inc", norm("Texas Instruments Incorporated - Common Stock") === "Texas Instruments");
// THE SEPARATOR ANCHOR, tested where it is actually load-bearing. Drop the
// `(^|[\s,])` from the suffix patterns and "Zinc" becomes "Z" — a one-letter
// query, and nothing else in this file notices.
check("'Inc' does not match the tail of a word", norm("Zinc Inc. Common Stock") === "Zinc", `got ${JSON.stringify(norm("Zinc Inc. Common Stock"))}`);
check("...nor 'Co' the tail of Tucows", norm("Tucows Common Stock") === "Tucows", `got ${JSON.stringify(norm("Tucows Common Stock"))}`);
check("...nor 'Group' the tail of a word", norm("Outgroup Inc. Common Stock") === "Outgroup", `got ${JSON.stringify(norm("Outgroup Inc. Common Stock"))}`);
check("a spaced-dash cut does not split a hyphenated name", norm("D-Wave Quantum Inc. - Common Stock") === "D-Wave Quantum");
check("...nor T-Mobile US", norm("T-Mobile US, Inc. - Common Stock") === "T-Mobile US");
check("...nor Global-E Online", norm("Global-E Online Ltd. - ordinary shares") === "Global-E Online");
check("stacked suffixes all go", norm("MARA Holdings, Inc. - Common Stock") === "MARA");
check("an ampersand joiner survives mid-name but not at the end", norm("Wells Fargo & Company Common Stock") === "Wells Fargo");
check("lowercase directory rows normalise the same", norm("Diana Shipping inc. common stock") === "Diana Shipping");
check("doubled whitespace is collapsed, not preserved", norm("Rigetti Computing, Inc.  - Common stock") === "Rigetti Computing");

console.log("\n=== 4. Nothing usable is turned into nothing ===\n");
check("empty in, empty out", norm("") === "" && norm("   ") === "");
check("a non-string does not throw", norm(null) === "" && norm(undefined) === "");
const emptied = [...ALL].filter(([, raw]) => norm(raw) === "");
check(
  "no real directory name normalises away to nothing",
  emptied.length === 0,
  emptied.map(([s]) => s).join(", ")
);
check(
  "the normaliser is idempotent",
  [...ALL.values()].every((raw) => norm(norm(raw)) === norm(raw)),
  "running it on its own output must not keep eating words"
);

console.log("\n=== 5. The verdict, and what it is for ===\n");
check("an empty name is not ok", m.assessCompanyName("").reason === "empty");
check("a two-letter name is not ok", m.assessCompanyName("BP").reason === "too-short");
check("a single common word is not ok", m.assessCompanyName("Strategy").reason === "single-common-word");
check("a fund is not a company", m.assessCompanyName("Keeley Dividend ETF").reason === "fund-or-note");
check("a real name is ok", m.assessCompanyName("Micron Technology").ok === true);
check(
  "a single word that is a real brand is still ok",
  ["Boeing", "Oracle", "Pfizer", "Tesla", "NVIDIA"].every((n) => m.assessCompanyName(n).ok),
  "flagging every one-word name would flag most of the universe"
);

// THE REGRESSION GUARD ON THE COVERED SET. Exactly one covered symbol is expected
// to fail the verdict; if a second starts failing, a change has made the
// normaliser more destructive and the list below must be revisited deliberately.
const KNOWN_COVERED_FLAGS = new Set(["MSTR"]);
const coveredFlags = [...fixture.COVERED].filter(([, raw]) => !m.assessCompanyName(norm(raw)).ok).map(([s]) => s);
check(
  "no covered symbol newly normalises to an unsearchable term",
  coveredFlags.length === KNOWN_COVERED_FLAGS.size && coveredFlags.every((s) => KNOWN_COVERED_FLAGS.has(s)),
  `flagged: ${coveredFlags.join(", ") || "none"} · expected: ${[...KNOWN_COVERED_FLAGS].join(", ")}`
);

console.log("\n=== 6. Override candidates (a report, not a failure) ===\n");
// These are the names step 3 must not send to Google News as-is. Printed rather
// than asserted because the answer is a manual override list, which is a
// decision, not a rule the normaliser can derive.
const byReason = new Map();
for (const [symbol, raw] of ALL) {
  const out = norm(raw);
  const verdict = m.assessCompanyName(out);
  if (verdict.ok) continue;
  if (!byReason.has(verdict.reason)) byReason.set(verdict.reason, []);
  byReason.get(verdict.reason).push(`${symbol} -> ${JSON.stringify(out)}`);
}
for (const [reason, rows] of [...byReason].sort()) {
  console.log(`  ${reason} (${rows.length})`);
  const show = reason === "fund-or-note" ? rows.slice(0, 6) : rows;
  for (const row of show) console.log(`      ${row}`);
  if (show.length < rows.length) console.log(`      …and ${rows.length - show.length} more`);
  console.log("");
}
console.log(
  `  ${ALL.size - [...byReason.values()].flat().length}/${ALL.size} of the sample produce a searchable term.\n`
);

console.log(`${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
