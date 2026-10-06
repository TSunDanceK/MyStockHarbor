// THE DASHBOARD'S LANDING (#563 COWORK #134, the approved mock-up): "Market
// right now" beside the hero, and the "Only on MyStockHarbor today" cards
// under the live feed. Server-rendered from lib/server/dashboardCards.ts; the
// hero itself (the search) stays in DashboardClient, which owns the search
// state. Every card links to its section and has its own empty state, so a
// missing store hides one card's figures, never the page.
//
// Copy: describes, never advises; no buy, sell or should. Sentences at
// --fs-read; short labels at --fs-label; credits and "as of" lines are fine
// print (data-fine-print).
import Link from "next/link";
import type { ReactNode } from "react";
import MarketMoodCard from "@/app/markets/spx/MarketMoodCard";
import { formatHeatPct, heatScale, tileShade } from "@/lib/sectorHeatmap";
import { TIINGO_CREDIT, TIINGO_URL } from "@/lib/server/tiingoSurfacePrice";
import type { DashboardCards, DashboardMarket } from "@/lib/server/dashboardCards";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: string) => { const [y, m, dd] = d.slice(0, 10).split("-").map(Number); return y && m && dd ? `${dd} ${MONTHS[m - 1]} ${y}` : d; };
const signed = (v: number, dp = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}%`;
const credit = <a href={TIINGO_URL} target="_blank" rel="noopener noreferrer">{TIINGO_CREDIT}</a>;

/** Empty-state words, one per card; scripts/check-dashboard-landing.mjs holds the page to them. */
export const EMPTY = {
  market: "Market figures aren't available just now.",
  hub: "The supply-chain map couldn't be read just now.",
  capex: "The capex figures couldn't be read just now.",
  pickers: "Today's screen counts aren't available just now.",
  earnings: "No estimated report windows are available just now.",
  sectors: "Sector figures aren't available just now.",
  insight: "No insight post is available just now.",
  news: "No headlines are available just now.",
} as const;

function Card({ id, eyebrow, tone, title, children, more, empty }: { id: string; eyebrow: string; tone: string; title?: string; children: ReactNode; more: { href: string; label: string }; empty?: string | null }) {
  return (
    <section className="dlCard" data-card={id} data-empty={empty ? "" : undefined}>
      <p className="dlEyebrow" style={{ color: tone }}>{eyebrow}</p>
      {title && !empty ? <h3 className="dlTitle">{title}</h3> : null}
      {empty ? <p className="dlEmpty">{empty}</p> : children}
      <Link className="dlMore" href={more.href} prefetch={false}>{more.label} →</Link>
    </section>
  );
}

// ── MARKET RIGHT NOW ────────────────────────────────────────────────────────

export function MarketNow({ m }: { m: DashboardMarket }) {
  const tiles: { href: string; label: string; value: string; sub: string; tone?: string }[] = [];
  if (m.spx) tiles.push({ href: "/markets/spx", label: "S&P 500", value: m.spx.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), sub: `${signed(m.spx.fromRecordPct)} from the record` });
  if (m.trend) tiles.push({ href: "/markets/spx", label: "Trend score", value: `${m.trend.score}/100`, sub: m.trend.words, tone: m.trend.score >= 56 ? "#86efac" : m.trend.score <= 44 ? "#fca5a5" : "#fde68a" });
  if (m.bestSector) tiles.push({ href: `/sector/${m.bestSector.slug}`, label: "Best sector YTD", value: m.bestSector.name, sub: signed(m.bestSector.ytd, 2), tone: m.bestSector.ytd >= 0 ? "#86efac" : "#fca5a5" });
  return (
    <div className="dlMarket" data-market-now="">
      <p className="dlEyebrow" style={{ color: "#93c5fd" }}>Market right now</p>
      {m.mood ? <MarketMoodCard view={m.mood} credit={credit} /> : null}
      {tiles.length ? (
        <div className="dlTiles">
          {tiles.map((t) => (
            <Link key={t.label} href={t.href} prefetch={false} className="dlTile" data-tile={t.label}>
              <span className="dlTileLabel">{t.label}</span>
              <span className="dlTileValue" style={t.tone ? { color: t.tone } : undefined}>{t.value}</span>
              <span className="dlTileSub">{t.sub}</span>
            </Link>
          ))}
        </div>
      ) : null}
      {!m.mood && !tiles.length ? <p className="dlEmpty" data-card="market" data-empty="">{EMPTY.market}</p> : null}
      {m.spx ? <p className="dlFine" data-fine-print="">S&amp;P 500 close as of {day(m.spx.asOf)}. Trend score from SPY&apos;s daily closes. {credit}</p> : null}
    </div>
  );
}

// ── THE CARDS ───────────────────────────────────────────────────────────────

/** Three hubs and a few faint spokes, server-drawn; decorative. */
function HubWeb({ top }: { top: { ticker: string; count: number }[] }) {
  const pos = [{ x: 120, y: 60 }, { x: 70, y: 130 }, { x: 180, y: 140 }];
  const spokes = [[20, 30], [230, 25], [10, 110], [250, 100], [40, 185], [120, 195], [215, 195]];
  return (
    <svg viewBox="0 0 260 210" className="dlWeb" aria-hidden="true" focusable="false">
      {top.map((_, i) => spokes.filter((_, j) => j % 3 === i).map(([x, y]) => <line key={`${i}-${x}`} x1={pos[i].x} y1={pos[i].y} x2={x} y2={y} stroke="rgba(95,212,199,0.35)" strokeWidth={1} />))}
      {spokes.map(([x, y]) => <circle key={`s${x}`} cx={x} cy={y} r={3} fill="#64748b" />)}
      {top.map((t, i) => (
        <g key={t.ticker}>
          <circle cx={pos[i].x} cy={pos[i].y} r={24} fill="#0b1220" stroke={["#5FD4C7", "#86efac", "#facc15"][i]} strokeWidth={2} />
          <text x={pos[i].x} y={pos[i].y - 1} textAnchor="middle" fill="#f1f5f9" style={{ fontSize: "0.75rem", fontWeight: 800 }}>{t.ticker.slice(0, 5)}</text>
          <text x={pos[i].x} y={pos[i].y + 12} textAnchor="middle" fill="#94a3b8" style={{ fontSize: "0.6875rem" }}>×{t.count}</text>
        </g>
      ))}
    </svg>
  );
}

export function LandingCards({ c }: { c: DashboardCards }) {
  const scale = c.sectors ? heatScale(c.sectors.tiles.map((t) => t.ytd)) : 1;
  const hub = c.hub;
  return (
    <section className="dlCards" aria-labelledby="dlCardsTitle">
      <div className="dlCardsHead">
        <h2 id="dlCardsTitle" className="dlH2">Only on MyStockHarbor today</h2>
        <p className="dlFine" data-fine-print="">Updated after each close · {credit} · Filings from SEC EDGAR</p>
      </div>

      <div className="dlRow dlRow2">
        <Card id="hub" eyebrow="Bottlenecks · supply-chain map" tone="#5FD4C7" title="Who the market quietly depends on" more={{ href: "/bottlenecks", label: "Explore the map" }} empty={hub ? null : EMPTY.hub}>
          {hub ? (
            <div className="dlHub">
              <HubWeb top={hub.top} />
              <div>
                <p className="dlRead">{hub.top[0].count} of the {hub.mapped} stocks we&apos;ve mapped name {hub.top[0].name} as a supplier or key customer. If one of these hubs stumbles, these are the pages that may feel it.</p>
                <ul className="dlList">
                  {hub.top.map((t) => (
                    <li key={t.ticker}><Link href={`/stock/${encodeURIComponent(t.ticker)}`} prefetch={false}>{t.ticker}</Link><span className="dlPill">×{t.count}</span></li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </Card>

        <Card id="capex" eyebrow="Follow the money · AI capex" tone="#c4b5fd" title={c.capex?.lead ? `${c.capex.lead.amount} out of ${c.capex.lead.ticker}. Where does it land?` : "Where the build-out money lands"} more={{ href: "/bottlenecks/capex", label: "See the full capex picture" }} empty={c.capex ? null : EMPTY.capex}>
          {c.capex ? (
            <>
              <div className="dlFlow">
                <div>
                  <p className="dlColHead">Spending most</p>
                  <ul className="dlList">{c.capex.spenders.map((s) => <li key={s.ticker}><span className="dlTk">{s.ticker}</span><span>{s.amount}</span></li>)}</ul>
                </div>
                <span className="dlArrow" aria-hidden="true">→</span>
                <div>
                  <p className="dlColHead">Build-out sales</p>
                  <ul className="dlList">{c.capex.receivers.map((s) => <li key={s.ticker}><span className="dlTk">{s.ticker}</span><span>{s.amount}</span></li>)}</ul>
                </div>
              </div>
              <p className="dlFine" data-fine-print="">From each company&apos;s filings. These are what suppliers sold, not a record of who paid them.</p>
            </>
          ) : null}
        </Card>
      </div>

      <div className="dlRow dlRow3">
        <Card id="pickers" eyebrow="Pickers · today's screens" tone="#4ade80" title="Today's screens, honest counts" more={{ href: "/pickers", label: "Build your own screen" }} empty={c.pickers ? null : EMPTY.pickers}>
          {c.pickers ? (
            <>
              <ul className="dlList">
                {c.pickers.screens.map((s) => (
                  <li key={s.href}><Link href={s.href} prefetch={false}>{s.label}</Link><span className="dlPill">{s.count > 0 ? s.count : "none today"}</span></li>
                ))}
              </ul>
              <p className="dlFine" data-fine-print="">Out of {c.pickers.universe.toLocaleString("en-US")} stocks. A screen that finds nothing says &quot;none today&quot;.</p>
            </>
          ) : null}
        </Card>

        <Card id="earnings" eyebrow="Earnings · next 3 weeks" tone="#38bdf8" title="Who is estimated to report next" more={{ href: "/earnings-calendar", label: "Open the calendar" }} empty={c.earnings ? null : EMPTY.earnings}>
          {c.earnings ? (
            <>
              <div className="dlWeeks">
                {c.earnings.windows.map((w) => (
                  <div key={w.range} className="dlWeek">
                    <p className="dlWeekHead">{w.range}</p>
                    <p className="dlFine" data-fine-print="">{w.count === 1 ? "1 company" : `${w.count} companies`}</p>
                    <div className="dlChips">{w.top.map((s) => <Link key={s} href={`/stock/${encodeURIComponent(s)}/earnings`} prefetch={false} className="dlChip">{s}</Link>)}</div>
                  </div>
                ))}
              </div>
              <p className="dlFine" data-fine-print=""><strong style={{ color: "#f59e0b" }}>Estimated</strong> from each company&apos;s own SEC reporting pattern, not from a paid calendar.</p>
            </>
          ) : null}
        </Card>

        <Card id="sectors" eyebrow="Sectors · year to date" tone="#facc15" title={c.sectors?.leader && c.sectors.laggard ? `${c.sectors.leader} leads, ${c.sectors.laggard} lags` : "Sectors this year"} more={{ href: "/sector", label: "All 11 sectors" }} empty={c.sectors ? null : EMPTY.sectors}>
          {c.sectors ? (
            <>
              <div className="dlSectors">
                {c.sectors.tiles.map((t) => (
                  <Link key={t.slug} href={`/sector/${t.slug}`} prefetch={false} className="dlSector" style={{ background: tileShade(t.ytd, scale).background }}>
                    <span className="dlSectorName">{t.name}</span>
                    <span className="dlSectorPct">{formatHeatPct(t.ytd)}</span>
                  </Link>
                ))}
              </div>
              <p className="dlFine" data-fine-print="">Cap-weighted across each sector&apos;s tracked stocks. {credit}</p>
            </>
          ) : null}
        </Card>
      </div>

      <div className="dlRow dlRow2">
        <Card id="insight" eyebrow="Insight of the day" tone="#fbbf24" more={{ href: c.insight ? `/insights/${c.insight.slug}` : "/insights", label: c.insight ? "Read the breakdown" : "All insights" }} empty={c.insight ? null : EMPTY.insight}>
          {c.insight ? (
            <div className="dlInsight">
              {c.insight.art.kind === "library" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="dlInsightImg" src={c.insight.art.art.src} width={c.insight.art.art.width} height={c.insight.art.art.height} alt="" loading="lazy" decoding="async" />
              ) : <span className="dlInsightImg" aria-hidden="true" />}
              <div>
                <h3 className="dlTitle"><Link href={`/insights/${c.insight.slug}`} prefetch={false}>{c.insight.title}</Link></h3>
                <p className="dlFine" data-fine-print="">
                  {c.insight.movePct !== null ? <><strong style={{ color: c.insight.movePct >= 0 ? "#86efac" : "#fca5a5" }}>{signed(c.insight.movePct)}</strong> since the post on {day(c.insight.date)}{c.insight.outcome ? ` · ${c.insight.outcome}` : ""}</> : <>Published {day(c.insight.date)} · {c.insight.symbol}</>}
                </p>
              </div>
            </div>
          ) : null}
        </Card>

        <Card id="news" eyebrow="Market headlines" tone="#f472b6" more={{ href: "/headlines", label: "All headlines" }} empty={c.news ? null : EMPTY.news}>
          {c.news ? (
            <ul className="dlList dlNews">
              {c.news.map((n) => (
                <li key={n.url}><a href={n.url} target="_blank" rel="noopener noreferrer nofollow">{n.title}</a><span className="dlPill">{n.source}</span></li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>
    </section>
  );
}

/** The landing's styles, once, beside the cards. */
export const LANDING_CSS = `
.dlEyebrow{margin:0;font-size:var(--fs-label);font-weight:800;letter-spacing:.08em;text-transform:uppercase;}
.dlFine{margin:8px 0 0;font-size:var(--fs-fine);line-height:1.5;color:#8a97ad;}
.dlFine a{color:inherit;}
.dlRead{margin:0 0 10px;font-size:var(--fs-read);line-height:var(--lh-read,1.6);color:#cbd5e1;}
.dlEmpty{margin:10px 0;font-size:var(--fs-read);line-height:1.6;color:#94a3b8;}
.dlMarket{display:grid;gap:12px;align-content:start;min-width:0;}
.dlTiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
.dlTile{display:grid;gap:4px;padding:12px;border:1px solid #222c40;border-radius:12px;background:#0f1624;color:#eaf0fa;text-decoration:none;min-width:0;}
.dlTile:hover{border-color:#27406f;}
.dlTileLabel{font-size:var(--fs-label);font-weight:800;color:#8a97ad;text-transform:uppercase;letter-spacing:.05em;}
.dlTileValue{font-size:1.375rem;font-weight:800;overflow-wrap:anywhere;}
.dlTileSub{font-size:var(--fs-label);color:#8a97ad;}
.dlCards{margin:22px 0 8px;display:grid;gap:16px;}
.dlCardsHead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;}
.dlH2{margin:0;font-size:1.625rem;font-weight:800;letter-spacing:-.01em;}
.dlRow{display:grid;gap:16px;}
.dlRow2{grid-template-columns:repeat(2,minmax(0,1fr));}
.dlRow3{grid-template-columns:repeat(3,minmax(0,1fr));}
.dlCard{display:flex;flex-direction:column;gap:10px;padding:18px;border:1px solid #222c40;border-radius:16px;background:#0d1422;min-width:0;}
.dlTitle{margin:0;font-size:1.25rem;line-height:1.3;font-weight:800;}
.dlTitle a{color:inherit;text-decoration:none;}
.dlMore{margin-top:auto;padding-top:6px;color:#60a5fa;font-weight:800;font-size:var(--fs-read);text-decoration:none;}
.dlList{list-style:none;margin:0;padding:0;display:grid;}
.dlList li{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1a2336;font-size:var(--fs-read);}
.dlList li:last-child{border-bottom:none;}
.dlList a{color:#eaf0fa;text-decoration:none;}
.dlList a:hover{text-decoration:underline;}
.dlPill{flex:0 0 auto;padding:2px 9px;border-radius:999px;background:#1a2336;color:#cbd5e1;font-size:var(--fs-label);font-weight:800;white-space:nowrap;}
.dlHub{display:grid;grid-template-columns:minmax(0,0.9fr) minmax(0,1.1fr);gap:16px;align-items:start;}
.dlWeb{width:100%;height:auto;max-width:300px;}
.dlFlow{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:12px;align-items:center;}
.dlColHead{margin:0 0 4px;font-size:var(--fs-label);color:#8a97ad;font-weight:700;}
.dlTk{font-weight:800;}
.dlArrow{color:#5FD4C7;font-size:1.5rem;font-weight:800;}
.dlWeeks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
.dlWeek{padding:10px;border:1px solid #1a2336;border-radius:12px;background:#0f1624;min-width:0;}
.dlWeekHead{margin:0;font-size:var(--fs-label);font-weight:800;}
.dlChips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
.dlChip{padding:3px 8px;border-radius:8px;background:#141b2b;border:1px solid #222c40;color:#eaf0fa;font-size:var(--fs-label);font-weight:800;text-decoration:none;}
.dlSectors{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:8px;}
.dlSector{display:grid;gap:2px;padding:8px;border-radius:10px;color:#fff;text-decoration:none;min-width:0;}
.dlSectorName{font-size:var(--fs-label);font-weight:700;line-height:1.25;}
.dlSectorPct{font-size:var(--fs-label);font-weight:800;}
.dlInsight{display:grid;grid-template-columns:140px minmax(0,1fr);gap:16px;align-items:center;}
.dlInsightImg{display:block;width:140px;height:100px;object-fit:cover;border-radius:12px;background:linear-gradient(135deg,#13213f,#0f1624);}
.dlNews li{align-items:flex-start;}
@media(max-width:1100px){.dlRow3{grid-template-columns:repeat(2,minmax(0,1fr));}}
@media(max-width:860px){.dlRow2,.dlRow3{grid-template-columns:minmax(0,1fr);}.dlHub{grid-template-columns:minmax(0,1fr);}}
@media(max-width:560px){.dlFlow{grid-template-columns:minmax(0,1fr);}.dlArrow{transform:rotate(90deg);justify-self:center;}.dlTiles{grid-template-columns:minmax(0,1fr);}.dlWeeks{grid-template-columns:minmax(0,1fr);}.dlSectors{grid-template-columns:repeat(2,minmax(0,1fr));}.dlInsight{grid-template-columns:minmax(0,1fr);}.dlInsightImg{width:100%;height:140px;}.dlCard{padding:14px;}.dlH2{font-size:1.375rem;}}
`;
