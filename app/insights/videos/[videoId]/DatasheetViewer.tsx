"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  alt: string;
};

export default function DatasheetViewer({ src, alt }: Props) {
  const [open, setOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setZoomed(false);
    if (typeof document !== "undefined" && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }, []);

  const openViewer = useCallback(() => {
    setOpen(true);
  }, []);

  // Try real fullscreen once the overlay is mounted. Falls back silently to the
  // fixed-position overlay (iOS Safari has no Element.requestFullscreen).
  useEffect(() => {
    if (!open) return;
    const node = overlayRef.current;
    if (node && !document.fullscreenElement && typeof node.requestFullscreen === "function") {
      void node.requestFullscreen().catch(() => {});
    }
  }, [open]);

  // Esc to close, and close if the user leaves fullscreen via the browser chrome.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onFsChange = () => {
      if (!document.fullscreenElement) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFsChange);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 11, opacity: 0.55, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Investor datasheet</div>
        <button
          type="button"
          onClick={openViewer}
          aria-label="View investor datasheet full screen"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.05)",
            color: "#f1f5f9",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />
          </svg>
          Full screen
        </button>
      </div>

      <img
        src={src}
        alt={alt}
        onClick={openViewer}
        style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", cursor: "zoom-in", display: "block" }}
      />

      {open && (
        <div
          ref={overlayRef}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(3,7,18,0.97)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            overflow: zoomed ? "auto" : "hidden",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
            aria-label="Close full screen"
            style={{
              position: "fixed",
              top: 16,
              right: 16,
              zIndex: 1,
              width: 40,
              height: 40,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.08)",
              color: "#f1f5f9",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
            }}
          >
            ×
          </button>

          <img
            src={src}
            alt={alt}
            onClick={(e) => {
              e.stopPropagation();
              setZoomed((z) => !z);
            }}
            style={
              zoomed
                ? { width: "auto", maxWidth: "none", height: "auto", borderRadius: 4, cursor: "zoom-out", display: "block", margin: "auto" }
                : { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4, cursor: "zoom-in", display: "block" }
            }
          />
        </div>
      )}
    </div>
  );
}
