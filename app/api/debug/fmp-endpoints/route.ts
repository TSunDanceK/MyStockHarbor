import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Debug-only probe: which FMP endpoints does this plan actually serve, and how
// many symbols does each yield?
//
// WHY IT EXISTS
// -------------
// The discovery universe is mathematically saturated. Confirmed live 2026-08-06:
//
//   pool 353 + CURATED_UNIVERSE 54 = 407 = masterListSize     (exact)
//
// getNextDiscoveryBatch skips anything already in state.dynamic AND anything in
// CURATED_UNIVERSE, so with a 407-name master list there is nothing left for it
// to find -- ever. `[market] discovery admitted 0 symbols (attempted 0, ...)`.
// Raising UNIVERSE_CAP cannot help; the candidate pool is the binding
// constraint.
//
// The master list is 407 because buildExpandedDiscoveryMasterList unions three
// FMP constituent endpoints with the static lists, and those endpoints appear to
// answer 402 on this plan -- fetchFmpConstituentSymbols swallows a non-ok
// response into [], so the failure is invisible. This route makes it visible,
// and tests whether any endpoint on this plan CAN supply a larger candidate set.
//
// SAFETY
// ------
// * Fixed allowlist of endpoints -- no caller-supplied URLs, so this cannot be
//   used as an open proxy to FMP with the site's key.
// * Returns status codes and COUNTS plus a tiny sample, never a full symbol
//   list, so it is not a data-exfiltration surface.
// * Never echoes the API key, and strips it from any error text.
// * ~8 calls per invocation. Not on any cron; run by hand.

type Probe = {
  id: string;
  path: string;
  note: string;
};

// `symbol`-bearing list endpoints worth knowing about, plus two known-good
// controls so a total failure is distinguishable from a plan restriction.
const PROBES: Probe[] = [
  { id: "sp500-constituent", path: "sp500-constituent", note: "currently used by buildExpandedDiscoveryMasterList" },
  { id: "nasdaq-constituent", path: "nasdaq-constituent", note: "currently used" },
  { id: "dowjones-constituent", path: "dowjones-constituent", note: "currently used" },
  { id: "most-actives", path: "most-actives", note: "CONTROL -- known working (price pool uses it)" },
  { id: "biggest-gainers", path: "biggest-gainers", note: "CONTROL -- known working" },
  {
    id: "company-screener-1b",
    path: "company-screener?marketCapMoreThan=1000000000&exchange=NASDAQ,NYSE&isActivelyTrading=true&limit=1000",
    note: "BEST CANDIDATE -- if this works it can supply hundreds of names",
  },
  {
    id: "company-screener-300m",
    path: "company-screener?marketCapMoreThan=300000000&exchange=NASDAQ,NYSE&isActivelyTrading=true&limit=1000",
    note: "wider net, same endpoint",
  },
  { id: "stock-list", path: "stock-list", note: "full symbol directory if available" },
];

function scrub(text: string, apiKey: string) {
  return apiKey ? text.split(apiKey).join("<key>") : text;
}

export async function GET() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing FMP_API_KEY" }, { status: 500 });
  }

  const results = [];

  for (const probe of PROBES) {
    const joiner = probe.path.includes("?") ? "&" : "?";
    const url = `https://financialmodelingprep.com/stable/${probe.path}${joiner}apikey=${encodeURIComponent(apiKey)}`;

    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const text = await res.text();

      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      const arr = Array.isArray(json) ? (json as Record<string, unknown>[]) : null;
      const symbols = arr
        ? Array.from(
            new Set(
              arr
                .map((row) => String(row?.symbol ?? "").trim().toUpperCase())
                .filter(Boolean)
            )
          )
        : [];

      results.push({
        id: probe.id,
        note: probe.note,
        httpStatus: res.status,
        ok: res.ok,
        isArray: Array.isArray(json),
        rows: arr ? arr.length : null,
        uniqueSymbols: symbols.length,
        sample: symbols.slice(0, 5),
        // Non-array responses are where the plan message lives (402/403 bodies).
        message: arr ? null : scrub(text, apiKey).slice(0, 200),
      });
    } catch (error) {
      results.push({
        id: probe.id,
        note: probe.note,
        httpStatus: null,
        ok: false,
        isArray: false,
        rows: null,
        uniqueSymbols: 0,
        sample: [],
        message: scrub(error instanceof Error ? error.message : "fetch failed", apiKey),
      });
    }
  }

  const working = results.filter((r) => r.uniqueSymbols > 0);
  const bestForDiscovery = [...working].sort((a, b) => b.uniqueSymbols - a.uniqueSymbols)[0] ?? null;

  return NextResponse.json({
    probedAt: new Date().toISOString(),
    // The headline: can anything here supply a bigger candidate pool than the
    // 407-name static master list?
    largestSymbolSource: bestForDiscovery
      ? { id: bestForDiscovery.id, uniqueSymbols: bestForDiscovery.uniqueSymbols }
      : null,
    currentMasterListSize: 407,
    results,
  });
}
