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
import { readAllDatasetHealth, type DatasetHealth } from "@/lib/server/stalenessQueue";
import { readJobRuns } from "@/lib/server/jobRuns";

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
function statusFor(d: DatasetHealth): { status: Status; why: string } {
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
  const [usage, minuteCalls, datasets, jobs, redisBandwidth] = await Promise.all([
    readFmpUsage(30),
    getFmpMinuteUsage(),
    readAllDatasetHealth(),
    readJobRuns(),
    // 7 days, not 30: the meter shipped 2026-09-04, so a 30-day window would be
    // 23 days of zeroes rendered beside 7 of data. The window widens on its own
    // once there is a month to widen into.
    readRedisBandwidth(7),
  ]);

  const pctCap = (usage.totalWireBytes / FMP_BANDWIDTH_CAP_BYTES) * 100;
  const pctRedisCap = (redisBandwidth.projectedMonthBytes / redisBandwidth.capBytes) * 100;

  const cell: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: 13, verticalAlign: "top" };
  const th: React.CSSProperties = { ...cell, color: "#94a3b8", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 };

  return (
    <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial", padding: "28px 18px 60px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Cache health</h1>
        <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 6 }}>
          Read-only. Nothing on this page triggers a refresh.
        </p>

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
          {/* THE POINT OF THE WHOLE PANEL, said in one line. Commands are
              unlimited on this plan and bandwidth is not, so the 17M -> 338k
              command reduction bought nothing here — while FMP, the meter that
              existed, sat at ~11%. */}
          <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 10 }}>
            Bandwidth is the metered dimension on this plan; commands are not. Bytes are derived
            from per-symbol constants measured {BYTES_MEASURED_AT} and re-derived from the writing
            modules on every build (<code>scripts/check-redis-bandwidth.mjs</code>) — so this is a
            projection from counted reads, not from counted bytes.
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
                <tr><th style={th}>Source</th><th style={th}>Bytes</th><th style={th}>Share</th><th style={th}>Reads</th><th style={th}>Symbols / read</th></tr>
              </thead>
              <tbody>
                {redisBandwidth.rows.map((row) => (
                  <tr key={row.source}>
                    <td style={cell}>{row.source}</td>
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
                const { status, why } = statusFor(d);
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
                    <td style={cell}>{d.instrumented ? d.stale : "—"}</td>
                    <td style={cell}>{fmtAge(d.oldestMs)}</td>
                    <td style={cell}>{fmtDuration(d.ttlSeconds)}</td>
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
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: STATUS_COLOR.uncovered, marginRight: 7 }} />
            <strong style={{ color: "#94a3b8" }}>&ldquo;N seen&rdquo;</strong> is not a coverage figure. Those datasets
            record refreshes but nothing declares which symbols <em>ought</em> to be fresh, so the only
            symbols in the count are the ones that already succeeded — a ratio that is 100% by
            construction. It is shown as a raw count, and never green, until something calls
            <code style={{ margin: "0 3px" }}>registerSymbols</code> for them.
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
                    ? Object.entries(run.summary).map(([k, v]) => `${k} ${v}`).join(" · ")
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
                    <td style={{ ...cell, color: "#94a3b8", fontSize: 12 }}>{detail}</td>
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
