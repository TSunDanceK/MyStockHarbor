// THE SEC PANEL ON /cache-health — cheap to load, and reading real keys.
//
// ── THE TWO WAYS A HEALTH PANEL LIES ──────────────────────────────────────
//
//   (1) IT RENDERS A ZERO IT DID NOT MEASURE. Every figure in the run table
//       comes from `run.summary[k] ?? 0`. A field the cron stopped writing, or
//       never wrote under that spelling, renders as a confident 0 — the same
//       shape as the census that reported 759 of 759 symbols unpopulated off a
//       retyped key. So every key the page reads is checked against the keys
//       the cron actually writes.
//
//   (2) IT COSTS MORE THAN THE THING IT MONITORS. The page's own stated rule
//       is that every read is an aggregate and nothing scales with the ~760
//       symbol universe. The manifest is 417 KB and holds most of what the
//       panel shows, so the tempting implementation is the forbidden one.
//
// Both are properties of source, read through readCodeOnly so the prose
// describing them cannot satisfy them.
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const PAGE = readCodeOnly("app/cache-health/page.tsx");
const HEALTH = readCodeOnly("lib/server/secHealth.ts");
const JOB = readCodeOnly("app/api/jobs/sec-facts/route.ts");

console.log("\n1. the panel is cheap, and cheap in the way the page requires");

check("the panel has a reader at all", /readSecHealth\(\)/.test(PAGE));
check("the reader never touches the manifest",
  !/readManifest|SEC_MANIFEST_KEY|manifest/.test(HEALTH),
  "417 KB on an owner page that promises every read is an aggregate");
check("...and neither does the page",
  !/readManifest\(/.test(PAGE));
// O(1) ONLY. zcard/hlen/get are constant; scan, keys and a multi-key mget are
// the shapes that grow with the universe.
const FORBIDDEN = ["redis.scan(", "redis.keys(", "redis.mget(", "zrange(", "hgetall("];
check("the reader issues only O(1) commands",
  FORBIDDEN.every((c) => !HEALTH.includes(c)),
  FORBIDDEN.filter((c) => HEALTH.includes(c)).join(", ") || "zcard/hlen/get only");
check("it fails to 'unknown' rather than to zero",
  /available: false/.test(HEALTH) && /available: true/.test(HEALTH) &&
    /secHealth\.available/.test(PAGE),
  "a Redis outage rendering as 0 queued and 0 exhausted is the worst possible reading");

console.log("\n2. every figure the panel shows is a figure the cron writes");

// THE CRON'S SUMMARY OBJECT, read from the shipped source rather than listed
// here. A list in this file would be a second copy that agrees today.
const summaryBlock = JOB.slice(JOB.indexOf("const summary = {", JOB.indexOf("const coldCleared")), JOB.indexOf("await recordJobRun(\"sec-facts\", summary.ok"));
check("the cron's summary object was found and sliced",
  summaryBlock.length > 200 && summaryBlock.includes("manifestWritten"),
  `${summaryBlock.length} chars`);
// SPLIT ON TOP-LEVEL COMMAS, not matched line by line. The first version used
// a per-line regex and missed `written, unchanged, failed, revalidated,` — four
// shorthand fields on one line — then reported all four as fields the cron does
// not write. A parser that reads three quarters of an object literal produces
// findings about the quarter it dropped.
const fieldNames = (block) => {
  const inner = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
  const parts = [];
  let depth = 0, buf = "";
  for (const ch of inner) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  parts.push(buf);
  return new Set(
    parts
      .map((t) => t.trim())
      .filter(Boolean)
      // `key: value` keeps the key; bare `key` is the shorthand form.
      .map((t) => (t.includes(":") ? t.slice(0, t.indexOf(":")) : t).trim())
      .filter((k) => /^[A-Za-z][A-Za-z0-9]*$/.test(k))
  );
};
const written = fieldNames(summaryBlock);
check("...and parsed into a non-trivial set of field names",
  written.size >= 10, `${written.size} fields: ${[...written].sort().join(", ")}`);

// WHAT THE PAGE READS, likewise parsed from the page rather than restated.
const read = [...PAGE.matchAll(/n\("([A-Za-z0-9]+)"\)/g)].map((m) => m[1]);
check("the page reads summary fields at all, or this section is vacuous",
  read.length >= 8, `${read.length} read site(s)`);
const missing = [...new Set(read)].filter((k) => !written.has(k));
check("every field the panel reads is one the cron writes",
  missing.length === 0,
  missing.length
    ? `${missing.join(", ")} — rendered as a confident 0 that was never measured`
    : `${new Set(read).size} distinct fields, all present`);

{
  // MUTATION: the cron renames one field and the page is not updated — the
  // silent-zero regression, judged by the same set arithmetic.
  const renamed = summaryBlock.replace("revalidated,", "flushed,");
  check("the rename mutation actually applied", renamed !== summaryBlock);
  const after = fieldNames(renamed);
  check("MUTATION: a renamed summary field is caught, not rendered as 0",
    [...new Set(read)].some((k) => !after.has(k)),
    "the page would have shown 0 pages revalidated on a run that flushed hundreds");
}

console.log("\n2b. a summary that LACKS a field renders 'not recorded', never 0");

// ── THE CASE THAT REACHED THE OWNER ──────────────────────────────────────
// The panel showed "Pages revalidated 0 of 434" for a run recorded BEFORE the
// counter existed. `?? 0` cannot tell an absent key from a measured zero, and
// the two are opposite facts: one says the cron flushed nothing, the other says
// nobody counted. §2 above catches the field being RENAMED; it cannot catch the
// stored record being OLDER than the code, which needs no rename at all — every
// deploy that adds a field creates exactly this state for one day.
//
// RUN, NOT READ. The rendering rule is arithmetic over an object, so it is
// lifted and called with a summary that is missing the field.
{
  const RENDER = PAGE.slice(PAGE.indexOf("const has = (k: string)"), PAGE.indexOf("const rows:"));
  check("the guard is in the page at all",
    /hasOwnProperty\.call\(run\.summary, k\)/.test(RENDER),
    RENDER.length ? `${RENDER.length} chars` : "(not found)");
  check("...and it is hasOwnProperty, not a truthiness test",
    !/if \(!run\.summary\[k\]\)|run\.summary\[k\] \|\|/.test(RENDER),
    "a truthiness test would render a genuine 0 as 'not recorded', which is the same lie inverted");

  // ── THE SHIPPED HELPERS, LIFTED AND CALLED WITH A CHOSEN SUMMARY ───────
  //
  // TYPES STRIPPED LONGEST-FIRST, and that is not a detail: stripping
  // `: string` before `: string[]` turns `keys: string[]` into `keys[]` and the
  // lift dies on a SyntaxError — which is how the first version of this block
  // failed, loudly and immediately, rather than passing against half a
  // function.
  const strip = (src) => src
    .replace(/: string\[\]/g, "")
    .replace(/: \(\) => string/g, "")
    .replace(/: string/g, "");
  let nonce = 0;
  const withSummary = (summary) =>
    lift(
      `const run = { summary: ${JSON.stringify(summary)} };\n` +
        strip(RENDER) +
        `\nexport { has, n, row };\n// nonce ${nonce++}`
    );
  const revalRow = (m) =>
    m.row(["revalidated", "attempted"], () => `${m.n("revalidated")} of ${m.n("attempted")} attempted`);

  // A run recorded before the counter existed: attempted and written, no
  // revalidated. This is the exact shape the owner was shown.
  const older = await withSummary({ attempted: 434, written: 419 });
  check("a summary WITHOUT revalidated renders 'not recorded'",
    revalRow(older) === "not recorded",
    `got ${JSON.stringify(revalRow(older))} — "0 of 434" is the confident zero this exists to prevent`);

  // AND A MEASURED ZERO MUST STILL RENDER AS ZERO, or the guard has only moved
  // the lie: a run that genuinely flushed nothing is a real reading.
  const measuredZero = await withSummary({ attempted: 434, revalidated: 0 });
  // ASSERTED ON THE SHAPE, NOT ON A HAND-TYPED SENTENCE. The first version
  // expected "0 of 434" while the row renders "0 of 434 attempted" — the check
  // failed on its own typo while the code was correct, which is the cheap
  // version of a harness measuring itself.
  check("...but a MEASURED zero still renders as 0",
    revalRow(measuredZero) !== "not recorded" && /^0 of 434\b/.test(revalRow(measuredZero)),
    `got ${JSON.stringify(revalRow(measuredZero))}`);

  // MUTATION: the guard removed, so the page is back to `?? 0`.
  const unguarded = await lift(
    `const run = { summary: { attempted: 434, written: 419 } };\n` +
      strip(RENDER).replace("keys.every(has)", "true") +
      `\nexport { has, n, row };\n// nonce ${nonce++}`
  );
  check("the remove-the-guard mutation actually applied",
    strip(RENDER).includes("keys.every(has)"),
    "the anchor must exist in the shipped source for the mutation to mean anything");
  check("MUTATION: without the guard the absent field renders as a confident 0",
    /^0 of 434\b/.test(revalRow(unguarded)),
    `got ${JSON.stringify(revalRow(unguarded))} — which is what shipped, and what was read ` +
      `as the cron flushing nothing`);
}

console.log("\n3. changed-only revalidation, as a counted fact");

const changedBranch = JOB.slice(
  JOB.indexOf("if (changed)"),
  JOB.indexOf("if (entry) {", JOB.indexOf("if (changed)"))
);
check("the changed branch was found and sliced",
  changedBranch.length > 100 && changedBranch.includes("revalidatePath"),
  `${changedBranch.length} chars`);
check("revalidatePath is inside the changed branch",
  /revalidatePath\(/.test(changedBranch));
check("...and the counter is incremented beside it, not somewhere else",
  /revalidated\+\+/.test(changedBranch),
  "counting elsewhere would let the number and the behaviour drift apart");
// THE FILING PHASE (#535 COWORK #6, 2026-09-23) FLUSHES TOO, and only after
// the write it just made — a set it read from the filing is by definition a
// change. So: exactly one flush OUTSIDE that phase, and every flush inside it
// sits after its `writeFactSet` succeeded.
const FILING_PHASE = JOB.slice(
  JOB.indexOf("const filingFill = {"),
  JOB.indexOf("const done = { cold:")
);
const outside = JOB.replace(FILING_PHASE, "");
check("the filing phase was found and sliced", FILING_PHASE.length > 500, `${FILING_PHASE.length} chars`);
check("there is exactly one revalidatePath in the job outside the filing phase",
  (outside.match(/revalidatePath\(/g) ?? []).length === 1,
  `${(outside.match(/revalidatePath\(/g) ?? []).length} call site(s) — a second one outside the ` +
    `branch is how "changed-only" becomes "every symbol touched"`);
check("the filing phase flushes only after its write succeeded",
  FILING_PHASE.indexOf("revalidatePath(`/stock/${symbol}/earnings`)") > FILING_PHASE.indexOf('if (!(await writeFactSet(next))) throw') &&
    FILING_PHASE.indexOf('if (!(await writeFactSet(next))) throw') > 0);

{
  // MUTATION: the flush moved out of the changed branch, so every attempted
  // symbol re-renders. The count would then track `attempted`, which is exactly
  // what the panel puts it beside.
  const moved = JOB.replace("      } else {\n        unchanged++;", "        revalidatePath(`/stock/${symbol}/earnings`);\n      } else {\n        unchanged++;");
  check("the move-the-flush mutation actually applied", moved !== JOB);
  check("MUTATION: a second revalidatePath outside the branch is caught",
    (moved.replace(FILING_PHASE, "").match(/revalidatePath\(/g) ?? []).length !== 1,
    "an assertion that survived this would not be guarding changed-only");
}

console.log(
  failures
    ? `\n${failures} assertion(s) failed.`
    : "\nThe panel measures what it shows, and costs four O(1) commands.\n"
);
process.exit(failures ? 1 : 0);
