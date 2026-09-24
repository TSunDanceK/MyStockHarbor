import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { RECEIVER_ENTRIES, RECEIVER_GROUPS, readReceiversRecord } from "@/lib/server/capexReceivers";
import { readContractsRecord } from "@/lib/server/capexContracts";
import { snapshotCompanyName } from "@/lib/server/companyNameSnapshot";
import { normaliseCompanyName } from "@/lib/server/news/companyName";
import { buildContractRows, buildReceiverGroups, formatAmount, type ReceiverView } from "@/lib/capexPresent";

// Capex -- "Follow the money" (Relay C, #563). Phase 1 panels, each from a
// filed or published source, side by side and deliberately NOT connected:
// no arrows, no flows, no sums across companies (COWORK #1 / #2).
//
// NOINDEX until "Who is spending" (Layer 1) lands with A's sector resolver: a
// page whose first panel is a placeholder is not the page to rank.
//
// Redis: two GETs per render (receivers, contracts), hourly ISR.
export const revalidate = 3600;

const PAGE_TITLE = "Capex: Follow the Money | AI & Data-Centre Spending | MyStockHarbor";
const PAGE_DESCRIPTION =
  "What the companies selling into the AI and data-centre build-out report in their own filings, and which listed companies receive federal contracts. Filed figures only.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "https://www.mystockharbor.com/bottlenecks/capex" },
  robots: { index: false, follow: true },
};

const HYPERSCALER_NOTE =
  "These companies are also among the largest spenders above; this is what they sell, not what they buy.";

export default async function CapexPage() {
  const [receivers, contracts] = await Promise.all([readReceiversRecord(), readContractsRecord()]);
  const groups = buildReceiverGroups(RECEIVER_GROUPS, RECEIVER_ENTRIES, receivers?.rows ?? {});
  // Our directory's name for each company, short form ("General Dynamics"),
  // from the committed snapshot: no request at render.
  const contractRows = contracts ? buildContractRows(contracts.rows, 15, (t) => normaliseCompanyName(snapshotCompanyName(t))) : [];

  return (
    <main style={mainStyle}>
      <div className="capexWrap">
        <section style={heroStyle}>
          <div style={tagStyle}>BOTTLENECKS · CAPEX</div>
          <h1 style={titleStyle}>Follow the money</h1>
          <p style={leadStyle}>
            Three views of the AI and data-centre build-out, each taken straight from a filed or
            published source. The panels sit side by side on purpose: they are not linked, and
            nothing here estimates who pays whom.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <a href="#spending" style={chipStyle}>Who is spending</a>
            <a href="#receiving" style={chipStyle}>Who is receiving</a>
            <a href="#contracts" style={chipStyle}>Federal contracts</a>
          </div>
        </section>

        {/* 1. Who is spending -- Layer 1, waiting on A's sector resolver. */}
        <section id="spending" style={panelStyle}>
          <div style={eyebrowStyle}>1 · WHO IS SPENDING</div>
          <h2 style={panelTitleStyle}>Capital spending by sector</h2>
          <p style={bodyStyle}>
            Coming next: five years of capital expenditure by sector, and capex as a share of revenue,
            from the companies&apos; own cash-flow statements. It waits on the sector grouping the rest of
            the site uses, so the sectors here match the ones you see elsewhere.
          </p>
        </section>

        {/* 2. Who is receiving */}
        <section id="receiving" style={panelStyle}>
          <div style={eyebrowStyle}>2 · WHO IS RECEIVING</div>
          <h2 style={panelTitleStyle}>Sales lines tied to the build-out</h2>
          <p style={bodyStyle}>
            One revenue line per company, in the company&apos;s own words, from its latest annual report.
            The bar is the change against the year before. Each line stands alone: they are not added up,
            and fiscal years end in different months.
          </p>
          {groups.length === 0 ? (
            <p style={emptyStyle}>The filed lines are being read from the latest annual reports. Check back shortly.</p>
          ) : (
            groups.map((g) => (
              <div key={g.id} style={{ marginTop: 22 }}>
                <h3 style={groupTitleStyle}>{g.heading}</h3>
                {g.hyperscalerNote ? <p style={noteStyle}>{HYPERSCALER_NOTE}</p> : null}
                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  {g.rows.map((r) => (
                    <ReceiverRow key={r.id} row={r} />
                  ))}
                </div>
              </div>
            ))
          )}
          <p style={sourceStyle}>
            Source: each company&apos;s latest annual report (10-K, 20-F or 40-F) filed with the SEC. The line,
            its name and its currency are the company&apos;s own; amounts are shown as filed, not converted.
            &quot;Broad line&quot; marks a line that also includes sales outside data centres.
          </p>
        </section>

        {/* 3. Federal contracts */}
        <section id="contracts" style={panelStyle}>
          <div style={eyebrowStyle}>3 · FEDERAL CONTRACTS</div>
          <h2 style={panelTitleStyle}>Listed companies with the most federal contract dollars</h2>
          {contracts ? (
            <>
              <p style={bodyStyle}>
                Federal contract obligations over the 12 months {monthYear(contracts.window.start)} to{" "}
                {monthYear(contracts.window.end)}, for the recipients we could match to a listed company.
                {contracts.totalAmount ? (
                  <>
                    {" "}Those matches account for {formatAmount(contracts.mappedAmount, "USD")} of{" "}
                    {formatAmount(contracts.totalAmount, "USD")} obligated in all; universities, national
                    labs, joint ventures and private firms make up much of the rest.
                  </>
                ) : null}
              </p>
              <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
                {contractRows.map((r) => (
                  <div key={r.ticker} className="capexRow" style={rowStyle} title={`${r.company}: ${r.amount} across ${r.entities.length} recipient record${r.entities.length === 1 ? "" : "s"}`}>
                    <div style={{ minWidth: 0 }}>
                      <div style={rowHeadStyle}>
                        <span style={tickerStyle}>{r.company}</span>
                        <Link href={`/stock/${encodeURIComponent(r.ticker)}`} style={subLabelStyle}>{r.ticker}</Link>
                      </div>
                      <details style={detailsStyle}>
                        <summary style={summaryStyle}>
                          Paid to: {r.entities[0]}
                          {r.entities.length > 1 ? `, … (${r.entities.length} entities)` : ""}
                        </summary>
                        <ul style={entityListStyle}>
                          {r.entities.map((name) => (
                            <li key={name}>{name}</li>
                          ))}
                        </ul>
                      </details>
                    </div>
                    <div style={barTrackStyle}>
                      <div style={{ ...barStyle, width: `${Math.max(1, r.barPct)}%`, background: "#60a5fa" }} />
                    </div>
                    <div style={valueStyle}>{r.amount}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p style={emptyStyle}>The contract figures are refreshed weekly. Check back shortly.</p>
          )}
          <p style={sourceStyle}>
            Source: USAspending.gov (federal spending data). Recipient names come from SAM.gov registrations.
            Matching a recipient to a listed company is ours: an exact name, or a documented alias for a
            subsidiary. Contracts to run national laboratories are left out, even where a listed company owns
            the operator. Obligations are commitments to pay, not payments made.
          </p>
        </section>

        <p style={footnoteStyle}>
          Filed and published figures only, shown for information. Nothing on this page is a forecast or a
          recommendation.
        </p>
      </div>

      <style>{`
        .capexWrap { max-width: 1040px; margin: 0 auto; padding: 28px 16px 56px; }
        @media (max-width: 640px) { .capexRow { grid-template-columns: 1fr !important; } }
      `}</style>
    </main>
  );
}

function ReceiverRow({ row }: { row: ReceiverView }) {
  const up = (row.changePct ?? 0) >= 0;
  return (
    <div
      className="capexRow"
      style={rowStyle}
      title={`${row.ticker} · ${row.label}: ${row.amount} (${row.fyTo})${row.priorAmount ? `, prior year ${row.priorAmount}` : ""}`}
    >
      <div style={rowHeadStyle}>
        <Link href={`/stock/${encodeURIComponent(row.ticker)}`} style={tickerStyle}>{row.ticker}</Link>
        <span style={labelStyle}>
          {row.label}
          {row.subLabel ? <span style={subLabelStyle}> — {row.subLabel}</span> : null}
        </span>
        {row.broad ? <span style={broadStyle}>Broad line: includes non-data-centre sales</span> : null}
      </div>
      <div style={barTrackStyle}>
        {row.changePct === null ? null : (
          <div style={{ ...barStyle, width: `${Math.max(1, row.barPct)}%`, background: up ? "#4ade80" : "#f87171" }} />
        )}
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ ...valueStyle, color: row.changePct === null ? "rgba(241,245,249,0.7)" : up ? "#86efac" : "#fca5a5" }}>
          {row.changeText}
          {row.capped ? " ▸" : ""}
        </div>
        <div style={metaStyle}>
          {row.amount} · {row.fyTo}
          {row.stale ? " · earlier filing" : ""}
        </div>
      </div>
    </div>
  );
}

function monthYear(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}

const mainStyle: CSSProperties = {
  minHeight: "100vh",
  background: "radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 22%), #06080d",
  color: "#f1f5f9",
  fontFamily: "system-ui, Arial",
};
const heroStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.09)", borderRadius: 28, padding: 22, background: "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(6,9,15,0.98))" };
const tagStyle: CSSProperties = { display: "inline-flex", padding: "8px 12px", borderRadius: 999, border: "1px solid rgba(59,130,246,0.28)", background: "rgba(59,130,246,0.14)", color: "#dbeafe", fontSize: 12, fontWeight: 950, letterSpacing: "0.08em" };
const titleStyle: CSSProperties = { margin: "14px 0 0 0", fontSize: 40, lineHeight: 1.04, letterSpacing: "-0.05em" };
const leadStyle: CSSProperties = { margin: "14px 0 0 0", maxWidth: 820, fontSize: 16, lineHeight: 1.75, color: "rgba(241,245,249,0.82)" };
const chipStyle: CSSProperties = { padding: "8px 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0", fontSize: 13, fontWeight: 800, textDecoration: "none" };
const panelStyle: CSSProperties = { marginTop: 22, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 22, padding: 20, background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))" };
const eyebrowStyle: CSSProperties = { fontSize: 12, fontWeight: 900, letterSpacing: "0.1em", color: "rgba(147,197,253,0.8)" };
const panelTitleStyle: CSSProperties = { margin: "8px 0 0 0", fontSize: 26, letterSpacing: "-0.03em" };
const bodyStyle: CSSProperties = { margin: "10px 0 0 0", maxWidth: 820, fontSize: 15, lineHeight: 1.7, color: "rgba(241,245,249,0.78)" };
const emptyStyle: CSSProperties = { ...bodyStyle, fontStyle: "italic" };
const groupTitleStyle: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", color: "rgba(241,245,249,0.9)" };
const noteStyle: CSSProperties = { margin: "6px 0 0 0", fontSize: 13, lineHeight: 1.6, color: "rgba(253,230,138,0.85)" };
const rowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) 150px", gap: 14, alignItems: "center", padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" };
const rowHeadStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, minWidth: 0 };
const tickerStyle: CSSProperties = { fontWeight: 950, color: "#f8fafc", textDecoration: "none" };
const labelStyle: CSSProperties = { fontSize: 14, color: "rgba(241,245,249,0.85)" };
const subLabelStyle: CSSProperties = { fontSize: 12, color: "rgba(241,245,249,0.6)" };
const broadStyle: CSSProperties = { fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, border: "1px solid rgba(253,230,138,0.35)", color: "rgba(253,230,138,0.9)" };
const barTrackStyle: CSSProperties = { height: 10, borderRadius: 4, background: "rgba(255,255,255,0.06)", overflow: "hidden" };
const barStyle: CSSProperties = { height: "100%", borderRadius: 4 };
const valueStyle: CSSProperties = { fontSize: 16, fontWeight: 950, textAlign: "right" };
const metaStyle: CSSProperties = { marginTop: 2, fontSize: 12, color: "rgba(241,245,249,0.6)" };
const detailsStyle: CSSProperties = { marginTop: 4 };
const summaryStyle: CSSProperties = { cursor: "pointer", fontSize: 12, color: "rgba(241,245,249,0.6)" };
const entityListStyle: CSSProperties = { margin: "6px 0 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: "rgba(241,245,249,0.7)" };
const sourceStyle: CSSProperties = { margin: "18px 0 0 0", fontSize: 12, lineHeight: 1.6, color: "rgba(241,245,249,0.5)" };
const footnoteStyle: CSSProperties = { marginTop: 18, fontSize: 12, lineHeight: 1.6, color: "rgba(241,245,249,0.48)" };
