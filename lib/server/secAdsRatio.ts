// THE ADS RATIO, FROM THE FILER'S OWN WORDS (#552, COWORK #22 §1).
//
// A foreign private issuer files per ORDINARY share; what trades here is an
// American Depositary Share. The ratio between them is stated in the 20-F
// (Item 12.D, and usually the cover and Item 9) and in the F-6 — "each ADS
// represents five ordinary shares". This reads that statement and nothing
// else. It never infers a ratio and never defaults one: a filing that states
// no ratio returns none, and the valuation keeps its refusal.
//
// PURE. The census (scripts/ads-ratio-census.mjs) runs it over live filings;
// the committed map (data/sec/ads-ratios.json) holds what it found, cited.

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, "twenty-five": 25, thirty: 30, forty: 40,
  fifty: 50, hundred: 100, "one hundred": 100,
};
const FRACTIONS: Record<string, number> = {
  "one-half": 0.5, "one half": 0.5, "one-quarter": 0.25, "one-fourth": 0.25, "one-third": 1 / 3,
  "one-fifth": 0.2, "one-tenth": 0.1, "one-twentieth": 0.05, "one-fortieth": 0.025,
  "two-thirds": 2 / 3, "three-quarters": 0.75, "three-fourths": 0.75,
};

/** "five" / "5" / "five (5)" / "one-half of one" → a number, or null. */
export function parseCount(raw: string): number | null {
  const t = raw.toLowerCase().replace(/\s+/g, " ").replace(/\(\s*[\d.,/]+\s*\)/g, "").trim()
    .replace(/\s+of\s+(?:one|an?)$/, "");
  if (t in FRACTIONS) return FRACTIONS[t];
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  if (t in WORDS) return WORDS[t];
  return null;
}

const COUNT = String.raw`(\d+(?:\.\d+)?|\d+\s*/\s*\d+|one[- ]half|one[- ](?:quarter|fourth|third|fifth|tenth|twentieth|fortieth)|two[- ]thirds|three[- ](?:quarters|fourths)|one hundred|twenty-five|[a-z]+)(?:\s*\(\s*[\d.,/]+\s*\))?(?:\s+of\s+(?:one|an?))?`;
const SHARE = String.raw`(?:ordinary|common|class\s+[a-z]\s+ordinary|class\s+[a-z]\s+common|series\s+[a-z]\s+)?\s*shares?`;
const ADS = String.raw`(?:ADS|ADSs|American\s+depositary\s+shares?|American\s+depositary\s+share)`;
/**
 * The phrasings, each capturing the number of ordinary shares ONE ADS stands
 * for. All anchored on "represent" / "equal" so a price, a volume or a count
 * of ADSs outstanding can never be read as a ratio.
 */
const PRECEDING_COUNT = String.raw`(?<!\b(?:two|three|four|five|six|seven|eight|nine|ten|twenty|\d+)\s+)`;
const RATIO_PATTERNS: { re: RegExp; ratio: (m: RegExpExecArray) => number | null }[] = [
  // "each ADS represents five ordinary shares"
  { re: new RegExp(String.raw`\b(?:each|one|1)\s+${ADS}\s+(?:currently\s+)?(?:represents?|representing|is\s+equal\s+to|equals)\s+(?:the\s+right\s+to\s+receive\s+)?${COUNT}\s+${SHARE}`, "gi"),
    ratio: (m) => parseCount(m[1]) },
  // "ADSs, each representing one-half of one ordinary share" — NOT when a
  // count precedes the ADS ("two ADSs represent one share" is the next rule).
  { re: new RegExp(String.raw`${PRECEDING_COUNT}${ADS}\s*(?:\((?!\s*each)[^)]{0,40}\)\s*)?,?\s*\(?\s*(?:each\s+)?(?:of\s+which\s+)?(?:currently\s+)?(?:represents?|representing)\s+(?:the\s+right\s+to\s+receive\s+)?${COUNT}\s+${SHARE}`, "gi"),
    ratio: (m) => parseCount(m[1]) },
  // "two ADSs represent one share" (FMS): shares / ADSs.
  { re: new RegExp(String.raw`\b(two|three|four|five|ten|twenty|\d+)\s+${ADS}\s+(?:together\s+)?(?:represents?|representing)\s+${COUNT}\s+${SHARE}`, "gi"),
    ratio: (m) => { const a = parseCount(m[1]), b = parseCount(m[2]); return a && b ? b / a : null; } },
];

export type AdsRatioStatement = { ordinaryPerAds: number; sentence: string };

/** The words around a match, not the whole run-on cover page it sits in. */
function around(text: string, at: number, len: number): string {
  const from = Math.max(0, text.lastIndexOf(" ", Math.max(0, at - 90)) + 1);
  const toSpace = text.indexOf(" ", Math.min(text.length, at + len + 60));
  return text.slice(from, toSpace < 0 ? text.length : toSpace).trim();
}

/** Every statement of an ADS ratio in `text`, each with the words around it. */
export function adsRatioStatements(text: string): AdsRatioStatement[] {
  const out: AdsRatioStatement[] = [];
  const flat = text.replace(/\s+/g, " ");
  const taken: [number, number][] = [];
  for (const { re, ratio } of RATIO_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(flat); m; m = re.exec(flat)) {
      const at = m.index, end = at + m[0].length;
      if (taken.some(([a, b]) => at < b && end > a)) continue;
      const n = ratio(m);
      if (n === null || !(n > 0) || n > 1000) continue;
      taken.push([at, end]);
      out.push({ ordinaryPerAds: n, sentence: around(flat, at, m[0].length) });
    }
  }
  return out;
}

/**
 * ORDINARY SHARES LISTED DIRECTLY (COWORK #22 §1: "no Item 12.D ADS section
 * means ordinary shares trade directly: compute normally"). Cited too: the
 * 20-F cover's Section 12(b) table lists ordinary/common shares under this
 * very ticker, and the filing never mentions depositary shares at all. The
 * row is returned verbatim as the citation; anything less returns null.
 */
export function directListingStatement(text: string, symbol: string): string | null {
  const flat = text.replace(/\s+/g, " ");
  if (/depositary/i.test(flat)) return null;
  const at = flat.search(/pursuant to Section 12\s*\(\s*b\s*\)/i);
  if (at < 0) return null;
  const table = flat.slice(at, at + 900);
  const sym = String(symbol).toUpperCase().replace(/[-.]/g, "[-. ]?");
  const row = new RegExp(String.raw`((?:Class\s+[A-Z]\s+)?(?:ordinary|common)\s+shares?\b[^;]{0,160}?)\b${sym}\b`, "i").exec(table);
  if (!row || /preferred|preference|warrant|notes?\b|debentures?|units?\b/i.test(row[1])) return null;
  return around(table, row.index, row[0].length);
}

/**
 * The one ratio a filing states, or why not. Every statement must agree:
 * a filing that states two ratios (a ratio change mid-year) is left for a
 * person, never averaged.
 */
export function adsRatioOf(text: string):
  | { ok: true; ordinaryPerAds: number; sentence: string; statements: number }
  | { ok: false; why: "no-ratio-stated" | "ratios-disagree"; values: number[] } {
  const all = adsRatioStatements(text);
  if (!all.length) return { ok: false, why: "no-ratio-stated", values: [] };
  const values = [...new Set(all.map((a) => Math.round(a.ordinaryPerAds * 1e6) / 1e6))];
  if (values.length > 1) return { ok: false, why: "ratios-disagree", values };
  return { ok: true, ordinaryPerAds: values[0], sentence: all[0].sentence, statements: all.length };
}
