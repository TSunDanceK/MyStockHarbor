// THE /bottlenecks HUB, MEASURED IN A REAL BROWSER (#125 COWORK).
//
// Renders the real server page (app/bottlenecks/page.tsx) from today's
// content/bottlenecks/*.md with the repo's render hooks
// (scripts/lib/tsx-render-hooks.mjs), then in Chromium checks:
//   - no sideways scroll at 320, 360, 390, 414, 560, 600, 768, 960, 1024, 1280 px,
//     on both mobile tabs;
//   - the dependency web is hidden at 560 px and under, and the top-10 list
//     shows instead; above 560 px the web shows and the list does not;
//   - the web's hub labels stay inside their circles and no two hubs overlap;
//   - hovering a hub shows "N stocks depend on X" and lights its lines;
//   - the leaderboard renders ten rows and "See full leaderboard"; a row opens
//     to chips linking /bottlenecks/{slug};
//   - THE RIM (#563 COWORK #131): every rim dot has a line to a hub, and the
//     caption's count is the number of dots; a 250-page fixture draws sector
//     arcs, not dots, and no arc label touches another label or a hub.
// Mutants: the ≤560 px hide rule removed must be caught; a forced wide element
// must be caught as sideways scroll.
//
//   node scripts/measure-bottlenecks-hub.mjs [--shots DIR]
//
// NOT IN check-all: it needs Chromium and Playwright (installed globally in the sandbox).
import fs from "node:fs";
import path from "node:path";
import { createRequire, register } from "node:module";

const ROOT = process.cwd();
const SHOTS = (() => { const i = process.argv.indexOf("--shots"); return i > 0 ? path.resolve(process.argv[i + 1]) : null; })();
register("./lib/tsx-render-hooks.mjs", import.meta.url);
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");

const { default: Page } = await import("../app/bottlenecks/page.tsx");
const html = renderToStaticMarkup(React.createElement(Page));
const CSS = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8").replace(/@import[^;]*;|@tailwind[^;]*;|@theme inline \{[^}]*\}/g, "");
const doc = (body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head><body style="margin:0;background:#06080d">${body}</body></html>`;
// Logos are served from public/logos as the site serves them; every other request is blocked (nothing reaches the network).
const open = async (browser, width, body = html) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.route("**/*", (r) => {
    if (r.request().url() === "http://hub.test/") return r.fulfill({ body: doc(body), contentType: "text/html" });
    const m = r.request().url().match(/\/logos\/([^/?#]+\.webp)$/);
    const file = m && path.join(ROOT, "public/logos", decodeURIComponent(m[1]));
    return file && fs.existsSync(file) ? r.fulfill({ path: file, contentType: "image/webp" }) : r.request().url().startsWith("data:") ? r.continue() : r.abort();
  });
  await page.goto("http://hub.test/");
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };

const probe = () => {
  const vis = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; };
  const hubs = [...document.querySelectorAll(".bnHub")].map((g) => {
    const c = g.querySelector("circle").getBoundingClientRect();
    const t = [...g.querySelectorAll("text")].map((x) => x.getBoundingClientRect());
    return { c, inside: t.every((r) => r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1), label: g.querySelector("text").textContent };
  });
  const overlap = [];
  for (let i = 0; i < hubs.length; i++) for (let j = i + 1; j < hubs.length; j++) {
    const a = hubs[i].c, b = hubs[j].c;
    const ra = a.width / 2, rb = b.width / 2, dx = a.left + ra - (b.left + rb), dy = a.top + ra - (b.top + rb);
    if (Math.hypot(dx, dy) < ra + rb) overlap.push(`${hubs[i].label}/${hubs[j].label}`);
  }
  // <main> carries overflow-x: hidden, which would clip (and so hide) a too-wide
  // block rather than scroll it. Lift it for the measurement so clipping counts too.
  const main = document.querySelector("main");
  const was = main.style.overflowX;
  main.style.overflowX = "visible";
  const scrolls = document.documentElement.scrollWidth > innerWidth;
  const wide = [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && e.getClientRects().length && !e.closest("svg") && !e.closest("[style*='overflow: hidden'], [style*='overflow:hidden']")).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${typeof e.className === "string" ? e.className.split(" ")[0] : ""} "${e.textContent.trim().slice(0, 30)}"`);
  main.style.overflowX = was;
  return {
    scrolls,
    wide,
    web: vis(".bnWebBlock") && vis(".bnWeb"),
    list: vis(".bnTopList"),
    notInside: hubs.filter((h) => !h.inside).map((h) => h.label),
    overlap,
    hubs: hubs.length,
  };
};

console.log("=== /bottlenecks hub, Chromium ===");
for (const width of [320, 360, 390, 414, 560, 600, 768, 960, 1024, 1280]) {
  for (const tab of ["list", "board"]) {
    const page = await open(browser, width, tab === "list" ? html : html.replace("bnTabScope--list", "bnTabScope--board"));
    const r = await page.evaluate(probe);
    const phone = width <= 560;
    const ok = !r.scrolls && (phone ? !r.web && r.list : r.web && !r.list) && (phone || (!r.notInside.length && !r.overlap.length && r.hubs === 8));
    check(`${width}px (${tab} tab): ${r.scrolls ? "SCROLLS SIDEWAYS" : "no sideways scroll"} · ${r.web ? "web shown" : "web hidden"} · ${r.list ? "top-10 list shown" : "no top-10 list"}${phone ? "" : ` · ${r.hubs} hubs, labels ${r.notInside.length ? `OUTSIDE: ${r.notInside}` : "inside"}, ${r.overlap.length ? `OVERLAP ${r.overlap}` : "no overlap"}`}`, ok, r.scrolls ? r.wide.join(", ") : "");
    if (SHOTS && tab === "list" && [1280, 768, 390].includes(width)) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `hub-${width}.png`), fullPage: false }); }
    if (SHOTS && tab === "board" && [1280, 390].includes(width)) {
      await page.locator(".bottlenecksLeaderboardRail").screenshot({ path: path.join(SHOTS, `hub-${width}-leaderboard.png`) });
      await page.locator(".bottlenecksThemesArea").screenshot({ path: path.join(SHOTS, `hub-${width}-themes.png`) });
    }
    await page.close();
  }
}

// Reading size in the hub's own blocks (the hero, the themes, the leaderboard):
// a sentence (six words or more, or ending . ? !) under 16px outside fine print
// fails, and so does any text under 12px. The list and archive keep their
// existing styling and are not judged here.
const readingScan = () => {
  const bad = [];
  for (const root of document.querySelectorAll(".bnHero, .bnThemes, .bottlenecksLeaderboardRail")) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.textContent.replace(/\s+/g, " ").trim(), el = n.parentElement;
      if (!t || el.closest("style,script,title")) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      if (![...r.getClientRects()].some((x) => x.width > 0)) continue;
      const px = parseFloat(getComputedStyle(el).fontSize), words = t.split(" ").filter((w) => /[A-Za-z0-9]/.test(w)).length;
      if (px < 11.99) bad.push(`under 12px (${px}px): "${t.slice(0, 50)}"`);
      else if ((words >= 6 || /[.?!]$/.test(t)) && px < 15.99 && !el.closest("[data-fine-print]")) bad.push(`sentence at ${px}px: "${t.slice(0, 50)}"`);
    }
  }
  return bad;
};
for (const width of [390, 1280]) {
  for (const tab of ["list", "board"]) {
    const page = await open(browser, width, (tab === "list" ? html : html.replace("bnTabScope--list", "bnTabScope--board")).replace(/<details class="bnLbRow">|<details class="bnLbWhy">/g, (m) => m.replace("<details ", "<details open ")));
    const bad = await page.evaluate(readingScan);
    check(`${width}px (${tab} tab, rows open): reading text at reading size in the hero, themes and leaderboard`, !bad.length, bad.slice(0, 5).join("; "));
    await page.close();
  }
}

// Hover a hub: its caption replaces the default and its lines light up.
{
  const page = await open(browser, 1280);
  const first = await page.evaluate(() => document.querySelector(".bnHub-0").getAttribute("aria-label"));
  await page.hover(".bnHub-0 circle");
  const r = await page.evaluate(() => ({
    cap: [...document.querySelectorAll(".bnCap")].filter((e) => getComputedStyle(e).display !== "none").map((e) => e.textContent.trim()),
    def: getComputedStyle(document.querySelector(".bnCapDefault")).display,
    lit: getComputedStyle(document.querySelector(".bnLinks-0")).strokeOpacity,
    dim: getComputedStyle(document.querySelector(".bnLinks-1")).strokeOpacity,
  }));
  check(`hover hub 1: caption "${r.cap.join(" | ")}", its lines ${r.lit}, others ${r.dim}`, r.cap.length === 1 && r.cap[0] === first && /^\d+ stocks depend on /.test(r.cap[0]) && r.def === "none" && Number(r.lit) > 0.5 && Number(r.dim) < 0.1);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "hub-1280-hover.png") });
  await page.close();
}
// The leaderboard: ten rows, "See full leaderboard", a row opens to chips.
{
  const page = await open(browser, 1280);
  const r = await page.evaluate(() => {
    const rows = document.querySelectorAll(".bnLbRow");
    rows[0].open = true;
    const chips = [...rows[0].querySelectorAll(".bnLbChip")];
    return { rows: rows.length, more: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "See full leaderboard"), chips: chips.length, chipsVisible: chips.filter((c) => c.getClientRects().length).length, href: chips[0]?.getAttribute("href") };
  });
  check(`leaderboard: ${r.rows} rows, "See full leaderboard" ${r.more ? "present" : "MISSING"}, first row opens to ${r.chipsVisible} chips (${r.href})`, r.rows === 10 && r.more && r.chips > 0 && r.chipsVisible === r.chips && /^\/bottlenecks\/[a-z0-9.-]+$/.test(r.href));
  if (SHOTS) await page.locator(".bottlenecksLeaderboardRail").screenshot({ path: path.join(SHOTS, "hub-1280-row-open.png") });
  await page.close();
}

// THE RIM (#131): every dot has a line; the caption counts the dots.
{
  const page = await open(browser, 1280);
  const r = await page.evaluate(() => {
    const ends = new Set([...document.querySelectorAll(".bnLinks line")].map((l) => `${l.getAttribute("x1")},${l.getAttribute("y1")}`));
    const dots = [...document.querySelectorAll(".bnStock")];
    return { dots: dots.length, lonely: dots.filter((d) => !ends.has(`${d.getAttribute("cx")},${d.getAttribute("cy")}`)).length, caption: document.querySelector(".bnCapDefault").textContent.trim() };
  });
  check(`rim: ${r.dots} dots, ${r.lonely} without a line; caption "${r.caption}"`, r.dots > 0 && r.lonely === 0 && r.caption.startsWith(`${r.dots} stocks that name one of these 8.`));
  await page.close();
}
// THE SAFETY VALVE (#131): 250 connected pages over uneven sectors draw arcs; no label collides.
{
  const H = await import("../lib/bottleneckHub.ts");
  const { default: Web } = await import("../app/components/BottleneckWeb.tsx");
  const { SECTORS } = await import("../lib/sectors.ts");
  const names = [...SECTORS.map((x) => x.shortName), "Other"];
  const E = (name, ticker) => ({ name, ticker, pct: 10, blurb: "" });
  const hubsOf = [["Amazon (AWS)", "AMZN"], ["Alphabet", "GOOGL"], ["Microsoft", "MSFT"], ["TSMC", "TSM"], ["Nvidia", "NVDA"], ["Samsung Electronics", null], ["Apple", "AAPL"], ["Broadcom", "AVGO"]];
  const posts = Array.from({ length: 250 }, (_, i) => ({ slug: `f${i}`, symbol: `F${i}`, companyName: `F${i} Corp`, category: "", domain: "", title: "", date: "2026-10-01", summary: "", disclaimer: "", supplyChainNote: "", customersNote: "",
    supplyChain: [E(...hubsOf[i % 8]), ...(i % 3 ? [] : [E(...hubsOf[(i * 7) % 8])])], customers: [] }));
  // Uneven sectors: Technology large, a few mid-sized, some slivers too short to label.
  const weights = [60, 12, 30, 25, 20, 8, 40, 3, 2, 15, 30, 5];
  const cum = weights.map((w, i) => weights.slice(0, i + 1).reduce((a, b) => a + b, 0)), tot = cum.at(-1);
  const sectorOf = (sym) => { const k = (Number(sym.slice(1)) * 37) % tot; return names[cum.findIndex((c) => k < c)]; };
  const web = H.buildDependencyWeb(posts, H.buildHubCompanies(posts), 8, sectorOf);
  const body = renderToStaticMarkup(React.createElement("div", { className: "bnWebBlock", style: { maxWidth: 560, margin: "0 auto" } }, React.createElement(Web, { web })));
  for (const width of [1280, 600]) {
    for (const root of [16, 20]) {
      const page = await open(browser, width, `<style>html{font-size:${root}px}</style>${body}`);
      const r = await page.evaluate(() => {
        const svg = document.querySelector(".bnWeb");
        const glyphs = (t) => Array.from({ length: t.getNumberOfChars() }, (_, i) => t.getExtentOfChar(i));
        const labels = [...svg.querySelectorAll(".bnArcLabel")].map((t) => ({ t: t.textContent, g: glyphs(t) }));
        const hubText = [...svg.querySelectorAll(".bnHub text")].map((t) => ({ t: t.textContent, g: glyphs(t) }));
        const circles = [...svg.querySelectorAll(".bnHub circle")].map((c) => ({ x: +c.getAttribute("cx"), y: +c.getAttribute("cy"), r: +c.getAttribute("r") }));
        const hit = (a, b) => a.x < b.x + b.width - 0.3 && b.x < a.x + a.width - 0.3 && a.y < b.y + b.height - 0.3 && b.y < a.y + a.height - 0.3;
        const inCircle = (g, c) => [[g.x, g.y], [g.x + g.width, g.y], [g.x, g.y + g.height], [g.x + g.width, g.y + g.height]].some(([x, y]) => Math.hypot(x - c.x, y - c.y) < c.r + 2);
        const bad = [];
        labels.forEach((a, i) => {
          for (const b of [...labels.slice(i + 1), ...hubText]) if (a.g.some((x) => b.g.some((y) => hit(x, y)))) bad.push(`${a.t} / ${b.t}`);
          if (a.g.some((g) => circles.some((c) => inCircle(g, c)))) bad.push(`${a.t} on a hub`);
          if (a.g.some((g) => g.x < 0 || g.y < 0 || g.x + g.width > 560 || g.y + g.height > 520)) bad.push(`${a.t} outside the web`);
        });
        return { dots: svg.querySelectorAll(".bnStock").length, arcs: svg.querySelectorAll(".bnArc").length, labels: labels.map((x) => x.t), bundles: svg.querySelectorAll(".bnBundle").length, caption: document.querySelector(".bnCapDefault").textContent.trim(), bad };
      });
      check(`250-page fixture at ${width}px, ${root}px root: ${r.arcs} sector arcs, ${r.dots} dots, ${r.bundles} bundles, ${r.labels.length} labels (${r.labels.join(", ")}); ${r.bad.length ? `COLLIDE: ${r.bad.join("; ")}` : "no label collisions"}`,
        r.dots === 0 && r.arcs === web.arcs.length && r.arcs >= 10 && r.labels.length >= 4 && !r.bad.length && r.caption.startsWith("250 stocks that name one of these 8."));
      if (SHOTS && root === 16 && width === 1280) await page.screenshot({ path: path.join(SHOTS, "hub-250-arcs.png") });
      await page.close();
    }
  }
}

console.log("\n=== Mutants: each must be caught ===");
{
  const mut = html.replace(/\.bnWebBlock \{ display: none; \}/, "");
  const page = await open(browser, 390, mut);
  const r = await page.evaluate(probe);
  check("mutant (≤560px hide rule removed): web shows at 390px", mut !== html && r.web);
  await page.close();
}
{
  const page = await open(browser, 360, html.replace('<div class="bnStatTiles"', '<div style="width:600px">x</div><div class="bnStatTiles"'));
  const r = await page.evaluate(probe);
  check("mutant (a 600px element in the hero): caught as sideways scroll at 360px", r.scrolls);
  await page.close();
}
{
  const page = await open(browser, 1280, html.replace("These are the companies those pages name most often.", '<span style="font-size:14px">These are the companies those pages name most often.</span>'));
  const bad = await page.evaluate(readingScan);
  check("mutant (a hero sentence at 14px): caught by the reading-size scan", bad.some((b) => /sentence at 14px/.test(b)));
  await page.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
