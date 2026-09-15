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
import os from "node:os";
import path from "node:path";
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
  // Name-matching, NOT ticker-matching -- the ticker key is what failed.
  //
  // needsDump WAS true AND IS NOW FALSE, because run 48 proved the dump has
  // nothing this task wants: its FMP cache rows carry sector and industry and
  // no company name at all, so the run came back void. Names now come from the
  // Nasdaq Trader directory, fetched on the runner. The dump is still READ if
  // one is attached -- it contributes the pickers half of the universe -- but
  // requiring it would make the task wait on an artifact it does not need.
  "sec-titles": {
    script: "scripts/sec-title-candidates.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: false,
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
  // How much of a symbol's real pool its anchored short-name needle admits, and
  // how much of that is the company rather than the index, the month or the
  // noun. news.google.com is refused from the sandbox; a runner reaches it.
  "anchor-collisions": { script: "scripts/anchor-collision-sample.mjs", args: () => [] },
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
  // Read-only: the FULL Google News feed per symbol, digested to publisher,
  // link host and title. Asked after the preview showed 13 of 15 MU cards were
  // institutional-holding churn that every precision probe had scored 96-100%,
  // because "is it about MU" and "is it worth reading" are different questions
  // and only the first had ever been measured.
  "churn-sample": { script: "scripts/churn-sample.mjs", args: () => [] },
  // Read-only: asks a deployment for pages so their renders emit [timing] lines
  // into the Vercel runtime log. Prints no response body -- the measurement is
  // in the log, not in the HTML, and the sandbox is refused *.vercel.app anyway.
  "render": {
    script: "scripts/render-probe.mjs",
    args: (env) => [env.SYMBOLS ?? ""],
  },
  // Read-only: how long each free news adapter actually takes, cold, against
  // the real hosts. Asked before choosing a per-adapter timeout budget, because
  // the sandbox cannot reach any of the three and a guessed budget is a guess.
  "news-timing": { script: "scripts/news-timing-probe.mjs", args: () => [] },
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
  // NOT A TASK, DELIBERATELY: scripts/window-fixture-diff.mjs reads the committed
  // fixture and a live symbol list and touches no network, so it runs locally.
  // Adding it here would imply it needs a runner, which is the kind of drift
  // this table exists to avoid.
  //
  // Read-only: captures the REAL filing rows for a date window so a check can
  // replay them through applyFilings. §17 previously built its own 281 synthetic
  // symbols and handed them forms from a modulo-5 round robin, which cannot be
  // evidence about what the route does with a real week of EDGAR.
  "sec-window-fixture": {
    script: "scripts/sec-window-fixture.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
    // It LIFTS the shipped parsers, and type erasure needs the TypeScript
    // compiler. See needsTypescript below for why that is one package and not
    // `npm ci`.
    needsTypescript: true,
  },
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
  // Read-only: runs the SHIPPED extraction over five real filers' companyfacts
  // and diffs every extracted number against the frozen FMP ground truth in the
  // dump. Needs the dump for the FMP side and the network for the SEC side, and
  // the sandbox is refused data.sec.gov with 403 CONNECT. Lifts secFields.ts and
  // secExtract.ts, so type erasure needs the TypeScript compiler.
  "sec-extract": {
    script: "scripts/sec-extract-probe.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
    needsTypescript: true,
  },
  // Read-only, NO CREDENTIAL: Phase 0 of the logo-harvest brief. Asks FMP's
  // image CDN whether it actually holds a logo for each symbol in the union
  // universe. The CDN needs no API key, so this belongs in the uncredentialled
  // job -- the FMP key stays out of Actions, per the static-profile README.
  // Fetches the Nasdaq symdir live for the Exchange and ETF columns, because
  // `exchange` is in static-profile.json's absentFields.blocked.
  "logo-coverage": { script: "scripts/logo-coverage-probe.mjs", args: () => [] },
  // Read-only: what one symbol COSTS to populate — fetch, parse, extract,
  // encode — measured sequentially and paced exactly as the route paces it, so
  // SEC_POPULATE_PER_RUN is sized against a number rather than an estimate.
  // Needs the dump for the universe and the network for companyfacts.
  "sec-populate-cost": {
    script: "scripts/sec-populate-cost.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
    needsTypescript: true,
  },
  // Read-only: does the page read IFRS filings now, and what is left when it
  // does. Runs the SHIPPED extractor over the ten FPIs that measured as empty
  // plus the universe FPIs the brief named plus a us-gaap control, and reports
  // which mapped ifrs-full tags never hit and which published tags nothing
  // maps. No dump, no credential; needs the network and the TypeScript
  // compiler for the lift.
  "sec-ifrs": {
    script: "scripts/sec-ifrs-probe.mjs",
    args: (env) => [env.SYMBOLS ?? ""],
    needsTypescript: true,
  },
  // Read-only: runs the SHIPPED view builder and the SHIPPED scorer over real
  // companyfacts and prints what a reader would see — the snapshot card's
  // strings, the growth table row by row with its base disclosed, and the
  // score with the components it could not read. Prints the OLD q[i+4] base
  // beside the new one so "unchanged for a dense filer" is checked rather than
  // asserted. Also diagnoses an empty cash-flow chain against the payload.
  // No dump, no credential; needs the network and the TypeScript compiler.
  "sec-period-match": {
    script: "scripts/sec-period-match-probe.mjs",
    args: (env) => [env.SYMBOLS ?? ""],
    needsTypescript: true,
  },
  // Read-only: what twelve stored quarters COST, measured against real
  // payloads before the window is changed. Reports the stored record size at
  // four window variants, whether the reader's hash gate moves (it cannot),
  // and how many of the eight RENDERED rows can reach a prior-year period at
  // each. No dump, no credential; needs the network and the TypeScript
  // compiler for the lift.
  "sec-window-size": {
    script: "scripts/sec-window-size-probe.mjs",
    args: (env) => [env.SYMBOLS ?? ""],
    needsTypescript: true,
  },
  // Read-only: captures a REAL StoredFactSet for a symbol and prints it
  // gzip+base64 with a SHA-256 of the plaintext, so a fixture can be committed
  // and proven byte-identical to what the runner produced. Actions artifacts
  // download via a blob host the sandbox cannot reach, which is why it goes
  // through the log.
  "sec-fixture": {
    script: "scripts/sec-fixture-capture.mjs",
    args: (env) => [env.SYMBOLS ?? ""],
    needsTypescript: true,
  },
  // Read-only: WHY a field renders "—" on a given filer. Lists every concept
  // the filer actually tagged in the period whose name could plausibly be the
  // figure, with values, and says whether our chain lists it. Answers "chain
  // gap or not tagged" with evidence instead of a guess.
  "sec-missing-fields": {
    script: "scripts/sec-missing-field-probe.mjs",
    args: () => [],
    needsTypescript: true,
  },
  // Credentialled because Upstash lives in that job; performs NO writes.
  // Counts, from the STORED universe, how many SYMBOLS render the annual-filer
  // card and how many sets are still on the old quarter window.
  "write-annual-filer-census": {
    script: "scripts/annual-filer-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
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
// TYPESCRIPT, ON DEMAND, AND GENUINELY ONLY TYPESCRIPT.
//
// The read-only job deliberately runs no `npm ci` -- relay.yml states the
// property plainly: not installing the Upstash client is what keeps this job
// unable to reach the database even if a future edit tried to. A task that LIFTS
// a shipped function needs ts.transpileModule to erase types, so it needs the
// compiler.
//
// THE OBVIOUS FIX DOES NOT WORK, AND IT FAILS SILENTLY. `npm install --no-save
// typescript` run in the repo root resolves the WHOLE of package.json first:
// measured on run 34830229705, "added 438 packages in 10s" -- @upstash/redis
// among them. It looked like a one-package install and was a full tree, which
// would have quietly voided the property the workflow comment describes.
//
// So the install happens in an EMPTY temporary directory, where typescript has
// no dependencies of its own and npm adds exactly one package, and only that
// package is copied into ./node_modules. Verified: `npm install --no-save
// --no-package-lock typescript@^5` in an empty dir reports "added 1 package".
//
// AND IT LIVES HERE, NOT IN relay.yml, for the reason in this file's header: a
// workflow edit costs a merge-and-wait before it can run once.
if (spec.needsTypescript) {
  let present = false;
  try {
    await import("typescript");
    present = true;
  } catch {
    present = false;
  }
  if (!present) {
    // Pinned to the same range the repo builds with, so erase() behaves here
    // exactly as it does in check-all. A floating install could change what a
    // lifted function's body looks like, which is the one thing this must not do.
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const range = pkg.devDependencies?.typescript ?? pkg.dependencies?.typescript;
    if (!range) {
      console.error("FATAL: package.json declares no typescript, but this task lifts TS source.");
      process.exit(2);
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relay-ts-"));
    console.log(`relay: installing typescript@${range} in isolation (NOT npm ci, NOT the repo tree)`);
    const r = spawnSync(
      "npm",
      ["install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", `typescript@${range}`],
      { cwd: tmp, stdio: "inherit" }
    );
    const from = path.join(tmp, "node_modules", "typescript");
    if (r.status !== 0 || !fs.existsSync(from)) {
      console.error(
        `FATAL: could not install typescript (exit ${r.status}). This task lifts functions ` +
          `from .ts sources and cannot erase types without it. Reimplementing the parsers ` +
          `instead is not the fallback -- a capture that parses with its own code is not ` +
          `evidence about the shipped parser.`
      );
      process.exit(2);
    }
    // ONE DIRECTORY, COPIED BY NAME. Anything else npm happened to leave in the
    // temp tree stays there.
    fs.mkdirSync("node_modules", { recursive: true });
    fs.cpSync(from, path.join("node_modules", "typescript"), { recursive: true });
    const installed = fs.readdirSync(path.join(tmp, "node_modules")).filter((d) => !d.startsWith("."));
    console.log(`relay: typescript in place (isolated install held ${installed.length}: ${installed.join(", ")})`);
  }
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
