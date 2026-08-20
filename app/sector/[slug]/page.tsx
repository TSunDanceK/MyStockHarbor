import { notFound, redirect } from "next/navigation";

import { SECTORS, getSectorBySlug, sectorNewsPath } from "@/lib/sectors";

// This route carried no segment config at all, so it built as `f` -- every
// request paid a full serverless render just to issue a redirect. (Worth noting
// against the assumption that the whole /sector/[slug] family already ran at
// 1800: only the /news child did. This one had nothing.)
//
// 1800 matches the /news child it redirects to, for consistency rather than
// freshness -- the redirect target is a pure function of the slug and cannot go
// stale. The interval is set so the pair cannot drift apart if this route ever
// grows real content (see the note below about it being kept free for a fuller
// sector hub).
export const revalidate = 1800;

// A dynamic segment cannot be ISR at all without this export, even with nothing
// dynamic left in the route -- measured on /stock/[symbol] in #280, where the
// routes stayed `f` until an empty generateStaticParams existed.
//
// A real list rather than an empty one here, mirroring the /news child: all 11
// slugs are known at build time from SECTORS, there is no per-slug data fetch on
// this route to make prerendering expensive (it is a redirect), and prerendering
// makes the redirect itself cacheable rather than a per-request render.
//
// dynamicParams stays at its default (true), so an unrecognised slug still
// renders on demand and hits the notFound() below.
export function generateStaticParams() {
  return SECTORS.map((sector) => ({ slug: sector.slug }));
}

// /sector/{slug} currently has exactly one thing on it, so it redirects to it.
//
// Same pattern as app/news/page.tsx -> /headlines. The URL is deliberately kept
// free rather than collapsed into /sector/{slug}/news: if a fuller sector hub
// (overview, constituents, valuation, earnings) is built later it lands here
// with no redirect churn on an already-indexed path.
export default async function SectorIndexRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sector = getSectorBySlug(slug);

  if (!sector) notFound();

  redirect(sectorNewsPath(sector.slug));
}
