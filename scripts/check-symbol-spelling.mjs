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
check(
  "buildFmpSymbol maps dot to dash, not the reverse",
  /replace\(\s*\/\\\.\/g\s*,\s*"-"\s*\)/.test(buildFmp),
  "this is the evidence that FMP wants the dash — corroborated by the screener " +
    "cache, whose rows come from FMP's own endpoint and are dashed"
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

const unexpected = [...found.keys()].filter((s) => !ALLOWED_DOTTED.has(s)).sort();
check(
  "no dotted ticker outside the allowlist",
  unexpected.length === 0,
  unexpected.length
    ? `${unexpected.join(", ")} — a dotted ticker gets bars and NO industry or ` +
      `sector, silently, because the fundamentals path does not map the dot. ` +
      `Use FMP's dashed spelling instead, or add an allowlist entry saying why not`
    : `${found.size} dotted ticker(s) in the tree, all known`
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
  const note = ALLOWED_DOTTED.get(sym);
  console.log(`  ${sym} — ${files.size} file(s)${note ? `: ${note}` : ""}`);
  for (const f of [...files].sort()) console.log(`      ${f}`);
}

console.log(
  failures === 0
    ? "\nALL CHECKS PASSED"
    : `\n${failures} CHECK(S) FAILED`
);
process.exit(failures === 0 ? 0 : 1);
