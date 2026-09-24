// What the capex page shows, decided in one pure place (Relay C, #563 COWORK
// #2 presentation rules). Import-free, so the check loads it in bare Node.
//
// THE RULES, each asserted by scripts/check-capex-page.mjs:
//   * the bar is the % CHANGE (current vs prior fiscal year) -- it compares
//     across companies and currencies; the filed amount is secondary text;
//   * amounts in the FILED currency (ASML in EUR), never converted;
//   * rows grouped under our plain headings, and NO group totals -- nothing is
//     ever summed across companies;
//   * "FY to <month year>" per row, because fiscal years end differently;
//   * a "Broad line" tag on every line that is not data-centre specific;
//   * a line with no positive prior year is "New line", not a bar.

export type PresentEntry = {
  id: string;
  ticker: string;
  group: string;
  filedLabel: string;
  subLabel: { text: string } | null;
  broad: boolean;
  hyperscaler: boolean;
};

export type PresentFigure = {
  fyEnd: string;
  currency: string;
  current: number;
  prior: number | null;
  changePct: number | null;
  subLabelOk: boolean;
  staleSince: string | null;
  form: string;
};

export type ReceiverView = {
  id: string;
  ticker: string;
  label: string;
  subLabel: string | null;
  broad: boolean;
  fyTo: string;
  amount: string;
  priorAmount: string | null;
  changePct: number | null;
  changeText: string;
  /** 0..100: the bar's share of the panel's scale. */
  barPct: number;
  /** The bar was cut at the scale's cap; the text carries the real value. */
  capped: boolean;
  stale: boolean;
  form: string;
};

export type ReceiverGroupView = { id: string; heading: string; hyperscalerNote: boolean; rows: ReceiverView[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "FY to Jan 2026". A 52/53-week year ending in the first days of a month
 *  belongs to the month before ("2026-07-03" -> "Jun 2026"). */
export function fyToLabel(fyEnd: string): string {
  const [y, m, d] = fyEnd.split("-").map(Number);
  let month = m - 1;
  let year = y;
  if (d <= 7) {
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
  }
  return `FY to ${MONTHS[month]} ${year}`;
}

/** "$193.7bn" / "EUR 10.4bn" / "$480m". The filed currency, never converted. */
export function formatAmount(value: number, currency: string): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const prefix = currency === "USD" ? "$" : `${currency} `;
  if (abs >= 1e9) return `${sign}${prefix}${(abs / 1e9).toFixed(abs >= 1e11 ? 0 : 1)}bn`;
  return `${sign}${prefix}${Math.round(abs / 1e6)}m`;
}

export function changeText(pct: number | null): string {
  if (pct === null) return "New line";
  const r = Math.round(pct);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}%`;
}

/** Bars share one scale, capped so one +600% line does not flatten the rest. */
export const BAR_CAP_PCT = 150;

export function buildReceiverGroups(
  groups: Array<{ id: string; heading: string }>,
  entries: PresentEntry[],
  figures: Record<string, PresentFigure | undefined>
): ReceiverGroupView[] {
  const out: ReceiverGroupView[] = [];
  for (const g of groups) {
    const rows: ReceiverView[] = [];
    for (const e of entries) {
      if (e.group !== g.id) continue;
      const f = figures[e.id];
      if (!f) continue;
      const pct = f.changePct;
      const capped = pct !== null && Math.abs(pct) > BAR_CAP_PCT;
      rows.push({
        id: e.id,
        ticker: e.ticker,
        label: e.filedLabel,
        subLabel: e.subLabel && f.subLabelOk ? e.subLabel.text : null,
        broad: e.broad,
        fyTo: fyToLabel(f.fyEnd),
        amount: formatAmount(f.current, f.currency),
        priorAmount: f.prior === null ? null : formatAmount(f.prior, f.currency),
        changePct: pct,
        changeText: changeText(pct),
        barPct: pct === null ? 0 : (Math.min(Math.abs(pct), BAR_CAP_PCT) / BAR_CAP_PCT) * 100,
        capped,
        stale: Boolean(f.staleSince),
        form: f.form,
      });
    }
    // Largest change first; new lines last (they have no change to rank).
    rows.sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
    if (rows.length) out.push({ id: g.id, heading: g.heading, hyperscalerNote: entries.some((e) => e.group === g.id && e.hyperscaler), rows });
  }
  return out;
}

export type ContractView = {
  ticker: string;
  /** Our directory name for the company ("General Dynamics"); the ticker when there is none. */
  company: string;
  amount: string;
  barPct: number;
  /** The USAspending recipient names, largest first, in normal case, each once. */
  entities: string[];
  /** Recipient records behind them: USAspending often repeats one name under several registrations. */
  records: number;
};

// Words USAspending writes in capitals that ARE capitals, and a few names whose
// own capitalisation is mixed. Everything else is put in normal case: the page
// shows no all-caps names (#563 COWORK #4).
const KEEP_UPPER = new Set(["LLC", "USG", "OTS", "CACI", "KBR", "HII", "QTC", "CGI", "FCA", "US", "USA", "V2X", "BAE", "IBM", "SAIC", "GE", "RTX", "AWS", "DXC", "AECOM", "BWXT", "NASA", "IT", "II", "III"]);
const MIXED: Record<string, string> = { L3HARRIS: "L3Harris", OPTUMRX: "OptumRx", OPTUMSERVE: "OptumServe", AMERISOURCEBERGEN: "AmerisourceBergen" };
const LEGAL: Record<string, string> = { INC: "Inc.", CORP: "Corp.", CO: "Co.", LTD: "Ltd", LP: "L.P.", PLC: "plc" };
const SMALL = new Set(["AND", "OF", "THE", "FOR", "DE"]);

/** "ELECTRIC BOAT CORPORATION" -> "Electric Boat Corporation"; a name already in mixed case is left alone. */
export function entityCase(raw: string): string {
  const name = String(raw ?? "").trim();
  if (/[a-z]/.test(name)) return name;
  return name
    .split(/\s+/)
    .map((word, i) =>
      word.replace(/[A-Z0-9&]+(?:\.[A-Z](?![A-Z]))*\.?/g, (tok) => {
        const bare = tok.replace(/\./g, "");
        if (MIXED[bare]) return MIXED[bare];
        if (LEGAL[bare]) return LEGAL[bare];
        if (KEEP_UPPER.has(bare) || tok.includes("&")) return tok;
        if (i > 0 && SMALL.has(bare)) return tok.toLowerCase();
        return tok.charAt(0) + tok.slice(1).toLowerCase();
      })
    )
    .join(" ");
}

export function buildContractRows(
  rows: Array<{ ticker: string; amount: number; entities: Array<{ name: string }> }>,
  show: number,
  companyName: (ticker: string) => string = () => ""
): ContractView[] {
  const top = rows.slice(0, show);
  const max = Math.max(0, ...top.map((r) => r.amount));
  return top.map((r) => ({
    ticker: r.ticker,
    company: companyName(r.ticker) || r.ticker,
    amount: formatAmount(r.amount, "USD"),
    barPct: max > 0 ? (Math.max(0, r.amount) / max) * 100 : 0,
    entities: [...new Set(r.entities.map((e) => entityCase(e.name)))],
    records: r.entities.length,
  }));
}

// ── "Who is spending" (Layer 1, #563 COWORK #1 D1) ─────────────────────────
// One row per sector. The long bar is the latest calendar year on ONE scale
// shared by every sector (the largest sector is full width); the five small
// bars are that sector's own five years on its own scale, so they show shape,
// not size. Capex ÷ revenue is shown as text for the first and latest year.

export type SpendingSectorInput = {
  sector: string;
  cohort: number;
  capex: number[];
  ratioCohort: number;
  capexToRevenue: (number | null)[];
  top: string[];
};

export type SpendingView = {
  sector: string;
  cohort: number;
  latest: string;
  /** 0..100 on the scale shared by all sectors. */
  barPct: number;
  /** 0..100 per year, on this sector's own scale. */
  spark: number[];
  sparkTitles: string[];
  changeText: string;
  ratioFirst: string | null;
  ratioLatest: string | null;
  ratioCohort: number;
  top: string[];
};

const pctText = (x: number | null) => (x === null ? null : `${(x * 100).toFixed(1)}%`);

export function buildSpendingRows(sectors: SpendingSectorInput[], years: number[]): SpendingView[] {
  const last = years.length - 1;
  const max = Math.max(0, ...sectors.map((s) => s.capex[last] ?? 0));
  return sectors.map((s) => {
    const own = Math.max(0, ...s.capex);
    const first = s.capex[0];
    const latest = s.capex[last];
    return {
      sector: s.sector,
      cohort: s.cohort,
      latest: formatAmount(latest, "USD"),
      barPct: max > 0 ? (Math.max(0, latest) / max) * 100 : 0,
      spark: s.capex.map((v) => (own > 0 ? (Math.max(0, v) / own) * 100 : 0)),
      sparkTitles: s.capex.map((v, i) => `${years[i]}: ${formatAmount(v, "USD")}`),
      changeText: first > 0 ? changeText(((latest - first) / first) * 100) : "New line",
      ratioFirst: pctText(s.capexToRevenue[0] ?? null),
      ratioLatest: pctText(s.capexToRevenue[last] ?? null),
      ratioCohort: s.ratioCohort,
      top: s.top,
    };
  });
}
