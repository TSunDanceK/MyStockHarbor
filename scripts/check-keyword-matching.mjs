// Pins the matcher that decides what counts as an earnings story.
//
// THE BUG THIS EXISTS FOR, reported live on MU. A story headlined "Micron
// Committed $10 Billion Over 10 Years to a Research Lab" appeared in the
// earnings section, because keywordHits was `lower.includes(word)` and the
// word "quarter" is inside "headquartered". Same shape: "eps" inside "steps",
// "profit" inside "nonprofit", "margin" inside "marginal", "ai" inside "said".
//
// None of it is visible. The section fills, the score is a number, the build is
// green. The only symptom is an earnings section full of things that are not
// earnings -- and a filter that looks like it simply found these stories.
//
// THE FUNCTION IS EXTRACTED AND RUN, not re-implemented here. A second copy of
// the matching rule written inside its own test agrees with itself by
// construction (claude/traps/two-validators-for-one-value.md). Both
// keywordHits and the real isEarningsNewsItem are lifted out of the shipping
// sources by AST and executed.
//
//   node scripts/check-keyword-matching.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const sourceFile = (rel, kind = ts.ScriptKind.TS) =>
  ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, kind);

const extract = (sf, names) => {
  const out = {};
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) {
      out[node.name.text] = node.getText(sf).replace(/^export\s+/, "");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};

const { keywordHits } = extract(sourceFile("lib/keywordMatch.ts"), ["keywordHits"]);
const helpers = extract(sourceFile("lib/keywordMatch.ts"), ["matcher"]);
const { isEarningsNewsItem } = extract(sourceFile("lib/stock-news-data.ts"), ["isEarningsNewsItem"]);

if (!keywordHits || !helpers.matcher || !isEarningsNewsItem) {
  console.error("FAIL: could not extract the shipping functions — measuring nothing.");
  process.exit(1);
}

// The module-level cache and escape helper the extracted matcher closes over,
// copied verbatim from the source rather than paraphrased.
const preamble = read("lib/keywordMatch.ts")
  .split("\n")
  .filter((l) => l.startsWith("const cache =") || l.startsWith("const escape ="))
  .join("\n");

const js = ts.transpileModule(
  `${preamble}\n${helpers.matcher}\n${keywordHits}\n${isEarningsNewsItem}\n` +
    `export { keywordHits, isEarningsNewsItem };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

console.log("\n=== 1. Every reported false positive, gone ===\n");
// Each of these is a word the old substring matcher found inside a longer,
// unrelated word. Left as separate cases so a regression names which one.
const FALSE_POSITIVES = [
  ["quarter", "The company is headquartered in Boise, Idaho"],
  ["eps", "Management steps back from the target"],
  ["eps", "The board keeps its dividend unchanged"],
  ["profit", "Donated to a nonprofit research foundation"],
  ["margin", "A marginal improvement in throughput"],
  ["ai", "The spokesperson said the plant is on schedule"],
  ["ai", "Shares maintain their gains into the close"],
  ["meta", "A new metal fabrication line opens"],
  ["loss", "The glossary defines the term"],
];
for (const [word, text] of FALSE_POSITIVES) {
  check(`"${word}" does NOT match: ${text}`, !m.keywordHits(text.toLowerCase(), [word]));
}

console.log("\n=== 2. What the substring behaviour was doing right, kept ===\n");
// A plain \bword\b fix trades one error for its opposite. These are the
// inflections the old matcher caught for free and the new one must still catch.
const TRUE_POSITIVES = [
  ["profit", "Q3 profits rose 12%"],
  ["loss", "Wider losses on lower volumes"],
  ["miss", "Micron missed on revenue"],
  ["surge", "Shares surged after the print"],
  ["recall", "The company recalled 40,000 units"],
  ["quarter", "Third quarter results"],
  ["margin", "Gross margins expanded"],
  ["decline", "Bookings declined year over year"],
  ["eps", "EPS of $1.20 beat estimates"],
  ["ai", "A new AI accelerator"],
  ["price target cut", "Analyst price target cuts follow the miss"],
  ["52-week", "Stock hits a 52-week high"],
  ["white house", "White House comment on the deal"],
];
for (const [word, text] of TRUE_POSITIVES) {
  check(`"${word}" still matches: ${text}`, m.keywordHits(text.toLowerCase(), [word]));
}

console.log("\n=== 3. The reported story, end to end ===\n");
// The exact item, through the REAL classifier rather than through keywordHits
// directly -- this is the reading the earnings section actually takes.
const MU = {
  title: "Micron Committed $10 Billion Over 10 Years to a Research Lab",
  description:
    "The memory maker, headquartered in Boise, said the facility will support long-term process development.",
};
check(
  "the MU research-lab story is NOT an earnings story",
  !m.isEarningsNewsItem(MU),
  '"headquartered" no longer counts as "quarter"'
);
check(
  "a real earnings story still is",
  m.isEarningsNewsItem({
    title: "Micron Q3 Earnings: Revenue Beats, Guidance Raised",
    description: "Gross margins expanded sequentially.",
  })
);

console.log("\n=== 4. Known limit, recorded rather than implied fixed ===\n");
// "results" is a real English word in "which results in". No matcher can tell
// that from "Q3 results" -- it is a bad KEYWORD, not a bad match. Asserted as a
// KNOWN failure so nobody reads a green run as "the earnings filter is clean",
// and so the day the vocabulary is narrowed, this check fails and gets updated.
check(
  "STILL MISCLASSIFIED (known): a 'results in' sentence reads as earnings",
  m.isEarningsNewsItem({
    title: "New tariff schedule takes effect",
    description: "The change results in higher landed costs for importers.",
  }),
  "narrowing the earnings vocabulary is a separate decision — see 2c"
);

console.log("\n=== 5. One matcher, not four ===\n");
// Three byte-identical copies of keywordHits shipped: lib/stock-news-data.ts,
// lib/stock-news-templates.ts and app/stock/[symbol]/news/page.tsx. A matcher
// fix applied to the lib alone would have left the PAGE WHERE THE BAD STORIES
// WERE ACTUALLY SEEN running the old rule.
const tree = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(e.name)) tree.push([path.relative(ROOT, full), read(path.relative(ROOT, full))]);
  }
};
walk(path.join(ROOT, "app"));
walk(path.join(ROOT, "lib"));
const definers = tree.filter(([, src]) => /function keywordHits\s*\(/.test(src)).map(([rel]) => rel);
check("exactly one definition of keywordHits in the tree", definers.length === 1, definers.join(", "));
check("...and it is the shared leaf module", definers[0] === "lib/keywordMatch.ts");

const newsPage = read("app/stock/[symbol]/news/page.tsx");
check(
  "the news page uses the lib's earnings classifier, not a local copy",
  /isEarningsNewsItem\(item\)/.test(newsPage) && !/function isEarningsHeadline/.test(newsPage)
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
