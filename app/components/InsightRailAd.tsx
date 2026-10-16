"use client";

import { AD_LABEL_STYLE, PartnerImage, type RailCreative } from "./AffiliateRail";
import { usePartnerAds } from "./usePartnerAds";

// One 300x600 partner banner at the foot of an insight post's right-hand
// column, under the sector card (owner request, #553, 16 Oct). Same rules as
// the screener rail: UK / EU / EEA visitors who pressed Accept only, and only
// while the page is two columns wide (above the 900px the layout collapses at),
// so it never lands in a stacked mobile page. Otherwise nothing renders and
// nothing is requested.
const TWO_COLUMNS_FROM = 901;

export default function InsightRailAd({ creative }: { creative: RailCreative }) {
  const show = usePartnerAds(TWO_COLUMNS_FROM);
  if (!show) return null;
  return (
    <aside aria-label="Sponsored" data-insight-rail-ad="" style={{ display: "grid", justifyItems: "center", gap: 8, padding: "4px 0 8px" }}>
      <div style={AD_LABEL_STYLE}>Ad</div>
      <PartnerImage c={creative} />
    </aside>
  );
}
