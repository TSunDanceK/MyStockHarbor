// THE NEWS STORE NEVER CALLS after() (#553 COWORK #203, from #563 CODE-C #138).
//
// lib/server/newsStore.ts runs only inside the news pages' unstable_cache
// builders, and Next also runs those as a background refresh of a stale entry,
// after the response has closed. An after() registered there was held by a
// response that had already ended, so Vercel kept the function open until it
// killed it at 300 s (60-80 a day on the landing page's refills).
//
// What must hold (source, comments stripped):
//   1. newsStore.ts neither imports nor calls after().
//   2. Each of its three writes (writeStored + recordRefreshStats, and the
//      staleness mark in both wrappers) is AWAITED through boundedDeferred(...)()
//      with NEWS_DEFERRED_WRITE_BUDGET_MS -- bounded, and not a dropped promise.
//   3. Its two refreshing entry points are called only from the two news data
//      modules, and there only from a builder that unstable_cache wraps.
// Every rule has a planted mutant.
//
//   node scripts/check-news-store-no-after.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const STORE = "lib/server/newsStore.ts";
const STOCK = "lib/stock-news-data.ts";
const SECTOR = "lib/sector-news-data.ts";
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(rel, out); }
    else if (/\.(tsx?|mjs)$/.test(e.name)) out.push(rel);
  }
  return out;
}

function rules(srcs) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const code = (f) => stripComments(srcs[f], { file: f });
  const store = code(STORE);
  want("newsStore.ts does not import after()", !/import\s*\{[^}]*\bafter\b[^}]*\}\s*from\s*"next\/server"/.test(store));
  want("newsStore.ts does not call after()", !/\bafter\(/.test(store));
  want("the store write and counters are awaited, bounded",
    /await boundedDeferred\("news-store", key, async \(\) => \{\s*await writeStored\(key, kept, nowMs\);\s*await recordRefreshStats\(mode, added, nowMs, byProvider\);\s*\}, NEWS_DEFERRED_WRITE_BUDGET_MS\)\(\);/.test(store));
  want("the symbol staleness mark is awaited, bounded",
    /if \(result\.mode !== "cached"\) await boundedDeferred\("news-store", upper, \(\) => markViewed\("news", upper, nowMs\), NEWS_DEFERRED_WRITE_BUDGET_MS\)\(\);/.test(store));
  want("the sector staleness mark is awaited, bounded",
    /if \(result\.mode !== "cached"\) await boundedDeferred\("news-store", lower, \(\) => markViewed\("sectorNews", lower, nowMs\), NEWS_DEFERRED_WRITE_BUDGET_MS\)\(\);/.test(store));
  // 3. who calls the refreshing entry points
  const callers = Object.keys(srcs).filter((f) => f !== STORE && /\breadOrRefresh(Symbol|Sector)News\b/.test(code(f)));
  want(`only the two news data modules refresh the store (${callers.join(", ")})`, callers.length === 2 && callers.includes(STOCK) && callers.includes(SECTOR));
  want("the stock news builder runs under unstable_cache",
    /const getCachedStockNewsBaseData = unstable_cache\(\s*async \([^)]*\) => \{[\s\S]*?return buildStockNewsBaseData\(/.test(code(STOCK)));
  want("the sector news builder runs under unstable_cache",
    /const getCachedSectorNewsBaseData = unstable_cache\(\s*async \([^)]*\) => \{[\s\S]*?return buildSectorNewsBaseData\(/.test(code(SECTOR)));
  return fails;
}

const files = [...walk("app"), ...walk("lib")];
const srcs = Object.fromEntries(files.map((f) => [f, read(f)]));
const real = rules(srcs);
for (const f of real) check(f, false);
check("the news store never calls after() and awaits its bounded writes", real.length === 0);

const MUTANTS = [
  ["after() back on the store write", STORE, /await (boundedDeferred\("news-store", key, async \(\) => \{[\s\S]*?\}, NEWS_DEFERRED_WRITE_BUDGET_MS\))\(\);/, 'after($1);'],
  ["the import back", STORE, /import \{ Redis \} from "@upstash\/redis";/, 'import { after } from "next/server";\nimport { Redis } from "@upstash/redis";'],
  ["the write left as a dropped promise", STORE, /await (boundedDeferred\("news-store", key, )/, "void $1"],
  ["the write unbounded", STORE, /await boundedDeferred\("news-store", key, (async \(\) => \{[\s\S]*?\}), NEWS_DEFERRED_WRITE_BUDGET_MS\)\(\);/, "await ($1)();"],
  ["the symbol mark through after()", STORE, /await (boundedDeferred\("news-store", upper, [^\n]*NEWS_DEFERRED_WRITE_BUDGET_MS\))\(\);/, "after($1);"],
  ["the sector mark dropped", STORE, /await (boundedDeferred\("news-store", lower, )/, "void $1"],
  ["a third caller outside the cached builders", "app/headlines/page.tsx", /$/, '\nimport { readOrRefreshSymbolNews } from "@/lib/server/newsStore";\nvoid readOrRefreshSymbolNews;\n'],
];
for (const [label, file, from, to] of MUTANTS) {
  const src = srcs[file];
  if (src === undefined) { check(`mutant "${label}" applies`, false, `${file} not found`); continue; }
  const m = src.replace(from, to);
  if (m === src) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const f = rules({ ...srcs, [file]: m });
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
