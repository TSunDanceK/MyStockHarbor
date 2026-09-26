"use client";

// THE "SEC data loaded" NOTICE (#552 COWORK #46). Mounted once in the stock
// layout, so its live region is already in the DOM when the text arrives —
// a screen reader announces a CHANGE in a polite region, not a region that
// appears with its text already in it. Hides itself after a few seconds.
import { useEffect, useState, useSyncExternalStore } from "react";
import { SEC_LOADED_NOTICE_MS, SEC_LOADED_WORDS, secLoadedAt, subscribeSecLoaded } from "./secLoadedStore";

export default function SecLoadedNotice() {
  const at = useSyncExternalStore(subscribeSecLoaded, secLoadedAt, () => 0);
  const [hiddenFor, setHiddenFor] = useState(0);
  useEffect(() => {
    if (!at) return;
    const left = at + SEC_LOADED_NOTICE_MS - Date.now();
    const t = setTimeout(() => setHiddenFor(at), Math.max(0, left));
    return () => clearTimeout(t);
  }, [at]);
  const visible = at > 0 && hiddenFor !== at;
  return (
    <div role="status" aria-live="polite" className="secLoadedNotice" data-visible={visible ? "true" : "false"}>
      {visible ? SEC_LOADED_WORDS : ""}
      <style>{`
        .secLoadedNotice { position: fixed; left: 50%; bottom: calc(72px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 60; pointer-events: none; }
        .secLoadedNotice[data-visible="true"] { padding: 10px 16px; border-radius: 12px; border: 1px solid rgba(34,197,94,0.40); background: rgba(6,40,22,0.94); color: #dcfce7; font-weight: 800; font-size: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
      `}</style>
    </div>
  );
}
