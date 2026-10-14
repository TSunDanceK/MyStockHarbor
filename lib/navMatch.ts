// THE HEADER'S ACTIVE-PATH RULE, AS DATA (#552 COWORK #231).
//
// lib/navSections.ts describes each header entry's "is this the current
// page?" rule as a NavMatch instead of a function, so the tree can be passed
// from a server component to the header's client island. This module is the
// matcher; it imports nothing, so the island stays small.

/**
 * An active-path rule, as data. A path matches when it is in `exact`, starts
 * with one of `prefixes`, or matches one of `patterns` (regex sources), and
 * is in neither `exceptExact` nor `exceptPrefixes`. An empty rule never
 * matches. Paths arrive normalised: no trailing slash, "/" for the root.
 */
export type NavMatch = {
  exact?: string[];
  prefixes?: string[];
  patterns?: string[];
  exceptExact?: string[];
  exceptPrefixes?: string[];
};

export function navMatches(rule: NavMatch | undefined, path: string): boolean {
  if (!rule) return false;
  if (rule.exceptExact?.includes(path)) return false;
  if (rule.exceptPrefixes?.some((p) => path.startsWith(p))) return false;
  return Boolean(
    rule.exact?.includes(path) ||
      rule.prefixes?.some((p) => path.startsWith(p)) ||
      rule.patterns?.some((re) => new RegExp(re).test(path))
  );
}
