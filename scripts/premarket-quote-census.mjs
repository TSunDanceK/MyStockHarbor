// THE PRE-MARKET QUOTE, MEASURED (#553 COWORK #222, step 1).
//
// The audit (13 Oct) saw stock pages show an early-morning IEX quote as "the
// close on Mon 12 Oct", paired with 12 Oct's day range and the 9 Oct close as
// "Prev close". This reads, for the audited symbols, what is actually stored:
// the last two EOD bars (msh:tiingo:eod:v1:<SYM>) and the IEX quote row
// (msh:tiingo:quotes:v1), and reports
//   - the stored last bar's date, and whether the audit's "real close" figure
//     matches it (yes/no and the % gap), so the audit's numbers are confirmed
//     against our own bars without printing them;
//   - the quote's sale time in ET and its session (pre-market / regular /
//     after-hours / weekend), and the quote's % gap from the stored close;
//   - whether the quote sits outside the stored last bar's high/low (the
//     "above the day high / below the day low" contradiction the page shows).
//
// READ-ONLY, ENFORCED (GET, MGET, HMGET only). PUBLIC LOG (#553): dates,
// times, %, yes/no and symbols only. No price is printed.
//
//   node scripts/premarket-quote-census.mjs     (relay: write-premarket-quote-census)
import { register } from "node:module";
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "MGET", "HMGET"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`census is read-only: refused ${c?.[0]}`);
    commands += cmds.length || 1;
  }
  return realFetch(input, init);
};
const redis = (await import("@upstash/redis")).Redis.fromEnv({ automaticDeserialization: false });
const { tiingoEodKey, TIINGO_QUOTES_KEY } = await import("../lib/server/marketData/keys.ts");
const parse = (v) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return null; } };

// The audit's published figures (#553 COWORK #222), compared, never printed back.
const CLAIMS = {
  INTC: { close: 101.35 },
  SOFI: { close: 15.23 },
  QQQ: { close: 746.04 },
  AAPL: { high: 342.63 },
};
const SYMBOLS = ["AAPL", "INTC", "SOFI", "QQQ", "AMZN", "GOOGL", "JPM", "UNH", "AMD", "NIO", "COIN", "UBER", "ZS", "SPY", "GLD", "MSFT", "META", "ORCL", "MU", "WFC"];

const etParts = (ms) => {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, wd: p.weekday, hm: `${p.hour}:${p.minute}`, mins: Number(p.hour) * 60 + Number(p.minute) };
};
const session = (ms) => {
  const t = etParts(ms);
  if (t.wd === "Sat" || t.wd === "Sun") return "weekend";
  if (t.mins < 9 * 60 + 30) return "pre-market";
  if (t.mins >= 16 * 60) return "after-hours";
  return "regular";
};
const pct = (a, b) => (b ? ((a / b - 1) * 100) : NaN);
const f2 = (x) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(2)}%` : "n/a");

const eod = await redis.mget(...SYMBOLS.map((s) => tiingoEodKey(s)));
const quotes = await redis.hmget(TIINGO_QUOTES_KEY, ...SYMBOLS);
const qArr = Array.isArray(quotes) ? quotes : SYMBOLS.map((s) => quotes?.[s] ?? null);

console.log(`now (ET): ${etParts(Date.now()).day} ${etParts(Date.now()).hm} · session ${session(Date.now())}\n`);
console.log("symbol | last bar | prev bar | quote time ET (session) | quote vs last close | quote outside last bar's range | audit figure matches stored");
let outside = 0, preOrAfter = 0;
SYMBOLS.forEach((sym, i) => {
  const e = parse(eod[i]);
  const bars = Array.isArray(e?.bars) ? e.bars : [];
  const last = bars[bars.length - 1], prev = bars[bars.length - 2];
  const q = parse(qArr[i]);
  const lastClose = last?.[4], lastHigh = last?.[2], lastLow = last?.[3];
  let qCell = "no quote", vs = "n/a", out = "n/a";
  if (q && typeof q.price === "number" && Number.isFinite(q.at)) {
    const t = etParts(q.at), s = session(q.at);
    if (s !== "regular") preOrAfter++;
    qCell = `${t.day} ${t.hm} (${s})`;
    vs = f2(pct(q.price, lastClose));
    const o = q.price > lastHigh ? "above high" : q.price < lastLow ? "below low" : "inside";
    if (o !== "inside") outside++;
    out = o;
  }
  const c = CLAIMS[sym];
  let audit = "";
  if (c?.close) audit = `real close ${Math.abs(pct(c.close, lastClose)) < 0.005 ? "= stored last close" : `≠ stored last close (${f2(pct(c.close, lastClose))})`}`;
  if (c?.high) audit = `day high ${Math.abs(pct(c.high, lastHigh)) < 0.005 ? "= stored last bar's high" : `≠ stored last bar's high (${f2(pct(c.high, lastHigh))})`}`;
  console.log(`${sym} | ${last?.[0] ?? "none"} | ${prev?.[0] ?? "none"} | ${qCell} | ${vs} | ${out} | ${audit}`);
});
console.log(`\n${SYMBOLS.length} symbols · quotes outside the regular session ${preOrAfter} · quotes outside the last bar's high/low ${outside}`);
console.log(`Redis commands ${commands} (read-only: ${[...READ_VERBS].join(", ")})`);
