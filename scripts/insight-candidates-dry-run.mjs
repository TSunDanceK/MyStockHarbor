// THE INSIGHT CANDIDATES OVER THE LAST 5 SESSIONS, DRY (#553 COWORK #181/#188/#190).
// READ-ONLY, ENFORCED. Writes nothing; prints each session's list as the writer
// would receive it (the read path's 30-day repeat rule applied against
// content/insights in this checkout).
//
// Per session: every stored bar cut at that session, the real
// selectInsightCandidates, then finalInsightCandidates. Limits, said plainly:
// the SEC rows, report-date records and search demand are TODAY's for every
// session, so "results this week" uses today's estimate of the next date.
//
// PUBLIC LOG: tickers, event labels, dates, size buckets, counts. No price, no bar.
//
//   node scripts/insight-candidates-dry-run.mjs   (relay: write-insight-candidates-dry-run)
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "MGET", "HGETALL", "HKEYS", "HMGET", "ZRANGE"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    if (!cmds.length) throw new Error("dry run is read-only: refused a request with no readable command");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`dry run is read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const C = await import("../lib/server/insightCandidates.ts");
const { PICKERS_SEC_KEY, toSecCapRow } = await import("../lib/server/pickersSecFundamentals.ts");
const { tiingoEodKey } = await import("../lib/server/marketData/keys.ts");
const { readReportDatesBulk } = await import("../lib/server/secReportDatesStore.ts");
const { readSearchDemand } = await import("../lib/server/searchDemand.ts");
const { getAllPosts } = await import("../lib/blog.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const SESSIONS = Number(process.env.SESSIONS || 5);

const rawRows = (await redis.hgetall(PICKERS_SEC_KEY)) ?? {};
const secRows = {};
for (const [f, v] of Object.entries(rawRows)) { const r = parse(v); if (r && r.inputs) secRows[f] = toSecCapRow(r); }
// Bars for every SEC symbol (the size ranking needs each one's close), 25 a MGET.
const syms = [...new Set(Object.keys(secRows).map(toDashed))];
const bars = new Map();
for (let i = 0; i < syms.length; i += 25) {
  const chunk = syms.slice(i, i + 25);
  const vals = await redis.mget(...chunk.map((s) => tiingoEodKey(s)));
  chunk.forEach((s, k) => { const e = parse(vals[k]); if (e && Array.isArray(e.bars) && e.bars.length) bars.set(s, e.bars); });
}
const demand = await readSearchDemand(50);
const top = C.capRanked(bars, secRows).slice(0, C.INSIGHT_UNIVERSE + 40).map((x) => x.symbol);
const rd = await readReportDatesBulk([...new Set([...top, ...demand.map((d) => toDashed(d.symbol))])]);
const reportDates = rd.ok ? rd.recs : new Map();
const posts = getAllPosts();

const count = new Map();
for (const b of bars.values()) for (const x of b.slice(-SESSIONS - 3)) count.set(x[0], (count.get(x[0]) ?? 0) + 1);
const sessions = [...count.entries()].filter(([, n]) => n >= bars.size * 0.5).map(([d]) => d).sort().slice(-SESSIONS);
console.log(`SEC rows ${Object.keys(secRows).length} · with bars ${bars.size} · report-date records ${rd.ok ? [...reportDates.values()].filter(Boolean).length : "read failed"} · posts ${posts.length} · sessions ${sessions.join(", ")}`);
for (const asOf of sessions) {
  const cut = new Map();
  for (const [s, b] of bars) { const c = b.filter((x) => x[0] <= asOf); if (c.length) cut.set(s, c); }
  const value = C.selectInsightCandidates({ asOf, bars: cut, secRows, reportDates, demand }, new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  const bad = C.insightKeyViolations(value);
  const fin = C.finalInsightCandidates(value, posts);
  console.log(`\n── ${asOf} ── ranked ${value.ranked.length}${bad.length ? ` · GUARD FAILED: ${bad[0]}` : ""}`);
  fin.candidates.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. ${c.symbol.padEnd(6)} ${c.capBucket.padEnd(5)} ${c.events.join(", ")}`));
  console.log(`  buzz: ${fin.buzz ? `${fin.buzz.symbol} (${fin.buzz.capBucket}) ${fin.buzz.events.join(", ")}` : "none"}`);
  if (fin.repeats.length) console.log(`  left out, posted within ${C.INSIGHT_REPEAT_DAYS} days: ${fin.repeats.join(" ")}`);
  if (value.excluded.length) console.log(`  left out by #188: ${value.excluded.map((e) => `${e.symbol} (${e.why})`).join(" ")}`);
}
console.log(`\nRedis commands ${commands} (read-only)`);
