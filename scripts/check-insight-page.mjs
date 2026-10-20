// THE INSIGHT POST PAGE (#563 COWORK #132/#133): rules, then mutants.
//
// lib/insightView.ts (the figures) and lib/insightScreens.ts (the screens)
// are transpiled and run on synthetic daily bars with known answers; the page,
// the template and the fixture are read as source. Rules:
//   - "Since this was published": the move, then → now, the sessions, and
//     nothing before one session has closed after publication;
//   - the held / broke / reclaimed rule on daily closes, every outcome, with
//     its dates; now vs the level; the S&P comparison in points;
//   - one setup label from the data at publication, "testing" within 2%;
//   - an old post's level from its chart indicator; its summary once; its
//     scenarios as the two one-liners; the muted line where its words and its
//     data disagree (AMZN: "just above", the close below);
//   - the new format reads no price fields; sources must be https;
//   - the screens link only to picker routes;
//   - no advice words in anything the template writes;
//   - the fixture is served off production only and never listed;
//   - SEO (#138): an Article with the hero picture and dateModified from the
//     post's own "updated", Insights › TICKER › post, one h1, the hero's alt;
//   - the rail (#138/#139): the Key levels pole with the level discussed, the
//     filed tiles or "not available yet", and the news card's empty state;
//   - drivers (#146): the loader's validation on fixtures (missing, bad date,
//     empty, bad URL, too many sources); every post's `drivers` valid and free
//     of advice words; the card leads with the dated paragraph, its sources as
//     nofollow publisher links, then at most three headlines, and falls back to
//     the tone line without it; junk headlines are skipped with B's predicate
//     (lib/server/news/junkTitle.ts, #818), never a copy of it;
//   - update (#149): the loader's validation on fixtures (missing, bad date,
//     empty text); every post's `update` valid, free of advice words and dated
//     as its `updated`; AMZN's text exactly as the owner wrote it; the box
//     leads the body and the original sections sit under one dated heading.
//   - #177: a post dated on a day with no closed session (a weekend, or a
//     Monday before the close) reads "Published {its date}" and "the 120
//     sessions to {the last closed session}"; the drivers' source line names
//     each publisher once, its sources numbered links ("Archer Aviation (1, 2)").
//   - #181: the "More on" sector card carries the sector's figures (the side
//     box's row, no second read) and up to 8 same-sector peers with a map or a
//     post here, never the post's own ticker; no peers, no heading; the mini
//     map's labels are a ticker or a whole word, on every bottleneck page.
//   - heroArt: a post's `heroArt` names an image in the news-art manifest (an
//     unknown name fails here, it never falls back silently); the loader puts
//     it ahead of the automatic plan; UMAC's is the drone; the share image and
//     the JSON-LD use the hero's picture.
//   - the "Earnings calendar" card: up to 4 of the week's reporters from the
//     dashboard's shared list, the post's own ticker first, "+N more", the link
//     last; the S&P 500 card: the index close, SPY's day and 5 sessions, the
//     Trend score, each only when it exists; neither predicts; no new read;
//     the page-data cache key bumped.
// A mutant each.
//
//   node scripts/check-insight-page.mjs
import fs from "node:fs";
import ts from "typescript";
import { stripComments } from "./lib/source-code.mjs";
import matter from "gray-matter";

const VIEW = "lib/insightView.ts", SCREENS = "lib/insightScreens.ts", PAGE = "app/insights/[slug]/InsightPage.tsx", ROUTE = "app/insights/[slug]/page.tsx";
const PRICE = "app/components/PriceChart.tsx";
const CHART = "app/insights/[slug]/InsightChart.tsx", LOADER = "lib/server/insightPage.ts", TEMPLATE = "content/templates/insight-template.md";
const FIXTURE = "content/insights-fixtures/fixture-aapl-new-format.md", AMZN = "content/insights/amzn-daily-ma200-buy-zone-july-2026.md";
const read = (f) => fs.readFileSync(f, "utf8");
const OG = "app/insights/[slug]/opengraph-image.tsx", UMAC = "content/insights/umac-softer-q3-before-q4-ramp-october-2026.md";
// Every post's frontmatter, both folders: the heroArt rule reads them from here so a mutant can swap one.
const POSTS = ["content/insights", "content/insights-fixtures"].flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(".md")).map((f) => ({ file: `${d}/${f}`, data: matter(read(`${d}/${f}`)).data })));
const MANIFEST = JSON.parse(read("public/news-art/manifest-v2.json"));
// The owner's words for AMZN's update (#563 COWORK #149 §3), verbatim.
const AMZN_UPDATE = "This post was written two days before Amazon's Q2 report on 30 July. That report has since come and gone: Amazon raised its 2026 capital-spending estimate to about $220bn, and AWS growth sped up again. The strip above shows how the price has moved since, and whether the 200-day held. The next test may be the Q3 report, expected around 29 October; \"What's driving AMZN now\" below has the details. The original post follows, unchanged.";

let n = 0;
async function load(src, name) {
  const js = ts.transpileModule(src.replace(/^import type[^;]+;$/gm, ""), { fileName: `${name}.ts`, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const tmp = `scripts/.check-insight-page-${process.pid}-${n++}.mjs`;
  fs.writeFileSync(tmp, js);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

// ── Synthetic bars ──────────────────────────────────────────────────────────
// Weekdays from 2025-01-01; `close(i)` decides the path. 300 bars, so the 200-day exists.
const days = (() => { const out = []; for (let t = Date.parse("2025-01-01T00:00:00Z"); out.length < 330; t += 86_400_000) { const d = new Date(t); if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10)); } return out; })();
const series = (fn) => days.map((d, i) => { const c = fn(i); return [d, c, c, c, c, 1e6]; });
const FLAT = 100;
// A flat 100 for 300 sessions (the 200-day sits at 100), publication on bar 299, then a path.
const after = (path) => series((i) => (i < 300 ? FLAT : path[i - 300] ?? path.at(-1)));
const PUB = days[299];
const LEVELS_FLAT = Array(330).fill(FLAT);

const RULES = {
  "'Since this was published': the move, then → now and the sessions; nothing before a session has closed": ({ V }) => {
    const bars = after([102, 104, 110]);
    const s = V.sinceView(bars.slice(0, 303), null, PUB, undefined);
    const none = V.sinceView(bars.slice(0, 300), null, PUB, undefined);
    return none === null && s.sessions === 3 && s.thenClose === 100 && s.nowClose === 110 && Math.abs(s.movePct - 10) < 1e-9 && s.thenDate === PUB && s.nowDate === days[302] && s.level === null && s.vsSpxPts === null;
  },
  "the held / broke rule on daily closes: held, broke (its date), broke and reclaimed, stayed below, reclaimed, reclaimed and lost": ({ V }) => {
    const o = (start, path) => V.levelOutcome([...Array(300).fill(FLAT), ...path].map((c, i) => (i === 299 ? start : c)), LEVELS_FLAT, days, 299);
    const a = o(101, [102, 100, 103]), b = o(101, [102, 99, 98]), c = o(101, [99, 98, 101]), d = o(99, [98, 97]), e = o(99, [101, 102]), f = o(99, [101, 98]);
    // Broke, came back, broke again: the date is the FIRST close below.
    const g = o(101, [99, 101, 98]);
    return g.kind === "broke" && g.on === days[300] && a.kind === "held" && b.kind === "broke" && b.on === days[301] && c.kind === "broke-reclaimed" && c.on === days[300] && c.back === days[302] &&
      d.kind === "stayed-below" && e.kind === "reclaimed" && e.on === days[300] && f.kind === "reclaimed-lost" && f.on === days[300] && f.lost === days[301];
  },
  "now vs the level and vs the S&P 500 in points": ({ V }) => {
    const bars = after([105, 110]).slice(0, 302), spy = after([102, 104]).slice(0, 302);
    const s = V.sinceView(bars, spy, PUB, "MA200");
    return s.level && s.level.name === "200-day average" && Math.abs(s.level.thenPct) < 1e-9 && s.level.nowPct > 9 && s.level.nowPct < 10 &&
      s.level.outcome.kind === "held" && Math.abs(s.vsSpxPts - (10 - 4)) < 1e-9 && V.ptsWords(6) === "+6.0 pts" && V.pctWords(-2.14) === "−2.1%";
  },
  "one setup label from the data at publication: testing within 2%, above, below; no level, the trend": ({ V }) => {
    const at = (c) => V.setupLabel(series((i) => (i < 299 ? FLAT : c)), days[299], "MA200").text;
    const up = V.setupLabel(series((i) => 50 + i * 0.5), days[299], undefined).text;
    return at(101.5) === "Testing the 200-day average" && at(103) === "Above the 200-day average" && at(97) === "Below the 200-day average" &&
      V.TESTING_PCT === 2 && /^Uptrend/.test(up);
  },
  "an old post: its level from its chart indicator; the summary once; its scenarios as the two one-liners": ({ V }) => {
    // gray-matter, as the site reads it (the post carries a nested `drivers` block since #146).
    const { data, content: body } = matter(read(AMZN));
    const p = V.normaliseInsight("amzn", data, body);
    return p.format === "v1" && p.levels.join() === "MA200" && p.summary === data.excerpt && /^AMZN holds the 200-day/.test(p.bull) && /^Amazon raises capex guidance/.test(p.bear) &&
      /^Amazon has pulled back/.test(p.whatHappened) && p.claimedSide === "above" && !/## What happened|## Bull vs bear/.test(p.originalRest) && /## Levels to watch/.test(p.originalRest) &&
      V.levelFromIndicators(["MA200"], "w").join() === "WMA200" && V.levelFromIndicators(["Bollinger(20,2)"], "d").join() === "BBMID" && V.levelFromIndicators(["RSI(14)"], "d").length === 0;
  },
  "the muted line where an old post's words and its data disagree": ({ V }) => {
    const n = { levels: ["MA200"], claimedSide: "above", date: days[299] };
    const below = series((i) => (i < 299 ? FLAT : 97.9)), above = series((i) => (i < 299 ? FLAT : 101));
    return V.differenceNote(n, below) === "At publication the close was 2.1% below the 200-day average." && V.differenceNote(n, above) === null && V.differenceNote({ ...n, claimedSide: null }, below) === null;
  },
  "the new format: no price fields read, https sources only, the fixture parses": ({ V }) => {
    const data = { title: "T", date: "2026-09-15", symbol: "aapl", eventType: "level-test", timeframe: "d", levels: ["MA50", "PRICE"], summary: "S", price: 123.45, level: 99,
      sources: [{ title: "ok", url: "https://www.sec.gov/x" }, { title: "bad", url: "http://x" }], bull: "b", bear: "c" };
    const p = V.normaliseInsight("x", data, "## What happened\n\nW");
    const fx = read(FIXTURE);
    return p.format === "v2" && p.symbol === "AAPL" && p.levels.join() === "MA50" && p.sources.length === 1 && !JSON.stringify(p).includes("123.45") && p.whatHappened === "W" &&
      /^eventType: "level-test"$/m.test(fx) && !/^(price|chartBars|chartIndicators|close|marketCap):/m.test(fx) &&
      /\*\*No price fields, ever\.\*\*/.test(read(TEMPLATE)) && !/^chartBars:|^chartIndicators:/m.test(read(TEMPLATE));
  },
  "the screens link only to picker routes; the setup's screen first": ({ S }) => {
    const routes = read("lib/pickerRoutes.ts");
    return Object.values(S.SCREEN_ROUTES).every((r) => routes.includes(`"${r.href}"`)) &&
      S.screenFor({ text: "Testing the 200-day average" }, ["aboveMA50", "dailyMa200Proximity"]).href === "/stocks-near-200-day-moving-average" &&
      S.screenFor({ text: "Mixed trend" }, ["oversold"]).href === "/oversold-stocks-today" && S.screenFor(null, null) === null;
  },
  "no advice words in anything the template writes; no emoji in its headings": ({ V, S }) => {
    const ADVICE = /\b(buy|buying|sell|selling|should|must|recommend\w*|buy zone|target)\b/i;
    const strings = (src, file) => [...stripComments(src, { file }).matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`]*)`|>([^<>{}]+)</g)].map((m) => m[1] ?? m[2] ?? m[3]).filter((s) => s && /[a-z]{3}/i.test(s) && !/^[\w.-]+$/.test(s) && !/^[-\w\s:;,()%#.]+$/.test(s.trim()) || (s && /\s/.test(s.trim())));
    const page = strings(read(PAGE), PAGE).filter((s) => !/^\s*\.?in[A-Z]|^\.|^@media|^\s*[a-z-]+:/.test(s));
    const words = [V.outcomeWords({ kind: "held" }), V.outcomeWords({ kind: "broke", on: "2026-01-02" }), V.outcomeWords({ kind: "reclaimed-lost", on: "2026-01-02", lost: "2026-01-05" })].flatMap((o) => [o.word, o.detail]);
    const all = [...page, ...strings(read(CHART), CHART), ...words, ...Object.values(S.SCREEN_ROUTES).map((r) => r.label)];
    return all.length > 30 && all.every((s) => !ADVICE.test(s ?? "")) && !/\p{Extended_Pictographic}/u.test(all.join(" ")) && V.stripEmoji("📈 What happened") === "What happened";
  },
  // #563 COWORK #138/#139, read as source (the Chromium measure renders them).
  "SEO: an Article with the hero picture, dateModified from the post's own 'updated', a 3-step breadcrumb; one h1": ({ route, page }) =>
    /"@type": "Article"/.test(route) && /image: \[heroImage\]/.test(route) && /const modifiedTime = data\.n\.updated \? new Date\(data\.n\.updated\)\.toISOString\(\) : publishedTime;/.test(route) &&
    /dateModified: modifiedTime,/.test(route) && /name: "Insights",[\s\S]*?name: sym,[\s\S]*?name: post\.title,/.test(route) && !/"@type": "BlogPosting"/.test(route) &&
    (page.match(/<h1 /g) ?? []).length === 1 && /alt=\{`Illustration for \$\{d\.company\} \(\$\{sym\}\): \$\{n\.title\}`\}/.test(page),
  "the rail: the Key levels pole with the level discussed; filed tiles, or 'not available yet' without facts; news with its empty state": ({ page, loader }) =>
    /<KeyLevelsCard bars=\{d\.railBars\} discussed=\{d\.discussed\}/.test(page) && /discussed: level && lvNow !== null \? \{ label: SHORT\[level\], value: lvNow \} : null,/.test(loader) &&
    /\{d\.snapshot\?\.available \? <EarningsTiles d=\{d\} \/> : <p className="inRead" data-insight-no-facts="">Filed figures not available yet\.<\/p>\}/.test(page) &&
    /: <p className="inRead">No recent headlines\.<\/p>\}/.test(page) && /getStockNewsBaseData\(sym, \{ maxDetailedItems: 5 \}\)/.test(loader) && !/LatestEarningsCard/.test(page),
  "#141: the flow's header names whose figures they are (flat since #156); the EPS tile gives its year-ago figure": ({ page }) => {
    const heads = /\{spending \? "Top build-out receivers · their own filed sales" : "Top spenders · their own capex"\}/.test(page) &&
      /<div className="inCxOther" data-flow=\{m\.mention\.list\}>\s*<p className="inFlowHead" data-flow-head="">/.test(page);
    const fn = page.match(/const epsMoney = [^\n]*\n[\s\S]*?export function epsLine[\s\S]*?\n\}/)?.[0];
    if (!heads || !fn || !/vs: epsLine\(s\.eps\.value, ya\)/.test(page)) return false;
    const js = ts.transpileModule(`${read("lib/snapshotVsYearAgo.ts")}\n${fn.replace(/^export /m, "")}\nexports.epsLine = epsLine;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: {} };
    new Function("module", "exports", js)(mod, mod.exports);
    const { epsLine } = mod.exports, ya = (eps) => ({ label: "Q2 FY2025", eps });
    return epsLine(1.68, ya(1.26)).words === "up from $1.26, Q2 FY2025" && epsLine(1.0, ya(1.26)).words === "down from $1.26, Q2 FY2025" &&
      epsLine(1.26, ya(1.26)).words === "level with $1.26, Q2 FY2025" && /loss narrowed from -\$0\.71/.test(epsLine(-0.2, ya(-0.71)).words ?? "") &&
      epsLine(1.68, null).words !== "up from" && epsLine(null, ya(1.26)).words === null;
  },
  "drivers: the loader rejects a malformed paragraph whole and keeps a good one": ({ V }) => {
    const src = (n) => Array.from({ length: n }, (_, i) => ({ title: `Article ${i}`, publisher: `Pub ${i}`, url: `https://example.com/a${i}` }));
    const ok = { asOf: "2026-10-07", text: "Amazon heads into its Q3 report.", sources: src(3) };
    const good = V.parseDrivers(ok), dated = V.parseDrivers({ ...ok, asOf: new Date("2026-10-07T00:00:00Z") });
    const bad = (over) => V.parseDrivers({ ...ok, ...over });
    return good.drivers?.sources.length === 3 && good.problems.length === 0 && dated.drivers?.asOf === "2026-10-07" &&
      V.parseDrivers(undefined).drivers === null && V.parseDrivers(undefined).problems.length === 0 &&
      bad({ asOf: "7 Oct" }).drivers === null && bad({ asOf: "2026-02-30" }).drivers === null && bad({ text: "  " }).drivers === null &&
      bad({ sources: [] }).drivers === null && bad({ sources: src(6) }).drivers === null && bad({ sources: src(5) }).drivers !== null &&
      bad({ sources: [{ title: "x", publisher: "y", url: "http://example.com/a" }] }).drivers === null &&
      bad({ sources: [{ title: "x", publisher: "", url: "https://example.com/a" }] }).drivers === null &&
      V.normaliseInsight("x", { title: "t", date: "2026-07-28", symbol: "amzn", drivers: ok }, "").drivers?.text === ok.text &&
      V.normaliseInsight("x", { title: "t", date: "2026-07-28", symbol: "amzn", drivers: { ...ok, sources: [] } }, "").drivers === null;
  },
  "drivers: every post's paragraph validates, is dated and advises nothing": ({ V }) => {
    const ADVICE = /\b(buy|buying|sell|selling|should|must|recommend\w*|buy zone|target)\b/i;
    const files = [...fs.readdirSync("content/insights").map((f) => `content/insights/${f}`), ...fs.readdirSync("content/insights-fixtures").map((f) => `content/insights-fixtures/${f}`)].filter((f) => f.endsWith(".md"));
    const withDrivers = files.map((f) => matter(read(f)).data).filter((d) => d.drivers !== undefined);
    return withDrivers.length >= 1 && withDrivers.every((d) => {
      const r = V.parseDrivers(d.drivers);
      return r.drivers && !ADVICE.test(r.drivers.text) && (!d.updated || V.parseUpdate(d.update).update?.date === String(d.updated));
    });
  },
  "drivers: the card leads with the dated paragraph, nofollow sources, at most three headlines, the old layout without it": ({ page, loader, V }) =>
    /<Card eyebrow=\{`What's driving \$\{sym\} now`\} title=\{`\$\{sym\} news and catalysts`\}/.test(page) &&
    /data-insight-drivers-asof="">As of \{dayWords\(n\.drivers\.asOf\)\}<\/p>/.test(page) &&
    /<p className="inRead inDrivers" data-insight-drivers="">\{n\.drivers\.text\}<\/p>/.test(page) &&
    /rel="nofollow noopener"/.test(page) && /\{src\.publisher\}/.test(page) &&
    /\) : d\.news\?\.score \? \(/.test(page) && /Latest headlines/.test(page) &&
    /export const NEWS_SHOWN = 3;/.test(loader) && /junkReason\(i\.title\) === null\)\.slice\(0, NEWS_SHOWN\)/.test(loader) &&
    /import \{ junkReason \} from "@\/lib\/server\/news\/junkTitle";/.test(loader) && !/isJunkHeadline/.test(read(VIEW)),
  "update: the loader rejects a malformed note whole and keeps a good one": ({ V }) => {
    const ok = { date: "2026-10-07", text: "Since then, the report came out." };
    const bad = (over) => V.parseUpdate({ ...ok, ...over });
    return V.parseUpdate(ok).update?.text === ok.text && V.parseUpdate(ok).problems.length === 0 &&
      V.parseUpdate({ ...ok, date: new Date("2026-10-07T00:00:00Z") }).update?.date === "2026-10-07" &&
      V.parseUpdate(undefined).update === null && V.parseUpdate(undefined).problems.length === 0 &&
      bad({ date: "7 Oct" }).update === null && bad({ date: "2026-02-30" }).update === null && bad({ text: "  " }).update === null &&
      V.parseUpdate("a note").update === null && V.parseUpdate(["a"]).update === null &&
      V.normaliseInsight("x", { title: "t", date: "2026-07-28", symbol: "amzn", update: ok }, "").update?.date === "2026-10-07" &&
      V.normaliseInsight("x", { title: "t", date: "2026-07-28", symbol: "amzn", eventType: "level-test", summary: "s", update: ok }, "").update?.text === ok.text &&
      V.normaliseInsight("x", { title: "t", date: "2026-07-28", symbol: "amzn", update: { ...ok, text: "" } }, "").update === null;
  },
  "update: every post's note validates, advises nothing and is dated as its 'updated'; AMZN's text as written": ({ V }) => {
    const ADVICE = /\b(buy|buying|sell|selling|should|must|recommend\w*|buy zone|target)\b/i;
    const files = [...fs.readdirSync("content/insights").map((f) => `content/insights/${f}`), ...fs.readdirSync("content/insights-fixtures").map((f) => `content/insights-fixtures/${f}`)].filter((f) => f.endsWith(".md"));
    const withUpdate = files.map((f) => matter(read(f)).data).filter((d) => d.update !== undefined);
    const amzn = V.parseUpdate(matter(read(AMZN)).data.update).update;
    return withUpdate.length >= 1 && withUpdate.every((d) => {
      const u = V.parseUpdate(d.update).update;
      return u && !ADVICE.test(u.text) && String(d.updated) === u.date;
    }) && amzn?.date === "2026-10-07" && amzn.text === AMZN_UPDATE;
  },
  "update: the box leads the body; the original sections under one dated heading; no update, the old order": ({ page }) => {
    const withU = page.match(/\{n\.update \? \(([\s\S]*?)\) : \(([\s\S]*?)\)\}/);
    if (!withU) return false;
    const order = (block, names) => names.map((x) => block.indexOf(x)).every((v, i, a) => v >= 0 && (i === 0 || v > a[i - 1]));
    const orig = withU[1].match(/<section className="inOriginal" data-insight-original="">([\s\S]*?)<\/section>/)?.[1] ?? "";
    return order(withU[1], ["data-insight-update=", "{chartCard}", "{newsCard}", "data-insight-original="]) &&
      /<div className="inEyebrow">Update · \{dayWords\(n\.update\.date\)\}<\/div>/.test(withU[1]) &&
      /<p className="inRead" data-insight-update-text="">\{n\.update\.text\}<\/p>/.test(withU[1]) &&
      /<h2 className="inOriginalTitle">The original post · \{dayWords\(n\.date\)\}<\/h2>/.test(orig) && order(orig, ["{shortCard}", "{whatCard}"]) &&
      order(withU[2], ["{shortCard}", "{chartCard}", "{newsCard}", "{whatCard}"]) && (page.match(/\{shortCard\}/g) ?? []).length === 2;
  },
  // #563 COWORK #155: the slider IS the chart's x-axis, over the plot area, and marks its bar.
  "#155 slider: the chart's own sessions, the plot area's width, a marker on the bar, pre-publication labelled": ({ chart, price }) =>
    /<input id="inSliderRange" type="range" min=\{0\} max=\{last\} step=\{1\} value=\{i\}/.test(chart) && /marker=\{span >= 1 \? i : null\}/.test(chart) &&
    /paddingLeft: `calc\(\$\{\(PRICE_CHART_PAD\.left \/ PRICE_CHART_PAD\.width\) \* 100\}% \+ 1px\)`, paddingRight: `calc\(\$\{\(PRICE_CHART_PAD\.right \/ PRICE_CHART_PAD\.width\) \* 100\}% - 1px\)`/.test(chart) &&
    /\{before \? "before publication" : `\$\{pct\(/.test(chart) && /const before = i < p\.publishIndex;/.test(chart) &&
    /export const PRICE_CHART_PAD = \{ left: 34, right: 54, width: 760 \} as const;/.test(price) && /const padL = 34;/.test(price) && /const padR = 54;/.test(price) &&
    /<circle data-chart-marker-dot="" cx=\{x\(marker\)\} cy=\{yMain\(series\[marker\]\.close\)\}/.test(price),
  // #563 COWORK #156 §1: the screen's other members, from one shared day's entry, streamed.
  "#156 screens: up to 10 members, own ticker out, largest first, from one shared 24 h entry, streamed, with an empty state": ({ page, loader }) =>
    /export const SCREEN_MEMBERS = 10;/.test(loader) && /out\[flag\] = syms\.slice\(0, SCREEN_MEMBERS \+ 1\)/.test(loader) &&
    /\(PRESET_RANK\.get\(a\) \?\? 1e6\) - \(PRESET_RANK\.get\(b\) \?\? 1e6\)/.test(loader) &&
    /\["insight-screen-members-v1"\],\s*\{ revalidate: 86400/.test(loader) && /readScreenMembers\(easternDate\(new Date\(\)\)\)/.test(loader) &&
    /\.filter\(\(m\) => m\.symbol !== own\.toUpperCase\(\)\)\.slice\(0, SCREEN_MEMBERS\)/.test(loader) &&
    /<Suspense fallback=\{<ul className="inScreenList" data-screen-skeleton=""/.test(page) && /<ScreenMembers flag=\{m\.flag\} sym=\{sym\} \/>/.test(page) &&
    /data-screen-empty="">No other stocks in this setup today\.<\/p>/.test(page) && /title=\{x\.name\}/.test(page) &&
    /\.inScreenCo \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/.test(read(PAGE)) && /Open the screen →<\/Link>/.test(page),
  // #563 COWORK #156 §2: Follow the money is one card, its rows directly on it, in the dashboard's purple bars.
  "#156 follow the money: no card inside the card; the company row on top; purple bars": ({ page }) =>
    !/inFlowBox|inFlowArrow/.test(page) && !/\.inCxOther \{[^}]*border/.test(read(PAGE)) && /<div className="inCxOwn" data-capex-own="">/.test(page) &&
    page.indexOf('data-capex-own=""') < page.indexOf('data-flow-head=""') && /\.inCxFill \{[^}]*background: #a78bfa;/.test(read(PAGE)),
  "the fixture is served off production only, noindex, and never listed": () => {
    const loader = stripComments(read(LOADER), { file: LOADER }), route = stripComments(read(ROUTE), { file: ROUTE });
    return /export const fixturesServed = \(\) => process\.env\.VERCEL_ENV !== "production";/.test(loader) && /fixturesServed\(\) && /.test(loader) &&
      /robots: isInsightFixture\(slug\) \? \{ index: false, follow: false \}/.test(route) && !fs.existsSync("content/insights/fixture-aapl-new-format.md") &&
      !/insights-fixtures/.test(read("lib/blog.ts")) && !/insights-fixtures/.test(read("app/sitemap.ts"));
  },
  "#177 no-session day: the publish bar is the last close on or before the post's date; 'Published' keeps the post's date, the thumbnail names the session": ({ V, chart, page, route, loader }) => {
    const bars = series(() => FLAT);
    const fri = days.findIndex((d, i) => i > 10 && new Date(`${d}T00:00:00Z`).getUTCDay() === 5);
    const sat = new Date(Date.parse(`${days[fri]}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const onSat = V.publishBar(bars, sat), past = V.publishBar(bars, "2099-01-05"), on = V.publishBar(bars, days[fri - 2]);
    return onSat?.index === fri && onSat.session === days[fri] && past?.session === days.at(-1) && on?.index === fri - 2 && on.session === days[fri - 2] &&
      V.publishBar([], sat) === null &&
      /const at = publishBar\(bars, n\.date\);/.test(loader) && /publishedOn: n\.date,/.test(loader) && /thumbTo = at\.session;/.test(loader) &&
      /Published \{day\(p\.publishedOn\)\}\. The slider appears once a session has closed since\./.test(chart) &&
      /the \{thumb\.length\} sessions to \{dayWords\(thumbTo \?\? n\.date\)\}/.test(page) &&
      /const thumbTo = frozen && frozen\.length > 1 \? snapshot\?\.chartPoints\?\.at\(-1\)\?\.date \?\? null : data\.thumbTo;/.test(route) && /thumbTo=\{thumbTo\}/.test(route);
  },
  "#181 sector card: the sector's figures and same-sector peers (never the post's own ticker); no peers, no heading": ({ V, page, loader }) => {
    const sec = { ACHR: "Industrials", JOBY: "Industrials", BA: "Industrials", HON: "Industrials", AAPL: "Technology", GEV: "Industrials" };
    const of = (s) => sec[s] ?? null;
    const mapped = [{ symbol: "JOBY", companyName: "Joby Aviation, Inc." }, { symbol: "AAPL", companyName: "Apple Inc." }, { symbol: "HON", companyName: "Honeywell" }, { symbol: "ACHR", companyName: "Archer" }];
    const p = V.sectorPeers("achr", "Industrials", mapped, ["JOBY", "BA", "ACHR", "AAPL", "GEV"], of, (s) => `${s} Co`);
    const many = V.sectorPeers("X", "Industrials", Array.from({ length: 12 }, (_, i) => ({ symbol: `I${i}`, companyName: `I${i}` })), [], () => "Industrials", (s) => s);
    return p.map((x) => x.symbol).join() === "JOBY,HON,BA,GEV" && p[0].name === "Joby Aviation, Inc." && p[2].name === "BA Co" &&
      V.sectorPeers("achr", "Utilities", mapped, ["JOBY"], of, (s) => s).length === 0 && many.length === V.SECTOR_PEERS && V.SECTOR_PEERS === 8 &&
      /data-sector-figures="">/.test(page) && /\{fig\("Year to date", mv\.ytd, 2\)\}/.test(page) && /\{fig\("Latest session", mv\.day\)\}/.test(page) &&
      /\{fig\("This week", mv\.week\)\}/.test(page) && /\{fig\("This month", mv\.month\)\}/.test(page) && /Rank, latest session<\/span><strong>\{mv\.rank\} of 11/.test(page) &&
      /\{peers\.length \? \(\s*<>\s*<h3 className="inH3" data-sector-peers-head="">Other \{m\.name\} on MyStockHarbor<\/h3>\s*<ScreenMembersList members=\{peers\} \/>/.test(page) &&
      /<ScreenMembersList members=\{peers\} \/>\s*<\/>\s*\) : null\}\s*<Link href=\{m\.href\} className="inMoreGo">Open the sector page →<\/Link>/.test(page) &&
      /move: sectorRow \? \{ day: sectorRow\.day, week: sectorRow\.week, month: sectorRow\.month, ytd: sectorRow\.ytd, rank: sectorRow\.rank \} : null,/.test(loader) && /peers: sectorPeers\(sym, sector\.name,/.test(loader);
  },
  "#181 mini map: each label a ticker or a whole word of the name, on every bottleneck page; the centre a full ticker": ({ V, page }) => {
    const bn = fs.readdirSync("content/bottlenecks").filter((f) => f.endsWith(".md")).map((f) => matter(read(`content/bottlenecks/${f}`)).data);
    const whole = (c) => { const l = V.miniLabel(c.name, c.ticker ?? null); return c.ticker ? l === String(c.ticker) : c.name.split(/[\s,(/]+/).map((w) => w.replace(/[^\p{L}\p{N}]+$/u, "")).includes(l) && l.length > 0; };
    const tops = bn.flatMap((d) => [...(d.supplyChain ?? [])].sort((x, y) => y.pct - x.pct).slice(0, 4));
    return bn.length > 100 && tops.length > 300 && tops.every(whole) &&
      V.miniLabel("Molicel (E-One Moli Energy)", null) === "Molicel" && V.miniLabel("Single-source and custom manufacturers", null) === "Single-source" && V.miniLabel("Stellantis N.V.", "STLA") === "STLA" &&
      /left=\{m\.suppliers\.map\(\(s\) => miniLabel\(s\.name, s\.ticker\)\)\}/.test(page) && /\{left\.map\(\(s, i\) => <li key=\{i\}>\{s\}<\/li>\)\}/.test(page) &&
      /fontWeight: 800 \}\}>\{center\}<\/text>/.test(page) && !/\.slice\(0, [45]\)/.test(page) && /\.inMiniLabels li \{[^}]*white-space: nowrap;/.test(page);
  },
  "#177 sources: one label per publisher, its sources numbered links": ({ V, page }) => {
    const src = (publisher, url) => ({ title: `${publisher} story`, publisher, url });
    const g = V.sourceGroups([src("Archer Aviation", "https://a.example/1"), src("StockTitan", "https://s.example/1"), src("Archer Aviation", "https://a.example/2")]);
    return g.length === 2 && g[0].publisher === "Archer Aviation" && g[0].items.map((i) => i.url).join() === "https://a.example/1,https://a.example/2" &&
      g[1].publisher === "StockTitan" && g[1].items.length === 1 &&
      /sourceGroups\(n\.drivers\.sources\)\.map\(/.test(page) && /\{g\.publisher\} \(\{g\.items\.map\(/.test(page) && /data-source-n="">\{j \+ 1\}<\/a>/.test(page);
  },
  "heroArt: every name is in the manifest (with its files), read by the loader ahead of the plan; UMAC's is the drone": ({ V, loader, route, posts, manifest }) => {
    const named = posts.filter((p) => p.data.heroArt !== undefined);
    const known = (n) => typeof n === "string" && Object.hasOwn(manifest, n) && fs.existsSync(`public/news-art/${n}.webp`) && fs.existsSync(`public/news-art/${n}-sm.webp`);
    const umac = posts.find((p) => p.file === UMAC);
    return named.length >= 1 && named.every((p) => known(p.data.heroArt)) && umac?.data.heroArt === "aerospace-defence-any-04" &&
      V.normaliseInsight("x", { title: "t", date: "2026-10-18", symbol: "umac", eventType: "earnings", summary: "s", heroArt: " aerospace-defence-any-04 " }, "").heroArt === "aerospace-defence-any-04" &&
      V.normaliseInsight("x", { title: "t", date: "2026-10-18", symbol: "umac", eventType: "earnings", summary: "s" }, "").heroArt === null &&
      /if \(post\.heroArt\) \{\s*const art = taggedArtByName\(post\.heroArt\);\s*if \(art\) \{\s*taken\.names\.add\(post\.heroArt\);\s*return \{ kind: "library", art \};/.test(loader) &&
      loader.indexOf("taggedArtByName(post.heroArt)") < loader.indexOf("return planSymbolCardArt(") &&
      /const art = artFor\(sym, n\.title, `insight:\$\{slug\}`, taken, \{ heroArt: n\.heroArt, summary: n\.summary \}\);/.test(loader) &&
      /return Object\.hasOwn\(ENTRIES, name\) \? artFor\(name\) : null;/.test(read("lib/server/news/artTags.ts")) &&
      /const heroImage = data\.art\.kind === "library" \? `https:\/\/www\.mystockharbor\.com\$\{data\.art\.art\.src\}`/.test(route) &&
      /if \(d\?\.art\.kind === "library"\) art = await heroArt\(d\.art\.art\.src\);/.test(stripComments(read(OG), { file: OG }));
  },
  "the calendar card: up to 4 of the week's reporters, the post's own first, '+N more', the link last; from the shared list": ({ V, page, loader }) => {
    const wk = ["A", "B", "UMAC", "C", "D", "E"].map((symbol) => ({ symbol }));
    const own = V.calendarRows(wk, "umac"), other = V.calendarRows(wk, "ZZZ"), few = V.calendarRows(wk.slice(0, 2), "A");
    const card = page.match(/if \(m\.kind === "calendar"\) \{[\s\S]*?\n  \}\n/)?.[0] ?? "";
    return V.CALENDAR_ROWS === 4 && own.rows.map((r) => r.symbol).join() === "UMAC,A,B,C" && own.rows[0].own && !own.rows[1].own && own.more === 2 &&
      other.rows.map((r) => r.symbol).join() === "A,B,UMAC,C" && other.rows.every((r) => !r.own) && other.more === 2 && few.more === 0 && few.rows.length === 2 &&
      /data-calendar-rows=\{w\.rows\.length\}/.test(card) && /\{w\.more > 0 \? <span className="inRead" data-calendar-more="">\+\{w\.more\} more in the calendar<\/span> : null\}/.test(card) &&
      /<span className="inCalDay">\{r\.day\}<\/span>/.test(card) && /<TickerLogo symbol=\{r\.symbol\}/.test(card) &&
      /<Link href=\{m\.href\} className="inMoreGo">Open the calendar →<\/Link>\s*<\/div>\s*\);\s*\}\s*$/.test(card) &&
      /readComingUpWeeks\(easternDate\(new Date\(nowMs\)\)\)/.test(loader) && /const cal = wk \? calendarRows\(wk\.items, sym\) : null;/.test(loader) &&
      /readComingUpWeeks\(easternDate\(new Date\(\)\)\)/.test(stripComments(read("lib/server/dashboardCards.ts"), { file: "lib/server/dashboardCards.ts" })) &&
      !/getCalendarForwardSections|readPricePoolBulk/.test(loader) && /\["insight-page-data-v7"\]/.test(loader);
  },
  "the S&P 500 card: index close, SPY's day and 5 sessions, the Trend score, each only when it exists; from bars already read": ({ V, page, loader }) => {
    const m = V.spyMoves(series((i) => 100 + i).slice(0, 10)), one = V.spyMoves(series(() => FLAT).slice(0, 1));
    const card = page.slice(page.indexOf("const x = m.market;"), page.indexOf("async function ScreenMembers"));
    return Math.abs(m.dayPct - ((109 - 108) / 108) * 100) < 1e-9 && Math.abs(m.weekPct - ((109 - 104) / 104) * 100) < 1e-9 && m.date === days[9] &&
      one.dayPct === null && one.weekPct === null && V.spyMoves([]) === null &&
      /\{x\.index \? <li><span>Index close, \{dayWords\(x\.index\.date\)\}<\/span><strong>\{indexWords\(x\.index\.close\)\}<\/strong><\/li> : null\}/.test(card) &&
      /v === null \|\| v === undefined \? null :/.test(card) && /\{move\("Past 5 sessions \(SPY\)", x\.moves\?\.weekPct\)\}/.test(card) &&
      /\{x\.trend \? <li><span>Trend score<\/span><strong>\{x\.trend\.score\}\/100<\/strong><\/li> : null\}/.test(card) &&
      !/—|n\/a|N\/A/.test(card) && /Open the S&amp;P 500 page →<\/Link>\s*<\/div>\s*\);\s*\}\s*$/.test(card) &&
      /if \(more\.length < 3\) more\.push\(\{ kind: "spx", href: "\/markets\/spx", market: spxFigures\(spy\) \}\);/.test(loader) &&
      (loader.match(/readTiingoHistory\(/g) ?? []).length === 2 && /parseSpxWeekly\(JSON\.parse\(fs\.readFileSync\(path\.join\(process\.cwd\(\), "content\/markets\/spx-weekly\.json"\)/.test(loader);
  },
  "neither card predicts: no forecast words in the calendar or S&P card": ({ page }) => {
    const cards = page.slice(page.indexOf('if (m.kind === "calendar") {'), page.indexOf("async function ScreenMembers"));
    // The whole source of both cards (comments already stripped): the words sit in JSX text and template strings alike.
    const words = cards.replace(/not a forecast/g, "");
    return cards.length > 500 && /Dates can move\./.test(cards) && !/\b(will|won't|likely|expect\w*|poised|set to|forecast\w*|predict\w*|should|target)\b/i.test(words);
  },
};

const MUTANTS = [
  ["'Since this was published'", "v", (s) => s.replace("if (from < 0 || bars.length - 1 - from < 1) return null;", "if (from < 0) return null;")],
  ["'Since this was published'", "v", (s) => s.replace("const movePct = ((nowClose - thenClose) / thenClose) * 100;", "const movePct = ((nowClose - thenClose) / nowClose) * 100;")],
  ["the held / broke rule", "v", (s) => s.replace('if (s !== start) firstCross ??= dates[i];', "if (s !== start) firstCross = dates[i];")],
  ["the held / broke rule", "v", (s) => s.replace('return cur === "above" && lastBack ? { kind: "broke-reclaimed", on: firstCross, back: lastBack } : { kind: "broke", on: firstCross };', 'return { kind: "broke", on: firstCross };')],
  ["the held / broke rule", "v", (s) => s.replace('closes[i] >= (levels[i] as number) ? "above" : "below"', 'closes[i] > (levels[i] as number) + 1 ? "above" : "below"')],
  ["now vs the level", "v", (s) => s.replace("if (s0 >= 0 && s1 > s0) vsSpxPts = movePct - ((spy[s1][4] - spy[s0][4]) / spy[s0][4]) * 100;", "if (s0 >= 0 && s1 > s0) vsSpxPts = movePct;")],
  ["one setup label", "v", (s) => s.replace("export const TESTING_PCT = 2;", "export const TESTING_PCT = 5;")],
  ["an old post:", "v", (s) => s.replace('if (ind === "MA200") return [timeframe === "w" ? "WMA200" : "MA200"];', 'if (ind === "MA200") return ["MA200"];')],
  ["an old post:", "v", (s) => s.replace("const summary = str(data.excerpt) || str(data.overallBreakdown);", "const summary = `${str(data.excerpt)} ${str(data.overallBreakdown)}`;")],
  ["the muted line", "v", (s) => s.replace("if (actual === n.claimedSide) return null;", "")],
  ["the new format:", "v", (s) => s.replace(".filter((s): s is InsightSource => !!s && !!s.title && /^https:\\/\\//.test(s.url));", ".filter((s): s is InsightSource => !!s && !!s.title);")],
  ["drivers: the loader", "v", (s) => s.replace("if (list.length < 1 || list.length > DRIVERS_MAX_SOURCES)", "if (list.length > 99)")],
  ["drivers: the loader", "v", (s) => s.replace("if (!/^https:\\/\\/[^\\s/]+\\.[^\\s]+$/.test(src.url))", "if (!/^https?:\\/\\//.test(src.url))")],
  ["drivers: the loader", "v", (s) => s.replace("return problems.length ? { drivers: null, problems } :", "return false ? { drivers: null, problems } :")],
  ["update: the loader", "v", (s) => s.replace('return problems.length ? { update: null, problems } :', 'return false ? { update: null, problems } :')],
  ["update: the loader", "v", (s) => s.replace('...(text ? [] : ["update.text is empty"])', "")],
  ["update: the loader", "v", (s) => s.replace("const update = parseUpdate(data.update).update;", "const update = null;")],
  ["the screens link", "s", (s) => s.replace('href: "/oversold-stocks-today"', 'href: "/oversold-today"')],
  ["#177 no-session day", "v", (s) => s.replace("return { index, session: bars[index][0] };", "return { index, session: date };")],
  ["#181 sector card", "v", (s) => s.replace(".filter((s) => s !== me && sectorOfName(s) === sectorName)", ".filter((s) => sectorOfName(s) === sectorName)")],
  ["#181 sector card", "v", (s) => s.replace(".filter((s) => s !== me && sectorOfName(s) === sectorName)", ".filter((s) => s !== me)")],
  ["#181 mini map", "v", (s) => s.replace("  if (ticker) return ticker;\n  const first", "  if (ticker) return ticker;\n  return name.slice(0, 5);\n  const first")],
  ["#177 sources", "v", (s) => s.replace("if (g) g.items.push(s);", "if (g && false) g.items.push(s);")],
  ["heroArt:", "v", (s) => s.replace("const heroArt = str(data.heroArt) || null;", "const heroArt = null;")],
  ["the calendar card:", "v", (s) => s.replace("const picked = [...(mine ? [mine] : []), ...items.filter((i) => i !== mine)].slice(0, max);", "const picked = items.slice(0, max);")],
  ["the calendar card:", "v", (s) => s.replace("more: Math.max(0, items.length - picked.length)", "more: 0")],
  ["the S&P 500 card:", "v", (s) => s.replace("return { date: last[0], dayPct: vs(1), weekPct: vs(5) };", "return { date: last[0], dayPct: vs(1), weekPct: vs(4) };")],
  ["no advice words", "v", (s) => s.replace('case "held": return { word: "Held", detail: "No daily close below it since", tone: "up" };', 'case "held": return { word: "Held", detail: "A level to buy while it holds", tone: "up" };')],
];

// Source mutants: [rule start, file, mutation].
const SRC_MUTANTS = [
  ["#155 slider", CHART, (s) => s.replace('min={0} max={last} step={1} value={i}', 'min={p.publishIndex} max={last} step={1} value={i}')],
  ["#155 slider", CHART, (s) => s.replace(/style=\{\{ paddingLeft: `calc\([^`]*`, paddingRight: `calc\([^`]*` \}\}/, "style={{}}")],
  ["#155 slider", CHART, (s) => s.replace("marker={span >= 1 ? i : null}", "")],
  ["#155 slider", CHART, (s) => s.replace('{before ? "before publication" : `${pct(', '{false ? "before publication" : `${pct(')],
  ["#156 screens", LOADER, (s) => s.replace(".filter((m) => m.symbol !== own.toUpperCase()).slice(0, SCREEN_MEMBERS)", ".slice(0, SCREEN_MEMBERS)")],
  ["#156 screens", LOADER, (s) => s.replace("export const SCREEN_MEMBERS = 10;", "export const SCREEN_MEMBERS = 20;")],
  ["#156 screens", PAGE, (s) => s.replace("No other stocks in this setup today.", "")],
  ["#156 screens", PAGE, (s) => s.replace("<Suspense fallback=", "<div data-x=").replace("</Suspense>", "</div>")],
  ["#156 follow the money", PAGE, (s) => s.replace('<div className="inCxOther" data-flow={m.mention.list}>', '<div className="inCxOther inFlowBox" data-flow={m.mention.list}>')],
  ["SEO:", ROUTE, (s) => s.replace("dateModified: modifiedTime,", "dateModified: new Date().toISOString(),")],
  ["SEO:", ROUTE, (s) => s.replace('"@type": "Article",', '"@type": "BlogPosting",')],
  ["the rail:", PAGE, (s) => s.replace("<KeyLevelsCard bars={d.railBars} discussed={d.discussed}", "<KeyLevelsCard bars={d.railBars}")],
  ["#141:", PAGE, (s) => s.replace('"Top build-out receivers · their own filed sales"', '"Build-out sellers"')],
  ["#141:", PAGE, (s) => s.replace("vs: epsLine(s.eps.value, ya)", "vs: epsVsYearAgo(s.eps.value, ya?.eps, epsMoney)")],
  ["#141:", PAGE, (s) => s.replace('`${now > ya.eps ? "up" : "down"} from ${then}${when}`', "null")],
  ["drivers: the card", PAGE, (s) => s.replaceAll('rel="nofollow noopener"', 'rel="noopener"')],
  ["#177 no-session day", CHART, (s) => s.replace("Published {day(p.publishedOn)}.", "Published {day(pub.date)}.")],
  ["#177 no-session day", PAGE, (s) => s.replace("sessions to {dayWords(thumbTo ?? n.date)}", "sessions to {dayWords(n.date)}")],
  ["#177 no-session day", LOADER, (s) => s.replace("thumbTo = at.session;", "thumbTo = n.date;")],
  ["#177 sources", PAGE, (s) => s.replace('data-source-n="">{j + 1}</a>', 'data-source-n="">{src.publisher}</a>')],
  ["#181 sector card", PAGE, (s) => s.replace("{peers.length ? (\n          <>\n            <h3", "{true ? (\n          <>\n            <h3")],
  ["#181 sector card", PAGE, (s) => s.replace('            {fig("Year to date", mv.ytd, 2)}\n', "")],
  ["#181 sector card", LOADER, (s) => s.replace("move: sectorRow ? { day: sectorRow.day, week: sectorRow.week, month: sectorRow.month, ytd: sectorRow.ytd, rank: sectorRow.rank } : null,", "move: null,")],
  ["#181 mini map", PAGE, (s) => s.replace("{left.map((s, i) => <li key={i}>{s}</li>)}", "{left.map((s, i) => <li key={i}>{s.slice(0, 5)}</li>)}")],
  ["#181 mini map", PAGE, (s) => s.replace("left={m.suppliers.map((s) => miniLabel(s.name, s.ticker))}", "left={m.suppliers.map((s) => s.ticker ?? s.name)}")],
  ["drivers: the card", PAGE, (s) => s.replace(") : d.news?.score ? (", ") : null}{d.news?.score ? (")],
  ["drivers: the card", LOADER, (s) => s.replace("export const NEWS_SHOWN = 3;", "export const NEWS_SHOWN = 5;")],
  ["drivers: the card", LOADER, (s) => s.replace("&& junkReason(i.title) === null)", ")")],
  ["update: the box", PAGE, (s) => s.replace("The original post · {dayWords(n.date)}", "The original post")],
  ["update: the box", PAGE, (s) => s.replace("{chartCard}\n                {newsCard}\n                <section", "<section")],
  ["update: the box", PAGE, (s) => s.replace("{shortCard}\n                  {whatCard}\n                </section>", "</section>\n                {shortCard}\n                {whatCard}")],
  ["heroArt:", LOADER, (s) => s.replace("  if (post.heroArt) {\n", "  if (false && post.heroArt) {\n")],
  ["heroArt:", LOADER, (s) => s.replace("taken, { heroArt: n.heroArt, summary: n.summary });", "taken, { summary: n.summary });")],
  ["the calendar card:", PAGE, (s) => s.replace('{w.more > 0 ? <span className="inRead" data-calendar-more="">+{w.more} more in the calendar</span> : null}', "")],
  ["the calendar card:", LOADER, (s) => s.replace("calendarRows(wk.items, sym)", 'calendarRows(wk.items, "")')],
  ["the calendar card:", LOADER, (s) => s.replace('["insight-page-data-v7"]', '["insight-page-data-v6"]')],
  ["the S&P 500 card:", PAGE, (s) => s.replace("{x.index ? <li><span>Index close, {dayWords(x.index.date)}</span><strong>{indexWords(x.index.close)}</strong></li> : null}", "<li><span>Index close</span><strong>{x.index ? indexWords(x.index.close) : \"—\"}</strong></li>")],
  ["the S&P 500 card:", LOADER, (s) => s.replace("market: spxFigures(spy) });", "market: null });")],
  ["neither card predicts", PAGE, (s) => s.replace("Dates can move.</span>", "Dates can move. Expect a busy week.</span>")],
  ["neither card predicts", PAGE, (s) => s.replace("a reading of the trend so far, not a forecast.</span>", "the index will likely keep rising.</span>")],
  ["the rail:", PAGE, (s) => s.replace('{d.snapshot?.available ? <EarningsTiles d={d} /> : <p className="inRead" data-insight-no-facts="">Filed figures not available yet.</p>}', "<EarningsTiles d={d} />")],
];
const R = Object.keys(RULES);
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch (e) { if (process.env.DEBUG) console.log(e); return false; } };
const srcOf = (over = {}) => ({ chart: stripComments(over[CHART] ?? read(CHART), { file: CHART }), price: stripComments(over[PRICE] ?? read(PRICE), { file: PRICE }), route: stripComments(over[ROUTE] ?? read(ROUTE), { file: ROUTE }), page: stripComments(over[PAGE] ?? read(PAGE), { file: PAGE }), loader: stripComments(over[LOADER] ?? read(LOADER), { file: LOADER }) });
const measure = async (v = read(VIEW), s = read(SCREENS), over = {}) => ({ V: await load(v, "view"), S: await load(s, "screens"), posts: POSTS, manifest: MANIFEST, ...srcOf(over) });

console.log("=== Rules ===");
const base = await measure();
for (const label of R) check(label, run(RULES[label], base));
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [start, where, mutate] of MUTANTS) {
  const label = R.find((x) => x.startsWith(start));
  if (!label) { check(`mutant: no rule starts "${start}"`, false); continue; }
  const src = where === "v" ? read(VIEW) : read(SCREENS), mut = mutate(src);
  if (mut === src) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  let m;
  try { m = await measure(where === "v" ? mut : undefined, where === "s" ? mut : undefined); } catch { m = null; }
  check(`mutant bites: ${label}`, !m || !run(RULES[label], m));
}
for (const [start, file, mutate] of SRC_MUTANTS) {
  const label = R.find((x) => x.startsWith(start)), src = read(file), mut = mutate(src);
  if (mut === src) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  check(`mutant bites: ${label}`, !run(RULES[label], { ...base, ...srcOf({ [file]: mut }) }));
}
// Data mutants: [rule start, what the rule is handed instead].
const swapHero = (name) => POSTS.map((p) => (p.file === UMAC ? { ...p, data: { ...p.data, heroArt: name } } : p));
const DATA_MUTANTS = [
  // A name the manifest does not hold must fail, not fall back to the automatic picture.
  ["heroArt:", (m) => ({ ...m, posts: swapHero("aerospace-defence-any-99") })],
  ["heroArt:", (m) => ({ ...m, posts: swapHero("aerospace-defence-any-01") })],
  ["heroArt:", (m) => ({ ...m, manifest: Object.fromEntries(Object.entries(m.manifest).filter(([k]) => k !== "aerospace-defence-any-04")) })],
];
for (const [start, mutate] of DATA_MUTANTS) {
  const label = R.find((x) => x.startsWith(start));
  check(`mutant bites: ${label}`, !!label && !run(RULES[label], mutate(base)));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
