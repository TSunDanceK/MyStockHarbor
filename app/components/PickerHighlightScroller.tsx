"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Scrolls a specific result card into view and gives it a brief highlight
// pulse when a page is opened with ?symbol=XYZ (e.g. from the /pickers
// accordion's "jump to this stock" links). Renders nothing itself -- the
// actual highlight animation lives on the .resultCard.highlight CSS class
// in PickerResultPage.tsx; this just adds/removes that class and scrolls.
//
// The symbol used to arrive as a prop, read from searchParams in the server
// component. It is read here instead because awaiting searchParams on the
// server opts the whole route out of static rendering, and all 32 screener
// pages were paying a full serverless render per visit and per crawl for a
// value only a browser was ever going to use. Nothing about the behaviour
// changes: this always ran in an effect, after hydration, against the live
// DOM.
//
// MUST be rendered inside a <Suspense> boundary. useSearchParams() without
// one makes Next bail the entire page out of static generation -- quietly
// undoing the exact thing this move is for -- and the build fails with
// "missing suspense boundary with useSearchParams" rather than warning.
//
// A null fallback is right: the prerendered HTML should contain nothing for
// this, and there is nothing worth showing while it resolves.
export default function PickerHighlightScroller() {
  const searchParams = useSearchParams();
  const raw = searchParams.get("symbol") ?? "";
  const symbol = raw.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");

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
