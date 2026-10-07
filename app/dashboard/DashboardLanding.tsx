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
import TickerLogo from "@/app/components/TickerLogo";
import { formatHeatPct } from "@/lib/sectorHeatmap";
import { TIINGO_CREDIT, TIINGO_URL } from "@/lib/server/tiingoSurfacePrice";
import type { CapexBar, DashboardCards, DashboardMarket } from "@/lib/server/dashboardCards";

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
  if (m.spx) tiles.push({ href: "/markets/spx", label: "S&P 500 (SPY)", value: `$${m.spx.close.toFixed(2)}`, sub: Math.abs(m.spx.fromHighPct) < 0.05 ? "at its highest close on file" : `${signed(m.spx.fromHighPct)} from its highest close` });
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
      {m.spx ? <p className="dlFine" data-fine-print="">SPY, the ETF that tracks the S&amp;P 500: close on {day(m.spx.date)}, against its highest close since {day(m.spx.since)}. Trend score from the same daily closes. {credit}</p> : null}
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

/**
 * FOLLOW THE MONEY AS A CHART (#563 COWORK #148 §3), in the capex page's purple
 * (its .spFill bar: #a78bfa on the rgba(255,255,255,0.06) track). Spenders'
 * own capex on the left, receivers' own filed sales on the right, each side on
 * its own scale. Every connector runs between ONE company and the "build-out"
 * node: there is no line from a company to another company, because there is
 * no estimated company→company flow (#563 rules). Server-drawn, no client code.
 */
/** The capex rows' fixed height and gap, in px: the star's lines are drawn on them. */
const CX_ROW = 28, CX_GAP = 8;

/** The sectors card's one plain line (#154 §3). */
export const SECTOR_WHAT = "How much each sector\u2019s stocks have risen or fallen since 1 January, weighted by company size.";

function CapexFlow({ spenders, receivers }: { spenders: CapexBar[]; receivers: CapexBar[] }) {
  const side = (rows: CapexBar[], head: string, key: string) => {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return (
      <div className="dlCx" data-side={key}>
        <p className="dlColHead">{head}</p>
        <ul className="dlCxList">
          {rows.map((r) => (
            <li key={r.ticker} className="dlCxRow">
              <TickerLogo symbol={r.ticker} size={22} radius={6} alt="" />
              <Link href={`/stock/${encodeURIComponent(r.ticker)}`} prefetch={false} className="dlTk">{r.ticker}</Link>
              <span className="dlCxTrack"><i className="dlCxFill" style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }} /></span>
              <span className="dlCxAmt">{r.amount}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  // THE STAR, LINED UP (#563 COWORK #154 §1): the rows have a fixed height, so
  // the lines are drawn in the lists' own pixels. Each line leaves its company
  // row level, at that row's vertical centre, and turns into the hub, which
  // sits on the middle row's centre. Every line has one end on the hub.
  const n = Math.max(spenders.length, receivers.length, 1);
  const H = n * CX_ROW + (n - 1) * CX_GAP, hubY = H / 2;
  const cy = (i: number) => i * (CX_ROW + CX_GAP) + CX_ROW / 2;
  return (
    <div className="dlCapexChart" data-capex-chart="">
      {side(spenders, "Top spenders · their own capex", "spend")}
      <div className="dlCxNode">
        <div className="dlCxStar" style={{ height: H }} data-hub-y={hubY}>
          {/* Sizes the column to the label, so the label never wraps or overhangs the bars. */}
          <span className="dlCxSize" aria-hidden="true">the build-out</span>
          <svg viewBox={`0 0 80 ${H}`} preserveAspectRatio="none" className="dlCxLines" aria-hidden="true" focusable="false">
            {spenders.map((r, i) => <path key={`in${r.ticker}`} data-into-node="" data-row-y={cy(i)} d={`M0 ${cy(i)} H14 L40 ${hubY}`} fill="none" stroke="rgba(167,139,250,0.55)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
            {receivers.map((r, i) => <path key={`out${r.ticker}`} data-from-node="" data-row-y={cy(i)} d={`M40 ${hubY} L66 ${cy(i)} H80`} fill="none" stroke="rgba(167,139,250,0.55)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
          </svg>
          <i className="dlCxHub" style={{ top: hubY }} aria-hidden="true" />
          <span className="dlCxNodeLabel" data-node="" style={{ top: hubY + 12 }}>the build-out</span>
        </div>
      </div>
      {side(receivers, "Top build-out receivers · their own filed sales", "receive")}
    </div>
  );
}

/**
 * SECTORS YTD AS A MEASUREMENT (#563 COWORK #148 §6): one diverging bar per
 * sector on a shared axis, 0 marked, green to the right and red to the left,
 * the value at the bar's end, and the S&P 500's YTD (SPY) as a reference line.
 */
function SectorBars({ rows, spx }: { rows: { name: string; slug: string; ytd: number | null }[]; spx: number | null }) {
  const vals = [...rows.map((r) => r.ytd), spx].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const span = Math.max(1, ...vals.map(Math.abs)) * 1.05;
  // The axis runs −span … +span across the track; 0 sits at 50%.
  const at = (v: number) => 50 + (v / span) * 50;
  return (
    <div className="dlSecChart" data-sector-chart="">
      <ul className="dlSecList">
        {rows.map((r) => {
          const v = typeof r.ytd === "number" && Number.isFinite(r.ytd) ? r.ytd : null;
          const up = (v ?? 0) >= 0;
          return (
            <li key={r.slug} className="dlSecRow" data-sector-row={r.slug}>
              <Link href={`/sector/${r.slug}`} prefetch={false} className="dlSecName">{r.name}</Link>
              <span className="dlSecTrack">
                <i className="dlSecZero" aria-hidden="true" />
                {spx !== null ? <i className="dlSecRef" data-spx-ref="" style={{ left: `${at(spx)}%` }} aria-hidden="true" /> : null}
                {v !== null ? <i className="dlSecBar" data-tone={up ? "up" : "down"} style={up ? { left: "50%", width: `${at(v) - 50}%` } : { left: `${at(v)}%`, width: `${50 - at(v)}%` }} /> : null}
              </span>
              <span className="dlSecVal" data-tone={v === null ? "none" : up ? "up" : "down"}>{v === null ? "n/a" : formatHeatPct(v)}</span>
            </li>
          );
        })}
      </ul>
      {spx !== null ? <p className="dlFine" data-fine-print=""><i className="dlSecKey" aria-hidden="true" /> S&amp;P 500 (SPY) {formatHeatPct(spx)} this year: bars past the line beat the market.</p> : null}
    </div>
  );
}

export function LandingCards({ c }: { c: DashboardCards }) {
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
              {/* THE STAR NEEDS ROOM (#154 §1): a card too narrow for it, a phone or a large text size, gets the stacked layout. */}
              <div className="dlCapexWrap"><CapexFlow spenders={c.capex.spenders} receivers={c.capex.receivers} /></div>
              <p className="dlFine" data-fine-print="">From each company&apos;s filings. These are what suppliers sold, not a record of who paid them.</p>
            </>
          ) : null}
        </Card>
      </div>

      <div className="dlRow dlRow3">
        <Card id="pickers" eyebrow="Pickers · today's screens" tone="#4ade80" title="Today's screens, honest counts" more={{ href: "/stock-screener", label: "Build your own screen" }} empty={c.pickers ? null : EMPTY.pickers}>
          {c.pickers ? (
            <>
              <ul className="dlList">
                {c.pickers.screens.map((s) => (
                  <li key={s.href} className="dlScreen">
                    <Link href={s.href} prefetch={false}>{s.label}</Link>
                    <span className="dlScreenRight">
                      {s.peek.length ? <span className="dlPeek" data-peek="" aria-hidden="true">{s.peek.map((t) => <TickerLogo key={t} symbol={t} size={20} radius={5} alt="" />)}</span> : null}
                      <span className="dlPill">{s.count > 0 ? s.count : "none today"}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="dlFine" data-fine-print="">Out of {c.pickers.universe.toLocaleString("en-US")} stocks. A screen that finds nothing says &quot;none today&quot;.</p>
            </>
          ) : null}
        </Card>

        <Card id="earnings" eyebrow="Earnings · the next two weeks" tone="#38bdf8" title="Who is estimated to report next" more={{ href: "/earnings-calendar", label: "Open the calendar" }} empty={c.earnings ? null : EMPTY.earnings}>
          {c.earnings ? (
            <>
              {/* A LIST, LIKE THE PICKERS CARD (#563 COWORK #154 §2): a heading per
                  week, then one company per line, biggest first, the rest counted. */}
              <div className="dlWeeks">
                {c.earnings.windows.map((w) => (
                  <div key={w.range} className="dlWeek" data-week="">
                    <p className="dlWeekHead">{w.range} · {w.count === 1 ? "1 company" : `${w.count} companies`}</p>
                    <ul className="dlList dlEarnList">
                      {w.top.map((e) => (
                        <li key={e.symbol} className="dlEarnRow" data-earn-row="">
                          <Link href={`/stock/${encodeURIComponent(e.symbol)}/earnings`} prefetch={false} className="dlEarnName" title={e.name}>
                            <TickerLogo symbol={e.symbol} size={20} radius={5} alt="" />
                            <strong>{e.symbol}</strong>
                            <span className="dlEarnCo">{e.name}</span>
                          </Link>
                          <span className="dlEarnDay">{e.day} <em>Estimated</em></span>
                        </li>
                      ))}
                    </ul>
                    {w.count > w.top.length ? <Link href="/earnings-calendar" prefetch={false} className="dlEarnMore" data-earn-more="">+{w.count - w.top.length} more in the calendar →</Link> : null}
                  </div>
                ))}
              </div>
              <p className="dlFine" data-fine-print=""><strong style={{ color: "#f59e0b" }}>Estimated</strong> from each company&apos;s own SEC reporting pattern, not from a paid calendar.</p>
            </>
          ) : null}
        </Card>

        <Card id="sectors" eyebrow="Sector growth · year to date" tone="#facc15" title={c.sectors?.leader && c.sectors.laggard ? `${c.sectors.leader} leads, ${c.sectors.laggard} lags` : "Sectors this year"} more={{ href: "/sector", label: "All 11 sectors" }} empty={c.sectors ? null : EMPTY.sectors}>
          {c.sectors ? (
            <>
              {/* WHAT IT MEASURES, IN ONE PLAIN LINE (#563 COWORK #154 §3). */}
              <p className="dlRead dlSecWhat" data-sector-what="">{SECTOR_WHAT}</p>
              <SectorBars rows={c.sectors.rows} spx={c.sectors.spxYtd} />
              <p className="dlFine" data-fine-print="">Cap-weighted across each sector&apos;s tracked stocks. {credit}</p>
            </>
          ) : null}
        </Card>
      </div>

      <div className="dlRow dlRow2">
        {/* TWO POSTS ON A WIDE SCREEN (#563 COWORK #154 §4): the newest two side by
            side at 1024 px and up; a phone shows the newest only. */}
        <Card id="insight" eyebrow="Insight of the day" tone="#fbbf24" more={{ href: c.insights ? `/insights/${c.insights[0].slug}` : "/insights", label: c.insights ? "Read the breakdown" : "All insights" }} empty={c.insights ? null : EMPTY.insight}>
          {c.insights ? (
            <div className="dlInsights" data-insights={c.insights.length}>
              {c.insights.map((p, i) => (
                <div key={p.slug} className="dlInsight" data-insight-post={i}>
                  {p.art.kind === "library" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="dlInsightImg" src={p.art.art.src} width={p.art.art.width} height={p.art.art.height} alt="" loading="lazy" decoding="async" />
                  ) : <span className="dlInsightImg" aria-hidden="true" />}
                  <div>
                    <h3 className="dlTitle"><Link href={`/insights/${p.slug}`} prefetch={false}>{p.title}</Link></h3>
                    <p className="dlFine" data-fine-print="">
                      {p.movePct !== null ? <><strong style={{ color: p.movePct >= 0 ? "#86efac" : "#fca5a5" }}>{signed(p.movePct)}</strong> since the post on {day(p.date)}{p.outcome ? ` · ${p.outcome}` : ""}</> : <>Published {day(p.date)} · {p.symbol}</>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        <Card id="news" eyebrow="News · the largest companies" tone="#f472b6" more={{ href: "/headlines", label: "All headlines" }} empty={c.news ? null : EMPTY.news}>
          {c.news ? (
            <>
              <ul className="dlList dlNews">
                {c.news.map((n) => (
                  <li key={n.url} className="dlNewsRow">
                    {/* THE THUMBNAIL (#563 COWORK #149 §2): decorative, the headline is the link text. */}
                    {n.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="dlNewsThumb" data-news-thumb="" src={n.thumb} alt="" width={60} height={60} loading="lazy" decoding="async" />
                    ) : <span className="dlNewsThumb" data-news-thumb="fallback" aria-hidden="true" />}
                    <a href={n.url} target="_blank" rel="noopener noreferrer nofollow">{n.title}</a>
                    <Link className="dlPill" href={`/stock/${encodeURIComponent(n.symbol)}/news`} prefetch={false}>{n.symbol}</Link>
                  </li>
                ))}
              </ul>
              <p className="dlFine" data-fine-print="">Each company&apos;s newest headline from its news page{c.news.some((n) => n.source) ? ` (${[...new Set(c.news.map((n) => n.source).filter(Boolean))].join(", ")})` : ""}.</p>
            </>
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
.dlColHead{margin:0 0 4px;font-size:var(--fs-read);line-height:1.35;color:#8a97ad;font-weight:700;}
.dlTk{font-weight:800;}
.dlWeeks{display:block;}
.dlLogoChip{display:inline-flex;align-items:center;gap:5px;}
.dlScreen{flex-wrap:nowrap;}
.dlScreenRight{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;}
.dlPeek{display:inline-flex;gap:3px;}
.dlCapexChart{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:6px;align-items:end;}
.dlCx{min-width:0;}
.dlCx .dlColHead{min-height:2.7em;}
.dlCxList{list-style:none;margin:0;padding:0;display:grid;gap:8px;}
.dlCxRow{display:grid;grid-template-columns:22px auto minmax(16px,1fr) auto;gap:6px;align-items:center;height:28px;font-size:var(--fs-label);}
.dlCxRow .dlTk{color:#f8fafc;text-decoration:none;font-weight:900;}
.dlCxTrack{display:block;height:12px;border-radius:4px;background:rgba(255,255,255,0.06);overflow:hidden;}
.dlCxFill{display:block;height:12px;border-radius:4px;background:#a78bfa;}
.dlCxAmt{font-weight:900;white-space:nowrap;}
.dlCxNode{min-width:0;}
.dlCxStar{position:relative;}
.dlCapexWrap{container-type:inline-size;}
.dlCxSize{display:block;visibility:hidden;height:0;overflow:hidden;white-space:nowrap;font-size:var(--fs-label);font-weight:800;padding:0 10px;}
.dlCxLines{display:block;width:100%;height:100%;}
.dlCxHub{position:absolute;left:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#a78bfa;box-shadow:0 0 0 4px rgba(167,139,250,0.18);}
.dlCxNodeLabel{position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:var(--fs-label);font-weight:800;color:#c4b5fd;line-height:1.2;padding:1px 6px;border-radius:6px;background:#141b2b;}
.dlSecList{list-style:none;margin:0;padding:0;display:grid;gap:5px;}
.dlSecRow{display:grid;grid-template-columns:minmax(0,9em) minmax(0,1fr) 4.4em;gap:8px;align-items:center;font-size:var(--fs-label);}
.dlSecName{color:#e2e8f0;text-decoration:none;font-weight:700;line-height:1.15;overflow-wrap:anywhere;}
.dlSecTrack{position:relative;display:block;height:12px;}
.dlSecZero{position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:rgba(148,163,184,0.55);}
.dlSecRef{position:absolute;top:-3px;bottom:-3px;width:0;border-left:2px dashed #93c5fd;z-index:1;}
.dlSecBar{position:absolute;top:1px;height:10px;border-radius:2px;}
.dlSecBar[data-tone="up"]{background:#22c55e;}
.dlSecBar[data-tone="down"]{background:#ef4444;}
.dlSecVal{font-weight:800;text-align:right;white-space:nowrap;}
.dlSecVal[data-tone="up"]{color:#86efac;}
.dlSecVal[data-tone="down"]{color:#fca5a5;}
.dlSecKey{display:inline-block;width:0;height:10px;border-left:2px dashed #93c5fd;margin-right:4px;vertical-align:middle;}
.dlWeek{min-width:0;}
.dlWeek+.dlWeek{margin-top:12px;}
.dlWeekHead{margin:0 0 6px;font-size:var(--fs-label);font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;}
.dlEarnList{gap:6px;}
.dlEarnRow{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;}
.dlEarnName{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 auto;color:#e2e8f0;text-decoration:none;}
.dlEarnName strong{color:#f8fafc;font-weight:900;flex:0 0 auto;}
.dlEarnCo{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8;}
.dlEarnDay{flex:0 0 auto;white-space:nowrap;font-weight:700;color:#cbd5e1;font-size:var(--fs-label);}
.dlEarnDay em{font-style:normal;color:#f59e0b;font-weight:800;margin-left:4px;}
.dlEarnMore{display:inline-block;margin-top:6px;font-size:var(--fs-label);font-weight:800;color:#7dd3fc;text-decoration:none;}
.dlSecWhat{margin:0 0 10px;color:#cbd5e1;}
.dlInsights{display:grid;gap:16px;}
.dlInsights[data-insights="2"] .dlInsight+.dlInsight{display:none;}
@media(min-width:1024px){.dlInsights[data-insights="2"]{grid-template-columns:repeat(2,minmax(0,1fr));}.dlInsights[data-insights="2"] .dlInsight{grid-template-columns:minmax(0,1fr);align-content:start;}.dlInsights[data-insights="2"] .dlInsight+.dlInsight{display:grid;}.dlInsights[data-insights="2"] .dlInsightImg{width:100%;height:130px;}}
.dlChips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
.dlChip{padding:3px 8px;border-radius:8px;background:#141b2b;border:1px solid #222c40;color:#eaf0fa;font-size:var(--fs-label);font-weight:800;text-decoration:none;}
.dlInsight{display:grid;grid-template-columns:140px minmax(0,1fr);gap:16px;align-items:center;}
.dlInsightImg{display:block;width:140px;height:100px;object-fit:cover;border-radius:12px;background:linear-gradient(135deg,#13213f,#0f1624);}
.dlNews li{align-items:flex-start;}
.dlNews .dlNewsRow{display:grid;grid-template-columns:60px minmax(0,1fr) auto;gap:12px;align-items:center;}
.dlNewsThumb{display:block;width:60px;height:60px;border-radius:10px;object-fit:cover;background:linear-gradient(135deg,#13213f,#0f1624);}
@media(max-width:1100px){.dlRow3{grid-template-columns:repeat(2,minmax(0,1fr));}}
@media(max-width:860px){.dlRow2,.dlRow3{grid-template-columns:minmax(0,1fr);}.dlHub{grid-template-columns:minmax(0,1fr);}}
@media(max-width:560px){.dlTiles{grid-template-columns:minmax(0,1fr);}.dlInsight{grid-template-columns:minmax(0,1fr);}.dlInsightImg{width:100%;height:140px;}.dlCard{padding:14px;}.dlH2{font-size:1.375rem;}}
/* THE STACKED STAR (#154 §1), last so it outranks the star's own rules. */
@container (max-width:27em){.dlCx .dlColHead{min-height:0;}.dlCapexChart{grid-template-columns:minmax(0,1fr);}.dlCxNode{display:flex;justify-content:center;}.dlCxSize,.dlCxLines,.dlCxHub{display:none;}.dlCxStar{height:auto!important;}.dlCxNodeLabel{position:static;transform:none;background:none;}.dlCxNodeLabel::before{content:"↓ ";}.dlCxNodeLabel::after{content:" ↓";}}
`;
