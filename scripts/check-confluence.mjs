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
// PRICE GAPS (#563 COWORK #108): B's lib/ta/fairValueGaps.ts is bundled as
// imported (not copied). Fixtures: a gap that overlaps a shown zone (one more
// member, a dated note line, the zone's range unmoved), one near but not
// overlapping, one filled, none; today's partial bar never fills one; gaps
// never make, move or pick a zone; the card holds no ReasonedValue (so its
// translateY labels can't capture a fixed note). A mutant each.
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
const DEPS = ["lib/ta/sessionBar.ts", "lib/ta/keyLevels.ts", "lib/ta/macdSeries.ts", "lib/ta/priceLadder.ts", "lib/ta/fairValueGaps.ts"];
// B's detector has its own module-scope isPrice; one bundle can't hold two.
const depSrc = (f) => (f.endsWith("fairValueGaps.ts") ? strip(read(f)).replace(/\bisPrice\b/g, "fvgIsPrice") : strip(read(f)));
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");

/** C's TapNote (#563 COWORK #88/#89), with the two hooks the shared unit doesn't import. */
const tapNoteUnit = (src = fs.readFileSync("app/stock/[symbol]/TapNote.tsx", "utf8")) => `import { useCallback, useLayoutEffect } from "react";\n${strip(src)}`;
const read = (f) => fs.readFileSync(f, "utf8");

let n = 0;
async function load(lib, card, tap = read("app/stock/[symbol]/TapNote.tsx")) {
  const page = read(PAGE);
  const lifted = ["lastNum", "rsiWilder", "ema", "buildMacd"].map((f) => grabFunction(page, f)).join("\n")
    .replace(/\bfunction ema\(/, "function pageEma(").replace(/\bema\(values, (12|26)\)/g, "pageEma(values, $1)").replace(/\bema\(macdValues, 9\)/, "pageEma(macdValues, 9)")
    .replace(/\bavg\(/g, "pageAvg(");
  const unit = `${reasonedValueUnit()}\n${tapNoteUnit(tap)}\n${DEPS.map(depSrc).join("\n")}\n${strip(lib)}\n${strip(card).replace("export default function ConfluenceCard", "export function ConfluenceCard")}\n` +
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
// Gap fixtures on a flat series (high 100.5, low 99.5): bar 40's high 100.5, bar 42's low 105.5 → the gap [100.5, 105.5], c2 Tue 4 Aug 2026.
const FLAT_DAYS = (() => { const out = []; for (let t = Date.parse("2026-06-08T00:00:00Z"); out.length < 80; t += 86_400_000) { const d = new Date(t); if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10)); } return out; })();
const gapBars = (after) => FLAT_DAYS.map((date, i) => i < 41 ? { date, open: 100, high: 100.5, low: 99.5, close: 100 } : i === 41 ? { date, open: 101, high: 106, low: 100.8, close: 105.5 } : { date, open: 106, high: 106.5, low: after(i), close: 106 });
const GAP_OPEN = gapBars(() => 105.5), GAP_FILLED = gapBars((i) => (i === 60 ? 103 : 105.5));
const GAP_TODAY = [...GAP_OPEN, { date: "2026-10-01", open: 106, high: 106, low: 103, close: 104, partial: true }];
const sma = (b, k) => b.slice(-k).reduce((s, x) => s + x.close, 0) / k;
// RISING holds unfilled gaps below the price; a macro support zone placed across the lower one makes a shown zone it overlaps.
const GAP_MACRO = { lower: 249.5, upper: 250.5 };
const input = (b) => ({ bars: b, ma50: sma(b, 50), ma200: sma(b, 200), macro: null });
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const FORECAST = /\b(buy|sell|bullish|bearish|will|should|recommend|target|expect|likely|breakout)\b/i;

function measure(M) {
  const c = (b) => M.confluence(input(b));
  const render = (b) => renderToStaticMarkup(React.createElement(M.ConfluenceCard, input(b)));
  const credited = renderToStaticMarkup(React.createElement(M.ConfluenceCard, { ...input(RISING), credit: React.createElement("a", { href: "#" }, "Tiingo credit") }));
  const noteHtml = (c, z, side) => renderToStaticMarkup(React.createElement(M.ZoneNoteBody, { mark: { zone: z, side, top: 0, bottom: 0, labelY: 0 }, price: c.price }));
  return { M, rising: c(RISING), falling: c(FALLING), shared: c(SHARED), slide: c(SLIDE), flat: c(FLAT), gapped: M.confluence({ ...input(RISING), macro: GAP_MACRO }), risingHtml: render(RISING), flatHtml: render(FLAT), credited, noteHtml };
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
        z.lo === Math.min(...z.members.filter((x) => !x.gap).map((x) => x.value)) && z.hi === Math.max(...z.members.filter((x) => !x.gap).map((x) => x.value)));
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
  "the small print folded (#88 §1): 'How to read this' closed, holding the key, the kinds' dots and the hedge; the credit outside": ({ M, credited }) => {
    const d = /<details class="howToRead"([^>]*)>([\s\S]*?)<\/details>/.exec(credited);
    return !!d && !/\bopen\b/.test(d[1]) && />How to read this ▾</.test(d[2]) && d[2].includes(M.ZONES_KEY.replace(/'/g, "&#x27;")) &&
      d[2].includes(M.CONFLUENCE_NOTE) && M.NOTE_KINDS.every((k) => d[2].includes(k.label.replace("&", "&amp;"))) &&
      (d[2].match(/class="noteDot"/g) ?? []).length === M.NOTE_KINDS.length &&
      !/Daily prices/.test(d[2]) && credited.indexOf("Daily prices: <a") > credited.indexOf("</details>") &&
      (credited.match(/Some traders watch areas like this/g) ?? []).length === 1;
  },
  "the ladder is taller (#88 §2): 320 px, at least 280 on a phone": ({ M, risingHtml }) =>
    M.ZONE_LADDER_HEIGHT >= 320 && /class="czLadder" style="[^"]*height:320px/.test(risingHtml),
  "the zone note (#88 §4): header in the zone's colour, one bullet per level grouped by kind with its dot, shared prices on one bullet, a muted footer": ({ M, rising, noteHtml }) => {
    const z = [...rising.above, ...rising.below, ...(rising.inside ? [rising.inside] : [])].find((x) => x.members.some((m) => m.tier === "projection"))
      ?? rising.above[0];
    const side = z.lo > rising.price ? "above" : z.hi < rising.price ? "below" : "inside";
    const h = noteHtml(rising, z, side), parts = M.zoneNoteParts(z, rising.price);
    const order = parts.bullets.map((b) => M.NOTE_KINDS.findIndex((k) => k.key === b.kind));
    // Shared prices on one bullet: a hand-built zone where one bar's low is the week's and the month's.
    const hand = { lo: 100, hi: 100.5, count: 2, members: [
      { labels: ["Week low", "Month low"], value: 100, tier: "structural", date: "2026-09-28", rank: 0 },
      { labels: ["MA50"], value: 100.5, tier: "structural", date: null, rank: 2 }] };
    const sp = M.zoneNoteParts(hand, 99);
    return new RegExp(`class="czNoteHead" style="[^"]*color:${{ above: "#f59e0b", below: "#38bdf8", inside: "#e2e8f0" }[side]}`).test(h) &&
      h.includes(`>${parts.count} <`) && h.includes(`· ${parts.range} · ${parts.distance}`) &&
      parts.bullets.length === z.count && order.every((o, i) => i === 0 || o >= order[i - 1]) &&
      (h.match(/<li class="czBullet" data-kind="[a-z]+"[^>]*><span aria-hidden="true" class="noteDot"/g) ?? []).length === z.count &&
      h.includes(`class="czNoteFoot"`) && h.includes(M.ZONE_NOTE_FOOTER.replace("'", "&#x27;")) &&
      sp.bullets.length === 2 && M.bulletWords(sp.bullets[0]) === "Week low · Month low — $100.00 (Mon 28 Sep)" && sp.bullets[1].kind === "ma" && sp.side === "above";
  },
  "the note opens beside the tap (#88 §3): below the label, flipped above off the screen's bottom; inline on a phone, pushing what follows": ({ M }) => {
    const below = M.anchoredPlacement({ labelTop: 100, labelBottom: 130, height: 200, containerTop: 0, viewportHeight: 800 });
    const flip = M.anchoredPlacement({ labelTop: 500, labelBottom: 530, height: 200, containerTop: 200, viewportHeight: 800 });
    const noRoom = M.anchoredPlacement({ labelTop: 10, labelBottom: 40, height: 300, containerTop: 50, viewportHeight: 300 });
    const push = M.pushOffsets([50, 120, 140, 300], 130, 100);
    return below.top === 130 + M.NOTE_GAP && !below.flipped && flip.flipped && flip.top === 500 - M.NOTE_GAP - 200 &&
      noRoom.flipped === false && push.join(",") === `0,0,${100 + 2 * M.NOTE_GAP},${100 + 2 * M.NOTE_GAP}` && M.PHONE_MAX === 900;
  },
  "one note open at a time; ✕, Esc or a tap outside closes it; the zone labels use it (#88 §3)": () => {
    const t = stripComments(read("app/stock/[symbol]/TapNote.tsx"), { file: "TapNote.tsx" }), c = stripComments(read(CARD), { file: CARD });
    return /const l = \(o: string \| null\) => setOpen\(o === id\);/.test(t) && /const toggle = useCallback\(\(\) => announce\(current === id \? null : id\), \[id\]\);/.test(t) &&
      /if \(e\.key === "Escape"\) close\(\);/.test(t) && /e\.target\.closest\(`\[data-note="\$\{id\}"\]`\)\) close\(\);/.test(t) &&
      /className="tapNoteClose" aria-label="Close" onClick=\{note\.close\}/.test(t) &&
      /phone\s*\? <NotePanel note=\{note\}[^>]*mode="inline"/.test(c) && /: <NotePanel note=\{note\}[^>]*overlay=\{place \?\?/.test(c) &&
      /if \(phone\) \{ onPush\(index, bottom, h\); return; \}/.test(c);
  },
  "placement: its own card directly above Key levels in the sidebar, once": () => {
    const p = read(PAGE), side = p.slice(p.indexOf('<aside className="stock-page-sidebar">'), p.indexOf("</aside>"));
    return /<div className="sp-slot sp-confluence">\s*<ConfluenceCard bars=\{history\}[^\n]*\/>\s*<\/div>\s*\{\/\*[^*]*\*\/\}\s*<div className="sp-slot sp-keylevels">/.test(side) &&
      (p.match(/<ConfluenceCard\b/g) ?? []).length === 1 && /^import ConfluenceCard from "\.\/ConfluenceCard";$/m.test(p);
  },
  "gaps: B's detector at its defaults, imported, not copied; closed bars only": ({ M }) => {
    const lib = stripComments(read(LIB), { file: LIB });
    const open = M.zoneGaps(GAP_OPEN), today = M.zoneGaps(GAP_TODAY);
    return /^import \{ fairValueGaps, type FairValueGap \} from "\.\/fairValueGaps";$/m.test(read(LIB)) && !/function fairValueGaps|function atrSeries/.test(lib) &&
      /fairValueGaps\(closed\.map\(\(b\) => \(\{ date: b\.date, high: b\.high!, low: b\.low!, close: b\.close \}\)\)\)/.test(lib) &&
      open.length === 1 && open[0].lower === 100.5 && open[0].upper === 105.5 &&
      today.length === 1 && today[0].date === open[0].date && M.zoneGaps(GAP_FILLED).length === 0;
  },
  "gaps: an overlapping gap adds one structural member and a dated note line; the range stays": ({ M }) => {
    const [g] = M.zoneGaps(GAP_OPEN);
    const z = { lo: 100, hi: 101, count: 2, members: [
      { labels: ["MA50"], value: 100, tier: "structural", date: null, rank: 2 },
      { labels: ["Swing low"], value: 101, tier: "structural", date: "2026-07-01", rank: 2 }] };
    const w = M.withGaps(z, [g]), parts = M.zoneNoteParts(w, 110), gb = parts.bullets.find((b) => b.kind === "gap");
    const edge = M.withGaps({ ...z, lo: 99, hi: g.lower }, [g]);
    return g.date === "2026-08-04" && w.count === 3 && w.members.length === 3 && w.lo === 100 && w.hi === 101 &&
      w.members.some((m) => m.gap && m.tier === "structural" && m.labels.join() === "Unfilled price gap") &&
      !!gb && M.bulletWords(gb) === "Unfilled price gap from Tue 4 Aug 2026" && M.zoneNote(w).includes("Unfilled price gap from Tue 4 Aug 2026.") &&
      M.NOTE_KINDS.some((k) => k.key === "gap" && k.label === "Price gaps") && edge.count === 3;
  },
  "gaps: near but not overlapping, or none, adds nothing": ({ M }) => {
    const [g] = M.zoneGaps(GAP_OPEN);
    const z = { lo: 98, hi: 100.4, count: 2, members: [
      { labels: ["MA50"], value: 98, tier: "structural", date: null, rank: 2 },
      { labels: ["MA200"], value: 100.4, tier: "structural", date: null, rank: 0 }] };
    return M.withGaps(z, [g]) === z && M.withGaps(z, []) === z && M.zoneNoteParts(z, 110).bullets.every((b) => b.kind !== "gap");
  },
  "gaps: on the page's zones, each shown zone holds exactly the gaps that overlap it, and they never make, move or pick a zone": ({ M, rising, falling, flat, gapped }) => {
    let withGap = 0;
    const ok = [[RISING, rising], [FALLING, falling], [FLAT, flat], [RISING, gapped]].every(([bars, c]) => {
      const gaps = M.zoneGaps(bars), all = M.allZones(c.levels, c.band, c.price);
      return shownZones(c).every((z) => {
        const over = gaps.filter((g) => g.lower <= z.hi && g.upper >= z.lo), base = all.find((a) => a.lo === z.lo && a.hi === z.hi);
        if (over.length) withGap++;
        return !!base && z.count === base.count + over.length && z.members.filter((m) => m.gap).length === over.length;
      });
    });
    return ok && withGap > 0;
  },
  "gaps: the card holds no ReasonedValue (its labels' translateY can't capture a fixed note)": () =>
    !/ReasonedValue|EstimatedValue/.test(stripComments(read(CARD), { file: CARD })),
  "gaps: the card says how a gap counts, in plain words, with no forecast": ({ M }) => {
    const [g] = M.zoneGaps(GAP_OPEN);
    const note = M.zoneNote(M.withGaps({ lo: 100, hi: 101, count: 2, members: [
      { labels: ["MA50"], value: 100, tier: "structural", date: null, rank: 2 }, { labels: ["MA200"], value: 101, tier: "structural", date: null, rank: 0 }] }, [g]));
    return M.GAP_WHAT === "An unfilled price gap (a jump of at least half the usual daily range that prices haven't gone back into, over the last 250 sessions) adds one level to a zone it overlaps; it never makes a zone on its own." &&
      /\$\{GAP_WHAT\}/.test(read(CARD)) && !FORECAST.test(M.GAP_WHAT) && !FORECAST.test(note) && !FORECAST.test(M.GAP_LABEL);
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
  ["the nearest 2 qualifying zones above and below; a zone holding the price is 'inside'", "l", (s) => s.replace("const above = zones.filter((z) => z.lo > price).sort((x, y) => x.lo - y.lo).slice(0, SHOWN)", "const above = zones.filter((z) => z.lo > price).sort((x, y) => y.lo - x.lo).slice(0, SHOWN)")],
  ["the nearest 2 qualifying zones above and below; a zone holding the price is 'inside'", "l", (s) => s.replace("export const SHOWN = 2;", "export const SHOWN = 1;")],
  ["price inside a zone: shown as 'price inside zone', the next ones out above and below", "l", (s) => s.replace("const inside = insideZone ? withGaps(insideZone, gaps) : null;", "const inside = null;")],
  ["price inside a zone: shown as 'price inside zone', the next ones out above and below", "c", (s) => s.replace('{mark.side === "inside" ? <div className="czInside"', '{false ? <div className="czInside"')],
  ["a fixed scale: the shown zones and the price, padded; the dot at its true height, never centred", "l", (s) => s.replace("scale: { lo: lo - pad, hi: hi + pad }, levels:", "scale: { lo: price - Math.max(price - lo, hi - price) - pad, hi: price + Math.max(price - lo, hi - price) + pad }, levels:")],
  ["a fixed scale: the shown zones and the price, padded; the dot at its true height, never centred", "c", (s) => s.replace("top: priceY + dotOff - 6,", "top: ZONE_LADDER_HEIGHT / 2 - 6 + dotOff,")],
  ["zone labels: stacked apart on one side, each band at its own price range", "l", (s) => s.replace("const ys = stackLabels(marks.map((m) => m.labelY), ZONE_LABEL_GAP, height, ZONE_LABEL_GAP / 2);", "const ys = marks.map((m) => m.labelY);")],
  ["projections marked ≈ in the tap note, as one-session projections", "l", (s) => s.replace("return `${ESTIMATE_SIGN} ${priceWords(m.value)}: ${m.derived} (a one-session projection).`;", "return `${priceWords(m.value)}: ${m.derived}.`;")],
  ["the copy describes, never forecasts or advises", "l", (s) => s.replace("Some traders watch areas like this; a description, not a forecast.", "Price will likely bounce at these zones.")],
  ["the copy describes, never forecasts or advises", "c", (s) => s.replace("`Band: a zone's lowest to highest level", "`Buy near a zone · Band: a zone's lowest to highest level")],
  ["placement: its own card directly above Key levels in the sidebar, once", "p", (s) => s.replace('<div className="sp-slot sp-confluence">', '<div className="sp-slot sp-confluence-moved">')],
  ["the small print folded (#88 §1): 'How to read this' closed, holding the key, the kinds' dots and the hedge; the credit outside", "c", (s) => s.replace('{credit ? <p className="czCredit" style={noteStyle}>Daily prices: {credit}</p> : null}', "").replace('<p className="czNoteText" style={{ margin: "6px 0 0" }}>{CONFLUENCE_NOTE}</p>', '<p className="czNoteText" style={{ margin: "6px 0 0" }}>{CONFLUENCE_NOTE}</p>{credit ? <p>Daily prices: {credit}</p> : null}')],
  ["the small print folded (#88 §1): 'How to read this' closed, holding the key, the kinds' dots and the hedge; the credit outside", "c", (s) => s.replace('{marks.length ? <p className="czKey" style={{ margin: 0 }}>{ZONES_KEY}</p> : null}', "")],
  ["the ladder is taller (#88 §2): 320 px, at least 280 on a phone", "l", (s) => s.replace("export const ZONE_LADDER_HEIGHT = 320;", "export const ZONE_LADDER_HEIGHT = 220;")],
  ["the zone note (#88 §4): header in the zone's colour, one bullet per level grouped by kind with its dot, shared prices on one bullet, a muted footer", "l", (s) => s.replace(".sort((a, b) => order(a.kind) - order(b.kind) || b.value - a.value);", ".sort((a, b) => order(b.kind) - order(a.kind) || b.value - a.value);")],
  ["the zone note (#88 §4): header in the zone's colour, one bullet per level grouped by kind with its dot, shared prices on one bullet, a muted footer", "c", (s) => s.replace('<div className="czNoteHead" style={{ fontWeight: 850, color: ZONE_COLOUR[n.side] }}>', '<div className="czNoteHead" style={{ fontWeight: 850, color: C.value }}>')],
  ["the zone note (#88 §4): header in the zone's colour, one bullet per level grouped by kind with its dot, shared prices on one bullet, a muted footer", "c", (s) => s.replace("<NoteDot colour={kindMeta(b.kind).colour} />", "")],
  ["the zone note (#88 §4): header in the zone's colour, one bullet per level grouped by kind with its dot, shared prices on one bullet, a muted footer", "l", (s) => s.replace("  return `${b.names.join(\" · \")} — ${priceWords(b.value)}", "  return `${b.names[0]} — ${priceWords(b.value)}")],
  ["the note opens beside the tap (#88 §3): below the label, flipped above off the screen's bottom; inline on a phone, pushing what follows", "t", (s) => s.replace("return offBottom && fitsAbove ? { top: above, flipped: true }", "return offBottom ? { top: above, flipped: true }")],
  ["the note opens beside the tap (#88 §3): below the label, flipped above off the screen's bottom; inline on a phone, pushing what follows", "t", (s) => s.replace("return ys.map((y) => (y >= from ? noteHeight + NOTE_GAP * 2 : 0));", "return ys.map(() => 0);")],
  ["one note open at a time; ✕, Esc or a tap outside closes it; the zone labels use it (#88 §3)", "t", (s) => s.replace("const l = (o: string | null) => setOpen(o === id);", "const l = (o: string | null) => { if (o === id) setOpen(true); };")],
  ["one note open at a time; ✕, Esc or a tap outside closes it; the zone labels use it (#88 §3)", "t", (s) => s.replace('if (e.key === "Escape") close();', "")],
  ["one note open at a time; ✕, Esc or a tap outside closes it; the zone labels use it (#88 §3)", "c", (s) => s.replace("if (phone) { onPush(index, bottom, h); return; }", "")],
  ["gaps: B's detector at its defaults, imported, not copied; closed bars only", "l", (s) => s.replace("const closed = closedBars(bars).filter(", "const closed = [...(bars ?? [])].filter(")],
  ["gaps: B's detector at its defaults, imported, not copied; closed bars only", "l", (s) => s.replace("return fairValueGaps(closed.map((b) => ({ date: b.date, high: b.high!, low: b.low!, close: b.close })));", "return fairValueGaps(closed.map((b) => ({ date: b.date, high: b.high!, low: b.low!, close: b.close })), { lookback: 20 });")],
  ["gaps: an overlapping gap adds one structural member and a dated note line; the range stays", "l", (s) => s.replace("count: z.count + added.length };", "count: z.count };")],
  ["gaps: an overlapping gap adds one structural member and a dated note line; the range stays", "l", (s) => s.replace("return { ...z, members: [...z.members, ...added]", "return { ...z, hi: Math.max(z.hi, ...over.map((g) => g.upper)), members: [...z.members, ...added]")],
  ["gaps: an overlapping gap adds one structural member and a dated note line; the range stays", "l", (s) => s.replace("return `${GAP_LABEL} from ${dateWords(b.date)}`;", "return `${GAP_LABEL} from ${dateWords(b.date).replace(/ \\d{4}$/, \"\")}`;")],
  ["gaps: an overlapping gap adds one structural member and a dated note line; the range stays", "l", (s) => s.replace('  if (label === GAP_LABEL) return "gap";\n', "")],
  ["gaps: near but not overlapping, or none, adds nothing", "l", (s) => s.replace("g.lower <= z.hi && g.upper >= z.lo;", "g.lower <= z.hi + 1 && g.upper >= z.lo - 1;")],
  ["gaps: on the page's zones, each shown zone holds exactly the gaps that overlap it, and they never make, move or pick a zone", "l", (s) => s.replace("const zones = allZones(dedupe(levels), band, price);", "const zones = [...allZones(dedupe(levels), band, price), ...zoneGaps(inp.bars).map((g) => ({ lo: g.lower, hi: g.upper, members: [], count: 1 }))];")],
  ["gaps: on the page's zones, each shown zone holds exactly the gaps that overlap it, and they never make, move or pick a zone", "l", (s) => s.replace("const below = zones.filter((z) => z.hi < price).sort((x, y) => y.hi - x.hi).slice(0, SHOWN).map((z) => withGaps(z, gaps));", "const below = zones.filter((z) => z.hi < price).sort((x, y) => y.hi - x.hi).slice(0, SHOWN);")],
  ["gaps: the card holds no ReasonedValue (its labels' translateY can't capture a fixed note)", "c", (s) => s.replace("<h2 style={titleStyle}>Price zones</h2>", "<h2 style={titleStyle}>Price zones</h2><ReasonedValue value={null} />")],
  ["gaps: the card says how a gap counts, in plain words, with no forecast", "l", (s) => s.replace('export const GAP_WHAT = "An unfilled price gap (a jump', 'export const GAP_WHAT = "An unfilled price gap (likely to fill; a jump')],
  ["gaps: the card says how a gap counts, in plain words, with no forecast", "l", (s) => s.replace("return `${GAP_LABEL} from ${dateWords(m.date)}.`;", "return `${GAP_LABEL} from ${dateWords(m.date)}: price will likely fill it.`;")],
  ["no fetch, no Redis, no provider reads", "l", (s) => s.replace("export const K_ATR = 0.35;", "export const K_ATR = 0.35;\nconst probe = () => fetch(\"/api/x\");")],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
const pageSrc = read(PAGE), TAP = "app/stock/[symbol]/TapNote.tsx", tapSrc = read(TAP);
for (const [label, where, mutate] of MUTANTS) {
  const src = where === "l" ? libSrc : where === "c" ? cardSrc : where === "t" ? tapSrc : pageSrc;
  const mut = mutate(src);
  if (mut === src) { check(`mutant bites: ${label}`, false, "the mutation did not apply"); continue; }
  let caught;
  // Rules that read a source file from disk get the mutation on disk, restored after.
  const onDisk = where === "p" || (where === "l" && label.startsWith("no fetch")) || label.startsWith("one note open") || label.startsWith("gaps: the card holds no ReasonedValue");
  if (onDisk) {
    const file = { p: PAGE, l: LIB, c: CARD, t: TAP }[where];
    fs.writeFileSync(file, mut);
    try { caught = !run(RULES[label], base); } finally { fs.writeFileSync(file, src); }
  } else {
    let m;
    try { m = measure(await load(where === "l" ? mut : libSrc, where === "c" ? mut : cardSrc, where === "t" ? mut : tapSrc)); } catch { m = null; }
    caught = !m || !run(RULES[label], m);
  }
  check(`mutant bites: ${label}`, caught);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
