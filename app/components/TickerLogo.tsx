"use client";

import { useEffect, useRef, useState } from "react";

// Small ticker/company logo with a graceful fallback chain, shared across
// the site (search dropdowns, dashboard live feed + quote header, the
// stock/news/earnings headers, and the insights + bottleneck lists).
//
// Source order -- first that loads wins:
//   1. Harvested local file   (/logos/SYM.webp) -- served from our own domain,
//      no third party in it, and the fastest of the four. Tried UNCONDITIONALLY:
//      see the note on the manifest below.
//   2. Clearbit domain logo   (when a `domain` is known -- e.g. bottleneck
//      posts already carry one; same source CompanyLogo.tsx uses).
//   3. Monogram (first letter of name/symbol) -- so nothing ever renders as
//      a broken image, matching the letter treatment used before logos.
//
// FMP'S IMAGE CDN WAS SOURCE 3 UNTIL 3 OCT 2026, removed with the FMP exit
// (#553 COWORK #102, owner ruling on checklist row B9): no third-party vendor
// hotlink stays in the chain. The last harvest ran the same day, while the CDN
// still served (2,612 files, 4.6 MB).
//
// THE HARVEST IS A SNAPSHOT, not a live index -- see
// claude/BRIEF-logo-harvest-2026-09-14.md. It is re-run quarterly, and between
// runs a newly listed symbol simply falls through to the monogram. No breakage
// either way.

// ONE CONSTANT, so moving the assets off our own domain later (a separate repo
// on GitHub Pages was the runner-up home) is a one-line change rather than a
// hunt through call sites.
const LOGO_BASE = "/logos";

/**
 * AN IMAGE THAT HAS ALREADY FAILED (#552 COWORK #174). On a server-rendered
 * page the browser can finish (and fail) the request BEFORE React hydrates and
 * attaches onError, so the error is never heard and a white tile with nothing
 * in it stays: TMQ (no file) on the calendar, JOBY in the stock page header.
 * A finished image with no pixels is the failure, read after mount. A lazy
 * image not yet loaded is not complete, and is left to onError.
 * Measured in Chromium: a broken <img alt=""> still paints its white
 * background and a broken-image glyph, so no CSS-only fallback can cover it.
 */
export function imageFailed(img: Pick<HTMLImageElement, "complete" | "naturalWidth"> | null): boolean {
  return Boolean(img && img.complete && img.naturalWidth === 0);
}

// ── NO MANIFEST AT RUNTIME, DELIBERATELY ──────────────────────────────────
// data/logo-manifest.json is still emitted by the harvest, and is still the
// record used to diff one re-harvest against the next. It is NOT imported here.
//
// This is a client component, so importing it would ship all 2,622 symbols to
// every visitor on every page -- measured at 16.7 KB raw, 6.4 KB gzipped, plus
// parse -- to buy one thing: skipping a 404 for the 31 symbols (1.2%) that have
// no harvested file. onError already handles exactly that, by advancing to the
// next source, which is the same path a symbol takes when its Clearbit or FMP
// logo is missing. Paying a whole-universe download on every page to avoid a
// rare, already-handled 404 is the wrong trade.

export default function TickerLogo({
  symbol,
  domain,
  name,
  size = 24,
  radius = 8,
  alt,
}: {
  symbol?: string | null;
  domain?: string | null;
  name?: string | null;
  size?: number;
  radius?: number | string;
  /** The image's alt text. Default "{SYM} logo"; "" where the ticker text beside it already names it. */
  alt?: string;
}) {
  const sym = (symbol || "").toUpperCase().trim();

  const sources: string[] = [];
  if (sym) sources.push(`${LOGO_BASE}/${encodeURIComponent(sym)}.webp`);
  if (domain) sources.push(`https://logo.clearbit.com/${domain}`);

  // ── THE FALLBACK POSITION IS SCOPED TO THE SYMBOL IT WAS EARNED ON ───────
  // A plain useState(0) survives a symbol change, because React reuses the
  // instance when the element keeps its position and key. An instance that had
  // walked to idx 2 for the previous symbol would therefore START at 2 for the
  // next one -- skipping /logos/{SYM}.webp and serving the next source instead. It renders
  // a correct-looking logo either way, which is exactly why a visual check
  // cannot catch it.
  //
  // Pre-existing, but Phase 3 is what makes it matter: the chain got longer and
  // the source being skipped is now the harvested one this whole change exists
  // to serve. Most call sites are symbol-keyed and remount anyway
  // (DashboardTicker's item.id is `mover-${symbol}` and friends, so its key
  // changes with the symbol); the ones that change symbol IN PLACE are
  // DashboardClient's quote header and CustomScreenerSymbolSearch's selected
  // row. Rather than depend on every call site keying correctly forever, the
  // reset lives here.
  //
  // WHAT THIS DOES NOT DO is make a late onError from the previous symbol's
  // request safe. React replaces the onError closure on re-render, so an error
  // dispatched after the symbol changed would run the NEW closure and capture
  // the NEW sym -- advancing the new symbol past its harvested file. The old
  // closure does not survive to be harmlessly discarded, and an earlier version
  // of this comment claimed it did.
  //
  // The case is fine for a different reason: assigning a new src ABORTS the
  // in-flight load, and an aborted image request does not fire error. So the
  // late error should never be dispatched in the first place. If a browser is
  // ever seen firing error on an abort, key={sym} on the <img> below makes the
  // whole class structurally impossible -- a fresh element per symbol. Not done
  // pre-emptively. See claude/serving-assets-from-public-2026-09-15.md.
  const [fallback, setFallback] = useState({ sym, idx: 0 });
  const idx = fallback.sym === sym ? fallback.idx : 0;
  const imgRef = useRef<HTMLImageElement>(null);
  // THE ERROR THAT FIRED BEFORE HYDRATION: checked once the element is ours.
  useEffect(() => {
    // Read on the next frame: the check is of the DOM, and the switch is a
    // callback from it rather than a render-time cascade.
    const frame = requestAnimationFrame(() => {
      if (imageFailed(imgRef.current)) setFallback({ sym, idx: idx + 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [sym, idx]);
  const initial = (name || sym || "?").trim().charAt(0).toUpperCase() || "?";

  const box: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    boxSizing: "border-box",
  };

  // Every source exhausted -> monogram chip.
  if (idx >= sources.length) {
    return (
      <div
        aria-hidden="true"
        style={{
          ...box,
          background: "rgba(95,212,199,0.12)",
          border: "1px solid rgba(95,212,199,0.35)",
          fontSize: Math.round(size * 0.42),
          fontWeight: 800,
          color: "#5FD4C7",
        }}
      >
        {initial}
      </div>
    );
  }

  return (
    <div
      style={{
        ...box,
        background: "#ffffff",
        border: "1px solid rgba(255,255,255,0.12)",
        padding: Math.max(1, Math.round(size * 0.12)),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={sources[idx]}
        alt={alt ?? (sym ? `${sym} logo` : "")}
        loading="lazy"
        onError={() => setFallback({ sym, idx: idx + 1 })}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
    </div>
  );
}
