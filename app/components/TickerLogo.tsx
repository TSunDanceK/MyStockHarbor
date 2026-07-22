"use client";

import { useState } from "react";

// Small ticker/company logo with a graceful fallback chain, shared across
// the site (search dropdowns, dashboard live feed + quote header, the
// stock/news/earnings headers, and the insights + bottleneck lists).
//
// Source order -- first that loads wins:
//   1. Clearbit domain logo   (when a `domain` is known -- e.g. bottleneck
//      posts already carry one; same source CompanyLogo.tsx uses).
//   2. FMP public symbol logo (images.financialmodelingprep.com/symbol/SYM.png)
//      -- no API key and no quota, so it is free to use everywhere and adds
//      no load to the FMP data plan the rest of the site is careful about.
//   3. Monogram (first letter of name/symbol) -- so nothing ever renders as
//      a broken image, matching the letter treatment used before logos.
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
