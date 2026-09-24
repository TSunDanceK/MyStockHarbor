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

export type ContractView = { ticker: string; amount: string; barPct: number; entities: string; entityCount: number };

export function buildContractRows(rows: Array<{ ticker: string; amount: number; entities: Array<{ name: string }> }>, show: number): ContractView[] {
  const top = rows.slice(0, show);
  const max = Math.max(0, ...top.map((r) => r.amount));
  return top.map((r) => ({
    ticker: r.ticker,
    amount: formatAmount(r.amount, "USD"),
    barPct: max > 0 ? (Math.max(0, r.amount) / max) * 100 : 0,
    entities: r.entities[0]?.name ?? "",
    entityCount: r.entities.length,
  }));
}
