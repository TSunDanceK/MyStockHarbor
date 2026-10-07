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
//     the tone line without it; filing notices and quote pages are skipped.
// A mutant each.
//
//   node scripts/check-insight-page.mjs
import fs from "node:fs";
import ts from "typescript";
import { stripComments } from "./lib/source-code.mjs";
import matter from "gray-matter";

const VIEW = "lib/insightView.ts", SCREENS = "lib/insightScreens.ts", PAGE = "app/insights/[slug]/InsightPage.tsx", ROUTE = "app/insights/[slug]/page.tsx";
const CHART = "app/insights/[slug]/InsightChart.tsx", LOADER = "lib/server/insightPage.ts", TEMPLATE = "content/templates/insight-template.md";
const FIXTURE = "content/insights-fixtures/fixture-aapl-new-format.md", AMZN = "content/insights/amzn-daily-ma200-buy-zone-july-2026.md";
const read = (f) => fs.readFileSync(f, "utf8");

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
      return r.drivers && !ADVICE.test(r.drivers.text) && !d.updated;
    });
  },
  "drivers: the card leads with the dated paragraph, nofollow sources, at most three headlines, the old layout without it": ({ page, loader, V }) =>
    /<Card eyebrow=\{`What's driving \$\{sym\} now`\} title=\{`\$\{sym\} news and catalysts`\}/.test(page) &&
    /data-insight-drivers-asof="">As of \{dayWords\(n\.drivers\.asOf\)\}<\/p>/.test(page) &&
    /<p className="inRead inDrivers" data-insight-drivers="">\{n\.drivers\.text\}<\/p>/.test(page) &&
    /rel="nofollow noopener"/.test(page) && /\{src\.publisher\}/.test(page) &&
    /\) : d\.news\?\.score \? \(/.test(page) && /Latest headlines/.test(page) &&
    /export const NEWS_SHOWN = 3;/.test(loader) && /!isJunkHeadline\(i\.title\)\)\.slice\(0, NEWS_SHOWN\)/.test(loader) &&
    V.isJunkHeadline("Form 4 Amazon.com Inc For: Oct 03 Filed by: Jassy Andrew R") && V.isJunkHeadline("Amazon.com, Inc. (AMZN) historical prices and data") &&
    V.isJunkHeadline("BKNG.BK board approves dividend") && !V.isJunkHeadline("Amazon raises its 2026 capex estimate as AWS growth speeds up"),
  "the fixture is served off production only, noindex, and never listed": () => {
    const loader = stripComments(read(LOADER), { file: LOADER }), route = stripComments(read(ROUTE), { file: ROUTE });
    return /export const fixturesServed = \(\) => process\.env\.VERCEL_ENV !== "production";/.test(loader) && /fixturesServed\(\) && /.test(loader) &&
      /robots: isInsightFixture\(slug\) \? \{ index: false, follow: false \}/.test(route) && !fs.existsSync("content/insights/fixture-aapl-new-format.md") &&
      !/insights-fixtures/.test(read("lib/blog.ts")) && !/insights-fixtures/.test(read("app/sitemap.ts"));
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
  ["drivers: the card", "v", (s) => s.replace("return /^form\\s*(?:4|3|5|144)\\b/i.test(title) ||", "return false ||")],
  ["the screens link", "s", (s) => s.replace('href: "/oversold-stocks-today"', 'href: "/oversold-today"')],
  ["no advice words", "v", (s) => s.replace('case "held": return { word: "Held", detail: "No daily close below it since", tone: "up" };', 'case "held": return { word: "Held", detail: "A level to buy while it holds", tone: "up" };')],
];

// Source mutants: [rule start, file, mutation].
const SRC_MUTANTS = [
  ["SEO:", ROUTE, (s) => s.replace("dateModified: modifiedTime,", "dateModified: new Date().toISOString(),")],
  ["SEO:", ROUTE, (s) => s.replace('"@type": "Article",', '"@type": "BlogPosting",')],
  ["the rail:", PAGE, (s) => s.replace("<KeyLevelsCard bars={d.railBars} discussed={d.discussed}", "<KeyLevelsCard bars={d.railBars}")],
  ["drivers: the card", PAGE, (s) => s.replace('rel="nofollow noopener"', 'rel="noopener"')],
  ["drivers: the card", PAGE, (s) => s.replace(") : d.news?.score ? (", ") : null}{d.news?.score ? (")],
  ["drivers: the card", LOADER, (s) => s.replace("export const NEWS_SHOWN = 3;", "export const NEWS_SHOWN = 5;")],
  ["the rail:", PAGE, (s) => s.replace('{d.snapshot?.available ? <EarningsTiles d={d} /> : <p className="inRead" data-insight-no-facts="">Filed figures not available yet.</p>}', "<EarningsTiles d={d} />")],
];
const R = Object.keys(RULES);
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch (e) { if (process.env.DEBUG) console.log(e); return false; } };
const srcOf = (over = {}) => ({ route: stripComments(over[ROUTE] ?? read(ROUTE), { file: ROUTE }), page: stripComments(over[PAGE] ?? read(PAGE), { file: PAGE }), loader: stripComments(over[LOADER] ?? read(LOADER), { file: LOADER }) });
const measure = async (v = read(VIEW), s = read(SCREENS), over = {}) => ({ V: await load(v, "view"), S: await load(s, "screens"), ...srcOf(over) });

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
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
