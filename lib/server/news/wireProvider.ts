// The wire adapters — GlobeNewswire and PR Newswire.
//
// Step 4 of claude/news-adapter-spec-2026-09-13.md, behind NEWS_PROVIDER — which
// step 7 flipped to default "free", so this is live.
//
// ── WHY THE WIRES ARE THE ONE LEG THAT MAY KEEP ITS EXTRACTS AND IMAGES ─────
// A press release is issued FOR republication. That is the whole distinction
// from the FMP situation: the wire is the rights holder for its own release and
// its own photograph, so a wire-credited image is defensible where an agency
// photograph passed through an aggregator never was. This adapter records that
// per-item verdict in `imageVerdict`; it does not render anything. Rendering
// still needs SHOW_PUBLISHER_IMAGES (lib/news-image-policy.ts), which stays
// false — the flag is the master switch ABOVE the verdict and both must be true.
//
// ── ONE POLL, TWO CONSUMERS ────────────────────────────────────────────────
// Both feeds are market-wide, so fetchMarket() and fetchForSymbol() read the
// SAME two requests. There is no per-symbol request anywhere in this file: the
// URL does not vary by symbol, so Next's Data Cache (revalidate 3600) collapses
// every caller within the hour onto one fetch per feed, and within a render pass
// they are memoised outright. fetchForSymbol filters that shared set rather than
// asking the wire about a symbol.
import { stripHtmlTags, containsHtmlMarkup, decodeHtml, cleanRssDescription } from "./text";
import { deriveEventType } from "./eventType";
import type { NewsItem, NewsProvider } from "./types";

const GLOBENEWSWIRE_URL =
  "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire---Public-Companies";
const PRNEWSWIRE_URL =
  "https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss";

/** Wire releases are short-lived; the same window the other adapters keep. */
export const WIRE_STORE_MAX_AGE_DAYS = 120;

/**
 * Exchange prefixes on GlobeNewswire's <category> that count as US-listed.
 *
 * MEASURED, NOT GUESSED. One real poll of 20 items produced: TSX=10, Nasdaq=10,
 * Paris=4, SWX=2, OTC Markets=2, Copenhagen/TSX-V/Frankfurt/NYSE/BMV/Shenzhen/
 * Oslo=1 each. The feed is mostly NOT US-listed, which is why the spec says to
 * ignore the rest rather than try to map them — a Toronto or Paris ticker can
 * collide with an unrelated US one, and a wrong match is worse than no match.
 *
 * OTC Markets is deliberately excluded despite being US: the scan universe is
 * listed equities, and an OTC symbol (RHHBY) resolving against it would be a
 * false match of exactly the kind this allowlist exists to prevent. Reversible
 * in one line if OTC coverage is ever wanted.
 */
const US_EXCHANGE_PREFIXES = new Set([
  "nasdaq", "nyse", "nyse american", "nyseamerican", "nyse arca", "amex", "bats", "cboe",
]);

/** PR Newswire's prn:subject / dc:subject -> the NewsItem eventType enum. */
function tagAll(block: string, tag: string): string[] {
  const out: string[] = [];
  // Escaped because prn:industry and dc:subject contain a colon.
  const re = new RegExp(`<${tag.replace(":", "\\:")}[^>]*>([\\s\\S]*?)</${tag.replace(":", "\\:")}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.push(m[1]);
  return out;
}
const tag1 = (block: string, tag: string) => tagAll(block, tag)[0] ?? null;
const clean = (v: string | null) => (v == null ? "" : decodeHtml(stripHtmlTags(v)).trim());

/**
 * Tickers from GlobeNewswire's exchange-prefixed <category>.
 *
 * "SWX:RO" and "OTC Markets:RHHBY" are the spec's own examples; the prefix is
 * split on the FIRST colon only, because "NYSE American:XYZ" contains a space
 * but no second colon and splitting on all of them would lose the symbol.
 *
 * THE CAPTURED FEED SHOWS THE REAL DISCRIMINATOR IS THE `domain` ATTRIBUTE:
 * a ticker category is domain=".../rss/stock" and the same item also carries
 * domain=".../rss/ISIN" holding an ISIN. The caller passes only the stock-domain
 * values; the colon rule below is kept as the second gate because an ISIN
 * (US74033P1003) has no colon and would fall through it anyway, so the two
 * disagree in no case and the redundancy costs nothing.
 */
export function tickersFromCategories(categories: string[]): string[] {
  const out = new Set<string>();

  for (const raw of categories) {
    const value = clean(raw);
    const colon = value.indexOf(":");
    if (colon < 0) continue;

    const prefix = value.slice(0, colon).trim().toLowerCase();
    const symbol = value.slice(colon + 1).trim().toUpperCase();
    if (!US_EXCHANGE_PREFIXES.has(prefix)) continue;
    // Ticker shape only: the same category element also carries free-text topics.
    if (/^[A-Z][A-Z.\-]{0,6}$/.test(symbol)) out.add(symbol);
  }

  return [...out];
}

/**
 * The §6 image cascade, as a verdict rather than a render.
 *
 *   wire credits ITSELF        -> allow   (it issued the release and the photo)
 *   an agency is credited      -> deny    (Getty et al were never ours to use)
 *   no image at all            -> deny
 *   anything else              -> deny
 *
 * DEFAULT DENY IS THE WHOLE DESIGN: every path that is not positively known to
 * be safe returns "deny", so a credit format nobody has seen yet fails closed.
 */
const AGENCY_CREDITS = /getty|reuters|associated press|\bap\b|agence france|afp|bloomberg|shutterstock|istock|alamy|epa|zuma/i;
const WIRE_SELF_CREDITS = /^(prnewswire|pr newswire|globenewswire|globe newswire|business wire|businesswire)$/i;

export function imageVerdictFor(imageUrl: string | null, credit: string | null): NewsItem["imageVerdict"] {
  if (!imageUrl) return "deny";
  const value = (credit ?? "").trim();
  if (!value) return "deny";
  if (AGENCY_CREDITS.test(value)) return "deny";
  if (WIRE_SELF_CREDITS.test(value)) return "allow";
  return "deny";
}

type WireSource = {
  id: "globenewswire" | "prnewswire";
  url: string;
  label: string;
};

const SOURCES: WireSource[] = [
  { id: "globenewswire", url: GLOBENEWSWIRE_URL, label: "GlobeNewswire" },
  { id: "prnewswire", url: PRNEWSWIRE_URL, label: "PR Newswire" },
];

/**
 * One wire feed into NewsItems. Exported for the harness, which runs it against
 * captured payloads — the sandbox cannot reach either host.
 */
export function parseWireFeed(xml: string, source: WireSource, nowMs = Date.now()): NewsItem[] {
  const oldestAllowedMs = nowMs - WIRE_STORE_MAX_AGE_DAYS * 86_400_000;
  const items: NewsItem[] = [];

  for (const raw of xml.split(/<item[\s>]/).slice(1)) {
    const block = raw.split("</item>")[0];

    const title = clean(tag1(block, "title"));
    const link = clean(tag1(block, "link"));
    if (!title || !link) continue;
    if (containsHtmlMarkup(title)) continue;

    const pubDate = clean(tag1(block, "pubDate")) || null;
    const ms = pubDate ? Date.parse(pubDate) : NaN;
    if (!Number.isFinite(ms) || ms < oldestAllowedMs) continue;

    // THE REAL DESCRIPTION IS KEPT. This is the one leg where a longer extract is
    // defensible, so these items carry their own snippet and never fall through
    // to the template builders in lib/stock-news-templates.ts.
    const description = cleanRssDescription(tag1(block, "description"));

    // ONLY THE STOCK-DOMAIN CATEGORIES. GlobeNewswire tags each <category> with a
    // `domain` saying what kind of identifier it holds; the ISIN ones are not
    // tickers and must not be offered to the matcher.
    const stockCategories = [...block.matchAll(/<category[^>]*domain="[^"]*\/rss\/stock"[^>]*>([\s\S]*?)<\/category>/g)]
      .map((m) => m[1]);
    // NOTE: GlobeNewswire's free-text categories ("Mergers and Acquisitions",
    // "Calendar of Events") are deliberately NOT collected here. They are a
    // plausible eventType signal and step 6 may want them; nothing reads
    // `categories` yet, so adding them now would be an unverifiable guess.
    const tickers = source.id === "globenewswire" ? tickersFromCategories(stockCategories) : [];

    // prn:industry -> sector label, prn:subject -> eventType. Both carry long
    // labels AND 3-letter codes in the same item, so the codes are filtered out
    // by length rather than by a list nobody would maintain.
    const industries = tagAll(block, "prn:industry").map(clean).filter((v) => v.length > 4);
    const subjects = [...tagAll(block, "prn:subject"), ...tagAll(block, "dc:subject")]
      .map(clean)
      .filter((v) => v.length > 4);

    // Step 6: the subject leg, falling through to the title leg when the issuer
    // supplied no usable subject. The cascade and every pattern in it live in
    // lib/server/news/eventType.ts — see the note there on why it is one file.
    const { eventType } = deriveEventType({ subjects, title });

    const imageUrl = block.match(/<media:content[^>]*url="([^"]+)"/)?.[1] ?? null;
    const credit = clean(tag1(block, "media:credit")) || null;

    items.push({
      title,
      link,
      pubDate,
      source: source.label,
      description,
      // Recorded, NOT rendered. lib/news-image-policy.ts is the master switch and
      // it is false; this only says what the cascade decided.
      image: imageUrl,
      imageVerdict: imageVerdictFor(imageUrl, credit),
      guid: clean(tag1(block, "guid")) || null,
      tickers,
      categories: [...industries, ...subjects],
      eventType,
      provider: "wire",
    });
  }

  return items.sort((a, b) => Date.parse(b.pubDate ?? "") - Date.parse(a.pubDate ?? ""));
}

async function pollAll(): Promise<NewsItem[]> {
  const batches = await Promise.all(
    SOURCES.map(async (source) => {
      try {
        // Identical URL for every caller and every symbol — that is what makes
        // this one poll rather than one per symbol.
        const res = await fetch(source.url, { next: { revalidate: 3600 } });
        if (!res.ok) return [];
        return parseWireFeed(await res.text(), source);
      } catch {
        return [];
      }
    })
  );

  return batches.flat();
}

/**
 * Per-symbol: the shared poll, filtered.
 *
 * MATCHED ON THE FEED'S OWN STRUCTURED FIELD, not on text. A GlobeNewswire
 * <category> of "Nasdaq:CYRX" is the issuer telling the wire which ticker the
 * release is about — no headline matching involved.
 *
 * NOTE ON WHAT THIS IS WORTH, measured rather than assumed: one real poll
 * returned 2 of 40 wire items resolving to a universe symbol. The wires are a
 * supplement to the per-symbol feed, not a source of it. `companyName` is
 * unused — matching is by ticker, and a name match would reintroduce exactly the
 * text guessing the structured field avoids.
 */
async function fetchForSymbol(
  symbol: string,
  _companyName: string,
  _sinceIso: string | null
): Promise<NewsItem[]> {
  const wanted = symbol.trim().toUpperCase();
  if (!wanted) return [];
  return (await pollAll()).filter((item) => item.tickers?.includes(wanted));
}

/** Market-wide: the same poll, unfiltered. Feeds /headlines and seeds sectors. */
async function fetchMarket(): Promise<NewsItem[]> {
  return pollAll();
}

export const wireProvider: NewsProvider = {
  id: "wire",
  fetchForSymbol,
  fetchMarket,
};
