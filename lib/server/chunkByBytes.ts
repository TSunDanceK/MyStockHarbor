// Group items so that no single Redis request body exceeds the plan's limit.
//
// WHY THIS EXISTS. Upstash sent "Your Max Request Size Limit is Reached" for
// MSH-Market-Cache three times -- 2026-09-05, 09-07 and 09-10, all at 07:21-07:22
// UTC. The limit is 10MB and it applies to the REQUEST BODY, not the stored
// value. An over-limit operation RETURNS AN ERROR rather than truncating, so
// the write fails, the previous value stays under its existing TTL, and the
// fail-open handlers everywhere in this codebase swallow it. Nothing downstream
// notices until that TTL lapses. See claude/upstash-request-size-2026-09-11.md.
//
// THE GENERAL DEFECT: every chunk size in this codebase is bounded by COMMAND
// COUNT, not bytes -- 500 here, 500 there, 40 in historyCache. A command count
// is a proxy for request size that holds only while per-record size stays put.
// All of those are comfortably safe today and they are safe BY LUCK, not by
// construction: nothing notices when a record shape grows.
//
// This is the by-construction version. It is deliberately small and has no
// Redis dependency, so it can be unit-run by scripts/check-request-size.mjs.

/**
 * The byte budget for one request's worth of serialized values.
 *
 * 5MB against a 10MB ceiling, and NOT "10MB minus a bit", for three reasons
 * that compound:
 *
 *   ESCAPING. The value is JSON-stringified and that string is then embedded in
 *   the command array, which is itself JSON -- so every `"` becomes `\"` on the
 *   way out. The inflation is real and its size depends on quote density, which
 *   depends on the record shape. #427's instrumentation reports the measured
 *   figure per build; until several days of that exist, a budget sized against
 *   an assumed inflation would be sized against a guess.
 *
 *   COMMAND OVERHEAD. Keys, "set", "ex", the TTL and the array punctuation all
 *   sit on top of the values.
 *
 *   IT COSTS NOTHING. These are separate requests on a plan where COMMANDS ARE
 *   UNLIMITED and bandwidth is the constraint. Two 3.5MB requests move the same
 *   bytes as one 7MB request; the only thing halving the budget buys is
 *   headroom, and the only thing it spends is a second round trip.
 */
export const REQUEST_BYTE_BUDGET = 5 * 1024 * 1024;

/** The plan limit the budget sits under. Stated so the ratio is checkable. */
export const UPSTASH_MAX_REQUEST_BYTES = 10 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// THE MEASURED SIZE OF THE PAYLOAD, AND A DISCREPANCY WORTH NOT BURYING.
//
// Taken from the live database on 2026-09-11:
//
//   STRLEN msh:pickers:v9:charts-off-payload  =  7,248,807
//
// That is the STRIPPED payload -- chart series already live in their own hash --
// over an analysed universe of 700, so ~10,356 bytes per signalRecord.
//
// redisBandwidth.ts carries BYTES_PER_SYMBOL_PICKER_PAYLOAD = 2,000 for the
// same quantity. THE TWO DISAGREE BY ROUGHLY FIVE TIMES, and the 2,000 is the
// one to distrust: #418 labelled it "NOT RE-DERIVED BY THE CHECK" and "the
// weakest number in this file", and it was a residual from a 260-symbol split
// on 2026-08-06 (payloadChars less charts, over 260). A residual computed once,
// a month ago, at a third of today's universe.
//
// So the projection below uses the DIRECT MEASUREMENT rather than the derived
// one. The consequence for the bandwidth meter is recorded in redisBandwidth.ts
// rather than silently fixed here: correcting that constant changes reported
// GB/day on the picker-payload line, which is a measurement question to settle
// against #427's per-build instrumentation, not a side effect of a chunking PR.
export const PICKERS_PAYLOAD_STRLEN_MEASURED = 7_248_807;
export const PICKERS_PAYLOAD_MEASURED_AT = "2026-09-11";
export const PICKERS_PAYLOAD_MEASURED_AT_UNIVERSE = 700;
export const PICKERS_PAYLOAD_MEASURED_SOURCE =
  "STRLEN msh:pickers:v9:charts-off-payload against the live MSH-Market-Cache, " +
  "recorded in claude/upstash-request-size-2026-09-11.md §3";

/** Bytes per signalRecord, from the direct measurement rather than a residual. */
export function measuredBytesPerRecord(): number {
  return PICKERS_PAYLOAD_STRLEN_MEASURED / PICKERS_PAYLOAD_MEASURED_AT_UNIVERSE;
}

export type ChunkByBytesResult<T> = {
  /** Groups, in input order. Empty input yields no groups. */
  groups: T[][];
  /** Items whose own serialized length exceeded the budget on their own. */
  oversized: number;
};

/**
 * Split `items` into groups whose combined serialized length stays under
 * `budget`.
 *
 * A SINGLE ITEM OVER BUDGET IS YIELDED ALONE, NOT THROWN. Fail-open is the
 * house style, and a stuck warm job is worse than an oversized request: the
 * oversized request fails one write and leaves the previous value in place,
 * while a throw takes down the build that produced it. The count comes back in
 * `oversized` so the caller can log it rather than discover it from an Upstash
 * email.
 *
 * PURE, and the serializer is injected, so the invariant check can run it over
 * fixtures with a known-size serializer instead of guessing at JSON.
 */
export function chunkByBytes<T>(
  items: readonly T[],
  serializedLength: (item: T) => number,
  budget: number = REQUEST_BYTE_BUDGET
): ChunkByBytesResult<T> {
  const groups: T[][] = [];
  let oversized = 0;

  // A budget that is not a usable positive number would silently produce one
  // group per item -- correct, but for a reason nobody chose. Fall back to the
  // real budget rather than to the caller's mistake.
  const cap = Number.isFinite(budget) && budget > 0 ? budget : REQUEST_BYTE_BUDGET;

  let current: T[] = [];
  let currentBytes = 0;

  for (const item of items) {
    const raw = serializedLength(item);
    // An unmeasurable item is treated as budget-sized rather than as zero. Zero
    // would let an unbounded number of them into one group, which is the
    // failure this whole file exists to prevent, reached through a bad input.
    const size = Number.isFinite(raw) && raw >= 0 ? raw : cap;

    if (size > cap) {
      // Flush what is pending first, so the oversized item is alone in its own
      // request rather than dragging a full group over with it.
      if (current.length) {
        groups.push(current);
        current = [];
        currentBytes = 0;
      }
      groups.push([item]);
      oversized++;
      continue;
    }

    if (current.length && currentBytes + size > cap) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(item);
    currentBytes += size;
  }

  if (current.length) groups.push(current);

  return { groups, oversized };
}

/** Serialized byte length, in the unit the request limit is actually in. */
export function jsonByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    // Circular or unserializable: treat as over-budget so it lands alone rather
    // than being counted as free.
    return REQUEST_BYTE_BUDGET + 1;
  }
}
