"use client";

import { useEffect, useState } from "react";
import { CONSENT_OPEN, askRegion } from "./consentClient";

// The footer's "Cookie settings": reopens the banner. Shown only where the
// banner can show (UK + EU/EEA), so everyone else sees no extra footer link.
export default function CookieSettingsLink() {
  const [inScope, setInScope] = useState(false);
  useEffect(() => {
    let live = true;
    askRegion().then((yes) => { if (live) setInScope(yes); });
    return () => { live = false; };
  }, []);
  if (!inScope) return null;
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN))}
      style={{ background: "none", border: 0, padding: 0, marginLeft: 14, font: "inherit", color: "inherit", textDecoration: "underline", cursor: "pointer" }}>
      Cookie settings
    </button>
  );
}
