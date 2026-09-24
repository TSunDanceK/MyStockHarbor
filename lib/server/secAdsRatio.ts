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

const COUNT = String.raw`(\d+(?:\.\d+)?|\d+\s*/\s*\d+|one[- ]half|one[- ](?:quarter|fourth|third|fifth|tenth|twentieth|fortieth)|one hundred|twenty-five|[a-z]+)(?:\s*\(\s*[\d.,/]+\s*\))?(?:\s+of\s+(?:one|an?))?`;
const SHARE = String.raw`(?:ordinary|common|class\s+[a-z]\s+ordinary|class\s+[a-z]\s+common|series\s+[a-z]\s+)?\s*shares?`;
const ADS = String.raw`(?:ADS|ADSs|American\s+depositary\s+shares?|American\s+depositary\s+share)`;
/**
 * The phrasings, each capturing the number of ordinary shares ONE ADS stands
 * for. All anchored on "represent" / "equal" so a price, a volume or a count
 * of ADSs outstanding can never be read as a ratio.
 */
const RATIO_PATTERNS: RegExp[] = [
  // "each ADS represents five ordinary shares"
  new RegExp(String.raw`\b(?:each|one|1)\s+${ADS}\s+(?:currently\s+)?(?:represents?|representing|is\s+equal\s+to|equals)\s+(?:the\s+right\s+to\s+receive\s+)?${COUNT}\s+${SHARE}`, "i"),
  // "ADSs, each representing one-half of one ordinary share"
  new RegExp(String.raw`${ADS}\s*(?:\((?!\s*each)[^)]{0,40}\)\s*)?,?\s*\(?\s*(?:each\s+)?(?:of\s+which\s+)?(?:currently\s+)?(?:represents?|representing)\s+(?:the\s+right\s+to\s+receive\s+)?${COUNT}\s+${SHARE}`, "i"),
];

export type AdsRatioStatement = { ordinaryPerAds: number; sentence: string };

/** Every sentence in `text` stating an ADS ratio, with the ratio it states. */
export function adsRatioStatements(text: string): AdsRatioStatement[] {
  const out: AdsRatioStatement[] = [];
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.;])\s+(?=[A-Z(“"])/);
  for (const s of sentences) {
    if (!/depositary|ADS/i.test(s)) continue;
    for (const re of RATIO_PATTERNS) {
      const m = re.exec(s);
      if (!m) continue;
      const n = parseCount(m[1]);
      if (n !== null && n > 0 && n <= 1000) out.push({ ordinaryPerAds: n, sentence: s.trim().slice(0, 400) });
      break;
    }
  }
  return out;
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
