// What Googlebot is served (#535 COWORK #21 §5): the SERVER RENDER only, no
// script run, with a Googlebot user-agent. Plus whether companyfacts exists for
// the curated ETFs that resolve to a CIK (why three /stock/<etf> render noindex).
// Read-only and uncredentialled.
const UA_SEC = process.env.SEC_USER_AGENT ?? "MyStockHarbor research contact@mystockharbor.com";
const GB = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const ETF = { SPY: 884394, QQQ: 1067839, DIA: 1041130, IBIT: 1980994, HODL: 1838028, GLD: 1222333, SLV: 1330568 };
for (const [s, cik] of Object.entries(ETF)) {
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "User-Agent": UA_SEC } });
  await res.arrayBuffer().catch(() => null);
  console.log(`companyfacts ${s}: HTTP ${res.status}`);
  await new Promise((r) => setTimeout(r, 200));
}
const paths = (process.env.SYMBOLS || "").trim()
  ? process.env.SYMBOLS.split(/\s+/)
  : ["/stock/AAPL", "/stock/AAPL/earnings", "/stock/NVDA/earnings", "/stock/COIN", "/stock/COIN/earnings", "/stock/CAVA/earnings", "/stock/ASML/earnings", "/stock/SPY", "/stock/QQQ", "/stock/DIA", "/stock/GLD", "/stock/LAZR/earnings", "/stock/WKHS/earnings"];
for (const p of paths) {
  try {
    const res = await fetch(`https://www.mystockharbor.com${p}`, { headers: { "User-Agent": GB, Accept: "text/html" }, redirect: "manual" });
    const html = await res.text();
    const robots = html.match(/<meta name="robots" content="([^"]+)"/)?.[1] ?? "(none)";
    const flags = [
      /Reading this company(&#x27;|')s SEC filings/.test(html) ? "READING" : null,
      /have not been read yet/.test(html) ? "NOT-YET-READ" : null,
      /No SEC company filings on file/.test(html) ? "NO-FILINGS" : null,
      /Earnings snapshot/.test(html) ? "snapshot-card" : null,
      /\$[0-9][0-9.,]*[BMK]\b/.test(html) ? "dollar-figures" : null,
      /Diluted EPS|EPS \(diluted\)/i.test(html) ? "eps" : null,
    ].filter(Boolean).join(",");
    console.log(`${p}: HTTP ${res.status} ${res.headers.get("x-vercel-cache") ?? ""} robots="${robots}" bytes=${html.length} [${flags}]`);
  } catch (e) {
    console.log(`${p}: ERROR ${e.message}`);
  }
}
