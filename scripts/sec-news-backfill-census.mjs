// WHY THE SEC NEWS BACKFILL FAILS (#552 COWORK #157 §4). Reads only.
//
// sec-daily-index's news leg (lib/server/news/secFilingsJob.ts) backfills
// tracked symbols with no stored items, 150 a run; on 5 Oct it tried 90 and 88
// failed (fetchSubmissionsItems returned null). This replays its selection
// exactly — manifest entries with a CIK and not delisted, minus those with a
// stored news key, first 150 — and asks each the same questions
// fetchSubmissionsItems does, recording WHICH one failed:
//   no-news-cik  the news adapter's CIK map (data/cik-map.json) has no entry,
//                so it returns null before any request (A's ticker file shown
//                alongside, since the manifest found a CIK somewhere)
//   http-NNN     SEC answered non-OK for the CIK the news map gives
//   CIK differs  the news map's CIK is not the manifest's
//   ok           a 200 that parses (would be written)
// SEC: one submissions request per symbol that has a news CIK, paced at 5/s
// (under the site's 8/s), with the news adapter's own User-Agent.
//
//   relay task: write-sec-news-backfill-census (READ-ONLY despite the prefix:
//   the credentials live in that job). Redis: 1 GET + 1 pipelined EXISTS per
//   tracked symbol (~970). Prints counts, then the symbols per reason.
import "./lib/register-ts-app.mjs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const { SEC_MANIFEST_KEY } = await import("../lib/server/secManifest.ts");
const { secFilingsNewsKey } = await import("../lib/server/news/secFilingsStore.ts");
const { cikFor, parseSubmissions } = await import("../lib/server/news/secProvider.ts");
const { secUserAgent } = await import("../lib/server/news/userAgent.ts");
const { cikForSymbol } = await import("../lib/server/secColdFetch.ts");

const PER_RUN = 150, PACE_MS = 200;
const raw = await redis.get(SEC_MANIFEST_KEY);
const manifest = typeof raw === "string" ? JSON.parse(raw) : raw;
const tracked = Object.entries(manifest?.symbols ?? {}).filter(([, e]) => e.cik && !e.delisted).map(([s, e]) => [s, e.cik]);
const p = redis.pipeline();
for (const [s] of tracked) p.exists(secFilingsNewsKey(s));
const hits = await p.exec();
const missing = tracked.filter((_, i) => !hits[i]);
const queue = missing.slice(0, PER_RUN);

const by = new Map();
const add = (why, s) => by.set(why, [...(by.get(why) ?? []), s]);
let requests = 0, last = 0, cikDiffers = 0;
for (const [s, manifestCik] of queue) {
  const cik = cikFor(s.toUpperCase());
  if (!cik) { add(`no-news-cik (ticker file ${cikForSymbol(s) ? "has" : "has no"} CIK)`, s); continue; }
  if (String(cik).padStart(10, "0") !== String(manifestCik).padStart(10, "0")) cikDiffers++;
  const wait = last + PACE_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); requests++;
  try {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "user-agent": secUserAgent(), accept: "application/json" } });
    if (!res.ok) { add(`http-${res.status}`, s); continue; }
    const items = parseSubmissions(await res.json(), s.toUpperCase());
    add(items.length ? "ok (would be written)" : "ok, 0 items (written empty)", s);
  } catch (e) { add(`threw (${String(e?.message ?? e).slice(0, 40)})`, s); }
}

console.log(`tracked (manifest, CIK, not delisted): ${tracked.length} · no stored news: ${missing.length} · this run's backfill slice: ${queue.length}`);
console.log(`news-map CIK differs from the manifest's: ${cikDiffers}`);
for (const [why, syms] of [...by.entries()].sort((a, b) => b[1].length - a[1].length)) console.log(`\n${why}: ${syms.length}\n  ${syms.join(" ")}`);
console.log(`\nRedis commands: 1 GET + ${tracked.length} EXISTS (one pipeline), read-only · SEC requests: ${requests} at ≤ ${1000 / PACE_MS}/s`);
