"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { FilterKey } from "@/lib/pickerFilters";

type PickerFilterContextValue = {
  selectedFilters: FilterKey[];
  toggleFilter: (key: FilterKey) => void;
  clearFilters: () => void;
  matchCount: number | null;
  setMatchCount: (count: number | null) => void;
};

const PickerFilterContext = createContext<PickerFilterContextValue | null>(null);

// Wraps a single picker page's left-column nav + results grid so the
// checkboxes rendered inside ScreenerNav (see FilterChecklist there) and
// the filtering/pagination done in PickerResultsGrid can share one
// selection without a server round trip -- the same client-side-only
// filtering /pickers' own PickersClient.tsx does, just lifted one level so
// two sibling components on the same page can both read/write it.
export function PickerFilterProvider({ children }: { children: ReactNode }) {
  const [selectedFilters, setSelectedFilters] = useState<FilterKey[]>([]);
  const [matchCount, setMatchCount] = useState<number | null>(null);

  const value = useMemo<PickerFilterContextValue>(
    () => ({
      selectedFilters,
      toggleFilter: (key) =>
        setSelectedFilters((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])),
      clearFilters: () => setSelectedFilters([]),
      matchCount,
      setMatchCount,
    }),
    [selectedFilters, matchCount]
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
    matchCount: null,
    setMatchCount: () => {},
  };
}
