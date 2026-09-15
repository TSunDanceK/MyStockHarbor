"use client";

import { useState } from "react";

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
//   3. FMP public symbol logo (images.financialmodelingprep.com/symbol/SYM.png)
//      -- no API key and no quota. Kept DELIBERATELY as a fallback rather than
//      removed: it costs nothing while it works and it covers anything the
//      harvest missed, including symbols that list after the last harvest.
//   4. Monogram (first letter of name/symbol) -- so nothing ever renders as
//      a broken image, matching the letter treatment used before logos.
//
// THE HARVEST IS A SNAPSHOT, not a live index -- see
// claude/BRIEF-logo-harvest-2026-09-14.md. It is re-run quarterly, and between
// runs a newly listed symbol simply falls through to source 3 and then 4. No
// breakage either way, which is why the chain below is left intact.

// ONE CONSTANT, so moving the assets off our own domain later (a separate repo
// on GitHub Pages was the runner-up home) is a one-line change rather than a
// hunt through call sites.
const LOGO_BASE = "/logos";

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
}: {
  symbol?: string | null;
  domain?: string | null;
  name?: string | null;
  size?: number;
  radius?: number | string;
}) {
  const sym = (symbol || "").toUpperCase().trim();

  const sources: string[] = [];
  if (sym) sources.push(`${LOGO_BASE}/${encodeURIComponent(sym)}.webp`);
  if (domain) sources.push(`https://logo.clearbit.com/${domain}`);
  if (sym) {
    sources.push(
      `https://images.financialmodelingprep.com/symbol/${encodeURIComponent(sym)}.png`
    );
  }

  const [idx, setIdx] = useState(0);
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
        src={sources[idx]}
        alt={sym ? `${sym} logo` : ""}
        loading="lazy"
        onError={() => setIdx((i) => i + 1)}
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
