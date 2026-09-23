// A hand-written dotted ticker gets bars and no taxonomy, silently.
//
// WHY THIS CHECK EXISTS, and why it is a check rather than another trap doc.
//
// BRK.B was the only symbol in the 700-symbol analysis universe missing both
// industry and sector. The value was never missing: the screener cache holds it
// under BRK-B. Bars are filed under the dotted spelling, taxonomy under the
// dashed one, and nothing bridges them, so the lookup missed data that was
// already paid for. Measured 2026-09-12 from the frozen Step 0 dump --
// claude/symbol-spelling-split-2026-09-12.md has the table.
//
// THE VECTOR IS HAND-EDITS, NOT UNIVERSE SIZE. That distinction decides the
// mitigation, and the first reading got it wrong. Seven awkward-shaped tickers
// are in the universe today and six work fine -- BF-B, EP-PC, FITB-PM, MER-PK,
// MKC-V, PBR-A -- because everything sourced from FMP's screener arrives in
// FMP's own dashed spelling and stays consistent end to end. Screener-driven
// growth to 1,500 or 3,000 symbols is SAFE. What is not safe is a person typing
// a ticker the way a human writes it into one of the hardcoded lists, and #404's
// hand-edit rule institutionalises exactly that: the rule exists because
// eviction-on-no-bars would have wrongly removed renamed mega-caps, so lists get
// edited by hand, on purpose, indefinitely.
//
// So the frequency of this bug is tied to how often someone edits a list, which
// is a standing repo practice -- not to how big the universe gets. The screener
// cache already holds 18 dashed dual-class and preferred names (BRK-A, BF-B,
// CIG-C, CMS-PB, CTA-PA, CTA-PB, EP-PC, FITB-PA, FITB-PM, MER-PK, MKC-V, MOG-A,
// OAK-PA, OAK-PB, PBR-A, SEAL-PB, TRTN-PC, BRK-B), each one a name a future
// hand-edit could reintroduce with a dot.
//
// AND WHY A CHECK. Five trap docs were written the same day this was found. One
// of them, claude/traps/an-unchecked-cd.md, already existed and did not prevent
// an unchecked destructive chain hours later in the same session. Docs inform;
// checks enforce. This property is mechanically checkable, so it is enforced.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── THE ALLOWLIST ───────────────────────────────────────────────────────────
// Known dotted tickers, each a live instance of the bug. This list should only
// ever SHRINK. It shrinks when the fundamentals path learns to normalise, at
// which point the entry must be deleted from here too -- the stale-entry
// assertion below is what forces that, so a fix cannot quietly leave the
// allowlist behind as permission for the next one.
const ALLOWED_DOTTED = new Map([
  [
    "BRK.B",
    "Berkshire class B. Taxonomy is cached under BRK-B and never read. Remove " +
      "this entry when the fundamentals path normalises, not before.",
  ],
]);

// ── TEST FIXTURES ARE A DIFFERENT CATEGORY, AND MIXING THEM WOULD ROT THE LIST ─
// The allowlist above means "a live instance of the bug, still unfixed", and its
// value comes from only ever shrinking. A dotted string that exists solely as an
// argument to a unit test is not an instance of the bug: it never reaches the
// fundamentals path, and it must not shrink out of the list when something is
// fixed, so filing it above would make "this list only shrinks" false and quietly
// retire the invariant.
//
// WHY THE FIXTURES NEED AN EXCEPTION AT ALL. cikFor() falls back from a dotted
// spelling to the dashed one, and "exact match wins over the rewrite" is
// indistinguishable from "the rewrite wins" against the real CIK map -- no key in
// it both contains a dot and exists in its own right. Only a crafted map with
// both spellings of one symbol discriminates them, and a mutation swapping the
// two survived until that fixture existed.
//
// KEYED BY symbol@file, NOT BY SYMBOL. That is the whole point of a second map
// rather than a looser first one: a fixture is permitted in the ONE harness that
// declares it, so the same literal appearing in app code -- which is the
// hand-edit vector this checker exists for -- still fails. The stale check below
// covers these too, so a deleted fixture cannot leave standing permission.
const ALLOWED_FIXTURES = new Map([
  [
    "A.B@scripts/check-sec-adapter.mjs",
    "crafted CIK map proving exact-match-before-rewrite in cikFor(); not a ticker",
  ],
  [
    "ZZZZ.Z@scripts/check-sec-adapter.mjs",
    "the not-in-either-spelling case, proving cikFor returns undefined rather than inventing a CIK",
  ],
  // The DOTTED forms are the whole subject of these three: seedManifest read
  // the map with a plain get() and BRK.B came back with no CIK, which made it
  // invisible to the daily index forever. The fixture has to hold the spelling
  // the universe actually uses or it would assert nothing.
  [
    "BRK.B@scripts/check-sec-daily-index.mjs",
    "the dotted-universe-ticker-resolves-to-dashed-map-entry fixture; the defect this asserts against",
  ],
  [
    "BF.B@scripts/check-sec-daily-index.mjs",
    "second dotted form in the same fixture — one symbol passing proves nothing about the shape",
  ],
  [
    "MKC.V@scripts/check-sec-daily-index.mjs",
    "third dotted form, and the non-B suffix, so the fixture is not three instances of one pattern",
  ],
]);

/** A dotted literal is excused only in the exact file its fixture entry names. */
const fixtureExcused = (symbol, file) =>
  ALLOWED_FIXTURES.has(`${symbol}@${path.relative(process.cwd(), file).split(path.sep).join("/")}`);

console.log("1. The premise: the vendor's spelling is the DASH");

// If buildFmpSymbol were deleted, or reversed to map dash->dot, the whole
// argument above inverts and this check would be enforcing the wrong direction.
// Assert the premise rather than assuming it.
const history = readCodeOnly("lib/server/historyCache.ts");
const buildFmp = (history.match(/function buildFmpSymbol\([\s\S]*?\n\}/) ?? [])[0];
if (!buildFmp) {
  console.error("FAIL: could not find buildFmpSymbol — measuring nothing.");
  process.exit(1);
}
// THE PREMISE MOVED, AND THE ASSERTION FOLLOWED IT RATHER THAN BEING DELETED.
//
// This used to read buildFmpSymbol's body for a literal `.replace(/\./g, "-")`.
// That body now calls toDashed from lib/symbolSpellings.mjs instead, because
// the rule having exactly one implementation is the point -- fetchFmpQuote
// shipped without the conversion precisely because the rule lived inside one
// caller. Pinning the old text would have failed the fix that improved it.
//
// So the premise is asserted in two halves, at the two places it can now break:
// buildFmpSymbol delegates, and the thing it delegates to maps dot to dash. A
// check that only asserted the first half would pass if toDashed were reversed.
check(
  "buildFmpSymbol delegates to the shared helper rather than re-rolling the rule",
  /toDashed\(/.test(buildFmp) && !/replace\(/.test(buildFmp),
  "a private copy is how the rule stayed invisible to fetchFmpQuote; the " +
    "second clause is what stops a copy coming back beside the call"
);
const spellings = readCodeOnly("lib/symbolSpellings.mjs");
const toDashedSrc = (spellings.match(/export const toDashed\s*=[^\n]*/) ?? [])[0] ?? "";
check(
  "and toDashed itself maps dot to dash, not the reverse",
  /replace\(\s*\/\\\.\/g\s*,\s*"-"\s*\)/.test(toDashedSrc),
  "this is the evidence that FMP wants the dash — corroborated by the screener " +
    "cache, whose rows come from FMP's own endpoint and are dashed. Reversing " +
    "this one line would silently invert every call site below"
);
check(
  "and it is applied when building the bars request",
  /buildFmpSymbol\(/.test(history.replace(buildFmp, "")),
  "the mapping existing but going uncalled would mean bars break too, and the " +
    "asymmetry this check guards would not be an asymmetry"
);

console.log("\n2. No NEW hand-written dotted ticker");

// A ticker-shaped literal: all caps either side of a single dot. Deliberately
// narrow -- a wider pattern would match version strings and file paths and turn
// the assertion into noise that gets ignored, which is the failure mode this
// whole check was written in response to.
const TICKER_WITH_DOT = /^[A-Z]{1,5}\.[A-Z]{1,2}$/;
const ROOTS = ["lib", "app", "scripts"];
const SELF = path.resolve("scripts/check-symbol-spelling.mjs");

// THE AST, NOT A REGEX OVER TEXT. A string literal reported by the parser is by
// construction outside every comment, so prose mentioning "BRK.B" cannot satisfy
// or trip this (claude/traps/grep-finds-the-comment-not-the-code.md) -- and
// there is a lot of such prose, including in this file's own header.
const found = new Map();
let filesScanned = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walk(p);
      continue;
    }
    if (!/\.(ts|tsx|mjs)$/.test(entry.name)) continue;
    // THIS FILE EXCLUDES ITSELF. The allowlist above quotes "BRK.B" as a string
    // literal, so a scan including this file counts itself as an instance and
    // reports 7 files where 6 hold the ticker. Excluding only this one path
    // rather than all of scripts/ keeps the other harnesses in scope.
    if (path.resolve(p) === SELF) continue;
    // AND ONE MORE FILE, for the same reason and not as a loophole.
    // check-security-spellings.mjs holds captured NASDAQ TRADER names, where a
    // dotted ticker is that source's own spelling for a share class (MKC.V,
    // BRK.A) -- it is the subject under test, not repo ticker usage. It does not
    // belong in ALLOWED_DOTTED either: entries there mean "a live instance of
    // the bug in this codebase", and that list is documented to only shrink.
    if (path.basename(p) === "check-security-spellings.mjs") continue;
    filesScanned++;
    const text = fs.readFileSync(p, "utf8");
    const sf = ts.createSourceFile(
      p,
      text,
      ts.ScriptTarget.Latest,
      true,
      p.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const visit = (n) => {
      if (ts.isStringLiteral(n) && TICKER_WITH_DOT.test(n.text)) {
        if (!found.has(n.text)) found.set(n.text, new Set());
        found.get(n.text).add(p);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
};
for (const root of ROOTS) if (fs.existsSync(root)) walk(root);

// MEASURING-NOTHING GUARD, FIRST. A scan that visited no files, or whose parse
// silently returned no literals, would satisfy "no unexpected dotted ticker"
// vacuously -- the exact fail-green shape scripts/lib/source-code.mjs was built
// to prevent. The known instance is the positive control: if the scan cannot
// find the one dotted ticker that is definitely there, it is not measuring.
check(
  "the scan actually read the source tree",
  filesScanned > 100,
  `${filesScanned} files parsed under ${ROOTS.join(", ")} — a scan of nothing ` +
    `would pass the assertion below by finding nothing`
);
for (const known of ALLOWED_DOTTED.keys()) {
  check(
    `the scan finds the known instance ${known} (positive control)`,
    found.has(known),
    "if this goes red, either the bug was fixed — delete the allowlist entry — " +
      "or the scan broke and every assertion here is worthless"
  );
}

// A symbol is unexpected only if EVERY file holding it is unaccounted for: a
// fixture entry excuses its own file, never the symbol everywhere.
const unexpected = [...found.entries()]
  .filter(([sym, files]) =>
    !ALLOWED_DOTTED.has(sym) && [...files].some((f) => !fixtureExcused(sym, f)))
  .map(([sym]) => sym)
  .sort();
check(
  "no dotted ticker outside the allowlist",
  unexpected.length === 0,
  unexpected.length
    ? `${unexpected.join(", ")} — a dotted ticker gets bars and NO industry or ` +
      `sector, silently, because the fundamentals path does not map the dot. ` +
      `Use FMP's dashed spelling instead, or add an allowlist entry saying why not`
    : `${found.size} dotted ticker(s) in the tree, all known`
);

// THE SCOPING ITSELF, ASSERTED RATHER THAN ASSUMED. Widening the excuse from
// symbol@file to bare symbol passes every other assertion here, because it only
// does damage in the presence of a leak -- two mutations that are each harmless
// alone. A single-mutation suite cannot catch that pairing, so the property is
// checked directly: the same literal in a different file must NOT be excused.
check(
  "a fixture excuses its own file and nothing else",
  (() => {
    const [firstKey] = [...ALLOWED_FIXTURES.keys()];
    if (!firstKey) return false;
    const [sym, file] = firstKey.split("@");
    return fixtureExcused(sym, path.join(process.cwd(), file)) &&
      !fixtureExcused(sym, path.join(process.cwd(), "lib/server/news/secProvider.ts")) &&
      !fixtureExcused("NOT.AFIXTURE", path.join(process.cwd(), file));
  })(),
  "otherwise a test fixture becomes standing permission for the same literal in app code, " +
    "which is the hand-edit vector this whole file exists for"
);

const staleFixtures = [...ALLOWED_FIXTURES.keys()].filter((key) => {
  const [sym, file] = key.split("@");
  const files = found.get(sym);
  return !files || ![...files].some((f) => path.relative(process.cwd(), f).split(path.sep).join("/") === file);
});
check(
  "the fixture list has no stale entries",
  staleFixtures.length === 0,
  staleFixtures.length
    ? `${staleFixtures.join(", ")} is excused but no longer there — delete the ` +
      `entry, or it becomes standing permission for a real dotted ticker in that file`
    : `${ALLOWED_FIXTURES.size} fixture(s), each still in the file that declares it`
);

const stale = [...ALLOWED_DOTTED.keys()].filter((s) => !found.has(s)).sort();
check(
  "the allowlist has no stale entries",
  stale.length === 0,
  stale.length
    ? `${stale.join(", ")} is allowlisted but no longer in the source — delete ` +
      `the entry, or it becomes standing permission for the next one`
    : "every entry is still a live instance"
);

console.log("\n3. Where the known instances actually are");
// Printed rather than asserted: the COUNT is not the property, and pinning it
// would make an unrelated refactor fail. It is here because the first write-up
// of this said "five places" from memory and there are six -- so the number gets
// measured on every run instead of remembered.
for (const [sym, files] of [...found].sort()) {
  const note = ALLOWED_DOTTED.get(sym) ??
    [...files].map((f) => ALLOWED_FIXTURES.get(
      `${sym}@${path.relative(process.cwd(), f).split(path.sep).join("/")}`)).find(Boolean);
  console.log(`  ${sym} — ${files.size} file(s)${note ? `: ${note}` : ""}`);
  for (const f of [...files].sort()) console.log(`      ${f}`);
}

console.log("\n4. The vendor call sites convert before they ask");

// SECTION 2 CATCHES A DOTTED TICKER WRITTEN INTO THE SOURCE. This catches the
// other half of the same bug, which section 2 cannot see: a symbol that arrives
// at RUNTIME already dotted -- from a route parameter -- and is handed to FMP
// unconverted. No literal appears anywhere, so nothing above fires, and the
// page renders LAST PRICE: DATA UNAVAILABLE with no error in any log.
//
// It is not hypothetical and it is not one call site. /stock/BRK.B/news had two
// of them, one feeding the body and one feeding the <title>, while the same
// page's history went through buildFmpSymbol and converted -- so the title
// carried a price and the body did not.
//
// WHAT IS ASSERTED VS WHAT IS PRINTED. The assertion covers the call sites named
// below and nothing else, because those are the ones fixed. Every other FMP
// request that interpolates a symbol is PRINTED instead: whether each can
// receive a dotted spelling depends on what feeds it, which this check cannot
// determine and must not pretend to. A census that goes quiet would be worse
// than no census, so it prints on every run and names its own limit.

// ONE ENTRY PER VENDOR, because the symbol does not sit in the same place in
// each URL: FMP takes it as a query parameter, Yahoo as a PATH SEGMENT. A
// checker that only understood `symbol=` would have reported the Yahoo leg as
// having no symbol at all -- clean by absence, which is the fail-green shape
// this file keeps guarding against.
const VENDORS = [
  {
    name: "FMP",
    host: /financialmodelingprep\.com/,
    // `...?symbol=${x}` puts "?symbol=" in the chunk before the span.
    slot: /[?&]symbols?=$/,
  },
  {
    name: "Yahoo",
    host: /query1\.finance\.yahoo\.com/,
    slot: /\/v8\/finance\/chart\/$/,
  },
];

// The interpolated expression is read from the AST, not by regex over the URL
// text, because the two are different questions: the text tells you a symbol is
// in the URL, the AST tells you WHAT EXPRESSION produced it -- which is the
// thing that either converts or does not.
const symbolExpressionsIn = (file, text) => {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const out = [];
  const enclosingFunction = (node) => {
    for (let n = node.parent; n; n = n.parent) {
      if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
      if (
        (ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n)) &&
        n.name &&
        ts.isIdentifier(n.name) &&
        n.initializer &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
      ) {
        return n.name.text;
      }
    }
    return "(top level)";
  };
  const visit = (n) => {
    if (ts.isTemplateExpression(n)) {
      const whole = n.getText(sf);
      const vendor = VENDORS.find((v) => v.host.test(whole));
      if (vendor) {
        // The literal chunk BEFORE a span is what names the slot that span
        // fills, whether that slot is a query parameter or a path segment.
        let before = n.head.text;
        for (const span of n.templateSpans) {
          if (vendor.slot.test(before)) {
            out.push({
              file,
              vendor: vendor.name,
              fn: enclosingFunction(n),
              expr: span.expression.getText(sf),
              line: sf.getLineAndCharacterOfPosition(span.expression.getStart(sf)).line + 1,
            });
          }
          before = span.literal.text;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
};

// A conversion is recognised by NAME, and only by the names that actually do it.
// `encodeURIComponent` wraps every one of these and converts nothing, so the
// pattern has to be the helper, not "the expression is a call".
const CONVERTS = /\b(toDashed|buildFmpSymbol|fmpSymbol)\b/;

// ── THE EXTRACTOR IS TESTED BEFORE IT IS TRUSTED ──────────────────────────
// An earlier assertion in this repo passed against `if (false && tagged)`,
// because it compared source positions instead of calling the thing. The shape
// to avoid is an extractor that finds nothing and therefore reports nothing
// wrong. So it is run against two synthetic sources whose answers are known,
// and it must separate them.
const PROBE_RAW = `
  const bad = async (symbol: string) => {
    const url = \`https://financialmodelingprep.com/stable/quote?symbol=\${encodeURIComponent(symbol)}&apikey=\${k}\`;
    return fetch(url);
  };`;
const PROBE_CONVERTED = PROBE_RAW.replace("encodeURIComponent(symbol)", "encodeURIComponent(toDashed(symbol))");
// The SAME control for the path-segment shape. The two slots are read by two
// different regexes, so a probe of only the query-parameter form would leave
// the Yahoo half of the extractor untested.
const PROBE_PATH = `
  const alsoBad = async (symbol: string) => {
    const url = \`https://query1.finance.yahoo.com/v8/finance/chart/\${encodeURIComponent(symbol)}?interval=1d\`;
    return fetch(url);
  };`;
const rawFound = symbolExpressionsIn("probe-raw.ts", PROBE_RAW);
const convFound = symbolExpressionsIn("probe-converted.ts", PROBE_CONVERTED);
const pathFound = symbolExpressionsIn("probe-path.ts", PROBE_PATH);
check(
  "the extractor finds an interpolated symbol at all (positive control)",
  rawFound.length === 1 && rawFound[0].fn === "bad",
  rawFound.length === 1
    ? `found ${rawFound[0].expr} in ${rawFound[0].fn}()`
    : `found ${rawFound.length}, expected exactly 1 — an extractor that finds ` +
      `nothing would report every call site as clean`
);
check(
  "and it finds one in a PATH SEGMENT, not just a query parameter",
  pathFound.length === 1 && pathFound[0].vendor === "Yahoo",
  pathFound.length === 1
    ? `found ${pathFound[0].expr} as a ${pathFound[0].vendor} path segment`
    : `found ${pathFound.length}, expected exactly 1 — Yahoo puts the symbol in ` +
      `the path, and an extractor blind to that would score the whole leg clean ` +
      `by finding nothing in it`
);
check(
  "and it tells a converted call site from a raw one",
  rawFound.length === 1 &&
    convFound.length === 1 &&
    !CONVERTS.test(rawFound[0].expr) &&
    CONVERTS.test(convFound[0].expr),
  "the two probes differ by exactly the toDashed wrapper, so a pattern that " +
    "matched both — or neither — would make the assertion below vacuous"
);

// THE CALL SITES THIS PR FIXED. Named by file and function so a rename fails
// loudly here rather than quietly removing the site from the check's scope.
const UNDER_TEST = [
  ["lib/stock-news-data.ts", "fetchFmpQuote", "the price in the page body"],
  ["app/stock/[symbol]/news/page.tsx", "fetchQuoteForMeta", "the price in the <title>"],
  // Yahoo is the LAST fallback for both the quote and the history, and its two
  // callers share this one request builder. Converting here was measured, not
  // assumed: BRK.B is a 404 at this endpoint and BRK-B is a 200 (Actions run
  // 35794824846). Had it gone the other way this entry would not exist.
  ["lib/stock-news-data.ts", "fetchYahooChart", "the Yahoo fallback, quote and history"],
];

const allSites = [];
const collectFrom = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") collectFrom(p);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    const rel = path.relative(process.cwd(), p).split(path.sep).join("/");
    const text = fs.readFileSync(p, "utf8");
    // Cheap pre-filter only. It must be derived from VENDORS rather than
    // hardcoded, or adding a vendor above would silently scan for the old one.
    if (!VENDORS.some((v) => v.host.test(text))) continue;
    allSites.push(...symbolExpressionsIn(rel, text));
  }
};
for (const root of ["lib", "app"]) if (fs.existsSync(root)) collectFrom(root);

check(
  "the vendor scan read a real tree",
  allSites.length > 5 && VENDORS.every((v) => allSites.some((s) => s.vendor === v.name)),
  `${allSites.length} symbol-carrying request(s) across lib/ and app/: ` +
    VENDORS.map((v) => `${v.name} ${allSites.filter((s) => s.vendor === v.name).length}`).join(", ") +
    " — a vendor with zero sites means its host pattern stopped matching, and " +
    "every assertion about it below would then pass by finding nothing"
);

for (const [file, fn, what] of UNDER_TEST) {
  const sites = allSites.filter((s) => s.file === file && s.fn === fn);
  check(
    `${fn}() in ${file} is still there`,
    sites.length > 0,
    sites.length
      ? `${sites.length} ${[...new Set(sites.map((s) => s.vendor))].join("/")} request(s) — ${what}`
      : "renamed, moved or deleted — this check is now measuring nothing for it, " +
        "which is how a fixed call site quietly becomes an unfixed one again"
  );
  for (const site of sites) {
    check(
      `${fn}() converts before asking ${site.vendor} (line ${site.line})`,
      CONVERTS.test(site.expr),
      CONVERTS.test(site.expr)
        ? `\${${site.expr}}`
        : `\${${site.expr}} sends the spelling it was given. On ` +
          `/stock/BRK.B/news that is "BRK.B", which ${site.vendor} has no row ` +
          `for — the page renders DATA UNAVAILABLE and nothing errors. Wrap it ` +
          `in toDashed`
    );
  }
}

// ── THE CENSUS ─────────────────────────────────────────────────────────────
// Printed, never asserted. These are outside what was fixed; several are fed
// from the screener snapshot, which is dashed at source and so cannot carry a
// dot — but "several" is not "all", and this check cannot tell which is which
// without tracing every caller. The list is here so the next person fixing one
// of these starts from a measurement instead of a grep.
const rest = allSites.filter(
  (s) => !UNDER_TEST.some(([f, fn]) => s.file === f && s.fn === fn)
);
const unconverted = rest.filter((s) => !CONVERTS.test(s.expr));
console.log(
  `\n  ${rest.length} other symbol-carrying vendor request(s); ${unconverted.length} ` +
    `do not convert. NOT a failure list — whether a dotted spelling can reach ` +
    `each one depends on what feeds it, and that is unmeasured here:`
);
for (const s of unconverted.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  console.log(`      ${s.file}:${s.line}  ${s.fn}()  ${s.vendor}  \${${s.expr}}`);
}

console.log(
  failures === 0
    ? "\nALL CHECKS PASSED"
    : `\n${failures} CHECK(S) FAILED`
);
process.exit(failures === 0 ? 0 : 1);
