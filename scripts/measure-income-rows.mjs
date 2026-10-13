// THE INCOME STATEMENT CARD'S ROWS, MEASURED FOR OVERLAP (#552 COWORK #137 §1).
//
// Renders the earnings page's SEC cards from a committed fixture with the
// page's own <style> (scripts/earnings-page-render.mjs), loads it in Chromium
// at each width, and reports any card row whose label and value boxes overlap.
//
//   FIXTURE=AAPL node scripts/measure-income-rows.mjs   # widths 320 360 375 430 1280
//
// NOT IN check-all: it needs Chromium and Playwright (installed globally).
// check-income-row-values holds the rule and its mutants.
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const SYM = (process.env.FIXTURE || "AAPL").toUpperCase();
const OUT = path.resolve(process.env.OUT || `/tmp/income-rows-${SYM}.html`);
execFileSync(process.execPath, ["scripts/earnings-page-render.mjs"], { env: { ...process.env, FIXTURE: SYM, OUT }, stdio: "ignore" });
const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const { chromium } = createRequire(path.join(globalRoot, "noop.js"))("playwright");
const browser = await chromium.launch();
let bad = 0;
for (const width of (process.env.WIDTHS || "320,360,375,430,1280").split(",").map(Number)) {
  const page = await browser.newPage({ viewport: { width, height: 1200 } });
  await page.goto(`file://${OUT}`);
  const found = await page.evaluate(() => {
    const out = [];
    let rows = 0;
    // A card row: a flex row of two, its value cell nowrap (SecEarningsCards' Row).
    for (const row of document.querySelectorAll(".card div")) {
      if (row.children.length !== 2) continue;
      const cs = getComputedStyle(row);
      const [label, value] = row.children;
      if (cs.display !== "flex" || cs.justifyContent !== "space-between" || getComputedStyle(value).whiteSpace !== "nowrap") continue;
      rows++;
      const a = label.getBoundingClientRect(), b = value.getBoundingClientRect();
      const overlap = a.right > b.left + 0.5 && a.left < b.right - 0.5 && a.bottom > b.top + 0.5 && a.top < b.bottom - 0.5;
      const card = row.closest(".card").getBoundingClientRect();
      if (overlap) out.push(`"${label.textContent.trim()}" overlaps "${value.textContent.trim()}"`);
      else if (b.right > card.right + 1) out.push(`"${label.textContent.trim()}": value runs past the card`);
    }
    return { out, rows };
  });
  console.log(`${SYM} ${width}px: ${found.rows} rows, ${found.out.length ? `${found.out.length} overlapping` : "none overlap"}`);
  for (const l of found.out) console.log(`   ${l}`);
  bad += found.out.length;
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
