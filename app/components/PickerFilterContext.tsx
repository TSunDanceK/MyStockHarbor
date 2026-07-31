"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { AnyFilterKey } from "@/lib/pickerFilters";
import { findPredicate, type Predicate } from "@/lib/screenerFields";

type PickerFilterContextValue = {
  // ---- the store ----------------------------------------------------------
  predicates: Predicate[];
  setPredicate: (predicate: Predicate) => void;
  removePredicate: (kind: Predicate["kind"], field: string) => void;
  clearFilters: () => void;

  // ---- derived views over the store ---------------------------------------
  // Kept so ScreenerNav and PickerResultsGrid can carry on talking in terms of
  // "which conditions are ticked" and "which sectors are ticked" while the
  // storage underneath is a single predicate list. See the note on the provider.
  selectedFilters: AnyFilterKey[];
  toggleFilter: (key: AnyFilterKey) => void;
  selectedSectors: string[];
  toggleSector: (sector: string) => void;

  matchCount: number | null;
  setMatchCount: (count: number | null) => void;

  // Is the selection still exactly the page's own seeded condition?
  //
  // Several things want to present differently once the visitor has changed the
  // filters -- the hero copy, the Select Screener pill, and the per-card tone
  // dot -- and all of them would otherwise need the page's config threaded down
  // to them. The provider already receives the seed, so it can answer this once
  // and consumers just ask.
  //
  // True outside a provider too (see usePickerFilter's inert fallback), so
  // anything reading it on a non-filterable page keeps its existing behaviour.
  isPristine: boolean;
};

const PickerFilterContext = createContext<PickerFilterContextValue | null>(null);

// Wraps a single picker page's left-column nav + results grid so the
// checkboxes rendered inside ScreenerNav and the filtering/pagination done in
// PickerResultsGrid can share one selection without a server round trip.
//
// The store is a flat list of Predicates (see lib/screenerFields.ts). That
// replaced two hardcoded arrays -- an AnyFilterKey[] of ticked conditions and a
// string[] of ticked sectors -- which between them could only ever express two
// kinds of filter. Numeric filters (PE under 15) and a searchable industry list
// don't fit either shape, and bolting on a third and fourth array would have
// meant another piece of state, another toggle, another clause in the grid and
// another block of UI for every kind added.
//
// Nothing else has had to change yet: `selectedFilters` and `selectedSectors`
// are derived from the predicate list on the way out, and `toggleFilter` /
// `toggleSector` write back into it, so both consumers still see exactly the
// API they had before. That's deliberate -- this is a storage change landing on
// its own, with the UI that exploits it following separately.
//
// `initialFilters` seeds the selection. Dedicated condition pages (Oversold,
// Below MA200, Buy Signals, ...) pass their own condition here rather than
// having the server pre-filter the entry list, so the page ships the FULL
// analyzed universe with that box already ticked. Because useState's initial
// value is used during the server render too, the SSR'd HTML is still just that
// condition's matches -- the page's indexed content is unchanged -- but the
// visitor can untick it, or AND another condition onto it, entirely
// client-side. That's what lets the mobile "Select Screener" sheet stay open
// while the results behind it change. See PickerResultPage.tsx.
export function PickerFilterProvider({
  children,
  initialFilters = [],
}: {
  children: ReactNode;
  initialFilters?: AnyFilterKey[];
}) {
  const [predicates, setPredicates] = useState<Predicate[]>(() =>
    initialFilters.map((field) => ({ kind: "flag", field }))
  );
  const [matchCount, setMatchCount] = useState<number | null>(null);

  // One predicate per (kind, field). Adding a second sector extends the
  // existing category predicate's `values` rather than appending another --
  // that's what makes values OR while predicates AND.
  const setPredicate = useCallback((predicate: Predicate) => {
    setPredicates((prev) => {
      const rest = prev.filter((p) => !(p.kind === predicate.kind && p.field === predicate.field));
      return [...rest, predicate];
    });
  }, []);

  const removePredicate = useCallback((kind: Predicate["kind"], field: string) => {
    setPredicates((prev) => prev.filter((p) => !(p.kind === kind && p.field === field)));
  }, []);

  const clearFilters = useCallback(() => setPredicates([]), []);

  const selectedFilters = useMemo(
    () =>
      predicates
        .filter((p): p is Extract<Predicate, { kind: "flag" }> => p.kind === "flag")
        .map((p) => p.field),
    [predicates]
  );

  const selectedSectors = useMemo(() => {
    const sectorPredicate = findPredicate(predicates, "category", "sector");
    return sectorPredicate && sectorPredicate.kind === "category" ? sectorPredicate.values : [];
  }, [predicates]);

  const toggleFilter = useCallback((key: AnyFilterKey) => {
    setPredicates((prev) => {
      const exists = prev.some((p) => p.kind === "flag" && p.field === key);
      if (exists) return prev.filter((p) => !(p.kind === "flag" && p.field === key));
      return [...prev, { kind: "flag", field: key }];
    });
  }, []);

  // Toggling the last remaining value drops the whole predicate rather than
  // leaving an empty one behind, so "no sector selected" is represented one way
  // only and the grid never has to special-case an empty values array.
  const toggleSector = useCallback((sector: string) => {
    setPredicates((prev) => {
      const existing = prev.find((p) => p.kind === "category" && p.field === "sector");
      if (!existing || existing.kind !== "category") {
        return [...prev, { kind: "category", field: "sector", values: [sector] }];
      }
      const values = existing.values.includes(sector)
        ? existing.values.filter((v) => v !== sector)
        : [...existing.values, sector];
      const rest = prev.filter((p) => !(p.kind === "category" && p.field === "sector"));
      return values.length ? [...rest, { kind: "category", field: "sector", values }] : rest;
    });
  }, []);

  // The seed as it was at mount, frozen. A ref rather than the prop itself
  // because `initialFilters` is re-created on every render when a page passes
  // no presetFilters, and because the question being answered is "has the
  // visitor moved away from what this page started as" -- which is about the
  // original seed, not whatever the prop happens to say now.
  const presetRef = useRef<AnyFilterKey[]>(initialFilters);

  // Same set, ignoring order. Any category or numeric predicate makes it false
  // by definition, since the seed only ever contains flags.
  const isPristine = useMemo(() => {
    const preset = presetRef.current;
    if (predicates.length !== preset.length) return false;
    return predicates.every((p) => p.kind === "flag" && preset.includes(p.field));
  }, [predicates]);

  const value = useMemo<PickerFilterContextValue>(
    () => ({
      predicates,
      setPredicate,
      removePredicate,
      clearFilters,
      selectedFilters,
      toggleFilter,
      selectedSectors,
      toggleSector,
      matchCount,
      setMatchCount,
      isPristine,
    }),
    [
      predicates,
      setPredicate,
      removePredicate,
      clearFilters,
      selectedFilters,
      toggleFilter,
      selectedSectors,
      toggleSector,
      matchCount,
      isPristine,
    ]
  );

  return <PickerFilterContext.Provider value={value}>{children}</PickerFilterContext.Provider>;
}

// Safe to call outside a provider -- returns inert no-op state so ScreenerNav
// (used on many pages that don't opt into filtering) keeps working unchanged
// everywhere it isn't wrapped in a PickerFilterProvider.
export function usePickerFilter(): PickerFilterContextValue {
  const ctx = useContext(PickerFilterContext);
  if (ctx) return ctx;
  return {
    predicates: [],
    setPredicate: () => {},
    removePredicate: () => {},
    clearFilters: () => {},
    selectedFilters: [],
    toggleFilter: () => {},
    selectedSectors: [],
    toggleSector: () => {},
    matchCount: null,
    setMatchCount: () => {},
    // Nothing is seeded and nothing can be selected, so "unchanged from the
    // page's own state" is trivially true -- consumers keep their default
    // presentation.
    isPristine: true,
  };
}
