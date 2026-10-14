"use client";

import { useEffect, useState } from "react";
import { CONSENT_CHANGED, askRegion, readConsent } from "./consentClient";

// A fixed-position partner banner for the empty strip beside a text block
// (owner ruling, #553, 14 Oct: the table keeps its full width). The parent
// must be position: relative; the banner sits at its top-right and scrolls
// with the page. It shows when ALL of these hold, and otherwise renders
// nothing (no request, no element): the viewport is at least MIN_WIDTH wide
// (so the strip is really empty), the visitor is in the UK or EU/EEA
// (/api/ad-region), and they have pressed Accept.
//
// Reusable: a different slot or creative is another <AffiliateRail creative={...} />.
export type RailCreative = { href: string; imgSrc: string; width: number; height: number; alt: string };

const MIN_WIDTH = 1380; // 780px text column + a 30px gap + 160px banner + the 352px sidebar and page padding

export default function AffiliateRail({ creative }: { creative: RailCreative }) {
  const [wide, setWide] = useState(false);
  const [inScope, setInScope] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let live = true;
    const mq = window.matchMedia(`(min-width: ${MIN_WIDTH}px)`);
    const onWide = () => setWide(mq.matches);
    const onConsent = () => setAccepted(readConsent() === "accept");
    onWide(); onConsent();
    mq.addEventListener("change", onWide);
    window.addEventListener(CONSENT_CHANGED, onConsent);
    askRegion().then((yes) => { if (live) setInScope(yes); });
    return () => { live = false; mq.removeEventListener("change", onWide); window.removeEventListener(CONSENT_CHANGED, onConsent); };
  }, []);

  if (!(wide && inScope && accepted)) return null;
  return (
    <aside aria-label="Sponsored" style={{ position: "absolute", top: 40, right: 0, width: creative.width }}>
      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(148,163,184,0.8)", marginBottom: 4 }}>Ad</div>
      <a href={creative.href} target="_blank" rel="sponsored noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element -- a partner creative served by the partner, deliberately not through next/image */}
        <img src={creative.imgSrc} width={creative.width} height={creative.height} alt={creative.alt} loading="lazy" style={{ display: "block", border: 0 }} />
      </a>
    </aside>
  );
}
