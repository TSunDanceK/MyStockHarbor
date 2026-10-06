"use client";

import { useState } from "react";
import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";
import type { HubCompany } from "@/lib/bottleneckHub";

// THE BOTTLENECK LEADERBOARD (#125 COWORK).
//
// One row per company, keyed and counted by lib/bottleneckHub.ts: by ticker
// when there is one, otherwise by normalised name, and counted once per stock
// page that names it. Each row is a <details>: closed, it shows the logo, the
// name, "named on N stock pages", a split bar (named on the supplier chart vs
// the key-customer chart) and ×N; open, it shows a chip for every stock page
// that names the company. <details> needs no script, and its chips are in the
// server-rendered HTML whether the row is open or not.
//
// The top ten render first. "See full leaderboard" adds every other company
// named on two or more pages; the long tail named on a single page is counted
// in one line rather than listed, since a ×1 row says nothing about shared
// dependency. This used to be a scroll window, which a phone handles badly
// (a scrolling box inside a scrolling page), so rows are capped instead.
//
// Every size is rem or a reading-size token; no transforms.

const TOP = 10;

type Row = Pick<HubCompany, "key" | "name" | "ticker" | "count" | "supplierPages" | "customerPages" | "pages">;

const SUPPLIER = "#5FD4C7";
const CUSTOMER = "#f0abfc";

function LeaderRow({ c, rank, max }: { c: Row; rank: number; max: number }) {
  const width = max > 0 ? Math.max(8, Math.round((c.count / max) * 100)) : 0;
  const both = c.supplierPages + c.customerPages;
  const sPct = both ? (c.supplierPages / both) * 100 : 0;
  return (
    <details className="bnLbRow">
      <summary className="bnLbSummary">
        <span className="bnLbRank" aria-hidden="true">{rank}</span>
        <TickerLogo symbol={c.ticker} name={c.name} size={30} radius={8} alt="" />
        <span className="bnLbMain">
          <span className="bnLbTop">
            <span className="bnLbName">
              {c.name}
              {c.ticker && c.ticker !== c.name ? <span style={{ color: "#5FD4C7" }}> ({c.ticker})</span> : null}
            </span>
            <span className="bnLbCount">×{c.count}</span>
          </span>
          <span className="bnLbSub">named on {c.count} stock page{c.count === 1 ? "" : "s"}</span>
          <span className="bnLbBar" style={{ width: `${width}%` }} title={`Supplier on ${c.supplierPages}, key customer on ${c.customerPages}`}>
            <span style={{ width: `${sPct}%`, background: SUPPLIER }} />
            <span style={{ width: `${100 - sPct}%`, background: CUSTOMER }} />
          </span>
          <span className="bnLbLegend">
            <span style={{ color: SUPPLIER }}>supplier {c.supplierPages}</span>
            <span style={{ color: CUSTOMER }}>customer {c.customerPages}</span>
          </span>
        </span>
      </summary>
      <div className="bnLbOpen">
        <div className="bnLbOpenLabel">Named on these stock pages</div>
        <ul className="bnLbChips">
          {c.pages.map((p) => (
            <li key={p.slug}>
              <Link href={`/bottlenecks/${p.slug}`} prefetch={false} className="bnLbChip" title={p.companyName}>
                {p.symbol}
              </Link>
            </li>
          ))}
        </ul>
        {c.ticker ? (
          <Link href={`/stock/${encodeURIComponent(c.ticker)}`} prefetch={false} className="bnLbStock">
            {c.ticker} stock page &rsaquo;
          </Link>
        ) : null}
      </div>
    </details>
  );
}

export default function BottleneckLeaderboard({ rows, singles }: { rows: Row[]; singles: number }) {
  const [full, setFull] = useState(false);
  const visible = full ? rows : rows.slice(0, TOP);
  const max = rows.length ? rows[0].count : 0;

  return (
    <section
      style={{
        background: "#0b1220",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        padding: 20,
        boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: 6, fontSize: "1.125rem", fontWeight: 850 }}>Bottleneck Leaderboard</h2>
      <p style={{ marginTop: 0, marginBottom: 12, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(241,245,249,0.75)" }}>
        How many stock pages name each company, as a supplier or as a key customer. Open a row to see which ones.
      </p>
      <div className="bnLbKey">
        <span><span className="bnLbSwatch" style={{ background: SUPPLIER }} />supplier chart</span>
        <span><span className="bnLbSwatch" style={{ background: CUSTOMER }} />customer chart</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: "var(--fs-read)", opacity: 0.6 }}>No data yet.</div>
      ) : (
        <div className="bnLbList">
          {visible.map((c, i) => (
            <LeaderRow key={c.key} c={c} rank={i + 1} max={max} />
          ))}
        </div>
      )}

      {!full && rows.length > TOP ? (
        <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
          <button type="button" className="bnLbMore" onClick={() => setFull(true)}>
            See full leaderboard
          </button>
        </div>
      ) : null}
      {full && singles > 0 ? (
        <p data-fine-print style={{ margin: "12px 0 0", fontSize: "var(--fs-fine)", color: "rgba(241,245,249,0.6)" }}>
          Another {singles} companies are each named on one stock page.
        </p>
      ) : null}

      <details className="bnLbWhy">
        <summary>Why it matters</summary>
        <p>
          A company that keeps showing up here isn&apos;t just important to one stock - it&apos;s a shared dependency across many of them. If a name high on this list runs into trouble - an outage, a shortage, a regulatory action, a bad quarter - the disruption can ripple across every business that relies on it, not just the one you started on. The higher the count, the more concentrated - and systemic - that risk becomes.
        </p>
      </details>

      <style>{`
        /* minmax(0, 1fr): a long name must ellipse inside the column, not
           size it past the edge of a phone. */
        .bnLbList { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
        .bnLbRow { min-width: 0; border-radius: 12px; border: 1px solid rgba(255,255,255,0.07); background: rgba(255,255,255,0.025); }
        .bnLbRow[open] { border-color: rgba(95,212,199,0.3); }
        .bnLbSummary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 10px 12px; min-width: 0; }
        .bnLbSummary::-webkit-details-marker { display: none; }
        .bnLbRank { flex-shrink: 0; min-width: 1.5em; font-size: var(--fs-label); color: rgba(241,245,249,0.45); font-variant-numeric: tabular-nums; }
        .bnLbMain { flex: 1; min-width: 0; display: grid; gap: 3px; }
        .bnLbTop { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
        .bnLbName { min-width: 0; font-size: var(--fs-read); font-weight: 700; color: #f1f5f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bnLbCount { flex-shrink: 0; font-size: var(--fs-read); font-weight: 850; color: #5FD4C7; }
        .bnLbSub { font-size: var(--fs-label); color: rgba(241,245,249,0.62); }
        .bnLbBar { display: flex; height: 6px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,0.08); }
        .bnLbBar > span { display: block; height: 100%; }
        .bnLbLegend { display: flex; gap: 12px; font-size: var(--fs-label); font-weight: 700; }
        .bnLbKey { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; font-size: var(--fs-label); color: rgba(241,245,249,0.7); }
        .bnLbSwatch { display: inline-block; width: 0.75em; height: 0.75em; border-radius: 3px; margin-right: 6px; vertical-align: -0.05em; }
        .bnLbOpen { padding: 0 12px 12px; }
        .bnLbOpenLabel { font-size: var(--fs-label); font-weight: 800; color: rgba(241,245,249,0.7); margin-bottom: 8px; }
        .bnLbChips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
        .bnLbChip { display: inline-block; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(147,197,253,0.35); background: rgba(147,197,253,0.10); color: #bfdbfe; font-size: var(--fs-label); font-weight: 800; text-decoration: none; }
        .bnLbChip:hover { background: rgba(147,197,253,0.2); }
        .bnLbStock { display: inline-block; margin-top: 10px; font-size: var(--fs-label); font-weight: 800; color: #93c5fd; text-decoration: none; }
        .bnLbMore { cursor: pointer; border-radius: 999px; border: 1px solid rgba(95,212,199,0.35); background: rgba(95,212,199,0.12); color: #a7f3ec; padding: 9px 18px; font-size: var(--fs-label); font-weight: 800; font-family: inherit; }
        .bnLbWhy { margin-top: 18px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.10); }
        .bnLbWhy summary { cursor: pointer; font-size: var(--fs-label); font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; color: rgba(241,245,249,0.7); }
        .bnLbWhy p { margin: 8px 0 0; font-size: var(--fs-read); line-height: var(--lh-read); color: rgba(241,245,249,0.8); }
      `}</style>
    </section>
  );
}
