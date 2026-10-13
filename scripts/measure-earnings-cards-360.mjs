// THE EARNINGS CARDS AT PHONE WIDTH, MEASURED (#552 COWORK #97).
//
// Renders the page's SEC cards from a committed fixture with the page's own
// <style> block (scripts/earnings-page-render.mjs), adds the Next report card,
// loads the result in Chromium at each width and reports every card whose
// content is wider than the card: scrollWidth > clientWidth on the card, or a
// painted descendant whose right edge passes the card's.
//
//   FIXTURE=ONDS node scripts/measure-earnings-cards-360.mjs   # widths 320 360 375 430
//
// NOT IN check-all: it needs Chromium and Playwright (installed globally in
// the sandbox, not a dependency). check-earnings-cards holds the static rules
// and mutants; this is the rendered measurement behind them. Exit 1 on any
// overflow.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadNextReportCard, html, React } from "./lib/render-cards.mjs";

const SYM = (process.env.FIXTURE || "ONDS").toUpperCase();
const OUT = path.resolve(process.env.OUT || `/tmp/earnings-360-${SYM}.html`);
execFileSync(process.execPath, ["scripts/earnings-page-render.mjs"], { env: { ...process.env, FIXTURE: SYM, OUT }, stdio: "ignore" });

// THE NEXT REPORT CARD, from an outlook shaped as symbolOutlook composes it.
const { NextReportCard } = await loadNextReportCard();
const outlook = {
  symbol: SYM, kind: "beyond-window",
  headline: `${SYM} is not expected to report in the next 30 days.`,
  hedge: "Estimated from this company's own filing history — not a confirmed date, and not announced by the company.",
  evidence: ["Usually reports about 45 days after a period ends (last 15 periods)", "Last reported 2026-08-13, for the period ending 2026-06-30"],
  window: { line: "Mid-November 2026", estimate: true },
};
const next = html(React.createElement(NextReportCard, { outlook }));
fs.writeFileSync(OUT, fs.readFileSync(OUT, "utf8").replace("</aside>", `${next}</aside>`));

const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const { chromium } = createRequire(path.join(globalRoot, "noop.js"))("playwright");
const browser = await chromium.launch();
let bad = 0;
for (const width of (process.env.WIDTHS || "320,360,375,430").split(",").map(Number)) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`file://${OUT}`);
  const found = await page.evaluate(() => {
    const out = [];
    for (const card of document.querySelectorAll(".card, .scoreCard")) {
      const c = card.getBoundingClientRect();
      const name = (card.querySelector(".eyebrow, h3, .smallLabel")?.textContent || card.className).trim().slice(0, 40);
      if (card.scrollWidth > card.clientWidth + 1) out.push(`${name}: scrollWidth ${card.scrollWidth} > clientWidth ${card.clientWidth}`);
      for (const el of card.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (!r.width || getComputedStyle(el).display === "none") continue;
        if (r.right > c.right + 1) { out.push(`${name}: <${el.tagName.toLowerCase()} class="${el.className}"> right ${Math.round(r.right)} > card ${Math.round(c.right)}`); break; }
      }
    }
    return { out, page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth };
  });
  const pageWide = found.page > found.view + 1;
  console.log(`${width}px: ${found.out.length ? `${found.out.length} overflowing` : "no card overflows"}${pageWide ? `; PAGE scrollWidth ${found.page} > ${found.view}` : ""}`);
  for (const l of found.out) console.log(`   ${l}`);
  bad += found.out.length + (pageWide ? 1 : 0);
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
