import type { Metadata } from "next";
import { headers } from "next/headers";

import {
  checkCacheHealthKey,
  checkCacheHealthLockout,
  clearCacheHealthFailures,
  getClientIp,
  recordCacheHealthFailure,
} from "@/lib/server/backfillAuth";
import { readFmpUsage, FMP_BANDWIDTH_CAP_BYTES } from "@/lib/server/fmpUsage";
import { readRedisBandwidth, BYTES_MEASURED_AT } from "@/lib/server/redisBandwidth";
import { getFmpMinuteUsage } from "@/lib/server/historyCache";
import { isActiveMarketWindow } from "@/lib/server/marketHours";
import { readAllDatasetHealth, type DatasetHealth } from "@/lib/server/stalenessQueue";
import { readJobRuns } from "@/lib/server/jobRuns";
import { readSecHealth } from "@/lib/server/secHealth";
import { newsProviderMode, activeNewsProviders, feedMaxAgeDays } from "@/lib/server/news";
import { readNewsProviderStats } from "@/lib/server/newsStore";
import {
  COMPANY_NAME_SNAPSHOT_SIZE,
  COMPANY_NAME_SNAPSHOT_AS_OF,
} from "@/lib/server/companyNameSnapshot";
import {
  PROFILED_SIZE,
  CIK_MAP_SIZE,
  CIK_COVERED,
  CIK_MISSING,
} from "@/lib/server/staticProfile";

// MANDATORY, NOT A PREFERENCE. lib/server/backfillAuth.ts:16 builds a bare
// `Redis.fromEnv()` with no PAGE_READ_CACHE, so every call this page makes
// through it is a no-store fetch. A no-store call on a PRERENDERED route throws
// DYNAMIC_SERVER_USAGE at request time -- a 500 on every request, not a
// fallback to dynamic. That is the outage documented in
// claude/traps/a-visible-failure-is-not-a-harmless-one.md and reverted in #323.
// Verify with `node scripts/check-static-safety.mjs "app/cache-health/page.tsx"`.
//
// An owner-only page should never be prerendered anyway, so this costs nothing.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Unlinked from everywhere, absent from app/sitemap.ts, and noindex/nofollow.
// BotID protects API routes, not server-rendered page HTML
// (instrumentation-client.ts), so on a page the KEY is the control -- the
// robots directive is hygiene, not security.
export const metadata: Metadata = {
  title: "Cache health",
  robots: { index: false, follow: false, nocache: true },
};

const GB = 1024 ** 3;
/**
 * A policy duration, at whatever scale it actually is.
 *
 * The first version was `>= 48h ? days : hours`, which had no sub-hour branch:
 * the price pool's real 900-second policy rendered as "0h". The CONFIG was
 * right and the status logic read `ttlSeconds` directly, so the judgement on
 * that row was always correct -- only the label lied, which is worse than a
 * wrong judgement, because it makes a correct one look untrustworthy and
 * invites someone to "fix" a value that was never broken.
 */
function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 48 * 3600) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

const fmtBytes = (n: number) =>
  n >= GB ? `${(n / GB).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;

function fmtAge(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

type Status = "ok" | "warn" | "fault" | "unknown" | "seeded" | "uncovered";

/**
 * A row's status, derived from THAT DATASET'S OWN TTL.
 *
 * The single most important rule on this page (spec, "What it shows"): a
 * 30-day-old profile is healthy and a 30-day-old price is a fault, so a global
 * "stale = 24h" threshold would report most rows wrong. Everything below is
 * expressed as a FRACTION of the dataset's own policy, never in absolute time.
 *
 * "unknown" is a first-class outcome, not an error state. A dataset with no
 * queue has not been measured, and saying so is the point -- a page that
 * silently omitted it would be another instance of the exact failure that made
 * this page necessary.
 */
function statusFor(d: DatasetHealth, marketOpen: boolean): { status: Status; why: string } {
  if (!d.instrumented) {
    return { status: "unknown", why: "no staleness set yet — not measured, not necessarily healthy" };
  }

  // A RATIO OF A SET TO ITSELF IS NOT COVERAGE, and this check comes FIRST so
  // that no amount of freshness below can talk it into "ok".
  //
  // A dataset needs registerSymbols to declare its denominator and markRefreshed
  // to fill in the numerator. With only the second, the queue contains exactly
  // the symbols something already refreshed -- so every symbol that failed, or
  // was never attempted, is missing from the denominator rather than counted
  // against it. `dailyHistory` read "24 / 24, within policy" in that state, and
  // it would have read 24 / 24 with the other 700 symbols of the universe
  // entirely absent.
  //
  // This is the same failure as the "unknown" branch above, one level subtler:
  // there, nothing is measured and the page says so. Here something IS measured,
  // and what it measures is guaranteed to look perfect. The rendering has to be
  // distinct because the remedy is different -- not "instrument this", but "give
  // this a denominator".
  if (!d.coverageEstablished) {
    return {
      status: "uncovered",
      why: `${d.tracked} observed, no declared population — nothing calls registerSymbols for this dataset, so a ratio here could only ever be 100%`,
    };
  }

  // SEEDED IS NOT FAULTED. registerSymbols scores the whole universe 0, so the
  // moment a dataset is instrumented every symbol in it reads "never
  // refreshed" -- and the first version rendered that as a red fault on a
  // dataset whose warm job simply had not had its turn yet. That is the jobs
  // table's own bug one level down: a state that has not been observed reading
  // as a state that has failed.
  //
  // It stays neutral only while it is plausibly young. A dataset seeded twice
  // its own TTL ago with nothing refreshed is not waiting, it is broken -- and a
  // neutral status that can never escalate is the opposite error, a dead job
  // that reads calm forever. seededAtMs is what lets the page tell those apart;
  // where it is missing (a queue seeded before that key existed) the page says
  // the age is unknown rather than assuming either answer.
  if (d.never === d.tracked && d.tracked > 0) {
    if (d.seededAtMs === null) {
      return { status: "seeded", why: "registered, none refreshed yet — seed time unknown, so age cannot be judged" };
    }
    const seededAgoSec = Math.max(0, (Date.now() - d.seededAtMs) / 1000);
    if (seededAgoSec > d.ttlSeconds * 2) {
      return {
        status: "fault",
        why: `seeded ${fmtAge(d.seededAtMs)} — past 2× its own TTL and nothing has ever refreshed`,
      };
    }
    return { status: "seeded", why: `registered ${fmtAge(d.seededAtMs)}, waiting on its first run` };
  }

  // Staleness is judged against the OBSERVED population, not the tracked one.
  // Folding never-refreshed symbols into the stale percentage conflates "this
  // symbol went stale" with "this symbol was added and has not come up yet" --
  // two different problems with two different fixes. The never count is still
  // shown in its own column, and the all-never case is handled above.
  const observed = Math.max(0, d.tracked - d.never);
  const pct = observed > 0 ? d.stale / observed : 0;

  // IDLE BECAUSE CORRECT IS NOT BROKEN, and until now this page could not say
  // the difference. warmPricePool refuses to run outside the buffered trading
  // window, so from 21:01 UTC to 12:00 the next morning -- and all weekend --
  // nothing refreshes and a 15-minute policy puts the entire universe past its
  // TTL within a quarter of an hour. The page rendered that red for roughly
  // fifteen hours a day, every day, and the reading was CORRECT every time:
  // "100% of observed symbols past their own TTL" is exactly true and exactly
  // the wrong colour.
  //
  // A permanent red is a red nobody reads, which is how the one that means
  // something gets missed. Same failure as `quarterlyRefreshes: 0` before #416.
  //
  // NEUTRAL, NOT GREEN. The page genuinely does not know whether the last
  // session's run was healthy -- only that nothing was SUPPOSED to run since.
  // Rendering it green would be the opposite error, and the Oldest column plus
  // the warm-jobs table below still carry the real evidence.
  //
  // It stays capable of faulting: while the window is OPEN this branch is
  // skipped entirely and the ratio judgement below applies unchanged, so a
  // price pool that stops refreshing during the session is red within the
  // quarter hour, exactly as before.
  if (!marketOpen && d.marketHoursOnly && pct >= 0.05) {
    return {
      status: "seeded",
      why: `${Math.round(pct * 100)}% past their own TTL — expected: this dataset only refreshes inside the buffered US trading window, which is shut`,
    };
  }

  if (pct >= 0.25) return { status: "fault", why: `${Math.round(pct * 100)}% of observed symbols past their own TTL` };
  if (pct >= 0.05) return { status: "warn", why: `${Math.round(pct * 100)}% of observed symbols past their own TTL` };
  // Coverage is a separate question from staleness, and a mostly-unobserved
  // dataset must not read "ok" just because the few symbols it has seen are
  // fresh.
  if (d.never > 0 && d.never / d.tracked >= 0.25) {
    return { status: "warn", why: `observed symbols are within policy, but ${Math.round((d.never / d.tracked) * 100)}% have never been refreshed` };
  }
  return { status: "ok", why: "within policy" };
}

const STATUS_COLOR: Record<Status, string> = {
  ok: "#22c55e",
  warn: "#eab308",
  fault: "#ef4444",
  // Both neutral, and deliberately distinct from every judged colour: neither
  // is a verdict. "unknown" means nothing is measuring this; "seeded" means it
  // is measured and has not run yet.
  unknown: "rgba(255,255,255,0.35)",
  seeded: "#38bdf8",
  // Also not a verdict, and deliberately NOT green: the dataset may be perfectly
  // healthy, but this page has no way to tell and must not imply it does.
  uncovered: "#a78bfa",
};

function Denied({ reason }: { reason: string }) {
  return (
    <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial", padding: 40 }}>
      <h1 style={{ fontSize: 18 }}>Cache health</h1>
      <p style={{ color: "#94a3b8", fontSize: 14 }}>{reason}</p>
    </main>
  );
}

export default async function CacheHealthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const submitted = typeof params.key === "string" ? params.key : "";

  // `headers()` is why this page could never have been static anyway.
  const hdrs = await headers();
  const ip = getClientIp(new Request("https://x/", { headers: hdrs }));

  const lockout = await checkCacheHealthLockout(ip);
  if (lockout.locked) {
    return <Denied reason={`Too many attempts. Try again in ${Math.ceil(lockout.retryAfterSeconds / 60)} minutes.`} />;
  }
  if (!checkCacheHealthKey(submitted)) {
    await recordCacheHealthFailure(ip);
    // Deliberately identical wording whether the key is wrong or CACHE_HEALTH_KEY
    // is unset, so the page does not report its own configuration to a guesser.
    return <Denied reason="Not authorized." />;
  }
  await clearCacheHealthFailures(ip);

  // EVERY READ BELOW IS AN AGGREGATE. No dataset is enumerated, no symbol row is
  // fetched, nothing scales with the ~755-symbol universe: ZCARD/ZCOUNT/ZRANGE
  // 0..0 per dataset, 30 day-hashes for bytes, one mget for job runs. If this
  // page ever needs a scan to answer something, that answer belongs in a
  // counter instead (spec, "The page must be cheap to load").
  const [usage, minuteCalls, datasets, jobs, redisBandwidth, providerStats, secHealth] = await Promise.all([
    readFmpUsage(30),
    getFmpMinuteUsage(),
    readAllDatasetHealth(),
    readJobRuns(),
    // 7 days, not 30: the meter shipped 2026-09-04, so a 30-day window would be
    // 23 days of zeroes rendered beside 7 of data. The window widens on its own
    // once there is a month to widen into.
    readRedisBandwidth(7),
    // One HGETALL of today's stats hash — the same key readNewsStats already
    // reads, so this adds one aggregate read and nothing that scales with the
    // universe. Returns null when Redis is absent, which the panel renders as
    // "unknown" rather than as zero.
    readNewsProviderStats(),
    // FOUR O(1) COMMANDS, and deliberately not a manifest read. Everything
    // manifest-derived — queue depths, what each run wrote — is already counted
    // by the cron and already in `jobs` above, at zero additional cost. See
    // lib/server/secHealth.ts.
    readSecHealth(),
  ]);

  // COMPUTED ONCE, PASSED IN. Pure arithmetic over Intl -- no Redis, no fetch,
  // nothing that could make this page dynamic in a new way. Read here rather
  // than inside statusFor so every row is judged against the same instant and
  // so the function stays pure over its arguments, which is what lets the
  // invariant check run it.
  const marketOpen = isActiveMarketWindow();

  const pctCap = (usage.totalWireBytes / FMP_BANDWIDTH_CAP_BYTES) * 100;
  const pctRedisCap = (redisBandwidth.projectedMonthBytes / redisBandwidth.capBytes) * 100;

  const newsMode = newsProviderMode();
  const newsAdapters = activeNewsProviders().map((p) => p.id);

  const cell: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: 13, verticalAlign: "top" };
  const th: React.CSSProperties = { ...cell, color: "#94a3b8", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 };

  return (
    <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial", padding: "28px 18px 60px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Cache health</h1>
        <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 6 }}>
          Read-only. Nothing on this page triggers a refresh.
        </p>

        {/* ── Which news provider is actually serving ─────────────────────
            §8 of claude/news-adapter-spec-2026-09-13.md asks for this BY NAME,
            and names the failure it is for: at step 7 the thing that goes wrong
            is that something fails to register and the site quietly keeps
            calling FMP -- the one outcome this whole migration exists to stop.
            A log line nobody reads is not enough. See claude/silent-failure-traps.md.

            READ-ONLY AND FREE: newsProviderMode() is an env read and
            activeNewsProviders() returns a module-level array. No Redis, no FMP,
            nothing fetched. */}
        <section style={{ marginTop: 22, border: `1px solid ${newsMode === "fmp" ? "rgba(234,179,8,0.45)" : "rgba(255,255,255,0.08)"}`, borderRadius: 14, padding: 18 }}>
          <h2 style={{ fontSize: 14, margin: 0, color: "#e2e8f0" }}>News provider — active now</h2>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 10 }}>
            <strong style={{ fontSize: 30, color: newsMode === "fmp" ? "#eab308" : "#22c55e" }}>{newsMode}</strong>
            <span style={{ color: "#94a3b8", fontSize: 14 }}>
              {newsAdapters.join(" + ")} · {feedMaxAgeDays()}-day feed window
            </span>
          </div>

          {/* ── CONFIGURED vs CONTRIBUTED ─────────────────────────────────
              THE LINE ABOVE READ "gnews + wire + sec" FOR TWO DAYS WHILE THE
              WIRE LEG RETURNED NOTHING AT ALL. It was not wrong — those three
              are registered — it was answering a question nobody was asking. A
              registered adapter that is being tarpitted renders exactly like a
              working one, and the failure that made this necessary produced no
              error, no log line and no thrown promise
              (claude/wire-egress-verdict-2026-09-14.md).

              So: the row above is what is ASKED. The row below is what ANSWERED.
              A zero here is the alarm the adapter itself cannot raise. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {newsAdapters.map((id) => {
              // null stats and a zero count are DIFFERENT FACTS. Redis absent
              // means this panel cannot know; zero means the adapter was asked
              // today and brought back nothing. Rendering the first as "0"
              // would report an outage that is really a missing credential.
              const count = providerStats.status === "ok" ? providerStats.counts[id] ?? 0 : null;
              const silent = count === 0;
              return (
                <span
                  key={id}
                  style={{
                    fontSize: 12,
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: `1px solid ${silent ? "rgba(234,179,8,0.45)" : "rgba(255,255,255,0.12)"}`,
                    color: silent ? "#eab308" : "#cbd5e1",
                  }}
                >
                  {id} — {count === null ? "unknown" : `${count.toLocaleString()} items today`}
                </span>
              );
            })}
          </div>
          <p style={{ color: "#64748b", fontSize: 11, marginTop: 8 }}>
            Items each adapter <em>returned</em> today, counted before dedup — the question is whether
            it answered at all, not whether it was first to the story. Registered is the line above;
            this line is what actually came back. An adapter sitting at zero while the others move is
            the shape of the GlobeNewswire tarpit, which threw nothing and logged nothing.
            {providerStats.status === "unavailable"
              ? " Redis is unavailable, so nothing can be counted — that is 'unknown', not zero."
              : providerStats.status === "idle"
                ? " No refresh has run today yet, so there is nothing to count — 'unknown', not zero."
                : ""}
          </p>

          {newsMode === "fmp" ? (
            <p style={{ color: "#eab308", fontSize: 12, marginTop: 10 }}>
              <strong>NEWS_PROVIDER=fmp is set in this environment.</strong> The free stack is built
              and registered but is not serving. This is the deliberate rollback state — if nobody
              set it on purpose, the flip has been rolled back by env var, with no code change.
            </p>
          ) : (
            <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 10 }}>
              Default since step 7. Set <code>NEWS_PROVIDER=fmp</code> to roll back — no revert
              commit, no code change. It is an env var, so it takes a production redeploy
              (~2 min) to take effect; the build itself is unchanged.
            </p>
          )}

          {/* 2026-09-23 (#552, COWORK #4): the "Static profile snapshot" line
              is gone with data/static-profile.json (FMP data, removed). Sector
              and industry now fall from the cache to the SEC SIC leg. */}
          {/* ── CIK COVERAGE ──────────────────────────────────────────────
              A symbol with no CIK gets [] from the SEC adapter on EVERY render,
              permanently, and says so only through a per-request console.warn.
              That kept a 73.5% gap invisible for as long as it existed: the map
              was built against the PICKERS universe while the adapter is called
              for any symbol with a stock page, so 1,924 of 2,619 profiled
              symbols — AOS among them — had a structurally empty SEC leg.
              claude/cik-map-coverage-2026-09-14.md.

              FREE: both inputs are JSON imported at build time, so this is
              arithmetic over two module-level objects. No Redis, no fetch. */}
          {/* The third committed identity dataset. An empty company name is not
              cosmetic: gnewsProvider SKIPS the symbol, so the leg carrying the
              news page goes quiet. This is the floor under that. */}
          <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 10 }}>
            Company-name snapshot: {COMPANY_NAME_SNAPSHOT_SIZE.toLocaleString()} symbols, captured{" "}
            {COMPANY_NAME_SNAPSHOT_AS_OF}. Used when the live Nasdaq Trader fetch misses or fails —
            without it an empty name makes Google News skip the symbol entirely.
          </p>

          <p style={{ color: CIK_MISSING ? "#eab308" : "#94a3b8", fontSize: 12, marginTop: 10 }}>
            CIK map: {CIK_MAP_SIZE.toLocaleString()} symbols — covers{" "}
            {CIK_COVERED.toLocaleString()} of the {PROFILED_SIZE.toLocaleString()} profiled (
            {((100 * CIK_COVERED) / Math.max(1, PROFILED_SIZE)).toFixed(1)}%).
            {CIK_MISSING > 0 ? (
              <>
                {" "}
                <strong>{CIK_MISSING.toLocaleString()} profiled symbols have no CIK</strong> and get an
                empty SEC leg on every render. Regenerate with the relay task <code>sec</code>,{" "}
                <code>symbols=cik-map</code>.
              </>
            ) : null}
          </p>
        </section>

        {/* ── Top line: the limit that actually binds ─────────────────── */}
        <section style={{ marginTop: 22, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 18 }}>
          <h2 style={{ fontSize: 14, margin: 0, color: "#e2e8f0" }}>FMP bandwidth — 30-day rolling</h2>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 10 }}>
            <strong style={{ fontSize: 30 }}>{fmtBytes(usage.totalWireBytes)}</strong>
            <span style={{ color: "#94a3b8", fontSize: 14 }}>of {fmtBytes(FMP_BANDWIDTH_CAP_BYTES)} · {pctCap.toFixed(1)}%</span>
          </div>
          <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 999, marginTop: 10, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, pctCap)}%`, height: "100%", background: pctCap >= 85 ? "#ef4444" : pctCap >= 60 ? "#eab308" : "#22c55e" }} />
          </div>

          {/* The counters start when the meter ships, so an early window is
              mostly empty. Reporting the total without this makes a floor look
              like a measurement -- the same absence trap the page exists for. */}
          {usage.daysMissing > 0 ? (
            <p style={{ color: "#eab308", fontSize: 12, marginTop: 10 }}>
              {usage.daysMissing} of {usage.days} days have no data — the meter was not running for those.
              Treat this as a <strong>floor</strong>, not a measurement.
            </p>
          ) : null}

          <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 10 }}>
            Calls this minute: {minuteCalls} / 300 — the guarded limit, and not the one that is close.
          </p>

          {usage.endpoints.length ? (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
              <thead>
                <tr><th style={th}>Endpoint</th><th style={th}>Wire</th><th style={th}>Calls</th><th style={th}>Per call</th></tr>
              </thead>
              <tbody>
                {usage.endpoints.slice(0, 12).map((e) => (
                  <tr key={e.endpoint}>
                    <td style={cell}>{e.endpoint}</td>
                    <td style={cell}>{fmtBytes(e.wireBytes)}</td>
                    <td style={cell}>{e.calls.toLocaleString()}</td>
                    <td style={cell}>{fmtBytes(e.bytesPerCall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 12 }}>No byte samples recorded yet.</p>
          )}
        </section>

        {/* ── The limit that was ACTUALLY binding ─────────────────────── */}
        <section style={{ marginTop: 22, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 18 }}>
          <h2 style={{ fontSize: 14, margin: 0, color: "#e2e8f0" }}>Redis bandwidth — projected 30-day</h2>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 10 }}>
            <strong style={{ fontSize: 30 }}>{fmtBytes(redisBandwidth.projectedMonthBytes)}</strong>
            <span style={{ color: "#94a3b8", fontSize: 14 }}>
              of {fmtBytes(redisBandwidth.capBytes)} · {pctRedisCap.toFixed(1)}%
            </span>
          </div>
          <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 999, marginTop: 10, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, pctRedisCap)}%`, height: "100%", background: pctRedisCap >= 85 ? "#ef4444" : pctRedisCap >= 60 ? "#eab308" : "#22c55e" }} />
          </div>
          {/* CORRECTED 2026-09-12. This line said "Bandwidth is the metered
              dimension on this plan; commands are not", carrying
              redisBandwidth.ts:5's error onto a page used to DECIDE things —
              which is worse than a wrong comment, because a reader acts on it.
              The Upstash console reads PAY AS YOU GO: 1.9m commands at
              $0.20/100K = $3.80 of a $3.82 bill, with bandwidth's 47 GB inside
              a 200 GB included allowance. So commands are what bills, and the
              17M -> 338k reduction was worth ~$33/month rather than nothing.
              The panel still measures BANDWIDTH, which is the useful thing it
              can measure cheaply — it just must not claim that is the bill. */}
          <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 10 }}>
            <strong>Commands are what bills on this plan</strong> — pay-as-you-go, $0.20 per 100K,
            ~99% of the invoice — while bandwidth&apos;s first 200 GB each month are included. This
            panel measures bandwidth, so read it as a shape-of-traffic signal, not as the bill.
            Bytes are derived from per-symbol constants measured {BYTES_MEASURED_AT} and re-derived
            from the writing modules on every build (<code>scripts/check-redis-bandwidth.mjs</code>)
            — so this is a projection from counted reads, not from counted bytes.
          </p>
          {redisBandwidth.daysMissing > 0 ? (
            <p style={{ color: "#eab308", fontSize: 12, marginTop: 8 }}>
              {redisBandwidth.daysMissing} of {redisBandwidth.days} days have no data — the meter
              was not running for those. Treat this as a <strong>floor</strong>.
            </p>
          ) : null}
          {redisBandwidth.rows.length ? (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
              <thead>
                <tr><th style={th}>Caller</th><th style={th}>Bytes</th><th style={th}>Share</th><th style={th}>Reads</th><th style={th}>Symbols / read</th></tr>
              </thead>
              <tbody>
                {redisBandwidth.rows.map((row) => (
                  <tr key={`${row.source}:${row.caller}`}>
                    <td style={cell}>
                      <div>{row.caller}</div>
                      <div style={{ color: "#64748b", fontSize: 11 }}>{row.source}</div>
                    </td>
                    <td style={cell}>{fmtBytes(row.bytes)}</td>
                    <td style={cell}>
                      {redisBandwidth.totalBytes > 0
                        ? `${((row.bytes / redisBandwidth.totalBytes) * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td style={cell}>{row.reads.toLocaleString()}</td>
                    <td style={cell}>{row.unitsPerRead.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 12 }}>
              No reads recorded yet — the meter starts counting on the first instrumented read after
              deploy. Zero here means <em>not yet measured</em>, not zero bandwidth.
            </p>
          )}

          {/* THE SHAPE IS THE ANSWER, NOT THE TOTAL.
              Three readers want three completely different fixes and a daily
              total cannot tell them apart:
                flat across 24h            a cron
                dips 02:00-06:00 UTC       human traffic
                flat AND high, no dip      scrapers
              peakToMean near 1 is flat. This is what settles the question
              rather than arguing it from three log lines. */}
          {redisBandwidth.hourly.length ? (
            <div style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 12, color: "#e2e8f0", margin: "0 0 8px" }}>
                Units read by UTC hour — flat means a cron, a dip means people
              </h3>
              {redisBandwidth.hourly.map((profile) => {
                const peak = Math.max(...profile.units, 1);
                return (
                  <div key={profile.source} style={{ marginBottom: 12 }}>
                    <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>
                      {profile.source} · peak/mean {profile.peakToMean.toFixed(2)}{" "}
                      {profile.peakToMean < 1.6 ? "(flat — cron-shaped)" : "(peaky — traffic-shaped)"}
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 44 }}>
                      {profile.units.map((units, hour) => (
                        <div
                          key={hour}
                          title={`${String(hour).padStart(2, "0")}:00 UTC — ${units.toLocaleString()} symbols`}
                          style={{
                            flex: 1,
                            height: `${Math.max(2, (units / peak) * 100)}%`,
                            background: units > 0 ? "#38bdf8" : "rgba(255,255,255,0.10)",
                            borderRadius: 2,
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: 10, marginTop: 2 }}>
                      <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>

        {/* ── One row per dataset ─────────────────────────────────────── */}
        <section style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 14, color: "#e2e8f0" }}>Datasets</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr>
                <th style={th}>Dataset</th><th style={th}>Coverage</th><th style={th}>Past its TTL</th>
                <th style={th}>Oldest</th><th style={th}>Policy</th><th style={th}>Deferred</th><th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => {
                const { status, why } = statusFor(d, marketOpen);
                const fresh = Math.max(0, d.tracked - d.stale - d.never);
                return (
                  <tr key={d.dataset}>
                    <td style={cell}>
                      <div>{d.label}</div>
                      <div style={{ color: "#64748b", fontSize: 11 }}>{d.note}</div>
                    </td>
                    <td style={cell}>
                      {/* The number itself is withheld, not just recoloured. A
                          purple "24 / 24" still reads as 24 of 24; the whole
                          point is that the denominator is not a population. */}
                      {!d.instrumented
                        ? "—"
                        : !d.coverageEstablished
                          ? `${d.tracked} seen`
                          : `${fresh} / ${d.tracked}`}
                      {d.never > 0 ? <div style={{ color: "#64748b", fontSize: 11 }}>{d.never} never refreshed</div> : null}
                    </td>
                    <td style={cell}>
                      {d.instrumented ? d.stale : "—"}
                      {/* THE SPLIT, SHOWN RATHER THAN SUMMED AWAY. `d.stale` is
                          now each symbol judged against its own tier's policy,
                          which is the correct single number -- but a single
                          number cannot be checked by eye against a two-policy
                          dataset, and this row spent weeks red because nobody
                          could see which policy produced it. */}
                      {d.instrumented && d.tiers
                        ? (
                          <div style={{ color: "#64748b", fontSize: 11 }}>
                            {d.tiers
                              .map((t) => `${t.stale}/${t.tracked} @ ${fmtDuration(t.ttlSeconds)}`)
                              .join(" · ")}
                          </div>
                        )
                        : null}
                    </td>
                    <td style={cell}>{fmtAge(d.oldestMs)}</td>
                    <td style={cell}>
                      {d.tiers
                        ? d.tiers.map((t) => fmtDuration(t.ttlSeconds)).join(" / ")
                        : fmtDuration(d.ttlSeconds)}
                    </td>
                    <td style={cell}>{d.instrumented ? d.deferred : "—"}</td>
                    <td style={cell}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: STATUS_COLOR[status], marginRight: 7 }} />
                      <span style={{ color: "#cbd5e1" }}>{why}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ color: "#64748b", fontSize: 11, marginTop: 8 }}>
            Status is judged against each dataset&apos;s own TTL, never a global threshold — a 30-day-old
            profile is healthy, a 30-day-old price is a fault.
          </p>
          <p style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: STATUS_COLOR.seeded, marginRight: 7 }} />
            The US market is currently <strong style={{ color: "#94a3b8" }}>{marketOpen ? "open" : "shut"}</strong> (buffered
            window). Datasets that only refresh inside it are <em>supposed</em> to be past their TTL
            while it is shut, so they read neutral rather than red — being idle on purpose is not the
            same as being broken, and a red that is on every night is a red nobody reads.
          </p>
          <p style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: STATUS_COLOR.uncovered, marginRight: 7 }} />
            <strong style={{ color: "#94a3b8" }}>&ldquo;N seen&rdquo;</strong> is not a coverage figure. Those datasets
            record refreshes but nothing declares which symbols <em>ought</em> to be fresh, so the only
            symbols in the count are the ones that already succeeded — a ratio that is 100% by
            construction. It is shown as a raw count, and never green, until something calls
            <code style={{ margin: "0 3px" }}>registerSymbols</code> for them.
          </p>
        </section>

        {/* ── SEC filings pipeline ────────────────────────────────────────
            THE ONE DATASET WITH NO DATASET ROW. Every other source on this page
            reports through readAllDatasetHealth; the SEC fact sets do not,
            because they are not warmed on a schedule per symbol — they are
            populated by a nightly cron working queues, and topped up by a cold
            path on first view. The numbers that describe that are queue depths
            and refusals, not staleness.

            EVERY FIGURE HERE IS EITHER A COUNTER OR SOMETHING THE CRON ALREADY
            COUNTED. Nothing below enumerates symbols or reads the 417 KB
            manifest. */}
        <section style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 14, color: "#e2e8f0" }}>SEC filings — pipeline</h2>
          {!secHealth.available && (
            <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>
              Redis unavailable — the live counters below read <strong>unknown</strong>, not zero.
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 10 }}>
            {[
              {
                label: "Cold queue",
                value: secHealth.available ? `${secHealth.coldQueue} / ${secHealth.coldQueueMax}` : "unknown",
                // Deep is not by itself bad: the cron drains it nightly. AT THE
                // CAP is bad, because past it a cold symbol is dropped rather
                // than queued and only a later visit re-enqueues it.
                warn: secHealth.available && secHealth.coldQueue >= secHealth.coldQueueMax,
                note: "symbols seen on a first view, waiting for the cron",
              },
              {
                label: "CIKs awaiting drain",
                value: secHealth.available ? `${secHealth.coldCikPending} / ${secHealth.coldCikMax}` : "unknown",
                warn: secHealth.available && secHealth.coldCikPending >= secHealth.coldCikMax,
                note: "recorded by cold writes, folded in on the next run",
              },
              {
                label: "Cold fetches this minute",
                value: secHealth.available ? `${secHealth.minuteFetches} / ${secHealth.minuteCap}` : "unknown",
                warn: false,
                // A MOVING NUMBER AND ALMOST ALWAYS ZERO. It is here to show
                // the cap is live, not to be watched — the bucket resets every
                // minute and most minutes have no cold fetch at all.
                note: "site-wide budget; resets every minute",
              },
              {
                label: "Budget exhausted",
                value: secHealth.available
                  ? `${secHealth.exhaustedToday} today · ${secHealth.exhaustedYesterday} yesterday`
                  : "unknown",
                // THE ONLY FIGURE HERE THAT DECIDES ANYTHING. claimColdFetch's
                // own docblock says this count IS the decision procedure for
                // whether per-IP isolation in code ever has a case. Zero means
                // it never did; a regular non-zero is the evidence that would
                // reopen it. See claude/sec-rate-limits-2026-09-16.md.
                warn: secHealth.available && secHealth.exhaustedToday > 0,
                note: "the evidence that would justify per-IP capping in code",
              },
            ].map((m) => (
              <div key={m.label} style={{ minWidth: 190 }}>
                <div style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 22, color: m.warn ? "#eab308" : "#e2e8f0", marginTop: 4 }}>
                  {m.value}
                </div>
                <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>{m.note}</div>
              </div>
            ))}
          </div>

          {/* THE CRON'S OWN LAST RUN, read from the record it already writes.
              Rendered here rather than left to the Warm jobs table below
              because that table shows one Summary cell per job, and this job's
              summary is fifteen fields that mean nothing as a blob. */}
          {(() => {
            const run = jobs.find((j) => j.job === "sec-facts")?.run ?? null;
            if (!run) {
              return (
                <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 14 }}>
                  No sec-facts run recorded yet — it fires daily, so silence for part of a day is expected.
                </p>
              );
            }
            // ── AN ABSENT FIELD IS "not recorded", NEVER 0 ──────────────────
            //
            // `?? 0` renders a field the cron never wrote as a confident zero,
            // and it is the exact case that reached the owner: the panel showed
            // "Pages revalidated 0 of 434" for a run that PREDATED the
            // counter — a number that was never measured, presented as a
            // measurement, and read as the cron flushing nothing.
            //
            // `hasOwnProperty`, not a truthiness test: a genuine 0 is a real
            // reading and must still render as 0.
            const has = (k: string) => Object.prototype.hasOwnProperty.call(run.summary, k);
            const n = (k: string) => Number(run.summary[k] ?? 0);
            /** Every field must be present, or the whole row is unmeasured. */
            const row = (keys: string[], render: () => string) =>
              keys.every(has) ? render() : "not recorded";
            const rows: [string, string][] = [
              ["Sets written / unchanged / failed",
                row(["written", "unchanged", "failed"],
                  () => `${n("written")} / ${n("unchanged")} / ${n("failed")}`)],
              // CHANGED-ONLY, and the count is the proof. The cron revalidates
              // the earnings path for a symbol whose content hash MOVED, not
              // for all ~475 it touched — so this number should track "written"
              // and never "attempted".
              ["Pages revalidated",
                row(["revalidated", "attempted"],
                  () => `${n("revalidated")} of ${n("attempted")} attempted`)],
              ["Queues taken by that run (reverify / populate / rewindow)",
                row(["reverifyTaken", "populateTaken", "rewindowTaken"],
                  () => `${n("reverifyTaken")} / ${n("populateTaken")} / ${n("rewindowTaken")}`)],
              // ── "WHEN THE RUN STARTED", AND THE LABEL HAS TO SAY SO ────────
              //
              // populationQueues is called ONCE at the top of the run, so these
              // three are the state the run INHERITED, not the state now — the
              // run then drains them. Labelled "Backlogs" they read as current,
              // and that misreading happened immediately: the panel showed
              // populate 623 while the live queue was 354, because 623 was the
              // figure BEFORE that run took its 300. Same queue, two moments.
              ["Backlogs WHEN THAT RUN STARTED (reverify / populate / rewindow)",
                row(["reverifyBacklog", "populateBacklog", "rewindowBacklog"],
                  () => `${n("reverifyBacklog")} / ${n("populateBacklog")} / ${n("rewindowBacklog")}`)],
              ["Cold queue taken / cleared",
                row(["coldTaken", "coldCleared"], () => `${n("coldTaken")} / ${n("coldCleared")}`)],
              ["CIKs seen / filled / created / conflicts",
                row(["coldCikSeen", "coldCikFilled", "coldCikCreated", "coldCikConflicts"],
                  () => `${n("coldCikSeen")} / ${n("coldCikFilled")} / ${n("coldCikCreated")} / ${n("coldCikConflicts")}`)],
            ];
            return (
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
                <thead>
                  <tr>
                    <th style={th}>Last sec-facts run</th>
                    {/* fmtAge TAKES A TIMESTAMP, NOT A DURATION. The first
                        version passed `Date.now() - run.at` and would have
                        rendered a run from an hour ago as decades old, because
                        fmtAge subtracts from now itself. Caught by the lint
                        rule against calling Date.now() during render, which was
                        pointing at a real defect rather than a style one. */}
                    <th style={th}>{fmtAge(run.at)}{run.ok ? "" : " · FAULT"}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ ...cell, color: "#94a3b8" }}>{k}</td>
                      {/* Greyed, so an unmeasured row cannot be skim-read as a
                          figure sitting beside real ones. */}
                      <td style={{ ...cell, color: v === "not recorded" ? "#64748b" : undefined }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
          {/* A CONFLICT IS THE ONE ROW THAT NEEDS A PERSON. Everything else
              above drains on its own; a CIK disagreement is deliberately never
              applied and keeps being reported until someone rules on it. */}
          <p style={{ color: "#64748b", fontSize: 11, marginTop: 8 }}>
            Every figure in this table describes <strong>that run</strong>, not the present. The
            backlogs are what the run inherited before it drained them, so a large number here with
            a large &ldquo;taken&rdquo; beside it is the queue working, not a queue growing.
          </p>
          <p style={{ color: "#64748b", fontSize: 11, marginTop: 6 }}>
            A non-zero <strong>conflicts</strong> count is not self-healing: the drain reports a CIK
            disagreement and never applies it, because reconcileCiks owns that decision.
          </p>
        </section>

        {/* ── Warm jobs ───────────────────────────────────────────────── */}
        <section style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 14, color: "#e2e8f0" }}>Warm jobs — last run</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr><th style={th}>Job</th><th style={th}>When</th><th style={th}>Outcome</th><th style={th}>Summary</th></tr>
            </thead>
            <tbody>
              {jobs.map(({ job, label, instrumented, cron, intervalSeconds, run }) => {
                // THREE outcomes, not two. An uninstrumented job reading the
                // same as a dead one is the failure this page exists to remove,
                // and the first version reproduced it: four of six jobs recorded
                // nothing, so warm-price-pool -- which runs every three minutes
                // -- rendered "never run".
                // AND A FOURTH, for the same reason there had to be a third.
                // "No run recorded" reads identically for a job firing every
                // three minutes and one firing once a day, and those mean
                // opposite things. Observed live: warm-picker-universe and
                // warm-earnings both read "no run recorded" when neither had
                // failed and both were scheduled -- recordJobRun reached their
                // routes at 19:18 UTC and their crons fire at 07:00 and 07:15,
                // so neither had had an OPPORTUNITY to record. Silence shorter
                // than the job's own cadence is not evidence of anything.
                // A daily job's silence is expected for most of the day; a
                // 3-minute job's silence never is. That threshold is the whole
                // distinction, so it is one named constant rather than a
                // condition repeated in the status and the detail.
                const silenceIsExpected = !run && intervalSeconds >= 60 * 60 * 12;
                const status: Status = !instrumented
                  ? "unknown"
                  : run
                    ? run.ok
                      ? "ok"
                      : "fault"
                    // Neutral only while a full cycle has not yet passed. A job
                    // that should have recorded by now and has not is a fault,
                    // not a pending one.
                    : silenceIsExpected
                      ? "seeded"
                      : "fault";
                const outcome = !instrumented
                  ? "not instrumented"
                  : run
                    ? run.ok
                      ? "ok"
                      : "failed"
                    : "no run recorded yet";
                const detail = !instrumented
                  ? "this job does not call recordJobRun — nothing is known about it, which is not the same as nothing happening"
                  : run
                    ? Object.entries(run.summary)
                        // `exchanges` is pulled out and given its own line below
                        // rather than being buried in a 25-key join -- see
                        // exchangeSplit.
                        .filter(([k]) => k !== "exchanges")
                        .map(([k, v]) => `${k} ${v}`)
                        .join(" · ")
                    : `runs on \`${cron}\` (about every ${fmtDuration(intervalSeconds)}) — nothing recorded yet. ` +
                      (silenceIsExpected
                        ? "A daily job is silent for most of the day by design, so this means nothing until a full cycle has passed since the instrumentation shipped."
                        : "A job on this cadence should have recorded by now.");
                return (
                  <tr key={job}>
                    <td style={cell}>{label}</td>
                    <td style={cell}>{run ? fmtAge(run.at) : "—"}</td>
                    <td style={cell}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: STATUS_COLOR[status], marginRight: 7 }} />
                      {outcome}
                    </td>
                    <td style={{ ...cell, color: "#94a3b8", fontSize: 12 }}>
                      {detail}
                      {/*
                        THE EXCHANGE SPLIT, ON ITS OWN LINE.

                        The NYSE slice is the population that loses its price
                        history if the bars deal lands Nasdaq-only, so it is the
                        size of that decision's cost. It was already in the run
                        summary and therefore already on this page -- folded
                        into a 25-key `·` join, which is present without being
                        legible. A number nobody can find is a number nobody
                        uses.
                      */}
                      {typeof run?.summary?.exchanges === "string" && run.summary.exchanges ? (
                        <div style={{ marginTop: 4, color: "#cbd5e1" }}>
                          <strong style={{ color: "#94a3b8", fontWeight: 500 }}>exchange mix</strong>{" "}
                          {run.summary.exchanges}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
