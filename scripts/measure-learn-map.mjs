// THE /learn MAP IN CHROMIUM (#563 COWORK #166 PR 3).
//
// Renders the real /learn page (server markup, the repo's render hooks) at 320,
// 390, 640, 768, 1024 and 1280 px, 16 and 20 px roots. It fails when:
//   - the page scrolls sideways, or a node or a "?" note runs past the viewport;
//   - at 640 px and under the path is not one vertical column (each lane's
//     nodes stacked, one per row, on one left edge);
//   - above 640 px no lane lays its nodes out along a row (no map, a list);
//   - a "?" does not open its note, or the open note is off screen, or its
//     text is under 16 px (it is reading text);
//   - a node is not a link (an <a href>), or its title wraps past two lines
//     (three on the narrowest phone column).
// With --shots DIR it saves 390 and 1280 px screenshots (one with a "?" open).
// A mutant (the phone column dropped) must be caught.
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
const html = renderToStaticMarkup(React.createElement(Page));

const CSS = fs.readFileSync("app/globals.css", "utf8").replace(/@import[^;]*;|@tailwind[^;]*;|@theme inline \{[^}]*\}/g, "");
const doc = (body, root) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style><style>html{font-size:${root}px}body{margin:0;background:#06080d;color:#f1f5f9;font-family:system-ui}</style></head><body>${body}</body></html>`;

function probe() {
  const bad = [];
  const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  if (document.documentElement.scrollWidth > innerWidth) bad.push(`scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth})`);
  const lanes = [...document.querySelectorAll(".lmLane")];
  if (lanes.length !== 6) bad.push(`${lanes.length} lanes`);
  let rowed = false;
  for (const lane of lanes) {
    const nodes = [...lane.querySelectorAll(":scope > .lmNodes > .lmNode")].filter(vis).map((n) => n.getBoundingClientRect());
    if (!nodes.length) { bad.push(`lane ${lane.dataset.lane} has no nodes`); continue; }
    if (nodes.some((r) => r.right > innerWidth + 1 || r.left < -1)) bad.push(`a node in ${lane.dataset.lane} runs past the viewport`);
    const tops = new Set(nodes.map((r) => Math.round(r.top)));
    if (innerWidth <= 640) {
      if (tops.size !== nodes.length || nodes.some((r) => Math.abs(r.left - nodes[0].left) > 1)) bad.push(`lane ${lane.dataset.lane} is not one vertical column at ${innerWidth}px`);
    } else if (tops.size < nodes.length) rowed = true;
  }
  if (innerWidth > 640 && !rowed) bad.push(`no lane lays its nodes along a row at ${innerWidth}px`);
  for (const a of document.querySelectorAll(".lmNode > .lmLink")) {
    if (a.tagName !== "A" || !a.getAttribute("href")) { bad.push("a node is not a link"); break; }
    const lh = parseFloat(getComputedStyle(a).lineHeight) || parseFloat(getComputedStyle(a).fontSize) * 1.3;
    // Two lines at most; three only on the narrowest phone column (320 px at a 20 px root).
    const maxLines = innerWidth <= 340 ? 3 : 2;
    if (a.getBoundingClientRect().height > lh * maxLines + 2) { bad.push(`a title wraps past ${maxLines} lines: ${a.textContent}`); break; }
  }
  return bad;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
let failures = 0;
async function run(body, width, root) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(doc(body, root));
  const bad = await page.evaluate(probe);
  // Open one "?" (the last node of the first lane, the one nearest the right edge) and check its note.
  await page.evaluate(() => {
    const qs = [...document.querySelectorAll(".lmLane")][0].querySelectorAll(".lmQ");
    qs[qs.length - 1].querySelector("summary").click();
  });
  await page.waitForTimeout(60);
  const tip = await page.evaluate(() => {
    const qs = [...document.querySelectorAll(".lmLane")][0].querySelectorAll(".lmQ");
    const q = qs[qs.length - 1], p = q.querySelector(".lmTip"), r = p.getBoundingClientRect();
    return { open: q.open, left: r.left, right: r.right, px: parseFloat(getComputedStyle(p).fontSize), visible: r.width > 0 && r.height > 0 };
  });
  if (!tip.open || !tip.visible) bad.push("a question-mark toggle does not open its note");
  else {
    if (tip.left < -1 || tip.right > width + 1) bad.push(`the open note runs off screen (${Math.round(tip.left)}–${Math.round(tip.right)})`);
    if (tip.px < 15.99 * (root / 16)) bad.push(`the note's text is ${tip.px}px`);
  }
  return { page, bad };
}
for (const root of [16, 20]) {
  for (const width of [320, 390, 640, 768, 1024, 1280]) {
    const { page, bad } = await run(html, width, root);
    if (bad.length) failures++;
    console.log(`${width}px @ ${root}px: ${bad.length ? `FAIL ${bad.join("; ")}` : "OK"}`);
    if (SHOTS && root === 16 && (width === 390 || width === 1280)) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `learn-map-${width}.png`), fullPage: true });
    }
    await page.close();
  }
}
{
  const body = html.replace("@media(max-width:640px){\n.lmNodes{display:grid;gap:8px;}", "@media(max-width:1px){\n.lmNodes{display:grid;gap:8px;}");
  if (body === html) { console.log("mutant (the phone column dropped): DOES NOT APPLY"); failures++; }
  else {
    const { page, bad } = await run(body, 390, 16);
    const caught = bad.some((b) => /not one vertical column/.test(b));
    console.log(`mutant (the phone column dropped): ${caught ? "caught" : "NOT CAUGHT"}`);
    if (!caught) failures++;
    await page.close();
  }
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
