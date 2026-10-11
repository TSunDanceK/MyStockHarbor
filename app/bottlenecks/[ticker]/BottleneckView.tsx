// THE INDIVIDUAL BOTTLENECK PAGE (#563 COWORK #158, the owner-approved AXON
// mock-up): one template for every page. Top to bottom: breadcrumb; hero with
// "At a glance" (two concentration meters and a price strip); the two-sided
// map; "Who {Company} depends on" and "Who buys from {Company}"; a row of
// three (what could change this map, partners at a glance, from the filings);
// sources & method; a short FAQ; keep exploring. Describes; never advises.
import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";
import { chartHref } from "@/lib/chartHref";
import { TIINGO_CREDIT, TIINGO_URL } from "@/lib/server/tiingoSurfacePrice";
import type { BottleneckCompany, BottleneckPost } from "@/lib/bottlenecks";
import type { BottleneckPageData, Move } from "@/lib/server/bottleneckPage";
import { GRADE_WORDS, initials, mapSide, unlistedWords, type FaqItem, type Meter } from "@/lib/bottleneckPage";
import BottleneckMap from "./BottleneckMap";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayWords = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return y && m && dd ? `${dd} ${MONTHS[m - 1]} ${y}` : d; };
const pct = (v: number | null) => (v === null ? "n/a" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`);
const toneOf = (v: number | null) => (v === null ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "flat");
const money = (v: number) => `$${v.toFixed(v >= 1000 ? 0 : 2)}`;

export type ViewModel = {
  post: BottleneckPost;
  name: string;
  data: BottleneckPageData;
  supplierMeter: Meter;
  customerMeter: Meter;
  faq: FaqItem[];
  listed: string[];
};

function MeterView({ id, title, m }: { id: string; title: string; m: Meter }) {
  return (
    <div className="bnMeter" data-meter={id} data-level={m.level}>
      <div className="bnMeterHead"><span>{title}</span><strong data-tone={m.level}>{m.level}</strong></div>
      <div className="bnMeterBar" aria-hidden="true"><i style={{ width: `${m.fill}%` }} data-tone={m.level} /></div>
      <div className="bnMeterEnds" aria-hidden="true"><span>Spread out</span><span>Concentrated</span></div>
      <p className="bnFine" data-fine-print="">{m.why}</p>
    </div>
  );
}

function MoveText({ m }: { m: Move | undefined }) {
  if (!m) return null;
  return <span className="bnMove" data-tone={toneOf(m.changePct)}>{pct(m.changePct)}</span>;
}

function DepRow({ c, side, i, d, hasFiledEarnings }: { c: BottleneckCompany; side: "s" | "c"; i: number; d: BottleneckPageData; hasFiledEarnings: boolean }) {
  const t = c.ticker;
  return (
    <li className="bnDep" id={`${side}-${i}`} data-dep="" data-grade={c.grade}>
      <div className="bnDepHead">
        {t ? <TickerLogo symbol={t} size={32} radius={8} alt="" /> : <span className="bnInitials" aria-hidden="true">{initials(c.name)}</span>}
        <div className="bnDepName">
          <strong>{c.name}</strong>
          <span className="bnGrade" data-grade={c.grade}>{GRADE_WORDS[c.grade]}</span>
        </div>
        <div className="bnShare"><span>~{c.pct}%</span><span className="bnShareBar" aria-hidden="true"><i style={{ width: `${Math.min(100, c.pct)}%` }} data-grade={c.grade} /></span></div>
      </div>
      {c.blurb ? <p className="bnWhy">{c.blurb}</p> : null}
      <div className="bnDepLinks">
        {t ? (
          <>
            <span className="bnTk">{t}</span>
            <MoveText m={d.moves[t]} />
            <Link href={chartHref(t)} prefetch={false} className="bnLink">Chart →</Link>
            {hasFiledEarnings ? <Link href={`/stock/${encodeURIComponent(t)}/earnings`} prefetch={false} className="bnLink" data-earnings-link="">Earnings →</Link> : null}
            {d.ownMaps.has(t) ? <Link href={`/bottlenecks/${t.toLowerCase()}`} prefetch={false} className="bnLink">{t}&apos;s own map →</Link> : null}
          </>
        ) : <span className="bnUnlisted">{unlistedWords(c.name, c.blurb)}</span>}
      </div>
    </li>
  );
}

export default function BottleneckView({ post, name, data: d, supplierMeter, customerMeter, faq, listed }: ViewModel) {
  const sym = post.symbol;
  const own = d.moves[sym];
  const left = mapSide(post.supplyChain, "s"), right = mapSide(post.customers, "c");
  const describe = `${name} depends on ${post.supplyChain.length} mapped supplier${post.supplyChain.length === 1 ? "" : "s"}${post.supplyChain[0] ? `, the largest ${post.supplyChain[0].name} at about ${post.supplyChain[0].pct}%` : ""}; ${post.customers.length} customer group${post.customers.length === 1 ? "" : "s"} depend on it${post.customers[0] ? `, the largest ${post.customers[0].name} at about ${post.customers[0].pct}%` : ""}.`;
  const partners = listed.filter((t) => t !== sym);
  const source = d.annualForm ? `Source: its ${d.annualForm} and public reporting` : "Source: company filings and public reporting";
  return (
    <div className="bnPage">
      <nav className="bnCrumbs" aria-label="Breadcrumb" data-bn="breadcrumb">
        <Link href="/bottlenecks">Bottlenecks</Link> ›{" "}
        {d.sector ? (d.sector.slug ? <Link href={`/sector/${d.sector.slug}`}>{d.sector.name}</Link> : <span>{d.sector.name}</span>) : <span>Company</span>} › <span>{sym}</span>
      </nav>

      <header className="bnHero" data-bn="hero">
        <div className="bnHeroLeft">
          <div className="bnHeroTop">
            <TickerLogo symbol={sym} size={44} radius={12} alt="" />
            <div>
              <span className="bnEyebrow">Bottlenecks · supply chain map</span>
              <p className="bnWho">{post.companyName}{d.sector ? ` · ${d.sector.name}` : ""}{post.category ? ` · ${post.category}` : ""}</p>
            </div>
          </div>
          <h1 className="bnH1">Who {name} depends on, and who depends on {name}</h1>
          <p className="bnLead">{post.summary}</p>
          <div className="bnChips" data-fine-print="">
            <span className="bnChip">{post.supplyChain.length} supplier{post.supplyChain.length === 1 ? "" : "s"} mapped</span>
            <span className="bnChip">{post.customers.length} customer group{post.customers.length === 1 ? "" : "s"}</span>
            {partners.length ? <span className="bnChip">{partners.length} listed partner{partners.length === 1 ? "" : "s"}: {partners.slice(0, 4).join(", ")}{partners.length > 4 ? "…" : ""}</span> : null}
            <span className="bnChip bnChipMuted">{source}</span>
          </div>
        </div>
        <aside className="bnGlance" aria-label="At a glance" data-bn="glance">
          <span className="bnEyebrow">At a glance</span>
          <MeterView id="supplier" title="Supplier concentration" m={supplierMeter} />
          <MeterView id="customer" title="Customer concentration" m={customerMeter} />
          <div className="bnPrice" data-price-strip="">
            {own ? (
              <p className="bnPriceLine"><strong>{money(own.close)}</strong> <MoveText m={own} /> <span className="bnFine" data-fine-print="">close on {dayWords(own.date)}</span></p>
            ) : <p className="bnFine" data-fine-print="">Today&apos;s close is not available yet.</p>}
            <div className="bnPriceLinks">
              <Link href={chartHref(sym)} prefetch={false} className="bnLink">Chart →</Link>
              {d.hasFiledEarnings[sym] ? <Link href={`/stock/${encodeURIComponent(sym)}/earnings`} prefetch={false} className="bnLink" data-earnings-link="">Earnings →</Link> : null}
              <Link href={`/stock/${encodeURIComponent(sym)}`} prefetch={false} className="bnLink">Stock page →</Link>
            </div>
          </div>
        </aside>
      </header>

      <section className="bnCard bnMapCard" data-bn="map" aria-labelledby="bnMapTitle">
        <h2 id="bnMapTitle" className="bnH2">The map</h2>
        <BottleneckMap symbol={sym} name={name} left={left} right={right} describe={describe} />
      </section>

      <div className="bnTwo" data-bn="cards">
        <section className="bnCard" id="suppliers" aria-labelledby="bnSupTitle">
          <h2 id="bnSupTitle" className="bnH2">Who {name} depends on</h2>
          {post.supplyChainNote ? <p className="bnNote">{post.supplyChainNote}</p> : null}
          {post.supplyChain.length ? <ul className="bnDeps">{post.supplyChain.map((c, i) => <DepRow key={`s${i}`} c={c} side="s" i={i} d={d} hasFiledEarnings={!!c.ticker && !!d.hasFiledEarnings[c.ticker]} />)}</ul> : <p className="bnNote">No suppliers are mapped yet.</p>}
        </section>
        <section className="bnCard" id="customers" aria-labelledby="bnCusTitle">
          <h2 id="bnCusTitle" className="bnH2">Who buys from {name}</h2>
          {post.customersNote ? <p className="bnNote">{post.customersNote}</p> : null}
          {post.customers.length ? <ul className="bnDeps">{post.customers.map((c, i) => <DepRow key={`c${i}`} c={c} side="c" i={i} d={d} hasFiledEarnings={!!c.ticker && !!d.hasFiledEarnings[c.ticker]} />)}</ul> : <p className="bnNote">No customers are mapped yet.</p>}
          <div className="bnReverse" data-reverse="">
            <div className="bnMeterHead bnReverseHead"><span>Other mapped stocks that name {sym}</span><strong>×{d.namedBy.count}</strong></div>
            {d.namedBy.names.length ? <p className="bnFine" data-fine-print="">{d.namedBy.names.map((t, i) => <span key={t}>{i ? ", " : ""}<Link href={`/bottlenecks/${t.toLowerCase()}`} prefetch={false}>{t}</Link></span>)}{d.namedBy.count > d.namedBy.names.length ? ` and ${d.namedBy.count - d.namedBy.names.length} more` : ""}</p>
              : <p className="bnFine" data-fine-print="">No other mapped page names {sym} yet.</p>}
          </div>
        </section>
      </div>

      <div className="bnThree" data-bn="row3">
        {post.watch.length ? (
          <section className="bnCard" data-watch="">
            <h2 className="bnH3">What could change this map</h2>
            {/* A bullet written "Label: text" shows its label in bold (#563 COWORK #159). */}
            <ul className="bnBullets">{post.watch.map((w) => { const m = w.match(/^([^:]{1,24}):\s+(.+)$/); return <li key={w}>{m ? <><strong>{m[1]}:</strong> {m[2]}</> : w}</li>; })}</ul>
            <p className="bnFine" data-fine-print="">Drawn from risk factors in {name}&apos;s own filings. Not a forecast.</p>
          </section>
        ) : null}
        <section className="bnCard" data-partners="">
          <h2 className="bnH3">Partners at a glance</h2>
          <ul className="bnPartners">
            {[sym, ...partners].map((t) => (
              <li key={t}>
                <Link href={chartHref(t)} prefetch={false} className="bnPartner"><TickerLogo symbol={t} size={22} radius={6} alt="" /><strong>{t}</strong></Link>
                {d.moves[t] ? <MoveText m={d.moves[t]} /> : <span className="bnFine" data-fine-print="">no close yet</span>}
              </li>
            ))}
          </ul>
          <p className="bnFine" data-fine-print="">Latest daily close vs the one before. Prices: <a href={TIINGO_URL} target="_blank" rel="noopener noreferrer">{TIINGO_CREDIT}</a></p>
        </section>
        {d.filed ? (
          <section className="bnCard" data-filed="">
            <h2 className="bnH3">From the filings</h2>
            <dl className="bnFiled">
              <div><dt>Revenue, {d.filed.period}</dt><dd>{d.filed.revenue}{d.filed.revenueYoY !== null ? <span className="bnMove" data-tone={toneOf(d.filed.revenueYoY)}> {pct(d.filed.revenueYoY)} y/y</span> : null}</dd></div>
              {d.filed.gross !== null ? <div><dt>Gross margin</dt><dd>{d.filed.gross.toFixed(1)}%{d.filed.grossPts !== null ? <span className="bnMove" data-tone={toneOf(d.filed.grossPts)}> {d.filed.grossPts > 0 ? "+" : d.filed.grossPts < 0 ? "−" : ""}{Math.abs(d.filed.grossPts).toFixed(1)} pt y/y</span> : null}</dd></div> : null}
              {d.filed.cogs ? <div><dt>Cost of sales</dt><dd>{d.filed.cogs}</dd></div> : null}
            </dl>
            <p className="bnFine" data-fine-print="">From its own SEC filings{d.filed.cogs ? "; cost of sales is revenue less gross profit" : ""}.</p>
            {d.hasFiledEarnings[sym] ? <Link href={`/stock/${encodeURIComponent(sym)}/earnings`} prefetch={false} className="bnLink" data-earnings-link="">{sym} filed earnings →</Link> : null}
          </section>
        ) : null}
      </div>

      <section className="bnCard" data-bn="sources" aria-labelledby="bnSrcTitle">
        <h2 id="bnSrcTitle" className="bnH3">Sources &amp; method</h2>
        <ul className="bnSources">
          {d.cik ? <li><a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${d.cik}&type=10-K`} target="_blank" rel="noopener noreferrer">{post.companyName} filings on SEC EDGAR</a></li> : null}
          {post.domain ? <li><a href={`https://${post.domain}`} target="_blank" rel="noopener noreferrer nofollow">{post.domain}</a> (investor and company information)</li> : null}
        </ul>
        <p className="bnRead">Shares are editorial estimates from company filings, earnings commentary and industry reporting, meant to show relative reliance; they are not audited figures. &quot;Hard to replace&quot; means few named alternatives in the filings. Updated {dayWords(post.updated || post.date)}. Not investment advice.</p>
      </section>

      <section className="bnCard" data-bn="faq" aria-labelledby="bnFaqTitle">
        <h2 id="bnFaqTitle" className="bnH3">Questions</h2>
        {faq.map((f) => (
          <details key={f.q} className="bnFaq">
            <summary>{f.q}</summary>
            <p className="bnRead">{f.a}</p>
          </details>
        ))}
      </section>

      <nav className="bnExplore" aria-label="Keep exploring" data-bn="explore">
        <h2 className="bnH3">Keep exploring</h2>
        <div className="bnExploreLinks">
          {partners.filter((t) => d.ownMaps.has(t)).slice(0, 4).map((t) => <Link key={t} href={`/bottlenecks/${t.toLowerCase()}`} prefetch={false} className="bnPill">{t}&apos;s map</Link>)}
          <Link href="/bottlenecks" prefetch={false} className="bnPill">All maps</Link>
          <Link href="/bottlenecks/capex" prefetch={false} className="bnPill">AI capex: follow the money</Link>
          <Link href={chartHref(sym)} prefetch={false} className="bnPill">{sym} chart</Link>
        </div>
      </nav>
    </div>
  );
}
