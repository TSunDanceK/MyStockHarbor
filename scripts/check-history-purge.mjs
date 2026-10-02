// The one-off history purge workflow (#552 COWORK #103).
//
// WHY A CHECK FOR A FILE THAT RUNS ONCE. It runs once, against every branch,
// with a token that can rewrite workflow history, and in a public log. There
// is no second attempt to learn from, so the rules it must keep are asserted
// before it can be dispatched:
//   - it only runs by hand, and only when the input says PURGE;
//   - the PAT is read in exactly two steps (the clone and the push) and never
//     appears in a URL;
//   - nothing from the runner leaves it (no upload-artifact, no cache), since
//     the mirror holds the old history;
//   - both asserts run before the push, under `set -e`;
//   - the push is branches only (refs/heads/*), never tags, refs/pull or
//     --mirror;
//   - the 12 paths are exactly the runbook's 12.
//
// WHAT A PASS DOES NOT COVER: whether the runner's git, gh or filter-repo
// behave as on 2 Oct. The step bodies are read as text, not run. The 2 Oct
// session run (CODE-A #102) is the evidence that the commands themselves work.
//
//   node scripts/check-history-purge.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILE = ".github/workflows/history-purge.yml";

// The runbook's 12 paths (A handover, 2 Oct, §2), typed here on purpose: the
// workflow's copy has to match an independent list, not itself.
const RUNBOOK_PATHS = [
  "data/consensus/",
  "data/static-profile.json",
  "data/.wire/static-profile-dict.json",
  "glob:data/.wire/static-profile-rows-*.txt",
  "data/taxonomy.json",
  "public/preview/",
  ".github/workflows/step0-ground-truth.yml",
  ".github/workflows/consensus-freeze-commit.yml",
  "scripts/consensus-freeze.mjs",
  "app/api/debug/static-profile/",
  "claude/screenshots/earnings-round-2-2026-09-23/",
  "claude/tiingo-contract-and-limits-2026-09-23.md",
];

const CLONE_STEP = "Mirror clone (PAT)";
const PUSH_STEP = "Force-push branches (PAT)";
const ASSERT_STEPS = ["Assert paths gone", "Assert main tree unchanged"];

// Steps: each block starts at a "      - " list item under `steps:`.
function splitSteps(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  if (start < 0) return [];
  const steps = [];
  for (const l of lines.slice(start + 1)) {
    if (/^ {6}- /.test(l)) steps.push([l]);
    else if (steps.length) steps[steps.length - 1].push(l);
  }
  return steps.map((ls) => {
    const body = ls.join("\n");
    const name = (body.match(/^ {6}- name:\s*(.+)$/m) || body.match(/^ {8}name:\s*(.+)$/m) || [])[1]?.trim() ?? "";
    return { name, body };
  });
}

function topBlock(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*\\n((?:[ \\t]+.*\\n|\\s*\\n)*)`, "m"));
  return m ? m[1] : null;
}

// YAML comment lines dropped: the header explains "no upload-artifact" and the
// push step's comment names refs/pull, and neither is a step.
const stripComments = (t) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

// Returns the list of failed rules (empty = pass).
export function rules(raw) {
  const text = stripComments(raw);
  const fails = [];
  const rule = (label, ok) => {
    if (!ok) fails.push(label);
  };
  const steps = splitSteps(text);
  const idx = (n) => steps.findIndex((s) => s.name === n);

  // 1. Dispatch-only.
  const on = topBlock(text, "on") ?? "";
  const triggers = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
  rule("on: is workflow_dispatch only", triggers.length === 1 && triggers[0] === "workflow_dispatch");
  rule("confirm input is required", /confirm:\s*\n(?:\s+.*\n)*?\s+required:\s*true/.test(on));

  // 2. The PURGE gate is the first step and exits non-zero otherwise.
  const gate = steps[0];
  rule(
    "first step is the PURGE gate",
    !!gate &&
      /inputs\.confirm/.test(gate.body) &&
      /"\$CONFIRM" != "PURGE"/.test(gate.body) &&
      /exit 1/.test(gate.body),
  );

  // 3. GITHUB_TOKEN is read-only.
  const perms = topBlock(text, "permissions") ?? "";
  rule("top-level permissions exist", perms.trim().length > 0);
  rule("no write permission", !/write/.test(perms) && !/permissions:\s*write-all/.test(text));
  rule("no job-level permissions override", (text.match(/^\s*permissions:/gm) || []).length === 1);

  // 4. Nothing leaves the runner.
  rule("no upload-artifact", !/upload-artifact/.test(text));
  rule("no actions/cache", !/actions\/cache/.test(text));
  rule("no cache: key", !/^\s*cache(-dependency-path)?:/m.test(text));

  // 5. The PAT: exactly two reads, in the clone and push steps only.
  const tokenSteps = steps.filter((s) => /secrets\.PURGE_TOKEN/.test(s.body)).map((s) => s.name);
  rule("PURGE_TOKEN read exactly twice", (text.match(/secrets\.PURGE_TOKEN/g) || []).length === 2);
  rule(
    "PURGE_TOKEN only in the clone and push steps",
    tokenSteps.length === 2 && tokenSteps.includes(CLONE_STEP) && tokenSteps.includes(PUSH_STEP),
  );
  rule("no credential in a URL", !/@github\.com/.test(text) && !/PURGE_TOKEN@|auth@/.test(text));
  rule("token sent as a masked header", (text.match(/::add-mask::\$auth/g) || []).length === 2);
  rule("clone fails fast without the secret", /-z "\$\{PURGE_TOKEN:-\}"[\s\S]*?exit 1/.test(steps[idx(CLONE_STEP)]?.body ?? ""));

  // 6. Order: pre-checks, clone, rewrite, both asserts, then the push.
  const pushIdx = idx(PUSH_STEP);
  const order = ["Pre-checks", CLONE_STEP, "Record pre-purge state", "Rewrite history", ...ASSERT_STEPS].map(idx);
  rule("all expected steps exist", order.every((i) => i >= 0) && pushIdx >= 0);
  rule("steps run in runbook order before the push", order.every((i, k) => i >= 0 && i < pushIdx && (k === 0 || i > order[k - 1])));
  const pushers = steps.filter((s) => /git\b[^\n]*\bpush\b/.test(s.body) || /^\s+push --/m.test(s.body)).map((s) => s.name);
  rule("only the push step pushes", pushers.length === 1 && pushers[0] === PUSH_STEP);
  const pushBody = steps[pushIdx]?.body ?? "";
  rule("push is refs/heads/* only", /'refs\/heads\/\*:refs\/heads\/\*'/.test(pushBody) && !/--tags|--mirror|--all|refs\/pull/.test(pushBody));
  for (const n of [...ASSERT_STEPS, "Pre-checks", "Rewrite history", PUSH_STEP]) {
    rule(`${n}: set -euo pipefail`, /set -euo pipefail/.test(steps[idx(n)]?.body ?? ""));
  }
  rule("assert 1 exits on a remaining path", /fail=1[\s\S]*exit 1/.test(steps[idx(ASSERT_STEPS[0])]?.body ?? ""));
  rule("assert 2 compares against the recorded tree", /"\$new_tree" != "\$OLD_TREE"[\s\S]*?exit 1/.test(steps[idx(ASSERT_STEPS[1])]?.body ?? ""));
  rule("pre-checks stop on open PRs or other runs", /open_prs" -eq 0 \] \|\| \{[^}]*exit 1/.test(steps[idx("Pre-checks")]?.body ?? "") && /other_runs" -eq 0 \] \|\| \{[^}]*exit 1/.test(steps[idx("Pre-checks")]?.body ?? ""));

  // 7. The rewrite: the runbook's 12 paths, main's rule files, quiet output.
  const rw = steps[idx("Rewrite history")]?.body ?? "";
  const here = rw.match(/<<'EOF'\n([\s\S]*?)\n\s*EOF/);
  const paths = here ? here[1].split("\n").map((l) => l.trim()).filter(Boolean) : [];
  rule("paths are exactly the runbook's 12", JSON.stringify(paths) === JSON.stringify(RUNBOOK_PATHS));
  rule("filter-repo uses both rule files", /--replace-text "\$RUNNER_TEMP\/rules-fmp\.txt"/.test(rw) && /--replace-text "\$RUNNER_TEMP\/rules-vendor\.txt"/.test(rw));
  rule("filter-repo output stays on the runner", /> "\$RUNNER_TEMP\/filter-repo\.log" 2>&1/.test(rw));
  rule("rule files read from the mirror's main", /git show main:scripts\/purge\/replace-fmp-values\.txt/.test(text) && /git show main:scripts\/purge\/replace-vendor-labels\.txt/.test(text));
  rule("filter-repo pinned to 2.47.0", /git-filter-repo==2\.47\.0/.test(text));

  // 8. Runner limits.
  rule("timeout-minutes set", /timeout-minutes:\s*15/.test(text));
  rule("concurrency without cancel-in-progress", /concurrency:[\s\S]*?cancel-in-progress:\s*false/.test(text));
  return fails;
}

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const text = fs.readFileSync(path.join(ROOT, FILE), "utf8");

console.log(`\n1. ${FILE} keeps every rule`);
const fails = rules(text);
check("all rules hold", fails.length === 0, fails.join("; "));

// The rule file itself must be on main, or the rewrite reads nothing.
for (const f of ["scripts/purge/replace-fmp-values.txt", "scripts/purge/replace-vendor-labels.txt"]) {
  check(`${f} exists`, fs.existsSync(path.join(ROOT, f)));
}

console.log("\n2. Mutants (each must be caught)");
const mutants = [
  ["a push trigger", (t) => t.replace("on:\n  workflow_dispatch:", "on:\n  push:\n    branches: [main]\n  workflow_dispatch:")],
  ["a schedule trigger", (t) => t.replace("on:\n  workflow_dispatch:", "on:\n  schedule:\n    - cron: \"0 0 * * *\"\n  workflow_dispatch:")],
  ["the gate removed", (t) => t.replace('if [ "$CONFIRM" != "PURGE" ]; then', 'if false; then')],
  ["the gate exits 0", (t) => t.replace('nothing done"\n            exit 1', 'nothing done"\n            exit 0')],
  ["contents: write", (t) => t.replace("  contents: read\n", "  contents: write\n")],
  ["upload-artifact added", (t) => t.replace("      - name: Verify and report", "      - uses: actions/upload-artifact@v4\n        with:\n          path: ${{ runner.temp }}/mirror.git\n\n      - name: Verify and report")],
  ["pip cache on", (t) => t.replace('python-version: "3.12"', 'python-version: "3.12"\n          cache: pip')],
  ["PAT in the pre-check step", (t) => t.replace("GH_TOKEN: ${{ github.token }}", "GH_TOKEN: ${{ secrets.PURGE_TOKEN }}")],
  ["token in the clone URL", (t) => t.replace('clone --quiet --mirror "https://github.com/$REPO.git"', 'clone --quiet --mirror "https://x-access-token:${PURGE_TOKEN}@github.com/$REPO.git"')],
  ["header not masked", (t) => t.replace('echo "::add-mask::$auth"\n          # Branches', "# Branches")],
  ["push before the asserts", (t) => {
    const s = splitSteps(t);
    const push = s.find((x) => x.name === PUSH_STEP).body;
    const a1 = s.find((x) => x.name === ASSERT_STEPS[0]).body;
    return t.replace(push + "\n", "").replace(a1, push + "\n" + a1);
  }],
  ["assert 1 no longer fails", (t) => t.replace('else echo "FAIL  $p ($n commits)"; fail=1; fi', 'else echo "FAIL  $p ($n commits)"; fi')],
  ["assert 2 compares the wrong tree", (t) => t.replace('"$new_tree" != "$OLD_TREE"', '"$new_tree" = "$new_tree"')],
  ["push --mirror", (t) => t.replace("push --quiet --force", "push --quiet --force --mirror")],
  ["push tags too", (t) => t.replace("push --quiet --force", "push --quiet --force --tags")],
  ["a path dropped", (t) => t.replace("          data/taxonomy.json\n", "")],
  ["filter-repo output in the log", (t) => t.replace(' \\\n              > "$RUNNER_TEMP/filter-repo.log" 2>&1; then', "; then")],
  ["one rule file dropped", (t) => t.replace(' \\\n              --replace-text "$RUNNER_TEMP/rules-vendor.txt"', "")],
  ["open-PR pre-check removed", (t) => t.replace('[ "$open_prs" -eq 0 ] || { echo "::error::pre-check FAIL: $open_prs open PRs"; exit 1; }', "true")],
  ["set -e dropped from the push", (t) => {
    const s = splitSteps(t).find((x) => x.name === PUSH_STEP).body;
    return t.replace(s, s.replace("set -euo pipefail", "true"));
  }],
  ["cancel-in-progress true", (t) => t.replace("cancel-in-progress: false", "cancel-in-progress: true")],
];
for (const [label, mutate] of mutants) {
  const m = mutate(text);
  check(`mutant: ${label}`, m !== text && rules(m).length > 0, m === text ? "mutation did not apply" : "");
}

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
