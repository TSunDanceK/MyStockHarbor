// THE STRENGTH BADGE (#563 COWORK #105): C's lib/strengthBadge.ts, the pill
// and note in app/stock/[symbol]/StrengthBadge.tsx, and the page's hand-over.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE RULE: a trend check, an RS window or cut-off, the RSI pull, the
//      earnings points or a word's cut-off drifting from the ruled table.
//   2. MISSING INPUTS: an input with too little history counted anyway, the S&P
//      500 compared on different dates, a word shown on fewer than 2 inputs,
//      or earnings without a read given points.
//   3. THE HOLD: a new word shown before 3 sessions in a row, or no date.
//   4. "Today so far" scored as a session.
//   5. THE NOTE: an input or its points missing, no hold sentence, the
//      not-a-recommendation line or the credit gone, or wording that tells the
//      reader what to do.
//   6. THE PAGE: a fetch of its own, FMP's series scored, a transform on the
//      pill or anything around it (it would capture a fixed note).
// Fixtures per word and per missing input; a mutant per rule.
//
//   node scripts/check-strength-badge.mjs
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { visibleText } from "./lib/render-cards.mjs";
import { stripComments } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const FILES = {
  sess: "lib/ta/sessionBar.ts", kl: "lib/ta/keyLevels.ts", perf: "lib/ta/performance.ts", earn: "lib/earningsBadge.ts",
  lib: "lib/strengthBadge.ts", tap: "app/stock/[symbol]/TapNote.tsx", card: "app/stock/[symbol]/StrengthBadge.tsx",
};
const PAGE = "app/stock/[symbol]/page.tsx";
const CLIENT = "app/stock/[symbol]/StockSymbolPageClient.tsx";
const read = (f) => fs.readFileSync(f, "utf8");
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");

async function load(over = {}) {
  const src = (k) => over[k] ?? read(FILES[k]);
  const unit = `import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";\n${["sess", "kl", "perf", "earn", "lib", "tap", "card"].map((k) => strip(src(k))).join("\n")}\n`;
  const js = ts.transpileModule(unit, { fileName: "s.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText;
  const tmp = `scripts/.check-strength-badge-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`;
  fs.writeFileSync(tmp, js);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

// ── fixtures ────────────────────────────────────────────────────────────────
function bars(n, f, end = "2026-10-02") {
  const out = [];
  for (let t = Date.parse(`${end}T00:00:00Z`); out.length < n; t -= 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse().map((date, i) => ({ date, close: f(i), open: 1, high: 1, low: 1 }));
}
/** A steady drift with a zig-zag, so RSI sits away from 0 and 100. */
const drift = (g, wiggle = 0.012) => (i) => 100 * Math.exp(g * i) * (1 + (i % 2 ? wiggle : -wiggle));
const N = 400;
const SPY_FLAT = bars(N, drift(0));
const SPY_UP = bars(N, drift(0.0015));
const GOOD = { score: 76, tone: "good", partial: false, toneLabel: "Good", periodLabel: "Q3 FY2026" };
const MIXED = { ...GOOD, score: 55, tone: "neutral", toneLabel: "Mixed" };
const WEAK = { ...GOOD, score: 30, tone: "weak", toneLabel: "Weak" };
const PARTIAL = { ...GOOD, partial: true, toneLabel: "Partial · 3 of 5 measured" };

function cases(M) {
  const B = (stock, spy, snap) => M.strengthBadge(stock, spy, M.earningsBadgeInput(snap));
  const up = bars(N, drift(0.0015));
  const down = bars(N, drift(-0.0015));
  return {
    // Trend +2, RS 3m +1, RS 12m +1, RSI 0, earnings +1 → +5.
    strong: B(up, SPY_FLAT, GOOD),
    // Trend +2, both RS 0 (level with SPY), no earnings read → +2.
    firm: B(up, SPY_UP, null),
    // Trend +2, RS 0, earnings Weak −1 → +1.
    neutral: B(up, SPY_UP, WEAK),
    // Trend −2 (all three checks fail), RS 0 against a falling SPY, Mixed 0 → −2.
    soft: B(down, bars(N, drift(-0.0015)), MIXED),
    // Trend −2, RS −1 −1, earnings Weak −1 → −5.
    weak: B(down, SPY_FLAT, WEAK),
    // Exactly +4 (Strong's floor): trend +2, RS +1 +1, no earnings.
    four: B(up, SPY_FLAT, null),
    // A straight line up: RSI 100 with a positive total pulls back 1 → +2 +1 +1 −1 = +3.
    stretched: B(bars(N, (i) => 100 * Math.exp(0.0015 * i)), SPY_FLAT, null),
    // A straight line down: RSI 0 with a negative total pulls back 1 → −2 −1 −1 +1 = −3.
    slumped: B(bars(N, (i) => 100 * Math.exp(-0.0015 * i)), SPY_FLAT, null),
    // A sharp 20-session dip in a long rise: RSI under 30 with a positive total (+1 trend, +1 RS 12m) → no pull.
    dip: B(bars(N, (i) => (i < 380 ? 100 * Math.exp(0.0015 * i) : 100 * Math.exp(0.0015 * 380 - 0.004 * (i - 380)))), SPY_FLAT, null),
    // MISSING INPUTS
    short: B(bars(50, drift(0.0015)), SPY_FLAT, GOOD), // no trend, no RS: RSI + earnings = 2 inputs
    tooShort: B(bars(10, drift(0.0015)), SPY_FLAT, GOOD), // earnings only → Not enough data
    noRs12: B(bars(230, drift(0.0015)), SPY_FLAT, null), // trend, RS 3m, RSI; no 12m
    noSpy: B(up, null, null),
    spyBehind: B(up, SPY_FLAT.slice(0, -1), null), // SPY's last day missing: RS not on the same dates
    partial: B(up, SPY_FLAT, PARTIAL),
    notRead: B(up, SPY_FLAT, null),
    empty: B([], SPY_FLAT, GOOD),
    // TODAY SO FAR is never scored.
    withToday: B([...up, { date: "2026-10-05", close: 1, partial: true }], SPY_FLAT, GOOD),
  };
}
const line = (b, k) => b.lines.find((l) => l.key === k);
const pointsOf = (b) => Object.fromEntries(b.lines.map((l) => [l.key, l.counted ? l.points : null]));
const sum = (b) => b.lines.reduce((a, l) => a + l.points, 0);

// The hold, on word sequences.
const seqOf = (words) => words.map((word, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, word }));
const holds = (M) => ({
  two: M.applyHold(seqOf(["Firm", "Firm", "Firm", "Strong", "Strong"])),
  three: M.applyHold(seqOf(["Firm", "Firm", "Firm", "Strong", "Strong", "Strong", "Strong"])),
  broken: M.applyHold(seqOf(["Firm", "Strong", "Strong", "Neutral", "Strong", "Strong"])),
  back: M.applyHold(seqOf(["Firm", "Soft", "Soft", "Soft", "Firm", "Firm", "Firm"])),
});

const ADVICE = /\b(buy|buying|sell|selling|should|must|recommend\w*|consider|accumulate|avoid|opportunit\w*|bargain|undervalued|overvalued|cheap|target|upside|downside)\b/i;

function rules(M, o) {
  const C = cases(M), H = holds(M);
  const render = (b, credit) => visibleText(renderToStaticMarkup(React.createElement(M.StrengthNoteBody, { badge: b, credit })));
  const credited = render(C.strong, React.createElement("a", { href: "#" }, "Tiingo credit"));
  const allText = Object.values(C).map((b) => render(b)).join("\n") + `\n${credited}`;
  const lib = stripComments(o.lib, { file: FILES.lib }), card = stripComments(o.card, { file: FILES.card });
  const page = stripComments(o.page, { file: PAGE }), client = stripComments(o.client, { file: CLIENT });
  return {
    // 1. THE RULE, a fixture per word.
    "Strong: trend +2, RS 3m +1, RS 12m +1, RSI 0, earnings Good +1 = +5": () =>
      C.strong.word === "Strong" && C.strong.total === 5 && JSON.stringify(pointsOf(C.strong)) === JSON.stringify({ trend: 2, rs3m: 1, rs12m: 1, rsi: 0, earnings: 1 }),
    "Firm: trend +2 level with the S&P 500, no earnings read = +2": () =>
      C.firm.word === "Firm" && C.firm.total === 2 && JSON.stringify(pointsOf(C.firm)) === JSON.stringify({ trend: 2, rs3m: 0, rs12m: 0, rsi: 0, earnings: null }),
    "Neutral: +2 with earnings Weak −1 = +1": () => C.neutral.word === "Neutral" && C.neutral.total === 1 && line(C.neutral, "earnings").points === -1,
    "Soft: trend −2 (no check passed), RS level, earnings Mixed 0 = −2": () =>
      C.soft.word === "Soft" && C.soft.total === -2 && pointsOf(C.soft).trend === -2 && pointsOf(C.soft).earnings === 0 && /^0 of 3 checks/.test(line(C.soft, "trend").reading) &&
      C.slumped.word === "Soft" && C.stretched.word === "Firm",
    "Weak: trend −2, RS −1 −1, earnings Weak −1 = −5": () => C.weak.word === "Weak" && C.weak.total === -5,
    "Strong's floor is +4 (the symmetric cut-offs)": () => C.four.total === 4 && C.four.word === "Strong" && M.wordFor(3) === "Firm" && M.wordFor(-1) === "Neutral" && M.wordFor(-2) === "Soft" && M.wordFor(-4) === "Weak" && M.wordFor(1) === "Neutral",
    "trend points: 1 check passed → −1, 2 → +1 (the 0→−2 … 3→+2 table)": () =>
      JSON.stringify([...M.TREND_POINTS]) === JSON.stringify([-2, -1, 1, 2]),
    "RS windows: 63 sessions at ±5 points, 252 at ±10": () =>
      /over 63 sessions .*±5 pts/.test(line(C.strong, "rs3m").reading) && /over 252 sessions .*±10 pts/.test(line(C.strong, "rs12m").reading) &&
      C.firm.lines.filter((l) => l.key.startsWith("rs")).every((l) => l.counted && l.points === 0),
    "RSI pulls toward Neutral: ≥ 70 with a positive total −1, ≤ 30 with a negative total +1": () =>
      line(C.stretched, "rsi").points === -1 && C.stretched.total === 3 && line(C.slumped, "rsi").points === 1 && C.slumped.total === -3 && line(C.strong, "rsi").points === 0 &&
      Number(line(C.dip, "rsi").reading.split(",")[0].split(":")[0]) <= 30 && line(C.dip, "rsi").points === 0 && C.dip.total > 0,
    "earnings: Good +1 · Mixed 0 · Weak −1": () => line(C.strong, "earnings").points === 1 && line(C.soft, "earnings").points === 0 && line(C.weak, "earnings").points === -1,
    "the total is the points listed": () => Object.values(C).every((b) => b.total === null || b.total === sum(b)),
    // 2. MISSING INPUTS
    "under 64 sessions: no trend, no RS; RSI + earnings still score (2 inputs)": () =>
      !line(C.short, "trend").counted && !line(C.short, "rs3m").counted && C.short.inputs === 2 && C.short.word !== null,
    "fewer than 2 inputs: Not enough data, no word": () => C.tooShort.word === null && C.tooShort.inputs === 1 && /Not enough data/.test(render(C.tooShort)) && C.empty.word === null,
    "under 253 sessions: 12-month RS not counted, 3-month is": () => !line(C.noRs12, "rs12m").counted && line(C.noRs12, "rs3m").counted && /needs 253 sessions/.test(line(C.noRs12, "rs12m").reading),
    "no S&P 500 closes: RS not counted, with why": () => !line(C.noSpy, "rs3m").counted && !line(C.noSpy, "rs12m").counted && /S&P 500/.test(line(C.noSpy, "rs3m").reading),
    "the S&P 500 on the same two dates only": () => !line(C.spyBehind, "rs3m").counted && !line(C.spyBehind, "rs12m").counted,
    "earnings with no read: 'Earnings: not counted (no results read yet)', 0 points": () =>
      !line(C.notRead, "earnings").counted && /Earnings: not counted \(no results read yet\) · 0 points/.test(render(C.notRead)),
    "partial earnings: 'Earnings: not counted (partial results)', 0 points": () =>
      !line(C.partial, "earnings").counted && /Earnings: not counted \(partial results\) · 0 points/.test(render(C.partial)) && C.partial.total === C.notRead.total,
    // 3. THE HOLD
    "the hold: a new word shows only on its 3rd session in a row, dated": () =>
      H.two.shown === "Firm" && H.two.pending?.word === "Strong" && H.two.pending?.sessions === 2 &&
      H.three.shown === "Strong" && H.three.since === "2026-09-06" && H.three.pending === null &&
      H.broken.shown === "Firm" && H.back.shown === "Firm" && H.back.since === "2026-09-07" && M.HOLD_SESSIONS === 3,
    "the note gives the hold sentence and the date of the last change": () =>
      /holds for 3 sessions in a row/.test(C.strong.hold) && /since (at least )?\w{3} \d{1,2} \w{3} \d{4}/.test(C.strong.hold) && render(C.strong).includes(C.strong.hold),
    // 4. TODAY SO FAR
    "today's partial bar is never scored": () => C.withToday.asOf === "2026-10-02" && C.withToday.total === C.strong.total,
    // 5. THE NOTE
    "the note lists all five inputs with their points": () =>
      Object.values(C).filter((b) => b.lines.length).every((b) => { const t = render(b); return ["Trend:", "3-month vs S&P 500:", "12-month vs S&P 500:", "RSI(14):", "Earnings:"].every((l) => t.includes(l)) && (t.match(/ · [+−]?\d+ points?\b/g) ?? []).length === 5; }),
    "the note carries the cut-offs, 'A description of recent price and results, not a recommendation.' and the credit": () =>
      credited.includes(M.NOT_ADVICE) && M.NOT_ADVICE === "A description of recent price and results, not a recommendation." && credited.includes("Strong +4 or more") && credited.includes("Tiingo credit"),
    "no advice: nothing tells the reader what to do": () => {
      const words = `${allText}\n${M.CUTOFFS_WORDS}\n${[...lib.matchAll(/`[^`]*`|"[^"]*"/g)].map((m) => m[0]).join("\n")}\n${[...card.matchAll(/>[^<>{}]+</g)].map((m) => m[0]).join("\n")}`;
      return !ADVICE.test(words.split(M.NOT_ADVICE).join(" "));
    },
    // 6. THE PAGE
    "no read of its own: no fetch, Redis or server import in the scorer or the pill": () =>
      ![lib, card].some((s) => /\bfetch\(|redis|@\/lib\/server\/(?!secEarningsSnapshot)|import\(/i.test(s.replace(/import type[^;]+;/g, ""))),
    "the page scores Tiingo's series only, from reads it already makes": () =>
      /const strength = historyResult\.provider === "tiingo" \? strengthBadge\(historyResult\.points, spyPoints, earningsBadgeInput\(secFacts\.snapshot\)\) : null;/.test(page) && /strength=\{strength\}/.test(page),
    "the pill sits left of Share, and under the ticker on a phone": () =>
      /<StrengthPill s=\{strengthTop\} badge=\{strength\} place="top" \/> : null\}\s*<ShareButton/.test(client) &&
      /<h1[^>]*>\{symbol\}<\/h1>\s*<\/div>\s*\{strength \? \(\s*<>\s*<div ref=\{strengthUnderRow\} data-strength-row className="strengthUnderRow">\s*<StrengthPill s=\{strengthUnder\}/.test(client) &&
      /@media \(max-width: 640px\) \{\s*\.strengthPill--top, \.strengthNoteSlot--top \{ display: none; \}/.test(card),
    "no transform on the pill, its note or its rows": () =>
      !/transform|translate\(|rotate\(|scale\(|will-change/.test(card) &&
      !/<div ref=\{strengthTopRow\}[^>]*transform/.test(client) && !/strengthUnderRow[^>]*transform/.test(client),
    "the note's sizes are the tokens": () => !/fontSize:\s*\d/.test(card) && /fontSize: "var\(--fs-label\)"/.test(card),
  };
}

const sources = (over = {}) => ({ lib: over.lib ?? read(FILES.lib), card: over.card ?? read(FILES.card), page: over.page ?? read(PAGE), client: over.client ?? read(CLIENT) });
const run = (fn) => { try { return !!fn(); } catch { return false; } };

console.log("=== Rules ===");
const base = rules(await load(), sources());
for (const [label, fn] of Object.entries(base)) check(label, run(fn));

const R = Object.keys(base);
const find = (start) => { const r = R.find((x) => x.startsWith(start)); if (!r) throw new Error(`no rule ${start}`); return r; };
const MUTANTS = [
  ["Strong:", "lib", (s) => s.replace("checks[0] = ", "checks[0] = ").replace("const checks = [close > m50, close > m200, m50 > m200];", "const checks = [close > m50, close > m200, m50 < m200];")],
  ["trend points", "lib", (s) => s.replace("export const TREND_POINTS = [-2, -1, 1, 2] as const;", "export const TREND_POINTS = [-2, -1, 0, 2] as const;")],
  ["RS windows", "lib", (s) => s.replace('{ key: "rs3m", sessions: 63, cut: 5,', '{ key: "rs3m", sessions: 63, cut: 15,')],
  ["RS windows", "lib", (s) => s.replace('{ key: "rs12m", sessions: 252, cut: 10,', '{ key: "rs12m", sessions: 126, cut: 10,')],
  ["RSI pulls", "lib", (s) => s.replace("rsi >= 70 && price > 0 ? -1", "rsi >= 70 && price < 0 ? -1")],
  ["RSI pulls", "lib", (s) => s.replace("rsi <= 30 && price < 0 ? 1", "rsi <= 30 ? 1")],
  ["earnings: Good", "lib", (s) => s.replace("{ Good: 1, Mixed: 0, Weak: -1 }", "{ Good: 1, Mixed: 0, Weak: 0 }")],
  ["Firm:", "lib", (s) => s.replace('total >= 2 ? "Firm"', 'total >= 3 ? "Firm"')],
  ["Neutral:", "lib", (s) => s.replace('total >= 2 ? "Firm"', 'total >= 1 ? "Firm"')],
  ["Weak:", "lib", (s) => s.replace("diff < -r.cut ? -1", "diff < -r.cut * 100 ? -1")],
  ["the total is the points listed", "lib", (s) => s.replace("price + rsiPts + earnPts", "price + earnPts")],
  ["under 253 sessions", "lib", (s) => s.replace("const from = i >= r.sessions ? x.bars[i - r.sessions] : null;", "const from = x.bars[Math.max(0, i - r.sessions)];")],
  ["no S&P 500 closes", "lib", (s) => s.replace("if (!spyEnd || !spyFrom || ", "if (")],
  ["Strong's floor", "lib", (s) => s.replace('total >= 4 ? "Strong"', 'total >= 5 ? "Strong"')],
  ["Soft:", "lib", (s) => s.replace('total >= -3 ? "Soft"', 'total >= -2 ? "Soft"')],
  ["fewer than 2 inputs", "lib", (s) => s.replace("total: inputs >= 2 ?", "total: inputs >= 1 ?")],
  ["under 64 sessions", "lib", (s) => s.replace("const m50 = sma(x, i, 50), m200 = sma(x, i, 200);", "const m50 = sma(x, i, 50), m200 = sma(x, i, 200) ?? sma(x, i, 50);")],
  ["the S&P 500 on the same two dates", "lib", (s) => s.replace("spyEnd.date !== x.bars[i].date || ", "")],
  ["earnings with no read", "lib", (s) => s.replace('"not counted (no results read yet)"', '"not read"')],
  ["partial earnings", "lib", (s) => s.replace('"not counted (partial results)"', '"partial"')],
  ["the hold", "lib", (s) => s.replace("export const HOLD_SESSIONS = 3;", "export const HOLD_SESSIONS = 2;")],
  ["the hold", "lib", (s) => s.replace("shown = s.word; since = s.date;", "shown = s.word;")],
  ["the note gives the hold", "card", (s) => s.replace('<p className="strengthHold" style={{ margin: "6px 0 0" }}>{badge.hold}</p>', "")],
  ["today's partial bar", "lib", (s) => s.replace("const bars = closedBars(barsIn);", "const bars = [...(barsIn ?? [])];")],
  ["the note lists all five", "card", (s) => s.replace("<strong>{signed(l.points)}</strong>", "")],
  ["the note carries", "card", (s) => s.replace('<p className="strengthNotAdvice" style={{ margin: "6px 0 0" }}>{NOT_ADVICE}</p>', "")],
  ["the note carries", "card", (s) => s.replace("Prices: {credit}", "")],
  ["no advice", "lib", (s) => s.replace('`${v}, stretched above 70: pulls a positive total back 1`', '`${v}, stretched above 70: you should consider waiting`')],
  ["no read of its own", "lib", (s) => s.replace("export function wordFor", "export async function peek() { return fetch(\"/x\"); }\nexport function wordFor")],
  ["the page scores Tiingo's", "page", (s) => s.replace('const strength = historyResult.provider === "tiingo" ? strengthBadge(', "const strength = true ? strengthBadge(")],
  ["the pill sits left of Share", "client", (s) => s.replace('{strength ? <StrengthPill s={strengthTop} badge={strength} place="top" /> : null}\n              <ShareButton url={shareUrl} title={shareTitle} text={shareText} />', '<ShareButton url={shareUrl} title={shareTitle} text={shareText} />\n              {strength ? <StrengthPill s={strengthTop} badge={strength} place="top" /> : null}')],
  ["no transform", "card", (s) => s.replace('borderBottom: "none", display: "inline-flex",', 'borderBottom: "none", transform: "translateZ(0)", display: "inline-flex",')],
  ["no transform", "client", (s) => s.replace('<div ref={strengthUnderRow} data-strength-row className="strengthUnderRow">', '<div ref={strengthUnderRow} data-strength-row className="strengthUnderRow" style={{ transform: "scale(1)" }}>')],
  ["the note's sizes", "card", (s) => s.replace('fontSize: "var(--fs-label)", fontWeight: 800', "fontSize: 12, fontWeight: 800")],
];
const PATH = { lib: FILES.lib, card: FILES.card, page: PAGE, client: CLIENT };
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [start, which, mutate] of MUTANTS) {
  const label = find(start), src = read(PATH[which]), mut = mutate(src);
  if (mut === src) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  const M = which === "lib" || which === "card" ? await load({ [which]: mut }) : await load();
  // A mutant that throws while building the fixtures has failed its rule too.
  check(`mutant bites: ${label}`, !run(() => rules(M, sources({ [which]: mut }))[label]()));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
