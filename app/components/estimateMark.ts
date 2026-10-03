// THE ESTIMATE MARK'S CONSTANTS AND TYPE, in a plain module so a server
// component (EstimateKey on a server-rendered page) and the client
// EstimatedValue read the same values. See EstimatedValue.tsx.

/** What a surface needs from lib/server/secEstimates' Estimate. */
export type EstimateMark = { kind: "estimate" | "derived"; note: string };

/**
 * Sky 300 on the site's #06080d: contrast 12.0:1 (WCAG AA needs 4.5:1),
 * and none of the green / yellow / red tones the pages use for signals.
 */
export const ESTIMATE_COLOUR = "#7dd3fc";
export const ESTIMATE_SIGN = "≈";
