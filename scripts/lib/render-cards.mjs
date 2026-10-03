// RENDER THE EARNINGS CARDS TO HTML, so a check can assert what a READER sees.
//
// ── WHY SOURCE-SCANNING WAS NOT ENOUGH ────────────────────────────────────
// check-sec-earnings-page asserts against the source, which is the right
// instrument for "is this hidden card registered" and the wrong one for "does
// the word `accession` reach a reader". A regex over JSX cannot tell a string
// that renders from one inside a branch that never runs, and it cannot see text
// assembled from two expressions. Three of the review's findings — an internal
// citation live on the page, the accession in prose, a hidden card that should
// render nothing — are all about OUTPUT.
//
// So the cards are transpiled with JSX enabled, given a real StoredFactSet
// fixture, and rendered with react-dom/server. What comes back is the markup
// the browser gets.
//
// NO FIXTURE SUPPLIES AN EXPECTED VALUE. The fact sets are captured from live
// companyfacts by the shipped extractor (scripts/sec-fixture-capture.mjs) and
// committed under data/sec/. Every number in them comes from SEC.
import fs from "node:fs";
import { grabConst } from "./source-code.mjs";
import { grabFunction } from "./earnings-plan.mjs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Transpile a .tsx module and import it.
 *
 * `jsx: ReactJSX` plus a .tsx fileName — without the extension TypeScript
 * parses `<div>` as a type assertion and the transpile fails on the first tag.
 * `react/jsx-runtime` is resolved through a data: URL's bare specifier, which
 * Node resolves against the importing file, so the module is written to a real
 * path inside the repo instead.
 */
async function importTsxSource(src) {
  const js = ts.transpileModule(src, {
    fileName: "cards.tsx",
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "react",
    },
  }).outputText;
  // WRITTEN TO A REAL PATH, not a data: URL. The emitted module imports
  // "react/jsx-runtime", a bare specifier, and Node resolves those against the
  // IMPORTING file — a data: URL has no directory to resolve from, so the
  // import fails. A file inside the repo does. Removed in a finally.
  const tmp = `scripts/.render-cards-${process.pid}.mjs`;
  fs.writeFileSync(tmp, js);
  try {
    return await import(`${process.cwd()}/${tmp}?t=${Date.now()}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const stripImports = (f) =>
  fs.readFileSync(f, "utf8")
    .replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");

/**
 * The view module and the cards module, wired together in one transpiled unit.
 *
 * The cards import from "@/lib/server/secEarningsView", which Node cannot
 * resolve here, so the view's source is inlined ahead of them and the import
 * line is dropped. One unit, no module graph, no path aliases.
 */
export async function loadCards(mutate = (src) => src) {
  // ORDER IS THE DEPENDENCY ORDER, and fxRates/secCurrency are in it because
  // the view now computes growth in the filer's reporting currency (see
  // storedInReportingCurrency). They are plain concatenation like the rest —
  // secCurrency's only imports are secFields, fxRates, and types that erase.
  const view = [
    fs.readFileSync("lib/server/secFields.ts", "utf8"),
    stripImports("lib/server/secExtract.ts"),
    stripImports("lib/server/fxRates.ts"),
    stripImports("lib/server/secCurrency.ts"),
    stripImports("lib/server/secFactCodec.ts"),
    stripImports("lib/server/secEarningsView.ts"),
    // THE CARDS' OTHER TWO SOURCES. SecEarningsCards.tsx imports the tone
    // bands and the trend median from secPresentation and the valuation legs
    // from secValuation; both are stripped of their imports and concatenated
    // like the rest, and both sit AFTER secEarningsView because that is what
    // they read (periodWords/isPct, and isConsecutive respectively).
    //
    // A MISSING MODULE HERE FAILS AT RENDER, NOT AT IMPORT — the first card
    // that calls barValue throws ReferenceError mid-tree, which is how this
    // was found. Anything the cards import has to be added here too.
    stripImports("lib/server/secPresentation.ts"),
    // THE SCORER, for SecScoreCard. After secPresentation, whose coverage
    // arithmetic it calls.
    stripImports("lib/server/secEarningsScore.ts"),
    // THE STATUTORY TABLE, AHEAD OF secValuation THAT READS IT.
    // COVER_SHARES_MAX_AGE_DAYS is DERIVED from DEADLINE_FALLBACK rather than
    // written as a number, so the concatenated unit needs the declaration or
    // the cards throw ReferenceError mid-render. ONE declaration, not the
    // module: secReportDates declares `const DAY` and so does secExtract above,
    // and the duplicate is a SyntaxError at import.
    grabConst("lib/server/secReportDates.ts", "DEADLINE_FALLBACK"),
    // THE ANNUAL-ONLY PREDICATE (#548), AHEAD OF secValuation THAT READS IT
    // for the P/E basis (#552 COWORK #9). The function and its one constant,
    // not the module: annualOnly declares MONTHS, which other lifted modules
    // may declare too.
    grabConst("lib/server/annualOnly.ts", "ANNUAL_ONLY_QUARTER_MONTHS"),
    grabFunction(fs.readFileSync("lib/server/annualOnly.ts", "utf8"), "annualOnlyForm"),
    // THE ESTIMATE LAYER, which secValuation reads (#552 COWORK #112).
    stripImports("lib/server/secEstimates.ts"),
    stripImports("lib/server/secValuation.ts"),
  ].join("\n");
  const cards = fs
    .readFileSync("app/stock/[symbol]/earnings/SecEarningsCards.tsx", "utf8")
    .replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
  // `mutate` is how a check breaks the shipped source on purpose and re-renders
  // — the mutation harness. Identity by default.
  const unit = mutate(`${view}\n${cards}`);
  // THE GROWTH & MARGINS PICTURE (#563 COWORK #36): SecGrowthMarginsCard draws
  // C's GrowthVisuals from buildGrowthVisuals, so both join the unit, after the
  // cards (hoisted; the card calls them at render). ONLY WHEN THE CALLER HAS NOT
  // ALREADY APPENDED THEM: check-growth-visuals appends its own (mutated) copy
  // through `mutate`, and a second copy would be a duplicate declaration.
  return importTsxSource(/function buildGrowthVisuals\(/.test(unit) ? unit : unit + growthVisualsUnit());
}

/** C's builder and component, stripped and joined the way check-growth-visuals joins them. */
export function growthVisualsUnit() {
  const builder = stripImports("lib/growthVisuals.ts");
  // The palette GrowthVisuals.tsx imports (#552 COWORK #134: shared with the snapshot tile).
  const palette = stripImports("lib/growthPalette.ts");
  const component = stripImports("app/stock/[symbol]/earnings/GrowthVisuals.tsx")
    .replace("export default function GrowthVisuals", "export function GrowthVisuals");
  return `\n${reasonedValueUnit()}\n${palette}\n${builder}\n${component}\n`;
}

/**
 * A's ReasonedValue (app/components/EstimatedValue.tsx) and the React hooks it
 * and GrowthVisuals use, for a unit that renders the picture: the one-off tag
 * opens its note through it (#563 COWORK #52). Its re-export line is dropped,
 * since estimateMark's constants are inlined ahead of it.
 */
export function reasonedValueUnit() {
  const mark = stripImports("app/components/estimateMark.ts");
  const comp = stripImports("app/components/EstimatedValue.tsx")
    .replace(/^"use client";$/m, "")
    .replace(/^export \{ ESTIMATE_COLOUR, ESTIMATE_SIGN, type EstimateMark \};$/m, "");
  return `import { useEffect, useId, useRef, useState } from "react";\n${mark}\n${comp}\n`;
}

/**
 * The Next report card (#552 COWORK #96), with what it imports: the shared
 * estimate mark, and secEstimates' date words (the two functions and their
 * month table, not the module). `mutate` breaks the card's source on purpose.
 */
export async function loadNextReportCard(mutate = (src) => src) {
  const est = fs.readFileSync("lib/server/secEstimates.ts", "utf8");
  const card = stripImports("app/stock/[symbol]/earnings/NextReportCard.tsx")
    .replace("export default function NextReportCard", "export function NextReportCard");
  return importTsxSource([
    reasonedValueUnit(),
    grabConst("lib/server/secEstimates.ts", "EST_MONTH_ABBR"),
    grabFunction(est, "readableDate"),
    grabFunction(est, "readableIsoDates"),
    grabFunction(est, "reportWindowMark"),
    mutate(card),
  ].join("\n"));
}

/**
 * The price-reaction charts (app/stock/[symbol]/earnings/ReactionCharts.tsx).
 * Self-contained — its only import is React's types — so it transpiles alone.
 */
export async function loadReactionCharts(mutate = (src) => src) {
  const src = fs.readFileSync("app/stock/[symbol]/earnings/ReactionCharts.tsx", "utf8")
    .replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
  return importTsxSource(mutate(src));
}

/** Render one element to markup. */
export const html = (el) => renderToStaticMarkup(el);

/**
 * Markup with tags removed and entities decoded — what a reader actually reads.
 *
 * Attribute VALUES are dropped with their tags, deliberately: a `title=` or an
 * `href=` is not body text, and a check for leaked jargon that scanned
 * attributes would fire on every SEC EDGAR link. Where an attribute IS the
 * thing under test, assert on the markup instead.
 */
export function visibleText(markup) {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/\s+/g, " ")
    .trim();
}

export { React };
