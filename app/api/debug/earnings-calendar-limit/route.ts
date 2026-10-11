import { NextResponse } from "next/server";

import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { fmpFetch } from "@/lib/server/fmpUsage";
import { EARNINGS_CALENDAR_PAGE_CAP } from "@/lib/server/earningsCalendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Several multi-MB fetches back to back. 60s is not enough and the failure mode
// of guessing would be a timeout that reads as "the endpoint refused".
export const maxDuration = 300;

// ─────────────────────────────────────────────────────────────────────────────
// PROBE ONLY. Does earnings-calendar honour `limit`, and how big does a real
// month get?
//
// WHY IT EXISTS. The concentration measurement run on 2026-09-03 read 2026-01
// as 1,655 rows and 2026-02 as EXACTLY 4,000. An exact round number out of an
// endpoint that was sent no limit is a page cap, not a February -- so 93.4% in
// the busiest 20 days and 710 symbols on the peak day are FLOORS, and the
// growth arithmetic downstream of them is sized against a truncated month.
//
// THIS IS PROBE Q1 AGAIN, ONE ENDPOINT OVER. SCREENER_LIMIT sat at 1000 because
// nobody had tried raising it, and the coverage floor the whole plan reasoned
// from was wrong by an order of magnitude. Q1 proved `limit` lifts on the
// screener. Nobody asked the same question here.
//
// A 200 THAT IGNORES THE PARAMETER IS A FAIL THAT LOOKS LIKE A PASS, which is
// why this does not stop at the row count:
//
//   * it compares COUNTS across several limits, and
//   * it compares the SETS -- the (symbol|date) pairs added and removed
//     relative to the no-limit baseline. A cap that is honoured ADDS rows and
//     removes none; an ignored parameter returns a byte-identical set; a
//     server-side hard cap returns the same count from a different slice.
//   * it reports BYTES, because the answer changes what gets written to Redis
//     daily and "state the new size rather than discovering it on the
//     bandwidth meter" is the whole reason to look before committing.
//
// IT DELIBERATELY BYPASSES BOTH CACHES. fetchMonthRows would serve the shared
// reference key, whose 24h TTL still holds the truncated month -- measuring the
// cache instead of the endpoint is how a fix gets reported as a failure.
//
// NOTHING IS CHANGED BY THIS ROUTE. It does not write, and it does not touch
// EARNINGS_CALENDAR_LIMIT.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MONTH = "2026-02";
/** 0 means "send no limit parameter at all" -- the behaviour being replaced. */
const DEFAULT_LIMITS = [0, 4000, 10000, 20000];
const MAX_PROBES = 5;

type Probe = {
  limit: number;
  url: string;
  status: number | null;
  ok: boolean;
  /** 402 = not on this plan, and half this plan's endpoints answer that. */
  planRestricted: boolean;
  rows: number | null;
  bytes: number | null;
  bytesPerRow: number | null;
  distinctSymbols: number | null;
  dateRange: { from: string | null; to: string | null };
  /** Against the FIRST probe: what this limit gained and lost. */
  vsBaseline: { added: number; removed: number; identical: boolean } | null;
  /** The count landed exactly on the number asked for. */
  looksCapped: boolean;
  error: string | null;
};

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * What one limit gained and lost against the baseline.
 *
 * PURE AND EXPORTED so the invariant check can RUN it. The first version of
 * this lived inline in the handler and the assertion could only test that the
 * loop existed -- which stayed true with the result thrown away. "The
 * comparison is written" and "the comparison is reported" are different claims
 * and only one of them matters.
 */
export function compareSets(
  baseline: Set<string>,
  keys: Set<string>
): { added: number; removed: number; identical: boolean } {
  let added = 0;
  let removed = 0;
  for (const k of keys) if (!baseline.has(k)) added++;
  for (const k of baseline) if (!keys.has(k)) removed++;
  // SAME SIZE CAN STILL BE A DIFFERENT SLICE, so identity is decided by the
  // members rather than by the counts. "The count did not change" is not the
  // same claim as "the endpoint ignored me".
  return { added, removed, identical: added === 0 && removed === 0 };
}

/**
 * Which world are we in?
 *
 * PURE AND EXPORTED for the same reason: the last time this data was read by
 * eye, "4,000 exactly" went past unremarked, and a verdict nothing can test is
 * a sentence rather than a finding.
 */
export function verdictFor(probes: Array<Pick<Probe, "rows" | "vsBaseline" | "looksCapped">>): string {
  const withRows = probes.filter((p) => typeof p.rows === "number" && (p.rows ?? 0) > 0);
  if (!withRows.length) {
    return "no-data: every probe failed or returned nothing, so nothing is established";
  }
  const counts = new Set(withRows.map((p) => p.rows));
  if (counts.size === 1 && probes.some((p) => p.vsBaseline?.identical)) {
    return (
      "limit-ignored: every limit returned the same rows. The calendar must be " +
      "fetched in narrower date slices instead, which is a different change."
    );
  }
  const best = withRows.reduce<(typeof withRows)[number] | null>(
    (acc, p) => (acc === null || (p.rows ?? 0) > (acc.rows ?? 0) ? p : acc),
    null
  );
  if (best && best.looksCapped) {
    return (
      `hard-cap-or-still-truncated: the largest probe returned exactly its own limit ` +
      `(${best.rows}), so the true month is larger still. Raise the limits and re-run.`
    );
  }
  return (
    `limit-honoured: the row count moves with the parameter and the largest probe ` +
    `(${best?.rows} rows) is under its own limit, so it is a whole month.`
  );
}

export async function GET(request: Request) {
  const denied = await guardDebugRequest(request);
  if (denied) return denied;
  const url = new URL(request.url);

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing FMP_API_KEY" }, { status: 500 });
  }

  const month = url.searchParams.get("month") ?? DEFAULT_MONTH;
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  const [year, mon] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth(year, mon)).padStart(2, "0")}`;

  const limits = (url.searchParams.get("limits") ?? DEFAULT_LIMITS.join(","))
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v >= 0)
    .slice(0, MAX_PROBES);

  const probes: Probe[] = [];
  let baseline: Set<string> | null = null;

  for (const limit of limits) {
    const target =
      `https://financialmodelingprep.com/stable/earnings-calendar?from=${from}&to=${to}` +
      (limit > 0 ? `&limit=${limit}` : "") +
      `&apikey=${encodeURIComponent(apiKey)}`;
    const probe: Probe = {
      limit,
      url: target.replace(encodeURIComponent(apiKey), "***"),
      status: null,
      ok: false,
      planRestricted: false,
      rows: null,
      bytes: null,
      bytesPerRow: null,
      distinctSymbols: null,
      dateRange: { from: null, to: null },
      vsBaseline: null,
      looksCapped: false,
      error: null,
    };

    try {
      // no-store, because a cached response would make two probes agree for a
      // reason that has nothing to do with the parameter under test.
      const res = await fmpFetch(target, { cache: "no-store" });
      probe.status = res.status;
      probe.ok = res.ok;
      probe.planRestricted = res.status === 402;
      // TEXT FIRST, so the byte count is the real transfer rather than a
      // re-serialisation of the parsed object.
      const text = await res.text();
      probe.bytes = text.length;
      const json = res.ok ? JSON.parse(text) : null;
      const rows: Array<{ symbol?: string; date?: string }> = Array.isArray(json) ? json : [];
      probe.rows = Array.isArray(json) ? rows.length : null;
      probe.bytesPerRow = rows.length ? Math.round(text.length / rows.length) : null;
      probe.looksCapped = limit > 0 && rows.length === limit;

      const keys = new Set<string>();
      const symbols = new Set<string>();
      let lo: string | null = null;
      let hi: string | null = null;
      for (const row of rows) {
        const symbol = String(row?.symbol ?? "").trim().toUpperCase();
        const date = String(row?.date ?? "").slice(0, 10);
        if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        keys.add(`${symbol}|${date}`);
        symbols.add(symbol);
        if (!lo || date < lo) lo = date;
        if (!hi || date > hi) hi = date;
      }
      probe.distinctSymbols = symbols.size;
      probe.dateRange = { from: lo, to: hi };

      if (baseline === null) {
        baseline = keys;
      } else {
        probe.vsBaseline = compareSets(baseline, keys);
      }
    } catch (error) {
      probe.error = error instanceof Error ? error.message : String(error);
    }

    probes.push(probe);
  }

  // WHICH WORLD ARE WE IN. Stated as a verdict rather than left for the reader
  // to infer from four rows of numbers.
  const verdict = verdictFor(probes);

  return NextResponse.json({
    month,
    from,
    to,
    observedPageCap: EARNINGS_CALENDAR_PAGE_CAP,
    verdict,
    probes,
    howToRead:
      "vsBaseline.identical on every probe means the parameter is ignored. " +
      "looksCapped means the count landed exactly on the number asked for, " +
      "which is a page cap rather than a month. bytes is what a daily reference-" +
      "cache write will carry once EARNINGS_CALENDAR_LIMIT is set to that value.",
  });
}
