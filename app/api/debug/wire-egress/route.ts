import { guardDebugRequest } from "@/lib/server/backfillAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Worst case is every cell hanging to the full timeout: (4 cells + 1 control)
// x 2 rounds x 20s = 200s. 300 is what the warm jobs already use on this
// project, so it is known-available rather than hopeful.
export const maxDuration = 300;

// ONE-OFF EGRESS PROBE — SECOND PASS.
//
// ── WHAT THE FIRST PASS SETTLED, AND WHAT IT DID NOT ───────────────────────
// Round one asked "is globenewswire.com blocked from Vercel?" and answered NO:
// 157/38/28ms, HTTP 200 three times out of three, from a Vercel function. The
// host is reachable and fast from the exact place the render runs.
//
// That makes the 5,002ms hang on stock pages OURS, not the network's. But the
// first probe's fetch differed from the render's fetch in TWO ways at once, so
// it could not say which of them mattered:
//
//                       probe (round one)        the render (wireProvider.ts:214)
//   cache mode          cache: "no-store"        next: { revalidate: 3600 }
//   User-Agent          explicit MSH string      none (Node's default)
//
// Two changes, one result: unattributable. This pass separates them.
//
// ── THE 2x2 ────────────────────────────────────────────────────────────────
//                      no User-Agent          explicit User-Agent
//   no-store               A                        B  <- round one, answered
//   revalidate 3600        C  <- THE RENDER         D
//
// C is the decisive cell: it is the render's fetch, byte for byte, executed
// somewhere we can time it. The decision rule, fixed BEFORE the numbers arrive
// so the result cannot be read to taste:
//
//   C answers              the fetch config is not the cause; look higher up
//                          (concurrency, parse, the surrounding await)
//   C hangs + A answers    the Data Cache path is the cause
//   C hangs + A hangs      the User-Agent is the cause (B, which differs from
//                          A only in the UA, answered)
//   control silent         this function had no egress; the subjects prove
//                          nothing and the run is void
//
// D is the cross-check, not a fifth opinion: it should agree with whichever of
// the two axes the C/A/B path names.
//
// ── WHY THE ORDER OF CELLS IS LOAD-BEARING ─────────────────────────────────
// C and D both use `revalidate`, so both can READ FROM and WRITE TO Next's Data
// Cache. On the same URL they would share a key, and D would be at risk of
// being served C's cached body — a cache hit reported as a network measurement.
// So:
//   1. C runs FIRST, on the bare URL, with nothing yet cached in this
//      invocation. That is the only way to measure the render's cold path.
//   2. A and B run next. `no-store` neither reads nor writes the Data Cache, so
//      they cannot contaminate anything and nothing can contaminate them.
//   3. D runs LAST on a query-param-suffixed URL, which gives it its own cache
//      key. KNOWN DEVIATION, recorded rather than hidden: D's URL is not
//      byte-identical to the render's. It is the corroborating cell, not the
//      decisive one, which is why the deviation is acceptable there and would
//      not have been acceptable on C.
//
// ── ROUND 1 IS THE MEASUREMENT; ROUND 2 IS NOT A SECOND SAMPLE ─────────────
// For the `revalidate` cells, round 2 is EXPECTED to be a hit (Data Cache, or
// fetch memoisation within the invocation) and should come back near-zero. A
// fast round 2 on C is therefore not evidence of health. Read round 1. Two
// rounds is the brief's own call: the signal here is binary, not a
// distribution.
//
// ── THE TIMEOUT IS DELIBERATELY LONGER THAN PRODUCTION'S ───────────────────
// ADAPTER_TIMEOUT_MS is 5s. This probe waits 20s, because 5s cannot tell a hang
// from a slow answer and the entire point is to tell them apart. A host that
// answers at 8s is transient; one still silent at 20s is not.
//
// ── SAFE TO DELETE once the verdict is recorded ────────────────────────────
// A probe, not a feature.
//
//   /api/debug/wire-egress?key=...
const PROBE_TIMEOUT_MS = 20_000;
const ROUNDS = 2;

/** The render's URL, verbatim from lib/server/news/wireProvider.ts. */
const GLOBENEWSWIRE_URL =
  "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire---Public-Companies";

/**
 * The User-Agent under test.
 *
 * Deliberately the SEC_USER_AGENT convention already in the tree rather than a
 * probe-only invention: if the UA turns out to be the cause, the fix is to
 * reuse that existing mechanism, and the probe should have tested the thing
 * that would actually ship.
 */
const PROBE_UA = "MyStockHarbor/1.0 (+https://www.mystockharbor.com; contact sonnybrindle@mystockharbor.com)";

type CacheMode = "no-store" | "revalidate-3600";

type Cell = {
  id: string;
  role: "subject" | "control";
  url: string;
  cacheMode: CacheMode;
  userAgent: boolean;
  note: string;
};

/**
 * CONTROL FIRST, then C, A, B, D — see the ordering note above.
 *
 * The control is not padding: without it, "C hung" is equally consistent with
 * "this function had no egress at all", and the probe would be evidence for a
 * conclusion it cannot support. Google News is the per-symbol primary and is
 * known-good in production logs, so if it answers and a subject does not, the
 * difference is the request and not the network.
 */
const CELLS: Cell[] = [
  {
    id: "control",
    role: "control",
    url: "https://news.google.com/rss/search?q=%22Micron+Technology%22+stock&hl=en-US&gl=US&ceid=US:en",
    cacheMode: "no-store",
    userAgent: true,
    note: "known-good host; proves this function has egress at all",
  },
  {
    id: "C",
    role: "subject",
    url: GLOBENEWSWIRE_URL,
    cacheMode: "revalidate-3600",
    userAgent: false,
    note: "THE RENDER, byte for byte. Runs first so its round 1 is genuinely cold.",
  },
  {
    id: "A",
    role: "subject",
    url: GLOBENEWSWIRE_URL,
    cacheMode: "no-store",
    userAgent: false,
    note: "differs from C in cache mode only",
  },
  {
    id: "B",
    role: "subject",
    url: GLOBENEWSWIRE_URL,
    cacheMode: "no-store",
    userAgent: true,
    note: "round one's configuration; differs from A in the User-Agent only",
  },
  {
    id: "D",
    role: "subject",
    // Own cache key, so C cannot serve it. Recorded as a deviation.
    url: `${GLOBENEWSWIRE_URL}?mshProbeCell=D`,
    cacheMode: "revalidate-3600",
    userAgent: true,
    note: "cross-check; URL carries a probe query param to avoid sharing C's Data Cache key",
  },
];

type Attempt = {
  round: number;
  id: string;
  role: string;
  cacheMode: CacheMode;
  userAgent: boolean;
  ms: number;
  status: number | null;
  bytes: number;
  /** Whether ANY bytes arrived. A silent drop and a slow answer differ here. */
  gotBytes: boolean;
  error: string | null;
  /** Node buries the real reason (ECONNREFUSED etc.) in `cause`. */
  cause: string | null;
  aborted: boolean;
};

async function attempt(round: number, cell: Cell): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();

  // Built as one object so the two axes are visibly the ONLY difference between
  // cells. Anything else added here would silently become a third variable.
  const init: RequestInit & { next?: { revalidate: number } } =
    cell.cacheMode === "no-store" ? { cache: "no-store" } : { next: { revalidate: 3600 } };
  init.signal = controller.signal;
  if (cell.userAgent) init.headers = { "user-agent": PROBE_UA };

  try {
    const res = await fetch(cell.url, init);
    const body = await res.text();
    return {
      round,
      id: cell.id,
      role: cell.role,
      cacheMode: cell.cacheMode,
      userAgent: cell.userAgent,
      ms: Date.now() - startedAt,
      status: res.status,
      bytes: body.length,
      gotBytes: body.length > 0,
      error: null,
      cause: null,
      aborted: false,
    };
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: unknown };
    const cause = e?.cause as { code?: string; message?: string } | undefined;
    return {
      round,
      id: cell.id,
      role: cell.role,
      cacheMode: cell.cacheMode,
      userAgent: cell.userAgent,
      ms: Date.now() - startedAt,
      status: null,
      bytes: 0,
      gotBytes: false,
      error: `${e?.name ?? "Error"}: ${e?.message ?? String(err)}`,
      cause: cause?.code ?? cause?.message ?? null,
      aborted: e?.name === "AbortError",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const denied = await guardDebugRequest(request);
  if (denied) return denied;

  const attempts: Attempt[] = [];
  // SEQUENTIAL, not parallel. Cells opening at once share DNS and socket setup,
  // one cell's stall can mask another's, and — decisively here — parallel cells
  // on the same URL with `revalidate` would race the Data Cache, which is the
  // exact contamination the ordering above exists to prevent.
  for (let round = 1; round <= ROUNDS; round += 1) {
    for (const cell of CELLS) {
      const result = await attempt(round, cell);
      attempts.push(result);
      console.log(
        `[wire-egress] round=${result.round} cell=${result.id} ` +
          `cache=${result.cacheMode} ua=${result.userAgent} ${result.ms}ms ` +
          `status=${result.status ?? "-"} bytes=${result.bytes} aborted=${result.aborted} ` +
          `error=${result.error ?? "-"} cause=${result.cause ?? "-"}`
      );
    }
  }

  // ROUND 1 IS THE VERDICT. Round 2 of a `revalidate` cell is expected to be a
  // cache hit, so folding it into the verdict would turn "C was served from the
  // cache the second time" into evidence that C is healthy.
  const round1 = (id: string) => attempts.find((a) => a.round === 1 && a.id === id) ?? null;
  const answered = (id: string) => round1(id)?.status != null;

  const verdictFor = (id: string) => {
    const first = round1(id);
    if (!first) return "not-run";
    if (first.status != null) return "answers";
    if (first.aborted && !first.gotBytes) return "hangs";
    return "refused";
  };

  // The decision rule from the header comment, applied mechanically rather than
  // left to whoever reads the JSON.
  const decide = () => {
    if (!answered("control")) {
      return {
        cause: "void",
        detail: "The control host did not answer. This function had no egress; the subject cells prove nothing. Re-run.",
      };
    }
    if (answered("C")) {
      return {
        cause: "not-the-fetch-config",
        detail:
          "C is the render's fetch byte for byte and it answered here. Neither the Data Cache path nor the missing User-Agent explains the 5,002ms hang; look above the fetch (concurrency, parse, the surrounding await).",
      };
    }
    if (answered("A")) {
      return {
        cause: "data-cache-path",
        detail:
          "C hung and A answered. A differs from C in cache mode alone, so the `next: { revalidate: 3600 }` path is what stalls — not the User-Agent.",
      };
    }
    if (answered("B")) {
      return {
        cause: "user-agent",
        detail:
          "C and A both hung; B answered. A and B differ in the User-Agent alone, so the absent User-Agent is what stalls — not the cache mode.",
      };
    }
    return {
      cause: "inconclusive",
      detail:
        "C, A and B all hung. Round one's configuration (B) answered before and does not now, so the host's behaviour changed between runs; neither axis is isolated. Re-run before concluding anything.",
    };
  };

  const decision = decide();

  // D corroborates; it never decides. Reported separately so a disagreement is
  // visible instead of being averaged away.
  const corroboration = (() => {
    const d = verdictFor("D");
    if (decision.cause === "data-cache-path") {
      return d === "answers"
        ? "DISAGREES: D also uses `revalidate` and answered, so cache mode alone does not explain C."
        : "AGREES: D uses `revalidate` and also hung.";
    }
    if (decision.cause === "user-agent") {
      return d === "answers"
        ? "AGREES: D carries the User-Agent and answered despite using `revalidate`."
        : "DISAGREES: D carries the User-Agent and still hung.";
    }
    return `D verdict: ${d} (no decision for it to corroborate).`;
  })();

  const summary = CELLS.map((cell) => {
    const rows = attempts.filter((a) => a.id === cell.id);
    return {
      cell: cell.id,
      role: cell.role,
      cacheMode: cell.cacheMode,
      userAgent: cell.userAgent,
      note: cell.note,
      verdict: verdictFor(cell.id),
      msPerRound: rows.map((r) => r.ms),
      statuses: rows.map((r) => r.status),
      bytesPerRound: rows.map((r) => r.bytes),
      causes: [...new Set(rows.map((r) => r.cause).filter(Boolean))],
    };
  });

  return Response.json({
    ok: true,
    probeTimeoutMs: PROBE_TIMEOUT_MS,
    rounds: ROUNDS,
    grid: {
      A: "no-store        + no User-Agent",
      B: "no-store        + User-Agent   (round one's configuration)",
      C: "revalidate 3600 + no User-Agent  <- THE RENDER, decisive",
      D: "revalidate 3600 + User-Agent     (cross-check, own cache key)",
    },
    readMe:
      "Read ROUND 1 only. Round 2 of C and D is expected to be a Data Cache / memoisation hit and says nothing about the network. " +
      "If the control did not answer, the whole run is void.",
    decision,
    corroboration,
    summary,
    attempts,
  });
}
