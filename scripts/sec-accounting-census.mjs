// WHICH ACCOUNTING STANDARD IS A STORED SET READ UNDER — counted, not assumed.
//
// accountingOf (lib/server/secEarningsView.ts) labels a set "US GAAP" whenever
// `us-gaap` is among its namespaces. The owner's question on #514: an IFRS
// filer carrying a few stray us-gaap tags would be mislabelled. This answers it
// with three measurements:
//
//   1. the namespace list, currency, concept choices and marker state for the
//      IFRS names the site tests against;
//   2. across EVERY stored set, how many carry us-gaap, ifrs-full, both, or
//      neither — and `tx` absent is reported as unknown, never as "none";
//   3. for each set carrying BOTH, which namespace the NEWEST period's values
//      were actually read from, field by field, off the live payload. The
//      extractor ranks the us-gaap chain first, so a field resolves us-gaap
//      whenever us-gaap has a row ending on that date; the census applies
//      that same rule rather than a new one.
//
// READS ONLY. Credentialled for the store (the write- prefix is the credential
// boundary, see relay-run.mjs); fetches companyfacts for mixed sets only.
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const constant = (src, n) => (readCodeOnly(src).match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const FACTS_PREFIX = constant("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
if (!FACTS_PREFIX) { console.error("FATAL: no SEC_FACTS_PREFIX"); process.exit(2); }
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; accounting census)";

const { SEC_FIELDS } = await lift(readCodeOnly("lib/server/secFields.ts"));

const TEST = (process.env.SYMBOLS || "ABVX AZN KGC RYAAY TSM ASML HDB IBN BABA NVS HSBC GSK ARM")
  .split(/[,\s]+/).filter(Boolean).map((s) => s.toUpperCase());

const keys = [];
let cursor = "0";
do {
  const [next, batch] = await redis.scan(cursor, { match: `${FACTS_PREFIX}:*`, count: 1000 });
  cursor = next;
  keys.push(...batch);
} while (cursor !== "0");
console.log(`stored sets: ${keys.length}`);

const combos = new Map();
const mixed = [];
const test = new Map();
let withNt = 0, noTx = 0, populated = 0;
for (let i = 0; i < keys.length; i += 64) {
  const sets = await Promise.all(keys.slice(i, i + 64).map((k) => redis.get(k).catch(() => null)));
  for (const set of sets) {
    if (!set || !Array.isArray(set.quarters)) continue;
    const hasValues = set.quarters.length + set.years.length > 0;
    if (hasValues) populated++;
    if (set.nt) withNt++;
    if (TEST.includes(set.symbol)) test.set(set.symbol, set);
    if (!Array.isArray(set.tx)) { noTx++; continue; }
    const fin = set.tx.filter((t) => t === "us-gaap" || t === "ifrs-full");
    const k = fin.length ? fin.join("+") : "(neither)";
    combos.set(k, (combos.get(k) ?? 0) + 1);
    if (fin.length === 2) mixed.push(set);
  }
}

console.log(`\n1. THE IFRS TEST NAMES`);
for (const s of TEST) {
  const set = test.get(s);
  if (!set) { console.log(`  ${s.padEnd(6)} no stored set`); continue; }
  const latest = set.quarters[0] ?? set.years[0] ?? null;
  console.log(`  ${s.padEnd(6)} tx=[${set.tx?.join(", ") ?? "ABSENT"}] cur=${set.cur ?? "USD"} ` +
    `cc=${JSON.stringify(set.cc ?? null)} nt=${set.nt ? `${set.nt.length} fields` : "absent"} ` +
    `latest=${latest ? `${latest.fp} FY${latest.fy} ${latest.e}` : "none"}`);
}

console.log(`\n2. NAMESPACES ACROSS EVERY STORED SET`);
for (const [k, n] of [...combos].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${n}`);
console.log(`  ${"tx absent (unknown)".padEnd(20)} ${noTx}`);
console.log(`  sets with values: ${populated}; sets already carrying the untagged marker (nt): ${withNt}`);

console.log(`\n3. SETS CARRYING BOTH us-gaap AND ifrs-full: ${mixed.length}`);
const LIMIT = Number(process.env.PAYLOAD_LIMIT ?? 80);
for (const set of mixed.slice(0, LIMIT)) {
  const latest = set.quarters[0] ?? set.years[0] ?? null;
  const head = `  ${set.symbol.padEnd(7)} cc=${JSON.stringify(set.cc ?? null)}`;
  if (!latest || !set.cik) { console.log(`${head} (no latest period or no cik)`); continue; }
  let facts;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${set.cik}.json`,
      { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
    if (!res.ok) { console.log(`${head} companyfacts HTTP ${res.status}`); continue; }
    facts = await res.json();
  } catch (e) { console.log(`${head} fetch failed ${e.message}`); continue; }
  const endsOn = (ns, tags) => tags.some((t) =>
    Object.values(facts.facts?.[ns]?.[t]?.units ?? {}).some((rows) => rows.some((r) => r.end === latest.e)));
  const read = { "us-gaap": 0, "ifrs-full": 0 };
  for (const f of SEC_FIELDS) {
    if (endsOn(f.taxonomy, f.chain)) read[f.taxonomy]++;
    else if (f.ifrsChain?.length && endsOn("ifrs-full", f.ifrsChain)) read["ifrs-full"]++;
  }
  const usTags = Object.keys(facts.facts?.["us-gaap"] ?? {}).length;
  const ifTags = Object.keys(facts.facts?.["ifrs-full"] ?? {}).length;
  console.log(`${head} latest ${latest.e}: fields read us-gaap=${read["us-gaap"]} ifrs-full=${read["ifrs-full"]}` +
    `  (payload concepts us-gaap=${usTags} ifrs-full=${ifTags})`);
  await new Promise((r) => setTimeout(r, 120));
}
if (mixed.length > LIMIT) console.log(`  ... and ${mixed.length - LIMIT} more (PAYLOAD_LIMIT)`);
