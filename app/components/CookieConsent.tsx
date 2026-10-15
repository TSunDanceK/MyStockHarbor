"use client";

import { useEffect, useRef, useState } from "react";
import { CONSENT_CHANGED, CONSENT_OPEN, askRegion, readConsent, writeConsent } from "./consentClient";

// The cookie dialog (#553, COWORK #233): UK + EU/EEA visitors only, nothing
// anywhere else. A centred modal over a dimmed backdrop on the first visit, and
// again when the footer's "Cookie settings" link asks. Accept and Reject are the
// same size and colour on purpose; either one stores the choice and closes it,
// and the whole site works either way. No close button, no click-away dismiss
// and Esc does nothing: the only ways out are the two buttons. Focus stays in
// the dialog and the page behind does not scroll. Until Accept, the partner-ad
// rail loads nothing and Google runs on Consent Mode defaults of denied
// (app/layout.tsx). Nothing renders until the region answer is in, so it never
// holds up first paint, and it is fixed-position so it moves no layout.
const BUTTON: React.CSSProperties = {
  flex: "1 1 0", minWidth: 0, padding: "11px 16px", borderRadius: 8, cursor: "pointer",
  border: "1px solid rgba(148,163,184,0.5)", background: "#1e293b", color: "#f1f5f9", font: "inherit", fontWeight: 700, fontSize: 15,
};

export default function CookieConsent() {
  const [inScope, setInScope] = useState(false);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    askRegion().then((yes) => {
      if (!live) return;
      setInScope(yes);
      if (yes && readConsent() === null) setOpen(true);
    });
    const reopen = () => setOpen(true);
    // A stored choice (from here, or any other component) closes the dialog.
    const closed = () => setOpen(false);
    window.addEventListener(CONSENT_OPEN, reopen);
    window.addEventListener(CONSENT_CHANGED, closed);
    return () => { live = false; window.removeEventListener(CONSENT_OPEN, reopen); window.removeEventListener(CONSENT_CHANGED, closed); };
  }, []);

  const showing = inScope && open;
  useEffect(() => {
    if (!showing) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const before = document.activeElement as HTMLElement | null;
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"));

    // Lock page scroll; keep the scrollbar's width so nothing behind shifts.
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (gap > 0) body.style.paddingRight = `${gap}px`;

    buttons[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); return; } // Esc does nothing, on purpose
      if (e.key !== "Tab" || buttons.length === 0) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    // If focus escapes (a click on the backdrop, a script), pull it back.
    const onFocusIn = (e: FocusEvent) => { if (!dialog.contains(e.target as Node)) buttons[0]?.focus(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      if (before && document.contains(before)) before.focus();
    };
  }, [showing]);

  if (!showing) return null;
  return (
    // The backdrop has no click handler: clicking it does not dismiss.
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box", background: "rgba(2,6,23,0.72)" }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="msh-cookie-title"
        style={{ width: "100%", maxWidth: 420, maxHeight: "100%", overflowY: "auto", boxSizing: "border-box", padding: 24, borderRadius: 14, background: "#0f172a", border: "1px solid rgba(255,255,255,0.16)", boxShadow: "0 20px 48px rgba(0,0,0,0.55)", color: "#e2e8f0", fontSize: 15, lineHeight: 1.55 }}>
        <h2 id="msh-cookie-title" style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 800, color: "#f8fafc" }}>Cookies</h2>
        <p style={{ margin: "0 0 20px" }}>
          MyStockHarbor is free and paid for by partner adverts. Can we use cookies for ads and analytics? You can change this any time under Cookie settings in the footer.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <button type="button" style={BUTTON} onClick={() => writeConsent("accept")}>Accept</button>
          <button type="button" style={BUTTON} onClick={() => writeConsent("reject")}>Reject</button>
        </div>
      </div>
    </div>
  );
}
