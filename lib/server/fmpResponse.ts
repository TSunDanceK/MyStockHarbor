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

/** An error envelope: the SERVICE reporting a fault, not data about a symbol. */
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
