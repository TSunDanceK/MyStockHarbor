// THE EMPTY-BUILD GUARD FOR FUNDAMENTAL SCREENS (#553 COWORK #149/#151/#155,
// Option A from CODE-B #143).
//
// A fundamental screen (a page defined by `presetPredicates`: P/E, yield,
// FCF, sector...) that matches NOTHING because its field is missing from the
// data is a data failure, not a market state: with ~685 stocks there is always
// a stock under 15x earnings. So when 0 entries match AND some predicate field
// is carried by fewer than PICKER_EMPTY_GUARD_MIN_COVERAGE of the entries, the
// page must not publish the empty list:
//   - during an ISR regeneration the render throws, and Next keeps serving
//     the last good render (the same mechanism getPickerData already uses for
//     an empty payload);
//   - at build time there is no earlier render to keep, so the page renders
//     the existing empty box with `noindex, follow`.
//
// A REAL ZERO PASSES: high coverage and no match (no stock yields over 4%
// today) renders the empty box as before. TECHNICAL-FLAG PAGES ARE NEVER
// GUARDED: they declare presetFilters, not presetPredicates, and zero
// oversold stocks is a real market state.
//
// 15%: today's lowest coverage among the guarded fields is ~41% (dividends,
// write-dividend-census on 5 Oct), and a lapse reads 0%.
//
// Pure, so scripts/check-picker-empty-guard.mjs can drive it directly.
import type { Predicate } from "./screenerFields";

export const PICKER_EMPTY_GUARD_MIN_COVERAGE = 0.15;

export type EmptyGuardVerdict =
  | { tripped: false }
  | { tripped: true; field: string; carried: number; total: number };

export function implausibleEmpty<E>(
  predicates: readonly Predicate[],
  entries: readonly E[],
  matched: number,
  valueOf: (entry: E, field: string) => unknown
): EmptyGuardVerdict {
  if (matched > 0 || !predicates.length || !entries.length) return { tripped: false };
  for (const p of predicates) {
    if (p.kind === "flag") continue;
    let carried = 0;
    for (const e of entries) {
      const v = valueOf(e, p.field);
      if (v !== null && v !== undefined && v !== "") carried++;
    }
    if (carried < entries.length * PICKER_EMPTY_GUARD_MIN_COVERAGE) {
      return { tripped: true, field: p.field, carried, total: entries.length };
    }
  }
  return { tripped: false };
}

/** The one log line, for the throw and for the build-time warning alike. */
export function emptyGuardLine(href: string, v: Extract<EmptyGuardVerdict, { tripped: true }>, atBuild: boolean): string {
  return `[pickers] ${href}: implausible empty (field ${v.field} on ${v.carried} of ${v.total}), ${
    atBuild ? "no earlier render at build: served the empty box with noindex" : "kept the last good render"
  }`;
}

export class PickerEmptyGuardError extends Error {}
