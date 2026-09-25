// Tiingo is called only by scheduled jobs (#553 COWORK #56, rule 1).
//
// check-tiingo-key-scope holds WHICH FILE reads the key. This holds WHO CAN
// REACH that file: if any page, component, visitor-facing route or middleware
// imports the adapter -- directly or through jobs.ts -- then a visitor's
// request, a bot, or a cache miss could spend the quota and the bandwidth.
//
// THE GRAPH, and nothing else may join it:
//   app/api/jobs/tiingo-quotes/route.ts ─┐
//   app/api/jobs/tiingo-eod/route.ts ────┴─> lib/server/marketData/jobs.ts ─> lib/server/marketData/tiingo.ts
//
// Any import form counts, `import type` included: a type import is erased
// today, and is one edit away from a value import that is not.
//
//   node scripts/check-tiingo-callers.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ADAPTER = "lib/server/marketData/tiingo";
const JOBS = "lib/server/marketData/jobs";
const ADAPTER_IMPORTERS = new Set(["lib/server/marketData/jobs.ts"]);
const JOBS_IMPORTERS = new Set(["app/api/jobs/tiingo-quotes/route.ts", "app/api/jobs/tiingo-eod/route.ts"]);
const ROOTS = ["app", "lib", "components", "hooks", "utils"];
const ROOT_FILES = ["middleware.ts", "instrumentation.ts", "instrumentation-client.ts", "next.config.ts", "next.config.mjs"];
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, out); }
    else if (EXT.test(e.name)) out.push(path.relative(ROOT, p));
  }
  return out;
}

/** Every module specifier in a file, resolved to a repo path without extension. */
function importsOf(rel, src) {
  const specs = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["'`]([^"'`]+)["'`]/g;
  let m;
  while ((m = re.exec(src))) specs.push(m[1]);
  return specs.map((s) => {
    let p = s.startsWith("@/") ? s.slice(2) : s.startsWith(".") ? path.join(path.dirname(rel), s) : null;
    if (!p) return null;
    p = path.normalize(p).split(path.sep).join("/").replace(EXT, "");
    return p.replace(/\/index$/, "");
  }).filter(Boolean);
}

function violations(files, read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8")) {
  const bad = [];
  for (const f of files) {
    const deps = importsOf(f, read(f));
    if (deps.includes(ADAPTER) && !ADAPTER_IMPORTERS.has(f)) bad.push(`${f} imports the adapter`);
    if (deps.includes(JOBS) && !JOBS_IMPORTERS.has(f)) bad.push(`${f} imports the Tiingo jobs`);
  }
  return bad;
}

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const files = [...ROOTS.flatMap((d) => walk(path.join(ROOT, d), [])), ...ROOT_FILES.filter((f) => fs.existsSync(path.join(ROOT, f)))];
const bad = violations(files);
check(`only jobs.ts imports the adapter, and only the two job routes import jobs.ts (${files.length} files)`, bad.length === 0, bad.join("; "));

// THE GRAPH MUST EXIST, or "no violations" is also what a renamed file returns.
for (const f of [...ADAPTER_IMPORTERS]) check(`${f} does import the adapter`, importsOf(f, fs.readFileSync(f, "utf8")).includes(ADAPTER));
for (const f of [...JOBS_IMPORTERS]) check(`${f} does import jobs.ts`, importsOf(f, fs.readFileSync(f, "utf8")).includes(JOBS));
check("read.ts (the Data Cache readers) does not import the adapter", !importsOf("lib/server/marketData/read.ts", fs.readFileSync("lib/server/marketData/read.ts", "utf8")).includes(ADAPTER));

// MUTANTS: each planted import must be caught, in every form a file could use.
const planted = {
  "app/stock/[symbol]/x.tsx": 'import { fetchIexQuotes } from "@/lib/server/marketData/tiingo";',
  "lib/server/marketData/read2.ts": 'import type { IexQuote } from "./tiingo";',
  "app/api/history/x.ts": 'const m = await import("../../../lib/server/marketData/jobs");',
  "middleware.ts": 'import { runTiingoQuotes } from "./lib/server/marketData/jobs.ts";',
  "lib/server/x.js": 'const t = require("./marketData/tiingo");',
};
for (const [f, src] of Object.entries(planted)) {
  check(`a planted import in ${f} is caught`, violations([f], () => src).length === 1);
}
check("...and an unrelated import is not flagged", violations(["app/x.ts"], () => 'import { a } from "@/lib/server/marketData/read";').length === 0);

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
