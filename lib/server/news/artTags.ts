// Which TAGGED illustration an article gets, if any. The v2 library's picker.
//
// The tagged-library brief of 2026-09-21, mirrored at
// claude/news-art-v2-headlines-2026-09-21.md §4.2. Pure lookup: no I/O and no
// network. The manifest is imported, so it is bundled rather than read from
// disk at request time — files in public/ are static CDN assets and are not
// reliably readable with fs from a serverless function.
//
// ── TWO MANIFESTS, TWO CONSUMERS, NO SHARED TYPE ───────────────────────────
// art.ts imports public/news-art/manifest.json as Record<string, number>: the
// BUCKET COUNTS behind sector-* and event-*. This file imports
// public/news-art/manifest-v2.json, which maps a WHOLE FILENAME STEM to the
// tags that image carries. They are different shapes on purpose. Putting the v2
// shape at the v1 path would break the three working symbol-led surfaces at
// build time or, worse, silently — so manifest.json is not touched by any of
// this, and scripts/check-news-art.mjs asserts it still holds numbers.
//
// ── THE NAME IS THE WHOLE NAME ─────────────────────────────────────────────
// v1 names are `<bucket>-<nn>` and art.ts adds the +1 at filename construction,
// which is the 0-vs-1 indexing bug the README still carries the scar of. There
// is no index arithmetic here AT ALL: the manifest key IS the file stem,
// `chips-any-01`, suffix included. Nothing to get wrong this time.
//
// ── A SCORE OF 0 RETURNS null, NEVER A RANDOM IMAGE ────────────────────────
// This is the same rule as eventType's null and for the same reason: a wrong
// picture asserts something false about the article, a missing one asserts
// nothing. /headlines falls through to the event-art path it already had.
import manifest from "@/public/news-art/manifest-v2.json";
import { ART_WIDTH, ART_HEIGHT, bucketForItem, hashKey, planCardArt, type CardArt, type NewsArt } from "./art";
import { articleTopic, MARKET_WIDE_SUBJECTS } from "./articleTopic";
import { eventTypeFromTitle, type EventType } from "./eventType";
import { industryTag } from "./industryArt";

/**
 * One image's tags, as the generator wrote them.
 *
 * `tone` and `palette` are RECORDED AND UNUSED, deliberately: selecting on tone
 * would mean deciding an article is good or bad news from its headline, which
 * is a different and much less reliable classifier than this one. They stay in
 * the file so that decision can be taken later with the data already there.
 */
export type TaggedEntry = {
  primary?: string[];
  related?: string[];
  motif?: string[];
  tone?: string;
  palette?: string;
  source?: { batch?: string; serial?: string };
};

const ENTRIES = manifest as Record<string, TaggedEntry>;

/**
 * THE NAMES, SORTED ONCE.
 *
 * Sorted rather than left in JSON key order because the winning set is walked
 * by `hash % length` and key order is a property of how the manifest was
 * serialised, not of the library. Re-exporting the same 330 images from the
 * generator in a different order would silently re-assign every article's
 * picture; sorting makes that impossible.
 */
const NAMES: string[] = Object.keys(ENTRIES).sort();

/**
 * The placeholder both axes use for "no tag on this axis".
 *
 * A subject image is `{ primary: ["chips"], motif: ["any"] }` and a motif image
 * is `{ primary: [], motif: ["macro"] }`. Nothing in articleTopic.ts can emit
 * "any", so it would already score 0 — but if anything ever did, every one of
 * the 268 subject images would tie at 2 and the picker would hand back an
 * arbitrary illustration for every article on the page. Skipped explicitly, so
 * that failure needs a deliberate change rather than a typo.
 */
const ANY = "any";

const asTags = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== ANY) : [];

const overlap = (tags: string[], wanted: Set<string>): number => {
  let n = 0;
  for (const tag of tags) if (wanted.has(tag)) n += 1;
  return n;
};

/**
 * §2's scoring, unchanged:
 *
 *   score = 3 × |primary ∩ subjectTags|
 *         + 1 × |related ∩ subjectTags|
 *         + 2 × |motif   ∩ articleMotifs|
 *
 * ── WHY MOTIF SCORES 2 AND NOT 4 ──────────────────────────────────────────
 * A story about a bank BEING SUED is a legal story, not a banking one, and the
 * picture that asserts the least while still being true is the courtroom, not
 * the vault. Subject outranking motif is what puts the refinery on the diesel
 * story; motif at 2 outranking a merely-related subject at 1 is what stops a
 * tangential subject tag beating the thing that actually happened.
 */
export function scoreEntry(
  entry: TaggedEntry,
  subjectTags: Set<string>,
  articleMotifs: Set<string>
): number {
  return (
    3 * overlap(asTags(entry.primary), subjectTags) +
    1 * overlap(asTags(entry.related), subjectTags) +
    2 * overlap(asTags(entry.motif), articleMotifs)
  );
}

/** The `src`/`srcSet` pair for one image, built exactly as artAt does in v1. */
function artFor(name: string): NewsArt {
  const stem = `/news-art/${name}`;
  return {
    src: `${stem}.webp`,
    srcSet: `${stem}-sm.webp 320w, ${stem}.webp 1200w`,
    width: ART_WIDTH,
    height: ART_HEIGHT,
    // v1's "bucket" is a folder-less prefix shared by several files. v2 has no
    // buckets, so the nearest true thing is the image's own name — which is
    // what the check script and any debugging actually want.
    bucket: name,
  };
}

/** Every name that ties for the top score, or an empty array when the top is 0. */
export function topScoring(subjectTags: Set<string>, articleMotifs: Set<string>): string[] {
  let best = 0;
  let winners: string[] = [];
  for (const name of NAMES) {
    const score = scoreEntry(ENTRIES[name], subjectTags, articleMotifs);
    if (score <= 0) continue;
    if (score > best) {
      best = score;
      winners = [name];
    } else if (score === best) {
      winners.push(name);
    }
  }
  return winners;
}

/**
 * Pick tagged art for one article, avoiding images already used on this page.
 *
 * RE-HASH ON COLLISION, exactly as pickArt does: the winning set for a tag as
 * narrow as `solar` is four images and the grid shows more cards than that, so
 * without the walk the same illustration appears twice. `taken` is mutated, so
 * one Set is shared across a page and passed in render order. When every
 * winner is already on the page a repeat is unavoidable and the first choice is
 * used rather than returning nothing — again matching v1.
 *
 * THE KEY IS THE ARTICLE'S, NOT THE PAGE'S: the same article must get the same
 * picture on every render, or the image cache never warms and the card flickers
 * between visits. hashKey is imported from art.ts rather than reimplemented —
 * a second hash in the tree is a second thing to keep in agreement forever.
 */
export function pickTagged(input: {
  subjectTags: string[];
  articleMotifs: string[];
  /** Stable per-article key: a guid where there is one, else the link. */
  key: string;
  /** No-repeat state, keyed BY NAME. Mutated, so pass the same Set per page. */
  taken?: Set<string>;
}): NewsArt | null {
  const subjects = new Set(input.subjectTags.filter((t) => t && t !== ANY));
  const motifs = new Set(input.articleMotifs.filter((t) => t && t !== ANY));
  if (subjects.size === 0 && motifs.size === 0) return null;

  const winners = topScoring(subjects, motifs);
  if (winners.length === 0) return null;

  const first = hashKey(input.key) % winners.length;
  const taken = input.taken;
  if (!taken) return artFor(winners[first]);

  for (let step = 0; step < winners.length; step += 1) {
    const name = winners[(first + step) % winners.length];
    if (!taken.has(name)) {
      taken.add(name);
      return artFor(name);
    }
  }

  return artFor(winners[first]);
}

/**
 * How many images the tagged library holds. 0 until the files land.
 *
 * ── THE LIBRARY SHIPS MANIFEST-FIRST, AND THAT IS THE SAFE ORDER ──────────
 * An empty manifest-v2.json means every call above returns null and /headlines
 * behaves exactly as it does today: the event-art path, unchanged. A count
 * raised before its files exist is a broken image on a live page, which is the
 * one failure nothing else catches, since the page renders regardless and only
 * a visitor sees it. public/news-art/README.md has the order to add art in.
 */
export const TAGGED_COUNT = NAMES.length;

/**
 * THE WHOLE /headlines RULE, IN ONE FUNCTION.
 *
 * ── WHY THIS IS A FUNCTION AND NOT SIX LINES IN THE PAGE BODY ─────────────
 * Because a rule in a page body can only be GREPPED at, and this file already
 * records what that is worth: check-news-art.mjs once asserted each surface by
 * searching for `pickArt`, `GeneratedNewsArt` and a `srcSet=` attribute, and
 * wrapping the render in `{false ? ... : null}` left every one of those
 * identifiers in place while the page went blank. Six of twelve mutations
 * walked through, including the one the section was written for.
 *
 * The same thing happened again writing THIS change: an order assertion that
 * compared where `pickTagged(` and `planCardArt(` appear in the file passed
 * cleanly against `if (false && tagged)`. An index in a string cannot tell you
 * what a program does.
 *
 * As a function it is tested by CALLING it, with a substituted manifest, and a
 * constant-false guard anywhere inside fails that test immediately.
 *
 * ── THE TWO RULES, IN ORDER ───────────────────────────────────────────────
 *   1. The article's own words -> tagged art. Reaches the whole v2 library.
 *   2. Failing that, the title's event type -> today's event bucket. Exactly
 *      what this page has shipped since #481, untouched.
 *
 * ── THE TWO ARGUMENTS A GENERAL HEADLINE CANNOT SUPPLY, PINNED HERE ───────
 * sectorBucket stays null: a GeneralHeadline carries no symbol and no sector,
 * and guessing a sector from free text would put an oil rig beside a story
 * about semiconductors. Rule 1 is not that guess — it reads tags the article
 * itself states, and returns nothing when it states none.
 *
 * canGenerate stays false: the generated card is a ticker and a sparkline, and
 * with no symbol there is nothing to draw. art.ts has the rule — a ticker card
 * with no ticker is worse than a blank slot.
 *
 * So the only three outcomes are the right picture, today's picture, or none.
 */
export function planHeadlineArt(input: {
  title: string;
  /** The card's excerpt. Weighted far below the title — see articleTopic.ts. */
  description?: string | null;
  /** Stable per-article key: a guid where there is one, else the link. */
  key: string;
  /** v2 no-repeat state, keyed by image NAME. Mutated; one per page. */
  takenNames: Set<string>;
  /** v1 no-repeat state, keyed by BUCKET. Mutated; one per page. */
  takenBuckets: Map<string, Set<number>>;
}): CardArt {
  const { subjects, motifs } = articleTopic(input.title, input.description ?? null);
  const tagged = pickTagged({
    subjectTags: subjects,
    articleMotifs: motifs,
    key: input.key,
    taken: input.takenNames,
  });
  if (tagged) return { kind: "library", art: tagged };

  return planCardArt({
    variant: "lead",
    // Leg 3 of §7's cascade, and the only leg reachable from this feed: legs 1
    // and 2 read an SEC form and a wire subject, neither of which a general
    // headline has. So this returns earnings, analyst or deal — never macro or
    // filing, which eventType.ts documents as unreachable from a title — or
    // null, which is the expected answer for most.
    eventType: eventTypeFromTitle(input.title),
    sectorBucket: null,
    key: input.key,
    taken: input.takenBuckets,
    canGenerate: false,
  });
}


/**
 * THE WHOLE SYMBOL-LED RULE, IN ONE FUNCTION — layered, most specific first.
 *
 *   1. THE ARTICLE'S OWN WORDS. articleTopic's subject, market-wide tags
 *      dropped. Hits 9 of 192 per-symbol headlines (4.7%) after the exclusion.
 *   2. THE EVENT BUCKET, unchanged from today. See below — this is the layer
 *      the brief did not mention and it is deliberately ABOVE industry.
 *   3. THE INDUSTRY. industryArt.ts turns FMP's label into a v2 subject. This
 *      is the layer that does the work: it reaches 87.7% of the universe and it
 *      is what stops every Technology stock showing servers and cables.
 *   4. THE SECTOR BUCKET, today's art, unchanged.
 *
 * ── WHY THE EVENT BUCKET STAYS ABOVE THE INDUSTRY, AND IT IS A CHOICE ─────
 * The brief said "classifier, then industry, then the existing sector art", and
 * did not say where eventType goes. Putting industry above it would silently
 * take event-earnings art off every earnings story on a stock page — 7% of
 * per-symbol headlines reach an event bucket today — and replace it with a
 * picture of the company's industry.
 *
 * That is a behaviour change nobody asked for, and the ordering principle the
 * whole picker is built on says it would be the wrong one anyway: layer 1 is
 * first because the ARTICLE is more specific than the company, and an event
 * type is also a fact about the article. "Apple beats estimates" is an earnings
 * story that happens to be about a consumer-electronics company.
 *
 * It is one line to move if that judgement is wrong, and the check has a case
 * pinning the current order so moving it is visible rather than accidental.
 *
 * COMPACT ROWS NEVER REACH ANY OF THIS. planCardArt gives them the generated
 * data card, because at 56px a ticker and a move are legible where a shrunk
 * illustration is not, and that rule is not this function's to revisit.
 */
export function planSymbolCardArt(input: {
  variant: "lead" | "compact";
  title: string;
  /** The item's summary or excerpt, when it has one. */
  description?: string | null;
  /** §7's event type for this item, or null. */
  eventType?: EventType | null;
  /** FMP's industry label from resolveProfile(), or null. */
  industry: string | null;
  /** The symbol's sector bucket — layer 4, and what everything falls through to. */
  sectorBucket: string | null;
  /** Stable per-article key: a guid where there is one, else the link. */
  key: string;
  /** v2 no-repeat state, keyed by image NAME. Mutated; one per page. */
  takenNames: Set<string>;
  /** v1 no-repeat state, keyed by BUCKET. Mutated; one per page. */
  takenBuckets: Map<string, Set<number>>;
  canGenerate: boolean;
}): CardArt {
  const {
    variant, title, description, eventType, industry, sectorBucket,
    key, takenNames, takenBuckets, canGenerate,
  } = input;

  if (variant === "lead") {
    // ── LAYER 1 ──────────────────────────────────────────────────────────
    // Subjects only. A motif-only article ("…raises guidance") falls through:
    // the company's own industry says more about the picture than a generic
    // podium does, which is the opposite of the trade on /headlines, where
    // there is no company to say anything about.
    const { subjects } = articleTopic(title, description ?? null);
    const specific = subjects.filter((tag) => !MARKET_WIDE_SUBJECTS.has(tag));
    if (specific.length) {
      const art = pickTagged({
        subjectTags: specific,
        articleMotifs: [],
        key,
        taken: takenNames,
      });
      if (art) return { kind: "library", art };
    }

    // ── LAYER 3, ONLY IF LAYER 2 HAS NOTHING TO SAY ──────────────────────
    // bucketForItem answers art.ts's own question — "does this item have an
    // event bucket that holds images?" — rather than this file re-deriving it.
    // A null sector argument makes it answer about the EVENT half alone.
    if (!bucketForItem(eventType ?? null, null)) {
      const tag = industryTag(industry);
      if (tag) {
        const art = pickTagged({
          subjectTags: [tag],
          articleMotifs: [],
          key,
          taken: takenNames,
        });
        if (art) return { kind: "library", art };
      }
    }
  }

  // ── LAYERS 2 AND 4, AND THE COMPACT CARD: TODAY'S RULE, UNTOUCHED ──────
  return planCardArt({
    variant,
    eventType,
    sectorBucket,
    key,
    taken: takenBuckets,
    canGenerate,
  });
}
