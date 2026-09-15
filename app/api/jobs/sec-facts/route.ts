import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "@/lib/server/jobRuns";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { readManifest, writeManifest, type SecManifest } from "@/lib/server/secManifest";
import { extractCompanyFacts, checkIdentities, identityRates, type CompanyFacts } from "@/lib/server/secExtract";
import { encodeFactSet, readFactSet, writeFactSet } from "@/lib/server/secFactStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// STEP 3 — the standing population path.
//
// KEYED ON contentHash === null, AND STANDING RATHER THAN A BACKFILL.
// `claude/sec-cold-start-coverage-2026-09-14.md` §2: only a filing event fills
// contentHash, so a symbol that has not filed since the manifest was seeded
// stays null forever and a one-off backfill leaves the same hole open for every
// symbol admitted afterwards. So this job runs every day and keeps finding them,
// and it will keep finding them for as long as the universe grows.
//
// TWO QUEUES, IN ORDER, WITH SEPARATE ALLOWANCES:
//
//   1. REVERIFY -- a filing event says this symbol's numbers may have moved.
//      Time-sensitive: the page is showing last quarter's figures right now.
//   2. POPULATE -- contentHash is null; the page has nothing at all.
//
// Reverify goes first because a stale number on a live page is worse than an
// absent one, and it is given the smaller allowance because it is driven by
// what actually filed rather than by a backlog.
//
// WHY A SEPARATE JOB FROM sec-daily-index. That job's stated property is ZERO
// companyfacts calls -- the change detector proved in isolation, so a wrong
// number later cannot be blamed on a detector nobody tested alone. Folding the
// fetch into it would spend that property. Two crons, twenty minutes apart.

/**
 * Per-run allowances.
 *
 * SIZED FROM THE WIRE COST, WHICH IS THE BINDING CONSTRAINT. There is no
 * conditional check on companyfacts -- Last-Modified and ETag are both absent,
 * measured 23 of 23 (`claude/sec-reread-no-cheap-check-2026-09-13.md`) -- so
 * every fetch is a full body. Measured ~150 KB typical, and AAPL's is ~10 MB.
 * 60 + 40 is ~15 MB of wire in the worst realistic mix, comfortably inside a
 * 300s function, and drains a 700-symbol universe in about a fortnight.
 *
 * SEPARATE, NOT SHARED. One pool would let a large backlog of never-populated
 * symbols starve the reverify queue for days -- the same priority inversion
 * SEC_COLD_FETCH_DRAIN_PER_RUN was given its own allowance to avoid.
 */
export const SEC_REVERIFY_PER_RUN = 60;
export const SEC_POPULATE_PER_RUN = 40;

/** SEC asks for at most 10 requests a second with a declared User-Agent. */
const MIN_GAP_MS = 125;

const SEC_UA = process.env.SEC_USER_AGENT || "";

async function authorize(req: NextRequest): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth === `Bearer ${secret}`) return null;
  return guardDebugRequest(req);
}

/**
 * The two queues, in priority order, each capped separately.
 *
 * EXPORTED AND PURE so a check can run it against a fixed manifest. The ordering
 * rule is the whole behaviour of this job and it should not need a network to
 * test.
 */
export function populationQueues(
  manifest: SecManifest,
  limits = { reverify: SEC_REVERIFY_PER_RUN, populate: SEC_POPULATE_PER_RUN }
) {
  const entries = Object.entries(manifest.symbols).filter(([, e]) => e.cik);

  const reverify = entries
    .filter(([, e]) => e.needsReverify)
    // Oldest enqueue first, so a symbol cannot be starved by a steadier stream
    // of newer events -- the same reason secRereadQueue sorts by enqueuedAt.
    .sort((a, b) => (a[1].enqueuedAt ?? 0) - (b[1].enqueuedAt ?? 0))
    .map(([s]) => s);

  const populate = entries
    .filter(([, e]) => !e.needsReverify && e.contentHash === null)
    .map(([s]) => s)
    .sort();

  return {
    reverify: reverify.slice(0, limits.reverify),
    populate: populate.slice(0, limits.populate),
    // The BACKLOG, not just what this run took. A drain that never shortens is
    // invisible from a per-run count alone, and this is the number that says
    // whether the standing path is keeping up.
    reverifyBacklog: reverify.length,
    populateBacklog: populate.length,
  };
}

let lastAt = 0;
async function fetchCompanyFacts(cik: string): Promise<CompanyFacts> {
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
    { headers: { "User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate" }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  // A 200 CARRYING HTML IS NOT DATA. Parsing one as data is how this site got
  // wrong numbers before; the same strictness that caught Stooq.
  if (!ct.includes("json")) throw new Error(`expected JSON, got ${ct}`);
  return (await res.json()) as CompanyFacts;
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  if (!SEC_UA) {
    const summary = {
      ok: false,
      error:
        "SEC_USER_AGENT is unset. SEC's fair-access policy requires a declared, " +
        "contactable agent; fetching without one risks a block on the whole account.",
    };
    await recordJobRun("sec-facts", false, summary);
    console.log("[sec-facts]", JSON.stringify(summary));
    return NextResponse.json(summary, { status: 503 });
  }

  const manifest = await readManifest();
  if (!manifest) {
    const summary = { ok: false, error: "no manifest — run /api/jobs/sec-daily-index first" };
    await recordJobRun("sec-facts", false, summary);
    console.log("[sec-facts]", JSON.stringify(summary));
    return NextResponse.json(summary, { status: 503 });
  }

  const q = populationQueues(manifest);
  const url = new URL(req.url);
  // One symbol, on demand — for checking a single page after a deploy without
  // waiting a day for the cron. Still goes through the same code path.
  const only = (url.searchParams.get("symbol") || "").toUpperCase();
  const work = only
    ? [{ symbol: only, reason: "manual" as const }]
    : [
        ...q.reverify.map((symbol) => ({ symbol, reason: "reverify" as const })),
        ...q.populate.map((symbol) => ({ symbol, reason: "populate" as const })),
      ];

  const results: Record<string, unknown>[] = [];
  let written = 0;
  let unchanged = 0;
  let failed = 0;

  for (const { symbol, reason } of work) {
    const entry = manifest.symbols[symbol];
    if (!entry?.cik) {
      results.push({ symbol, reason, error: "no CIK in the manifest" });
      failed++;
      continue;
    }
    try {
      const facts = await fetchCompanyFacts(entry.cik);
      const extracted = extractCompanyFacts(symbol, facts);
      const set = encodeFactSet(extracted);
      const rates = identityRates(checkIdentities(extracted));

      const prior = await readFactSet(symbol);
      // LAYER 2 OF THE CORRECTIONS FAILSAFE (spec §3). A content hash that moved
      // with no filing event behind it is a SILENT RESTATEMENT -- the case the
      // amended-form signal cannot see. The site is allowed to update; it is not
      // allowed to update without a trace, so it is logged with the periods and
      // the accession rather than quietly overwritten.
      const changed = prior ? prior.contentHash !== set.contentHash : true;
      if (prior && changed && !entry.needsReverify) {
        const movedPeriods = set.quarters
          .filter((p) => {
            const was = prior.quarters.find((x) => x.e === p.e);
            return was && JSON.stringify(was.v) !== JSON.stringify(p.v);
          })
          .map((p) => `${p.e}(${p.a ?? "?"})`);
        console.warn(
          "[sec-facts] SILENT RESTATEMENT",
          JSON.stringify({ symbol, from: prior.contentHash, to: set.contentHash, movedPeriods })
        );
      }

      if (changed) {
        if (await writeFactSet(set)) written++;
        else throw new Error("fact-set write failed");
      } else {
        unchanged++;
      }

      entry.contentHash = set.contentHash;
      entry.needsReverify = false;
      entry.reverifyReason = null;
      entry.verifiedAt = Date.now();

      results.push({
        symbol, reason, changed,
        quarters: set.quarters.length, years: set.years.length, instants: set.instants.length,
        coverAsOf: set.cover?.asOf ?? null,
        identities: rates,
        notes: set.notes.length,
      });
    } catch (err) {
      failed++;
      // NOT CLEARED ON FAILURE. Leaving needsReverify set is what makes the next
      // run retry it; clearing it here would turn one bad fetch into a symbol
      // that is never re-read again.
      results.push({ symbol, reason, error: String((err as Error)?.message ?? err) });
    }
  }

  // ONE SET, whatever happened — the manifest is a single key.
  const persisted = await writeManifest(manifest);

  const summary = {
    ok: failed === 0 || failed < work.length,
    attempted: work.length,
    written, unchanged, failed,
    reverifyTaken: only ? 0 : q.reverify.length,
    populateTaken: only ? 0 : q.populate.length,
    reverifyBacklog: q.reverifyBacklog,
    populateBacklog: q.populateBacklog,
    manifestWritten: persisted,
  };
  await recordJobRun("sec-facts", summary.ok, summary);
  // THE CRON LEAVES NO OTHER TRACE. sec-daily-index ran for a full day writing
  // nothing to the runtime log, and "did it run at all" could not be answered
  // from the Vercel console. One line, always.
  console.log("[sec-facts]", JSON.stringify(summary));

  return NextResponse.json({ ...summary, results });
}
