// ONE RULE FOR A STOCK PAGE'S ROBOTS TAG AND ITS SITEMAP ENTRY (#553 COWORK #143).
//
// A URL in the sitemap while its page says noindex earns "Submitted URL marked
// noindex" in Search Console. So the page's generateMetadata and app/sitemap.ts
// call the same predicate; only how each one learns the inputs differs:
//   hasData          the page: history points or a quote price;
//                    the sitemap: the symbol's stored daily bars (eod-last)
//   awaitingSecRead  both: lib/server/secColdFetch (the sitemap asks for all
//                    its symbols in one pipelined read, sitemapSecState)
//   hasCik           the earnings page only (A's route): a CIK, or a fund the
//                    site lists (#552 COWORK #155/#156: VUG takes SPY's card)
//
// Pure. scripts/check-sitemap-robots.mjs holds the rule and its mutants.

/** /stock/[symbol]: indexable only with data to show and its SEC set read. */
export function stockPageIndexable(i: { hasData: boolean; awaitingSecRead: boolean }): boolean {
  return i.hasData && !i.awaitingSecRead;
}

/** /stock/[symbol]/earnings, as that page's own robots rule reads: a CIK, or a fund the site lists, and its SEC set read. */
export function earningsPageIndexable(i: { hasCik: boolean; awaitingSecRead: boolean }): boolean {
  return i.hasCik && !i.awaitingSecRead;
}
