// The FMP purge script (#553 COWORK #136), against a fake Redis. Never a real one.
//
// What must hold:
//   1. The plan covers B's keys (CODE-B #125) and A's list (CODE-A #147 on
//      #552), and never classifies a msh:tiingo: key or the quote-offset counter.
//   2. The dry run (the default) deletes and writes nothing and prints a count
//      per group, never a value.
//   3. --apply deletes the default groups only. The price-pool hash is never
//      deleted (its fields are the universe's fallback source); --pool-figures
//      nulls the FMP figures in its rows and keeps the fields. market:state,
//      the meters and FMP-era insight snapshots go only with their own flags;
//      Tiingo-path snapshots are never deleted.
//   4. An unknown argument stops the run before any Redis command.
// Each rule also gets a planted mutant.
//
//   node scripts/check-fmp-purge.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const PLAN = "scripts/lib/fmp-purge-plan.mjs";
const RUN = "scripts/fmp-purge.mjs";
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

let seq = 0;
const tmp = [];
async function load(planSrc, runSrc) {
  const tag = `${process.pid}-${seq++}`;
  const planFile = path.join(ROOT, "scripts", "lib", `.check-fp-plan-${tag}.mjs`);
  const runFile = path.join(ROOT, "scripts", `.check-fp-run-${tag}.mjs`);
  fs.writeFileSync(planFile, planSrc);
  fs.writeFileSync(runFile, runSrc.replace('"./lib/fmp-purge-plan.mjs"', JSON.stringify(`./lib/.check-fp-plan-${tag}.mjs`)));
  tmp.push(planFile, runFile);
  return { plan: await import(pathToFileURL(planFile).href), run: await import(pathToFileURL(runFile).href) };
}

const FMP_ROW = { price: 10, changePct: 1, volume: 5, open: 9, dayHigh: 11, dayLow: 8, marketCap: 1e9, pe: 20, ts: 1, peTs: 1, failStreak: 0, failAt: 0 };
function seed() {
  const kv = new Map([
    // B, default
    ["msh:pricepool:session-health:v1", "{}"],
    ["msh:pickers:fundamentals:v1:AAPL", "{}"],
    ["msh:pickers:screener-fundamentals:v1:AAPL", "{}"],
    ["msh:stockdata:v1:AAPL", "{}"],
    ["msh:history:v7:AAPL", "{}"],
    ["msh:history:newest-bar:v1", "{}"],
    ["msh:quote:v1:AAPL", "{}"],
    ["msh:benchmarks:stock", "{}"],
    ["msh:feed:ipo:all:fmp", "{}"],
    ["msh:feed:index:additions", "{}"],
    // A, default (CODE-A #147)
    ["msh:pickers:earnings:v1:AAPL", "{}"],
    ["msh:pickers:earnings:v1:queue", "{}"],
    ["msh:pickers:earnings:v1:due:AAPL", "1"],
    ["msh:pickers:earnings:v1:lock", "1"],
    ["msh:pickers:earnings:v1:enqueue-guard", "1"],
    ["msh:earnings-quoted-symbol:v1:AAPL", "1"],
    ["msh:earnings-day-items:v2:2026-10-01", "{}"],
    ["msh:earnings-day-complete:v4:2026-10-01", "1"],
    ["msh:reference:v1:earnings-calendar:2026-10", "{}"],
    ["msh:earnings-schedule:v1", "{}"],
    ["msh:earnings-quote-calls:v1:202610041200", "3"],
    ["msh:earnings-day-items:v1:2026-09-01", "{}"],
    ["msh:earnings-day-complete:v3:2026-09-01", "1"],
    ["msh:earnings-day-complete:v2:2026-09-01", "1"],
    // opt-in
    ["msh:market:state", "{}"],
    ["msh:fmp-bytes:v1:20261004", "{}"],
    ["msh:fmp-calls:v1:202610041200", "1"],
    ["insight-snapshot:vrt-june-19-2026", { symbol: "VRT", price: 100 }],
    ["insight-snapshot:abc-oct-1-2026", { source: "tiingo", symbol: "ABC", snapshotDate: "2026-10-01" }],
    // never
    ["msh:tiingo:eod:v2:AAPL", "[]"],
    ["msh:tiingo:universe:v1", "[]"],
    ["msh:pickers:quote-offset:v1", "12"],
    ["msh:pickers:sec-fundamentals:v1", "{}"],
    ["msh:sec:facts:v1:AAPL", "{}"],
  ]);
  const hash = new Map([["msh:price-pool:v1", new Map([["AAPL", { ...FMP_ROW }], ["MSFT", { ...FMP_ROW, price: null, changePct: null, volume: null, open: null, dayHigh: null, dayLow: null, marketCap: null, pe: null }]])]]);
  return { kv, hash };
}
function fakeRedis(state) {
  const calls = [];
  const keys = () => [...state.kv.keys(), ...state.hash.keys()];
  return {
    calls,
    async scan(cursor, opts) {
      calls.push(["scan"]);
      const all = keys();
      const start = Number(cursor);
      const n = Math.min(opts?.count ?? 10, 7); // small pages: the cursor loop must run
      const next = start + n >= all.length ? "0" : String(start + n);
      return [next, all.slice(start, start + n)];
    },
    async mget(...ks) { calls.push(["mget", ...ks]); return ks.map((k) => state.kv.get(k) ?? null); },
    async hgetall(k) { calls.push(["hgetall", k]); const h = state.hash.get(k); return h ? Object.fromEntries(h) : null; },
    async hset(k, obj) { calls.push(["hset", k]); const h = state.hash.get(k) ?? new Map(); for (const [f, v] of Object.entries(obj)) h.set(f, v); state.hash.set(k, h); return Object.keys(obj).length; },
    async del(...ks) { calls.push(["del", ...ks]); let n = 0; for (const k of ks) { if (state.kv.delete(k) || state.hash.delete(k)) n++; } return n; },
  };
}

const B_KEYS = ["msh:pricepool:session-health:v1", "msh:pickers:fundamentals:v1:AAPL", "msh:pickers:screener-fundamentals:v1:AAPL", "msh:stockdata:v1:AAPL", "msh:history:v7:AAPL", "msh:history:newest-bar:v1", "msh:quote:v1:AAPL", "msh:benchmarks:stock", "msh:feed:ipo:all:fmp", "msh:feed:index:additions"];
const A_KEYS = ["msh:pickers:earnings:v1:AAPL", "msh:pickers:earnings:v1:queue", "msh:pickers:earnings:v1:due:AAPL", "msh:pickers:earnings:v1:lock", "msh:pickers:earnings:v1:enqueue-guard", "msh:earnings-quoted-symbol:v1:AAPL", "msh:earnings-day-items:v2:2026-10-01", "msh:earnings-day-complete:v4:2026-10-01", "msh:reference:v1:earnings-calendar:2026-10", "msh:earnings-schedule:v1", "msh:earnings-quote-calls:v1:202610041200", "msh:earnings-day-items:v1:2026-09-01", "msh:earnings-day-complete:v3:2026-09-01", "msh:earnings-day-complete:v2:2026-09-01"];
const KEEP_ALWAYS = ["msh:tiingo:eod:v2:AAPL", "msh:tiingo:universe:v1", "msh:pickers:quote-offset:v1", "msh:pickers:sec-fundamentals:v1", "msh:sec:facts:v1:AAPL", "insight-snapshot:abc-oct-1-2026"];
const OPT = { "--market-state": ["msh:market:state"], "--meters": ["msh:fmp-bytes:v1:20261004", "msh:fmp-calls:v1:202610041200"], "--insight-snapshots": ["insight-snapshot:vrt-june-19-2026"] };

async function rules(M) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const { plan, run } = M;
  const run1 = async (argv) => {
    const state = seed();
    const r = fakeRedis(state);
    const out = [];
    const code = await run.purge(r, argv, (s) => out.push(s));
    return { state, r, out: out.join("\n"), code };
  };

  want("the plan covers B's keys and A's list as defaults", [...B_KEYS, ...A_KEYS].every((k) => plan.classify(k) && !plan.classify(k).flag));
  want("never a msh:tiingo: key, the quote-offset counter or a SEC key", KEEP_ALWAYS.slice(0, 5).every((k) => plan.classify(k) === null));

  const dry = await run1([]);
  const writes = dry.r.calls.filter(([c]) => c === "del" || c === "hset");
  want("the dry run deletes and writes nothing", dry.code === 0 && writes.length === 0 && dry.state.kv.size === seed().kv.size);
  want("the dry run prints a count per group and the total", /DRY RUN: would DEL 24 key\(s\)/.test(dry.out) && /msh:pickers:earnings:v1:\*/.test(dry.out) && /msh:history:newest-bar:v1  \[no TTL\]/.test(dry.out));
  want("no value is ever printed", !/"price"|VRT|10000|\{ ?symbol/.test(dry.out));
  want("the dry run counts FMP-era snapshots only", /\b1  B  insight-snapshot:\* .*of 2 snapshots/.test(dry.out));

  const app = await run1(["--apply"]);
  want("--apply deletes every default key", app.code === 0 && [...B_KEYS, ...A_KEYS].every((k) => !app.state.kv.has(k)));
  want("--apply alone keeps the opt-in keys and the never keys", [...Object.values(OPT).flat(), ...KEEP_ALWAYS].every((k) => app.state.kv.has(k)));
  want("the price-pool hash is never deleted, and its rows keep their figures without --pool-figures", app.state.hash.has("msh:price-pool:v1") && app.state.hash.get("msh:price-pool:v1").get("AAPL").price === 10);

  for (const [flag, ks] of Object.entries(OPT)) {
    const o = await run1(["--apply", flag]);
    want(`${flag} deletes its keys and nothing else opt-in`, ks.every((k) => !o.state.kv.has(k)) && Object.entries(OPT).filter(([f]) => f !== flag).flatMap(([, v]) => v).every((k) => o.state.kv.has(k)) && KEEP_ALWAYS.every((k) => o.state.kv.has(k)));
  }
  const pf = await run1(["--apply", "--pool-figures"]);
  const pool = pf.state.hash.get("msh:price-pool:v1");
  want("--pool-figures nulls the figures, keeps every field and its bookkeeping", !!pool && pool.has("AAPL") && pool.has("MSFT") && pool.get("AAPL").price === null && pool.get("AAPL").marketCap === null && pool.get("AAPL").ts === 1 && pf.r.calls.filter(([c, k]) => c === "del" && k === "msh:price-pool:v1").length === 0);
  const pfDry = await run1(["--pool-figures"]);
  want("--pool-figures without --apply writes nothing", pfDry.r.calls.every(([c]) => c !== "hset" && c !== "del") && pfDry.state.hash.get("msh:price-pool:v1").get("AAPL").price === 10);

  const bad = await run1(["--aply"]);
  want("an unknown argument stops before any Redis command", bad.code === 2 && bad.r.calls.length === 0);
  return fails;
}

try {
  const PLAN_SRC = raw(PLAN);
  const RUN_SRC = raw(RUN);
  console.log("\n=== The purge, on a fake Redis ===\n");
  const f = await rules(await load(PLAN_SRC, RUN_SRC));
  check("plan, dry run, apply, opt-ins, pool strip, never-keys", f.length === 0, f.join("; "));

  console.log("\n=== Mutants ===\n");
  const MUTANTS = [
    // The never-guard dropped while a group's prefix is widened to reach msh:tiingo:.
    ["plan", "a Tiingo key purged (guard dropped, a wide prefix)", (src) => src.replace(/\[\(k\) => k\.startsWith\("msh:tiingo:"\), /, "[").replace("export const DEFAULT_GROUPS = [", 'export const DEFAULT_GROUPS = [\n  { id: "eod", owner: "B", prefix: "msh:tiingo:eod" },')],
    ["plan", "A's earnings rows left out", /\s*\{ id: "pickers-earnings",[^\n]*\n/, "\n"],
    ["plan", "a B key left out (newest-bar)", /\s*\{ id: "history-newest-bar",[^\n]*\n/, "\n"],
    ["plan", "the pool hash deleted by default", /\{ id: "pool-figures", flag: "--pool-figures", /, '{ id: "pool-figures", '],
    ["plan", "market:state by default", /\{ id: "market-state", flag: "--market-state", /, '{ id: "market-state", '],
    ["plan", "Tiingo-path snapshots counted as FMP-era", /raw\.source !== "tiingo"/, "true"],
    ["plan", "the pool strip keeps a figure", /export const POOL_FIGURES = \["price", /, 'export const POOL_FIGURES = ['],
    ["run", "applies on a dry run", /const apply = args\.has\("--apply"\);/, "const apply = true;"],
    ["run", "opt-ins without their flag", /const optedIn = new Set\(OPT_IN_GROUPS\.filter\(\(g\) => args\.has\(g\.flag\)\)/, "const optedIn = new Set(OPT_IN_GROUPS.filter(() => true)"],
    ["run", "every snapshot deleted, Tiingo ones too", /toDelete\.push\(\.\.\.fmpSnaps\)/, "toDelete.push(...snapKeys)"],
    ["run", "unknown arguments ignored", /if \(unknown\.length\) \{/, "if (false) {"],
    ["run", "the SCAN loop stops after one page", /\} while \(cursor !== "0"\);\n    return byGroup;/, "} while (false);\n    return byGroup;"],
  ];
  for (const [which, label, from, to] of MUTANTS) {
    const base = which === "plan" ? PLAN_SRC : RUN_SRC;
    const m = typeof from === "function" ? from(base) : base.replace(from, to);
    if (m === base) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    let fails;
    try { fails = await rules(await load(which === "plan" ? m : PLAN_SRC, which === "run" ? m : RUN_SRC)); } catch (e) { fails = [`threw: ${e.message}`]; }
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
