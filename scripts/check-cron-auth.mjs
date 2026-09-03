// Who calls the warm jobs, and who schedules them.
//
// TWO RULES, ADDED A DAY APART BECAUSE THEY FAILED A DAY APART: every
// automated caller of a CRON_SECRET-gated route must send the header
// (sections 1-4), and every warm job must have a scheduler that actually
// fires (section 5). The workflow this file is mostly about had both defects
// at once, and fixing the first did not touch the second.
//
// WHAT HAPPENED, so the assertion has a reason attached. All three calls in
// .github/workflows/pickers-warm.yml were bare curls -- zero occurrences of
// Authorization, Bearer or CRON_SECRET in the file -- against routes that
// require the header. From run 33614228672 on 2026-09-02:
//
//     warm-picker-universe: HTTP 200      <- in 2.0s, i.e. NOT forced
//     warm-earnings pass 1: HTTP 401
//     warm-earnings pass 2: HTTP 401
//     job conclusion: SUCCESS
//
// warm-earnings did 40 symbols a day instead of 120 for weeks, and every
// reading of "observed earnings coverage" was a reading of a broken job. The
// status was printed on every single run; nobody read it, because a workflow
// that prints a failure and exits 0 is a green tick.
//
// TWO DISTINCT FAILURES, and this file asserts both:
//   the call was unauthenticated
//   the run did not go red when it failed
//
// THE GATED SET IS DERIVED, NOT TYPED. A hand-typed list of "routes that need
// the header" goes stale the first time a route adds a gate, and the symptom
// is silence. The scan follows one import hop into lib/ because
// warm-picker-universe does not mention CRON_SECRET itself -- its gate lives
// in pickersBuilder.isCronAuthorized, which is exactly the case a route-file-
// only scan would miss.
//
// WHAT A PASS DOES NOT COVER, stated because a heuristic that reads as proof
// is worse than no check: the scan follows ONE hop, so a gate two modules deep
// is invisible to it; and it reads .github/workflows/*.yml only, so a call
// made from anywhere else -- a Claude routine, a phone bookmark, an external
// scheduler -- is outside its reach.
//
//   node scripts/check-cron-auth.mjs
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
// STRIPPED, for the routes as well as the workflow. warm-picker-universe
// mentions CRON_SECRET twice in its own file -- once in a comment and once in
// a console.warn telling the reader to go and set it -- and neither is a gate.
// A scan matching the NAME classified it as gated in its own route file, which
// silently disabled the one assertion that exists to prove the import hop
// works. Comment-stripping alone would not have been enough; the log string
// survives it. So the scan matches `process.env.CRON_SECRET` -- the gate --
// rather than the word.
const readCode = (p) => readCodeOnly(p, { minRetainedFraction: 0.005 });
const READS_THE_SECRET = /process\.env\.CRON_SECRET/;

// ── 1. Which job routes are gated ──────────────────────────────────────────
console.log("\n1. The gated routes, derived from the routes themselves");

const JOBS_DIR = path.join(ROOT, "app/api/jobs");
const jobDirs = fs
  .readdirSync(JOBS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const gated = new Set();
const via = new Map();
for (const name of jobDirs) {
  const rel = `app/api/jobs/${name}/route.ts`;
  let src;
  try {
    src = readCode(rel);
  } catch {
    continue;
  }
  if (READS_THE_SECRET.test(src)) {
    gated.add(name);
    via.set(name, "route");
    continue;
  }
  // ONE HOP. The route re-exports its handler from lib/server, and the gate
  // lives there -- warm-picker-universe is exactly this shape.
  for (const m of src.matchAll(/from\s+"(?:@\/|(?:\.\.\/)+)(lib\/server\/[A-Za-z0-9_-]+)"/g)) {
    try {
      if (READS_THE_SECRET.test(readCode(`${m[1]}.ts`))) {
        gated.add(name);
        via.set(name, `${m[1]}.ts`);
        break;
      }
    } catch {
      // not a file we can read; nothing to conclude from that
    }
  }
}

check(
  "the scan found gated routes to check against",
  gated.size >= 2,
  `${[...gated].map((g) => `${g} (via ${via.get(g)})`).join(", ")} — a scan that ` +
    `finds nothing passes trivially, which is the failure mode of a derived list`
);
check(
  "including the one whose gate is NOT in its own route file",
  gated.has("warm-picker-universe") && via.get("warm-picker-universe") !== "route",
  `warm-picker-universe via ${via.get("warm-picker-universe") ?? "NOT FOUND"} — ` +
    `it returns 200 without the header and merely declines to force, so a ` +
    `route-file-only scan would call it ungated and a 200 would look like ` +
    `success. If a route is renamed, update this line deliberately`
);

// ── 2. Every workflow call carries the header ──────────────────────────────
console.log("\n2. No workflow reaches a gated route without the header");

const WF_DIR = path.join(ROOT, ".github/workflows");
const workflows = fs.existsSync(WF_DIR)
  ? fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f))
  : [];

// COMMENTS STRIPPED FIRST. This file's own header names the routes and the
// header, so a raw scan would find the description of the code and pass -- see
// claude/traps/grep-finds-the-comment-not-the-code.md.
const stripYamlComments = (src) =>
  src
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

const offenders = [];
let callsSeen = 0;
for (const file of workflows) {
  const src = stripYamlComments(read(`.github/workflows/${file}`));
  // Split on step boundaries so "the header is in this step" is the question,
  // not "the header is somewhere in this file".
  const steps = src.split(/\n\s+- name:/);
  for (const step of steps) {
    for (const m of step.matchAll(/\/api\/jobs\/([A-Za-z0-9_-]+)/g)) {
      if (!gated.has(m[1])) continue;
      callsSeen++;
      if (!/Authorization:\s*Bearer/.test(step)) {
        offenders.push(`${file} -> ${m[1]}`);
      }
    }
  }
}

check(
  "the scan found workflow calls to gated routes",
  callsSeen > 0,
  `${callsSeen} call(s) across ${workflows.length} workflow file(s) — zero would ` +
    `mean this section is asserting nothing, which is how it passed before`
);
check(
  "every one of them sends Authorization: Bearer",
  offenders.length === 0,
  offenders.length
    ? `unauthenticated: ${offenders.join(", ")}`
    : "in the same step as the call, not merely somewhere in the file"
);

// COMMENTS STRIPPED HERE TOO. The workflow's own header quotes
// `Bearer ${process.env.CRON_SECRET}` while explaining what the routes
// require, and the literal-token assertion below promptly failed on the
// explanation rather than on any code. Twice in one file, in opposite
// directions: a comment that made a route look gated, and a comment that made
// a header look hardcoded.
const warm = workflows.includes("pickers-warm.yml")
  ? stripYamlComments(read(".github/workflows/pickers-warm.yml"))
  : "";
check(
  "the secret comes from Actions secrets, never a literal",
  /\$\{\{\s*secrets\.CRON_SECRET\s*\}\}/.test(warm) &&
    [...warm.matchAll(/Bearer\s+(\S+)/g)].every((m) =>
      /^\$\{?CRON_SECRET\}?/.test(m[1]) || /^\$\{\{/.test(m[1])
    ),
  "a pasted token in a public repository is the same incident with a worse ending"
);
check(
  "a missing secret is caught before the calls, with a message",
  /-z\s+"\$\{?CRON_SECRET\}?"/.test(warm) && /::error::/.test(warm),
  "without the secret every call 401s or silently no-ops, and 'the run went " +
    "red' is a much slower diagnosis than 'the secret is missing'"
);

// ── 3. A non-200 has to go red ─────────────────────────────────────────────
console.log("\n3. Printing a failure is not reporting one");

check(
  "the status is compared, not just printed",
  /!=\s*"200"/.test(warm) || /--fail/.test(warm),
  '`curl -sS -o /dev/null -w "%{http_code}"` exits 0 on a 401 — three failing ' +
    "calls read as a green tick for weeks"
);
check(
  "and the job exits non-zero when one fails",
  /exit 1/.test(warm),
  "a warm job that silently does nothing is worse than one that is visibly " +
    "broken, because the second gets fixed"
);
check(
  "every call still runs even after one fails",
  /failures=\$\(\(failures \+ 1\)\)/.test(warm),
  "exiting at the first bad status would hide the state of the other two, and " +
    "these three jobs are independent of each other"
);

// ── 4. The secret must never reach a browser ───────────────────────────────
console.log("\n4. CRON_SECRET is not a client-side thing and never can be");

const clientFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      clientFiles.push(full);
    }
  }
};
for (const dir of ["app", "components", "lib"]) {
  const full = path.join(ROOT, dir);
  if (fs.existsSync(full)) walk(full);
}

const leaks = clientFiles.filter((f) => {
  const src = fs.readFileSync(f, "utf8");
  return /^\s*["']use client["']/m.test(src) && /CRON_SECRET/.test(src);
});
check(
  "no client component references CRON_SECRET",
  leaks.length === 0,
  leaks.length
    ? `leaks: ${leaks.map((f) => path.relative(ROOT, f)).join(", ")}`
    : "the /pickers 'Fetch Earnings' button calls this same route from the " +
      "browser; the fix for THAT is not the header, because a secret in client " +
      "code ships to every visitor including the scrapers this site runs a " +
      "firewall against"
);
check(
  "and it is not exposed through a public env var",
  !clientFiles.some((f) => /NEXT_PUBLIC_[A-Z_]*CRON/.test(fs.readFileSync(f, "utf8"))),
  "NEXT_PUBLIC_ is inlined into the bundle at build time — same leak, longer name"
);

// ── 5. Where the schedule lives ────────────────────────────────────────────
console.log("\n5. Vercel schedules the warm jobs; GitHub only holds the lever");

// WHY THE SCHEDULE MOVED. GitHub's scheduled workflows are best-effort --
// queued, delayed under load, sometimes dropped -- and 05:03 UTC sits in one
// of the busiest cron windows there is. Across all 29 scheduled runs on record
// this workflow NEVER ONCE fired within half an hour of its schedule (best:
// +29 min), and over its last week it drifted to +265..+737 minutes before
// missing 2026-09-03 entirely. A job whose purpose is "warm the site early in
// the morning" was firing at lunchtime, when it fired at all.
//
// The manual trigger is kept, so sections 1-4 above still have a caller to be
// true about. That is why this section is here rather than in a file of its
// own: "is it authenticated" and "does it still have a scheduler" are the same
// question asked of the same three calls, and separating them is how you end
// up fixing one and shipping the other.
check(
  "the warm workflow is manual-only",
  /workflow_dispatch/.test(warm) && !/^\s*schedule:/m.test(warm),
  "GitHub's scheduler was never on time here and stopped firing altogether. " +
    "Re-adding `schedule:` should be a deliberate act that updates this line, " +
    "not a quiet restoration of a trigger that measurably does not work"
);

const vercelCrons = new Set(
  (JSON.parse(read("vercel.json")).crons ?? []).map((c) =>
    String(c.path).replace(/^\/api\/jobs\//, "")
  )
);
check(
  "vercel.json still schedules something",
  vercelCrons.size > 0,
  `${vercelCrons.size} cron entries — an empty list would make both assertions ` +
    `below vacuous, which is the failure mode of checking a set against a set`
);

// THE ONE-CHANGE-NOT-TWO RULE, MADE PERMANENT. Removing a GitHub schedule
// before the Vercel entry exists leaves a window with neither, and the symptom
// is a job that quietly stops running -- indistinguishable, on the run record,
// from a job that runs and finds nothing to do.
const orphanedByWorkflow = [];
for (const file of workflows) {
  const src = stripYamlComments(read(`.github/workflows/${file}`));
  for (const m of src.matchAll(/\/api\/jobs\/([A-Za-z0-9_-]+)/g)) {
    if (gated.has(m[1]) && !vercelCrons.has(m[1]) && !orphanedByWorkflow.includes(m[1])) {
      orphanedByWorkflow.push(m[1]);
    }
  }
}
check(
  "every job a workflow calls is also scheduled by Vercel",
  orphanedByWorkflow.length === 0,
  orphanedByWorkflow.length
    ? `no Vercel cron for: ${orphanedByWorkflow.join(", ")}`
    : "the workflow is a hand-pulled lever now, so anything it touches needs a " +
      "real schedule underneath it — this is what stops the next person " +
      "removing a trigger and a cron entry in two different PRs"
);

// AND THE BROADER ONE: a warm job with no scheduler is a job that never runs.
// check-cache-health-page.mjs already ties the JOBS REGISTRY to vercel.json in
// both directions; this ties the ROUTES ON DISK to it, which is the gap a new
// route falls through -- it would have no registry entry either, so nothing
// there would notice it.
const unscheduled = [...gated].filter((g) => !vercelCrons.has(g));
check(
  "every CRON_SECRET-gated job route has a Vercel cron",
  unscheduled.length === 0,
  unscheduled.length
    ? `gated but unscheduled: ${unscheduled.join(", ")}`
    : `all ${gated.size} of them — a route built to be woken by a scheduler, ` +
      `with no scheduler, is dead code that reads as infrastructure`
);

console.log(
  failures === 0
    ? "\nEvery automated caller is authenticated, and every warm job has a scheduler.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
