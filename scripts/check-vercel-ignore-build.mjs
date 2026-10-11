// THE VERCEL IGNORED BUILD STEP (#553 COWORK #164).
//
// Runs scripts/vercel-ignore-build.sh (exit 0 = skip, 1 = build) against fake
// Vercel env and real throwaway git repos:
//   - production always builds, whatever the branch, message or diff;
//   - relay/*, mockup/*, claude/*-census, claude/*-study, claude/*-mockup skip;
//   - [skip preview] in the commit SUBJECT skips; in the body only, it builds
//     (#791's own first push was skipped that way, COWORK #166);
//   - a diff of only reports/, claude/, docs/ or *.md skips; any other file
//     (scripts/ included) builds;
//   - a diff that cannot be computed (no previous commit, bad SHA) or is
//     empty (a redeploy of the same commit) builds;
//   - vercel.json wires the script as the ignoreCommand.
// Every rule has a planted mutant.
//
//   node scripts/check-vercel-ignore-build.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

const ROOT = process.cwd();
const SCRIPT = "scripts/vercel-ignore-build.sh";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vib-"));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).toString().trim();
let repoSeq = 0;
/** A repo whose last commit changes `files`; returns its dir and the previous SHA. */
function repo(files, { firstOnly = false } = {}) {
  const dir = path.join(tmpRoot, `r${repoSeq++}`);
  fs.mkdirSync(dir);
  git(dir, "init", "-q");
  fs.writeFileSync(path.join(dir, "base.txt"), "base");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  const prev = git(dir, "rev-parse", "HEAD");
  if (firstOnly) return { dir, prev: "" };
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), "x");
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "change");
  return { dir, prev };
}

function run(scriptSrc, env, cwd) {
  const f = path.join(tmpRoot, `s${repoSeq++}.sh`);
  fs.writeFileSync(f, scriptSrc);
  const r = spawnSync("bash", [f], { cwd, env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "").trim() };
}

function rules(src) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const code = repo(["app/page.tsx"]);
  const docs = repo(["claude/notes.txt", "reports/x.json", "docs/a.txt", "README.md"]);
  const scripts = repo(["scripts/check-x.mjs"]);
  const mixed = repo(["claude/notes.txt", "lib/x.ts"]);
  const first = repo([], { firstOnly: true });
  const env = (o) => ({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "claude/feature", VERCEL_GIT_COMMIT_MESSAGE: "a change", ...o });
  const is = (r, code) => r.code === code && /^vercel-ignore-build: (SKIP|BUILD) — /.test(r.out);
  // Production.
  want("production builds even on a read-only branch with docs only and [skip preview]",
    is(run(src, env({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "relay/census", VERCEL_GIT_COMMIT_MESSAGE: "x [skip preview]", VERCEL_GIT_PREVIOUS_SHA: docs.prev }), docs.dir), 1));
  // Branches.
  for (const ref of ["relay/sec-census", "mockup/pickers-icons", "claude/dividend-census", "claude/stretch-study", "claude/pickers-icons-mockup"]) {
    want(`${ref} skips`, is(run(src, env({ VERCEL_GIT_COMMIT_REF: ref, VERCEL_GIT_PREVIOUS_SHA: code.prev }), code.dir), 0));
  }
  for (const ref of ["claude/kind-albattani-lxnf2p-charts", "claude/census", "insight/vrt-june-19-2026", "main"]) {
    want(`${ref} with code changes builds`, is(run(src, env({ VERCEL_GIT_COMMIT_REF: ref, VERCEL_GIT_PREVIOUS_SHA: code.prev }), code.dir), 1));
  }
  // Message.
  want("[skip preview] skips", is(run(src, env({ VERCEL_GIT_COMMIT_MESSAGE: "copy tweak [skip preview]", VERCEL_GIT_PREVIOUS_SHA: code.prev }), code.dir), 0));
  // #553 COWORK #166: #791's own preview was skipped because its commit BODY
  // described the rule. A body that mentions the token builds; only the subject counts.
  want("[skip preview] only in the commit body builds", is(run(src, env({ VERCEL_GIT_COMMIT_MESSAGE: "Vercel: an ignored build step\n\nSkips: a commit message with [skip preview] in it.", VERCEL_GIT_PREVIOUS_SHA: scripts.prev }), scripts.dir), 1));
  want("a normal PR branch touching scripts/ builds", is(run(src, env({ VERCEL_GIT_COMMIT_REF: "claude/kind-albattani-lxnf2p-ignore", VERCEL_GIT_COMMIT_MESSAGE: "Vercel: ignored build step", VERCEL_GIT_PREVIOUS_SHA: scripts.prev }), scripts.dir), 1));
  // Diffs.
  want("docs-only (reports/, claude/, docs/, *.md) skips", is(run(src, env({ VERCEL_GIT_PREVIOUS_SHA: docs.prev }), docs.dir), 0));
  want("scripts/ changes build", is(run(src, env({ VERCEL_GIT_PREVIOUS_SHA: scripts.prev }), scripts.dir), 1));
  want("docs plus code builds", is(run(src, env({ VERCEL_GIT_PREVIOUS_SHA: mixed.prev }), mixed.dir), 1));
  want("no previous SHA falls back to HEAD^ (docs-only still skips)", is(run(src, env({}), docs.dir), 0));
  want("a diff that cannot be computed builds (first commit, no HEAD^)", is(run(src, env({}), first.dir), 1));
  want("an empty diff (previous SHA is HEAD, e.g. a redeploy) builds", is(run(src, env({ VERCEL_GIT_PREVIOUS_SHA: git(docs.dir, "rev-parse", "HEAD") }), docs.dir), 1));
  want("an unknown previous SHA builds", is(run(src, env({ VERCEL_GIT_PREVIOUS_SHA: "0123456789abcdef0123456789abcdef01234567" }), docs.dir), 1));
  return fails;
}

try {
  const src = read(SCRIPT);
  console.log("\n1. The script, against fake env and real diffs");
  const r = rules(src);
  check("production builds; read-only branches, [skip preview] and docs-only skip; unknown builds", r.length === 0, r.join("; "));
  console.log("\n2. Wiring");
  const vj = JSON.parse(read("vercel.json"));
  check("vercel.json runs it as the ignoreCommand", vj.ignoreCommand === "bash scripts/vercel-ignore-build.sh");

  console.log("\n3. Planted mutants");
  const M = [
    ["production may skip", '  build "production always builds"\n', "  :\n"],
    ["relay/* no longer skips", '  relay/*) skip "read-only relay branch ($ref)" ;;\n', ""],
    ["mockup/* no longer skips", '  mockup/*) skip "mock-up branch ($ref)" ;;\n', ""],
    ["the census/study/mockup pattern widened to every claude/ branch", "^claude/.+-(census|study|mockup)$", "^claude/"],
    ["[skip preview] ignored", '  skip "commit subject says [skip preview]"', '  :'],
    ["[skip preview] matched anywhere in the message (the #791 bug)", 'subject="${subject%%$\'\\n\'*}"\n', ""],
    ["scripts/ treated as docs", "    reports/*|claude/*|docs/*|*.md) ;;", "    reports/*|claude/*|docs/*|scripts/*|*.md) ;;"],
    ["an uncomputable diff skips", '  build "diff since $base could not be computed"', '  skip "diff since $base could not be computed"'],
    ["an empty diff skips", '  build "no changed files found since $base"', '  skip "no changed files found since $base"'],
  ];
  for (const [label, from, to] of M) {
    if (!src.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const f = rules(src.replace(from, to));
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
