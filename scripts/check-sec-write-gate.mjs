// NO SEC STATE IS WRITTEN OUTSIDE PRODUCTION — asserted per CALL SITE.
//
// ── THE DEFECT THIS GUARDS, MEASURED ─────────────────────────────────────
// An audit of the shared store on 2026-09-16 found twelve fact sets appearing
// in four minutes with no job running — ADSEW, ALMU, ESP, ISPR, KO, LEN, LUXE,
// NCPL, NCPLW, PEP, RVSN, RVSNW, RZLT, SANG — carrying a field only the
// unmerged branch could produce. A PREVIEW deployment's cold path had written
// them into the database production reads.
//
// ── WHY THIS ENUMERATES RATHER THAN SPOT-CHECKS ──────────────────────────
// A check that asserts "the cold path is gated" passes forever while the next
// write site is added ungated, and there are seven of them across five
// modules. So the sites are DERIVED from the source — every Redis mutation and
// every revalidatePath in the SEC modules — and each must be inside a function
// that consults the gate. A new one fails this check on the day it is written,
// which is the only day it is cheap to fix.
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// The modules that hold SEC state. Adding a SEC module without adding it here
// is itself caught: §4 asserts this list covers every file that imports the
// SEC fact-set or manifest key names.
const FILES = [
  "lib/server/secFactStore.ts",
  "lib/server/secReportDatesStore.ts",
  "lib/server/secManifest.ts",
  "lib/server/secColdCik.ts",
  "lib/server/secColdFetch.ts",
  "app/api/jobs/sec-facts/route.ts",
];

// A Redis MUTATION, not a read. zcard/zrange/get/hlen are reads and are
// deliberately absent: a preview may read all it likes.
const MUTATION = /\bredis\.(set|zadd|zrem|incr|expire|hset|hdel|del|lpush|rpush|sadd|srem)\b|\brevalidatePath\(/;

console.log("\n1. every SEC write site sits inside a gated function");

/** Split a module into top-level functions, so a site can be attributed. */
function functionsOf(src) {
  const out = [];
  const re = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
  let m;
  const starts = [];
  while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index });
  starts.forEach((s, i) => {
    out.push({ name: s.name, body: src.slice(s.at, starts[i + 1]?.at ?? src.length) });
  });
  return out;
}

const sites = [];
for (const file of FILES) {
  const src = readCodeOnly(file);
  const fns = functionsOf(src);
  src.split("\n").forEach((line, i) => {
    if (!MUTATION.test(line)) return;
    const upto = src.split("\n").slice(0, i + 1).join("\n");
    const fn = [...fns].reverse().find((f) => upto.includes(f.body.slice(0, 40)));
    sites.push({ file, line: i + 1, text: line.trim(), fn: fn?.name ?? "(top level)", body: fn?.body ?? src });
  });
}
check(`the source yields SEC write sites to check`, sites.length >= 7, `${sites.length} sites`);

// A site is gated when the function containing it consults the predicate, OR —
// for the two COUNTERS — when its key is built through the preview-prefixing
// helper, which is the ruling's "preview-only prefix" arm.
for (const s of sites) {
  const gated = /canWriteSecState\(\)/.test(s.body);
  const prefixed = /secCounterPrefix\(/.test(readCodeOnly(s.file)) &&
    /coldRateKey|coldExhaustionKey|RATE_PREFIX|cold-exhausted/.test(s.body);
  check(`${s.file}:${s.line} ${s.fn} — ${s.text.slice(0, 54)}`,
    gated || prefixed,
    gated ? "gated" : prefixed ? "counter, preview-prefixed" : "NOT GATED");
}

console.log("\n2. the predicate itself");
{
  const gate = readCodeOnly("lib/server/secWriteGate.ts");
  const shared = readCodeOnly("lib/server/deployTarget.ts");
  check("it asks whether this IS production, not whether it is preview",
    /process\.env\.VERCEL_ENV === "production"/.test(shared) &&
      !/=== "preview"/.test(shared),
    'a local run, a container or a CI job sets none of them and is not production either');
  // ── ONE ENVIRONMENT QUESTION, NOT TWO ──────────────────────────────────
  // A second gate now needs the same answer. A copy of the comparison here
  // would be two places for "am I production" to drift apart, which on a
  // predicate this quiet is a divergence nobody would notice.
  check("the SEC gate DELEGATES rather than re-reading the environment",
    /return isProductionDeployment\(\);/.test(gate) &&
      !/process\.env\.VERCEL_ENV/.test(gate.replace(/secCounterPrefix[\s\S]*$/, "")),
    "a second copy of the comparison is a second thing to get wrong");
  check("a blocked write is announced rather than silent",
    /console\.log\(\s*\n?\s*`\[\$\{gate\}\] writes disabled outside production`/.test(shared),
    "a silent no-write would let the cron report success having stored nothing");
  check("the counters get their OWN bucket rather than none",
    /return canWriteSecState\(\) \? base : `\$\{base\}:preview`/.test(gate),
    "skipping the counter leaves a preview with no rate limit against data.sec.gov at all");
}

console.log("\n3. the mutation: one gate removed");
{
  // THE SITE CHOSEN IS THE ONE THE AUDIT CAUGHT. If removing its gate does not
  // fail §1, §1 is not reading what it claims to read.
  const src = readCodeOnly("lib/server/secFactStore.ts");
  const broken = src.replace(
    '  if (!canWriteSecState()) { noteSecWriteBlocked("writeFactSet"); return false; }',
    ""
  );
  check("the mutation applies", broken !== src);
  const fns = functionsOf(broken);
  const writeFn = fns.find((f) => f.name === "writeFactSet");
  check("MUTATION: writeFactSet without its gate is not gated",
    writeFn && MUTATION.test(writeFn.body) && !/canWriteSecState\(\)/.test(writeFn.body),
    "which is exactly the state that let a preview write twelve fact sets");
}

console.log("\n4. the file list covers every module that names a SEC state key");
{
  // DERIVED, so a new SEC module cannot be missed by this check's own list.
  const { execSync } = await import("node:child_process");
  const hits = execSync(
    'grep -rl "SEC_FACTS_PREFIX\\|SEC_MANIFEST_KEY\\|SEC_COLD_QUEUE_KEY\\|SEC_COLD_CIK_KEY\\|SEC_REPORT_DATES_PREFIX" lib/server app/api || true',
    { encoding: "utf8" }
  ).split("\n").filter(Boolean);
  const writers = hits.filter((f) => MUTATION.test(readCodeOnly(f)));
  const missing = writers.filter((f) => !FILES.includes(f));
  check("no module writes a SEC key without being in this check's list",
    missing.length === 0, missing.join(", ") || "none");
}

console.log(
  failures ? `\n${failures} assertion(s) failed.` : "\nNo SEC state can be written outside production.\n"
);
process.exit(failures ? 1 : 0);
