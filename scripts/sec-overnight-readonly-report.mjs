// THE #191 ITEM 6 READ-ONLY REPORT (#552 COWORK #191). READ-ONLY.
//   R. ROLL-FORWARD: RY BMO BNS CM JEF NVS -- the stored next estimate against
//      what estimateUpcoming() gives today on the same record + fact set.
//   V. V's cover share count and its cover-review entry.
//   S. BABA RIO BBVA NVMI NMR -- valuationInputs (bare and with the cited ADS
//      ratio): shares, refusals, cover, and the newest diluted shares.
// Store: GET (fact sets, report dates) and HGET (cover review). Anything else
// is refused before it leaves. No SEC requests.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);

const READS = new Set(["get", "hget"]);
const counts = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    for (const c of Array.isArray(body?.[0]) ? body : [body]) {
      const op = String(c?.[0]).toLowerCase();
      if (!READS.has(op)) throw new Error(`read guard: ${op} refused`);
      counts[op] = (counts[op] ?? 0) + 1;
    }
  } else if (!url.startsWith("data:")) {
    throw new Error("read guard: only the store may be reached");
  }
  return realFetch(input, init);
};

const { valueOf } = await import("../lib/server/secFactCodec.ts");
const { valuationInputs } = await import("../lib/server/secValuation.ts");
const { estimateUpcoming, nextPeriodEndFrom } = await import("../lib/server/secReportDates.ts");
const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS_PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const RD_PREFIX = keyOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX") ?? keyOf("lib/server/secReportDatesStore.ts", "REPORT_DATES_PREFIX");
const COVER_REVIEW = keyOf("lib/server/secCoverReview.ts", "SEC_COVER_REVIEW_HASH");
if (!FACTS_PREFIX || !RD_PREFIX || !COVER_REVIEW) { console.error(`FATAL: a key moved ${FACTS_PREFIX} ${RD_PREFIX} ${COVER_REVIEW}`); process.exit(2); }
const ADS = JSON.parse(fs.readFileSync("data/sec/ads-ratios.json", "utf8")).entries;
const TODAY = new Date().toISOString().slice(0, 10);
const redis = Redis.fromEnv();
const set = async (s) => redis.get(`${FACTS_PREFIX}:${s}`);
const newest = (ps, k) => [...ps].filter((p) => valueOf(p, k) !== null).sort((a, b) => (a.e < b.e ? 1 : -1))[0] ?? null;

console.log(`today ${TODAY}\n\nR. ROLL-FORWARD`);
for (const s of ["RY", "BMO", "BNS", "CM", "JEF", "NVS"]) {
  const [fs_, rd] = [await set(s), await redis.get(`${RD_PREFIX}:${s}`)];
  if (!rd) { console.log(`  ${s}: no report-dates record`); continue; }
  const qe = (fs_?.quarters ?? []).map((p) => p.e).sort(), ye = (fs_?.years ?? []).map((p) => p.e).sort();
  const cad = nextPeriodEndFrom(qe, ye);
  const now = estimateUpcoming(rd.events ?? [], cad, rd.category, TODAY);
  console.log(`  ${s}: record at ${rd.at} · category ${rd.category ?? "?"} · stored next ${JSON.stringify(rd.next)} for ${rd.nextPeriodEnd}`);
  console.log(`      events: ${(rd.events ?? []).slice(0, 4).map((e) => `${e.periodEnd}→${e.announcedOn}`).join(" ")}`);
  console.log(`      set quarters ${qe.slice(-4).join(" ") || "none"} · years ${ye.slice(-2).join(" ") || "none"} · cadence ${JSON.stringify(cad)}`);
  console.log(`      today's estimate: ${JSON.stringify(now.estimate)} for ${now.periodEnd}`);
}

console.log("\nV. V's COVER");
{
  const v = await set("V");
  console.log(`  cover ${JSON.stringify(v?.cover ?? null)}`);
  console.log(`  cover-review entry ${JSON.stringify(await redis.hget(COVER_REVIEW, "V"))}`);
  const r = valuationInputs(v, TODAY, {});
  console.log(`  valuationInputs: shares ${JSON.stringify(r.shares)} refusals ${JSON.stringify(r.refusals)}`);
}

console.log("\nS. NO SHARES, NO REFUSAL");
for (const s of ["BABA", "RIO", "BBVA", "NVMI", "NMR"]) {
  const x = await set(s);
  if (!x) { console.log(`  ${s}: no fact set`); continue; }
  const d = newest([...x.quarters, ...x.years], "sharesDiluted");
  console.log(`  ${s}: cur ${x.cur ?? "USD"} · cover ${JSON.stringify(x.cover ?? null)} · newest diluted ${d ? `${valueOf(d, "sharesDiluted")} @ ${d.e}` : "none"}`);
  const a = ADS[s] && !ADS[s].withheld ? { ordinaryPerAds: ADS[s].ordinaryPerAds, source: ADS[s].source, kind: ADS[s].kind } : null;
  for (const [label, filer] of [["bare", {}], ["with ads", { annualForm: "20-F", ads: a }]]) {
    let r; try { r = valuationInputs(x, TODAY, filer); } catch (e) { r = { shares: null, refusals: [`threw: ${e.message}`] }; }
    console.log(`      ${label}: shares ${r.shares ? r.shares.val : null} · eps ${r.eps ? r.eps.val : null} · refusals ${JSON.stringify(r.refusals)}`);
  }
}
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
