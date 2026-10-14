"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CONSENT_CHANGED, CONSENT_OPEN, askRegion, readConsent, writeConsent } from "./consentClient";

// The cookie banner: UK + EU/EEA visitors only, nothing anywhere else. Shows
// until a choice is stored (a first-party cookie, six months) and again when
// the footer's "Cookie settings" link asks. Accept and Reject are the same
// size and colour on purpose. Until Accept, the partner-ad rail loads nothing
// and Google runs on Consent Mode defaults of denied (app/layout.tsx).
const BUTTON: React.CSSProperties = {
  flex: "1 1 0", minWidth: 96, padding: "9px 14px", borderRadius: 8, cursor: "pointer",
  border: "1px solid rgba(148,163,184,0.5)", background: "#1e293b", color: "#f1f5f9", font: "inherit", fontWeight: 700, fontSize: 14,
};

export default function CookieConsent() {
  const [inScope, setInScope] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    askRegion().then((yes) => {
      if (!live) return;
      setInScope(yes);
      if (yes && readConsent() === null) setOpen(true);
    });
    const reopen = () => setOpen(true);
    window.addEventListener(CONSENT_OPEN, reopen);
    return () => { live = false; window.removeEventListener(CONSENT_OPEN, reopen); };
  }, []);

  useEffect(() => {
    // Another tab-local component (or this one) stored a choice: close.
    const closed = () => setOpen(false);
    window.addEventListener(CONSENT_CHANGED, closed);
    return () => window.removeEventListener(CONSENT_CHANGED, closed);
  }, []);

  if (!inScope || !open) return null;
  return (
    <div role="dialog" aria-label="Cookie choices" style={{ position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 2000, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ pointerEvents: "auto", maxWidth: 560, width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 12, background: "#0f172a", border: "1px solid rgba(255,255,255,0.16)", boxShadow: "0 12px 32px rgba(0,0,0,0.5)", color: "#e2e8f0", fontSize: 13, lineHeight: 1.5 }}>
        <p style={{ margin: "0 0 10px" }}>
          We use cookies for analytics and partner ads. Accept or reject.{" "}
          <Link href="/privacy-policy" style={{ color: "#93c5fd" }}>Privacy policy</Link>
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" style={BUTTON} onClick={() => writeConsent("accept")}>Accept</button>
          <button type="button" style={BUTTON} onClick={() => writeConsent("reject")}>Reject</button>
        </div>
      </div>
    </div>
  );
}
