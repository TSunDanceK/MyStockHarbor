// Task router for .github/workflows/relay.yml.
//
// WHY THE ROUTING LIVES HERE AND NOT IN THE WORKFLOW. workflow_dispatch only
// registers for workflow files on the DEFAULT BRANCH, so anything encoded in
// relay.yml costs a merge-and-wait round trip to change. That toll was paid twice
// in one day (#436 gated Step 0, #444 gated Phase 0). A `case` statement inside
// the workflow would have kept paying it: every new phase would still need an
// edit to main before it could run once.
//
// A workflow can be dispatched with `ref` pointed at a FEATURE BRANCH, and it
// checks that branch out. So everything that varies per phase belongs in
// scripts/, where a branch can add it and dispatch it the same minute. relay.yml
// now holds only what cannot move: the input declarations and the credential
// split.
//
// THE WRITE PREFIX IS A SECURITY BOUNDARY, NOT A NAMING STYLE. Tasks whose name
// begins with "write-" are routed by relay.yml to a separate job that holds the
// Upstash credentials; everything else runs in a job that references no secrets
// at all and does not even install the Redis client. This file enforces the same
// rule independently, from the other side: invoked without --allow-writes it
// REFUSES to run a write- task, so a mis-edited `if:` in the workflow cannot
// cause a credentialled task to execute in the read-only job. Two mechanisms,
// one rule -- because a single `if:` expression is one typo from silently
// inverting.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

// task name -> script, plus the args it takes from the environment. Adding a
// phase is an edit HERE, on a branch, with no workflow change and no merge.
const TASKS = {
  "stooq-access": { script: "scripts/stooq-access-probe.mjs", args: () => [] },
  // Added on a branch and dispatched the same minute, with no workflow edit and
  // no merge -- which is the whole reason routing lives here instead of in a
  // case statement inside relay.yml.
  "bars-providers": { script: "scripts/bars-provider-probe.mjs", args: () => [] },
  "nasdaq-refill": {
    script: "scripts/nasdaq-refill-analysis.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  "listing-split": {
    script: "scripts/listing-split.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  "phase0-adjustment": {
    script: "scripts/phase0-adjustment-probe.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  coverage: {
    script: "scripts/stooq-coverage.mjs",
    args: (env) => [env.DUMP_DIR ?? "", env.SYMBOLS ?? ""],
    needsDump: true,
  },
  "sec-fundamentals": {
    script: "scripts/sec-fundamentals-ingest.mjs",
    args: (env) => [env.DUMP_DIR ?? "", env.SYMBOLS ?? ""],
    needsDump: true,
  },
  // Read-only: fetches two public pipe-delimited text files and prints them.
  // Needed because the sandbox is refused www.nasdaqtrader.com by policy, and
  // that directory is where the news path's company name actually comes from.
  "company-name-sample": { script: "scripts/company-name-sample.mjs", args: () => [] },
  // Read-only: fetches a public RSS feed and prints it. Needed because the
  // sandbox is refused news.google.com by policy, and the adapter's parser must
  // be tested against the feed's real shape.
  "gnews-sample": { script: "scripts/gnews-sample.mjs", args: () => [] },
  // Read-only, but needs the frozen universe to compute the match ratio: the
  // question "how many wire items are about a stock we cover" cannot be answered
  // without the symbol set.
  "wire-feeds": {
    script: "scripts/wire-feeds-probe.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // Read-only. Needs the dump for the universe: both the CIK map and the
  // sicDescription comparison are scoped to the symbols the site covers.
  "sec": {
    script: "scripts/sec-probe.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // Read-only. One poll of all three free news sources, digested to the raw
  // inputs §7's cascade reads — no judgement made on the runner, so the
  // measurement describes the shipped derivation and not a copy of it.
  "eventtype-sample": { script: "scripts/eventtype-sample.mjs", args: () => [] },
  // Read-only, NO NETWORK AT ALL: inventories the frozen dump already on the
  // runner. Asked before building the static-profile snapshot, because if the
  // dump carries the taxonomy the snapshot costs no FMP calls whatsoever.
  "dump-inventory": {
    script: "scripts/dump-inventory.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // Read-only, NO NETWORK: builds the static profile snapshot from the taxonomy
  // already in the frozen dump, captured while the FMP licence was live. See the
  // script header for why there are no FMP calls in it.
  "static-profile": {
    script: "scripts/static-profile-build.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // Fetches SEC's ticker file on a runner, because the agent sandbox is refused
  // www.sec.gov with 403 CONNECT. Read-only by name and by nature: it writes a
  // file into the workspace, which the workflow uploads as an artifact, and
  // touches no credential.
  "company-tickers": { script: "scripts/fetch-company-tickers.mjs", args: () => [] },
  // Read-only: the two venue reference files disagree about this universe, and
  // the totals alone cannot say which is wrong. Emits the per-symbol diff plus
  // what the 62.5%-by-dollar-volume figure becomes under each source. Needs the
  // dump for the universe AND for the bars that weight the swing.
  "listing-venue-diff": {
    script: "scripts/listing-venue-diff.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // Read-only: asks data.sec.gov/submissions whether a registrant is still
  // filing. Absence from the ticker file is not proof of deregistration, and
  // retiring a symbol on a lookup miss would discard its filing history.
  "sec-symbol-status": { script: "scripts/sec-symbol-status.mjs", args: (env) => [env.SYMBOLS ?? ""] },
  // Read-only: measures what it COSTS to find out whether a filer's numbers
  // changed -- conditional requests on companyfacts and submissions, both with
  // negative controls, plus whether submissions' isXBRL flag can tell a
  // quarter-carrying 6-K from a press release.
  "sec-reread": { script: "scripts/sec-reread-probe.mjs", args: (env) => [env.SYMBOLS ?? ""] },
  "write-stooq-ingest": {
    script: "scripts/stooq-ingest.mjs",
    args: (env) => [env.SYMBOLS ?? ""],
    writes: true,
  },
};

const argv = process.argv.slice(2);
const allowWrites = argv.includes("--allow-writes");
const task = argv.find((a) => !a.startsWith("--"));

if (!task) {
  console.error("FATAL: no task given. Usage: relay-run.mjs <task> [--allow-writes]");
  console.error(`Known tasks: ${Object.keys(TASKS).join(", ")}`);
  process.exit(2);
}

const spec = TASKS[task];
if (!spec) {
  // A CLEAR FAILURE, WITH THE LIST. An unknown task is most often a typo in the
  // dispatch form, and discovering it as "module not found" three minutes into a
  // runner is the round trip this whole design exists to avoid.
  console.error(`FATAL: unknown task "${task}".`);
  console.error(`Known tasks: ${Object.keys(TASKS).join(", ")}`);
  console.error(
    "Add it to TASKS in scripts/relay-run.mjs — on a branch, and dispatch the " +
      "relay with ref pointed at that branch. No workflow edit is needed."
  );
  process.exit(2);
}

// THE SECOND HALF OF THE BOUNDARY. relay.yml routes by the write- prefix; this
// refuses to act on a write task unless the caller says it is the credentialled
// job. The two must agree, and disagreeing fails closed.
const named = task.startsWith("write-");
if (named !== Boolean(spec.writes)) {
  console.error(
    `FATAL: naming/permission mismatch for "${task}". A task that writes MUST be ` +
      `named with the write- prefix, and a task named write- MUST declare ` +
      `writes: true. The prefix is what routes it to the credentialled job, so a ` +
      `disagreement here means the routing is wrong.`
  );
  process.exit(2);
}
if (spec.writes && !allowWrites) {
  console.error(
    `FATAL: "${task}" writes, and this invocation was not granted writes. It is ` +
      `running in the read-only relay job, which holds no credentials. Refusing ` +
      `rather than failing later with an authentication error that would read as ` +
      `a bad secret.`
  );
  process.exit(2);
}
if (!spec.writes && allowWrites) {
  console.error(
    `FATAL: "${task}" does not write, but was invoked from the credentialled job. ` +
      `Read-only work must not run where the write token is present — that is the ` +
      `whole point of the split.`
  );
  process.exit(2);
}

if (!fs.existsSync(spec.script)) {
  console.error(
    `FATAL: "${task}" routes to ${spec.script}, which does not exist on this ref.`
  );
  console.error(
    "Either the script has not been written yet, or the relay was dispatched " +
      "against a ref that predates it. Dispatch with ref pointed at the branch " +
      "that carries the script."
  );
  process.exit(2);
}
if (spec.needsDump && !process.env.DUMP_DIR) {
  console.error(
    `FATAL: "${task}" reads the frozen dump but DUMP_DIR is empty — the download ` +
      `or locate step did not run. Dispatch with a run_id.`
  );
  process.exit(2);
}

const args = spec.args(process.env).filter((a) => a !== "");
console.log(`relay: ${task} -> node ${spec.script} ${args.join(" ")}`);
const res = spawnSync("node", [spec.script, ...args], { stdio: "inherit" });
process.exit(res.status ?? 1);
