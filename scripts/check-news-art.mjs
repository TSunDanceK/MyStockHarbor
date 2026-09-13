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
import { pathToFileURL } from "node:url";
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
  "the one component that serves art uses a plain <img srcset> with width and height",
  (() => {
    // THE SINGLE <img> FOR ALL THREE SURFACES now lives in NewsCardArt, so this
    // is one assertion rather than three greps that could each go stale
    // separately. Section 7 proves the attributes survive into real markup;
    // this only proves the source has not reached for the optimiser.
    const card = readCodeOnly("app/components/NewsCardArt.tsx");
    return (
      !/from "next\/image"/.test(card) &&
      /srcSet=\{plan\.art\.srcSet\}/.test(card) &&
      /width=\{plan\.art\.width\}/.test(card) &&
      /height=\{plan\.art\.height\}/.test(card)
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
//
// ONE-INDEXED, matching the committed library: a bucket of 4 is -01 through -04
// and there is no -00 anywhere in the set. This check found the disagreement the
// moment the real library landed — 52 files asked for that do not exist, 52 that
// do left unreachable — which is precisely the failure it exists for, since the
// page renders either way and only a visitor sees the broken image.
const missing = [];
for (const [bucket, count] of Object.entries(manifest)) {
  for (let i = 1; i <= count; i += 1) {
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
  for (let i = 1; i <= count; i += 1) {
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

console.log("\n=== 4. Sector selection, and where eventType takes over ===\n");
// STEP 0 SHIPPED SECTOR SELECTION ONLY and this section asserted that no event
// bucket was reachable — correct then, and deliberately reversed by step 6,
// which supplies eventType and turns §6's full rule on. What stays true, and is
// what this now guards, is the DIVISION: bucketFor() is still sector-and-
// industry only, and every event bucket goes through bucketForItem().
check(
  "bucketFor() is still sector/industry only — no event bucket reaches it",
  (() => {
    // The FUNCTION BODY, not everything between two names: EVENT_BUCKETS is
    // declared between bucketFor and bucketForItem in the file, so a slice
    // bounded by the two names contains it and this check fails on itself.
    const start = artCode.indexOf("export function bucketFor(");
    const body = artCode.slice(start, artCode.indexOf("\n}", start));
    return start > 0 && body.length > 40 && !/event-/.test(body);
  })(),
  "the sector half is what the null case falls through to, and it must not start choosing event art"
);
check(
  "event buckets are reachable ONLY through bucketForItem",
  /export function bucketForItem\(/.test(artCode) && /EVENT_BUCKETS\[eventType\]/.test(artCode),
  "scripts/check-event-type.mjs owns the rest of that rule; this only guards the split"
);
check(
  "a bucket absent from the manifest yields no art",
  /BUCKET_COUNTS\[bucket\]/.test(artCode) && /return 0;/.test(artCode),
  "counts come from the manifest alone — never from counting files, and never guessed"
);

console.log("\n=== 5. Selection: the real module, against a synthetic manifest ===\n");
// THE MANIFEST IS SUBSTITUTED, not the module. Today's real manifest is empty, so
// running the selection logic against it would assert that nothing happens — a
// test that passes because the feature is switched off. A synthetic manifest is
// what makes the no-repeat rule and the bucket mapping observable at all.
const artModuleSrc = read("lib/server/news/art.ts")
  .replace(
    /^import manifest from "@\/public\/news-art\/manifest.json";$/m,
    // Event buckets included: §6's rule is that eventType selects one INSTEAD of
    // the sector bucket, and a synthetic manifest without them can only ever
    // show the fall-through.
    () => 'const manifest = { "sector-banks": 4, "sector-semiconductors": 6, "event-earnings": 5 };'
  )
  // Step 6 added a type-only import for EventType. Erasing it keeps this
  // harness about art selection, which is what it is for.
  .replace(/^import type \{ EventType \} from ".\/eventType";$/m, "")
  .replace(/const EVENT_BUCKETS: Record<EventType, string>/, "const EVENT_BUCKETS")
  .replace(
    /export function bucketForItem\(\n  eventType: EventType \| null \| undefined,\n  sectorBucket: string \| null\n\): string \| null \{/,
    "export function bucketForItem(eventType, sectorBucket) {"
  );
if (/^import /m.test(artModuleSrc)) {
  console.error("FAIL: an import survived substitution:\n" +
    artModuleSrc.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}
// Positive markers, so a substitution that stops matching is loud rather than
// silently loading a module with a binding missing.
for (const [marker, why] of [
  ['const manifest = { "sector-banks"', "the synthetic manifest was not substituted"],
  ["export function bucketForItem(eventType, sectorBucket) {", "bucketForItem was not de-typed"],
]) {
  if (!artModuleSrc.includes(marker)) { console.error(`FAIL: ${why}.`); process.exit(1); }
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
  "every site sector now maps to a bucket that holds art",
  art.bucketFor("utilities", null) === "sector-utilities",
  "utilities had no bucket until the full library landed — it does now"
);
check(
  "an unrecognised sector still yields no bucket",
  art.bucketFor("not-a-sector", null) === null && art.bucketFor(null, null) === null,
  "the no-art path must stay reachable, or the generated card becomes dead code"
);
check(
  "a bucket with no manifest entry yields no art",
  art.pickArt("sector-nonesuch", "any-key") === null && art.pickArt(null, "any-key") === null,
  "a bucket the manifest does not name must fall back to the generated card, not guess a filename"
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
  (() => {
    // The expected name is built from the 0-based slot PLUS ONE, independently
    // of artAt, so this fails if the +1 is dropped rather than agreeing with
    // whatever the module happens to do.
    const nn = String((art.hashKey("k") % 4) + 1).padStart(2, "0");
    return (
      art.pickArt("sector-banks", "k").srcSet ===
      `/news-art/sector-banks-${nn}-sm.webp 320w, /news-art/sector-banks-${nn}.webp 1200w`
    );
  })(),
  art.pickArt("sector-banks", "k").srcSet
);
check(
  "no selectable name is -00 — the library starts at -01",
  (() => {
    for (let i = 0; i < 200; i += 1) {
      if (art.pickArt("sector-banks", `key-${i}`).src.includes("-00.webp")) return false;
    }
    // And the top of the range is reachable: a bucket of 4 must be able to
    // produce -04, which an unshifted index never would.
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) seen.add(art.pickArt("sector-banks", `key-${i}`).src);
    return seen.has("/news-art/sector-banks-04.webp");
  })(),
  "0-based names asked for 52 files that do not exist and left 52 that do unreachable"
);
check(
  "art dimensions are the policy's 1200x675",
  art.ART_WIDTH === 1200 && art.ART_HEIGHT === 675
);

// ─────────────────────────────────────── 6. THE SURFACES, TREATED THE SAME
//
// STEP 0 STOPPED THE HOTLINK ON FOUR RENDER SITES AND GAVE ART BACK TO ONE.
// The other three went imageless on main and stayed that way for a whole step,
// because a missing picture fails no build, no test and no type.
//
// THE FIRST VERSION OF THIS SECTION DID NOT CATCH THAT EITHER, and the record
// is worth keeping: it grepped each file for `GeneratedNewsArt`, `pickArt` and
// a `srcSet=` attribute. Wrapping a render in `{false ? ... : null}` leaves
// every one of those identifiers in place, and six of twelve mutations walked
// straight through — including "the sector page goes imageless", which is
// literally the regression the section was written for.
//
// So the rule is now a function (planCardArt) and the markup a component
// (NewsCardArt), and both are tested by RUNNING them. What is left to assert
// about each surface is only that it delegates, which is a structural fact a
// `false` guard cannot fake: the art render must be the else-branch of the
// publisher-image ternary, with no extra condition of its own.
console.log("\n=== 6. The rule, by calling it ===\n");

const plan = (over = {}) =>
  art.planCardArt({
    variant: "lead",
    eventType: null,
    sectorBucket: "sector-banks",
    key: "k1",
    taken: new Map(),
    canGenerate: true,
    ...over,
  });

check(
  "a lead card takes library art when its bucket has some",
  plan().kind === "library" && plan().art.src.startsWith("/news-art/sector-banks-"),
  JSON.stringify(plan())
);
check(
  "a lead card falls back to the generated card when the bucket has none",
  (() => {
    const p = plan({ sectorBucket: "sector-nothing-here" });
    return p.kind === "generated" && p.variant === "lead";
  })()
);
check(
  "a lead card with no bucket AND no ticker draws nothing at all",
  plan({ sectorBucket: null, canGenerate: false }).kind === "none",
  "a ticker card with no ticker is worse than a blank slot"
);
check(
  "a COMPACT card is always the generated card, never library art",
  (() => {
    const p = plan({ variant: "compact" });
    return p.kind === "generated" && p.variant === "compact";
  })(),
  "§6: at 56px a ticker and a move are legible where a shrunk illustration is not — and this holds even though sector-banks has 8 images sitting right there"
);
check(
  "a compact card with no ticker draws nothing",
  plan({ variant: "compact", canGenerate: false }).kind === "none"
);
check(
  "eventType selects the event bucket; null falls through to sector",
  plan({ eventType: "earnings" }).art.bucket === "event-earnings" &&
    plan({ eventType: null }).art.bucket === "sector-banks" &&
    plan({ eventType: undefined }).art.bucket === "sector-banks",
  "the requirement the whole of step 6 is subordinate to"
);
check(
  "the no-repeat set is shared across a page and keyed BY BUCKET",
  (() => {
    const pick = (taken, eventType, key) =>
      art.planCardArt({ variant: "lead", eventType, sectorBucket: "sector-banks", key, taken, canGenerate: true });

    // FOUR KEYS THAT ALL HASH TO THE SAME SLOT, so the four distinct images
    // can only come from the re-hash walk. Four arbitrary keys prove nothing:
    // the first version used "a".."d", which happen to land on four different
    // indices anyway, and it passed with the no-repeat rule disabled outright.
    // (Verified below that they really do collide, so this stays honest if the
    // bucket count or the hash ever changes.)
    const COLLIDING = ["art-key-0", "art-key-4", "art-key-8", "art-key-11"];
    if (new Set(COLLIDING.map((k) => art.hashKey(k) % 4)).size !== 1) return false;

    const taken = new Map();
    const same = COLLIDING.map((k) => pick(taken, null, k));
    if (new Set(same.map((p) => p.art.src)).size !== 4) return false;

    // A card in a DIFFERENT bucket must be UNAFFECTED by them — and the test
    // has to pin the exact image, not the bucket name. A shared Set still
    // returns the right bucket; it just silently hands back a re-hashed index,
    // which is how this mutation survived the first version of this check.
    const unblocked = pick(new Map(), "earnings", "a");
    const afterFour = pick(taken, "earnings", "a");
    return afterFour.kind === "library" && afterFour.art.src === unblocked.art.src;
  })(),
  "one shared Set across buckets blocks images it has never used"
);

console.log("\n=== 7. The markup, by rendering it ===\n");
const { renderToStaticMarkup } = await import("react-dom/server");
// The component is TSX, so it goes through the same transpile the art module
// does. GeneratedNewsArt is inlined rather than imported, for the same reason.
const cardSrc = read("app/components/NewsCardArt.tsx")
  .replace(/^import type \{ CSSProperties \} from "react";$/m, "")
  .replace(/^import type \{ CardArt \} from "@\/lib\/server\/news\/art";$/m, "")
  .replace(/^import GeneratedNewsArt from "@\/app\/components\/GeneratedNewsArt";$/m,
    () => read("app/components/GeneratedNewsArt.tsx")
      .replace(/^import type \{ CSSProperties \} from "react";$/m, "")
      .replace("export type GeneratedArtProps = {", "type GeneratedArtProps = {")
      .replace("export default function GeneratedNewsArt", "function GeneratedNewsArt"))
  .replace(/export type NewsCardArtProps = \{[\s\S]*?^\};$/m, "")
  .replace(/export default function NewsCardArt\(\{\n([\s\S]*?)\n\}: NewsCardArtProps\) \{/m,
    "export default function NewsCardArt({\n$1\n}) {");
if (/^import /m.test(cardSrc)) {
  console.error("FAIL: an import survived inlining NewsCardArt:\n" +
    cardSrc.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}
for (const [marker, why] of [
  ["function GeneratedNewsArt", "GeneratedNewsArt was not inlined"],
  ["export default function NewsCardArt({", "NewsCardArt was not de-typed"],
]) {
  if (!cardSrc.includes(marker)) { console.error(`FAIL: ${why} — a substitution stopped matching.`); process.exit(1); }
}
const cardJs = ts.transpileModule(cardSrc, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const cardFile = path.join(ROOT, ".check-newscard.mjs");
fs.writeFileSync(cardFile, cardJs);
let Card;
try {
  Card = (await import(`${pathToFileURL(cardFile).href}?t=${Date.now()}`)).default;
} finally {
  fs.unlinkSync(cardFile);
}
const { createElement } = await import("react");
const renderCard = (plan) =>
  renderToStaticMarkup(createElement(Card, {
    plan, symbol: "MU", changePct: 3.2, points: [1, 2, 3], sizes: "100vw",
  }));

const libraryHtml = renderCard(plan());
check("library art renders a real <img>", /<img[^>]*src="\/news-art\/sector-banks-\d\d\.webp"/.test(libraryHtml), libraryHtml.slice(0, 90));
check("...with a srcset offering both widths", /srcSet="[^"]*320w[^"]*1200w"|srcset="[^"]*320w[^"]*1200w"/i.test(libraryHtml));
check(
  "...and with width AND height, so the box is reserved before it lands",
  /width="1200"/.test(libraryHtml) && /height="675"/.test(libraryHtml),
  "claude/image-policy-2026-09-13.md — the whole reason next/image is not used here"
);
check("...and alt is empty: it is decorative, the headline carries the meaning", /alt=""/.test(libraryHtml));
check("...and it is lazy", /loading="lazy"/.test(libraryHtml));

const generatedHtml = renderCard({ kind: "generated", variant: "compact" });
check("the generated card renders a real <svg>", /^<svg/.test(generatedHtml), generatedHtml.slice(0, 80));
check("...carrying the ticker", generatedHtml.includes(">MU<"));
check("...at the compact size, with width and height set", /width="56"/.test(generatedHtml) && /height="56"/.test(generatedHtml));
check(
  "a 'none' plan renders NOTHING, rather than an empty box",
  renderCard({ kind: "none" }) === "",
  "the sector feed's no-constituent case"
);
check(
  "nothing in the rendered markup is a next/image request",
  !/\/_next\/image/.test(libraryHtml) && !/\/_next\/image/.test(generatedHtml)
);

console.log("\n=== 8. Every surface delegates to that pair ===\n");

const SURFACES = [
  { file: "app/stock/[symbol]/news/page.tsx", label: "stock news page", compact: true },
  { file: "app/sector/[slug]/news/page.tsx", label: "sector news page", compact: true },
  { file: "app/components/DashboardClient.tsx", label: "dashboard news strip", compact: false },
];

// DELIBERATELY IMAGELESS, with the reason attached: step 4's real poll resolved
// 2 of 40 wire items to a universe symbol (5.0%), so /headlines has no per-item
// symbol to reach a bucket with and no price data for a generated card.
// Per-sector search is the option to revisit. If this list grows, it grows with
// a reason.
const IMAGELESS_BY_DESIGN = [
  { file: "app/headlines/page.tsx", why: "5% wire-to-universe match — no per-item symbol to reach a bucket with" },
];

for (const surface of SURFACES) {
  const code = readCodeOnly(surface.file);
  // WHITESPACE-COLLAPSED before matching. readCodeOnly blanks comments in place
  // rather than deleting lines, so a five-line comment inside the branch leaves
  // ~400 characters of spaces — which is structure-free noise that a character
  // budget would otherwise have to guess at.
  // Whitespace collapsed, and the residue of stripped JSX comments removed:
  // readCodeOnly blanks `{/* ... */}` in place, which collapses to `{ }` — an
  // empty expression container that is never meaningful code, and would
  // otherwise have to be tolerated by the structural pattern below (loosening
  // it enough to let a real guard through).
  const flat = code.replace(/\s+/g, " ").replace(/\{ \} ?/g, "");
  // ONE TERNARY AT A TIME. A single regex over the whole file is not enough:
  // with an unbounded lazy scan it can satisfy itself using a DIFFERENT
  // ternary further down, which is exactly how "the sector page goes imageless"
  // walked through the previous version — the lead card was broken and the
  // compact row's ternary matched in its place. Splitting on the marker means
  // every occurrence has to stand on its own.
  const branches = flat.split("SHOW_PUBLISHER_IMAGES && item.image ?").slice(1);
  check(
    `${surface.label}: EVERY publisher ternary renders art in its else-branch`,
    branches.length > 0 &&
      branches.every((b) =>
        // One optional wrapper div between the branch and the render, and
        // nothing else — no guard, no `&&`, no second condition.
        /^[\s\S]*?\) : \( ?(<div[^>]*> )?<NewsCardArt/.test(b.slice(0, b.indexOf("<NewsCardArt") + 12) || b)
      ),
    `${branches.length} ternar${branches.length === 1 ? "y" : "ies"} — a structural fact, not an identifier: \`{false && <NewsCardArt/>}\` fails this where a grep for the name passed`
  );
  check(
    `${surface.label}: no plan of its own — planCardArt or a server-sent plan`,
    /planCardArt\(/.test(code) || /plan=\{item\.art/.test(code)
  );
  check(
    `${surface.label}: does not re-implement selection — nor even import it`,
    !/pickArt|bucketForItem|hashKey/.test(code),
    "one rule, in lib/server/news/art.ts. Importing without calling is caught too: `void pickArt` slipped past a check for the call form"
  );
  check(`${surface.label}: never next/image`, !/from "next\/image"/.test(code));
  if (surface.compact) {
    check(
      `${surface.label}: its compact rows ask for variant "compact"`,
      /variant: "compact"/.test(code),
      "planCardArt turns that into the generated card; the surface does not decide it"
    );
  }
}

for (const { file, why } of IMAGELESS_BY_DESIGN) {
  check(
    `${file}: imageless ON PURPOSE`,
    !/NewsCardArt|planCardArt|GeneratedNewsArt/.test(readCodeOnly(file)),
    why
  );
}

check(
  "the dashboard decides its art SERVER-side",
  /planCardArt\(/.test(readCodeOnly("lib/server/internalNews.ts")) &&
    !/planCardArt\(/.test(readCodeOnly("app/components/DashboardClient.tsx")),
  "the strip is a client component and cannot read cached fundamentals; sending a bucket name instead would put the manifest and the hash in the bundle"
);
check(
  "...and every card's art comes from that call, not from a literal",
  /art: \w+\(item\)/.test(readCodeOnly("lib/server/internalNews.ts")),
  "defining planCardArt and then assigning `art: { kind: \"none\" }` leaves the call in the file and the strip blank"
);
check(
  "the dashboard's fallback for a card with no art is the GENERATED card",
  /plan=\{item\.art \?\? \{ kind: "generated", variant: "lead" \}\}/.test(
    readCodeOnly("app/components/DashboardClient.tsx")
  ),
  "an older payload, or a failed read, must still draw something — `?? { kind: \"none\" }` renders a blank strip"
);
check(
  "the sector page reaches its bucket from the SLUG, with no lookup at all",
  /bucketFor\(data\.slug, null\)/.test(readCodeOnly("app/sector/[slug]/news/page.tsx")),
  "the route already is the sector"
);
check(
  "the sector page's symbol resolution survives the step-7 flip",
  (() => {
    const code = readCodeOnly("app/sector/[slug]/news/page.tsx");
    const fn = code.slice(code.indexOf("function primarySymbol("));
    return /item\.fmpSymbols/.test(fn) && /item\.tickers/.test(fn);
  })(),
  "free adapters put attribution in `tickers`, never `fmpSymbols`; reading only the latter returns null for every item the day the flag flips"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
