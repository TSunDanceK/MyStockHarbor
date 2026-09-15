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
    const width = meta.width ?? 0;
    if (!width) return { symbol, ok: false, reason: "undecodable: no width in metadata" };
    if (width < FLOOR) return { symbol, ok: false, reason: `source-too-small (${width}px < ${FLOOR}px floor)` };

    const target = Math.min(TARGET, width);
    const out = await sharp(input)
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
          `source ${input.length}B ${width}px)`,
      };
    }

    fs.writeFileSync(path.join(OUT_DIR, `${symbol}.webp`), out);
    return { symbol, ok: true, bytes: out.length, sourceWidth: width, target };
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

console.log("LOGO HARVEST — Phase 2");
console.log(`User-Agent: ${UA}`);
console.log(`target ${TARGET}px · floor ${FLOOR}px · concurrency ${CONCURRENCY}`);
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
fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest)}\n`);

console.log("RESULT");
console.log(`  files written : ${kept.length}`);
console.log(`  total bytes   : ${totalBytes} (${(totalBytes / 1048576).toFixed(2)} MB)`);
console.log(`  mean file     : ${kept.length ? Math.round(totalBytes / kept.length) : 0} bytes`);
console.log(`  skipped       : ${skipped.length}`);
console.log(`  wall-clock    : ${wall.toFixed(1)}s`);
console.log(`  manifest      : ${MANIFEST} (${manifest.length} entries)\n`);

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
