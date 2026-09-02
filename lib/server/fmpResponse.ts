// Is an FMP response actually about the symbol, or is it FMP talking about
// itself?
//
// ONE COPY, BECAUSE IT IS ONE QUESTION ABOUT ONE API. This test was written
// first in stockDataCache's hasRows and the quote path was missed -- which is
// exactly the "eight chances for the ninth endpoint" argument that put the
// endpoint tally in fetchJson rather than in each block, applied to itself. Two
// copies would have been the same bug waiting on a third caller.
//
// WHAT MAKES IT NECESSARY. FMP answers a rate limit or a bad API key with
// HTTP 200 and {"Error Message": "..."} -- a successful status carrying a
// failure. Every naive test passes it: res.ok is true, the body is non-null, it
// is an object, and `Array.isArray(json) ? json[0] : json` hands it back as a
// row. Downstream that reads as a real answer full of nulls.
//
// Both spellings are rejected. The legacy endpoints use "Error Message" and
// some stable ones use "error"; accepting either is the same defect.

/**
 * An error envelope: the SERVICE reporting a fault, not data about a symbol.
 *
 * TESTS ONE OBJECT. It returns false for an ARRAY, and a caller that unwraps
 * `Array.isArray(json) ? json[0] : json` must therefore test the UNWRAPPED ROW
 * as well -- otherwise `[{"Error Message": "..."}]` sails through, becomes the
 * row, has keys, and is accepted as data.
 *
 * WHY THE TWO CALLERS DIFFER, RE-TAKEN DELIBERATELY RATHER THAN INHERITED.
 * hasFmpRows judges an array on its LENGTH, so an error inside an array counts
 * as a row there. That carve-out was decided for the fundamentals path, where
 * the cost is one mislabelled refresh on one symbol for one cycle. The quote
 * path's cost is different in kind: an accepted envelope clears failStreak and
 * failAt, which is #404's eviction evidence erased -- a delisted ticker
 * answered that way could never accumulate toward removal. Same shape, worse
 * consequence, so the quote path tests the row too rather than accepting the
 * fundamentals path's trade.
 */
export function isFmpErrorEnvelope(json: unknown): boolean {
  if (!json || typeof json !== "object" || Array.isArray(json)) return false;
  return Object.keys(json as Record<string, unknown>).some((k) => {
    const lower = k.toLowerCase();
    return lower === "error message" || lower === "error";
  });
}

/**
 * Does this response carry at least one row of data?
 *
 * An array is judged on its length. An object must have at least one own key
 * and must not be an error envelope -- `{}` carries nothing about the symbol
 * and used to pass.
 */
export function hasFmpRows(json: unknown): boolean {
  if (Array.isArray(json)) return json.length > 0;
  if (!json || typeof json !== "object") return false;
  if (isFmpErrorEnvelope(json)) return false;
  return Object.keys(json as Record<string, unknown>).length > 0;
}
