"use client";

import { useEffect, useState } from "react";
import { CONSENT_CHANGED, askRegion, readConsent } from "./consentClient";

// A stack of partner banners for the empty strip beside a text block (owner
// ruling, #553, 14 Oct: the table keeps its full width). It is an ordinary flex
// child at the right of the parent (display: flex), so it scrolls with the page
// and the parent grows to hold it. It shows when ALL of these hold, and otherwise renders
// nothing (no request, no element): the viewport is at least MIN_WIDTH wide
// (so the strip is really empty), the visitor is in the UK or EU/EEA
// (/api/ad-region), and they have pressed Accept.
//
// Reusable: a different slot or creative is another <AffiliateRail creatives={[...]} />.
export type RailCreative = { href: string; imgSrc: string; imgSrc2x?: string; width: number; height: number; alt: string };

const MIN_WIDTH = 1380; // 780px text column + a 30px gap + 160px banner + the 352px sidebar and page padding

export default function AffiliateRail({ creatives }: { creatives: RailCreative[] }) {
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
  const width = Math.max(...creatives.map((c) => c.width));
  return (
    <aside aria-label="Sponsored" style={{ flex: "none", marginTop: 40, width, display: "grid", gap: 12, alignContent: "start" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(148,163,184,0.8)" }}>Ad</div>
      {creatives.map((c) => (
        <a key={c.href} href={c.href} target="_blank" rel="sponsored noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- a partner creative served by the partner, deliberately not through next/image */}
          <img src={c.imgSrc} srcSet={c.imgSrc2x ? `${c.imgSrc} 1x, ${c.imgSrc2x} 2x` : undefined} width={c.width} height={c.height} alt={c.alt} loading="lazy" style={{ display: "block", border: 0 }} />
        </a>
      ))}
    </aside>
  );
}
