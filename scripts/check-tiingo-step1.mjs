// Tiingo step 1 (#553 COWORK #55 §2, #56, #57): the adapter, its limiter, the
// two jobs, the read-layer helpers, and the wiring around them.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. A TIINGO CALL FROM THE WRONG PLACE: a preview or `next build` spends the
//      account's requests (the key is set for Preview too).
//   2. THE LIMITER FAILS OPEN: a Redis error, or a count over 80% of the
//      contract caps, still lets requests out. Tiingo sends no rate-limit
//      headers (CODE-B #47), so this counter is the only meter there is.
//   3. THE WRONG SPELLING: our EP-PC is Tiingo's EP-P-C; a miss is a silent gap.
//   4. THE JOBS WRITE OUTSIDE msh:tiingo:, so the §7 purge misses a key.
//   5. THE NIGHT IS STAMPED COMPLETE WHEN IT IS NOT, so the retry never runs;
//      or it runs before tonight's date has landed and stores yesterday.
//   6. THE FRESHNESS KNOB DRIFTS from its cron line.
//   7. THE ATTRIBUTION IS MISSING (contract §5.4.1 is a breach if absent).
//
// Section 1 runs the real modules against a stubbed network (Upstash REST and
// the Tiingo host). Section 3 plants mutants of the adapter; each must fail.
//
//   node scripts/check-tiingo-step1.mjs
import { register } from "node:module";
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const REDIS = "https://fake-redis.test";
process.env.UPSTASH_REDIS_REST_URL = REDIS;
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
const PROD = { VERCEL_ENV: "production", TIINGO_API_KEY: "test-key" };
const setEnv = (env) => {
  for (const k of ["VERCEL_ENV", "TIINGO_API_KEY", "NEXT_PHASE"]) delete process.env[k];
  Object.assign(process.env, env);
};

// ── the stubbed network ──────────────────────────────────────────────────────
const net = {
  redisStatus: 200,
  counters: new Map(),
  strings: new Map(),
  hashes: new Map(),
  expires: new Map(),
  tiingo: [],
  redisCmds: [],
  bulkDate: "2026-09-24",
  iex: null,
  shortTickers: [],
};
const reset = () => {
  net.redisStatus = 200;
  net.counters = new Map();
  net.strings = new Map();
  net.hashes = new Map([["msh:price-pool:v1", new Map([["AAPL", "{}"], ["EP-PC", "{}"], ["BRK-B", "{}"]])]]);
  net.expires = new Map();
  net.tiingo = [];
  net.redisCmds = [];
  net.bulkDate = "2026-09-24";
  net.iex = null;
  net.shortTickers = [];
  globalThis.__nextCacheStub = { revalidated: [], cached: [] };
};
const b64 = (v) => (typeof v === "string" ? Buffer.from(v).toString("base64") : Array.isArray(v) ? v.map(b64) : v);
function redisAnswer(cmd) {
  net.redisCmds.push(cmd);
  const [op, key, ...rest] = cmd.map((x) => (typeof x === "string" ? x : String(x)));
  switch (op.toLowerCase()) {
    case "incrby": { const v = (net.counters.get(key) ?? 0) + Number(rest[0]); net.counters.set(key, v); return v; }
    case "expire": net.expires.set(key, Number(rest[0])); return 1;
    case "hkeys": return [...(net.hashes.get(key)?.keys() ?? [])];
    case "hset": { const h = net.hashes.get(key) ?? new Map(); for (let i = 0; i < rest.length; i += 2) h.set(rest[i], rest[i + 1]); net.hashes.set(key, h); return rest.length / 2; }
    case "hgetall": return [...(net.hashes.get(key) ?? new Map()).entries()].flat();
    case "get": return net.strings.get(key) ?? null;
    case "set": { net.strings.set(key, rest[0]); const ex = rest.findIndex((x) => x.toLowerCase() === "ex"); if (ex >= 0) net.expires.set(key, Number(rest[ex + 1])); return "OK"; }
    default: return null;
  }
}
const csv = (rows) => ["date,close,high,low,open,volume,adjClose,adjHigh,adjLow,adjOpen,adjVolume,divCash,splitFactor", ...rows].join("\n");
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (url.startsWith(REDIS)) {
    if (net.redisStatus !== 200) return new Response(JSON.stringify({ error: "ERR limit" }), { status: net.redisStatus });
    const body = JSON.parse(init.body ?? "null");
    const encode = String(init.headers?.["Upstash-Encoding"] ?? init.headers?.["upstash-encoding"] ?? "").toLowerCase() === "base64" || true;
    const out = (v) => (encode ? b64(v) : v);
    if (/\/pipeline|\/multi-exec/.test(url)) return new Response(JSON.stringify(body.map((c) => ({ result: out(redisAnswer(c)) }))), { status: 200 });
    return new Response(JSON.stringify({ result: out(redisAnswer(body)) }), { status: 200 });
  }
  if (url.startsWith("https://api.tiingo.com")) {
    net.tiingo.push(url.replace("https://api.tiingo.com", ""));
    const u = new URL(url);
    if (u.pathname === "/iex/") {
      const rows = net.iex ?? [
        { ticker: "AAPL", last: 250.5, tngoLast: 250.5, open: 249, high: 251, low: 248, prevClose: 248.5, lastSaleTimestamp: "2026-09-24T11:00:00-04:00" },
        { ticker: "EP-P-C", last: null, tngoLast: 50.1, open: 50, high: 50.2, low: 49.9, prevClose: 50, timestamp: "2026-09-24T11:00:00-04:00" },
        { ticker: "BRK-B", last: null, tngoLast: null, timestamp: "2026-09-24T11:00:00-04:00" },
      ];
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (u.pathname === "/tiingo/daily/prices") {
      const lines = ["ticker,date,close,high,low,open,volume,adjClose,adjHigh,adjLow,adjOpen,adjVolume,divCash,splitFactor"];
      for (const t of ["AAPL", "EP-P-C", "BRK-B", "ZZZ"]) lines.push(`${t},${net.bulkDate},1,1,1,1,1,1,1,1,1,1,0,1`);
      return new Response(lines.join("\n"), { status: 200 });
    }
    const m = u.pathname.match(/^\/tiingo\/daily\/([^/]+)\/prices$/);
    if (m) {
      // 40 weekdays ending 2026-09-24; a ticker in net.shortTickers answers 5.
      const n = net.shortTickers.includes(decodeURIComponent(m[1])) ? 5 : 40;
      const rows = [];
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(2026, 8, 24) - i * 86_400_000).toISOString().slice(0, 10);
        rows.push(`${d},10,11,9,10,100,10,11,9,10,100,0,1`);
      }
      return new Response(csv(rows), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }
  return new Response("unexpected host", { status: 599 });
};

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

let seq = 0;
async function loadCopy(src) {
  const file = path.join(ROOT, "lib/server/marketData", `.check-step1-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, src);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

// ── the adapter suite (also run against each mutant) ────────────────────────
async function adapterSuite(T) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const NOW = Date.parse("2026-09-24T15:00:00Z");
  const hourKey = "msh:tiingo:calls:v1:h:2026-09-24T15";
  const dayKey = "msh:tiingo:calls:v1:d:2026-09-24";

  ok("next build is refused", T.tiingoCallRefusal({ ...PROD, NEXT_PHASE: "phase-production-build" }) !== null);
  ok("a preview is refused", T.tiingoCallRefusal({ ...PROD, VERCEL_ENV: "preview" }) !== null);
  ok("no VERCEL_ENV (local, CI) is refused", T.tiingoCallRefusal({ TIINGO_API_KEY: "k" }) !== null);
  ok("production without a key is refused", T.tiingoCallRefusal({ VERCEL_ENV: "production" }) !== null);
  ok("production with a key may call", T.tiingoCallRefusal(PROD) === null);
  ok("the caps are 80% of the contract's", T.TIINGO_HOURLY_CAP === 16_000 && T.TIINGO_DAILY_CAP === 240_000, `${T.TIINGO_HOURLY_CAP}/${T.TIINGO_DAILY_CAP}`);

  setEnv(PROD);
  reset();
  let r = await T.reserveTiingoRequests(9, NOW).then((v) => v, (e) => e);
  ok("a reservation under both caps passes", r && r.hour === 9 && r.day === 9, JSON.stringify(r?.reason ?? r));
  ok("...with both counters given a TTL", net.expires.get(hourKey) > 0 && net.expires.get(dayKey) > 0);

  reset();
  net.counters.set(hourKey, 15_999);
  r = await T.reserveTiingoRequests(1, NOW).then(() => "ok", (e) => e);
  ok("exactly at the hourly cap passes", r === "ok", String(r?.reason ?? r));
  r = await T.reserveTiingoRequests(1, NOW).then(() => "ok", (e) => e);
  ok("one over the hourly cap is refused", r instanceof T.TiingoRefused, String(r));

  reset();
  net.counters.set(dayKey, 240_000);
  r = await T.reserveTiingoRequests(1, NOW).then(() => "ok", (e) => e);
  ok("one over the daily cap is refused", r instanceof T.TiingoRefused, String(r));

  reset();
  net.redisStatus = 500;
  r = await T.reserveTiingoRequests(1, NOW).then(() => "ok", (e) => e);
  ok("a Redis error refuses (fails closed)", r instanceof T.TiingoRefused, String(r));
  const quotes = await T.fetchIexQuotes(["AAPL"], NOW).then(() => "fetched", (e) => e);
  ok("...and no Tiingo request leaves after a refusal", quotes instanceof T.TiingoRefused && net.tiingo.length === 0, `${String(quotes)}; ${net.tiingo.length} sent`);

  reset();
  setEnv({ ...PROD, VERCEL_ENV: "preview" });
  r = await T.fetchIexQuotes(["AAPL"], NOW).then(() => "fetched", (e) => e);
  ok("a preview makes no Tiingo request and no limiter command", r instanceof T.TiingoRefused && net.tiingo.length === 0 && net.redisCmds.length === 0);

  reset();
  setEnv(PROD);
  const got = await T.fetchIexQuotes(["AAPL", "EP-PC", "BRK-B"], NOW);
  ok("the IEX batch asks in Tiingo's spelling", net.tiingo.some((u) => decodeURIComponent(u).includes("EP-P-C")), net.tiingo.join(" "));
  ok("...and answers in ours", got.quotes.has("EP-PC") && got.quotes.has("AAPL"), [...got.quotes.keys()].join(","));
  ok("...a row with no price is dropped, not stored as 0", !got.quotes.has("BRK-B"));
  ok("...tngoLast stands in when IEX has no last", got.quotes.get("EP-PC")?.price === 50.1);
  ok("...one request per 100 tickers, reserved first", got.requests === 1 && (net.counters.get(hourKey) ?? 0) === 1);

  const bars = T.parseEodCsv(csv(["2026-09-24,10,11,9,10,100,5,5.5,4.5,5,200,0,1", "2026-09-23,10,11,9,10,100,4,4.4,3.6,4,200,0,1"]));
  ok("history uses the ADJUSTED columns, oldest first", bars.length === 2 && bars[0][0] === "2026-09-23" && bars[1][4] === 5 && bars[1][5] === 200, JSON.stringify(bars));
  ok("a CSV without adjusted columns parses to nothing (not to unadjusted bars)", T.parseEodCsv("date,close\n2026-09-24,1").length === 0);
  return fails;
}

// ── 1. the real modules ─────────────────────────────────────────────────────
console.log("1. the adapter, the jobs and the helpers, against a stubbed network");
const T = await import(pathToFileURL(path.join(ROOT, "lib/server/marketData/tiingo.ts")).href);
const J = await import(pathToFileURL(path.join(ROOT, "lib/server/marketData/jobs.ts")).href);
const K = await import(pathToFileURL(path.join(ROOT, "lib/server/marketData/keys.ts")).href);
const P = await import(pathToFileURL(path.join(ROOT, "lib/server/marketData/provider.ts")).href);
const MG = await import(pathToFileURL(path.join(ROOT, "lib/server/marketData/merge.ts")).href);
const RD = await import(pathToFileURL(path.join(ROOT, "lib/server/marketData/read.ts")).href);
const S = await import(pathToFileURL(path.join(ROOT, "lib/symbolSpellings.mjs")).href);

const real = await adapterSuite(T);
for (const f of real) check(f, false);
check(`the adapter suite passes on the real module`, real.length === 0);

// Hourly job.
setEnv(PROD);
reset();
const THU_11ET = Date.parse("2026-09-24T15:00:00Z");
let q = await J.runTiingoQuotes(THU_11ET);
const pool = net.hashes.get(K.TIINGO_QUOTES_KEY);
check("hourly: in market hours it writes ONE HSET of the pool", q.ok && net.redisCmds.filter((c) => c[0] === "hset").length === 1, JSON.stringify(q));
check("...under our spelling, with a run stamp", pool?.has("EP-PC") && pool?.has(K.TIINGO_QUOTES_META_FIELD));
check("...with a TTL", net.expires.get(K.TIINGO_QUOTES_KEY) === K.TIINGO_QUOTES_TTL_SECONDS);
check("...and revalidates the prices tag", globalThis.__nextCacheStub.revalidated.some(([t]) => t === K.PRICES_TAG));
reset();
q = await J.runTiingoQuotes(Date.parse("2026-09-26T15:00:00Z"));
check("hourly: on a Saturday it does nothing at all", q.skipped === "outside-market-window" && net.tiingo.length === 0 && net.redisCmds.length === 0, JSON.stringify(q));
reset();
setEnv({ ...PROD, VERCEL_ENV: "preview" });
q = await J.runTiingoQuotes(THU_11ET);
check("hourly: a preview skips before any Redis or Tiingo call", String(q.skipped).startsWith("tiingo:") && net.tiingo.length === 0 && net.redisCmds.length === 0, JSON.stringify(q));

// Nightly job.
setEnv(PROD);
reset();
const NIGHT = Date.parse("2026-09-25T00:45:00Z");
let e = await J.runTiingoEod(NIGHT);
check("nightly: a landed night writes every symbol", e.ok && e.written === 3 && e.asOf === "2026-09-24", JSON.stringify(e));
check("...each under msh:tiingo:eod:v1:<our spelling>, with a TTL", ["AAPL", "EP-PC", "BRK-B"].every((s) => net.strings.has(K.tiingoEodKey(s)) && net.expires.get(K.tiingoEodKey(s)) === K.TIINGO_EOD_TTL_SECONDS));
check("...asking Tiingo in its spelling", net.tiingo.some((u) => u.startsWith("/tiingo/daily/EP-P-C/prices")));
check("...never reading stored history back", !net.redisCmds.some((c) => c[0] === "get" && String(c[1]).includes(":eod:v1:")));
check("...stamps the night complete, and revalidates eod", net.strings.has(K.TIINGO_EOD_META_KEY) && globalThis.__nextCacheStub.revalidated.some(([t]) => t === K.EOD_TAG));
const sent = net.tiingo.length;
e = await J.runTiingoEod(NIGHT + 2 * 3600_000);
check("nightly: the 02:45 retry after a complete night is one GET and no Tiingo call", e.skipped === "already-complete" && net.tiingo.length === sent, JSON.stringify(e));
reset();
net.shortTickers = ["BRK-B"];
net.strings.set(K.tiingoEodKey("BRK-B"), "{}"); // last night's value
e = await J.runTiingoEod(NIGHT);
check("nightly: a short answer (<30 bars) is not stored as a history", e.written === 2 && e.failed?.short === 1 && e.shortOrEmpty?.includes("BRK-B"), JSON.stringify(e));
check("...and last night's value is deleted, so a reader falls back to FMP", net.redisCmds.some((c) => c[0] === "del" && c.includes(K.tiingoEodKey("BRK-B"))));
check("...with the minimum pinned at 30, as historyCache qualifies", J.EOD_MIN_BARS === 30);
reset();
net.bulkDate = "2026-09-23";
e = await J.runTiingoEod(NIGHT);
check("nightly: a night that has not landed stores nothing and stamps nothing", e.ok === false && e.notLanded === "2026-09-24" && !net.redisCmds.some((c) => c[0] === "set"), JSON.stringify(e));
check("...and asks for no per-symbol history", net.tiingo.length === 1);
check("eodLanded wants 90% of the universe", J.eodLanded(new Map([["d", 9]]), "d", 10) && !J.eodLanded(new Map([["d", 8]]), "d", 10));

// Helpers.
check("the spelling rule: preferreds gain a dash, classes do not", ["EP-PC", ["FITB", "PM"].join("."), "MER-PK", ["BRK", "B"].join("."), "XYZ-P", "AAPL"].map(S.toTiingo).join(" ") === "EP-P-C FITB-P-M MER-P-K BRK-B XYZ-P AAPL");
check("provider: unset is fmp", P.PRICE_SURFACES.every((s) => P.priceProviderFor(s, {}) === "fmp"));
check("provider: tiingo is tiingo, per surface", P.priceProviderFor("POOL", { PRICE_PROVIDER_POOL: " Tiingo " }) === "tiingo" && P.priceProviderFor("HISTORY", { PRICE_PROVIDER_POOL: "tiingo" }) === "fmp");
check("provider: a typo stays on fmp", P.priceProviderFor("POOL", { PRICE_PROVIDER_POOL: "tiingoo" }) === "fmp");
const hist = [["2026-09-23", 1, 1, 1, 1, 1]];
const tb = MG.todaySoFar(hist, { price: 10, open: 9, high: 10.5, low: 8.5, at: Date.parse("2026-09-24T14:05:00-04:00") });
check("today so far: a newer quote is a labelled partial bar", tb?.partial === true && tb.date === "2026-09-24" && tb.label === "today so far (IEX), 14:05 ET" && tb.close === 10, JSON.stringify(tb));
check("...with no volume (EOD-only)", tb && !("volume" in tb));
check("...and none once the consolidated bar exists", MG.todaySoFar([["2026-09-24", 1, 1, 1, 1, 1]], { price: 10, open: null, high: null, low: null, at: Date.parse("2026-09-24T15:00:00-04:00") }) === null);
const parsed = RD.parsePoolHash({ AAPL: { price: 1, at: 1 }, _meta: { at: 5 }, BAD: "not json", ZERO: { price: 0 } });
check("read layer: the pool hash parses rows and its stamp, and drops junk", parsed.at === 5 && Object.keys(parsed.rows).join() === "AAPL");
const cached = globalThis.__nextCacheStub?.cached ?? [];
check("read layer: the pool is cached as one entry tagged prices, 1 h", RD.POOL_CACHE_SECONDS === 3600);
await RD.readTiingoHistory("brk.b").catch(() => null);
const histCache = (globalThis.__nextCacheStub?.cached ?? []).find((c) => c.keyParts?.[0] === "tiingo-eod-v1");
check("read layer: history is cached per symbol, tagged eod and eod:<SYM>, 24 h", histCache && histCache.options.tags.join() === "eod,eod:BRK-B" && histCache.options.revalidate === 86_400, JSON.stringify(histCache ?? cached));

// ── 2. the wiring ───────────────────────────────────────────────────────────
console.log("\n2. keys, purge, cadence, crons, attribution");
const keySrc = read("lib/server/marketData/keys.ts");
const literals = [...keySrc.matchAll(/`\$\{TIINGO_PREFIX\}([^`]*)`/g)].map((m) => K.TIINGO_PREFIX + m[1]);
check("every key in keys.ts is built on the one prefix", literals.length >= 3 && !/"msh:(?!tiingo:)/.test(keySrc), literals.join(", "));
check("...and so is the limiter's", T.TIINGO_CALLS_PREFIX.startsWith(K.TIINGO_PREFIX));
check("no other marketData file writes a msh: key of its own", ["jobs.ts", "read.ts", "tiingo.ts"].every((f) => !/"msh:(?!tiingo:|price-pool:v1)/.test(read(`lib/server/marketData/${f}`)) && !/`msh:(?!tiingo:)/.test(read(`lib/server/marketData/${f}`))));
const purge = read("scripts/tiingo-purge.mjs");
check("the purge scans exactly that prefix", purge.includes(`const PREFIX = "${K.TIINGO_PREFIX}"`));
check("the purge is a dry run unless --apply", /const apply = process\.argv\.includes\("--apply"\)/.test(purge) && /if \(!apply\)[\s\S]*?process\.exit\(0\)/.test(purge));
const relay = read("scripts/relay-run.mjs");
check("the relay's dry purge task passes no --apply", /"write-tiingo-purge-dry": \{[^}]*args: \(\) => \[\]/.test(relay));
check("the parity report makes no Tiingo request", !/TIINGO|api\.tiingo/.test(read("scripts/tiingo-parity.mjs").replace(/^\s*\/\/.*$/gm, "")));

const vercel = JSON.parse(read("vercel.json"));
const cronOf = (p) => vercel.crons.find((c) => c.path === p)?.schedule;
const jobsSrc = read("lib/server/jobRuns.ts");
const regOf = (k) => jobsSrc.match(new RegExp(`"${k}": \\{[^}]*cron: "([^"]+)"`))?.[1];
const cadenceToCron = { 60: /^\d{1,2} \* \* \* \*$/, 30: /^\d{1,2},\d{1,2} \* \* \* \*$/, 15: /^\d{1,2}-\d{1,2}\/15 \* \* \* \*$|^\*\/15 \* \* \* \*$/ };
check("the freshness knob and the quotes cron agree", cadenceToCron[J.QUOTE_CADENCE_MINUTES]?.test(cronOf("/api/jobs/tiingo-quotes") ?? ""), `${J.QUOTE_CADENCE_MINUTES} min vs "${cronOf("/api/jobs/tiingo-quotes")}"`);
check("vercel.json and the JOBS registry agree on both crons", cronOf("/api/jobs/tiingo-quotes") === regOf("tiingo-quotes") && cronOf("/api/jobs/tiingo-eod") === regOf("tiingo-eod"));
check("the nightly job runs after the US close in both seasons, and retries", cronOf("/api/jobs/tiingo-eod") === "45 0,2 * * *");
for (const j of ["tiingo-quotes", "tiingo-eod"]) {
  check(`${j}: its route exports the GUARDED handler`, /export const GET = guardJob\("/.test(read(`app/api/jobs/${j}/route.ts`)));
}
const guard = read("lib/server/jobGuard.ts");
check("both jobs have job-guard ceilings", /"tiingo-quotes": \{ perRun: \d/.test(guard) && /"tiingo-eod": \{ perRun: [\d_]+/.test(guard));

const about = read("app/about/page.tsx");
check("attribution: the about page says \"Market Data from Tiingo.com\"", about.includes("Market Data from Tiingo.com"));
check("...linked to Tiingo.com", /href="https:\/\/www\.tiingo\.com\/?"/.test(about));
const disclaimer = read("app/risk-disclaimer/page.tsx");
check("terms: market data is for personal research purposes only", /personal\s+research\s+purposes\s+only/i.test(disclaimer));

// ── 3. mutants of the adapter ───────────────────────────────────────────────
console.log("\n3. mutants: each must fail the adapter suite");
const src = read("lib/server/marketData/tiingo.ts");
const MUTANTS = [
  ["caps at the dashboard's 30,000, not 80% of the contract", (s) => s.replace("TIINGO_HOURLY_CAP = 16_000", "TIINGO_HOURLY_CAP = 30_000")],
  ["the limiter fails OPEN on a Redis error", (s) => s.replace(/throw new TiingoRefused\(`limiter redis error[^;]*;/, "return { hour: 0, day: 0 };")],
  ["the limiter checks > cap as >= (refuses the cap itself)", (s) => s.replace("if (h > TIINGO_HOURLY_CAP)", "if (h >= TIINGO_HOURLY_CAP)")],
  ["previews may call", (s) => s.replace('if (env.VERCEL_ENV !== "production")', "if (false)")],
  ["the IEX call uses our spelling", (s) => s.replace("new Map(symbols.map((s) => [toTiingo(s), s] as const))", "new Map(symbols.map((s) => [s, s] as const))")],
  ["history reads the unadjusted close", (s) => s.replace('at("adjClose")', 'at("close")')],
];
for (const [label, mutate] of MUTANTS) {
  const m = mutate(src);
  if (m === src) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const M = await loadCopy(m);
  const fails = await adapterSuite(M);
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
