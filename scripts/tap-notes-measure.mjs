// THE TAP NOTES ON PRICE ZONES AND KEY LEVELS, CLICKED IN CHROMIUM
// (#563 COWORK #88 §3 / #89). Behaviour, not markup: the stock page's client is
// bundled for the browser with fixture bars, mounted, and tapped.
//
// The two cards are mounted where the stock page puts them (the 300 px sidebar
// above 900 px; full width inside the page's 20 px gutter below), not the whole
// page: the page's client imports server actions a browser bundle can't take.
//
// At 1280 px (desktop): a zone's count opens its note anchored below the label
// (or above, flipped), no wider than the card; a second tap elsewhere leaves one
// note open; Esc and a tap outside close it; Key levels' "What are these?" opens
// its note the same way (the pole has no row notes since #563 COWORK #115). At
// 320, 360, 390 and 430 px (phone): the note opens inline, the zone labels below
// it move down by its height and none overlaps it, the Key levels note pushes
// the pole down; nothing scrolls sideways, open or closed.
// Reports the two cards' heights at 1280×800. With an
// output directory, saves a 390 px and a 1280 px screenshot with a note open.
//
// NOT IN check-all: it needs a browser and esbuild (ESBUILD_BIN, or fetched by
// npx once), and the suite must run without either.
//
//   node scripts/tap-notes-measure.mjs [screenshot-dir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "msh-tapnotes-"));
fs.writeFileSync(path.join(tmp, "nav.js"), `const r={push(){},replace(){},prefetch(){},back(){},refresh(){}};export const useRouter=()=>r;export const usePathname=()=>"/stock/AAPL";export const useSearchParams=()=>new URLSearchParams();export const useParams=()=>({});export const notFound=()=>{};export const redirect=()=>{};`);
fs.writeFileSync(path.join(tmp, "link.js"), `import React from "react";export default React.forwardRef(function Link({href,prefetch,scroll,replace,...p},ref){return React.createElement("a",{...p,href:typeof href==="string"?href:"#",ref});});`);
const entry = "scripts/.tap-notes-entry.tsx", bundle = path.join(tmp, "bundle.js");
fs.writeFileSync(entry, `import React from "react";
import { createRoot } from "react-dom/client";
import ConfluenceCard from "@/app/stock/[symbol]/ConfluenceCard";
import KeyLevelsCard from "@/app/stock/[symbol]/KeyLevelsCard";
const p = (window as any).__PROPS__;
createRoot(document.getElementById("root")!).render(React.createElement(React.Fragment, null,
  React.createElement(ConfluenceCard, p), React.createElement(KeyLevelsCard, p)));
`);
const esbuild = process.env.ESBUILD_BIN;
try {
  const args = [entry, "--bundle", "--platform=browser", "--format=iife", "--jsx=automatic", "--alias:@=.", `--alias:next/navigation=${path.join(tmp, "nav.js")}`, `--alias:next/link=${path.join(tmp, "link.js")}`, '--define:process.env.NODE_ENV="production"', `--outfile=${bundle}`, "--log-level=error"];
  if (esbuild) execFileSync(esbuild, args, { stdio: "inherit" });
  else execFileSync("npx", ["--yes", "esbuild@0.24.2", ...args], { stdio: "inherit" });
} finally { fs.rmSync(entry, { force: true }); }

// Weekdays to Fri 2 Oct 2026: a wave on a drift, so zones fall on both sides of the price.
const bars = [];
for (let t = Date.parse("2025-06-02T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
  const d = new Date(t);
  if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
  const b = 200 + 30 * Math.sin(i / 17) + 15 * Math.sin(i / 5.3) + i * 0.1;
  bars.push({ date: d.toISOString().slice(0, 10), open: b, high: b + 3, low: b - 2.5, close: b + 0.8, volume: 4e7 });
  i++;
}
const sma = (n) => bars.slice(-n).reduce((a, b) => a + b.close, 0) / n;
const props = { bars, lastPrice: bars[bars.length - 1].close, nowMs: Date.parse("2026-10-04T12:00:00Z"), ma50: sma(50), ma200: sma(200), macro: null };
const css = fs.readFileSync("app/globals.css", "utf8").replace(/@tailwind[^;]*;|@import[^;]*;/g, "");
const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><style>.stock-wrap{max-width:1240px;margin:0 auto;padding:0 20px;box-sizing:border-box}#root{display:flex;flex-direction:column;gap:16px;width:300px}@media (max-width:900px){#root{width:auto}}body{margin:0;background:#06080d;color:#e2e8f0;font-family:system-ui,sans-serif}</style><div class="stock-wrap"><div id="root"></div></div><script>window.__PROPS__=${JSON.stringify(props)};</script><script>${fs.readFileSync(bundle, "utf8")}</script></body></html>`;

const shots = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let failures = 0;
const say = (ok, line) => { if (!ok) failures++; console.log(`${ok ? "OK  " : "FAIL"} ${line}`); };
const rect = (page, sel, i = 0) => page.evaluate(([s, k]) => { const e = document.querySelectorAll(s)[k]; if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, width: r.width, height: r.height }; }, [sel, i]);
const panels = (page) => page.evaluate(() => [...document.querySelectorAll(".tapNotePanel")].map((p) => ({ mode: p.dataset.mode, flipped: !!p.dataset.flipped })));
const scrolls = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

// ── desktop ─────────────────────────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(doc);
  await page.waitForSelector(".czCard .czLabel .tapNoteBtn");
  const card = await rect(page, ".czCard");
  console.log(`1280×800: Price zones card ${Math.round(card.height)} px (ladder ${Math.round((await rect(page, ".czLadder")).height)} px) · Key levels ${Math.round((await rect(page, ".klCard")).height)} px`);
  say(!(await scrolls(page)), "1280 px, notes closed: no sideways scroll");
  const n = await page.locator(".czLabel .tapNoteBtn").count();
  await page.locator(".czLabel .tapNoteBtn").nth(1).click();
  const p1 = await panels(page), pr = await rect(page, ".tapNotePanel"), lab = await rect(page, ".czLabel", 1);
  say(p1.length === 1 && p1[0].mode === "overlay", `zone note opens anchored (${p1.map((x) => x.mode).join(",")})`);
  say(pr && pr.left >= card.left - 0.5 && pr.right <= card.right + 0.5 && pr.width <= card.width, `…no wider than the card (${Math.round(pr?.width)} ≤ ${Math.round(card.width)} px)`);
  say(pr && (p1[0].flipped ? pr.bottom <= lab.top + 1 : pr.top >= lab.bottom - 1) && Math.min(Math.abs(pr.top - lab.bottom), Math.abs(lab.top - pr.bottom)) < 20, `…directly ${p1[0]?.flipped ? "above" : "below"} its label`);
  if (shots) await page.screenshot({ path: path.join(shots, "tap-note-1280.png"), clip: { x: card.left - 10, y: card.top - 10, width: card.width + 20, height: Math.max(card.height, pr.bottom - card.top) + 20 } });
  // The open note floats over the labels below it; the label above it is the one still tappable.
  await page.locator(".czLabel .tapNoteBtn").nth(0).click();
  const p1b = await panels(page);
  say(p1b.length === 1 && (await page.locator(".czLabel .tapNoteBtn").nth(0).getAttribute("aria-expanded")) === "true", `a second zone's count: its note open, the first closed (${n} zones)`);
  // The open zone note floats over the card below it (Key levels' title sits right under Price zones), so it closes first.
  await page.keyboard.press("Escape");
  await page.locator(".klCard .tapNoteBtn").first().click();
  const p2 = await panels(page), kr = await rect(page, ".tapNotePanel"), kc = await rect(page, ".klCard"), kh = await rect(page, ".klCard .tapNoteBtn");
  say(p2.length === 1 && kr.left >= kc.left - 0.5 && kr.right <= kc.right + 0.5 && (p2[0].flipped ? kr.bottom <= kh.top + 1 : kr.top >= kh.bottom - 1),
    `Key levels' "What are these?": its note, ${p2[0]?.flipped ? "above" : "below"} the title, inside the card`);
  await page.keyboard.press("Escape");
  say((await panels(page)).length === 0, "Esc closes it");
  await page.locator(".czLabel .tapNoteBtn").first().click();
  await page.mouse.click(5, 5);
  say((await panels(page)).length === 0, "a tap outside closes it");
  await page.locator(".klCard .tapNoteBtn").first().click();
  say((await panels(page)).length === 1, "a tap on Key levels' \"What are these?\" opens its note");
  await page.locator(".tapNoteClose").first().click();
  say((await panels(page)).length === 0, "✕ closes it");
  await page.close();
}

// ── phone ───────────────────────────────────────────────────────────────────
for (const width of [320, 360, 390, 430]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.setContent(doc);
  await page.waitForSelector(".czCard .czLabel .tapNoteBtn");
  say(!(await scrolls(page)), `${width} px, notes closed: no sideways scroll · ladder ${Math.round((await rect(page, ".czLadder")).height)} px`);
  const before = await rect(page, ".czLabel", 2);
  await page.locator(".czLabel .tapNoteBtn").nth(1).click();
  await page.waitForTimeout(50);
  const p = await panels(page), pr = await rect(page, ".tapNotePanel"), after = await rect(page, ".czLabel", 2), card = await rect(page, ".czCard"), own = await rect(page, ".czLabel", 1);
  say(p.length === 1 && p[0].mode === "inline" && pr.top >= own.bottom - 1 && pr.left >= card.left - 0.5 && pr.right <= card.right + 0.5,
    `${width} px: zone note inline under its label, inside the card`);
  say(after.top >= pr.bottom - 1 && after.top - before.top > pr.height - 1, `…the next label moved down ${Math.round(after.top - before.top)} px (note ${Math.round(pr.height)} px), not overlapped`);
  say(!(await scrolls(page)), `…no sideways scroll with it open`);
  if (shots && width === 390) await page.screenshot({ path: path.join(shots, "tap-note-390.png"), clip: { x: 0, y: card.top - 10, width, height: card.height + 20 } });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(50);
  const trackBefore = await rect(page, ".klPole");
  await page.locator(".czLabel .tapNoteBtn").first().click();
  await page.locator(".klCard .tapNoteBtn").first().click();
  await page.waitForTimeout(50);
  const kp = await panels(page), kr = await rect(page, ".tapNotePanel"), trackAfter = await rect(page, ".klPole");
  say(kp.length === 1 && kp[0].mode === "inline" && trackAfter.top >= kr.bottom - 1 && trackAfter.top > trackBefore.top, `${width} px: Key levels note inline, the pole pushed down; the zone note closed`);
  say(!(await scrolls(page)), `…no sideways scroll with it open`);
  await page.close();
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : "\nall OK");
process.exit(failures ? 1 : 0);
