// What a news card's footer claims about where its text came from.
//
// WHAT IS AT RISK. A false provenance claim is the one bug this whole migration
// exists to prevent, and it renders perfectly:
//   1. CLAIMING AN EXCERPT OVER GENERATED TEXT. Google News carries no usable
//      description, so most cards' summaries are BUILT by the site. Calling
//      that "article excerpt provided by ..." tells a reader a publisher wrote
//      a sentence the site wrote.
//   2. NAMING FMP WHILE FMP IS NOT SERVING. The hardcoded line did exactly this
//      on all fifteen cards of the step-7 preview.
//   3. THE CLAIM DRIFTING FROM THE RENDER. The footer says which of two things
//      happened; if it decides that with its own copy of the predicate, the two
//      can disagree, which is how the original line became false.
//
//   node scripts/check-news-attribution.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const src = read("lib/news-attribution.ts");
const file = path.join(ROOT, ".check-attribution.mjs");
fs.writeFileSync(file, ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
let mod;
try { mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`); }
finally { fs.unlinkSync(file); }
const { newsAttribution, hasPublisherExcerpt } = mod;

const EXCERPT = "A".repeat(60);
const line = (provider, description, source = "Example Wire") =>
  newsAttribution({ provider, description, source });

// A CLAIM, NOT THE WORD. The first version of this tested /excerpt/i and failed
// every generated line, because the generated line SAYS "it is not an excerpt
// from the publisher" — the denial contains the noun. Matching the word would
// have forced the honest sentence to talk around the thing it is denying. The
// claim is always the opening of a sentence; the denial never is.
const claimsExcerpt = (text) => /(?:^|[.]\s+)(?:Article\s+e|E)xcerpt\b/.test(text);

console.log("\n=== 1. GENERATED TEXT IS NEVER CALLED AN EXCERPT ===\n");
for (const provider of ["gnews", "sec", "wire", "fmp", null, undefined, "somethingnew"]) {
  const text = line(provider, null);
  check(
    `${String(provider)} with no description does not claim an excerpt`,
    !claimsExcerpt(text) && /generated/i.test(text),
    text.slice(0, 80)
  );
}
check(
  "a description too short to render is treated as no description",
  !claimsExcerpt(line("wire", "tiny")),
  "the pages fall back to the built sentence below the threshold, so the footer must too"
);

console.log("\n=== 2. A REAL EXCERPT IS CREDITED, AND TO THE RIGHT PLACE ===\n");
check("a wire excerpt is called a press release", /press release/i.test(line("wire", EXCERPT)));
check("an FMP excerpt still names the FMP feed", /FMP news feed/.test(line("fmp", EXCERPT)));
check(
  "an unknown provider with real text credits its source and claims nothing more",
  claimsExcerpt(line("somethingnew", EXCERPT)) && /Example Wire/.test(line("somethingnew", EXCERPT))
);
check(
  "SEC says its HEADLINE is constructed too, not just its summary",
  /headline/i.test(line("sec", null)),
  "the title comes from the form type and item codes; a reader should not read it as the filing's own words"
);

console.log("\n=== 3. THE AI CLAUSE SURVIVES ON EVERY PATH ===\n");
const ALL = [
  line("gnews", null), line("sec", null), line("wire", EXCERPT),
  line("fmp", EXCERPT), line(null, null), line("somethingnew", EXCERPT),
];
check(
  "every line still says AI is used only for the optional read",
  ALL.every((t) => /AI is used only for the optional/.test(t)),
  "that half was true before and stays true; dropping it would understate what the page does"
);

console.log("\n=== 4. NO FMP IN READER-FACING COPY WHILE FREE IS THE DEFAULT ===\n");
// The assertion the owner asked for by name. Scoped to what a reader can see:
// the pages' rendered strings, not their comments, and not the attribution
// module's own fmp branch, which exists FOR the rollback and is reached only
// when an item really carries provider "fmp".
const registry = readCodeOnly("lib/server/news/index.ts");
const defaultIsFree = /process\.env\.NEWS_PROVIDER === "fmp" \? "fmp" : "free"/.test(registry);
check("the default is free, so this section applies", defaultIsFree);

for (const page of ["app/stock/[symbol]/news/page.tsx", "app/sector/[slug]/news/page.tsx"]) {
  const code = readCodeOnly(page);
  // Reader-facing strings only: JSX text and string literals that reach render.
  check(
    `${page} names no provider in its own copy`,
    !/FMP news feed/.test(code),
    "the sentence that rendered on all fifteen preview cards, none of which came from FMP"
  );
  check(
    `...and ${page} asks lib/news-attribution for the line`,
    /newsAttribution\(/.test(code),
    "a hardcoded sentence cannot be right for three providers at once"
  );
  check(
    `...and ${page} RENDERS it, with nothing guarding the call`,
    // STEP 6b's LESSON AGAIN. `/newsAttribution\(/` is satisfied by
    // `{false && newsAttribution({...})}`, which renders an empty footer — a
    // mutation that walked straight through the check above. The call has to be
    // the whole of the JSX expression, so the brace is immediately followed by
    // it and nothing else.
    /\{\s*newsAttribution\(/.test(code) &&
      !/\{[^{}]*(?:&&|\?)[^{}]*newsAttribution\(/.test(code),
    "a guarded call satisfies a grep and renders nothing"
  );
  check(
    `...and ${page} uses the SHARED excerpt predicate`,
    /hasPublisherExcerpt\(/.test(code),
    "its own length test is a second copy, and drift between render and claim is the original bug"
  );
  check(
    `...and ${page} has no length test of its own left`,
    !/length\s*>=?\s*40\b/.test(code),
    "the sector page said > 40 and the stock page >= 40 — a one-character disagreement about the same item"
  );
}

console.log("\n=== 5. THE PREDICATE IS GENUINELY SHARED, NOT JUST IMPORTED ===\n");
// Step 6b's lesson: an import can be present and never reached. This runs the
// predicate at the exact boundary both pages branch on.
check("39 characters is not an excerpt", !hasPublisherExcerpt("A".repeat(39)));
check("40 characters is", hasPublisherExcerpt("A".repeat(40)));
check("whitespace does not pad it over the line", !hasPublisherExcerpt(`${" ".repeat(50)}short`));
check("null and undefined are not excerpts", !hasPublisherExcerpt(null) && !hasPublisherExcerpt(undefined));
check(
  "the boundary value agrees with the footer it drives",
  claimsExcerpt(line("fmp", "A".repeat(40))) && !claimsExcerpt(line("fmp", "A".repeat(39))),
  "if these two ever disagree the footer is describing a render that did not happen"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
