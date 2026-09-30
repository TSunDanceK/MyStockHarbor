// READS ONLY: is each named symbol still COLD (no stored fact set) and does it
// have a CIK in the committed ticker map? For the owner's cold-fill test
// (#552 COWORK #71, #612). Redis: 1 EXISTS per symbol. Tickers only.
//   relay task: write-cold-symbol, symbols "A,B,C"
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const src = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const FACTS = (src.match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? [])[1];
if (!FACTS) { console.error("FATAL: key name not found"); process.exit(2); }
const map = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const ti = map.fields.indexOf("ticker");
const tickers = new Set(map.data.map((r) => String(r[ti]).toUpperCase()));
const hasCik = (s) => tickers.has(s) || tickers.has(s.replace(".", "-"));
const syms = String(process.env.SYMBOLS ?? "").split(/[,\s]+/).filter(Boolean).map((s) => s.toUpperCase()).slice(0, 20);
for (const s of syms) console.log(`${s.padEnd(6)} ${(await redis.exists(`${FACTS}:${s}`)) ? "stored" : "COLD"} · CIK in map ${hasCik(s) ? "yes" : "no"}`);
console.log(`Redis commands: ${syms.length}`);
