// The earnings page's "Growth & margins" picture (#563 COWORK #26/#27): C's new
// files lib/growthVisuals.ts and app/stock/[symbol]/earnings/GrowthVisuals.tsx.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. A NUMBER THE FILINGS DON'T HAVE: a ghost bar derived instead of looked up,
//      a profit invented for a year, a derived quarter shown as filed.
//   2. THE WORDS LIE: "+1235.4%" where the rule says "from a small base", a margin
//      of −194.5% printed instead of "costs were about 2.9× sales", a summary that
//      miscounts losses or misses the one-off.
//   3. THE ONE-OFF TAG on the wrong quarter, or missing where A's rule fired.
//   4. "Not reported" replaced by a blank or a zero.
//   5. THE COMPONENT FETCHES: it is presentation only (no fetch, no Redis).
//   6. AN UNMARKED ONE-OFF PROFIT (COWORK #36 blocker): without A's per-period
//      one-off notes, ONDS's Q1 FY2026 gain would draw as the biggest green bar
//      with no tag. The profit chart, its detail row and its summary clause stay
//      off until A passes `oneOffs`.
//   7. NO SCALE BEFORE A TAP (#36 ask 1): the newest bar and dot lose their
//      values, or the 0% / 50% / 100% guides go.
//   8. TWO PATTERNS FOR THE MULTIPLES (#36 ask 2).
//  11. THE PHONE LAYOUT (owner ruling, #563 COWORK #58): at or below the phone
//      breakpoint the margin is a line over the sales chart, in the margin
//      dot's own purple, against a % scale on its right, and the separate
//      margin chart is hidden; above it, the three charts as before. A missing
//      margin breaks the line. A tap scrolls the panel into view on a phone only.
//  12. "About these figures" (#56): a server-rendered <details> under one short
//      intro line, holding the basis, the gross-margin sentence and the "*"
//      footnote.
//  13. READABILITY (#563 COWORK #60): bars that fill about two thirds of their
//      slot (the profit bar as wide as the sales pair), and a thin, lighter line
//      joining the margin dots on desktop too, under the dots, broken where a
//      period has no margin. Quarters and years alike.
//  10. CENTS-PER-DOLLAR WORDING BACK ON A MARGIN (owner ruling, #563 COWORK #55:
//      margins in %, under the standard terms), or a missing gross-margin dot
//      with no reason behind it.
//   9. THE YEARS PROFIT CHART (#563 COWORK #51 (a), on A's #552 COWORK #117
//      annual one-offs): each year's FILED net income, behind the same gate as
//      the quarters, with no bar for a year the one-off rule can't run on.
//
// Real data: ONDS's fact set (data/sec/factset-fixture-ONDS.json, captured by the
// read-only sec-fixture relay, sha256 f76d9584…), run through A's view builder.
//
//   node scripts/check-growth-visuals.mjs
import fs from "node:fs";
import { loadCards, html, visibleText, React, reasonedValueUnit } from "./lib/render-cards.mjs";
import { stripComments } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const BUILDER = "lib/growthVisuals.ts";
const COMPONENT = "app/stock/[symbol]/earnings/GrowthVisuals.tsx";
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");
const appended = (builder, component) =>
  `\n${reasonedValueUnit()}\n${strip(fs.readFileSync("lib/growthPalette.ts", "utf8"))}\n${strip(builder)}\n${strip(component).replace("export default function GrowthVisuals", "export function GrowthVisuals")}\n`;

/** A's view stack plus C's two files, one transpiled unit (render-cards' method). */
const load = (builder = fs.readFileSync(BUILDER, "utf8"), component = fs.readFileSync(COMPONENT, "utf8"), card = (src) => src) => {
  SRC_B = { src: builder, file: BUILDER };
  SRC_C = { src: component, file: COMPONENT };
  // `card` mutates A's cards unit (SecEarningsCards.tsx, as render-cards joins it).
  return loadCards((src) => card(src) + appended(builder, component));
};

const full = JSON.parse(fs.readFileSync("data/sec/factset-fixture-ONDS.json", "utf8"));
/** ONDS as it stood after Q1 FY2026: the same filings, newest quarter not yet filed. */
const asOfQ1 = () => { const s = structuredClone(full); s.quarters = s.quarters.slice(1); return s; };
/** ONDS with every quarter's net income a loss: the loss-only shape. */
const lossOnly = (M) => {
  const s = structuredClone(full);
  const ni = M.SEC_FIELD_KEYS.indexOf("netIncome");
  for (const p of s.quarters) if (typeof p.v[ni] === "number") p.v[ni] = -Math.abs(p.v[ni]);
  return s;
};

/** Everything the rules read, for one load of the modules. */
async function measure(M) {
  const ondsView = M.buildSecEarningsView(full);
  const onds = M.buildGrowthVisuals(ondsView);
  const q1View = M.buildSecEarningsView(asOfQ1());
  // `oneOffs: {}` = "A checked every period": only the latest carries a note here.
  const q1 = M.buildGrowthVisuals(q1View, { oneOffs: {} });
  // ONDS as filed once A supplies the per-period note: Q1 FY2026 tagged with A's
  // own words for it (the note A's rule gives when Q1 is the latest period).
  const ondsChecked = M.buildGrowthVisuals(ondsView, { oneOffs: { "Q1 FY2026": q1View.largeNonOperatingNote } });
  const loss = M.buildGrowthVisuals(M.buildSecEarningsView(lossOnly(M)), { oneOffs: {} });
  const markup = (data) => html(React.createElement(M.GrowthVisuals, { data, notReported: "Not reported" }));
  const render = (data) => visibleText(markup(data));
  // "Not reported" survives: the newest quarter (the one the detail panel opens on) with no revenue.
  const blank = structuredClone(full);
  blank.quarters[0].v[M.SEC_FIELD_KEYS.indexOf("revenue")] = null;
  const blankData = M.buildGrowthVisuals(M.buildSecEarningsView(blank));
  // The card's own call (SecEarningsCards): A's per-period notes and unchecked list.
  const ondsCard = M.buildGrowthVisuals(ondsView, { oneOffs: ondsView.oneOffs, unchecked: ondsView.oneOffUnchecked });
  // One year the rule couldn't run on, one year tagged: the gate on years, not just quarters.
  const yearsMarked = M.buildGrowthVisuals(ondsView, { oneOffs: { FY2024: "A note for FY2024." }, unchecked: ["FY2023"] });
  const cardMarkup = html(React.createElement(M.SecGrowthMarginsCard, { view: ondsView }));
  return { onds, ondsChecked, ondsCard, ondsView, yearsMarked, q1, q1View, loss, render, markup, blankData, cardMarkup, M };
}

let M_PROFIT_WAITS = "";
/** The two files' source as loaded for this measure, for the wording rule. */
let SRC_B = { src: "", file: BUILDER }, SRC_C = { src: "", file: COMPONENT };
const rules = {
  "ONDS: 8 quarters, oldest first": ({ onds }) =>
    onds.quarters.periods.length === 8 && onds.quarters.periods[0].label === "Q3 FY2024" && onds.quarters.periods[7].label === "Q2 FY2026",
  "ghost bars are A's comparator, looked up by label, never derived": ({ onds }) => {
    const p = onds.quarters.periods;
    return p.slice(0, 4).every((x) => x.lastYear === null) &&
      p[7].lastYear?.label === "Q2 FY2025" && p[7].lastYear.val === p.find((x) => x.label === "Q2 FY2025").sales.val &&
      p[4].lastYear?.label === "Q3 FY2024";
  },
  "above +200% the label reads 'from a small base'": ({ onds, M }) =>
    onds.quarters.periods[7].growth === "from a small base" && M.growthWords(67.04) === "+67.0%" && M.growthWords(-44.44) === "−44.4%" &&
    M.growthWords(200) === "+200.0%" && M.growthWords("loss-both") === null,
  "gross margin is A's figure: whole % on the dot, one decimal in the panel": ({ onds, ondsView }) =>
    // Q3 FY2025's 25.79% is where rounding and truncating disagree (26 vs 25).
    onds.quarters.periods[7].grossPct === 43 && onds.quarters.periods[0].grossPct === 3 && onds.quarters.periods[4].grossPct === 26 &&
    // The panel's one decimal is A's figure too, not the rounded dot.
    onds.quarters.periods[7].grossText === `${ondsView.margins.find((m) => m.label === "Q2 FY2026").gross.toFixed(1)}%`,
  "a missing gross-margin dot always says why": ({ onds, blankData, render, M }) =>
    M.grossMargin(null, false, true).note === M.EMPTY_REASONS.notCaptured &&
    M.grossMargin(null, false, false).note === M.EMPTY_REASONS.needsRevenue &&
    M.grossMargin(40, true, true).note === M.EMPTY_REASONS.revenueIncomplete &&
    /more than the sales/.test(M.grossMargin(-5, false, true).note ?? "") &&
    [...onds.quarters.periods, ...onds.years.periods, ...blankData.quarters.periods].every((p) => p.grossPct !== null || !!p.grossNote) &&
    // The newest quarter of blankData has no sales: the panel (open on it) says so.
    blankData.quarters.periods.at(-1).grossPct === null && /Gross margin\s*Needs revenue/.test(render(blankData)),
  "margins beyond ±100% are worded, within are percentages": ({ onds, M }) =>
    onds.quarters.periods[7].operating === "operating costs were about 2.9× sales" &&
    onds.quarters.periods[6].operating === "−85.1%" &&
    onds.quarters.periods[6].net === "the net profit was about 7.2× sales" &&
    M.marginWords(-100, "net", false) === "−100.0%",
  "derived quarters keep A's derived note": ({ ondsChecked }) => {
    const p = ondsChecked.quarters.periods;
    const q4 = p.filter((x) => /^Q4 /.test(x.label));
    return q4.length === 2 && q4.every((x) => x.sales?.derivedNote && x.profit?.derivedNote) && p[7].sales.derivedNote === null;
  },
  "summary without A's notes: sales only, no profit clause": ({ onds }) =>
    onds.quarters.summary === "Sales up on a year earlier in each of the last 6 quarters.",
  "summary with A's notes: seven of eight losses, the one-off named": ({ ondsChecked }) =>
    ondsChecked.quarters.summary ===
      "Sales up on a year earlier in each of the last 6 quarters · a net loss in 7 of 8 quarters (the profitable quarter includes a one-off gain).",
  // THE #36 BLOCKER, on the data AND the markup: no profit bar, no profit row in
  // the panel, and the words saying where the figures are instead.
  "blocker: without A's per-period notes, no profit figure is drawn or listed": ({ onds, markup, render }) => {
    const m = markup(onds), t = render(onds);
    return onds.quarters.periods.every((x) => x.profit === null && x.oneOff === null) &&
      onds.quarters.profitMissing === M_PROFIT_WAITS && !/class="gvPlBar"/.test(m) &&
      !/<dt>Profit or loss<\/dt>/.test(m) && !/Profit or loss per /.test(t) &&
      t.includes(M_PROFIT_WAITS);
  },
  "blocker: with A's per-period note, Q1 '26 draws tagged": ({ ondsChecked, q1View, markup }) => {
    const p = ondsChecked.quarters.periods, m = markup(ondsChecked);
    const q1 = p.find((x) => x.label === "Q1 FY2026");
    return q1.profit.val > 0 && q1.oneOff === q1View.largeNonOperatingNote &&
      p.filter((x) => x.oneOff).length === 1 && ondsChecked.quarters.profitMissing === null &&
      (m.match(/class="gvPlBar"/g) ?? []).length === 8 && (m.match(/class="gvOneOff"/g) ?? []).length === 1;
  },
  "scale: the newest sales bar and the newest dot carry their values": ({ onds, markup }) => {
    const vals = [...markup(onds).matchAll(/class="gvVal"[^>]*>([^<]+)</g)].map((x) => x[1]);
    return vals.length === 2 && vals[0] === "$83.8M" && vals[1] === "43%";
  },
  "scale: faint 0% / 50% / 100% guides on the margin chart": ({ onds, markup }) => {
    const labels = [...markup(onds).matchAll(/class="gvPctLabel"[^>]*>([^<]+)</g)].map((x) => x[1]);
    return labels.join(",") === "0%,50%,100%" && (markup(onds).match(/class="gvPctGuide"/g) ?? []).length === 3;
  },
  // STANDARD TERMS (#563 COWORK #55): each margin under its own name; a multiple
  // keeps its one pattern ("<what> was/were about N× sales", #36 ask 2).
  "wording: standard margin terms; one pattern for the multiples": ({ onds, render }) => {
    const t = render(onds);
    return /Operating margin\s*operating costs were about 2\.9× sales/.test(t) && /Net margin\s*the net loss was about 1\.1× sales/.test(t) &&
      /Gross margin\s*43\.1%/.test(t) && t.includes("Gross margin per quarter") && t.includes("Gross margin (% of sales)") && !/All costs|(operating|net) margin: /i.test(t);
  },
  "no cents-per-dollar wording on a margin, in the picture or its source": ({ onds, render }) => {
    const CENTS = /¢|per \$1|of every \$1|of each \$1|cents? kept|kept \d+/i;
    const texts = [render(onds), render({ quarters: null, years: onds.years })];
    return texts.every((t) => !CENTS.test(t)) && texts[1].includes("Gross margin per year") &&
      ![SRC_B, SRC_C].some((s) => CENTS.test(stripComments(s.src, { file: s.file })));
  },
  "marker: on the quarter A's rule fired for, with A's words": ({ q1, q1View }) => {
    const p = q1.quarters.periods;
    return q1View.largeNonOperating === true && p.at(-1).label === "Q1 FY2026" && p.at(-1).oneOff === q1View.largeNonOperatingNote &&
      p.slice(0, -1).every((x) => x.oneOff === null);
  },
  "marker: the summary names the one-off": ({ q1 }) =>
    /the profitable quarter includes a one-off gain\)\.$/.test(q1.quarters.summary),
  // ON THE TAG ELEMENT, not the text: the summary and the detail panel also
  // say "one-off", so a text match passed with the tag gone.
  "ONDS as filed: no one-off tag (A's rule is false for Q2 FY2026)": ({ onds, markup }) =>
    onds.quarters.periods.every((x) => x.oneOff === null) && !/class="gvOneOff"/.test(markup(onds)),
  // ON TAP, NOT HOVER ONLY (#563 COWORK #51/#52): A's ReasonedValue, and outside
  // every column <button> (a button inside a button can't take the tap).
  "marker: the tag renders": ({ q1, markup }) => {
    const m = markup(q1), at = m.indexOf('class="gvOneOff"');
    const tag = at < 0 ? "" : m.slice(at, m.indexOf("one-off</span>", at) + 7);
    const before = m.slice(0, at);
    return (m.match(/class="gvOneOff"/g) ?? []).length === 1 &&
      /role="button"/.test(tag) && /tabindex="0"/.test(tag) &&
      /title="Includes a large non-operating gain; see the filing\."/.test(tag) && tag.endsWith("one-off") &&
      before.lastIndexOf("<button") < before.lastIndexOf("</button>") && !/<abbr class="gvOneOff"/.test(m);
  },
  "loss-only: all losses, said plainly": ({ loss }) =>
    loss.quarters.periods.every((x) => x.profit.val < 0) && / · a net loss in all 8 quarters\.$/.test(loss.quarters.summary),
  "years without A's notes: no profit drawn, and it says why": ({ onds, M }) =>
    onds.years.periods.length === 5 && onds.years.periods.every((x) => x.profit === null && x.oneOff === null) &&
    onds.years.profitMissing === M.profitWaitsForOneOffs("year"),
  "years with A's notes: each year's filed net income, never a margin": ({ ondsCard, ondsView }) => {
    const y = ondsCard.years;
    return y.profitMissing === null && y.periods.length === 5 &&
      y.periods.every((x, i) => x.label === ondsView.annual[i].label && x.profit?.val === ondsView.annual[i].netIncome.val) &&
      // FY2025 as filed: -$133.4M, not net margin × revenue rounded through a percentage.
      y.periods.at(-1).profit.val === -133381301;
  },
  "years: a year the rule can't run on gets no bar and the reason; a noted year is tagged": ({ yearsMarked, M }) => {
    const p = yearsMarked.years.periods, at = (l) => p.find((x) => x.label === l);
    return at("FY2023").profit === null && at("FY2023").oneOff === null && at("FY2023").profitUnchecked === M.PROFIT_UNCHECKED &&
      at("FY2024").oneOff === "A note for FY2024." && at("FY2024").profit !== null &&
      p.filter((x) => x.profitUnchecked).length === 1 && p.filter((x) => x.oneOff).length === 1;
  },
  "years: the summary counts the yearly losses": ({ ondsCard }) =>
    / · a net loss in all 5 years\.$/.test(ondsCard.years.summary),
  "'Not reported' survives a missing figure": ({ blankData, render }) =>
    blankData.quarters.periods.at(-1).sales === null && /Sales\s*Not reported/.test(render(blankData)),
  // #58: one stylesheet decides; the markup carries both layouts.
  "phone: the margin line over the sales chart, in the margin dot's purple, only below the breakpoint": ({ ondsChecked, markup, M }) => {
    const m = markup(ondsChecked);
    const css = (m.match(/<style>([\s\S]*?)<\/style>/) ?? [])[1] ?? "";
    const media = css.slice(css.indexOf(`@media (max-width: ${M.PHONE_MAX_PX}px)`));
    const outside = css.slice(0, css.indexOf("@media"));
    const purple = (m.match(/class="gvDot" style="bottom:[^"]*;background:(#[0-9a-f]{6})"/) ?? [])[1];
    const strokes = [...m.matchAll(/<svg class="gvPhoneOnly gvMarginLine"[\s\S]*?<\/svg>/g)].flatMap((x) => [...x[0].matchAll(/stroke="([^"]+)"/g)].map((y) => y[1]));
    const withMargin = ondsChecked.quarters.periods.filter((p) => p.grossPct !== null).length;
    const phoneDots = (m.match(/<span class="gvPhoneOnly"><span class="gvDot"/g) ?? []).length;
    const right = [...m.matchAll(/class="gvPhoneOnly gvRightScale"[^>]*>([\s\S]*?)<\/span><\/span>/g)].map((x) => [...x[1].matchAll(/>(\d+%)(?=<|$)/g)].map((y) => y[1]).join(","));
    return M.PHONE_MAX_PX === 480 && !!purple && purple === "#9085e9" &&
      strokes.length >= 1 && strokes.every((c) => c === purple) && phoneDots === withMargin &&
      right[0] === "0%,50%,100%" && /class="gvPhoneOnly"><i [^>]*><\/i>Gross margin % \(right scale\)/.test(m) &&
      /<div class="gvDesktopOnly">[\s\S]*Gross margin per quarter/.test(m) &&
      /\.gvPhoneOnly \{ display: none; \}/.test(outside) && !/\.gvDesktopOnly \{ display: none/.test(outside) &&
      /\.gvPhoneOnly \{ display: inline; \}/.test(media) && /\.gvDesktopOnly \{ display: none; \}/.test(media) &&
      // The profit chart stays on every screen: never inside a phone- or desktop-only box.
      !/<div class="gvDesktopOnly">[\s\S]*Profit or loss per/.test(m) && /Profit or loss per quarter/.test(m);
  },
  "phone: a period with no margin breaks the line": ({ M }) => {
    const p = (g) => ({ grossPct: g });
    const segs = M.marginSegments([p(40), p(45), p(null), p(50), p(null)]);
    return segs.length === 2 && segs[0] === "M0.5 60 L1.5 55" && segs[1] === "M3.5 50" && M.marginSegments([p(null)]).length === 0;
  },
  "phone: a tap scrolls the panel into view; desktop never scrolls": () => {
    const c = stripComments(SRC_C.src, { file: COMPONENT });
    const tapped = (c.match(/const tapped = \(\) => \{[\s\S]*?\n {2}\};/) ?? [""])[0];
    return /window\.matchMedia\?\.\(PHONE\)\.matches\) return;/.test(tapped) &&
      /scrollIntoView\(\{ block: "nearest"/.test(tapped) && /onClick=\{\(\) => \{ setActive\(i\); onTap\?\.\(\); \}\}/.test(c) &&
      (c.match(/onTap=\{tapped\}/g) ?? []).length === 3 && /<div ref=\{detailRef\}>/.test(c);
  },
  "about these figures: one intro line; the basis, the margin sentence and the * footnote in a server-rendered <details>": ({ cardMarkup, M }) => {
    const about = (cardMarkup.match(/<details class="gvAbout">([\s\S]*?)<\/details>/) ?? [])[1] ?? "";
    return /<summary[^>]*>About these figures<\/summary>/.test(about) && /compared with the same fiscal quarter a year earlier/.test(about) &&
      about.includes(M.GROSS_MARGIN_MEANS) && /\* Not filed as a quarter of its own/.test(about) &&
      /<p>Sales, profit or loss and gross margin each quarter, as filed\. Tap a quarter for its figures\.<\/p>/.test(cardMarkup) &&
      !/class="gvMissing"[^>]*>\* Not filed/.test(cardMarkup);
  },
  "wider bars: the sales pair and the profit bar fill about two thirds of each slot": ({ ondsChecked, markup, M }) => {
    const css = (markup(ondsChecked).match(/<style>([\s\S]*?)<\/style>/) ?? [])[1] ?? "";
    const inset = M.BAR_INSET_PCT, fill = 100 - 2 * inset;
    return fill >= 60 && fill <= 70 &&
      css.includes(`.gvBars { position: absolute; inset: 0 ${inset}% 0;`) &&
      /\.gvBar \{ flex: 1 1 0; border-radius/.test(css) && !/\.gvBar \{[^}]*max-width/.test(css) &&
      css.includes(`.gvPlBar { position: absolute; left: ${inset}%; right: ${inset}%; }`) &&
      // On a phone a shown axis label spills into its hidden neighbour's slot, never clipped.
      /@media \(max-width: 480px\) \{[\s\S]*\.gvTickAlt \{ visibility: hidden; \}[\s\S]*\.gvTick \{ overflow: visible; \}/.test(css);
  },
  "desktop too: a thin, lighter line joins the margin dots, under them, broken where a margin is missing": ({ ondsChecked, ondsCard, markup, M }) => {
    const lineOf = (m, cls) => [...m.matchAll(new RegExp(`<svg class="${cls} gvMarginLine"[\\s\\S]*?<\\/svg>`, "g"))].map((x) => x[0]);
    const pathsOk = (svg, periods) => {
      const paths = [...svg.matchAll(/<path [^>]*>/g)].map((x) => x[0]);
      return paths.length === M.marginSegments(periods).length && paths.every((p) =>
        /stroke="#9085e9"/.test(p) && new RegExp(`stroke-width="${M.MARGIN_LINE.width}"`).test(p) &&
        new RegExp(`stroke-opacity="${M.MARGIN_LINE.opacity}"`).test(p));
    };
    const q = markup(ondsChecked), y = markup({ quarters: null, years: ondsCard.years });
    const desk = q.slice(q.indexOf('<div class="gvDesktopOnly">'));
    const behind = desk.slice(desk.indexOf('<span class="gvBehind"'), desk.indexOf('<button'));
    return M.MARGIN_LINE.width <= 2 && M.MARGIN_LINE.opacity < 1 &&
      lineOf(behind, "gvDeskLine").length === 1 && pathsOk(lineOf(behind, "gvDeskLine")[0], ondsChecked.quarters.periods) &&
      lineOf(q, "gvPhoneOnly").length === 1 && pathsOk(lineOf(q, "gvPhoneOnly")[0], ondsChecked.quarters.periods) &&
      lineOf(y, "gvDeskLine").length === 1 && pathsOk(lineOf(y, "gvDeskLine")[0], ondsCard.years.periods);
  },
  "the render carries the summary, the toggle and the legend words": ({ ondsChecked, render }) => {
    const t = render(ondsChecked);
    return t.includes(ondsChecked.quarters.summary) && /Quarters/.test(t) && /Years/.test(t) && /Profit \(\+\), above the line/.test(t) && /Loss \(−\), below/.test(t);
  },
};

const staticRules = {
  "no fetch, no Redis, no server reads in either file": (b, c) =>
    ![b, c].some((s) => /fetch\(|redis|Redis|unstable_cache|readTiingo|getDailyHistory|resolveFactSet/.test(s)),
  "the client component imports only React and the builder's types": (b, c) => {
    const imports = [...c.matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]);
    // Plus A's ReasonedValue for the one-off tag's note (#563 COWORK #52), by name only,
    // and the shared palette module (#552 COWORK #134), which imports nothing.
    return imports.every((i) => i === "react" || i === "@/lib/growthVisuals" || i === "@/app/components/EstimatedValue" || i === "@/lib/growthPalette") &&
      !/^import\b/m.test(fs.readFileSync("lib/growthPalette.ts", "utf8")) &&
      /^import type \{[^}]*\} from "@\/lib\/growthVisuals";$/m.test(c) &&
      (!/@\/app\/components\/EstimatedValue/.test(c) || /^import \{ ReasonedValue \} from "@\/app\/components\/EstimatedValue";$/m.test(c));
  },
  "the builder imports A's formatter rather than copying it": (b) =>
    /import \{ scaledAmount \} from "\.\/server\/secPresentation";/.test(b) && /scaledAmount\(cell\.val\)/.test(b),
};

console.log("\n=== 1. ONDS, loss-only and marker-fires, through A's view builder ===\n");
const base = await measure(await load());
M_PROFIT_WAITS = base.M.profitWaitsForOneOffs("quarter");
for (const [name, rule] of Object.entries(rules)) check(name, rule(base));

console.log("\n=== 2. Static rules ===\n");
const B = fs.readFileSync(BUILDER, "utf8"), Cc = fs.readFileSync(COMPONENT, "utf8");
const code = (s, f) => stripComments(s, { file: f });
for (const [name, rule] of Object.entries(staticRules)) check(name, rule(code(B, BUILDER), code(Cc, COMPONENT)));

console.log("\n=== 3. Mutants: each must FAIL its rule ===\n");
const mutants = [
  ["above +200% the label reads 'from a small base'", "b", (s) => s.replace("export const SMALL_BASE_ABOVE_PCT = 200;", "export const SMALL_BASE_ABOVE_PCT = 100000;")],
  ["ghost bars are A's comparator, looked up by label, never derived", "b", (s) => s.replace("const prior = g?.comparedWith ? byLabel.get(g.comparedWith) : undefined;", "const prior = ordered[ordered.indexOf(p) - 1];")],
  ["gross margin is A's figure: whole % on the dot, one decimal in the panel", "b", (s) => s.replace("return { pct: Math.round(gross),", "return { pct: Math.floor(gross),")],
  ["gross margin is A's figure: whole % on the dot, one decimal in the panel", "b", (s) => s.replace("text: `${gross.toFixed(1)}%`", "text: `${Math.round(gross).toFixed(1)}%`")],
  ["a missing gross-margin dot always says why", "b", (s) => s.replace("note: hasSales ? EMPTY_REASONS.notCaptured : EMPTY_REASONS.needsRevenue", "note: null")],
  ["a missing gross-margin dot always says why", "c", (s) => s.replace("<span style={{ color: C.muted }}>{p.grossNote}</span>", "<span />")],
  ["margins beyond ±100% are worded, within are percentages", "b", (s) => s.replace("if (Math.abs(m) <= MARGIN_AS_MULTIPLE_BEYOND_PCT)", "if (true)")],
  ["derived quarters keep A's derived note", "b", (s) => s.replace("derivedNote: cell.derivedNote ?? null", "derivedNote: null")],
  ["summary with A's notes: seven of eight losses, the one-off named", "b", (s) => s.replace("const losses = withProfit.filter((p) => p.profit!.val < 0).length;", "const losses = withProfit.filter((p) => p.profit!.val <= 0).length + 1;")],
  ["summary without A's notes: sales only, no profit clause", "b", (s) => s.replace("profit: profitChecked && !unchecked.has(label) ? amount(netIncome) : null,", "profit: amount(netIncome),")],
  ["blocker: without A's per-period notes, no profit figure is drawn or listed", "b", (s) => s.replace("const profitChecked = opts.oneOffs !== undefined;", "const profitChecked = true;")],
  ["blocker: without A's per-period notes, no profit figure is drawn or listed", "c", (s) => s.replace("{showProfit ? (", "{true ? (")],
  ["blocker: with A's per-period note, Q1 '26 draws tagged", "b", (s) => s.replace("opts.oneOffs?.[label] ??", "")],
  ["scale: the newest sales bar and the newest dot carry their values", "c", (s) => s.replace("{i === newest && p.sales ? (", "{false && p.sales ? (")],
  ["scale: the newest sales bar and the newest dot carry their values", "c", (s) => s.replace("{i === newest ? (", "{false ? (")],
  ["scale: faint 0% / 50% / 100% guides on the margin chart", "c", (s) => s.replace("const PCT_GUIDES = [0, 50, 100] as const;", "const PCT_GUIDES = [0, 100] as const;")],
  ["scale: faint 0% / 50% / 100% guides on the margin chart", "c", (s) => s.replace(/(className="gvPctLabel"[^>]*>)\{c\}%</, "$1{c}¢<")],
  ["wording: standard margin terms; one pattern for the multiples", "b", (s) => s.replace("`operating costs were about ${", "`costs were about ${")],
  ["wording: standard margin terms; one pattern for the multiples", "c", (s) => s.replace("<dt>Operating margin</dt>", "<dt>All costs</dt>")],
  ["phone: the margin line over the sales chart, in the margin dot's purple, only below the breakpoint", "c", (s) => s.replace("<path key={d} d={d} fill=\"none\" stroke={C.margin}", "<path key={d} d={d} fill=\"none\" stroke={C.sales}")],
  ["phone: the margin line over the sales chart, in the margin dot's purple, only below the breakpoint", "c", (s) => s.replace("          .gvDesktopOnly { display: none; }\n", "")],
  ["phone: the margin line over the sales chart, in the margin dot's purple, only below the breakpoint", "c", (s) => s.replace("        .gvPhoneOnly { display: none; }\n", "")],
  ["phone: the margin line over the sales chart, in the margin dot's purple, only below the breakpoint", "c", (s) => s.replace("{PCT_GUIDES.map((c) => <span key={c} style={{ bottom: `${c}%` }}>{c}%</span>)}", "")],
  ["wider bars: the sales pair and the profit bar fill about two thirds of each slot", "c", (s) => s.replace("export const BAR_INSET_PCT = 16;", "export const BAR_INSET_PCT = 25;")],
  ["wider bars: the sales pair and the profit bar fill about two thirds of each slot", "c", (s) => s.replace("          .gvTick { overflow: visible; }\n", "")],
  ["wider bars: the sales pair and the profit bar fill about two thirds of each slot", "c", (s) => s.replace(".gvBar { flex: 1 1 0; border-radius", ".gvBar { flex: 1 1 0; max-width: 18px; border-radius")],
  ["wider bars: the sales pair and the profit bar fill about two thirds of each slot", "c", (s) => s.replace(".gvPlBar { position: absolute; left: ${BAR_INSET_PCT}%; right: ${BAR_INSET_PCT}%; }", ".gvPlBar { position: absolute; left: 25%; right: 25%; }")],
  ["desktop too: a thin, lighter line joins the margin dots, under them, broken where a margin is missing", "c", (s) => s.replace('        <MarginLine periods={s.periods} className="gvDeskLine" />\n', "")],
  ["desktop too: a thin, lighter line joins the margin dots, under them, broken where a margin is missing", "c", (s) => s.replace("export const MARGIN_LINE = GROWTH_MARGIN_LINE;", "export const MARGIN_LINE = { width: 1.5, opacity: 1 } as const;")],
  ["desktop too: a thin, lighter line joins the margin dots, under them, broken where a margin is missing", "c", (s) => s.replace("strokeWidth={MARGIN_LINE.width}", "strokeWidth={3}")],
  ["phone: a period with no margin breaks the line", "c", (s) => s.replace("if (p.grossPct === null) { if (run.length) runs.push(run.join(\" \")); run = []; return; }", "if (p.grossPct === null) return;")],
  ["phone: a tap scrolls the panel into view; desktop never scrolls", "c", (s) => s.replace("if (typeof window === \"undefined\" || !window.matchMedia?.(PHONE).matches) return;", "if (typeof window === \"undefined\") return;")],
  ["phone: a tap scrolls the panel into view; desktop never scrolls", "c", (s) => s.replace("onClick={() => { setActive(i); onTap?.(); }}", "onClick={() => setActive(i)}")],
  ["about these figures: one intro line; the basis, the margin sentence and the * footnote in a server-rendered <details>", "k", (s) => s.replace("<p>{GROSS_MARGIN_MEANS}</p>", "")],
  ["about these figures: one intro line; the basis, the margin sentence and the * footnote in a server-rendered <details>", "k", (s) => s.replace('<details className="gvAbout">', '<div className="gvAbout">').replace("      </details>\n      <MarginDelta", "      </div>\n      <MarginDelta")],
  ["no cents-per-dollar wording on a margin, in the picture or its source", "c", (s) => s.replace('legend={<><i style={{ background: C.margin, borderRadius: 999 }} />Gross margin (% of sales)</>}', 'legend={<><i style={{ background: C.margin, borderRadius: 999 }} />¢ kept per $1 (gross margin)</>}')],
  ["no cents-per-dollar wording on a margin, in the picture or its source", "c", (s) => s.replace("{p.grossPct}%", "{p.grossPct}¢")],
  ["no cents-per-dollar wording on a margin, in the picture or its source", "b", (s) => s.replace('"The direct costs of sales were more than the sales"', '"Under 0 cents kept per $1 of sales"')],
  ["marker: on the quarter A's rule fired for, with A's words", "b", (s) => s.replace("(label === view.latestLabel && view.largeNonOperating", "(view.largeNonOperating")],
  ["marker: the tag renders", "c", (s) => s.replace("        if (!p.oneOff) return null;\n", "        return null;\n")],
  ["marker: the tag renders", "c", (s) => s.replace('<ReasonedValue text="one-off" reason={p.oneOff} />', "<abbr title={p.oneOff}>one-off</abbr>")],
  ["loss-only: all losses, said plainly", "b", (s) => s.replace("losses === n ? `a net loss in all", "false ? `a net loss in all")],
  ["years without A's notes: no profit drawn, and it says why", "b", (s) => s.replace("profitMissing: profitChecked ? null : profitWaitsForOneOffs(yw.one),", "profitMissing: null,")],
  ["years without A's notes: no profit drawn, and it says why", "b", (s) => s.replace("        ...profitOf(a.label, a.netIncome),\n", "        profit: amount(a.netIncome),\n        oneOff: null,\n")],
  ["years with A's notes: each year's filed net income, never a margin", "b", (s) => s.replace("        ...profitOf(a.label, a.netIncome),\n", "        ...profitOf(a.label, a.netIncome),\n        profit: a.net == null || a.revenue.val == null ? null : { val: (a.net / 100) * a.revenue.val, text: \"x\", derivedNote: null },\n")],
  ["years with A's notes: each year's filed net income, never a margin", "b", (s) => s.replace("        ...profitOf(a.label, a.netIncome),\n", "        profit: null,\n        oneOff: null,\n")],
  ["years: a year the rule can't run on gets no bar and the reason; a noted year is tagged", "b", (s) => s.replace("profit: profitChecked && !unchecked.has(label) ? amount(netIncome) : null,", "profit: profitChecked ? amount(netIncome) : null,")],
  ["years: a year the rule can't run on gets no bar and the reason; a noted year is tagged", "b", (s) => s.replace("        ...profitOf(a.label, a.netIncome),\n", "        ...profitOf(a.label, a.netIncome),\n        oneOff: null,\n")],
  ["years: the summary counts the yearly losses", "b", (s) => s.replace("summary: summaryLine(periods, view.annual.map((a) => a.revenueYoY), yw.one, yw.many),", "summary: summaryLine(periods.map((p) => ({ ...p, profit: null })), view.annual.map((a) => a.revenueYoY), yw.one, yw.many),")],
  ["'Not reported' survives a missing figure", "c", (s) => s.replace("const nr = <span style={{ color: C.muted }}>{notReported}</span>;", "const nr = <span>$0.0M</span>;")],
  ["the render carries the summary, the toggle and the legend words", "c", (s) => s.replace("Profit (+), above the line", "Profit")],
];
const CARDS = "app/stock/[symbol]/earnings/SecEarningsCards.tsx";
const K = fs.readFileSync(CARDS, "utf8");
for (const [name, which, mutate] of mutants) {
  const b2 = which === "b" ? mutate(B) : B;
  const c2 = which === "c" ? mutate(Cc) : Cc;
  const k2 = which === "k" ? mutate(K) : K;
  const changed = b2 !== B || c2 !== Cc || k2 !== K;
  let bites = false;
  try { bites = !rules[name](await measure(await load(b2, c2, which === "k" ? (src) => mutate(src) : undefined))); } catch { bites = true; }
  check(`mutant bites: ${name}`, changed && bites, changed ? "" : "the mutation did not apply");
}
const staticMutants = [
  ["no fetch, no Redis, no server reads in either file", (b, c) => [b, `${c}\nconst x = fetch("/api/quote");`]],
  ["the client component imports only React and the builder's types", (b, c) => [b, `import { scaledAmount } from "@/lib/server/secPresentation";\n${c}`]],
  ["the client component imports only React and the builder's types", (b, c) => [b, c.replace("import { ReasonedValue } from", "import { ReasonedValue, notePlacement } from")]],
  ["the builder imports A's formatter rather than copying it", (b, c) => [b.replace("scaledAmount(cell.val)", "money(cell.val)"), c]],
];
for (const [name, mutate] of staticMutants) {
  const [b2, c2] = mutate(code(B, BUILDER), code(Cc, COMPONENT));
  check(`mutant bites: ${name}`, !staticRules[name](b2, c2));
}

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}\n`);
process.exit(failures ? 1 : 0);
