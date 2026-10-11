// THE STOCK PAGE CHART'S READOUT IN A REAL BROWSER (#553 COWORK #136).
//
// Runs the shipped StockPriceChart (and lib/chartReadout, lib/utcDate),
// transpiled as-is, in Chromium with React's own browser build, inside a
// column like the stock page's (16 px gutter, no global box-sizing). At each
// width it checks:
//   - no sideways scroll, and the chart's border stays inside its column
//     (CODE-C #74: it ran 2 px past);
//   - the default readout is the last bar, "Latest close";
//   - hovering a bar shows that bar's date, close and change, draws the
//     marker, and makes NO network request; leaving returns to the latest;
//   - a touch drag scrubs the same way and lifting returns to the latest;
//   - ←/→ step a bar once the chart is focused, Esc returns to the latest;
//   - the readout strip sits above the chart, never over it, keeps one
//     height while scrubbing (the chart doesn't jump) and cuts nothing off;
//   - FAIR VALUE GAPS (#553 COWORK #140/#144): the toggle starts off; on, each
//     zone is drawn inside the plot, the pointer inside one reads "In a
//     bullish gap (from …)", still no sideways scroll; the tap note opens at
//     16 px; a stock with none shows the toggle disabled with the reason.
// Also writes chart-gaps-390.png and chart-gaps-1280.png (gaps on).
// Writes chart-readout-390.png (a touch drag in progress) and
// chart-readout-1280.png (a hover) to SHOTS (default /tmp).
//
//   node scripts/measure-chart-readout.mjs     # widths 320 360 375 390 414 430 1280
//
// NOT IN check-all: it needs Chromium and Playwright (installed globally in
// the sandbox). check-chart-readout holds the rules and mutants.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import ts from "typescript";

const ROOT = process.cwd();
const SHOTS = path.resolve(process.env.SHOTS || "/tmp");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const cjs = (src, fileName) => ts.transpileModule(src, {
  fileName,
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react", esModuleInterop: true },
}).outputText;

// Every module the page needs, as CommonJS, wired by a tiny require().
const MODULES = {
  react: read("node_modules/react/cjs/react.development.js"),
  "react/jsx-runtime": read("node_modules/react/cjs/react-jsx-runtime.development.js"),
  "react-dom": read("node_modules/react-dom/cjs/react-dom.development.js"),
  "react-dom/client": read("node_modules/react-dom/cjs/react-dom-client.development.js"),
  scheduler: read("node_modules/scheduler/cjs/scheduler.development.js"),
  "@/lib/utcDate": cjs(read("lib/utcDate.ts"), "utcDate.ts"),
  "@/lib/chartReadout": cjs(read("lib/chartReadout.ts"), "chartReadout.ts"),
  "@/lib/ta/fairValueGaps": cjs(read("lib/ta/fairValueGaps.ts"), "fairValueGaps.ts"),
  "@/lib/chartGaps": cjs(read("lib/chartGaps.ts"), "chartGaps.ts"),
  "@/lib/stretch": cjs(read("lib/stretch.ts"), "stretch.ts"),
  "@/lib/chartCandles": cjs(read("lib/chartCandles.ts"), "chartCandles.ts"),
  "@/lib/useChartMode": cjs(read("lib/useChartMode.ts"), "useChartMode.ts"),
  chart: cjs(read("app/stock/[symbol]/StockPriceChart.tsx"), "StockPriceChart.tsx"),
};

// 240 weekday bars ending Fri 2 Oct 2026, with MA50/MA200 computed from them.
function bars() {
  const out = [];
  const d = new Date(Date.UTC(2026, 9, 2));
  let i = 0;
  while (out.length < 440) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      out.unshift({ date: d.toISOString().slice(0, 10), close: 0 });
      i++;
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  // SCALE=10 tries four-digit prices and three-digit moves on the narrowest phones.
  const scale = Number(process.env.SCALE || 1);
  out.forEach((p, k) => { p.close = Number(((180 + 25 * Math.sin(k / 23) + 8 * Math.sin(k / 5) + k * 0.06) * scale * (k >= 400 ? 1.25 : 1)).toFixed(2)); });
  // Highs and lows (1.5% either side, so ordinary days overlap), and one jump of 25% forty sessions from the end: a bullish gap.
  out.forEach((p) => { p.high = Number((p.close * 1.015).toFixed(2)); p.low = Number((p.close * 0.985).toFixed(2)); });
  // Opens for the candle view (#553 COWORK #165): the previous close, nudged, so days go both ways.
  out.forEach((p, k) => { p.open = Number(((k ? out[k - 1].close : p.close) * (k % 3 ? 1.004 : 0.996)).toFixed(2)); p.high = Math.max(p.high, p.open); p.low = Math.min(p.low, p.open); });
  const flat = out.map((p) => ({ date: p.date, open: 100, close: 100, high: 100, low: 100 }));
  const ma = (k, w) => (k + 1 >= w ? out.slice(k + 1 - w, k + 1).reduce((s, p) => s + p.close, 0) / w : null);
  const ma50 = out.map((_, k) => ma(k, 50));
  const ma200 = out.map((_, k) => ma(k, 200));
  return { data: out.slice(-240), ma50: ma50.slice(-240), ma200: ma200.slice(-240), gapBars: out, flat };
}
const SERIES = bars();

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{--fs-read:1rem;--lh-read:1.65;--fs-label:0.8125rem;--fs-fine:0.75rem}body{margin:0;padding:16px;background:#020617;color:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}#col{max-width:1100px;margin:0 auto}</style></head>
<body><div id="col"><section><h2 style="margin:0 0 16px">ABC with MA50 and MA200</h2><div id="root"></div></section></div>
<script>
window.process = { env: { NODE_ENV: "development" } };
const SOURCES = ${JSON.stringify(MODULES)};
const cache = {};
function require(name) {
  if (cache[name]) return cache[name].exports;
  if (!(name in SOURCES)) throw new Error("no module " + name);
  const module = { exports: {} };
  cache[name] = module;
  new Function("module", "exports", "require", "process", SOURCES[name])(module, module.exports, require, window.process);
  return module.exports;
}
window.SERIES = ${JSON.stringify(SERIES)};
window.requests = 0;
const realFetch = window.fetch;
window.fetch = (...a) => { window.requests++; return realFetch(...a); };
const React = require("react");
const Chart = require("chart").default;
const credit = React.createElement("a", { href: "#credit" }, "Market data from Tiingo.com");
require("react-dom/client").createRoot(document.getElementById("root")).render(
  location.search.includes("partial")
    ? React.createElement(Chart, { symbol: "PRT", data: SERIES.data.map((p, k, a) => (k === a.length - 1 ? { ...p, label: "today so far (IEX), 14:05 ET" } : p)), ma50: SERIES.ma50, ma200: SERIES.ma200, height: 360, credit, gapBars: SERIES.gapBars })
    : location.search.includes("flat")
    ? React.createElement(Chart, { symbol: "FLT", data: SERIES.flat.slice(-240), ma50: SERIES.ma50, ma200: SERIES.ma200, height: 360, credit, gapBars: SERIES.flat })
    : React.createElement(Chart, { symbol: "ABC", data: SERIES.data, ma50: SERIES.ma50, ma200: SERIES.ma200, height: 360, credit, gapBars: SERIES.gapBars })
);
</script></body></html>`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const n = SERIES.data.length;
const PAD = { width: 920, padL: 38, padR: 60 };

const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const { chromium } = createRequire(path.join(globalRoot, "noop.js"))("playwright");
const browser = await chromium.launch();
const file = path.join(SHOTS, "chart-readout.html");
fs.writeFileSync(file, page);

let bad = 0;
const say = (ok, label, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) bad++; };

for (const width of (process.env.WIDTHS || "320,360,375,390,414,430,1280").split(",").map(Number)) {
  const phone = width < 700;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: phone, isMobile: phone, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await p.goto(`file://${file}`);
  await p.waitForSelector("[data-chart-readout]");
  let netAfterLoad = 0;
  p.on("request", () => netAfterLoad++);
  console.log(`\n=== ${width} px ===`);

  const state = () => p.evaluate(() => {
    const strip = document.querySelector("[data-chart-readout]");
    const svg = document.querySelector("svg[tabindex]");
    const col = document.getElementById("root");
    const s = strip.getBoundingClientRect(), v = svg.getBoundingClientRect(), c = col.getBoundingClientRect();
    return {
      text: strip.textContent, kind: strip.dataset.chartReadout,
      marker: document.querySelector("[data-chart-marker]")?.dataset.chartMarker ?? null,
      stripBottom: s.bottom, stripH: s.height, svgTop: v.top, svgLeft: v.left, svgRight: v.right, svgW: v.width,
      colLeft: c.left, colRight: c.right,
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
      requests: window.requests,
      clipped: [...strip.children].filter((c) => c.scrollWidth > c.clientWidth + 0.5).map((c) => c.textContent),
    };
  });
  const s0 = await state();
  const last = SERIES.data[n - 1];
  say(s0.scrollW <= s0.clientW, "no sideways scroll", `${s0.scrollW} vs ${s0.clientW}`);
  say(s0.svgRight <= s0.colRight + 0.5 && s0.svgLeft >= s0.colLeft - 0.5, "the chart's border stays inside its column (CODE-C #74)", `chart ${s0.svgLeft.toFixed(1)}–${s0.svgRight.toFixed(1)}, column ${s0.colLeft.toFixed(1)}–${s0.colRight.toFixed(1)}`);
  say(s0.kind === "latest" && s0.text.startsWith(`Latest close · ${dayText(last.date)}`) && s0.text.includes(last.close.toFixed(2)) && s0.marker === null, "default: the last bar, \"Latest close\", no marker", s0.text);
  say(s0.stripBottom <= s0.svgTop, "the readout strip sits above the chart, not over it", `strip bottom ${s0.stripBottom.toFixed(1)}, chart top ${s0.svgTop.toFixed(1)}`);

  // The page x of bar i.
  const xOf = (st, i) => st.svgLeft + 1 + ((PAD.padL + (i * (PAD.width - PAD.padL - PAD.padR)) / (n - 1)) / PAD.width) * (st.svgW - 2);
  const yMid = s0.svgTop + 100;
  const picks = [0, 37, 120, 200, n - 2];
  const heights = new Set([s0.stripH]);
  const clipped = new Set(s0.clipped);
  const readMatches = (st, i) => {
    const b = SERIES.data[i], prev = SERIES.data[i - 1];
    const d = prev ? b.close - prev.close : null;
    const ch = d === null ? "no previous close shown" : `${d > 0 ? "+" : d < 0 ? "-" : ""}${Math.abs(d).toFixed(2)}`;
    return st.marker === String(i) && st.text.includes(dayText(b.date)) && st.text.includes(b.close.toFixed(2)) && st.text.includes(ch);
  };

  if (!phone) {
    let ok = true, why = "";
    for (const i of picks) {
      await p.mouse.move(xOf(s0, i), yMid);
      const st = await state();
      heights.add(st.stripH);
      st.clipped.forEach((t) => clipped.add(t));
      if (!readMatches(st, i)) { ok = false; why = `bar ${i}: ${st.text} (marker ${st.marker})`; break; }
    }
    say(ok, "hover: each bar's own date, close and change, with the marker", why);
    await p.mouse.move(xOf(s0, 150), yMid);
    await p.screenshot({ path: path.join(SHOTS, "chart-readout-1280.png"), fullPage: true });
    await p.mouse.move(5, 5);
    const out = await state();
    say(out.kind === "latest" && out.marker === null, "leaving the chart returns to \"Latest close\"", out.text);
  } else {
    // A finger: down on the chart, drag sideways, lift.
    const touch = (type, x) => p.evaluate(([type, x, y]) => {
      const svg = document.querySelector("svg[tabindex]");
      svg.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 7, isPrimary: true, clientX: x, clientY: y }));
    }, [type, x, yMid]);
    let ok = true, why = "";
    await touch("pointerdown", xOf(s0, picks[0]));
    for (const i of picks) {
      await touch("pointermove", xOf(s0, i));
      const st = await state();
      heights.add(st.stripH);
      st.clipped.forEach((t) => clipped.add(t));
      if (!readMatches(st, i)) { ok = false; why = `bar ${i}: ${st.text} (marker ${st.marker})`; break; }
    }
    say(ok, "touch drag: each bar's own date, close and change, with the marker", why);
    const during = await state();
    say(during.stripBottom <= during.svgTop, "while dragging the strip stays above the chart", `strip bottom ${during.stripBottom.toFixed(1)}, chart top ${during.svgTop.toFixed(1)}`);
    if (width === 390) {
      await touch("pointermove", xOf(s0, 150));
      await p.screenshot({ path: path.join(SHOTS, "chart-readout-390.png"), fullPage: true });
    }
    await touch("pointerup", xOf(s0, 150));
    const up = await state();
    say(up.kind === "latest" && up.marker === null, "lifting the finger returns to \"Latest close\"", up.text);
  }
  say(clipped.size === 0, "nothing in the readout is cut off", [...clipped][0] ?? "");
  say(heights.size === 1, "the strip keeps one height while scrubbing (the chart doesn't jump)", [...heights].join(", "));

  // Keyboard.
  await p.focus("svg[tabindex]");
  for (let k = 0; k < 3; k++) await p.keyboard.press("ArrowLeft");
  const k3 = await state();
  await p.keyboard.press("ArrowRight");
  const k2 = await state();
  await p.keyboard.press("Escape");
  const kEsc = await state();
  say(readMatches(k3, n - 4) && readMatches(k2, n - 3) && kEsc.kind === "latest" && kEsc.marker === null, "keys: ← ← ← steps back three bars, → one forward, Esc to the latest", `${k3.marker} ${k2.marker} ${kEsc.kind}`);

  // ── Stretch line (#553 COWORK #144): present, reading size, nothing past the column ──
  const st = await p.evaluate(() => {
    const el = document.querySelector("[data-chart-stretch]");
    if (!el) return null;
    const r = el.getBoundingClientRect(), c = document.getElementById("root").getBoundingClientRect();
    return { size: getComputedStyle(el).fontSize, inside: r.left >= c.left - 0.5 && r.right <= c.right + 0.5, text: el.textContent };
  });
  say(st && st.size === "16px" && st.inside && /standard deviations (above|below) its 20-day average/.test(st.text), "stretch: the line reads at 16 px inside the column", st ? st.text.slice(0, 70) : "missing");

  // ── Fair value gaps ──
  const g0 = await p.evaluate(() => ({ state: document.querySelector("[data-chart-gaps]")?.dataset.chartGaps, zones: document.querySelectorAll("[data-chart-gap]").length }));
  say(g0.state === "off" && g0.zones === 0, "gaps: the toggle starts off, nothing drawn", JSON.stringify(g0));
  await p.click(".chart-gap-toggle");
  const g1 = await p.evaluate(() => {
    const svg = document.querySelector("svg[tabindex]").getBoundingClientRect();
    const rects = [...document.querySelectorAll("[data-chart-gap]")].map((r) => r.getBoundingClientRect());
    return {
      pressed: document.querySelector(".chart-gap-toggle").getAttribute("aria-pressed"),
      n: rects.length,
      inside: rects.every((r) => r.left >= svg.left - 0.5 && r.right <= svg.right + 0.5 && r.top >= svg.top - 0.5 && r.bottom <= svg.bottom + 0.5),
      first: rects[0] ? { x: (rects[0].left + rects[0].right) / 2, y: (rects[0].top + rects[0].bottom) / 2 } : null,
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
      requests: window.requests, svgTop: svg.top,
    };
  });
  say(g1.pressed === "true" && g1.n >= 1 && g1.inside, "gaps on: zones drawn, each inside the chart", `${g1.n} zone(s)`);
  say(g1.scrollW <= g1.clientW, "gaps on: still no sideways scroll", `${g1.scrollW} vs ${g1.clientW}`);
  if (g1.first) {
    if (phone) {
      await p.evaluate(([x, y]) => {
        const svg = document.querySelector("svg[tabindex]");
        for (const type of ["pointerdown", "pointermove"]) svg.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 9, isPrimary: true, clientX: x, clientY: y }));
      }, [g1.first.x, g1.first.y]);
    } else await p.mouse.move(g1.first.x, g1.first.y);
    const words = await p.textContent("[data-chart-gap-status]");
    const svgTopIn = await p.evaluate(() => document.querySelector("svg[tabindex]").getBoundingClientRect().top);
    say(Math.abs(svgTopIn - g1.svgTop) < 0.5, "gaps: the words coming in don't move the chart", `${g1.svgTop} → ${svgTopIn}`);
    say(/^In a bullish gap \(from \d{1,2} [A-Z][a-z]{2}\)$/.test(words ?? ""), "gaps: the pointer inside a zone reads \"In a bullish gap (from …)\"", words ?? "");
    if (width === 390 || width === 1280) await p.screenshot({ path: path.join(SHOTS, `chart-gaps-${width}.png`), fullPage: true });
    if (phone) await p.evaluate(([x, y]) => document.querySelector("svg[tabindex]").dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", pointerId: 9, clientX: x, clientY: y })), [g1.first.x, g1.first.y]);
    else await p.mouse.move(2, 2);
  }
  await p.click(`button[aria-controls="ABC-gap-note"]`);
  const note = await p.evaluate(() => { const el = document.getElementById("ABC-gap-note"); return el ? { size: getComputedStyle(el).fontSize, text: el.textContent } : null; });
  say(note && note.size === "16px" && /A description, not a forecast\.$/.test(note.text), "gaps: the tap note opens at 16 px with the ruled words", note ? note.size : "not shown");
  const fp = await ctx.newPage();
  await fp.goto(`file://${file}?flat`);
  await fp.waitForSelector("[data-chart-gaps]");
  const none = await fp.evaluate(() => ({ state: document.querySelector("[data-chart-gaps]").dataset.chartGaps, disabled: document.querySelector(".chart-gap-toggle").disabled, words: document.querySelector("[data-chart-gap-status]").textContent, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
  say(none.state === "none" && none.disabled && none.words === "No unfilled gaps in the last 12 months" && none.scrollW <= none.clientW, "gaps: with none, the toggle is disabled with the reason", JSON.stringify(none));
  await fp.close();

  // ── LINE | CANDLES (#553 COWORK #165) ──
  const c0 = await p.evaluate(() => ({ line: !!document.querySelector("[data-chart-line]"), pressed: [...document.querySelectorAll(".chart-mode-btn")].map((b) => b.getAttribute("aria-pressed")).join() }));
  say(c0.line && c0.pressed === "true,false", "Line is the default, and the switch says so", JSON.stringify(c0));
  await p.click(".chart-mode-btn:nth-child(2)");
  await p.waitForSelector("[data-chart-candles]");
  const cs = await p.evaluate(() => {
    const svg = document.querySelector("svg[tabindex]");
    const k = svg.clientWidth / 920;
    const bodies = [...document.querySelectorAll("[data-candle] rect")];
    const widths = bodies.map((r) => r.getBoundingClientRect().width);
    const ups = document.querySelectorAll('[data-candle="up"]').length, downs = document.querySelectorAll('[data-candle="down"]').length;
    const upFill = document.querySelector('[data-candle="up"] rect')?.getAttribute("fill"), downFill = document.querySelector('[data-candle="down"] rect')?.getAttribute("fill");
    return { n: bodies.length, minW: Math.min(...widths), ups, downs, upFill, downFill, fit: document.querySelector("[data-chart-fit]")?.textContent ?? null,
      overlays: document.querySelectorAll('svg path[stroke-dasharray]').length, dot: !!svg.querySelector("circle"), line: !!document.querySelector("[data-chart-line]"),
      pressed: [...document.querySelectorAll(".chart-mode-btn")].map((b) => b.getAttribute("aria-pressed")).join(), stored: localStorage.getItem("msh:stock-chart-mode"),
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, k };
  });
  say(cs.pressed === "false,true" && !cs.line && cs.n >= 2, "candles: one candle per shown session, the line gone", `${cs.n} candles`);
  say(cs.ups > 0 && cs.downs > 0 && cs.upFill === "#22c55e" && cs.downFill === "#ef4444", "candles: green up days, red down days", `${cs.ups} up, ${cs.downs} down`);
  say(cs.minW >= 3 * 0.7 - 0.01 || cs.n === 240, "candles: each body at least ~3 px of slot (70% body)", `min ${cs.minW.toFixed(2)} px`);
  say(phone ? cs.n < 240 && cs.fit === `Last ${cs.n} sessions shown in candle view` : cs.n === 240 && cs.fit === null, phone ? "candles on a phone: only the latest that fit, said in the footer" : "candles on desktop: all 240 sessions", cs.fit ?? "no fit line");
  say(cs.overlays === 2 && cs.dot, "candles: MA50, MA200 and the last-price dot stay");
  say(cs.scrollW <= cs.clientW, "candles: no sideways scroll", `${cs.scrollW} vs ${cs.clientW}`);
  say(cs.stored === "candles", "candles: the choice is remembered in this browser");
  // The readout's OHLC line on a picked day, and the strip's height holding while scrubbing.
  const box = await p.evaluate(() => { const r = document.querySelector("svg[tabindex]").getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, strip: document.querySelector("[data-chart-readout]").getBoundingClientRect().height }; });
  if (phone) await p.evaluate(([x, y]) => { const svg = document.querySelector("svg[tabindex]"); for (const type of ["pointerdown", "pointermove"]) svg.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 7, isPrimary: true, clientX: x, clientY: y })); }, [box.l + box.w * 0.5, box.t + box.h * 0.5]);
  else await p.mouse.move(box.l + box.w * 0.5, box.t + box.h * 0.5);
  const ohlc = await p.evaluate(() => ({ text: document.querySelector("[data-chart-ohlc]")?.textContent ?? null, strip: document.querySelector("[data-chart-readout]").getBoundingClientRect().height, cut: [...document.querySelectorAll("[data-chart-readout] > span")].some((s) => s.scrollWidth > s.clientWidth + 1) }));
  say(/^O (\d+\.\d{2}|—) · H \d+\.\d{2} · L \d+\.\d{2} · C \d+\.\d{2}$/.test(ohlc.text ?? "") && Math.abs(ohlc.strip - box.strip) < 0.5 && !ohlc.cut, "candles: the readout shows O/H/L/C, one height while scrubbing, nothing cut", `${ohlc.text} · ${box.strip}→${ohlc.strip}`);
  if (width === 390 || width === 1280) await p.screenshot({ path: path.join(SHOTS, `chart-candles-${width}.png`), fullPage: true });
  if (phone) await p.evaluate(() => document.querySelector("svg[tabindex]").dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", pointerId: 7 })));
  else await p.mouse.move(2, 2);
  // Gaps still work in candle mode (they were left on above).
  const gc = await p.evaluate(() => ({ zones: document.querySelectorAll("[data-chart-gap]").length, pressed: document.querySelector(".chart-gap-toggle").getAttribute("aria-pressed") }));
  say(gc.pressed === "true" && gc.zones >= 1, "candles: Show gaps works the same", `${gc.zones} zone(s)`);
  await p.click(".chart-gap-toggle");
  say((await p.evaluate(() => document.querySelectorAll("[data-chart-gap]").length)) === 0, "candles: Hide gaps hides them");
  // The stored choice restored on the next visit; then back to Line for the rest.
  // (A second page in the same browser, so this page's no-request count stays clean.)
  const rp = await ctx.newPage();
  await rp.goto(`file://${file}`);
  await rp.waitForSelector("[data-chart-candles]", { timeout: 3000 }).catch(() => {});
  say(await rp.evaluate(() => !!document.querySelector("[data-chart-candles]")), "candles: restored from this browser's choice on the next visit");
  await rp.close();
  await p.click(".chart-mode-btn:nth-child(1)");
  // A flat day still draws a body; today's partial bar is hollow.
  for (const [q, label] of [["flat", "a flat day (O = H = L = C) still draws a visible body"], ["partial", "today's partial bar is hollow and the readout says today so far"]]) {
    const cp = await ctx.newPage();
    await cp.goto(`file://${file}?${q}`);
    await cp.waitForSelector(".chart-mode-btn");
    await cp.click(".chart-mode-btn:nth-child(2)");
    await cp.waitForSelector("[data-chart-candles]");
    const r = await cp.evaluate(() => {
      const last = [...document.querySelectorAll("[data-candle]")].pop();
      const body = last.querySelector("rect");
      return { h: body.getBoundingClientRect().height, fill: body.getAttribute("fill"), partial: last.getAttribute("data-candle-partial"), readout: document.querySelector("[data-chart-readout]").textContent };
    });
    say(q === "flat" ? r.h >= 1 : r.partial === "1" && r.fill === "none" && /today so far/.test(r.readout), label, JSON.stringify({ h: r.h.toFixed(2), fill: r.fill }));
    await cp.evaluate(() => localStorage.setItem("msh:stock-chart-mode", "line"));
    await cp.close();
  }
  // Storage that throws: the chart opens on Line and the switch still works.
  const tp = await ctx.newPage();
  await tp.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); });
  const tErrors = [];
  tp.on("pageerror", (e) => tErrors.push(String(e)));
  await tp.goto(`file://${file}`);
  await tp.waitForSelector(".chart-mode-btn");
  const t0 = await tp.evaluate(() => !!document.querySelector("[data-chart-line]"));
  await tp.click(".chart-mode-btn:nth-child(2)");
  const t1 = await tp.evaluate(() => !!document.querySelector("[data-chart-candles]"));
  say(t0 && t1 && tErrors.length === 0, "storage that throws: opens on Line, the switch still works, no error", tErrors[0] ?? "");
  await tp.close();

  const fin = await state();
  say(fin.requests === 0 && netAfterLoad === 0, "no network request on hover, drag or keys", `fetch ${fin.requests}, requests ${netAfterLoad}`);
  say(fin.scrollW <= fin.clientW, "still no sideways scroll after scrubbing", `${fin.scrollW} vs ${fin.clientW}`);
  say(errors.length === 0, "no page errors", errors[0] ?? "");
  await ctx.close();
}
await browser.close();
console.log(`\n${bad === 0 ? "ALL PASS" : `${bad} FAILURE(S)`}  (screenshots in ${SHOTS})`);
process.exit(bad === 0 ? 0 : 1);
