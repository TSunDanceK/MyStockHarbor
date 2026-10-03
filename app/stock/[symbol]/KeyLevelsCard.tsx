// THE "KEY LEVELS" CARD (#563 COWORK #64): the day's, this week's and this
// month's open / high / low / close, each with its distance from the last price,
// in the stock page's sidebar directly above the earnings snapshot.
//
// Presentation only: the levels come from lib/ta/keyLevels.ts over the daily
// bars the page already holds. No fetch, no Redis, no hooks of its own, so it
// renders in the server HTML with the rest of the page.
//
// COPY IS DESCRIPTIVE. What the levels are sits behind one ReasonedValue note
// ("levels some traders watch"); nothing says what a level means for the price
// or what a reader should do.
import type { CSSProperties, ReactNode } from "react";
import { ReasonedValue } from "@/app/components/EstimatedValue";
import {
  keyLevels, distanceWords, priceWords, shortDate, LEVEL_FIELDS, PERIOD_WORDS,
  type KeyBar, type LevelField, type PeriodLevels,
} from "@/lib/ta/keyLevels";

export const KEY_LEVELS_NOTE =
  "Levels some traders watch: the open, high, low and close of the latest session, of this week so far and of this month so far, " +
  "taken from daily prices. They describe where the price has been, not where it will go.";

const FIELD_WORDS: Record<LevelField, string> = { open: "Open", high: "High", low: "Low", close: "Close" };

const C = {
  label: "rgba(147,197,253,0.82)",
  muted: "rgba(203,213,225,0.62)",
  value: "rgba(241,245,249,0.94)",
  rule: "rgba(255,255,255,0.07)",
};

/** A column's sub-heading: the day's date, or where the week or month starts. */
function since(p: PeriodLevels): string {
  if (!p.from) return "—";
  return p.key === "day" ? shortDate(p.from) : `from ${shortDate(p.from)}`;
}

export default function KeyLevelsCard({
  bars,
  lastPrice,
  credit,
}: {
  bars: readonly KeyBar[];
  /** The page's last price; the latest close stands in when there is none. */
  lastPrice?: number | null;
  /** The linked Tiingo credit, passed only when the bars are Tiingo's. */
  credit?: ReactNode;
}) {
  const k = keyLevels(bars);
  const hasPrice = typeof lastPrice === "number" && Number.isFinite(lastPrice) && lastPrice > 0;
  const reference = hasPrice ? lastPrice : k.lastClose;
  return (
    <section className="klCard" style={cardStyle}>
      <div style={eyebrowStyle}>Price levels</div>
      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={titleStyle}>Key levels</h2>
        <span style={{ fontSize: 12, color: C.muted }}>
          <ReasonedValue text="What are these?" reason={KEY_LEVELS_NOTE} />
        </span>
      </div>
      {k.asOf ? (
        <p className="klAsOf" style={noteStyle}>
          As of the close on {k.asOfWords}.{" "}
          {reference != null
            ? hasPrice
              ? <>Distances are from the last price, {priceWords(reference)}.</>
              : <>Distances are from that close, {priceWords(reference)}.</>
            : null}
        </p>
      ) : null}

      {k.asOf ? (
        <table className="klGrid" style={tableStyle}>
          <thead>
            <tr>
              <th scope="col" style={{ ...headStyle, width: "16%", textAlign: "left" }}><span className="klSr">Level</span></th>
              {k.periods.map((p) => (
                <th key={p.key} scope="col" style={headStyle}>
                  <div>{PERIOD_WORDS[p.key].title}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, letterSpacing: 0, textTransform: "none" }}>{since(p)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LEVEL_FIELDS.map((f) => (
              <tr key={f}>
                <th scope="row" style={rowHeadStyle}>{FIELD_WORDS[f]}</th>
                {k.periods.map((p) => {
                  const lv = p.levels[f];
                  if (lv.value == null) {
                    return (
                      <td key={p.key} className="klCell" style={cellStyle}>
                        <ReasonedValue text="—" reason={lv.reason} />
                      </td>
                    );
                  }
                  const dist = reference != null ? distanceWords(lv.value, reference) : null;
                  const said = `${PERIOD_WORDS[p.key].possessive} ${f}: ${priceWords(lv.value)}${dist ? `, ${dist === "at the last price" ? dist : `${dist} the last price`}` : ""}`;
                  return (
                    <td key={p.key} className="klCell" style={cellStyle} title={said}>
                      <div className="klValue" style={valueStyle}>{priceWords(lv.value)}</div>
                      {dist ? <div className="klDist" style={distStyle}>{dist}</div> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {k.reasons.map((r) => (
        <p key={r} className="klReason" style={noteStyle}>{r}</p>
      ))}
      {credit ? <p style={noteStyle}>Daily prices: {credit}</p> : null}

      <style>{`
        .klSr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        .klGrid td.klCell, .klGrid th { overflow-wrap: anywhere; }
        @media (max-width: 360px) {
          .klGrid .klValue { font-size: 12px !important; }
          .klGrid .klDist { font-size: 10px !important; }
        }
      `}</style>
    </section>
  );
}

const cardStyle: CSSProperties = {
  border: "1px solid rgba(148,163,184,0.25)",
  borderRadius: 20,
  padding: 18,
  background: "linear-gradient(135deg, rgba(148,163,184,0.07), rgba(255,255,255,0.022))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  minWidth: 0,
};
const eyebrowStyle: CSSProperties = { fontSize: 11, fontWeight: 950, letterSpacing: "0.1em", textTransform: "uppercase", color: C.label };
const titleStyle: CSSProperties = { margin: 0, fontSize: 22, lineHeight: 1.12, letterSpacing: "-0.03em" };
const noteStyle: CSSProperties = { margin: "10px 0 0 0", fontSize: 11, lineHeight: 1.5, color: C.muted };
const tableStyle: CSSProperties = { width: "100%", marginTop: 12, borderCollapse: "collapse", tableLayout: "fixed", fontVariantNumeric: "tabular-nums" };
const headStyle: CSSProperties = {
  padding: "0 2px 6px", fontSize: 11, fontWeight: 850, letterSpacing: "0.04em", textTransform: "uppercase",
  color: "rgba(226,232,240,0.78)", textAlign: "right", borderBottom: `1px solid ${C.rule}`,
};
const rowHeadStyle: CSSProperties = { padding: "7px 0", fontSize: 12, fontWeight: 700, color: C.muted, textAlign: "left", borderBottom: `1px solid ${C.rule}` };
const cellStyle: CSSProperties = { padding: "7px 1px 7px 4px", textAlign: "right", verticalAlign: "top", borderBottom: `1px solid ${C.rule}` };
const valueStyle: CSSProperties = { fontSize: 13, fontWeight: 800, color: C.value, whiteSpace: "nowrap" };
const distStyle: CSSProperties = { marginTop: 2, fontSize: 10.5, lineHeight: 1.3, color: C.muted };
