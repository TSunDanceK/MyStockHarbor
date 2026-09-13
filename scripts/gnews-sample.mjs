// Captures REAL Google News RSS, so the adapter's parser is tested against the
// feed's actual shape rather than against a hand-written approximation of it.
//
// WHY A RUNNER. The agent sandbox is refused news.google.com with 403 CONNECT
// (re-tested 2026-09-13) — the same policy that blocks nasdaqtrader.com and the
// production domain. The parser is the half of the adapter that has to be
// testable offline, and it cannot be tested honestly against invented XML: the
// " - Publisher" suffix, the <source> element and the guid format are exactly
// the details an invented fixture would get subtly wrong.
//
// IT DUMPS ONLY. Every judgement about the payload is made in
// scripts/check-gnews-adapter.mjs against the committed fixture.
//
//   node scripts/gnews-sample.mjs
const LOCALE = "hl=en-US&gl=US&ceid=US:en";
const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; news adapter evaluation)";

// MU is the measured well-covered case (98% precision, 95-day span).
// CYRX is the measured pathological one: 55 items spanning 3,453 days, one from
// 2017 — the reason the date filter is not optional.
const QUERIES = [
  ["MU", '"Micron Technology" stock'],
  ["CYRX", '"CryoPort" stock'],
];

const ITEMS_PER_QUERY = 14;

for (const [symbol, query] of QUERIES) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${LOCALE}`;
  console.log(`\n===== ${symbol} :: ${query}`);
  console.log(`===== ${url}`);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    console.log(`===== HTTP ${res.status} ${res.headers.get("content-type") ?? ""}`);
    if (!res.ok) continue;

    const xml = await res.text();
    const blocks = xml.split("<item>").slice(1);
    console.log(`===== items in feed: ${blocks.length}`);

    // Verbatim <item> blocks, so the fixture is the feed and not a paraphrase.
    for (const block of blocks.slice(0, ITEMS_PER_QUERY)) {
      console.log("<item>" + block.split("</item>")[0] + "</item>");
    }

    // The oldest date present, which is the figure the date filter exists for.
    const dates = blocks
      .map((b) => b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1])
      .filter(Boolean)
      .map((d) => Date.parse(d))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (dates.length) {
      const spanDays = Math.round((dates[dates.length - 1] - dates[0]) / 86_400_000);
      console.log(`===== span: ${spanDays} days · oldest ${new Date(dates[0]).toISOString().slice(0, 10)} · newest ${new Date(dates[dates.length - 1]).toISOString().slice(0, 10)}`);
    }
  } catch (err) {
    console.log(`===== FAILED: ${err.message}`);
  }
}
console.log("\n[gnews-sample] done");
