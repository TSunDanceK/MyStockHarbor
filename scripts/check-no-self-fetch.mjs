// No server-side code may fetch our own origin over HTTP.
//
// WHY THIS IS A STANDING CHECK AND NOT A ONE-OFF CLEANUP. A page fetching its
// own API works perfectly in every environment until something sits between the
// two, and then it fails as a production outage rather than as a test failure.
// It has happened here: a Vercel Firewall rule ("Deny node User-Agent on /api/")
// added during an unrelated rate-limit incident blocked the site's own SSR
// self-fetches, because Node's built-in fetch sends `User-Agent: node`
// (claude/pickers-firewall-selfblock-2026-07-17.md -- which is NOT in this repo;
// see check-doc-citations.mjs).
//
// It also blocks a security step. That doc's next action is a per-IP rate limit
// on /api/* (~20-30/10s), recorded as "now safe post in-process fix" and still
// undone -- and it CANNOT be done safely while any page self-fetches from
// Vercel's shared egress IP, because the site would throttle itself. Every
// self-fetch reintroduced here pushes that back out of reach.
//
//   node scripts/check-no-self-fetch.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const files = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

// COMMENTS STRIPPED, because the tree is full of comments correctly DESCRIBING
// the self-fetches that were removed. Matching those would make this check fire
// on its own documentation -- grep-finds-the-comment-not-the-code, in the script
// written to prevent the thing the comments are about.
const OWN_ORIGIN = [
  /fetch\(\s*`\$\{base\}\/api\//,
  /fetch\(\s*`\$\{origin\}\/api\//,
  /fetch\(\s*`\$\{SITE_ORIGIN\}\/api\//,
  /fetch\(\s*`https:\/\/www\.mystockharbor\.com\/api\//,
  /fetch\(\s*`\$\{process\.env\.NEXT_PUBLIC_SITE_URL[^`]*\}\/api\//,
];

const offenders = [];
let serverFiles = 0;
for (const rel of files) {
  const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
  // A client component's fetch runs in the BROWSER and carries the real
  // headers. Those are fine and are the reason /api/pickers still cannot be
  // BotID-guarded without checking them.
  if (/^\s*["']use client["']/.test(raw.split("\n")[0] ?? "")) continue;
  serverFiles++;
  const code = stripComments(raw, { file: rel });
  for (const re of OWN_ORIGIN) {
    const m = re.exec(code);
    if (m) offenders.push(`${rel}: ${m[0]}`);
  }
}

console.log("\n=== No server-side self-fetch of our own origin ===\n");
check("the sweep actually looked at the tree", serverFiles > 100, `${serverFiles} server-side files`);
check(
  "no server-side self-fetch",
  offenders.length === 0,
  offenders.length ? offenders.join(" | ") : "the last one (app/pickers/page.tsx) went in-process 2026-08-24"
);

// A NEGATIVE ASSERTION NEEDS A POSITIVE CONTROL. "No matches" is what a broken
// regex returns too, so prove the patterns still match the shape they are for.
const FIXTURE = 'const r = await fetch(`${base}/api/pickers`, { next: { revalidate: 300 } });';
check(
  "the patterns still match a real self-fetch",
  OWN_ORIGIN.some((re) => re.test(FIXTURE)),
  "otherwise 'no matches' would mean 'the regex broke'"
);

console.log("\n=== The pages read their payload in-process instead ===\n");
for (const [rel, fn] of [
  ["app/pickers/page.tsx", "getPickersData"],
  ["app/plays/page.tsx", "getPlaysData"],
  ["app/components/PickerResultPage.tsx", "getPickersData"],
]) {
  const code = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"), { file: rel });
  check(`${rel} calls ${fn}()`, new RegExp(`\\b${fn}\\(`).test(code));
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
