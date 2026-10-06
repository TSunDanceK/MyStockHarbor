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
//   - the fixture is served off production only and never listed.
// A mutant each.
//
//   node scripts/check-insight-page.mjs
import fs from "node:fs";
import ts from "typescript";
import { stripComments } from "./lib/source-code.mjs";

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
    const raw = read(AMZN), fm = raw.split("---")[1], body = raw.split("---").slice(2).join("---");
    const data = Object.fromEntries(fm.trim().split("\n").map((l) => { const m = /^(\w+):\s*(.*)$/.exec(l); return m ? [m[1], JSON.parse(m[2])] : null; }).filter(Boolean));
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
  ["the screens link", "s", (s) => s.replace('href: "/oversold-stocks-today"', 'href: "/oversold-today"')],
  ["no advice words", "v", (s) => s.replace('case "held": return { word: "Held", detail: "No daily close below it since", tone: "up" };', 'case "held": return { word: "Held", detail: "A level to buy while it holds", tone: "up" };')],
];

const R = Object.keys(RULES);
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch (e) { if (process.env.DEBUG) console.log(e); return false; } };
const measure = async (v = read(VIEW), s = read(SCREENS)) => ({ V: await load(v, "view"), S: await load(s, "screens") });

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
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
