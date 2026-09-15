// The Nasdaq Trader symbol directory — the only non-FMP source of company
// IDENTITY this project has.
//
// ── WHY THIS MODULE EXISTS ────────────────────────────────────────────────
// Relay run 48 came back void: `name fields found: NONE`. The dump's FMP cache
// rows carry `sector` and `industry` and NO company-name field at all — which
// agrees with data/static-profile.json holding exactly those two fields and
// nothing else. The traversal was fine; there was simply nothing to read.
//
// THE SHAPE WORTH SEEING: the missing-name problem and the missing-CIK problem
// have the same root. There is no committed, non-FMP source of company
// identity. The taxonomy survived the FMP exit because it happened to be
// cached; the names did not. This directory is the replacement, and it is where
// lib/stock-news-data.ts's fetchCompanyName already reads from at render time.
//
// ── PARSED BY HEADER, NOT BY POSITION ─────────────────────────────────────
// Three places in this repo already split these files, and they do not agree:
// two take cols[0]/cols[1], scripts/listing-split.mjs reads the header. The
// header is right, and the difference is not academic — the two files do not
// share a first column name:
//
//   nasdaqlisted.txt   Symbol|Security Name|Market Category|Test Issue|...
//   otherlisted.txt    ACT Symbol|Security Name|Exchange|CQS Symbol|...|NASDAQ Symbol
//
// Position happens to work for these two. It does NOT work for
// nasdaqtraded.txt, whose first column is "Nasdaq Traded" and whose symbol sits
// at index 1 — so a future edit pointing any positional parser at that file
// silently reads a Y/N flag as a ticker. Reading the header costs one line and
// removes that entirely.
//
// ── otherlisted.txt CARRIES BOTH SPELLINGS, AND THAT IS USEFUL HERE ───────
// Its `ACT Symbol` is the DOTTED form (BRK.B) and its `NASDAQ Symbol` is the
// dashed one (BRK-B). Both are recorded, so a caller can resolve a name by
// either spelling without another normalisation layer — the same dot/dash split
// that cost the CIK lookup a symbol, handled at the source for once.

// ── THE INSTRUMENT CLAUSE, MIRRORED FROM THE APP RATHER THAN INVENTED ─────
// "Security Name" is the company name PLUS a description of the instrument:
// "Electronic Arts Inc. - Common Stock", "Archer Aviation Inc. Class A Common
// Stock". Left in, the matcher scores "ELECTRONIC ARTS COMMON STOCK" against
// SEC's "ELECTRONIC ARTS INC." as a SUBSET rather than an EXACT, which
// downgrades a certainty to a candidate for no reason.
//
// THE VOCABULARY IS lib/server/companyNames.ts's INSTRUMENT_SUFFIX_RE and
// RATIO_CLAUSE_RE, copied deliberately and not re-derived. A .mjs relay script
// cannot import a .ts module without the transpile machinery the check-*.mjs
// harnesses use -- the same bounded duplication already recorded for the
// User-Agent in lib/server/news/userAgent.ts. If that regex changes, this is
// the second place to change.
//
// AND IT IS A PHRASE RULE, NOT A TOKEN RULE. That distinction is the whole
// reason this lives here rather than in the matcher's stopword list: the
// clause "american depositary shares" is noise, but the token AMERICAN is not
// -- dropping it would collapse American Airlines, American Express and
// American Tower toward each other. Only the phrase is safe to remove.
const INSTRUMENT_SUFFIX_RE =
  /(?:[\s,–-]+|(?<=\)))(class\s+[a-z]\s+)?(common stock|ordinary shares?|common shares?|american depositary shares?|american depositary receipts?|depositary shares?|depositary receipts?)(\s+(reit|trust|fund))?\s*$/i;
const RATIO_CLAUSE_RE = /[\s,;–-]+each\s+represent\w*\b.*$/i;

/** Company name out of a directory "Security Name". */
export function stripInstrumentClause(raw) {
  let name = String(raw || "").trim();
  name = name.replace(RATIO_CLAUSE_RE, "");
  name = name.replace(INSTRUMENT_SUFFIX_RE, "");
  // Trailing parentheticals on this feed are instrument descriptions, never
  // part of the name. Loop so a name ending in two loses both.
  for (let i = 0; i < 3; i += 1) {
    const next = name.replace(/\s*\([^()]*\)\s*$/, "").trim();
    if (next === name) break;
    name = next;
  }
  // The suffix may now be exposed, having sat before the parenthetical.
  name = name.replace(INSTRUMENT_SUFFIX_RE, "");
  return name.replace(/\s{2,}/g, " ").replace(/[\s,;:–-]+$/, "").trim();
}

export const NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt";
export const OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt";

/**
 * One pipe-delimited directory file to `[{ symbol, name, altSymbol }]`.
 *
 * TEST ISSUES ARE DROPPED. The directory carries deliberately fake rows
 * (ZZZZZ, ZXYZ.A) flagged `Test Issue = Y`. They are real lines with real
 * names, so nothing downstream would reject them, and one shadowing a live
 * symbol would attach a nonsense company name to a real page.
 *
 * Returns [] for input that is not a pipe file — including a 200 carrying HTML,
 * which is how these hosts report an outage. The caller is expected to treat
 * empty as failure rather than as "no rows today"; parse() cannot tell the
 * difference and does not pretend to.
 *
 * THERE IS NO SEPARATE `looks like HTML` CHECK, and its absence is deliberate.
 * One was here, copied from scripts/company-name-sample.mjs, and a mutation
 * deleting it SURVIVED: the header check below is strictly stronger. An HTML
 * page's first line does not split on `|` into fields named `Symbol` and
 * `Security Name`, so it is already rejected, and a second test that can only
 * fire on a subset of what the first rejects is a line no test can defend.
 */
export function parseDirectory(text) {
  if (typeof text !== "string" || !text.trim()) return [];

  const lines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim());
  if (!lines.length) return [];

  const header = lines[0].split("|").map((h) => h.trim());
  let iSymbol = header.findIndex((h) => h === "Symbol" || h === "ACT Symbol");
  let iName = header.indexOf("Security Name");
  const iTest = header.indexOf("Test Issue");
  const iAlt = header.indexOf("NASDAQ Symbol");
  // NO POSITIONAL FALLBACK. A file whose header we do not recognise is a file
  // whose columns we do not know, and guessing 0/1 is how a "Nasdaq Traded"
  // flag becomes a ticker. Empty is the honest answer.
  if (iSymbol < 0 || iName < 0) return [];

  const out = [];
  for (const line of lines.slice(1)) {
    const f = line.split("|");
    // The trailing "File Creation Time: ..." line has no delimiters.
    if (f.length < header.length) continue;
    if (iTest >= 0 && f[iTest]?.trim() === "Y") continue;

    const symbol = (f[iSymbol] ?? "").trim().toUpperCase();
    const rawName = (f[iName] ?? "").trim();
    // BOTH ARE KEPT. `name` is what a matcher should use; `rawName` is what the
    // render path actually receives today, so a caller emitting a committed
    // snapshot can store the unmodified directory value and let the app's own
    // normaliser run over it, rather than baking this script's cleaning into
    // data the app then cleans a second time.
    const name = stripInstrumentClause(rawName);
    if (!symbol || !name) continue;

    const altSymbol = iAlt >= 0 ? (f[iAlt] ?? "").trim().toUpperCase() : "";
    out.push({ symbol, name, rawName, altSymbol: altSymbol && altSymbol !== symbol ? altSymbol : "" });
  }
  return out;
}

/**
 * Both files into one symbol -> name map, under every spelling on offer.
 *
 * FIRST WRITER WINS, and nasdaqlisted is passed first by convention, so a
 * symbol listed on Nasdaq keeps its Nasdaq name. The alternate spelling never
 * overwrites a primary one — an `altSymbol` is a second key for the same
 * company, not a competing claim about a different one.
 */
export function nameMap(...rowLists) {
  const map = new Map();
  for (const rows of rowLists) {
    for (const { symbol, name } of rows) if (!map.has(symbol)) map.set(symbol, name);
  }
  for (const rows of rowLists) {
    for (const { altSymbol, name } of rows) if (altSymbol && !map.has(altSymbol)) map.set(altSymbol, name);
  }
  return map;
}
