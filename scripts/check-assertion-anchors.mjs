// A standing rule about the checks themselves: an anchor on a bare identifier
// will match that identifier's DECLARATION.
//
// WHY THIS IS A CHECK AND NOT A NOTE. Ten defects in this repo have been caught
// by verifying assertions in the failing direction, and this exact shape
// accounts for several of them:
//
//   lastIndexOf('recordJobRun("warm-earnings"')   found the CATCH-block record,
//                                                 not the summary one -- twice,
//                                                 in two different PRs
//   indexOf("readFallbackTargets()")              matched the function's own
//                                                 declaration near the top of
//                                                 the file, so moving the call
//                                                 below the build left the
//                                                 ordering assertion green
//   indexOf("claimCalendarScan()")                same shape, correct only
//                                                 because the search started
//                                                 from an offset
//
// Every one of those PASSED while measuring the wrong thing, which is the worst
// failure mode a check has: it is indistinguishable from working.
//
// THE RULE. An `indexOf`/`lastIndexOf` anchor whose literal STARTS with an
// identifier followed by `(` is suspect, because a declaration of that
// identifier matches it too. Give the anchor context that only a call site has
// -- `await name(`, `const x = name(`, `return name(` -- or better, stop
// comparing offsets and RUN the predicate.
//
// WHAT THIS DOES NOT CATCH, said plainly so a PASS is not read as more than it
// is: regex anchors, template literals with interpolation, anchors that are
// ambiguous for reasons other than a declaration, and the general problem of an
// assertion measuring the wrong layer. It catches ONE mechanical shape, which
// is the one that has recurred.
//
//   node scripts/check-assertion-anchors.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "scripts");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// SELF-EXCLUDED. This file quotes the offending shapes in its own header to
// explain them, and a rule that flags its own documentation is a rule nobody
// keeps.
const SELF = "check-assertion-anchors.mjs";

const files = fs
  .readdirSync(DIR)
  .filter((f) => /^check-.*\.mjs$/.test(f) && f !== SELF)
  .sort();

check(
  "the check corpus was found",
  files.length >= 40,
  `${files.length} check scripts scanned — a scan over an empty directory passes trivially`
);

// `.indexOf("literal")` / `.lastIndexOf(`literal`)`, capturing the literal.
const ANCHOR = /\.(?:lastIndexOf|indexOf)\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
// A SIGNATURE-SHAPED ANCHOR: a BARE identifier, then `(`, then something a
// parameter list could also look like.
//
// Both halves of that are narrowing, and both were added after the first draft
// flagged seven anchors of which five were fine:
//
//   `sweep.presetHandEdit.push(symbol)` and `href.includes("trend-flip")` are
//   DOTTED, and a dotted path is never a function declaration -- there is no
//   `function sweep.presetHandEdit.push`. Bare identifiers only.
//
//   `recordJobRun("warm-earnings", true, {` and `after(async () => {` carry
//   string literals and arrows. A declaration's parameter list cannot contain
//   either, so those anchors already name a call unambiguously. Only an
//   argument list that could pass for a parameter list -- empty, or identifiers
//   and commas -- leaves the ambiguity this rule is about.
//
// A rule that flags correct code gets suppressed, and a suppressed rule catches
// nothing. Narrow enough to be obeyed is the requirement.
const BARE_CALL = /^[A-Za-z_$][\w$]*\(\s*[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*\)?\s*$|^[A-Za-z_$][\w$]*\(\s*\)?\s*$/;

const suspects = [];
let anchorsScanned = 0;
for (const file of files) {
  const src = fs.readFileSync(path.join(DIR, file), "utf8");
  const lines = src.split("\n");
  for (const m of src.matchAll(ANCHOR)) {
    const literal = m[2];
    anchorsScanned++;
    // Interpolated anchors are built at runtime; their shape cannot be judged
    // from the source and guessing would make this rule noise.
    if (literal.includes("${")) continue;
    if (!BARE_CALL.test(literal)) continue;
    const line = src.slice(0, m.index).split("\n").length;
    suspects.push({ file, line, literal, text: (lines[line - 1] ?? "").trim() });
  }
}

check(
  "the scan found anchors to judge",
  anchorsScanned >= 20,
  `${anchorsScanned} indexOf/lastIndexOf anchors across ${files.length} files — a ` +
    `scan finding nothing is the failure mode of a derived rule`
);

check(
  "no assertion anchors on a bare identifier call",
  suspects.length === 0,
  suspects.length
    ? suspects
        .map((s) => `${s.file}:${s.line} anchors on "${s.literal}" — a declaration of ` +
          `that identifier matches it too. Add context only a call site has ` +
          `(\`await …\`, \`const x = …\`), or run the predicate instead.`)
        .join("\n          ")
    : `${anchorsScanned} anchors, none of them a bare \`name(\` — the shape that ` +
      `made three assertions pass while measuring the wrong occurrence`
);

// THE RULE HAS TO BE ABLE TO FIRE. A detector that cannot detect its own
// example is the same defect one level up, so it is exercised on a fixture
// rather than trusted.
const FIXTURE = 'const i = src.indexOf("readFallbackTargets()");';
const fired = [...FIXTURE.matchAll(ANCHOR)].some(
  (m) => !m[2].includes("${") && BARE_CALL.test(m[2])
);
const spared = [...'const i = src.indexOf("await readFallbackTargets()");'.matchAll(ANCHOR)].some(
  (m) => !m[2].includes("${") && BARE_CALL.test(m[2])
);
check(
  "the detector fires on the real #419 anchor and spares the fixed one",
  fired && !spared,
  `flags \`indexOf("readFallbackTargets()")\`, allows \`indexOf("await readFallbackTargets()")\` ` +
    `— run against fixtures rather than assumed, because a rule that cannot fire ` +
    `is how the last three of these hid`
);

console.log(
  failures === 0
    ? "\nAll assertion-anchor rules hold.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
