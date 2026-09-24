// WHY PICKERS MARKET CAPS ARE REFUSED ON THE SHARE COUNT (#552 COWORK #31).
// For every Pickers symbol whose shipped valuationInputs refuses the share
// count for a reason OTHER than the ADS ratio ("no-cover-share-count",
// "share-count-is-stale", "multi-class-share-count-is-ambiguous"):
//   - the stored cover (asOf, value) and companyfacts' newest UNdimensioned
//     dei:EntityCommonStockSharesOutstanding (what the extractor can see);
//   - the newest 10-Q/10-K's own XBRL instance: EVERY cover-page share fact,
//     with its date and class-dimension member (what companyfacts drops).
// SEC values only; the Redis read is the symbol list and the stored sets.
//   relay task: write-cover-shares-refusals   Redis ≈ 30 commands.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const V = await import("../lib/server/secValuation.ts");
const { secFieldsHash } = await import("../lib/server/secFields.ts");
const { pickInstanceName } = await import("../lib/server/secFilingFill.ts");
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; cover shares probe)";
const TODAY = new Date().toISOString().slice(0, 10);
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
let commands = 1;
const u = ((await redis.get(keyOf("lib/server/pickersBuilder.ts", "PICKERS_SYMBOLS_KEY"))) ?? []).map((s) => String(s).toUpperCase());
const sets = new Map();
for (let i = 0; i < u.length; i += 25) {
  const c = u.slice(i, i + 25); commands++;
  const v = await redis.mget(...c.map((s) => `${FACTS}:${s}`));
  c.forEach((s, j) => { if (v[j]?.h === secFieldsHash()) sets.set(s, v[j]); });
}
const reg = (s) => REG[s] ?? REG[s.replace(".", "-")];
const refused = [];
const tally = new Map();
for (const s of u) {
  const set = sets.get(s);
  if (!set) continue;
  const r = V.valuationInputs(set, TODAY, { annualForm: reg(s)?.annualForm ?? null }).refusals;
  const why = r.find((x) => ["no-cover-share-count", "share-count-is-stale", "multi-class-share-count-is-ambiguous"].includes(x));
  if (!why || r.includes("ads-ratio-makes-shares-incomparable")) continue;
  tally.set(why, (tally.get(why) ?? 0) + 1);
  refused.push({ s, why, cover: set.cover, cik: set.cik ?? reg(s)?.cik });
}
console.log(`pickers ${u.length}; sets read ${sets.size}; non-ADS share-count refusals ${refused.length}: ${[...tally].map(([k, v]) => `${k} ${v}`).join(", ")}`);
const get = async (url) => { const r = await fetch(url, { headers: { "User-Agent": UA } }); await new Promise((x) => setTimeout(x, 130)); return r; };
for (const x of refused) {
  const cik = String(x.cik ?? "").padStart(10, "0");
  let line = `\n== ${x.s} | ${x.why} | stored cover ${x.cover ? `${x.cover.val ?? "—"} @ ${x.cover.asOf}${x.cover.candidates ? ` candidates ${x.cover.candidates.join("/")}` : ""}` : "none"}`;
  try {
    const cf = await (await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`)).json();
    const rows = cf.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? [];
    const newest = rows.map((r) => r.end).sort().at(-1);
    line += ` | companyfacts dei newest ${newest ?? "none"} (${rows.filter((r) => r.end === newest).length} row(s))`;
    const subs = await (await get(`https://data.sec.gov/submissions/CIK${cik}.json`)).json();
    const rec = subs.filings?.recent ?? {};
    const i = (rec.form ?? []).findIndex((f) => /^(10-Q|10-K)$/.test(f));
    if (i < 0) { console.log(`${line} | no 10-Q/10-K`); continue; }
    const accn = rec.accessionNumber[i], base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}`;
    const idx = await (await get(`${base}/index.json`)).json();
    const name = pickInstanceName((idx.directory?.item ?? []).map((it) => String(it.name ?? "")));
    if (!name) { console.log(`${line} | ${rec.form[i]} ${accn}: no instance`); continue; }
    const xml = await (await get(`${base}/${name}`)).text();
    const ctx = new Map();
    for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
      const inst = m[2].match(/<(?:[\w-]+:)?instant>\s*([\d-]+)/)?.[1];
      const mem = [...m[2].matchAll(/<(?:[\w-]+:)?explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)/g)].map((y) => `${y[1].replace(/^.*:/, "")}=${y[2].replace(/^.*:/, "")}`);
      ctx.set(m[1], { inst, mem });
    }
    const facts = [...xml.matchAll(/<dei:EntityCommonStockSharesOutstanding\b[^>]*contextRef="([^"]+)"[^>]*>([^<]+)</g)]
      .map((m) => { const c = ctx.get(m[1]) ?? {}; return `${c.inst ?? "?"} ${c.mem?.length ? c.mem.join("&") : "(no dimension)"} ${Number(m[2]).toLocaleString("en-US")}`; });
    const cls = [...xml.matchAll(/<dei:Security12bTitle\b[^>]*>([^<]+)</g)].map((m) => m[1].trim()).slice(0, 4);
    console.log(`${line} | ${rec.form[i]} ${rec.filingDate[i]} ${accn}\n   cover facts: ${facts.join("; ") || "none"}\n   12(b) titles: ${cls.join(" | ") || "—"}`);
  } catch (e) { console.log(`${line} | error ${String(e?.message ?? e).slice(0, 80)}`); }
}
console.log(`\nRedis commands used by this read: ${commands}`);
