// EARNINGS PAGE ROUND 2 — the four "Not reported" gaps, counted over the
// universe, before and after the chain edits, with the SHIPPED extraction.
//
// ── WHAT IS COUNTED ──────────────────────────────────────────────────────
// Four page lines: Total liabilities, Shareholders' equity, Interest expense,
// Other income / expense. For each symbol in the SEC manifest:
//
//   stored    the fact set in the store TODAY — is the line null on the
//             period the card shows (newest quarter, else newest year, for the
//             income lines; newest balance-sheet date for the two balances)?
//   before    companyfacts through the shipped extractor, chains as shipped
//   after     the same payload with the PROPOSED concepts (below) appended
//   + one run per proposed concept with ONLY that concept appended, so each
//     concept's own fills and alterations are attributed to it
//
// THE PROPOSAL IS APPLIED HERE, AT RUNTIME, not read from secFields.ts: the
// first run (35839022318, commit 960a0eb) measured the edit IN the source,
// found it altered existing figures, and the edit was withdrawn. Keeping the
// proposal in this file lets the measurement be re-run against the shipped
// chains without re-landing an edit that fails the zero-alteration bar.
//
// ALTERED is the headline: any period (quarter, year or balance date) whose
// value was a number before and is a different number — or nothing — after.
// The brief requires 0. A null that becomes a number is a FILL, and is
// counted separately so an overwrite cannot hide inside the win.
//
// SHAREHOLDERS' EQUITY IS NOT A CHAIN EDIT. The page falls back to the stored
// TOTAL equity (incl. noncontrolling interests) with its own label when the
// parent-only figure is absent; that is counted from the same sets.
// TOTAL LIABILITIES HAS NO CHAIN EDIT: the filers that lack `Liabilities`
// generally file no other total. The count of those that file
// LiabilitiesAndStockholdersEquity is printed so the derivation that was NOT
// added is priced rather than argued.
//
// Also: how many stored sets the chain edit re-queues (manifest `c` equal to
// main's chains hash — sets already on an older hash are queued either way).
//
// Credentialled (Upstash) and READ-ONLY: GETs only. Fetches companyfacts at
// 125ms spacing. SYMBOLS="SHARD i/n" splits the manifest across runners.
//   relay task: write-round2-gap-census
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; round 2 gap census)";
const PROPOSED = {
  interestExpense: ["InterestExpenseNonoperating", "InterestIncomeExpenseNonoperatingNet"],
  nonOperatingIncomeExpense: ["OtherNonoperatingIncomeExpense"],
};
const INCOME = ["interestExpense", "nonOperatingIncomeExpense"];

const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
  .replace(/^export \* from "\.\/[^"]+";$/gm, "");
const sec = await lift([
  readCodeOnly("lib/server/secFields.ts"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"),
].join("\n"));
const { SEC_FIELDS, extractCompanyFacts, encodeFactSet, valueOf, secChainsHash } = sec;

const shipped = {};
for (const [key, tags] of Object.entries(PROPOSED)) {
  const f = SEC_FIELDS.find((x) => x.key === key);
  if (!f || tags.some((t) => f.chain.includes(t))) {
    console.error(`FATAL: ${key}'s chain already contains one of ${tags.join(", ")} — nothing to measure`); process.exit(2);
  }
  shipped[key] = [...f.chain];
}
// Appends exactly `add` (a subset of the proposal) to the shipped chains.
const setChains = (add) => {
  for (const key of Object.keys(PROPOSED)) {
    const f = SEC_FIELDS.find((x) => x.key === key);
    f.chain.length = 0;
    f.chain.push(...shipped[key], ...PROPOSED[key].filter((t) => add.includes(t)));
  }
};
const ALL_ADDED = Object.values(PROPOSED).flat();
setChains([]);
const mainHash = secChainsHash();
setChains(ALL_ADDED);
const branchHash = secChainsHash();
setChains([]);
console.log(`main chains hash ${mainHash} · branch chains hash ${branchHash}`);

const redis = Redis.fromEnv();
const manifest = await redis.get("msh:sec:manifest:v1");
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }

// ── the re-read backlog the edit causes (whole manifest, every shard) ──────
{
  const t = { main: 0, branch: 0, older: 0, absent: 0, noSet: 0 };
  for (const e of Object.values(manifest.symbols)) {
    if (!e?.cik) continue;
    if (e.contentHash == null) { t.noSet++; continue; }
    const c = e.c ?? null;
    if (c === null) t.absent++; else if (c === mainHash) t.main++;
    else if (c === branchHash) t.branch++; else t.older++;
  }
  console.log(`BACKLOG: stored sets with a CIK ${t.main + t.branch + t.older + t.absent}; ` +
    `already chain-stale (older hash ${t.older}, none recorded ${t.absent}) = ${t.older + t.absent}; ` +
    `current on main's chains, RE-QUEUED by this edit = ${t.main}; on branch chains ${t.branch}; no set ${t.noSet}`);
}

const all = Object.entries(manifest.symbols).filter(([, e]) => e?.cik).map(([s, e]) => [s, e.cik]).sort();
const m = String(process.env.SYMBOLS || "").match(/SHARD\s+(\d+)\s*\/\s*(\d+)/i);
const [shard, shards] = m ? [Number(m[1]), Number(m[2])] : [0, 1];
const targets = all.filter((_, i) => i % shards === shard);
console.log(`manifest symbols with a CIK: ${all.length}; this shard ${shard}/${shards}: ${targets.length}\n`);

// Which have a report-date record (the 693-ish universe the page's due strip reads).
const hasRecord = new Set();
for (let i = 0; i < targets.length; i += 50) {
  const batch = targets.slice(i, i + 50);
  const p = redis.pipeline();
  for (const [s] of batch) p.exists(`msh:sec:reportdates:v1:${s}`);
  const r = await p.exec();
  batch.forEach(([s], j) => { if (Number(r[j]) > 0) hasRecord.add(s); });
}

const shownIncome = (set) => set?.quarters?.[0] ?? set?.years?.[0] ?? null;
const shownBalance = (set) => set?.instants?.[0] ?? null;
const allCells = (set, key) => {
  const out = new Map();
  for (const [b, ps] of [["q", set.quarters], ["y", set.years], ["i", set.instants]]) {
    for (const p of ps ?? []) out.set(`${b}:${p.e}`, valueOf(p, key));
  }
  return out;
};
const newestInstantHas = (facts, tag) => {
  const rows = facts?.facts?.["us-gaap"]?.[tag]?.units?.USD ?? [];
  return rows;
};

const FIELDS = ["totalLiabilities", "stockholdersEquity", "interestExpense", "nonOperatingIncomeExpense"];
const blank = () => ({ storedGap: 0, gapBefore: 0, filledAfter: 0, stillMissing: 0, altered: [], alteredSymbols: 0, cellsFilled: 0, recGapBefore: 0, recFilled: 0 });
const T = Object.fromEntries(FIELDS.map((k) => [k, blank()]));
const perConcept = Object.fromEntries(ALL_ADDED.map((t) => [t, { filledShown: 0, cellsFilled: 0, altered: [], alteredSymbols: [] }]));
const extra = { liabWithLSE: 0, liabGapSamples: [], equityNciDiffers: [], fetchFailed: 0, extractFailed: 0, read: 0, records: hasRecord.size };
const samples = Object.fromEntries(FIELDS.map((k) => [k, []]));

let lastAt = 0;
const fetchJson = async (url) => {
  const wait = Math.max(0, lastAt + 125 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
    return res.ok ? await res.json() : null;
  } catch { return null; }
};

const started = Date.now();
for (const [symbol, cik] of targets) {
  if (Date.now() - started > 38 * 60 * 1000) { console.log(`TIME BUDGET: stopped at ${symbol}`); break; }
  const stored = await redis.get(`msh:sec:facts:v1:${symbol}`).catch(() => null);
  const facts = await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!facts) { extra.fetchFailed++; continue; }
  let before, after;
  const alone = {};
  try {
    setChains([]); before = encodeFactSet(extractCompanyFacts(symbol, facts));
    for (const t of ALL_ADDED) {
      setChains([t]);
      alone[t] = encodeFactSet(extractCompanyFacts(symbol, facts));
    }
    setChains(ALL_ADDED); after = encodeFactSet(extractCompanyFacts(symbol, facts));
    setChains([]);
  } catch (e) { extra.extractFailed++; setChains([]); console.log(`  ${symbol} extract threw: ${e.message}`); continue; }
  extra.read++;
  const rec = hasRecord.has(symbol);

  for (const key of FIELDS) {
    const t = T[key];
    const shown = INCOME.includes(key) ? shownIncome : shownBalance;
    if (stored && shown(stored) && valueOf(shown(stored), key) == null) t.storedGap++;
    const pb = shown(before);
    if (!pb) continue;
    let vb = valueOf(pb, key);
    let va = valueOf(shown(after), key);
    // Shareholders' equity: the page's fallback to TOTAL equity, not a chain.
    if (key === "stockholdersEquity" && va == null) va = valueOf(shown(after), "totalEquity");
    if (vb == null) {
      t.gapBefore++; if (rec) t.recGapBefore++;
      if (va != null) { t.filledAfter++; if (rec) t.recFilled++; if (samples[key].length < 25) samples[key].push(`${symbol}=${va}`); }
      else t.stillMissing++;
    }
    if (key === "totalLiabilities" && vb == null) {
      const lse = newestInstantHas(facts, "LiabilitiesAndStockholdersEquity").some((r) => r.end === pb.e);
      if (lse) extra.liabWithLSE++;
    }
    if (key === "stockholdersEquity" && vb == null && va != null) {
      const nci = newestInstantHas(facts, "MinorityInterest").find((r) => r.end === pb.e && r.val);
      if (nci) extra.equityNciDiffers.push(`${symbol} NCI ${nci.val}`);
    }
    if (PROPOSED[key]) {
      const cb = allCells(before, key), ca = allCells(after, key);
      let movedAny = false;
      for (const [k, v] of cb) {
        if (v != null && ca.get(k) !== v) { t.altered.push(`${symbol} ${k} ${v} -> ${ca.get(k) ?? "GONE"}`); movedAny = true; }
      }
      if (movedAny) t.alteredSymbols++;
      for (const [k, v] of ca) if (v != null && cb.get(k) == null) t.cellsFilled++;
      // EACH CONCEPT ALONE against the shipped chains.
      for (const tag of PROPOSED[key]) {
        const c1 = allCells(alone[tag], key);
        const pc = perConcept[tag];
        const moved = [...cb].filter(([k, v]) => v != null && c1.get(k) !== v);
        for (const [k, v] of moved) pc.altered.push(`${symbol} ${k} ${v} -> ${c1.get(k) ?? "GONE"}`);
        if (moved.length) pc.alteredSymbols.push(symbol);
        for (const [k, v] of c1) if (v != null && cb.get(k) == null) pc.cellsFilled++;
        if (vb == null && valueOf(shown(alone[tag]), key) != null) pc.filledShown++;
      }
    }
  }
}

console.log(`\nREAD ${extra.read} of ${targets.length} (fetch failed ${extra.fetchFailed}, extract threw ${extra.extractFailed}); ` +
  `with a report-date record: ${extra.records}; ${((Date.now() - started) / 60000).toFixed(1)} min`);
console.log(`\nfield                       storedGap  gapBefore  filledAfter  stillMissing  altered(symbols)  cellsFilled  | rec:gapBefore rec:filled`);
for (const k of FIELDS) {
  const t = T[k];
  console.log(`${k.padEnd(28)}${String(t.storedGap).padStart(9)}${String(t.gapBefore).padStart(11)}${String(t.filledAfter).padStart(13)}` +
    `${String(t.stillMissing).padStart(14)}${String(t.altered.length).padStart(9)}(${t.alteredSymbols})${String(t.cellsFilled).padStart(13)}  | ` +
    `${String(t.recGapBefore).padStart(13)}${String(t.recFilled).padStart(11)}`);
}
console.log(`\nPER PROPOSED CONCEPT (each appended alone): shown-period fills · all cells filled · cells altered · symbols altered`);
for (const [tag, pc] of Object.entries(perConcept)) {
  console.log(`  ${tag.padEnd(40)} ${pc.filledShown}  ${pc.cellsFilled}  ${pc.altered.length}  ${pc.alteredSymbols.length}`);
  for (const l of pc.altered.slice(0, 15)) console.log(`      ALTERED ${l}`);
}
for (const k of FIELDS) {
  if (T[k].altered.length) {
    console.log(`\nALTERED ${k}: ${T[k].altered.length}`);
    for (const l of T[k].altered.slice(0, 40)) console.log(`  ${l}`);
  }
}
console.log(`\ntotalLiabilities gaps whose filer tags LiabilitiesAndStockholdersEquity on that date: ${extra.liabWithLSE} (NOT derived)`);
console.log(`equity fallbacks where the filer tags a nonzero MinorityInterest (total != parent): ${extra.equityNciDiffers.length}`);
for (const l of extra.equityNciDiffers.slice(0, 20)) console.log(`  ${l}`);
for (const k of FIELDS) if (samples[k].length) console.log(`\nfilled ${k} (sample): ${samples[k].join(" ")}`);
console.log(`\nJSON ${JSON.stringify({ shard, shards, read: extra.read, targets: targets.length, records: extra.records,
  fields: Object.fromEntries(FIELDS.map((k) => [k, { ...T[k], altered: T[k].altered.length }])),
  perConcept: Object.fromEntries(Object.entries(perConcept).map(([t, p]) => [t, { ...p, altered: p.altered.length, alteredSymbols: p.alteredSymbols.length }])),
  liabWithLSE: extra.liabWithLSE, equityNci: extra.equityNciDiffers.length })}`);
