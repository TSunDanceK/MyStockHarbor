// How much of a symbol's REAL pool does its anchored short-name needle admit,
// and how much of that is actually about the company?
//
//   relay task "anchor-collisions"   (read-only job; no credentials referenced)
//
// ── THE QUESTION, AND WHY IT CANNOT BE ANSWERED IN THE SANDBOX ────────────
// anchoredNameSignal gives the 55 short-named symbols a match path they did not
// have. Five of those needles also fire on generic finance copy:
//
//   DOW  \bDow\b  "Dow Jones Industrial Average closes higher as tech leads"
//   T    \bAT\b   "Stocks climb; Nasdaq AT RECORD HIGH"
//   NOV  \bNOV\b  "EARNINGS DUE NOV 15 FOR RETAIL"
//   BOX  \bBox\b  "Box office revenue hits a record for the summer"
//   RH   \bRH\b   (clean in the corpus below; carried as a control)
//
// Measured against the 219 real headlines committed to this repo
// (scripts/fixtures/churn-sample.tsv + eventtype-gnews.jsonl), which are OTHER
// symbols' pools and so measure exposure to off-topic text:
//
//   DOW  2 admits, BOTH index stories ("Is Humana Stock Outperforming the Dow?")
//   T, NOV, BOX, RH  0 admits
//
// That corroborates DOW as a dominant collision rather than a tail one. It does
// NOT clear the other four: a corpus of other symbols' news is weak evidence of
// what a symbol's OWN pool contains, and absence there is not absence.
//
// THE DECIDING NUMBER IS PER-SYMBOL: of the items Google News returns for THIS
// company, how many does the anchor admit, and how many of those are the
// company rather than the index, the month or the noun. news.google.com is
// refused from the agent sandbox (403 CONNECT); a runner reaches it.
//
// ── IT PRINTS. IT DOES NOT DECIDE. ───────────────────────────────────────
// Every admitted headline is printed in full so a human can classify it. This
// script deliberately does not guess which are on-topic: that judgement is the
// measurement, and a heuristic grading its own anchor would only agree with
// itself (claude/traps/two-validators-for-one-value.md).
// A MIRROR, because the read-only relay job deliberately runs no `npm ci` and
// so has no TypeScript to load the real function with. The duplication is
// asserted away in scripts/check-news-relevance-scope.mjs: the two must produce
// identical patterns for every name measured below.
import { anchoredNameSignalMirror as anchoredNameSignal } from "./lib/anchored-name-signal.mjs";

const LOCALE = "hl=en-US&gl=US&ceid=US:en";
const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; anchor collision measurement)";

// ── ROUND 2: THE SIX CAPITALISED-WORD NEEDLES, plus two all-caps controls ──
// Round 1 (relay run 77, 700 items) measured DOW/T/NOV/BOX/RH + CSX/RTX and the
// answer split cleanly on the SHAPE OF THE NEEDLE rather than on the symbol:
//
//   needle         marginal admits   of which off-topic
//   \bDow\b   (Cap)       59                55   93% wrong
//   \bBox\b   (Cap)       56                17   30% wrong
//   \bAT\b    (CAPS)      38                 0
//   \bNOV\b   (CAPS)      47                 1   (Novatti, ASX:NOV)
//   \bRH\b    (CAPS)      52                 0
//   \bCSX\b   (CAPS)      50                 0
//   \bRTX\b   (CAPS)      46                 4   (Nvidia's GPU line)
//
// "Marginal" is the load-bearing word: those are the items the anchor adds ON
// TOP of the explicit ticker signals that already shipped, measured by running
// the real isClearlyAboutRequestedCompany twice with the anchor guard switched
// off in one copy. DOW's raw 85 admits looked bad; its marginal 59 is the number
// that matters, because 26 of the 85 matched "dow stock"/"(dow)" regardless.
//
// Against the committed snapshot, exactly SIX of the 66 fallback-only names
// produce a capitalised-word needle, so round 2 measured all of them.
//
// ── WHAT ROUND 2 RETURNED (relay run 78), AND WHAT IT KILLED ─────────────
// Marginal precision, publisher suffix stripped first as the adapter strips it:
//
//   \bAon\b 100%   \bFox\b 92%   \bGap\b 70%   \bBox\b 68%   \bDow\b 10%
//
// The "a capitalised-word needle is the dirty shape" hypothesis round 1
// suggested is FALSE: Aon is perfect and Fox beats RTX. DOW is not on a
// continuum with the rest, and the reason is specific rather than orthographic
// — "Dow" is the everyday name of a market INDEX, so it appears in copy about
// no company at all. INDEX_TOKENS in lib/stock-news-data.ts is that finding;
// Box and Gap ship as measured, with their numbers recorded there.
//
// A DEFECT THIS PROBE HAS, found while reading round 2's output: it does not
// call stripPublisherSuffix, which gnewsProvider applies before an item is ever
// stored. Nine of FOX's apparent collisions were the string " - Fox Business"
// appended to headlines about other companies — items production never sees in
// that form. Printing raw titles is deliberate, so the classifier sees what the
// feed actually returned; but anything COUNTED off this output must strip first
// or it will invent collisions for any company sharing a name with a publisher.
//
// The subjects, unchanged so a re-run is comparable:
const SUBJECTS = [
  ["AON", "Aon plc", '"Aon" stock'],
  ["BOX", "Box, Inc.", '"Box" stock'],
  ["DOW", "Dow Inc.", '"Dow" stock'],
  ["FOX", "Fox Corporation", '"Fox" stock'],
  ["GAP", "Gap, Inc.", '"Gap" stock'],
  // Two ALL-CAPS controls carried over from round 1. If the capitalised six are
  // dirty and these two stay clean, the cut is the needle's case, not the name.
  ["CSX", "CSX Corporation", '"CSX" stock'],
  ["RTX", "RTX Corporation", '"RTX" stock'],
];

const strip = (v) =>
  v.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();

let totalPool = 0;
for (const [symbol, name, query] of SUBJECTS) {
  const needle = anchoredNameSignal(name);
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${LOCALE}`;
  console.log(`\n===== ${symbol}  name=${JSON.stringify(name)}  needle=${String(needle)}`);
  console.log(`===== ${query}`);

  let xml = "";
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    console.log(`===== HTTP ${res.status}`);
    if (!res.ok) continue;
    xml = await res.text();
  } catch (err) {
    console.log(`===== FETCH FAILED: ${String(err)}`);
    continue;
  }

  const titles = xml.split("<item>").slice(1)
    .map((b) => strip((b.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? ""))
    .filter(Boolean);
  totalPool += titles.length;

  if (!needle) { console.log(`  NO NEEDLE — this name is long enough for a substring variant`); continue; }
  const admitted = titles.filter((t) => needle.test(t));
  console.log(`  pool=${titles.length}  admitted=${admitted.length}  (${titles.length ? (100 * admitted.length / titles.length).toFixed(0) : "0"}%)`);
  console.log(`  --- every admitted headline, for classification ---`);
  for (const t of admitted) console.log(`   · ${t}`);
  const rejected = titles.filter((t) => !needle.test(t));
  console.log(`  --- first 5 REJECTED, so a needle that is too tight is visible too ---`);
  for (const t of rejected.slice(0, 5)) console.log(`   x ${t}`);
}

// MEASURING-NOTHING GUARD. Every symbol returning an empty pool reads exactly
// like "the anchor admits nothing", which is the opposite conclusion.
if (totalPool < 20) {
  console.error(`\nFATAL: total pool across all queries was ${totalPool}. Google News returned ` +
    `nothing usable, so every count above is an artefact rather than a measurement.`);
  process.exit(1);
}
console.log(`\n[anchor] total pool across ${SUBJECTS.length} queries: ${totalPool}`);
