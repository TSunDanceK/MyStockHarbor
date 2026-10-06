// THE INSIGHT POST PAGE (#563 COWORK #132/#133), built to the owner-approved
// mock-up. One template for every post: the 59 written before it render here
// too. Server-rendered; the chart and its slider are the only client island.
//
//   1. hero: the post's picture (the news pipeline's library art), the logo,
//      ticker, company, ONE derived setup label, the timeframe, the title, the
//      date, the next report window, sector · cap
//   2. "Since this was published": the move, the level and what it did, now
//      against the level, against the S&P 500
//   3. two columns: the short version · did the level hold? · from the filings
//      · what happened · if it goes well / if it doesn't │ levels today ·
//      showing up in screens · sector
//   4. more on {TICKER}: three cards, each only when the stock has that data
//   5. related insights, then the stock / news / earnings / trade links and
//      the fine print
//
// COPY: describes, never advises (scripts/check-insight-page.mjs reads every
// string this file writes). Sizes in rem or the reading tokens; fine print
// carries data-fine-print.
import Link from "next/link";
import type { ReactNode } from "react";
import TickerLogo from "@/app/components/TickerLogo";
import LatestEarningsCard from "@/app/components/LatestEarningsCard";
import InsightChart from "./InsightChart";
import { TIINGO_CREDIT, TIINGO_URL } from "@/lib/server/tiingoSurfacePrice";
import type { InsightPageData, MoreCard } from "@/lib/server/insightPage";
import { dayWords, outcomeWords, pctWords, ptsWords } from "@/lib/insightView";

export type InsightHtml = { whatHappened: string | null; why: string | null; originalRest: string | null };

const money = (v: number) => `$${v >= 1000 ? v.toFixed(0) : v.toFixed(2)}`;
const range = (z: { lo: number; hi: number }) => (z.hi - z.lo < 0.005 ? money(z.lo) : `${money(z.lo)}–${money(z.hi).slice(1)}`);
const tone = (v: number | null | undefined) => (v === null || v === undefined || Math.abs(v) < 0.05 ? "flat" : v > 0 ? "up" : "down");

export const INSIGHT_FINE_PRINT =
  "Descriptive analysis of public information, not investment advice. The post's text is as published on its date; prices, levels and figures on this page update daily. Filed figures: SEC EDGAR.";

export default function InsightPage({ d, html, thumb }: { d: InsightPageData; html: InsightHtml; thumb: number[] | null }) {
  const { n } = d;
  const sym = n.symbol;
  const timeframe = n.timeframe === "w" ? "Weekly" : "Daily";
  return (
    <main className="inPage">
      <div className="inWrap">
        <nav className="inCrumbs" aria-label="Breadcrumb"><Link href="/insights">Insights</Link> › <Link href={`/stock/${sym}`}>{sym}</Link></nav>

        {/* 1. HERO */}
        <header className="inHero" data-insight-hero="">
          {d.art.kind === "library" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="inHeroImg" src={d.art.art.src} srcSet={d.art.art.srcSet} sizes="(max-width: 1100px) 100vw, 1100px" width={d.art.art.width} height={d.art.art.height} alt="" loading="eager" decoding="async" />
          ) : (
            <div className="inHeroBrand" aria-hidden="true"><span>{sym}</span></div>
          )}
          <div className="inHeroShade" />
          <div className="inHeroBody">
            <div className="inHeroTop">
              <TickerLogo symbol={sym} name={d.company} size={40} radius={10} alt="" />
              <div style={{ minWidth: 0 }}>
                <div className="inHeroSym">{sym} <span className="inHeroCo">{d.company}</span></div>
                <div className="inChips">
                  {d.label ? <span className="inChip" data-tone={d.label.tone} data-setup-label="">{d.label.text}</span> : null}
                  <span className="inChip" data-tone="flat">{timeframe}</span>
                </div>
              </div>
            </div>
            <h1 className="inTitle">{n.title}</h1>
            <p className="inMeta">
              Published {dayWords(n.date)}
              {d.nextReport ? <> · Next report: {d.nextReport}</> : null}
              {d.sector || d.capWords ? <> · {[d.sector?.name, d.capWords ? `${d.capWords} market cap` : null].filter(Boolean).join(" · ")}</> : null}
            </p>
          </div>
        </header>

        {/* 2. SINCE THIS WAS PUBLISHED */}
        {d.since ? (
          <section className="inSince" data-insight-since="" aria-label="Since this was published">
            <h2 className="inEyebrow">Since this was published</h2>
            <div className="inStats">
              <Stat label="Move since" value={pctWords(d.since.movePct)} tone={tone(d.since.movePct)} sub={`${money(d.since.thenClose)} → ${money(d.since.nowClose)}`} />
              {d.since.level ? (() => {
                const o = outcomeWords(d.since.level.outcome);
                return <Stat label={`The ${d.since.level.name}`} value={o.word} tone={o.tone} sub={o.detail ?? ""} />;
              })() : null}
              {d.since.level ? <Stat label={`Now vs the ${d.since.level.name}`} value={pctWords(d.since.level.nowPct)} tone={tone(d.since.level.nowPct)} sub={`${d.since.level.nowPct >= 0 ? "above" : "below"} ${money(d.since.level.nowValue)}`} /> : null}
              {d.since.vsSpxPts !== null ? <Stat label="Vs the S&P 500" value={ptsWords(d.since.vsSpxPts)} tone={tone(d.since.vsSpxPts)} sub="vs SPY, same dates" /> : null}
            </div>
            <p className="inFine" data-fine-print="">{d.since.sessions} daily close{d.since.sessions === 1 ? "" : "s"} since publication, {dayWords(d.since.thenDate)} to {dayWords(d.since.nowDate)}. {d.onTiingo ? <>Prices: <a href={TIINGO_URL} target="_blank" rel="noopener noreferrer">{TIINGO_CREDIT}</a></> : null}</p>
          </section>
        ) : null}

        {/* 3. TWO COLUMNS */}
        <div className="inCols">
          <div className="inMain">
            <Card eyebrow="The short version" attr="data-insight-summary">
              <p className="inRead" data-insight-summary-text="">{n.summary}</p>
              {d.difference ? <p className="inDiff" data-insight-difference="">{d.difference}</p> : null}
              {html.why ? (
                <details className="inTap"><summary>Why it mattered</summary><div className="inProse" dangerouslySetInnerHTML={{ __html: html.why }} /></details>
              ) : null}
            </Card>

            {d.chart ? (
              <Card eyebrow="Did the level hold" title="Drag from the publish date to today">
                <InsightChart symbol={sym} {...d.chart} />
                {thumb && thumb.length > 1 ? (
                  <figure className="inThumb">
                    <Spark closes={thumb} />
                    <figcaption className="inFine" data-fine-print="">Chart when published: the {thumb.length} sessions to {dayWords(n.date)}.</figcaption>
                  </figure>
                ) : null}
              </Card>
            ) : null}

            {d.snapshot?.available ? (
              <section className="inBlock" aria-label="From the filings">
                <h2 className="inH2">From the filings</h2>
                <LatestEarningsCard snapshot={d.snapshot} symbol={sym} />
                {d.pe ? <p className="inRead" data-insight-pe="">P/E {d.pe.value.toFixed(1)}: {d.pe.text}. <span className="inFineInline" data-fine-print="">{d.pe.note}</span></p> : null}
                <p className="inLinks">
                  <Link href={`/stock/${sym}/earnings`}>{sym} earnings, in full →</Link>
                </p>
              </section>
            ) : null}

            {html.whatHappened ? (
              <Card eyebrow="What happened">
                <div className="inProse" dangerouslySetInnerHTML={{ __html: html.whatHappened }} />
                {n.sources.length ? (
                  <ul className="inSources" aria-label="Sources">
                    {n.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>{s.publisher ? <span> · {s.publisher}</span> : null}</li>)}
                  </ul>
                ) : null}
                {n.bull || n.bear ? (
                  <div className="inScen" data-insight-scenarios="">
                    {n.bull ? <div className="inScenBox" data-tone="up"><div className="inEyebrow">If it goes well</div><p className="inRead">{n.bull}</p></div> : null}
                    {n.bear ? <div className="inScenBox" data-tone="down"><div className="inEyebrow">If it doesn&apos;t</div><p className="inRead">{n.bear}</p></div> : null}
                  </div>
                ) : null}
                {html.originalRest ? (
                  <details className="inTap"><summary>The original post, in full</summary><div className="inProse" dangerouslySetInnerHTML={{ __html: html.originalRest }} /></details>
                ) : null}
              </Card>
            ) : null}
          </div>

          <aside className="inRail">
            {d.levelsToday ? (
              <Card eyebrow="Levels today" title={`As of ${dayWords(d.levelsToday.asOf)}`}>
                <ul className="inList inDots" data-insight-levels="">
                  {[...d.levelsToday.above].reverse().map((z, i) => <li key={`a${i}`} data-dot="up"><span>Zone above ({z.count} levels)</span><strong>{range(z)}</strong></li>)}
                  {d.levelsToday.inside ? <li data-dot="last"><span>Price inside a zone ({d.levelsToday.inside.count} levels)</span><strong>{range(d.levelsToday.inside)}</strong></li> : null}
                  <li data-dot="last"><span>Last close</span><strong>{money(d.levelsToday.price)}</strong></li>
                  {d.levelsToday.below.map((z, i) => <li key={`b${i}`} data-dot="down"><span>Zone below ({z.count} levels)</span><strong>{range(z)}</strong></li>)}
                  {d.levelsToday.monthLow !== null ? <li data-dot="down"><span>This month&apos;s low</span><strong>{money(d.levelsToday.monthLow)}</strong></li> : null}
                  {d.levelsToday.discussed ? <li data-dot="level" data-discussed=""><span>Level discussed: {d.levelsToday.discussed.name}</span><strong>{money(d.levelsToday.discussed.value)}</strong></li> : null}
                </ul>
                <p className="inFine" data-fine-print="">Zones are where several levels sit close together. <Link href={`/stock/${sym}`}>All levels on the {sym} page →</Link></p>
              </Card>
            ) : null}
            {d.screens && d.screens.length ? (
              <Card eyebrow="Showing up in screens" title={`${d.screens.length} screen${d.screens.length === 1 ? "" : "s"} today`}>
                <div className="inPills" data-insight-screens="">{d.screens.map((s) => <Link key={s.href} href={s.href} className="inPill">{s.label}</Link>)}</div>
              </Card>
            ) : null}
            {d.sectorMove ? (
              <Card eyebrow="Sector" title={d.sectorMove.ytd !== null ? `${d.sectorMove.name} · ${pctWords(d.sectorMove.ytd, 2)} YTD` : d.sectorMove.name}>
                <ul className="inList">
                  {d.sectorMove.day !== null ? <li><span>Latest session</span><strong className={tone(d.sectorMove.day) === "up" ? "inUp" : tone(d.sectorMove.day) === "down" ? "inDown" : ""}>{pctWords(d.sectorMove.day)}</strong></li> : null}
                  {d.sectorMove.week !== null ? <li><span>This week</span><strong>{pctWords(d.sectorMove.week)}</strong></li> : null}
                  {d.sectorMove.month !== null ? <li><span>This month</span><strong>{pctWords(d.sectorMove.month)}</strong></li> : null}
                  {d.sectorMove.rank !== null ? <li><span>Rank, latest session</span><strong>{d.sectorMove.rank} of 11</strong></li> : null}
                </ul>
                <p className="inFine" data-fine-print=""><Link href={`/sector/${d.sectorMove.slug}`}>The {d.sectorMove.name} sector →</Link></p>
              </Card>
            ) : null}
          </aside>
        </div>

        {/* 4. MORE ON {TICKER} */}
        <section className="inMore" aria-label={`More on ${sym}`}>
          <h2 className="inH2">More on {sym} across MyStockHarbor</h2>
          <div className="inMoreGrid">{d.more.map((m) => <MoreCardView key={m.kind} m={m} sym={sym} />)}</div>
        </section>

        {/* 5. RELATED, THEN THE LINKS AND THE FINE PRINT */}
        {d.related.length ? (
          <section className="inRelated" aria-label="Related insights">
            <h2 className="inH2">Related insights</h2>
            <div className="inMoreGrid">
              {d.related.map((r) => (
                <Link key={r.slug} href={`/insights/${r.slug}`} className="inRelCard">
                  {r.art.kind === "library" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.art.art.src} srcSet={r.art.art.srcSet} sizes="(max-width: 900px) 100vw, 360px" width={r.art.art.width} height={r.art.art.height} alt="" loading="lazy" decoding="async" />
                  ) : <div className="inRelBrand" aria-hidden="true">{r.symbol}</div>}
                  <span className="inRelSym">{r.symbol} · {dayWords(r.date)}</span>
                  <span className="inRelTitle">{r.title}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <nav className="inEndLinks" aria-label={`${sym} pages`}>
          <p className="inRead">Compare this with the live stock page, news and earnings.</p>
          <div className="inEndRow">
            <Link href={`/stock/${sym}`}>{sym} stock page</Link>
            <Link href={`/stock/${sym}/news`}>News</Link>
            <Link href={`/stock/${sym}/earnings`}>Earnings</Link>
            <a href="/platforms" className="inTrade">Trade {sym} →</a>
          </div>
        </nav>
        <p className="inFine" data-fine-print="">{INSIGHT_FINE_PRINT}</p>
      </div>
      <style>{CSS}</style>
    </main>
  );
}

function Card({ eyebrow, title, children, attr }: { eyebrow: string; title?: string; children: ReactNode; attr?: string }) {
  return (
    <section className="inCard" {...(attr ? { [attr]: "" } : {})}>
      <div className="inEyebrow">{eyebrow}</div>
      {title ? <h2 className="inCardTitle">{title}</h2> : null}
      {children}
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="inStat" data-tone={tone}>
      <div className="inStatLabel">{label}</div>
      <div className="inStatValue">{value}</div>
      {sub ? <div className="inStatSub">{sub}</div> : null}
    </div>
  );
}

/** The "Chart when published" thumbnail: the closes to the publish date, no axes. */
function Spark({ closes }: { closes: number[] }) {
  const lo = Math.min(...closes), hi = Math.max(...closes), W = 240, H = 56;
  const pts = closes.map((c, i) => `${((i / (closes.length - 1)) * W).toFixed(1)},${(H - ((c - lo) / (hi - lo || 1)) * H).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="The price to the publish date" style={{ display: "block", maxWidth: 320 }}>
      <polyline points={pts} fill="none" stroke="rgba(203,213,225,0.8)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MoreCardView({ m, sym }: { m: MoreCard; sym: string }) {
  if (m.kind === "bottlenecks") {
    return (
      <Link href={m.href} className="inMoreCard" data-more="bottlenecks">
        <span className="inEyebrow">Bottlenecks</span>
        {m.count > 0 ? <span className="inMoreBig">×{m.count}</span> : null}
        {m.pages.length ? <MiniWeb center={sym} around={m.pages} /> : null}
        <span className="inRead">{m.count > 0 ? `Named on ${m.count} stock page${m.count === 1 ? "" : "s"} as a supplier or customer.` : `${sym}'s own suppliers and customers.`}</span>
        <span className="inMoreGo">{m.count > 0 ? `See who depends on ${m.company} →` : `See ${sym}'s bottlenecks →`}</span>
      </Link>
    );
  }
  if (m.kind === "capex") {
    return (
      <Link href={m.href} className="inMoreCard" data-more="capex">
        <span className="inEyebrow">Capex: follow the money</span>
        <span className="inMoreBig">#{m.mention.rank}</span>
        <span className="inRead">{m.mention.list === "spending" ? `Among the largest capex spenders: ${m.mention.amount} in its latest year.` : `On the receiving side: ${m.mention.line ?? "its build-out line"}, ${m.mention.amount}.`}</span>
        <span className="inMoreGo">AI and data-centre capex →</span>
      </Link>
    );
  }
  if (m.kind === "pickers") {
    return (
      <Link href={m.href} className="inMoreCard" data-more="pickers">
        <span className="inEyebrow">Screens</span>
        <span className="inMoreBig inMoreMid">{m.label}</span>
        <span className="inRead">Other stocks in the same kind of setup today.</span>
        <span className="inMoreGo">Open the screen →</span>
      </Link>
    );
  }
  const words = m.kind === "sector" ? { eyebrow: "Sector", big: m.name, line: `How the ${m.name} sector is moving.`, go: "Open the sector page →" }
    : m.kind === "calendar" ? { eyebrow: "Earnings calendar", big: "This week", line: "Who reports this week, and the latest results.", go: "Open the calendar →" }
    : { eyebrow: "The market", big: "S&P 500", line: "The index's trend, levels and this week's read.", go: "Open the S&P 500 page →" };
  return (
    <Link href={m.href} className="inMoreCard" data-more={m.kind}>
      <span className="inEyebrow">{words.eyebrow}</span>
      <span className="inMoreBig inMoreMid">{words.big}</span>
      <span className="inRead">{words.line}</span>
      <span className="inMoreGo">{words.go}</span>
    </Link>
  );
}

/** The stock in the middle and up to eight pages that name it around it. */
function MiniWeb({ center, around }: { center: string; around: string[] }) {
  const R = 38, C = 50;
  return (
    <svg viewBox="0 0 100 100" width="96" height="96" aria-hidden="true" className="inMiniWeb">
      {around.map((s, i) => {
        const a = -Math.PI / 2 + (i / around.length) * Math.PI * 2;
        return <line key={s} x1={C} y1={C} x2={C + R * Math.cos(a)} y2={C + R * Math.sin(a)} stroke="rgba(95,212,199,0.45)" strokeWidth={1} />;
      })}
      {around.map((s, i) => {
        const a = -Math.PI / 2 + (i / around.length) * Math.PI * 2;
        return <circle key={s} cx={C + R * Math.cos(a)} cy={C + R * Math.sin(a)} r={4} fill="#cbd5e1" />;
      })}
      <circle cx={C} cy={C} r={12} fill="#0b1220" stroke="#5FD4C7" strokeWidth={2} />
      <text x={C} y={C + 3} textAnchor="middle" fill="#f1f5f9" style={{ fontSize: "0.75rem", fontWeight: 800 }}>{center.slice(0, 4)}</text>
    </svg>
  );
}

// Reading sizes: --fs-read 1rem for reading text, --fs-label, --fs-fine for fine print.
const CSS = `
.inPage { min-height: 100vh; background: #06080d; color: #f1f5f9; font-family: system-ui, Arial, sans-serif; }
.inWrap { max-width: 1100px; margin: 0 auto; padding: 20px; box-sizing: border-box; }
.inCrumbs { font-size: var(--fs-label); color: rgba(203,213,225,0.7); margin-bottom: 12px; }
.inCrumbs a { color: #93c5fd; text-decoration: none; }
.inHero { position: relative; border-radius: 22px; overflow: hidden; min-height: 320px; display: flex; align-items: flex-end; border: 1px solid rgba(148,163,184,0.2); background: linear-gradient(135deg, #0d1f35, #060c18); }
.inHeroImg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.inHeroBrand { position: absolute; inset: 0; display: flex; align-items: center; justify-content: flex-end; padding-right: 6%; font-size: 6rem; font-weight: 950; color: rgba(95,212,199,0.12); letter-spacing: -0.04em; }
.inHeroShade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(6,8,13,0.15) 0%, rgba(6,8,13,0.72) 55%, rgba(6,8,13,0.96) 100%); }
.inHeroBody { position: relative; padding: 22px; width: 100%; box-sizing: border-box; }
.inHeroTop { display: flex; align-items: center; gap: 12px; }
.inHeroSym { font-size: 1.125rem; font-weight: 900; }
.inHeroCo { font-weight: 600; color: rgba(226,232,240,0.85); font-size: var(--fs-read); }
.inChips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.inChip { font-size: var(--fs-label); font-weight: 800; padding: 3px 9px; border-radius: 999px; border: 1px solid rgba(148,163,184,0.4); background: rgba(15,23,42,0.6); }
.inChip[data-tone="up"] { border-color: rgba(34,197,94,0.5); color: #86efac; }
.inChip[data-tone="down"] { border-color: rgba(239,68,68,0.5); color: #fca5a5; }
.inTitle { margin: 14px 0 0; font-size: 2rem; line-height: 1.15; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.inMeta { margin: 10px 0 0; font-size: var(--fs-read); line-height: var(--lh-read); color: rgba(226,232,240,0.85); }
.inSince { margin-top: 16px; border: 1px solid rgba(148,163,184,0.22); border-radius: 18px; padding: 16px; background: rgba(15,23,42,0.55); }
.inEyebrow { margin: 0; font-size: var(--fs-label); font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(147,197,253,0.85); display: block; }
.inStats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
.inStat { border: 1px solid rgba(148,163,184,0.18); border-radius: 14px; padding: 12px; min-width: 0; }
.inStatLabel { font-size: var(--fs-label); color: rgba(203,213,225,0.75); font-weight: 700; }
.inStatValue { margin-top: 4px; font-size: 1.5rem; font-weight: 900; font-variant-numeric: tabular-nums; }
.inStat[data-tone="up"] .inStatValue { color: #86efac; }
.inStat[data-tone="down"] .inStatValue { color: #fca5a5; }
.inStatSub { margin-top: 4px; font-size: var(--fs-read); color: rgba(203,213,225,0.75); line-height: 1.4; }
.inFine { margin: 10px 0 0; font-size: var(--fs-fine); line-height: 1.5; color: rgba(203,213,225,0.62); }
.inFine a, .inFineInline a { color: inherit; }
.inFineInline { font-size: var(--fs-fine); color: rgba(203,213,225,0.62); }
.inCols { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; margin-top: 16px; align-items: start; }
.inMain, .inRail { display: grid; gap: 16px; min-width: 0; }
.inCard, .inBlock { border: 1px solid rgba(148,163,184,0.22); border-radius: 18px; padding: 18px; background: linear-gradient(135deg, rgba(148,163,184,0.06), rgba(255,255,255,0.02)); min-width: 0; }
.inBlock { padding: 0; border: 0; background: none; }
.inCardTitle, .inH2 { margin: 6px 0 0; font-size: 1.25rem; line-height: 1.2; }
.inH2 { margin: 0 0 10px; }
.inRead { margin: 10px 0 0; font-size: var(--fs-read); line-height: var(--lh-read); color: rgba(226,232,240,0.92); }
.inDiff { margin: 8px 0 0; font-size: var(--fs-read); line-height: var(--lh-read); color: rgba(203,213,225,0.7); font-style: italic; }
.inProse { font-size: var(--fs-read); line-height: var(--lh-read); color: rgba(226,232,240,0.92); overflow-wrap: anywhere; }
.inProse a, .inSources a, .inLinks a { color: #93c5fd; }
.inProse h2 { font-size: 1.125rem; margin: 18px 0 6px; }
.inTap { margin-top: 12px; }
.inTap summary { cursor: pointer; font-size: var(--fs-read); font-weight: 800; color: #93c5fd; }
.inSources { margin: 12px 0 0; padding-left: 18px; font-size: var(--fs-read); line-height: var(--lh-read); }
.inScen { margin-top: 14px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.inScenBox { border-radius: 14px; padding: 12px; border: 1px solid rgba(34,197,94,0.3); background: rgba(34,197,94,0.06); min-width: 0; }
.inScenBox[data-tone="down"] { border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.06); }
.inScenBox[data-tone="up"] .inEyebrow { color: #86efac; }
.inScenBox[data-tone="down"] .inEyebrow { color: #fca5a5; }
.inScenBox .inRead { margin-top: 6px; }
.inDots li span::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 999px; margin-right: 8px; background: #94a3b8; vertical-align: middle; }
.inDots li[data-dot="up"] span::before { background: #22c55e; }
.inDots li[data-dot="down"] span::before { background: #ef4444; }
.inDots li[data-dot="last"] span::before { background: #38bdf8; }
.inDots li[data-dot="level"] span::before { background: #eab308; }
.inUp { color: #86efac; }
.inDown { color: #fca5a5; }
.inLinks { margin: 10px 0 0; font-size: var(--fs-read); }
.inList { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 8px; }
.inList li { display: flex; justify-content: space-between; gap: 10px; font-size: var(--fs-read); line-height: 1.4; }
.inList li span { color: rgba(203,213,225,0.85); min-width: 0; }
.inList li strong { font-variant-numeric: tabular-nums; white-space: nowrap; }
.inList li em { font-style: normal; font-size: var(--fs-label); color: rgba(203,213,225,0.75); }
.inPills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.inPill { font-size: var(--fs-label); font-weight: 800; padding: 5px 10px; border-radius: 999px; border: 1px solid rgba(95,212,199,0.4); color: #ccfbf1; text-decoration: none; }
.inToggles { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 8px; }
.inToggle { font: inherit; font-size: var(--fs-label); font-weight: 800; padding: 5px 10px; border-radius: 999px; border: 1px solid rgba(148,163,184,0.35); background: transparent; color: #e2e8f0; cursor: pointer; }
.inToggle[data-on="1"] { background: rgba(59,130,246,0.22); border-color: rgba(147,197,253,0.6); }
.inSlider { margin-top: 10px; }
.inSliderLabel { display: block; font-size: var(--fs-label); color: rgba(203,213,225,0.8); }
.inSlider input { width: 100%; margin-top: 6px; }
.inReadout { margin: 6px 0 0; font-size: var(--fs-read); line-height: var(--lh-read); color: rgba(226,232,240,0.92); }
.inThumb { margin: 14px 0 0; }
.inMore, .inRelated { margin-top: 24px; }
.inMoreGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.inMoreCard, .inRelCard { display: flex; flex-direction: column; gap: 6px; border: 1px solid rgba(148,163,184,0.22); border-radius: 18px; padding: 16px; text-decoration: none; color: inherit; background: rgba(15,23,42,0.5); min-width: 0; }
.inMoreBig { font-size: 1.75rem; font-weight: 950; color: #5fd4c7; }
.inMoreMid { font-size: 1.25rem; }
.inMoreGo { font-size: var(--fs-read); font-weight: 800; color: #93c5fd; margin-top: auto; }
.inMoreCard .inRead { margin: 0; }
.inRelCard { padding: 0; overflow: hidden; }
.inRelCard img, .inRelBrand { width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: cover; display: block; }
.inRelBrand { display: flex; align-items: center; justify-content: center; font-size: 2rem; font-weight: 950; color: rgba(95,212,199,0.35); background: linear-gradient(135deg, #0d1f35, #060c18); }
.inRelSym { padding: 10px 14px 0; font-size: var(--fs-label); color: rgba(203,213,225,0.75); font-weight: 800; }
.inRelTitle { padding: 0 14px 14px; font-size: var(--fs-read); line-height: 1.4; font-weight: 800; }
.inEndLinks { margin-top: 24px; border: 1px solid rgba(148,163,184,0.22); border-radius: 18px; padding: 16px 18px; background: rgba(15,23,42,0.5); }
.inEndLinks .inRead { margin: 0; color: rgba(203,213,225,0.8); }
.inEndRow { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.inEndRow a { font-size: var(--fs-read); font-weight: 800; color: #e2e8f0; text-decoration: none; padding: 8px 14px; border-radius: 12px; border: 1px solid rgba(59,130,246,0.35); background: rgba(30,58,138,0.25); }
.inEndRow .inTrade { color: #dcfce7; border-color: rgba(34,197,94,0.4); background: rgba(21,128,61,0.15); }
@media (max-width: 900px) {
  .inCols { grid-template-columns: minmax(0, 1fr); }
  .inStats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .inMoreGrid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .inScen { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 380px) {
  .inStats { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .inWrap { padding: 16px; }
  .inTitle { font-size: 1.5rem; }
  .inHero { min-height: 280px; }
}
`;
