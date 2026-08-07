import { notFound, redirect } from "next/navigation";

import { getSectorBySlug, sectorNewsPath } from "@/lib/sectors";

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
