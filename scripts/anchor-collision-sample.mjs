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

// THE FIVE THAT FIRE, plus two controls. CSX and RTX are clean acronym cases
// with no plausible English collision — if the anchor admits most of their pool
// and almost none of DOW's is on-topic, the shape of the answer is not "the
// anchored rule is wrong" but "these five need more than the anchor".
const SUBJECTS = [
  ["DOW", "Dow Inc.", '"Dow" stock'],
  ["T", "AT&T Inc.", '"AT&T" stock'],
  ["NOV", "NOV Inc.", '"NOV" stock'],
  ["BOX", "Box, Inc.", '"Box" stock'],
  ["RH", "RH", '"RH" stock'],
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
