import {
  RECEIVER_GROUPS,
  changeFraction,
  type ReceiverEntry,
  type ReceiverFlag,
  type ReceiverReading,
} from "@/lib/server/capexReceivers";

// "WHO IS RECEIVING" (#563 COWORK #2 presentation rules):
// - the bar is the % change on the prior fiscal year, because it compares
//   across companies and currencies; the filed amount and currency are text;
// - rows sit under our own plain group headings, with NO group totals;
// - a broad line carries a tag saying it includes non-data-centre sales;
// - each row says which fiscal year it covers ("FY to Jan 2026").
// Nothing here adds one company's line to another's.

type Row = ReceiverEntry & { reading: ReceiverReading; flags: ReceiverFlag[] };

// Bars are drawn on a 0–100% scale. A larger change is drawn full-width with an
// "off scale" notch, and its real figure is always printed beside the bar, so
// IREN's +686% does not flatten every other row to a sliver.
const SCALE_CAP = 1;

const BAR = "#60a5fa";
const BAR_DOWN = "#94a3b8";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fyTo(fyEnd: string): string {
  // A 52/53-week year can end in the first days of a month; name the month the
  // year actually covers (2026-01-03 is "FY to Dec 2025").
  const d = new Date(`${fyEnd}T00:00:00Z`);
  if (d.getUTCDate() <= 7) d.setUTCDate(0);
  return `FY to ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function money(value: number, currency: string): string {
  const sym = currency === "USD" ? "US$" : currency === "EUR" ? "€" : `${currency} `;
  const abs = Math.abs(value);
  const text = abs >= 1e9 ? `${(abs / 1e9).toFixed(abs >= 1e11 ? 0 : 1)}bn` : `${Math.round(abs / 1e6)}m`;
  return `${value < 0 ? "−" : ""}${sym}${text}`;
}

function pct(f: number): string {
  const p = f * 100;
  return `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(Math.abs(p) >= 10 ? 0 : 1)}%`;
}

function filingHref(cik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/`;
}

function ReceiverRow({ row }: { row: Row }) {
  const change = changeFraction(row.reading);
  const width = change === null ? 0 : Math.min(Math.abs(change), SCALE_CAP) / SCALE_CAP;
  const offScale = change !== null && Math.abs(change) > SCALE_CAP;
  const amount = money(row.reading.value, row.reading.currency);
  const prior = row.reading.prior === null ? null : money(row.reading.prior, row.reading.currency);
  const tip = `${row.ticker} — ${row.label}: ${amount}${prior ? ` vs ${prior} the year before` : ""} (${fyTo(row.reading.fyEnd)})`;
  return (
    <li className="capexRow" title={tip}>
      <div className="capexRowName">
        <span style={{ fontWeight: 800 }}>{row.ticker}</span>{" "}
        <span>{row.label}</span>
        {row.subLabel ? (
          <span className="capexSub" title={`Source: ${row.subLabel.source}`}>
            {" "}— {row.subLabel.text}
          </span>
        ) : null}
        {row.broad ? <span className="capexTag">Broad line: includes non-data-centre sales</span> : null}
        {row.flags.includes("element-missing") || row.flags.includes("label-changed") ? (
          <span className="capexTag">Latest filing changed this line; showing the last matching filing</span>
        ) : null}
      </div>
      <div className="capexBarCell">
        <div className="capexTrack" aria-hidden="true">
          {change !== null ? (
            <div
              style={{
                width: `${Math.max(width * 100, 1.5)}%`,
                background: change >= 0 ? BAR : BAR_DOWN,
                height: "100%",
                borderRadius: "0 4px 4px 0",
              }}
            />
          ) : null}
          {offScale ? <span className="capexOff">›</span> : null}
        </div>
        <span className="capexPct">{change === null ? "New line" : pct(change)}</span>
      </div>
      <div className="capexMeta">
        {amount} · {fyTo(row.reading.fyEnd)} ·{" "}
        <a href={filingHref(row.cik, row.reading.accession)} rel="nofollow noopener" target="_blank">
          {row.reading.form}
        </a>
      </div>
    </li>
  );
}

export default function ReceiversPanel({ rows }: { rows: Row[] }) {
  return (
    <section className="capexCard" aria-labelledby="capex-receiving">
      <h2 id="capex-receiving" className="capexH2">
        Who is receiving
      </h2>
      <p className="capexLead">
        One line of revenue from each company, named in the company&apos;s own words, and how much it grew
        on the year before. Each company is shown on its own: the lines are not added together.
      </p>
      {RECEIVER_GROUPS.map((group) => {
        const inGroup = rows.filter((r) => r.group === group);
        if (!inGroup.length) return null;
        return (
          <div key={group} className="capexGroup">
            <h3 className="capexH3">{group}</h3>
            {group === "Cloud & data centres" ? (
              <p className="capexNote">
                These companies are also among the largest spenders above; this is what they sell, not what
                they buy.
              </p>
            ) : null}
            <ul className="capexList">
              {inGroup.map((row) => (
                <ReceiverRow key={`${row.ticker}|${row.element}`} row={row} />
              ))}
            </ul>
          </div>
        );
      })}
      <p className="capexSources">
        Bars show the change in each line&apos;s revenue on the company&apos;s previous fiscal year, from 0% to
        +100%; a notch (›) marks a larger change, and the figure beside the bar is exact. Fiscal years end in
        different months. Source: each company&apos;s latest annual report (Form 10-K, 20-F or 40-F) filed with
        the SEC, read from its XBRL data. Group headings are ours; line names are the companies&apos; own.
      </p>
    </section>
  );
}
