// THE PRICE ZONES CARD (#563 COWORK #83/#84): rules, then mutants.
//
// lib/ta/confluence.ts and app/stock/[symbol]/ConfluenceCard.tsx are
// transpiled into one module with their imports (sessionBar, keyLevels,
// macdSeries, priceLadder) and driven with fixtures. The page's own rsiWilder
// and buildMacd are lifted from StockSymbolPageClient.tsx, so the projections
// are verified forward against the arithmetic the reader sees: append the
// projected close, and RSI(14) reads 70 / 30, MACD meets its signal line.
//
// Rules: the dedupe; the band merge; the ≥2 rule and the not-alone rule; the
// reverse RSI and MACD (forward-verified, and left out with the reason beyond
// 20%); the nearest-2 selection; price inside a zone; the fixed scale with the
// dot at its true height; "≈" on projections; the copy has no forecast words;
// placement directly above Key levels; no fetch or Redis. A mutant each.
//
//   node scripts/check-confluence.mjs
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reasonedValueUnit } from "./lib/render-cards.mjs";
import { grabFunction } from "./lib/earnings-plan.mjs";
import { stripComments } from "./lib/source-code.mjs";

const LIB = "lib/ta/confluence.ts", CARD = "app/stock/[symbol]/ConfluenceCard.tsx", PAGE = "app/stock/[symbol]/StockSymbolPageClient.tsx";
const DEPS = ["lib/ta/sessionBar.ts", "lib/ta/keyLevels.ts", "lib/ta/macdSeries.ts", "lib/ta/priceLadder.ts"];
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");
const read = (f) => fs.readFileSync(f, "utf8");

let n = 0;
async function load(lib, card) {
  const page = read(PAGE);
  const lifted = ["lastNum", "rsiWilder", "ema", "buildMacd"].map((f) => grabFunction(page, f)).join("\n")
    .replace(/\bfunction ema\(/, "function pageEma(").replace(/\bema\(values, (12|26)\)/g, "pageEma(values, $1)").replace(/\bema\(macdValues, 9\)/, "pageEma(macdValues, 9)")
    .replace(/\bavg\(/g, "pageAvg(");
  const unit = `${reasonedValueUnit()}\n${DEPS.map((f) => strip(read(f))).join("\n")}\n${strip(lib)}\n${strip(card).replace("export default function ConfluenceCard", "export function ConfluenceCard")}\n` +
    `const pageAvg = (v) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);\n${lifted}\nexport { rsiWilder as pageRsi, buildMacd as pageMacd };\n`;
  const tmp = `scripts/.check-confluence-${process.pid}-${n++}.mjs`;
  fs.writeFileSync(tmp, ts.transpileModule(unit, { fileName: "c.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

// ── fixtures, all ending Fri 2 Oct 2026 ─────────────────────────────────────
function wave(scale = 1, drift = 0.1) {
  const out = [];
  for (let t = Date.parse("2025-06-02T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t), date = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const b = (200 + 30 * Math.sin(i / 17) + 15 * Math.sin(i / 5.3) + i * drift) * scale;
    out.push({ date, open: b, high: b + 3 * scale, low: b - 2.5 * scale, close: b + 0.8 * scale });
    i++;
  }
  return out;
}
const RISING = wave(1, 0.1), FALLING = wave(1, -0.12);
// Thu 1 Oct is the lowest low of the week AND the month (from Thu 1 Oct): one bar, two names.
const SHARED = RISING.map((b) => (b.date === "2026-10-01" ? { ...b, low: b.low - 9 } : b));
// A steady 1.2% fall a day for 60 sessions: RSI near 0, so RSI 70 is more than 20% away.
const SLIDE = RISING.slice(0, -60).concat(Array.from({ length: 60 }, (_, i) => {
  const base = RISING[RISING.length - 61].close * Math.pow(0.988, i + 1), d = RISING[RISING.length - 60 + i].date;
  return { date: d, open: base * 1.006, high: base * 1.008, low: base * 0.995, close: base };
}));
// The flat last session: the price sits inside a zone.
const FLAT = RISING.map((b, i, a) => (i === a.length - 1 ? { ...b, open: b.close, high: b.close, low: b.close } : b));
const sma = (b, k) => b.slice(-k).reduce((s, x) => s + x.close, 0) / k;
const input = (b) => ({ bars: b, ma50: sma(b, 50), ma200: sma(b, 200), macro: null });
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const FORECAST = /\b(buy|sell|bullish|bearish|will|should|recommend|target|expect|likely|breakout)\b/i;

function measure(M) {
  const c = (b) => M.confluence(input(b));
  const render = (b) => renderToStaticMarkup(React.createElement(M.ConfluenceCard, input(b)));
  return { M, rising: c(RISING), falling: c(FALLING), shared: c(SHARED), slide: c(SLIDE), flat: c(FLAT), risingHtml: render(RISING), flatHtml: render(FLAT) };
}
const shownZones = (c) => [...c.above, ...c.below, ...(c.inside ? [c.inside] : [])];

const RULES = {
  "dedupe: one bar's one price counts once, under every name": ({ M, shared }) => {
    const d = M.dedupe([
      { label: "Week low", value: 100, tier: "structural", src: "2026-09-28:low", date: "2026-09-28", rank: 1 },
      { label: "Month low", value: 100, tier: "structural", src: "2026-09-28:low", date: "2026-09-28", rank: 0 },
      { label: "Swing low", value: 100, tier: "structural", src: "2026-07-01:low", date: "2026-07-01", rank: 2 },
    ]);
    const thu = shared.levels.find((m) => m.date === "2026-10-01" && m.labels.includes("Month low"));
    return d.length === 2 && d[0].labels.join("|") === "Week low|Month low" && d[0].rank === 0 &&
      !!thu && thu.labels.includes("Week low") && thu.labels.includes("Month low") &&
      shared.levels.filter((m) => m.date === "2026-10-01" && m.value === thu.value).length === 1;
  },
  "band: levels within k × ATR of the zone's lowest member join it; the zone is its lowest–highest member": ({ M, rising }) => {
    const m = (v) => ({ labels: [String(v)], value: v, tier: "structural", date: null, rank: 2 });
    const g = M.bandMerge([m(10), m(10.5), m(10.9), m(11.1), m(12)], 1);
    return g.map((z) => z.map((x) => x.value).join(",")).join("|") === "10,10.5,10.9|11.1,12" &&
      near(rising.band, M.K_ATR * rising.atr) && shownZones(rising).every((z) => z.hi - z.lo <= rising.band + 1e-9 &&
        z.lo === Math.min(...z.members.map((x) => x.value)) && z.hi === Math.max(...z.members.map((x) => x.value)));
  },
  "≥2 independent members, at least one structural: round numbers and projections never alone": ({ M, rising, falling, flat }) => {
    const m = (v, tier) => ({ labels: [tier], value: v, tier, date: null, rank: 2 });
    return M.qualifies([m(1, "structural"), m(1.1, "round")]) && !M.qualifies([m(1, "structural")]) &&
      !M.qualifies([m(1, "round"), m(1.1, "projection")]) && !M.qualifies([m(1, "projection"), m(1.1, "projection")]) &&
      [rising, falling, flat].every((c) => shownZones(c).every((z) => z.count >= 2 && z.count === z.members.length && z.members.some((x) => x.tier === "structural"))) &&
      shownZones(rising).some((z) => z.members.some((x) => x.tier !== "structural"));
  },
  "reverse RSI: the projected close, run forward through the page's RSI, reads 70 and 30": ({ M }) =>
    [RISING, FALLING, SHARED].every((b) => [70, 30].every((t) => {
      const cl = b.map((x) => x.close), x = M.reverseRsi(cl, t);
      const r = M.pageRsi([...cl, x], 14);
      return typeof x === "number" && near(r[r.length - 1], t, 1e-6);
    })),
  "reverse MACD: the projected close, run forward through the page's MACD, meets the signal line": ({ M }) =>
    [RISING, FALLING, SHARED].every((b) => {
      const cl = b.map((x) => x.close), x = M.reverseMacd(cl);
      const m = M.pageMacd([...cl, x]);
      return typeof x === "number" && m && Math.abs(m.histogram) < 1e-9 * Math.max(1, Math.abs(m.macd));
    }),
  "a projection beyond 20%, or out of reach, is left out with its reason": ({ slide, rising }) =>
    slide.omitted.some((o) => /^RSI\(14\) 70: \d+% from the price, beyond 20%\.$/.test(o)) &&
    !slide.levels.some((m) => m.labels.includes("RSI(14) 70")) &&
    rising.levels.filter((m) => m.tier === "projection").every((m) => Math.abs(m.value - rising.price) / rising.price <= 0.2),
  "the nearest 2 qualifying zones above and below; a zone holding the price is 'inside'": ({ M, rising, flat }) =>
    [rising, flat].every((c) => {
      const all = M.allZones(c.levels, c.band, c.price);
      const up = all.filter((z) => z.lo > c.price), down = all.filter((z) => z.hi < c.price).reverse();
      return c.above.length === Math.min(2, up.length) && c.above.every((z, i) => z === up[i] || (z.lo === up[i].lo && z.hi === up[i].hi)) &&
        c.below.length === Math.min(2, down.length) && c.below.every((z, i) => z.lo === down[i].lo && z.hi === down[i].hi);
    }) && up2(rising),
  "price inside a zone: shown as 'price inside zone', the next ones out above and below": ({ M, flat, flatHtml }) =>
    !!flat.inside && flat.inside.lo <= flat.price && flat.price <= flat.inside.hi &&
    M.zoneDistance(flat.inside, flat.price) === "price inside zone" &&
    flat.above.every((z) => z.lo > flat.inside.hi) && flat.below.every((z) => z.hi < flat.inside.lo) &&
    /class="czInside"[^>]*>price inside zone</.test(flatHtml),
  "a fixed scale: the shown zones and the price, padded; the dot at its true height, never centred": ({ M, rising, risingHtml }) => {
    const z = shownZones(rising), lo = Math.min(rising.price, ...z.map((x) => x.lo)), hi = Math.max(rising.price, ...z.map((x) => x.hi)), pad = (hi - lo) * 0.08;
    const top = M.ladderTop(rising.price, rising.scale);
    return near(rising.scale.lo, lo - pad) && near(rising.scale.hi, hi + pad) &&
      near(top, M.ZONE_LADDER_HEIGHT * (1 - (rising.price - rising.scale.lo) / (rising.scale.hi - rising.scale.lo))) &&
      Math.abs(M.heightPct(rising.price, rising.scale) - 50) > 5 &&
      new RegExp(`class="czDot" style="[^"]*top:${(top - 6).toFixed(3).replace(/\.?0+$/, "")}`).test(risingHtml.replace(/top:(-?\d+\.\d{3})\d*/g, "top:$1"));
  },
  "zone labels: stacked apart on one side, each band at its own price range": ({ M, rising }) => {
    const marks = M.zoneLadder(rising), ys = [...marks.map((m) => m.labelY)].sort((a, b) => a - b);
    return marks.length === shownZones(rising).length && ys.every((y, i) => i === 0 || y - ys[i - 1] >= M.ZONE_LABEL_GAP - 1e-9) &&
      marks.every((m) => near(m.top, M.ladderTop(m.zone.hi, rising.scale)) && near(m.bottom, M.ladderTop(m.zone.lo, rising.scale)));
  },
  "projections marked ≈ in the tap note, as one-session projections": ({ M, rising }) => {
    const z = shownZones(rising).find((x) => x.members.some((m) => m.tier === "projection"));
    return !!z && /≈ \$[\d,.]+: the next close that would (take RSI\(14\) to (70|30)|bring MACD \(12, 26, 9\) to its signal line) \(a one-session projection\)\./.test(M.zoneNote(z)) &&
      shownZones(rising).every((x) => M.zoneNote(x).startsWith(M.countWords(x)));
  },
  "the copy describes, never forecasts or advises": ({ M, rising, risingHtml }) =>
    M.CONFLUENCE_NOTE === "Areas where several price levels sit close together. Some traders watch areas like this; a description, not a forecast." &&
    risingHtml.includes(M.CONFLUENCE_NOTE) && risingHtml.includes(">Price zones<") && risingHtml.includes(">Confluence<") &&
    !FORECAST.test(`${M.ZONES_KEY} ${shownZones(rising).map((z) => M.zoneNote(z)).join(" ")} ${risingHtml.replace(/<[^>]+>/g, " ")}`),
  "placement: its own card directly above Key levels in the sidebar, once": () => {
    const p = read(PAGE), side = p.slice(p.indexOf('<aside className="stock-page-sidebar">'), p.indexOf("</aside>"));
    return /<div className="sp-slot sp-confluence">\s*<ConfluenceCard bars=\{history\}[^\n]*\/>\s*<\/div>\s*\{\/\*[^*]*\*\/\}\s*<div className="sp-slot sp-keylevels">/.test(side) &&
      (p.match(/<ConfluenceCard\b/g) ?? []).length === 1 && /^import ConfluenceCard from "\.\/ConfluenceCard";$/m.test(p);
  },
  "no fetch, no Redis, no provider reads": () =>
    [[LIB, read(LIB)], [CARD, read(CARD)]].every(([f, s]) => !/\bfetch\(|redis|upstash|tiingo|fmp/i.test(stripComments(s, { file: f }))),
};
function up2(c) { return c.above.length === 2 && c.below.length === 2; }

const libSrc = read(LIB), cardSrc = read(CARD);
let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch { return false; } };

console.log("=== Rules ===");
const base = measure(await load(libSrc, cardSrc));
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base));

// [rule, "l" (lib) or "c" (card) or "p" (page), mutation]
const MUTANTS = [
  ["dedupe: one bar's one price counts once, under every name", "l", (s) => s.replace("const m = by.get(l.src);", "const m = undefined; by.set(l.src + Math.random(), null);")],
  ["dedupe: one bar's one price counts once, under every name", "l", (s) => s.replace('`${hd}:high` : `${p.key}:high`', '`${p.key}:${hd}:high` : `${p.key}:high`').replace('`${ld}:low` : `${p.key}:low`', '`${p.key}:${ld}:low` : `${p.key}:low`')],
  ["band: levels within k × ATR of the zone's lowest member join it; the zone is its lowest–highest member", "l", (s) => s.replace("if (z && m.value - z[0].value <= band) z.push(m);", "if (z && m.value - z[z.length - 1].value <= band) z.push(m);")],
  ["band: levels within k × ATR of the zone's lowest member join it; the zone is its lowest–highest member", "l", (s) => s.replace("const band = (opts.k ?? K_ATR) * a;", "const band = (opts.k ?? K_ATR) * a * 2;")],
  ["≥2 independent members, at least one structural: round numbers and projections never alone", "l", (s) => s.replace("ms.length >= ZONE_MIN && structural(ms)", "ms.length >= ZONE_MIN")],
  ["≥2 independent members, at least one structural: round numbers and projections never alone", "l", (s) => s.replace("export const ZONE_MIN = 2;", "export const ZONE_MIN = 1;")],
  ["reverse RSI: the projected close, run forward through the page's RSI, reads 70 and 30", "l", (s) => s.replace("last + m * (rs * s.avgLoss - s.avgGain)", "last + period * (rs * s.avgLoss - s.avgGain)")],
  ["reverse RSI: the projected close, run forward through the page's RSI, reads 70 and 30", "l", (s) => s.replace("avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;", "avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / (period + 1);")],
  ["reverse MACD: the projected close, run forward through the page's MACD, meets the signal line", "l", (s) => s.replace("const a12 = 2 / 13, a26 = 2 / 27;", "const a12 = 2 / 12, a26 = 2 / 26;")],
  ["a projection beyond 20%, or out of reach, is left out with its reason", "l", (s) => s.replace("if (pct > MAX_PROJECTION_PCT) {", "if (false) {")],
  ["the nearest 2 qualifying zones above and below; a zone holding the price is 'inside'", "l", (s) => s.replace("const above = zones.filter((z) => z.lo > price).sort((x, y) => x.lo - y.lo).slice(0, SHOWN);", "const above = zones.filter((z) => z.lo > price).sort((x, y) => y.lo - x.lo).slice(0, SHOWN);")],
  ["the nearest 2 qualifying zones above and below; a zone holding the price is 'inside'", "l", (s) => s.replace("export const SHOWN = 2;", "export const SHOWN = 1;")],
  ["price inside a zone: shown as 'price inside zone', the next ones out above and below", "l", (s) => s.replace("const inside = zones.find((z) => z.lo <= price && price <= z.hi) ?? null;", "const inside = null;")],
  ["price inside a zone: shown as 'price inside zone', the next ones out above and below", "c", (s) => s.replace('{m.side === "inside" ? <div className="czInside"', '{false ? <div className="czInside"')],
  ["a fixed scale: the shown zones and the price, padded; the dot at its true height, never centred", "l", (s) => s.replace("scale: { lo: lo - pad, hi: hi + pad }, levels:", "scale: { lo: price - Math.max(price - lo, hi - price) - pad, hi: price + Math.max(price - lo, hi - price) + pad }, levels:")],
  ["a fixed scale: the shown zones and the price, padded; the dot at its true height, never centred", "c", (s) => s.replace("top: ladderTop(c.price, c.scale) - 6,", "top: ZONE_LADDER_HEIGHT / 2 - 6,")],
  ["zone labels: stacked apart on one side, each band at its own price range", "l", (s) => s.replace("const ys = stackLabels(marks.map((m) => m.labelY), ZONE_LABEL_GAP, height, ZONE_LABEL_GAP / 2);", "const ys = marks.map((m) => m.labelY);")],
  ["projections marked ≈ in the tap note, as one-session projections", "l", (s) => s.replace("return `${ESTIMATE_SIGN} ${priceWords(m.value)}: ${m.derived} (a one-session projection).`;", "return `${priceWords(m.value)}: ${m.derived}.`;")],
  ["the copy describes, never forecasts or advises", "l", (s) => s.replace("Some traders watch areas like this; a description, not a forecast.", "Price will likely bounce at these zones.")],
  ["the copy describes, never forecasts or advises", "c", (s) => s.replace("`Band: a zone's lowest to highest level", "`Buy near a zone · Band: a zone's lowest to highest level")],
  ["placement: its own card directly above Key levels in the sidebar, once", "p", (s) => s.replace('<div className="sp-slot sp-confluence">', '<div className="sp-slot sp-confluence-moved">')],
  ["no fetch, no Redis, no provider reads", "l", (s) => s.replace("export const K_ATR = 0.35;", "export const K_ATR = 0.35;\nconst probe = () => fetch(\"/api/x\");")],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
const pageSrc = read(PAGE);
for (const [label, where, mutate] of MUTANTS) {
  const src = where === "l" ? libSrc : where === "c" ? cardSrc : pageSrc;
  const mut = mutate(src);
  if (mut === src) { check(`mutant bites: ${label}`, false, "the mutation did not apply"); continue; }
  let caught;
  if (where === "p") {
    fs.writeFileSync(PAGE, mut);
    try { caught = !run(RULES[label], base); } finally { fs.writeFileSync(PAGE, pageSrc); }
  } else if (where === "l" && label.startsWith("no fetch")) {
    fs.writeFileSync(LIB, mut);
    try { caught = !run(RULES[label], base); } finally { fs.writeFileSync(LIB, libSrc); }
  } else {
    let m;
    try { m = measure(await load(where === "l" ? mut : libSrc, where === "c" ? mut : cardSrc)); } catch { m = null; }
    caught = !m || !run(RULES[label], m);
  }
  check(`mutant bites: ${label}`, caught);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
