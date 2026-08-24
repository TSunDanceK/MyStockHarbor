// Every claude/*.md path cited from code must exist in this repo.
//
// THE CITATION IS THE ARGUMENT. This tree does not repeat its reasoning at each
// call site; it points at a doc. "See claude/pickers-firewall-selfblock-
// 2026-07-17.md" is doing the work of a paragraph explaining why a route must
// not be guarded. A citation pointing at nothing reads as "the reasoning is
// recorded elsewhere" when it is not -- and someone who cannot find the doc has
// to choose between trusting a claim they cannot check and overriding a
// constraint they do not understand.
//
// That is not hypothetical. The most-cited document in this codebase -- 20 code
// files -- exists only in the Claude Project and was never mirrored here, while
// the entire stated purpose of the claude/ directory is that these are
// "readable from GitHub itself -- e.g. from a phone, without needing to open
// Claude" (CLAUDE.md). Its content materially changes what several of those 20
// call sites mean.
//
// A DATED ALLOWLIST, NOT A CLEAN PASS. 24 of 59 cited paths are missing today.
// A check that fails on all of them is a check someone disables; a check with no
// allowlist at all would have to be added as already-failing. So the backlog is
// listed here explicitly -- visible in the repo rather than in a chat, shrinking
// as docs are mirrored, and any NEW dangling citation fails immediately.
//
//   node scripts/check-doc-citations.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Missing as of 2026-08-24. Each is a doc that exists in the Claude Project and
// was never mirrored. Remove entries as they land; do not add without saying
// why in the commit.
const KNOWN_MISSING = new Set([
  "claude/pickers-firewall-selfblock-2026-07-17.md",
  "claude/seo-recovery-plan-2026-08-15.md",
  "claude/list-link-prefetch-disable-2026-07-21.md",
  "claude/stock-daily-rate-limit-2026-07-21.md",
  "claude/stock-page-earnings-selfblock-2026-07-21.md",
  "claude/header-nav-not-crawlable-2026-08-17.md",
  "claude/CLAUDE.md",
  "claude/firewall-bot-protection-audit-2026-07-19.md",
  "claude/universe-architecture-audit-2026-08-06.md",
  "claude/video-page-quote-selfblock-fix-2026-07-21.md",
  "claude/popular-searches-universe-spec-2026-07-23.md",
  "claude/health-check-firewall-indexing-analytics-2026-08-17.md",
  "claude/stock-page-consolidation.md",
  "claude/PICKERS_ACCORDION_REDESIGN.md",
  "claude/picker-columns-needed-2026-08-22.md",
  "claude/NEXT-SESSION-2026-08-18.md",
  "claude/all-stocks-full-universe-and-header-dropdown-2026-07-23.md",
  "claude/universe-megacap-preset-fix-2026-07-23.md",
  "claude/sector-news-plan-2026-08-07.md",
  "claude/picker-signals-and-news-bandwidth-2026-08-22.md",
  "claude/picker-pages-demand-data-2026-08-15.md",
  "claude/seo-recovery-progress-2026-08-17.md",
  "claude/firewall-allowed-bot-scraping-audit-2026-07-21.md",
  "claude/firewall-ja4-repeat-offenders-selfblock-2026-07-21.md",
]);

const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const PAT = /claude\/[A-Za-z0-9_\-./]+\.md/g;

const cited = new Map(); // path -> Set(citing files)
for (const rel of files) {
  let text;
  try {
    text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    continue;
  }
  for (const m of new Set(text.match(PAT) ?? [])) {
    if (!cited.has(m)) cited.set(m, new Set());
    cited.get(m).add(rel);
  }
}

const exists = (p) => fs.existsSync(path.join(ROOT, p));
const missing = [...cited].filter(([p]) => !exists(p));
const isCode = (f) => /\.(ts|tsx|mjs|js)$/.test(f);

console.log(`\n=== ${cited.size} cited claude/*.md paths, ${missing.length} missing ===\n`);

const unexpected = missing.filter(([p]) => !KNOWN_MISSING.has(p));
check(
  "no NEW dangling citation",
  unexpected.length === 0,
  unexpected.length
    ? unexpected.map(([p, srcs]) => `${p} (cited by ${[...srcs].join(", ")})`).join(" | ")
    : `${missing.length} known, all allowlisted`
);

// The allowlist must shrink, not rot. An entry for a doc that now exists is a
// stale exemption, and a stale exemption is how an allowlist stops meaning
// anything.
const staleAllowlist = [...KNOWN_MISSING].filter((p) => exists(p));
check(
  "the allowlist has no stale entries",
  staleAllowlist.length === 0,
  staleAllowlist.length ? `now present, remove from KNOWN_MISSING: ${staleAllowlist.join(", ")}` : "every entry is still genuinely missing"
);

// An allowlist entry nothing cites any more is also dead weight.
const uncited = [...KNOWN_MISSING].filter((p) => !cited.has(p));
check(
  "the allowlist has no orphans",
  uncited.length === 0,
  uncited.length ? `no longer cited, remove: ${uncited.join(", ")}` : "every entry is still cited"
);

console.log("\n=== The backlog, weighted by how much code leans on it ===\n");
const byWeight = missing
  .map(([p, srcs]) => [p, [...srcs].filter(isCode).length, srcs.size])
  .sort((a, b) => b[1] - a[1]);
for (const [p, code, total] of byWeight.slice(0, 8)) {
  console.log(`  ${String(code).padStart(2)} code file(s) of ${total}  ${p}`);
}
if (byWeight.length > 8) console.log(`  ... and ${byWeight.length - 8} more`);

const codeCited = missing.filter(([, srcs]) => [...srcs].some(isCode)).length;
console.log(`\n  ${codeCited} of ${missing.length} missing docs are cited FROM CODE, not just from other docs.`);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
