// THE /learn SPIDER MAP IN CHROMIUM (#563 COWORK #169).
//
// Renders the real /learn page (server markup, the repo's render hooks) at 320,
// 390, 640, 768, 1024 and 1280 px, 16 and 20 px roots. It fails when:
//   - the page scrolls sideways, a node runs past the viewport, two nodes
//     overlap, or a title is cut short (clamped);
//   - where the map is wide enough, the six sections are not split three and
//     three either side of the hub, or the wires don't meet their nodes;
//   - hovering a lesson does not pop it (about 1.08×, a glow), show its card,
//     brighten its wire and dim the rest (about 40%), or keyboard focus does not
//     do the same; hovering a section does not light its whole branch;
//   - with reduced motion, a pop still scales or a wire still animates;
//   - on touch (no hover), the first tap on a lesson navigates instead of
//     popping it, or the second tap does not open it.
// With --shots DIR it saves 390 and 1280 px screenshots and a hovered branch.
// Each behaviour has a mutant that must be caught.
//
//   node scripts/measure-learn-map.mjs [--shots DIR]
//
// NOT IN check-all: it needs Chromium and Playwright.
import fs from "node:fs";
import path from "node:path";
import { createRequire, register } from "node:module";

const SHOTS = (() => { const i = process.argv.indexOf("--shots"); return i > 0 ? path.resolve(process.argv[i + 1]) : null; })();
register("./lib/tsx-render-hooks.mjs", import.meta.url);
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const { renderToStaticMarkup } = await import("react-dom/server");
const React = await import("react");
const { default: Page } = await import("../app/learn/page.tsx");
const HTML = renderToStaticMarkup(React.createElement(Page));

const CSS = fs.readFileSync("app/globals.css", "utf8").replace(/@import[^;]*;|@tailwind[^;]*;|@theme inline \{[^}]*\}/g, "");
const doc = (body, root) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style><style>html{font-size:${root}px}body{margin:0;background:#06080d;color:#f1f5f9;font-family:system-ui}</style></head><body>${body}</body></html>`;

/** Layout: sideways scroll, overlaps, clamped titles, the wide split, wires meeting nodes. */
function layout() {
  const bad = [];
  const vis = (el) => el.getClientRects().length > 0;
  if (document.documentElement.scrollWidth > innerWidth) bad.push(`scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth})`);
  const nodes = [...document.querySelectorAll(".lmMap .lmNode, .lmHub")].filter(vis);
  const rs = nodes.map((n) => n.getBoundingClientRect());
  if (rs.some((r) => r.right > innerWidth + 1 || r.left < -1)) bad.push("a node runs past the viewport");
  for (let i = 0; i < rs.length && bad.length < 4; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) { bad.push(`nodes overlap: "${nodes[i].textContent.slice(0, 24)}" / "${nodes[j].textContent.slice(0, 24)}"`); break; }
  }
  const cut = [...document.querySelectorAll(".lmTitle")].find((t) => t.scrollHeight > t.clientHeight + 1);
  if (cut) bad.push(`a title is cut short: "${cut.textContent}"`);
  const wide = getComputedStyle(document.querySelector(".lmMap")).display === "grid";
  if (wide) {
    const hub = document.querySelector(".lmHub").getBoundingClientRect(), mid = hub.left + hub.width / 2;
    const secs = [...document.querySelectorAll(".lmSection")].map((s) => s.getBoundingClientRect());
    const leftN = secs.filter((s) => s.right <= hub.left).length, rightN = secs.filter((s) => s.left >= hub.right).length;
    if (leftN !== 3 || rightN !== 3) bad.push(`sections ${leftN} left / ${rightN} right of the hub`);
    // Each branch wire ends on its leaf's middle, and starts at its section's middle.
    for (const g of document.querySelectorAll(".lmGroup")) {
      const s = g.querySelector(".lmSection").getBoundingClientRect(), sy = s.top + s.height / 2;
      const svg = g.querySelector(".lmBranchWires"), sb = svg.getBoundingClientRect(), k = sb.height / svg.viewBox.baseVal.height;
      const leaves = [...g.querySelectorAll(".lmLeaf")].map((l) => l.getBoundingClientRect());
      [...svg.querySelectorAll(".lmWire")].forEach((p, i) => {
        const a = p.getPointAtLength(0), z = p.getPointAtLength(p.getTotalLength());
        const ly = leaves[i].top + leaves[i].height / 2;
        if (Math.abs(sb.top + a.y * k - sy) > 2 || Math.abs(sb.top + z.y * k - ly) > 2) bad.push(`a wire misses its node in ${g.dataset.lane}`);
      });
    }
    void mid;
  }
  return [...new Set(bad)].slice(0, 6);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
let failures = 0;
const open = async (html, width, root, opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const navs = [];
  await page.route("**/*", (r) => {
    const u = r.request().url();
    if (u === "http://learn.test/learn") return r.fulfill({ body: doc(html, root), contentType: "text/html" });
    if (r.request().isNavigationRequest()) navs.push(u);
    return r.fulfill({ body: "<!doctype html><title>lesson</title>", contentType: "text/html" });
  });
  await page.goto("http://learn.test/learn");
  await page.waitForTimeout(950); // let the wires finish drawing
  return { ctx, page, navs };
};
const state = (page) => page.evaluate(() => {
  const leaf = document.querySelector('.lmGroup[data-lane="indicators"] .lmLeaf[data-i="2"]');
  const other = document.querySelector('.lmGroup[data-lane="risk"] .lmLeaf[data-i="0"]');
  const wire = document.querySelector('.lmGroup[data-lane="indicators"] .lmWire[data-i="2"]');
  const card = leaf.querySelector(".lmCard");
  const m = getComputedStyle(leaf).transform.match(/matrix\(([-\d.]+)/);
  return { scale: m ? +m[1] : 1, glow: getComputedStyle(leaf).boxShadow !== "none", card: getComputedStyle(card).visibility === "visible", dim: +getComputedStyle(other).opacity, wire: +getComputedStyle(wire).opacity, anim: getComputedStyle(wire).animationName };
});
/** Hover, focus and section behaviour; returns failures. */
async function behaviour(html, width, reduced = false) {
  const bad = [];
  const { ctx, page } = await open(html, width, 16, reduced ? { reducedMotion: "reduce" } : {});
  const leaf = page.locator('.lmGroup[data-lane="indicators"] .lmLeaf[data-i="2"]');
  await leaf.hover(); await page.waitForTimeout(250);
  const h = await state(page);
  if (reduced) {
    if (Math.abs(h.scale - 1) > 0.001) bad.push(`reduced motion still scales (${h.scale})`);
    if (h.anim !== "none") bad.push("reduced motion still draws the wires");
    if (!h.card || h.dim > 0.45) bad.push("reduced motion loses the highlight");
  } else {
    if (Math.abs(h.scale - 1.08) > 0.01 || !h.glow) bad.push(`hover does not pop the lesson (scale ${h.scale})`);
    if (!h.card) bad.push("hover does not show the card");
    if (h.dim > 0.45) bad.push(`hover does not dim the rest (opacity ${h.dim})`);
    if (h.wire < 0.99) bad.push("hover does not brighten the lesson's wire");
  }
  // Keyboard: tab to the same leaf.
  await page.mouse.move(1, 1); await page.locator("body").click({ position: { x: 1, y: 1 } });
  for (let k = 0; k < 80; k++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.matches('.lmGroup[data-lane="indicators"] .lmLeaf[data-i="2"]'))) break;
  }
  await page.waitForTimeout(250);
  const f = await state(page);
  if (!reduced && (Math.abs(f.scale - 1.08) > 0.01 || !f.card || f.dim > 0.45)) bad.push(`keyboard focus does not pop the lesson (scale ${f.scale}, card ${f.card})`);
  // A section lights its whole branch.
  await page.locator('.lmGroup[data-lane="risk"] .lmSection').hover(); await page.waitForTimeout(250);
  const b = await page.evaluate(() => ({ branch: Math.min(...[...document.querySelectorAll('.lmGroup[data-lane="risk"] .lmNode')].map((n) => +getComputedStyle(n).opacity)), other: +getComputedStyle(document.querySelector('.lmGroup[data-lane="basics"] .lmLeaf')).opacity }));
  if (b.branch < 0.99 || b.other > 0.45) bad.push(`a section does not light its branch (${b.branch} / ${b.other})`);
  await ctx.close();
  return bad;
}
/** Touch: the first tap pops, the second opens. */
async function touch(html) {
  const { ctx, page, navs } = await open(html, 390, 16, { hasTouch: true, isMobile: true });
  const href = await page.locator(".lmLeaf").first().getAttribute("href");
  const bad = [];
  await page.locator(".lmLeaf").first().tap(); await page.waitForTimeout(300);
  if (navs.length) { bad.push("the first tap navigated instead of popping the lesson"); await ctx.close(); return bad; }
  const first = await page.evaluate(() => ({ active: document.querySelector(".lmLeaf").classList.contains("is-active"), card: getComputedStyle(document.querySelector(".lmLeaf .lmCard")).visibility }));
  if (!first.active || first.card !== "visible") bad.push("the first tap did not pop the lesson");
  await page.locator(".lmLeaf").first().tap(); await page.waitForTimeout(400);
  if (!navs.some((u) => u.endsWith(href))) bad.push("the second tap did not open the lesson");
  await ctx.close();
  return bad;
}

for (const root of [16, 20]) {
  for (const width of [320, 390, 640, 768, 1024, 1280]) {
    const { ctx, page } = await open(HTML, width, root);
    const bad = await page.evaluate(layout);
    if (bad.length) failures++;
    console.log(`${width}px @ ${root}px: ${bad.length ? `FAIL ${bad.join("; ")}` : "OK"}`);
    if (SHOTS && root === 16 && (width === 390 || width === 1280)) { fs.mkdirSync(SHOTS, { recursive: true }); await page.locator(".lmWrap").screenshot({ path: path.join(SHOTS, `learn-map-${width}.png`) }); }
    await ctx.close();
  }
}
for (const width of [390, 1280]) {
  const b = await behaviour(HTML, width), r = await behaviour(HTML, width, true);
  if (b.length || r.length) failures++;
  console.log(`hover / focus / branch at ${width}px: ${b.length ? `FAIL ${b.join("; ")}` : "OK"}; reduced motion: ${r.length ? `FAIL ${r.join("; ")}` : "OK"}`);
}
{
  const t = await touch(HTML);
  if (t.length) failures++;
  console.log(`touch (first tap pops, second opens): ${t.length ? `FAIL ${t.join("; ")}` : "OK"}`);
}
if (SHOTS) {
  // A tall viewport so nothing scrolls (a scroll would move the pointer off the hovered node).
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 2200 } });
  const page = await ctx.newPage();
  await page.route("**/*", (r) => r.request().url() === "http://learn.test/learn" ? r.fulfill({ body: doc(HTML, 16), contentType: "text/html" }) : r.fulfill({ body: "" }));
  await page.goto("http://learn.test/learn"); await page.waitForTimeout(950);
  const clip = await page.evaluate(() => { const r = document.querySelector(".lmWrap").getBoundingClientRect(); return { x: r.left, y: r.top + scrollY, width: r.width, height: r.height }; });
  await page.locator('.lmGroup[data-lane="indicators"] .lmLeaf[data-i="3"]').hover(); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "learn-map-1280-hover.png"), clip });
  await page.locator('.lmGroup[data-lane="financial"] .lmSection').hover(); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "learn-map-1280-branch.png"), clip });
  await ctx.close();
}

// MUTANTS: each behaviour broken in turn must be caught.
const css = (h, from, to) => h.split(from).join(to);
for (const [label, mutate, run, pat] of [
  ["no pop on hover", (h) => css(h, "transform:scale(1.08);", ""), () => behaviour, /does not pop/],
  ["no dimming", (h) => css(h, "{opacity:.4;}", "{opacity:1;}"), () => behaviour, /does not dim|does not light/],
  ["focus does not pop (hover only)", (h) => h.replace(/\.lmNode:focus-visible,/g, "").replace(/\.lmLeaf:focus-visible,/g, ""), () => behaviour, /keyboard focus/],
  ["reduced motion ignored", (h) => css(h, "@media (prefers-reduced-motion:reduce){", "@media (max-width:1px){"), () => (x, w) => behaviour(x, w, true), /reduced motion/],
  ["leaves overlap (rows too short)", (h) => css(h, ".lmLeaf{height:2.75rem;min-height:0;", ".lmLeaf{height:3.5rem;min-height:0;"), () => null, /overlap|misses/],
  ["the touch script dropped", (h) => h.replace(/<script>[\s\S]*?<\/script>/, ""), () => touch, /first tap/],
]) {
  const m = mutate(HTML);
  if (m === HTML) { console.log(`mutant (${label}): DOES NOT APPLY`); failures++; continue; }
  let bad;
  const fn = run();
  if (fn === null) { const { ctx, page } = await open(m, 1280, 16); bad = await page.evaluate(layout); await ctx.close(); }
  else bad = await fn(m, 1280);
  const caught = bad.some((b) => pat.test(b));
  console.log(`mutant (${label}): ${caught ? "caught" : `NOT CAUGHT (${bad.join("; ") || "no failure"})`}`);
  if (!caught) failures++;
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
