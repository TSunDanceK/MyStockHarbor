"use client";

import { usePickerFilter } from "@/app/components/PickerFilterContext";

// The small "Current scan" line under the results.
//
// It used to be plain server-rendered text, which meant it was only ever right
// at the moment the page was built. Filtering happens client-side, so on the
// Advanced Screener with ?industry=Semiconductors applied it cheerfully read
// "Live matches 260 · Shown 260" while the chip bar directly above the table
// read "18 of 260". A line whose first word is "Live" was the one number on the
// page that never moved -- and it is the one a visitor is most likely to read
// as authoritative.
//
// `matchCount` is published into the filter context by PickerResultsGrid, which
// is the component that actually does the filtering, so it is by construction
// the same number the table is showing. It is null when nothing is applied,
// which is why the server count is kept as the fallback rather than rendering a
// zero while the client hydrates.
//
// Two other changes to what this line says:
//
//   * "Shown" is gone. It was seoEntries.length, which equalled the match count
//     in every case anyone could produce, so it read as a second opinion that
//     always agreed -- noise pretending to be information.
//
//   * "Universe 613" is now "Universe 260 · Pool 353". The 613 was
//     universeSize + dynamicUniverseCount, a sum of two things that are not the
//     same kind of thing: 260 symbols actually analyzed, plus a ~353-name
//     candidate pool that is eligible for future builds and overlaps the 260.
//     Presented as one figure it invited exactly the wrong inference, and did:
//     a whole session was spent hunting for 353 "missing" symbols that were
//     never missing. See claude/preset-pages-universe-blocker-2026-08-04.md.
export default function ScanFooter({
  serverMatchCount,
  universeSize,
  poolSize,
  updatedLabel,
}: {
  serverMatchCount: number;
  universeSize: number | null;
  poolSize: number | null;
  updatedLabel: string;
}) {
  const { matchCount } = usePickerFilter();
  const live = matchCount ?? serverMatchCount;

  return (
    <div className="scanDebug">
      Current scan · Live matches {live}
      {universeSize != null ? <> · Universe {universeSize}</> : null}
      {poolSize != null ? <> · Pool {poolSize}</> : null}
      {universeSize == null && poolSize == null ? <> · Universe Live</> : null}
      {" "}· Updated {updatedLabel}
    </div>
  );
}
