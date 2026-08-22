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

type Status = "ok" | "warn" | "fault" | "unknown";

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
  const unrefreshed = d.stale + d.never;
  const pct = d.tracked > 0 ? unrefreshed / d.tracked : 0;
  if (d.never === d.tracked && d.tracked > 0) {
    return { status: "fault", why: "every tracked symbol is unrefreshed" };
  }
  if (pct >= 0.25) return { status: "fault", why: `${Math.round(pct * 100)}% past their own TTL` };
  if (pct >= 0.05) return { status: "warn", why: `${Math.round(pct * 100)}% past their own TTL` };
  return { status: "ok", why: "within policy" };
}

const STATUS_COLOR: Record<Status, string> = {
  ok: "#22c55e",
  warn: "#eab308",
  fault: "#ef4444",
  unknown: "rgba(255,255,255,0.35)",
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
  const [usage, minuteCalls, datasets, jobs] = await Promise.all([
    readFmpUsage(30),
    getFmpMinuteUsage(),
    readAllDatasetHealth(),
    readJobRuns(),
  ]);

  const pctCap = (usage.totalWireBytes / FMP_BANDWIDTH_CAP_BYTES) * 100;

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
                      {d.instrumented ? `${fresh} / ${d.tracked}` : "—"}
                      {d.never > 0 ? <div style={{ color: "#64748b", fontSize: 11 }}>{d.never} never refreshed</div> : null}
                    </td>
                    <td style={cell}>{d.instrumented ? d.stale : "—"}</td>
                    <td style={cell}>{fmtAge(d.oldestMs)}</td>
                    <td style={cell}>{Math.round(d.ttlSeconds / 3600) >= 48 ? `${Math.round(d.ttlSeconds / 86400)}d` : `${Math.round(d.ttlSeconds / 3600)}h`}</td>
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
        </section>

        {/* ── Warm jobs ───────────────────────────────────────────────── */}
        <section style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 14, color: "#e2e8f0" }}>Warm jobs — last run</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr><th style={th}>Job</th><th style={th}>When</th><th style={th}>Outcome</th><th style={th}>Summary</th></tr>
            </thead>
            <tbody>
              {jobs.map(({ job, label, run }) => (
                <tr key={job}>
                  <td style={cell}>{label}</td>
                  <td style={cell}>{run ? fmtAge(run.at) : "—"}</td>
                  <td style={cell}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: run ? (run.ok ? STATUS_COLOR.ok : STATUS_COLOR.fault) : STATUS_COLOR.unknown, marginRight: 7 }} />
                    {run ? (run.ok ? "ok" : "failed") : "no run recorded"}
                  </td>
                  <td style={{ ...cell, color: "#94a3b8", fontSize: 12 }}>
                    {run
                      ? Object.entries(run.summary).map(([k, v]) => `${k} ${v}`).join(" · ")
                      : "never run, or older than the 8-day record TTL"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
