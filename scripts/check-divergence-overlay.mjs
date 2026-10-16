// WHICH INDICATOR PANEL A DIVERGENCE CARD DRAWS (#553).
//
// The bug: on the Bullish RSI Divergence screener, OLLI, UNH, ADSK, GIB and PSA
// drew a MACD panel (WM drew RSI) because chartOverlayForEntry searched the
// card's `reasons` -- every OTHER condition the stock qualifies for -- for
// "macd" before it looked for "rsi". The decision now lives in
// lib/divergenceOverlay.ts and is asserted here on the real module, then on
// copies of it with each rule broken (the mutants), so a check that cannot
// fail would show.
//   1. A page about one kind decides from the page alone (reasons ignored).
//   2. A sidebar condition naming one kind decides, on any page.
//   3. A mixed view decides per card, from its own badge / divergence flags only.
//   4. The grid hands the decision to the module and never reads `reasons`.
//   5. The chart LINK follows the same decision: choosing a chart on an RSI
//      divergence page opened the dashboard with MACD applied (the stored link
//      prefers MACD for a stock with both divergences). Links are rewritten by
//      the module, on the server page and in the grid.
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const src = readCodeOnly("lib/divergenceOverlay.ts");
const once = (s, find, repl) => { if (s.split(find).length - 1 !== 1) throw new Error(`mutation anchor not unique: ${find.slice(0, 60)}`); return s.replace(find, repl); };

// Cards as the grid sees them: the divergence fields, plus the text that must NOT decide.
const rsiCardWithMacdReasons = { badge: "D · RSI(14)", bullishRsiDivergence: true, note: "Daily bullish RSI divergence", reasons: ["Bullish RSI Divergence", "MACD Bullish Cross", "Above MA50"] };
const macdCard = { badge: "D · MACD(12,26,9)", bullishMacdDivergence: true, note: "Daily bullish MACD divergence", reasons: ["Bullish MACD Divergence", "RSI Oversold"] };
const rsiOnly = { badge: "W · RSI(14)", bearishRsiDivergence: true, reasons: ["Bearish RSI Divergence"] };

/** The scenarios, each with the answer the rule demands. */
const SCENARIOS = [
  ["RSI divergence page, entry whose reasons mention MACD -> rsi", (m) => m.divergenceOverlay("/bullish-rsi-divergence-stocks", [], rsiCardWithMacdReasons), "rsi"],
  ["bearish RSI divergence page, same -> rsi", (m) => m.divergenceOverlay("/bearish-rsi-divergence-stocks", [], { ...rsiCardWithMacdReasons, bearishRsiDivergence: true }), "rsi"],
  ["MACD divergence page, entry whose reasons mention RSI -> macd", (m) => m.divergenceOverlay("/bullish-macd-divergence-stocks", [], macdCard), "macd"],
  ["bearish MACD divergence page -> macd", (m) => m.divergenceOverlay("/bearish-macd-divergence-stocks", [], { ...macdCard, bearishMacdDivergence: true }), "macd"],
  ["a page about one kind ignores a stray badge", (m) => m.divergenceOverlay("/bullish-rsi-divergence-stocks", [], { badge: "D · MACD(12,26,9)" }), "rsi"],
  ["Advanced Screener with Bullish RSI Divergence ticked -> rsi, whatever the reasons say", (m) => m.divergenceOverlay("/advanced-stock-screener", ["bullishRsiDivergence"], rsiCardWithMacdReasons), "rsi"],
  ["sector page with Bearish MACD Divergence ticked -> macd", (m) => m.divergenceOverlay("/sector/technology", ["bearishMacdDivergence", "oversold"], rsiCardWithMacdReasons), "macd"],
  ["a ticked RSI divergence beats the combined page's per-card choice", (m) => m.divergenceOverlay("/bullish-bearish-divergence-stocks", ["bullishRsiDivergence"], macdCard), "rsi"],
  ["combined page, RSI card -> rsi from its own badge, not its reasons", (m) => m.divergenceOverlay("/bullish-bearish-divergence-stocks", [], rsiCardWithMacdReasons), "rsi"],
  ["combined page, MACD card -> macd from its own badge", (m) => m.divergenceOverlay("/bullish-bearish-divergence-stocks", [], macdCard), "macd"],
  ["combined page, badge only (no flags) -> its own badge", (m) => m.divergenceOverlay("/bullish-bearish-divergence-stocks", [], { badge: "W · MACD(12,26,9)", reasons: ["RSI Oversold"] }), "macd"],
  ["combined page, no badge -> its own divergence flag", (m) => m.divergenceOverlay("/bullish-bearish-divergence-stocks", [], { bearishRsiDivergence: true, reasons: ["MACD Bearish Cross"] }), "rsi"],
  ["both kinds ticked on another page -> per card, its own badge", (m) => m.divergenceOverlay("/advanced-stock-screener", ["bullishRsiDivergence", "bullishMacdDivergence"], rsiOnly), "rsi"],
  ["both kinds on one card is MACD, as the builder's badge says", (m) => m.divergenceOverlay("/bullish-bearish-divergence-stocks", [], { bullishRsiDivergence: true, bullishMacdDivergence: true }), "macd"],
  ["a mixed view with no own signal draws nothing (never guesses from reasons)", (m) => m.divergenceOverlay("/bullish-bearish-divergence-stocks", [], { reasons: ["MACD Bullish Cross"] }), null],
  ["a page that is not about divergence and no divergence ticked -> not decided here", (m) => m.divergenceOverlay("/oversold-stocks", ["oversold"], rsiCardWithMacdReasons), null],
];

console.log("\n1. the rule, on the real module\n");
const real = await lift(src);
for (const [label, run, want] of SCENARIOS) {
  const got = run(real);
  check(label, got === want, `got ${got}`);
}

console.log("\n2. mutants: each rule broken must change an answer\n");
const MUTANTS = [
  ["the page's own kind ignored (falls through to the card)", (s) => once(s, 'if (page === "rsi" || page === "macd") return page;', "")],
  ["MACD wins whenever the page is a divergence page", (s) => once(s, 'if (page === "rsi" || page === "macd") return page;', 'if (page) return "macd";')],
  ["the sidebar's ticked kind ignored", (s) => once(s, "if (picked.rsi !== picked.macd) return picked.rsi ? \"rsi\" : \"macd\";", "")],
  ["the card's badge ignored (flags only)", (s) => once(s, "if (badgeMacd !== badgeRsi) return badgeMacd ? \"macd\" : \"rsi\";", "")],
  ["a card with both signals goes RSI", (s) => once(s, "  if (macd) return \"macd\";\n  if (rsi) return \"rsi\";", "  if (rsi) return \"rsi\";\n  if (macd) return \"macd\";")],
  ["the mixed view guesses from the badge-less card as MACD", (s) => once(s, "  if (rsi) return \"rsi\";\n  return null;\n}", "  if (rsi) return \"rsi\";\n  return \"macd\";\n}")],
];
for (const [label, mutate] of MUTANTS) {
  let broken;
  try { broken = await lift(mutate(src)); } catch (e) { check(`MUTANT anchor: ${label}`, false, e.message); continue; }
  const caught = SCENARIOS.some(([, run, want]) => run(broken) !== want);
  check(`MUTANT caught: ${label}`, caught);
}
// The reasons-reading version, as shipped before: the card's text, MACD first.
const OLD = `export function divergenceOverlay(href, filters, card) {
  const text = (href + " " + (card.badge ?? "") + " " + (card.note ?? "") + " " + (card.reasons ?? []).join(" ")).toLowerCase();
  if (text.includes("macd")) return "macd";
  if (text.includes("rsi")) return "rsi";
  return null;
}`;
const oldMod = await lift(OLD);
check("MUTANT caught: the shipped bug (search reasons, MACD first) fails the headline scenario", oldMod.divergenceOverlay("/bullish-rsi-divergence-stocks", [], rsiCardWithMacdReasons) === "macd");

console.log("\n2b. the chart link, on the real module\n");
const STORED = "/dashboard?symbol=OLLI&tf=D&indicator=MACD%2812%2C26%2C9%29#analyser";
const LINKS = [
  ["an RSI page's link gets indicator=RSI(14), keeping symbol, timeframe and hash", (m) => m.withDivergenceIndicator(STORED, "rsi"), "/dashboard?symbol=OLLI&tf=D&indicator=RSI%2814%29#analyser"],
  ["a MACD page's link gets indicator=MACD(12,26,9)", (m) => m.withDivergenceIndicator("/dashboard?symbol=WM&tf=W&indicator=RSI%2814%29#analyser", "macd"), "/dashboard?symbol=WM&tf=W&indicator=MACD%2812%2C26%2C9%29#analyser"],
  ["a link with no indicator gets one", (m) => m.withDivergenceIndicator("/dashboard?symbol=UNH#analyser", "rsi"), "/dashboard?symbol=UNH&indicator=RSI%2814%29#analyser"],
  ["no decision leaves the link alone", (m) => m.withDivergenceIndicator(STORED, null), STORED],
  ["an earnings link is never touched", (m) => m.withDivergenceIndicator("/stock/OLLI/earnings", "rsi"), "/stock/OLLI/earnings"],
];
for (const [label, run, want] of LINKS) { const got = run(real); check(label, got === want, got); }
const LINK_MUTANTS = [
  ["the indicator is not replaced when one is already there (MACD stays)", (s) => once(s, "params.set(\"indicator\", INDICATOR_PARAM[indicator]);", "if (!params.has(\"indicator\")) params.set(\"indicator\", INDICATOR_PARAM[indicator]);")],
  ["the hash is dropped", (s) => once(s, "return `${path}?${params.toString()}${hash}`;", "return `${path}?${params.toString()}`;")],
  ["the two indicators are swapped", (s) => once(s, "{ rsi: \"RSI(14)\", macd: \"MACD(12,26,9)\" }", "{ rsi: \"MACD(12,26,9)\", macd: \"RSI(14)\" }")],
  ["an earnings link is rewritten too", (s) => once(s, "if (!href.startsWith(\"/dashboard\") && !href.startsWith(\"/?\")) return href;", "")],
];
for (const [label, mutate] of LINK_MUTANTS) {
  let broken;
  try { broken = await lift(mutate(src)); } catch (e) { check(`MUTANT anchor: ${label}`, false, e.message); continue; }
  check(`MUTANT caught: ${label}`, LINKS.some(([, run, want]) => run(broken) !== want));
}

console.log("\n3. the grid uses it, and does not read reasons for the panel\n");
const grid = readCodeOnly("app/components/PickerResultsGrid.tsx");
const body = grid.slice(grid.indexOf("function chartOverlayForEntry("), grid.indexOf("function scoreLabelForEntry("));
check("chartOverlayForEntry asks divergenceOverlay with the sidebar's ticked conditions", /divergenceOverlay\(configHref, selectedFilters, entry\)/.test(body) && /entry: ResultEntry, selectedFilters: readonly AnyFilterKey\[\]/.test(body));
check("chartOverlayForEntry never reads reasons, note or badge itself", !/\.reasons|entry\.note|entry\.badge/.test(body));
check("both call sites pass the sidebar's selected filters", (grid.match(/chartOverlayForEntry\(configHref, configTitle, entry, selectedFilters\)/g) ?? []).length === 2);
check("MUTANT caught: reading reasons in the grid again is detected", /\.reasons/.test(once(body, "const divergence = divergenceOverlay(", "const r = entry.reasons?.join(' '); const divergence = divergenceOverlay(")));

const pageSrc = readCodeOnly("app/components/PickerResultPage.tsx");
const pageFn = pageSrc.slice(pageSrc.indexOf("function chartHrefForEntry("), pageSrc.indexOf("function getSellSignalCount("));
check("the server page sets the indicator on a one-kind divergence page's chart links", /divergencePageKind\(configHref\)/.test(pageFn) && /if \(divergenceKind === "rsi" \|\| divergenceKind === "macd"\) return withDivergenceIndicator\(base, divergenceKind\);/.test(pageFn));
check("MUTANT caught: the server page's link rewrite removed is detected", !/withDivergenceIndicator\(base, divergenceKind\)/.test(once(pageFn, "return withDivergenceIndicator(base, divergenceKind);", "return base;")));
check("the grid's three chart links (card, list symbol, row action) go through chartLinkFor", !/entry\.chartHref|e\.chartHref/.test(grid.replace(/withDivergenceIndicator\(entry\.chartHref/, "")) && (grid.match(/chartLinkFor\(/g) ?? []).length >= 3);

console.log(failures ? `\n${failures} FAILED` : "\nThe divergence overlay holds.");
process.exit(failures ? 1 : 0);
