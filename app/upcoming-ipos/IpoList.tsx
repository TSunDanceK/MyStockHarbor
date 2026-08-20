"use client";

import type React from "react";
import { useEffect, useState } from "react";
import type { ConfirmedIpo } from "@/lib/server/ipoCalendar";

type Props = {
  ipos: ConfirmedIpo[];
  emptyMessage: string;
  dateColumnLabel: string;
};

function formatDate(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatPriceRange(low: number | null, high: number | null) {
  if (low === null && high === null) return "-";
  if (low !== null && high !== null && low !== high) {
    return `$${low.toFixed(2)} - $${high.toFixed(2)}`;
  }
  const single = low ?? high;
  return single !== null ? `$${single.toFixed(2)}` : "-";
}

function formatShares(shares: number | null) {
  if (shares === null) return "-";
  return shares.toLocaleString("en-US");
}

function formatCompact(value: number | null) {
  if (value === null) return "-";

  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString("en-US");
}

// Everything that isn't the row's identity (symbol, company) or its headline
// (the date). On desktop these are seven columns; on a phone they're the
// contents of the expanded panel.
type FieldDef = {
  key: string;
  label: string;
  format: (ipo: ConfirmedIpo) => string;
  has: (ipo: ConfirmedIpo) => boolean;
};

const FIELDS: FieldDef[] = [
  {
    key: "exchange",
    label: "Exchange",
    format: (i) => i.exchange ?? "-",
    has: (i) => i.exchange !== null,
  },
  {
    key: "priceRange",
    label: "Price Range",
    format: (i) => formatPriceRange(i.priceRangeLow, i.priceRangeHigh),
    has: (i) => i.priceRangeLow !== null || i.priceRangeHigh !== null,
  },
  {
    key: "sharesOffered",
    label: "Shares Offered",
    format: (i) => formatShares(i.sharesOffered),
    has: (i) => i.sharesOffered !== null,
  },
  {
    key: "dealSize",
    label: "Deal Size",
    format: (i) => formatCompact(i.dealSize),
    has: (i) => i.dealSize !== null,
  },
  {
    key: "marketCap",
    label: "Market Cap",
    format: (i) => formatCompact(i.marketCap),
    has: (i) => i.marketCap !== null,
  },
  {
    key: "revenue",
    label: "Revenue",
    format: (i) => formatCompact(i.revenue),
    has: (i) => i.revenue !== null,
  },
];

function rowKey(ipo: ConfirmedIpo) {
  return `${ipo.symbol}-${ipo.date}`;
}

// Desktop keeps the nine-column table. Below 720px the same rows render
// full-width instead: symbol, company and the date, with a chevron that opens
// the rest of the deal terms.
//
// Deliberately state + matchMedia rather than rendering both trees and hiding
// one with CSS, matching /earnings-calendar (#260) and the screener (#258):
// two copies of every listing in the DOM is duplicated content on a page that
// is being indexed, and the listings are the whole reason it ranks. isNarrow
// starts false, so the server render -- and therefore Googlebot -- always gets
// the table, exactly as before this change.
export default function IpoList({ ipos, emptyMessage, dateColumnLabel }: Props) {
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());

  function toggleRow(key: string) {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (ipos.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", opacity: 0.75, fontSize: 15 }}>
        {emptyMessage}
      </div>
    );
  }

  if (isNarrow) {
    return (
      <div className="ipoRows">
        <p className="ipoRowsHint">Tap any listing for its full deal terms.</p>
        {ipos.map((ipo) => {
          const key = rowKey(ipo);
          const open = expandedRows.has(key);
          // Only the terms this deal actually has. A listing with no reported
          // revenue has none to report -- a column of dashes reads like a
          // loading state rather than an answer.
          const fields = FIELDS.filter((field) => field.has(ipo));
          const priceRange = formatPriceRange(ipo.priceRangeLow, ipo.priceRangeHigh);
          return (
            <div key={key} className={open ? "ipoRow open" : "ipoRow"}>
              {/* The whole collapsed row is one button and it only expands.
                  Nothing here navigates: an upcoming listing has no stock page
                  worth sending anyone to yet, so there is no second outcome to
                  hit by accident. */}
              <button
                type="button"
                className="ipoRowTop"
                onClick={() => toggleRow(key)}
                aria-expanded={open}
                aria-label={open ? `Hide ${ipo.symbol} deal terms` : `Show ${ipo.symbol} deal terms`}
              >
                <span className="ipoRowId">
                  <span className="ipoRowSym">{ipo.symbol}</span>
                  <span className="ipoRowName" title={ipo.company}>
                    {ipo.company}
                  </span>
                </span>
                <span className="ipoRowFigures">
                  <span className="ipoRowLabel">{dateColumnLabel}</span>
                  <span className="ipoRowValue">{formatDate(ipo.date)}</span>
                  {priceRange !== "-" ? <span className="ipoRowSub">{priceRange}</span> : null}
                </span>
                <span className="ipoRowChev" aria-hidden="true">
                  {open ? "▲" : "▼"}
                </span>
              </button>
              {open ? (
                <div className="ipoRowPanel">
                  {fields.length ? (
                    <div className="ipoRowFields">
                      {fields.map((field) => (
                        <div key={field.key} className="ipoRowField">
                          <span className="ipoRowFieldLabel">{field.label}</span>
                          <span className="ipoRowFieldValue">{field.format(ipo)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="ipoRowEmpty">
                      No deal terms published for {ipo.symbol} yet.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}

        <style>{`
          .ipoRows { display: grid; gap: 8px; padding: 12px; }
          .ipoRowsHint {
            margin: 0 2px 2px; font-size: 12px; font-weight: 700;
            color: rgba(148,163,184,0.75);
          }
          .ipoRow {
            border: 1px solid rgba(255,255,255,0.09); border-radius: 14px;
            background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
            overflow: hidden;
          }
          .ipoRow.open { border-color: rgba(96,165,250,0.4); }
          .ipoRowTop {
            display: flex; width: 100%; align-items: center; gap: 10px;
            padding: 11px 12px; border: none; background: transparent;
            font: inherit; color: inherit; cursor: pointer; text-align: left;
          }
          .ipoRowTop:active { background: rgba(255,255,255,0.03); }
          .ipoRowId { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1 1 auto; }
          .ipoRowSym { flex: 0 0 auto; font-size: 15px; font-weight: 950; letter-spacing: -0.02em; color: #eaf2ff; }
          .ipoRowName {
            min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            font-size: 12px; font-weight: 700; color: rgba(148,163,184,0.9);
          }
          .ipoRowFigures {
            flex: 0 0 auto; display: flex; flex-direction: column;
            align-items: flex-end; gap: 1px; text-align: right;
          }
          .ipoRowLabel {
            font-size: 9px; font-weight: 900; letter-spacing: 0.05em;
            text-transform: uppercase; color: rgba(148,163,184,0.62);
          }
          .ipoRowValue { font-size: 14.5px; font-weight: 900; color: #f1f5f9; white-space: nowrap; }
          .ipoRowSub { font-size: 11.5px; font-weight: 800; white-space: nowrap; color: rgba(148,163,184,0.9); }
          .ipoRowChev { flex: 0 0 auto; font-size: 10px; color: rgba(226,232,240,0.6); }
          .ipoRow.open .ipoRowChev { color: #93c5fd; }

          .ipoRowPanel { border-top: 1px solid rgba(255,255,255,0.08); padding: 4px 12px 12px; }
          .ipoRowFields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px; }
          .ipoRowField {
            display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
            padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.055); min-width: 0;
          }
          .ipoRowFieldLabel {
            font-size: 11px; font-weight: 800; color: rgba(148,163,184,0.8);
            min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          }
          .ipoRowFieldValue {
            flex: 0 0 auto; font-size: 12.5px; font-weight: 800;
            color: rgba(226,232,240,0.94); white-space: nowrap;
          }
          .ipoRowEmpty { padding: 8px 0 2px; font-size: 12px; color: rgba(148,163,184,0.75); }

          @media (max-width: 430px) {
            /* Two columns of label+value stops fitting once "Shares Offered"
               sits beside a nine-digit share count -- one column keeps every
               value on the same line as its own label. */
            .ipoRowFields { grid-template-columns: minmax(0, 1fr); }
            .ipoRowName { font-size: 11.5px; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        className="ipoCalendarTable"
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
          minWidth: 880,
        }}
      >
        <thead>
          <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
            <th style={thStyle}>{dateColumnLabel}</th>
            <th style={thStyle}>Symbol</th>
            <th style={thStyle}>Company Name</th>
            <th style={thStyle}>Exchange</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Price Range</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Shares Offered</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Deal Size</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Market Cap</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Revenue</th>
          </tr>
        </thead>
        <tbody>
          {ipos.map((ipo: ConfirmedIpo) => (
            <tr key={rowKey(ipo)} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <td style={tdStyle}>{formatDate(ipo.date)}</td>
              <td style={{ ...tdStyle, fontWeight: 700 }}>{ipo.symbol}</td>
              <td style={tdStyle}>{ipo.company}</td>
              <td style={tdStyle}>{ipo.exchange ?? "-"}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                {formatPriceRange(ipo.priceRangeLow, ipo.priceRangeHigh)}
              </td>
              <td style={{ ...tdStyle, textAlign: "right" }}>{formatShares(ipo.sharesOffered)}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>{formatCompact(ipo.dealSize)}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>{formatCompact(ipo.marketCap)}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>{formatCompact(ipo.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
