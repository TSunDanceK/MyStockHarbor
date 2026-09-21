// RENDER THE SIDEBAR EARNINGS SNAPSHOT, so a check can assert what a READER
// sees — and re-render it with the shipped source deliberately broken.
//
// ── WHY THIS EXISTS BESIDE render-cards.mjs ───────────────────────────────
// That harness wires secEarningsView to the /stock/[symbol]/earnings CARDS.
// This one wires the same view to the SNAPSHOT BUILDER
// (lib/server/secEarningsSnapshot.ts), the SCORER
// (lib/server/secEarningsScore.ts) and the sidebar card
// (app/components/LatestEarningsCard.tsx) — a different module graph answering
// a different question, and neither is a subset of the other.
//
// THE MUTATION ARGUMENT IS THE POINT. An assertion that passes against correct
// source proves nothing on its own: it may be reading a string that would be
// there whatever the code did. Every property this harness is used for is
// asserted twice — once against the shipped source, once against a source
// edited to break exactly that property — so a check that cannot fail is
// visible as a check that cannot fail.
//
// NO FIXTURE SUPPLIES AN EXPECTED VALUE. data/sec/factset-fixture-*.json are
// captured from live companyfacts by the shipped extractor
// (scripts/sec-fixture-capture.mjs). Every number in them comes from SEC.
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function importTsxSource(src) {
  const js = ts.transpileModule(src, {
    fileName: "snapshot.tsx",
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "react",
    },
  }).outputText;
  // A REAL PATH, NOT A data: URL — the emitted module imports
  // "react/jsx-runtime", a bare specifier, and Node resolves those against the
  // IMPORTING file. A data: URL has no directory to resolve from.
  const tmp = `scripts/.render-snapshot-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`;
  fs.writeFileSync(tmp, js);
  try {
    return await import(`${process.cwd()}/${tmp}?t=${Date.now()}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * One exported `const NAME = ...;` from a module, without the module.
 *
 * Anchored on `^export const NAME` and closed on the first line that is a bare
 * `};` — the shape every table in these files has. It returns the declaration
 * with `export` stripped, because the caller concatenates it into a unit that
 * declares its own exports.
 */
const grabConst = (file, name) => {
  const src = fs.readFileSync(file, "utf8");
  const re = new RegExp(`^export const ${name}[^=]*=[\\s\\S]*?\\n\\};$`, "m");
  const found = (src.match(re) ?? [])[0];
  if (!found) throw new Error(`grabConst: ${name} not found in ${file}`);
  return found.replace(/^export /, "");
};

const stripImports = (f) =>
  fs.readFileSync(f, "utf8")
    .replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");

/**
 * `next/link` and the sector helpers, as the smallest things that behave.
 *
 * The real Link needs a Next request context; an <a> is what it renders to and
 * is all any assertion here reads. Declared as source rather than injected as
 * a binding because the modules below are concatenated into ONE unit — there
 * is no import to satisfy, only a name that has to exist.
 */
const SHIMS = `
const Link = ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a>;
const sectorSlugFromLabel = (label) => (label ? String(label).toLowerCase().replace(/[^a-z]+/g, "-") : null);
const sectorNewsPath = (slug) => "/sector-news/" + slug;
`;

/**
 * The snapshot builder, the scorer and the sidebar card, in one transpiled unit.
 *
 * ORDER IS DEPENDENCY ORDER, and a missing module here fails at RENDER rather
 * than at import — the first call into it throws ReferenceError mid-tree, which
 * is how render-cards.mjs found its own gap. Anything these files import has to
 * be added to the list.
 *
 * secReportDates contributes ONE table rather than the module; see the note at
 * its entry below.
 *
 * `mutate` receives the whole concatenated source. Identity by default.
 */
export async function loadSnapshot(mutate = (src) => src) {
  const unit = [
    SHIMS,
    fs.readFileSync("lib/server/secFields.ts", "utf8"),
    stripImports("lib/server/secExtract.ts"),
    stripImports("lib/server/fxRates.ts"),
    stripImports("lib/server/secCurrency.ts"),
    stripImports("lib/server/secFactCodec.ts"),
    stripImports("lib/server/secEarningsView.ts"),
    // ── TIMING_WORDING ONLY, NOT THE WHOLE MODULE ────────────────────────
    // The first draft inlined lib/server/secReportDates.ts entire, for this
    // one table. It declares `const DAY = 86400000` at top level and so does
    // secExtract above it, and concatenation turned two correct modules into
    // "Identifier 'DAY' has already been declared" — a collision that exists
    // only in this harness and would grow a new instance every time either
    // file gained a common name. Grabbing the table keeps the surface at the
    // one thing the snapshot actually reads.
    grabConst("lib/server/secReportDates.ts", "TIMING_WORDING"),
    stripImports("lib/server/secEarningsScore.ts"),
    // getSecEarningsSnapshot's Redis and cold-path calls are stripped with the
    // imports and are never invoked: every assertion drives
    // buildSecEarningsSnapshot, the pure half, which is why it is a separate
    // function at all.
    stripImports("lib/server/secEarningsSnapshot.ts"),
    stripImports("app/components/LatestEarningsCard.tsx"),
  ].join("\n");
  return importTsxSource(mutate(unit));
}

/** CompanyProfile on its own — it shares nothing with the earnings graph. */
export async function loadProfile(mutate = (src) => src) {
  const unit = [SHIMS, stripImports("app/components/CompanyProfile.tsx")].join("\n");
  return importTsxSource(mutate(unit));
}

/** Render one element to markup. */
export const html = (el) => renderToStaticMarkup(el);

/**
 * Markup with tags removed and entities decoded — what a reader actually reads.
 *
 * Attribute VALUES are dropped with their tags, deliberately: an href is not
 * body text. Where an attribute IS the thing under test (a colour, say),
 * assert on the markup instead.
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
