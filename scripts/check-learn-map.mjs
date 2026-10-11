// THE /learn SPIDER MAP (#563 COWORK #169; first built as a path, #166 PR 3).
//
// Renders the real /learn page (app/learn/page.tsx, server markup) with the
// repo's render hooks. It fails when:
//   1. a lesson (every one in ALL_LESSONS) or a guide is not a real <a href> in
//      the server HTML, or appears more than once (crawlable, exactly once);
//   2. a leaf shows more than its title, or its description is not in the HTML
//      (its card, tied to the link by aria-describedby);
//   3. the branches are not the six sections in order around one "Learn" hub,
//      three each side, or the section reads "Divergencies" anywhere a reader
//      sees it (the map, the sidebar, a lesson page's label);
//   4. hover and keyboard focus do not both pop a node (1.08×, a glow, the rest
//      dimmed to 40%), a section does not light its branch, or reduced motion
//      does not drop the scaling and the drawing animation;
//   5. touch has no first-tap-pops script, or the old wall of cards is back.
// A mutant each. (measure-learn-map checks the same behaviour in Chromium.)
//
//   node scripts/check-learn-map.mjs
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./lib/tsx-render-hooks.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const React = await import("react");
const { ALL_LESSONS } = await import("../app/learn/all-lessons.ts");

const MAP = "app/learn/LearnMap.tsx", PAGE = "app/learn/page.tsx", SHELL = "app/learn/LearnShell.tsx", LESSON = "app/learn/[slug]/page.tsx", ALL = "app/learn/all-lessons.ts";
const read = (f) => fs.readFileSync(f, "utf8");
const GUIDES = ["/how-to-read-stock-charts", "/best-stock-indicators-for-beginners", "/trading-setups",
  "/position-sizing-guide", "/stop-loss-strategy", "/trading-risk-management", "/risk-reward-ratio", "/margin-trading-explained"];
const LANES = ["basics", "indicators", "divergences", "financial", "guides", "risk"];
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const text = (h) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

let seq = 0;
/** Render the page with (possibly mutated) copies of the map and the page, beside the originals. */
async function render(mapSrc, pageSrc) {
  const tag = `${process.pid}-${seq++}`;
  const mapTmp = path.join("app/learn", `.check-lm-map-${tag}.tsx`), pageTmp = path.join("app/learn", `.check-lm-page-${tag}.tsx`);
  fs.writeFileSync(mapTmp, mapSrc);
  fs.writeFileSync(pageTmp, pageSrc.replace('from "./LearnMap";', `from "./${path.basename(mapTmp, ".tsx")}";`));
  try {
    const { default: Page } = await import(pathToFileURL(path.resolve(pageTmp)).href);
    return renderToStaticMarkup(React.createElement(Page));
  } finally { fs.rmSync(mapTmp, { force: true }); fs.rmSync(pageTmp, { force: true }); }
}

function rules(html, shellSrc = read(SHELL), lessonSrc = read(LESSON), allSrc = read(ALL)) {
  const fails = [], want = (l, ok) => { if (!ok) fails.push(l); };
  const css = html.match(/<style>([\s\S]*?\.lmWrap[\s\S]*?)<\/style>/)?.[1] ?? "";
  const leaves = [...html.matchAll(/<a href="([^"]+)" class="lmNode lmLeaf" data-i="\d+" aria-label="([^"]*)" aria-describedby="([^"]+)">([\s\S]*?)<\/a>/g)]
    .map((m) => ({ href: m[1], label: m[2], desc: m[3], body: m[4] }));
  // 1. Every lesson and guide a real link, exactly once.
  const want1 = [...ALL_LESSONS.map((l) => `/learn/${encodeURIComponent(l.slug)}`), ...GUIDES];
  want(`every lesson (${ALL_LESSONS.length}) and guide (${GUIDES.length}) is a real <a href> on the map, exactly once`,
    leaves.length === new Set(want1).size && want1.every((h) => leaves.filter((l) => l.href === h).length === 1));
  // 2. Title only up front; the description in the HTML, in a card tied to the link.
  want("each leaf is its title, with its description in the HTML (a card the link describes itself by)", leaves.length > 0 && leaves.every((l) => {
    const lesson = ALL_LESSONS.find((x) => l.href === `/learn/${encodeURIComponent(x.slug)}`);
    const m = l.body.match(/^<span class="lmTitle">([^<]+)<\/span><span class="lmCard" id="([^"]+)" role="tooltip">([^<]{20,})<span class="lmCardHint" aria-hidden="true">Tap again to open<\/span><\/span>$/);
    return !!m && m[2] === l.desc && m[1] === l.label && (!lesson || (m[1] === esc(lesson.title) && m[3] === esc(lesson.summary)));
  }));
  // 3. The hub, six branches in order, three each side; "Divergences" as readers see it.
  const lanes = [...html.matchAll(/<section class="lmGroup" data-lane="([a-z]+)" data-side="([lr])"/g)].map((m) => `${m[1]}:${m[2]}`);
  want("one \"Learn\" hub with the six sections in order, three each side", /<div class="lmHub" aria-hidden="true">Learn<\/div>/.test(html) &&
    lanes.join() === LANES.map((l, i) => `${l}:${i < 3 ? "l" : "r"}`).join());
  want("the section reads \"Divergences\" (map, sidebar, lesson pages)", !/Divergencies/i.test(text(html)) && /label="Divergences"/.test(shellSrc) &&
    /\{categoryLabel\(lesson\.category\)\}/.test(lessonSrc) && /return cat === "Divergencies" \? "Divergences" : cat;/.test(allSrc));
  // 4. The pop on hover AND focus; branch lighting; reduced motion.
  const popSel = css.match(/:is\(([^)]*\.lmNode:hover[^)]*)\)\{transform:scale\(1\.08\);/)?.[1] ?? "";
  want("hover and keyboard focus (and a tap) pop a node: 1.08×, a glow, the rest at 40%", /\.lmNode:hover/.test(popSel) && /\.lmNode:focus-visible/.test(popSel) && /\.lmNode\.is-active/.test(popSel) &&
    /transform:scale\(1\.08\);z-index:5;border-color:var\(--lm-tone\);box-shadow:0 0 0 1px var\(--lm-tone\),0 0 20px/.test(css) &&
    /\.lmMap:has\([^{]*\.lmNode:focus-visible[^{]*\) \.lmNode\{opacity:\.4;\}/.test(css) && /:is\([^)]*\.lmLeaf:focus-visible[^)]*\) \.lmCard\{visibility:visible;opacity:1;/.test(css));
  want("a section lights its whole branch", /\.lmMap \.lmGroup:has\(\.lmSection:hover,\.lmSection:focus-visible,\.lmSection\.is-active\) \.lmNode\{opacity:1;/.test(css));
  const reduced = css.match(/@media \(prefers-reduced-motion:reduce\)\{([\s\S]*)\}\s*$/)?.[1] ?? "";
  want("reduced motion: no scaling, no drawing, no transitions", /\.lmWire,\.lmTrunkWire\{animation:none;\}/.test(reduced) && /\.lmNode:focus-visible[^{]*\)\{transform:none;\}/.test(reduced) && /\{transition:none;\}/.test(reduced));
  // 5. Touch, and no card wall.
  want("touch: the first tap pops, the second opens (a script for no-hover devices)", /matchMedia\("\(hover: none\)"\)/.test(html) && /e\.preventDefault\(\);clear\(\);n\.classList\.add\("is-active"\)/.test(html));
  want("the old wall of cards is gone", !/minmax\(240px, ?1fr\)/.test(html) && !/>BASICS<|>INDICATORS<|>IN-DEPTH GUIDES</.test(html) && !/class="lmQ"/.test(html));
  return fails;
}

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const mapSrc = read(MAP), pageSrc = read(PAGE);
const realHtml = await render(mapSrc, pageSrc);
const real = rules(realHtml);
check("the /learn spider map passes every rule", real.length === 0, real.join("; "));

for (const [label, file, from, to] of [
  ["a leaf not a link", MAP, '<a href={n.href} className="lmNode lmLeaf"', '<span data-href={n.href} className="lmNode lmLeaf"'],
  ["a section's lessons dropped", MAP, 'nodes: lessons("Divergencies") }', "nodes: [] }"],
  ["a guide dropped", MAP, '  { href: "/risk-reward-ratio",', '  // { href: "/risk-reward-ratio",'],
  ["the description dropped from the HTML", MAP, "{n.summary}<span", "<span"],
  ["the description shown up front", MAP, '<span className="lmTitle">{n.title}</span>', '<span className="lmTitle">{n.title}: {n.summary}</span>'],
  ["the branches out of order", MAP, '    { id: "basics", label: "Basics", tone: "#93c5fd", nodes: lessons("Basics") },\n    { id: "indicators", label: "Indicators", tone: "#d8b4fe", nodes: lessons("Indicators") },', '    { id: "indicators", label: "Indicators", tone: "#d8b4fe", nodes: lessons("Indicators") },\n    { id: "basics", label: "Basics", tone: "#93c5fd", nodes: lessons("Basics") },'],
  ["\"Divergencies\" back on the map", MAP, 'label: "Divergences"', 'label: "Divergencies"'],
  ["hover only (focus does not pop)", MAP, "const active = (sel: string) => [`${sel}:hover`, `${sel}:focus-visible`, `${sel}.is-active`].join(\",\");", "const active = (sel: string) => [`${sel}:hover`, `${sel}.is-active`].join(\",\");"],
  ["no pop", MAP, "{transform:scale(1.08);", "{"],
  ["no dimming", MAP, ".lmNode{opacity:.4;}", ".lmNode{opacity:1;}"],
  ["a section does not light its branch", MAP, ".lmMap .lmGroup:has(${active(\".lmSection\")}) .lmNode{opacity:1;", ".lmMap .lmGroup:has(${active(\".lmSection\")}) .lmNode{"],
  ["reduced motion ignored", MAP, ".lmWire,.lmTrunkWire{animation:none;}\n:is(${active(\".lmNode\")}){transform:none;}", ""],
  ["no touch script", MAP, "<script dangerouslySetInnerHTML={{ __html: LEARN_MAP_TOUCH }} />", ""],
  ["the map not on the page", PAGE, "<LearnMap />", "{null}"],
]) {
  const src = file === MAP ? mapSrc : pageSrc;
  if (!src.includes(from)) { check(`mutant "${label}" applies`, false, "matched nothing"); continue; }
  const m = src.replace(from, to);
  let f;
  try { f = rules(file === MAP ? await render(m, pageSrc) : await render(mapSrc, m)); } catch (e) { f = [`threw: ${e.message}`]; }
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}
for (const [label, mutate] of [
  ["the lesson page's label back to \"Divergencies\"", () => rules(realHtml, undefined, read(LESSON).replace("{categoryLabel(lesson.category)}", "{lesson.category}"))],
]) {
  let f;
  f = mutate();
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}
console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
