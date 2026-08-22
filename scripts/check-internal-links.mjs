// No internal link should point at a path next.config.ts redirects away from.
//
// WHY IT MATTERS HERE. This site is in SEO recovery. A 301 preserves most link
// equity but not all of it, costs the reader a hop, and — the part that actually
// bites — means the link's target has no page behind it at all. Nothing breaks;
// the redirect answers. It is invisible, permanent, and accumulates every time
// someone adds a link to a path they remember rather than the one that exists.
//
// Six such links existed when this was written, all pointing at the two
// divergence routes 301'd since that redirect landed. None of them were created
// by deleting those pages — every one had been hopping since the redirect
// shipped. The deletion only made them visible.
//
// GENERALISED ON PURPOSE. It reads the redirect table rather than naming the two
// paths, so a redirect added tomorrow is covered without anyone remembering to
// come back here.
//
//   node scripts/check-internal-links.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Sources of a redirect, from the config itself. Parameterised sources (:slug,
// wildcards) are skipped: a link matching one of those is not necessarily
// pointing at the redirect, and a false positive here would train people to
// ignore the check.
const config = fs.readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
const redirected = new Map();
const pairs = [...config.matchAll(/source:\s*"([^"]+)",\s*\n\s*destination:\s*"([^"]+)"/g)];
for (const [, source, destination] of pairs) {
  if (source.includes(":") || source.includes("*")) continue;
  redirected.set(source, destination);
}

check("the redirect table was parsed", redirected.size >= 5, `${redirected.size} literal redirects`);

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(e.name)) files.push(full);
  }
};
walk(path.join(ROOT, "app"));

// Comments stripped from EVERY file, not just the one being thought about --
// a prose mention of an old path is not a link, and counting it would make this
// check cry wolf until someone turns it off
// (claude/traps/a-regex-over-source-has-no-scope.md).
const codeOf = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");

const offenders = [];
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const code = codeOf(fs.readFileSync(file, "utf8"));
  for (const [source, destination] of redirected) {
    // href="/x" only. A bare string mention of the path is not a link, and
    // next.config.ts itself obviously names every source.
    const re = new RegExp(`href=["'\`]${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`, "g");
    const hits = (code.match(re) ?? []).length;
    if (hits) offenders.push({ rel, source, destination, hits });
  }
}

console.log("\n=== Internal links pointing at a redirected path ===\n");
check(
  "no file under app/ links to a path next.config.ts redirects away from",
  offenders.length === 0,
  offenders.map((o) => `${o.rel} -> ${o.source} (${o.hits}x, should be ${o.destination})`).join("; ")
);

// The check has to be able to SEE a link, or "none found" means nothing. Proven
// against a path that is deliberately still linked: /pickers is a redirect
// DESTINATION and is linked from many places, so a non-zero count there shows
// the walker and the regex are both live.
let sanity = 0;
for (const file of files) {
  sanity += (codeOf(fs.readFileSync(file, "utf8")).match(/href=["'`]\/pickers["'`]/g) ?? []).length;
}
check(
  "the walker and regex actually find links (sanity: /pickers)",
  sanity > 0,
  `${sanity} links to /pickers — a zero here would make the result above meaningless`
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
