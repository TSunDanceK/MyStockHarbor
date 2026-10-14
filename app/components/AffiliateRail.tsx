"use client";

import { useEffect, useState } from "react";
import { CONSENT_CHANGED, askRegion, readConsent } from "./consentClient";

// A right-hand rail for one partner banner, on wide screens only. It shows
// when ALL of these hold, and renders nothing (no request, no element)
// otherwise: the viewport is at least 1280px wide, the visitor is in the UK or
// EU/EEA (/api/ad-region), and they have pressed Accept. The page grid gets
// its third column from `html[data-ad-rail]`, set here only while the rail
// shows, so every other visitor keeps today's layout.
//
// Reusable: a different slot or creative is another <AffiliateRail creative={...} />.
export type RailCreative = { href: string; imgSrc: string; width: number; height: number; alt: string };

export default function AffiliateRail({ creative }: { creative: RailCreative }) {
  const [wide, setWide] = useState(false);
  const [inScope, setInScope] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let live = true;
    const mq = window.matchMedia("(min-width: 1280px)");
    const onWide = () => setWide(mq.matches);
    const onConsent = () => setAccepted(readConsent() === "accept");
    onWide(); onConsent();
    mq.addEventListener("change", onWide);
    window.addEventListener(CONSENT_CHANGED, onConsent);
    askRegion().then((yes) => { if (live) setInScope(yes); });
    return () => { live = false; mq.removeEventListener("change", onWide); window.removeEventListener(CONSENT_CHANGED, onConsent); };
  }, []);

  const show = wide && inScope && accepted;
  useEffect(() => {
    if (!show) return;
    document.documentElement.setAttribute("data-ad-rail", "");
    return () => document.documentElement.removeAttribute("data-ad-rail");
  }, [show]);

  if (!show) return null;
  return (
    <aside aria-label="Sponsored" style={{ width: creative.width, alignSelf: "stretch" }}>
      <div style={{ position: "sticky", top: 88 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(148,163,184,0.8)", marginBottom: 4 }}>Ad</div>
        <a href={creative.href} target="_blank" rel="sponsored noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- a partner creative served by the partner, deliberately not through next/image */}
          <img src={creative.imgSrc} width={creative.width} height={creative.height} alt={creative.alt} loading="lazy" style={{ display: "block", border: 0 }} />
        </a>
      </div>
    </aside>
  );
}
