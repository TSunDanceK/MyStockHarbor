// The stock-page Tiingo cold fill (#553 COWORK #121/#122/#123).
//
// What must hold, and what each section pins:
//   1. The adapter's carve-out: only the "cold-fill" path may run on Preview;
//      every other call stays production-only; `next build` never calls.
//   2. The gate, in order, failing closed on every unreadable input; which
//      refusals queue (crawlers, caps) and which end (junk, no list).
//   3. The shared visitor cap: 20 distinct new tickers a UTC day, a repeat
//      free, the 21st refused and removed, every failure closed.
//   4. The supported list: the filter, and the zip reader on a real zip.
//   5. The words and the page: "being prepared" exactly as the owner kept it,
//      noindex while preparing, and the page's FMP legs skipped for a cold symbol.
//   6. The jobs: the requested set joins the universe; the queue job's command
//      shape; the guard ceilings and crons for the two new jobs.
// Each rule that is a single line of source also gets a planted mutant.
//
//   node scripts/check-tiingo-cold-fill.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRawSync, inflateRawSync } from "node:zlib";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const REDIS = "https://fake-redis.test";
process.env.UPSTASH_REDIS_REST_URL = REDIS;
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const FILES = {
  adapter: "lib/server/marketData/tiingo.ts",
  cold: "lib/server/marketData/coldFill.ts",
  state: "lib/server/tiingoColdState.ts",
  visitor: "lib/server/coldVisitorCap.ts",
  jobs: "lib/server/marketData/jobs.ts",
  action: "app/stock/[symbol]/tiingoColdFillAction.ts",
  client: "app/stock/[symbol]/TiingoColdFill.tsx",
  page: "app/stock/[symbol]/page.tsx",
  queueRoute: "app/api/jobs/tiingo-cold-queue/route.ts",
  supportedRoute: "app/api/jobs/tiingo-supported/route.ts",
  guard: "lib/server/jobGuard.ts",
  jobRuns: "lib/server/jobRuns.ts",
};

let seq = 0;
async function loadMutant(rel, src) {
  const tmp = path.join(ROOT, path.dirname(rel), `.check-cold-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(tmp, src);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
const real = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
async function mutants(rel, list, behaviour) {
  const src = raw(rel);
  for (const [label, from, to] of list) {
    const m = src.replace(from, to);
    if (m === src) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const fails = await behaviour(await loadMutant(rel, m));
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
}

// ── a stubbed Upstash ─────────────────────────────────────────────────────
const net = { sets: new Map(), strings: new Map(), cmds: [], fail: false };
const b64 = (v) => (typeof v === "string" ? Buffer.from(v).toString("base64") : Array.isArray(v) ? v.map(b64) : v);
function answer(cmd) {
  net.cmds.push(cmd.map(String));
  const [op, key, ...rest] = cmd.map(String);
  const set = () => { if (!net.sets.has(key)) net.sets.set(key, new Set()); return net.sets.get(key); };
  switch (op.toLowerCase()) {
    case "sadd": { const s = set(); let n = 0; for (const m of rest) if (!s.has(m)) { s.add(m); n++; } return n; }
    case "scard": return net.sets.get(key)?.size ?? 0;
    case "srem": { const s = set(); let n = 0; for (const m of rest) if (s.delete(m)) n++; return n; }
    case "expire": return 1;
    case "incr": { const n = Number(net.strings.get(key) ?? 0) + 1; net.strings.set(key, String(n)); return n; }
    default: return 1;
  }
}
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (url.startsWith(REDIS)) {
    if (net.fail) throw new Error("network down");
    const body = JSON.parse(init.body ?? "null");
    if (/\/pipeline|\/multi-exec/.test(url)) return new Response(JSON.stringify(body.map((c) => ({ result: b64(answer(c)) }))), { status: 200 });
    return new Response(JSON.stringify({ result: b64(answer(body)) }), { status: 200 });
  }
  return new Response("unexpected host", { status: 599 });
};
const resetNet = () => { net.sets = new Map(); net.strings = new Map(); net.cmds = []; net.fail = false; };

// ── 1. The adapter's carve-out ────────────────────────────────────────────
console.log("\n=== 1. tiingoCallRefusal: the cold-fill path alone may run on Preview ===\n");
async function carveOut(A) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const env = (e) => ({ TIINGO_API_KEY: "k", ...e });
  want("production: the jobs may call", A.tiingoCallRefusal(env({ VERCEL_ENV: "production" })) === null);
  want("production: the cold fill may call", A.tiingoCallRefusal(env({ VERCEL_ENV: "production" }), "cold-fill") === null);
  want("Preview: the cold fill may call (owner, COWORK #123)", A.tiingoCallRefusal(env({ VERCEL_ENV: "preview" }), "cold-fill") === null);
  want("Preview: a job may NOT call", A.tiingoCallRefusal(env({ VERCEL_ENV: "preview" })) !== null && A.tiingoCallRefusal(env({ VERCEL_ENV: "preview" }), "job") !== null);
  // #553 COWORK #127: the supported-ticker download alone joins it on Preview.
  want("Preview: the supported-list download may call (owner, COWORK #127)", A.tiingoCallRefusal(env({ VERCEL_ENV: "preview" }), "supported-list") === null);
  want("production: the supported-list download may call", A.tiingoCallRefusal(env({ VERCEL_ENV: "production" }), "supported-list") === null);
  want("development: the supported-list download may not", A.tiingoCallRefusal(env({ VERCEL_ENV: "development" }), "supported-list") !== null);
  want("an unknown path on Preview is refused", A.tiingoCallRefusal(env({ VERCEL_ENV: "preview" }), "quotes") !== null);
  want("development: neither may call", A.tiingoCallRefusal(env({ VERCEL_ENV: "development" }), "cold-fill") !== null && A.tiingoCallRefusal(env({})) !== null);
  want("next build: never", A.tiingoCallRefusal(env({ VERCEL_ENV: "production", NEXT_PHASE: "phase-production-build" }), "cold-fill") !== null);
  want("no key: never", A.tiingoCallRefusal({ VERCEL_ENV: "production" }, "cold-fill") !== null);
  return fails;
}
const A = await real(FILES.adapter);
const aFails = await carveOut(A);
for (const f of aFails) check(f, false);
check("the carve-out is exactly the cold-fill path on Preview", aFails.length === 0);
await mutants(FILES.adapter, [
  ["Preview opened to every caller", /\(PREVIEW_PATHS\.has\(path\) && env\.VERCEL_ENV === "preview"\)/, '(env.VERCEL_ENV === "preview")'],
  ["the carve-out removed", /\|\| \(PREVIEW_PATHS\.has\(path\) && env\.VERCEL_ENV === "preview"\)/, ""],
  ["the jobs added to the Preview paths", /new Set\(\["cold-fill", "supported-list"\]\)/, 'new Set(["cold-fill", "supported-list", "job"])'],
  ["the supported-list path dropped from Preview", /new Set\(\["cold-fill", "supported-list"\]\)/, 'new Set(["cold-fill"])'],
  ["the cold-fill path dropped from Preview", /new Set\(\["cold-fill", "supported-list"\]\)/, 'new Set(["supported-list"])'],
  ["the build guard dropped", /if \(env\.NEXT_PHASE === "phase-production-build"\) return "next build";/, ""],
], carveOut);
const adapterSrc = raw(FILES.adapter);
check("the limiter and the request both take the caller's path (no default 'job' refusal on the cold path)",
  /const refusal = tiingoCallRefusal\(process\.env, path\);/.test(adapterSrc) && /const refusal = tiingoCallRefusal\(process\.env, opts\.path \?\? "job"\);/.test(adapterSrc));
check("the history request carries the caller's abort signal (the 3 s budget)", /signal: opts\.signal,/.test(adapterSrc));
{
  const jobs = raw(FILES.jobs);
  const sup = jobs.slice(jobs.indexOf("export async function runTiingoSupported"));
  check("only tiingo-supported uses the supported-list path (its refusal and its one reserved download)",
    /const refusal = tiingoCallRefusal\(process\.env, "supported-list"\);/.test(sup) &&
    /await reserveTiingoRequests\(1, nowMs, "supported-list"\);\s*const refusal = tiingoCallRefusal\(process\.env, "supported-list"\);/.test(adapterSrc) &&
    (jobs.match(/"supported-list"/g) ?? []).length === 1 && (adapterSrc.replace(/^\s*\/\/.*$/gm, "").match(/"supported-list"/g) ?? []).length === 4);
}
const coldSrc = raw(FILES.cold);
check("only the action asks for the cold-fill path; the queue job uses the job path",
  /fillTiingoColdSymbol\(sym, \{ path: "cold-fill" \}\)/.test(raw(FILES.action)) && /fillTiingoColdSymbol\(sym, \{ path: "job",/.test(coldSrc) && !/path: "cold-fill"/.test(coldSrc));

// ── 2. The gate ───────────────────────────────────────────────────────────
console.log("\n=== 2. The gate, in order, failing closed ===\n");
const S = await real(FILES.state);
async function gate(C) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const base = { tokenOk: true, symbolOk: true, supported: "yes", visitorOk: true, attempts: 1 };
  const human = { isBot: false, isVerifiedBot: false };
  const fills = { hour: 1, day: 1 };
  want("a bad token is refused first", C.coldFillGate({ ...base, tokenOk: false, symbolOk: false }) === "token");
  want("a bad symbol", C.coldFillGate({ ...base, symbolOk: false }) === "symbol");
  want("junk (not on Tiingo's list) ends, unqueued", C.coldFillGate({ ...base, supported: "no" }) === "not-supported" && !C.QUEUEING_REFUSALS.has("not-supported"));
  want("Tiingo answered empty: ends", C.coldFillGate({ ...base, supported: "no-data" }) === "not-supported");
  want("no list, or an unreadable one: fails closed, unqueued", C.coldFillGate({ ...base, supported: "no-list" }) === "no-list" && C.coldFillGate({ ...base, supported: "error" }) === "no-list" && !C.QUEUEING_REFUSALS.has("no-list"));
  want("the visitor cap comes before the paid check, and queues", C.coldFillGate({ ...base, visitorOk: false, bot: human, fills }) === "visitor-cap" && C.QUEUEING_REFUSALS.has("visitor-cap"));
  want("the day's BotID attempts: over, or unreadable, refuse and queue",
    C.coldFillGate({ ...base, attempts: S.COLD_ATTEMPTS_PER_DAY + 1 }) === "attempt-cap" && C.coldFillGate({ ...base, attempts: null }) === "attempt-cap" && C.QUEUEING_REFUSALS.has("attempt-cap"));
  want("at the attempt cap exactly: allowed", C.coldFillGate({ ...base, attempts: S.COLD_ATTEMPTS_PER_DAY }) === null);
  want("before BotID is asked: no verdict yet", C.coldFillGate(base) === null);
  want("any bot is refused and queued", C.coldFillGate({ ...base, bot: { isBot: true, isVerifiedBot: false } }) === "bot" && C.QUEUEING_REFUSALS.has("bot"));
  want("a verified crawler (Googlebot, Bingbot) is refused and queued (#122)", C.coldFillGate({ ...base, bot: { isBot: false, isVerifiedBot: true } }) === "bot");
  want("an unanswerable verdict fails closed", C.coldFillGate({ ...base, bot: null }) === "bot");
  want("a human with fills uncounted: no verdict yet", C.coldFillGate({ ...base, bot: human }) === null);
  want("the hour cap: over, or unreadable, refuse and queue",
    C.coldFillGate({ ...base, bot: human, fills: { hour: S.COLD_FILLS_PER_HOUR + 1, day: 1 } }) === "hour-cap" && C.coldFillGate({ ...base, bot: human, fills: { hour: null, day: 1 } }) === "hour-cap");
  want("the day cap: over, or unreadable, refuse and queue",
    C.coldFillGate({ ...base, bot: human, fills: { hour: 1, day: S.COLD_FILLS_PER_DAY + 1 } }) === "day-cap" && C.coldFillGate({ ...base, bot: human, fills: { hour: 1, day: null } }) === "day-cap");
  want("all clear: fill", C.coldFillGate({ ...base, bot: human, fills }) === null);
  want("the day cap forced to 0 (TIINGO_COLD_FILL_DAY_CAP=0) refuses every fill, and queues",
    C.coldFillGate({ ...base, bot: human, fills, dayCap: 0 }) === "day-cap" && S.coldFillsPerDay({ TIINGO_COLD_FILL_DAY_CAP: "0" }) === 0 &&
    S.coldFillsPerDay({}) === S.COLD_FILLS_PER_DAY && S.coldFillsPerDay({ TIINGO_COLD_FILL_DAY_CAP: "junk" }) === S.COLD_FILLS_PER_DAY);
  return fails;
}
const C = await real(FILES.cold);
const gFails = await gate(C);
for (const f of gFails) check(f, false);
check("the gate refuses in order and fails closed on every unreadable input", gFails.length === 0);
await mutants(FILES.cold, [
  ["a verified crawler let through", /if \(!i\.bot \|\| i\.bot\.isBot \|\| i\.bot\.isVerifiedBot\) return "bot";/, 'if (!i.bot || i.bot.isBot) return "bot";'],
  ["an unreadable attempt count let through", /if \(i\.attempts == null \|\| i\.attempts > COLD_ATTEMPTS_PER_DAY\) return "attempt-cap";/, 'if (i.attempts != null && i.attempts > COLD_ATTEMPTS_PER_DAY) return "attempt-cap";'],
  ["the visitor cap skipped", /if \(!i\.visitorOk\) return "visitor-cap";/, ""],
  ["a missing list read as supported", /if \(i\.supported === "no-list" \|\| i\.supported === "error"\) return "no-list";/, ""],
  ["the day cap skipped", /if \(i\.fills\.day == null \|\| i\.fills\.day > \(i\.dayCap \?\? COLD_FILLS_PER_DAY\)\) return "day-cap";/, ""],
  ["the day-cap override ignored", /i\.fills\.day > \(i\.dayCap \?\? COLD_FILLS_PER_DAY\)/, "i.fills.day > COLD_FILLS_PER_DAY"],
  ["a crawler not queued", /"visitor-cap", "attempt-cap", "bot", "hour-cap", "day-cap"/, '"visitor-cap", "attempt-cap", "hour-cap", "day-cap"'],
], gate);
check("the owner's figures: 500/h, 3,000/day, attempts 3,000/day, queue 500/day, requested 1,000 for 30 days, 3 s",
  S.COLD_FILLS_PER_HOUR === 500 && S.COLD_FILLS_PER_DAY === 3000 && S.COLD_ATTEMPTS_PER_DAY === 3000 && S.COLD_QUEUE_ADDS_PER_DAY === 500 &&
  S.REQUESTED_CAP === 1000 && S.REQUESTED_IDLE_DAYS === 30 && S.COLD_FETCH_TIMEOUT_MS === 3000);

// The action runs the stages in the gate's order, paid check after the free ones.
const actionSrc = raw(FILES.action);
const order = ["coldSettled(sym", "supportedState(sym)", "admitColdVisitor(ip, sym)", "countColdAttempt()", "checkBotId(", "countColdFill()", "takeColdLock(sym)", "fillTiingoColdSymbol(sym"];
const at = order.map((s) => actionSrc.indexOf(s));
check("the action's stages run in gate order (stored, supported, visitor, attempts, BotID, fills, lock, fetch)",
  at.every((i) => i > 0) && at.every((i, k) => k === 0 || i > at[k - 1]), JSON.stringify(at));
check("BotID is deep analysis, matching /stock/* POST in instrumentation-client.ts",
  /checkBotId\(\{ advancedOptions: \{ checkLevel: "deepAnalysis" \} \}\)/.test(actionSrc) &&
  /path: "\/stock\/\*", method: "POST", advancedOptions: \{ checkLevel: "deepAnalysis" \}/.test(raw("instrumentation-client.ts")));
check("the action returns outcome words, never a figure", !/bars|price|close/i.test(actionSrc.match(/export type TiingoColdReply[\s\S]*?;\n/)?.[0] ?? "x"));

// ── 3. The shared visitor cap ─────────────────────────────────────────────
console.log("\n=== 3. The shared visitor cap (coldVisitorCap.ts) ===\n");
async function visitor(V) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  want("the cap is 20 new tickers a day", V.COLD_VISITOR_NEW_TICKERS_PER_DAY === 20);
  want("the key is neutral and per UTC day", V.coldVisitorKey("1.2.3.4", Date.UTC(2026, 9, 3, 23, 59)) === "msh:cold:visitor:v1:20261003:1.2.3.4");
  resetNet();
  const now = Date.UTC(2026, 9, 3, 12);
  const res = [];
  for (let i = 0; i < 20; i++) res.push(await V.admitColdVisitor("1.2.3.4", `T${i}`, now));
  want("20 distinct tickers are admitted", res.every((r) => r.ok && !r.repeat) && res[19].count === 20);
  const again = await V.admitColdVisitor("1.2.3.4", "t0", now);
  want("a repeat (any case) is free: Tiingo and SEC on one page count once", again.ok && again.repeat);
  const brk = [await V.admitColdVisitor("9.9.9.9", "BRK.B", now), await V.admitColdVisitor("9.9.9.9", "BRK-B", now)];
  want("BRK.B and BRK-B are one slot", brk[1].ok && brk[1].repeat && brk[1].count === 1);
  net.cmds = [];
  const over = await V.admitColdVisitor("1.2.3.4", "T20", now);
  const overCmds = net.cmds.map((c) => c.map((x) => x.toLowerCase()));
  want("the 21st is refused (cap)", !over.ok && over.reason === "cap");
  want("...and removed, so a retry of it is refused again", !net.sets.get(V.coldVisitorKey("1.2.3.4", now))?.has("T20") && !(await V.admitColdVisitor("1.2.3.4", "T20", now)).ok);
  want("3 commands per call (SADD, SCARD, EXPIRE NX), +1 SREM on a refusal",
    overCmds.length === 4 && overCmds.map((c) => c[0]).join() === "sadd,scard,expire,srem" && overCmds[2].includes("nx"));
  want("another visitor is unaffected", (await V.admitColdVisitor("5.6.7.8", "T20", now)).ok);
  want("the next UTC day starts again", (await V.admitColdVisitor("1.2.3.4", "T20", now + 86_400_000)).ok);
  want("no address fails closed", !(await V.admitColdVisitor("unknown", "X", now)).ok && !(await V.admitColdVisitor("", "X", now)).ok);
  net.fail = true;
  const down = await V.admitColdVisitor("1.2.3.4", "NEW", now);
  want("a Redis error fails closed", !down.ok && down.reason === "redis-error");
  net.fail = false;
  return fails;
}
const V = await real(FILES.visitor);
const vFails = await visitor(V);
for (const f of vFails) check(f, false);
check("one visitor: 20 new tickers a day, repeats free, every failure closed", vFails.length === 0);
await mutants(FILES.visitor, [
  ["a counter, not a set (repeats counted)", /if \(added === 0\) return \{ ok: true, count, repeat: true \};/, ""],
  ["fails open on a Redis error", /return \{ ok: false, reason: "redis-error", count: null \};\n  \}\n\}/, 'return { ok: true, count: 0, repeat: false };\n  }\n}'],
  ["the refused ticker left in the set", /await redis\.srem\(key, sym\);/, "void 0;"],
], visitor);

// ── 4. The supported list ─────────────────────────────────────────────────
console.log("\n=== 4. The supported list ===\n");
const J = await real(FILES.jobs);
const NOW = Date.UTC(2026, 9, 3);
const rows = [
  { ticker: "aapl", exchange: "NASDAQ", assetType: "Stock", priceCurrency: "USD", endDate: "2026-10-02" },
  { ticker: "brk.b", exchange: "NYSE", assetType: "Stock", priceCurrency: "USD", endDate: "2026-10-02" },
  { ticker: "spy", exchange: "NYSE ARCA", assetType: "ETF", priceCurrency: "USD", endDate: "2026-10-02" },
  { ticker: "ifnny", exchange: "OTC", assetType: "Stock", priceCurrency: "USD", endDate: "2026-10-01" },
  { ticker: "old", exchange: "NYSE", assetType: "Stock", priceCurrency: "USD", endDate: "2019-01-04" },
  { ticker: "000001", exchange: "SHE", assetType: "Stock", priceCurrency: "CNY", endDate: "2026-10-02" },
  { ticker: "vfiax", exchange: "NMFQS", assetType: "Mutual Fund", priceCurrency: "USD", endDate: "2026-10-02" },
  { ticker: "x y", exchange: "NYSE", assetType: "Stock", priceCurrency: "USD", endDate: "2026-10-02" },
];
check("kept: USD stocks and ETFs still trading, in our spelling (BRK-B); dropped: delisted, non-USD, funds, junk",
  J.supportedSymbols(rows, NOW).join() === "AAPL,BRK-B,IFNNY,SPY", J.supportedSymbols(rows, NOW).join());
const csv = "ticker,exchange,assetType,priceCurrency,startDate,endDate\naapl,NASDAQ,Stock,USD,1980-12-12,2026-10-02\n";
const parsed = A.parseSupportedTickers(csv);
check("the CSV parses by header", parsed.length === 1 && parsed[0].ticker === "aapl" && parsed[0].endDate === "2026-10-02");
// A real zip (one deflated entry, sizes in the central directory only), built here.
function zipOf(name, data) {
  const body = deflateRawSync(data);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(n.length, 26);
  const cdh = Buffer.alloc(46); cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(8, 10); cdh.writeUInt32LE(body.length, 20); cdh.writeUInt32LE(data.length, 24); cdh.writeUInt16LE(n.length, 28); cdh.writeUInt32LE(0, 42);
  const cdOff = local.length + n.length + body.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cdh.length + n.length, 12); eocd.writeUInt32LE(cdOff, 16);
  return Buffer.concat([local, n, body, cdh, n, eocd]);
}
const z = zipOf("supported_tickers.csv", Buffer.from(csv));
check("the zip reader inflates the first entry from the central directory", A.firstZipEntry(z, (b) => inflateRawSync(b)).toString() === csv);
let threw = false;
try { A.firstZipEntry(Buffer.from("not a zip at all, padding padding"), (b) => b); } catch { threw = true; }
check("...and throws on a non-zip", threw);
const jobsSrc = raw(FILES.jobs);
check("a short list keeps yesterday's (never replaces it with a bad file)", J.SUPPORTED_MIN_ROWS >= 5000 && /if \(symbols\.length < SUPPORTED_MIN_ROWS\) \{\s*return \{ ok: false/.test(jobsSrc));
check("the list is replaced whole (built aside, then RENAME), with the marker that tells 'no list' from 'not listed'",
  /await r\.sadd\(tmp, TIINGO_SUPPORTED_MARKER\);\s*await r\.rename\(tmp, TIINGO_SUPPORTED_KEY\);/.test(jobsSrc));
const stateSrc = raw(FILES.state);
check("the page's supported read asks for the marker in the same command (a missing list is 'no-list')",
  /p\.smismember\(TIINGO_SUPPORTED_KEY, \[TIINGO_SUPPORTED_MARKER, sym\]\);/.test(stateSrc) && /if \(!Array\.isArray\(both\) \|\| Number\(both\[0\]\) !== 1\) return "no-list";/.test(stateSrc));

// ── 5. The words and the page ─────────────────────────────────────────────
console.log("\n=== 5. The words and the page ===\n");
check("the words, exactly as the owner kept them (COWORK #121 §3, #123)",
  S.preparingWords("XYZ") === "Price data for XYZ is being prepared; it may take a few minutes.");
const clientSrc = raw(FILES.client);
check("a hidden tab that becomes visible asks the store and refreshes if filled (#553 COWORK #129)",
  /document\.addEventListener\("visibilitychange", onVisible\);/.test(clientSrc) &&
  /if \(document\.visibilityState !== "visible"\) return;\s*try \{\s*if \(\(await tiingoColdFillStatus\(symbol, tokenRef\.current\)\)\.ready\) router\.refresh\(\);/.test(clientSrc) &&
  /return \(\) => document\.removeEventListener\("visibilitychange", onVisible\);/.test(clientSrc));
check("the client panel shows the same words while waiting, filling, queued or given up",
  (clientSrc.match(/is being prepared; it may take a few minutes\./g) ?? []).length >= 2);
const pageSrc = raw(FILES.page);
check("a cold symbol takes the Tiingo cold path, not the FMP quote", /if \(\(!t \|\| t\.price == null\) && \(await isColdTiingoCandidate\(symbol\)\)\) \{\s*return \{ quote: EMPTY_QUOTE, outcome: "cold-tiingo" \};/.test(pageSrc));
check("...nor the FMP history (both page and metadata reads)",
  (pageSrc.match(/historyForSurface\("CHARTS", upper, \(\) => getDailyHistory\(upper, \{ caller: "stock-page(-meta)?" \}\), \{\s*(?:\/\/[^\n]*\n\s*)*skipFmp: \(\) => isColdTiingoCandidate\(upper\),/g) ?? []).length === 2 &&
  /if \(deps\.skipFmp && \(await deps\.skipFmp\(\)\.catch\(\(\) => false\)\)\) return \{ points: \[\], provider: "none" \};/.test(raw("lib/server/tiingoHistory.ts")));
check("the preparing page mounts the cold fill with a page token", /<TiingoColdFill symbol=\{upper\} token=\{mintQuoteToken\(\)\} \/>/.test(pageSrc));
check("the preparing state is noindex (hasData is false) and titled so", /\$\{upper\} \| Price data being prepared \| MyStockHarbor/.test(pageSrc) && /index: hasData && /.test(pageSrc));
check("an off-universe Tiingo page keeps its symbol in the requested set (one touch a view)",
  /historyResult\.provider === "tiingo" && !inCommittedUniverse\(upper\) \? \(\s*<TiingoRequestedTouch/.test(pageSrc));
check("the candidate test needs the Tiingo stock-page path, no stored bars, and a supported ticker",
  /if \(priceProviderFor\("STOCK_PAGE"\) !== "tiingo"\) return false;/.test(stateSrc) && /if \(stored\?\.bars\?\.length\) return false;/.test(stateSrc) && /return \(await supportedState\(sym\)\) === "yes";/.test(stateSrc));
check("the committed universe is the same two lists as STOCK_PAGE_SYMBOLS",
  S.inCommittedUniverse("AAPL") && S.inCommittedUniverse("brk.b") && S.inCommittedUniverse("SPY") && !S.inCommittedUniverse("ZZZZQ"));

// ── 6. The jobs ───────────────────────────────────────────────────────────
console.log("\n=== 6. The jobs ===\n");
check("the requested set joins the quote and EOD universe (1 ZRANGE)",
  /const requestedRaw = await mustRedis\(\)\.zrange<string\[\]>\(TIINGO_REQUESTED_KEY, 0, -1\)/.test(jobsSrc) && /\[\.\.\.keys, \.\.\.requested\]/.test(jobsSrc));
check("the queue job drops symbols unviewed for 30 days, then fills at most 100 queued, oldest first",
  /zremrangebyscore\(TIINGO_REQUESTED_KEY, 0, nowMs - REQUESTED_IDLE_DAYS \* 86_400_000\)/.test(coldSrc) && /zrange<string\[\]>\(TIINGO_COLD_QUEUE_KEY, 0, COLD_QUEUE_PER_RUN - 1\)/.test(coldSrc) && C.COLD_QUEUE_PER_RUN === 100);
check("the queue drain starts no symbol past its time budget, well inside the route's 300 s",
  C.COLD_DRAIN_BUDGET_MS > 0 && C.COLD_DRAIN_BUDGET_MS + 15_000 <= 240_000 &&
  /if \(Date\.now\(\) - startedAt >= COLD_DRAIN_BUDGET_MS\) return;/.test(coldSrc) && /export const maxDuration = 300;/.test(raw(FILES.queueRoute)));
check("the requested set is capped, least recently viewed evicted", /const over = Number\(card\) - REQUESTED_CAP;\s*if \(over > 0\) await r\.zpopmin\(TIINGO_REQUESTED_KEY, over\);/.test(coldSrc));
check("a cold fill stores exactly what the nightly job stores (same key, window, TTL)",
  /await redis\.set\(tiingoEodKey\(sym\), JSON\.stringify\(value\), \{ ex: TIINGO_EOD_TTL_SECONDS \}\);/.test(coldSrc) && /got\.bars\.slice\(-EOD_WINDOW_BARS\)/.test(coldSrc));
const G = await real(FILES.guard);
check("both new jobs are guarded", G.JOB_LIMITS["tiingo-supported"]?.perRun > 0 && G.JOB_LIMITS["tiingo-cold-queue"]?.perRun >= 1000 &&
  /guardJob\("tiingo-cold-queue", handleGET\)/.test(raw(FILES.queueRoute)) && /guardJob\("tiingo-supported", handleGET\)/.test(raw(FILES.supportedRoute)));
const vercel = JSON.parse(raw("vercel.json"));
const cronOf = (p) => vercel.crons.find((c) => c.path === p)?.schedule;
const R = raw(FILES.jobRuns);
check("vercel.json and the JOBS registry agree on both crons",
  cronOf("/api/jobs/tiingo-supported") === "25 3 * * *" && cronOf("/api/jobs/tiingo-cold-queue") === "3-59/10 * * * *" &&
  R.includes('"tiingo-supported": { label:') && R.includes('cron: "25 3 * * *"') && R.includes('cron: "3-59/10 * * * *"'));
check("every cold-fill key is under msh:tiingo: (the purge's prefix)", (() => {
  const keysSrc = raw("lib/server/marketData/keys.ts");
  return ["supported:v1", "requested:v1", "cold-queue:v1", "cold-nodata:v1", "cold:v1:"].every((k) => keysSrc.includes(`\`\${TIINGO_PREFIX}${k}\``));
})());

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
