"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
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
  initialHasMore: boolean;
  complete: boolean;
};

// Which columns can be sorted, and whether they sort as text or numbers.
type SortKey = "symbol" | "company" | "epsEstimated" | "revenueEstimated" | "price" | "marketCap";
type SortDir = "asc" | "desc";

const TEXT_KEYS: ReadonlySet<SortKey> = new Set<SortKey>(["symbol", "company"]);

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "company", label: "Company", align: "left" },
  { key: "epsEstimated", label: "EPS Est.", align: "right" },
  { key: "revenueEstimated", label: "Revenue Est.", align: "right" },
  { key: "price", label: "Price", align: "right" },
  { key: "marketCap", label: "Market Cap", align: "right" },
];

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

// Merge a new page of rows into the existing list, dropping any symbol already
// present. The server already de-duplicates, but this keeps the client robust
// if a blob shifts length between the initial render and a Show more fetch.
function mergeUniqueBySymbol(prev: EarningsListItem[], more: EarningsListItem[]) {
  const seen = new Set(prev.map((i) => i.symbol.toUpperCase()));
  const merged = prev.slice();
  for (const m of more) {
    const key = m.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(m);
  }
  return merged;
}

// The server renders the top 50 US-listed reporters (largest market cap first)
// into the initial HTML -- fast and crawlable. "Show more" pulls the next 50
// straight from the already-materialised Redis blob via
// /api/earnings-calendar/day (a pure cache read, no quoting), so paging is cheap
// and never blocks. Column headers are clickable to re-sort the loaded rows;
// the default is market cap, largest at the top.
export default function EarningsDayList({ date, initialItems, initialHasMore, complete }: Props) {
  const [items, setItems] = useState<EarningsListItem[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("marketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Fresh server navigation to a new date resets everything, including sort.
  useEffect(() => {
    setItems(initialItems);
    setHasMore(initialHasMore);
    setLoading(false);
    setError(null);
    setSortKey("marketCap");
    setSortDir("desc");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Text columns read best A->Z; numbers read best largest-first.
      setSortDir(TEXT_KEYS.has(key) ? "asc" : "desc");
    }
  }

  const sortedItems = useMemo(() => {
    const arr = items.slice();
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      if (TEXT_KEYS.has(sortKey)) {
        const av = String(a[sortKey] ?? "");
        const bv = String(b[sortKey] ?? "");
        return av.localeCompare(bv) * dir;
      }
      const av = a[sortKey] as number | null;
      const bv = b[sortKey] as number | null;
      // Missing values always sink to the bottom, regardless of direction.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
    return arr;
  }, [items, sortKey, sortDir]);

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/earnings-calendar/day?date=${encodeURIComponent(date)}&offset=${items.length}`
      );
      if (!res.ok) throw new Error("");
      const data = (await res.json()) as { items?: EarningsListItem[]; hasMore?: boolean };
      const more = Array.isArray(data.items) ? data.items : [];
      setItems((prev) => mergeUniqueBySymbol(prev, more));
      setHasMore(Boolean(data.hasMore));
    } catch {
      setError("Couldn't load more right now — try again shortly.");
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", opacity: 0.75, fontSize: 15 }}>
        {complete
          ? "No confirmed US-listed reporters found for this date."
          : "This date is still populating — check back shortly."}
      </div>
    );
  }

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 900, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 90 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 260 }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
              {COLUMNS.map((col) => {
                const active = col.key === sortKey;
                return (
                  <th key={col.key} style={{ ...thStyle, textAlign: col.align }}>
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      title={`Sort by ${col.label}`}
                      style={{
                        ...thButtonStyle,
                        justifyContent: col.align === "right" ? "flex-end" : "flex-start",
                        color: active ? "#93c5fd" : "#8a97ad",
                      }}
                    >
                      {col.label}
                      <span style={{ fontSize: 9, opacity: active ? 1 : 0.25 }}>
                        {active ? (sortDir === "asc" ? "▲" : "▼") : "▲"}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item) => (
              <tr key={item.symbol} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <td style={tdStyle}>
                  <Link
                    href={`/stock/${encodeURIComponent(item.symbol)}/earnings`}
                    style={{ color: "#93c5fd", textDecoration: "none", fontWeight: 700 }}
                  >
                    {item.symbol}
                  </Link>
                </td>
                <td style={companyTdStyle} title={item.company}>
                  {item.company}
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{formatEps(item.epsEstimated)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{formatCompact(item.revenueEstimated)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{formatPrice(item.price)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{formatCompact(item.marketCap)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <div style={{ display: "inline-flex", gap: 6, flexWrap: "nowrap" }}>
                    <Link href={`/stock/${encodeURIComponent(item.symbol)}`} style={pillStyle}>
                      Analysis →
                    </Link>
                    <Link href={`/dashboard?symbol=${encodeURIComponent(item.symbol)}`} style={pillStyle}>
                      Chart →
                    </Link>
                    <Link href={`/stock/${encodeURIComponent(item.symbol)}/news`} style={pillStyle}>
                      News →
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error ? <div style={{ marginTop: 12, fontSize: 13, color: "#fecaca", textAlign: "center" }}>{error}</div> : null}

      {hasMore ? (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "1px solid rgba(147,197,253,0.28)",
              background: loading ? "rgba(255,255,255,0.04)" : "rgba(147,197,253,0.10)",
              color: loading ? "rgba(226,232,240,0.5)" : "#93c5fd",
              fontWeight: 700,
              fontSize: 13,
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Loading…" : "Show more"}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 16, textAlign: "center", fontSize: 12.5, opacity: 0.55 }}>
          {complete
            ? `Showing all ${items.length} US-listed reporter${items.length === 1 ? "" : "s"} for this date.`
            : `Showing ${items.length} so far — still populating…`}
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

const thButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  width: "100%",
  padding: 0,
  border: "none",
  background: "transparent",
  font: "inherit",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  whiteSpace: "nowrap",
};

// Company names vary wildly in length; fix the column width and truncate with
// an ellipsis so the Analysis/Chart/News pills never get pushed off the right
// edge. The full name is available via the native `title` tooltip; the symbol
// itself is never truncated.
const companyTdStyle: React.CSSProperties = {
  ...tdStyle,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const pillStyle: React.CSSProperties = {
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
};
