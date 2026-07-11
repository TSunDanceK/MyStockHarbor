"use client";

import { useEffect } from "react";

// Scrolls a specific result card into view and gives it a brief highlight
// pulse when a page is opened with ?symbol=XYZ (e.g. from the /pickers
// accordion's "jump to this stock" links). Renders nothing itself -- the
// actual highlight animation lives on the .resultCard.highlight CSS class
// in PickerResultPage.tsx; this just adds/removes that class and scrolls.
export default function PickerHighlightScroller({ symbol }: { symbol: string }) {
  useEffect(() => {
    if (!symbol) return;
    const el = document.getElementById(`picker-${symbol}`);
    if (!el) return;

    const scrollTimer = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);

    el.classList.add("highlight");
    const clearTimer = window.setTimeout(() => {
      el.classList.remove("highlight");
    }, 2600);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [symbol]);

  return null;
}
