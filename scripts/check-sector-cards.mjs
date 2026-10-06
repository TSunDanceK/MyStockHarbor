// THE /sector CARDS' EXTRA FACTS AND THE COMPARE TABLE (#553 COWORK #157
// items 3-4, #158: no "Reporting next", no earnings-date column).
//
// Runtime, on fixtures:
//   - movers: 2 gainers + 1 decliner by last-close %, only among the larger
//     half by tracked cap, only on the card's own session;
//   - breadth: N counts only constituents with 200+ bars (eodBreadth);
//   - median P/E: shown only where A's line would show it (peer floor, stable
//     median); otherwise a dash;
//   - news tone: only while under 3 hours old; otherwise no chip;
//   - the compare table: server-rendered rows, default YTD highest first,
//     every column sorts, a missing figure sinks last both ways.
// Source: the cards read the tone hash and A's medians (imported, never
// edited), link each mover to its stock page, carry the tap note; no earnings
// calendar is imported; the tone is written only from a real news build, and
// a preview keeps to its own hash. Every rule has a planted mutant.
//
//   node scripts/check-sector-cards.mjs
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/tsx-render-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
const LIB = "lib/sectorCards.ts";
const TABLE = "app/sector/SectorCompareTable.tsx";
const PAGE = "app/sector/page.tsx";
const PANELS = "lib/server/sectorPanels.ts";
const TONE = "lib/server/sectorTone.ts";
const NEWS = "lib/sector-news-data.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const tmp = [];
let seq = 0;
async function load(rel, src) {
  const f = path.join(path.dirname(path.join(ROOT, rel)), `.check-scd-${process.pid}-${seq++}${path.extname(rel)}`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}

async function libRules(L, E) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const D = "2026-10-02";
  const rows = [
    { symbol: "BIG1", pct: 1.0, cap: 900, sessionDate: D },
    { symbol: "BIG2", pct: 2.5, cap: 800, sessionDate: D },
    { symbol: "BIG3", pct: -3.0, cap: 700, sessionDate: D },
    { symbol: "BIG4", pct: 4.0, cap: 600, sessionDate: "2026-10-01" },
    { symbol: "BIG5", pct: 0.5, cap: 650, sessionDate: D },
    { symbol: "SMALL1", pct: 30, cap: 10, sessionDate: D },
    { symbol: "SMALL2", pct: -25, cap: 9, sessionDate: D },
    { symbol: "SMALL3", pct: 1, cap: 8, sessionDate: D },
    { symbol: "NOCAP", pct: 50, cap: null, sessionDate: D },
  ];
  const m = L.sectorMovers(rows, D);
  want("movers: the 2 biggest gainers and the biggest decliner", m.gainers.map((x) => x.symbol).join() === "BIG2,BIG1" && m.decliners.map((x) => x.symbol).join() === "BIG3");
  want("...only among the larger half by cap (a micro-cap spike never headlines)", ![...m.gainers, ...m.decliners].some((x) => /SMALL|NOCAP/.test(x.symbol)));
  want("...only on the card's own session", !m.gainers.some((x) => x.symbol === "BIG4"));
  want("no movers without a session", L.sectorMovers(rows, null).gainers.length === 0);
  want("median shown only past the peer floor and when stable", L.usableMedian({ median: 21.5, n: 40, spreadPct: 10 }, 20, 25) === 21.5 && L.usableMedian({ median: 21.5, n: 12, spreadPct: 10 }, 20, 25) === null && L.usableMedian({ median: 21.5, n: 40, spreadPct: 40 }, 20, 25) === null && L.usableMedian(null, 20, 25) === null);
  const now = Date.parse("2026-10-05T12:00:00Z");
  want("a tone under 3 hours old is shown, an older or missing one is not", L.toneIsFresh({ label: "Neutral", score: 50, at: now - 3600e3 }, now) && !L.toneIsFresh({ label: "Neutral", score: 50, at: now - 4 * 3600e3 }, now) && !L.toneIsFresh(null, now));
  want("breadth: X of N, none when no constituent has 200 bars", L.breadthLine(12, 40)?.pct === 30 && L.breadthLine(0, 0) === null);
  // eodBreadth, the builder's source: a young listing (under 200 bars: a200 null) is not in N.
  const eod = { OLD1: { a50: true, a200: true }, OLD2: { a50: false, a200: false }, YOUNG: { a50: null, a200: null } };
  const b = E.eodBreadth(["OLD1", "OLD2", "YOUNG"], eod);
  want("breadth N leaves out listings under 200 bars", b.sampled === 2 && b.above200 === 1);
  return fails;
}

async function tableRules(T) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const rows = [
    { slug: "a", name: "Alpha", href: "/sector/a/news", day: 1, month: 2, ytd: 10, breadthPct: 50, breadthText: "20/40", medianPe: 20, tone: "Neutral", toneScore: 50 },
    { slug: "b", name: "Bravo", href: "/sector/b/news", day: -2, month: -1, ytd: -5, breadthPct: 30, breadthText: "12/40", medianPe: null, tone: null, toneScore: null },
    { slug: "c", name: "Charlie", href: "/sector/c/news", day: 0.5, month: 5, ytd: null, breadthPct: null, breadthText: null, medianPe: 30, tone: "Slightly bullish", toneScore: 62 },
  ];
  const html = renderToStaticMarkup(React.createElement(T.default, { rows, dayLabel: "Last close · 2 Oct" }));
  const order = [...html.matchAll(/data-slug="(\w+)"/g)].map((x) => x[1]).join("");
  want("server-rendered rows, default YTD highest first, a missing YTD last", order === "abc");
  want("the columns: Sector, last close, 1M, YTD, Above 200-day, Median P/E, News tone (no earnings date)", /Sector[\s\S]*Last close · 2 Oct[\s\S]*1M[\s\S]*YTD[\s\S]*Above 200-day[\s\S]*Median P\/E[\s\S]*News tone/.test(html) && !/[Ee]arnings|[Rr]eport/.test(html));
  want("sector names link to their pages", /<a href="\/sector\/a\/news">Alpha<\/a>/.test(html));
  const s = (k, d) => T.sortCompareRows(rows, k, d).map((r) => r.slug).join("");
  want("every column sorts, both ways, a missing figure last", s("name", "asc") === "abc" && s("name", "desc") === "cba" && s("day", "desc") === "acb" && s("day", "asc") === "bca" && s("month", "desc") === "cab" && s("ytd", "asc") === "bac" && s("breadthPct", "desc") === "abc" && s("breadthPct", "asc") === "bac" && s("medianPe", "asc") === "acb" && s("toneScore", "desc") === "cab");
  want("the default sort is YTD, highest first", T.COMPARE_DEFAULT_SORT.key === "ytd" && T.COMPARE_DEFAULT_SORT.dir === "desc");
  want("the table scrolls inside its box, the sector column pinned", /\.cmpWrap \{[^}]*overflow-x: auto;/.test(html) && /\.cmpTable th:first-child \{[^}]*position: sticky; left: 0;/.test(html));
  return fails;
}

function sourceRules({ page, panels, tone, news }) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const p = stripComments(page, { file: PAGE });
  const t = stripComments(tone, { file: TONE });
  const n = stripComments(news, { file: NEWS });
  const b = stripComments(panels, { file: PANELS });
  want("the cards show tone only when fresh, else no chip", /tone: toneIsFresh\(tones\[slug\], nowMs\) \? tones\[slug\] : null,/.test(p) && /\{facts\.tone \? <span className="sectorTone">News tone: \{facts\.tone\.label\}<\/span> : null\}/.test(p));
  want("median P/E: A's medians, A's rule, a dash otherwise", /import \{ readPeSectorMedians \} from "@\/lib\/server\/peSectorMedians";/.test(p) && /usableMedian\(m, PE_PEER_FLOOR, PE_MAX_SPREAD_PCT\)/.test(p) && /Median P\/E: \{facts\.medianPe != null \? `\$\{facts\.medianPe\.toFixed\(1\)\}×` : "—"\}/.test(p));
  want("each mover links to its stock page", /href=\{`\/stock\/\$\{encodeURIComponent\(m\.symbol\)\}`\}/.test(p));
  want("the tap note carries the movers rule", /<summary>How these are worked out<\/summary>[\s\S]*\{MOVERS_RULE\}/.test(p));
  want('no "Reporting next" and no earnings calendar import', !/[Rr]eporting next|earningsCalendar|earnings-calendar|getSectorEarningsThisWeek/.test(p));
  want("the builder computes breadth and movers from the EOD blob, larger half by cap", /const breadth = eodBreadth\(members, eod\);/.test(b) && /sectorMovers\(\s*members\.map/.test(b) && /\.\.\.cardFacts\(sector\.slug\),/.test(b));
  want("the tone is written only from a real news build", /if \(news\.length\) await recordSectorTone\(sector\.slug, newsScore\.label, newsScore\.score\);/.test(n));
  want("...and a preview writes and reads only its own hash", /return env === "preview" \? `\$\{SECTOR_TONE_BASE_KEY\}:preview` : SECTOR_TONE_BASE_KEY;/.test(t) && /redis\.hset\(sectorToneKey\(\),/.test(t) && /redis\.hgetall<Record<string, StoredTone>>\(sectorToneKey\(\)\)/.test(t));
  return fails;
}

try {
  const libSrc = read(LIB), tableSrc = read(TABLE);
  const E = await import(pathToFileURL(path.join(ROOT, "lib/server/marketData/eodLast.ts")).href);
  const real = { page: read(PAGE), panels: read(PANELS), tone: read(TONE), news: read(NEWS) };
  console.log("\n1. The card facts, on fixtures");
  const l = await libRules(await load(LIB, libSrc), E);
  check("movers, breadth N, median rule, tone freshness", l.length === 0, l.join("; "));
  console.log("\n2. The compare table");
  const t = await tableRules(await load(TABLE, tableSrc));
  check("server-rendered, YTD first, every sort key, missing last, sticky column", t.length === 0, t.join("; "));
  console.log("\n3. Source");
  const s = sourceRules(real);
  check("tone/median/movers wiring; no Reporting next; tone writes", s.length === 0, s.join("; "));

  console.log("\n4. Planted mutants");
  const LM = [
    ["movers from the whole sector (micro-caps headline)", "const larger = capped.slice(0, Math.ceil(capped.length / 2));", "const larger = rows;"],
    ["movers from any session", "r.sessionDate === sessionDate && sessionDate !== null && ", ""],
    ["three gainers", ".sort((a, b) => b.pct - a.pct).slice(0, 2);", ".sort((a, b) => b.pct - a.pct).slice(0, 3);"],
    ["an unstable median shown", "if (m.n < peerFloor || m.spreadPct > maxSpreadPct) return null;", "if (m.n < peerFloor) return null;"],
    ["a stale tone shown", "nowMs - t.at < TONE_MAX_AGE_MS", "true"],
  ];
  for (const [label, from, to] of LM) {
    if (!libSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try { f = await libRules(await load(LIB, libSrc.replace(from, to)), E); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const TM = [
    ["the default sort by name", 'export const COMPARE_DEFAULT_SORT: { key: Key; dir: "asc" | "desc" } = { key: "ytd", dir: "desc" };', 'export const COMPARE_DEFAULT_SORT: { key: Key; dir: "asc" | "desc" } = { key: "name", dir: "asc" };'],
    ["a missing figure sorted as zero", "if (ma || mb) return ma === mb ? a.name.localeCompare(b.name) : ma ? 1 : -1;", ""],
    ["the sector column not pinned", "position: sticky; left: 0;", "position: static;"],
  ];
  for (const [label, from, to] of TM) {
    if (!tableSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try { f = await tableRules(await load(TABLE, tableSrc.replace(from, to))); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const SM = [
    ["a stale tone shown on the card", "page", "tone: toneIsFresh(tones[slug], nowMs) ? tones[slug] : null,", "tone: tones[slug] ?? null,"],
    ["the median shown without A's rule", "page", "usableMedian(m, PE_PEER_FLOOR, PE_MAX_SPREAD_PCT)", "(m?.median ?? null)"],
    ['"Reporting next" back on the card', "page", '<span className="sectorPe">', '<span>Reporting next: ORCL</span>\n                    <span className="sectorPe">'],
    ["a preview writes production's tones", "tone", 'return env === "preview" ? `${SECTOR_TONE_BASE_KEY}:preview` : SECTOR_TONE_BASE_KEY;', "return SECTOR_TONE_BASE_KEY;"],
    ["a headline-less sector writes Neutral", "news", "if (news.length) await recordSectorTone(", "await recordSectorTone("],
  ];
  for (const [label, which, from, to] of SM) {
    if (!real[which].includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const f = sourceRules({ ...real, [which]: real[which].replace(from, to) });
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
