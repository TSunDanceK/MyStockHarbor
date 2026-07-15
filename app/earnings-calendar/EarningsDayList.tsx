"use client";

import type React from "react";
import { useEffect, useState } from "react";
import Link from "next/link";

type EarningsListItem = {
  symbol: string;
  company: string;
  date: string;
  epsEstimated: number | null;
  epsActual: number | null;
  revenueEstimated: number | null;
  revenueActual: number | null;
  price: number | null;
  marketCap: number | null;
};

type Props = {
  date: string;
  initialItems: EarningsListItem[];
  initialTotalCandidates: number;
  initialFetchedCount: number;
  initialHasMore: boolean;
  initialNextBatch: number | null;
};

// Client-side cooldown after each "Show more" click, so a single visitor
// can't rapid-fire the button. This is on top of (not instead of) the real
// protection, which is that every symbol quote is cached for ~30 days via
// Next's fetch cache -- so even without this cooldown, hammering the button
// would mostly just be re-reading already-cached data, not spamming FMP.
const COOLDOWN_MS = 45_000;

function formatCompact(value: number | null) {
  if (value === null) return "-";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString("en-US");
}

function formatPrice(value: number | null) {
  return value !== null ? `$${value.toFixed(2)}` : "-";
}

function formatEps(value: number | null) {
  return value !== null ? `$${value.toFixed(2)}` : "-";
}

export default function EarningsDayList({
  date,
  initialItems,
  initialTotalCandidates,
  initialFetchedCount,
  initialHasMore,
  initialNextBatch,
}: Props) {
  const [items, setItems] = useState(initialItems);
  const [totalCandidates, setTotalCandidates] = useState(initialTotalCandidates);
  const [fetchedCount, setFetchedCount] = useState(initialFetchedCount);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextBatch, setNextBatch] = useState(initialNextBatch);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  // Reset whenever the selected date changes (a fresh server navigation to
  // this component with new initial props).
  useEffect(() => {
    setItems(initialItems);
    setTotalCandidates(initialTotalCandidates);
    setFetchedCount(initialFetchedCount);
    setHasMore(initialHasMore);
    setNextBatch(initialNextBatch);
    setError(null);

    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(`msh_earnings_cooldown_${date}`);
    const parsed = stored ? Number(stored) : null;
    setCooldownUntil(parsed && parsed > Date.now() ? parsed : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Tick every second while a cooldown is active so the countdown updates.
  useEffect(() => {
    if (!cooldownUntil) return;
    const id = window.setInterval(() => forceTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const cooldownRemaining = cooldownUntil ? Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)) : 0;
  const onCooldown = cooldownRemaining > 0;

  async function loadMore() {
    if (nextBatch == null || loading || onCooldown) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/earnings-calendar/day?date=${encodeURIComponent(date)}&batch=${nextBatch}`);
      if (!res.ok) throw new Error("");
      const data = (await res.json()) as {
        items: EarningsListItem[];
        totalCandidates: number;
        fetchedCount: number;
        hasMore: boolean;
        nextBatch: number | null;
      };

      setItems((prev) => [...prev, ...data.items]);
      setTotalCandidates(data.totalCandidates);
      setFetchedCount(data.fetchedCount);
      setHasMore(data.hasMore);
      setNextBatch(data.nextBatch);

      const until = Date.now() + COOLDOWN_MS;
      setCooldownUntil(until);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(`msh_earnings_cooldown_${date}`, String(until));
      }
    } catch {
      setError("Couldn't load more right now — try again shortly.");
    } finally {
      setLoading(false);
    }
  }

  const remaining = Math.max(0, totalCandidates - fetchedCount);

  return (
    <div>
      {items.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", opacity: 0.75, fontSize: 15 }}>
          No confirmed US-listed reporters found for this date.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 760 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                <th style={thStyle}>Symbol</th>
                <th style={thStyle}>Company</th>
                <th style={{ ...thStyle, textAlign: "right" }}>EPS Est.</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Revenue Est.</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Price</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Market Cap</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.symbol} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={tdStyle}>
                    <Link
                      href={`/stock/${encodeURIComponent(item.symbol)}/earnings`}
                      style={{ color: "#93c5fd", textDecoration: "none", fontWeight: 700 }}
                    >
                      {item.symbol}
                    </Link>
                  </td>
                  <td style={tdStyle}>{item.company}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{formatEps(item.epsEstimated)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{formatCompact(item.revenueEstimated)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{formatPrice(item.price)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{formatCompact(item.marketCap)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <Link
                      href={`/dashboard?symbol=${encodeURIComponent(item.symbol)}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "4px 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(147,197,253,0.28)",
                        background: "rgba(147,197,253,0.10)",
                        color: "#93c5fd",
                        textDecoration: "none",
                        fontWeight: 700,
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Chart →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error ? <div style={{ marginTop: 12, fontSize: 13, color: "#fecaca" }}>{error}</div> : null}

      {hasMore ? (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            onClick={loadMore}
            disabled={loading || onCooldown}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "1px solid rgba(147,197,253,0.28)",
              background: loading || onCooldown ? "rgba(255,255,255,0.04)" : "rgba(147,197,253,0.10)",
              color: loading || onCooldown ? "rgba(226,232,240,0.5)" : "#93c5fd",
              fontWeight: 700,
              fontSize: 13,
              cursor: loading || onCooldown ? "default" : "pointer",
            }}
          >
            {loading
              ? "Loading…"
              : onCooldown
                ? `Show more available in ${cooldownRemaining}s (${remaining} left on this date)`
                : `Show more on this date (${remaining} left)`}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 16, textAlign: "center", fontSize: 12.5, opacity: 0.55 }}>
          Showing all {fetchedCount} of {totalCandidates} reporters for this date.
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 16px",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "#8a97ad",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  whiteSpace: "nowrap",
};
