// app/stock/[symbol]/earnings/EarningsDetail.tsx
// Presentational earnings-page extras (no hooks, server-rendered). Formatting is
// self-contained so this file has no dependency on page.tsx.
//  - IncomeStatementCard  : full latest-quarter P&L (compact, for the sidebar).
//  - AnnualConsensusCard   : forward full-year analyst consensus.
//  - CashFlowCard          : quality of earnings + free cash flow (H-bar chart).
//  - SegmentationCard      : revenue by product and by region (H-bar charts).
//  - BalanceSheetCard      : cash vs debt + current ratio (H-bar chart).
// Each card renders null when its data is absent.

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

export type CashFlow = {
  periodEnd?: string | null;
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  netIncome: number | null;
  stockBasedCompensation: number | null;
};

export type BalanceHealth = {
  periodEnd?: string | null;
  cashAndStInvestments: number | null;
  totalDebt: number | null;
  netCash: number | null;
  currentRatio: number | null;
};

export type SegmentGroup = {
  fiscalYear: number | string | null;
  items: { name: string; value: number | null }[];
};

const SEGMENT_COLORS = ["#60a5fa", "#22c55e", "#facc15", "#a855f7", "#2dd4bf", "#f87171", "#fb923c", "#94a3b8"];

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

function shareOf(part: number | null, total: number | null): string | null {
  if (part == null || total == null || total === 0) return null;
  return `${((Math.abs(part) / Math.abs(total)) * 100).toFixed(0)}%`;
}

function fyLabel(date?: string | null): string {
  if (!date) return "the coming year";
  return `FY ${String(date).slice(0, 4)}`;
}

function cleanSegmentName(name: string): string {
  const trimmed = name.replace(/\s+segment$/i, "").trim();
  return trimmed
    .toLowerCase()
    .split(" ")
    .map((w) => (w === "and" ? "&" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// ---------------------------------------------------------------- horizontal bar chart
function HBarChart({ items, formatValue }: { items: { label: string; value: number | null; color: string; sub?: string | null }[]; formatValue: (v: number) => string }) {
  const maxAbs = Math.max(...items.map((i) => Math.abs(i.value ?? 0)), 1);
  return (
    <div style={{ marginTop: 12, display: "grid", gap: 11 }}>
      {items.map((it) => {
        const w = it.value == null ? 0 : Math.max(2, (Math.abs(it.value) / maxAbs) * 100);
        return (
          <div key={it.label} style={{ display: "grid", gridTemplateColumns: "minmax(96px, 132px) 1fr auto", gap: 10, alignItems: "center" }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.25, color: "rgba(226,232,240,0.82)", fontWeight: 600 }}>{it.label}</div>
            <div style={{ height: 16, borderRadius: 8, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${w}%`, background: it.color, borderRadius: 8, opacity: it.value == null ? 0.25 : 1 }} />
            </div>
            <div style={{ textAlign: "right", minWidth: 66 }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: "#f1f5f9" }}>{it.value == null ? "—" : formatValue(it.value)}</span>
              {it.sub ? <span style={{ marginLeft: 6, fontSize: 11, color: "rgba(148,163,184,0.72)", fontWeight: 700 }}>{it.sub}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- P&L (sidebar)
function PLRow(props: { label: string; value: string; sub?: string | null; strong?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <span style={{ fontSize: 12.5, color: props.muted ? "rgba(148,163,184,0.75)" : "rgba(226,232,240,0.82)", fontWeight: props.strong ? 900 : 600 }}>{props.label}</span>
      <span style={{ textAlign: "right", minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: props.strong ? 950 : 800, color: "#f1f5f9" }}>{props.value}</span>
        {props.sub ? <span style={{ display: "block", fontSize: 10.5, color: "rgba(148,163,184,0.7)", marginTop: 1 }}>{props.sub}</span> : null}
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
      <h3>Full profit &amp; loss — latest quarter</h3>
      <p style={{ fontSize: 13.5 }}>
        The full income-statement waterfall behind the headline EPS and revenue
        {income.periodEnd ? <> (period ending <strong>{income.periodEnd}</strong>)</> : null}.
      </p>
      <div style={{ marginTop: 12 }}>
        <PLRow label="Revenue" value={money(income.revenue, true)} strong />
        <PLRow label="Cost of revenue" value={money(income.costOfRevenue == null ? null : -Math.abs(income.costOfRevenue), true)} muted />
        <PLRow label="Gross profit" value={money(income.grossProfit, true)} sub={ofRevenue(income.grossProfit, income.revenue)} strong />
        <PLRow label="Research & development" value={money(income.researchAndDevelopment == null ? null : -Math.abs(income.researchAndDevelopment), true)} muted />
        <PLRow label="Selling, general & admin" value={money(income.sga == null ? null : -Math.abs(income.sga), true)} muted />
        <PLRow label="Operating income (EBIT)" value={money(income.operatingIncome, true)} sub={ofRevenue(income.operatingIncome, income.revenue)} strong />
        <PLRow label="EBITDA" value={money(income.ebitda, true)} sub={ofRevenue(income.ebitda, income.revenue)} />
        <PLRow label="Interest expense" value={money(income.interestExpense == null ? null : -Math.abs(income.interestExpense), true)} muted />
        <PLRow label="Pre-tax income" value={money(income.incomeBeforeTax, true)} />
        <PLRow label="Income tax" value={money(income.incomeTaxExpense == null ? null : -Math.abs(income.incomeTaxExpense), true)} sub={taxRate != null ? `${taxRate.toFixed(1)}% effective` : null} muted />
        <PLRow label="Net income" value={money(income.netIncome, true)} sub={ofRevenue(income.netIncome, income.revenue)} strong />
        <PLRow label="Diluted EPS" value={income.epsDiluted != null ? `$${income.epsDiluted.toFixed(2)}` : "—"} strong />
        <PLRow label="Diluted shares" value={shares(income.weightedAverageShsDil)} muted />
      </div>
      <p className="earningsDataNote">
        As-reported (GAAP) values from FMP; may differ from the adjusted figures in earnings headlines. See{" "}
        <a href="/learn/income-statement" style={{ color: "#93c5fd", fontWeight: 800 }}>The Income Statement</a>.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- forward consensus
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

// ---------------------------------------------------------------- cash flow / quality of earnings
export function CashFlowCard({ cashflow }: { cashflow: CashFlow | null }) {
  if (!cashflow || cashflow.operatingCashFlow == null) return null;
  const cashConversion =
    cashflow.operatingCashFlow != null && cashflow.netIncome != null && cashflow.netIncome > 0
      ? cashflow.operatingCashFlow / cashflow.netIncome
      : null;
  const items = [
    { label: "Operating cash flow", value: cashflow.operatingCashFlow, color: "#22c55e" },
    { label: "Free cash flow", value: cashflow.freeCashFlow, color: "#34d399" },
    { label: "Net income (GAAP)", value: cashflow.netIncome, color: "#60a5fa" },
    { label: "Capital expenditure", value: cashflow.capex, color: "#f87171" },
    { label: "Stock-based comp", value: cashflow.stockBasedCompensation, color: "#facc15" },
  ];
  return (
    <section className="card">
      <div className="eyebrow">Quality of earnings</div>
      <h2>Does the profit turn into cash?</h2>
      <p>Reported profit is an accounting figure; cash flow is harder to massage. Free cash flow (operating cash flow minus capital spending) is the cash the business actually generates.</p>
      {cashConversion != null ? (
        <p><strong>Operating cash flow was {cashConversion.toFixed(1)}× net income</strong> this quarter — {cashConversion >= 1 ? "profit is converting into real cash." : "profit is running ahead of cash, worth watching."}</p>
      ) : null}
      <div className="chartBlock">
        <div className="chartBlockTitle">Latest quarter cash generation{cashflow.periodEnd ? ` (period ending ${cashflow.periodEnd})` : ""}</div>
        <HBarChart items={items} formatValue={(v) => money(v, true)} />
      </div>
      <p className="earningsDataNote">From the cash-flow statement (FMP). Capex is shown as a cash outflow. See <a href="/learn/balance-sheet-and-cash-flow" style={{ color: "#93c5fd", fontWeight: 800 }}>The Balance Sheet &amp; Cash Flow</a>.</p>
    </section>
  );
}

// ---------------------------------------------------------------- revenue segmentation
function SegmentBlock({ title, group }: { title: string; group: SegmentGroup }) {
  if (!group.items.length) return null;
  const total = group.items.reduce((sum, s) => sum + (s.value ?? 0), 0);
  const items = group.items.slice(0, 8).map((s, i) => ({
    label: cleanSegmentName(s.name),
    value: s.value,
    color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
    sub: shareOf(s.value, total),
  }));
  return (
    <div className="chartBlock">
      <div className="chartBlockTitle">{title}</div>
      <HBarChart items={items} formatValue={(v) => money(v, true)} />
    </div>
  );
}

export function SegmentationCard({ product, geographic }: { product: SegmentGroup | null; geographic: SegmentGroup | null }) {
  const hasProduct = product && product.items.length > 0;
  const hasGeo = geographic && geographic.items.length > 0;
  if (!hasProduct && !hasGeo) return null;
  const fy = (hasProduct ? product?.fiscalYear : geographic?.fiscalYear) ?? null;
  return (
    <section className="card">
      <div className="eyebrow">Revenue breakdown</div>
      <h2>Where the revenue comes from</h2>
      <p>The latest full-year revenue{fy ? <> (FY{fy})</> : null} split by product line and by region — useful for seeing which parts of the business are actually driving the top line.</p>
      {hasProduct ? <SegmentBlock title="By product / segment" group={product as SegmentGroup} /> : null}
      {hasGeo ? <SegmentBlock title="By region" group={geographic as SegmentGroup} /> : null}
      <p className="earningsDataNote">Annual segment revenue from FMP; percentages are share of the reported total for that year.</p>
    </section>
  );
}

// ---------------------------------------------------------------- balance sheet health
export function BalanceSheetCard({ balance }: { balance: BalanceHealth | null }) {
  if (!balance || (balance.cashAndStInvestments == null && balance.totalDebt == null)) return null;
  const items = [
    { label: "Cash & investments", value: balance.cashAndStInvestments, color: "#22c55e" },
    { label: "Total debt", value: balance.totalDebt == null ? null : -Math.abs(balance.totalDebt), color: "#f87171" },
    { label: balance.netCash != null && balance.netCash < 0 ? "Net debt" : "Net cash", value: balance.netCash, color: (balance.netCash ?? 0) >= 0 ? "#34d399" : "#f87171" },
  ];
  const cr = balance.currentRatio;
  return (
    <section className="card">
      <div className="eyebrow">Balance sheet</div>
      <h2>How solid is the balance sheet?</h2>
      <p>Cash versus debt shows the financial cushion; the current ratio shows whether short-term resources cover what&apos;s due within a year.</p>
      <div className="chartBlock">
        <div className="chartBlockTitle">Cash vs debt{balance.periodEnd ? ` (as of ${balance.periodEnd})` : ""}</div>
        <HBarChart items={items} formatValue={(v) => money(v, true)} />
      </div>
      {cr != null ? (
        <p><strong>Current ratio {cr.toFixed(2)}</strong> — {cr >= 1.5 ? "comfortable short-term liquidity." : cr >= 1 ? "adequate, but not a big cushion." : "below 1, a potential short-term squeeze."}</p>
      ) : null}
      <p className="earningsDataNote">From the latest balance sheet (FMP). Net cash = cash &amp; short-term investments minus total debt.</p>
    </section>
  );
}
