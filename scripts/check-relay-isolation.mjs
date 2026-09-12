// The relay's read-only job must stay credential-free.
//
// WHY THIS CHECK EXISTS. Collapsing the migration's per-phase workflows into one
// parameterised relay bought back a merge-and-wait round trip per phase, but it
// put a real guarantee at risk. The read-only posture on this repo is STRUCTURAL,
// not conventional: the Step 0 dump workflow is handed Upstash's read-only token
// and the analyse workflow is handed no Upstash secrets at all, so an accidental
// write is refused by the server rather than prevented by care.
//
// A single job with a `case` over tasks would destroy that. A credential
// referenced in one branch is reachable from every branch, so the moment the
// ingest's write token appeared in the same job as the probes, "this job cannot
// touch the database" would drop from a fact to a hope.
//
// Hence two jobs, exactly one of which runs. This check asserts the property the
// comment in relay.yml claims, because a comment claiming an isolation guarantee
// and nothing enforcing it is how the guarantee quietly ends. Adding a task to
// the wrong job is a security regression, and it should fail a check rather than
// be noticed in review.
import fs from "node:fs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const FILE = ".github/workflows/relay.yml";
if (!fs.existsSync(FILE)) {
  console.error(`FATAL: ${FILE} is missing — this check measures nothing.`);
  process.exit(1);
}
const raw = fs.readFileSync(FILE, "utf8");

// Split on the job headers rather than parsing YAML, so this has no dependency
// on a YAML library being present -- and strip comment lines, because the header
// of relay.yml DISCUSSES the credentials at length and a naive substring search
// would match the prose explaining the rule and report a violation.
const stripComments = (text) =>
  text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

const jobsAt = raw.indexOf("\njobs:");
check(
  "the workflow has a jobs block",
  jobsAt !== -1,
  "without it the slicing below would silently measure the whole file"
);
const jobsBlock = raw.slice(jobsAt);

const sliceJob = (name) => {
  const start = jobsBlock.indexOf(`\n  ${name}:`);
  if (start === -1) return null;
  const rest = jobsBlock.slice(start + 1);
  // The next line at exactly two-space indent that is not a comment ends the job.
  const lines = rest.split("\n");
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (/^  [A-Za-z0-9_-]+:/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
};

const readOnly = sliceJob("read-only");
const stateful = sliceJob("stateful");

check("the read-only job exists", Boolean(readOnly));
check("the stateful job exists", Boolean(stateful));
if (!readOnly || !stateful) {
  console.log("\n2 CHECK(S) FAILED");
  process.exit(1);
}

const roCode = stripComments(readOnly);
const stCode = stripComments(stateful);

// ── The load-bearing assertion ───────────────────────────────────────────────
const SECRET_PATTERN = /secrets\.\s*([A-Z0-9_]+)/g;
const secretsIn = (code) => [...code.matchAll(SECRET_PATTERN)].map((m) => m[1]);
const roSecrets = secretsIn(roCode);
// GITHUB_TOKEN is the runner's own automatic token, scoped to this repository's
// Actions API, and downloading the frozen artifact needs it. It grants no
// database access, so it is not the thing being isolated.
const roNonGithub = roSecrets.filter((s) => s !== "GITHUB_TOKEN");

check(
  "the read-only job references NO secret except GITHUB_TOKEN",
  roNonGithub.length === 0,
  roNonGithub.length
    ? `found ${[...new Set(roNonGithub)].join(", ")} — a task that needs a ` +
      `credential belongs in the stateful job, not here. The read-only job's ` +
      `guarantee is that it CANNOT reach the database, and referencing a ` +
      `credential anywhere in it ends that guarantee for every task in it`
    : `only GITHUB_TOKEN (the runner's own Actions token, needed to download the artifact)`
);

check(
  "and specifically no Upstash credential",
  !/UPSTASH/.test(roCode),
  "the read-only job must not be able to authenticate to Redis at all"
);

check(
  "the read-only job does not run npm ci",
  !/npm ci/.test(roCode),
  "not installing @upstash/redis is the second layer: even a future edit that " +
    "added a credential would have no client to use it with"
);

// ── The other half: the split must actually be exclusive ─────────────────────
// Two jobs that can both run on one dispatch would put the write token's job
// alongside the probes in the same run, which is most of what the split prevents.
const ifOf = (code) => (code.match(/^\s*if:\s*(.+)$/m) ?? [])[1]?.trim() ?? null;
const roIf = ifOf(roCode);
const stIf = ifOf(stCode);
console.log(`\n  read-only if: ${roIf}`);
console.log(`  stateful  if: ${stIf}`);
// THE PREFIX IS THE BOUNDARY, and both gates must key on it in opposite
// directions. A task name is free text in the dispatch form precisely so that
// adding a phase needs no edit to this file -- which makes the prefix the ONLY
// thing deciding whether a credential is present, so it is asserted literally
// rather than loosely matched.
check(
  "exactly one job runs per dispatch — both gates key on the write- prefix, inverted",
  roIf === "${{ !startsWith(inputs.task, 'write-') }}" &&
    stIf === "${{ startsWith(inputs.task, 'write-') }}",
  roIf && stIf
    ? "the write- prefix routes to the credentialled job and nothing else does"
    : "an ungated job runs on every dispatch, including ones meant for the other job"
);

check(
  "the stateful job is the one that references Upstash",
  /UPSTASH_REDIS_REST_TOKEN/.test(stCode),
  "if this fails the ingest cannot write at all, and the isolation above is " +
    "trivially satisfied by a relay that does nothing"
);

// ── The router's half of the contract ────────────────────────────────────────
// Routing moved out of the workflow so that adding a phase does not need a merge.
// That makes scripts/relay-run.mjs load-bearing for the same guarantee, so its
// side is asserted too.
const ROUTER = "scripts/relay-run.mjs";
if (!fs.existsSync(ROUTER)) {
  console.error(`FATAL: ${ROUTER} is missing — the relay routes every task through it.`);
  process.exit(1);
}
const router = fs.readFileSync(ROUTER, "utf8");

console.log("");
check(
  "the read-only job invokes the router WITHOUT --allow-writes",
  /relay-run\.mjs "\$\{TASK\}"\s*2>&1/.test(roCode) && !/--allow-writes/.test(roCode),
  "the flag is what the router checks before running anything that writes"
);
check(
  "the credentialled job invokes the router WITH --allow-writes",
  /relay-run\.mjs "\$\{TASK\}" --allow-writes/.test(stCode),
  "without it the router refuses every write task and the ingest cannot run"
);
// DEFENCE IN DEPTH, and the reason it is worth having: the split above rests on
// one `if:` expression per job, and a single typo inverts it. The router
// re-derives the same rule from the task name and fails closed, so a mis-edited
// gate cannot put a credentialled task in the read-only job or vice versa.
check(
  "the router refuses a write task when writes were not granted",
  /spec\.writes && !allowWrites/.test(router),
  "this is the second, independent enforcement of the same boundary"
);
check(
  "the router refuses a read-only task when writes WERE granted",
  /!spec\.writes && allowWrites/.test(router),
  "read-only work must not execute in the job that holds the write token"
);
check(
  "the router requires the write- prefix and the writes flag to agree",
  /named !== Boolean\(spec\.writes\)/.test(router),
  "a writing task named without the prefix would be routed to the read-only job " +
    "by the workflow and would then fail confusingly rather than clearly"
);
// A task that routes to a missing script is the round trip this design exists to
// avoid, so the router checks before spawning.
check(
  "the router checks its target script exists before spawning",
  /existsSync\(spec\.script\)/.test(router),
  "a missing script would otherwise surface as a module-not-found three minutes " +
    "into a runner"
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
