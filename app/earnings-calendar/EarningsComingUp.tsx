// "COMING UP" AS A WEEK GRID (#552 COWORK #179, owner pick): four columns,
// the rest of this week and the next three, each a date WINDOW, never a day.
// Server-rendered, so it is in the HTML and indexable; "+ N more" is a native
// <details>, so it works without JS.
//
// WHAT WENT, 2026-10-06 (COWORK #179): the long line under the title, the
// "~15 Oct" on every chip, and each chip's evidence note (habit, period, last
// filing). The words survive in expectedCopy.ts; the method now sits behind
// one "How we estimate" tap. The data source is unchanged.
//
// "DUE TO REPORT" names (period ended, usual filing day arrived, nothing filed)
// lead the "This week" column under their own heading. An UNREADABLE record is
// not "empty": it keeps its one sentence, so a failed read never looks like a
// quiet market (dueStripState's whole point).
import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";
import { EXPECTED_NONE, EXPECTED_UNAVAILABLE } from "@/lib/server/expectedCopy";
import { DUE_STRIP_UNAVAILABLE, type DueStripState } from "@/lib/server/dueStripState";
import type { ExpectedSectionState } from "@/lib/server/expectedToReport";
import { addDays, byCapThenSymbol, comingUpColumns } from "@/lib/server/earningsWeek";

export const COMING_UP_TITLE = "Coming up";
export const ESTIMATED_TAG = "Estimated";
export const HOW_WE_ESTIMATE =
  "These dates are estimated from each company's usual SEC reporting pattern, so the exact day may differ.";
export const DUE_GROUP_HEADING = "Period ended, not filed yet";
export const EMPTY_COLUMN = "None estimated.";
/** Rows a column shows before "+ N more". */
export const VISIBLE_PER_COLUMN = 8;

/** Per symbol: the name and the market cap (for the sort only), as the page read them. */
export type ComingUpFacts = Record<string, { company: string; cap: number | null }>;
type Row = { symbol: string; company: string; cap: number | null; due: boolean };

function RowItem({ r }: { r: Row }) {
  return (
    <li className="cuRow" data-row={r.symbol} data-due={r.due ? "" : undefined}>
      <Link href={`/stock/${encodeURIComponent(r.symbol)}/earnings`} prefetch={false} className="cuRowLink">
        <TickerLogo symbol={r.symbol} name={r.company} size={20} radius={6} alt="" />
        <span className="cuSym">{r.symbol}</span>
        <span className="cuName">{r.company}</span>
      </Link>
    </li>
  );
}

/** The column's rows, the due ones first under their heading; the first VISIBLE_PER_COLUMN shown. */
function ColumnRows({ due, rows }: { due: Row[]; rows: Row[] }) {
  const all = [...due, ...rows];
  const shown = all.slice(0, VISIBLE_PER_COLUMN), more = all.slice(VISIBLE_PER_COLUMN);
  const list = (items: Row[], first: boolean) => {
    const d = items.filter((r) => r.due), e = items.filter((r) => !r.due);
    return (
      <>
        {d.length ? <>{first ? <p className="cuSub" data-group="due">{DUE_GROUP_HEADING}</p> : null}<ul className="cuList">{d.map((r) => <RowItem key={r.symbol} r={r} />)}</ul></> : null}
        {e.length ? <ul className={`cuList${d.length ? " cuAfterDue" : ""}`}>{e.map((r) => <RowItem key={r.symbol} r={r} />)}</ul> : null}
      </>
    );
  };
  return (
    <>
      {list(shown, true)}
      {more.length ? (
        <details className="cuMore">
          <summary><span className="cuMoreOpen">+ {more.length} more</span><span className="cuMoreClose">Show fewer</span></summary>
          {list(more, false)}
        </details>
      ) : null}
    </>
  );
}

export default function EarningsComingUp({ expected, due, today, facts = {} }: {
  expected: ExpectedSectionState; due: DueStripState; today: string; facts?: ComingUpFacts;
}) {
  const fact = (s: string) => facts[s] ?? { company: "", cap: null };
  const rows = expected.kind === "listed"
    ? expected.rows.map((r) => ({ symbol: r.symbol, estimatedOn: addDays(today, r.daysAway), ...fact(r.symbol), due: false }))
    : [];
  const dueRows: Row[] = (due.kind === "listed" ? due.entries : [])
    .map((e) => ({ symbol: e.symbol, ...fact(e.symbol), due: true }))
    .filter((r) => !rows.some((x) => x.symbol === r.symbol))
    .sort(byCapThenSymbol);
  const columns = comingUpColumns(rows, today);
  const showGrid = rows.length > 0 || dueRows.length > 0;
  return (
    <section className="cuCard" aria-labelledby="cuHeading">
      <div className="cuHead">
        <h2 id="cuHeading" className="cuHeading">{COMING_UP_TITLE}</h2>
        <span className="cuTag" data-estimated-tag="">{ESTIMATED_TAG}</span>
        <details className="cuHow">
          <summary><span aria-hidden="true">ⓘ</span> How we estimate</summary>
          <p>{HOW_WE_ESTIMATE}</p>
        </details>
      </div>

      {due.kind === "unavailable" ? (
        // A FAILED READ IS NOT A QUIET MARKET.
        <p className="cuLine" data-due-unavailable="">{DUE_STRIP_UNAVAILABLE}</p>
      ) : null}
      {expected.kind !== "listed" ? (
        <p className="cuLine">{expected.kind === "none" ? EXPECTED_NONE : EXPECTED_UNAVAILABLE}</p>
      ) : null}

      {showGrid ? (
        <div className="cuGrid">
          {columns.map((c) => {
            const colDue = c.isThisWeek ? dueRows : [];
            const n = c.items.length + colDue.length;
            return (
              <div key={c.key} className={`cuCol${c.isThisWeek ? " cuThisWeek" : ""}`} data-col={c.key} aria-labelledby={`cu-${c.key}`}>
                <div className="cuColHead">
                  <h3 id={`cu-${c.key}`} className="cuColLabel">{c.label}</h3>
                  <div className="cuColMeta"><span className="cuRange">{c.range}</span> · <span data-count={n}>{n} {n === 1 ? "company" : "companies"}</span></div>
                </div>
                {n ? <ColumnRows due={colDue} rows={c.items.map((r) => ({ symbol: r.symbol, company: r.company, cap: r.cap, due: false }))} />
                  : <p className="cuEmpty">{EMPTY_COLUMN}</p>}
              </div>
            );
          })}
        </div>
      ) : null}

      <style>{`
        .cuCard { margin: 0 0 24px; padding: 20px; border-radius: 16px; border: 1px dashed rgba(148,163,184,0.30); background: rgba(148,163,184,0.04); }
        .cuHead { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0 0 14px; }
        .cuHeading { margin: 0; font-size: 1.125rem; font-weight: 900; color: #e2e8f0; }
        .cuTag { padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(251,191,36,0.45); background: rgba(251,191,36,0.12); color: #fcd34d; font-size: var(--fs-fine); font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
        .cuHow { margin-left: auto; }
        .cuHow[open] { flex-basis: 100%; margin-left: 0; }
        .cuHow > summary { cursor: pointer; list-style: none; font-size: var(--fs-label); font-weight: 800; color: #93c5fd; }
        .cuHow > summary::-webkit-details-marker { display: none; }
        .cuHow p { margin: 6px 0 0; font-size: var(--fs-read); line-height: var(--lh-read); color: #cbd5e1; }
        .cuLine { margin: 0 0 14px; font-size: var(--fs-read); line-height: var(--lh-read); color: #cbd5e1; }
        .cuGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        .cuCol { min-width: 0; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.02); }
        .cuThisWeek { border-color: rgba(147,197,253,0.55); }
        .cuColHead { margin: 0 0 8px; }
        .cuColLabel { margin: 0; font-size: var(--fs-read); font-weight: 900; color: #f8fafc; }
        .cuThisWeek .cuColLabel::before { content: ""; display: inline-block; width: 7px; height: 7px; margin: 0 6px 1px 0; border-radius: 50%; background: #93c5fd; vertical-align: middle; }
        .cuColMeta { font-size: var(--fs-label); color: #94a3b8; font-weight: 700; }
        .cuSub { margin: 0 0 4px; font-size: var(--fs-label); font-weight: 800; color: #cbd5e1; }
        .cuList { list-style: none; margin: 0; padding: 0; display: grid; }
        .cuAfterDue { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.08); }
        .cuRow { min-width: 0; }
        .cuRowLink { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 5px 0; color: inherit; text-decoration: none; font-size: var(--fs-read); }
        .cuRowLink:hover .cuSym { text-decoration: underline; }
        .cuRowLink:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; border-radius: 6px; }
        .cuSym { flex: none; font-weight: 900; color: #f8fafc; }
        .cuName { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cbd5e1; }
        .cuMore > summary { cursor: pointer; list-style: none; margin-top: 4px; font-size: var(--fs-label); font-weight: 800; color: #93c5fd; }
        .cuMore > summary::-webkit-details-marker { display: none; }
        .cuMore > summary:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; border-radius: 6px; }
        .cuMoreClose, .cuMore[open] .cuMoreOpen { display: none; }
        .cuMore[open] .cuMoreClose { display: inline; }
        .cuMore[open] > summary { order: 2; }
        .cuMore[open] { display: flex; flex-direction: column; }
        .cuEmpty { margin: 4px 0 0; font-size: var(--fs-read); line-height: var(--lh-read); color: #94a3b8; }
        @media (max-width: 900px) { .cuGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 560px) { .cuGrid { grid-template-columns: minmax(0, 1fr); } .cuCard { padding: 14px; } }
      `}</style>
    </section>
  );
}
