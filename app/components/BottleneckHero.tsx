import type { BottleneckHub } from "@/lib/bottleneckHub";
import BottleneckWeb from "@/app/components/BottleneckWeb";
import BottleneckHubSearch from "@/app/components/BottleneckHubSearch";

// The top of /bottlenecks (#125 COWORK): the h1, three stat tiles, the search
// and the dependency web, all server-rendered from getBottleneckHub(). It
// carries no data-bntab, like the intro card it replaced: it holds the h1, so
// it stays on screen whichever mobile tab is showing.
//
// At 560px and under the web is hidden (CSS only, so it is still in the HTML)
// and the top ten companies show as a compact list instead.

export const HERO_TITLE = "Which companies the market can't easily do without";
export const SOURCE_NOTE =
  "Dependencies come from public filings and research. The shares on each stock page are editorial estimates, not audited figures. This is not financial advice.";

const tile: React.CSSProperties = {
  minWidth: 0,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
};
const tileValue: React.CSSProperties = { fontSize: "1.25rem", fontWeight: 900, lineHeight: 1.2, color: "#f1f5f9", overflowWrap: "anywhere" };
const tileLabel: React.CSSProperties = { marginTop: 4, fontSize: "var(--fs-label)", color: "rgba(241,245,249,0.65)", fontWeight: 700 };

export default function BottleneckHero({ hub, items }: { hub: BottleneckHub; items: { slug: string; symbol: string; companyName: string }[] }) {
  const { stats, web, companies } = hub;
  const most = stats.mostShared;

  return (
    <section
      className="bnHero"
      style={{
        background: "#0b1220",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        padding: 24,
        boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
        marginBottom: 24,
      }}
    >
      <div className="bnHeroGrid">
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: "var(--fs-label)",
                fontWeight: 900,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#5FD4C7",
                marginBottom: 10,
              }}
            >
              Stock Bottlenecks
            </span>
            <span className="bnHeroTitle" style={{ display: "block", fontSize: "2rem", lineHeight: 1.15, fontWeight: 900 }}>
              {HERO_TITLE}
            </span>
          </h1>

          <p style={{ margin: "14px 0 0", fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(241,245,249,0.88)" }}>
            Each stock page maps the suppliers a company leans on and the customers that make up a large share of its sales. These are the companies those pages name most often.
          </p>

          <div className="bnStatTiles" style={{ marginTop: 18 }}>
            <div style={tile}>
              <div style={tileValue}>{stats.stocksMapped}</div>
              <div style={tileLabel}>stocks mapped</div>
            </div>
            <div style={tile}>
              {/* "about" (#563 COWORK #126): a few single-page generic names remain in the count. */}
              <div style={tileValue}><span style={{ fontSize: "var(--fs-label)", fontWeight: 700 }}>about </span>{stats.companiesNamed}</div>
              <div style={tileLabel}>companies named</div>
            </div>
            <div className="bnTileWide" style={tile}>
              <div style={tileValue}>
                {most ? (
                  <>
                    {most.ticker ?? most.name} <span style={{ color: "#5FD4C7" }}>×{most.count}</span>
                  </>
                ) : (
                  "—"
                )}
              </div>
              <div style={tileLabel}>most shared</div>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <BottleneckHubSearch items={items} />
          </div>

          <p data-fine-print style={{ margin: "14px 0 0", fontSize: "var(--fs-fine)", lineHeight: 1.5, color: "rgba(241,245,249,0.6)" }}>
            {SOURCE_NOTE}
          </p>
        </div>

        <div className="bnWebBlock" style={{ minWidth: 0 }}>
          <BottleneckWeb web={web} />
        </div>

        <div className="bnTopList" style={{ minWidth: 0 }}>
          <div style={{ fontSize: "var(--fs-label)", fontWeight: 800, color: "rgba(241,245,249,0.7)", marginBottom: 8 }}>Most-shared companies</div>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {companies.slice(0, 10).map((c, i) => (
              <li key={c.key} style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, fontSize: "var(--fs-read)" }}>
                <span style={{ color: "rgba(241,245,249,0.45)", fontVariantNumeric: "tabular-nums", flexShrink: 0, minWidth: "1.25em" }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 700 }}>
                  {c.name}
                  {c.ticker && c.ticker !== c.name ? <span style={{ color: "#5FD4C7" }}> ({c.ticker})</span> : null}
                </span>
                <span style={{ flexShrink: 0, color: "#5FD4C7", fontWeight: 800 }}>×{c.count}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <style>{`
        .bnHeroGrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 28px; align-items: center; }
        .bnStatTiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        .bnTopList { display: none; }
        @media (max-width: 900px) {
          .bnHeroGrid { grid-template-columns: minmax(0, 1fr); }
          .bnWebBlock { max-width: 560px; width: 100%; margin: 0 auto; }
        }
        @media (max-width: 640px) {
          .bnHero { padding: 18px !important; }
          .bnHeroTitle { font-size: 1.625rem !important; }
        }
        /* Phones: the web is not legible this narrow, so it goes and the top
           ten show as a list. Hidden by CSS only: the drawing stays in the HTML. */
        @media (max-width: 560px) {
          .bnWebBlock { display: none; }
          .bnTopList { display: block; }
        }
        /* Three across leaves the "most shared" figure no room on a small
           phone: two across, with that tile taking the full second row. */
        @media (max-width: 420px) {
          .bnStatTiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .bnTileWide { grid-column: 1 / -1; }
        }
      `}</style>
    </section>
  );
}
