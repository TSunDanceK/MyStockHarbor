// WHICH LARGE COMPANIES THE ANALYSIS UNIVERSE MISSES, AND WHY (#553 COWORK #182).
// READ-ONLY, ENFORCED (GET, MGET, HMGET, HKEYS, ZRANGE, ZSCORE).
//
// Ranks every row of the picker SEC hash by cover shares x the latest stored
// Tiingo close (A's method, scripts/due-strip-rank.mjs), takes the top 300,
// and lists each one NOT in the analysis universe (msh:pickers:v10:symbols)
// with its rank and what it has: a dynamic-universe entry (score, last seen),
// a place in the Tiingo universe, stored EOD bars. Then the budget: how many
// of the gap already get nightly Tiingo bars (no new requests) and how many
// would need adding.
//
// PUBLIC LOG (#553): symbols, ranks, counts, ages in days. Never a price, a
// cap figure, a share count or a bar.
//
//   node scripts/universe-gap-census.mjs   (relay: write-universe-gap-census)
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "MGET", "HMGET", "HKEYS", "ZRANGE", "ZSCORE", "EXISTS"]);
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
const parse = (v) => { if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } } return v ?? null; };
const dashed = (s) => String(s).trim().toUpperCase().replace(/\./g, "-");
const TOP = Number(process.env.TOP || 300);

const secFields = await redis.hkeys("msh:pickers:sec-fundamentals:v1");
const fields = [...new Set(secFields.map(dashed))];
const sec = await redis.hmget("msh:pickers:sec-fundamentals:v1", ...fields);
const eod = await redis.hmget("msh:tiingo:eod-last:v1", ...fields);
const at = (raw, f, i) => parse(Array.isArray(raw) ? raw[i] : raw?.[f]);
const rows = fields.map((f, i) => ({ f, shares: Number(at(sec, f, i)?.inputs?.shares?.val), close: Number(at(eod, f, i)?.c), lastBar: at(eod, f, i)?.d ?? null }));
const ranked = rows.filter((r) => r.shares > 0 && r.close > 0).map((r) => ({ ...r, cap: r.shares * r.close })).sort((a, b) => b.cap - a.cap);
const top = ranked.slice(0, TOP);

const uni = new Set((parse(await redis.get("msh:pickers:v10:symbols")) ?? []).map(dashed));
const tiingoUni = new Set(((parse(await redis.get("msh:tiingo:universe:v1"))?.symbols) ?? []).map(dashed));
// The dynamic universe: score and last-seen per symbol.
const pairs = (raw) => { const m = new Map(); for (let i = 0; i + 1 < (raw ?? []).length; i += 2) m.set(dashed(raw[i]), Number(raw[i + 1])); return m; };
const score = pairs(await redis.zrange("msh:dynamic-universe:v2:score", 0, -1, { withScores: true }));
const seen = pairs(await redis.zrange("msh:dynamic-universe:v2:seen", 0, -1, { withScores: true }));
const now = Date.now();

const gap = top.map((r, i) => ({ ...r, rank: i + 1 })).filter((r) => !uni.has(r.f));
console.log(`SEC rows ${fields.length} · ranked (shares and a close) ${ranked.length} · top ${TOP} · analysis universe ${uni.size} · Tiingo universe ${tiingoUni.size} · dynamic universe ${score.size}`);
console.log(`\nIN THE TOP ${TOP} BUT NOT IN THE ANALYSIS UNIVERSE: ${gap.length}`);
for (const band of [50, 100, 150, 200, 300]) console.log(`  in the top ${band}: ${gap.filter((g) => g.rank <= band).length}`);
console.log("");
for (const g of gap) {
  const s = seen.get(g.f);
  console.log(`  #${String(g.rank).padStart(3)} ${g.f.padEnd(7)} tiingo-universe ${tiingoUni.has(g.f) ? "yes" : "NO "} · last bar ${g.lastBar ?? "none"} · dynamic ${score.has(g.f) ? `yes (seen ${s ? Math.round((now - s) / 86400000) + "d ago" : "?"})` : "no"}`);
}
const named = (process.env.NAMED || "TSM JNJ ARM WFC VZ DIS T WDC NET BMY BNS CVS PSX ASX MS").split(/\s+/);
console.log(`\nNAMED (COWORK #182): ${named.map((s) => { const r = ranked.findIndex((x) => x.f === dashed(s)); return `${s} ${uni.has(dashed(s)) ? "IN" : "out"}${r >= 0 ? ` #${r + 1}` : " (unranked)"}`; }).join(" · ")}`);
const noBars = gap.filter((g) => !tiingoUni.has(g.f)).length;
console.log(`\nBUDGET: of the ${gap.length}, ${gap.length - noBars} already get nightly Tiingo bars (no new request); ${noBars} would need adding to the Tiingo universe.`);
// How the analysis universe's members break down by source, for the "why".
const inDyn = [...uni].filter((s) => score.has(s)).length;
console.log(`analysis universe members with a dynamic-universe entry: ${inDyn} of ${uni.size}`);
// BEFORE AND AFTER #808 (#553 COWORK #189/#190): the universe as it stood on
// 2026-10-06 before the size slice, against today's. Symbols only.
{
  const fs = await import("node:fs");
  const before = new Set(fs.readFileSync(new URL("./universe-before-2026-10-06.txt", import.meta.url), "utf8").split(",").map((s) => s.trim()).filter(Boolean).map(dashed));
  const added = [...uni].filter((s) => !before.has(s)).sort();
  const dropped = [...before].filter((s) => !uni.has(s)).sort();
  const topSet = new Set(top.map((r) => r.f));
  const rankOf = (s) => { const r = ranked.findIndex((x) => x.f === s); return r >= 0 ? `#${r + 1}` : "unranked"; };
  console.log(`\nBEFORE #808: ${before.size} · NOW: ${uni.size}`);
  console.log(`NOW IN, NOT BEFORE: ${added.length} (of them in the top ${TOP}: ${added.filter((s) => topSet.has(s)).length})`);
  console.log(`  ${added.map((s) => `${s} ${rankOf(s)}`).join(" · ")}`);
  console.log(`DROPPED OUT: ${dropped.length}`);
  for (const s of dropped) console.log(`  ${s.padEnd(7)} cap rank ${rankOf(s)} · dynamic ${score.has(s) ? `yes (score ${score.get(s)})` : "no"}`);
}
console.log(`\nRedis commands ${commands} (read-only)`);
