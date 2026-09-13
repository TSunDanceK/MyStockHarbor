import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "@/lib/server/jobRuns";
import {
  readManifest,
  writeManifest,
  seedManifest,
  symbolsByCik,
  type SecManifest,
} from "@/lib/server/secManifest";
import { loadTickerMap } from "@/lib/server/secTickerMap";
import {
  addDays,
  fetchDailyIndex,
  intersect,
  isPeriodicForm,
  isWeekend,
  latestProcessableDate,
  type SymbolFiling,
} from "@/lib/server/secDailyIndex";
import {
  ANALYSIS_UNIVERSE_CAP,
  readDynamicUniverse,
} from "@/lib/server/dynamicUniverseCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Step 2 of the SEC build order, and deliberately the whole of it: fetch the
// daily index, intersect the CIK column against the manifest, record what
// filed, write the manifest back.
//
// ZERO companyfacts CALLS. Not an omission -- the point. The change detector is
// proved in isolation before anything depends on it, so a wrong number later
// cannot be blamed on a detector nobody tested alone.
//
// REDIS BUDGET: one GET and one SET per run, whatever happens. Not one write
// per symbol that filed -- the manifest is a single key, so the symbols that
// filed ride along in the same SET as the watermark. Writes are already 76% of
// the command count on this account and that is the meter that bills.
//
// THE SEED LIVES HERE because seeding needs a write and the relay's Upstash
// credential is deliberately read-only; the app is the only thing that can
// write. It is idempotent and never clears existing state.

/**
 * How many dates one invocation will process.
 *
 * BOUNDED CATCH-UP, NOT "YESTERDAY". Processing only the previous day means a
 * single missed cron run loses those filings permanently and silently -- there
 * is no second chance at a daily index, because tomorrow's run would move the
 * watermark past the gap. So every date from the watermark forward is
 * processed, oldest first, and the watermark is left wherever it got to. A long
 * gap drains over several days instead of timing out in one and making no
 * progress at all.
 */
const MAX_DAYS_PER_RUN = 10;

/**
 * Consecutive failures before the run reports itself unhealthy.
 *
 * A day with no index answers 403 (see secDailyIndex.looksLikeMissingIndex),
 * which is every weekend and every market holiday -- so alarming on one is
 * alarming roughly 110 times a year for nothing. Three consecutive covers a
 * Friday-Saturday-Sunday run of absences without firing; a real block does not
 * stop on the fourth day.
 */
const CONSECUTIVE_FAILURE_ALARM = 4;

/** SEC's fair-access policy requires a declared agent carrying a contact. */
const SEC_UA = process.env.SEC_USER_AGENT || "";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

/**
 * Fold one day's filings into the manifest. Pure, so the acceptance test can
 * run it against fixed rows without a network or a database.
 */
export function applyFilings(manifest: SecManifest, filings: SymbolFiling[]) {
  const touched = new Set<string>();
  const periodicBySymbol = new Map<string, SymbolFiling[]>();

  for (const f of filings) {
    const entry = manifest.symbols[f.symbol];
    if (!entry) continue;
    touched.add(f.symbol);

    if (f.amendment) {
      // A restatement is recorded as its own event. Folding it into
      // lastAccession would lose the fact that an already-published period
      // moved, which 3.8 requires be attributable rather than merely detected.
      entry.lastAmendment = { accession: f.accession, form: f.form, filed: f.filed };
      entry.needsReverify = true;
    }

    if (!isPeriodicForm(f.form)) continue;
    const list = periodicBySymbol.get(f.symbol) ?? [];
    list.push(f);
    periodicBySymbol.set(f.symbol, list);
  }

  for (const [symbol, list] of periodicBySymbol) {
    const entry = manifest.symbols[symbol];
    if (!entry) continue;
    // Newest filing date wins; within a date the order is left alone, because
    // the index carries nothing that could break the tie honestly.
    const newest = list.reduce((a, b) => (b.filed > a.filed ? b : a));
    if (!entry.lastFiled || newest.filed >= entry.lastFiled) {
      entry.lastAccession = newest.accession;
      entry.lastFiled = newest.filed;
    }
    entry.needsReverify = true;

    const sameDay = list.filter((f) => f.filed === newest.filed);
    // ARM files 6-Ks in pairs on the same day. Which one carries the period
    // report needs reportDate, which this index does not have -- both are kept
    // and flagged for step 3 rather than picked by a guess.
    entry.ambiguousSameDayFilings =
      sameDay.length > 1 ? sameDay.map((f) => f.accession).sort() : null;
  }

  return { touched: [...touched].sort(), periodic: [...periodicBySymbol.keys()].sort() };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const url = new URL(req.url);
  const maxDays = Math.max(1, Math.min(30, Number(url.searchParams.get("maxDays") ?? MAX_DAYS_PER_RUN)));
  // Test-only overrides so the acceptance window can be replayed against real
  // dates without waiting for the watermark to reach them.
  const fromOverride = url.searchParams.get("from");
  const toOverride = url.searchParams.get("to");
  const dryRun = url.searchParams.get("dryRun") === "1";

  if (!SEC_UA) {
    // Named as its own failure. Without a declared agent SEC answers 403 with
    // "Request Rate Threshold Exceeded", which reads as a rate limit and is
    // not one -- and would be counted as a missing index by any looser rule.
    await recordJobRun("sec-daily-index", false, { error: "SEC_USER_AGENT is not set" });
    return NextResponse.json(
      { ok: false, error: "SEC_USER_AGENT is not set; every request would be blocked as an undeclared agent" },
      { status: 503 }
    );
  }

  // ── ONE READ ──────────────────────────────────────────────────────────────
  const manifest = await readManifest();
  if (!manifest) {
    await recordJobRun("sec-daily-index", false, { error: "manifest unreadable" });
    return NextResponse.json({ ok: false, error: "manifest unreadable (Redis unconfigured or read failed)" }, { status: 503 });
  }

  // ── Seed, idempotent ──────────────────────────────────────────────────────
  const tickers = loadTickerMap();
  const universe = (await readDynamicUniverse())
    .slice(0, ANALYSIS_UNIVERSE_CAP)
    .map((e) => e.symbol);
  const seed = seedManifest(manifest, universe, tickers.map, tickers.present);

  const bySymbolCik = symbolsByCik(manifest);

  // ── Which dates ───────────────────────────────────────────────────────────
  const latest = toOverride || latestProcessableDate();
  const start = fromOverride || (manifest.lastIndexDate ? addDays(manifest.lastIndexDate, 1) : latest);

  const dates: string[] = [];
  for (let d = start; d <= latest && dates.length < maxDays; d = addDays(d, 1)) dates.push(d);

  const days: Record<string, unknown>[] = [];
  const filingsBySymbol: Record<string, SymbolFiling[]> = {};
  let consecutive = manifest.consecutiveIndexFailures;
  let lastProcessed: string | null = null;

  for (const date of dates) {
    const res = await fetchDailyIndex(date, SEC_UA);

    if (res.outcome === "parsed") {
      const filings = intersect(res.parsed.rows, bySymbolCik);
      const applied = applyFilings(manifest, filings);
      for (const f of filings) (filingsBySymbol[f.symbol] ??= []).push(f);
      // ANY success resets the counter -- a weekend inside a healthy run must
      // not accumulate toward an alarm.
      consecutive = 0;
      lastProcessed = date;
      days.push({
        date,
        outcome: "parsed",
        status: res.status,
        ms: res.ms,
        indexRows: res.parsed.dataRows,
        malformedRows: res.parsed.malformedRows,
        matched: filings.length,
        filings: filings.map((f) => `${f.symbol} ${f.form}`),
        symbolsTouched: applied.touched,
        periodicFilers: applied.periodic,
      });
      continue;
    }

    if (res.outcome === "absent") {
      // Expected: weekend or market holiday. The watermark still advances --
      // there is no index to come back for -- and nothing alarms.
      consecutive += 1;
      lastProcessed = date;
      days.push({
        date,
        outcome: "absent",
        status: res.status,
        ms: res.ms,
        weekend: isWeekend(date),
        bodyHead: res.bodyHead,
        note: "no index published for this date (403 AccessDenied from S3 is how EDGAR says 'no such key'); watermark advances, no alarm",
      });
      continue;
    }

    // A real failure. The watermark is NOT advanced past it -- the day is
    // retried tomorrow rather than lost.
    consecutive += 1;
    days.push({ date, outcome: "failed", status: res.status, ms: res.ms, reason: res.reason });
    break;
  }

  if (lastProcessed) manifest.lastIndexDate = lastProcessed;
  manifest.consecutiveIndexFailures = consecutive;

  // ── ONE WRITE ─────────────────────────────────────────────────────────────
  const written = dryRun ? false : await writeManifest(manifest);

  const failedDays = days.filter((d) => d.outcome === "failed").length;
  const alarming = consecutive >= CONSECUTIVE_FAILURE_ALARM;
  const ok = failedDays === 0 && !alarming && (dryRun || written);

  const summary = {
    datesConsidered: dates.length,
    parsed: days.filter((d) => d.outcome === "parsed").length,
    absent: days.filter((d) => d.outcome === "absent").length,
    failed: failedDays,
    consecutiveIndexFailures: consecutive,
    alarming,
    watermark: manifest.lastIndexDate,
    symbolsWithFilings: Object.keys(filingsBySymbol).length,
    universe: seed.symbols,
    withCik: seed.withCik,
    tickerMapPresent: seed.tickerMapPresent,
    redisCommands: dryRun ? 1 : 2,
    ms: Date.now() - started,
  };

  await recordJobRun("sec-daily-index", ok, summary);

  return NextResponse.json({
    ok,
    ...summary,
    // Stated rather than left to be inferred from zero matches.
    tickerMapNote: seed.tickerMapPresent
      ? null
      : `data/sec/company-tickers.json is not committed, so ${seed.withoutCik.length} symbol(s) have no CIK and the index can match nothing. See data/sec/README.md. This is NOT "no filings today".`,
    alarmNote: alarming
      ? `${consecutive} consecutive index failures (threshold ${CONSECUTIVE_FAILURE_ALARM}). A weekend is two; a holiday weekend three. Four means www.sec.gov is refusing us, not that EDGAR published nothing.`
      : null,
    seededThisRun: seed.seeded,
    symbolsWithoutCik: seed.withoutCik.slice(0, 20),
    days,
    filingsBySymbol,
    manifestWritten: written,
  });
}
