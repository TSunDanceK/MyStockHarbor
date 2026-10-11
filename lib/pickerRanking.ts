// THE PICKER PAGE'S DEFAULT ORDER, IN WORDS (#553 COWORK #161).
//
// A re-sorted table looked like a wrong ranking because nothing on the page
// named the right one. A page with `orderBy` names itself from it; a page
// ordered by its pickers section names itself with `rankedBy`, which only the
// pages whose section sorts by one plain key carry (the trend flips and the
// SEC earnings growth -- scripts/check-picker-ranking.mjs holds the list).
// Null means the page has no ranking worth naming, and shows no line.

export type PickerRanking = { label: string; short: string };

export function pageRanking(config: {
  orderBy?: { dir: "asc" | "desc"; label: string };
  rankedBy?: PickerRanking;
}): PickerRanking | null {
  if (config.orderBy) {
    return {
      label: `${config.orderBy.label}, ${config.orderBy.dir === "asc" ? "lowest" : "highest"} first`,
      short: config.orderBy.label,
    };
  }
  return config.rankedBy ?? null;
}
