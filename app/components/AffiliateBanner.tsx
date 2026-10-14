"use client";

import { AD_LABEL_STYLE, PartnerImage, type RailCreative } from "./AffiliateRail";
import { usePartnerAds } from "./usePartnerAds";

// One horizontal partner banner under a block (the dashboard chart; owner
// request, #553, 14 Oct). Same rules as the rail: UK/EU/EEA visitors who
// pressed Accept only, nothing rendered and nothing requested otherwise. It
// scales down to the width it is given rather than overflowing.
//
// With an `offer`, a short notice sits with an arrow pointing at the banner.
// Placement follows the container's own width, so it holds if the dashboard
// layout moves: wide enough, the banner is pushed to the right and the notice
// sits on its left with a right arrow; narrower, the notice sits above the
// banner with a down arrow.
export type BannerOffer = { headline: string; detail: string };

const CSS = `
.pbWrap { container-type: inline-size; display: grid; gap: 4px; min-width: 0; justify-items: center; }
.pbRow { display: flex; flex-direction: column; align-items: center; gap: 8px; max-width: 100%; min-width: 0; }
.pbOffer { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-radius: 12px; border: 1px solid rgba(34,197,94,0.45); background: rgba(34,197,94,0.10); color: #e2e8f0; text-decoration: none; font-size: 13px; line-height: 1.35; text-align: left; }
.pbOffer strong { font-size: 20px; line-height: 1; font-weight: 900; color: #4ade80; white-space: nowrap; }
.pbOffer span.pbDetail { max-width: 230px; }
.pbArrow { font-size: 22px; font-weight: 900; color: #4ade80; line-height: 1; }
.pbArrow::before { content: "\\2193"; }
@container (min-width: 960px) {
  .pbLabel { justify-self: center; }
  .pbRow { width: 100%; flex-direction: row; justify-content: center; align-items: center; gap: 16px; }
  .pbArrow::before { content: "\\2192"; }
}
`;

export default function AffiliateBanner({ creative, offer, minWidth = 900 }: { creative: RailCreative; offer?: BannerOffer; minWidth?: number }) {
  const show = usePartnerAds(minWidth);
  if (!show) return null;
  return (
    <aside aria-label="Sponsored" className="pbWrap">
      <style>{CSS}</style>
      <div className="pbLabel" style={AD_LABEL_STYLE}>Ad</div>
      <div className="pbRow">
        {offer ? (
          <a className="pbOffer" href={creative.href} target="_blank" rel="sponsored noopener noreferrer">
            <strong>{offer.headline}</strong>
            <span className="pbDetail">{offer.detail}</span>
            <span className="pbArrow" aria-hidden="true" />
          </a>
        ) : null}
        <PartnerImage c={creative} fluid />
      </div>
    </aside>
  );
}
