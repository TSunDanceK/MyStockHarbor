import { NextResponse } from "next/server";

import {
  checkBackfillKey,
  checkBackfillLockout,
  clearBackfillFailures,
  getClientIp,
  recordBackfillFailure,
} from "@/lib/server/backfillAuth";
import { reserveFmpCallSlot } from "@/lib/server/historyCache";
import { fmpFetch, flushFmpUsage } from "@/lib/server/fmpUsage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────────────────────
// PROBE ONLY. Does this plan serve a symbol-change feed at all?
//
// WHY A PROBE AND NOT AN IMPLEMENTATION. `symbol-change` and
// `company-symbols-change` appear NOWHERE in this repository -- not in code,
// not in the earlier probes, not in any doc. The endpoint has never been
// called. Designing rename handling around an endpoint nobody has called is a
// mistake this project has already made twice and written down twice: three
// index-constituent endpoints were unioned into the discovery master list while
// answering 402, and fetchFmpConstituentSymbols swallowed the non-ok response
// into [] so the failure was invisible for weeks.
//
// AND 402 IS THE LIKELY ANSWER. batch-quote is 402 on this plan; so are all six
// index-constituent variants. If this one is restricted too, renames need a
// different mechanism entirely -- and establishing that IS the deliverable, not
// a disappointing result.
//
// WHY IT MATTERS. A rename is not a delisting, so #404's mechanism will never
// catch it: probe Q5 found FB (now META) still reads isActivelyTrading: true.
// The consequences are worse than a dead symbol:
//
//   * HISTORY IS ORPHANED. msh:history:v7:FB holds up to 1,400 bars;
//     msh:history:v7:META starts empty. There is no alias layer, no merge and
//     no cross-reference anywhere in the codebase.
//   * BOTH SYMBOLS OCCUPY UNIVERSE SLOTS -- the old one via accumulated
//     state.dynamic, the new one via fresh discovery. Two slots and two sets of
//     per-cycle calls for one company.
//   * THE OLD ROW RENDERS A FROZEN PRICE. pricePool carries `prev` forward on
//     every failed fetch and PricePoolRow has no "this data is frozen" flag, so
//     a renamed ticker keeps showing its last-known price as though it were
//     current. #403's failStreak now at least bounds the CALLS; it does not
//     stop the row rendering.
//
// TWO ENDPOINT SPELLINGS ARE TRIED because FMP's stable and legacy namespaces
// disagree about this one and the docs are a JS-rendered playground this
// sandbox cannot read. Trying both costs one extra call and removes a guess.
//
// NOTHING IS IMPLEMENTED HERE WHATEVER THE ANSWER.
// ─────────────────────────────────────────────────────────────────────────────

type ProbeResult = {
  label: string;
  url: string;
  status: number | null;
  ok: boolean;
  /** What the plan says, when it refuses. 402 = not on this plan. */
  planRestricted: boolean;
  rowCount: number | null;
  /** Every distinct key across the returned rows -- the real field list. */
  fields: string[];
  /** Oldest and newest date found, whatever the date field turns out to be. */
  dateRange: { from: string | null; to: string | null };
  sample: unknown;
  /** The one case anyone can check by eye. */
  fbToMeta: unknown;
  error: string | null;
};

const CANDIDATES: Array<{ label: string; url: (key: string) => string }> = [
  {
    label: "stable/symbol-change",
    url: (k) => `https://financialmodelingprep.com/stable/symbol-change?apikey=${k}`,
  },
  {
    label: "stable/company-symbols-change",
    url: (k) => `https://financialmodelingprep.com/stable/company-symbols-change?apikey=${k}`,
  },
  {
    label: "api/v4/symbol_change",
    url: (k) => `https://financialmodelingprep.com/api/v4/symbol_change?apikey=${k}`,
  },
];

/** Any value that looks like an ISO date, wherever FMP put it. */
function datesIn(rows: Record<string, unknown>[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    for (const value of Object.values(row ?? {})) {
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) out.push(value.slice(0, 10));
    }
  }
  return out.sort();
}

/**
 * A row mentioning both FB and META, in whichever fields FMP uses.
 *
 * Deliberately field-agnostic: the whole point of the probe is that the schema
 * is unknown, so looking for `oldSymbol`/`newSymbol` would report "not found"
 * for a feed that carries the change under different names.
 */
function findFbToMeta(rows: Record<string, unknown>[]): unknown {
  return (
    rows.find((row) => {
      const values = Object.values(row ?? {}).map((v) => String(v).toUpperCase());
      return values.includes("FB") && values.includes("META");
    }) ?? null
  );
}

async function probe(label: string, url: string): Promise<ProbeResult> {
  const base: ProbeResult = {
    label,
    url: url.replace(/apikey=[^&]+/, "apikey=REDACTED"),
    status: null,
    ok: false,
    planRestricted: false,
    rowCount: null,
    fields: [],
    dateRange: { from: null, to: null },
    sample: null,
    fbToMeta: null,
    error: null,
  };

  try {
    await reserveFmpCallSlot();
    const res = await fmpFetch(url, { cache: "no-store", headers: { accept: "application/json" } });
    base.status = res.status;
    // 401/402/403 are the plan's answer, not a fault. Naming them separately is
    // the difference between "this endpoint is not available to us" and "this
    // endpoint is broken", which the earlier constituent probes conflated.
    base.planRestricted = res.status === 401 || res.status === 402 || res.status === 403;
    if (!res.ok) return base;

    const json = await res.json().catch(() => null);
    const rows = Array.isArray(json) ? (json as Record<string, unknown>[]) : [];
    base.ok = true;
    base.rowCount = rows.length;
    base.fields = Array.from(new Set(rows.flatMap((r) => Object.keys(r ?? {})))).sort();
    const dates = datesIn(rows);
    base.dateRange = { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null };
    base.sample = rows.slice(0, 3);
    base.fbToMeta = findFbToMeta(rows);
  } catch (error) {
    base.error = error instanceof Error ? error.message : String(error);
  }

  return base;
}

export async function GET(request: Request) {
  const ip = getClientIp(request);

  const lockout = await checkBackfillLockout(ip);
  if (lockout.locked) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts" },
      { status: 429, headers: { "retry-after": String(lockout.retryAfterSeconds) } }
    );
  }

  const submitted = new URL(request.url).searchParams.get("key") ?? "";
  if (!checkBackfillKey(submitted)) {
    await recordBackfillFailure(ip);
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  await clearBackfillFailures(ip);

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing FMP_API_KEY" }, { status: 500 });
  }

  const results: ProbeResult[] = [];
  for (const candidate of CANDIDATES) {
    results.push(await probe(candidate.label, candidate.url(apiKey)));
  }

  await flushFmpUsage();

  const served = results.filter((r) => r.ok);
  const restricted = results.filter((r) => r.planRestricted);

  return NextResponse.json({
    ok: true,
    // THE ANSWER, IN ONE LINE, because a probe whose conclusion has to be
    // reconstructed from three result objects is a probe nobody re-reads.
    verdict: served.length
      ? `${served.length} of ${results.length} spellings answered; ` +
        `rename detection is possible via ${served.map((r) => r.label).join(", ")}`
      : restricted.length === results.length
        ? "EVERY spelling is plan-restricted. Renames need a different mechanism " +
          "entirely -- do not design around this endpoint."
        : "No spelling answered, and not all refusals were plan restrictions. " +
          "Re-run before concluding; this may be transient.",
    fbToMetaFound: served.some((r) => r.fbToMeta),
    results,
  });
}
