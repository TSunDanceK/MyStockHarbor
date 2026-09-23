// WHAT A STORED REPORT-DATE RECORD SAYS, AND WHAT THE LIVE PAGE SHOWS. Reads only.
//
// Asked after the pairing rewrite (#515) to check TSLA and ABBV on production.
// The agent sandbox is refused the live domain and *.vercel.app, so both halves
// run on a runner: the record straight from Upstash, and the rendered
// /stock/X/earnings "Next expected earnings date" card fetched over the internet.
//
// The page is ISR (revalidate 3600): the first request after the hour can get the
// old render and trigger the rebuild. So each page is fetched up to three times,
// 20s apart, and every answer is printed. It is not just the last one.
//
//   SYMBOLS="TSLA,ABBV" node scripts/report-date-live-check.mjs
//   relay task: write-report-date-live-check  (credentialled for the read)
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const SYMBOLS = (process.argv[2] || process.env.SYMBOLS || "TSLA,ABBV")
  .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const BASE = process.env.LIVE_BASE || "https://www.mystockharbor.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const prefix = (fs.readFileSync("lib/server/secReportDatesStore.ts", "utf8")
  .match(/SEC_REPORT_DATES_PREFIX = "([^"]+)"/) ?? [])[1];
if (!prefix) { console.error("FATAL: SEC_REPORT_DATES_PREFIX not readable"); process.exit(2); }
const redis = Redis.fromEnv();

const text = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ")
  .replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

for (const sym of SYMBOLS) {
  console.log(`\n=== ${sym} ===`);
  const rec = await redis.get(`${prefix}:${sym}`);
  if (!rec) console.log("record: none");
  else {
    console.log(`record at ${rec.at} · nextPeriodEnd ${rec.nextPeriodEnd}`);
    console.log(`  next: ${JSON.stringify(rec.next)}`);
    console.log(`  earlyNonResults key present: ${"earlyNonResults" in rec} · value: ${JSON.stringify(rec.earlyNonResults)}`);
    console.log(`  pending: ${JSON.stringify(rec.pending ?? null)}`);
    for (const e of (rec.events ?? []).slice(0, 4)) console.log(`  event ${JSON.stringify(e)}`);
  }
  for (let i = 1; i <= 3; i++) {
    const url = `${BASE}/stock/${sym}/earnings`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, cache: "no-store" });
      const body = await res.text();
      const t = text(body);
      const at = t.indexOf("Next expected earnings date");
      const hdr = ["x-vercel-cache", "age", "x-vercel-mitigated", "date"].map((h) => `${h}=${res.headers.get(h)}`).join(" ");
      console.log(`page #${i} ${res.status} ${hdr}`);
      console.log(at >= 0 ? `  card: ${t.slice(at, at + 420)}` : `  card: NOT FOUND (title: ${(body.match(/<title>([^<]*)/) ?? [])[1] ?? "-"})`);
    } catch (err) {
      console.log(`page #${i} fetch failed: ${err?.message ?? err}`);
    }
    if (i < 3) await new Promise((r) => setTimeout(r, 20_000));
  }
}
