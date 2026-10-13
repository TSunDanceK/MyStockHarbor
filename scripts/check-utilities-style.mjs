// /utilities IN THE SITE'S PALETTE (#563 COWORK #166 PR 4).
//
// Renders the real /utilities page (server markup, the repo's render hooks:
// the page, its calculators panel and their shared styles). It fails when:
//   1. an emoji or pictograph icon is drawn (the round emoji badges are gone;
//      the ⚠ beside a poor risk / reward is a warning glyph, not an icon);
//   2. anything is painted with a gradient or a glow;
//   3. the section eyebrows use more than one hue, or the cards, panels and
//      tiles leave the site's palette (#0d1422 / #1f2b44 cards, #0f1624 /
//      #222c40 tiles);
//   4. green, amber or red appear anywhere but a result's risk border (and
//      the red ⚠ warning glyph).
// A mutant each.
//
//   node scripts/check-utilities-style.mjs
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./lib/tsx-render-hooks.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const React = await import("react");

const DIR = "app/utilities", STYLES = `${DIR}/utilitiesStyles.ts`, PANEL = `${DIR}/CalculatorsPanel.tsx`, PAGE = `${DIR}/page.tsx`;
const read = (f) => fs.readFileSync(f, "utf8");
const ICON = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26A0}\u{26A1}-\u{27BF}\u{2139}]\u{FE0F}?/u;
const GLYPH_OK = /⚠/g; // the risk / reward warning glyph

let seq = 0;
/** Render the page from (possibly mutated) copies of its three files. */
async function render(src) {
  const tag = `${process.pid}-${seq++}`, name = (f) => path.join(DIR, `.check-us-${tag}-${path.basename(f)}`);
  const styles = name(STYLES), panel = name(PANEL), page = name(PAGE);
  const fix = (s) => s.replaceAll('from "./utilitiesStyles"', `from "./${path.basename(styles, ".ts")}"`).replaceAll('from "./CalculatorsPanel"', `from "./${path.basename(panel, ".tsx")}"`);
  fs.writeFileSync(styles, src.styles); fs.writeFileSync(panel, fix(src.panel)); fs.writeFileSync(page, fix(src.page));
  try {
    const { default: Page } = await import(pathToFileURL(path.resolve(page)).href);
    return renderToStaticMarkup(React.createElement(Page));
  } finally { for (const f of [styles, panel, page]) fs.rmSync(f, { force: true }); }
}

function rules(html) {
  const fails = [], want = (l, ok) => { if (!ok) fails.push(l); };
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "");
  want("no emoji or pictograph icons (the ⚠ risk glyph aside)", !ICON.test(body.replace(GLYPH_OK, "")));
  want("no gradients or glows", !/gradient\(|box-shadow:0 0 \d/.test(body));
  const eyebrows = new Set([...body.matchAll(/text-transform:uppercase;color:(#[0-9a-f]{6})/g)].map((m) => m[1]));
  want("one eyebrow hue", eyebrows.size === 1 && eyebrows.has("#93c5fd"));
  const bgs = new Set([...body.matchAll(/background:(#[0-9a-f]{6}|rgba?\([^)]*\))/g)].map((m) => m[1]));
  const allowedBg = new Set(["#0d1422", "#0f1624", "#06080d", "rgba(255,255,255,0.15)"]); // the last: the neutral "?" help chips
  want("cards, panels and tiles in the site's palette", [...bgs].every((b) => allowedBg.has(b)) && /background:#0d1422/.test(body) && /border:1px solid #1f2b44/.test(body) && /background:#0f1624/.test(body));
  // Green / amber / red only on a result box's border.
  const coloured = [...body.matchAll(/(?:color|background|border)(?:-[a-z]+)?:[^;"]*(?:rgba\((?:34,197,94|234,179,8|250,204,21|239,68,68)|#86efac|#fde68a|#fca5a5|#22c55e|#ef4444)[^;"]*/g)].map((m) => m[0]);
  // ...and the red ⚠ beside a poor risk / reward (a warning, so it keeps its colour).
  want("green / amber / red only as a result's risk border (and the ⚠ warning glyph)", coloured.every((c) => /^border:1px solid rgba\((34,197,94|234,179,8|239,68,68),0\.(38|40)\)$/.test(c) || c === "color:#ef4444"));
  return fails;
}

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const SRC = { styles: read(STYLES), panel: read(PANEL), page: read(PAGE) };
const real = rules(await render(SRC));
check("/utilities is in the site's palette", real.length === 0, real.join("; "));

for (const [label, key, from, to] of [
  ["an emoji icon back", "panel", '<div style={{ fontWeight: 900 }}>What this tool does</div>', '<div>✅</div><div style={{ fontWeight: 900 }}>What this tool does</div>'],
  ["a gradient back on the panels", "styles", "return { border: CARD_BORDER, borderRadius: 20, padding: 18, background: CARD_BG };", 'return { border: CARD_BORDER, borderRadius: 20, padding: 18, background: "linear-gradient(180deg, rgba(8,22,45,0.94), rgba(7,18,36,0.98))" };'],
  ["rainbow eyebrows back", "styles", "    color: EYEBROW,\n  };", '    color: _type === "green" ? "#86efac" : _type === "yellow" ? "#fde68a" : EYEBROW,\n  };'],
  ["a coloured callout back", "styles", "return { borderRadius: 16, border: TILE_BORDER, background: TILE_BG, padding: 16 };", 'return { borderRadius: 16, border: _type === "red" ? "1px solid rgba(239,68,68,0.24)" : TILE_BORDER, background: TILE_BG, padding: 16 };'],
  ["a tinted result fill back", "styles", 'if (type === "green") return { ...base, border: "1px solid rgba(34,197,94,0.38)" };', 'if (type === "green") return { ...base, border: "1px solid rgba(34,197,94,0.38)", background: "rgba(34,197,94,0.18)" };'],
]) {
  if (!SRC[key].includes(from)) { check(`mutant "${label}" applies`, false, "matched nothing"); continue; }
  let f;
  try { f = rules(await render({ ...SRC, [key]: SRC[key].replace(from, to) })); } catch (e) { f = [`threw: ${e.message}`]; }
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}
console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
