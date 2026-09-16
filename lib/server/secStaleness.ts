// WHETHER A STORED SET IS BEHIND WHAT THE CODE WOULD WRITE TODAY — one
// function, one place, three reasons.
//
// ── WHY THIS IS ITS OWN MODULE AND NOT A HELPER IN THE CRON ROUTE ─────────
// It lived in app/api/jobs/sec-facts/route.ts. It was pulled out for a second
// caller on the READ path, and that caller — refresh-on-view — has since been
// removed (see secColdFetch's populated branch for why). So the cron is once
// again the only thing that asks the question, and this module could in
// principle fold back into the route. IT SHOULD NOT.
//
// A rule living inside a route handler is a rule nothing outside that route can
// import, and the answer every time something else needs it is a second copy.
// That is how the rewindow migration nearly shipped with two staleness
// predicates that agreed on the day they were written. check-sec-rewindow lifts
// THIS function rather than a transcription of it, which is only possible
// because it is here.
//
// ── ABSENT MUST SELECT, NEVER SKIP ────────────────────────────────────────
// Every field below was added after sets were already being written, so the
// entries that most need re-reading are precisely the ones with no value for
// it. Reading absence as "current" is how a migration finishes without doing
// anything. Each default below is the state BEFORE that field existed.
import { SEC_QUARTER_WINDOW, SEC_YEAR_WINDOW, SEC_LABEL_VERSION } from "./secExtract";
import { secChainsHash } from "./secFields";

/**
 * What a manifest entry has to carry for staleness to be decidable.
 *
 * Structural rather than the full SecManifestEntry, so a check can call this
 * with a literal rather than having to build a whole manifest entry.
 */
export type StaleInput = {
  /** Quarter retention window the set was written under. Absent = 8. */
  w?: number;
  /** Year retention window. Absent = 5. */
  y?: number;
  /**
   * secChainsHash at the time the set was written. Absent = older than the
   * field, therefore older than any chain edit since, therefore stale.
   */
  c?: string | null;
  /**
   * SEC_LABEL_VERSION the set's period labelling AND ADMISSION were written
   * under. Absent = 1.
   *
   * ITS OWN REASON, because neither of the other two can see it: `c` moves for
   * a TAG CHAIN and a labelling change touches no tag, `h` moves for FIELD
   * ORDER and labels are not fields. A set written before fiscal-year
   * calibration would otherwise keep naming AAP's quarters FY2027 forever with
   * nothing selecting it.
   */
  lv?: number;
};

/**
 * A stored set is behind if ANY of the three is behind.
 *
 * ── WHY THE CHAIN HASH BELONGS HERE AND NOT ONLY IN THE COLD PATH ─────────
 * secColdFetch already retries on a chain-hash mismatch, but only for a set
 * that came back EMPTY — the reasoning being that a chain edit cannot
 * invalidate values already stored, so re-reading 759 SYMBOLS over one tag
 * would be a self-inflicted outage.
 *
 * MEASURED, THAT REASONING WAS HALF RIGHT. A chain edit cannot make a stored
 * value WRONG — confirmed, 0 of 119 SYMBOLS changed a figure when the capex
 * fallback landed (relay 35025749420). But it can make a stored set
 * INCOMPLETE, and that is not a rare edge: 24 of those 119 gained a capital
 * expenditure line they did not have, fourteen of them going from nothing at
 * all to all 18 periods — NVDA, AMZN, V, HD, CVX, QCOM among them. A set with
 * values is not the same as a set with the values the chains can now read.
 *
 * "Empty" was the wrong test because it asks whether the OLD chains found
 * anything, when the question is whether the NEW ones would find more.
 *
 * THE COST IS BOUNDED BY THE QUEUE, NOT BY THIS FUNCTION. Selecting the whole
 * populated universe is the case SEC_REWINDOW_PER_RUN was sized for — see its
 * docblock, which says so in as many words — and the re-read is a cache miss
 * for freshness, never a correctness gate. `h` is the correctness gate and it
 * does not move for a chain edit, so every stale set stays readable and renders
 * exactly as it does today until its turn comes.
 */
export function needsReread(e: StaleInput): boolean {
  return (
    (e.w ?? 8) < SEC_QUARTER_WINDOW ||
    (e.y ?? 5) < SEC_YEAR_WINDOW ||
    (e.lv ?? 1) < SEC_LABEL_VERSION ||
    (e.c ?? null) !== secChainsHash()
  );
}

/**
 * WHY it is stale, for a report that has to explain a queue's size.
 *
 * A backlog of 759 reads as alarming or routine depending entirely on whether
 * it is one chain edit or a genuine window migration, and a boolean cannot say
 * which. Returns an empty array when the entry is current.
 */
export function staleReasons(e: StaleInput): ("quarters" | "years" | "chains" | "labels")[] {
  const out: ("quarters" | "years" | "chains" | "labels")[] = [];
  if ((e.w ?? 8) < SEC_QUARTER_WINDOW) out.push("quarters");
  if ((e.y ?? 5) < SEC_YEAR_WINDOW) out.push("years");
  if ((e.lv ?? 1) < SEC_LABEL_VERSION) out.push("labels");
  if ((e.c ?? null) !== secChainsHash()) out.push("chains");
  return out;
}
