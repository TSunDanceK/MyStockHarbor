// THE COLD FILL, RENDERED IN A REAL BROWSER ON A FAKE CLOCK (#552 COWORK #46).
//
// The sandbox cannot reach a preview, and a cold start there needs BotID and
// a real SEC read, so this is the nearest rendered test: the SHIPPED
// ColdFill.tsx and SecLoadedNotice.tsx (and everything they import) bundled
// with esbuild, the server action and the router stubbed, run in Chromium
// under Playwright's clock. The stub "server" swaps the figures in on a
// refresh only once the store has the set — as the real page does.
//
//   1. A 45-second fill: loading → still working (20s) → the figures appear
//      in place with "SEC data loaded", no manual refresh.
//   2. The give-up path: "Taking longer than expected" and a Refresh button;
//      clicking it brings the figures in once they are stored.
//   3. MUTANT: the auto-swap removed from coldFillPoll.ts → scenario 1 must fail.
// Screenshots of each state go to OUT_DIR (default: the scratch directory).
//
//   OUT_DIR=/tmp/shots node scripts/cold-fill-render.mjs
//
// NOT IN check-all: it needs Chromium and `npx esbuild`. The same rules run on
// a virtual clock in check-cold-fill-poll (in check-all), with the same mutant.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const OUT = process.env.OUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "cold-fill-"));
fs.mkdirSync(OUT, { recursive: true });
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "cold-fill-build-"));
const require = createRequire(path.join(execSync("npm root -g").toString().trim(), "_"));
const { chromium } = require("playwright");

const PAGE = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
const css = PAGE.slice(PAGE.indexOf("<style>{`") + 9, PAGE.indexOf("`}</style>", PAGE.indexOf("<style>{`"))).replace(/\$\{[^}]*\}/g, "transparent");

fs.writeFileSync(path.join(WORK, "entry.tsx"), `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ColdFill from "@/app/stock/[symbol]/ColdFill";
import SecLoadedNotice from "@/app/components/SecLoadedNotice";
function App() {
  const [stored, setStored] = useState(false);
  (window as any).__serverRender = () => setStored((window as any).__isStored());
  return (<>
    <main className="earningsWrap" style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <section className="card" style={{ marginBottom: 14 }}><div className="eyebrow">AXTI</div><h2>AXT Inc</h2><p>Price, chart and news render here as usual.</p></section>
      {stored
        ? <section className="card" data-figures="1"><div className="eyebrow">Financials</div><h2>AXTI financials</h2><p>Revenue, margins and cash flow from AXTI's filings.</p></section>
        : <ColdFill symbol="AXTI" token="t" headline="AXTI financials" />}
    </main>
    <SecLoadedNotice />
  </>);
}
createRoot(document.getElementById("root")!).render(<App />);
`);

function bundle(name, mutateRefresh) {
  const stubs = path.join(WORK, `stubs-${name}`);
  fs.mkdirSync(stubs, { recursive: true });
  fs.writeFileSync(path.join(stubs, "next-navigation.ts"), `
const router = { refresh: () => { (window as any).__refreshes = ((window as any).__refreshes ?? 0) + 1; (window as any).__serverRender(); } };
export const useRouter = () => router;`);
  fs.writeFileSync(path.join(stubs, "coldFillAction.ts"), `
export const requestColdFill = (_s: unknown, _t: unknown) => (window as any).__scenario.request();
export const coldFillStatus = async (_s: unknown, _t: unknown) => { (window as any).__polls = ((window as any).__polls ?? 0) + 1; return { ready: (window as any).__isStored() }; };`);
  // The mutant: coldFillPoll.ts with its soft refresh removed, bundled in its place.
  let pollPath = path.join(ROOT, "app/stock/[symbol]/coldFillPoll.ts");
  if (mutateRefresh) {
    const src = fs.readFileSync(pollPath, "utf8");
    const anchor = "    d.refresh();\n    d.announce();\n";
    if (src.split(anchor).length !== 2) throw new Error("mutation anchor");
    pollPath = path.join(stubs, "coldFillPoll.ts");
    fs.writeFileSync(pollPath, src.replace(anchor, "    d.announce();\n").replace(/from "\.\/coldFillSettle"/, `from ${JSON.stringify(path.join(ROOT, "app/stock/[symbol]/coldFillSettle"))}`));
  }
  const plugin = `
const path = require("path");
const fs = require("fs");
module.exports = { name: "stubs", setup(b) {
  b.onResolve({ filter: /^next\\/navigation$/ }, () => ({ path: ${JSON.stringify(path.join(stubs, "next-navigation.ts"))} }));
  b.onResolve({ filter: /coldFillAction$/ }, () => ({ path: ${JSON.stringify(path.join(stubs, "coldFillAction.ts"))} }));
  b.onResolve({ filter: /coldFillPoll$/ }, () => ({ path: ${JSON.stringify(pollPath)} }));
  b.onResolve({ filter: /^@\\// }, (a) => {
    const base = path.join(${JSON.stringify(ROOT)}, a.path.slice(2));
    const hit = ["", ".tsx", ".ts", ".js"].map((x) => base + x).find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    return hit ? { path: hit } : undefined;
  });
}};`;
  fs.writeFileSync(path.join(stubs, "plugin.cjs"), plugin);
  const runner = path.join(stubs, "build.cjs");
  fs.writeFileSync(runner, `
const esbuild = require(process.env.ESBUILD);
esbuild.build({ entryPoints: [${JSON.stringify(path.join(WORK, "entry.tsx"))}], bundle: true, format: "iife", jsx: "automatic",
  resolveExtensions: [".tsx", ".ts", ".js", ".mjs"], nodePaths: [${JSON.stringify(path.join(ROOT, "node_modules"))}],
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error",
  outfile: ${JSON.stringify(path.join(stubs, "app.js"))}, plugins: [require(${JSON.stringify(path.join(stubs, "plugin.cjs"))})] }).catch((e) => { console.error(e.message); process.exit(1); });`);
  execFileSync(process.execPath, [runner], { stdio: "inherit", env: { ...process.env, ESBUILD: ESBUILD } });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#07111f;color:#e2e8f0;font-family:system-ui,sans-serif} ${css}</style></head><body><div id="root"></div><script>${fs.readFileSync(path.join(stubs, "app.js"), "utf8")}</script></body></html>`;
  const file = path.join(stubs, "index.html");
  fs.writeFileSync(file, html);
  return file;
}

// esbuild via npx, once: its package directory, for require().
execSync("npx -y esbuild@0.25.10 --version", { stdio: "ignore" });
const ESBUILD = execSync(`find ${os.homedir()}/.npm/_npx -path '*node_modules/esbuild/package.json' | head -1`).toString().trim().replace(/\/package\.json$/, "");
if (!ESBUILD) throw new Error("esbuild not found after npx");

let failures = 0;
const check = (name, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
async function scenario(file, { readyAt, replyAt, reply }) {
  const page = await browser.newPage({ viewport: { width: 760, height: 560 } });
  await page.clock.install({ time: 0 });
  await page.addInitScript(({ readyAt, replyAt, reply }) => {
    const t0 = Date.now();
    window.__isStored = () => Date.now() - t0 >= readyAt;
    window.__scenario = { request: () => new Promise((r) => setTimeout(() => r(reply), replyAt)) };
  }, { readyAt, replyAt, reply });
  await page.goto(`file://${file}`);
  return page;
}
const text = (page) => page.evaluate(() => document.querySelector("main").innerText + " | notice: " + document.querySelector(".secLoadedNotice").innerText);
const state = (page) => page.evaluate(() => ({ figures: !!document.querySelector("[data-figures]"), cold: document.querySelector("[data-cold-fill]")?.getAttribute("data-cold-fill") ?? null,
  notice: document.querySelector(".secLoadedNotice").innerText, refreshes: window.__refreshes ?? 0, polls: window.__polls ?? 0 }));

const REAL = bundle("real", false);
console.log("1. a 45-second fill (the action's own reply arrives at 45s, after the 12s ceiling)");
async function slowFill(file, shots) {
  const page = await scenario(file, { readyAt: 45_000, replyAt: 45_000, reply: { ok: true, outcome: "filled" } });
  await page.clock.runFor(2_000);
  const s2 = await state(page);
  if (shots) await page.screenshot({ path: path.join(OUT, "1-loading.png") });
  await page.clock.runFor(20_000);
  const s22 = await state(page);
  if (shots) await page.screenshot({ path: path.join(OUT, "2-still-working.png") });
  await page.clock.runFor(29_000); // t = 51s: the 50s poll has landed
  const s51 = await state(page);
  if (shots) await page.screenshot({ path: path.join(OUT, "3-loaded-notice.png") });
  await page.clock.runFor(6_000);
  const s57 = await state(page);
  const words = await text(page);
  await page.close();
  return { s2, s22, s51, s57, words };
}
{
  const r = await slowFill(REAL, true);
  check("2s: loading", r.s2.cold === "reading" && !r.s2.figures, JSON.stringify(r.s2));
  check("22s: still working", r.s22.cold === "still", JSON.stringify(r.s22));
  check("51s: the figures are in place, no manual refresh, 'SEC data loaded' on screen", r.s51.figures && r.s51.notice === "SEC data loaded" && r.s51.refreshes >= 1, JSON.stringify(r.s51));
  check("57s: the notice has gone; the figures stay", r.s57.figures && r.s57.notice === "", JSON.stringify(r.s57));
  check(`Redis cost of this fill: ${r.s51.polls} status polls`, r.s51.polls <= 6, String(r.s51.polls));
}

console.log("\n2. the give-up path");
{
  const page = await scenario(REAL, { readyAt: 200_000, replyAt: 60_000, reply: { ok: true, outcome: "queued" } });
  await page.clock.runFor(160_000);
  const s = await state(page);
  const hasButton = await page.getByRole("button", { name: "Refresh" }).count();
  await page.screenshot({ path: path.join(OUT, "4-gave-up.png") });
  check("160s: 'Taking longer than expected' with a Refresh button", s.cold === "gave-up" && hasButton === 1 && (await text(page)).includes("Taking longer than expected."), JSON.stringify(s));
  const polls = s.polls;
  await page.clock.runFor(45_000);
  check("no polling after giving up", (await state(page)).polls === polls);
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.clock.runFor(1_000);
  const after = await state(page);
  check("Refresh (the set now stored) → the figures swap in with the notice", after.figures && after.notice === "SEC data loaded", JSON.stringify(after));
  await page.close();
}

console.log("\n3. MUTANT: no auto-swap");
{
  const r = await slowFill(bundle("mutant", true), false);
  check("MUTANT: without the soft refresh the 45s fill never shows its figures (the scenario-1 test fails)", !r.s51.figures && !r.s57.figures, JSON.stringify(r.s51));
}

await browser.close();
console.log(`\nscreenshots: ${OUT}`);
if (failures) { console.log(`${failures} assertion(s) failed.`); process.exit(1); }
console.log("ALL CHECKS PASSED");
