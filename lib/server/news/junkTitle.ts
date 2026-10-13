// HEADLINES THAT ARE NOT NEWS (#553 COWORK #191 item 1, 2026-10-07).
//
// On the #807 preview AMZN's news card showed "Form 4 Amazon.com Inc For: 6
// October" (a filing notice, republished by an aggregator) and "Amazon.com, Inc.
// (AMZN03.BK) stock historical prices and data" (a quote page for a foreign
// depositary listing). Neither is an article. Three shapes, read from the
// HEADLINE alone (as filingChurn reads it: a publisher list matches a spelling,
// and a new farm spells itself differently):
//
//   filing-notice    a third-party copy of insider or holder paperwork: Form
//                    3/4/5/144, Schedule/SC 13D or 13G. The SEC adapter's OWN
//                    filing items are exempt: it already caps routine forms at
//                    three on purpose (secProvider ROUTINE_FORMS), and those are
//                    labelled filings, not headlines pretending to be news
//   quote-page       a price page: "historical prices", "stock price today",
//                    "stock quote", "price history", "stock price & news"
//   foreign-listing  a ticker in brackets with a foreign venue suffix (".BK",
//                    ".L", ".TO", ...), the page of another listing of the
//                    company, not this one's news. A US share class (BRK.B) is a
//                    single letter and is not matched
//
// Applied in the news store (lib/server/newsStore.ts readOrRefresh: what is
// held and what is fetched, for every symbol and sector record, so a stored
// record reads clean at once and clears at its next refresh; and its direct
// read of constituents for the sector feed) and in /headlines'
// keepForHeadlines. Not in dedupeNews: several checks run that function in a
// sandbox without imports.
// Pure; scripts/check-news-junk.mjs measures it against real headlines.

export type JunkReason = "filing-notice" | "quote-page" | "foreign-listing";

const FILING_NOTICE = [
  /^\s*form\s+(3|4|5|144)(\/a)?\b/i,
  /\bform\s+(3|4|5|144)(\/a)?\b[^]*\bfor:\s/i,
  /^\s*(schedule|sc)\s*13[dg](\/a)?\b/i,
  /\b(schedule|sc)\s+13[dg](\/a)?\s*(filing|form)?\s*[:\-–—]/i,
];

const QUOTE_PAGE = [
  /\bhistorical (stock )?prices?\b/i,
  /\bstock price today\b/i,
  /\bstock quote\b/i,
  /\bprice history\b/i,
  /\bstock price\s*(&|and)\s*news\b/i,
  /\bshare price\s*(&|and)\s*(news|chart)\b/i,
];

/** Foreign venue suffixes (Yahoo/Reuters style) seen on depositary and cross listings. */
const FOREIGN_SUFFIX =
  "BK|L|IL|TO|V|CN|NE|DE|F|BE|DU|HM|MU|SG|HK|SS|SZ|T|KS|KQ|TW|TWO|AX|NZ|NS|BO|JK|SI|KL|SA|MX|BA|SN|PA|AS|BR|MI|MC|LS|SW|VI|ST|OL|CO|HE|IR|WA|PR|IS|JO|TA|ME";
const FOREIGN_LISTING = new RegExp(`\\(\\s*[A-Z0-9]{1,10}\\.(${FOREIGN_SUFFIX})\\s*\\)`);

/** Why a headline is not news, or null. `provider` exempts the SEC adapter's own filings. */
export function junkReason(title: string | null | undefined, provider?: string | null): JunkReason | null {
  const text = String(title ?? "").trim();
  if (!text) return null;
  if (provider !== "sec" && FILING_NOTICE.some((re) => re.test(text))) return "filing-notice";
  if (QUOTE_PAGE.some((re) => re.test(text))) return "quote-page";
  if (FOREIGN_LISTING.test(text)) return "foreign-listing";
  return null;
}

/** The filter form: keep an item that is news. */
export function isNotJunkNews(item: { title: string; provider?: string | null }): boolean {
  return junkReason(item.title, item.provider) === null;
}
