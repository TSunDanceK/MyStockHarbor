// THE SEC ARCHIVE BACKFILL LOOP (#552 COWORK #65 PR 1, #67), with every
// effect injected (SEC fetch, R2, sleep, clock, log) so the check can drive it
// with stubs. scripts/sec-archive-backfill.mjs is the thin wrapper that runs it.
//
// FAIR ACCESS (#552 COWORK #66/#67): one runner, ≤8 requests/s, our
// User-Agent. A 429 or 403 from SEC is THROTTLING, not a bad CIK: the run saves
// the index and STOPS — it never keeps hitting SEC at the same rate. A 5xx or
// a network error is retried once after 10 s; a second failure counts that
// CIK as failed and the run continues.
import zlib from "node:zlib";
import { factsToRows, encodeFacts, newestFiling, sha256, ARCHIVE_VERSION } from "./secArchive.mjs";

export class SecThrottled extends Error {
  constructor(status) { super(`SEC ${status}`); this.status = status; }
}
export const MIN_GAP_MS = 125; // ≤8 requests/s
export const RETRY_AFTER_MS = 10_000;

/**
 * One SEC GET, paced and classified: null on 404; SecThrottled on 429/403
 * (never retried); one retry after RETRY_AFTER_MS on 5xx or a network error.
 */
export function secFetcher({ fetchImpl, sleep, now, userAgent, counters }) {
  let lastAt = -Infinity;
  const once = async (url) => {
    const wait = Math.max(0, lastAt + MIN_GAP_MS - now());
    if (wait) await sleep(wait);
    lastAt = now();
    counters.secRequests++;
    const res = await fetchImpl(url, { headers: { "User-Agent": userAgent, "Accept-Encoding": "gzip, deflate" } });
    if (res.status === 429 || res.status === 403) throw new SecThrottled(res.status);
    if (res.status === 404) return null;
    if (res.status >= 500) throw Object.assign(new Error(`SEC ${res.status}`), { retryable: true });
    if (!res.ok) throw new Error(`SEC ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  return async (url) => {
    try {
      return await once(url);
    } catch (e) {
      if (e instanceof SecThrottled) throw e;
      if (!e?.retryable && !(e instanceof TypeError) && e?.name !== "TimeoutError" && e?.name !== "AbortError") throw e;
      await sleep(RETRY_AFTER_MS);
      return once(url); // a second failure propagates: the CIK is counted failed
    }
  };
}

/**
 * The loop. Returns { status: "complete" | "budget" | "throttled", T, index }.
 * The index is saved every `checkpoint` filers, at a stop, and at the end.
 */
export async function runBackfill({ universe, r2, fetchImpl, sleep, now, log, userAgent, limit = 0, refresh = false, checkpoint = 50, budgetMs = 50 * 60 * 1000 }) {
  const started = now();
  const T = { archived: 0, unchanged: 0, noFacts: 0, failed: 0, secRequests: 0, puts: 0, factRows: 0, factBytes: 0, subBytes: 0 };
  const sec = secFetcher({ fetchImpl, sleep, now, userAgent, counters: T });
  const prior = await r2.get("index.json");
  const index = prior ? JSON.parse(prior.toString("utf8")) : { v: ARCHIVE_VERSION, entries: {} };
  const todo = universe.filter((c) => refresh || !index.entries[c]);
  const batch = limit > 0 ? todo.slice(0, limit) : todo;
  log(`universe ${universe.length} · archived ${Object.keys(index.entries).length} · to do ${todo.length} · this run ${batch.length}`);
  const saveIndex = async () => {
    index.updatedAt = new Date(now()).toISOString();
    await r2.put("index.json", Buffer.from(JSON.stringify(index)), "application/json");
    T.puts++;
  };
  // A PUT is skipped when the object's hash equals the one already indexed, so
  // an unchanged re-fetch (REFRESH) writes nothing (#552 COWORK #66).
  const putIfChanged = async (key, body, type, prevSha) => {
    const h = sha256(body);
    if (h !== prevSha) { await r2.put(key, body, type); T.puts++; }
    return h;
  };
  let status = "complete", sinceCheckpoint = 0;
  for (const cik of batch) {
    if (now() - started > budgetMs) { status = "budget"; break; }
    const prev = index.entries[cik] ?? {};
    try {
      const cf = await sec(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
      const sub = await sec(`https://data.sec.gov/submissions/CIK${cik}.json`);
      const subJson = sub ? JSON.parse(sub.toString("utf8")) : null;
      const pages = [];
      for (const p of subJson?.filings?.files ?? []) {
        const page = await sec(`https://data.sec.gov/submissions/${p.name}`);
        if (page) pages.push(JSON.parse(page.toString("utf8")));
      }
      // ORDER IS DELIBERATE: the objects are written first and the index entry
      // last. A CIK that fails between the two has no entry, so the next run
      // simply redoes it (the objects are overwritten, or skipped if unchanged).
      // Do not "fix" this by writing the entry first: that would mark a CIK
      // archived whose objects may not exist.
      const entry = { at: new Date(now()).toISOString(), rows: 0, newest: null, factsSha: null, subSha: null, pages: pages.length };
      if (cf) {
        const archived = factsToRows(JSON.parse(cf.toString("utf8")));
        const body = encodeFacts(archived);
        entry.factsSha = await putIfChanged(`facts/${cik}.ndjson.br`, body, "application/x-ndjson", prev.factsSha);
        Object.assign(entry, { rows: archived.rows.length, newest: newestFiling(archived.rows) });
        T.factRows += archived.rows.length; T.factBytes += body.length;
      } else T.noFacts++;
      if (subJson) {
        const body = zlib.gzipSync(Buffer.from(JSON.stringify({ main: subJson, pages })), { level: 9 });
        entry.subSha = await putIfChanged(`submissions/${cik}.json.gz`, body, "application/json", prev.subSha);
        T.subBytes += body.length;
      }
      if (entry.factsSha === prev.factsSha && entry.subSha === prev.subSha) T.unchanged++;
      index.entries[cik] = entry;
      T.archived++;
      if (++sinceCheckpoint >= checkpoint) { await saveIndex(); sinceCheckpoint = 0; }
    } catch (e) {
      if (e instanceof SecThrottled) { status = "throttled"; break; }
      T.failed++;
      // Status only: the message with any URL cut (it names the CIK path).
      log(`failed: ${String(e?.message ?? e).replace(/https?:\/\/\S+/g, "<url>").slice(0, 60)}`);
    }
  }
  await saveIndex();
  if (status === "throttled") log("stopped: SEC throttled (429/403) · index saved · the next dispatch resumes");
  if (status === "budget") log("stopped: budget reached · index saved · the next dispatch resumes");
  const mb = (b) => (b / 1e6).toFixed(1);
  log(`archived ${T.archived} · unchanged ${T.unchanged} · no companyfacts ${T.noFacts} · failed ${T.failed} · SEC requests ${T.secRequests} · R2 puts ${T.puts} · fact rows ${T.factRows} · facts ${mb(T.factBytes)} MB · submissions ${mb(T.subBytes)} MB · index now ${Object.keys(index.entries).length}/${universe.length} · ${Math.round((now() - started) / 1000)}s`);
  return { status, T, index };
}
