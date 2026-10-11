"use client";

// "COMPARE ALL 11 SECTORS" (#553 COWORK #157 item 4, #158: no earnings column).
// The rows are server-rendered in the default order (year to date, highest
// first), so the table is in the HTML for indexing; sorting by any column is
// client-side. A missing figure sorts last in both directions. On a phone the
// table scrolls sideways inside its own box with the sector column pinned; the
// page itself never scrolls sideways.
import { useMemo, useState } from "react";
import Link from "next/link";

export type CompareRow = {
  slug: string;
  name: string;
  href: string;
  day: number | null;
  month: number | null;
  ytd: number | null;
  breadthPct: number | null;
  breadthText: string | null;
  medianPe: number | null;
  tone: string | null;
  toneScore: number | null;
};

type Key = "name" | "day" | "month" | "ytd" | "breadthPct" | "medianPe" | "toneScore";

export const COMPARE_DEFAULT_SORT: { key: Key; dir: "asc" | "desc" } = { key: "ytd", dir: "desc" };

/** The order the table shows: a missing value sinks below every figure, both ways. */
export function sortCompareRows(rows: CompareRow[], key: Key, dir: "asc" | "desc"): CompareRow[] {
  const f = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "name") return f * a.name.localeCompare(b.name);
    const va = a[key];
    const vb = b[key];
    const ma = typeof va !== "number" || !Number.isFinite(va);
    const mb = typeof vb !== "number" || !Number.isFinite(vb);
    if (ma || mb) return ma === mb ? a.name.localeCompare(b.name) : ma ? 1 : -1;
    return f * ((va as number) - (vb as number)) || a.name.localeCompare(b.name);
  });
}

const pct = (v: number | null) => (typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(2)}%` : "—");
const colour = (v: number | null) => (typeof v !== "number" || !Number.isFinite(v) ? undefined : v > 0.05 ? "#86efac" : v < -0.05 ? "#fca5a5" : undefined);

export default function SectorCompareTable({ rows, dayLabel }: { rows: CompareRow[]; dayLabel: string }) {
  const [sort, setSort] = useState(COMPARE_DEFAULT_SORT);
  const shown = useMemo(() => sortCompareRows(rows, sort.key, sort.dir), [rows, sort]);
  const cols: { key: Key; label: string }[] = [
    { key: "name", label: "Sector" },
    { key: "day", label: dayLabel },
    { key: "month", label: "1M" },
    { key: "ytd", label: "YTD" },
    { key: "breadthPct", label: "Above 200-day" },
    { key: "medianPe", label: "Median P/E" },
    { key: "toneScore", label: "News tone" },
  ];
  const onSort = (key: Key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));

  return (
    <section className="cmp" aria-labelledby="cmp-title">
      <h2 id="cmp-title" className="cmpTitle">Compare all 11 sectors</h2>
      <div className="cmpWrap">
        <table className="cmpTable">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" className="cmpSort" onClick={() => onSort(c.key)}>
                    {c.label}
                    <span className="cmpArrow" aria-hidden="true">{sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.slug} data-slug={r.slug}>
                <th scope="row"><Link href={r.href}>{r.name}</Link></th>
                <td style={{ color: colour(r.day) }}>{pct(r.day)}</td>
                <td style={{ color: colour(r.month) }}>{pct(r.month)}</td>
                <td style={{ color: colour(r.ytd) }}>{pct(r.ytd)}</td>
                <td>{r.breadthText ?? "—"}</td>
                <td>{typeof r.medianPe === "number" ? `${r.medianPe.toFixed(1)}×` : "—"}</td>
                <td>{r.tone ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <style>{`
        .cmp { margin-top: 26px; }
        .cmpTitle { margin: 0 0 10px; font-size: 22px; font-weight: 900; letter-spacing: -0.03em; color: #f8fafc; }
        .cmpWrap { max-width: 100%; overflow-x: auto; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; }
        .cmpTable { width: 100%; min-width: 680px; border-collapse: separate; border-spacing: 0; font-size: var(--fs-label); font-variant-numeric: tabular-nums; }
        .cmpTable th, .cmpTable td { padding: 10px 12px; text-align: right; white-space: nowrap; border-bottom: 1px solid rgba(255,255,255,0.06); color: #e2e8f0; }
        .cmpTable thead th { background: #0b1220; color: rgba(226,232,240,0.78); font-weight: 800; }
        .cmpTable th:first-child { text-align: left; position: sticky; left: 0; z-index: 1; background: #0b1220; }
        .cmpTable tbody th { font-weight: 800; }
        .cmpTable tbody th a { color: #e0f2fe; text-decoration: none; }
        .cmpTable tbody th a:hover, .cmpTable tbody th a:focus-visible { text-decoration: underline; }
        .cmpSort { all: unset; cursor: pointer; display: inline-flex; gap: 4px; align-items: center; min-height: 28px; }
        .cmpSort:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; border-radius: 3px; }
        .cmpArrow { font-size: 0.75rem; color: #38bdf8; min-width: 8px; }
      `}</style>
    </section>
  );
}
