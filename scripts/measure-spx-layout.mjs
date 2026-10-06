// THE SPX PAGE'S TWO ROWS, BALANCED (#563 COWORK #129), MEASURED IN CHROMIUM.
//
// Renders the real SPX server page (stubbed reads, as measure-reading-size
// does) for three weeks' shapes: the standing fixture, a week with 2 price
// zones, and one with the card's maximum of 5 (two above, two below, one the
// price sits in; the card never shows more). At 1280 and 1024 px, 16 and 20 px
// roots, it fails when:
//   - the hero: the left column (headline to tiles) and the Market Mood card
//     end more than 8 px apart, or the mood line is shorter than its 44 px;
//   - the levels row: the left column (Price zones, then Levels to watch) and
//     the right (Key levels) end more than 8 px apart;
//   - a card leaves a blank band: more than 8 px under its last line beyond
//     its own padding (Price zones, Levels to watch, Key levels), or a pole
//     shorter than the room its card gives it: the Price zones ladder up to
//     its cap, the Key levels pole up to KL_FILL_MAX × its own height; past a
//     cap the spare is split above and below it.
// At 390 px: Price zones, Key levels, Levels to watch in that order, one
// column, nothing sideways; and the heights printed, to set against main's.
// A mutant (CSS that undoes the stretch) must fail.
//
//   node scripts/measure-spx-layout.mjs [--shots DIR]
//
// NOT IN check-all: it needs Chromium and Playwright.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { register } from "node:module";

const ROOT = process.cwd();
const SHOTS = (() => { const i = process.argv.indexOf("--shots"); return i > 0 ? path.resolve(process.argv[i + 1]) : null; })();
process.env.MEASURE_STUBS = JSON.stringify({
  "@/lib/server/historyCache": "scripts/lib/measure-stubs/history-cache.mjs",
  "@/lib/server/marketData/read": "scripts/lib/measure-stubs/tiingo-read-variant.mjs",
  "@/lib/server/marketMoodRead": "scripts/lib/measure-stubs/mood-read.mjs",
});
process.env.PRICE_PROVIDER_SPX = "tiingo";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
register("./lib/tsx-render-hooks.mjs", import.meta.url);

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { default: Page } = await import("../app/markets/spx/page.tsx");
void React;

/** Weekday bars to Fri 2 Oct 2026: a slow wave, a fast one and a drift, as fixture-bars.mjs draws them. */
function bars(level, slow, slowPeriod, fast, drift) {
  const out = [];
  for (let t = Date.parse("2024-10-01T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const b = level + level * slow * Math.sin(i / slowPeriod) + level * fast * Math.sin(i / 6.1) + i * level * drift;
    out.push([d.toISOString().slice(0, 10), b, b * 1.006, b * 0.994, b * 1.001, 6e7]);
    i++;
  }
  return out;
}
const WEEKS = [
  { name: "standing fixture", bars: null },
  { name: "2 zones", bars: bars(560, 0.2, 13, 0.005, 0), zones: 2 },
  { name: "5 zones (the card's maximum)", bars: bars(560, 0.02, 13, 0.005, 0), zones: 5 },
];

const CSS = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8").replace(/@import[^;]*;|@tailwind[^;]*;|@theme inline \{[^}]*\}/g, "");
const doc = (body, root, extra = "") => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style><style>html{font-size:${root}px}${extra}</style></head><body>${body}</body></html>`;
/** THE MUTANT: the stretch taken away, the rows sized by their content again. */
const NO_STRETCH = ".spxHeroGrid{align-items:start!important}.spxLevels{align-items:start!important;grid-template-rows:auto auto!important}.spxZonesCell .czCard,.spxKeysCell .klCard{flex:none!important}.czFill,.czLadder[data-fill],.klFill,.klPole[data-fill]{flex:none!important}.moodSparkPlot{flex:none!important}";

function probe() {
  const box = (el) => el?.getBoundingClientRect();
  const q = (s) => document.querySelector(s);
  const hero = q(".spxHeroGrid"), heroLeft = hero?.children[0], mood = q(".moodCard"), plot = q(".moodSparkPlot");
  const zones = q(".spxZonesCell"), glance = q(".spxGlanceCell"), keys = q(".spxKeysCell"), kl = q(".klCard"), cz = q(".czCard"), ladder = q(".czLadder"), fillBox = q(".czFill");
  // A card's blank band: the room under its last in-flow child, beyond its own padding.
  const lastLine = (card) => {
    const b = box(card);
    let bottom = b.top;
    for (const el of card.children) { const st = getComputedStyle(el); if (st.position !== "absolute" && st.display !== "none") bottom = Math.max(bottom, el.getBoundingClientRect().bottom + parseFloat(st.marginBottom)); }
    return b.bottom - parseFloat(getComputedStyle(card).paddingBottom) - bottom;
  };
  const pole = q(".klPole"), klFill = q(".klFill");
  return {
    sideways: document.documentElement.scrollWidth > innerWidth,
    heroGap: Math.abs(box(heroLeft).bottom - box(mood).bottom), plotH: box(plot)?.height ?? 0,
    levelsGap: Math.abs(box(glance).bottom - box(keys).bottom),
    keysSpare: lastLine(kl), glanceSpare: lastLine(q(".lgCard")), zonesSpare: lastLine(cz),
    poleH: box(pole)?.height ?? 0, poleFillH: box(klFill)?.height ?? 0, poleMax: parseFloat(getComputedStyle(pole).maxHeight) || 0, poleMin: parseFloat(getComputedStyle(pole).minHeight) || 0,
    ladderH: box(ladder)?.height ?? 0, fillH: box(fillBox)?.height ?? 0, ladderMin: parseFloat(ladder?.style.minHeight ?? "0"), ladderMax: parseFloat(ladder?.style.maxHeight ?? "0"),
    zonesCount: document.querySelectorAll(".czBand").length,
    order: [zones, keys, glance].map((el) => Math.round(box(el).top)),
    oneColumn: Math.abs(box(zones).left - box(keys).left) < 1 && Math.abs(box(keys).left - box(glance).left) < 1,
    debug: Object.fromEntries([".spxLevels", ".spxZonesCell", ".czCard", ".czFill", ".czLadder", ".spxGlanceCell", ".lgCard", ".spxKeysCell", ".klCard", ".klPole"].map((s) => [s, q(s) ? [Math.round(box(q(s)).top), Math.round(box(q(s)).bottom)] : null])),
    heights: { hero: Math.round(box(q(".spxHero")).height), mood: Math.round(box(mood).height), zones: Math.round(box(cz).height), keys: Math.round(box(kl).height), glance: Math.round(box(q(".lgCard")).height), plot: Math.round(box(plot)?.height ?? 0), ladder: Math.round(box(ladder)?.height ?? 0) },
  };
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
let failures = 0;
const fail = (msg) => { console.log(`    FAIL ${msg}`); failures++; };
for (const week of WEEKS) {
  globalThis.__SPX_BARS = week.bars ?? undefined;
  const html = renderToStaticMarkup(await Page());
  console.log(`\n${week.name}`);
  for (const root of [16, 20]) {
    for (const width of [1280, 1024, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.setContent(doc(html, root));
      const r = await page.evaluate(probe);
      console.log(`  ${width}px @ ${root}px: zones ${r.zonesCount} · hero gap ${r.heroGap.toFixed(1)} · levels gap ${r.levelsGap.toFixed(1)} · spare (zones/glance/keys) ${r.zonesSpare.toFixed(0)}/${r.glanceSpare.toFixed(0)}/${r.keysSpare.toFixed(0)} · ladder ${r.ladderH.toFixed(0)} of ${r.fillH.toFixed(0)} · pole ${r.poleH.toFixed(0)} of ${r.poleFillH.toFixed(0)} (cap ${r.poleMax.toFixed(0)}) · heights ${JSON.stringify(r.heights)}`);
      if (process.env.SPX_DEBUG) console.log(JSON.stringify(r.debug));
      if (week.zones && r.zonesCount !== week.zones) fail(`expected ${week.zones} zones, drew ${r.zonesCount}`);
      if (r.sideways) fail("the page scrolls sideways");
      if (width >= 1024) {
        if (r.heroGap > 8) fail(`hero columns end ${r.heroGap.toFixed(1)} px apart`);
        if (r.plotH < 44 - 0.5) fail(`the mood line is ${r.plotH.toFixed(1)} px, under its 44`);
        if (r.levelsGap > 8) fail(`levels columns end ${r.levelsGap.toFixed(1)} px apart`);
        for (const [n, v] of [["Key levels", r.keysSpare], ["Levels to watch", r.glanceSpare], ["Price zones", r.zonesSpare]]) if (v > 8) fail(`${n} has a ${v.toFixed(1)} px blank band under its last line`);
        if (r.poleH < Math.min(r.poleFillH, r.poleMax) - 1) fail(`the Key levels pole (${r.poleH.toFixed(0)} px) is shorter than its room (${r.poleFillH.toFixed(0)} px, cap ${r.poleMax})`);
        // The ladder takes its card's room up to its cap; past the cap the rest is split above and below it.
        if (r.ladderH < Math.min(r.fillH, r.ladderMax) - 1) fail(`the ladder (${r.ladderH.toFixed(0)} px) is shorter than its room (${r.fillH.toFixed(0)} px, cap ${r.ladderMax})`);
      } else {
        if (!r.oneColumn || !(r.order[0] < r.order[1] && r.order[1] < r.order[2])) fail("at 390 px the order is not Price zones, Key levels, Levels to watch in one column");
        if (Math.abs(r.ladderH - r.ladderMin) > 0.5) fail(`at 390 px the ladder (${r.ladderH}) is not its own height (${r.ladderMin})`);
        if (Math.abs(r.poleH - r.poleMin) > 0.5) fail(`at 390 px the Key levels pole (${r.poleH}) is not its own height (${r.poleMin})`);
      }
      if (SHOTS && root === 16) {
        fs.mkdirSync(SHOTS, { recursive: true });
        const tag = `${week.bars ? week.zones : "fixture"}-${width}`;
        await page.locator(".spxHero").screenshot({ path: path.join(SHOTS, `spx-hero-${tag}.png`) });
        await page.locator(".spxLevels").screenshot({ path: path.join(SHOTS, `spx-levels-${tag}.png`) });
      }
      await page.close();
    }
  }
}
// THE MUTANT: the same pages with the stretch undone must fail somewhere at desktop widths.
{
  globalThis.__SPX_BARS = undefined;
  const html = renderToStaticMarkup(await Page());
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.setContent(doc(html, 16, NO_STRETCH));
  const r = await page.evaluate(probe);
  const caught = r.heroGap > 8 || r.levelsGap > 8 || r.keysSpare > 8 || r.glanceSpare > 8 || r.zonesSpare > 8;
  console.log(`\nmutant (no stretch): hero gap ${r.heroGap.toFixed(1)} · levels gap ${r.levelsGap.toFixed(1)} · ${caught ? "caught" : "NOT CAUGHT"}`);
  if (!caught) failures++;
  await page.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
