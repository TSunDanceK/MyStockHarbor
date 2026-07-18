import type React from "react";
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
  items: EarningsListItem[];
  complete: boolean;
};

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

// Presentational only: the full US-listed set for the date is server-rendered
// and passed in as `items` (no pagination, no "Show more" -- every reporter is
// shown at once). Population happens server-side via the calendar's background
// auto-populate / owner backfill; this component just renders what's ready.
export default function EarningsDayList({ items, complete }: Props) {
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

      <div style={{ marginTop: 16, textAlign: "center", fontSize: 12.5, opacity: 0.55 }}>
        {complete
          ? `Showing all ${items.length} US-listed reporter${items.length === 1 ? "" : "s"} for this date.`
          : `Showing ${items.length} so far — still populating…`}
      </div>
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
