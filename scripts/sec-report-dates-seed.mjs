// SEED THE REPORT-DATES STORE so the preview has something to render.
//
// ── WHY THIS EXISTS AND WHAT IT IS NOT ───────────────────────────────────
// The cron writes these records, and the cron does not run on a branch. So a
// preview of the wired page would show the FMP fallback on every symbol and
// the eye-check would be of the path that did not change.
//
// IT RUNS THE SHIPPED CODE, NOT A COPY. reportEvents, nextPeriodEndFrom and
// estimateNextReport are lifted from lib/server/secReportDates.ts, and the
// record it writes is the record the route writes — same key, same shape. A
// seeder with its own logic would prove the seeder works.
//
// SAFE AGAINST PRODUCTION: the key prefix is new, nothing on main reads it, and
// the cron will overwrite each record on its own schedule once this merges.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; report date seed)";

const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const sec = await lift(
  strip("lib/server/secReportDates.ts").replace(/export (const|function|type)/g, "$1") +
    "\nexport { reportEvents, estimateUpcoming, nextPeriodEndFrom, latestResultsAnnouncement, pendingResults };"
);
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);

const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (name) => (manifestSrc.match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const SEC_MANIFEST_KEY = pick("SEC_MANIFEST_KEY");
const SEC_FACTS_PREFIX = pick("SEC_FACTS_PREFIX");
const DATES_PREFIX = (
  fs.readFileSync("lib/server/secReportDatesStore.ts", "utf8")
    .match(/SEC_REPORT_DATES_PREFIX = "([^"]+)"/) ?? []
)[1];
const LIMIT = Number(
  (fs.readFileSync("lib/server/secReportDatesStore.ts", "utf8")
    .match(/STORED_EVENT_LIMIT = (\d+)/) ?? [])[1] ?? 20
);
for (const [n, v] of [["SEC_MANIFEST_KEY", SEC_MANIFEST_KEY], ["SEC_FACTS_PREFIX", SEC_FACTS_PREFIX],
  ["SEC_REPORT_DATES_PREFIX", DATES_PREFIX]]) {
  if (!v) { console.error(`FATAL: could not read ${n}`); process.exit(2); }
}

const manifest = await redis.get(SEC_MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

const SYMBOLS = (process.env.SYMBOLS || "").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
// NO SLICE. The first version took the first sixty alphabetically, which is
// fine for a preview and useless for a count — "how many SYMBOLS show the
// notice" cannot be answered from the As.
const targets = SYMBOLS.length
  ? SYMBOLS
  : Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
console.log(`${targets.length} SYMBOLS\n`);

let lastAt = 0;
const MIN_GAP_MS = 125;
const fetchJson = async (url) => {
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) return null;
  return res.json();
};

const TODAY = new Date().toISOString().slice(0, 10);
const tally = { pending: 0, written: 0, noFacts: 0, noSubs: 0, date: 0, month: 0, none: 0, noEvents: 0 };
const examples = [];
const pendingList = [];
for (const symbol of targets) {
  const cik = manifest.symbols[symbol]?.cik ?? tickerMap.get(symbol)?.cik;
  if (!cik) continue;
  const set = await redis.get(`${SEC_FACTS_PREFIX}:${symbol}`);
  if (!set?.quarters) { tally.noFacts++; continue; }
  const subs = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  if (!subs) { tally.noSubs++; continue; }

  const quarterEnds = (set.quarters ?? []).map((p) => p.e).filter(Boolean);
  const yearEnds = (set.years ?? []).map((p) => p.e).filter(Boolean);
  const events = sec.reportEvents(subs, new Set([...quarterEnds, ...yearEnds]))
    .filter((e) => e.periodEnd)
    .slice(0, LIMIT);
  const cadence = sec.nextPeriodEndFrom(quarterEnds, yearEnds);
  const { estimate: next, periodEnd: nextEnd } = sec.estimateUpcoming(
    events, cadence, subs.category, TODAY
  );
  const pending = sec.pendingResults(events, sec.latestResultsAnnouncement(subs), cadence, TODAY);

  await redis.set(`${DATES_PREFIX}:${symbol}`, {
    symbol, cik,
    at: new Date().toISOString(),
    events,
    nextPeriodEnd: nextEnd,
    next,
    pending,
  });
  tally.written++;
  tally[next.kind]++;
  if (pending) {
    tally.pending++;
    pendingList.push(`${symbol.padEnd(6)} quarter ended ${pending.periodEnd}, announced ${pending.announcedOn}`);
  }
  if (!events.length) tally.noEvents++;
  if (examples.length < 14) {
    examples.push(
      `${symbol.padEnd(6)} ${String(events.length).padStart(2)} events · next ${next.kind}` +
        `${next.kind === "date" ? ` ${next.date}${next.clamped ? " (clamped)" : ""} est=${next.estimator} timing=${next.timing ?? "mixed"}` : ""}` +
        `${next.kind === "month" ? ` ${next.month}` : ""}` +
        `${next.kind === "none" ? ` — ${next.reason}` : ""}` +
        `${pending ? ` · PENDING ${pending.periodEnd} announced ${pending.announcedOn}` : ""}` +
        `${events[0] ? ` · latest ${events[0].periodEnd} -> ${events[0].announcedOn} ${events[0].timing} (${events[0].basis})` : ""}`
    );
  }
}

console.log("=".repeat(76));
console.log("EXAMPLES (SYMBOLS):");
for (const e of examples) console.log(`  ${e}`);
console.log(`\nSYMBOLS SHOWING "announced, not yet in the SEC feed": ${pendingList.length}`);
for (const l of pendingList.slice(0, 40)) console.log(`  ${l}`);
if (pendingList.length > 40) console.log(`  ... and ${pendingList.length - 40} more`);
console.log("");
console.log(JSON.stringify(tally, null, 2));
