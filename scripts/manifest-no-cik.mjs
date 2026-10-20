// Manifest symbols with no CIK, beside what the committed ticker maps say. Read-only (one GET).
import fs from "node:fs";
import { Redis } from "@upstash/redis";
const KEY = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_MANIFEST_KEY = "([^"]+)"/) ?? [])[1];
const man = await Redis.fromEnv().get(KEY);
const tick = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const ix = Object.fromEntries(tick.fields.map((f, i) => [f, i]));
const byT = new Map(tick.data.map((r) => [r[ix.ticker], r]));
const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const syms = Object.entries(man.symbols);
const none = syms.filter(([, e]) => !e?.cik);
console.log(`manifest symbols: ${syms.length}; without a CIK: ${none.length}\n`);
for (const [s, e] of none) {
  const alt = [s, s.replace(".", "-"), s.replace("-", ".")].find((t) => byT.has(t));
  console.log(`${s}\tentry=${JSON.stringify(e).slice(0, 160)}\tcompany-tickers=${alt ? `${alt}:${byT.get(alt)[ix.cik]} ${byT.get(alt)[ix.name]}` : "—"}\tcik-map=${cikMap[s] ?? "—"}`);
}
