// What a news card's footer is allowed to claim about where its text came from.
//
// ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
// Both news pages hardcoded one sentence:
//
//   "Article excerpt provided by the FMP news feed. AI is used only for the
//    optional 'Why this matters' read."
//
// On the step-7 preview it rendered on all fifteen cards and not one of them
// came from FMP. Post-flip it is true of one source and false of the other two,
// so it cannot stay a single sentence:
//
//   gnews  NO EXCERPT EXISTS. Google News RSS carries no usable description, so
//          the summary is BUILT from the item's own title, source and date.
//          Calling that a publisher excerpt is a false provenance claim — the
//          exact thing this migration exists to stop.
//   wire   A real issuer-written excerpt. The press release was issued FOR
//          republication, so quoting it and saying so is accurate.
//   sec    No excerpt either, and the HEADLINE is constructed too — from the
//          form type and item codes (see news/secProvider.ts).
//   fmp    A real excerpt, under the rollback. The old sentence was true here
//          and stays true here.
//
// ── IT IS DRIVEN BY WHAT WAS ACTUALLY RENDERED, NOT BY THE PROVIDER ALONE ──
// A provider-only rule would still be a guess: a wire item with an empty
// description renders the generated line, and saying "excerpt from the press
// release" under generated text is the same false claim in a new spelling. So
// `hasPublisherExcerpt` is the SAME predicate the pages use to choose between
// the description and the built sentence, exported from here and imported by
// both, because the way the old line became false was drift between what the
// page rendered and what the footer said about it.
//
// The "AI is used only for the optional read" half is true regardless of
// provider and is kept verbatim.

/** Shorter than this and the pages fall back to the generated sentence. */
const MIN_EXCERPT_CHARS = 40;

/**
 * Does this item carry a description long enough for the pages to render?
 *
 * THE PAGES MUST CALL THIS RATHER THAN RE-TESTING THE LENGTH. Two copies of a
 * 40 is two copies that can drift, and drift between the render and the claim
 * about the render is precisely the bug being fixed here.
 */
export function hasPublisherExcerpt(description: string | null | undefined): boolean {
  return String(description ?? "").trim().length >= MIN_EXCERPT_CHARS;
}

const AI_CLAUSE = 'AI is used only for the optional "Why this matters" read.';

/**
 * The footer line for one card.
 *
 * `plainText` swaps the typographic quotes the JSX version escapes, so the
 * sector page and the stock page can render the same sentence in their own
 * markup without one of them smuggling a raw quote into JSX.
 */
export function newsAttribution(item: {
  provider?: string | null;
  source?: string | null;
  description?: string | null;
}): string {
  const provider = String(item?.provider ?? "").toLowerCase();
  const source = String(item?.source ?? "").trim();

  if (hasPublisherExcerpt(item?.description)) {
    if (provider === "wire") {
      return `Excerpt from the press release${source ? `, issued via ${source}` : ""}. ${AI_CLAUSE}`;
    }
    if (provider === "fmp") {
      return `Article excerpt provided by the FMP news feed. ${AI_CLAUSE}`;
    }
    // A provider we have not named, carrying real text. Credit the source and
    // claim nothing more than that it is an excerpt.
    return `Article excerpt${source ? ` provided by ${source}` : ""}. ${AI_CLAUSE}`;
  }

  if (provider === "sec") {
    return (
      "This headline and summary are generated from the filing's form type and item codes. " +
      `Nothing here is quoted from the filing itself. ${AI_CLAUSE}`
    );
  }

  return (
    "This summary is generated from the article's headline, source and date — " +
    `it is not an excerpt from the publisher. ${AI_CLAUSE}`
  );
}
