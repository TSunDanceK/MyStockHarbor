// "WHAT IT DOES" ACROSS THE CURRENT LIST (#553 COWORK #159 PR 2, the success
// rate it asks for). READ-ONLY, ENFORCED: one Redis GET of the stored
// profiles (the guard refuses any other verb), then each filer's latest
// registration document from SEC through A's secFetcher (our User-Agent,
// <= 8/s, a 429/403 stops the run), run through the shipped extractAbout.
//
// PUBLIC LOG: CIK, form, the outcome, the word count and the extract itself
// (the company's own words from a public filing). No price, no figure.
//
//   node scripts/ipo-about-measure.mjs   (relay: write-ipo-about-measure)
import { register } from "node:module";
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    if (!cmds.length) throw new Error("read-only: refused a request with no readable command");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; ipo about measure)";
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const S = await import("../lib/server/ipoProfiles.ts");
const V = await import("../lib/ipoProfileView.ts");
const { secFetcher, SecThrottled } = await import("../lib/secArchiveBackfill.mjs");

const stored = await redis.get(S.IPO_PROFILES_KEY);
const profiles = Object.values(stored?.profiles ?? {});
console.log(`stored profiles: ${profiles.length}`);
const counters = { secRequests: 0 };
const get = secFetcher({ fetchImpl: (u, i) => realFetch(u, { ...i, signal: AbortSignal.timeout(20_000) }), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now, userAgent: UA, counters });
const LIMIT = Number(process.env.LIMIT || 200);
let ok = 0, omitted = 0, noDoc = 0, failed = 0;
const words = [];
for (const p of profiles.slice(0, LIMIT)) {
  const reg = V.latestRegistration(p.filings ?? []);
  if (!reg?.doc) { noDoc++; console.log(`${p.cik} | ${reg?.form ?? "-"} | no document`); continue; }
  try {
    const buf = await get(`https://www.sec.gov/Archives/edgar/data/${String(Number(p.cik))}/${reg.acc.replace(/-/g, "")}/${encodeURIComponent(reg.doc)}`);
    if (!buf) { failed++; console.log(`${p.cik} | ${reg.form} | 404`); continue; }
    const html = buf.toString("utf8");
    const text = S.extractAbout(html);
    const kind = V.ipoKind(p.sic, "", p.filings ?? []);
    if (text) {
      ok++;
      const w = text.split(/\s+/).length;
      words.push(w);
      console.log(`${p.cik} | ${reg.form} | ${kind} | OK ${w}w | ${text}`);
    } else {
      omitted++;
      // Why: the standalone summary headings, and the first blocks after the first one.
      const blocks = S.htmlBlocks(html);
      const heads = blocks.map((b, i) => [i, b]).filter(([, b]) => /^(prospectus\s+)?summary[\s.:]*$/i.test(b));
      const first = heads[0]?.[0];
      const after = first === undefined ? [] : blocks.slice(first + 1, first + 6).map((b) => b.slice(0, 90));
      console.log(`${p.cik} | ${reg.form} | ${kind} | OMITTED | ${(html.length / 1e6).toFixed(1)} MB, ${blocks.length} blocks, ${heads.length} summary headings${after.length ? ` | next: ${after.map((a) => JSON.stringify(a)).join(" / ")}` : ""}`);
    }
  } catch (err) {
    if (err instanceof SecThrottled) { console.log(`throttled (${err.status}); stopping`); break; }
    failed++;
    console.log(`${p.cik} | ${reg.form} | error ${String(err?.message ?? err).slice(0, 80)}`);
  }
}
const tried = ok + omitted;
words.sort((a, b) => a - b);
console.log(`\nextract: ${ok} of ${tried} documents read (${tried ? Math.round((ok / tried) * 100) : 0}%); omitted ${omitted}; no document ${noDoc}; fetch failed ${failed}`);
if (words.length) console.log(`words: min ${words[0]}, median ${words[Math.floor(words.length / 2)]}, max ${words[words.length - 1]}`);
console.log(`SEC requests ${counters.secRequests}; Redis commands ${commands} (read-only: GET)`);
