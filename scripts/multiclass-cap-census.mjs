// MULTI-CLASS MARKET CAP, MEASURED BEFORE BUILDING (#552 COWORK #26). Reads only.
//
// Pickers shows Market Cap "–" where secValuation refuses a multi-class cover
// page (the extractor stored `cover.candidates` instead of one count), e.g.
// CMCSA and ACN. The proposed rule: where the classes are economically equal
// (1:1 convertible, same dividend), cap = total shares across classes × the
// listed class's price, cited from the cover page and the charter. This
// counts how many Pickers-universe names that could recover, and lists them
// with SEC's own values only (the per-class counts and the sibling tickers
// sharing their CIK) so each can be checked against its charter by hand.
//
//   relay task: write-multiclass-cap-census  (credentialled for the read)
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
let commands = 0;
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const SYMBOLS_KEY = keyOf("lib/server/pickersBuilder.ts", "PICKERS_SYMBOLS_KEY");
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
if (!SYMBOLS_KEY || !FACTS) { console.error("FATAL: key names not readable"); process.exit(2); }

const tickers = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikOf = new Map(tickers.data.map(([cik, , t]) => [String(t).toUpperCase(), String(cik)]));
const byCik = new Map();
for (const [t, c] of cikOf) byCik.set(c, [...(byCik.get(c) ?? []), t]);

commands++;
const u1 = ((await redis.get(SYMBOLS_KEY)) ?? []).map((s) => String(s).toUpperCase());
const sets = new Map();
for (let i = 0; i < u1.length; i += 25) {
  const chunk = u1.slice(i, i + 25);
  commands++;
  const vals = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
  chunk.forEach((s, j) => { if (vals[j]) sets.set(s, vals[j]); });
}

const rows = [];
let single = 0, none = 0, stale = 0;
for (const s of u1) {
  const c = sets.get(s)?.cover ?? null;
  if (!c) { none++; continue; }
  if (Array.isArray(c.candidates) && c.candidates.length) {
    const cik = cikOf.get(s.replace(".", "-")) ?? cikOf.get(s) ?? null;
    rows.push({ s, asOf: c.asOf, candidates: c.candidates, total: c.candidates.reduce((a, b) => a + b, 0), siblings: cik ? (byCik.get(cik) ?? []).filter((t) => t !== s) : [] });
  } else if (typeof c.val === "number") single++;
  else stale++;
}
console.log(`Pickers universe: ${u1.length}; fact sets read: ${sets.size}`);
console.log(`cover: single count ${single}; multi-class (candidates) ${rows.length}; no usable cover ${none + stale}`);
console.log(`\nmulti-class filers (SEC values only): symbol | cover asOf | per-class counts | total | other tickers on the same CIK`);
for (const r of rows.sort((a, b) => a.s.localeCompare(b.s))) {
  console.log(`  ${r.s} | ${r.asOf} | ${r.candidates.map((v) => v.toLocaleString("en-US")).join(" / ")} | ${r.total.toLocaleString("en-US")} | ${r.siblings.join(" ") || "none listed"}`);
}
const oneListed = rows.filter((r) => r.siblings.length === 0).length;
console.log(`\nof ${rows.length}: ${oneListed} have ONE listed ticker on their CIK (price × total is well-defined if the classes are equal); ${rows.length - oneListed} list several classes (each class has its own price; needs the per-class rule)`);
console.log(`Redis commands used by this read: ${commands}`);
