"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { AnyFilterKey } from "@/lib/pickerFilters";
import { findPredicate, type Predicate } from "@/lib/screenerFields";
import {
  clearFilterParams,
  hasFilterParams,
  parsePredicates,
  predicatesQueryString,
  serializePredicates,
} from "@/lib/screenerUrl";

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

  // How many of the CURRENTLY SHOWN results also satisfy each checkable
  // condition -- i.e. what you would be left with if you ticked it.
  //
  // The screener's standing problem is that a condition tells you nothing until
  // you press it: tick something and the list either changes or empties, and
  // only then do you learn which. These counts move that answer in front of the
  // decision, and a 0 marks a dead end before it costs a tap.
  //
  // Computed in PickerResultsGrid, which is the only place holding the entries,
  // and published here for ScreenerNav to render -- the same one-way channel
  // matchCount already uses. null means "not computed" (a page outside a
  // provider, or before the grid's first pass) and should render no count at
  // all rather than a zero, which would claim every condition is a dead end.
  conditionCounts: Partial<Record<AnyFilterKey, number>> | null;
  setConditionCounts: (counts: Partial<Record<AnyFilterKey, number>> | null) => void;

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
// The selection is mirrored into the query string (see lib/screenerUrl.ts and
// the two sync effects below), which is what makes a filtered screen shareable
// and what stops a selection leaking between visits to a page.
//
// `initialFilters` seeds the selection when the URL carries none. Dedicated
// condition pages (Oversold, Below MA200, Buy Signals, ...) pass their own
// condition here rather than having the server pre-filter the entry list, so
// the page ships the FULL analyzed universe with that box already ticked.
// Because useState's initial value is used during the server render too, the
// SSR'd HTML is still just that condition's matches -- the page's indexed
// content is unchanged -- but the visitor can untick it, or AND another
// condition onto it, entirely client-side. That's what lets the mobile
// "Select Screener" sheet stay open while the results behind it change. See
// PickerResultPage.tsx.
export function PickerFilterProvider({
  children,
  initialFilters = [],
  initialPredicates = [],
}: {
  children: ReactNode;
  initialFilters?: AnyFilterKey[];
  // Seeds that aren't boolean conditions -- a numeric bound (`peRatio` under
  // 15) or a category value (`industry` = Semiconductors). The "Popular
  // Screens" landing pages are defined by exactly these, and a flag key cannot
  // express them: there is no `cheap` boolean on a record, only a PE column to
  // put a ceiling on. Kept as a separate prop rather than widening
  // `initialFilters` so the existing 24 condition pages are untouched.
  initialPredicates?: Predicate[];
}) {
  const pathname = usePathname();

  // The live query string, reported in by <PickerFilterUrlSync /> rather than
  // read with useSearchParams() here. Calling that hook in this provider opts
  // the whole page out of static rendering, and wrapping the provider itself
  // in <Suspense> is not a fix: the provider wraps the entire results tree, so
  // the boundary would render its fallback into the prerendered HTML and the
  // results would only appear after hydration -- exactly the SSR content these
  // pages are indexed on. Isolating the hook in a null-rendering child keeps
  // the boundary empty, so the grid still prerenders while the URL stays fully
  // reactive. See claude/picker-pages-isr-2026-08-20.md.
  //
  // "" on the server and on the first client render, which is what makes the
  // prerendered HTML query-independent -- it must be, since one cached HTML is
  // now served for every query string. A shared filtered link therefore seeds
  // the page's own preset first and applies its filters right after hydration,
  // via the URL -> state effect below, instead of arriving pre-filtered from
  // the server. The SEO invariant is unchanged and in fact now unconditional:
  // a crawler on the clean path gets this page's own condition in the HTML.
  const [searchString, setSearchString] = useState("");
  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);

  // The seed as it was at mount, frozen. Frozen because both props are
  // re-created on every render when a page passes no preset, and because the
  // question being answered downstream is "has the visitor moved away from what
  // this page started as" -- which is about the original seed, not whatever the
  // prop happens to say now.
  //
  // A lazy useState rather than a ref: the initialiser runs exactly once and
  // the value is then ordinary state, which is safe to read during render.
  // (Refs are not -- react-hooks/refs flags reading .current in a render path,
  // and the previous version tripped it.) Nothing ever calls the setter, so
  // this is a write-once constant with the right semantics rather than state in
  // any meaningful sense.
  const [presetPredicates] = useState<Predicate[]>(() => [
    ...initialFilters.map((field) => ({ kind: "flag" as const, field })),
    ...initialPredicates,
  ]);

  // The URL's own view of the selection. `hasFilterParams` is asked separately
  // from `parsePredicates` because an empty result is ambiguous: a clean URL
  // means "this page's own preset", while an explicit `filters=none` means the
  // visitor cleared everything. See lib/screenerUrl.ts.
  const urlParams = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const urlPredicates = useMemo(() => parsePredicates(urlParams), [urlParams]);
  const urlHasFilters = useMemo(() => hasFilterParams(urlParams), [urlParams]);
  const urlQuery = useMemo(
    () => (urlHasFilters ? predicatesQueryString(urlPredicates) : ""),
    [urlHasFilters, urlPredicates]
  );

  // Seeded from the URL when it carries a selection, otherwise from the page's
  // own preset. Because this initialiser runs during the server render too, a
  // crawler on the clean path still gets exactly the page's own condition in
  // the SSR'd HTML -- the SEO invariant is unchanged. A shared filtered link
  // server-renders its own filtered set, which is why every condition page's
  // canonical stays pinned to the bare path.
  const [predicates, setPredicates] = useState<Predicate[]>(() =>
    urlHasFilters ? urlPredicates : presetPredicates
  );
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [conditionCounts, setConditionCounts] = useState<
    Partial<Record<AnyFilterKey, number>> | null
  >(null);

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

  const currentQuery = useMemo(() => predicatesQueryString(predicates), [predicates]);
  const presetQuery = useMemo(() => predicatesQueryString(presetPredicates), [presetPredicates]);

  // "Is the selection still exactly what this page started as?"
  //
  // Compared as canonical query strings rather than by walking the arrays.
  // serializePredicates sorts by field and writes one param per predicate, so
  // two selections produce the same string exactly when they are the same
  // selection -- which makes this order-independent for free, and correct for
  // numeric and category seeds as well as flags. (The previous implementation
  // compared flag fields directly and documented that "any category or numeric
  // predicate makes it false by definition, since the seed only ever contains
  // flags" -- no longer true now that the Popular Screens pages seed exactly
  // those. Left as a set comparison it would have made those pages permanently
  // non-pristine, which would have put ?peRatio=..15 on the canonical URL of a
  // page whose whole point is to be that filter.)
  const isPristine = currentQuery === presetQuery;

  // While the selection is still the page's own preset the URL stays clean, so
  // the resting state of every condition page remains the bare canonical path
  // and only a deliberate change puts params on it.
  const desiredQuery = isPristine ? "" : currentQuery;

  // Tracks the last query string the two sides agreed on, so the URL -> state
  // effect can tell a real navigation apart from the echo of our own write.
  const lastSyncedRef = useRef(urlQuery);

  // URL -> state. Fires for a shared link, the back/forward buttons, and a nav
  // link back to this page's clean path.
  //
  // That last case is the one this was built for. The client router can keep
  // this provider mounted across a navigation, so useState's initialiser is not
  // re-run and a selection used to survive being navigated away from and back
  // to. Reading from the URL removes the dependency on remount semantics
  // entirely: the clean path carries no filters, so it re-seeds the preset.
  useEffect(() => {
    if (urlQuery === lastSyncedRef.current) return;
    lastSyncedRef.current = urlQuery;
    setPredicates(urlHasFilters ? urlPredicates : presetPredicates);
  }, [urlQuery, urlHasFilters, urlPredicates, presetPredicates]);

  // state -> URL.
  //
  // history.replaceState, NOT router.push: a Next navigation would unmount the
  // mobile Select Screener sheet mid-interaction, which is the whole thing the
  // in-place filtering work exists to avoid. replace rather than push also
  // keeps the history stack honest -- ticking six boxes should not cost six
  // back presses to undo.
  useEffect(() => {
    if (desiredQuery === urlQuery) return;
    lastSyncedRef.current = desiredQuery;
    const next = isPristine ? clearFilterParams(urlParams) : serializePredicates(predicates, urlParams);
    const query = next.toString();
    window.history.replaceState(
      null,
      "",
      `${pathname}${query ? `?${query}` : ""}${window.location.hash}`
    );
  }, [desiredQuery, urlQuery, isPristine, predicates, urlParams, pathname]);

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
      conditionCounts,
      setConditionCounts,
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
      conditionCounts,
      isPristine,
    ]
  );

  return (
    <PickerFilterContext.Provider value={value}>
      <PickerFilterUrlContext.Provider value={setSearchString}>{children}</PickerFilterUrlContext.Provider>
    </PickerFilterContext.Provider>
  );
}

// Carries the query string from PickerFilterUrlSync up into the provider.
// Separate from PickerFilterContext so the many consumers of that context are
// not re-rendered by a setter identity they never read.
const PickerFilterUrlContext = createContext<((value: string) => void) | null>(null);

// Owns the useSearchParams() call for the filter system and renders nothing.
//
// MUST be rendered inside a <Suspense> boundary, and inside a
// PickerFilterProvider. useSearchParams() without a boundary makes Next bail
// the entire page out of static generation -- the exact thing this split
// exists to prevent -- and the build fails rather than warning. Because this
// component renders null, the boundary's fallback is also null, so nothing
// about the prerendered HTML changes.
//
// Keeping the real hook (rather than reading window.location.search in an
// effect) is deliberate: it stays reactive to back/forward, to a shared link,
// and to a nav link back to this page's clean path while the provider stays
// mounted -- the case the URL -> state effect above was built for, and the one
// a mount-only read would silently break.
export function PickerFilterUrlSync() {
  const searchParams = useSearchParams();
  const setSearchString = useContext(PickerFilterUrlContext);
  const search = searchParams.toString();

  useEffect(() => {
    setSearchString?.(search);
  }, [search, setSearchString]);

  return null;
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
    conditionCounts: null,
    setConditionCounts: () => {},
    // Nothing is seeded and nothing can be selected, so "unchanged from the
    // page's own state" is trivially true -- consumers keep their default
    // presentation.
    isPristine: true,
  };
}
