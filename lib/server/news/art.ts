// Which generated illustration a news card gets, if any.
//
// Step 0 of claude/news-adapter-spec-2026-09-13.md, §6. Pure lookup: no I/O and
// no network. The manifest is imported, so it is bundled rather than read from
// disk at request time -- files in public/ are static CDN assets and are not
// reliably readable with fs from a serverless function.
//
// ── THE MANIFEST IS THE ONLY SOURCE OF COUNTS ──────────────────────────────
// Never count files by hand and never guess. A bucket absent from the manifest
// has no art, and the caller falls back to the generated data card. That is what
// makes the library shippable while it is still incomplete: five sector buckets
// (staples, realestate, materials, aerospace, insurance) have no images yet, and
// today the manifest is empty entirely, so every card takes the generated card.
// When images land, raising the count is the only change needed here.
//
// ── EVENT BUCKETS, LIVE SINCE STEP 6 ───────────────────────────────────────
// §6's full rule is `eventType ? pick(event-*) : pick(sector-*)`. Step 0 shipped
// the sector half, which the spec is explicit is "a perfectly good default";
// step 6 supplies eventType and bucketForItem() implements the choice.
//
// null IS NOT A DEFAULT EVENT BUCKET. It falls through to sector, because a
// wrong event type puts event-earnings art on a lawsuit story and asserts
// something false, where a sector illustration asserts nothing.
import manifest from "@/public/news-art/manifest.json";
import type { EventType } from "./eventType";

const BUCKET_COUNTS = manifest as Record<string, number>;

/** Lead-card art. The 320x180 -sm variant ships but is unused -- see §6. */
export const ART_WIDTH = 1200;
export const ART_HEIGHT = 675;

export type NewsArt = {
  src: string;
  srcSet: string;
  width: number;
  height: number;
  /** The bucket it came from, for the check script and for debugging. */
  bucket: string;
};

/**
 * Industry -> bucket, tried before sector.
 *
 * WHY INDUSTRY AND NOT JUST SECTOR. The bucket taxonomy is finer than the site's
 * eleven sectors: "technology" alone cannot choose between semiconductors and
 * software, and "healthcare" cannot choose between biotech and medtech. The
 * industry string is already cached per symbol beside the sector (30-day TTL in
 * lib/server/fundamentalsCache.ts), so using it costs nothing extra and is the
 * difference between the library being used and half of it never being reached.
 *
 * Matched as lowercase substrings, FIRST MATCH WINS, so order is meaningful:
 * "medical devices" must be tried before a bare "medical", and the narrow
 * entries sit above the broad ones throughout.
 */
const INDUSTRY_BUCKETS: Array<[RegExp, string]> = [
  [/semiconductor/, "sector-semiconductors"],
  [/biotechnolog|drug manufactur|pharmaceutic/, "sector-biotech"],
  [/medical device|medical instrument|diagnostic|healthcare plan|medical care|health information/, "sector-medtech"],
  [/internet retail/, "sector-ecommerce"],
  [/gambling|casino|electronic gaming/, "sector-gaming"],
  [/airline|lodging|resort|cruise|travel/, "sector-travel"],
  [/aerospace|defense/, "sector-aerospace"],
  [/insurance/, "sector-insurance"],
  [/bank|capital market|credit service|asset management|financial data|financial conglomerate/, "sector-banks"],
  [/auto manufactur|auto part|auto & truck|recreational vehicle/, "sector-auto"],
  [/telecom/, "sector-telecom"],
  [/entertainment|broadcast|publishing|advertising|internet content/, "sector-media"],
  [/software|information technology service/, "sector-software"],
  [/oil|gas|coal|solar|uranium|renewable/, "sector-energy"],
  [/reit|real estate/, "sector-realestate"],
  [/chemical|steel|copper|gold|silver|aluminum|paper|lumber|mining/, "sector-materials"],
  [/beverage|packaged food|household|tobacco|confection|farm product|grocery/, "sector-staples"],
  [/retail|apparel|footwear|luxury|department store|specialty/, "sector-retail"],
  [/industrial|machinery|construction|engineering|conglomerate|railroad|trucking|marine shipping|waste management/, "sector-industrials"],
];

/**
 * Sector -> bucket, the fallback when industry is missing or unrecognised.
 *
 * These are the site's own slugs from lib/sectors.ts. Every one of them now
 * resolves to a bucket that holds art; the three that were empty when this map
 * was written (staples, realestate, materials) were filled by the full library,
 * as was utilities. A slug missing from here still resolves to no art and the
 * caller draws the generated card, which is the behaviour to keep.
 */
const SECTOR_BUCKETS: Record<string, string> = {
  technology: "sector-software",
  healthcare: "sector-biotech",
  "financial-services": "sector-banks",
  "consumer-cyclical": "sector-retail",
  "consumer-defensive": "sector-staples",
  energy: "sector-energy",
  industrials: "sector-industrials",
  "basic-materials": "sector-materials",
  "real-estate": "sector-realestate",
  "communication-services": "sector-media",
  // Added when the full library landed: sector-utilities has art now, where the
  // first cut of this map had no bucket to point it at.
  utilities: "sector-utilities",
};

/** The art bucket for a symbol, or null when nothing maps. */
export function bucketFor(sector: string | null, industry: string | null): string | null {
  const ind = (industry ?? "").toLowerCase();
  if (ind) {
    for (const [pattern, bucket] of INDUSTRY_BUCKETS) {
      if (pattern.test(ind)) return bucket;
    }
  }

  const slug = (sector ?? "").toLowerCase().trim();
  return SECTOR_BUCKETS[slug] ?? null;
}

/**
 * eventType -> art bucket.
 *
 * ── THE NAMES DO NOT MATCH, AND THAT IS THE WHOLE REASON THIS MAP EXISTS ───
 * The type union is singular ("deal", "filing"); the shipped library is plural
 * ("event-deals", "event-filings"). `event-${eventType}` reads like the obvious
 * implementation and silently resolves to a bucket that is not in the manifest,
 * which means bucketCount 0, which means NO art at all on exactly the items
 * that had the strongest evidence. It would not have failed a build — the same
 * shape as the 0-vs-1 index bug the merge exposed, where only a visitor sees it.
 *
 * Written out in full, and scripts/check-news-art.mjs asserts every member of
 * the union reaches a bucket the manifest actually holds images for.
 */
const EVENT_BUCKETS: Record<EventType, string> = {
  earnings: "event-earnings",
  filing: "event-filings",
  analyst: "event-analyst",
  deal: "event-deals",
  macro: "event-macro",
};

/**
 * §6's selection rule: the event bucket when the item has an eventType, the
 * symbol's sector bucket when it does not.
 *
 * ONE DELIBERATE DEVIATION, and it is defensive rather than a rule change: an
 * eventType whose bucket holds no images falls through to sector instead of
 * returning a bucket with nothing in it. Both branches are degenerate at that
 * point, and sector art beats no art. It is the manifest-is-the-only-source-of-
 * counts rule applied to the event half — if the event art is ever removed, the
 * cards quietly go back to sector illustrations rather than quietly go blank.
 */
export function bucketForItem(
  eventType: EventType | null | undefined,
  sectorBucket: string | null
): string | null {
  if (eventType) {
    const bucket = EVENT_BUCKETS[eventType];
    if (bucketCount(bucket) > 0) return bucket;
  }
  return sectorBucket;
}

/** How many images a bucket holds. 0 for a bucket with none, or one absent. */
export function bucketCount(bucket: string | null): number {
  if (!bucket) return 0;
  const count = BUCKET_COUNTS[bucket];
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/**
 * A small stable hash.
 *
 * THE POINT IS STABILITY, not distribution quality: an article must get the same
 * illustration on every render so the image is cache-friendly and does not
 * flicker between visits. FNV-1a, which is short, deterministic and has no
 * dependency.
 */
export function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * THE LIBRARY IS ONE-INDEXED; EVERYTHING ELSE HERE IS ZERO-INDEXED.
 *
 * `sector-energy-01.webp` through `-10.webp`, with no `-00` in the whole set.
 * §6's `pick()` formula is written 0-based (`hash % count`) and was implemented
 * that way, which asked for 52 files that do not exist and left 52 that do
 * unreachable — the manifest and the folder disagreeing in a way only a visitor
 * would have seen, as a broken image.
 *
 * The +1 lives HERE, at name construction, and nowhere else. `index` stays
 * 0-based through `hash % count`, the collision walk and the `taken` set, so the
 * re-hash-on-collision rule and its tests are untouched by the correction. The
 * committed files are not renamed: the naming predates the formula.
 */
function artAt(bucket: string, index: number): NewsArt {
  const stem = `/news-art/${bucket}-${pad(index + 1)}`;
  return {
    // srcset offers the small variant for narrow viewports. Both files are
    // pre-generated at fixed sizes; nothing is transformed at request time.
    src: `${stem}.webp`,
    srcSet: `${stem}-sm.webp 320w, ${stem}.webp 1200w`,
    width: ART_WIDTH,
    height: ART_HEIGHT,
    bucket,
  };
}

/**
 * Pick art for one item, avoiding images already used on this page.
 *
 * RE-HASH ON COLLISION, per §6: buckets hold as few as four images and the page
 * shows five lead cards, so without this the same illustration appears twice
 * above the fold. `taken` is mutated so a caller can walk the lead cards in
 * order; when the bucket is smaller than the number of cards a repeat is
 * unavoidable and the first choice is used rather than returning nothing.
 */
export function pickArt(bucket: string | null, key: string, taken?: Set<number>): NewsArt | null {
  const count = bucketCount(bucket);
  if (!bucket || count <= 0) return null;

  const first = hashKey(key) % count;
  if (!taken) return artAt(bucket, first);

  for (let step = 0; step < count; step += 1) {
    const index = (first + step) % count;
    if (!taken.has(index)) {
      taken.add(index);
      return artAt(bucket, index);
    }
  }

  // Every image in the bucket is already on the page. Repeat rather than drop.
  return artAt(bucket, first);
}
