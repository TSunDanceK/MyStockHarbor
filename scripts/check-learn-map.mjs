// THE /learn OVERVIEW AS A MAP (#563 COWORK #166 PR 3).
//
// Renders the real /learn page (app/learn/page.tsx, server markup) with the
// repo's render hooks. It fails when:
//   1. a lesson (every one in ALL_LESSONS) or a guide is missing from the map,
//      or is not a real <a href> in the server HTML (crawlable);
//   2. a node shows more than its title, or its "?" is not a native <details>
//      holding its short description (in the HTML, closed on arrival);
//   3. the lanes are not the existing sections in order (Basics, Indicators,
//      Divergencies, How to read financial data, In-depth guides, Risk
//      management), or the path's steps are not numbered 1..N in that order;
//   4. the old wall of cards is back;
//   5. there is no vertical path on a phone (640 px and under).
// A mutant each.
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

const MAP = "app/learn/LearnMap.tsx", PAGE = "app/learn/page.tsx";
const read = (f) => fs.readFileSync(f, "utf8");
const GUIDES = ["/how-to-read-stock-charts", "/best-stock-indicators-for-beginners", "/trading-setups",
  "/position-sizing-guide", "/stop-loss-strategy", "/trading-risk-management", "/risk-reward-ratio", "/margin-trading-explained"];
const LANES = ["basics", "indicators", "divergencies", "financial", "guides", "risk"];
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

let seq = 0;
/** Render the page with (possibly mutated) copies of the map and the page, side by side with the originals. */
async function render(mapSrc, pageSrc) {
  const tag = `${process.pid}-${seq++}`;
  const mapTmp = path.join("app/learn", `.check-lm-map-${tag}.tsx`), pageTmp = path.join("app/learn", `.check-lm-page-${tag}.tsx`);
  fs.writeFileSync(mapTmp, mapSrc);
  fs.writeFileSync(pageTmp, pageSrc.replace('from "./LearnMap";', `from "./${path.basename(mapTmp, ".tsx")}";`));
  try {
    const { default: Page } = await import(pathToFileURL(path.resolve(pageTmp)).href);
    const mod = await import(pathToFileURL(path.resolve(mapTmp)).href);
    return { html: renderToStaticMarkup(React.createElement(Page)), css: mod.LEARN_MAP_CSS ?? "" };
  } finally { fs.rmSync(mapTmp, { force: true }); fs.rmSync(pageTmp, { force: true }); }
}

function rules({ html, css }) {
  const fails = [], want = (l, ok) => { if (!ok) fails.push(l); };
  const map = html.slice(html.indexOf('data-learn-map=""'), html.indexOf("</nav>", html.indexOf('data-learn-map=""')));
  const nodes = [...map.matchAll(/<li class="lmNode" data-step="(\d+)">([\s\S]*?)<\/li>/g)].map((m) => ({ step: Number(m[1]), body: m[2] }));
  const hrefs = nodes.map((n) => n.body.match(/^<a href="([^"]+)" class="lmLink">/)?.[1] ?? null);
  // 1. Every lesson and guide, each a real link.
  const lessonHrefs = ALL_LESSONS.map((l) => `/learn/${encodeURIComponent(l.slug)}`);
  want(`every lesson (${ALL_LESSONS.length}) and guide (${GUIDES.length}) is a node with a real <a href>, once`,
    [...lessonHrefs, ...GUIDES].every((h) => hrefs.filter((x) => x === h).length === 1) && hrefs.every((h) => h !== null) && nodes.length === new Set([...lessonHrefs, ...GUIDES]).size);
  // 2. Title only; the "?" a closed <details> with the description in the HTML.
  want("each node is its title, then a closed '?' <details> holding its short description", nodes.length > 0 && nodes.every((n) => {
    const l = ALL_LESSONS.find((x) => n.body.includes(`href="/learn/${encodeURIComponent(x.slug)}"`) && !GUIDES.includes(`/learn/${x.slug}`));
    const ok = /^<a href="[^"]+" class="lmLink">[^<]+<\/a><details class="lmQ"><summary aria-label="[^"]+" title="What is this\?">\?<\/summary><p class="lmTip">[^<]{20,}<\/p><\/details>$/.test(n.body);
    return ok && (!l || (n.body.includes(`>${esc(l.title)}</a>`) && n.body.includes(`<p class="lmTip">${esc(l.summary)}</p>`)));
  }) && !/<details class="lmQ"[^>]*\sopen/.test(map));
  // 3. The lanes in order; the steps 1..N along the path.
  const lanes = [...map.matchAll(/<li class="lmLane" data-lane="([a-z]+)"/g)].map((m) => m[1]);
  want("the lanes are the existing sections, in order", lanes.join() === LANES.join());
  want("the path's steps run 1..N in reading order", nodes.every((n, i) => n.step === i + 1));
  // 4. No wall of cards.
  want("the old wall of cards is gone", !/minmax\(240px, ?1fr\)/.test(html) && !/>BASICS<|>INDICATORS<|>IN-DEPTH GUIDES</.test(html));
  // 5. One vertical path on a phone.
  want("on a phone the lanes become one vertical path", /@media\(max-width:640px\)\{\s*\.lmNodes\{display:grid;gap:8px;\}/.test(css) && /\.lmLanes::before\{content:"";position:absolute;left:6px;/.test(css));
  return fails;
}

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const mapSrc = read(MAP), pageSrc = read(PAGE);
const real = rules(await render(mapSrc, pageSrc));
check("the /learn map passes every rule", real.length === 0, real.join("; "));

for (const [label, file, from, to] of [
  ["a node not a link", MAP, '<Link href={n.href} className="lmLink">{n.title}</Link>', '<span className="lmLink">{n.title}</span>'],
  ["the description dropped from the HTML", MAP, '<p className="lmTip">{n.summary}</p>', ""],
  ["the description open on arrival", MAP, '<details className="lmQ">', '<details className="lmQ" open>'],
  ["a node shows its description up front", MAP, '<Link href={n.href} className="lmLink">{n.title}</Link>', '<Link href={n.href} className="lmLink">{n.title}</Link><span>{n.summary}</span>'],
  ["a section's lessons dropped", MAP, 'nodes: lessons("Divergencies") }', "nodes: [] }"],
  ["a guide dropped", MAP, '  { href: "/risk-reward-ratio",', '  // { href: "/risk-reward-ratio",'],
  ["the lanes out of order", MAP, '    { id: "basics", label: "Basics", tone: "#93c5fd", nodes: lessons("Basics") },\n    { id: "indicators", label: "Indicators", tone: "#d8b4fe", nodes: lessons("Indicators") },', '    { id: "indicators", label: "Indicators", tone: "#d8b4fe", nodes: lessons("Indicators") },\n    { id: "basics", label: "Basics", tone: "#93c5fd", nodes: lessons("Basics") },'],
  ["no vertical path on a phone", MAP, "@media(max-width:640px){\n.lmNodes{display:grid;gap:8px;}", "@media(max-width:1px){\n.lmNodes{display:grid;gap:8px;}"],
  ["the map not on the page", PAGE, "<LearnMap />", "{null}"],
]) {
  const src = file === MAP ? mapSrc : pageSrc;
  if (!src.includes(from)) { check(`mutant "${label}" applies`, false, "matched nothing"); continue; }
  const m = src.replace(from, to);
  let f;
  try { f = rules(file === MAP ? await render(m, pageSrc) : await render(mapSrc, m)); } catch (e) { f = [`threw: ${e.message}`]; }
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}
console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
