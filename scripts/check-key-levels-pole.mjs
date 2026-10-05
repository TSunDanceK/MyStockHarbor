// THE KEY LEVELS POLE (#563 COWORK #115, "E1, true scale"): rules, then mutants.
//
// lib/ta/keyLevelPole.ts and app/stock/[symbol]/KeyLevelsCard.tsx, transpiled
// with their imports (sessionBar, keyLevels, TapNote) and rendered with the
// fixtures #115 lists: a normal day, a Monday (the Week skipped), the first
// session of a month (the Month skipped), a flat day, a gap from the previous
// close, a crowded cluster of six levels within 0.3%, and a thin stock whose
// levels are one price.
//
// Rules: every tick at its true height on a padded scale; the labels at least
// the gap apart, inside the pole, with leaders from each tick to its label;
// equal prices (2 dp) one label; green above the last price, red below; the
// Week (and Month) skipped when only the latest session, and said so; the
// level list; the last-price pill; the hidden list; the key line; "How to read
// this" gone; the Tiingo credit; no advice; the SVG aria-hidden and no
// transform; sizes in rem or tokens. A mutant each.
//
//   node scripts/check-key-levels-pole.mjs
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { visibleText } from "./lib/render-cards.mjs";
import { stripComments } from "./lib/source-code.mjs";

const SESS = "lib/ta/sessionBar.ts", KL = "lib/ta/keyLevels.ts", TAP = "app/stock/[symbol]/TapNote.tsx";
const POLE = "lib/ta/keyLevelPole.ts", CARD = "app/stock/[symbol]/KeyLevelsCard.tsx";
const read = (f) => fs.readFileSync(f, "utf8");
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");

let n = 0;
async function load(pole, card) {
  const unit = `import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";\n${[read(SESS), read(KL), read(TAP), pole].map(strip).join("\n")}\n${strip(card).replace("export default function KeyLevelsCard", "export function KeyLevelsCard")}\n`;
  const js = ts.transpileModule(unit, { fileName: "k.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText;
  const tmp = `scripts/.check-key-levels-pole-${process.pid}-${n++}.mjs`;
  fs.writeFileSync(tmp, js);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

// ── fixtures: weekday bars from 3 Aug 2026 to `end` (Labor Day off), every value distinct ──
function bars(end, f = (i) => 200 + Math.sin(i / 4) * 6 + i * 0.05) {
  const out = [];
  for (let t = Date.parse("2026-08-03T00:00:00Z"), i = 0; t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t), date = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || date === "2026-09-07") continue;
    const c = f(i++);
    out.push({ date, open: c - 0.7, high: c + 1.9, low: c - 2.3, close: c });
  }
  return out;
}
const set = (b, date, v) => b.map((x) => (x.date === date ? { ...x, ...v } : x));
const NORMAL = bars("2026-10-08"); // Thu: the week from Mon 5 Oct, the month from Thu 1 Oct
const MONDAY = bars("2026-10-05");
const FIRST = bars("2026-10-01"); // Thu 1 Oct: the month is that one session
const FLAT = set(NORMAL, "2026-10-08", { open: 210, high: 210, low: 210, close: 210 });
const GAP = (() => { const p = NORMAL.find((x) => x.date === "2026-10-07").close; return set(NORMAL, "2026-10-08", { open: p * 1.06, high: p * 1.08, low: p * 1.05, close: p * 1.07 }); })();
// Six levels within 0.3%: the week's and the day's bars all near 250.
const CROWD = NORMAL.map((x) => (x.date >= "2026-10-05" ? { ...x, open: 250 + (x.date.slice(-1) * 0.05), high: 250.6, low: 249.4, close: 250 + (x.date.slice(-1) * 0.07) } : x));
const THIN = NORMAL.map((x) => (x.date >= "2026-09-18" ? { ...x, open: 11.24, high: 11.24, low: 11.24, close: 11.24 } : x));
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;
const ADVICE = /\b(buy|sell|bullish|bearish|support|resistance|target|should|recommend|will)\b/i;

async function measure(M, src) {
  const at = (b, last) => M.keyLevelPole(M.keyLevels(b), last ?? b[b.length - 1].close);
  const P = { normal: at(NORMAL), monday: at(MONDAY), first: at(FIRST), flat: at(FLAT), gap: at(GAP), crowd: at(CROWD), thin: at(THIN) };
  const render = (b, credit) => renderToStaticMarkup(React.createElement(M.KeyLevelsCard, { bars: b, lastPrice: b[b.length - 1].close, credit }));
  const svg = (p) => renderToStaticMarkup(React.createElement(M.PoleSvg, { pole: p }));
  return { M, P, html: { normal: render(NORMAL, React.createElement("a", { href: "#" }, "Market data from Tiingo.com")), monday: render(MONDAY), bare: render(NORMAL) }, svg, ...src };
}
const names = (p) => p.rows.filter((r) => !r.last).flatMap((r) => r.names);

const RULES = {
  "true scale: every tick at (hi − v) / (hi − lo) × height, the scale padded past the month's range and every level": ({ P }) =>
    Object.values(P).every((p) => p.rows.every((r) => near(r.y, ((p.hi - r.value) / (p.hi - p.lo)) * p.height)) &&
      p.lo < Math.min(...p.rows.map((r) => r.value)) && p.hi > Math.max(...p.rows.map((r) => r.value))) &&
    P.normal.month.top > 0 && P.normal.month.bottom < P.normal.height && P.normal.day.top >= P.normal.month.top - 1e-9 && P.normal.day.bottom <= P.normal.month.bottom + 1e-9,
  "labels: at least the gap apart, in price order, inside the pole; leaders from each tick to its label": ({ M, P, svg }) => {
    const ok = Object.values(P).every((p) => p.rows.every((r, i) => i === 0 || r.ly - p.rows[i - 1].ly >= M.LABEL_GAP_REM - 1e-9) &&
      p.rows.every((r) => r.ly >= M.EDGE_REM - 1e-9 && r.ly <= p.height - M.EDGE_REM + 1e-9));
    const crowded = P.crowd.rows.filter((r) => Math.abs(r.ly - r.y) > 0.05).length >= 2;
    const s = svg(P.crowd);
    const tick = P.crowd.rows.find((r) => !r.last && Math.abs(r.ly - r.y) > 0.05);
    return ok && crowded && M.LABEL_GAP_REM === Math.round(M.LABEL_LINE_REM * 1.4 * 1000) / 1000 &&
      new RegExp(`class="klLeader" d="M[\\d.]+ ${(tick.y * 10).toFixed(4).replace(/0+$/, "").replace(/\\.$/, "")}[\\d]* L[\\d.]+ ${(tick.ly * 10).toFixed(4).replace(/0+$/, "").replace(/\\.$/, "")}`).test(s) &&
      (s.match(/class="klLeader"/g) ?? []).length === 2 * P.crowd.rows.filter((r) => !r.last).length;
  },
  "equal prices (2 dp) are one label: 'Day & Month high'": ({ M, P }) =>
    M.mergeNames(["Day high", "Month high"]) === "Day & Month high" && M.mergeNames(["Day open", "Prev close"]) === "Day open & Prev close" &&
    M.samePrice(1.004, 1.0) && !M.samePrice(1.006, 1.0) &&
    P.thin.rows.filter((r) => !r.last).length === 1 && P.thin.rows.find((r) => !r.last).names.length >= 6 &&
    new Set(P.normal.rows.map((r) => Math.round(r.value * 100))).size === P.normal.rows.length - P.normal.rows.filter((r) => !r.last && P.normal.rows.some((q) => q.last && Math.round(q.value * 100) === Math.round(r.value * 100))).length,
  "green above the last price, red below, muted level with it": ({ M, P, html }) =>
    Object.values(P).every((p) => p.rows.every((r) => r.last || r.side === (M.samePrice(r.value, p.last) ? "at" : r.value > p.last ? "up" : "down"))) &&
    M.SIDE_COLOUR.up === "#22c55e" && M.SIDE_COLOUR.down === "#ef4444" &&
    /data-side="up"[\s\S]*?color:#22c55e/.test(html.normal) && /data-side="down"[\s\S]*?color:#ef4444/.test(html.normal),
  "the Week skipped when only the latest session (a Monday), the Month on its first session; the fine print says so": ({ P, html }) =>
    !names(P.monday).some((n) => n.startsWith("Week") || n === "Last week's close") && P.monday.skipped === "Week = the latest session" &&
    !names(P.first).some((n) => n.startsWith("Month") || /^[A-Z][a-z]{2} close$/.test(n)) && P.first.skipped === "Month = the latest session" &&
    names(P.normal).some((n) => n === "Week open") && P.normal.skipped === null && /Week = the latest session/.test(visibleText(html.monday)),
  "the levels: Day open, high, low; Prev close; Week open, high, low, last week's close; Month open, high, low and 'Sep close'": ({ M, P }) => {
    const all = M.poleLevels(M.keyLevels(NORMAL)).list.map((l) => l.name);
    return ["Day open", "Day high", "Day low", "Prev close", "Week open", "Week high", "Week low", "Last week's close", "Month open", "Month high", "Month low", "Sep close"].every((x) => all.includes(x)) && all.length === 12 &&
      M.poleLevels(M.keyLevels(GAP)).list.some((l) => l.name === "Prev close") && P.gap.rows.some((r) => r.names.includes("Prev close") && r.side === "down");
  },
  "a flat day draws: its levels merge into one label with the last price beside it": ({ P }) =>
    P.flat.day.bottom - P.flat.day.top === 0 && P.flat.rows.some((r) => r.names.includes("Day open") && r.names.includes("Day high") && r.names.includes("Day low")) && P.flat.rows.some((r) => r.last),
  "the last price: an accent mark on the pole and a pill, 'Last price 332.94'": ({ html, svg, P }) =>
    /class="klPill"[^>]*><span>Last price<\/span><span[^>]*>[\d,.]+<\/span>/.test(html.normal) && /class="klLastMark"/.test(svg(P.normal)) &&
    P.normal.rows.filter((r) => r.last).length === 1,
  "screen readers: a visually hidden list of the levels in price order, with their distances; the pole aria-hidden": ({ M, P, html }) => {
    const words = M.poleListWords(P.normal);
    return words.length === P.normal.rows.length && /^[A-Z][^$]* \$[\d,.]+, [\d.]+% (above|below) the last price$|^Last price \$[\d,.]+$/.test(words[0]) &&
      /<ul class="klList" style="[^"]*clip:rect\(0 0 0 0\)/.test(html.normal) && /<div class="klPole" aria-hidden="true"/.test(html.normal) && /<svg class="klPoleSvg" aria-hidden="true"/.test(html.normal);
  },
  "the key line under the pole; 'How to read this' gone; 'What are these?' kept": ({ M, html }) => {
    const t = visibleText(html.normal);
    return M.POLE_KEY === "Green: above the last price · red: below · thick band: today's range · thin: this month's" && t.replace(/\s+/g, "").includes(M.POLE_KEY.replace(/\s+/g, "")) &&
      !/How to read this/.test(t) && /What are these\?/.test(t) && /class="klKey" data-fine-print="true" style="[^"]*font-size:var\(--fs-label\)/.test(html.normal);
  },
  "the Tiingo credit when passed, as fine print": ({ html }) =>
    /<p class="klCredit" data-fine-print="true"[^>]*>Daily prices: <a href="#">Market data from Tiingo\.com<\/a><\/p>/.test(html.normal) && !/Daily prices/.test(html.bare),
  "no advice or forecast words": ({ M, html }) => !ADVICE.test(`${visibleText(html.normal)} ${visibleText(html.monday)} ${M.KEY_LEVELS_NOTE.replace("not where it will go", "")}`),
  "sizes in rem or tokens, the pill larger than the labels; no transform anywhere in the card": ({ card }) =>
    !/fontSize:\s*\d/.test(card) && /className="klPill"[^\n]*fontSize: "var\(--fs-label\)", fontWeight: 800/.test(card) && /className="klDist"[^\n]*fontSize: "var\(--fs-fine\)"/.test(card) &&
    !/transform|translate\(|rotate\(|will-change/.test(card),
};

let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch { return false; } };
const SRC = { pole: read(POLE), card: read(CARD) };
const meas = async (s) => measure(await load(s.pole, s.card), { card: stripComments(s.card, { file: CARD }) });

console.log("=== Rules ===");
const base = await meas(SRC);
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base));

const R = Object.keys(RULES);
const find = (start) => { const r = R.find((x) => x.startsWith(start)); if (!r) throw new Error(`no rule ${start}`); return r; };
const MUTANTS = [
  ["true scale", "pole", (s) => s.replace("const y = (v: number) => ((hi - v) / (hi - lo)) * height;", "const y = (v: number) => ((hi - v) / (hi - lo)) * height * 0.9;")],
  ["true scale", "pole", (s) => s.replace("lo -= span * PAD_FRACTION; hi += span * PAD_FRACTION;", "")],
  ["labels:", "pole", (s) => s.replace("for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1] + g(i)) out[i] = out[i - 1] + g(i);", "return out;")],
  ["labels:", "card", (s) => s.replace("d={`M${mid - 9} ${ty} L${mid - 12} ${ly} L0 ${ly}`}", "d={`M${mid - 9} ${ty} L0 ${ty}`}").replace("d={`M${mid + 9} ${ty} L${mid + 12} ${ly} L${W} ${ly}`}", "d={`M${mid + 9} ${ty} L${W} ${ty}`}")],
  ["labels:", "pole", (s) => s.replace("export const LABEL_GAP_REM = Math.round(LABEL_LINE_REM * 1.4 * 1000) / 1000;", "export const LABEL_GAP_REM = 0.6;")],
  ["equal prices", "pole", (s) => s.replace("export const samePrice = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);", "export const samePrice = (a: number, b: number) => a === b;")],
  ["equal prices", "pole", (s) => s.replace('if (tail && split.every(([, t]) => t === tail)) return `${split.map(([h]) => h).join(" & ")} ${tail}`;', "")],
  ["green above", "pole", (s) => s.replace(': r.value > last ? "up" : "down",', ': r.value > last ? "down" : "up",')],
  ["green above", "card", (s) => s.replace('{ up: "#22c55e", down: "#ef4444",', '{ up: "#ef4444", down: "#22c55e",')],
  ["the Week skipped", "pole", (s) => s.replace("const weekIsDay = !!week && !!day && !week.reason && week.from === day.from;", "const weekIsDay = false;")],
  ["the Week skipped", "pole", (s) => s.replace("const monthIsDay = !!month && !!day && !month.reason && month.from === day.from;", "const monthIsDay = false;")],
  ["the levels:", "pole", (s) => s.replace('    add("Last week\'s close", week.prevClose?.value);\n', "")],
  ["the levels:", "pole", (s) => s.replace("add(`${MONTH_NAMES[Number(month.prevClose.date.slice(5, 7)) - 1]} close`", 'add("Month close"')],
  ["a flat day", "pole", (s) => s.replace("const merged: { names: string[]; value: number }[] = [];", "const merged: { names: string[]; value: number }[] = [];\n  const samePrice = (a: number, b: number) => a === b && false;")],
  ["the last price:", "card", (s) => s.replace("<span>Last price</span>", "<span>Now</span>")],
  ["screen readers", "card", (s) => s.replace('<ul className="klList" style={srOnly}>', '<ul className="klList">')],
  ["screen readers", "card", (s) => s.replace('<div ref={box} className="klPole" aria-hidden="true"', '<div ref={box} className="klPole"')],
  ["the key line", "pole", (s) => s.replace('export const POLE_KEY = "Green: above the last price · red: below · thick band: today\'s range · thin: this month\'s";', 'export const POLE_KEY = "Green and red: price levels";')],
  ["the Tiingo credit", "card", (s) => s.replace("{credit ? <>Daily prices: {credit}</> : null}", "{null}")],
  ["no advice", "pole", (s) => s.replace('`Week = ${only}`', '`Week = today so far: a level to buy`')],
  ["sizes in rem", "card", (s) => s.replace('fontSize: "var(--fs-label)", fontWeight: 800, lineHeight: 1.4', "fontSize: 11, fontWeight: 800, lineHeight: 1.4")],
  ["sizes in rem", "card", (s) => s.replace('style={{ position: "absolute", left: 0, right: 0, top: `calc(', 'style={{ transform: "translateY(-50%)", position: "absolute", left: 0, right: 0, top: `calc(')],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [start, where, mutate] of MUTANTS) {
  const label = find(start), mut = mutate(SRC[where]);
  if (mut === SRC[where]) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  let m;
  try { m = await meas({ ...SRC, [where]: mut }); } catch { m = null; }
  check(`mutant bites: ${label}`, !m || !run(RULES[label], m));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
