import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";
import type { HubTheme } from "@/lib/bottleneckHub";

// "Choke points by theme" on /bottlenecks (#125 COWORK), plus the hub's link
// card to the capex page. Server-rendered from buildThemes(): the themes are
// an editorial map in lib/bottleneckHub.ts (THEME_MAP, company key → theme),
// and each card counts the distinct mapped stock pages that name at least one
// company in it. The three logos are the theme's most-named companies.

export const CAPEX_TITLE = "Follow the money: AI and data-centre capex";

export default function BottleneckThemes({ themes }: { themes: HubTheme[] }) {
  return (
    <section className="bnThemes" style={{ marginBottom: 24 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: "1.25rem", fontWeight: 850 }}>Choke points by theme</h2>
      <div className="bnThemeGrid">
        {themes.map((t) => (
          <div key={t.id} className="bnThemeCard">
            <h3 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 850, color: "#f1f5f9" }}>{t.title}</h3>
            <p style={{ margin: "6px 0 0", fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(241,245,249,0.78)" }}>{t.line}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, minWidth: 0 }}>
              {t.top.map((c) => (
                <span key={c.key} title={c.name} style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <TickerLogo symbol={c.ticker} name={c.name} size={28} radius={7} alt={c.name} />
                </span>
              ))}
              <span className="bnThemeNames" style={{ minWidth: 0, fontSize: "var(--fs-label)", color: "rgba(241,245,249,0.65)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t.top.map((c) => c.ticker ?? c.name).join(" · ")}
              </span>
            </div>
            <p style={{ margin: "10px 0 0", fontSize: "var(--fs-read)", color: "#5FD4C7", fontWeight: 700 }}>
              {t.pageCount} mapped stocks name a company here
            </p>
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
        .bnThemeGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        .bnThemeCard { min-width: 0; padding: 16px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.10); background: #0b1220; }
        .bnCapexCard { display: block; margin-top: 12px; padding: 16px 18px; border-radius: 14px; border: 1px solid rgba(252,211,77,0.3); background: rgba(252,211,77,0.06); text-decoration: none; }
        .bnCapexCard:hover { border-color: rgba(252,211,77,0.55); }
        @media (max-width: 1100px) { .bnThemeGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 560px) { .bnThemeGrid { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </section>
  );
}
