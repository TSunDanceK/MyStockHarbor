// The comment stripper every other harness reads its subject through.
//
// WHY THIS HARNESS EXISTS. Sixteen check-*.mjs scripts strip comments before
// asking "does the code do X", because otherwise the prose describing a bug
// satisfies the assertion about the bug. If the stripper is wrong, every one of
// those scripts is measuring the stripper rather than the code -- and it fails
// in the quiet direction: a strip that eats a region makes POSITIVE assertions
// fail loudly but makes NEGATIVE ones ("this pattern is gone", "nothing imports
// X") pass, because nothing appears in text that was deleted.
//
// So the stripper needs its own calibration, against fixtures that are the real
// bugs rather than invented ones.
//
//   node scripts/check-comment-stripper.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments, assertStripKeptTheCode, outsideCommentMarkers } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// The naive strip, verbatim as it lived in sixteen harnesses.
const NAIVE = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

console.log("\n=== 1. FIXTURE: the bug that prompted this ===\n");
// lib/server/historyCache.ts sends an Accept header containing `*/*`. To the
// naive regex that `*/` closes the preceding block comment and the following
// `/*` opens a new one.
const HIST = "lib/server/historyCache.ts";
const hist = read(HIST);
check(
  "historyCache.ts still contains the `*/*` that triggers it",
  hist.includes("*/*"),
  "if this ever goes away, keep the fixture below anyway — the pattern is what matters"
);

const naiveOut = NAIVE(hist);
check(
  "the naive strip demonstrably eats code from it",
  naiveOut.length < hist.length * 0.5,
  `${hist.length} -> ${naiveOut.length}`
);
let caught = null;
try {
  assertStripKeptTheCode(hist, naiveOut, HIST);
} catch (e) {
  caught = e.message;
}
check("...and the guard REFUSES it", Boolean(caught), caught ? caught.slice(0, 90) + "…" : "guard did not fire");
check(
  "the guard names what was lost, not just that something was",
  Boolean(caught && /lost occurrences \(/.test(caught) && /"|[0-9]+\/[0-9]+/.test(caught))
);

console.log("\n=== 2. FIXTURE: template literals with substitutions ===\n");
// The SECOND bug, found by this guard before it shipped: a raw ts.createScanner
// has no parser state, loses the thread at the `}` of a `${...}` substitution,
// and treats the next backtick as the start of a fresh template -- swallowing
// everything to the one after it.
const EARN = "app/stock/[symbol]/earnings/page.tsx";
const earn = read(EARN);
const earnStripped = stripComments(earn, { file: EARN });
check(
  'the string after a template literal on the same line survives',
  earnStripped.includes('type: "article"'),
  "a scanner-based strip lost this one"
);
check(
  "so does the one after that",
  earnStripped.includes("MyStockHarbor earnings dashboard")
);

console.log("\n=== 3. The strip actually strips ===\n");
// The opposite failure: a "stripper" that returns its input unchanged passes
// every guard above and defeats the entire purpose.
const histStripped = stripComments(hist, { file: HIST });
check("a block-comment phrase is gone", !histStripped.includes("ORDERING CONSTRAINT"));
check("a line-comment phrase is gone", !histStripped.includes("FIRST, AND BEFORE THE WEEKEND BRANCH"));
check("a trailing comment is gone too", !histStripped.includes("skipTrivia"), "not just whole-line comments");
check("the code is not", histStripped.includes("export async function getDailyHistoryBulk("));
check("string contents survive", histStripped.includes("q=0.9"), "the *\\/* header itself is data, not a comment");
check(
  "it removed a substantial amount",
  histStripped.replace(/\s+/g, "").length < hist.replace(/\s+/g, "").length * 0.9,
  `${hist.replace(/\s+/g, "").length} -> ${histStripped.replace(/\s+/g, "").length} non-whitespace chars`
);

console.log("\n=== 4. Line numbers are preserved unless dropLines is asked for ===\n");
check(
  "default: the stripped text has the same line count",
  histStripped.split("\n").length === hist.split("\n").length,
  "line-anchored assertions in the callers depend on this"
);
const dropped = stripComments(hist, { file: HIST, dropLines: true });
check("dropLines: fewer lines", dropped.split("\n").length < hist.split("\n").length);
check(
  "dropLines keeps lines that were ALREADY blank",
  dropped.split("\n").filter((l) => l.trim() === "").length > 0,
  "the originals dropped comment lines, not blank ones"
);

console.log("\n=== 5. A comment-dense file is not mistaken for an eaten one ===\n");
// The first version of the guard used a 20% byte floor and immediately produced
// a FALSE ALARM on this file, which is genuinely 92% comment lines. A fraction
// cannot separate "mostly prose" from "the stripper ate the code" -- the real
// bug retained 68.6% of its file. That is why the markers do the work.
const LAYOUT = "app/stock/[symbol]/layout.tsx";
const layout = read(LAYOUT);
let threw = false;
try { stripComments(layout, { file: LAYOUT }); } catch { threw = true; }
check(
  "a 92%-comment file strips without tripping the guard",
  !threw,
  `${layout.length} -> ${threw ? "THREW" : stripComments(layout, { file: LAYOUT }).replace(/\s+/g, "").length + " non-ws chars"}`
);

console.log("\n=== 6. Markers are dense enough to catch a bite anywhere ===\n");
// Top-level declarations alone are sparse: a smaller eaten region could fall
// entirely between two of them. Names and string literals from the whole tree
// are what make an arbitrary bite detectable.
const markers = outsideCommentMarkers(hist, HIST);
check("historyCache parses to many markers", markers.size >= 50, `${markers.size}`);
// BITTEN AT A KNOWN CODE POSITION, not at an arbitrary offset. The first
// version of this fixture removed bytes from the middle of the file and expected
// a catch; it did not get one, and the guard was right -- the middle of
// historyCache.ts is prose, so the bite removed only comments and nothing real
// was lost. The property is "parsed markers survive", not "bytes survive", and a
// fixture that conflates the two tests the wrong thing.
const biteAt = (needle, len) => {
  const at = hist.indexOf(needle);
  if (at < 0) throw new Error(`fixture anchor missing: ${needle}`);
  return hist.slice(0, at) + hist.slice(at + len);
};
for (const [needle, len] of [
  ["function collapseDuplicateDates", 2000],
  ["function parseFmpHistoricalRows", 400],
  ["export async function getDailyHistoryBulk", 300],
]) {
  let bitCaught = false;
  try { assertStripKeptTheCode(hist, biteAt(needle, len), HIST); } catch { bitCaught = true; }
  check(`a ${len}-char hole at \`${needle.slice(0, 34)}\` is caught`, bitCaught);
}

console.log("\n=== 7. Every harness that strips goes through this module ===\n");
// A harness that rolls its own regex again is a harness outside the guard.
const scripts = fs
  .readdirSync(path.join(ROOT, "scripts"))
  .filter((f) => f.startsWith("check-") && f.endsWith(".mjs"));
const rogue = [];
for (const f of scripts) {
  const src = read(`scripts/${f}`);
  // Its own fixture is allowed to define NAIVE deliberately.
  if (f === "check-comment-stripper.mjs") continue;
  const rollsOwn =
    /replace\(\/\\\/\\\*\[\\s\\S\]\*\?\\\*\\\/\/g/.test(src) ||
    /startsWith\("\/\/"\)/.test(src) ||
    /ts\.createScanner\(/.test(src);
  if (rollsOwn) rogue.push(f);
}
check(
  "no harness strips comments by hand",
  rogue.length === 0,
  rogue.length ? rogue.join(", ") : `${scripts.length} scripts checked`
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
