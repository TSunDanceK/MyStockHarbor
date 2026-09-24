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
// V2 FILES ARE NOT UNCOUNTED V1 FILES. Without this exclusion the note fires on
// all 660 tagged images and tells the reader to "raise the bucket count" for
// files that have no bucket and are already reachable through manifest-v2 —
// advice that is not just noise but wrong to follow. §9 owns those files.
const uncounted = [...files].filter((f) => !counted.has(f) && /^(?:sector|event)-/.test(f));
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
  // ── /headlines MOVED HERE OUT OF IMAGELESS_BY_DESIGN ──────────────────
  // Its recorded reason was "5% wire-to-universe match — no per-item symbol to
  // reach a bucket with and no price data for a generated card". Both halves
  // are TRUE and neither rules out library art: bucketForItem(eventType, null)
  // reaches an event bucket from a TITLE ALONE, with no symbol and no prices.
  //
  // That is the identical mistake this file already records against the sector
  // page — "that reasoning applied to the FALLBACK and was taken to rule out
  // the library art too, which it never did". A reason that is sound for the
  // generated card was read as a reason for nothing at all, twice.
  //
  // noneIsNull, because this surface is the one that can legitimately plan
  // `none`: with sectorBucket null and canGenerate false, a title matching no
  // pattern has no honest picture, and an empty 16:9 wrapper on most of the
  // grid would be worse than the blank it replaces.
  { file: "app/headlines/page.tsx", label: "headlines page", compact: false, noneIsNull: true },
];

// DELIBERATELY IMAGELESS, with the reason attached. EMPTY, and the partition
// assertion below is what stops that being vacuous: every render site must be
// in exactly one of these two lists, so a site cannot leave SURFACES without
// arriving here with a stated reason. If this list grows, it grows with one.
const IMAGELESS_BY_DESIGN = [];

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
  // ONE EXTRA STEP IS PERMITTED, AND ONLY ONE, AND ONLY ON noneIsNull SURFACES:
  // a short-circuit on the PLAN's own kind. It has to be spelled against the
  // plan — `art.kind === "none" ? null :` — so a constant-false guard cannot
  // reappear in that slot wearing the same shape. Everything else is unchanged:
  // one optional wrapper div, then the render.
  const ELSE_BRANCH = surface.noneIsNull
    ? /^[\s\S]*?\) : (?:\w+\.kind === "none" \? null : )?\( ?(<div[^>]*> )?<NewsCardArt/
    : /^[\s\S]*?\) : \( ?(<div[^>]*> )?<NewsCardArt/;
  check(
    `${surface.label}: EVERY publisher ternary renders art in its else-branch`,
    branches.length > 0 &&
      branches.every((b) =>
        ELSE_BRANCH.test(b.slice(0, b.indexOf("<NewsCardArt") + 12) || b)
      ),
    `${branches.length} ternar${branches.length === 1 ? "y" : "ies"} — a structural fact, not an identifier: \`{false && <NewsCardArt/>}\` fails this where a grep for the name passed`
  );
  if (surface.noneIsNull) {
    check(
      `${surface.label}: the null branch is conditioned on the PLAN, not on a constant`,
      /\w+\.kind === "none" \? null :/.test(flat),
      "rendering nothing is legitimate here only when planCardArt SAID none; " +
        "`{cond ? art : null}` with any other condition is the original bug"
    );
  }
  check(
    `${surface.label}: no plan of its own — planCardArt, planHeadlineArt or a server-sent plan`,
    /planCardArt\(/.test(code) || /planHeadlineArt\(/.test(code) || /plan=\{item\.art/.test(code),
    // planHeadlineArt is /headlines' own composition of the two rules and lives
    // in lib/server/news/artTags.ts, where §9 tests it BY CALLING IT. It still
    // ends in planCardArt; what it adds in front is the tagged library.
    "the surface may not decide what a card shows; it delegates and renders"
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

// ── THE GAP THAT LET /headlines SHIP BLANK ──────────────────────────────
// §1 asserted a GUARD at all four render sites; the loop above asserted a
// FALLBACK only at the three in SURFACES. /headlines was in neither — it sat in
// IMAGELESS_BY_DESIGN, whose assertion is the INVERSE one, so every check
// passed while the page rendered no picture on any card. Nothing was wrong with
// either list; what was missing was anything requiring them to COVER the render
// sites between them.
//
// So the two lists are now a PARTITION of RENDER_SITES. A site cannot be
// dropped from SURFACES without landing in IMAGELESS_BY_DESIGN with a written
// reason, and cannot be in both. The failure mode this closes is silence, so
// the assertion names the specific files rather than just counting.
const covered = [...SURFACES.map((x) => x.file), ...IMAGELESS_BY_DESIGN.map((x) => x.file)];
const uncovered = RENDER_SITES.filter((f) => !covered.includes(f));
const doubled = RENDER_SITES.filter(
  (f) => SURFACES.some((x) => x.file === f) && IMAGELESS_BY_DESIGN.some((x) => x.file === f)
);
const stray = covered.filter((f) => !RENDER_SITES.includes(f));
check(
  "every render site is EITHER an art surface OR imageless with a reason",
  uncovered.length === 0 && doubled.length === 0,
  uncovered.length
    ? `uncovered: ${uncovered.join(", ")} — asserted to guard the publisher image, asserted to do nothing else`
    : doubled.length
      ? `in both lists: ${doubled.join(", ")}`
      : `${RENDER_SITES.length} sites: ${SURFACES.length} render art, ${IMAGELESS_BY_DESIGN.length} imageless by design`
);
check(
  "...and neither list names a file that is not a render site",
  stray.length === 0,
  stray.length ? `stray: ${stray.join(", ")}` : "a renamed page would otherwise leave a passing assertion behind"
);
// ── /headlines, WITH THE EXACT INPUTS ITS RULE PASSES ───────────────────
// The structural checks above prove the page DELEGATES. They cannot prove the
// delegation produces a picture, and "wired up but always none" is the failure
// this whole section exists to stop being invisible. So the two pinned
// arguments -- sectorBucket null, canGenerate false -- are run here against the
// real title classifier.
//
// THEY LIVE IN planHeadlineArt NOW, not in the page body, and §9 asserts them
// there by calling it. What is below is still the half that matters here: that
// the EVENT bucket, which is what this page falls through to when an article
// carries no tags, is reachable from a title alone and holds shipped art.
const etSrc = read("lib/server/news/eventType.ts")
  .split("\n").filter((l) => !/^import /.test(l)).join("\n")
  .replace(/export type EventType = NonNullable<NewsItem\["eventType"\]>;/, "export type EventType = string;");
if (!/export function eventTypeFromTitle\(/.test(etSrc)) {
  console.error("FAIL: eventTypeFromTitle was not found after stubbing eventType.ts.");
  process.exit(1);
}
const et = await import(`data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(etSrc, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
).toString("base64")}`);

// REAL HEADLINES, captured rather than written to pass. The first two are the
// shapes the title leg is built for; the third is an ordinary market headline
// of the kind that dominates this feed.
const headlinePlan = (title) =>
  art.planCardArt({
    variant: "lead",
    eventType: et.eventTypeFromTitle(title),
    sectorBucket: null,
    key: title,
    taken: new Map(),
    canGenerate: false,
  });

check(
  "/headlines: an earnings-shaped title reaches LIBRARY art with no symbol at all",
  (() => {
    const p = headlinePlan("Nvidia beats estimates as data-centre revenue sets a record");
    return p.kind === "library" && /event-earnings/.test(p.art.src);
  })(),
  "this is the half the IMAGELESS_BY_DESIGN reason missed: the event bucket needs " +
    "a title, not a ticker and not a price series"
);
// AGAINST THE REAL MANIFEST, NOT THE SYNTHETIC ONE. The check above runs on the
// substituted manifest, which carries event-earnings and deliberately not the
// others -- so it proves the MECHANISM and can say nothing about what ships. An
// analyst-shaped title classified correctly but landing on an empty bucket would
// fall through to sectorBucket, which is null here, and render nothing: wired up
// and still blank, the exact outcome this page is being fixed for.
//
// So the shipped counts are asserted directly, for every type the title leg can
// actually return. Not all five: macro and filing are unreachable from a title.
const shippedManifest = JSON.parse(read("public/news-art/manifest.json"));
const TITLE_REACHABLE = { earnings: "event-earnings", analyst: "event-analyst", deal: "event-deals" };
const emptyBuckets = Object.entries(TITLE_REACHABLE)
  .filter(([, bucket]) => !(shippedManifest[bucket] > 0))
  .map(([type, bucket]) => `${type} -> ${bucket}`);
check(
  "/headlines: every event bucket the title leg can reach holds shipped art",
  emptyBuckets.length === 0,
  emptyBuckets.length
    ? `empty: ${emptyBuckets.join(", ")} — those headlines classify and then render nothing`
    : Object.entries(TITLE_REACHABLE).map(([t, b]) => `${t}=${shippedManifest[b]}`).join(" ")
);
check(
  "...and the title leg really does return all three, so that list is not aspirational",
  ["Nvidia beats estimates on record revenue", "Analyst raises price target on Apple",
   "Acme agrees to acquire Beta Corp"].map((t) => et.eventTypeFromTitle(t)).join(",") ===
    "earnings,analyst,deal",
  "a bucket list naming types the classifier never produces would pass the check above vacuously"
);
check(
  "/headlines: an ordinary headline plans NONE — never a guessed sector",
  headlinePlan("Stocks drift as investors wait on the Fed").kind === "none",
  "with sectorBucket null and canGenerate false the only alternatives are the " +
    "right art or no art; a mismatched illustration cannot be produced"
);
check(
  "/headlines: the page's comment is true — the title leg never returns macro or filing",
  ["macro", "filing"].every((t) =>
    !Object.values({
      a: "Fed holds rates steady as inflation cools",
      b: "Tariffs pressure Deere's margins",
      c: "Company files its 10-Q for the September quarter",
      d: "New economic policy reshapes trade",
    }).some((title) => et.eventTypeFromTitle(title) === t)
  ),
  "eventType.ts documents both as deliberately unreachable from a title; the page " +
    "says so in a comment, and a comment that stops being true is how the last one shipped"
);

check(
  "every IMAGELESS_BY_DESIGN entry carries a real reason",
  IMAGELESS_BY_DESIGN.every((x) => typeof x.why === "string" && x.why.trim().length > 20),
  "the list is empty today; the rule is what makes re-adding a site cost a sentence"
);

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

// ─────────────────────────────── 9. THE TAGGED LIBRARY (v2), END TO END
//
// A SECOND LIBRARY, A SECOND MANIFEST, AND DELIBERATELY NO SHARED TYPE WITH
// THE FIRST. §1-§8 above are about `sector-*`/`event-*` and manifest.json's
// bucket counts; nothing in this section may change what any of them assert.
//
// The failure this section exists for is SILENCE, in three shapes:
//   - a manifest name with no file behind it (a broken image on a live page,
//     which the page renders around and only a visitor sees),
//   - a pattern that can only ever score 0 (dead code that looks alive — the
//     same shape as the event-deals/deal plural trap in art.ts),
//   - "wired up but always none", which is the exact state /headlines shipped
//     in for a whole step while every check above passed.
console.log("\n=== 9. The tagged library (v2): manifest, patterns, picker ===\n");

const V2_PATH = "public/news-art/manifest-v2.json";
const v2 = JSON.parse(read(V2_PATH));
const v2Names = Object.keys(v2);

check(
  "manifest-v2 parses as name -> tags, and every entry has the tag arrays",
  v2 && typeof v2 === "object" && !Array.isArray(v2) &&
    v2Names.every((n) => {
      const e = v2[n];
      if (!e || typeof e !== "object" || Array.isArray(e)) return false;
      return ["primary", "related", "motif"].every(
        (k) => e[k] === undefined || (Array.isArray(e[k]) && e[k].every((t) => typeof t === "string"))
      );
    }),
  `${v2Names.length} images`
);

// §4.1 OF THE BRIEF, AND IT IS THE ONE THAT PROTECTS THE WORKING SURFACES.
// art.ts reads manifest.json as Record<string, number>. A v2-shaped object at
// that path would break /stock/*/news, /sector/*/news and the dashboard strip
// at build time or, worse, silently. Asserted from both ends: v1 holds numbers,
// and each module imports its own file.
check(
  "manifest.json is STILL the v1 count shape — this PR cannot have touched it",
  Object.values(manifest).every((v) => typeof v === "number"),
  "the three symbol-led surfaces read it as bucket counts"
);
check(
  "...and the two modules import different files",
  /import manifest from "@\/public\/news-art\/manifest\.json";/.test(artCode) &&
    /import manifest from "@\/public\/news-art\/manifest-v2\.json";/.test(read("lib/server/news/artTags.ts")),
  "one manifest read by both is one shape read two ways"
);

// A NAME IS A FILENAME. Anything outside [a-z0-9-] either cannot be served or
// escapes the folder, and both are worth failing on before they are URLs.
const badNames = v2Names.filter((n) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n));
check(
  "every name is a safe, lowercase file stem",
  badNames.length === 0,
  badNames.slice(0, 3).join(", ") || `${v2Names.length} names`
);

// BOTH DIRECTIONS, because a one-way check is how a name and a file drift.
const v2Missing = [];
for (const name of v2Names) {
  if (!files.has(`${name}.webp`)) v2Missing.push(`${name}.webp`);
  if (!files.has(`${name}-sm.webp`)) v2Missing.push(`${name}-sm.webp`);
}
check(
  "every name in manifest-v2 has BOTH files on disk",
  v2Missing.length === 0,
  v2Missing.length ? `${v2Missing.length} missing, e.g. ${v2Missing.slice(0, 3).join(", ")}` : "no name is unbacked"
);

// The other direction is a FAILURE here, not a note as it is for v1. v1 can
// grow a bucket at a time because a count gates it; v2 has no counts, so a file
// the manifest does not name is simply unreachable forever and nothing else
// would ever say so.
const v2Orphans = [...files].filter(
  (f) => !/^(?:sector|event)-/.test(f) && !v2Names.includes(f.replace(/(?:-sm)?\.webp$/, ""))
);
check(
  "no v2-shaped .webp on disk is missing from manifest-v2",
  v2Orphans.length === 0,
  v2Orphans.length ? `${v2Orphans.length} unreachable, e.g. ${v2Orphans.slice(0, 3).join(", ")}` : "nothing unreachable"
);

// ── THE CLASSIFIER, BY RUNNING IT ──────────────────────────────────────────
// articleTopic.ts imports nothing at all, so it transpiles and loads as-is —
// no substitution, which means this is the shipped module and not a copy of it.
const topicSrc = read("lib/server/news/articleTopic.ts");
if (/^import /m.test(topicSrc)) {
  console.error("FAIL: articleTopic.ts grew an import; this harness loads it unsubstituted.");
  process.exit(1);
}
const topic = await import(`data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(topicSrc, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
).toString("base64")}`);

// EVERY TAG THE TABLE CAN EMIT MUST EXIST IN THE MANIFEST, and the reverse is
// NOT required: the library holds 67 subjects and 16 motifs, most of which no
// pattern reaches yet, which is a coverage gap and not a bug. A pattern with no
// image is the bug, because it looks alive and can only ever score 0.
if (v2Names.length === 0) {
  console.log(
    "  NOTE  manifest-v2.json is EMPTY. The tagged path is INERT: pickTagged returns\n" +
      "        null for every article and /headlines renders exactly what it renders today.\n" +
      "        The pattern-reachability assertions below are SKIPPED because there is\n" +
      "        nothing to reach — they turn back on with the first image. Adding art:\n" +
      "        files first, manifest second. public/news-art/README.md has the order."
  );
} else {
  const inManifest = (axis, tag) =>
    v2Names.some((n) => {
      const e = v2[n];
      return axis === "subject"
        ? (e.primary ?? []).includes(tag) || (e.related ?? []).includes(tag)
        : (e.motif ?? []).includes(tag);
    });
  const deadSubjects = topic.SUBJECT_TAGS.filter((t) => !inManifest("subject", t));
  const deadMotifs = topic.MOTIF_TAGS.filter((t) => !inManifest("motif", t));
  check(
    "every subject the table can emit reaches at least one image",
    deadSubjects.length === 0,
    deadSubjects.length ? `dead: ${deadSubjects.join(", ")}` : `${topic.SUBJECT_TAGS.length} subjects`
  );
  check(
    "every motif the table can emit reaches at least one image",
    deadMotifs.length === 0,
    deadMotifs.length ? `dead: ${deadMotifs.join(", ")}` : `${topic.MOTIF_TAGS.length} motifs`
  );
}

// REAL HEADLINES, CAPTURED BEFORE THE TABLE EXISTED. The fixture's own header
// separates the real rows from the constructed probes; `imprecise` rows are
// printed rather than asserted, so a later narrowing that fixes one does not
// fail this suite for fixing it.
// ── THREE FIXTURES, TWO POPULATIONS, ONE ASSERTION ─────────────────────────
// article-topic.jsonl's real rows are the PER-SYMBOL feed, where a story about
// Costco says "Costco" and not "retailers". The two article-topic-general files
// are the GENERAL feed, which is what /headlines actually serves and where the
// subject is usually named outright. They score very differently and neither is
// wrong; what is wrong is quoting one number without its sample.
//
// THE THIRD FILE EXISTS BECAUSE THE SECOND STOPPED BEING HELD OUT. Twelve rows
// of the 09-21 capture were recorded misses, and resolving them turned that
// capture into the thing the patterns were fitted to. A rate needs a sample
// nobody tuned against, so 09-22 was captured after the work was finished:
//
//   6.8% per-symbol, 192 headlines, held out (scripts/newsart-topic-sample.mjs)
//    40% general 09-21 — FITTED, do not quote as a rate
//    36% general 09-22 — held out by timing, and a floor
//
// Both are asserted by the same code, so a pattern change has to satisfy both
// populations at once. That is the point: every defect fixed on this branch so
// far was invisible on one sample and obvious on the other.
const TOPIC_FIXTURES = [
  {
    file: "scripts/fixtures/article-topic.jsonl",
    // HAND-PICKED FROM A 192-HEADLINE POLL, deliberately over-weighted towards
    // matches so the precision read-through had something to read. Its split is
    // a property of that SELECTION and is not a rate: the measured rate on the
    // full poll is 6.8%, from scripts/newsart-topic-sample.mjs.
    composition: "hand-picked from a 192-item poll — NOT a rate (the poll measures 6.8%)",
  },
  {
    file: "scripts/fixtures/article-topic-general-2026-09-21.jsonl",
    // THE WHOLE CAPTURE, every headline on the grid — BUT NO LONGER HELD OUT.
    // Twelve of its rows were `note`d recall misses that the round-1 pattern
    // work resolves, so its split is now FITTED and must not be quoted as a
    // rate. It stays because those twelve rows are the evidence that asked for
    // each pattern, and because a fitted sample still catches a regression.
    composition: "FITTED — 12 rows resolved by the patterns measured against it; not a rate",
  },
  {
    file: "scripts/fixtures/article-topic-general-2026-09-22.jsonl",
    // THE HELD-OUT ONE, and the reason there are three files instead of two.
    // Captured a full news cycle after the patterns were written, measured and
    // mutation-tested; one headline overlaps with the 09-21 capture. Its split
    // IS the rate. Excerpts truncated at 200 characters, so still a floor, and
    // every label in it was computed from the text the file stores.
    composition: "the whole capture, held out by timing — this IS the rate, and a floor (excerpts at 200 chars)",
  },
];
const topicRows = TOPIC_FIXTURES.flatMap(({ file }) =>
  read(file)
    .split("\n").filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => ({ file, ...JSON.parse(l) }))
);
const asserted = topicRows.filter((r) => !r.imprecise);
const imprecise = topicRows.filter((r) => r.imprecise);
const wrong = [];
for (const row of asserted) {
  const got = topic.articleTopic(row.title, row.description ?? null);
  if (got.subjects.join(",") !== row.subjects.join(",") || got.motifs.join(",") !== row.motifs.join(",")) {
    wrong.push(`[${path.basename(row.file)}] "${row.title.slice(0, 44)}" -> ${JSON.stringify(got)} want ${JSON.stringify({ subjects: row.subjects, motifs: row.motifs })}`);
  }
}
check(
  `the classifier matches the fixture on all ${asserted.length} asserted rows`,
  wrong.length === 0,
  wrong.length ? wrong.slice(0, 2).join(" | ") : `${topicRows.length} rows, ${imprecise.length} recorded as imprecise`
);
// A FIXTURE OF ALL-POSITIVES WOULD PASS A CLASSIFIER THAT NEVER RETURNS NULL,
// and a fixture of all-negatives would pass one that never returns anything.
// Both shapes are asserted present, so neither degenerate module can pass.
check(
  "...and neither fixture is degenerate: real positives, real negatives, both feeds, both axes",
  (() => {
    const real = asserted.filter((r) => r.src !== "probe");
    // BOTH POPULATIONS, asserted by name. A per-symbol-only fixture is how the
    // three dead patterns survived: every one of them was silent on that feed
    // and the suite was green.
    const perSymbol = real.filter((r) => /gnews/.test(r.src));
    const general = real.filter((r) => /headlines/.test(r.src));
    return (
      perSymbol.length >= 30 && general.length >= 30 &&
      real.filter((r) => r.subjects.length || r.motifs.length).length >= 25 &&
      real.filter((r) => !r.subjects.length && !r.motifs.length).length >= 25 &&
      asserted.some((r) => r.subjects.length && r.motifs.length) &&
      asserted.some((r) => r.description)
    );
  })(),
  `${asserted.filter((r) => /gnews/.test(r.src)).length} per-symbol, ${asserted.filter((r) => /headlines/.test(r.src)).length} general, ${asserted.filter((r) => r.src === "probe").length} probes`
);

// ── THE SPLIT, PRINTED PER FEED AND NOT ASSERTED ───────────────────────────
// A match RATE moves with the feed, so pinning it to a threshold produces a
// check that fails for a reason nobody can act on. Printing it here keeps the
// number the doc quotes computable from the repo instead of remembered, which
// is the whole reason the general sample was committed.
for (const { file, composition } of TOPIC_FIXTURES) {
  const rows = topicRows.filter((r) => r.file === file && r.src !== "probe");
  if (!rows.length) continue;
  const subject = rows.filter((r) => r.subjects.length).length;
  const motifOnly = rows.filter((r) => !r.subjects.length && r.motifs.length).length;
  const pc = (n) => `${((n / rows.length) * 100).toFixed(0)}%`;
  console.log(
    `  NOTE  ${path.basename(file)}: ${rows.length} real rows — ` +
      `${subject} subject (${pc(subject)}), ${motifOnly} motif-only, ` +
      `${rows.length - subject - motifOnly} nothing\n` +
      `        ${composition}`
  );
}
// ── THE CHECK THAT WAS MISSING, AND IT COST THREE DEFECTS ─────────────────
// "Every tag exists in the manifest" (above) proves a tag has a PICTURE. It
// cannot prove the tag ever FIRES, and three patterns that never fired shipped
// in the first cut of articleTopic.ts, each looking perfectly alive in the
// source:
//
//   banks     — fourteen lines of comment explaining the narrowing, and the
//               pattern line itself deleted by an editing accident.
//   pipelines — present and correct, and shadowed by `oil-gas-upstream` and
//               `refining` on every headline that names the commodity, which
//               is how a pipeline headline is written.
//   pharma    — `\bpharma\b` cannot match "Pharmaceuticals".
//
// None of the three breaks a build, a type, or any assertion above. So every
// tag must now be PROVEN to fire by a row that produces it, which is a
// requirement on the fixture as much as on the table: a tag added to the table
// without a row lands here immediately.
const emittedSubjects = new Set(asserted.flatMap((r) => r.subjects));
const emittedMotifs = new Set(asserted.flatMap((r) => r.motifs));
const neverFires = [
  ...topic.SUBJECT_TAGS.filter((t) => !emittedSubjects.has(t)).map((t) => `subject:${t}`),
  ...topic.MOTIF_TAGS.filter((t) => !emittedMotifs.has(t)).map((t) => `motif:${t}`),
];
// ── ONE TAG, ONE ROW ──────────────────────────────────────────────────────
// A tag appearing twice in the table is two patterns competing under
// first-match-wins, and the loser is dead code that reads as if it works —
// the same family as the three dead patterns above, and it happened: candidate
// C was added as a SECOND `aerospace-defence` row rather than folded into the
// one that already existed, which would have left the wider of the two
// permanently unreachable for any headline the narrower matched first.
const dupSubjects = topic.SUBJECT_TAGS.filter((t, i) => topic.SUBJECT_TAGS.indexOf(t) !== i);
const dupMotifs = topic.MOTIF_TAGS.filter((t, i) => topic.MOTIF_TAGS.indexOf(t) !== i);
check(
  "no tag appears twice in the table — one tag, one row",
  dupSubjects.length === 0 && dupMotifs.length === 0,
  [...new Set([...dupSubjects, ...dupMotifs])].join(", ") ||
    `${topic.SUBJECT_TAGS.length} subjects, ${topic.MOTIF_TAGS.length} motifs, all distinct`
);

check(
  "every tag in the table is PROVEN to fire by a fixture row that produces it",
  neverFires.length === 0,
  neverFires.length
    ? `never fires: ${neverFires.join(", ")} — deleted, shadowed by a pattern above it, or unable to match its own word`
    : `${topic.SUBJECT_TAGS.length} subjects, ${topic.MOTIF_TAGS.length} motifs, all reachable`
);

for (const row of imprecise) {
  console.log(`  NOTE  imprecise [${path.basename(row.file).replace(/^article-topic-?/, "").replace(/\.jsonl$/, "") || "per-symbol"}]: "${row.title.slice(0, 52)}" — ${row.imprecise.split(".")[0]}.`);
}

// ── THE PICKER, AGAINST A SYNTHETIC MANIFEST ───────────────────────────────
// THE MANIFEST IS SUBSTITUTED, NOT THE MODULE — the same arrangement as §5 and
// for the same reason: today's shipped manifest is empty, so running the
// scoring against it would assert that nothing happens, which is a test that
// passes because the feature is switched off. hashKey and the dimensions come
// from the REAL art.ts loaded in §5 (neither depends on a manifest), so the
// "do not write a second hash" rule is asserted by construction here.
// 2026-09-23 (#552, COWORK #4): data/static-profile.json (FMP's per-symbol
// sector/industry) is removed, so there is no per-symbol label census to count
// against any more. industryArt.ts no longer imports it; the table's KEYS are
// category names, checked below only for what they emit.
const industrySrc = read("lib/server/news/industryArt.ts");
if (/^import /m.test(industrySrc)) {
  console.error("FAIL: industryArt.ts gained an import this harness does not inline.");
  process.exit(1);
}
const industry = await import(`data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(industrySrc, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
).toString("base64")}`);
globalThis.__newsIndustry = industry;

// ── THE REAL PROFILE LOOKUP, for the spelling case ────────────────────────
// /stock/BRK.B/news is the page this exists for: the snapshot keys share
// classes with a DASH and curatedSymbols spells Berkshire with a DOT, so that
// page reached no row at all and drew the generated card while /stock/BRK-B
// worked. Testing it against a hand-written map would assert that a bridge
// exists while testing a different bridge, so the SHIPPED module is loaded,
// with only its two data imports handed over.
globalThis.__symbolSpellings = await import("../lib/symbolSpellings.mjs");
const staticProfileSrc = read("lib/server/staticProfile.ts")
  .replace(/^import cikMap from "@\/data\/cik-map\.json";$/m, () => `const cikMap = ${read("data/cik-map.json")};`)
  // The SIC leg's two files (#517), real data like the CIK map.
  .replace(/^import registrantsFile from "@\/data\/sec\/registrants\.json";$/m, () => `const registrantsFile = ${read("data/sec/registrants.json")};`)
  .replace(/^import classificationFile from "@\/data\/sec\/sic-classification\.json";$/m, () => `const classificationFile = ${read("data/sec/sic-classification.json")};`)
  .replace(/^import overridesFile from "@\/data\/sec\/classification-overrides\.json";$/m, () => `const overridesFile = ${read("data/sec/classification-overrides.json")};`)
  .replace(/^import \{ lookupSpellingIn \} from "@\/lib\/symbolSpellings\.mjs";$/m, "const { lookupSpellingIn } = globalThis.__symbolSpellings;");
if (/^import /m.test(staticProfileSrc)) {
  console.error("FAIL: an import survived substitution in staticProfile.ts:\n" +
    staticProfileSrc.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}
const staticProfile = await import(`data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(staticProfileSrc, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
).toString("base64")}`);

globalThis.__newsArtV1 = art;
globalThis.__newsTopic = topic;
globalThis.__newsEventType = et;
const SYNTHETIC_V2 = {
  "chips-any-01": { primary: ["chips"], related: ["ai-compute"], motif: ["any"], tone: "flat", palette: "neon wireframe" },
  "chips-any-02": { primary: ["chips"], related: ["ai-compute"], motif: ["any"], tone: "up", palette: "mono plus accent" },
  "chips-any-03": { primary: ["chips"], related: [], motif: ["any"], tone: "flat", palette: "neon wireframe" },
  "chips-any-04": { primary: ["chips"], related: [], motif: ["any"], tone: "down", palette: "mono plus accent" },
  "refining-any-01": { primary: ["refining"], related: ["oil-gas-upstream"], motif: ["any"], tone: "flat", palette: "neon wireframe" },
  "any-macro-01": { primary: [], related: ["utilities-grid"], motif: ["macro"], tone: "flat", palette: "mono plus accent" },
  "any-macro-02": { primary: [], related: [], motif: ["macro"], tone: "flat", palette: "mono plus accent" },
  "any-macro-03": { primary: [], related: [], motif: ["macro"], tone: "down", palette: "neon wireframe" },
  "any-legal-01": { primary: [], related: [], motif: ["legal"], tone: "flat", palette: "mono plus accent" },
};
const loadTagged = async (manifestObject, label) => {
  const src = read("lib/server/news/artTags.ts")
    .replace(
      /^import manifest from "@\/public\/news-art\/manifest-v2\.json";$/m,
      () => `const manifest = ${JSON.stringify(manifestObject)};`
    )
    // The v1 module is handed over rather than re-imported: a `data:` module
    // cannot resolve "./art", and inlining art.ts again would put a SECOND copy
    // of hashKey in this harness, which is the duplication the module header
    // forbids in the app.
    .replace(
      /^import \{ ART_WIDTH, ART_HEIGHT, bucketForItem, hashKey, planCardArt, type CardArt, type NewsArt \} from "\.\/art";$/m,
      "const { ART_WIDTH, ART_HEIGHT, bucketForItem, hashKey, planCardArt } = globalThis.__newsArtV1;"
    )
    // The classifier and the event-type leg are handed over already loaded, for
    // the same reason: a `data:` module cannot resolve a relative specifier, and
    // a second inlined copy of either would be a second thing to keep in
    // agreement. Both are the SHIPPED modules, loaded above.
    .replace(
      /^import \{ articleTopic, MARKET_WIDE_SUBJECTS \} from "\.\/articleTopic";$/m,
      "const { articleTopic, MARKET_WIDE_SUBJECTS } = globalThis.__newsTopic;"
    )
    .replace(
      /^import \{ eventTypeFromTitle, type EventType \} from "\.\/eventType";$/m,
      "const { eventTypeFromTitle } = globalThis.__newsEventType;"
    )
    // The industry table, loaded above against the real snapshot. Handed over
    // rather than re-imported for the same reason as the other three.
    .replace(
      /^import \{ industryTag \} from "\.\/industryArt";$/m,
      "const { industryTag } = globalThis.__newsIndustry;"
    );
  if (/^import /m.test(src)) {
    console.error(`FAIL: an import survived substitution in artTags.ts (${label}):\n` +
      src.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
    process.exit(1);
  }
  for (const [marker, why] of [
    ["const manifest = {", "the manifest was not substituted"],
    ["const { ART_WIDTH, ART_HEIGHT, bucketForItem, hashKey, planCardArt } = globalThis.__newsArtV1;", "the art.ts import was not rewired"],
    ["const { industryTag } = globalThis.__newsIndustry;", "the industry table import was not rewired"],
    ["const { articleTopic, MARKET_WIDE_SUBJECTS } = globalThis.__newsTopic;", "the classifier import was not rewired"],
    ["const { eventTypeFromTitle } = globalThis.__newsEventType;", "the eventType import was not rewired"],
  ]) {
    if (!src.includes(marker)) { console.error(`FAIL: ${why} (${label}).`); process.exit(1); }
  }
  return import(`data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(src, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText
  ).toString("base64")}`);
};
const tags = await loadTagged(SYNTHETIC_V2, "synthetic");

const pick = (subjectTags, articleMotifs, key = "k", taken) =>
  tags.pickTagged({ subjectTags, articleMotifs, key, taken });

check(
  "a subject (3) outranks a motif (2) — the diesel story gets the refinery",
  pick(["chips"], ["macro"]).src.startsWith("/news-art/chips-any-"),
  "the weighting is the whole selection rule; reversed, a merger story about a chipmaker gets a handshake"
);
check(
  "a motif alone still reaches art — most headlines have no subject at all",
  pick([], ["macro"]).src.startsWith("/news-art/any-macro-"),
  "this is the half that covers the general feed"
);
check(
  "a RELATED tag (1) is reachable, and loses to a primary (3)",
  pick(["utilities-grid"], []).src.startsWith("/news-art/any-macro-") &&
    pick(["chips"], []).src.startsWith("/news-art/chips-any-"),
  "related scoring 0 would make four fifths of each image's tags decorative"
);
check(
  "a score of 0 returns NULL — never a random image",
  pick(["steel"], []) === null && pick([], ["ipo"]) === null && pick([], []) === null,
  "a wrong picture asserts something false; a missing one asserts nothing"
);
check(
  "the 'any' placeholder cannot be scored against",
  pick(["any"], ["any"]) === null,
  "'any' is on every image's unused axis: if it ever scored, all 268 subject images would tie and every card would get an arbitrary picture"
);
check(
  "the manifest key IS the file stem — no index arithmetic, no -00, no +1",
  (() => {
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) seen.add(pick(["chips"], [], `key-${i}`).src);
    return (
      [...seen].every((s) => /^\/news-art\/chips-any-0[1-4]\.webp$/.test(s)) &&
      seen.size === 4
    );
  })(),
  "v1's +1 lives at name construction and cost a whole step to find; v2 has no index to shift"
);
check(
  "the srcSet offers both pre-generated sizes and nothing else",
  (() => {
    const a = pick(["refining"], []);
    return a.srcSet === "/news-art/refining-any-01-sm.webp 320w, /news-art/refining-any-01.webp 1200w" &&
      a.src === "/news-art/refining-any-01.webp";
  })(),
  pick(["refining"], []).srcSet
);
check(
  "art dimensions are the policy's 1200x675, from art.ts and not a second copy",
  pick(["chips"], []).width === art.ART_WIDTH && pick(["chips"], []).height === art.ART_HEIGHT
);
check(
  "the same article always gets the same image",
  pick(["chips"], [], "guid-abc").src === pick(["chips"], [], "guid-abc").src,
  "an image that changes between renders defeats the cache and flickers"
);
check(
  "four cards sharing a tag never repeat — for keys that ALL COLLIDE",
  (() => {
    // Keys chosen to land on the same slot, then ASSERTED to collide, so this
    // stays honest if the hash or the winning-set size ever changes. Four
    // arbitrary keys prove nothing: FNV-1a maps systematic keys to distinct
    // slots, which is how the v1 version of this check passed with the rule
    // disabled outright.
    const colliding = [];
    for (let i = 0; colliding.length < 4 && i < 5000; i += 1) {
      if (art.hashKey(`c${i}`) % 4 === 1) colliding.push(`c${i}`);
    }
    if (colliding.length < 4) return false;
    if (new Set(colliding.map((k) => art.hashKey(k) % 4)).size !== 1) return false;
    const taken = new Set();
    const picks = colliding.map((k) => pick(["chips"], [], k, taken));
    return picks.every(Boolean) && new Set(picks.map((p) => p.src)).size === 4;
  })(),
  "without the walk the same illustration appears four times down the grid"
);
check(
  "...and a fifth card repeats rather than rendering nothing",
  (() => {
    const taken = new Set();
    const five = [0, 1, 2, 3, 4].map((i) => pick(["chips"], [], `k${i}`, taken));
    return five.every(Boolean) && new Set(five.map((a) => a.src)).size === 4;
  })(),
  "a winning set smaller than the card count must still fill every card"
);
check(
  "...and one page's `taken` does not block a DIFFERENT tag's images",
  (() => {
    const taken = new Set();
    for (let i = 0; i < 4; i += 1) pick(["chips"], [], `k${i}`, taken);
    const unblocked = pick([], ["legal"], "legal-key");
    const after = pick([], ["legal"], "legal-key", taken);
    return after && unblocked && after.src === unblocked.src;
  })(),
  "keyed by NAME, so exhausting one subject cannot re-hash another"
);
// AWAITED, NOT HANDED TO check() AS A PROMISE. A pending Promise is truthy, so
// `check("...", somethingAsync())` passes whatever the assertion inside it
// decides — a check that can only pass. Resolved here first.
const reversedTags = await loadTagged(Object.fromEntries(Object.entries(SYNTHETIC_V2).reverse()), "reversed");
check(
  "the pick does not depend on the manifest's key ORDER",
  ["a", "b", "c", "d", "e"].every(
    (k) => reversedTags.pickTagged({ subjectTags: ["chips"], articleMotifs: [], key: k }).src === pick(["chips"], [], k).src
  ),
  "NAMES is sorted for exactly this: re-exporting the library in a different order must not silently re-assign every article's picture"
);

// ── AND AGAINST THE SHIPPED MANIFEST ───────────────────────────────────────
// #481's tests learned this the expensive way: a mechanism proved on a
// synthetic fixture says nothing about what ships. Both states are asserted, so
// this check keeps its meaning on the day the images land rather than needing
// to be rewritten then.
const shippedTags = await loadTagged(v2, "shipped");
const chipsHeadline = topic.articleTopic("Memory chip prices climb as DRAM supply tightens", null);
const shippedPick = shippedTags.pickTagged({
  subjectTags: chipsHeadline.subjects,
  articleMotifs: chipsHeadline.motifs,
  key: "https://example.com/a",
});
check(
  v2Names.length === 0
    ? "with an EMPTY shipped manifest the tagged path is inert — /headlines is unchanged"
    : "with the shipped manifest a classified headline reaches real tagged art",
  v2Names.length === 0
    ? shippedPick === null && chipsHeadline.subjects.length > 0
    : shippedPick !== null && files.has(`${shippedPick.bucket}.webp`),
  v2Names.length === 0
    ? "the classifier already answers `chips`; only the images are missing, so the fall-through to event art is what renders"
    : `${shippedPick?.src}`
);

// ── /headlines: THE RULE, BY CALLING IT ────────────────────────────────────
// THE ASSERTION THAT WAS NOT GOOD ENOUGH, AND IS RECORDED BECAUSE IT LOOKED
// FINE: the first version of this block compared where `pickTagged(` and
// `planCardArt(` appear in the page source and called that "tagged art first".
// `if (false && tagged)` passed it cleanly. An index in a string cannot say
// what a program does — the identical lesson §6 and §8 above each record once
// already, which is why the rule is a function now.
//
// Every case below is planHeadlineArt RUN, against the synthetic v2 manifest
// and §5's synthetic v1 one (sector-banks 4, sector-semiconductors 6,
// event-earnings 5), which is what makes both branches observable at once.
const headlineArt = (title, description = null, over = {}) =>
  tags.planHeadlineArt({
    title,
    description,
    key: title,
    takenNames: new Set(),
    takenBuckets: new Map(),
    ...over,
  });

check(
  "/headlines: a story with a SUBJECT gets tagged art, with no symbol at all",
  (() => {
    const p = headlineArt("Memory chip prices climb as DRAM supply tightens");
    return p.kind === "library" && /^\/news-art\/chips-any-0[1-4]\.webp$/.test(p.art.src);
  })(),
  "this is the whole point of the change: 268 subject images that a headline can reach"
);
check(
  "/headlines: a MOTIF-only story still gets art",
  (() => {
    const p = headlineArt("The Fed holds rates steady as inflation cools");
    return p.kind === "library" && p.art.src.startsWith("/news-art/any-macro-");
  })(),
  "no subject, no symbol, and still an honest picture"
);
check(
  "/headlines: a story with NEITHER falls through to today's event art",
  (() => {
    // No subject and no motif -- `beats estimates` is the earnings motif, so
    // this one deliberately uses the phrasing only the EVENT leg reads.
    const p = headlineArt("Acme Corp reports fourth-quarter results above plan");
    return p.kind === "library" && p.art.bucket === "event-earnings";
  })(),
  "the path this page has shipped since #481 is a fall-through, not a casualty"
);
check(
  "/headlines: an ordinary headline plans NONE — never a guessed sector, never a blank ticker card",
  headlineArt("Stocks drift as investors wait for Friday's data").kind === "none",
  "with sectorBucket null and canGenerate false the only outcomes are the right art or no art"
);
check(
  "/headlines: the tagged rule is asked FIRST — a story that matches both gets the tagged one",
  (() => {
    // Both rules fire on this: `chips` for the tagged library, and the event
    // leg's `beats estimates` for event-earnings. Order decides which renders,
    // and a constant-false guard on the tagged branch fails HERE rather than
    // passing a grep.
    const p = headlineArt("Semiconductor maker beats estimates as wafer demand climbs");
    return p.kind === "library" && p.art.src.startsWith("/news-art/chips-any-");
  })(),
  "reversed, the three event buckets would keep every headline they match and the library stays unreachable"
);
check(
  "/headlines: the description is read, and is weighted below the title",
  (() => {
    const once = headlineArt("Acme slips in afternoon trading", "The move came as oil prices rose.");
    const twice = headlineArt(
      "Acme slips in afternoon trading",
      "Oil prices rose again. Oil markets are pricing in a supply cut."
    );
    return once.kind === "none" && twice.kind === "library" && twice.art.bucket === "refining-any-01";
  })(),
  "one mention in the body is not what a story is about; two is. 'refining' wins on `related` here, which is the 1-point leg doing its job"
);
check(
  "/headlines: one page's no-repeat state is shared across cards AND across the two libraries",
  (() => {
    const takenNames = new Set();
    const takenBuckets = new Map();
    const four = ["a", "b", "c", "d"].map((k) =>
      tags.planHeadlineArt({
        title: "Memory chip prices climb as DRAM supply tightens",
        key: k, takenNames, takenBuckets,
      })
    );
    // Four identical headlines, four different pictures: the walk is running.
    if (new Set(four.map((p) => p.art.src)).size !== 4) return false;
    // And the v1 half is untouched by it -- an event-bucket card is the same
    // whether or not four tagged names have been taken.
    const unblocked = headlineArt("Acme Corp reports fourth-quarter results above plan");
    const after = tags.planHeadlineArt({
      title: "Acme Corp reports fourth-quarter results above plan",
      key: "Acme Corp reports fourth-quarter results above plan",
      takenNames, takenBuckets: new Map(),
    });
    return after.art.src === unblocked.art.src;
  })(),
  "one shared collection across two differently-keyed libraries blocks images it has never used"
);
check(
  "/headlines: the page delegates and does not re-implement any of it",
  (() => {
    const code = readCodeOnly("app/headlines/page.tsx");
    return (
      /planHeadlineArt\(/.test(code) &&
      !/scoreEntry|topScoring|SUBJECT_PATTERNS|MOTIF_PATTERNS|pickTagged\(|articleTopic\(/.test(code)
    );
  })(),
  "one rule, in lib/server/news/artTags.ts, where it can be run"
);
// ── SCOPE, AND IT MOVED ON PURPOSE ────────────────────────────────────────
// This said "the three symbol-led surfaces are untouched by v2" and was right
// when /headlines was the only surface switched over. /stock/[symbol]/news is
// now switched too — §10 owns that — so the assertion is narrowed to the TWO
// that are still on v1 rather than deleted. A narrowed assertion is the point:
// the sector page and the dashboard strip going quietly onto tag scoring is
// exactly what it still exists to catch.
check(
  "the two remaining v1 surfaces are untouched: /sector/*/news and the dashboard strip",
  !/artTags|articleTopic|industryArt/.test(readCodeOnly("app/sector/[slug]/news/page.tsx")) &&
    !/artTags|articleTopic|industryArt/.test(readCodeOnly("lib/server/internalNews.ts")),
  "the sector page has a slug and no industry; the strip is a server-built payload. Each is its own change"
);

// ── SERVING: THE FOLDER'S OWN REQUEST PATH ─────────────────────────────────
// claude/serving-assets-from-public-2026-09-15.md, written after the logo
// harvest put the site's first same-origin images into production: middleware
// runs on public/ assets unless the matcher excludes the folder, and Next
// serves public/ with `max-age=0, must-revalidate` unless a header says
// otherwise. `logos/` got both; `news-art/` had neither, which was survivable
// while three cards a page carried art and is not once a grid of them does.
check(
  "news-art/ is excluded from the middleware matcher",
  /news-art\//.test(read("middleware.ts").match(/matcher: \[[\s\S]*?\]/)?.[0] ?? ""),
  "otherwise every image is an extra edge invocation AND an extra Upstash call, before the /api/ early-return"
);
check(
  "...and is served with a real Cache-Control",
  /source: "\/news-art\/:path\*"/.test(read("next.config.ts")),
  "the default makes a repeat visitor re-request every illustration on the page"
);

// ──────────────────────── 10. THE SYMBOL-LED PICKER: INDUSTRY, AND ORDER
//
// /stock/[symbol]/news chose art from the SECTOR alone, and nineteen sector
// buckets cannot say what 67 subjects can: 317 symbols resolve to
// sector-software, and `software`, `cloud`, `consumer-electronics` and
// `telecom` are all underneath it. Apple and Ondas both showed servers.
//
// The layering is most-specific-first and §10 asserts the ORDER, not just that
// each layer works — an order is the only thing a layered picker can get wrong
// without any single layer being wrong.
console.log("\n=== 10. The symbol-led picker: industry table, layer order, the 10% rule ===\n");

// "every label is one the snapshot contains" RETIRED 2026-09-23 (#552): the
// snapshot was FMP data and is removed; there is no committed label census left
// to check the keys against. COWORK #3's SIC table brings one back.
const strayTags = [...new Set(industry.INDUSTRY_TAG_VALUES)].filter((t) => !v2Names.some((n) => (v2[n].primary ?? []).includes(t)));
check(
  "every tag it can emit is a PRIMARY subject some image carries",
  strayTags.length === 0,
  strayTags.length ? `no image: ${strayTags.join(", ")}` : `${new Set(industry.INDUSTRY_TAG_VALUES).size} distinct tags`
);
// `related` IS NOT ENOUGH HERE and the distinction is the difference between a
// picture of the industry and a picture that merely mentions it. pickTagged
// scores primary at 3 and related at 1; a tag that only ever appears in
// `related` would still return an image, and it would be an image of something
// else that happens to list this industry as adjacent.
check(
  "...PRIMARY, not merely `related` — checked by excluding related from the search",
  industry.INDUSTRY_TAG_VALUES.every((t) => v2Names.some((n) => (v2[n].primary ?? []).includes(t))),
  "a related-only tag returns an image of something adjacent, which is a different promise"
);

// THE WEAK LIST IS ONLY WORTH ANYTHING IF IT IS INERT. Its whole purpose is
// that those 19 labels render exactly what they render today until someone
// approves each row, so a label appearing in both maps would silently go live.
const weakKeys = Object.keys(industry.WEAK_LABELS);
const weakLive = weakKeys.filter((l) => industry.industryTag(l) !== null);
check(
  "every WEAK label is INERT — present in neither the live map nor the output",
  weakLive.length === 0,
  weakLive.length ? `LIVE but marked weak: ${weakLive.join(", ")}` : `${weakKeys.length} labels, ${weakKeys.reduce((a, l) => a + industry.WEAK_LABELS[l].symbols, 0)} symbols held back`
);
check(
  "...and each carries a real reason",
  weakKeys.every((l) => {
    const w = industry.WEAK_LABELS[l];
    return typeof w.why === "string" && w.why.trim().length > 20;
  }),
  "the per-label counts were checked against the FMP snapshot, removed 2026-09-23 (#552)"
);

// ── THE 10% RULE ───────────────────────────────────────────────────────────
// A STANDING LIMIT ON HOW BROAD A SUBJECT PATTERN MAY BE, measured against 192
// real per-symbol headlines. It exists because the per-symbol feed is where a
// lazy fallback is most tempting and least visible: nearly every headline on it
// says "stock", so `\bstocks?\b` would fire on 76% of the feed and look like
// excellent coverage right up until someone read the pictures.
//
// EACH PATTERN IS TESTED ALONE, not through articleTopic. First-match-wins
// hides a broad pattern placed below a narrow one — the narrow one keeps
// winning on the headlines anyone would spot-check.
// THE ADAPTER STRIPS THE PUBLISHER SUFFIX before anything downstream sees a
// title, so measuring the raw fixture string would measure a string production
// never classifies. Lifted from the shipped adapter rather than reimplemented.
const stripSrc = read("lib/server/news/gnewsProvider.ts")
  .match(/export function stripPublisherSuffix\(title: string\): string \{[\s\S]*?\n\}/)[0]
  .replace("export function stripPublisherSuffix(title: string): string {", "export function stripPublisherSuffix(title) {");
const { stripPublisherSuffix } = await import(
  `data:text/javascript;base64,${Buffer.from(stripSrc).toString("base64")}`
);
const perSymbolTitles = read("scripts/fixtures/eventtype-gnews.jsonl")
  .split("\n").filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => stripPublisherSuffix(JSON.parse(l).title));
const BROAD_LIMIT = 0.10;
const tooBroad = topic.SUBJECT_PATTERN_ENTRIES
  .map(([tag, re]) => [tag, perSymbolTitles.filter((t) => re.test(t)).length])
  .filter(([, n]) => n / perSymbolTitles.length > BROAD_LIMIT);
check(
  `no subject pattern matches more than ${BROAD_LIMIT * 100}% of the ${perSymbolTitles.length}-headline per-symbol fixture`,
  tooBroad.length === 0,
  tooBroad.length
    ? tooBroad.map(([t, n]) => `${t} ${n}/${perSymbolTitles.length}`).join(", ")
    : `widest is ${topic.SUBJECT_PATTERN_ENTRIES
        .map(([tag, re]) => [tag, perSymbolTitles.filter((t) => re.test(t)).length])
        .sort((a, b) => b[1] - a[1])[0].join(" at ")}/${perSymbolTitles.length}`
);
check(
  "...and the rule has teeth: the fallback shapes it exists to stop are all over the limit",
  [/\bstocks?\b/i, /\bshares?\b/i, /\binvestors?\b/i].some(
    (re) => perSymbolTitles.filter((t) => re.test(t)).length / perSymbolTitles.length > BROAD_LIMIT
  ),
  `\\bstocks?\\b alone: ${perSymbolTitles.filter((t) => /\bstocks?\b/i.test(t)).length}/${perSymbolTitles.length} — a limit no candidate could exceed would assert nothing`
);

// ── THE LAYERS, BY CALLING THEM ──────────────────────────────────────────
// AGAINST THE SHIPPED MANIFEST, not §9's synthetic one. The synthetic manifest
// exists to make SCORING observable and holds four tags; these cases are about
// whether the real industry table reaches real images, which only the shipped
// 330 can answer. The v1 half stays synthetic (sector-banks 4, event-earnings
// 5), which is what makes the event-vs-industry ordering observable at all.──
const sym = (over = {}) =>
  shippedTags.planSymbolCardArt({
    variant: "lead",
    title: "Acme Corp names a new chief financial officer",
    description: null,
    eventType: null,
    industry: "Consumer Electronics",
    sectorBucket: "sector-banks",
    key: "k1",
    takenNames: new Set(),
    takenBuckets: new Map(),
    canGenerate: true,
    ...over,
  });

check(
  "LAYER 1 wins: an article whose own words name a subject beats the industry",
  (() => {
    const p = sym({ title: "Memory chip prices climb as DRAM supply tightens" });
    return p.kind === "library" && p.art.src.startsWith("/news-art/chips-any-");
  })(),
  "the article is more specific than the company"
);
check(
  "LAYER 1 DROPS MARKET-WIDE TAGS — `wall street` must not beat the industry",
  (() => {
    // The exact headline from the fixture, which scores `exchanges` on
    // /headlines and must not here.
    const p = sym({ title: "Apple Stock Slips After $1,999 Foldable Duo, iPhone 18 Fail to Wow Wall Street" });
    return p.kind === "library" && p.art.src.startsWith("/news-art/consumer-electronics-any-");
  })(),
  "4 of 4 `exchanges` hits on the per-symbol fixture are this metonym; a trading floor is not a picture of Apple"
);
check(
  "...and the exclusion is a NAMED SET, not a special case buried in the branch",
  topic.MARKET_WIDE_SUBJECTS instanceof Set && topic.MARKET_WIDE_SUBJECTS.has("exchanges"),
  "it lives beside the SUBJECT TABLE, not beside the picker that applies it: a statement about what these tags MEAN, so anything holding a tag can ask"
);
// ── THE SAME-AS-INDUSTRY SKIP ─────────────────────────────────────────────
// A layer-1 tag equal to the symbol's own industry tag carries no information
// the page does not already have, and jumping the event bucket with it costs a
// real picture. Both halves are pinned on REAL headlines from the drone
// capture, because this rule exists because of them.
check(
  "LAYER 1 SKIPS a subject the industry already says — AVAV keeps its event art",
  (() => {
    // "AeroVironment Stock Jumps After Earnings Beat. There's Still Growth for
    // Drones." Both axes fire: `drones` is a real aerospace-defence match and
    // `earnings beat` is a real event. AVAV's industry is Aerospace & Defense,
    // so layer 1 adds nothing and the EVENT bucket must answer.
    const p = sym({
      title: "AeroVironment Stock Jumps After Earnings Beat. There's Still Growth for Drones.",
      eventType: "earnings",
      industry: "Aerospace & Defense",
    });
    return p.kind === "library" && p.art.bucket === "event-earnings";
  })(),
  "without the skip this card loses event-earnings to a drone picture because its last clause says drones"
);
check(
  "...and does NOT skip it when the industry says something else — ONDS keeps the drone art",
  (() => {
    // The same rule from the other side. ONDS is Communication Equipment, so a
    // drone headline knows something the taxonomy does not, and layer 1 wins.
    const p = sym({
      title: "Ondas vs. Red Cat: Which Drone Stock Is the Better Pick Now?",
      industry: "Communication Equipment",
    });
    return p.kind === "library" && p.art.src.startsWith("/news-art/aerospace-defence-any-");
  })(),
  "6 of candidate C's 16 hits survive the skip, and every one is ONDS or UMAC"
);
check(
  "...and the skip does not silence the tag everywhere — a NON-aerospace page still gets it",
  (() => {
    const p = sym({ title: "Drone stocks climb on a Pentagon order", industry: "Software - Application" });
    return p.kind === "library" && p.art.src.startsWith("/news-art/aerospace-defence-any-");
  })(),
  "the rule is about redundancy with THIS symbol's industry, not about the tag"
);
check(
  "LAYER 2 stays above the industry: an earnings story keeps today's event art",
  (() => {
    const p = sym({ eventType: "earnings" });
    return p.kind === "library" && p.art.bucket === "event-earnings";
  })(),
  "PINNED ON PURPOSE. The brief did not say where eventType goes, and putting industry above it would silently take event art off every earnings story on a stock page. Moving it must fail here, not pass quietly"
);
check(
  "LAYER 3 is the one doing the work: no subject in the words, no event, so the INDUSTRY answers",
  (() => {
    const p = sym();
    return p.kind === "library" && p.art.src.startsWith("/news-art/consumer-electronics-any-");
  })(),
  "this is the ONDS/AAPL case — sector-software for both, until now"
);
check(
  "LAYER 4: an industry with no tag falls through to today's sector art",
  (() => {
    const weakLabel = Object.keys(industry.WEAK_LABELS)[0];
    const p = sym({ industry: weakLabel });
    return p.kind === "library" && p.art.bucket === "sector-banks";
  })(),
  "the 19 weak and 11 untagged labels must render exactly what they render today"
);
check(
  "...and so does a label the snapshot has never heard of",
  sym({ industry: "Underwater Basket Weaving" }).art.bucket === "sector-banks" &&
    sym({ industry: null }).art.bucket === "sector-banks"
);
// ── NO PAGE REPEATS AN IMAGE ──────────────────────────────────────────────
// THE DEFECT THE PREVIEW FOUND, and the arithmetic that made it certain: a
// stock page draws FIVE lead cards (maxDetailedItems: 5) and 62 of the 67 v2
// subjects hold FOUR images, so the fifth card exhausted the pool and repeated
// — ONDS 01,04,03,02,04 and AAPL 03,01,02,04,02 on the deployed preview.
//
// EIGHT CARDS, not five, so the assertion still bites if the page ever shows
// more, and run over every live industry label rather than a sample: the
// failure is arithmetic, so it is not a question of picking the right symbol.
check(
  "no symbol page repeats an image across 8 cards — any label, any pool size",
  (() => {
    const offenders = [];
    for (const label of industry.INDUSTRY_TAG_LABELS) {
      const takenNames = new Set();
      const takenBuckets = new Map();
      const seen = new Set();
      for (let i = 0; i < 8; i += 1) {
        const p = shippedTags.planSymbolCardArt({
          variant: "lead",
          title: "Quiet day for the company",
          description: null,
          eventType: null,
          industry: label,
          sectorBucket: "sector-banks",
          key: `card-${i}`,
          takenNames,
          takenBuckets,
          canGenerate: true,
        });
        // A generated card is not a repeat: it carries this article's own
        // ticker and move, so two of them are not the same picture twice.
        if (p.kind !== "library") continue;
        if (seen.has(p.art.src)) { offenders.push(`${label} -> ${p.art.src} on card ${i + 1}`); break; }
        seen.add(p.art.src);
      }
      if (offenders.length >= 3) break;
    }
    return offenders.length === 0;
  })(),
  "a repeated illustration says two stories are the same one; the generated card says nothing it does not know"
);
check(
  "...and the fall-through is ordered: the tag's pool, then the sector bucket, then the generated card",
  (() => {
    // COUNTS DERIVED, NOT TYPED. `luxury` holds 4 in the shipped manifest and
    // sector-banks holds 4 in §5's synthetic one — but the first version of
    // this check hardcoded 8 for the sector half, which is what the REAL v1
    // manifest holds, and failed against the harness. An expectation written
    // from a different manifest than the one under test asserts nothing about
    // either.
    const tagPool = v2Names.filter((n) => (v2[n].primary ?? []).includes("luxury")).length;
    const sectorPool = art.bucketCount("sector-banks");
    const takenNames = new Set();
    const takenBuckets = new Map();
    const kinds = [];
    for (let i = 0; i < tagPool + sectorPool + 1; i += 1) {
      const p = shippedTags.planSymbolCardArt({
        variant: "lead", title: "Quiet day", description: null, eventType: null,
        industry: "Luxury Goods", sectorBucket: "sector-banks", key: `k${i}`,
        takenNames, takenBuckets, canGenerate: true,
      });
      kinds.push(p.kind === "library" ? (p.art.bucket.startsWith("sector-") ? "sector" : "tag") : p.kind);
    }
    return (
      tagPool > 0 && sectorPool > 0 &&
      kinds.slice(0, tagPool).every((k) => k === "tag") &&
      kinds.slice(tagPool, tagPool + sectorPool).every((k) => k === "sector") &&
      kinds[tagPool + sectorPool] === "generated"
    );
  })(),
  "the tag's pool, then the sector bucket, then the card — and nothing repeated on the way"
);

// ── /stock/BRK.B/news, THE SPELLING THE PAGE ACTUALLY USES ────────────────
// Unverifiable on a preview, because BRK.B's feed carried no headlines the day
// it was checked. It is verifiable here, and it is the whole point of routing
// staticProfileFor through lookupSpellingIn.
check(
  "BRK.B and BRK-B reach the same row and the same plan — the dotted spelling is not a second-class page",
  (() => {
    const forSymbol = (sym) => {
      const profile = staticProfile.resolveProfile(sym, null);
      return shippedTags.planSymbolCardArt({
        variant: "lead",
        title: "Berkshire trims a position and adds to another",
        description: null,
        eventType: null,
        industry: profile.industry,
        sectorBucket: "sector-insurance",
        key: "k1",
        takenNames: new Set(),
        takenBuckets: new Map(),
        canGenerate: true,
      });
    };
    const dotted = forSymbol("BRK.B");
    const dashed = forSymbol("BRK-B");
    // 2026-09-23 (#552): with the FMP snapshot gone, Berkshire's industry is
    // SEC's "Fire, Marine & Casualty Insurance", which has no industry tag, so
    // both spellings now draw the generated card until COWORK #3 maps SIC 6331
    // onto an insurance label. What this pins is the bridge: the two spellings
    // reach the SAME row and the SAME plan.
    const a = staticProfile.resolveProfile("BRK.B", null);
    const b = staticProfile.resolveProfile("BRK-B", null);
    return a.industry !== null && a.industry === b.industry && a.sector === b.sector &&
      JSON.stringify(dotted) === JSON.stringify(dashed);
  })(),
  "before the spellings fix the dotted page reached NO row, so it drew the generated ticker card while the dashed one drew art"
);

check(
  "a COMPACT row is untouched by all four layers — still the generated card",
  (() => {
    const p = sym({ variant: "compact", title: "Memory chip prices climb as DRAM supply tightens" });
    return p.kind === "generated" && p.variant === "compact";
  })(),
  "at 56px a ticker and a move are legible where a shrunk illustration is not"
);
check(
  "the no-repeat rule holds across the tagged layers and does not leak into the buckets",
  (() => {
    const takenNames = new Set();
    const takenBuckets = new Map();
    const four = ["a", "b", "c", "d"].map((k) =>
      shippedTags.planSymbolCardArt({
        variant: "lead", title: "Quiet day for the company", description: null, eventType: null,
        industry: "Consumer Electronics", sectorBucket: "sector-banks", key: k,
        takenNames, takenBuckets, canGenerate: true,
      })
    );
    if (new Set(four.map((p) => p.art.src)).size !== 4) return false;
    const unblocked = sym({ eventType: "earnings", key: "e1" });
    const after = shippedTags.planSymbolCardArt({
      variant: "lead", title: "Acme Corp names a new chief financial officer", description: null,
      eventType: "earnings", industry: "Consumer Electronics", sectorBucket: "sector-banks",
      key: "e1", takenNames, takenBuckets: new Map(), canGenerate: true,
    });
    return after.art.src === unblocked.art.src;
  })(),
  "four cards of one industry must not repeat, and exhausting them must not re-hash an event bucket"
);
check(
  "the stock news page delegates and keeps its compact rows on planCardArt",
  (() => {
    const code = readCodeOnly("app/stock/[symbol]/news/page.tsx");
    return (
      /planSymbolCardArt\(/.test(code) &&
      /variant: "compact"/.test(code) &&
      !/INDUSTRY_TAGS|MARKET_WIDE|articleTopic\(|pickTagged\(/.test(code)
    );
  })(),
  "one rule, in lib/server/news/artTags.ts, where §10 can run it"
);
check(
  "/sector/*/news and the dashboard strip are NOT switched over in this change",
  !/planSymbolCardArt|industryArt/.test(readCodeOnly("app/sector/[slug]/news/page.tsx")) &&
    !/planSymbolCardArt|industryArt/.test(readCodeOnly("lib/server/internalNews.ts")),
  "the sector page has a slug and no industry, and the strip is a different payload; both are their own change"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
