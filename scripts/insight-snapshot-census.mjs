// WHICH POSTS THE FMP-ERA INSIGHT SNAPSHOTS BELONG TO (#553 COWORK #171), and
// what deleting each would do. READ-ONLY, ENFORCED (SCAN, GET, MGET).
//
// For every insight-snapshot:<slug> key: the post's frontmatter symbol and
// date (content/insights/<slug>.md), whether the record is FMP-era (not
// source "tiingo"), and whether the stored Tiingo EOD bars hold at least 2
// sessions. lib/insightSnapshots.ts rebuilds a deleted record from those bars
// when PRICE_PROVIDER_CHARTS=tiingo (with today's figures, not the post's);
// with fewer than 2 bars, or CHARTS not on Tiingo, the chart is lost.
//
// PUBLIC LOG (#553): slugs, symbols, dates and session COUNTS only; never a
// price, a bar or a record's figures.
//
//   node scripts/insight-snapshot-census.mjs   (relay: write-insight-snapshot-census)
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["SCAN", "GET", "MGET"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    if (!cmds.length) throw new Error("census is read-only: refused a request with no readable command");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`census is read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const { tiingoEodKey } = await import("../lib/server/marketData/keys.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

const keys = [];
let cursor = "0";
do {
  const [next, batch] = await redis.scan(cursor, { match: "insight-snapshot:*", count: 1000 });
  cursor = String(next);
  keys.push(...batch.map(String));
} while (cursor !== "0");
keys.sort();

const front = (slug) => {
  const f = path.join(process.cwd(), "content", "insights", `${slug}.md`);
  if (!fs.existsSync(f)) return null;
  const head = fs.readFileSync(f, "utf8").split(/^---\s*$/m)[1] ?? "";
  const field = (k) => (head.match(new RegExp(`^${k}:\\s*"?([^"\\n]+)"?`, "m"))?.[1] ?? "").trim();
  return { symbol: field("symbol").toUpperCase(), date: field("date") };
};

const rows = [];
for (let i = 0; i < keys.length; i += 20) {
  const slice = keys.slice(i, i + 20);
  const recs = await redis.mget(...slice);
  for (let j = 0; j < slice.length; j++) {
    const slug = slice[j].slice("insight-snapshot:".length);
    const rec = parse(recs[j]);
    const fmpEra = !!rec && typeof rec === "object" && rec.source !== "tiingo";
    const fm = front(slug);
    const symbol = fm?.symbol || (rec && typeof rec.symbol === "string" ? rec.symbol.toUpperCase() : "");
    let sessions = 0;
    if (symbol) {
      const e = parse(await redis.get(tiingoEodKey(toDashed(symbol))));
      sessions = e && Array.isArray(e.bars) ? e.bars.length : 0;
    }
    rows.push({ slug, symbol: symbol || "?", date: fm?.date || "?", post: !!fm, fmpEra, sessions });
  }
}

const verdict = (r) => !r.fmpEra ? "kept (Tiingo record)" : r.sessions >= 2 ? "rebuilds, today's figures" : "CHART LOST";
console.log(`insight snapshots: ${rows.length} · FMP-era ${rows.filter((r) => r.fmpEra).length} · with no post file ${rows.filter((r) => !r.post).length}\n`);
console.log("post date   | symbol | stored sessions | if deleted (CHARTS=tiingo)      | slug");
for (const r of rows.sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug)))
  console.log(`${r.date.padEnd(11)} | ${r.symbol.padEnd(6)} | ${String(r.sessions).padStart(15)} | ${verdict(r).padEnd(31)} | ${r.slug}${r.post ? "" : "  (no post file)"}`);
const lost = rows.filter((r) => r.fmpEra && r.sessions < 2);
console.log(`\nIf deleted with PRICE_PROVIDER_CHARTS=tiingo: ${rows.filter((r) => r.fmpEra && r.sessions >= 2).length} rebuild with today's figures, ${lost.length} lose the chart.`);
console.log("If CHARTS is not on Tiingo: every deleted FMP-era record loses its chart (no FMP key).");
console.log(`\nRedis commands ${commands} (read-only: ${[...READ_VERBS].join(", ")})`);
