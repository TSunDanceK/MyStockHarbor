// WHO HAS NO COVER SHARE COUNT IN THE PICKERS SEC HASH, AND WHY (#553 COWORK
// #175, A's #552 CODE-A #187 Finding B: WFC and JNJ). READ-ONLY, ENFORCED
// (GET, HMGET, HGETALL).
//
// For every pickers universe symbol: its row in msh:pickers:sec-fundamentals:v1
// (spelling-tolerant), whether `inputs.shares` is set, and if not, its
// share refusal; then A's cover-review entry (msh:sec:cover-review:v1), whose
// `why` says whether the class-axis fallback ran and why it gave up.
//
// PUBLIC LOG (#553): symbols, refusal codes, reason strings and counts only;
// never a share count, a price or a figure.
//
//   node scripts/share-count-gap-census.mjs   (relay: write-share-count-gap-census)
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "HMGET", "HGETALL"]);
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
const { symbolSpellings } = await import("../lib/symbolSpellings.mjs");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const SEC_KEY = "msh:pickers:sec-fundamentals:v1";
const REVIEW_KEY = "msh:sec:cover-review:v1";
const UNIVERSE_KEY = "msh:pickers:v10:symbols"; // PICKERS_SYMBOLS_KEY
// Written by name (scripts/pricepool-cap-gap-probe.mjs's list), independent of the field measured.
const LARGE_CAPS = ["NVDA","AAPL","MSFT","GOOGL","GOOG","AMZN","META","AVGO","TSLA","BRK-B","LLY","JPM","V","XOM","UNH","MA","COST","HD","PG","JNJ","WMT","NFLX","ABBV","BAC","CRM","ORCL","CVX","KO","AMD","PEP","TMO","LIN","ADBE","MRK","ACN","MCD","CSCO","ABT","PM","INTU","TXN","QCOM","IBM","GE","CAT","VZ","DIS","NOW","AMGN","INTC","WFC","GS","MS","C","AXP","BLK","SCHW","RTX","HON","UNP","SPGI","LOW","PFE","T","BKNG","ISRG","DE","LMT","SYK","MDT","ELV","CI","GILD","ADP","MMC","PLD","CB","MO","SO","DUK"];

let universe = parse(await redis.get(UNIVERSE_KEY));
universe = [...new Set((Array.isArray(universe) ? universe : []).map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
const names = [...new Set([...universe, ...LARGE_CAPS])];
const fields = [...new Set(names.flatMap((s) => symbolSpellings(s)))];
const rows = new Map();
for (let i = 0; i < fields.length; i += 200) {
  const slice = fields.slice(i, i + 200);
  const vals = await redis.hmget(SEC_KEY, ...slice);
  slice.forEach((f, j) => { const v = Array.isArray(vals) ? vals[j] : vals?.[f]; if (v) rows.set(f, parse(v)); });
}
const review = (await redis.hgetall(REVIEW_KEY)) ?? {};
const reviewOf = (sym) => { for (const s of symbolSpellings(sym)) if (review[s]) return parse(review[s]); return null; };
const rowOf = (sym) => { for (const s of symbolSpellings(sym)) if (rows.has(s)) return rows.get(s); return null; };
const SHARE_CODES = ["no-cover-share-count", "share-count-is-stale", "multi-class-share-count-is-ambiguous", "ads-ratio-makes-shares-incomparable", "ticker-is-a-debt-security"];
const classify = (sym) => {
  const r = rowOf(sym);
  if (!r) return { bucket: "no row" };
  if (r.inputs?.shares) return { bucket: "has shares" };
  const code = (r.inputs?.refusals ?? []).find((c) => SHARE_CODES.includes(c)) ?? "no shares, no share refusal";
  return { bucket: code, why: reviewOf(sym)?.why ?? "(no cover-review entry)" };
};
const tally = (list) => {
  const by = new Map();
  for (const s of list) { const c = classify(s); const k = c.bucket; if (!by.has(k)) by.set(k, []); by.get(k).push(c.why ? `${s} [${c.why}]` : s); }
  return by;
};
for (const [title, list] of [["Named large caps", LARGE_CAPS], ["Whole pickers universe", universe]]) {
  const by = tally(list);
  console.log(`\n${title} (${list.length}):`);
  for (const [k, v] of [...by].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(v.length).padStart(4)}  ${k}`);
    if (k !== "has shares") console.log(`        ${v.slice(0, 60).join(", ")}${v.length > 60 ? ", …" : ""}`);
  }
}
const whyCounts = new Map();
for (const s of universe) { const c = classify(s); if (c.why) whyCounts.set(c.why, (whyCounts.get(c.why) ?? 0) + 1); }
console.log("\nCover-review reasons among the universe's share gaps:");
for (const [k, v] of [...whyCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log(`\nRedis commands ${commands} (read-only: ${[...READ_VERBS].join(", ")})`);
