// No key, no history lock (#553 COWORK #146): lib/server/historyCache.ts
// getDailyHistoryInner.
//
// With FMP_API_KEY unset, a cache miss can only end in fetchAndCacheDailyHistory
// throwing `no-api-key`, so that same error is thrown BEFORE the history lock is
// taken, and a read never polls waitForHistoryCache for 12 s behind a winner that
// cannot fetch either. Throwing, not returning empty, keeps every caller's
// behaviour as it was. Order matters, so the rules are about order: after the
// cache read, before the lock. Each rule gets a planted mutant.
//
//   node scripts/check-history-nokey-lock.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const FILE = "lib/server/historyCache.ts";
const rawSrc = fs.readFileSync(path.join(process.cwd(), FILE), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

function innerBody(src) {
  const at = src.indexOf("async function getDailyHistoryInner(");
  if (at < 0) return "";
  const open = src.indexOf("{", src.indexOf(")", at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return "";
}

function rules(raw) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const body = innerBody(stripComments(raw, { file: FILE }));
  want("getDailyHistoryInner was found", body.length > 0);
  const guard = body.search(/if \(!process\.env\.FMP_API_KEY\) \{\s*throw new FmpHistoryError\("Missing FMP_API_KEY environment variable", "no-api-key"\);\s*\}/);
  const read = body.search(/await readHistoryEntry\(normalized, caller\)/);
  const lock = body.search(/await acquireHistoryLock\(normalized\)/);
  const wait = body.search(/await waitForHistoryCache\(normalized\)/);
  want("a read with no key throws the fetch's own no-api-key error", guard >= 0);
  want("...after the cache read, so a cached series is still served", read >= 0 && guard > read);
  want("...before the history lock is taken", lock >= 0 && guard < lock);
  want("...and so before the 12 s wait", wait >= 0 && guard < wait);
  want("exactly one such return", (body.match(/process\.env\.FMP_API_KEY/g) ?? []).length === 1);
  return fails;
}

console.log("\n1. The real historyCache.ts");
const real = rules(rawSrc);
check("the real getDailyHistoryInner passes every rule", real.length === 0, real.join("; "));

console.log("\n2. Planted mutants");
const GUARD = '  if (!process.env.FMP_API_KEY) {\n    throw new FmpHistoryError("Missing FMP_API_KEY environment variable", "no-api-key");\n  }\n';
const MUTANTS = [
  ["the no-key return removed", (s) => s.replace(GUARD, "")],
  ["an empty return instead of the error", (s) => s.replace(GUARD, "  if (!process.env.FMP_API_KEY) return [] as Point[];\n")],
  ["the no-key return moved after the lock", (s) => s.replace(GUARD, "").replace("  const lockToken = await acquireHistoryLock(normalized);\n", "  const lockToken = await acquireHistoryLock(normalized);\n" + GUARD)],
  ["the no-key return moved before the cache read", (s) => s.replace(GUARD, "").replace("  const cached = force ? null : await readHistoryEntry(normalized, caller);\n", GUARD + "  const cached = force ? null : await readHistoryEntry(normalized, caller);\n")],
];
for (const [label, mutate] of MUTANTS) {
  const m = mutate(rawSrc);
  if (m === rawSrc) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = rules(m);
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no rule failed");
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
