import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";
import type { HubTheme } from "@/lib/bottleneckHub";

// "Choke points by theme" on /bottlenecks (#125 COWORK), plus the hub's link
// card to the capex page. Server-rendered from buildThemes(): the themes are
// an editorial map in lib/bottleneckHub.ts (THEME_MAP, company key → theme;
// THEME_PAGES, a mapped page's own ticker → theme, #563 COWORK #180), and each
// card counts the distinct mapped stock pages that name at least one company in
// it or are in it. The three logos are the theme's most-named companies (on a
// ticker-keyed theme, the listed partners its pages name).

export const CAPEX_TITLE = "Follow the money: AI and data-centre capex";

export default function BottleneckThemes({ themes }: { themes: HubTheme[] }) {
  return (
    <section className="bnThemes" style={{ marginBottom: 24 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: "1.25rem", fontWeight: 850 }}>Choke points by theme</h2>
      {/* COMPACT (#563 COWORK #166 h): no card outline, tighter spacing, and the
          logos, tickers and "N mapped" on one line; about half the old height. */}
      <div className="bnThemeGrid">
        {themes.map((t) => (
          <div key={t.id} className="bnThemeCard" data-theme={t.id}>
            <h3 className="bnThemeTitle">{t.title}</h3>
            <p className="bnThemeLine" title={t.line}>{t.line}</p>
            <div className="bnThemeFoot">
              <div className="bnThemeLogos" aria-hidden="true">
                {t.top.map((c) => <TickerLogo key={c.key} symbol={c.ticker} name={c.name} size={20} radius={5} alt="" />)}
              </div>
              <span className="bnThemeNames" title={t.top.map((c) => c.name).join(", ")}>{t.top.map((c) => c.ticker ?? c.name).join(" · ")}</span>
              <span className="bnThemeCount" data-fine-print="" title={t.countNote}>{t.pageCount} mapped stocks</span>
            </div>
          </div>
        ))}
      </div>

      <Link href="/bottlenecks/capex" prefetch={false} className="bnCapexCard">
        <span style={{ display: "block", fontSize: "var(--fs-label)", fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#fcd34d" }}>
          Capex
        </span>
        <span style={{ display: "block", marginTop: 4, fontSize: "1.125rem", fontWeight: 850, color: "#f1f5f9" }}>{CAPEX_TITLE}</span>
        <span style={{ display: "block", marginTop: 4, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(241,245,249,0.78)" }}>
          Three views of the AI and data-centre build-out from filed and published figures: who is spending, who is receiving, and federal contracts. &rsaquo;
        </span>
      </Link>

      <style>{`
        .bnThemeGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 28px; border-top: 1px solid rgba(255,255,255,0.08); }
        .bnThemeCard { min-width: 0; padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .bnThemeTitle { margin: 0; font-size: 1rem; font-weight: 850; color: #f1f5f9; }
        .bnThemeLine { margin: 2px 0 0; font-size: var(--fs-read); line-height: 1.45; color: rgba(241,245,249,0.72); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bnThemeFoot { display: flex; align-items: center; gap: 6px 8px; margin-top: 6px; min-width: 0; flex-wrap: wrap; }
        .bnThemeLogos { display: inline-flex; gap: 3px; flex: 0 0 auto; }
        .bnThemeNames { min-width: 0; font-size: var(--fs-label); font-weight: 800; color: rgba(241,245,249,0.78); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bnThemeCount { flex: 0 0 auto; margin-left: auto; font-size: var(--fs-fine); font-weight: 700; color: #5FD4C7; white-space: nowrap; }
        .bnCapexCard { display: block; margin-top: 12px; padding: 16px 18px; border-radius: 14px; border: 1px solid rgba(252,211,77,0.3); background: rgba(252,211,77,0.06); text-decoration: none; }
        .bnCapexCard:hover { border-color: rgba(252,211,77,0.55); }
        @media (max-width: 1100px) { .bnThemeGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 560px) { .bnThemeGrid { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </section>
  );
}
