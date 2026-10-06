// CHART-PLAY CARDS: A QUIET LINK, NOT A BIG BUTTON (#553 COWORK #162).
//
// In each of the three chart-play clients (ascending triangles, bull flags,
// descending triangles):
//   - no full-width filled "Open full chart" button, and no per-pattern tint;
//   - the card ends in an "Open full chart →" link (.playOpenLink) named
//     "Open full chart for <SYMBOL>", at --fs-label, accent colour, no fill or
//     border, a 44 px tap area, underlined on hover and focus;
//   - the chart is a link to the same URL under the same name;
//   - the card is a flex column, so the link sits at its foot and cards in a
//     row end level;
//   - the pattern chart, score badge and description stay.
// Every rule has a planted mutant.
//
//   node scripts/check-play-card-link.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const FILES = [
  "app/plays/PlaysClient.tsx",
  "app/plays/bull-flags/BullFlagsClient.tsx",
  "app/plays/descending-triangles/DescendingTrianglesClient.tsx",
];
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

function rules(file, raw) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(`${file}: ${label}`); };
  const c = stripComments(raw, { file });
  const card = c.slice(c.indexOf("{section.items.map((item) => ("), c.indexOf("function MiniPlayChart"));
  want("no filled full-width button in the card", !/justifyContent: "center",\s*textDecoration: "none",\s*borderRadius: 14,/.test(card) && !/>\s*Open full chart\s*</.test(card));
  want("the link: named, quiet, at the foot",
    /<a\s+href=\{toChartHref\(item\.dashboardHref\)\}\s+aria-label=\{`Open full chart for \$\{item\.symbol\}`\}\s+className="playOpenLink"\s*>\s*Open full chart →\s*<\/a>/.test(card));
  want("the chart is a link to the same URL under the same name",
    /<a\s+href=\{toChartHref\(item\.dashboardHref\)\}\s+aria-label=\{`Open full chart for \$\{item\.symbol\}`\}\s+className="playChartArea"\s*>\s*<MiniPlayChart item=\{item\} \/>\s*<\/a>/.test(card));
  const css = (c.match(/const PLAY_CARD_LINK_CSS = `([\s\S]*?)`;/) ?? [])[1] ?? "";
  const link = (css.match(/\.playOpenLink \{([^}]*)\}/) ?? [])[1] ?? "";
  want("the link reads at --fs-label in the accent, no fill, no border", /font-size: var\(--fs-label\)/.test(link) && /color: #7dd3fc/.test(link) && /background: none/.test(link) && /border: 0/.test(link));
  want("a 44 px tap area, pushed to the card's foot", /min-height: 44px/.test(link) && /margin-top: auto/.test(link));
  want("underlined on hover and focus", /\.playOpenLink:hover, \.playOpenLink:focus-visible \{ text-decoration: underline;/.test(css));
  want("the styles are rendered", /<style>\{PLAY_CARD_LINK_CSS\}<\/style>/.test(c));
  want("the card is a flex column", /boxShadow: "0 16px 36px rgba\(0,0,0,0\.22\)",\s*display: "flex",\s*flexDirection: "column",/.test(card));
  want("the pattern chart, score and description stay", /<MiniPlayChart item=\{item\} \/>/.test(card) && /\{item\.score\}/.test(card) && /\{item\.note\}/.test(card));
  return fails;
}

const srcs = Object.fromEntries(FILES.map((f) => [f, read(f)]));
console.log("\n1. The three chart-play clients");
for (const f of FILES) {
  const r = rules(f, srcs[f]);
  check(`${f}: quiet named link, clickable chart, no big button`, r.length === 0, r.join("; "));
}

console.log("\n2. Planted mutants");
const BUTTON = `                    <a
                      href={toChartHref(item.dashboardHref)}
                      style={{
                        marginTop: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        textDecoration: "none",
                        borderRadius: 14,
                        padding: "11px 12px",
                        background: "rgba(37,99,235,0.24)",
                      }}
                    >
                      Open full chart
                    </a>
`;
const f0 = FILES[0], f1 = FILES[1], f2 = FILES[2];
const MUTANTS = [
  ["the big button restored", f0, "                    <a\n                      href={toChartHref(item.dashboardHref)}\n                      aria-label={`Open full chart for ${item.symbol}`}\n                      className=\"playOpenLink\"", BUTTON + "                    <a\n                      href={toChartHref(item.dashboardHref)}\n                      aria-label={`Open full chart for ${item.symbol}`}\n                      className=\"playOpenLink\""],
  ["the link loses its name", f1, "                      aria-label={`Open full chart for ${item.symbol}`}\n                      className=\"playOpenLink\"", "                      className=\"playOpenLink\""],
  ["the chart no longer a link", f2, "                      className=\"playChartArea\"\n                    >\n                      <MiniPlayChart item={item} />\n                    </a>", "                      className=\"playChartAreaX\"\n                    >\n                      <MiniPlayChart item={item} />\n                    </a>"],
  ["the link under 44 px", f0, "align-items: center; min-height: 44px;", "align-items: center; min-height: 24px;"],
  ["the link given a fill", f1, "  background: none; border: 0;", "  background: rgba(34,197,94,0.24); border: 0;"],
  ["no underline on focus", f2, ".playOpenLink:hover, .playOpenLink:focus-visible { text-decoration: underline;", ".playOpenLink:hover { text-decoration: underline;"],
  ["the card no longer a column", f0, "                      display: \"flex\",\n                      flexDirection: \"column\",\n", ""],
  ["the pattern chart removed", f1, "                      <MiniPlayChart item={item} />\n", ""],
];
for (const [label, file, from, to] of MUTANTS) {
  if (!srcs[file].includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
  const f = rules(file, srcs[file].replace(from, to));
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
