"use client";

import type { ReactNode } from "react";
import { usePickerFilter } from "@/app/components/PickerFilterContext";
import { FILTER_DEFS, CATEGORY_FILTER_DEFS, type AnyFilterKey } from "@/lib/pickerFilters";

// Every checkable condition's display label, keyed by its filter key -- the 18
// custom-builder conditions plus the 7 category-membership ones. Reused from
// lib/pickerFilters.ts rather than restated here so the wording in the heading
// can't drift from the wording on the checkbox the visitor just ticked.
const LABEL_BY_KEY = new Map<string, string>(
  [...FILTER_DEFS, ...CATEGORY_FILTER_DEFS].map((def) => [def.key as string, def.label])
);

function labelFor(key: AnyFilterKey) {
  return LABEL_BY_KEY.get(key as string) ?? String(key);
}

function sameSelection(selected: AnyFilterKey[], preset: AnyFilterKey[]) {
  if (selected.length !== preset.length) return false;
  return preset.every((key) => selected.includes(key));
}

/**
 * The hero block (eyebrow / H1 / description / explainer) for a screener page.
 *
 * Dedicated condition pages now ship the whole universe with their own
 * condition pre-ticked, so a visitor can untick it or add another without
 * leaving the page (see PickerResultPage.tsx). That's good for them and bad for
 * the heading: leaving "Oversold Stocks Today" above a table of overbought
 * names reads like a bug.
 *
 * So the heading follows the selection. Three states:
 *
 *   - Selection matches the page's own preset -> render the server-supplied
 *     copy verbatim. This is the default, and it is ALWAYS what a crawler sees:
 *     the initial filter state is seeded server-side, so the SSR'd HTML carries
 *     the page's real title and description. Nothing here changes the indexed
 *     content -- the swap only ever happens after a human ticks something.
 *   - Nothing ticked -> the page has become the All Stocks screener; say so.
 *   - Anything else -> describe the actual conditions being applied.
 *
 * The explainer (passed as children) is only shown in the first state, since
 * "How to use oversold stocks" under a custom screen is the same dissonance in
 * miniature.
 */
export default function ScreenerHeroHeading({
  eyebrow,
  title,
  description,
  presetFilters,
  presetHref,
  dotColour,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  presetFilters?: AnyFilterKey[];
  presetHref: string;
  dotColour: string;
  children?: ReactNode;
}) {
  const { selectedFilters } = usePickerFilter();
  const preset = presetFilters ?? [];
  const isPristine = sameSelection(selectedFilters, preset);

  let shownEyebrow = eyebrow;
  let shownTitle = title;
  let shownDescription = description;

  if (!isPristine) {
    if (selectedFilters.length === 0) {
      shownEyebrow = "All stocks screener";
      shownTitle = "All Stocks";
      shownDescription =
        "Every stock in the analyzed universe. Tick one or more conditions in Select Screener to narrow the list.";
    } else if (selectedFilters.length === 1) {
      const only = labelFor(selectedFilters[0]);
      shownEyebrow = `${only} screener`;
      shownTitle = `${only} Stocks`;
      shownDescription = `Stocks currently matching ${only}.`;
    } else {
      const labels = selectedFilters.map(labelFor);
      shownEyebrow = "Custom stock screen";
      shownTitle = "Custom Stock Screen";
      shownDescription = `Stocks matching all of: ${labels.join(" + ")}.`;
    }
  }

  return (
    <>
      <div className="eyebrow">
        <span style={{ color: dotColour }}>●</span>
        {shownEyebrow}
      </div>
      <h1>{shownTitle}</h1>
      <p>{shownDescription}</p>

      {/* Only offered once the visitor has moved away from the page's own
          condition. A plain link rather than a state reset: it returns them to
          a clean, canonical, bookmarkable URL, which is also the one we'd want
          them sharing. */}
      {!isPristine && preset.length > 0 ? (
        <p style={{ margin: "10px 0 0" }}>
          <a
            href={presetHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 800,
              color: "#93c5fd",
              textDecoration: "none",
            }}
          >
            ← Back to {title}
          </a>
        </p>
      ) : null}

      {isPristine ? children : null}
    </>
  );
}
