"use client";

import { AD_LABEL_STYLE, PartnerImage, type RailCreative } from "./AffiliateRail";
import { usePartnerAds } from "./usePartnerAds";

// One horizontal partner banner under a block (the dashboard chart; owner
// request, #553, 14 Oct). Same rules as the rail: UK/EU/EEA visitors who
// pressed Accept only, nothing rendered and nothing requested otherwise. It
// scales down to the width it is given rather than overflowing.
export default function AffiliateBanner({ creative, minWidth = 900 }: { creative: RailCreative; minWidth?: number }) {
  const show = usePartnerAds(minWidth);
  if (!show) return null;
  return (
    <aside aria-label="Sponsored" style={{ display: "grid", gap: 4, justifyItems: "center", minWidth: 0 }}>
      <div style={AD_LABEL_STYLE}>Ad</div>
      <PartnerImage c={creative} fluid />
    </aside>
  );
}
