// Unresolved symbols -> candidate CIKs, matched on SEC's own `title`.
//
//   relay task "sec-titles"   (read-only job; no credentials referenced)
//
// ── WHAT QUESTION THIS ANSWERS, AND WHY IT IS NOT sec-symbol-status ────────
// sec-symbol-status asks "is this company alive", per symbol. That was never
// the question: relay run 47's misses are live mega-caps. The question is
// "what is this company called AT SEC", and answering it needs the WHOLE file
// in hand, matched exactly — which is what a runner has and an agent sandbox
// does not (www.sec.gov is refused here, 403 CONNECT).
//
// ONE PASS, NOT TEN DISPATCHES. Every unresolved symbol is matched against
// every row of company_tickers.json in the same run.
//
// ── THE RELIABILITY POINT THAT MOTIVATED THIS ─────────────────────────────
// Three of the ten were resolved by reading SEC's 220 KB file through a
// summarising model. The three HITS are good positive evidence. The seven NOT
// FOUNDs are NOT reliable negatives: truncation and genuine absence produce an
// identical answer, so nothing there says EA, AVB, EQR, K, WBS, NBN or TOWN are
// missing from SEC's file. This script exists so the negatives mean something —
// it holds the complete file and matches every row.
//
// ── IT PRINTS. IT DOES NOT APPLY. ─────────────────────────────────────────
// No fuzzy match is auto-applied and this script cannot write data/cik-map.json.
// Output is a CANDIDATE LIST, shaped as an array of records rather than a
// symbol -> CIK object, so it is not accidentally committable as a map. A human
// reads it, confirms, and commits only what is confirmed.
//
// Every proposed CIK is independently checkable, and this checks the top one
// for you: data.sec.gov/submissions/CIK##########.json is fetched for each
// leading candidate and its own `name`, `tickers` and `exchanges` are printed.
// That turns "a name matched" into "a name matched AND the filer's own record
// says so", which is the difference between a guess and a corroborated claim.
//
// See scripts/lib/sec-title-match.mjs for why name matching is legitimate here
// and correctly refused in lib/server/news/wireProvider.ts.
import fs from "node:fs";
import path from "node:path";
import { emitPayload } from "./lib/relay-capture.mjs";
import { rankCandidates } from "./lib/sec-title-match.mjs";
import { symbolSpellings, lookupSpellingIn } from "./lib/symbol-spellings.mjs";
import {
  NASDAQ_LISTED_URL,
  OTHER_LISTED_URL,
  parseDirectory,
  nameMap,
} from "./lib/nasdaq-directory.mjs";

const DUMP_DIR = process.argv[2] || "";
const ROOT = process.cwd();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (contact@mystockharbor.com)";
const HEADERS = { "user-agent": UA, accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
};

// ─────────────────────────────────────────── who is unresolved, and what we call them
const cikMap = readJson(path.join(ROOT, "data/cik-map.json"), {});
const profile = readJson(path.join(ROOT, "data/static-profile.json"), { rows: {} });

// THE DUMP IS OPTIONAL NOW. It contributed nothing this task needs -- run 48
// established its rows carry no company name -- so it is no longer required.
// Read when present because it adds the pickers half of the universe, which is
// one symbol the committed snapshot lacks (the dotted BRK.B).
let pickers = [];
if (DUMP_DIR && fs.existsSync(path.join(DUMP_DIR, "universe.json"))) {
  pickers = (readJson(path.join(DUMP_DIR, "universe.json"), {})?.pickersSymbolsKey ?? [])
    .map((s) => String(s).toUpperCase());
}
const universe = [...new Set([...pickers, ...Object.keys(profile.rows ?? {})])].sort();

// The dot/dash fallback is applied HERE TOO, or BRK.B would be reported as
// unresolved and a human would be asked to adjudicate a bug that is already
// fixed at the lookup (lib/server/news/secProvider.ts cikFor).
const resolved = (s) => Boolean(lookupSpellingIn(cikMap, s));
const unresolved = universe.filter((s) => !resolved(s));

// ── COMPANY NAMES: THE NASDAQ TRADER DIRECTORY, NOT THE DUMP ──────────────
// RUN 48 CAME BACK VOID — "name fields found: NONE" — and the guard is the only
// reason we know. Without it, ten unmatchable symbols would have read as ten
// real negatives and seven live mega-caps would have been recorded as absent
// from SEC's file.
//
// The cause is established rather than guessed, and it is NOT a sixth field
// spelling. scripts/static-profile-build.mjs runs the IDENTICAL traversal over
// the SAME three dump files — `?.values`, `Object.entries`, `value.symbol ||
// symbolFromKey(key)`, same typeof guard — and succeeds, yielding 2,609 / 760 /
// 651 rows. The dump shape is right and the traversal was right. Those FMP
// cache rows simply carry sector and industry and NO company-name field at all,
// which is exactly why data/static-profile.json holds only those two fields.
//
// So the source moves to where the name actually lives: the Nasdaq Trader
// symbol directory, which is where lib/stock-news-data.ts's fetchCompanyName
// already reads at render time. The sandbox is refused www.nasdaqtrader.com by
// policy; a runner is not.
//
// THIS ALSO CLOSES A SECOND, SEPARATE GAP. There is no committed, non-FMP
// source of company identity — the taxonomy survived the FMP exit only because
// it happened to be cached, and the names did not. The same fetch that supplies
// names for matching also emits a committable snapshot below, so the two are
// one piece of work rather than two.
const [nasdaqRes, otherRes] = await Promise.all([
  fetch(NASDAQ_LISTED_URL, { headers: { "user-agent": UA } }),
  fetch(OTHER_LISTED_URL, { headers: { "user-agent": UA } }),
]);
console.log(`[titles] nasdaqlisted.txt: HTTP ${nasdaqRes.status}, otherlisted.txt: HTTP ${otherRes.status}`);
// RAW TEXT KEPT, deliberately, for the substring search below. It is the only
// thing that separates "absent from the file" from "dropped by our own parser".
const nasdaqText = nasdaqRes.ok ? await nasdaqRes.text() : "";
const otherText = otherRes.ok ? await otherRes.text() : "";
const nasdaqRows = parseDirectory(nasdaqText);
const otherRows = parseDirectory(otherText);
console.log(`[titles] directory rows: nasdaqlisted ${nasdaqRows.length}, otherlisted ${otherRows.length}`);

// MEASURING-NOTHING GUARD, AND IT IS THE ONE THAT JUST EARNED ITS PLACE. A
// directory that returned HTML, or whose header changed, parses to [] — and
// every symbol would then be "not matchable" again, which is a void run
// dressed as a result. Fail loudly instead.
if (nasdaqRows.length + otherRows.length < 5000) {
  console.error(
    `FATAL: the symbol directory is not usable — ${nasdaqRows.length + otherRows.length} rows parsed ` +
      "(expected >13,000). Every symbol would be reported unmatchable, which is indistinguishable " +
      "from a real negative."
  );
  process.exit(1);
}

const names = nameMap(nasdaqRows, otherRows);
console.log(`[titles] names available for ${names.size} symbols`);

console.log(`[titles] universe ${universe.length}, unresolved ${unresolved.length}`);
// THE PROVENANCE LINE, kept but repointed. Run 48's "name fields found: NONE"
// is the only reason that void run was legible instead of being read as ten
// real negatives, so the replacement source states its coverage the same way:
// where the names came from and how many of them there are.
console.log(
  `[titles] name source: Nasdaq Trader symdir — ` +
    `${names.size} symbols, covering ${unresolved.filter((s) => names.has(s)).length}/${unresolved.length} unresolved`
);
console.log(`[titles] unresolved: ${unresolved.join(", ")}`);

const withNames = unresolved.filter((s) => names.has(s));
const withoutNames = unresolved.filter((s) => !names.has(s));
if (withoutNames.length) {
  // NOT SILENT. A symbol with no name cannot be matched, and reporting it as
  // "no candidates" would be indistinguishable from "SEC does not have it" --
  // the exact ambiguity this script was built to remove.
  console.log(`[titles] NO NAME AVAILABLE, so not matchable (≠ absent at SEC): ${withoutNames.join(", ")}`);
}

// ───────────────────────────────────────────────────────────── SEC's whole file
const res = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: HEADERS });
console.log(`[titles] company_tickers.json: HTTP ${res.status}`);
if (!res.ok) {
  console.error("FATAL: company_tickers.json did not return 200 — nothing below is meaningful.");
  process.exit(1);
}
const secText = await res.text();
const rows = Object.values(JSON.parse(secText)).map((r) => ({
  ticker: String(r?.ticker ?? "").toUpperCase(),
  cik: String(r?.cik_str ?? "").padStart(10, "0"),
  title: String(r?.title ?? ""),
}));
console.log(`[titles] SEC rows: ${rows.length}`);

// MEASURING-NOTHING GUARD. A file that parsed to nothing, or to rows without
// titles, would produce "no candidates for anybody" -- which reads exactly like
// a real negative result and is the fail-green shape this repo keeps getting
// bitten by. The known-good control is cheap: Fiserv must be findable.
const control = rows.filter((r) => /FISERV/i.test(r.title));
if (!rows.length || !control.length) {
  console.error(`FATAL: the SEC file is not usable — rows=${rows.length}, FISERV rows=${control.length}.`);
  process.exit(1);
}
console.log(`[titles] control: FISERV present as ${control.map((c) => `${c.ticker}/${c.cik}`).join(", ")}`);

// ── THE RAW SUBSTRING SEARCH: is it absent, or did WE drop it? ────────────
// EIGHT SYMBOLS WERE MISSING FROM BOTH NATIONAL SOURCES — AVB, BK, EA, EQR, FI,
// K, MMC, WBS — after run 49. Two independent national listings both missing
// eight large, currently-traded US companies is not plausible as a fact about
// the world; it points at a common cause on our side.
//
// THIS IS THE ONLY FORK THAT MATTERS AND NOTHING HAD TESTED IT. Every previous
// run measured what survived OUR parsing. This searches the bytes as
// downloaded, before any parse, filter or normalisation:
//
//   present in the raw bytes + reported missing  -> the bug is entirely ours,
//                                                   and runs 47-49 have been
//                                                   measuring our own filters
//   absent from the raw bytes                    -> a fact about the source,
//                                                   and the question moves
//
// Three forms per source, because they fail differently: a DELIMITED hit is the
// symbol in its own field, a QUOTED hit is SEC's JSON key form, and a LOOSE
// count is every occurrence anywhere. A symbol with a loose hit but no
// delimited one is in the file under some other column or inside another word,
// which is a third answer neither of the first two would show.
console.log("\n[raw] substring search of the DOWNLOADED BYTES, before any parsing\n");
const rawVerdict = new Map();
const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const symbol of unresolved) {
  const esc = escapeRe(symbol);
  const report = [];

  for (const [label, text] of [["nasdaqlisted", nasdaqText], ["otherlisted", otherText]]) {
    if (!text) { report.push(`${label}: (not downloaded)`); continue; }
    const delimited = text.split("\n").filter((l) => new RegExp(`(^|\\|)${esc}\\|`).test(l));
    const loose = (text.match(new RegExp(esc, "g")) ?? []).length;
    report.push(`${label}: delimited=${delimited.length} loose=${loose}`);
    for (const line of delimited.slice(0, 3)) report.push(`      ${line.slice(0, 160)}`);
  }

  const quoted = (secText.match(new RegExp(`"${esc}"`, "g")) ?? []).length;
  const looseSec = (secText.match(new RegExp(esc, "g")) ?? []).length;
  report.push(`company_tickers: quoted=${quoted} loose=${looseSec}`);
  if (quoted) {
    // The surrounding object, so the CIK and title travel with the hit.
    for (const m of [...secText.matchAll(new RegExp(`.{0,120}"${esc}".{0,120}`, "g"))].slice(0, 2)) {
      report.push(`      …${m[0]}…`);
    }
  }

  // ── THE VERDICT THIS SUPPORTS, and it is a narrow one ────────────────
  // A symbol absent from BOTH national sources, while present in our own
  // snapshot, is by construction a symbol that is NOT CURRENTLY LISTED under
  // that spelling. That is a definite statement and it does not require
  // guessing why. The likely why is a RENAME: this repo already documents two
  // (MMC -> MRSH 2026-01-14, FI -> FISV 2025-11-11, in
  // lib/server/presetUniverse.ts), our snapshot is a frozen FMP capture that
  // still carries the retired spelling, and in all three checked cases the
  // SUCCESSOR is already in data/cik-map.json with a CIK.
  //
  // It is deliberately NOT asserted as a rename here. "Not listed under this
  // spelling today" is what the bytes support; which symbol replaced it is a
  // separate claim needing separate evidence.
  const inDirectory = report.some((l) => /^(nasdaqlisted|otherlisted): delimited=[1-9]/.test(l));
  const inSec = report.some((l) => /^company_tickers: quoted=[1-9]/.test(l));
  const verdict = inDirectory || inSec
    ? (inDirectory && inSec
        ? "PRESENT IN BOTH RAW SOURCES — if we reported it missing, the bug is ours"
        : `PRESENT IN ${inDirectory ? "THE DIRECTORY" : "SEC"} ONLY — our parsing or the other source`)
    : "ABSENT FROM BOTH RAW SOURCES — not currently listed under this spelling " +
      "(a rename is the likely why; the successor is a separate question)";

  rawVerdict.set(symbol, { inDirectory, inSec, verdict });
  console.log(`  ${symbol} — ${verdict}`);
  for (const line of report) console.log(`    ${line}`);
}

// ──────────────────────────────────────────────────────────────── the matching
const report = [];
for (const symbol of withNames) {
  const ourName = names.get(symbol);
  const { candidates, ambiguous, topTier } = rankCandidates(ourName, rows);
  report.push({ symbol, ourName, topTier, ambiguous, candidates });

  console.log(`\n[titles] ${symbol} — our name: ${JSON.stringify(ourName)}`);
  if (!candidates.length) {
    // NOT "a REAL negative". The SEARCH was exhaustive; the MATCHER is not
    // exhaustive, and conflating the two overstates what this line knows.
    // Run 49 proved it: TOWN's "Towne Bank" against a TOWNEBANK-shaped title
    // shares ZERO tokens and scores 0 — a spacing difference reported as an
    // absence. The honest claim is about our matcher, not about SEC.
    console.log(
      "    no candidate above the floor — the whole file was searched, but that is a " +
        "statement about this matcher, NOT evidence the filer is absent from SEC"
    );
    continue;
  }
  if (ambiguous) console.log("    AMBIGUOUS: more than one filer at the top tier — do not confirm from this alone");
  for (const c of candidates) {
    console.log(`    ${c.tier.padEnd(7)} score=${c.score.toFixed(2)} ${c.ticker.padEnd(8)} CIK ${c.cik}  ${c.title}`);
  }
}

// ───────────────────────────────────────── corroborate the leader, per symbol
// The filer's own record, so a name match is not the only evidence. Sequential
// with a pause: SEC's fair-access cap is 10 req/sec and this is at most a
// handful of requests.
console.log("\n[titles] corroboration — data.sec.gov/submissions for each leading candidate\n");
for (const entry of report) {
  const top = entry.candidates[0];
  if (!top) continue;
  try {
    const r = await fetch(`https://data.sec.gov/submissions/CIK${top.cik}.json`, { headers: HEADERS });
    if (!r.ok) { console.log(`    ${entry.symbol}: HTTP ${r.status} for CIK ${top.cik}`); continue; }
    const body = await r.json();
    const tickers = body?.tickers ?? [];
    const carriesOurSymbol = tickers.map((t) => String(t).toUpperCase()).includes(entry.symbol);

    // ── carriesOurSymbol: false MEANS OPPOSITE THINGS IN THE TWO CASES ────
    // I previously wrote that false was expected and "the finding, not a
    // failure". That is true for a RENAME and false for everything else, and
    // printing one gloss for both would make a refutation read as agreement.
    //
    //   our symbol ABSENT from both raw sources (retired spelling):
    //       false = CONFIRMATION. SEC carries the successor under its new
    //       ticker; that is exactly what a rename looks like.
    //
    //   our symbol PRESENT in the directory (live listing):
    //       false = REFUTATION. Our ticker is live and this filer does not
    //       claim it, so this candidate is the wrong company.
    //
    // NBN and TOWN are the second kind. The raw verdict is what decides which
    // sentence is printed, so the two cannot be confused.
    const raw = rawVerdict.get(entry.symbol);
    const reading = carriesOurSymbol
      ? "CONFIRMED — the filer claims our exact symbol"
      : raw?.inDirectory
        ? "REFUTED — our symbol is LIVE in the directory and this filer does not claim it, " +
          "so this candidate is a different company"
        : "CONSISTENT WITH A RENAME — our symbol is absent from both raw sources, and SEC " +
          "carries this filer under a different ticker";

    entry.corroboration = {
      name: body?.name ?? null,
      tickers,
      exchanges: body?.exchanges ?? [],
      carriesOurSymbol,
      rawVerdict: raw?.verdict ?? null,
      reading,
    };
    console.log(
      `    ${entry.symbol}: CIK ${top.cik} is "${body?.name}" — tickers ${JSON.stringify(tickers)} ` +
        `exchanges ${JSON.stringify(body?.exchanges ?? [])}`
    );
    console.log(`        carriesOurSymbol=${carriesOurSymbol} -> ${reading}`);
  } catch (err) {
    console.log(`    ${entry.symbol}: submissions fetch failed — ${String(err)}`);
  }
  await sleep(150);
}

// AN ARRAY, NOT AN OBJECT KEYED BY SYMBOL, on purpose: a symbol -> CIK object
// is committable as data/cik-map.json by a single copy-paste, and nothing in
// this pipeline should make that an easy mistake. Confirming a candidate is a
// deliberate edit, not a file move.
emitPayload("cik-candidates", JSON.stringify({
  generatedAt: new Date().toISOString(),
  note: "CANDIDATES, NOT A MAP. Review, confirm against the corroboration, then add confirmed entries to data/cik-map.json by hand.",
  unresolved,
  notMatchable: withoutNames,
  report,
}, null, 2));

// ── THE SECOND OUTPUT: a committable company-name snapshot ────────────────
// A DIFFERENT KIND OF ARTIFACT FROM THE CANDIDATE LIST ABOVE, and the
// difference is why one may be committed wholesale and the other may not.
// A candidate is a FUZZY NAME MATCH and needs a human. This is a DIRECT
// TRANSCRIPTION keyed on the exact symbol, from the same directory the render
// path already reads — no guessing, nothing to adjudicate.
//
// RAW NAMES, NOT CLEANED ONES. The app has its own normaliser
// (lib/server/companyNames.ts cleanName, via normaliseCompanyName) and it runs
// over whatever fetchCompanyName returns. Storing this script's cleaned output
// would bake one normaliser's judgement into the data and then run the app's
// over it a second time -- two cleanings, one of them invisible. The snapshot
// holds what the directory said.
//
// Scoped to the universe rather than all ~13,000 rows: the same denominator
// argument as data/cik-map.json, whose header prices it.
//
// THE DASHED SPELLINGS NEED THE DOTTED LOOKUP, and the first snapshot missed 17
// of them. otherlisted.txt's `NASDAQ Symbol` column — the dashed alternative —
// is EMPTY for NYSE-listed dual-class and preferred names, because they have no
// Nasdaq symbol. So the directory offers those under the DOTTED ACT Symbol only
// (BRK.B), while this repo stores them DASHED (BRK-B), and the lookup found
// nothing: BF-B, BRK-A, CIG-C, CMS-PB, CTA-PA, CTA-PB, EP-PC, FITB-PA, FITB-PM,
// MER-PK, MKC-V, MOG-A, OAK-PA, OAK-PB, PBR-A, SEAL-PB, TRTN-PC.
//
// Stored under the UNIVERSE's spelling, which is what a caller will ask with.
const snapshot = {};
const findRow = (sym) =>
  nasdaqRows.find((r) => r.symbol === sym || r.altSymbol === sym) ??
  otherRows.find((r) => r.symbol === sym || r.altSymbol === sym);
for (const symbol of universe) {
  const row = symbolSpellings(symbol).map(findRow).find(Boolean);
  if (row) snapshot[symbol] = row.rawName;
}
console.log(`[titles] company-name snapshot: ${Object.keys(snapshot).length}/${universe.length} universe symbols`);
emitPayload("company-names", JSON.stringify({
  asOf: new Date().toISOString().slice(0, 10),
  source: "Nasdaq Trader symdir (nasdaqlisted.txt + otherlisted.txt), Security Name verbatim",
  note: "RAW directory names. lib/server/companyNames.ts cleanName is the normaliser; do not pre-clean here.",
  rows: snapshot,
}, null, 0));

console.log(`\n[titles] done — ${report.filter((r) => r.topTier === "exact").length} exact, ` +
  `${report.filter((r) => r.topTier === "subset").length} subset, ` +
  `${report.filter((r) => r.topTier === "partial").length} partial, ` +
  `${report.filter((r) => r.topTier === "none").length} with nothing above the floor.`);
