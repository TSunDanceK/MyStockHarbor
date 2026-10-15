// Browser run for the no-JS mobile menu (#553 COWORK #234). Not a check-*.mjs:
// it needs a running site, so check-all does not pick it up.
//
//   BASE_URL=http://localhost:3000 node scripts/verify-mobile-menu-nojs.mjs
//   ENGINE=webkit BASE_URL=https://<preview> node scripts/verify-mobile-menu-nojs.mjs
//
// ENGINE is chromium (default) or webkit (needs `npx playwright install webkit`).
// At 390px with JavaScript OFF: the menu is closed, the hamburger opens it, its
// top-level items are there, a group expands, the close control shuts it, and a
// link navigates. Then JavaScript ON: the hamburger opens the drill-down
// overlay and the static menu stays hidden.
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

// Playwright is not a dependency of the site: use the project's if there is one, else the global install.
function loadPlaywright() {
  for (const from of [import.meta.url, `file://${execSync("npm root -g").toString().trim()}/`]) {
    try { return createRequire(from)("playwright"); } catch { /* try the next */ }
  }
  throw new Error("playwright not found: run `npm i -g playwright` (and `npx playwright install webkit` for ENGINE=webkit)");
}
const { chromium, webkit } = loadPlaywright();

const base = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const engine = process.env.ENGINE === "webkit" ? webkit : chromium;
const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } : {};
const browser = await engine.launch(launch);

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const shown = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0; }, sel);

console.log(`\nJavaScript OFF (${process.env.ENGINE ?? "chromium"}, 390px)`);
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const p = await ctx.newPage();
  await p.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
  check("menu starts closed", !(await shown(p, ".mshStaticMenu")));
  await p.click(".mshMobileMenuButton");
  check("tapping the hamburger opens the menu", await shown(p, ".mshStaticMenu"));
  const tops = await p.$$eval(".mshStaticMenu .mshMobileOverlayNav > a, .mshStaticMenu .mshMobileOverlayNav > details > summary", (els) => els.map((e) => e.textContent.trim()));
  check("the top-level items are there", tops.length >= 8, tops.join(", "));
  await p.click(".mshStaticMenu details > summary");
  check("a group expands and shows links", (await p.$$eval(".mshStaticMenu details[open] a", (a) => a.length)) > 0);
  await p.click(".mshStaticMenu .mshMobileOverlayClose");
  check("the close control shuts it", !(await shown(p, ".mshStaticMenu")));
  await p.click(".mshMobileMenuButton");
  await p.click(".mshStaticMenu .mshMobileOverlayNav > a");
  await p.waitForLoadState("domcontentloaded");
  check("a link navigates", new URL(p.url()).pathname !== "/", new URL(p.url()).pathname);
  await ctx.close();
}

console.log("\nJavaScript ON");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "/", { waitUntil: "load", timeout: 120000 });
  await p.waitForTimeout(4000);
  await p.click(".mshMobileMenuButton");
  await p.waitForSelector('.mshMobileOverlay[role="dialog"]', { timeout: 5000 }).catch(() => {});
  check("the hamburger opens the drill-down overlay", !!(await p.$('.mshMobileOverlay[role="dialog"]')));
  check("the static menu stays hidden beside it", !(await shown(p, ".mshStaticMenu")));
  check("no page errors", errors.length === 0, errors.join("; "));
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nThe mobile menu opens in this browser.");
process.exit(failures ? 1 : 0);
