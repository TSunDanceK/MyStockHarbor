// DRY RUN (audit r6): every stored set, the filing job as main ships it beside
// this branch's, on the same SEC responses. Reads only: nothing is written.
//
// For each filer the branch's job would act on (behind its newest filing, or
// missing a quarter a 10-Q filed), both jobs run; the set main would leave live
// is compared cell by cell with the branch's. A cell the branch changes is
// attributed to the FILINGS when the companyfacts-only read gives something
// else, and to DRIFT (code or feed changes since the set was written, which
// any re-read would bring) when it gives the same.
//   SYMBOLS="SHARD i/n"  or  "NAMES:NEE,SO"    relay task: write-multi-filing-fill-dry-run
// SEC at 400 ms spacing per shard (4 shards: 10 a second at most).
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { Redis } from "@upstash/redis";

const arg = String(process.env.SYMBOLS || "SHARD 0/1");
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (+https://www.mystockharbor.com; filing fill dry run)";
execSync("git fetch --depth=1 origin main", { stdio: "ignore" });
const MAIN_JOB = `lib/server/.dryrun-main-secFilingJob-${process.pid}.ts`;
fs.writeFileSync(MAIN_JOB, execSync("git show FETCH_HEAD:lib/server/secFilingJob.ts", { encoding: "utf8" }));
let OLD, NEW;
try {
  OLD = await import(`../${MAIN_JOB}`);
  NEW = await import("../lib/server/secFilingJob.ts");
} finally { fs.rmSync(MAIN_JOB, { force: true }); }
const Fill = await import("../lib/server/secFilingFill.ts");
const Build = await import("../lib/server/secFactBuild.ts");
const Codec = await import("../lib/server/secFactCodec.ts");
const { extractForSymbol } = await import("../lib/server/secExtractFor.ts");
const { withPredecessorFacts } = await import("../lib/server/secSuccession.ts");
const { defaultSources } = await import("../lib/server/fxRates.ts");
const { SEC_FIELD_KEYS } = await import("../lib/server/secFields.ts");

const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const MANIFEST = keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const STATE = keyOf("lib/server/secFilingJob.ts", "FILING_STATE_KEY");
const redis = Redis.fromEnv();
const manifest = await redis.get(MANIFEST);
const filingState = (await redis.hgetall(STATE)) ?? {};
let all = Object.entries(manifest.symbols).filter(([, e]) => e.cik && e.contentHash !== null).map(([s]) => s).sort();
const shard = arg.match(/SHARD\s+(\d+)\s*\/\s*(\d+)/i);
const named = arg.startsWith("NAMES:") ? arg.slice(6).split(",").filter(Boolean) : null;
if (named) all = named;
else if (shard) all = all.filter((_, i) => i % Number(shard[2]) === Number(shard[1]));

// One paced gate for every SEC request, cached so both jobs see the same bytes.
let lastAt = 0, requests = 0;
const cache = new Map();
const secGet = async (url) => {
  if (cache.has(url)) return cache.get(url);
  const wait = Math.max(0, lastAt + 400 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  requests++;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  const body = { status: res.status, type: res.headers.get("content-type") ?? "", text: await res.text() };
  cache.set(url, body);
  return body;
};
const asResponse = (b) => new Response(b.text, { status: b.status, headers: { "content-type": b.type } });
const json = async (url) => {
  const b = await secGet(url);
  if (b.status !== 200) throw Object.assign(new Error(`HTTP ${b.status}`), { name: b.status === 404 && /companyfacts/.test(url) ? "NoXbrlFacts" : "Error" });
  return JSON.parse(b.text);
};
const fetchers = {
  submissions: (cik) => json(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`),
  companyFacts: (cik) => json(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`),
  instance: async (cik, f) => {
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accn.replace(/-/g, "")}`;
    const idx = JSON.parse((await secGet(`${base}/index.json`)).text);
    const items = idx.directory?.item ?? [];
    const name = Fill.pickInstanceName(items.map((i) => String(i.name ?? "")));
    if (!name) return null;
    if (Number(items.find((i) => i.name === name)?.size ?? 0) > Fill.FILING_INSTANCE_MAX_BYTES) return null;
    const b = await secGet(`${base}/${name}`);
    return b.status === 200 && !b.type.includes("html") ? b.text : null;
  },
  get: async (url) => asResponse(await secGet(url)),
};

const label = (p) => (p.fp && p.fy ? (p.fp === "FY" ? `FY${p.fy}` : `${p.fp} FY${p.fy}`) : p.e);
const writes = (o) => o && (o.kind === "caught-up" || o.kind === "filled" || o.kind === "notice");
const byEnd = (set) => new Map([...set.quarters.map((p) => [`Q|${p.e}`, p]), ...set.years.map((p) => [`Y|${p.e}`, p])]);
const fmt = (v) => (v === null || v === undefined ? "—" : Math.abs(v) >= 1e5 ? `${(v / 1e6).toFixed(1)}M` : String(v));

const totals = { read: 0, acted: 0, filers: 0, filled: 0, changed: 0, blanked: 0, drift: 0, skippedFx: 0, failed: 0 };
const fillers = [];
const WATCH = new Set(["NEE", "CNP", "D", "DLR", "FRT", "HIW", "LNT", "MAA", "OMF", "PLD", "UE", "CUBE", "TXNM", "C", "SO", "DUK", "EIX", "DOW", "URI", "IDA"]);
const watched = [];
for (let i = 0; i < all.length; i += 25) {
  const chunk = all.slice(i, i + 25);
  const sets = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
  for (let j = 0; j < chunk.length; j++) {
    const symbol = chunk[j], stored = sets[j], cik = manifest.symbols[symbol]?.cik;
    if (!stored || !cik) continue;
    totals.read++;
    if (stored.cur && stored.cur !== "USD") { totals.skippedFx++; continue; }
    try {
      const subs = await fetchers.submissions(cik);
      const filings = Fill.periodicFilings(subs);
      const newest = Fill.newestPeriodicFiling(subs);
      const gate = Fill.isLagging(stored, newest) || Fill.filingsToRead(filings, Build.storedQuarterEnds(stored), Fill.newestStoredEnd(stored)).length > 0;
      if (!gate) { if (WATCH.has(symbol)) watched.push(`  ${symbol.padEnd(5)} not acted on: current and complete (ff ${stored.ff?.accn ?? "-"})`); continue; }
      totals.acted++;
      const prior = filingState[symbol] ?? undefined;
      const o = await OLD.checkAndFill(symbol, cik, structuredClone(stored), prior, fetchers, new Map());
      const n = await NEW.checkAndFill(symbol, cik, structuredClone(stored), prior, fetchers, new Map());
      const live = writes(o) ? o.set : stored;
      const next = writes(n) ? n.set : stored;
      // The companyfacts-only read, for attribution.
      const cf = await withPredecessorFacts(cik, await fetchers.companyFacts(cik), fetchers.companyFacts);
      const feedOnly = byEnd(await Build.toStoredSet(extractForSymbol(symbol, cf), defaultSources(), new Map()));
      const a = byEnd(live), b = byEnd(next);
      const counts = { filled: 0, changed: 0, blanked: 0, drift: 0 };
      const samples = [];
      for (const k of new Set([...a.keys(), ...b.keys()])) {
        const pa = a.get(k), pb = b.get(k), pf = feedOnly.get(k);
        for (const key of SEC_FIELD_KEYS) {
          const va = Codec.valueOf(pa, key), vb = Codec.valueOf(pb, key);
          if (va === vb) continue;
          if (vb === Codec.valueOf(pf, key)) { counts.drift++; continue; }
          const kind = va === null ? "filled" : vb === null ? "blanked" : "changed";
          counts[kind]++;
          if (samples.length < 8 || kind !== "filled") samples.push(`${kind} ${label(pb ?? pa)} ${key} ${fmt(va)} → ${fmt(vb)}`);
        }
      }
      for (const k of ["filled", "changed", "blanked", "drift"]) totals[k] += counts[k];
      const reads = Fill.filingsToRead(filings, Build.storedQuarterEnds(stored), Fill.newestStoredEnd(stored)).map((f) => `${f.form} ${f.reportDate}`);
      const st = filingState[symbol];
      const pickup = st?.lag ? `lag recorded (${st.lag.kind}): re-checked daily` : "no lag recorded: checked when the daily index sees a new filing";
      const line = `  ${symbol.padEnd(6)} main ${o.kind} → branch ${n.kind} | filled ${counts.filled}, changed ${counts.changed}, blanked ${counts.blanked}, drift ${counts.drift} | gate reads ${reads.join(", ") || "-"} | ${pickup}`;
      if (counts.filled + counts.changed + counts.blanked) { totals.filers++; fillers.push([line, samples]); }
      if (WATCH.has(symbol)) {
        const q2 = next.quarters.find((q) => q.e.startsWith("2026-06")), q2live = live.quarters.find((q) => q.e.startsWith("2026-06"));
        watched.push(`${line}\n         Q2 2026 net income: main ${fmt(Codec.valueOf(q2live, "netIncome"))} → branch ${fmt(Codec.valueOf(q2, "netIncome"))}`);
      }
    } catch (e) {
      totals.failed++;
      console.log(`  ${symbol}: failed ${String(e?.message ?? e).slice(0, 100)}`);
    }
  }
}

console.log(`\n${arg}: ${all.length} symbols, ${totals.read} stored sets read, ${totals.skippedFx} non-USD skipped, ${totals.acted} acted on, ${totals.failed} failed, ${requests} SEC requests`);
console.log(`cells the FILINGS move: filled ${totals.filled}, changed ${totals.changed}, blanked ${totals.blanked} (across ${totals.filers} filers); drift cells ${totals.drift}`);
for (const [line, samples] of fillers) {
  console.log(line);
  for (const s of samples) console.log(`         ${s}`);
}
console.log("\nwatched filers:");
for (const w of watched) console.log(w);
