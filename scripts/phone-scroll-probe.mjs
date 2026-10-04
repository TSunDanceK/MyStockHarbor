// THE STOCK PAGE ON PHONES, ON REAL TICKERS (#563 COWORK #87). Read-only.
//
// For AAPL, BRK-A and one sub-$5 stock from the Pickers universe, reads the
// Tiingo daily bars the stock page draws (msh:tiingo:eod:v2) and SPY's for the
// performance strip, renders main's own StockSymbolPageClient with them, and
// measures it in Chrome at 360 and 390 px: whether the page scrolls sideways,
// whether Price zones, Key levels or any reordered section (.sp-slot) runs past
// the viewport or overflows inside, and the sections' order.
//
// The earnings snapshot is a fixed "not read in" state and the profile a fixed
// description: they are not what this measures. Prices and bars come from the
// store; the quote is the latest close.
//
// READ-ONLY, ENFORCED: any Upstash command outside GET/MGET is refused before it
// is sent. PUBLIC LOG (#553): tickers, widths in px and pass/fail only. No price,
// bar or other Tiingo value is printed.
//
// Needs esbuild and playwright-core (installed into a temp dir on the runner) and
// a Chrome (the runner's /usr/bin/google-chrome). FIXTURE=1 runs it on synthetic
// bars with no Redis; ESBUILD_BIN / PW_MODULE / CHROME override the tools.
//
//   node scripts/phone-scroll-probe.mjs      (relay: write-phone-scroll-probe)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { register } from "node:module";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

const FIXTURE = process.env.FIXTURE === "1";
if (!FIXTURE && (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)) {
  console.error("FATAL: needs the Upstash credentials (write- relay job).");
  process.exit(2);
}
const UPSTASH = (process.env.UPSTASH_REDIS_REST_URL ?? "https://fixture.invalid").replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    for (const c of cmds) if (!["GET", "MGET"].includes(String(c?.[0] ?? "").toUpperCase())) throw new Error(`probe is read-only: refused ${c?.[0]}`);
    commands += cmds.length || 1;
  }
  return realFetch(input, init);
};

// ── the tools ───────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "msh-phone-"));
let esbuild = process.env.ESBUILD_BIN, pwModule = process.env.PW_MODULE;
if (!esbuild || !pwModule) {
  execFileSync("npm", ["i", "--silent", "--no-audit", "--no-fund", "--prefix", tmp, "esbuild@0.24.2", "playwright-core@1.48.2"], { stdio: "inherit" });
  esbuild ??= path.join(tmp, "node_modules/.bin/esbuild");
  pwModule ??= path.join(tmp, "node_modules/playwright-core");
}
const chrome = process.env.CHROME ?? (fs.existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
const require = createRequire(import.meta.url);
const { chromium } = require(pwModule);

// ── the bars ────────────────────────────────────────────────────────────────
const { tiingoEodKey } = await import("../lib/server/marketData/keys.ts");
const { eodBarsToPoints } = await import("../lib/server/marketData/pickerHistory.ts");
const { PICKERS_SYMBOLS_KEY } = await import("../lib/server/pickersBuilder.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");
const { performanceStrip } = await import("../lib/ta/performance.ts");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

function fixtureBars(level) {
  const out = [];
  for (let t = Date.parse("2024-10-01T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const b = level * (1 + 0.15 * Math.sin(i / 23) + 0.05 * Math.sin(i / 4.7) + i * 0.0003);
    out.push({ date: d.toISOString().slice(0, 10), open: b, high: b * 1.012, low: b * 0.988, close: b * 1.003, volume: 2e6 + (i % 9) * 1e5 });
    i++;
  }
  return out;
}
let redis = null;
const mget = async (keys) => { const out = []; for (let i = 0; i < keys.length; i += 25) out.push(...(await redis.mget(...keys.slice(i, i + 25)))); return out; };
const barsOf = (raw) => { const e = parse(raw); return e && Array.isArray(e.bars) ? eodBarsToPoints(e.bars) : []; };

let picks, spy;
if (FIXTURE) {
  picks = [["AAPL", fixtureBars(250)], ["BRK-A", fixtureBars(740_000)], ["SUB5", fixtureBars(3.2)]];
  spy = fixtureBars(560);
} else {
  redis = (await import("@upstash/redis")).Redis.fromEnv();
  const listed = parse(await redis.get(PICKERS_SYMBOLS_KEY));
  const universe = (Array.isArray(listed) ? listed : []).map((s) => String(s).trim().toUpperCase()).filter(Boolean).sort();
  const [aapl, brka, spyRaw] = await mget(["AAPL", "BRK.A", "SPY"].map((s) => tiingoEodKey(toDashed(s))));
  spy = barsOf(spyRaw);
  // The first sub-$5 stock (alphabetically) with a year of bars.
  let sub5 = null;
  const raws = await mget(universe.map((s) => tiingoEodKey(toDashed(s))));
  universe.forEach((s, i) => { if (sub5) return; const b = barsOf(raws[i]); if (b.length >= 250 && b[b.length - 1].close < 5) sub5 = [s, b]; });
  picks = [["AAPL", barsOf(aapl)], ["BRK-A", barsOf(brka)], ...(sub5 ? [sub5] : [])];
  console.log(`universe ${universe.length} · sub-$5 pick: ${sub5 ? sub5[0] : "none found"} · Redis commands ${commands}`);
}

// ── render main's page client with them ─────────────────────────────────────
const stub = path.join(tmp, "nav-stub.js");
fs.writeFileSync(stub, `const r={push(){},replace(){},prefetch(){},back(){},refresh(){}};exports.useRouter=()=>r;exports.usePathname=()=>"/stock/X";exports.useSearchParams=()=>new URLSearchParams();exports.useParams=()=>({});exports.notFound=()=>{throw new Error("notFound")};exports.redirect=()=>{throw new Error("redirect")};`);
const entry = "scripts/.phone-probe-entry.tsx", bundle = "scripts/.phone-probe-bundle.cjs";
fs.writeFileSync(entry, `import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StockSymbolPageClient from "@/app/stock/[symbol]/StockSymbolPageClient";
export function render(props: any) { return renderToStaticMarkup(React.createElement(StockSymbolPageClient as any, props)); }
`);
const pages = [];
try {
  execFileSync(esbuild, [entry, "--bundle", "--platform=node", "--format=cjs", "--jsx=automatic", "--alias:@=.", `--alias:next/navigation=${stub}`, `--outfile=${bundle}`, "--log-level=error", "--external:react", "--external:react-dom", "--external:next"], { stdio: "inherit" });
  const { render } = require(path.resolve(bundle));
  for (const [sym, bars] of picks) {
    if (bars.length < 60) { pages.push({ sym, html: null }); continue; }
    const last = bars[bars.length - 1];
    const avgVolume = bars.slice(-50).reduce((s, b) => s + (b.volume ?? 0), 0) / 50;
    const html = render({
      symbol: sym,
      earningsSnapshot: { symbol: sym, available: false, unavailableReason: "Filings not read in for this probe.", tone: "neutral", toneLabel: "Unavailable", rows: [], score: null },
      profile: { description: "A fixed company description for the layout probe. ".repeat(5), sector: "Sector", industry: "Industry", marketCap: 1e11, exchange: "NYSE", country: "US" },
      dividend: { state: "hidden", why: "none" },
      shareHistory: null,
      valuation: null,
      initialHistory: bars,
      initialQuote: { price: last.close, change: 0, changePercentage: 0, dayLow: last.low, dayHigh: last.high, volume: last.volume ?? 0, avgVolume },
      historyProvider: "tiingo",
      performance: performanceStrip(bars, spy),
      renderedAt: Date.now(),
    });
    pages.push({ sym, html });
  }
} finally {
  fs.rmSync(entry, { force: true });
  fs.rmSync(bundle, { force: true });
}

// ── measure in Chrome ───────────────────────────────────────────────────────
const css = fs.readFileSync("app/globals.css", "utf8").replace(/@tailwind[^;]*;|@import[^;]*;/g, "");
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
let failures = 0;
for (const { sym, html } of pages) {
  if (!html) { console.log(`${sym}: fewer than 60 daily bars on file, not measured`); failures++; continue; }
  for (const width of [360, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${html}</body></html>`);
    const r = await page.evaluate(() => {
      const W = innerWidth, bad = [];
      const named = (el) => (typeof el.className === "string" && el.className ? el.className.split(" ").find((c) => c.startsWith("sp-") && c !== "sp-slot") ?? el.className.split(" ")[0] : el.tagName.toLowerCase());
      for (const el of document.querySelectorAll(".czCard, .klCard, .sp-slot")) {
        const b = el.getBoundingClientRect();
        if (b.width === 0) continue;
        if (b.left < -0.5 || b.right > W + 0.5) bad.push(`${named(el)} runs past the viewport (${Math.round(b.left)}–${Math.round(b.right)} px)`);
        if (el.scrollWidth > el.clientWidth + 1) bad.push(`${named(el)} overflows inside (${el.scrollWidth} > ${el.clientWidth} px)`);
      }
      const past = [...document.body.querySelectorAll("*")].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > W + 0.5 && getComputedStyle(el).position !== "fixed"; });
      const order = [...document.querySelectorAll(".sp-slot")].filter((el) => el.getBoundingClientRect().height > 0)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(named);
      return { scrolls: document.documentElement.scrollWidth > W, docW: document.documentElement.scrollWidth, bad, past: past.length, pastNames: [...new Set(past.slice(0, 5).map(named))], order, zones: document.querySelectorAll(".czBand").length };
    });
    // Sideways scroll is the verdict (#87); a section wider inside than its box, with nothing past the screen edge, is a note.
    const ok = !r.scrolls && r.past === 0 && !r.bad.some((x) => x.includes("runs past the viewport"));
    if (!ok) failures++;
    console.log(`${sym} @ ${width}px: page scrolls sideways ${r.scrolls} (document ${r.docW} px) · Price zones bands ${r.zones} · elements past the right edge ${r.past}${r.past ? ` ${JSON.stringify(r.pastNames)}` : ""}${r.bad.length ? ` · notes ${JSON.stringify(r.bad)}` : ""} — ${ok ? "no sideways scroll" : "SIDEWAYS SCROLL"}`);
    if (width === 390) console.log(`  order: ${r.order.join(" → ")}`);
    await page.close();
  }
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
