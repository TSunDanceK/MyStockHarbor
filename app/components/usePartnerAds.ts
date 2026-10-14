"use client";

import { useEffect, useState } from "react";
import { CONSENT_CHANGED, askRegion, readConsent } from "./consentClient";

/**
 * May a partner ad render here? True only when the viewport is at least
 * `minWidth` wide (so the slot really has room), the visitor is in the UK or
 * EU/EEA (/api/ad-region) and they pressed Accept on the cookie banner. False
 * everywhere else, including before the checks finish, so no ad element and
 * no request to a partner host exists until all three hold.
 */
export function usePartnerAds(minWidth: number): boolean {
  const [wide, setWide] = useState(false);
  const [inScope, setInScope] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let live = true;
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const onWide = () => setWide(mq.matches);
    const onConsent = () => setAccepted(readConsent() === "accept");
    onWide(); onConsent();
    mq.addEventListener("change", onWide);
    window.addEventListener(CONSENT_CHANGED, onConsent);
    askRegion().then((yes) => { if (live) setInScope(yes); });
    return () => { live = false; mq.removeEventListener("change", onWide); window.removeEventListener(CONSENT_CHANGED, onConsent); };
  }, [minWidth]);

  return wide && inScope && accepted;
}
