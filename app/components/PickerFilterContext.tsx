"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { AnyFilterKey } from "@/lib/pickerFilters";

type PickerFilterContextValue = {
  selectedFilters: AnyFilterKey[];
  toggleFilter: (key: AnyFilterKey) => void;
  clearFilters: () => void;
  selectedSectors: string[];
  toggleSector: (sector: string) => void;
  matchCount: number | null;
  setMatchCount: (count: number | null) => void;
};

const PickerFilterContext = createContext<PickerFilterContextValue | null>(null);

// Wraps a single picker page's left-column nav + results grid so the
// checkboxes rendered inside ScreenerNav (see NavList/MoreFilters there) and
// the filtering/pagination done in PickerResultsGrid can share one
// selection without a server round trip -- the same client-side-only
// filtering /pickers' own PickersClient.tsx does, just lifted one level so
// two sibling components on the same page can both read/write it.
//
// selectedFilters can mix two kinds of keys (see lib/pickerFilters.ts):
// the 18-condition custom builder (FilterKey, e.g. "oversold") and the
// category-membership checks ScreenerNav's own nav items now carry
// (CategoryFilterKey, e.g. "hasBuySignal" for the Buy Signals item). Both
// are ANDed together identically by PickerResultsGrid.
//
// `initialFilters` seeds the selection. Dedicated condition pages (the
// "preset" kind -- Oversold, Below MA200, ...) pass their own condition in
// here instead of having the server pre-filter the entry list: the page then
// ships the FULL analyzed universe with that one box already ticked. Because
// useState's initial value is used during the server render too, the SSR'd
// HTML is still just that condition's matches (so the page's SEO content is
// unchanged), but the visitor can now untick it -- or AND a second condition
// onto it -- entirely client-side, with no navigation and no refetch. That's
// what lets the mobile "Select Screener" sheet stay open while the results
// behind it change. See PickerResultPage.tsx.
export function PickerFilterProvider({
  children,
  initialFilters = [],
}: {
  children: ReactNode;
  initialFilters?: AnyFilterKey[];
}) {
  const [selectedFilters, setSelectedFilters] = useState<AnyFilterKey[]>(initialFilters);
  // Sector lives in its own list rather than joining selectedFilters, because
  // the two combine differently: conditions are ANDed with each other (oversold
  // AND above MA50), whereas sectors are ORed within themselves (Technology OR
  // Healthcare) and then ANDed with the conditions as a group. Keeping them
  // apart means PickerResultsGrid can express that without special-casing
  // certain keys out of the AND loop.
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [matchCount, setMatchCount] = useState<number | null>(null);

  const value = useMemo<PickerFilterContextValue>(
    () => ({
      selectedFilters,
      toggleFilter: (key) =>
        setSelectedFilters((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])),
      // Clear resets both dimensions -- a visitor who has ticked conditions and
      // sectors and presses Clear means "start again", not "start again except
      // for the sectors".
      clearFilters: () => {
        setSelectedFilters([]);
        setSelectedSectors([]);
      },
      selectedSectors,
      toggleSector: (sector) =>
        setSelectedSectors((prev) =>
          prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector]
        ),
      matchCount,
      setMatchCount,
    }),
    [selectedFilters, selectedSectors, matchCount]
  );

  return <PickerFilterContext.Provider value={value}>{children}</PickerFilterContext.Provider>;
}

// Safe to call outside a provider -- returns inert no-op state so
// ScreenerNav (used on many pages that don't opt into filtering) keeps
// working unchanged everywhere it isn't wrapped in a PickerFilterProvider.
export function usePickerFilter(): PickerFilterContextValue {
  const ctx = useContext(PickerFilterContext);
  if (ctx) return ctx;
  return {
    selectedFilters: [],
    toggleFilter: () => {},
    clearFilters: () => {},
    selectedSectors: [],
    toggleSector: () => {},
    matchCount: null,
    setMatchCount: () => {},
  };
}
