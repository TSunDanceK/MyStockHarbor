// The two things step 0 must not quietly lose: no publisher image renders
// unguarded, and no manifest count without a file behind it.
//
// WHY BOTH ARE ASSERTED RATHER THAN TRUSTED.
//
// The guard is a legal posture, not a preference. The site was hotlinking images
// FMP had no right to sublicense (claude/news-adapter-spec-2026-09-13.md §0), and
// the fix is four `SHOW_PUBLISHER_IMAGES &&` guards across four files. A fifth
// render site added later — a new card, a new strip — would reintroduce the
// exposure silently, because an image that renders looks like a working feature.
//
// The manifest is the source of truth for bucket counts, which means a count with
// no file behind it is a broken image on a live page. That is a one-character
// mistake to make while adding art, and nothing else would catch it: the page
// renders, the <img> 404s, and only a visitor sees it.
//
//   node scripts/check-news-art.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("\n=== 1. No publisher image renders unguarded ===\n");

// Every file that renders an item's own image URL. Comments stripped, so the
// prose explaining the guard cannot satisfy the assertion about the guard.
const RENDER_SITES = [
  "app/stock/[symbol]/news/page.tsx",
  "app/sector/[slug]/news/page.tsx",
  "app/headlines/page.tsx",
  "app/components/DashboardClient.tsx",
];

for (const file of RENDER_SITES) {
  const code = readCodeOnly(file);
  const renders = (code.match(/\{item\.image \?/g) ?? []).length;
  const guarded = (code.match(/\{SHOW_PUBLISHER_IMAGES && item\.image \?/g) ?? []).length;
  check(
    `${file} guards every publisher image render`,
    renders === 0 && guarded > 0,
    `${guarded} guarded, ${renders} unguarded`
  );
}

check(
  "the flag is off",
  /export const SHOW_PUBLISHER_IMAGES = false;/.test(readCodeOnly("lib/news-image-policy.ts")),
  "step 0 is the exposure stopping; turning this on needs the §6 per-item verdict too"
);

// A NEW render site is the regression this exists for. Anything outside the four
// known files that renders `item.image` is unguarded by construction.
const scanned = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(rel);
    } else if (entry.name.endsWith(".tsx")) {
      scanned.push(rel);
    }
  }
};
walk("app");
const strays = scanned.filter(
  (f) => !RENDER_SITES.includes(f) && /<img[^>]*src=\{item\.image/.test(readCodeOnly(f))
);
check(
  "no render site outside the four known files",
  strays.length === 0,
  strays.join(", ") || `${scanned.length} .tsx files scanned`
);

console.log("\n=== 2. next/image is not used for news art ===\n");
// claude/image-policy-2026-09-13.md rule 2: these are fixed, pre-generated sizes,
// so routing them through the optimiser pays a per-transformation meter for work
// already done.
const artCode = readCodeOnly("lib/server/news/art.ts");
check(
  "the art module does not reach for next/image",
  !/next\/image/.test(artCode)
);
check(
  "the news page serves art with a plain <img srcset> carrying width and height",
  (() => {
    const page = readCodeOnly("app/stock/[symbol]/news/page.tsx");
    return (
      !/from "next\/image"/.test(page) &&
      /srcSet=\{leadArt\[index\]!\.srcSet\}/.test(page) &&
      /width=\{leadArt\[index\]!\.width\}/.test(page) &&
      /height=\{leadArt\[index\]!\.height\}/.test(page)
    );
  })(),
  "an <img> with no width/height shifts the page as it loads, during an SEO recovery"
);

console.log("\n=== 3. The manifest and the files agree ===\n");

const manifestPath = "public/news-art/manifest.json";
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, manifestPath), "utf8"));
const artDir = path.join(ROOT, "public/news-art");
const files = new Set(fs.readdirSync(artDir).filter((f) => f.endsWith(".webp")));

check(
  "the manifest parses as a flat bucket -> count map",
  manifest && typeof manifest === "object" && !Array.isArray(manifest) &&
    Object.values(manifest).every((v) => typeof v === "number" && Number.isInteger(v) && v >= 0),
  `${Object.keys(manifest).length} buckets`
);

// THE ASSERTION THAT MATTERS. Every count must have its files, both sizes.
const missing = [];
for (const [bucket, count] of Object.entries(manifest)) {
  for (let i = 0; i < count; i += 1) {
    const nn = String(i).padStart(2, "0");
    if (!files.has(`${bucket}-${nn}.webp`)) missing.push(`${bucket}-${nn}.webp`);
    if (!files.has(`${bucket}-${nn}-sm.webp`)) missing.push(`${bucket}-${nn}-sm.webp`);
  }
}
check(
  "every image the manifest counts is actually present",
  missing.length === 0,
  missing.length ? `${missing.length} missing, e.g. ${missing.slice(0, 3).join(", ")}` : "no count is unbacked"
);

// The other direction is a warning, not a failure: files can land before the
// manifest is raised, and that is the safe order to do it in.
const counted = new Set();
for (const [bucket, count] of Object.entries(manifest)) {
  for (let i = 0; i < count; i += 1) {
    const nn = String(i).padStart(2, "0");
    counted.add(`${bucket}-${nn}.webp`);
    counted.add(`${bucket}-${nn}-sm.webp`);
  }
}
const uncounted = [...files].filter((f) => !counted.has(f));
if (uncounted.length) {
  console.log(
    `  NOTE  ${uncounted.length} .webp present but not counted in the manifest — ` +
      `raise the bucket count to use them (${uncounted.slice(0, 3).join(", ")})`
  );
}

console.log("\n=== 4. Step 0 selects on sector, not eventType ===\n");
check(
  "no event-* bucket is selected yet",
  !/event-/.test(artCode),
  "eventType is derived by the adapters — that is step 6, and selecting on it now would read as working while always missing"
);
check(
  "a bucket absent from the manifest yields no art",
  /BUCKET_COUNTS\[bucket\]/.test(artCode) && /return 0;/.test(artCode),
  "five sector buckets are empty by design and the library ships incomplete"
);

console.log("\n=== 5. Selection: the real module, against a synthetic manifest ===\n");
// THE MANIFEST IS SUBSTITUTED, not the module. Today's real manifest is empty, so
// running the selection logic against it would assert that nothing happens — a
// test that passes because the feature is switched off. A synthetic manifest is
// what makes the no-repeat rule and the bucket mapping observable at all.
const artModuleSrc = read("lib/server/news/art.ts").replace(
  /^import manifest from "@\/public\/news-art\/manifest.json";$/m,
  () => 'const manifest = { "sector-banks": 4, "sector-semiconductors": 6 };'
);
if (/^import /m.test(artModuleSrc)) {
  console.error("FAIL: an import survived substitution.");
  process.exit(1);
}
const artJs = ts.transpileModule(artModuleSrc, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const art = await import(`data:text/javascript;base64,${Buffer.from(artJs).toString("base64")}`);

check(
  "industry beats sector — technology alone cannot choose semiconductors",
  art.bucketFor("technology", "Semiconductors") === "sector-semiconductors" &&
    art.bucketFor("technology", null) === "sector-software",
  "half the library is unreachable from the eleven site sectors"
);
check(
  "...and healthcare splits the same way",
  art.bucketFor("healthcare", "Medical Devices") === "sector-medtech" &&
    art.bucketFor("healthcare", "Biotechnology") === "sector-biotech"
);
check(
  "an unmapped sector yields no bucket",
  art.bucketFor("utilities", null) === null && art.bucketFor(null, null) === null
);
check(
  "a bucket with no manifest entry yields no art",
  art.pickArt("sector-staples", "any-key") === null && art.pickArt(null, "any-key") === null,
  "the five empty buckets fall back to the generated card"
);
check(
  "the same article always gets the same image",
  art.pickArt("sector-banks", "guid-abc").src === art.pickArt("sector-banks", "guid-abc").src,
  "an image that changes between renders defeats the cache and flickers"
);
check(
  "four lead cards from a four-image bucket never repeat — for ANY four articles",
  (() => {
    // OVER MANY KEY SETS, AND THE KEYS MATTER. Two earlier versions of this
    // check survived deleting the rule it tests. The first used one hand-picked
    // set; the second used keys differing only in a trailing digit, which FNV-1a
    // maps to four DISTINCT slots every single time -- multiplying by an odd
    // prime is a bijection on the low bits, so systematic keys are exactly the
    // ones that never collide. Real keys are article links, so these are too.
    let seed = 0x2f6e2b1;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const link = () => `https://example.com/${rand().toString(36).slice(2, 10)}`;

    let sawACollisionWithoutTheRule = false;
    for (let trial = 0; trial < 400; trial += 1) {
      const keys = [link(), link(), link(), link()];
      const taken = new Set();
      const withRule = keys.map((k) => art.pickArt("sector-banks", k, taken).src);
      if (new Set(withRule).size !== 4) return false;
      // The control: the same keys picked independently. If these never collide
      // either, the fixture is not exercising the rule and the assertion above
      // is worthless -- so that is asserted separately below.
      const without = keys.map((k) => art.pickArt("sector-banks", k).src);
      if (new Set(without).size !== 4) sawACollisionWithoutTheRule = true;
    }
    return sawACollisionWithoutTheRule;
  })(),
  "without re-hash-on-collision the same illustration appears twice above the fold — this also fails if the fixture stops producing collisions, which would make it prove nothing"
);
check(
  "...and a fifth card repeats rather than rendering nothing",
  (() => {
    const taken = new Set();
    const five = [0, 1, 2, 3, 4].map((i) => art.pickArt("sector-banks", `k${i}`, taken));
    return five.every(Boolean) && new Set(five.map((a) => a.src)).size === 4;
  })(),
  "a bucket smaller than the card count must still fill every card"
);
check(
  "the srcset offers both pre-generated sizes and nothing else",
  art.pickArt("sector-banks", "k").srcSet === "/news-art/sector-banks-0" +
    (art.hashKey("k") % 4) + "-sm.webp 320w, /news-art/sector-banks-0" +
    (art.hashKey("k") % 4) + ".webp 1200w",
  art.pickArt("sector-banks", "k").srcSet
);
check(
  "art dimensions are the policy's 1200x675",
  art.ART_WIDTH === 1200 && art.ART_HEIGHT === 675
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
