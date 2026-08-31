// Every Redis client a page can reach must pass PAGE_READ_CACHE.
//
// WHY THIS EXISTS, AND WHY IT EXISTS NOW. @upstash/redis defaults every REST
// call to cache: "no-store". A no-store fetch on a PRERENDERED route throws
// DYNAMIC_SERVER_USAGE at request time -- a 500 on every request, not a
// fallback to dynamic. #310 shipped that configuration and took production down
// for 3.5 hours.
//
// It has since been found by hand TWICE MORE: lib/youtube.ts in #383, and
// lib/server/newsStore.ts in #380 -- which shipped bare onto an already-
// prerendered route and sat in production until someone re-ran the scan. Both
// were caught by a person reading a grep. Nothing failed.
//
// THE EXEMPTIONS ARE DERIVED, NOT LISTED. A hand-maintained list of "these bare
// clients are fine" would be another declaration nothing checks -- and its
// entries would be exactly wrong the moment someone adds an importer, which is
// the one event that changes the answer. So instead this walks the real import
// graph and works out, per module, WHICH pages reach it. A bare client is
// exempt only while:
//
//   * no page reaches it at all (API route handlers and crons are not
//     prerendered, so a bare client there cannot throw), or
//   * every page that reaches it declares `export const dynamic =
//     "force-dynamic"` -- app/cache-health/page.tsx is the worked example, and
//     it documents at its own top that this is mandatory rather than a
//     preference.
//
// Add a normal page importing one of those modules, or drop force-dynamic from
// a page that reaches one, and the exemption stops holding on its own. That is
// the property a list cannot have.
//
//   node scripts/check-page-read-cache.mjs
import fs from "node:fs";
import path from "node:path";
import { ROOT, importsOf, routeEntryPoints } from "./lib/import-graph.mjs";
import { stripComments } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

// ---- every source file, and its imports, parsed once ------------------------
const adjacency = new Map();
function deps(file) {
  let d = adjacency.get(file);
  if (!d) {
    d = importsOf(file);
    adjacency.set(file, d);
  }
  return d;
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const allFiles = [...walkFiles(path.join(ROOT, "lib")), ...walkFiles(path.join(ROOT, "app"))];

// ---- where Redis clients are constructed ------------------------------------
// Comments are stripped first: several files DISCUSS bare clients at length --
// this one included -- and a grep that counted prose would report modules that
// construct nothing.
const constructions = [];
for (const file of allFiles) {
  const code = stripComments(fs.readFileSync(file, "utf8"), { file });
  for (const m of code.matchAll(/(?:Redis\.fromEnv|new Redis)\s*\(([^)]*)\)/g)) {
    const line = code.slice(0, m.index).split("\n").length;
    constructions.push({
      file,
      line,
      args: m[1],
      guarded: /PAGE_READ_CACHE/.test(m[1]),
    });
  }
}

// ---- which pages reach which module -----------------------------------------
const entries = routeEntryPoints();
const forceDynamic = new Set(
  entries.filter((e) =>
    /export const dynamic\s*=\s*["']force-dynamic["']/.test(fs.readFileSync(e, "utf8"))
  )
);

/** page -> every module it can reach */
const reachedBy = new Map(); // module -> Set<page>
for (const entry of entries) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const d of deps(f)) stack.push(d);
  }
  for (const mod of seen) {
    if (!reachedBy.has(mod)) reachedBy.set(mod, new Set());
    reachedBy.get(mod).add(entry);
  }
}

console.log(`\n=== Redis constructions: ${constructions.length} across ${new Set(constructions.map((c) => c.file)).size} modules ===\n`);

const violations = [];
const exempt = [];

for (const c of constructions) {
  const pages = [...(reachedBy.get(c.file) ?? [])];
  if (c.guarded) continue;

  const risky = pages.filter((p) => !forceDynamic.has(p));
  if (!pages.length) {
    exempt.push({ ...c, why: "no page reaches it (API route handler / cron only)" });
  } else if (!risky.length) {
    exempt.push({
      ...c,
      why: `reached only from force-dynamic routes (${pages.map(rel).join(", ")})`,
    });
  } else {
    violations.push({ ...c, risky });
  }
}

for (const e of exempt) {
  console.log(`  exempt  ${rel(e.file)}:${e.line} — ${e.why}`);
}

console.log("\n=== The rule ===\n");

check(
  "no bare Redis client is reachable from a prerenderable page",
  violations.length === 0,
  violations.length
    ? violations
        .map((v) => `${rel(v.file)}:${v.line} reached by ${v.risky.map(rel).join(", ")}`)
        .join(" | ")
    : "a no-store call on a prerendered route is a 500 at request time, not a fallback to dynamic"
);

check(
  "the exemptions are derived from the graph, not declared",
  true,
  `${exempt.length} bare client(s) exempt, each because of where it sits — adding a page importer withdraws the exemption without anyone editing a list`
);

// A guard on the guard: if the scan ever finds nothing, it passes vacuously.
check(
  "the scan actually found Redis constructions",
  constructions.length > 5,
  `an empty or near-empty scan passes every assertion above while proving nothing — found ${constructions.length}`
);
check(
  "the scan found the route entry points it reasons from",
  entries.length > 20,
  `reachability is what makes an exemption safe, so no entry points means every bare client looks unreachable — found ${entries.length}`
);

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
