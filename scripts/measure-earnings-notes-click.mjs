// EVERY NOTE ON THE EARNINGS PAGE OPENS ON A REAL CLICK (#552 COWORK #126).
//
// check-earnings-glance proves every dotted value CARRIES a note; this proves
// each one OPENS. The SEC cards are bundled with their client code (esbuild),
// hydrated in Chromium from a committed fixture with the page's own <style>
// block, and every note trigger (role="button" with a data-estimate-note) is
// clicked with the mouse at its centre. Passing means aria-expanded="true" and
// a role="tooltip" on screen, and still so after a scroll event lands on the
// next frame (AVAV's "Loss both periods" opened and shut at once: a settling
// scroll hit the old close-on-scroll listener).
//
//   FIXTURES=AVAV,ONDS node scripts/measure-earnings-notes-click.mjs   # widths 1280 1024 768 375 360
//
// NOT IN check-all: it needs Chromium, Playwright and esbuild (installed
// globally in the sandbox, or ESBUILD_DIR=<a folder whose node_modules holds
// esbuild>), none of them dependencies. check-estimates holds the static rule
// (follow on scroll, close only off screen) and its mutant. Exit 1 on any
// note that does not open.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const FIXTURES = (process.env.FIXTURES || "AVAV,ONDS,AAPL,KGC,WKHS,AZN").split(",").map((s) => s.trim().toUpperCase());
const WIDTHS = (process.env.WIDTHS || "1280,1024,768,375,360").split(",").map(Number);
const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();

function requireFrom(dirs, name) {
  for (const d of dirs.filter(Boolean)) {
    try { return createRequire(path.join(d, "noop.js"))(name); } catch { /* next */ }
  }
  console.error(`${name} not found (looked in ${dirs.filter(Boolean).join(", ")}); install it globally or set ESBUILD_DIR.`);
  process.exit(2);
}
const esbuild = requireFrom([process.env.ESBUILD_DIR && path.join(process.env.ESBUILD_DIR, "node_modules"), path.join(ROOT, "node_modules"), globalRoot], "esbuild");
const { chromium } = requireFrom([globalRoot], "playwright");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "earnings-notes-"));
const PAGE = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
const cssAt = PAGE.indexOf("<style>{`"), cssEnd = PAGE.indexOf("`}</style>", cssAt);
if (cssAt < 0 || cssEnd < 0) { console.error("page.tsx <style> block not found"); process.exit(2); }
const CSS = PAGE.slice(cssAt + 9, cssEnd).replace(/\$\{[^}]*\}/g, "50");

/** The page's SEC cards for one fixture, as page.tsx lays them out. */
const entry = (sym) => `
import React from "react";
import { createRoot } from "react-dom/client";
import fixture from "@/data/sec/factset-fixture-${sym}.json";
import { buildSecEarningsView } from "@/lib/server/secEarningsView";
import { scoreFromSec, coverageOf } from "@/lib/server/secEarningsScore";
import { valuationInputs } from "@/lib/server/secValuation";
import * as C from "@/app/stock/[symbol]/earnings/SecEarningsCards";
const set = fixture as any;
const view = buildSecEarningsView(set);
const score = scoreFromSec(view, "${sym}", { status: "ready" } as any);
const year = view.tableBasis === "year";
function Page() {
  return (
    <main className="earningsPage"><div className="earningsWrap">
      <section className="hero"><div><h1>${sym}</h1></div><C.SecScoreCard symbol="${sym}" score={score} coverage={coverageOf(score)} /></section>
      <section className="contentGrid"><div style={{ display: "grid", gap: 18 }}>
        <C.SecSnapshotCard view={view} pending={null} />
        {year ? null : <C.SecGrowthMarginsCard view={view} />}
        <C.SecAnnualCard view={view} sole={year} />
        <C.SecTrendSummaryCard view={view} />
        <C.SecValuationCard view={view} inputs={valuationInputs(set, "2026-10-02")} price={10} priceAsOf="2026-10-02" today="2026-10-02" />
        <C.SecCashQualityCard view={view} />
        <C.SecBalanceSheetCard view={view} />
      </div><aside className="sideColumn"><C.SecIncomeStatementCard view={view} /><C.SecRecentPeriodsCard view={view} /></aside></section>
    </div></main>
  );
}
createRoot(document.getElementById("root")!).render(<Page />);
`;

const browser = await chromium.launch();
let bad = 0;
for (const sym of FIXTURES) {
  const src = path.join(work, `entry-${sym}.tsx`);
  fs.writeFileSync(src, entry(sym));
  await esbuild.build({
    entryPoints: [src], bundle: true, outfile: path.join(work, `${sym}.js`), platform: "browser", format: "iife",
    jsx: "automatic", alias: { "@": ROOT }, nodePaths: [path.join(ROOT, "node_modules")], loader: { ".json": "json" },
    define: { "process.env.NODE_ENV": '"production"' }, banner: { js: "var process={env:{}};" }, logLevel: "error",
  });
  const htmlFile = path.join(work, `${sym}.html`);
  fs.writeFileSync(htmlFile, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head><body style="margin:0;background:#06080d;color:#e2e8f0"><div id="root"></div><script src="${sym}.js"></script></body></html>`);

  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`file://${htmlFile}`);
    await page.waitForSelector(".card", { state: "attached" });
    // The fine print's notes count too: open every <details> first.
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => d.setAttribute("open", "")));
    const triggers = page.locator('[role="button"][data-estimate-note]');
    const n = await triggers.count();
    const failed = [];
    let clicked = 0;
    for (let i = 0; i < n; i++) {
      const t = triggers.nth(i);
      if (!(await t.isVisible())) continue;
      clicked++;
      await t.scrollIntoViewIfNeeded();
      const box = await t.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.mouse.click(box.x, box.y);
      // A scroll on the next frame, as a settling page sends one.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => { window.dispatchEvent(new Event("scroll")); requestAnimationFrame(() => r()); })));
      const exp = await t.getAttribute("aria-expanded");
      const tips = await page.locator('[role="tooltip"]').count();
      if (exp !== "true" || tips === 0) {
        const label = await t.evaluate((el) => `${(el.closest(".card,.scoreCard")?.querySelector("h2,h3,.eyebrow,.smallLabel")?.textContent || "?").trim().slice(0, 40)} | ${el.textContent}`);
        failed.push(`${label} (aria-expanded=${exp}, tooltips=${tips})`);
      }
      await page.mouse.click(1, 1);
    }
    if (clicked === 0) failed.push("no visible note triggers at all");
    console.log(`${sym} ${width}px: ${clicked} notes clicked, ${failed.length ? `${failed.length} did not open` : "all opened"}${errs.length ? `; page errors: ${errs.slice(0, 2).join(" | ")}` : ""}`);
    for (const f of failed) console.log(`   ${f}`);
    bad += failed.length + errs.length;
    await page.close();
  }
}
await browser.close();
fs.rmSync(work, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
