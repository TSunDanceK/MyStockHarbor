// Pre-check before adding generateStaticParams to any route.
//
// A route table showing "●" proves a route BECAME static. It says nothing about
// whether the route SURVIVES being static. #310 verified the former and shipped
// a 3.5-hour production outage: /insights/[slug] reached Redis through a client
// that did not pass PAGE_READ_CACHE, @upstash/redis defaults every REST call to
// cache: "no-store", and a no-store fetch on a prerendered route throws
// DYNAMIC_SERVER_USAGE at request time -- a 500, not a fallback to dynamic.
//
// This walks a route's TRANSITIVE import graph and reports every construct that
// would do that: Redis clients built without PAGE_READ_CACHE, and literal
// no-store fetches.
//
//   node scripts/check-static-safety.mjs "app/insights/[slug]/page.tsx"
//
// CLEAN here is necessary, not sufficient. The other half of the pre-check
// cannot be automated from a sandbox: request a real path on the PREVIEW
// deployment and confirm 200 with real content. A preview build never issues a
// runtime request to a prerendered dynamic path, so a green build and a correct
// route table are both fully consistent with every request 500ing.
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";
// Shared with check-page-read-cache.mjs. The two scripts ask opposite questions
// of the same graph and must not disagree about what an import resolves to.
import { ROOT, importsOf as imports } from "./lib/import-graph.mjs";

// Findings: a Redis client constructed without PAGE_READ_CACHE, or a literal
// no-store fetch. Both make a prerendered route throw DYNAMIC_SERVER_USAGE.
function findings(file) {
  const src = fs.readFileSync(file, "utf8");
  const hits = [];
  // A no-store call inside an unstable_cache callback never reaches the
  // renderer's dynamic detection. This flags the FILE, not the call site, so a
  // finding here still needs a human to confirm which side of the wrapper it is
  // on -- lib/youtube.ts is the worked example: bare client, three no-store
  // fetches, all of them reached only through two unstable_cache wrappers, so
  // all three are false positives.
  // Strip comments first. Testing the raw source matched the word
  // "unstable_cache" inside a comment that merely MENTIONED it, and reported a
  // module with no wrapper at all as possibly-insulated -- a grep finding the
  // comment rather than the code (claude/traps/grep-finds-the-comment-not-the-code.md).
  // Tokeniser-based and guarded -- see scripts/lib/source-code.mjs.
  const code = stripComments(src, { file, dropLines: true });
  const insulated = /unstable_cache/.test(code);
  src.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (/Redis\.fromEnv\s*\(/.test(code) && !/PAGE_READ_CACHE/.test(code)) hits.push([i + 1, "bare Redis.fromEnv()", line.trim()]);
    if (/cache\s*:\s*["']no-store["']/.test(code)) hits.push([i + 1, 'cache: "no-store"', line.trim()]);
  });
  return hits.map((h) => [...h, insulated]);
}

// A DEFAULT, BECAUSE A HARNESS THAT CRASHES ON BARE INVOCATION IS A HARNESS
// NOBODY RUNS. This one took a required argv path, so `node scripts/check-*.mjs`
// over the directory -- the only way anyone runs the suite -- hit a TypeError
// here and got skipped over as "broken" rather than read as a result.
const DEFAULT_ENTRIES = [
  "app/cache-health/page.tsx",
  "app/pickers/page.tsx",
  "app/page.tsx",
];
const requested = process.argv.slice(2);
const entries = (requested.length ? requested : DEFAULT_ENTRIES).filter((p) =>
  fs.existsSync(path.join(ROOT, p))
);
if (!entries.length) {
  console.error("check-static-safety: no entry file to trace. Pass one, e.g. app/cache-health/page.tsx");
  process.exit(1);
}
const entry = path.join(ROOT, entries[0]);
const seen = new Set(); const stack = [[entry, []]]; const report = [];
while (stack.length) {
  const [file, chain] = stack.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const f = findings(file);
  if (f.length) report.push({ file: path.relative(ROOT, file), chain: chain.map(c => path.relative(ROOT, c)), f });
  for (const dep of imports(file)) stack.push([dep, [...chain, file]]);
}
console.log(`entry: ${entries[0]}`);
console.log(`modules on the transitive read path: ${seen.size}`);
if (!report.length) console.log("  CLEAN -- no bare Redis client, no literal no-store fetch");
for (const r of report) {
  console.log(`\n  ${r.file}`);
  for (const [ln, kind, text, insulated] of r.f) {
    console.log(`    :${ln}  ${kind}  ${text.slice(0, 80)}`);
    if (insulated) console.log("           ^ file uses unstable_cache -- confirm by hand whether THIS call site is inside a wrapper");
  }
  if (r.chain.length) console.log(`    via: ${r.chain.slice(1).join(" -> ") || "(direct import)"}`);
}
