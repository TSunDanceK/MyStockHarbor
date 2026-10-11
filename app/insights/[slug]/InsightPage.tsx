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
import { Suspense, type ReactNode } from "react";
import TickerLogo from "@/app/components/TickerLogo";
import KeyLevelsCard from "@/app/stock/[symbol]/KeyLevelsCard";
import { epsVsYearAgo, marginVsYearAgo, VS_TINT, type Vs } from "@/lib/snapshotVsYearAgo";
import InsightChart from "./InsightChart";
import InsightVote from "./InsightVote";
import { TIINGO_CREDIT, TIINGO_URL } from "@/lib/server/tiingoSurfacePrice";
import { screenMembersFor, type InsightPageData, type MoreCard, type ScreenMember } from "@/lib/server/insightPage";
import type { ScreenFlag } from "@/lib/insightScreens";
import { dayWords, outcomeWords, pctWords, ptsWords } from "@/lib/insightView";

export type InsightHtml = { whatHappened: string | null; why: string | null; originalRest: string | null };

const money = (v: number) => `$${v >= 1000 ? v.toFixed(0) : v.toFixed(2)}`;
const bnWords = (v: number) => `$${(v / 1e9).toFixed(1)}bn`;
const newsDay = (d: string) => { const t = Date.parse(d); return Number.isFinite(t) ? dayWords(new Date(t).toISOString().slice(0, 10)) : d; };
const tone = (v: number | null | undefined) => (v === null || v === undefined || Math.abs(v) < 0.05 ? "flat" : v > 0 ? "up" : "down");

export const INSIGHT_FINE_PRINT =
  "Descriptive analysis of public information, not investment advice. The post's text is as published on its date; prices, levels and figures on this page update daily. Filed figures: SEC EDGAR.";

// hasFiledEarnings: the route's hasFiledEarnings(symbol) (#552 COWORK #197); the earnings links render only when true.
export default function InsightPage({ d, html, thumb, hasFiledEarnings = false }: { d: InsightPageData; html: InsightHtml; thumb: number[] | null; hasFiledEarnings: boolean }) {
  const { n } = d;
  const sym = n.symbol;
  const timeframe = n.timeframe === "w" ? "Weekly" : "Daily";
  const shortCard = (
    <Card eyebrow="The short version" attr="data-insight-summary">
      <p className="inRead" data-insight-summary-text="">{n.summary}</p>
      {d.difference ? <p className="inDiff" data-insight-difference="">{d.difference}</p> : null}
      {html.why ? (
        <details className="inTap"><summary>Why it mattered</summary><div className="inProse" dangerouslySetInnerHTML={{ __html: html.why }} /></details>
      ) : null}
    </Card>
  );
  const chartCard = (
    d.chart ? (
      <Card eyebrow="Did the level hold" title={d.chart.level ? `Did ${sym} hold its ${d.chart.level.name}?` : `${sym} since publication`}>
        <InsightChart symbol={sym} {...d.chart} />
        {thumb && thumb.length > 1 ? (
          <figure className="inThumb">
            <Spark closes={thumb} />
            <figcaption className="inFine" data-fine-print="">Chart when published: the {thumb.length} sessions to {dayWords(n.date)}.</figcaption>
          </figure>
        ) : null}
      </Card>
    ) : null
  );
  // WHAT'S DRIVING IT NOW (#563 COWORK #138 §1, corrected by #146): the writer's dated,
  // sourced paragraph first, then at most three headlines, smaller. Without a paragraph
  // (the old posts), the news page's tone line and headlines, as before.
  const newsCard = (
    <Card eyebrow={`What's driving ${sym} now`} title={`${sym} news and catalysts`} attr="data-insight-news">
      {n.drivers ? (
        <>
          <p className="inDriverAsOf" data-fine-print="" data-insight-drivers-asof="">As of {dayWords(n.drivers.asOf)}</p>
          <p className="inRead inDrivers" data-insight-drivers="">{n.drivers.text}</p>
          <p className="inDriverSources" data-fine-print="">
            Sources:{" "}
            {n.drivers.sources.map((src, i) => (
              <span key={src.url}>{i ? ", " : ""}<a href={src.url} target="_blank" rel="nofollow noopener" title={src.title}>{src.publisher}</a></span>
            ))}
          </p>
        </>
      ) : d.news?.score ? (
        <p className="inRead"><span className="inTone" data-tone={d.news.score.tone}>{d.news.score.label}</span> {d.news.score.reason}</p>
      ) : null}
      {d.news?.items.length ? (
        <div className={n.drivers ? "inNewsSmall" : undefined} {...(n.drivers ? { "data-fine-print": "" } : {})}>
          {n.drivers ? <div className="inEyebrow inNewsLabel">Latest headlines</div> : null}
          <ul className="inNews">
            {d.news.items.map((i) => (
              <li key={i.link}>
                <a href={i.link} target="_blank" rel="noopener noreferrer">{i.title}</a>
                <span className="inNewsMeta">{[i.source, i.date ? newsDay(i.date) : null].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : n.drivers ? null : <p className="inRead">No recent headlines.</p>}
      <p className="inLinks"><Link href={`/stock/${sym}/news`}>All {sym} news →</Link></p>
    </Card>
  );
  const whatCard = (
    html.whatHappened ? (
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
    ) : null
  );
  return (
    <main className="inPage">
      <div className="inWrap">
        <nav className="inCrumbs" aria-label="Breadcrumb"><Link href="/insights">Insights</Link> › <Link href={`/stock/${sym}`}>{sym}</Link></nav>

        {/* 1. HERO */}
        <header className="inHero" data-insight-hero="">
          {d.art.kind === "library" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="inHeroImg" src={d.art.art.src} srcSet={d.art.art.srcSet} sizes="(max-width: 1100px) 100vw, 1100px" width={d.art.art.width} height={d.art.art.height} alt={`Illustration for ${d.company} (${sym}): ${n.title}`} loading="eager" decoding="async" />
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
            <h2 className="inCardTitle inSinceTitle">{d.company} stock since this was published</h2>
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
            {n.update ? (
              <>
                {/* UPDATE (#563 COWORK #149 §3): the writer's dated note first, then the live cards,
                    then the post as published, under one heading. */}
                <section className="inCard inUpdate" data-insight-update="">
                  <div className="inEyebrow">Update · {dayWords(n.update.date)}</div>
                  <p className="inRead" data-insight-update-text="">{n.update.text}</p>
                </section>
                {chartCard}
                {newsCard}
                <section className="inOriginal" data-insight-original="">
                  <h2 className="inOriginalTitle">The original post · {dayWords(n.date)}</h2>
                  {shortCard}
                  {whatCard}
                </section>
              </>
            ) : (
              <>
                {shortCard}
                {chartCard}
                {newsCard}
                {whatCard}
              </>
            )}

            {/* YOUR READ (#563 COWORK #132/#133, PR 2): a reader poll per report window, never advice. */}
            <Card eyebrow="Your read" title={`Where do you think ${sym} goes into its next report?`} attr="data-insight-vote-card">
              <InsightVote slug={n.slug} window={d.vote.window} />
              {d.vote.called ? <p className="inRead" data-insight-vote-called="">{d.vote.called}</p> : null}
              <p className="inFine" data-fine-print="">A poll of readers, not a forecast or advice. Votes reset at each report; after it, the page shows how readers called it. One vote per browser per report.</p>
            </Card>
          </div>

          <aside className="inRail">
            {/* LEVELS TODAY (#563 COWORK #139): the Key levels pole, with the post's level as its own gold tick. */}
            {d.railBars.length ? (
              <div className="inRailPole" data-insight-levels="">
                <KeyLevelsCard bars={d.railBars} discussed={d.discussed} credit={d.onTiingo ? <a href={TIINGO_URL} target="_blank" rel="noopener noreferrer">{TIINGO_CREDIT}</a> : undefined} />
                <p className="inFine" data-fine-print="">Zones are where several levels sit close together. <Link href={`/stock/${sym}`}>All levels on the {sym} page →</Link></p>
              </div>
            ) : null}
            {/* LATEST EARNINGS, COMPACT (#563 COWORK #138 §3): the three tiles vs a year ago, the P/E line, the link. */}
            <Card eyebrow="From the filings" title={`${sym} latest earnings`} attr="data-insight-earnings">
              {d.snapshot?.available ? <EarningsTiles d={d} /> : <p className="inRead" data-insight-no-facts="">Filed figures not available yet.</p>}
              {hasFiledEarnings ? <p className="inLinks"><Link href={`/stock/${sym}/earnings`}>Full earnings →</Link></p> : null}
            </Card>
            {d.screens && d.screens.length ? (
              <section className="inCard inScreens">
                {/* THE FAINT CHART BEHIND IT (#563 COWORK #138 §6): decorative, low contrast. */}
                {d.screenChart ? <FaintChart closes={d.screenChart.closes} ref200={d.screenChart.ref} /> : null}
                <div className="inEyebrow">Showing up in screens</div>
                <h2 className="inCardTitle">{`${d.screens.length} screen${d.screens.length === 1 ? "" : "s"} today`}</h2>
                <div className="inPills" data-insight-screens="">{d.screens.map((s) => <Link key={s.href} href={s.href} className="inPill">{s.label}</Link>)}</div>
              </section>
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
            {hasFiledEarnings ? <Link href={`/stock/${sym}/earnings`}>Earnings</Link> : null}
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
    // BOTH DIRECTIONS (#563 COWORK #138 §4).
    return (
      <div className="inMoreCard" data-more="bottlenecks">
        <span className="inEyebrow">Bottlenecks</span>
        <MiniWeb center={sym} left={m.suppliers.map((s) => s.ticker ?? s.name)} right={m.dependants.names} />
        {m.suppliers.length ? (
          <>
            <h3 className="inH3">Who {m.company} depends on</h3>
            <ul className="inList inTight">{m.suppliers.map((s) => <li key={s.name}><span>{s.name}</span><strong>~{s.pct}%</strong></li>)}</ul>
          </>
        ) : null}
        {m.dependants.count > 0 ? (
          <>
            <h3 className="inH3">Who depends on {m.company} <span className="inMoreBig inInline">×{m.dependants.count}</span></h3>
            <p className="inRead">{m.dependants.names.join(", ")}{m.dependants.count > m.dependants.names.length ? ` and ${m.dependants.count - m.dependants.names.length} more` : ""}.</p>
          </>
        ) : null}
        <Link href={m.href} className="inMoreGo">{m.ownPage ? "See the full map →" : `See who depends on ${m.company} →`}</Link>
      </div>
    );
  }
  if (m.kind === "capex") {
    // FOLLOW THE MONEY, FLAT (#563 COWORK #156 §2): the company's own row on top,
    // then the other list's header and rows directly on the card, in the
    // dashboard's purple bars. No inner box: each figure is that company's own
    // filing, never a payment from one to the other.
    const flow = m.mention.list === "spending" ? m.flow.to : m.flow.from;
    const max = Math.max(1, ...flow.map((f) => f.value || 0));
    const spending = m.mention.list === "spending";
    return (
      <Link href={m.href} className="inMoreCard" data-more="capex">
        <span className="inEyebrow">Follow the money</span>
        <div className="inCxOwn" data-capex-own="">
          <TickerLogo symbol={sym} size={28} radius={7} alt="" />
          <div>
            <span className="inMoreBig"><span className="inCxSym">{sym}</span> #{m.mention.rank} · {spending ? (m.own ? bnWords(m.own.value) : m.mention.amount) : m.mention.amount}</span>
            <span className="inRead">{m.mention.list === "spending"
              ? (m.own ? `Capex in FY${m.own.year}${m.own.changePct !== null ? `, ${pctWords(m.own.changePct)} on the year before` : ""}, from its cash-flow statement.` : "Among the largest reported capex spenders.")
              : `${m.mention.line}, ${m.mention.fyTo}${m.mention.changePct !== null ? `, ${pctWords(m.mention.changePct)} on the year before` : ""}.`}</span>
          </div>
        </div>
        {flow.length ? (
          <div className="inCxOther" data-flow={m.mention.list}>
            <p className="inFlowHead" data-flow-head="">{spending ? "Top build-out receivers · their own filed sales" : "Top spenders · their own capex"}</p>
            <ul className="inCxList">
              {flow.map((f) => (
                <li key={f.ticker} className="inCxRow">
                  <TickerLogo symbol={f.ticker} size={22} radius={6} alt="" />
                  <span className="inCxSym">{f.ticker}</span>
                  <span className="inCxTrack" aria-hidden="true"><i className="inCxFill" style={{ width: `${Math.max(4, (100 * (f.value || 0)) / max)}%` }} /></span>
                  <span className="inCxAmt">{f.amount}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <span className="inFineInline" data-fine-print="">What suppliers sold, not a record of who paid them.</span>
        <span className="inMoreGo">AI and data-centre capex →</span>
      </Link>
    );
  }
  if (m.kind === "pickers") {
    // THE SCREEN'S OTHER MEMBERS (#563 COWORK #156 §1): up to 10, largest first,
    // streamed so the first visitor's page is not held up by the read.
    return (
      <div className="inMoreCard" data-more="pickers">
        <span className="inEyebrow">Screens</span>
        <Link href={m.href} className="inMoreBig inMoreMid inMoreTitleLink">{m.label}</Link>
        <span className="inRead">Other stocks in the same kind of setup today.</span>
        {m.flag ? (
          <Suspense fallback={<ul className="inScreenList" data-screen-skeleton="" aria-hidden="true">{[0, 1, 2].map((k) => <li key={k} className="inSkel" />)}</ul>}>
            <ScreenMembers flag={m.flag} sym={sym} />
          </Suspense>
        ) : <ScreenMembersList members={[]} />}
        <Link href={m.href} className="inMoreGo">Open the screen →</Link>
      </div>
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

/** The screen's members, read from the shared day's entry (0 commands while warm). */
async function ScreenMembers({ flag, sym }: { flag: ScreenFlag; sym: string }) {
  return <ScreenMembersList members={(await screenMembersFor(flag, sym)) ?? []} />;
}

/** Up to 10 members: logo, ticker, name on one line; or the empty state. */
export function ScreenMembersList({ members }: { members: ScreenMember[] }) {
  if (!members.length) return <p className="inRead" data-screen-empty="">No other stocks in this setup today.</p>;
  return (
    <ul className="inScreenList" data-screen-members={members.length}>
      {members.map((x) => (
        <li key={x.symbol}>
          <Link href={`/stock/${encodeURIComponent(x.symbol)}`} className="inScreenRow" title={x.name}>
            <TickerLogo symbol={x.symbol} size={20} radius={5} alt="" />
            <strong>{x.symbol}</strong>
            <span className="inScreenCo" data-fine-print="">{x.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Suppliers on the left feeding the stock in the middle; the pages that depend on it on the right. */
function MiniWeb({ center, left, right }: { center: string; left: string[]; right: string[] }) {
  const W = 220, H = 96, C = { x: W / 2, y: H / 2 };
  const at = (i: number, n: number, x: number) => ({ x, y: n === 1 ? H / 2 : 14 + (i * (H - 28)) / (n - 1) });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden="true" className="inMiniWeb" style={{ maxWidth: 260 }}>
      {left.map((s, i) => { const p = at(i, left.length, 40); return <line key={`l${s}`} x1={p.x} y1={p.y} x2={C.x - 14} y2={C.y} stroke="rgba(147,197,253,0.5)" strokeWidth={1} />; })}
      {right.map((s, i) => { const p = at(i, right.length, W - 40); return <line key={`r${s}`} x1={C.x + 14} y1={C.y} x2={p.x} y2={p.y} stroke="rgba(95,212,199,0.5)" strokeWidth={1} />; })}
      {left.map((s, i) => { const p = at(i, left.length, 40); return <g key={`lc${s}`}><circle cx={p.x} cy={p.y} r={3.5} fill="#93c5fd" /><text x={p.x - 7} y={p.y + 4} textAnchor="end" fill="#cbd5e1" style={{ fontSize: "0.75rem" }}>{s.slice(0, 5)}</text></g>; })}
      {right.map((s, i) => { const p = at(i, right.length, W - 40); return <circle key={`rc${s}`} cx={p.x} cy={p.y} r={3.5} fill="#5FD4C7" />; })}
      <circle cx={C.x} cy={C.y} r={14} fill="#0b1220" stroke="#5FD4C7" strokeWidth={2} />
      <text x={C.x} y={C.y + 4} textAnchor="middle" fill="#f1f5f9" style={{ fontSize: "0.75rem", fontWeight: 800 }}>{center.slice(0, 4)}</text>
    </svg>
  );
}

/** The screens card's background (#138 §6): the last closes and the screen's own line, faint, aria-hidden. */
function FaintChart({ closes, ref200 }: { closes: number[]; ref200: (number | null)[] | null }) {
  const vals = [...closes, ...(ref200 ?? []).filter((v): v is number => v !== null)];
  const lo = Math.min(...vals), hi = Math.max(...vals), W = 300, H = 120;
  const y = (v: number) => (H - ((v - lo) / (hi - lo || 1)) * (H - 10) - 5).toFixed(1);
  const line = (vs: (number | null)[]) => vs.map((v, i) => (v === null ? null : `${((i / (vs.length - 1)) * W).toFixed(1)},${y(v)}`)).filter(Boolean).join(" ");
  return (
    <svg className="inFaint" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {ref200 ? <polyline points={line(ref200)} fill="none" stroke="rgba(234,179,8,0.22)" strokeWidth={1.2} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null}
      <polyline points={line(closes)} fill="none" stroke="rgba(148,163,184,0.22)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The snapshot's three tiles against the same quarter a year earlier, the P/E line under them. */
const epsMoney = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
/**
 * THE EPS TILE'S YEAR-AGO LINE (#563 COWORK #141 §2). The shared rule words
 * only the loss cases ("loss narrowed from …"); a profit against a profit got
 * a tint and no words, so AMZN's tile said nothing. When both quarters exist,
 * say what the year-ago figure was.
 */
export function epsLine(now: number | null, ya: { label: string; eps: number | null } | null): Vs {
  const vs = epsVsYearAgo(now, ya?.eps, epsMoney);
  if (vs.words || now === null || !Number.isFinite(now) || ya?.eps == null || !Number.isFinite(ya.eps)) return vs;
  const then = epsMoney(ya.eps), when = ya.label ? `, ${ya.label}` : " a year earlier";
  const same = Math.round(now * 100) === Math.round(ya.eps * 100);
  return { tone: vs.tone, words: same ? `level with ${then}${when}` : `${now > ya.eps ? "up" : "down"} from ${then}${when}` };
}

function EarningsTiles({ d }: { d: InsightPageData }) {
  const s = d.snapshot!, ya = s.yearAgo ?? null;
  const tiles: { label: string; value: string; vs: Vs }[] = [
    { label: "EPS (diluted)", value: s.eps.value !== null ? `$${s.eps.value.toFixed(2)}` : "n/a", vs: epsLine(s.eps.value, ya) },
    { label: "Gross margin", value: s.margins.gross !== null ? `${s.margins.gross.toFixed(1)}%` : "n/a", vs: marginVsYearAgo(s.margins.gross, ya?.gross, ya?.label) },
    { label: "Operating margin", value: s.margins.operating !== null ? `${s.margins.operating.toFixed(1)}%` : "n/a", vs: marginVsYearAgo(s.margins.operating, ya?.operating, ya?.label) },
  ];
  return (
    <>
      {s.periodLabel ? <p className="inFine" data-fine-print="">{s.periodLabel}{s.comparedWith ? `, against ${s.comparedWith}` : ""}. Filed with the SEC.</p> : null}
      <div className="inTiles">
        {tiles.map((t) => (
          <div key={t.label} className="inTile" data-tone={t.vs.tone ?? "none"} style={t.vs.tone ? { background: VS_TINT[t.vs.tone] } : undefined}>
            <div className="inStatLabel">{t.label}</div>
            <div className="inTileValue">{t.value}</div>
            {t.vs.words ? <div className="inTileSub">{t.vs.words}</div> : null}
          </div>
        ))}
      </div>
      {d.pe ? <p className="inRead" data-insight-pe="">P/E {d.pe.value.toFixed(1)}: {d.pe.text}.</p> : null}
    </>
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
.inSinceTitle { margin: 0; font-size: 1.125rem; }
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
.inUpdate { border-color: rgba(250,204,21,0.45); background: linear-gradient(135deg, rgba(250,204,21,0.08), rgba(255,255,255,0.02)); }
.inUpdate .inEyebrow { color: rgba(253,224,71,0.9); }
.inUpdate .inRead { margin: 8px 0 0; }
.inOriginal { display: grid; gap: 16px; min-width: 0; padding-top: 8px; border-top: 1px solid rgba(148,163,184,0.22); }
.inOriginalTitle { margin: 0; font-size: 1.25rem; line-height: 1.2; }
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
.inVote { margin-top: 10px; }
.inVoteRow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.inVoteBtn { border: 1px solid rgba(148,163,184,0.28); background: #0b1220; color: #e2e8f0; border-radius: 12px; padding: 10px 8px; font-weight: 800; font-size: var(--fs-read); cursor: pointer; }
.inVoteBtn:hover { border-color: #34507a; }
.inVoteBtn:disabled { opacity: 0.6; cursor: default; }
.inVoteBtn[data-choice="higher"] span { color: #22c55e; }
.inVoteBtn[data-choice="lower"] span { color: #ef4444; }
.inVoteBar { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: #0b1220; margin-top: 4px; }
.inVoteBar i { display: block; height: 100%; }
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
.inSliderTrack { box-sizing: border-box; width: 100%; }
.inSlider input { -webkit-appearance: none; appearance: none; display: block; width: calc(100% + 18px); margin: 6px -9px 0; height: 18px; background: transparent; cursor: pointer; }
.inSlider input::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(to right, rgba(148,163,184,0.28) 0 var(--pub), #2f6bff var(--pub) 100%); }
.inSlider input::-moz-range-track { height: 4px; border-radius: 2px; background: linear-gradient(to right, rgba(148,163,184,0.28) 0 var(--pub), #2f6bff var(--pub) 100%); }
.inSlider input::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; margin-top: -7px; border-radius: 50%; background: #2f6bff; border: 2px solid #e2e8f0; box-sizing: border-box; }
.inSlider input::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #2f6bff; border: 2px solid #e2e8f0; box-sizing: border-box; }
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
.inTone { display: inline-block; font-size: var(--fs-label); font-weight: 800; padding: 2px 9px; border-radius: 999px; border: 1px solid rgba(234,179,8,0.45); color: #fde68a; margin-right: 6px; }
.inTone[data-tone="green"] { border-color: rgba(34,197,94,0.45); color: #86efac; }
.inTone[data-tone="red"] { border-color: rgba(239,68,68,0.45); color: #fca5a5; }
.inNews { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 10px; }
.inNews a { font-size: var(--fs-read); line-height: 1.45; color: #e2e8f0; font-weight: 700; text-decoration: none; overflow-wrap: anywhere; }
.inNews a:hover { text-decoration: underline; }
.inNewsMeta { display: block; margin-top: 2px; font-size: var(--fs-label); color: rgba(203,213,225,0.7); }
.inDriverAsOf { margin: 2px 0 0; font-size: var(--fs-fine); font-weight: 700; color: rgba(203,213,225,0.75); }
.inDrivers { margin: 6px 0 0; }
.inDriverSources { margin: 8px 0 0; font-size: var(--fs-fine); color: rgba(203,213,225,0.75); }
.inDriverSources a { color: inherit; }
.inNewsSmall { margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(148,163,184,0.16); }
.inNewsSmall .inNews { margin-top: 6px; gap: 8px; }
.inNewsSmall .inNews a { font-size: var(--fs-label); font-weight: 700; }
.inNewsLabel { margin: 0; }
.inRailPole { min-width: 0; }
.inTiles { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; margin-top: 10px; }
.inTile { border: 1px solid rgba(148,163,184,0.2); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.inTileValue { margin-top: 2px; font-size: 1.25rem; font-weight: 900; font-variant-numeric: tabular-nums; }
.inTileSub { font-size: var(--fs-label); color: rgba(203,213,225,0.8); }
.inScreens { position: relative; overflow: hidden; }
.inScreens > *:not(.inFaint) { position: relative; }
.inFaint { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.inH3 { margin: 10px 0 0; font-size: var(--fs-read); font-weight: 800; }
.inInline { font-size: 1.125rem; margin-left: 6px; }
.inTight { margin-top: 6px; gap: 4px; }
.inCxOwn { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; align-items: start; margin-top: 4px; }
.inCxOwn .inMoreBig, .inCxOwn .inRead { display: block; }
.inCxSym { font-weight: 900; color: #f8fafc; }
.inCxOther { margin-top: 10px; min-width: 0; }
.inCxList { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; min-width: 0; }
.inCxRow { display: grid; grid-template-columns: 22px auto minmax(16px, 1fr) auto; gap: 6px; align-items: center; height: 28px; font-size: var(--fs-label); }
.inCxTrack { display: block; height: 12px; border-radius: 4px; background: rgba(255,255,255,0.06); overflow: hidden; }
.inCxFill { display: block; height: 12px; border-radius: 4px; background: #a78bfa; }
.inCxAmt { font-weight: 900; white-space: nowrap; }
.inScreenList { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; min-width: 0; }
.inScreenList > li { min-width: 0; }
.inScreenRow { max-width: 100%; display: flex; align-items: center; gap: 8px; min-width: 0; color: #e2e8f0; text-decoration: none; font-size: var(--fs-label); }
.inScreenRow strong { color: #f8fafc; font-weight: 900; flex: 0 0 auto; }
.inScreenCo { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #94a3b8; }
.inSkel { height: 20px; border-radius: 6px; background: linear-gradient(90deg, rgba(148,163,184,0.10), rgba(148,163,184,0.18), rgba(148,163,184,0.10)); }
.inMoreTitleLink { color: inherit; text-decoration: none; }
.inFlowHead { margin: 0 0 4px; font-size: var(--fs-read); line-height: 1.35; font-weight: 800; color: rgba(203,213,225,0.85); }
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
