"use client";

import { usePartnerAds } from "./usePartnerAds";

// A stack of partner banners for the empty strip beside a text block (owner
// ruling, #553, 14 Oct: the table keeps its full width). It is an ordinary flex
// child at the right of the parent (display: flex), so it scrolls with the page
// and the parent grows to hold it. Shows only where usePartnerAds allows
// (1380px+, UK/EU/EEA, accepted); otherwise renders nothing.
//
// Reusable: a different slot or creative is another <AffiliateRail creatives={[...]} />.
export type RailCreative = { href: string; imgSrc: string; imgSrc2x?: string; width: number; height: number; alt: string };

const MIN_WIDTH = 1380; // 780px text column + no gap (the banner is centred in the whole strip) + 160px banner + the 352px sidebar and page padding

export function PartnerImage({ c, fluid }: { c: RailCreative; fluid?: boolean }) {
  return (
    <a href={c.href} target="_blank" rel="sponsored noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element -- a partner creative served by the partner, deliberately not through next/image */}
      <img src={c.imgSrc} srcSet={c.imgSrc2x ? `${c.imgSrc} 1x, ${c.imgSrc2x} 2x` : undefined} width={c.width} height={c.height} alt={c.alt} loading="lazy"
        style={{ display: "block", border: 0, ...(fluid ? { maxWidth: "100%", height: "auto" } : null) }} />
    </a>
  );
}

export const AD_LABEL_STYLE: React.CSSProperties = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(148,163,184,0.8)" };

export default function AffiliateRail({ creatives }: { creatives: RailCreative[] }) {
  const show = usePartnerAds(MIN_WIDTH);
  if (!show) return null;
  const width = Math.max(...creatives.map((c) => c.width));
  // Takes all the room between the text and the table's right edge and centres the banners in it (owner request, #553).
  return (
    <aside aria-label="Sponsored" style={{ flex: `1 1 ${width}px`, minWidth: width, marginTop: 40, display: "grid", justifyItems: "center", gap: 12, alignContent: "start" }}>
      <div style={AD_LABEL_STYLE}>Ad</div>
      {creatives.map((c) => <PartnerImage key={c.href} c={c} />)}
    </aside>
  );
}
