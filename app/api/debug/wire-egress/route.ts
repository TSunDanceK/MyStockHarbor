import { guardDebugRequest } from "@/lib/server/backfillAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ONE-OFF EGRESS PROBE. Answers a single question that nothing else can:
//
//   Is globenewswire.com BLOCKED from Vercel, or merely slow?
//
// ── WHY THIS CANNOT BE ANSWERED ANYWHERE ELSE ──────────────────────────────
// The agent sandbox is refused globenewswire.com outright, so it cannot ask.
// A GitHub runner CAN reach it — scripts/news-timing-probe.mjs measured
// 12-330ms there — which is exactly what makes the question live: the host is
// up, so the failure is specific to Vercel's egress. Only a Vercel function can
// distinguish the cases, so the probe has to run where the problem is.
//
// ── WHAT THE MEASUREMENT DECIDES ───────────────────────────────────────────
// From claude/news-flip-done-2026-09-14.md. Three outcomes, three answers:
//
//   immediate refusal / 403     IP-level block, structural  -> stop polling it
//                               per-symbol; the wire leg is dead for stock
//                               pages until something changes
//   hangs, no bytes             silent drop, likely deliberate -> same
//   answers, slowly/flaky       transient -> a per-feed timeout is enough
//
// The distinction is ELAPSED TIME PLUS ERROR SHAPE, which is why this does not
// simply race a promise: a bare Promise.race reports "slow" for every failure
// mode and would make all three look identical. AbortController lets the socket
// actually close AND surfaces Node's underlying cause (ECONNREFUSED, ENOTFOUND,
// UND_ERR_CONNECT_TIMEOUT), which is the half that names the mechanism.
//
// ── THE TIMEOUT IS DELIBERATELY LONGER THAN PRODUCTION'S ───────────────────
// ADAPTER_TIMEOUT_MS is 5s. This probe waits 20s, because 5s cannot tell a hang
// from a slow answer and the entire point is to tell them apart. A host that
// answers at 8s is transient; one that is still silent at 20s is not.
//
// ── SAFE TO DELETE once the verdict is recorded ────────────────────────────
// A probe, not a feature. Same shape and same fate as the news-sources probe
// and the static-profile capture route.
//
//   /api/debug/wire-egress?key=...
const PROBE_TIMEOUT_MS = 20_000;
const ROUNDS = 3;

/**
 * The two wire feeds, plus a CONTROL.
 *
 * The control is not padding: without it, "globenewswire timed out" is
 * consistent with "this function has no egress at all", and the probe would be
 * evidence for a conclusion it cannot support. Google News is the per-symbol
 * primary and is known-good in production logs, so if it answers here and
 * GlobeNewswire does not, the difference is the host and not the network.
 */
const TARGETS: Array<{ id: string; role: "subject" | "control"; url: string }> = [
  {
    id: "globenewswire",
    role: "subject",
    url: "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire---Public-Companies",
  },
  {
    id: "prnewswire",
    role: "subject",
    url: "https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss",
  },
  {
    id: "gnews-control",
    role: "control",
    url: "https://news.google.com/rss/search?q=%22Micron+Technology%22+stock&hl=en-US&gl=US&ceid=US:en",
  },
];

type Attempt = {
  round: number;
  id: string;
  role: string;
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

async function attempt(round: number, target: (typeof TARGETS)[number]): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const res = await fetch(target.url, {
      signal: controller.signal,
      // NO CACHING. A cached answer would report the Data Cache's health, not
      // the network's -- the measurement would describe the wrong layer.
      cache: "no-store",
      headers: {
        "user-agent": "MyStockHarbor/1.0 (+https://www.mystockharbor.com; egress probe)",
      },
    });
    const body = await res.text();
    return {
      round,
      id: target.id,
      role: target.role,
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
      id: target.id,
      role: target.role,
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
  // SEQUENTIAL, not parallel. Three hosts opening at once share DNS and socket
  // setup, and one host's stall can mask another's. Sequential costs wall time
  // and buys an unambiguous per-host number, which is the whole deliverable.
  for (let round = 1; round <= ROUNDS; round += 1) {
    for (const target of TARGETS) {
      const result = await attempt(round, target);
      attempts.push(result);
      console.log(
        `[wire-egress] round=${result.round} ${result.id} (${result.role}) ${result.ms}ms ` +
          `status=${result.status ?? "-"} bytes=${result.bytes} aborted=${result.aborted} ` +
          `error=${result.error ?? "-"} cause=${result.cause ?? "-"}`
      );
    }
  }

  // THE VERDICT IS COMPUTED HERE, not left to whoever reads the JSON, so the
  // three cases in the brief map onto one field rather than onto an impression.
  const verdictFor = (id: string) => {
    const rows = attempts.filter((a) => a.id === id);
    const answered = rows.filter((a) => a.status !== null);
    if (answered.length === rows.length) return "answers";
    if (answered.length > 0) return "intermittent";
    if (rows.every((a) => a.aborted && !a.gotBytes)) return "silent-drop";
    if (rows.every((a) => !a.aborted)) return "refused";
    return "mixed-failure";
  };

  const summary = TARGETS.map((t) => {
    const rows = attempts.filter((a) => a.id === t.id);
    return {
      id: t.id,
      role: t.role,
      verdict: verdictFor(t.id),
      msPerRound: rows.map((r) => r.ms),
      statuses: rows.map((r) => r.status),
      causes: [...new Set(rows.map((r) => r.cause).filter(Boolean))],
    };
  });

  return Response.json({
    ok: true,
    probeTimeoutMs: PROBE_TIMEOUT_MS,
    rounds: ROUNDS,
    note:
      "verdict: answers | intermittent = transient, a per-feed timeout suffices. " +
      "silent-drop | refused = structural. Read the control: if it did not answer " +
      "either, this function had no egress and the subjects prove nothing.",
    summary,
    attempts,
  });
}
