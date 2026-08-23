// Did today's commits ship what their messages say they shipped?
//
// WHY THIS EXISTS. Two commits this week carried messages describing fixes their
// trees did not contain -- #362's `threwWithCache` wrap and #363's
// trailing-comment collection -- both lost to a `git checkout --` during
// calibration, before the commit. Both were harness fixes: bad, but bounded. The
// question that mattered was whether the same reflex had lost a PRODUCTION fix,
// because that would mean something recorded as fixed was still broken.
//
// A NOTE ON WHAT CAN AND CANNOT HAPPEN. Git cannot lose a committed change
// silently: every removal is itself a commit. So there are exactly two places a
// claimed fix can hide, and this tool checks both.
//
//   claims  — a commit's message names a symbol its own TREE does not contain.
//             That is the threwWithCache signature: the fix existed in a working
//             tree, was reverted, and only the prose survived.
//
//   reverts — a symbol declared in lib/ or app/ during the window is absent from
//             HEAD, meaning some later commit removed it. Deliberate refactors
//             show up here too, so the output is a shortlist to read, not a
//             verdict.
//
// TREE, NOT DIFF, for `claims`. A squash merge collapses within-branch churn, so
// a symbol a branch added and then retired appears in the message and in no diff
// on main. `newsBackfillDepth` is exactly that, and reading the diff would call
// it a false claim.
//
// THIS IS NOT A SUITE CHECK, deliberately. Both modes produce shortlists that
// need a human to classify -- a doc filename, a deliberate deletion, a symbol
// referenced rather than introduced. Wiring it into check-all.mjs would mean
// maintaining an allowlist of benign cases, and an allowlist that rots is how a
// check stops meaning anything.
//
//   node scripts/audit-claims.mjs [--since "2026-08-22 00:00"] [--mode claims|reverts|both]
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const since = arg("--since", "2026-08-22 00:00");
const mode = arg("--mode", "both");

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const shas = git("log", `--since=${since}`, "--pretty=%H").trim().split("\n").filter(Boolean);
if (!shas.length) {
  console.log(`no commits since ${since}`);
  process.exit(0);
}

const inTreeAt = (sym, ref, paths = ["*.ts", "*.tsx", "*.mjs", "*.json", "*.md"]) => {
  try {
    git("grep", "-l", "--fixed-strings", "-e", sym, ref, "--", ...paths);
    return true;
  } catch {
    return false;
  }
};

// Prose that parses as an identifier. Kept short on purpose: a long list is a
// list nobody prunes, and a false positive here costs one line of reading.
const IGNORE = new Set([
  "MyStockHarbor", "GitHub", "JavaScript", "TypeScript", "README", "CLAUDE",
  "StockHarbor", "noEmit", "dashboardGb", "workflow_dispatch",
]);

function symbolsIn(msg) {
  const out = new Set();
  const add = (raw) => {
    const t = raw.replace(/[`()]/g, "").trim();
    if (t.length < 6 || IGNORE.has(t)) return;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)) return;
    if (!/[A-Z_]/.test(t.slice(1))) return; // needs an internal capital or underscore
    out.add(t);
  };
  for (const m of msg.matchAll(/`([^`\n]{2,60})`/g)) for (const t of m[1].split(/[\s,/]+/)) add(t);
  for (const m of msg.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\(/g)) add(m[1]);
  for (const m of msg.matchAll(/\b[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]{2,}\b/g)) add(m[0]);
  for (const m of msg.matchAll(/\b[A-Z][A-Z0-9]{3,}(?:_[A-Z0-9]+)+\b/g)) add(m[0]);
  return [...out];
}

if (mode === "claims" || mode === "both") {
  console.log(`\n=== CLAIMS: symbols a message names that its own tree lacks (${shas.length} commits) ===\n`);
  let flagged = 0;
  for (const sha of shas) {
    const msg = git("log", "-1", "--pretty=%B", sha);
    const missing = symbolsIn(msg).filter((s) => !inTreeAt(s, sha));
    if (!missing.length) continue;
    flagged++;
    console.log(`${sha.slice(0, 8)}  ${msg.split("\n")[0]}`);
    for (const s of missing) {
      const ever = git("log", "-S", s, "--oneline", "--all").trim().split("\n").filter(Boolean).length;
      console.log(
        `    ${s.padEnd(30)} on main: ${inTreeAt(s, "HEAD") ? "yes" : "NO "}   commits mentioning it anywhere: ${ever}`
      );
    }
  }
  console.log(`\n${flagged} of ${shas.length} commits flagged. Zero means every named symbol shipped.`);
  console.log("A flag is not a fault: read each one. Benign shapes are a doc filename, a symbol the");
  console.log("message deliberately says was DELETED, and one a branch added then retired before squash.\n");
}

if (mode === "reverts" || mode === "both") {
  console.log(`=== REVERTS: symbols declared in lib/ or app/ during the window, absent from HEAD ===\n`);
  const PROD = /^\+\+\+ b\/((?:lib|app)\/.*\.(?:ts|tsx))$/;
  const added = new Map();
  for (const sha of [...shas].reverse()) {
    let inProd = false;
    for (const line of git("show", "--format=", sha).split("\n")) {
      const m = PROD.exec(line);
      if (line.startsWith("+++ ")) { inProd = Boolean(m); continue; }
      if (!inProd || !line.startsWith("+") || line.startsWith("+++")) continue;
      // DECLARATIONS ONLY. A symbol merely referenced on an added line does not
      // belong to this commit, and counting references would drown the signal.
      for (const d of line.matchAll(
        /\b(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]{5,})\b/g
      )) {
        if (!added.has(d[1])) added.set(d[1], sha.slice(0, 8));
      }
    }
  }
  const gone = [...added].filter(([s]) => !inTreeAt(s, "HEAD", ["lib", "app", "scripts"]));
  console.log(`${added.size} symbols declared; ${gone.length} absent from main today.\n`);
  for (const [sym, sha] of gone) {
    console.log(`  ${sym.padEnd(32)} added ${sha}`);
    for (const r of git("log", "-S", sym, "--oneline").trim().split("\n").filter(Boolean).slice(0, 2)) {
      console.log(`      ${r}`);
    }
  }
  console.log(gone.length ? "\nRead each: a deliberate refactor looks the same as a lost fix from here.\n" : "");
}
