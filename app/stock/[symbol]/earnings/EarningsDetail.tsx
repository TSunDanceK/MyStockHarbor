// app/stock/[symbol]/earnings/EarningsDetail.tsx
// Presentational earnings-page extras (no hooks, server-rendered):
//  - IncomeStatementCard: full P&L breakdown for the latest reported quarter.
//  - AnnualConsensusCard: forward full-year analyst consensus (renders null if
//    the FMP key returns no annual estimates).
// Formatting is self-contained so this file has no dependency on page.tsx.

export type IncomeDetail = {
  periodEnd?: string | null;
  periodLabel?: string | null;
  revenue: number | null;
  costOfRevenue: number | null;
  grossProfit: number | null;
  researchAndDevelopment: number | null;
  sga: number | null;
  operatingIncome: number | null;
  ebitda: number | null;
  interestExpense: number | null;
  incomeBeforeTax: number | null;
  incomeTaxExpense: number | null;
  netIncome: number | null;
  epsDiluted: number | null;
  weightedAverageShsDil: number | null;
};

export type AnnualConsensus = {
  date?: string | null;
  revenueAvg: number | null;
  revenueLow: number | null;
  revenueHigh: number | null;
  epsAvg: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  numAnalystsRevenue: number | null;
  numAnalystsEps: number | null;
  ttmRevenue?: number | null;
  ttmEps?: number | null;
};

function money(value: number | null | undefined, compact = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (compact) {
    if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(2)}`;
  }
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shares(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  return value.toLocaleString("en-US");
}

function pct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function ofRevenue(part: number | null, revenue: number | null): string | null {
  if (part == null || revenue == null || revenue === 0) return null;
  return `${((part / Math.abs(revenue)) * 100).toFixed(1)}% of revenue`;
}

function fyLabel(date?: string | null): string {
  if (!date) return "the coming year";
  const year = String(date).slice(0, 4);
  return `FY ${year}`;
}

function PLRow(props: { label: string; value: string; sub?: string | null; strong?: boolean; muted?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        padding: "9px 0",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: props.muted ? "rgba(148,163,184,0.75)" : "rgba(226,232,240,0.82)",
          fontWeight: props.strong ? 900 : 600,
        }}
      >
        {props.label}
      </span>
      <span style={{ textAlign: "right", minWidth: 0 }}>
        <span style={{ fontSize: 14.5, fontWeight: props.strong ? 950 : 800, color: "#f1f5f9" }}>{props.value}</span>
        {props.sub ? (
          <span style={{ display: "block", fontSize: 11, color: "rgba(148,163,184,0.7)", marginTop: 2 }}>{props.sub}</span>
        ) : null}
      </span>
    </div>
  );
}

export function IncomeStatementCard({ income }: { income: IncomeDetail | null }) {
  if (!income || income.revenue == null) return null;
  const taxRate =
    income.incomeTaxExpense != null && income.incomeBeforeTax != null && income.incomeBeforeTax !== 0
      ? (income.incomeTaxExpense / income.incomeBeforeTax) * 100
      : null;

  return (
    <section className="card">
      <div className="eyebrow">Income statement</div>
      <h2>Full profit &amp; loss — latest quarter</h2>
      <p>
        The full income-statement waterfall for the most recent reported quarter
        {income.periodEnd ? <> (period ending <strong>{income.periodEnd}</strong>)</> : null}. This is the detail behind
        the headline EPS and revenue above.
      </p>
      <div style={{ marginTop: 14 }}>
        <PLRow label="Revenue" value={money(income.revenue, true)} strong />
        <PLRow label="Cost of revenue" value={money(income.costOfRevenue == null ? null : -Math.abs(income.costOfRevenue), true)} muted />
        <PLRow label="Gross profit" value={money(income.grossProfit, true)} sub={ofRevenue(income.grossProfit, income.revenue)} strong />
        <PLRow label="Research & development" value={money(income.researchAndDevelopment == null ? null : -Math.abs(income.researchAndDevelopment), true)} muted />
        <PLRow label="Selling, general & admin" value={money(income.sga == null ? null : -Math.abs(income.sga), true)} muted />
        <PLRow label="Operating income (EBIT)" value={money(income.operatingIncome, true)} sub={ofRevenue(income.operatingIncome, income.revenue)} strong />
        <PLRow label="EBITDA" value={money(income.ebitda, true)} sub={ofRevenue(income.ebitda, income.revenue)} />
        <PLRow label="Interest expense" value={money(income.interestExpense == null ? null : -Math.abs(income.interestExpense), true)} muted />
        <PLRow label="Pre-tax income" value={money(income.incomeBeforeTax, true)} />
        <PLRow label="Income tax" value={money(income.incomeTaxExpense == null ? null : -Math.abs(income.incomeTaxExpense), true)} sub={taxRate != null ? `${taxRate.toFixed(1)}% effective rate` : null} muted />
        <PLRow label="Net income" value={money(income.netIncome, true)} sub={ofRevenue(income.netIncome, income.revenue)} strong />
        <PLRow label="Diluted EPS" value={income.epsDiluted != null ? `$${income.epsDiluted.toFixed(2)}` : "—"} strong />
        <PLRow label="Diluted shares" value={shares(income.weightedAverageShsDil)} muted />
      </div>
      <p className="earningsDataNote">
        Figures are as-reported (GAAP) income-statement values from FMP and may differ from the adjusted/non-GAAP numbers
        companies highlight in earnings headlines. New to these lines? See{" "}
        <a href="/learn/income-statement" style={{ color: "#93c5fd", fontWeight: 800 }}>
          The Income Statement
        </a>
        .
      </p>
    </section>
  );
}

export function AnnualConsensusCard({ estimate }: { estimate: AnnualConsensus | null }) {
  if (!estimate || (estimate.revenueAvg == null && estimate.epsAvg == null)) return null;

  const revGrowth =
    estimate.revenueAvg != null && estimate.ttmRevenue != null && estimate.ttmRevenue !== 0
      ? (estimate.revenueAvg / Math.abs(estimate.ttmRevenue) - 1) * 100
      : null;
  const epsGrowth =
    estimate.epsAvg != null && estimate.ttmEps != null && estimate.ttmEps !== 0
      ? (estimate.epsAvg / Math.abs(estimate.ttmEps) - 1) * 100
      : null;

  return (
    <section className="card">
      <div className="eyebrow">Forward consensus</div>
      <h2>Full-year analyst estimates — {fyLabel(estimate.date)}</h2>
      <p>Where covering analysts expect the full year to land. Ranges show the spread between the most and least optimistic.</p>
      <div className="estimateGrid">
        <div className="metricCard" style={{ border: "1px solid rgba(59,130,246,0.22)", borderRadius: 18, padding: 16, background: "rgba(59,130,246,0.06)" }}>
          <div className="metricLabel">Consensus revenue</div>
          <div className="metricValue">{money(estimate.revenueAvg, true)}</div>
          <div className="metricSub">
            Range {money(estimate.revenueLow, true)} – {money(estimate.revenueHigh, true)}
            {estimate.numAnalystsRevenue ? ` · ${estimate.numAnalystsRevenue} analysts` : ""}
            {revGrowth != null ? ` · ${pct(revGrowth)} vs last 12 mo` : ""}
          </div>
        </div>
        <div className="metricCard" style={{ border: "1px solid rgba(34,197,94,0.22)", borderRadius: 18, padding: 16, background: "rgba(34,197,94,0.06)" }}>
          <div className="metricLabel">Consensus EPS</div>
          <div className="metricValue">{estimate.epsAvg != null ? `$${estimate.epsAvg.toFixed(2)}` : "—"}</div>
          <div className="metricSub">
            Range {estimate.epsLow != null ? `$${estimate.epsLow.toFixed(2)}` : "—"} – {estimate.epsHigh != null ? `$${estimate.epsHigh.toFixed(2)}` : "—"}
            {estimate.numAnalystsEps ? ` · ${estimate.numAnalystsEps} analysts` : ""}
            {epsGrowth != null ? ` · ${pct(epsGrowth)} vs last 12 mo` : ""}
          </div>
        </div>
      </div>
      <p className="earningsDataNote">Full-year consensus from FMP&apos;s covering-analyst estimates; it shifts as analysts revise through the year.</p>
    </section>
  );
}
