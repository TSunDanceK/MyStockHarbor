// THE COLD SEC PATH'S PACING, WINDOWS AND QUEUE ORDER (#552 COWORK #132).
//
// SEC fair access is a hard rule (10 requests/s), and the scheduled jobs pace
// themselves at ≤8/s. A page's cold fill must not stack on top of them:
//   1. every cold SEC request claims the site-wide per-second bucket (≤4/s),
//      one claim per REQUEST, not per fill; over it, it waits for the next
//      second (bounded tries) and then gives up, and it FAILS CLOSED when the
//      bucket cannot be counted. RUN here on the shipped function, with real
//      concurrency, against a fake Redis.
//   2. every SEC request in the module goes through that claim (no bare fetch
//      to data.sec.gov outside it);
//   3. inside a scheduled SEC job's window (lib/secJobWindow.mjs) a fill is
//      deferred to the queue, never fetched;
//   4. the queue serves people first: a verified crawler's entry sorts behind
//      every person's, a person re-queuing keeps (or takes) the earlier place,
//      a crawler never moves an entry that exists. RUN on the shipped enqueue
//      against a small sorted-set fake.
// Each with a mutation showing the assertion bites.
//
//   node scripts/check-sec-cold-pacing.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (from, to) => (src) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

const FILE = "lib/server/secColdFetch.ts";
const RAW = fs.readFileSync(FILE, "utf8");
const constLine = (src, name) => {
  const m = src.match(new RegExp(`export const ${name} =[\\s\\S]*?;\\n`));
  if (!m) throw new Error(`no ${name}`);
  return m[0].replace("export const", "const");
};

// The module-level client is a Proxy onto whichever fake the test installs.
const PREAMBLE = `
const redis = new Proxy({}, { get: (_, k) => { const r = globalThis.__fakeRedis; const f = r && r[k]; return typeof f === "function" ? f.bind(r) : f; } });
const secCounterPrefix = (p) => p;
const canWriteSecState = () => true;
const noteSecWriteBlocked = () => {};
const PACE_PREFIX = "msh:sec:cold-pace:v1";
`;

async function load(src) {
  const pieces = [
    constLine(src, "SEC_COLD_QUEUE_KEY"),
    constLine(src, "SEC_COLD_QUEUE_MAX"),
    constLine(src, "SEC_COLD_QUEUE_CRAWLER_OFFSET_MS"),
    constLine(src, "SEC_COLD_REQUESTS_PER_SECOND"),
    constLine(src, "SEC_COLD_PACE_TRIES"),
    constLine(src, "coldPaceKey"),
    grabFunction(src, "enqueue"),
    grabFunction(src, "paceSecRequest"),
  ];
  return lift(pieces.join("\n") + "\nexport { enqueue, paceSecRequest, SEC_COLD_REQUESTS_PER_SECOND, SEC_COLD_QUEUE_CRAWLER_OFFSET_MS };", PREAMBLE, "cold-pacing");
}

/** A counter fake: INCR per key; `fail` makes every INCR throw. */
const counterRedis = (fail = false) => {
  const n = new Map();
  return {
    async incr(k) { if (fail) throw new Error("redis down"); n.set(k, (n.get(k) ?? 0) + 1); return n.get(k); },
    async expire() { return 1; },
  };
};

/** A sorted-set fake honouring NX and LT, as Upstash's zadd does. */
const zsetRedis = () => {
  const z = new Map();
  return {
    z,
    async zcard() { return z.size; },
    async zadd(_key, opts, { score, member }) {
      const had = z.has(member);
      if (opts?.nx && had) return 0;
      if (opts?.lt && had && !(score < z.get(member))) return 0;
      z.set(member, score);
      return had ? 0 : 1;
    },
    order() { return [...z.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m); },
  };
};

const RULES = {
  // ── 1. PACING, RUN ──────────────────────────────────────────────────────
  "≤4 cold SEC requests start in any one wall-clock second, with 12 asked at once": async (M) => {
    globalThis.__fakeRedis = counterRedis();
    const starts = [];
    await Promise.all(Array.from({ length: 12 }, () => M.paceSecRequest().then(() => starts.push(Math.floor(Date.now() / 1000)), () => {})));
    const perSecond = new Map();
    for (const s of starts) perSecond.set(s, (perSecond.get(s) ?? 0) + 1);
    return starts.length >= 4 && Math.max(...perSecond.values()) <= 4 && M.SEC_COLD_REQUESTS_PER_SECOND === 4;
  },
  "past its bounded tries a request gives up (the fill then queues), it is never sent unpaced": async (M) => {
    globalThis.__fakeRedis = { async incr() { return 99; }, async expire() { return 1; } };
    try { await M.paceSecRequest(); return false; } catch (e) { return /pace exhausted/.test(e.message); }
  },
  "an uncountable request (Redis error) is not sent: pacing FAILS CLOSED": async (M) => {
    globalThis.__fakeRedis = counterRedis(true);
    try { await M.paceSecRequest(); return false; } catch (e) { return /pacing unavailable/.test(e.message); }
  },

  // ── 2. EVERY SEC REQUEST IS PACED ──────────────────────────────────────
  "every SEC request in the module goes through secFetch (companyfacts, submissions, cover and instance EPS)": async (_M, src) => {
    const code = src;
    const bare = [...code.matchAll(/\bawait fetch\(|[^.\w]fetch\(url/g)].length;
    const sf = code.slice(code.indexOf("async function secFetch("));
    // PACED, THEN ONE FETCH: no-store and bounded since #552 COWORK #181.
    return /await paceSecRequest\(\);\s*return fetch\(url, \{ \.\.\.init, cache: "no-store", signal: AbortSignal\.timeout\(SEC_COLD_FETCH_DEADLINE_MS\) \}\);/.test(sf.slice(0, 260))
      && /const res = await secFetch\(`https:\/\/data\.sec\.gov\/api\/xbrl\/companyfacts/.test(code)
      && /const res = await secFetch\(`https:\/\/data\.sec\.gov\/submissions/.test(code)
      && /const secGet = \(url: string\) => secFetch\(url,/.test(code)
      && bare === 1; // the one inside secFetch itself
  },

  // ── 3. THE SCHEDULED JOBS' WINDOWS ─────────────────────────────────────
  "inside a scheduled SEC job's window a fill is deferred to the queue, before any claim or fetch": async (_M, src) => {
    const fn = src.slice(src.indexOf("export async function fillColdSymbol("));
    const w = fn.indexOf("if (inSecJobWindow(Date.now())) {");
    const claim = fn.indexOf("await claimColdFetch(clean)");
    const stored = fn.indexOf("const stored = await readFactSet(clean);");
    return w > stored && w < claim && /if \(inSecJobWindow\(Date\.now\(\)\)\) \{\s*await enqueue\(clean\);\s*return "deferred";/.test(fn)
      && /import \{ inSecJobWindow \} from "\.\.\/secJobWindow\.mjs";/.test(src);
  },
  "the windows are the jobs' own: sec-facts 04:20 and 16:20 inside, 03:30 and 12:00 outside": async () => {
    const W = await import("../lib/secJobWindow.mjs");
    const at = (iso) => W.inSecJobWindow(Date.parse(iso));
    return at("2026-10-05T04:20:00Z") && at("2026-10-05T16:20:00Z") && at("2026-10-05T06:49:00Z")
      && !at("2026-10-05T03:30:00Z") && !at("2026-10-05T12:00:00Z") && !at("2026-10-05T16:50:00Z");
  },

  // ── 4. THE QUEUE SERVES PEOPLE FIRST ───────────────────────────────────
  "a crawler's entry sorts behind every person's, even a person who came later": async (M) => {
    const r = zsetRedis(); globalThis.__fakeRedis = r;
    await M.enqueue("CRAWL", "crawler");
    await new Promise((res) => setTimeout(res, 5));
    await M.enqueue("PERSON", "person");
    return r.order().join(",") === "PERSON,CRAWL" && r.z.get("CRAWL") >= M.SEC_COLD_QUEUE_CRAWLER_OFFSET_MS;
  },
  "a person re-queuing keeps their earlier place (LT), and promotes a symbol a crawler queued": async (M) => {
    const r = zsetRedis(); globalThis.__fakeRedis = r;
    await M.enqueue("AAA", "person");
    await new Promise((res) => setTimeout(res, 5));
    await M.enqueue("BBB", "person");
    await M.enqueue("CCC", "crawler");
    await new Promise((res) => setTimeout(res, 5));
    await M.enqueue("AAA", "person");
    await M.enqueue("CCC", "person");
    return r.order().join(",") === "AAA,BBB,CCC" && r.z.get("CCC") < M.SEC_COLD_QUEUE_CRAWLER_OFFSET_MS;
  },
  "a crawler never moves an entry that exists (NX): a person's place survives a crawler's visit": async (M) => {
    const r = zsetRedis(); globalThis.__fakeRedis = r;
    await M.enqueue("AAA", "person");
    const before = r.z.get("AAA");
    await M.enqueue("AAA", "crawler");
    return r.z.get("AAA") === before;
  },
  "the action queues only after the verdict: crawler and over-cap person queue, an unverified bot does not": async () => {
    const a = readCodeOnly("app/stock/[symbol]/coldFillAction.ts");
    const bot = a.indexOf("const botRefusal = coldFillBotGate(bot);");
    const crawler = a.indexOf('if (botRefusal === "crawler") await queueColdSymbol(clean, "crawler");');
    const cap = a.indexOf('if (visitorRefusal === "visitor-cap") await queueColdSymbol(clean, "person");');
    return bot > 0 && crawler > bot && cap > crawler && (a.match(/queueColdSymbol\(/g) ?? []).length === 2;
  },
};

const M0 = await load(RAW);
console.log("the shipped rules");
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(await rule(M0, readCodeOnly(FILE))); } catch (e) { console.log(`    ${e?.message ?? e}`); }
  check(name, ok);
}

console.log("\nmutants: each must break a rule");
const MUTANTS = [
  ["the per-second cap at 40", once("export const SEC_COLD_REQUESTS_PER_SECOND = 4;", "export const SEC_COLD_REQUESTS_PER_SECOND = 40;")],
  ["over the cap, sent anyway", once('  throw new Error("cold SEC pace exhausted");', "")],
  ["pacing fails OPEN on a Redis error", once('      throw new Error("cold SEC pacing unavailable");', "      return;")],
  ["companyfacts fetched bare", once("const res = await secFetch(`https://data.sec.gov/api/xbrl/companyfacts", "const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts")],
  ["the cover / instance-EPS getter fetched bare", once("const secGet = (url: string) => secFetch(url,", "const secGet = (url: string) => fetch(url,")],
  ["the window deferral removed", once("if (inSecJobWindow(Date.now())) {", "if (false) {")],
  ["crawler entries scored like people's", once("score: SEC_COLD_QUEUE_CRAWLER_OFFSET_MS + Date.now()", "score: Date.now()")],
  ["a person's re-queue moves them back (no LT)", once("{ lt: true }", "{}")],
  ["a crawler overwrites a person's place (no NX)", once("{ nx: true }", "{}")],
];
for (const [label, mutate] of MUTANTS) {
  let bites = false;
  try {
    const src = mutate(RAW);
    const Mm = await load(src);
    for (const rule of Object.values(RULES)) {
      let ok = false;
      try { ok = Boolean(await rule(Mm, src)); } catch { ok = false; }
      if (!ok) { bites = true; break; }
    }
  } catch (e) { bites = !/mutation anchor/.test(String(e?.message)); if (!bites) console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, bites);
}
delete globalThis.__fakeRedis;

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
