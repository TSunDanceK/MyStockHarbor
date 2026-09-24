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
const SHARE = String.raw`(?:ordinary|common|equity|class\s+[a-z]\s+ordinary|class\s+[a-z]\s+common|class\s+[a-z]|class\s+“?[a-z]”?|series\s+[a-z]\s+)?\s*shares?`;
// "Depository" too: EC's own cover spells it that way; GDSs (IRS) are the same instrument.
const ADS = String.raw`(?:ADS|ADSs|GDS|GDSs|(?:American|Global)\s+deposit[ao]ry\s+shares?)`;
/**
 * The phrasings, each capturing the number of ordinary shares ONE ADS stands
 * for. All anchored on "represent" / "equal" so a price, a volume or a count
 * of ADSs outstanding can never be read as a ratio.
 */
const PRECEDING_COUNT = String.raw`(?<!\b(?:two|three|four|five|six|seven|eight|nine|ten|twenty|\d+)\s+)`;
const RATIO_PATTERNS: { re: RegExp; ratio: (m: RegExpExecArray) => number | null }[] = [
  // "each ADS represents five ordinary shares"
  { re: new RegExp(String.raw`\b(?:each|one|1)\s+${ADS}\s+(?:currently\s+)?(?:represents?|representing|is\s+equal\s+to|equals)\s+(?:(?:the\s+)?rights?\s+to\s+(?:receive\s+)?)?${COUNT}\s+${SHARE}`, "gi"),
    ratio: (m) => parseCount(m[1]) },
  // "ADSs, each representing one-half of one ordinary share" — NOT when a
  // count precedes the ADS ("two ADSs represent one share" is the next rule).
  // WITH "EACH", a preceding number is how many ADSs, not a ratio: "4,050,549
  // ADSs, each representing five Class B common shares" (TEO) states five.
  { re: new RegExp(String.raw`${ADS}\s*(?:\((?!\s*each)[^)]{0,40}\)\s*)?,?\s*\(?\s*each\s+(?:of\s+which\s+)?(?:currently\s+)?(?:represents?|representing)\s+(?:(?:the\s+)?rights?\s+to\s+(?:receive\s+)?)?${COUNT}\s+${SHARE}`, "gi"),
    ratio: (m) => parseCount(m[1]) },
  { re: new RegExp(String.raw`${PRECEDING_COUNT}${ADS}\s*(?:\((?!\s*each)[^)]{0,40}\)\s*)?,?\s*\(?\s*(?:of\s+which\s+)?(?:currently\s+)?(?:represents?|representing)\s+(?:(?:the\s+)?rights?\s+to\s+(?:receive\s+)?)?${COUNT}\s+${SHARE}`, "gi"),
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
  // "D. American Depositary Shares Not applicable" (Item 12.D) is the filing
  // SAYING there are none — the direct-listing signal, not a mention of ADSs.
  if (/depositary/i.test(flat.replace(/American Depositary Shares\.?\s*:?\s*Not applicable/gi, ""))) return null;
  // THE SECURITIES TABLE, not the "PURSUANT TO SECTION 12(b) OR (g)" checkbox line above it.
  const at = flat.search(/registered,?\s+or\s+to\s+be\s+registered,?\s+pursuant\s+to\s+Section\s+12\s*\(\s*b\s*\)/i);
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

// ── THE LATEST 20-F'S 12(b) SECTION DECIDES (#552 COWORK #45) ──
//
// AZN's F-6 (2025) says each ADS is one-half of an ordinary share; its FY2025
// 20-F registers ORDINARY SHARES and no ADSs, so the listing changed and the
// older F-6 must not win. Covers are laid out every which way (RIO lists all
// titles, then all symbols; SAP puts its symbol in the header; E's ADS line
// carries no symbol at all), so the SECTION decides, not a row: a 12(b) section
// that registers depositary shares is an ADS listing, one that registers only
// ordinary/common shares is a direct listing.

const SECTION_12B = /registered,?\s+or\s+to\s+be\s+registered,?\s+pursuant\s+to\s+Section\s+12\s*\(\s*b\s*\)/i;
const ADS_MENTION = /(?:American|Global)\s+deposit[ao]ry|\b[AG]DSs?\b/i;
// A DEPOSITARY SHARE OF SOMETHING OTHER THAN COMMON EQUITY: preferred shares
// (AVAL, CIB, ITUB) or CPO units (CX, TV). The filer's EPS and share count are
// per common share, so no ratio makes the arithmetic honest — refused.
const NOT_COMMON_UNDERLYING = /\bCPOs?\b|participation\s+certificates|\bunits?\b/i;
const PREFERRED_UNDERLYING = /represent\w*\s+(?:the\s+)?(?:rights?\s+to\s+(?:receive\s+)?)?\S+\s+(?:[\w.,$]+\s+){0,3}?(?:preferred|preference)\b/i;

/** The 20-F cover's 12(b) section, from its heading up to the 12(g) line, flattened. */
export function section12bOf(text: string): string | null {
  const flat = text.replace(/\s+/g, " ");
  const at = flat.search(SECTION_12B);
  if (at < 0) return null;
  // THE WHOLE SECTION, footnotes included: AZN lists a dozen notes first.
  let table = flat.slice(at, at + 8000);
  const g = table.slice(60).search(/pursuant\s+to\s+Section\s+12\s*\(\s*g\s*\)/i);
  if (g >= 0) table = table.slice(0, 60 + g);
  return table;
}

const symbolRe = (symbol: string, flags: string) => {
  const sym = String(symbol).toUpperCase().replace(/[-.]/g, "[-. ]?");
  // A note's symbol ("AZN/26", "AZN26", "AZN 26") is not the ticker.
  return new RegExp(String.raw`(?<![A-Za-z0-9/])${sym}(?![A-Za-z0-9/]|\s\d{2,4}[A-Z]?\b)`, flags);
};

export type CoverRow = { title: string; kind: "ads" | "ordinary" | "other" };

const kindOfTitle = (title: string): CoverRow["kind"] =>
  ADS_MENTION.test(title) ? "ads"
    : /preferred|preference|warrant|\bnotes?\b|debentures?|\bunits?\b|%/i.test(title) ? "other"
      : /(?:ordinary|common|equity)\s+(?:shares?|stock)|\bshares?\b/i.test(title) ? "ordinary" : "other";

/** Every 12(b) row listed under `symbol` in a 20-F, classified, in table order. */
export function coverRowsFor(text: string, symbol: string): CoverRow[] {
  const table = section12bOf(text);
  if (!table) return [];
  const rows: CoverRow[] = [];
  let prevEnd = 0;
  for (const m of table.slice(40).matchAll(symbolRe(symbol, "g"))) {
    const idx = 40 + m.index;
    const before = table.slice(prevEnd, idx);
    prevEnd = idx + m[0].length;
    let cut = 0;
    for (const b of before.matchAll(/\b(?:registered:?|Exchange|LLC|Market|Inc\.?|\(“?NYSE”?\))(?=\s)|\*+(?=\s)/gi)) cut = b.index + b[0].length;
    const title = before.slice(cut).replace(/^[\s:*.,;–-]+/, "").trim();
    if (title) rows.push({ title, kind: kindOfTitle(title) });
  }
  return rows;
}

/** The section's own words about its depositary shares: the ADS title and its footnote. */
function adsWordsOf(section: string): string {
  const at = section.search(ADS_MENTION);
  return at < 0 ? "" : around(section, at, 160);
}

/**
 * The ONE listing the price is quoted for, from the latest 20-F's 12(b)
 * section. Depositary shares registered there → the ADS (an ordinary line
 * under the same symbol is the deposit, "not for trading" — VOD, WPP, E).
 * None → the ordinary/common row, when the section names this symbol at all
 * (AZN's ordinary row carries no symbol; only its notes do). Null when the
 * section is missing or never names the symbol.
 */
export function coverRowFor(text: string, symbol: string): CoverRow | null {
  const section = section12bOf(text);
  if (!section) return null;
  const rows = coverRowsFor(text, symbol);
  const named = rows.length > 0 || new RegExp(String.raw`\b${String(symbol).toUpperCase().replace(/[-.]/g, "[-. ]?")}\b`).test(section);
  if (!named) return null;
  const ads = rows.find((r) => r.kind === "ads");
  if (ads) return ads;
  // A CLASS TICKER (PBR-A) that no row names is never given the section's
  // first ADS line: that line is the other class's.
  if (!rows.length && /[-.]/.test(symbol)) return null;
  if (ADS_MENTION.test(section)) return { title: adsWordsOf(section), kind: "ads" };
  const ord = rows.find((r) => r.kind === "ordinary");
  if (ord) return ord;
  if (rows.length) return rows[0];
  // NO ROW CARRIES THE SYMBOL (AZN: "Ordinary Shares of 25 ¢ each The New York
  // Stock Exchange", then "AZN 26…" notes): the section's ordinary title.
  const title = /((?:Class\s+[A-Z]\s+)?(?:ordinary|common)\s+shares?\b[^*]{0,80}?(?:Exchange|LLC|Market)\b)/i.exec(section.slice(40));
  return title ? { title: title[1].trim(), kind: "ordinary" } : null;
}

// THE SECTION'S FOOTNOTE PHRASINGS, read only inside a 12(b) section that
// registers ADSs: E's "(Which represent the right to receive two Shares)",
// RIO's "Each American Depositary Share Represents one Rio Tinto plc Ordinary
// Shares" (the company's name between the count and the class).
// Never across "preferred"/"preference": that is a different class (AVAL, CIB, ITUB).
const SECTION_RATIO = new RegExp(String.raw`\brepresent(?:s|ing)?\s+(?:the\s+)?(?:rights?\s+to\s+(?:receive\s+)?)?${COUNT}\s+(?:(?!preferred|preference)[A-Za-z.&]+\s+){0,4}?${SHARE}`, "gi");

export function sectionRatioOf(section: string): ReturnType<typeof adsRatioOf> {
  const std = adsRatioOf(section);
  if (std.ok || std.why === "ratios-disagree") return std;
  const all: AdsRatioStatement[] = [];
  for (const m of section.matchAll(SECTION_RATIO)) {
    const n = parseCount(m[1]);
    if (n !== null && n > 0 && n <= 1000) all.push({ ordinaryPerAds: n, sentence: around(section, m.index, m[0].length) });
  }
  if (!all.length) return std;
  const values = [...new Set(all.map((a) => Math.round(a.ordinaryPerAds * 1e6) / 1e6))];
  if (values.length > 1) return { ok: false, why: "ratios-disagree", values };
  return { ok: true, ordinaryPerAds: values[0], sentence: all[0].sentence, statements: all.length };
}

export type AdsRowDecision =
  | { row: { kind: "ads" | "ordinary"; ordinaryPerAds: number; evidence: string; from: "20-F" | "F-6"; basis: string } }
  | { refuse: string };

/**
 * THE SOURCE RULE (#552 COWORK #45), in one place: the latest 20-F's cover row
 * for the ticker decides; an F-6 is read ONLY when filed after that 20-F (or
 * with no 20-F on the list), and one stating a different ratio from the 20-F
 * is a ratio change — refused, for a person. `f6Text` is null when there is
 * no F-6 to read.
 */
export function decideAdsRow(text20F: string | null, symbol: string, f6Text: string | null, f6IsNewer: boolean): AdsRowDecision {
  let row: { kind: "ads" | "ordinary"; ordinaryPerAds: number; evidence: string; from: "20-F" | "F-6"; basis: string } | null = null;
  if (text20F) {
    const cover = coverRowFor(text20F, symbol);
    if (cover?.kind === "ordinary") row = { kind: "ordinary", ordinaryPerAds: 1, evidence: cover.title, from: "20-F", basis: "cover-row" };
    else if (cover?.kind === "ads") {
      if (NOT_COMMON_UNDERLYING.test(cover.title)) return { refuse: `depositary shares of units/CPOs: ${cover.title.slice(0, 80)}` };
      if (PREFERRED_UNDERLYING.test(cover.title)) return { refuse: `depositary shares of preferred shares: ${cover.title.slice(0, 80)}` };
      // The row's own title, then the section with its footnotes, then the 20-F's text.
      const t = adsRatioOf(cover.title);
      const sec = t.ok ? t : sectionRatioOf(section12bOf(text20F) ?? "");
      const got = sec.ok || sec.why === "ratios-disagree" ? sec : adsRatioOf(text20F);
      if (got.ok) row = { kind: "ads", ordinaryPerAds: got.ordinaryPerAds, evidence: t.ok ? cover.title : got.sentence, from: "20-F", basis: t.ok ? "cover-row" : sec.ok ? "12(b) section" : "20-F text" };
      else if (got.why === "ratios-disagree") return { refuse: `ratios disagree ${got.values.join("/")}` };
    } else if (cover?.kind === "other") return { refuse: `cover row is not common/ordinary: ${cover.title.slice(0, 80)}` };
    else if (/[-.]/.test(symbol) && ADS_MENTION.test(section12bOf(text20F) ?? "")) return { refuse: "class ticker on no 12(b) row" };
    else {
      const got = adsRatioOf(text20F);
      if (got.ok) row = { kind: "ads", ordinaryPerAds: got.ordinaryPerAds, evidence: got.sentence, from: "20-F", basis: "20-F text" };
      else if (got.why === "ratios-disagree") return { refuse: `ratios disagree ${got.values.join("/")}` };
      else {
        const direct = directListingStatement(text20F, symbol);
        if (direct) row = { kind: "ordinary", ordinaryPerAds: 1, evidence: direct, from: "20-F", basis: "12(b), no ADS" };
      }
    }
  }
  if (f6Text && f6IsNewer) {
    const got = adsRatioOf(f6Text);
    if (got.ok && row && row.ordinaryPerAds !== got.ordinaryPerAds) return { refuse: `ratio changed after the 20-F: ${row.ordinaryPerAds} -> ${got.ordinaryPerAds}` };
    if (got.ok && !row) row = { kind: "ads", ordinaryPerAds: got.ordinaryPerAds, evidence: got.sentence, from: "F-6", basis: "F-6 newer than the 20-F" };
  }
  return row ? { row } : { refuse: "no ratio or listing statement" };
}
