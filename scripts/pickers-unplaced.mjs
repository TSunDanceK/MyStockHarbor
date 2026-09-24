// THE PICKERS NAMES THE SEC RESOLVER CANNOT PLACE (#552 COWORK #29). Reads
// the Pickers symbol list, resolves each exactly as lib/server/staticProfile's
// sicProfileFor does (filing override → SIC table → major group, from the
// committed files, dot/dash bridged), and prints the unplaced ones: missing
// sector or industry, with SIC, registrant row, description and size rank
// (SEC cover shares × pool price, rank only; 20-F/40-F ranked separately
// since their share counts are not in the price's unit). Reads only.
//   relay task: write-pickers-unplaced   Redis cost ≈ 36 commands.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { lookupSpellingIn } from "../lib/symbolSpellings.mjs";

const redis = Redis.fromEnv();
let commands = 0;
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const REG = read("data/sec/registrants.json").rows;
const TABLE = read("data/sec/sic-classification.json");
const OVR = read("data/sec/classification-overrides.json").overrides;
const DESC = read("data/sec/descriptions.json");
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
function resolve(s) {
  const o = lookupSpellingIn(OVR, s)?.value;
  if (o && (clean(o.sector) || clean(o.industry))) return { sector: clean(o.sector), industry: clean(o.industry), from: "filing" };
  const code = lookupSpellingIn(REG, s)?.value?.sic;
  if (!code) return { sector: null, industry: null, from: "no-sic" };
  const row = TABLE.codes[code];
  return { sector: clean(row?.sector) ?? clean(row ? null : TABLE.majorGroups[code.slice(0, 2)]), industry: clean(row?.industry), from: "sic" };
}
commands++;
const u = ((await redis.get(keyOf("lib/server/pickersBuilder.ts", "PICKERS_SYMBOLS_KEY"))) ?? []).map((s) => String(s).toUpperCase());
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const price = new Map(), shares = new Map();
for (let i = 0; i < u.length; i += 100) {
  const c = u.slice(i, i + 100); commands++;
  const rows = await redis.hmget("msh:price-pool:v1", ...c);
  c.forEach((s, j) => { const p = Array.isArray(rows) ? rows[j] : rows?.[s]; if (typeof p?.price === "number") price.set(s, p.price); });
}
for (let i = 0; i < u.length; i += 25) {
  const c = u.slice(i, i + 25); commands++;
  const v = await redis.mget(...c.map((s) => `${FACTS}:${s}`));
  c.forEach((s, j) => { if (typeof v[j]?.cover?.val === "number") shares.set(s, v[j].cover.val); });
}
const foreign = (s) => /^(20-F|40-F)/.test(lookupSpellingIn(REG, s)?.value?.annualForm ?? "");
const rankOf = (list) => new Map(list.filter((s) => price.has(s) && shares.has(s)).sort((a, b) => price.get(b) * shares.get(b) - price.get(a) * shares.get(a)).map((s, i) => [s, i + 1]));
const rDom = rankOf(u.filter((s) => !foreign(s))), rFor = rankOf(u.filter(foreign));
const out = [];
let noRow = [];
for (const s of u) {
  const reg = lookupSpellingIn(REG, s)?.value;
  if (!reg) noRow.push(s);
  const r = resolve(s);
  if (r.sector && r.industry) continue;
  const d = lookupSpellingIn(DESC.rows, s)?.value;
  const miss = lookupSpellingIn(DESC.misses ?? {}, s)?.value;
  out.push({ s, rank: foreign(s) ? `F${rFor.get(s) ?? "-"}` : String(rDom.get(s) ?? "-"), sic: reg?.sic ?? "none", sicD: reg?.sicDescription ?? "", form: reg?.annualForm ?? "?",
    sector: r.sector, industry: r.industry, desc: d ? `${d[0]} ${String(d[3]).slice(0, 150).replace(/\s+/g, " ")}` : `NO DESC (${miss ?? "no row"})` });
}
const num = (x) => (x.rank.startsWith("F") ? 10000 + (Number(x.rank.slice(1)) || 9999) : Number(x.rank) || 9999);
out.sort((a, b) => num(a) - num(b));
console.log(`pickers universe ${u.length}; unplaced ${out.length} (no sector ${out.filter((x) => !x.sector).length}, sector but no industry ${out.filter((x) => x.sector && !x.industry).length}); top-100 domestic unplaced ${out.filter((x) => !x.rank.startsWith("F") && Number(x.rank) <= 100).length}`);
console.log(`no registrants row: ${noRow.length}: ${noRow.join(" ")}`);
console.log(`\nrank | symbol | SIC | form | sector | industry | description`);
for (const x of out) console.log(`U ${x.rank} | ${x.s} | ${x.sic} ${x.sicD} | ${x.form} | ${x.sector ?? "—"} | ${x.industry ?? "—"} | ${x.desc}`);
console.log(`\nRedis commands used by this read: ${commands}`);
