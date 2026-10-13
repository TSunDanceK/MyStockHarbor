// THE INSIGHT WRITER'S READ PATH (#553 COWORK #181). READ-ONLY, ENFORCED (GET).
//
// The scheduled writer cannot reach the site (its sandbox's proxy refuses the
// production host) but can dispatch a relay and read the job's log through the
// GitHub API. So this is the read path: one GET of the nightly key, the 30-day
// repeat rule applied against content/insights in this checkout (so a post
// merged today counts tomorrow, with no deploy in between), and the list
// printed between two markers as JSON. Tickers, labels, dates and a size
// bucket -- the key's own guard is re-run here before anything is printed.
//
//   node scripts/insight-candidates-read.mjs   (relay: write-insight-candidates-read)
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    if (!cmds.length) throw new Error("read path is read-only: refused a request with no readable command");
    for (const c of cmds) if (String(c?.[0] ?? "").toUpperCase() !== "GET") throw new Error(`read path is read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const C = await import("../lib/server/insightCandidates.ts");
const { getAllPosts } = await import("../lib/blog.ts");
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const raw = await redis.get(C.INSIGHT_CANDIDATES_KEY);
const value = typeof raw === "string" ? JSON.parse(raw) : raw;
if (!value || value.v !== 1) { console.log("no candidates on file (the nightly step has not written the key)"); process.exit(1); }
const bad = C.insightKeyViolations(value);
if (bad.length) { console.error(`REFUSED: the key failed its guard (${bad[0]})`); process.exit(1); }
const out = C.finalInsightCandidates(value, getAllPosts());
console.log("=== INSIGHT CANDIDATES BEGIN ===");
console.log(JSON.stringify(out, null, 2));
console.log("=== INSIGHT CANDIDATES END ===");
console.log(`Redis commands ${commands} (read-only)`);
