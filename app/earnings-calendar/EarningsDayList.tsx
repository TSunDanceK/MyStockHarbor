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

// The four figures that aren't the row's identity. On desktop they're four
// columns; on a phone one of them leads each row and the rest live in the
// expanded panel (see the rows branch below).
type MetricKey = Extract<SortKey, "epsEstimated" | "revenueEstimated" | "price" | "marketCap">;

const TEXT_KEYS: ReadonlySet<SortKey> = new Set<SortKey>(["symbol", "company"]);

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

const METRIC_COLUMNS: { key: MetricKey; label: string; fmt: (item: EarningsListItem) => string }[] = [
  { key: "epsEstimated", label: "EPS Est.", fmt: (i) => formatEps(i.epsEstimated) },
  { key: "revenueEstimated", label: "Revenue Est.", fmt: (i) => formatCompact(i.revenueEstimated) },
  { key: "price", label: "Price", fmt: (i) => formatPrice(i.price) },
  { key: "marketCap", label: "Market Cap", fmt: (i) => formatCompact(i.marketCap) },
];

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "company", label: "Company", align: "left" },
  ...METRIC_COLUMNS.map((col) => ({ key: col.key as SortKey, label: col.label, align: "right" as const })),
];

// The figure each phone row leads with when nothing has been sorted. An
// earnings calendar is a list of things that are about to report, so the
// consensus estimate is the number the page is about -- market cap is only the
// default ORDER, not the reason anyone is reading the row.
const DEFAULT_METRIC: MetricKey = "epsEstimated";

function isMetricKey(key: SortKey): key is MetricKey {
  return !TEXT_KEYS.has(key);
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

  // Phone layout swap. The six-column table is 980px wide with a fixed layout,
  // so on a 390px screen everything past the company name -- both estimates,
  // price, market cap and all three links -- sits behind a sideways scroll.
  // Below this width the same data renders as full-width rows instead.
  //
  // Deliberately state + matchMedia rather than rendering both trees and hiding
  // one with CSS: two copies of every ticker in the DOM is duplicated content
  // on a page that is actively being indexed, and the day's reporters are the
  // whole reason this page ranks. Starting false means the server render (and
  // therefore the crawler) always gets the table; a phone swaps on hydration.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Which mobile rows are expanded to show the rest of their figures and the
  // Earnings / Analysis / Chart / News buttons. Keyed by symbol.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());

  // Fresh server navigation to a new date resets everything, including sort.
  useEffect(() => {
    setItems(initialItems);
    setHasMore(initialHasMore);
    setLoading(false);
    setError(null);
    setSortKey("marketCap");
    setSortDir("desc");
    setExpandedRows(new Set());
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

  function toggleRow(symbol: string) {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }

  // The figure a phone row leads with. Follows the sort when the sort is on a
  // number, so sorting by Market Cap makes every row show its market cap --
  // which is what makes sorting legible with no column headers on screen.
  // Sorting by Symbol or Company leaves the estimate in place, since neither of
  // those is a figure a row could display.
  const headlineColumn = useMemo(() => {
    const wanted = isMetricKey(sortKey) ? sortKey : DEFAULT_METRIC;
    return METRIC_COLUMNS.find((col) => col.key === wanted) ?? METRIC_COLUMNS[0];
  }, [sortKey]);

  // The smaller figure under the headline. Price is the useful companion to any
  // of the others; when price IS the headline, show the market cap instead.
  const subColumn = useMemo(() => {
    const wanted: MetricKey = headlineColumn.key === "price" ? "marketCap" : "price";
    return METRIC_COLUMNS.find((col) => col.key === wanted) ?? null;
  }, [headlineColumn]);

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
      {/* Sorting on a phone can't be "tap a column header" -- there are no
          headers once the table is gone, and reaching the ones on the right
          meant swiping sideways even when there were. So it becomes a visible
          control, and the metric it names is the one every row then leads
          with. */}
      {isNarrow ? (
        <div className="ecSortRow">
          <select
            className="ecSortSelect"
            value={sortKey}
            onChange={(e) => {
              const key = e.target.value as SortKey;
              setSortKey(key);
              setSortDir(TEXT_KEYS.has(key) ? "asc" : "desc");
            }}
            aria-label="Sort by"
          >
            {COLUMNS.map((col) => (
              <option key={col.key} value={col.key}>
                Sort: {col.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ecSortDir"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            aria-label={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
          >
            {sortDir === "asc" ? "▲" : "▼"}
          </button>
        </div>
      ) : null}

      {isNarrow ? (
        <div className="ecRows">
          {sortedItems.map((item) => {
            const open = expandedRows.has(item.symbol);
            // Only the figures this company actually has. An estimate is
            // genuinely absent for a name with no analyst coverage, and a row
            // of dashes reads like a loading state rather than an answer.
            const panelColumns = METRIC_COLUMNS.filter((col) => item[col.key] !== null);
            return (
              <div key={item.symbol} className={open ? "ecRow open" : "ecRow"}>
                {/* The whole collapsed row is one target and it only expands.
                    Nothing here navigates: leaving the ticker as a link meant
                    the row had two outcomes depending on which few pixels you
                    hit, and the destructive one was the accident. Leaving the
                    page is now always a deliberate tap on a named button in the
                    panel below. */}
                <button
                  type="button"
                  className="ecRowTop"
                  onClick={() => toggleRow(item.symbol)}
                  aria-expanded={open}
                  aria-label={open ? `Hide ${item.symbol} details` : `Show ${item.symbol} details`}
                >
                  <span className="ecRowId">
                    <span className="ecRowSym">{item.symbol}</span>
                    <span className="ecRowName" title={item.company}>
                      {item.company}
                    </span>
                  </span>
                  <span className="ecRowFigures">
                    <span className="ecRowLabel">{headlineColumn.label}</span>
                    <span className="ecRowValue">{headlineColumn.fmt(item)}</span>
                    {subColumn ? <span className="ecRowSub">{subColumn.fmt(item)}</span> : null}
                  </span>
                  <span className="ecRowChev" aria-hidden="true">
                    {open ? "▲" : "▼"}
                  </span>
                </button>
                {open ? (
                  <div className="ecRowPanel">
                    {panelColumns.length ? (
                      <div className="ecRowFields">
                        {panelColumns.map((col) => (
                          <div key={col.key} className="ecRowField">
                            <span className="ecRowFieldLabel">{col.label}</span>
                            <span className="ecRowFieldValue">{col.fmt(item)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="ecRowEmpty">No estimates or quote data for {item.symbol} yet.</div>
                    )}
                    {/* Every way off this row, named. The ticker used to open
                        the earnings page implicitly; on an earnings calendar
                        that is the destination most people want, so it leads
                        here rather than disappearing with the link. */}
                    <div className="ecRowLinks">
                      <Link href={`/stock/${encodeURIComponent(item.symbol)}/earnings`} className="ecRowLink">
                        Earnings
                      </Link>
                      <Link href={`/stock/${encodeURIComponent(item.symbol)}`} className="ecRowLink">
                        Analysis
                      </Link>
                      <Link href={`/dashboard?symbol=${encodeURIComponent(item.symbol)}`} className="ecRowLink">
                        Chart
                      </Link>
                      <Link href={`/stock/${encodeURIComponent(item.symbol)}/news`} className="ecRowLink">
                        News
                      </Link>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
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
      )}

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

      <style>{`
        .ecSortRow { display: flex; align-items: stretch; justify-content: flex-end; gap: 6px; margin-bottom: 10px; }
        .ecSortSelect {
          appearance: none; border-radius: 999px; padding: 7px 14px;
          border: 1px solid rgba(96,165,250,0.4); background: rgba(59,130,246,0.10);
          color: #dbeafe; font-family: inherit; font-size: 12px; font-weight: 800; cursor: pointer;
        }
        .ecSortDir {
          flex: 0 0 auto; width: 38px; border-radius: 999px;
          border: 1px solid rgba(96,165,250,0.4); background: rgba(59,130,246,0.10);
          color: #dbeafe; font-size: 11px; font-weight: 900; cursor: pointer; font-family: inherit;
        }

        .ecRows { display: grid; gap: 8px; }
        .ecRow {
          border: 1px solid rgba(255,255,255,0.09); border-radius: 14px;
          background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
          overflow: hidden;
        }
        .ecRow.open { border-color: rgba(96,165,250,0.4); }
        /* The entire collapsed row is the button. */
        .ecRowTop {
          display: flex; width: 100%; align-items: center; gap: 10px;
          padding: 11px 12px; border: none; background: transparent;
          font: inherit; color: inherit; cursor: pointer; text-align: left;
        }
        .ecRowTop:active { background: rgba(255,255,255,0.03); }
        .ecRowId { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1 1 auto; }
        /* Not link-blue any more: nothing in the collapsed row navigates, and
           colouring the ticker like a link would promise otherwise. */
        .ecRowSym { flex: 0 0 auto; font-size: 15px; font-weight: 950; letter-spacing: -0.02em; color: #eaf2ff; }
        .ecRowName {
          min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-size: 12px; font-weight: 700; color: rgba(148,163,184,0.9);
        }
        .ecRowFigures { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 1px; text-align: right; }
        .ecRowLabel { font-size: 9px; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(148,163,184,0.62); }
        .ecRowValue { font-size: 14.5px; font-weight: 900; color: #f1f5f9; white-space: nowrap; }
        .ecRowSub { font-size: 11.5px; font-weight: 800; white-space: nowrap; color: rgba(148,163,184,0.9); }
        .ecRowChev { flex: 0 0 auto; font-size: 10px; color: rgba(226,232,240,0.6); }
        .ecRow.open .ecRowChev { color: #93c5fd; }

        .ecRowPanel { border-top: 1px solid rgba(255,255,255,0.08); padding: 4px 12px 12px; }
        .ecRowFields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px; }
        .ecRowField {
          display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
          padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.055); min-width: 0;
        }
        .ecRowFieldLabel { font-size: 11px; font-weight: 800; color: rgba(148,163,184,0.8); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ecRowFieldValue { flex: 0 0 auto; font-size: 12.5px; font-weight: 800; color: rgba(226,232,240,0.94); white-space: nowrap; }
        .ecRowEmpty { padding: 8px 0 2px; font-size: 12px; color: rgba(148,163,184,0.75); }
        /* Four destinations, 2x2 rather than a single row: four labels across a
           390px screen leaves each about 85px, and "Earnings" plus its padding
           does not fit that without shrinking the type below a comfortable tap
           target. */
        .ecRowLinks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
        .ecRowLink {
          display: inline-flex; align-items: center; justify-content: center;
          padding: 10px 6px; border-radius: 10px;
          border: 1px solid rgba(96,165,250,0.32); background: rgba(59,130,246,0.10);
          color: #dbeafe; text-decoration: none; font-weight: 850; font-size: 12.5px; white-space: nowrap;
        }
        .ecRowLink:active { background: rgba(59,130,246,0.2); }

        @media (max-width: 430px) {
          /* Two columns of label+value stops fitting once "Revenue Est." and
             "Market Cap" are both on screen -- one column keeps every value on
             the same line as its own label. */
          .ecRowFields { grid-template-columns: minmax(0, 1fr); }
          .ecRowName { font-size: 11.5px; }
        }
      `}</style>
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
