import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { readPickersSymbolsIfCached } from "@/lib/server/pickersBuilder";
import { fmpFetch } from "@/lib/server/fmpUsage";
import { reserveFmpCallSlot } from "@/lib/server/historyCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ONE-OFF CAPTURE ROUTE. Returns the eight static profile fields that nothing
// in this repo caches, so they can be pasted into data/static-profile.json
// before the FMP licence goes.
//
// ── WHY A ROUTE AND NOT THE RELAY ──────────────────────────────────────────
// The fields live only behind /stable/profile, one call per symbol, and that
// needs FMP_API_KEY. The agent sandbox is refused financialmodelingprep.com
// outright (403 CONNECT) and the relay deliberately carries no FMP credential:
// this repository is public and forkable, and relay.yml's credential split is a
// security property, not an inconvenience. Production already holds the key, so
// the capture happens where the key already is and no new credential is created
// anywhere. Same shape as app/api/debug/news-sources.
//
// sector and industry are NOT here. They were snapshotted at zero cost from the
// Step 0 dump, which already carried them 100% populated for 2,619 symbols.
// This route exists only for the eight that had no cached copy.
//
// ── SAFE TO DELETE once the fields are committed ───────────────────────────
// It is a probe, not a feature. It makes real metered FMP calls, so leaving it
// deployed is a standing invitation to spend the budget by accident.
//
//   /api/debug/static-profile?key=...&offset=0&limit=250
//
// PAGED, BECAUSE ONE RESPONSE WILL NOT HOLD IT. ~700 symbols of eight fields is
// larger than is comfortable to copy in one go, and the function has a 300s
// ceiling against a metered upstream. Walk `offset` until `done` is true; each
// page is a complete JSON object that can be pasted on its own.
const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 400;

// THE EIGHT, and nothing else. Deliberately NOT selected here:
//   marketCap, beta, range, lastDividend -- readings, not facts. Freezing a
//     reading puts a stale number on a live page.
//   description -- FMP's authored prose rather than a fact.
//   sector, industry -- already snapshotted, free.
type StaticFields = {
  exchange: string | null;
  country: string | null;
  ipoDate: string | null;
  isin: string | null;
  cusip: string | null;
  website: string | null;
  ceo: string | null;
  employees: number | null;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const int = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
};

async function fetchStatic(symbol: string, apiKey: string): Promise<StaticFields | null> {
  try {
    // THE SAME PACING THE REST OF THE APP USES. reserveFmpCallSlot is what
    // keeps this under FMP_SAFE_CALLS_PER_MINUTE (200, against a 300 plan
    // ceiling); a probe that ignores it would starve the crons it shares the
    // budget with.
    await reserveFmpCallSlot();
    const url = `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(
      symbol
    )}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fmpFetch(url, { cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;
    if (!row || typeof row !== "object") return null;

    return {
      exchange: str(row.exchange) ?? str(row.exchangeShortName),
      country: str(row.country),
      ipoDate: str(row.ipoDate),
      isin: str(row.isin),
      cusip: str(row.cusip),
      website: str(row.website),
      ceo: str(row.ceo),
      employees: int(row.fullTimeEmployees ?? row.employees),
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const denied = await guardDebugRequest(request);
  if (denied) return denied;

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return Response.json({ ok: false, error: "FMP_API_KEY is not set" }, { status: 500 });
  }

  const params = new URL(request.url).searchParams;
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));

  const universe = (await readPickersSymbolsIfCached()) ?? [];
  if (!universe.length) {
    return Response.json({ ok: false, error: "universe not cached; try again after a pickers build" }, { status: 503 });
  }

  const sorted = [...new Set(universe.map((s) => String(s).trim().toUpperCase()).filter(Boolean))].sort();
  const slice = sorted.slice(offset, offset + limit);

  const rows: Record<string, StaticFields> = {};
  let missed = 0;
  for (const symbol of slice) {
    const fields = await fetchStatic(symbol, apiKey);
    // A SYMBOL WITH NO USABLE FIELD IS OMITTED, not written as eight nulls.
    // CompanyProfile filters rows with no value, so an all-null row renders
    // identically to an absent one and only makes the committed file bigger.
    if (fields && Object.values(fields).some((v) => v !== null)) rows[symbol] = fields;
    else missed += 1;
  }

  const next = offset + slice.length;
  return Response.json({
    ok: true,
    note: "Paste the `rows` object into data/.wire/static-profile-extra-<page>.json, then run scripts/static-profile-expand.mjs.",
    fields: ["exchange", "country", "ipoDate", "isin", "cusip", "website", "ceo", "employees"],
    universeSize: sorted.length,
    offset,
    limit,
    returned: Object.keys(rows).length,
    missed,
    next,
    done: next >= sorted.length,
    rows,
  });
}
