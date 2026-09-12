// STEP 0 — freeze the FMP ground truth out of Redis, before it expires.
//
// WHY THIS EXISTS. FMP is being removed (commercial licence quoted at $20,000/yr).
// Every later comparison between a candidate source -- Stooq for bars, SEC EDGAR
// for fundamentals -- and what the site serves today is a diff against WHAT FMP
// ALREADY PUT IN REDIS. Those entries sit on their own TTLs and the key that
// would refill them is on borrowed time, so this dump is the only baseline the
// replacement can ever be validated against. Once an entry has expired it is not
// recoverable: the ceiling on everything the migration can later PROVE is set by
// how much was still in cache the moment this ran.
//
// THE MOST IRREPLACEABLE DATASET IS NOT THE BARS. It is
// msh:pickers:profile:v1:<SYM> -- industry and sector in FMP's own taxonomy, on a
// 30-day TTL (PROFILE_TTL_SECONDS). SIC codes from SEC will not reproduce that
// taxonomy, so this dump is the only way to keep it for the existing universe.
//
// STRICTLY READ-ONLY, BY CONSTRUCTION AND BY CREDENTIAL.
//
//   * Only GET / MGET / HGETALL / ZRANGE / SCAN / DBSIZE are issued. No SET, no
//     DEL, no EXPIRE, no HINCRBY.
//   * The workflow supplies Upstash's READ-ONLY token. A write would be refused
//     by the server, so the guarantee does not rest on this file being careful.
//   * NOTHING FROM lib/server/ IS IMPORTED, and that is deliberate rather than
//     tidy. Importing historyCache would pull in redisBandwidth, whose
//     recordRedisRead accumulates and then flushes HINCRBY + EXPIRE -- writes the
//     read-only token refuses. It would fail open and silently, so the dump would
//     still work while quietly trying to write on every read. This file talks to
//     Redis directly and duplicates the key names, with the source of each named
//     in KEYS below so a rename is findable.
//
// NO FORCED PICKERS BUILD, AND THAT IS A DELIBERATE DEPARTURE FROM THE BRIEF.
// Step 0 as written asks for "the current pickers payload, forced
// (/api/pickers?force=1&key=<owner key>)" AND, two lines later, "trigger no
// refresh that would call FMP". Those conflict: force=1 rebuilds, and a rebuild
// calls FMP. Section membership "as it stands" is already in Redis under the v10
// manifest, so it is read from there. That satisfies the stated purpose, honours
// the read-only rule, and needs no owner key.
//
// Usage:  node scripts/step0-dump-ground-truth.mjs [outDir]
// Env:    UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Redis } from "@upstash/redis";

const OUT = path.resolve(process.argv[2] ?? "step0-dump");
const DUMPED_AT = new Date().toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// The key names, each with the module that owns it, so a rename is greppable
// from here rather than guessed at. Duplicated deliberately -- see the header.
const KEYS = {
  // lib/server/historyCache.ts  REDIS_HISTORY_PREFIX
  history: "msh:history:v7",
  // lib/server/historyCache.ts  NEWEST_BAR_STAMP_HASH
  newestBar: "msh:history:newest-bar:v1",
  // lib/server/fundamentalsCache.ts  FUND_KEY_PREFIX / PROFILE_KEY_PREFIX / SCREENER_FUND_KEY_PREFIX
  fundamentals: "msh:pickers:fundamentals:v1:",
  profile: "msh:pickers:profile:v1:",
  screenerFundamentals: "msh:pickers:screener-fundamentals:v1:",
  // lib/server/stockDataCache.ts  KEY_PREFIX -- holds rating / priceTarget / analystCount
  stockData: "msh:stockdata:v1:",
  // lib/server/pickersBuilder.ts  PICKERS_MANIFEST_KEY / _CHUNK_PREFIX / _SYMBOLS_KEY / EARNINGS_*
  pickersManifest: "msh:pickers:v10:manifest",
  pickersChunk: "msh:pickers:v10:chunk",
  pickersSymbols: "msh:pickers:v10:symbols",
  pickersV9: "msh:pickers:v9:charts-off-payload",
  earningsRow: "msh:pickers:earnings:v1:",
  // lib/server/earningsCalendar.ts / earningsStore.ts
  earningsDayItems: "msh:earnings-day-items:v1",
  earningsDayComplete: "msh:earnings-day-complete:v2",
  earningsSchedule: "msh:earnings-schedule:v1",
  // lib/server/dynamicUniverseCache.ts  SCORE_KEY / SEEN_KEY
  universeScore: "msh:dynamic-universe:v2:score",
  universeSeen: "msh:dynamic-universe:v2:seen",
  // lib/server/pricePool.ts
  pricePool: "msh:price-pool:v1",
};

// MGET RESPONSE SIZE, NOT ROUND-TRIP COUNT, IS WHAT BOUNDS THIS. A stored history
// entry measures ~110 KB (BYTES_PER_SYMBOL_HISTORY = 109,962), and Upstash refuses
// a response over 10 MB -- the same ceiling historyCache.ts's HISTORY_MGET_CHUNK
// of 40 exists for. 20 keeps the worst case near 2.2 MB, which leaves room for a
// symbol with deeper history than the average without a second guess.
const HISTORY_MGET_CHUNK = 20;
// The small datasets are ~1-3 KB a symbol, so they can go wider.
const SMALL_MGET_CHUNK = 100;

const redis = Redis.fromEnv();

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(name, value) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return { file: name, bytes: fs.statSync(file).size };
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** SCAN a prefix to completion. Read-only, and the authority on what still EXISTS. */
async function scanPrefix(match) {
  const found = [];
  let cursor = "0";
  let guard = 0;
  do {
    const [next, keys] = await redis.scan(cursor, { match, count: 1000 });
    cursor = String(next);
    for (const k of keys) found.push(k);
    // A cursor that never returns to 0 would loop forever. 100k keys at count
    // 1000 is far past this keyspace; stop and say so rather than hang a job.
    if (++guard > 2000) {
      console.warn(`  ! scan(${match}) hit the iteration guard at ${found.length} keys`);
      break;
    }
  } while (cursor !== "0");
  return [...new Set(found)];
}

const suffixOf = (key, prefix) => key.slice(prefix.length).replace(/^:/, "");

// ─────────────────────────────────────────────────────────────────────────────
console.log(`Step 0 ground-truth dump -> ${OUT}`);
console.log(`dumpedAt ${DUMPED_AT}`);
ensureDir(OUT);

const report = {
  dumpedAt: DUMPED_AT,
  purpose:
    "Frozen FMP ground truth for the Stooq/SEC migration. Read-only dump from Upstash. " +
    "Coverage below is the ceiling on what any later source comparison can prove.",
  readOnly: true,
  keys: KEYS,
  datasets: {},
  universe: {},
  files: [],
  warnings: [],
};

// ── 1. THE UNIVERSE, from three sources, so the denominator is not a guess ────
console.log("\n1. Universe");

let dbsize = null;
try {
  dbsize = await redis.dbsize();
  console.log(`   DBSIZE ${dbsize}`);
} catch (e) {
  report.warnings.push(`dbsize failed: ${String(e?.message ?? e)}`);
}

async function readSymbolList() {
  try {
    const v = await redis.get(KEYS.pickersSymbols);
    if (Array.isArray(v)) return v.map(String);
    if (v && typeof v === "object" && Array.isArray(v.symbols)) return v.symbols.map(String);
    return [];
  } catch {
    return [];
  }
}

async function readUniverseZset() {
  try {
    const raw = await redis.zrange(KEYS.universeScore, 0, -1, { withScores: true });
    const out = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      out.push({ symbol: String(raw[i]), score: Number(raw[i + 1]) });
    }
    return out;
  } catch {
    return [];
  }
}

const [symbolList, universeZ] = await Promise.all([readSymbolList(), readUniverseZset()]);

// SCAN is the authority on what is actually still cached, and it also catches
// symbols that no declared list knows about.
const historyKeys = await scanPrefix(`${KEYS.history}:*`);
const historySymbols = historyKeys.map((k) => suffixOf(k, KEYS.history));

const declared = [...new Set([...symbolList, ...universeZ.map((r) => r.symbol)])].sort();
const universe = [...new Set([...declared, ...historySymbols])].sort();

report.universe = {
  dbsize,
  fromPickersSymbolsKey: symbolList.length,
  fromDynamicUniverseZset: universeZ.length,
  fromHistoryKeyScan: historySymbols.length,
  declaredUnion: declared.length,
  dumpUniverse: universe.length,
  note:
    "dumpUniverse is the union of the declared lists and every symbol with a live " +
    "history key. Symbols present only in the scan are already-evicted-from-the-list " +
    "but still cached; symbols only in the declared lists have already lost their bars.",
};
console.log(
  `   symbols key ${symbolList.length} · universe zset ${universeZ.length} · ` +
    `history keys ${historySymbols.length} · union ${universe.length}`
);

report.files.push(
  writeJson("universe.json", {
    dumpedAt: DUMPED_AT,
    ...report.universe,
    pickersSymbolsKey: symbolList,
    dynamicUniverseScores: universeZ,
    historyKeySymbols: historySymbols.sort(),
    dumpUniverse: universe,
  })
);

// ── 2. DAILY BARS, full depth, streamed as NDJSON ────────────────────────────
// NDJSON + gzip rather than one JSON array: ~700 x ~110 KB is ~77 MB, and a
// line-per-symbol file can be read back a symbol at a time by whatever does the
// Stooq diff, instead of parsing 77 MB to look at one ticker.
console.log("\n2. Daily bars (full depth)");
{
  const barsPath = path.join(OUT, "history-bars.ndjson.gz");
  const gz = zlib.createGzip({ level: 6 });
  const sink = fs.createWriteStream(barsPath);
  gz.pipe(sink);
  const write = (obj) =>
    new Promise((res, rej) => gz.write(JSON.stringify(obj) + "\n", (e) => (e ? rej(e) : res())));

  await write({ _meta: true, dumpedAt: DUMPED_AT, dataset: "history", key: `${KEYS.history}:<SYM>` });

  let present = 0;
  let bars = 0;
  let missing = 0;
  const statuses = {};

  for (const group of chunk(historyKeys, HISTORY_MGET_CHUNK)) {
    let values;
    try {
      values = await redis.mget(...group);
    } catch (e) {
      report.warnings.push(`history mget failed for ${group.length} keys: ${String(e?.message ?? e)}`);
      continue;
    }
    for (let i = 0; i < group.length; i++) {
      const entry = values?.[i];
      const symbol = suffixOf(group[i], KEYS.history);
      if (!entry) {
        missing++;
        continue;
      }
      present++;
      const n = Array.isArray(entry?.daily) ? entry.daily.length : 0;
      bars += n;
      const st = String(entry?.status ?? "unknown");
      statuses[st] = (statuses[st] ?? 0) + 1;
      await write({ symbol, barCount: n, entry });
    }
    process.stdout.write(`\r   ${present} symbols, ${bars} bars`);
  }

  // Wait on the SINK, not the gzip stream: gz.end()'s callback fires when the
  // compressor has flushed, which is before the bytes are on disk. Resolving
  // there would let statSync read a short file.
  await new Promise((res, rej) => {
    sink.on("finish", res);
    sink.on("error", rej);
    gz.on("error", rej);
    gz.end();
  });

  const size = fs.statSync(barsPath).size;
  console.log(`\n   ${present} present, ${missing} keys that vanished mid-scan, ${bars} bars, ${(size / 1e6).toFixed(1)} MB gz`);
  report.datasets.history = {
    key: `${KEYS.history}:<SYM>`,
    keysScanned: historyKeys.length,
    present,
    vanishedMidScan: missing,
    totalBars: bars,
    meanBarsPerSymbol: present ? Math.round(bars / present) : 0,
    statuses,
    coverageOfDumpUniversePct: universe.length ? Number(((present / universe.length) * 100).toFixed(1)) : 0,
  };
  report.files.push({ file: "history-bars.ndjson.gz", bytes: size });
}

// ── 3. THE PER-SYMBOL DATASETS ───────────────────────────────────────────────
console.log("\n3. Per-symbol datasets");

/**
 * Dump one prefix across the whole universe.
 *
 * SCANNED AS WELL AS FETCHED BY NAME. Fetching only the universe's keys would
 * report coverage against a denominator that has already lost its evicted
 * members; scanning finds everything still there, including symbols no list
 * mentions any more. Both numbers go in the report.
 */
async function dumpPerSymbol(name, prefix, { chunkSize = SMALL_MGET_CHUNK } = {}) {
  const scanned = await scanPrefix(`${prefix}*`);
  const symbols = [...new Set([...scanned.map((k) => suffixOf(k, prefix)), ...universe])].sort();
  const keys = symbols.map((s) => `${prefix}${s}`);

  const values = {};
  let present = 0;
  for (const group of chunk(keys, chunkSize)) {
    let got;
    try {
      got = await redis.mget(...group);
    } catch (e) {
      report.warnings.push(`${name} mget failed for ${group.length} keys: ${String(e?.message ?? e)}`);
      continue;
    }
    for (let i = 0; i < group.length; i++) {
      const v = got?.[i];
      if (v == null) continue;
      present++;
      values[suffixOf(group[i], prefix)] = v;
    }
  }

  const pct = universe.length ? Number(((present / universe.length) * 100).toFixed(1)) : 0;
  report.datasets[name] = {
    key: `${prefix}<SYM>`,
    keysScanned: scanned.length,
    present,
    coverageOfDumpUniversePct: pct,
  };
  report.files.push(
    writeJson(`${name}.json`, { dumpedAt: DUMPED_AT, dataset: name, key: `${prefix}<SYM>`, present, values })
  );
  console.log(`   ${name.padEnd(22)} ${String(present).padStart(5)} present  ${String(pct).padStart(5)}% of universe`);
  return values;
}

await dumpPerSymbol("fundamentals", KEYS.fundamentals);
await dumpPerSymbol("profile", KEYS.profile);
await dumpPerSymbol("screener-fundamentals", KEYS.screenerFundamentals);
await dumpPerSymbol("earnings-rows", KEYS.earningsRow, { chunkSize: 50 });
// stockdata carries rating / priceTarget / analystCount and is the biggest of the
// small datasets, so it gets a narrower chunk.
const stockData = await dumpPerSymbol("stockdata", KEYS.stockData, { chunkSize: 25 });

// ── 4. THE FIVE COLUMNS GOING DARK, extracted on their own ───────────────────
// These have no free replacement anywhere -- analyst estimates are a licensed,
// vendor-aggregated product. Pulled out of stockdata into their own file so the
// last known state of the five hidden columns is one small artefact rather than
// something to be re-derived from a large one.
console.log("\n4. The five analyst columns");
{
  const rows = {};
  let withAny = 0;
  for (const [symbol, v] of Object.entries(stockData)) {
    if (!v || typeof v !== "object") continue;
    const row = {
      rating: v.rating ?? null,
      analystCount: v.analystCount ?? null,
      priceTarget: v.priceTarget ?? null,
      forwardPE: v.forwardPE ?? null,
      ptUpside: v.ptUpside ?? null,
    };
    if (Object.values(row).some((x) => x != null)) {
      rows[symbol] = row;
      withAny++;
    }
  }
  report.datasets["analyst-columns"] = {
    source: `${KEYS.stockData}<SYM>`,
    fields: ["rating", "analystCount", "priceTarget", "forwardPE", "ptUpside"],
    symbolsWithAtLeastOneValue: withAny,
    coverageOfDumpUniversePct: universe.length ? Number(((withAny / universe.length) * 100).toFixed(1)) : 0,
    note:
      "forwardPE and ptUpside are derived on render in some paths rather than stored; " +
      "a null here means not stored, not necessarily unavailable at the time.",
  };
  report.files.push(
    writeJson("analyst-columns.json", { dumpedAt: DUMPED_AT, dataset: "analyst-columns", rows })
  );
  console.log(`   ${withAny} symbols carry at least one analyst value`);
}

// ── 5. THE PICKERS PAYLOAD — section membership as it stands ──────────────────
console.log("\n5. Pickers payload (section membership)");
{
  const out = { dumpedAt: DUMPED_AT, dataset: "pickers-payload", source: "redis (NOT a forced rebuild)" };
  try {
    const manifest = await redis.get(KEYS.pickersManifest);
    out.manifest = manifest ?? null;
    if (manifest && Array.isArray(manifest.chunkKeys) && manifest.chunkKeys.length) {
      const records = [];
      // One chunk per request: each is sized to ~5 MB by chunkByBytes, so an MGET
      // of two would approach the 10 MB response ceiling.
      for (const key of manifest.chunkKeys) {
        const part = await redis.get(key);
        if (Array.isArray(part)) records.push(...part);
        else report.warnings.push(`pickers chunk ${key} missing or not an array -- payload is a short read`);
      }
      out.recordCount = records.length;
      out.manifestRecordCount = manifest.recordCount ?? null;
      out.complete = records.length === (manifest.recordCount ?? -1);
      out.signalRecords = records;
      console.log(`   v10: ${records.length} records over ${manifest.chunkKeys.length} chunk(s), complete=${out.complete}`);
    } else {
      // v9 is a single value and expires on its own 60-minute TTL; if v10 is
      // absent this is the fallback worth having rather than nothing.
      const v9 = await redis.get(KEYS.pickersV9);
      out.v9 = v9 ?? null;
      out.recordCount = Array.isArray(v9?.data?.signalRecords) ? v9.data.signalRecords.length : 0;
      console.log(`   v10 manifest absent; v9 fallback ${out.recordCount} records`);
      if (!v9) report.warnings.push("no pickers payload in cache at dump time -- section membership NOT captured");
    }
  } catch (e) {
    report.warnings.push(`pickers payload read failed: ${String(e?.message ?? e)}`);
  }
  report.datasets["pickers-payload"] = {
    recordCount: out.recordCount ?? 0,
    complete: out.complete ?? null,
    captured: (out.recordCount ?? 0) > 0,
  };
  report.files.push(writeJson("pickers-payload.json", out));
}

// ── 6. THE SINGLETONS: earnings calendar, newest-bar stamps, price pool ───────
console.log("\n6. Singleton keys");
for (const [name, key, kind] of [
  ["earnings-day-items", KEYS.earningsDayItems, "hash"],
  ["earnings-day-complete", KEYS.earningsDayComplete, "hash"],
  ["earnings-schedule", KEYS.earningsSchedule, "hash"],
  ["history-newest-bar", KEYS.newestBar, "hash"],
  ["price-pool", KEYS.pricePool, "hash"],
  ["dynamic-universe-seen", KEYS.universeSeen, "zset"],
]) {
  try {
    let value = null;
    if (kind === "hash") value = await redis.hgetall(key);
    else if (kind === "zset") {
      const raw = await redis.zrange(key, 0, -1, { withScores: true });
      const pairs = [];
      for (let i = 0; i + 1 < raw.length; i += 2) pairs.push({ member: String(raw[i]), score: Number(raw[i + 1]) });
      value = pairs;
    }
    const n = Array.isArray(value) ? value.length : value ? Object.keys(value).length : 0;
    report.datasets[name] = { key, kind, entries: n, present: n > 0 };
    report.files.push(writeJson(`${name}.json`, { dumpedAt: DUMPED_AT, dataset: name, key, kind, entries: n, value }));
    console.log(`   ${name.padEnd(24)} ${String(n).padStart(6)} entries`);
  } catch (e) {
    report.warnings.push(`${name} (${key}) read failed: ${String(e?.message ?? e)}`);
    report.datasets[name] = { key, kind, entries: 0, present: false, error: true };
  }
}

// ── 7. THE COVERAGE VERDICT ──────────────────────────────────────────────────
// The number the brief actually asks for, and the reason the dump is urgent:
// anything already expired is already lost, and this is the ceiling on what the
// Stooq/SEC comparison can ever prove.
const totalBytes = report.files.reduce((s, f) => s + (f.bytes ?? 0), 0);
report.totalBytes = totalBytes;
report.coverageVerdict = Object.fromEntries(
  Object.entries(report.datasets)
    .filter(([, d]) => typeof d.coverageOfDumpUniversePct === "number")
    .map(([k, d]) => [k, `${d.coverageOfDumpUniversePct}% of ${universe.length}`])
);

// Written last and listed in its own files[] before serialising, so the report
// describes the complete artefact set including itself.
report.files.push({ file: "REPORT.json", bytes: null });
fs.writeFileSync(path.join(OUT, "REPORT.json"), JSON.stringify(report, null, 2));

console.log("\n── Coverage at dump time ──");
for (const [k, v] of Object.entries(report.coverageVerdict)) console.log(`   ${k.padEnd(24)} ${v}`);
console.log(`\n   total ${(totalBytes / 1e6).toFixed(1)} MB across ${report.files.length} files`);
if (report.warnings.length) {
  console.log(`\n   ${report.warnings.length} warning(s):`);
  for (const w of report.warnings) console.log(`     - ${w}`);
}
console.log(`\nDone. dumpedAt ${DUMPED_AT}`);
