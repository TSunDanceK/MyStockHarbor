// Captures the FULL Google News feed per symbol, digested to the three fields a
// churn classifier could possibly read: publisher label, link domain, title.
//
// WHY THIS EXISTS. The preview showed 13 of 15 cards on /stock/MU/news were
// institutional-holding notices ("X Takes Position in Micron Technology"). The
// step-3 probes measured PRECISION -- is this item about MU -- and scored
// 96-100%. These pass that perfectly; they ARE about MU. Nothing measured
// whether an item was worth READING, so nothing caught it.
//
// So before writing a classifier, measure the thing. Two candidate rules are
// on the table -- a per-publisher cap and a headline-grammar match -- and the
// point of this dump is that the choice between them is made against real
// headlines rather than against the seven the owner happened to paste.
//
// IT DUMPS ONLY, like every probe here. No verdict is computed on the runner:
// every judgement is made offline against the committed fixture, so the
// measurement describes the shipped rule and not a second copy of it living on
// a CI runner where nobody reads it.
//
// WHY A RUNNER AT ALL. The agent sandbox is refused news.google.com with
// 403 CONNECT (re-tested 2026-09-13).
//
//   node scripts/churn-sample.mjs
const LOCALE = "hl=en-US&gl=US&ceid=US:en";
const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; news adapter evaluation)";

// MU is the reported case. The rest are chosen to make a FALSE POSITIVE
// visible, which a single-symbol sample cannot do:
//   BRK-B  -- a real "takes a stake in" story is genuine news when the filer is
//             Berkshire. If the grammar cannot tell that from a $668,000 filing
//             by a regional bank, that is worth knowing before shipping it.
//   CYRX   -- the measured thin name. The cap must not make its feed emptier.
//   JPM    -- heavily covered, heavily filed-on; the churn/real ratio should be
//             worst here if volume drives it.
const QUERIES = [
  ["MU", '"Micron Technology" stock'],
  ["BRK-B", '"Berkshire Hathaway" stock'],
  ["CYRX", '"CryoPort" stock'],
  ["JPM", '"JPMorgan Chase" stock'],
];

/** Google News wraps the real link; the host is still in the <link> text. */
function hostOf(link) {
  try {
    return new URL(link).host.replace(/^www\./, "");
  } catch {
    return "(unparseable)";
  }
}

const tag = (block, name) =>
  block.match(new RegExp(`<${name}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`))?.[1] ??
  block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ??
  "";

for (const [symbol, query] of QUERIES) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${LOCALE}`;
  console.log(`\n===== ${symbol} :: ${query}`);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    console.log(`===== HTTP ${res.status}`);
    if (!res.ok) continue;

    const xml = await res.text();
    const blocks = xml.split("<item>").slice(1);
    console.log(`===== items in feed: ${blocks.length}`);

    for (const raw of blocks) {
      const block = raw.split("</item>")[0];
      // ONE LINE PER ITEM, tab-separated, so the census in relay-capture can
      // verify it arrived intact and so nothing has to be re-flowed by hand.
      // The title keeps its " - Publisher" suffix: the adapter strips it, and a
      // classifier that reads the title has to be tested against what the
      // adapter actually hands it, both before and after stripping.
      const line = [
        symbol,
        tag(block, "source").trim(),
        hostOf(tag(block, "link").trim()),
        tag(block, "title").replace(/\s+/g, " ").trim(),
      ].join("\t");
      console.log(line);
    }
  } catch (err) {
    console.log(`===== FAILED: ${err.message}`);
  }
}
