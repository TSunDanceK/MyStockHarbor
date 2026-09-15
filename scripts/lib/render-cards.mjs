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
  const view = [
    fs.readFileSync("lib/server/secFields.ts", "utf8"),
    stripImports("lib/server/secExtract.ts"),
    stripImports("lib/server/secFactCodec.ts"),
    stripImports("lib/server/secEarningsView.ts"),
  ].join("\n");
  const cards = fs
    .readFileSync("app/stock/[symbol]/earnings/SecEarningsCards.tsx", "utf8")
    .replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
  // `mutate` is how a check breaks the shipped source on purpose and re-renders
  // — the mutation harness. Identity by default.
  return importTsxSource(mutate(`${view}\n${cards}`));
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
