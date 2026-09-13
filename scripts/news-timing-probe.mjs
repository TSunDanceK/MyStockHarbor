// How long each free adapter actually takes, cold, against the real hosts.
//
// WHY A RUNNER. The agent sandbox is refused news.google.com, globenewswire.com
// and prnewswire.com. data.sec.gov is reachable from a runner. Nothing about
// adapter latency can be measured from inside the sandbox, and a guessed
// timeout budget is exactly what the owner asked not to receive.
//
// WHAT THIS IS NOT. A runner is not iad1 and carries no Vercel Data Cache, so
// these are COLD, UNCACHED upstream times — the worst case the render can hit,
// which is the number a timeout budget should be set from. Total render time
// and the news share of it cannot be measured here; that needs MSH_TIMING on a
// real deployment.
//
// SERIAL AND PARALLEL ARE BOTH TIMED, because the question "is the sum or the
// max what the page waits for" is worth answering with the real numbers rather
// than from the shape of the code.
//
//   node scripts/news-timing-probe.mjs
const LOCALE = "hl=en-US&gl=US&ceid=US:en";
const UA = process.env.PROBE_USER_AGENT ?? "MyStockHarbor/1.0 (+https://www.mystockharbor.com; latency probe)";
const SEC_UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (contact@mystockharbor.com)";

const SOURCES = {
  gnews: (sym, q) => [`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${LOCALE}`, { "user-agent": UA }],
  globenewswire: () => ["https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire---Public-Companies", { "user-agent": UA }],
  prnewswire: () => ["https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss", { "user-agent": UA }],
  sec: (sym, q, cik) => [`https://data.sec.gov/submissions/CIK${cik}.json`, { "user-agent": SEC_UA, accept: "application/json" }],
};

// CIKs from data/cik-map.json, hardcoded so the probe needs no repo read.
//
// BOTH SYMBOLS ARE IN THE CIK MAP, and that took two tries: CYRX and PLAB, the
// obvious thin-coverage cases, are NOT in it. The SEC leg would have
// short-circuited to [] with no request at all, and the "sec is fast" reading
// would have been measuring an early return.
const CASES = [
  ["MU", '"Micron Technology" stock', "0000723125"],
  ["JPM", '"JPMorgan Chase" stock', "0000019617"],
];

async function time(name, url, headers) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers });
    const body = await res.text();
    return { name, ms: Date.now() - t0, status: res.status, bytes: body.length };
  } catch (err) {
    return { name, ms: Date.now() - t0, status: "ERR", bytes: 0, error: err.message };
  }
}

const ROUNDS = 3;
for (const [sym, query, cik] of CASES) {
  console.log(`\n===== ${sym}`);
  for (let round = 1; round <= ROUNDS; round += 1) {
    const jobs = Object.entries(SOURCES).map(([name, build]) => {
      const [url, headers] = build(sym, query, cik);
      return () => time(name, url, headers);
    });

    // PARALLEL: what the page waits for today (Promise.all across adapters).
    const p0 = Date.now();
    const par = await Promise.all(jobs.map((j) => j()));
    const parTotal = Date.now() - p0;

    // SERIAL: the sum, for comparison.
    const s0 = Date.now();
    const ser = [];
    for (const j of jobs) ser.push(await j());
    const serTotal = Date.now() - s0;

    console.log(
      `  round ${round}  parallel=${parTotal}ms  serial=${serTotal}ms  | ` +
        par.map((r) => `${r.name}=${r.ms}ms(${r.status},${r.bytes}B)`).join(" ")
    );
    console.log(
      `            serial legs: ` + ser.map((r) => `${r.name}=${r.ms}ms`).join(" ")
    );
  }
}
