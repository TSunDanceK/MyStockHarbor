// Whether publisher-supplied article images are rendered. They are not.
//
// ── WHY THIS IS OFF ────────────────────────────────────────────────────────
// Step 0 of claude/news-adapter-spec-2026-09-13.md. The site was hotlinking
// publisher thumbnails supplied through FMP's news feed. FMP aggregated other
// people's articles and passed through other people's image URLs -- they were
// never the rights holder, so no FMP plan at any price could have granted the
// right to display a Getty photograph, and FMP have themselves said the plan
// does not cover this usage.
//
// That is why this shipped BEFORE the adapter migration rather than as part of
// it: the exposure was running in production every day the migration took.
//
// ── WHY IT IS A FLAG AND NOT A DELETION ────────────────────────────────────
// The owner's standing convention, and the reason it earns its keep here: if a
// licensed image source ever arrives -- a wire feed whose own credit line names
// the wire itself, per the cascade in §6 -- turning the render back on is this
// one constant, not an archaeology exercise across four files. The render code
// at each call site is left intact and guarded, and each site says so.
//
// FLIPPING THIS TO true IS NOT SUFFICIENT ON ITS OWN. §6's cascade is
// per-item -- allow a wire's self-credited image, deny an agency credit, deny
// anything with no credit at all -- so a real re-enable also needs that
// per-item verdict (NewsItem.imageVerdict) to exist and be consulted. This
// constant is the master switch above it, not the whole policy.
//
// The four call sites it guards:
//   app/stock/[symbol]/news/page.tsx   lead cards and compact rows
//   app/sector/[slug]/news/page.tsx    lead cards and compact rows
//   app/headlines/page.tsx             headline cards
//   app/components/DashboardClient.tsx dashboard news strip
//
// scripts/check-news-art.mjs asserts that no call site renders a publisher URL
// without this guard, so a fifth one cannot be added quietly.
export const SHOW_PUBLISHER_IMAGES = false;
