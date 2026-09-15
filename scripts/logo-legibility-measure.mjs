// Measures the two legibility problems in claude/BRIEF-logo-legibility-2026-09-15.md
// against the committed logos, so the fix can be checked rather than asserted.
//
// The brief's own probe ran in a browser console over 78 large caps. This does
// the same three measurements with sharp over EVERY committed file, which is
// both wider and reproducible in CI.
//
// ── THE TRAP THE BRIEF FLAGS, PRESERVED HERE ──────────────────────────────
// An ALPHA-ONLY bounding box reports AAPL as filling 100% of its frame, because
// its margin is opaque white rather than transparent. The fill measurement below
// is therefore taken against the CORNER COLOUR, not against alpha. Measuring
// alpha alone concluded there was no padding problem at all.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DIR = process.argv[2] || "public/logos";
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);

// WCAG relative luminance, on linearised sRGB.
function luminance(r, g, b) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
// Against the chip's white. Ratio is 1.0 for pure white, 21 for pure black.
const contrastVsWhite = (r, g, b) => 1.05 / (luminance(r, g, b) + 0.05);

async function measure(file) {
  const { data, info } = await sharp(path.join(DIR, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };

  const corner = at(0, 0);
  const opaqueBackground = corner[3] > 200;

  // Bounding box of everything that differs from the corner colour. For a
  // transparent-margin logo the corner is transparent and this reduces to the
  // alpha box; for a baked-in white margin it finds the actual mark.
  let minX = w, minY = h, maxX = -1, maxY = -1;
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = at(x, y);
      const differs =
        Math.abs(r - corner[0]) > 12 ||
        Math.abs(g - corner[1]) > 12 ||
        Math.abs(b - corner[2]) > 12 ||
        Math.abs(a - corner[3]) > 12;
      if (differs) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (a > 16) { sr += r; sg += g; sb += b; n += 1; }
    }
  }
  const fill =
    maxX < 0 ? 0 : Math.max((maxX - minX + 1) / w, (maxY - minY + 1) / h);
  const mean = n ? [sr / n, sg / n, sb / n] : [255, 255, 255];
  // What survives compositing onto the chip. Materialised before stats(),
  // because sharp's stats() reads the INPUT and ignores chained operations.
  const flat = await sharp(path.join(DIR, file))
    .flatten({ background: "#ffffff" })
    .toBuffer();
  const fst = await sharp(flat).stats();
  const visible = Math.max(...fst.channels.slice(0, 3).map((c) => c.stdev));

  return {
    file,
    symbol: file.replace(/\.webp$/, ""),
    w, h,
    opaqueBackground,
    fill,
    visible,
    contrast: contrastVsWhite(mean[0], mean[1], mean[2]),
  };
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".webp"));
const wanted = ONLY.length ? files.filter((f) => ONLY.includes(f.replace(/\.webp$/, ""))) : files;

const out = [];
let idx = 0;
await Promise.all(
  Array.from({ length: 16 }, async () => {
    for (;;) {
      const i = idx++;
      if (i >= wanted.length) return;
      try { out.push(await measure(wanted[i])); }
      catch (err) { out.push({ file: wanted[i], symbol: wanted[i], error: String(err?.message ?? err) }); }
    }
  })
);

const ok = out.filter((r) => !r.error);
const lowFill = ok.filter((r) => r.fill < 0.75);
const baked = ok.filter((r) => r.opaqueBackground);
// INVISIBLE IS MEASURED BY COMPOSITING, not by the mean colour's contrast.
// Contrast of the mean is a proxy that fails in a specific, common way: a mark
// that is mostly light with dark detail averages light and scores under 1.5:1
// while being perfectly legible. Measured against the committed harvest it
// flagged 203 files of which 202 were plainly visible, at 13-100 variation --
// the same class of error as the alpha-only bounding box the brief warns about,
// one layer up. `visible` below composites onto the chip's own white and asks
// what is left, which is the question a reader's eye actually answers.
const lowContrast = ok.filter((r) => r.visible < 8);

console.log(`DIR: ${DIR}`);
console.log(`measured: ${ok.length}${out.length - ok.length ? ` (${out.length - ok.length} errored)` : ""}\n`);
console.log(`mark fills <75% of frame : ${lowFill.length}  (${((lowFill.length / ok.length) * 100).toFixed(1)}%)`);
console.log(`invisible on white chip  : ${lowContrast.length}  (${((lowContrast.length / ok.length) * 100).toFixed(1)}%)  [variation <8 after compositing onto the chip]`);
console.log(`opaque baked background  : ${baked.length}\n`);

const show = (label, rows, k) => {
  console.log(`${label} (${rows.length}${rows.length > 25 ? ", first 25" : ""})`);
  for (const r of rows.sort((a, b) => a[k] - b[k]).slice(0, 25)) {
    console.log(`  ${r.symbol.padEnd(9)} fill=${(r.fill * 100).toFixed(0).padStart(3)}%  visible=${r.visible.toFixed(1)}  meanContrast=${r.contrast.toFixed(2)}  bakedBg=${r.opaqueBackground}`);
  }
  console.log();
};
show("WORST FILL", lowFill, "fill");
show("WORST — INVISIBLE ON THE CHIP", lowContrast, "visible");

if (ONLY.length) {
  console.log("REQUESTED SYMBOLS");
  for (const r of out.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    if (r.error) { console.log(`  ${r.symbol.padEnd(9)} ERROR ${r.error}`); continue; }
    console.log(`  ${r.symbol.padEnd(9)} ${r.w}x${r.h} fill=${(r.fill * 100).toFixed(0)}% visible=${r.visible.toFixed(1)} meanContrast=${r.contrast.toFixed(2)} bakedBg=${r.opaqueBackground}`);
  }
}
