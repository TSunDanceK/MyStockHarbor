"use client";

// /upcoming-ipos ON THE SEC PATH: EACH LISTING OPENS INTO A SHORT PROFILE
// (#553 COWORK #159 PR 1).
//
// EVERY ROW IS A <details>, SERVER-RENDERED WITH ITS BODY. The profile is in
// the HTML the crawler gets, closed; nothing is fetched on a click. Only the
// filter row is client state (All / Operating companies / SPACs), and a
// filtered-out row is hidden, never removed from the markup.
//
// Every fact is from SEC EDGAR (the filer's submissions JSON, its registration
// filings and the filing-fee exhibit), via lib/server/ipoProfiles.ts in the
// daily job. A block shows only when its data exists; nothing is estimated.
import { useState } from "react";
import TickerLogo from "@/app/components/TickerLogo";
import type { ConfirmedIpo } from "@/lib/server/ipoCalendar";
import {
  SPAC_NOTE,
  companyFilingsUrl,
  filingUrl,
  fiscalYearEndLabel,
  formatDealUsd,
  industryHqLine,
  ipoKind,
  ipoTimeline,
  latestRegistration,
  REG_AMENDMENT,
  type IpoKind,
  type IpoProfile,
} from "@/lib/ipoProfileView";

export type IpoProfileRow = { ipo: ConfirmedIpo; profile: IpoProfile | null };

type Filter = "all" | "operating" | "spac";

const SYMBOL_FALLBACK = "—";

function formatDate(dateStr: string | null) {
  if (!dateStr) return null;
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function formatPriceRange(low: number | null, high: number | null): string | null {
  if (low === null && high === null) return null;
  if (low !== null && high !== null && low !== high) return `$${low.toFixed(2)} – $${high.toFixed(2)}`;
  const single = low ?? high;
  return single !== null ? `$${single.toFixed(2)}` : null;
}

const KIND_LABEL: Record<IpoKind, string> = { company: "COMPANY", spac: "SPAC", foreign: "FOREIGN" };

function kindOf(row: IpoProfileRow): IpoKind {
  return ipoKind(row.profile?.sic ?? null, row.ipo.company, row.profile?.filings ?? []);
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="ipoFact">
      <span className="ipoFactLabel">{label}</span>
      <span className="ipoFactValue">{value}</span>
    </div>
  );
}

export default function IpoProfileList({
  rows,
  table,
  dateLabel,
  emptyMessage,
}: {
  rows: IpoProfileRow[];
  table: "upcoming" | "recent";
  /** "Terms set" (upcoming) or the listing date's label (recent). */
  dateLabel: string;
  emptyMessage: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  if (!rows.length) {
    return <div style={{ padding: 32, textAlign: "center", opacity: 0.75, fontSize: "var(--fs-read)" }}>{emptyMessage}</div>;
  }
  const spacs = rows.filter((r) => kindOf(r) === "spac").length;
  const counts: Record<Filter, number> = { all: rows.length, operating: rows.length - spacs, spac: spacs };
  const shows = (r: IpoProfileRow) => filter === "all" || (filter === "spac") === (kindOf(r) === "spac");

  return (
    <div className="ipoP">
      <div className="ipoFilters" role="group" aria-label="Show">
        {(["all", "operating", "spac"] as Filter[]).map((f) => (
          <button key={f} type="button" className={f === filter ? "ipoFilter on" : "ipoFilter"} aria-pressed={f === filter} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "operating" ? "Operating companies" : "SPACs"} · {counts[f]}
          </button>
        ))}
      </div>

      {rows.map((row) => {
        const { ipo, profile } = row;
        const kind = kindOf(row);
        const price = formatPriceRange(ipo.priceRangeLow, ipo.priceRangeHigh);
        const line = industryHqLine(profile);
        const filings = profile?.filings ?? [];
        const reg = latestRegistration(filings);
        const amendments = filings.filter((f) => REG_AMENDMENT.test(f.form)).length;
        const firstFiled = filings.find((f) => /^(S-1|F-1)$/.test(f.form)) ?? null;
        const steps = ipoTimeline(filings, table === "upcoming" ? ipo.date : null);
        const maxDeal = formatDealUsd(profile?.maxDealSize ?? null);
        return (
          <details key={`${ipo.cik}-${ipo.date}`} className="ipoItem" data-kind={kind} hidden={!shows(row)}>
            <summary className="ipoSum">
              <span className="ipoLogo" aria-hidden="true">
                <TickerLogo symbol={ipo.symbol} name={ipo.company} size={34} radius={9} alt="" />
              </span>
              <span className="ipoWho">
                <span className="ipoName">
                  {ipo.company} · <span className="ipoSym">{ipo.symbol ?? SYMBOL_FALLBACK}</span>
                </span>
                <span className="ipoBadges">
                  <span className={`ipoBadge ${kind}`}>{KIND_LABEL[kind]}</span>
                  <span className="ipoBadge status">{table === "upcoming" ? "TERMS SET" : "LISTED"}</span>
                </span>
                {line ? <span className="ipoLine">{line}</span> : null}
              </span>
              <span className="ipoRight">
                <span className="ipoPrice">{price ?? "—"}</span>
                <span className="ipoExch">{ipo.exchange ?? ""}</span>
                <span className="ipoDate">{dateLabel} {formatDate(ipo.date)}</span>
              </span>
            </summary>

            <div className="ipoBody">
              <section className="ipoBlock">
                <h3 className="ipoBlockTitle">The deal</h3>
                <div className="ipoFacts">
                  <Fact label={kind === "spac" ? "Unit price" : "Price range"} value={price} />
                  <Fact label={kind === "spac" ? "Units offered" : "Shares offered"} value={ipo.sharesOffered !== null ? ipo.sharesOffered.toLocaleString("en-US") : null} />
                  <Fact label="Deal size at the midpoint" value={formatDealUsd(ipo.dealSize)} />
                  <Fact
                    label="Maximum deal size"
                    value={maxDeal ? `${maxDeal} (fee exhibit, ${profile?.maxDealSizeFrom?.form ?? "filing"} of ${formatDate(profile?.maxDealSizeFrom?.date ?? null) ?? "—"})` : null}
                  />
                  <Fact label="Exchange · ticker" value={ipo.exchange || ipo.symbol ? `${ipo.exchange ?? "—"} · ${ipo.symbol ?? SYMBOL_FALLBACK}` : null} />
                  <Fact label="First filed" value={firstFiled ? `${formatDate(firstFiled.date)} (${firstFiled.form})` : null} />
                </div>
              </section>

              {profile ? (
                <section className="ipoBlock">
                  <h3 className="ipoBlockTitle">The company</h3>
                  <div className="ipoFacts">
                    <Fact label="Industry" value={profile.sicDescription ? `${profile.sicDescription}${profile.sic ? ` (SIC ${profile.sic})` : ""}` : null} />
                    <Fact label="Headquarters" value={[profile.city, profile.region].filter(Boolean).join(", ") || null} />
                    <Fact label="Incorporated in" value={profile.incorporatedIn} />
                    <Fact label="Fiscal year ends" value={fiscalYearEndLabel(profile.fiscalYearEnd)} />
                    <Fact label="Filer status" value={profile.emergingGrowth ? "Emerging growth company" : null} />
                    <Fact label="Amendments filed" value={amendments ? String(amendments) : null} />
                  </div>
                </section>
              ) : null}

              {kind === "spac" ? <p className="ipoSpacNote">{SPAC_NOTE}</p> : null}

              {filings.length ? (
                <section className="ipoBlock">
                  <h3 className="ipoBlockTitle">Where the filing stands</h3>
                  <ol className="ipoTimeline">
                    {steps.map((s) => (
                      <li key={s.key} className={s.done ? "done" : "next"}>
                        <span className="ipoStepLabel">{s.label}</span>
                        {s.date ? <span className="ipoStepDate">{formatDate(s.date)}</span> : null}
                        {s.detail ? <span className="ipoStepDetail">{s.detail}</span> : null}
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              <section className="ipoBlock">
                <h3 className="ipoBlockTitle">Read the filings</h3>
                <p className="ipoLinks">
                  {reg ? (
                    <a href={filingUrl(ipo.cik, reg)} target="_blank" rel="noopener noreferrer">
                      Latest registration filing ({reg.form}, {formatDate(reg.date)}) on EDGAR
                    </a>
                  ) : null}
                  <a href={companyFilingsUrl(ipo.cik)} target="_blank" rel="noopener noreferrer">
                    All of the company&apos;s filings on EDGAR
                  </a>
                </p>
              </section>
            </div>
          </details>
        );
      })}

      <style>{`
        .ipoP { padding: 12px; display: grid; gap: 8px; }
        .ipoFilters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
        .ipoFilter { min-height: 36px; padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.03); color: rgba(226,232,240,0.85); font: inherit; font-size: var(--fs-label); font-weight: 750; cursor: pointer; }
        .ipoFilter.on { background: rgba(56,189,248,0.16); color: #e0f2fe; border-color: rgba(56,189,248,0.45); }
        .ipoFilter:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
        .ipoItem { border: 1px solid rgba(255,255,255,0.09); border-radius: 14px; background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02)); min-width: 0; }
        .ipoItem[open] { border-color: rgba(96,165,250,0.4); }
        .ipoItem[hidden] { display: none; }
        .ipoSum { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 12px; cursor: pointer; list-style: none; }
        .ipoSum::-webkit-details-marker { display: none; }
        .ipoSum:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; border-radius: 14px; }
        .ipoWho { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .ipoName { font-size: var(--fs-read); font-weight: 850; color: #f1f5f9; overflow-wrap: anywhere; }
        .ipoSym { color: #93c5fd; }
        .ipoBadges { display: flex; flex-wrap: wrap; gap: 6px; }
        .ipoBadge { font-size: var(--fs-label); font-weight: 850; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 6px; border: 1px solid rgba(148,163,184,0.35); color: rgba(226,232,240,0.9); }
        .ipoBadge.spac { border-color: rgba(251,191,36,0.5); color: #fde68a; }
        .ipoBadge.foreign { border-color: rgba(167,139,250,0.5); color: #ddd6fe; }
        .ipoBadge.status { border-color: rgba(56,189,248,0.4); color: #bae6fd; }
        .ipoLine { font-size: var(--fs-label); color: rgba(148,163,184,0.95); overflow-wrap: anywhere; }
        .ipoRight { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-align: right; }
        .ipoPrice { font-size: var(--fs-read); font-weight: 900; color: #f1f5f9; white-space: nowrap; }
        .ipoExch, .ipoDate { font-size: var(--fs-label); color: rgba(148,163,184,0.9); white-space: nowrap; }
        .ipoBody { border-top: 1px solid rgba(255,255,255,0.08); padding: 4px 14px 14px; display: grid; gap: 12px; }
        .ipoBlockTitle { margin: 10px 0 6px; font-size: var(--fs-label); font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(191,219,254,0.85); }
        .ipoFacts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 16px; }
        .ipoFact { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .ipoFactLabel { font-size: var(--fs-label); font-weight: 750; color: rgba(148,163,184,0.85); }
        .ipoFactValue { font-size: var(--fs-read); font-weight: 750; color: rgba(241,245,249,0.95); overflow-wrap: anywhere; }
        .ipoSpacNote { margin: 0; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(251,191,36,0.35); background: rgba(251,191,36,0.06); font-size: var(--fs-read); line-height: var(--lh-read); color: rgba(254,243,199,0.95); }
        .ipoTimeline { list-style: none; margin: 0; padding: 0 0 0 14px; border-left: 2px solid rgba(148,163,184,0.25); display: grid; gap: 8px; }
        .ipoTimeline li { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: var(--fs-read); position: relative; }
        .ipoTimeline li::before { content: ""; position: absolute; left: -20px; top: 6px; width: 10px; height: 10px; border-radius: 999px; background: #38bdf8; }
        .ipoTimeline li.next { color: rgba(148,163,184,0.6); }
        .ipoTimeline li.next::before { background: rgba(148,163,184,0.35); }
        .ipoStepLabel { font-weight: 800; }
        .ipoStepDate, .ipoStepDetail { color: rgba(148,163,184,0.95); }
        .ipoLinks { margin: 0; display: flex; flex-direction: column; gap: 6px; font-size: var(--fs-read); }
        .ipoLinks a { color: #7dd3fc; overflow-wrap: anywhere; }
        @media (max-width: 720px) {
          .ipoFacts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .ipoSum { grid-template-columns: auto minmax(0, 1fr); }
          .ipoRight { grid-column: 2; align-items: flex-start; text-align: left; flex-direction: row; flex-wrap: wrap; gap: 4px 10px; }
        }
      `}</style>
    </div>
  );
}
