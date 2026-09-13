// Turning a universe display name into something Google News can be asked about.
//
// Step 2 of claude/news-adapter-spec-2026-09-13.md. Pure string work -- no I/O,
// no network. The adapter that will use it is step 3.
//
// WHY IT IS NEEDED. Google News is a plain text search with no notion of a
// ticker, so the adapter queries `"${cleanName}" stock`. The name it starts from
// is whatever lib/stock-news-data.ts's fetchCompanyName returned, and that is the
// Nasdaq Trader directory's Security Name column RAW -- "Micron Technology, Inc.
// - Common Stock". Querying that verbatim searches for the instrument
// description as much as for the company.
//
// ── WHERE THIS DEPARTS FROM THE SPEC, AND WHY ──────────────────────────────
// The spec says to strip "everything from ` - ` onward". Measured against 155
// real directory names (scripts/fixtures/company-names.txt), THAT IS TRUE OF
// ONLY ABOUT HALF OF THEM. The rest join the instrument clause with a plain
// space, or after a bracket:
//
//   "Micron Technology, Inc. - Common Stock"   <- the spec's shape
//   "Chevron Corporation Common Stock"         <- no dash at all
//   "Boeing Company (The) Common Stock"        <- and a parenthetical in the way
//
// A ` - ` cut alone leaves "Chevron Corporation Common Stock" intact, which is
// the exact failure the normaliser exists to prevent. So the dash cut is kept
// (it is the only thing that handles " - Units" and " - 7.875% Notes due 2028")
// and the instrument clause is then removed by the rule that already ships:
// cleanName in lib/server/companyNames.ts, which the screener cards have used
// against this same feed for months. Sharing it beats restating it.
import { cleanName } from "@/lib/server/companyNames";

/**
 * Corporate suffixes stripped from the end of a name.
 *
 * WHAT STOPS "Corp" EATING THE END OF "Corporation" IS THE SEPARATOR ANCHOR in
 * stripCorporateSuffixes, not the order of this list -- every pattern requires a
 * space or comma in front of the suffix, so "Corp" simply does not match inside
 * "Corporation". That was worth establishing rather than assuming: the list is
 * still sorted longest-first below as defence in depth, but a mutation that
 * reverses the sort changes no output, and a comment claiming the ordering is
 * what protects the name would have been credit in the wrong place.
 */
const SPEC_SUFFIXES = [
  "Corporation",
  "Company",
  "Holdings",
  "Group",
  "Corp.",
  "Inc.",
  "Ltd.",
  "N.V.",
  "S.A.",
  "plc",
  "Co.",
];

/**
 * Suffixes the spec's list does not name but the real sample contains.
 *
 * KEPT AS A SEPARATE LIST so the spec's own list stays legible and this can be
 * deleted in one edit if the owner wants strict spec behaviour. Every entry is
 * here because a real name in the fixture needs it, named in the comment:
 */
const OBSERVED_SUFFIXES = [
  "Incorporated", // TXN "Texas Instruments Incorporated"
  "Limited", //      DOX "Amdocs Limited", BABA "Alibaba Group Holding Limited"
  "Holding", //      BABA, after "Limited" goes
  "Corp", //         AXINU "…Acquisition Corp 1", MTAKU "…Acquisition Corp"
  "Inc", //          MSTR "Strategy Inc", ONDS "Ondas Inc"
  "Ltd", //          UK "Ucommune International Ltd"
  "LLC", //          VRT "Vertiv Holdings, LLC"
  "L.P.", //         partnership names in the wider directory
  "LP", //           UGA "United States Gasoline Fund LP"
  "Co", //           bare, no dot
];

const SUFFIXES = [...SPEC_SUFFIXES, ...OBSERVED_SUFFIXES].sort(
  (a, b) => b.length - a.length
);

/** Punctuation and whitespace left dangling at either end by a cut. */
const EDGE_PUNCTUATION = /^[\s,.;:\-–—/&]+|[\s,.;:\-–—/&]+$/g;

/**
 * Strip everything from the first spaced dash onward.
 *
 * THE SPACES ARE WHAT MAKE IT SAFE. A bare "-" would cut "D-Wave Quantum",
 * "T-Mobile US" and "Global-E Online" in half. The directory's instrument clause
 * is always spaced, and across 155 real names no company name contains a spaced
 * dash -- so this only ever removes instrument text.
 */
function stripDashClause(name: string): string {
  const cut = name.search(/\s[-–—]\s/);
  return cut === -1 ? name : name.slice(0, cut);
}

/**
 * Strip trailing corporate suffixes, repeatedly.
 *
 * REPEATEDLY, because they stack: "MARA Holdings, Inc." needs two passes and
 * "Alibaba Group Holding Limited" needs three. Bounded so nothing can spin.
 *
 * THE KNOWN COST, stated rather than discovered later: "Group" and "Holdings"
 * are on the spec's list but are sometimes part of the name a reader would use
 * ("Post Holdings" -> "Post"). That makes a query broader, not wrong, and names
 * that end up too generic are exactly what assessCompanyName flags and what the
 * manual override list will be for.
 */
function stripCorporateSuffixes(name: string): string {
  let out = name;

  for (let pass = 0; pass < 5; pass += 1) {
    const before = out;

    for (const suffix of SUFFIXES) {
      const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Anchored to the end, and requiring a separator in front so "Inc" cannot
      // match the tail of "Zinc" nor "Co" the tail of "Tucows".
      const re = new RegExp(`(^|[\\s,])${escaped}$`, "i");
      if (re.test(out)) {
        out = out.replace(re, "").replace(EDGE_PUNCTUATION, "");
        break;
      }
    }

    if (out === before) break;
  }

  return out;
}

/**
 * A universe display name, reduced to the term a news search should use.
 *
 *   "Micron Technology, Inc. - Common Stock"  ->  "Micron Technology"
 *   "Chevron Corporation Common Stock"        ->  "Chevron"
 *
 * Returns "" when nothing survives. A caller MUST treat that as "no usable
 * name" and fall back to the symbol rather than searching for it: `"" stock`
 * matches the entire market.
 */
export function normaliseCompanyName(raw: string): string {
  if (typeof raw !== "string") return "";

  let name = raw.replace(/\s+/g, " ").trim();
  if (!name) return "";

  name = stripDashClause(name);
  name = cleanName(name);
  name = stripCorporateSuffixes(name);
  name = name.replace(EDGE_PUNCTUATION, "");
  name = name.replace(/\s{2,}/g, " ").trim();

  return name;
}

/**
 * Words that are not a company when they stand alone.
 *
 * Every entry is a word a real normalised name in the fixture reduced to, or a
 * near neighbour of one. `"Post" stock` and `"Strategy" stock` return the news,
 * not the company's news.
 */
const COMMON_WORDS = new Set([
  "american", "capital", "energy", "equity", "financial", "first", "global",
  "growth", "health", "income", "industries", "international", "investment",
  "investors", "national", "pacific", "partners", "post", "premier", "quality",
  "resources", "select", "strategic", "strategy", "technologies", "technology",
  "trust", "united", "value", "world",
]);

export type NameVerdict = {
  ok: boolean;
  reason?: "empty" | "too-short" | "single-common-word" | "fund-or-note";
};

/**
 * Would this normalised name make a bad Google News query?
 *
 * SEPARATE FROM THE NORMALISER, and it returns a REASON rather than a boolean.
 * The normaliser's job is to produce the best name it can; judging that the
 * result is not searchable is a different question, and step 3's adapter will
 * want to act on it -- fall back to the symbol, or consult an override list --
 * rather than merely know something is wrong.
 */
export function assessCompanyName(normalised: string): NameVerdict {
  if (!normalised) return { ok: false, reason: "empty" };

  const letters = normalised.replace(/[^A-Za-z0-9]/g, "");
  if (letters.length <= 2) return { ok: false, reason: "too-short" };

  // Funds, notes and preferreds are not companies, and their names are product
  // descriptions. They should never reach a per-symbol news query, but the
  // universe is not guaranteed clean, so this says so rather than searching.
  if (/\b(ETF|ETN|ETNs|Fund|Notes?|Debentures?|Preferred|Preference|Units?)\b/i.test(normalised)) {
    return { ok: false, reason: "fund-or-note" };
  }

  const words = normalised.split(/\s+/).filter(Boolean);
  if (words.length === 1 && COMMON_WORDS.has(words[0].toLowerCase())) {
    return { ok: false, reason: "single-common-word" };
  }

  return { ok: true };
}
