import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { RECEIVER_ENTRIES, RECEIVER_GROUPS, readReceiversRecord } from "@/lib/server/capexReceivers";
import { readContractsRecord } from "@/lib/server/capexContracts";
import { readSpendingRecord } from "@/lib/server/capexSpending";
import { snapshotCompanyName } from "@/lib/server/companyNameSnapshot";
import { normaliseCompanyName } from "@/lib/server/news/companyName";
import { buildContractRows, buildInsights, buildReceiverGroups, buildSpendingRows, formatAmount, type Insights, type ReceiverView, type SpendingView } from "@/lib/capexPresent";

// Capex -- "Follow the money" (Relay C, #563). Phase 1 panels, each from a
// filed or published source, side by side and deliberately NOT connected:
// no arrows, no flows, no sums across companies (COWORK #1 / #2).
//
// Indexed now that "Who is spending" (Layer 1) is in, built from A's SEC fact
// sets and sector resolver.
//
// Redis: three GETs per render (spending, receivers, contracts), hourly ISR.
// The right-hand insight cards (#563 COWORK #12) read those same three
// records: no new Redis command, no new request.
export const revalidate = 3600;

const PAGE_TITLE = "Capex: Follow the Money | AI & Data-Centre Spending | MyStockHarbor";
const PAGE_DESCRIPTION =
  "What the companies selling into the AI and data-centre build-out report in their own filings, and which listed companies receive federal contracts. Filed figures only.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "https://www.mystockharbor.com/bottlenecks/capex" },
  robots: { index: true, follow: true },
};

const HYPERSCALER_NOTE =
  "These companies are also among the largest spenders above; this is what they sell, not what they buy.";

export default async function CapexPage() {
  const [spending, receivers, contracts] = await Promise.all([readSpendingRecord(), readReceiversRecord(), readContractsRecord()]);
  const spendingRows = spending ? buildSpendingRows(spending.sectors, spending.years) : [];
  const firstYear = spending?.years[0];
  const lastYear = spending?.years[spending.years.length - 1];
  const groups = buildReceiverGroups(RECEIVER_GROUPS, RECEIVER_ENTRIES, receivers?.rows ?? {});
  // Our directory's name for each company, short form ("General Dynamics"),
  // from the committed snapshot: no request at render.
  const companyName = (t: string) => normaliseCompanyName(snapshotCompanyName(t));
  const contractRows = contracts ? buildContractRows(contracts.rows, 15, companyName) : [];
  const insights = buildInsights({
    spending,
    receivers: groups.flatMap((g) => g.rows),
    contracts,
    companyName,
  });

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

        <div className="capexGrid">
        <div className="capexMain">
        {/* 1. Who is spending -- Layer 1: sector totals, a fixed cohort each. */}
        <section id="spending" style={panelStyle}>
          <div style={eyebrowStyle}>1 · WHO IS SPENDING</div>
          <h2 style={panelTitleStyle}>Capital spending by sector</h2>
          {spending && spendingRows.length ? (
            <>
              <p style={bodyStyle}>
                Capital expenditure (money spent on buildings, equipment and data centres) reported by US-listed
                companies, added up by sector for each calendar year {firstYear} to {lastYear}.
              </p>
              <p className="spKey">
                Long bar = {lastYear}, compared across sectors · Small bars = this sector&apos;s last five years
              </p>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {spendingRows.map((r) => (
                  <SpendingRow key={r.sector} row={r} firstYear={firstYear!} lastYear={lastYear!} />
                ))}
              </div>
              <p style={noteStyle}>
                Each sector counts only the companies that reported capex in all five years ({spending.years.length}{" "}
                years), so a bar does not grow just because more companies started reporting.
                {spending.otherCurrency > 0 ? ` ${spending.otherCurrency} filers reporting in other currencies not included.` : ""}
                {spending.unclassified > 0 ? ` ${spending.unclassified} companies without a sector are not placed.` : ""}
                {spending.duplicateListings > 0 ? " Companies with more than one listing are counted once." : ""}
              </p>
              <p style={noteStyle}>
                Sectors follow our classification: Amazon is counted in Consumer Cyclical, Alphabet and Meta in
                Communication Services.
              </p>
            </>
          ) : (
            <p style={emptyStyle}>The sector figures are rebuilt weekly from annual reports. Check back shortly.</p>
          )}
          <p style={sourceStyle}>
            Source: each company&apos;s annual cash-flow and income statements filed with the SEC (10-K, 20-F or
            40-F). Fiscal years are placed in the calendar year that holds most of them. Sectors are the ones used
            across this site. Totals are sums of filed figures, not estimates; capex ÷ revenue uses the companies
            in each sector that reported both in every year.
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
                  <div key={r.ticker} className="capexRow" style={rowStyle} title={`${r.company}: ${r.amount} across ${r.records} recipient record${r.records === 1 ? "" : "s"}`}>
                    <div style={{ minWidth: 0 }}>
                      <div style={rowHeadStyle}>
                        <span style={tickerStyle}>{r.company}</span>
                        <Link href={`/stock/${encodeURIComponent(r.ticker)}`} style={subLabelStyle}>{r.ticker}</Link>
                      </div>
                      <details style={detailsStyle}>
                        <summary style={summaryStyle}>
                          Paid to: {r.entities[0]}
                          {r.entities.length > 1 ? `, … (${r.entities.length} names)` : ""}
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

        </div>
        <InsightColumn insights={insights} contractsWindow={contracts?.window ?? null} />
        </div>

        <p style={footnoteStyle}>
          Filed and published figures only, shown for information. Nothing on this page is a forecast or a
          recommendation.
        </p>
      </div>

      <style>{`
        .capexWrap { max-width: 1240px; margin: 0 auto; padding: 28px 16px 56px; }
        /* Two columns like the earnings page: panels left, insight cards right.
           Under 980px one column, the cards ABOVE the panels (#563 COWORK #12). */
        .capexGrid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.85fr); gap: 22px; align-items: start; }
        .capexGrid > * { min-width: 0; }
        .capexSide { position: sticky; top: 18px; display: grid; gap: 16px; margin-top: 22px; }
        .capexCard { border: 1px solid rgba(255,255,255,0.08); border-radius: 22px; padding: 18px; background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.022)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); }
        .capexCard h3 { margin: 6px 0 0 0; font-size: 18px; letter-spacing: -0.02em; }
        .cardEyebrow { font-size: 12px; font-weight: 950; text-transform: uppercase; letter-spacing: 0.08em; color: #93c5fd; }
        .cardBig { margin-top: 8px; font-size: 26px; font-weight: 950; letter-spacing: -0.03em; }
        .cardText { margin: 6px 0 0 0; font-size: 14px; line-height: 1.6; color: rgba(241,245,249,0.8); }
        .cardSource { margin: 10px 0 0 0; font-size: 11.5px; line-height: 1.5; color: rgba(241,245,249,0.5); }
        .cardList { margin: 10px 0 0 0; padding: 0; list-style: none; display: grid; gap: 8px; }
        .cardList li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: baseline; font-size: 14px; }
        .cardList a { color: #f8fafc; font-weight: 900; text-decoration: none; }
        .cardName { color: rgba(241,245,249,0.65); font-size: 12.5px; margin-left: 6px; }
        .cardAmt { font-weight: 900; }
        .shareTrack { display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: rgba(255,255,255,0.06); margin-top: 10px; }
        .bulletList { margin: 10px 0 0 0; padding-left: 18px; display: grid; gap: 8px; font-size: 14px; line-height: 1.6; color: rgba(241,245,249,0.8); }
        .spKey { margin: 12px 0 0 0; font-size: 12.5px; font-weight: 800; color: rgba(196,181,253,0.9); }
        .spRow { padding: 12px 14px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); display: grid; gap: 8px; }
        .spHead { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 6px 14px; }
        .spLine { display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 10px; align-items: center; }
        .spLbl { font-size: 11px; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(241,245,249,0.55); }
        .spTrack { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .spFill { height: 12px; border-radius: 4px; background: #a78bfa; flex: none; }
        .spAmt { font-size: 14px; font-weight: 950; white-space: nowrap; }
        .spTrend { display: grid; grid-template-columns: repeat(5, minmax(0, 44px)); gap: 6px; }
        .spCol { display: grid; grid-template-rows: 56px auto; gap: 3px; justify-items: stretch; }
        .spBarBox { position: relative; display: flex; align-items: flex-end; height: 56px; }
        .spBar { width: 100%; border-radius: 3px 3px 1px 1px; background: rgba(167,139,250,0.6); cursor: help; outline: none; }
        .spBar:hover, .spBar:focus { background: #c4b5fd; }
        .spBar:hover::after, .spBar:focus::after { content: attr(data-v); position: absolute; left: 50%; bottom: calc(100% + 4px); transform: translateX(-50%); white-space: nowrap; padding: 3px 7px; border-radius: 6px; background: #0f172a; border: 1px solid rgba(148,163,184,0.35); color: #f1f5f9; font-size: 11.5px; font-weight: 800; z-index: 5; }
        .spYear { text-align: center; font-size: 10.5px; font-weight: 800; color: rgba(241,245,249,0.5); }
        .spMeta { font-size: 12px; color: rgba(241,245,249,0.6); }
        @media (max-width: 980px) {
          .capexGrid { grid-template-columns: 1fr; }
          .capexSide { position: static; order: -1; }
        }
        @media (max-width: 640px) { .capexRow { grid-template-columns: 1fr !important; } }
      `}</style>
    </main>
  );
}

function SpendingRow({ row, firstYear, lastYear }: { row: SpendingView; firstYear: number; lastYear: number }) {
  return (
    <div className="spRow">
      <div className="spHead">
        <div>
          <span style={tickerStyle}>{row.sector}</span>
          <span style={{ ...subLabelStyle, marginLeft: 8 }}>{row.cohort} companies</span>
        </div>
        <div className="spMeta">
          {row.changeText} since {firstYear}
          {row.ratioLatest ? (
            <span title={`Capex ÷ revenue, ${row.ratioCohort} companies`}>
              {" "}· of revenue: {row.ratioFirst ?? "–"} ({firstYear}), {row.ratioLatest} ({lastYear})
            </span>
          ) : null}
        </div>
      </div>
      <div className="spLine">
        <span className="spLbl">{lastYear}</span>
        <div className="spTrack" title={`${row.sector}: ${row.latest} in ${lastYear}`}>
          {/* 80% of the track is the scale, so the figure always fits at the bar's end. */}
          <div className="spFill" style={{ width: `${Math.max(1, row.barPct * 0.8)}%` }} />
          <span className="spAmt">{row.latest}</span>
        </div>
      </div>
      <div className="spLine">
        <span className="spLbl">Trend</span>
        <div className="spTrend" aria-label={`Capex ${firstYear} to ${lastYear}`}>
          {row.spark.map((h, i) => (
            <div key={i} className="spCol">
              <div className="spBarBox">
                <div
                  className="spBar"
                  tabIndex={0}
                  role="img"
                  aria-label={row.sparkTitles[i]}
                  data-v={row.sparkValues[i]}
                  style={{ height: `${Math.max(3, h)}%` }}
                />
              </div>
              <span className="spYear">{row.sparkYears[i]}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="spMeta">
        Largest reported:{" "}
        {row.top.map((t, i) => (
          <span key={t}>
            {i ? ", " : ""}
            <Link href={`/stock/${encodeURIComponent(t)}`} style={{ color: "inherit" }}>{t}</Link>
          </span>
        ))}
      </div>
    </div>
  );
}

// The right column (#563 COWORK #12): each card reads one of the page's three
// records, names its source and year, and never links one panel to another.
function InsightColumn({ insights: x, contractsWindow }: { insights: Insights; contractsWindow: { start: string; end: string } | null }) {
  const shareColors = ["#a78bfa", "#60a5fa", "#34d399"];
  return (
    <aside className="capexSide">
      {x.whereMoney.length ? (
        <section className="capexCard">
          <div className="cardEyebrow">Where the money is going</div>
          <h3>Largest sectors by {x.year} capex</h3>
          <div className="shareTrack" aria-hidden="true">
            {x.whereMoney.map((w, i) => (
              <div key={w.sector} style={{ width: `${w.sharePct}%`, background: shareColors[i] }} />
            ))}
          </div>
          <ul className="cardList">
            {x.whereMoney.map((w, i) => (
              <li key={w.sector}>
                <span><span style={{ color: shareColors[i] }}>■</span> {w.sector}</span>
                <span className="cardAmt">{w.amount} · {w.shareText}</span>
              </li>
            ))}
            {x.otherSectors ? (
              <li>
                <span style={{ color: "rgba(241,245,249,0.65)" }}>■ The other {x.otherSectors.count} sectors</span>
                <span className="cardAmt" style={{ color: "rgba(241,245,249,0.65)" }}>{x.otherSectors.shareText}</span>
              </li>
            ) : null}
          </ul>
          <p className="cardSource">Share of {x.year} capex across the sectors shown. Source: SEC annual filings, calendar {x.year}.</p>
        </section>
      ) : null}

      {x.topSpenders.length ? (
        <section className="capexCard">
          <div className="cardEyebrow">Who is spending most</div>
          <h3>Largest reported capex, {x.year}</h3>
          <ul className="cardList">
            {x.topSpenders.map((t) => (
              <li key={t.ticker}>
                <span>
                  <Link href={`/stock/${encodeURIComponent(t.ticker)}`}>{t.ticker}</Link>
                  <span className="cardName">{t.name}</span>
                </span>
                <span className="cardAmt">{t.amount}</span>
              </li>
            ))}
          </ul>
          <p className="cardSource">Source: each company&apos;s cash-flow statement filed with the SEC, calendar {x.year}.</p>
        </section>
      ) : null}

      {x.fastest ? (
        <section className="capexCard">
          <div className="cardEyebrow">Fastest growing</div>
          <h3>{x.fastest.sector}</h3>
          <div className="cardBig">{x.fastest.changeText}</div>
          <p className="cardText">Capex went from {x.fastest.from} in {x.fastest.firstYear} to {x.fastest.to} in {x.year}, the largest rise of any sector shown.</p>
          <p className="cardSource">Source: SEC annual filings, calendar {x.fastest.firstYear}–{x.year}.</p>
        </section>
      ) : null}

      {x.reinvest ? (
        <section className="capexCard">
          <div className="cardEyebrow">Reinvesting the most</div>
          <h3>{x.reinvest.sector}</h3>
          <div className="cardBig">{x.reinvest.ratioText}</div>
          <p className="cardText">of revenue went back into capital spending in {x.year}, the highest share of any sector shown ({x.reinvest.cohort} companies).</p>
          <p className="cardSource">Source: SEC annual filings, calendar {x.year}.</p>
        </section>
      ) : null}

      {x.receiverTop ? (
        <section className="capexCard">
          <div className="cardEyebrow">Receivers snapshot</div>
          <h3>Fastest-growing filed line</h3>
          <p className="cardText">
            <Link href={`/stock/${encodeURIComponent(x.receiverTop.ticker)}`} style={{ color: "#f8fafc", fontWeight: 900, textDecoration: "none" }}>{x.receiverTop.name}</Link>
            {" "}— {x.receiverTop.line}
          </p>
          <div className="cardBig">{x.receiverTop.changeText}</div>
          <p className="cardSource">Change against the year before. Source: the company&apos;s latest annual report, {x.receiverTop.fyTo}.</p>
        </section>
      ) : null}

      {x.contractTop ? (
        <section className="capexCard">
          <div className="cardEyebrow">Federal contracts snapshot</div>
          <h3>
            <Link href={`/stock/${encodeURIComponent(x.contractTop.ticker)}`} style={{ color: "inherit", textDecoration: "none" }}>{x.contractTop.name}</Link>
          </h3>
          <div className="cardBig">{x.contractTop.amount}</div>
          <p className="cardText">
            The largest matched recipient. Matched listed companies together: {x.contractTop.mapped}
            {x.contractTop.total ? ` of ${x.contractTop.total} obligated in all` : ""}.
          </p>
          <p className="cardSource">
            Source: USAspending.gov{contractsWindow ? `, ${monthYear(contractsWindow.start)} to ${monthYear(contractsWindow.end)}` : ""}.
          </p>
        </section>
      ) : null}

      <section className="capexCard">
        <div className="cardEyebrow">What it means</div>
        <h3>Reading this page</h3>
        <ul className="bulletList">
          <li>Rising capex can signal that companies expect demand to grow; it can also weigh on free cash flow in the short term.</li>
          <li>Capex as a share of revenue shows how much of each sales dollar is being reinvested.</li>
          <li>Spending by buyers and sales by suppliers are shown side by side; the page does not link them.</li>
        </ul>
      </section>
    </aside>
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
