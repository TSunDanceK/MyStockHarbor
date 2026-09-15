// PHASE 2 of claude/BRIEF-logo-harvest-2026-09-14.md: fetch every logo FMP's
// image CDN actually holds, transcode it, and commit the result so the site
// serves its own assets instead of hotlinking FMP on every page view.
//
// WHY THIS IS NOT A RELAY TASK, despite Phase 0 being one. The relay cannot
// deliver this phase's output, for two independent reasons:
//   1. sharp needs node_modules, and the read-only relay job deliberately runs
//      no `npm ci` -- scripts/check-relay-isolation.mjs ASSERTS that, because
//      not installing @upstash/redis is the second layer of the credential
//      split. Adding npm ci there would fail the guard and weaken a real
//      security property for an unrelated reason.
//   2. relay.yml declares no `permissions:`, and its artifact upload globs are
//      a fixed list on main that public/logos/ does not match. The output of
//      this phase is ~2,600 files that must land IN the repo, and the agent
//      sandbox cannot download Actions artifacts at all (the blob host is
//      refused, re-confirmed this session).
// So the harvest gets its own PUSH-TRIGGERED workflow, which runs from the
// feature branch without existing on main -- the same mechanism
// gen-learn-images.yml already uses. That keeps the brief's actual requirement
// (no merge-to-main toll) while getting write permission the relay lacks.
//
// NO SYMDIR HERE, unlike the Phase 0 probe. The probe needed Nasdaq's directory
// for the Exchange and ETF columns it split on; the harvest needs none of that,
// so the universe comes from committed files only and this script has no
// external dependency beyond the CDN itself.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const UA =
  process.env.HARVEST_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; logo harvest)";
const CONCURRENCY = Number(process.env.HARVEST_CONCURRENCY ?? 8);
const LIMIT = Number(process.env.HARVEST_LIMIT ?? 0); // 0 = no cap; >0 for smoke runs
const OUT_DIR = process.env.HARVEST_OUT_DIR ?? "public/logos";
const MANIFEST = process.env.HARVEST_MANIFEST ?? "data/logo-manifest.json";

// ── THE THREE SOURCE-SHAPE RULES, from Phase 0's measured dimensions ──────
// Phase 0 found 35 sources NARROWER than the render target, down to 16px. An
// upscaled 32px logo looks worse than the monogram it would replace, so size is
// a decision here rather than something the resizer is left to do blindly.
const TARGET = 72;   // one size only: TickerLogo's largest render is 34px, so
                     // 72 already exceeds 2x everywhere and @2x would be dead weight
const FLOOR = 24;    // narrower than this renders worse than the monogram
// Below this standard deviation, once composited onto the chip's white, there is
// nothing for a viewer to see. Measured: real logos sit far above it (MU 93,
// NVDA 87, the plainest two-tone ETF marks ~72); the blanks sat at exactly 0,
// with only AI at 0.34 and BWA at 0.06 anywhere near.
const BLANK_STDEV = 2;

// ── LEGIBILITY PASS, claude/BRIEF-logo-legibility-2026-09-15.md ───────────
// Below this contrast ratio against the chip's white, a mark does not read at
// all. Measured over the committed harvest, 223 of 2,622 marks (8.5%) are white
// on transparency and land at ~1.00:1 -- V, UNH, IBM, CAT, BA, DIS, NKE among
// them. A RATIO rather than a luminance threshold, because the thing being
// decided is contrast against a known background, and a mark that is mostly
// light with dark detail would be misjudged by mean luminance alone.
const MIN_CONTRAST = 1.5;
// The chip paints #ffffff behind the image (TickerLogo's box), so that is what
// a mark has to be legible against.
const CHIP_BG = { r: 255, g: 255, b: 255 };
// COLORS.cardBg from DashboardClient -- the card these chips sit on. Taken from
// the palette rather than invented, per the brief, and it matches what the site
// already ships: 305 harvested logos arrive with their own dark baked
// background, median rgb(15,44,82), the same dark-navy family.
const BACKING = { r: 0x14, g: 0x1b, b: 0x2b, alpha: 1 };
// Margin around a mark placed on that backing, so it does not touch the edge.
const INSET = 0.12;
// Trim that removes more than this of BOTH dimensions is treated as a misfire
// rather than a tight crop, and the untrimmed original is kept.
const TRIM_SUSPICIOUS = 0.6;
// This pass changes how logos LOOK, not which ones harvest. A count that moves
// by more than this means something else happened, so the run stops instead of
// committing. ~1% of the 2,622 the harvest settled on.
const COUNT_DRIFT_LIMIT = Number(process.env.HARVEST_COUNT_DRIFT ?? 25);
// Above this, public/ stops being the right home and that is the owner's call.
const BYTE_CEILING = Number(process.env.HARVEST_BYTE_CEILING ?? 10 * 1024 * 1024);

const pad = (s, n) => String(s).padEnd(n);

function universe() {
  const cn = Object.keys(JSON.parse(fs.readFileSync("data/company-names.json", "utf8")).rows);
  const sp = Object.keys(JSON.parse(fs.readFileSync("data/static-profile.json", "utf8")).rows);
  const src = fs.readFileSync("lib/curatedSymbols.ts", "utf8");
  const curated = [...new Set([...src.matchAll(/"([A-Z][A-Z0-9.\-]{0,6})"/g)].map((m) => m[1]))];
  return [...new Set([...cn, ...sp, ...curated])].sort();
}

async function runPool(items, worker, size) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await worker(items[i], i);
      }
    })
  );
  return out;
}

// WCAG relative luminance on linearised sRGB, and the ratio against the chip.
function luminance(r, g, b) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastRatio(a, b) {
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Crop a uniform border, with the guards the brief requires.
 *
 * WHY THIS FIXES THE SIZING PROBLEM. A handful of sources carry an OPAQUE baked
 * margin with the mark floating inside it -- AAPL fills 49% of its own frame,
 * BRK.B 67%. object-fit: contain then correctly fits the whole image, margin
 * included, so the mark renders small. trim() crops a flat border using the
 * top-left pixel as reference, so it removes baked white exactly as it removes
 * transparent padding, and it is a NO-OP on the marks that already fill their
 * frame. That is what makes it safe to apply to everything rather than to a
 * hand-maintained list -- scaling up globally would crop or distort the
 * majority to fix a handful.
 */
async function trimBorder(input, width, height) {
  try {
    const { data, info } = await sharp(input).trim().toBuffer({ resolveWithObject: true });
    if (!info?.width || !info?.height || info.width < 2 || info.height < 2) {
      return { buf: input, width, height, note: "trim-empty" };
    }
    // Suspicious only when BOTH dimensions collapse. A wordmark legitimately
    // loses most of one dimension and none of the other.
    if (info.width < width * (1 - TRIM_SUSPICIOUS) && info.height < height * (1 - TRIM_SUSPICIOUS)) {
      return { buf: input, width, height, note: "trim-suspicious" };
    }
    const trimmedAway = info.width < width || info.height < height;
    return { buf: data, width: info.width, height: info.height, note: trimmedAway ? "trimmed" : "no-op" };
  } catch {
    // sharp throws when an image is entirely uniform. The blank guard below is
    // the thing that should judge that, not this.
    return { buf: input, width, height, note: "trim-threw" };
  }
}

/** Contrast of the mark's mean colour against the chip it will sit on. */
async function markContrast(buf) {
  const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 16) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1; }
  }
  const mean = n ? [r / n, g / n, b / n] : [255, 255, 255];
  return contrastRatio(luminance(...mean), luminance(CHIP_BG.r, CHIP_BG.g, CHIP_BG.b));
}

/**
 * Does the image carry its own background? Asked of the ORIGINAL, never the
 * trimmed copy, and that is the whole point.
 *
 * Trim removes the transparent margin, so after it a mark that fills its own
 * bounding box has an OPAQUE corner and reads as "already has a background" --
 * which is exactly backwards for the white marks this pass exists to rescue.
 * A fixture of a solid white square on transparency caught it: the trimmed copy
 * reported an opaque corner and the backing was never applied, leaving it as
 * invisible as before. The untrimmed original still has its margin, so its
 * corner answers the question the condition is actually asking.
 */
async function carriesOwnBackground(buf) {
  const { data, info } = await sharp(buf)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return info.channels >= 4 ? data[3] > 200 : true;
}

async function harvest(symbol) {
  const url = `https://images.financialmodelingprep.com/symbol/${encodeURIComponent(symbol)}.png`;

  // ONE RETRY ON A TRANSPORT ERROR OR A 5xx, and none on a 404. A 404 is the
  // CDN's real answer and retrying it just doubles the request count, but a
  // dropped connection is not an answer at all -- and across 2,653 calls a
  // single transient failure would otherwise write a WRONG MANIFEST: the symbol
  // would be silently absent, so TickerLogo would never ask for a file that
  // should exist. Phase 0 saw zero errors, so this should never fire; it is
  // here because the failure it prevents is invisible rather than loud.
  let res = null;
  let transport = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
      transport = null;
      if (res.status < 500) break;
    } catch (err) {
      res = null;
      transport = String(err?.message ?? err);
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
  }
  if (!res) return { symbol, ok: false, reason: `fetch-failed after retry: ${transport}` };
  if (!res.ok) return { symbol, ok: false, reason: `no-logo-on-cdn (HTTP ${res.status})` };

  const input = Buffer.from(await res.arrayBuffer());

  try {
    // sharp's own metadata, NOT the IHDR parse the probe used. The probe could
    // only read bytes it had already fetched; here the decoder is present, so
    // it answers for every format -- including the 4 payloads served under a
    // .png name that carry no PNG header. Those are attempted like anything
    // else and skipped only if the decoder actually fails, per the brief.
    // NO RAW BYTE-SIZE GUARD HERE, deliberately. Phase 0 treated a sub-200-byte
    // 200 as a placeholder because it had no decoder and byte size was the only
    // proxy available. With sharp present the honest test is the image itself,
    // and the width floor below SUBSUMES the byte check: the placeholder shape
    // that guard existed to catch (a 1x1 or blank chip) fails the floor anyway.
    // Keeping both would be strictly worse -- a small but valid logo would be
    // skipped and mislabelled "placeholder", which a synthetic test caught.
    const meta = await sharp(input).metadata();
    const srcWidth = meta.width ?? 0;
    if (!srcWidth) return { symbol, ok: false, reason: "undecodable: no width in metadata" };

    // ── 1. TRIM, BEFORE THE RESIZE ──────────────────────────────────────
    const trimmed = await trimBorder(input, srcWidth, meta.height ?? srcWidth);
    const width = trimmed.width;

    // ── 2. THE FLOOR IS RE-CHECKED AGAINST THE TRIMMED WIDTH ────────────
    // Deliberately after the trim, not before. A 32px source whose mark
    // occupies a corner of its frame can land under the floor once the margin
    // is gone, and the old rule was written against the untrimmed width.
    // Checking first would keep exactly the upscaled mush the floor exists to
    // reject, and the mistake would be invisible -- it renders, just badly.
    if (width < FLOOR) {
      return {
        symbol,
        ok: false,
        reason: `source-too-small (${width}px < ${FLOOR}px floor, after trim from ${srcWidth}px)`,
      };
    }

    const target = Math.min(TARGET, width);

    // ── 3. BAKE CONTRAST IN WHERE THE MARK WOULD BE INVISIBLE ───────────
    // TickerLogo cannot pick a chip colour per symbol: that needs a per-symbol
    // lookup, which is exactly what #458 removed for costing 6.4 KB gzipped on
    // every page. So the contrast has to live in the image.
    // Contrast from the trimmed copy (trim only crops uniform border, so the
    // opaque pixels -- and their mean -- are unchanged); the background question
    // from the ORIGINAL, for the reason in carriesOwnBackground's header.
    const contrast = await markContrast(trimmed.buf);
    const ownBackground = await carriesOwnBackground(input);
    const needsBacking = contrast < MIN_CONTRAST && !ownBackground;

    let out;
    if (needsBacking) {
      const inner = Math.max(1, Math.round(target * (1 - 2 * INSET)));
      const mark = await sharp(trimmed.buf)
        .resize({
          width: inner,
          height: inner,
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      out = await sharp({
        create: { width: target, height: target, channels: 4, background: BACKING },
      })
        .composite([{ input: mark, gravity: "centre" }])
        .webp({ quality: 90, effort: 6 })
        .toBuffer();
    } else {
      out = await sharp(trimmed.buf)
        .resize({
          width: target,
          height: target,
          fit: "contain",
          // Transparent padding, and withoutEnlargement so the no-upscale rule
          // holds even for a source that is narrow but tall.
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          withoutEnlargement: true,
        })
        .webp({ quality: 90, effort: 6 })
        .toBuffer();
    }

    // ── BLANKNESS, MEASURED ON THE IMAGE ITSELF ─────────────────────────
    // A spot-check of the first harvest found files that decode perfectly at
    // 72x72 and carry no content at all -- KNX and NGVT among them. Neither
    // earlier guard catches that shape: the width floor passes (they are full
    // size) and a byte-size floor passes (Q's source is 43 KB at 1596px). A
    // blank chip is worse than the monogram it replaces and worse than a 404,
    // because nothing downstream can tell it failed -- <img> fires load, not
    // error, so the fallback chain never advances.
    //
    // THE TEST IS BACKGROUND-INDEPENDENT, and that correction matters. An
    // earlier version composited onto the chip's white and measured that, which
    // flagged 166 files including IBM, DIS, NKE and V. Those are NOT blank:
    // their marks are WHITE on transparency, so they vanish against white while
    // being perfectly good images. Skipping them would have silently dropped
    // a hundred major brands on a measurement error. Their invisibility against
    // a white chip is a real and separate issue, it predates this change (the
    // same PNG renders into the same white box today), and it is the owner's
    // call -- not something a harvest should decide by deleting files.
    //
    // So "blank" means the IMAGE has no variation anywhere:
    //   fully transparent            -> nothing to see on any background
    //   flat colour AND flat alpha   -> one uniform square
    // A mark of any single colour, white included, varies in alpha and is kept.
    const st = await sharp(out).stats();
    const rgbStdev = Math.max(...st.channels.slice(0, 3).map((c) => c.stdev));
    const alphaCh = st.channels[3];
    const fullyTransparent = Boolean(alphaCh) && alphaCh.max === 0;
    const flatEverywhere = rgbStdev < BLANK_STDEV && (!alphaCh || alphaCh.stdev < BLANK_STDEV);
    if (fullyTransparent || flatEverywhere) {
      return {
        symbol,
        ok: false,
        reason:
          `blank-image (${fullyTransparent ? "fully transparent" : "uniform colour"}; ` +
          `rgbStdev=${rgbStdev.toFixed(2)} alphaStdev=${alphaCh ? alphaCh.stdev.toFixed(2) : "n/a"}; ` +
          `source ${input.length}B ${srcWidth}px)`,
      };
    }

    fs.writeFileSync(path.join(OUT_DIR, `${symbol}.webp`), out);
    return {
      symbol,
      ok: true,
      bytes: out.length,
      sourceWidth: width,
      srcWidth,
      target,
      trim: trimmed.note,
      backed: needsBacking,
      contrast,
    };
  } catch (err) {
    return { symbol, ok: false, reason: `sharp-failed: ${String(err?.message ?? err).split("\n")[0]}` };
  }
}

// ── RUN ───────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });

// THE OUTPUT DIRECTORY IS CLEARED FIRST, so it always describes THIS run and
// not the union of every run before it. Without this, a symbol that used to
// harvest and is now skipped -- a logo pulled from the CDN, or one the blank
// guard newly rejects -- keeps its stale file on disk while dropping out of the
// manifest. That is the one state the component cannot cope with: the file is
// live at its URL, but nothing points at it and nothing prunes it.
let cleared = 0;
for (const f of fs.readdirSync(OUT_DIR)) {
  if (f.endsWith(".webp")) {
    fs.unlinkSync(path.join(OUT_DIR, f));
    cleared += 1;
  }
}
if (cleared) console.log(`cleared ${cleared} file(s) from a previous run\n`);

let symbols = universe();
if (LIMIT > 0) symbols = symbols.slice(0, LIMIT);

console.log("LOGO HARVEST — Phase 2 + legibility pass");
console.log(`User-Agent: ${UA}`);
console.log(`target ${TARGET}px · floor ${FLOOR}px (checked AFTER trim) · concurrency ${CONCURRENCY}`);
console.log(`backing #${[BACKING.r, BACKING.g, BACKING.b].map((v) => v.toString(16).padStart(2, "0")).join("")} below ${MIN_CONTRAST}:1 vs the white chip · inset ${(INSET * 100).toFixed(0)}%`);
console.log(`universe: ${symbols.length} symbols${LIMIT ? ` (capped at ${LIMIT})` : ""}\n`);

const t0 = Date.now();
const results = await runPool(symbols, (s) => harvest(s), CONCURRENCY);
const wall = (Date.now() - t0) / 1000;

const kept = results.filter((r) => r.ok);
const skipped = results.filter((r) => !r.ok);
const totalBytes = kept.reduce((a, r) => a + r.bytes, 0);

// THE MANIFEST IS WHAT THE COMPONENT TRUSTS, so it is derived from files that
// were actually written -- never from the symbol list that was attempted.
// A skipped symbol absent from it is what makes the fallback chain correct.
const manifest = kept.map((r) => r.symbol).sort();

// ── STOP RATHER THAN COMMIT, per the legibility brief ────────────────────
// Checked BEFORE the manifest is written, so a bad run leaves the previous
// harvest intact and exits non-zero. The workflow's commit step has no
// `if: always()`, so a failure here means nothing is committed -- which is the
// whole point: a run that quietly dropped 200 logos would otherwise land as a
// perfectly clean-looking commit.
const previous = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")).length : 0;
const drift = previous ? Math.abs(manifest.length - previous) : 0;
if (previous && drift > COUNT_DRIFT_LIMIT) {
  console.error(
    `\nFATAL: file count moved from ${previous} to ${manifest.length} (${drift} symbols, ` +
      `limit ${COUNT_DRIFT_LIMIT}). The legibility pass should not change WHICH logos ` +
      `harvest, only how they look. The manifest is UNCHANGED and the job fails, so ` +
      `nothing is committed. Investigate before re-running.`
  );
  process.exit(1);
}
if (totalBytes > BYTE_CEILING) {
  console.error(
    `\nFATAL: total ${(totalBytes / 1048576).toFixed(2)} MB exceeds the ${(BYTE_CEILING / 1048576).toFixed(0)} MB ` +
      `ceiling. Compositing adds opaque pixels so growth is expected, but clearing this ` +
      `reopens the storage decision settled in the harvest brief. The manifest is ` +
      `UNCHANGED and the job fails, so nothing is committed.`
  );
  process.exit(1);
}

fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest)}\n`);

console.log("RESULT");
console.log(`  files written : ${kept.length}`);
console.log(`  total bytes   : ${totalBytes} (${(totalBytes / 1048576).toFixed(2)} MB)`);
console.log(`  mean file     : ${kept.length ? Math.round(totalBytes / kept.length) : 0} bytes`);
console.log(`  skipped       : ${skipped.length}`);
console.log(`  wall-clock    : ${wall.toFixed(1)}s`);
console.log(`  manifest      : ${MANIFEST} (${manifest.length} entries)\n`);

// ── LEGIBILITY PASS ACCOUNTING ────────────────────────────────────────────
const trimmedCount = kept.filter((r) => r.trim === "trimmed").length;
const noopCount = kept.filter((r) => r.trim === "no-op").length;
const suspicious = kept.filter((r) => r.trim === "trim-suspicious");
const threw = kept.filter((r) => r.trim === "trim-threw" || r.trim === "trim-empty");
const backed = kept.filter((r) => r.backed);
console.log("LEGIBILITY PASS");
console.log(`  trimmed (border removed) : ${trimmedCount}`);
console.log(`  trim was a no-op         : ${noopCount}`);
console.log(`  trim rejected by guard   : ${suspicious.length} suspicious + ${threw.length} empty/threw`);
console.log(`  dark backing applied     : ${backed.length}  (contrast <${MIN_CONTRAST}:1 vs the white chip)`);
if (suspicious.length) {
  console.log(`  SUSPICIOUS TRIMS, original kept: ${suspicious.map((r) => r.symbol).join(" ")}`);
}
console.log();

const nativeKept = kept.filter((r) => r.target < TARGET);
console.log(`KEPT AT NATIVE SIZE (source ${FLOOR}-${TARGET}px, not upscaled): ${nativeKept.length}`);
for (const r of nativeKept) console.log(`  ${pad(r.symbol, 8)} ${r.sourceWidth}px`);
console.log();

// EVERY skipped symbol with its reason -- the brief asks for the full list in
// the PR body, so it is printed in full rather than sampled.
const byReason = new Map();
for (const r of skipped) {
  const key = r.reason.replace(/\(HTTP \d+\)/, "(HTTP …)").replace(/\(\d+px/, "(…px").replace(/\(\d+ bytes\)/, "(… bytes)");
  byReason.set(key, (byReason.get(key) ?? 0) + 1);
}
console.log("SKIPPED BY REASON");
for (const [k, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${pad(n, 5)} ${k}`);
console.log();

console.log(`EVERY SKIPPED SYMBOL (${skipped.length})`);
for (const r of skipped.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
  console.log(`  ${pad(r.symbol, 10)} ${r.reason}`);
}
