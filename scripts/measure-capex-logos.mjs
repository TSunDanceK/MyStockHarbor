// THE CAPEX SIDEBAR'S COMPANY CARDS WITH LOGOS (#563 COWORK #130), IN CHROMIUM.
//
// "Who is spending most" and "Who is receiving most" with the company logo
// beside each ticker (app/bottlenecks/capex/CapexLogoRow.tsx), against the same
// rows as they were drawn before (ticker, name and amount only, rebuilt below
// from the pre-#130 markup), under the page's own stylesheet, at 320, 390 and
// 430 px with 16 and 20 px roots. The rows are stand-ins with the names the
// page would show (the snapshot names; the stored record is in Redis). Fails
// when:
//   - at 390 px (the ruled width), a row's ticker-and-name line wraps where it
//     did not wrap before (at 320 and 430 px a long name taking one more line
//     is printed as a note);
//   - the amount leaves the right edge, or is not on the ticker's line;
//   - a logo (or its letter) is missing, or not centred on the ticker line;
//   - the page scrolls sideways.
// A mutant (a 60 px logo) must be caught.
//
//   node scripts/measure-capex-logos.mjs [--shots DIR]
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
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { default: Receiving } = await import("../app/bottlenecks/capex/WhoIsReceivingMost.tsx");
const { default: Row } = await import("../app/bottlenecks/capex/CapexLogoRow.tsx");
const { snapshotCompanyName } = await import("../lib/server/companyNameSnapshot.ts");
const { normaliseCompanyName } = await import("../lib/server/news/companyName.ts");
const h = React.createElement;
const name = (t) => normaliseCompanyName(snapshotCompanyName(t)) || t;

const SPEND = [["MSFT", "$88.2bn"], ["AMZN", "$83.0bn"], ["GOOGL", "$52.5bn"], ["META", "$39.2bn"], ["ORCL", "$21.2bn"]].map(([ticker, amount]) => ({ ticker, name: name(ticker), amount }));
const RECV = [["NVDA", "Data Center", "$194bn"], ["HPE", "Server", "$17.6bn"], ["INTC", "DCAI — Datacenter and AI", "$16.9bn"], ["AMD", "Datacenter", "$16.6bn"], ["MU", "CMBU", "$13.5bn"]]
  .map(([ticker, line, amount]) => ({ id: ticker, ticker, name: name(ticker), line, fyTo: "FY to Dec 2025", amount, stale: false }));

const spendingCard = (rows) => h("section", { className: "capexCard" }, h("div", { className: "cardEyebrow" }, "Who is spending most"), h("h3", null, "Largest reported capex, 2025"),
  h("ul", { className: "cardList" }, rows));
const NEW = renderToStaticMarkup(h("aside", { className: "capexSide" },
  spendingCard(SPEND.map((t) => h(Row, { key: t.ticker, ticker: t.ticker, name: t.name, amount: t.amount }))),
  h(Receiving, { rows: RECV })));
// The rows as drawn before #130, for the wrap comparison.
const OLD = renderToStaticMarkup(h("aside", { className: "capexSide" },
  spendingCard(SPEND.map((t) => h("li", { key: t.ticker }, h("span", null, h("a", { href: "#" }, t.ticker), h("span", { className: "cardName" }, t.name)), h("span", { className: "cardAmt" }, t.amount)))),
  h("section", { className: "capexCard capexReceivingMost" }, h("ul", { className: "cardList" }, RECV.map((r) => h("li", { key: r.id, style: { fontSize: "var(--fs-read)" } },
    h("span", { style: { minWidth: 0 } }, h("a", { href: "#" }, r.ticker), h("span", { className: "cardName", style: { fontSize: "var(--fs-label)" } }, r.name),
      h("span", { style: { display: "block", marginTop: 2, fontSize: "var(--fs-label)" } }, `${r.line} · ${r.fyTo}`)), h("span", { className: "cardAmt" }, r.amount)))))));

const pageSrc = fs.readFileSync("app/bottlenecks/capex/page.tsx", "utf8");
const pageCss = /<style>\{`([\s\S]*?)`\}<\/style>/.exec(pageSrc)[1];
const CSS = fs.readFileSync("app/globals.css", "utf8").replace(/@import[^;]*;|@tailwind[^;]*;|@theme inline \{[^}]*\}/g, "");
const doc = (body, root, extra = "") => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style><style>${pageCss}</style><style>html{font-size:${root}px}body{margin:0;background:#06080d;color:#f1f5f9;font-family:system-ui,sans-serif}main{padding:16px}${extra}</style></head><body><main>${body}</main></body></html>`;

/** Per row: how many lines the ticker-and-name text takes, the amount's place, the logo's centre against the ticker's. */
function rows() {
  // The ticker-and-name line's line boxes: the ticker's and the name's text rects, grouped where they overlap vertically.
  const lines = (els) => {
    const rects = els.flatMap((el) => { const r = document.createRange(); r.selectNodeContents(el); return [...r.getClientRects()].filter((x) => x.width > 0); }).sort((a, b) => a.top - b.top);
    const rows = [];
    for (const x of rects) { const last = rows.at(-1); if (last && x.top < last.bottom - Math.min(x.height, last.bottom - last.top) / 2) last.bottom = Math.max(last.bottom, x.bottom); else rows.push({ top: x.top, bottom: x.bottom }); }
    return rows.length;
  };
  return [...document.querySelectorAll(".cardList li")].map((li) => {
    const a = li.querySelector("a"), amt = li.querySelector(".cardAmt"), logo = li.firstElementChild?.matches("a, span") ? null : li.firstElementChild;
    const A = a.getBoundingClientRect(), M = amt.getBoundingClientRect(), L = logo?.getBoundingClientRect(), LI = li.getBoundingClientRect();
    return { t: a.textContent, lines: lines([a, li.querySelector(".cardName")]), amtRight: LI.right - M.right, amtLine: Math.abs((M.top + M.bottom) / 2 - (A.top + A.bottom) / 2), logo: !!logo && (logo.querySelector("img") || /^[A-Z?]$/.test(logo.textContent.trim())) ? true : false, logoOff: L ? Math.abs((L.top + L.bottom) / 2 - (A.top + A.bottom) / 2) : null };
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
let failures = 0;
const fail = (m) => { console.log(`    FAIL ${m}`); failures++; };
const note = (m) => console.log(`    note ${m}`);
const run = async (width, root, body, extra = "") => {
  const page = await browser.newPage({ viewport: { width, height: 1200 } });
  // Logos are served from public/logos as the site serves them; nothing else reaches the network.
  await page.route("**/*", (r) => {
    const url = r.request().url();
    if (url === "http://capex.test/") return r.fulfill({ body: doc(body, root, extra), contentType: "text/html" });
    const m = url.match(/\/logos\/([^/?#]+\.webp)$/), file = m && path.join("public/logos", decodeURIComponent(m[1]));
    return file && fs.existsSync(file) ? r.fulfill({ path: file, contentType: "image/webp" }) : r.abort();
  });
  await page.goto("http://capex.test/");
  await page.waitForLoadState("networkidle").catch(() => {});
  const out = { rows: await page.evaluate(rows), sideways: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) };
  return { page, ...out };
};
for (const root of [16, 20]) {
  for (const width of [320, 390, 430]) {
    const before = await run(width, root, OLD), after = await run(width, root, NEW);
    await before.page.close();
    console.log(`${width}px @ ${root}px root: ${after.rows.map((r, i) => `${r.t} ${before.rows[i].lines}→${r.lines} line${r.lines === 1 ? "" : "s"}`).join(" · ")}`);
    if (after.sideways) fail("the page scrolls sideways");
    after.rows.forEach((r, i) => {
      // The ruled width is 390 px (#130); elsewhere a long name taking one more line is reported, not failed.
      if (r.lines > before.rows[i].lines) (width === 390 ? fail : note)(`${r.t}: its ticker line wraps (${before.rows[i].lines} → ${r.lines})`);
      if (!r.logo) fail(`${r.t}: no logo and no letter`);
      if (r.logoOff === null || r.logoOff > 1.5) fail(`${r.t}: the logo is ${r.logoOff?.toFixed(1)} px off the ticker line's centre`);
      if (r.amtRight > 0.5) fail(`${r.t}: the amount is ${r.amtRight.toFixed(1)} px short of the right edge`);
      if (r.amtLine > 1.5) fail(`${r.t}: the amount is ${r.amtLine.toFixed(1)} px off the ticker line`);
    });
    if (SHOTS && root === 16) { fs.mkdirSync(SHOTS, { recursive: true }); await after.page.locator(".capexSide").screenshot({ path: path.join(SHOTS, `capex-logos-${width}.png`) }); }
    await after.page.close();
  }
}
// THE MUTANT: a 60 px logo pushes the ticker line off its centre.
{
  const m = await run(390, 16, NEW, ".capexLogoRow > div:first-child{width:60px!important;height:60px!important}");
  const caught = m.rows.some((r) => r.logoOff === null || r.logoOff > 1.5);
  console.log(`mutant (a 60 px logo): ${caught ? "caught" : "NOT CAUGHT"}`);
  if (!caught) failures++;
  await m.page.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
