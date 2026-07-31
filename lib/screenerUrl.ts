import type { AnyFilterKey } from "@/lib/pickerFilters";
import { FIELD_BY_KEY, type Predicate } from "@/lib/screenerFields";

// ---------------------------------------------------------------------------
// Predicates <-> query string.
//
// Filter state lives in the URL. Two things fall out of that, and the second is
// the one that forced it:
//
//   1. A filtered screen becomes shareable and bookmarkable, and a combination
//      worth a landing page of its own (industry=Semiconductors + peRatio<15)
//      is now expressible as a URL before it is expressible as a page.
//   2. A selection stops leaking between visits. The client router can keep the
//      filter provider mounted across a navigation -- the back button, or
//      clicking a nav link to the page you are already on -- so useState's
//      initialiser is not re-run and the previous selection used to survive.
//      Reading from the URL removes the dependency on remount semantics.
//
// Format is deliberately readable rather than compact: these strings show up in
// Search Console, in analytics and in links people paste, and the eventual
// preset pages are easier to reason about when the combination behind them can
// be read off the URL.
//
//   flag      oversold=1
//   category  sector=Technology&sector=Healthcare      (repeated, not delimited)
//   number    peRatio=..15   marketCap=1000000000..    perf1y=5..25
//
// Multi-value categories repeat the key rather than joining with a separator
// because industry names contain commas, dashes and slashes; repeating lets
// URLSearchParams own the encoding and removes the class of bug entirely.
//
// Field keys come from the registry, so a field added to lib/screenerFields.ts
// is URL-addressable with no change here.
// ---------------------------------------------------------------------------

const RANGE_SEPARATOR = "..";

// An empty selection is a real state -- "show me the whole universe" -- and has
// to be distinguishable from a clean URL, which on a condition page means "this
// page's own preset". Without a sentinel, unticking a page's only condition
// would be indistinguishable from never having touched it, and would be
// silently undone by the next navigation.
export const NO_FILTERS_PARAM = "filters";
export const NO_FILTERS_VALUE = "none";

// Every param this module owns. Anything else on the URL -- the ?symbol= deep
// link the /pickers accordion uses, utm tags, gclid -- is none of our business
// and is preserved untouched.
function isFilterParam(key: string) {
  return key === NO_FILTERS_PARAM || FIELD_BY_KEY.has(key);
}

/**
 * Strips every filter param, leaving the rest of the URL untouched and adding
 * no sentinel.
 *
 * This is "back to the page's own preset" -- the clean canonical URL -- and is
 * deliberately distinct from an empty selection, which is `filters=none`. The
 * two look the same on screen only on the Advanced Screener, where the preset
 * is itself empty.
 */
export function clearFilterParams(existing?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(existing ? existing.toString() : "");
  for (const key of Array.from(params.keys())) {
    if (isFilterParam(key)) params.delete(key);
  }
  return params;
}

/**
 * Writes a selection into a copy of `existing`, leaving every non-filter param
 * alone. Keys are emitted in sorted order so the same selection always produces
 * the same string -- which is what lets the sync effects compare cheaply, and
 * what stops a shared link differing from the URL that generated it.
 */
export function serializePredicates(predicates: Predicate[], existing?: URLSearchParams): URLSearchParams {
  // Clear first, so removing a filter removes its param rather than leaving a
  // stale one behind.
  const params = clearFilterParams(existing);

  // An unbounded numeric predicate is deliberately not written. It would
  // serialise to a bare `peRatio=..`, which parse rejects, so emitting it would
  // break the round-trip. It also has no business in a shared link: it filters
  // only in the sense of excluding stocks that have no value at all, which is
  // outstanding item 2 and wants fixing at the source.
  //
  // Dropped BEFORE the emptiness check, not during the write loop. A selection
  // of nothing but unbounded numbers is, as far as a URL is concerned, an empty
  // selection -- and it has to serialise to the sentinel, because an empty
  // string means "clean URL", which means "this page's own preset".
  const writable = predicates.filter((p) => !(p.kind === "number" && p.min == null && p.max == null));

  if (!writable.length) {
    params.set(NO_FILTERS_PARAM, NO_FILTERS_VALUE);
    return params;
  }

  const ordered = writable.slice().sort((a, b) => a.field.localeCompare(b.field));
  for (const p of ordered) {
    if (p.kind === "flag") {
      params.set(p.field, "1");
    } else if (p.kind === "category") {
      for (const value of p.values) params.append(p.field, value);
    } else {
      const min = p.min != null ? String(p.min) : "";
      const max = p.max != null ? String(p.max) : "";
      params.set(p.field, `${min}${RANGE_SEPARATOR}${max}`);
    }
  }

  return params;
}

/**
 * The filter-only view of a selection, with no surrounding params. Used as the
 * comparison key on both sides of the URL sync: two selections are the same
 * selection exactly when these strings match.
 */
export function predicatesQueryString(predicates: Predicate[]): string {
  return serializePredicates(predicates).toString();
}

/**
 * Does this URL carry a selection at all?
 *
 * Distinct from `parsePredicates(...).length > 0`, which cannot tell an
 * explicitly empty selection from a clean URL. A clean URL means "use the
 * page's own preset"; `filters=none` means "the visitor cleared everything".
 */
export function hasFilterParams(params: URLSearchParams): boolean {
  if (params.get(NO_FILTERS_PARAM) === NO_FILTERS_VALUE) return true;
  for (const key of Array.from(params.keys())) {
    if (FIELD_BY_KEY.has(key)) return true;
  }
  return false;
}

/**
 * Reads a selection back out. Anything unrecognised, malformed or out of range
 * is skipped rather than throwing -- a hand-edited or truncated URL should
 * degrade to a narrower screen, never to an error page.
 */
export function parsePredicates(params: URLSearchParams): Predicate[] {
  const out: Predicate[] = [];
  const seen = new Set<string>();

  for (const key of Array.from(params.keys())) {
    if (seen.has(key)) continue;
    seen.add(key);

    const def = FIELD_BY_KEY.get(key);
    if (!def) continue;

    if (def.kind === "flag") {
      const raw = params.get(key);
      if (raw === "1" || raw === "true") out.push({ kind: "flag", field: key as AnyFilterKey });
      continue;
    }

    if (def.kind === "category") {
      const values = params.getAll(key).filter((value) => value.trim().length > 0);
      if (values.length) out.push({ kind: "category", field: key, values });
      continue;
    }

    // Numbers must carry the range separator. A bare `peRatio=15` is ambiguous
    // between "at most 15" and "at least 15", so it is rejected rather than
    // guessed at -- guessing would silently return the wrong stocks.
    const raw = params.get(key) ?? "";
    if (!raw.includes(RANGE_SEPARATOR)) continue;
    const [minRaw = "", maxRaw = ""] = raw.split(RANGE_SEPARATOR);
    const min = minRaw.trim() === "" ? undefined : Number(minRaw);
    const max = maxRaw.trim() === "" ? undefined : Number(maxRaw);
    if (min !== undefined && !Number.isFinite(min)) continue;
    if (max !== undefined && !Number.isFinite(max)) continue;
    if (min === undefined && max === undefined) continue;
    out.push({
      kind: "number",
      field: key,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    });
  }

  return out;
}
