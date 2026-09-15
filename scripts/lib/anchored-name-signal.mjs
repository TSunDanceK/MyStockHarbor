// A MIRROR of anchoredNameSignal in lib/stock-news-data.ts, for relay probes.
//
// ── WHY A MIRROR AND NOT AN IMPORT ───────────────────────────────────────
// The relay's READ-ONLY job deliberately does not run `npm ci`:
//
//   # No `npm ci`. These scripts import only node: builtins and use global
//   # fetch, and not installing the Upstash client keeps the job unable to
//   # reach the database even if a future edit tried to.
//
// That is a security property, not a convenience. It also means `typescript` is
// not on that runner, so the transpile-and-import trick the check-*.mjs
// harnesses use to load real TS is unavailable there. Adding `npm ci` to buy it
// would trade an isolation guarantee for a probe's convenience, which is the
// wrong way round.
//
// So this is bounded, deliberate duplication — the same call already recorded
// for the User-Agent in lib/server/news/userAgent.ts. The difference is that
// here the duplication is CHECKED: scripts/check-news-relevance-scope.mjs
// asserts this function and the TypeScript one produce identical patterns for
// every name the probe measures, so the two cannot drift silently.
//
// If you change one, the checker will tell you to change the other.

/** Keep in step with anchoredNameSignal in lib/stock-news-data.ts. */
export function anchoredNameSignalMirror(companyName) {
  const base = String(companyName ?? "")
    .replace(
      /\b(incorporated|inc|inc\.|corporation|corp|corp\.|company|co|co\.|ltd|plc|class a|class b|common stock|ordinary shares|american depositary shares|ads|adr)\b/gi,
      " "
    )
    .replace(/^\s*the\s+/i, "")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const token = base.split(/\s+/)[0] ?? "";
  const alnum = token.replace(/[^A-Za-z0-9]/g, "");

  if (alnum.length < 2 || alnum.length > 4) return null;
  if (!/[A-Z]/.test(token)) return null;

  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const forms = new Set([`\\b${esc(alnum)}\\b`]);
  if (token !== alnum) {
    forms.add(`\\b${esc(token)}${/\w$/.test(token) ? "\\b" : ""}`);
  }

  return new RegExp([...forms].join("|"));
}
