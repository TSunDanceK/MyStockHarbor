// THE ARCHIVE UNIVERSE (#552 COWORK #71): every CIK Layer 1 keeps.
//   registrants.json            the registrant rows (the backfill's universe);
//   archive-extra-ciks.json     the CIK of every stored fact set outside it
//                               (ETFs/trusts, dynamic-pool names), so a switch
//                               to the archive drops no stored set;
//   successor-ciks.json         each successor's PREDECESSOR CIK, whose facts
//                               withPredecessorFacts fills history from.
// Pure; the wrappers pass the parsed files in. Returns sorted 10-digit CIKs.
export const cik10 = (c) => String(c).padStart(10, "0");

export function archiveUniverse({ registrants, extra = {}, successors = [] }) {
  const out = new Set();
  for (const r of Object.values(registrants ?? {})) if (r?.cik) out.add(cik10(r.cik));
  for (const c of Object.values(extra ?? {})) if (c) out.add(cik10(c));
  for (const s of successors ?? []) if (s?.predecessorCik) out.add(cik10(s.predecessorCik));
  return [...out].sort();
}

/** Reads the three files from the repo (for the wrappers and the diff). */
export function readArchiveUniverse(fs) {
  const j = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  return archiveUniverse({
    registrants: j("data/sec/registrants.json").rows,
    extra: j("data/sec/archive-extra-ciks.json").rows,
    successors: j("data/sec/successor-ciks.json").successors,
  });
}
