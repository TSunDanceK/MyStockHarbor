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
/**
 * A CHANGE, signed. The "+" says "up on the base", so it belongs only on a
 * figure that HAS a base.
 */
const pct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;

/**
 * A LEVEL, unsigned. Margins are a share of revenue, not a change in one, and
 * rendering a 82.9% gross margin as "+82.9%" reads as growth of 82.9%.
 */
const pctLevel = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`;
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
/**
 * ── A HIDDEN SOURCE RENDERS NOTHING. THE REGISTRY STAYS. ──────────────────
 *
 * This used to render a dashed "Not shown" card carrying the reason. The rule
 * has been reversed deliberately by the owner: the five retired sources render
 * NOTHING AT ALL, because a page carrying five apology cards about analyst
 * estimates reads as a broken page rather than an honest one, and no free
 * source for any of them exists to restore.
 *
 * WHAT IS NOT REVERSED: the registry. RETIRED_SOURCES still names every one,
 * what supplied it, when it went and why, and `retiredSource()` still THROWS on
 * an unknown id. That is the part that stops the next person re-adding a column
 * and wiring it to whatever is nearest — the reason lives in the source, where
 * someone about to restore the column will read it, instead of on the page,
 * where a reader who never had the feature is told about its absence.
 *
 * `id` is still required and still validated, so hiding a card without
 * registering it is still impossible.
 */
export function HiddenCard({ id }: { id: string; stacked?: boolean }) {
  // Validated for its throw, then discarded. Calling it is the point.
  retiredSource(id);
  return null;
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
        {view.latestFiled ? <>, filed <strong>{view.latestFiled}</strong></> : null}.
      </p>
      {/* THE ACCESSION IS A DATABASE KEY, NOT A FACT ABOUT THE COMPANY. It read
          as "under accession 0000320193-26-000081" in the middle of a sentence
          a reader was meant to understand. It still identifies the filing, so
          it carries the link rather than the prose. */}
      {view.latestAccession ? (
        <p style={{ marginTop: -4 }}>
          <a
            href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(view.symbol)}&type=10-&dateb=&owner=include&count=10`}
            style={{ color: "#93c5fd", fontWeight: 800 }}
          >
            View this filing on SEC EDGAR
          </a>
        </p>
      ) : null}
      <div className="metricGrid">
        <Metric label="Revenue"><CellValue cell={s.revenue} compact /></Metric>
        {/* NO COMPARATOR MEANS NO FIGURE, AND THE CARD SAYS WHY. It used to
            take the fourth row back whatever that was, which on a half-yearly
            filer was a four-year-old quarter labelled "year over year". */}
        <Metric
          label="YoY revenue growth"
          sub={s.comparedWith ? `Compared with ${s.comparedWith}` : "Prior-year quarter not on file"}
        >
          {pct(s.revenueYoY)}
        </Metric>
        <Metric label="Diluted EPS (GAAP)"><CellValue cell={s.epsDiluted} /></Metric>
        <Metric
          label="YoY EPS growth"
          sub={s.comparedWith ? `Compared with ${s.comparedWith}` : "Prior-year quarter not on file"}
        >
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
      {/* "PERIODS ON FILE", NOT "QUARTERS". These are the periods the filer
          published, in order — not a contiguous run. AZN's eight rows carry a
          three-quarter hole and the table presented them as consecutive. */}
      {/* ── THE GAP EXPLANATION IS VISIBLE TEXT, NOT AN abbr TITLE ────────────
          It lived only in the badge's `title`, which is hover-only: on a phone
          there is nothing to hover, so most of the audience saw an unexplained
          "gap" and no way to find out what it meant. This paragraph already
          carries two other clarifications, so it is where the third belongs.
          The badge stays as a per-row marker — it now points at an explanation
          the reader can actually read. */}
      <p>
        The periods this company has filed, newest last. Year-over-year growth compares each period
        with the <strong>same fiscal quarter one year earlier</strong>, named in the row; where that
        period is not on file the figure is blank rather than measured against something else.
        Margins are gross profit, operating income and net income as a share of that period&apos;s
        revenue. A row marked <strong>gap</strong> has no filing on file for the period immediately
        before it — these are the periods the company published, not a consecutive run of quarters.
        {/* VISIBLE, not hover-only — the same lesson as the gap badge. */}{" "}
        <strong>Q4 EPS is not filed separately:</strong> companies file nine-month and full-year
        figures, and this page does not derive the difference, so those cells read
        &ldquo;not filed&rdquo;.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="historyTable">
          <thead>
            <tr><th>Period</th><th>Compared with</th><th>Revenue YoY</th><th>EPS YoY</th><th>Gross margin</th><th>Operating margin</th><th>Net margin</th></tr>
          </thead>
          <tbody>
            {view.margins.map((m, i) => (
              <tr key={m.label}>
                {/* data-label, not a position: the page's narrow-screen rule
                    reads attr(data-label), because two tables here have
                    different columns and an nth-child rule would relabel one. */}
                <td data-label="Period">
                  {m.label}
                  {/* The gap is marked on the row ABOVE it in reading order,
                      because `margins` is reversed to oldest-first for display
                      while gapAfter was computed newest-first. */}
                  {m.gapAfter ? (
                    <abbr
                      title="No filing on file for the period immediately before this one — these rows are the periods the company published, not a consecutive run."
                      style={{ marginLeft: 5, fontSize: 11, fontWeight: 800, color: "#94a3b8", textDecoration: "none", cursor: "help" }}
                    >gap</abbr>
                  ) : null}
                </td>
                {/* THE BASE, DISCLOSED PER ROW. The snapshot card named its
                    comparator and this table did not, so the same wrong base
                    was visible in one place and silent in the other. */}
                <td data-label="Compared with">{view.growth[i]?.comparedWith ?? "not on file"}</td>
                <td data-label="Revenue YoY">{pct(view.growth[i]?.revenueYoY)}</td>
                {/* A BLANK Q4 EPS IS NOT A GAP IN THE DATA. Q4 is never filed
                    as a standalone three-month frame, and this page refuses to
                    invent one (no 4·FY − 3·9M, no ratio against another
                    period's share count). A bare "—" reads as missing; the
                    reason is one hover and one footnote away instead. */}
                <td data-label="EPS YoY">
                  {view.growth[i]?.epsYoY == null && /^Q4 /.test(m.label) ? (
                    <abbr title="Q4 EPS is not filed separately — companies file nine-month and full-year figures, and this page does not derive the difference." style={{ textDecoration: "none", cursor: "help", color: "#94a3b8" }}>
                      not filed
                    </abbr>
                  ) : (
                    pct(view.growth[i]?.epsYoY)
                  )}
                </td>
                <td data-label="Gross margin">{pctLevel(m.gross)}</td>
                <td data-label="Operating margin">{pctLevel(m.operating)}</td>
                <td data-label="Net margin">{pctLevel(m.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="earningsDataNote">Source: {SEC_ATTRIBUTION}.</p>
    </section>
  );
}

/**
 * FIVE FISCAL YEARS — ONE COMPONENT, TWO PLACES.
 *
 * (i) every stock gets this card, quarterly filer or not, and (ii) for an
 * annual-only filer like KGC it is the ONLY growth table, because that filer
 * has no quarters to tabulate.
 *
 * ONE COMPONENT RATHER THAN TWO, deliberately. Two would be two places for the
 * label, the comparator and the null handling to drift apart, and the whole
 * point of `view.annual` is that both read the same rows built by the same
 * builder from the same helpers.
 *
 * YoY IS FY AGAINST FY-1 BY LABEL — priorYearOf on the years array, which
 * works unchanged because annual periods carry `fp: "FY"` and a real `fy`.
 * Never an array offset, and "not on file" where the prior year is absent.
 * No gap badge: a gap is a quarterly idea (see gapAfter in secEarningsView).
 */
export function SecAnnualCard({ view, sole = false }: { view: SecEarningsView; sole?: boolean }) {
  if (!view.annual.length) return null;
  return (
    <section className="card">
      <div className="eyebrow">Five-year history</div>
      <h2>
        {view.symbol} by fiscal year
        {sole ? "" : " — the longer view"}
      </h2>
      <p>
        Each fiscal year as filed, oldest first, with the year it is measured against named in the
        row. Year-over-year compares a fiscal year with the one before it; where that year is not on
        file the figure is blank rather than measured against something else. Margins are gross
        profit, operating income and net income as a share of that year&apos;s revenue.
        {sole ? (
          <>
            {" "}
            <strong>{view.symbol} files annually</strong>, so these are the only periods it
            publishes — there is no quarterly table below.
          </>
        ) : null}
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="historyTable">
          <thead>
            <tr>
              <th>Fiscal year</th><th>Compared with</th><th>Revenue</th><th>Revenue YoY</th>
              <th>Diluted EPS</th><th>EPS YoY</th>
              <th>Gross margin</th><th>Operating margin</th><th>Net margin</th>
            </tr>
          </thead>
          <tbody>
            {view.annual.map((r) => (
              <tr key={r.label}>
                <td data-label="Fiscal year">
                  {r.label}
                  {/* EVERY FIGURE NAMES ITS PERIOD END, not just its label —
                      two filers' "FY2025" can be nine months apart. */}
                  <span style={{ display: "block", fontSize: 11, color: "#94a3b8" }}>
                    ended {r.end}
                  </span>
                </td>
                <td data-label="Compared with">{r.comparedWith ?? "not on file"}</td>
                <td data-label="Revenue"><CellValue cell={r.revenue} compact /></td>
                <td data-label="Revenue YoY">{pct(r.revenueYoY)}</td>
                <td data-label="Diluted EPS"><CellValue cell={r.epsDiluted} /></td>
                <td data-label="EPS YoY">{pct(r.epsYoY)}</td>
                <td data-label="Gross margin">{pctLevel(r.gross)}</td>
                <td data-label="Operating margin">{pctLevel(r.operating)}</td>
                <td data-label="Net margin">{pctLevel(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="earningsDataNote">{GAAP_EPS_NOTE} Source: {SEC_ATTRIBUTION}.</p>
    </section>
  );
}

export function SecCashQualityCard({ view }: { view: SecEarningsView }) {
  const c = view.cashQuality;
  return (
    <section className="card">
      <div className="eyebrow">Quality of earnings</div>
      {/* THE HEADING NAMES THE CARD'S OWN PERIOD, not the page's latest
          quarter. They differ whenever the filer publishes a cash-flow
          statement only on 6- and 12-month frames: every figure below then
          comes from the latest FULL YEAR, and a heading that still said
          "Q2 FY2025" over annual numbers would be the mixed-period claim this
          card is built to avoid. */}
      <h3>Is the profit turning into cash? — {c.period}</h3>
      {c.basis === "year" ? (
        <p style={{ marginTop: 8, marginBottom: 0 }}>
          <strong>{view.symbol} does not publish a quarterly cash-flow statement.</strong> Its
          filings carry cash flow only over six- and twelve-month periods, so every figure on this
          card — including the net income it is compared against — is the full year {c.period},
          not {view.latestLabel}.
        </p>
      ) : null}
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
        <Row label={c.basis === "year" ? "Net income (same period)" : "Net income"}>
          <CellValue cell={c.netIncome} compact />
        </Row>
        {/* BOTH LEGS ARE THE SAME PERIOD. Annual operating cash flow against a
            quarterly net income reads as roughly 4x cash conversion and would
            score STRONG for an arithmetic reason alone. cashFrom in
            secEarningsView selects one period for the whole card. */}
        <Row
          label="Cash flow less net income"
          sub={`Positive means cash is running ahead of reported profit. Both figures are ${c.period}.`}
        >
          {money(c.accruals, true)}
        </Row>
        <Row label="Share-based compensation"><CellValue cell={c.shareBasedCompensation} compact /></Row>
      </div>
      {/* TRAP 1, AND IT IS WHY EVERY CASH LINE HERE CAN CARRY A DERIVED MARK.
          US filers report cash flow YEAR-TO-DATE: Q1 covers three months, Q2
          six, Q3 nine, the 10-K twelve. Read straight, a Q3 figure is roughly
          three times too large and looks entirely plausible. */}
      <p className="earningsDataNote">
        {c.basis === "year" ? (
          <>
            Annual cash-flow figures as filed, for {c.period}. Source: {SEC_ATTRIBUTION}.
          </>
        ) : (
          <>
            Cash-flow figures are filed year-to-date, so every quarter except the first is the
            difference between two cumulative figures — those are marked <em>derived</em>. Source:{" "}
            {SEC_ATTRIBUTION}.
          </>
        )}
      </p>
    </section>
  );
}

/**
 * A QUARTER. Past this the balance-sheet date is far enough from the income
 * statement's period end that presenting them together without a word is
 * misleading, so the card says one.
 */
const BALANCE_SHEET_SPREAD_DAYS = 95;

export function SecBalanceSheetCard({ view }: { view: SecEarningsView }) {
  const b = view.balance;
  if (!b) return null;
  const spread = view.balanceSheetSpreadDays;
  const apart = spread !== null && Math.abs(spread) > BALANCE_SHEET_SPREAD_DAYS;
  return (
    <section className="card">
      <div className="eyebrow">Balance sheet</div>
      <h3>Financial position as at {b.asOf}</h3>
      {/* THREE PERIODS, ONE LEDE. The page's opening line says "latest reported
          quarter" while the income statement, the cash-flow statement and this
          balance sheet can each be a different period — every one correctly
          labelled, which is not the same as clear. Said only when the dates are
          genuinely far apart; on a normal 10-Q filer they coincide and a
          standing disclaimer would be noise. */}
      {apart ? (
        <p style={{ marginTop: 8, marginBottom: 0 }}>
          This is a <strong>different date</strong> from the income statement above, which covers{" "}
          {view.latestLabel} ending {view.latestEnd}. A balance sheet is a position on one day and a
          filer&apos;s most recent one is not always the end of its most recent reported period —
          these are {Math.abs(spread!)} days apart.
        </p>
      ) : null}
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
/**
 * READ IN, WITH DATA, AND NO QUARTERS — the second permanent-pending case.
 *
 * `buildSecEarningsView` returns null when the stored set has no quarterly
 * periods, and the page's fallback for a null view was SecPendingCard. So a
 * filer whose set is populated and passes every usability bar still got
 * "financials are being fetched — check back shortly", forever, because the
 * cron would re-read it daily and find the same absence of quarters.
 *
 * It is the same defect the no-xbrl card was created to fix, in the branch
 * nobody looked at: the review found the score card's version of it on RYAAY
 * and this one sits one condition further along. KGC is the measured example —
 * 5 years and 8 instants stored, 24 populated fields in its best period, zero
 * quarters — and it is a whole class, not one filer: an annual-only foreign
 * private issuer files 20-F and nothing quarterly.
 */
export function SecNoQuartersCard({
  symbol,
  years,
  instants,
}: {
  symbol: string;
  years: number;
  instants: number;
}) {
  return (
    <section className="card">
      <div className="eyebrow">Annual filer</div>
      <h2>{symbol} does not file quarterly results</h2>
      <p>
        This page is built around the most recent reported <strong>quarter</strong>, and{" "}
        {symbol} files annually — {years === 1 ? "one annual period" : `${years} annual periods`}
        {instants ? ` and ${instants} balance-sheet dates` : ""} are on file, with no quarterly
        period among them. Its figures have been read from {SEC_ATTRIBUTION}; there is simply no
        quarter to show.
      </p>
      <p style={{ marginBottom: 0 }}>
        Its annual filings are available on{" "}
        <a href="https://www.sec.gov/edgar/search/" style={{ color: "#93c5fd", fontWeight: 800 }}>
          SEC EDGAR
        </a>
        .
      </p>
    </section>
  );
}

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

