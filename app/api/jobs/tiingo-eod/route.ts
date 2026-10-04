import { NextRequest, NextResponse } from "next/server";
import { runTiingoEod, runSummary } from "../../../../lib/server/marketData/jobs";
import { recordJobRun } from "../../../../lib/server/jobRuns";
import { guardJob } from "../../../../lib/server/jobGuard";
import { revalidatePath } from "next/cache";
import { PICKER_ROUTES } from "@/lib/pickerRoutes";
import { priceProviderFor } from "../../../../lib/server/marketData/provider";
import type { EodBar } from "../../../../lib/server/marketData/types";
import {
  getPickersData,
  readLastBuildStats,
  readLastHistoryStats,
} from "../../../../lib/server/pickersBuilder";
import { writeMarketMood, type MoodWrite } from "../../../../lib/server/marketMoodWrite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// TIINGO (#553 COWORK #55 §2, #56, #57). Nightly EOD re-pull of every universe symbol into msh:tiingo:eod:v1:<SYM>, gated on the bulk file showing tonight's date, then revalidateTag('eod').
//
// One of the only two routes that may import lib/server/marketData/jobs.ts,
// the only importer of the adapter (scripts/check-tiingo-callers.mjs). No page
// or visitor-facing route reaches Tiingo.

// STEP 2 (#553 COWORK #57 §4): THE PICKERS BUILD RIDES ON THE NIGHT'S BARS.
// With PRICE_PROVIDER_PICKERS=tiingo, a complete night hands its in-memory
// bars to one forced Pickers build, which then reads no history at all. The
// hourly rebuilds (the payload's 1 h TTL) read the same bars through the Data
// Cache. With the switch on fmp nothing here runs.
//
// TIME: the fetch has its own 240 s budget inside a 300 s function, so the
// build starts only while PICKERS_BUILD_MIN_LEFT_MS remain (a build measured
// ~10 s at 700 symbols, with no history reads). A skipped build is recorded;
// the next hourly or 07:02 build reads the Data Cache instead.
const FUNCTION_MS = maxDuration * 1000;
const PICKERS_BUILD_MIN_LEFT_MS = 100_000;

type PickersOnBars = { pickersBuild: string; pickers?: Record<string, unknown> };

function pickersOnBars(req: NextRequest, startedAt: number, out: PickersOnBars) {
  return async (bars: Map<string, EodBar[]>) => {
    if (priceProviderFor("PICKERS") !== "tiingo") {
      out.pickersBuild = "off (provider fmp)";
      return;
    }
    const left = FUNCTION_MS - (Date.now() - startedAt);
    if (left < PICKERS_BUILD_MIN_LEFT_MS) {
      out.pickersBuild = `skipped: ${Math.round(left / 1000)}s left`;
      return;
    }
    const t = Date.now();
    try {
      await getPickersData(new URL(req.url).origin, { forceRefresh: true, eodBars: bars });
      const build = readLastBuildStats();
      const history = readLastHistoryStats();
      let revalidated = 0;
      for (const route of PICKER_ROUTES) {
        try {
          revalidatePath(route);
          revalidated++;
        } catch {
          // one route failing to revalidate must not fail the night
        }
      }
      out.pickersBuild = build?.wrote ? "written" : build?.degradedFallbackUsed ? "refused (degraded)" : "not written";
      out.pickers = { ...history, universeSize: build?.universeSize ?? null, degradedSymbolPct: build?.degradedSymbolPct ?? null, revalidated, ms: Date.now() - t };
    } catch (error) {
      // Never into the EOD result: the bars are already written and tagged.
      out.pickersBuild = `threw: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`;
    }
  };
}

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function handleGET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const startedAt = Date.now();
    const onBars: PickersOnBars = { pickersBuild: "not reached (incomplete night or nothing fetched)" };
    // MARKET MOOD (#563 COWORK #96): the same complete night's bars, first (about a second, 1 SET),
    // then the Pickers build as before.
    const mood: MoodWrite = { mood: "not reached (incomplete night or nothing fetched)" };
    const pickers = pickersOnBars(req, startedAt, onBars);
    const both = async (bars: Map<string, EodBar[]>) => {
      Object.assign(mood, await writeMarketMood(bars));
      await pickers(bars);
    };
    const result = { ...(await runTiingoEod(Date.now(), both)), ...onBars, ...mood };
    console.log("[tiingo-eod]", JSON.stringify(result));
    await recordJobRun("tiingo-eod", result.ok !== false, runSummary(result));
    return NextResponse.json(result, { status: result.ok === false ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "tiingo-eod failed";
    await recordJobRun("tiingo-eod", false, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// RUNAWAY-COST GUARD: kill switch, daily circuit breaker, per-run command
// budget, stop on Redis errors. See lib/server/jobGuard.ts.
export const GET = guardJob("tiingo-eod", handleGET);
