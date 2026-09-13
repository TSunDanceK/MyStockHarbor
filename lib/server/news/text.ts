// Text hygiene shared by every news adapter and by the parsers that feed them.
//
// MOVED VERBATIM out of lib/stock-news-data.ts in step 1 of
// claude/news-adapter-spec-2026-09-13.md. It had to move rather than be imported
// from there: the adapters are called BY stock-news-data, so importing these
// back out of it would be a cycle. Nothing about the functions changed -- the
// bodies below are the shipping ones, comments included.
//
// IMPORTS NOTHING, like ./types.ts, so it stays safe for any adapter to use.

export function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

// Some upstream sources (mainly the Google News RSS fallback used for
// thin-coverage / freshly-listed tickers) occasionally hand back a
// title/description that is itself a raw HTML snippet -- e.g.
// `<a href="...">Headline</a>&nbsp;<font color="#6f6f6f">Source</font>` --
// rather than plain text. Since titles/descriptions are rendered as plain
// React text (never dangerouslySetInnerHTML'd), any literal "<...>" that
// slips through shows up as visible, broken-looking markup on the page.
// stripHtmlTags is the one place that unwraps CDATA, strips tags, and
// collapses whitespace; both cleanRssDescription (below) and the title
// handling in parseRss (lib/stock-news-data.ts) and in the adapters
// (./fmpProvider.ts) route through it so there's a single implementation to
// keep in sync.
export function stripHtmlTags(value: string) {
  return decodeHtml(
    value
      .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// A legitimate headline never contains a literal HTML tag. When one does
// (see stripHtmlTags' comment above), that's a strong signal the whole item
// is a malformed auto-generated snippet rather than real editorial content
// -- better to drop it than show a "cleaned" but still nonsensical
// duplicate-of-itself headline.
export function containsHtmlMarkup(value: string) {
  return /<[a-z][^>]*>/i.test(value);
}

export function cleanRssDescription(value: string | null) {
  if (!value) return null;
  const cleaned = stripHtmlTags(value);
  return cleaned || null;
}
