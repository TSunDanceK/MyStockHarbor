// The earnings page's SEC-backed cards, plus the one that renders a hidden one.
//
// Presentational and server-rendered: every decision about which number is
// which, and what is derived, is made in lib/server/secEarningsView.ts and
// asserted by scripts/check-sec-earnings-page.mjs. This file only draws.
import {
  GAAP_EPS_NOTE, SEC_ATTRIBUTION, retiredSource,
  type SecEarningsView, type ViewCell,
} from "@/lib/server/secEarningsView";

function money(v: number | null | undefined, compact = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (compact && abs >= 1e9) return `${v < 0 ? "-" : ""}$${(abs / 1e9).toFixed(2)}B`;
  if (compact && abs >= 1e6) return `${v < 0 ? "-" : ""}$${(abs / 1e6).toFixed(1)}M`;
  return `${v < 0 ? "-" : ""}$${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
const pct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
const ratio = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(2);

/**
 * The marker on a figure the filer did not publish for that period.
 *
 * NOT A FOOTNOTE SYMBOL ALONE. A bare asterisk tells a reader something is
 * different without saying what, so the sentence is on the element itself.
 */
export function DerivedMark({ cell }: { cell: ViewCell }) {
  if (!cell.derivedNote) return null;
  return (
    <abbr
      title={cell.derivedNote}
      style={{ marginLeft: 5, fontSize: 11, fontWeight: 800, color: "#94a3b8", textDecoration: "none", cursor: "help" }}
    >
      derived
    </abbr>
  );
}

/** A cell's value, with its derived mark. `—` when the filer did not publish it. */
export function CellValue({ cell, compact = false, currency = true }: { cell: ViewCell; compact?: boolean; currency?: boolean }) {
  return (
    <>
      {currency ? money(cell.val, compact) : cell.val == null ? "—" : cell.val.toLocaleString("en-US")}
      <DerivedMark cell={cell} />
    </>
  );
}

/**
 * A card whose source went away.
 *
 * THE OWNER'S RULE: hidden, not removed, with the reason visible and the
 * registry entry naming what went and when. Never a blank space and never a
 * zero -- "EPS surprise: 0.00" reads as "came in exactly in line", which is a
 * claim, and a false one.
 */
export function HiddenCard({ id, stacked = false }: { id: string; stacked?: boolean }) {
  const r = retiredSource(id);
  return (
    <section
      className="card"
      style={stacked ? undefined : { borderStyle: "dashed", opacity: 0.85 }}
      data-hidden-source={r.id}
    >
      <div className="eyebrow">Not shown</div>
      <h3 style={{ marginTop: 4 }}>{r.label}</h3>
      <p style={{ fontSize: 13.5, marginBottom: 0 }}>{r.reason}</p>
    </section>
  );
}

function Metric({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="metricCard">
      <div className="metricLabel">{label}</div>
      <div className="metricValue">{children}</div>
      {sub ? <div className="metricSub">{sub}</div> : null}
    </div>
  );
}

export function SecSnapshotCard({ view }: { view: SecEarningsView }) {
  const s = view.snapshot;
  return (
    <section className="card">
      <div className="eyebrow">Latest reported quarter</div>
      <h2>{view.symbol} latest earnings snapshot</h2>
      <p>
        Most recent quarter filed: <strong>{view.latestLabel}</strong> (period ending{" "}
        <strong>{view.latestEnd}</strong>)
        {view.latestFiled ? <>, filed <strong>{view.latestFiled}</strong></> : null}
        {view.latestAccession ? <> under accession <code>{view.latestAccession}</code></> : null}.
      </p>
      <div className="metricGrid">
        <Metric label="Revenue"><CellValue cell={s.revenue} compact /></Metric>
        <Metric label="YoY revenue growth" sub={s.comparedWith ? `Compared with ${s.comparedWith}` : undefined}>
          {pct(s.revenueYoY)}
        </Metric>
        <Metric label="Diluted EPS (GAAP)"><CellValue cell={s.epsDiluted} /></Metric>
        <Metric label="YoY EPS growth" sub={s.comparedWith ? `Compared with ${s.comparedWith}` : undefined}>
          {pct(s.epsYoY)}
        </Metric>
        <Metric label="Operating income"><CellValue cell={s.operatingIncome} compact /></Metric>
        <Metric label="Net income"><CellValue cell={s.netIncome} compact /></Metric>
      </div>
      <p className="earningsDataNote">{GAAP_EPS_NOTE} Source: {SEC_ATTRIBUTION}.</p>
      {/* PERIOD LABELS ARE THE FILER'S OWN FISCAL PERIOD, NOT THE CALENDAR. The
          probe set's year-ends are 31 Mar, 26 Sep, 3 Sep, 31 Oct and 31 Dec, so
          two companies' "2026" can be nine months apart. */}
      <p className="earningsDataNote">
        Quarters are labelled by the company&apos;s own fiscal calendar, which often differs from the
        calendar year.
      </p>
    </section>
  );
}

export function SecGrowthMarginsCard({ view }: { view: SecEarningsView }) {
  return (
    <section className="card">
      <div className="eyebrow">Growth &amp; margins</div>
      <h2>Is growth accelerating, and are margins holding up?</h2>
      <p>
        Year-over-year growth compares each quarter with the same quarter a year earlier. Margins are
        gross profit, operating income and net income as a share of that quarter&apos;s revenue.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="historyTable">
          <thead>
            <tr><th>Quarter</th><th>Revenue YoY</th><th>EPS YoY</th><th>Gross margin</th><th>Operating margin</th><th>Net margin</th></tr>
          </thead>
          <tbody>
            {view.margins.map((m, i) => (
              <tr key={m.label}>
                {/* data-label, not a position: the page's narrow-screen rule
                    reads attr(data-label), because two tables here have
                    different columns and an nth-child rule would relabel one. */}
                <td data-label="Quarter">{m.label}</td>
                <td data-label="Revenue YoY">{pct(view.growth[i]?.revenueYoY)}</td>
                <td data-label="EPS YoY">{pct(view.growth[i]?.epsYoY)}</td>
                <td data-label="Gross margin">{pct(m.gross)}</td>
                <td data-label="Operating margin">{pct(m.operating)}</td>
                <td data-label="Net margin">{pct(m.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="earningsDataNote">Source: {SEC_ATTRIBUTION}.</p>
    </section>
  );
}

export function SecCashQualityCard({ view }: { view: SecEarningsView }) {
  const c = view.cashQuality;
  return (
    <section className="card">
      <div className="eyebrow">Quality of earnings</div>
      <h3>Is the profit turning into cash? — {view.latestLabel}</h3>
      <div style={{ marginTop: 12 }}>
        <Row label="Operating cash flow"><CellValue cell={c.operatingCashFlow} compact /></Row>
        <Row label="Capital expenditure"><CellValue cell={c.capex} compact /></Row>
        <Row label="Free cash flow" strong>
          {money(c.freeCashFlow, true)}
          {c.freeCashFlowDerived ? (
            <abbr
              title="Derived: operating cash flow minus capital expenditure, both of which the filer reports year-to-date, so this quarter is the difference between two cumulative figures."
              style={{ marginLeft: 5, fontSize: 11, fontWeight: 800, color: "#94a3b8", textDecoration: "none", cursor: "help" }}
            >derived</abbr>
          ) : null}
        </Row>
        <Row label="Net income"><CellValue cell={c.netIncome} compact /></Row>
        <Row label="Cash flow less net income" sub="Positive means cash is running ahead of reported profit.">
          {money(c.accruals, true)}
        </Row>
        <Row label="Share-based compensation"><CellValue cell={c.shareBasedCompensation} compact /></Row>
      </div>
      {/* TRAP 1, AND IT IS WHY EVERY CASH LINE HERE CAN CARRY A DERIVED MARK.
          US filers report cash flow YEAR-TO-DATE: Q1 covers three months, Q2
          six, Q3 nine, the 10-K twelve. Read straight, a Q3 figure is roughly
          three times too large and looks entirely plausible. */}
      <p className="earningsDataNote">
        Cash-flow figures are filed year-to-date, so every quarter except the first is the difference
        between two cumulative figures — those are marked <em>derived</em>. Source: {SEC_ATTRIBUTION}.
      </p>
    </section>
  );
}

export function SecBalanceSheetCard({ view }: { view: SecEarningsView }) {
  const b = view.balance;
  if (!b) return null;
  return (
    <section className="card">
      <div className="eyebrow">Balance sheet</div>
      <h3>Financial position as at {b.asOf}</h3>
      <div style={{ marginTop: 12 }}>
        <Row label="Cash &amp; equivalents"><CellValue cell={b.cash} compact /></Row>
        <Row label="Short-term investments"><CellValue cell={b.shortTermInvestments} compact /></Row>
        <Row label="Total debt">{money(b.totalDebt, true)}</Row>
        <Row label="Net cash" strong sub="Cash and short-term investments less total debt.">
          {money(b.netCash, true)}
        </Row>
        <Row label="Current ratio">{ratio(b.currentRatio)}</Row>
        <Row label="Total assets"><CellValue cell={b.totalAssets} compact /></Row>
        <Row label="Total liabilities"><CellValue cell={b.totalLiabilities} compact /></Row>
        <Row label="Shareholders&apos; equity" strong><CellValue cell={b.stockholdersEquity} compact /></Row>
      </div>
      <p className="earningsDataNote">
        Balance-sheet figures are a position at a date, not a period total, so none of them are
        derived. Source: {SEC_ATTRIBUTION}.
      </p>
    </section>
  );
}

export function SecIncomeStatementCard({ view }: { view: SecEarningsView }) {
  return (
    <section className="card">
      <div className="eyebrow">Income statement</div>
      <h3>Full profit &amp; loss — {view.latestLabel}</h3>
      <div style={{ marginTop: 12 }}>
        {view.incomeStatement.map((c) => (
          <Row key={c.label} label={c.label}>
            <CellValue cell={c} compact currency={!c.label.includes("shares")} />
          </Row>
        ))}
      </div>
      {/* MEASURED TO FAIL ON 5 OF 32 PROBE QUARTERS (ARM, MU), always because the
          filer expenses something these lines have no slot for -- restructuring,
          impairments, amortisation of intangibles. Operating income is taken as
          filed and is right; it is the BREAKDOWN that is partial, and the card
          must not imply otherwise. */}
      {!view.incomeStatementComplete ? (
        <p className="earningsDataNote">
          The expense lines above do not add up to operating income for this quarter: this company
          reports costs that these categories do not cover. Operating income is as filed.
        </p>
      ) : null}
      <p className="earningsDataNote">{GAAP_EPS_NOTE} Source: {SEC_ATTRIBUTION}.</p>
    </section>
  );
}

export function SecRecentQuartersCard({ view }: { view: SecEarningsView }) {
  return (
    <section className="card">
      <div className="eyebrow">Earnings history</div>
      <h2>Recent reported quarters</h2>
      <p>
        As filed with the SEC. Estimate and surprise columns are no longer shown —{" "}
        {retiredSource("quarter-estimate-columns").reason}
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="historyTable">
          <thead><tr><th>Quarter</th><th>Period ending</th><th>Revenue</th><th>Diluted EPS (GAAP)</th><th>Net income</th></tr></thead>
          <tbody>
            {view.recentQuarters.map((r) => (
              <tr key={r.end}>
                <td data-label="Quarter">{r.label}</td>
                <td data-label="Period ending">{r.end}</td>
                <td data-label="Revenue"><CellValue cell={r.revenue} compact /></td>
                <td data-label="Diluted EPS (GAAP)"><CellValue cell={r.epsDiluted} /></td>
                <td data-label="Net income"><CellValue cell={r.netIncome} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Q4 IS NEVER FILED AS A STANDALONE QUARTER, and a weighted-average share
          count is not additive, so EPS cannot be derived for it either. One row
          in four shows a dash where the filer published nothing. */}
      <p className="earningsDataNote">
        Companies do not file a standalone fourth quarter, so EPS is blank on that row rather than
        estimated. Source: {SEC_ATTRIBUTION}.
      </p>
    </section>
  );
}

function Row({ label, children, sub, strong }: { label: string; children: React.ReactNode; sub?: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid rgba(148,163,184,0.14)" }}>
      <div style={{ fontSize: 13.5, fontWeight: strong ? 800 : 600, color: strong ? undefined : "#cbd5e1" }}>
        {label}
        {sub ? <div style={{ fontSize: 11.5, fontWeight: 500, color: "#94a3b8" }}>{sub}</div> : null}
      </div>
      <div style={{ fontSize: 13.5, fontWeight: strong ? 800 : 700, whiteSpace: "nowrap" }}>{children}</div>
    </div>
  );
}

/**
 * PENDING — and it must be genuinely temporary.
 *
 * Reached only when a cold fetch timed out, was refused by the per-IP budget, or
 * failed. The symbol IS queued, so this state ends. It is NOT the state for a
 * filer whose data cannot be read at all — see SecNoXbrlCard, and the comment
 * there for why conflating them puts a permanent "coming soon" on a page.
 */
export function SecPendingCard({ symbol }: { symbol: string }) {
  return (
    <section className="card">
      <div className="eyebrow">Loading financials</div>
      <h2>{symbol} financials are being fetched</h2>
      <p style={{ marginBottom: 0 }}>
        This page is built from {SEC_ATTRIBUTION}. {symbol}&apos;s filings are being read now —
        refresh in a moment, or check back shortly.
      </p>
    </section>
  );
}

/**
 * NO READABLE DATA — and the card must say WHOSE limit it is.
 *
 * ── THE COPY THAT SHIPPED WAS A FALSE STATEMENT ABOUT REAL COMPANIES ───────
 * It read "{symbol} does not file the financial data this page is built from".
 * For a foreign private issuer that is simply untrue. companyfacts namespaces
 * facts BY TAXONOMY, so Ryanair's complete IFRS statements were in the payload
 * the whole time, under `ifrs-full`, which these field definitions did not
 * read. The page was describing its own gap as a fact about Ryanair -- on a
 * quarter of stock pages, since 49 of the 55 periodic filers in the measured
 * window were 6-K filers and HSBC, AZN, GSK, NVS, BIDU, SAN, LYG, VALE, ZTO and
 * ABEV are all in the universe.
 *
 * ── SO THERE ARE TWO CARDS' WORTH OF TRUTH HERE, AND ONE PROP DECIDES ──────
 *   "unread-taxonomy"  the payload HAS financial facts, in a namespace this
 *                      page does not read yet. A gap in the SITE. Named, so a
 *                      reader can see it is a coverage limit and not a verdict
 *                      on the company.
 *   "none"             no financial namespace at all -- a dei-only payload.
 *                      THE ONLY case that may be worded as a fact about the
 *                      filer, and it is the wording the original card used for
 *                      everyone.
 *
 * `unreadableReason()` in secExtract decides from the stored taxonomy census
 * rather than from a list of filers anyone maintains. A set stored before that
 * census existed has no `tx`, which reads as UNKNOWN -- and unknown takes the
 * site-limit wording, because claiming a company files nothing on the strength
 * of a field that is absent is the same error in a new place.
 */
export function SecNoXbrlCard({
  symbol,
  reason,
  taxonomies = [],
}: {
  symbol: string;
  reason: "unread-taxonomy" | "currency" | "unread-detail" | "none" | "unknown";
  /** The namespaces on "unread-taxonomy"; the currency codes on "currency". */
  taxonomies?: string[];
}) {
  const named = taxonomies.length ? taxonomies.join(", ") : "a taxonomy";
  // ── THE CURRENCY CASE, AND IT IS THE COMMON ONE ────────────────────────────
  // Measured after the ifrs-full chains landed: the filers that still do not
  // render are not a tagging gap, they are AEG in EUR, NWG in GBP, MFC in CAD,
  // RYAAY in EUR, VIV in BRL. rowsForField refuses a non-USD figure on purpose
  // -- a euro number under a dollar sign is the plausible wrong number this
  // whole pipeline is built against -- so the honest card names the currency
  // rather than implying the filing is unreadable.
  if (reason === "currency") {
    return (
      <section className="card">
        <div className="eyebrow">Not supported yet</div>
        <h2>
          {symbol} reports in {named}
        </h2>
        <p>
          {symbol} files complete financial statements with {SEC_ATTRIBUTION}, denominated
          in {named}. This page reads US-dollar figures only, and shows nothing rather than
          printing a {named} figure with a dollar sign on it.
        </p>
        <p style={{ marginBottom: 0 }}>
          Its filings are available now on{" "}
          <a href="https://www.sec.gov/edgar/search/" style={{ color: "#93c5fd", fontWeight: 800 }}>
            SEC EDGAR
          </a>
          .
        </p>
      </section>
    );
  }
  if (reason === "none") {
    return (
      <section className="card">
        <div className="eyebrow">Not available for this company</div>
        <h2>{symbol} has not filed XBRL financial statements</h2>
        <p>
          This page reads structured XBRL financial statements from {SEC_ATTRIBUTION}.{" "}
          {symbol}&apos;s filings carry cover-page data only — no tagged income statement,
          cash-flow statement or balance sheet — most often because it has not filed a full
          financial year yet.
        </p>
        <p style={{ marginBottom: 0 }}>
          Its filings are still public on{" "}
          <a href="https://www.sec.gov/edgar/search/" style={{ color: "#93c5fd", fontWeight: 800 }}>
            SEC EDGAR
          </a>
          .
        </p>
      </section>
    );
  }
  return (
    <section className="card">
      <div className="eyebrow">Not supported yet</div>
      <h2>This page does not read {symbol}&apos;s filings yet</h2>
      <p>
        {symbol} files its financial statements with {SEC_ATTRIBUTION}
        {reason === "unread-taxonomy" ? (
          <>
            {" "}
            under the <strong>{named}</strong> taxonomy
          </>
        ) : null}
        , which this page does not read yet. The data exists — the gap is here, not in{" "}
        {symbol}&apos;s reporting.
      </p>
      <p style={{ marginBottom: 0 }}>
        Its filings are available now on{" "}
        <a href="https://www.sec.gov/edgar/search/" style={{ color: "#93c5fd", fontWeight: 800 }}>
          SEC EDGAR
        </a>
        .
      </p>
    </section>
  );
}

