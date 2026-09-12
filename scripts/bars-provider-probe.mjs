// Which bars providers can a runner actually reach, and what do their free tiers
// return? Probed UNAUTHENTICATED first, deliberately.
//
// WHY UNAUTHENTICATED IS THE RIGHT FIRST QUESTION. Every candidate needs a signup,
// and asking the owner for three keys before knowing which hosts are even
// reachable would spend their time on a question this run answers for free. The
// distinction that matters needs no credential:
//
//   401/403 WITH A JSON BODY  -> reachable, needs a key. GREEN.
//   a challenge / HTML page   -> the Stooq outcome. RED.
//
// Those look identical in a status code and opposite in consequence, which is why
// the body is classified rather than the status.
//
// WHAT STOOQ TAUGHT, APPLIED HERE. The parser is strict about content type before
// it believes anything, because a 200 carrying HTML is not data and parsing it as
// data is what put wrong numbers on this site once. And no attempt is made to look
// like a browser: the User-Agent is honest and identifying on every request.
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = process.argv[2] || ".";
const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; provider evaluation)";

const CHALLENGE_MARKERS = [
  "requires JavaScript to verify your browser",
  "Checking your browser",
  "cf-browser-verification",
  "Just a moment",
];

// Keys are read from the environment if present, so the same script upgrades from
// "is it reachable" to "what does it return" without being rewritten. Absent keys
// are the expected case on this run and are NOT an error.
const KEYS = {
  tiingo: process.env.TIINGO_API_KEY ?? "",
  alpacaId: process.env.ALPACA_API_KEY_ID ?? "",
  alpacaSecret: process.env.ALPACA_API_SECRET_KEY ?? "",
  marketstack: process.env.MARKETSTACK_API_KEY ?? "",
};

const TARGETS = [
  {
    provider: "Tiingo",
    label: "daily prices (AAPL)",
    url: "https://api.tiingo.com/tiingo/daily/aapl/prices?startDate=2021-01-01",
    headers: () => (KEYS.tiingo ? { Authorization: `Token ${KEYS.tiingo}` } : {}),
    keyed: Boolean(KEYS.tiingo),
    spelling: "lowercase bare ticker in the path; class shares documented as e.g. brk-b",
  },
  {
    provider: "Alpaca",
    label: "daily bars (AAPL, IEX feed)",
    url: "https://data.alpaca.markets/v2/stocks/AAPL/bars?timeframe=1Day&start=2021-01-01&feed=iex&limit=100",
    headers: () =>
      KEYS.alpacaId && KEYS.alpacaSecret
        ? { "APCA-API-KEY-ID": KEYS.alpacaId, "APCA-API-SECRET-KEY": KEYS.alpacaSecret }
        : {},
    keyed: Boolean(KEYS.alpacaId && KEYS.alpacaSecret),
    spelling: "UPPERCASE bare ticker in the path; class shares as BRK.B",
  },
  {
    provider: "marketstack",
    label: "end-of-day (AAPL)",
    // HTTPS even though the free tier is documented as HTTP-only: if it refuses
    // TLS that is itself a finding worth having, and sending an API key over
    // plaintext later would not be acceptable anyway.
    url: "https://api.marketstack.com/v1/eod?symbols=AAPL&limit=100",
    headers: () => ({}),
    keyed: Boolean(KEYS.marketstack),
    query: () => (KEYS.marketstack ? `&access_key=${encodeURIComponent(KEYS.marketstack)}` : ""),
    spelling: "UPPERCASE bare ticker in a symbols= param",
  },
];

const classify = (status, contentType, bodyHead, isJson) => {
  if (CHALLENGE_MARKERS.some((m) => bodyHead.includes(m))) return "RED — browser challenge";
  if (/^\s*<(!doctype|html)/i.test(bodyHead)) return "RED — HTML, not an API response";
  if (isJson && (status === 401 || status === 403))
    return "GREEN — reachable, needs a key (JSON error body)";
  if (isJson && status === 200) return "GREEN — reachable, returned data";
  if (isJson) return `AMBER — JSON but HTTP ${status}`;
  return `AMBER — ${contentType || "no content-type"} at HTTP ${status}`;
};

console.log("BARS PROVIDER PROBE — reachability first, credentials second");
console.log(`User-Agent: ${UA}`);
console.log(
  `keys present: tiingo=${KEYS.tiingo ? "yes" : "no"} · alpaca=${
    KEYS.alpacaId && KEYS.alpacaSecret ? "yes" : "no"
  } · marketstack=${KEYS.marketstack ? "yes" : "no"}`
);
console.log("An absent key is the EXPECTED case on this run, not a failure.\n");

const results = [];
for (const t of TARGETS) {
  const url = t.url + (t.query ? t.query() : "");
  console.log(`── ${t.provider}: ${t.label}`);
  console.log(`   ${url.replace(/access_key=[^&]+/, "access_key=REDACTED")}`);
  const row = { provider: t.provider, label: t.label, keyed: t.keyed, spellingDoc: t.spelling };
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, ...t.headers() } });
    const ct = res.headers.get("content-type") ?? "";
    const text = await res.text();
    const head = text.slice(0, 300).replace(/\s+/g, " ");
    const isJson = ct.includes("json") || /^\s*[[{]/.test(text);
    row.status = res.status;
    row.contentType = ct;
    row.bytes = text.length;
    row.head = head.slice(0, 200);
    row.verdict = classify(res.status, ct, head, isJson);
    console.log(`   HTTP ${res.status} · ${ct || "no content-type"} · ${text.length} bytes`);
    console.log(`   >>> ${row.verdict}`);
    console.log(`   head: ${row.head}`);

    // ONLY IF REAL DATA CAME BACK. With no key this is not expected, and saying so
    // is better than an empty "depth: unknown" row that reads like a measurement.
    if (isJson && res.status === 200) {
      try {
        const data = JSON.parse(text);
        const rows = Array.isArray(data) ? data : (data?.bars ?? data?.data ?? null);
        if (Array.isArray(rows) && rows.length) {
          const first = rows[0];
          const last = rows[rows.length - 1];
          const dateOf = (r) => r?.date ?? r?.t ?? r?.timestamp ?? null;
          row.barCount = rows.length;
          row.firstDate = dateOf(first);
          row.lastDate = dateOf(last);
          // HIGH AND LOW MATTER, not just close: the bull-flag and
          // descending-triangle builders read them, so a close-only feed would
          // silently disable two pickers.
          row.hasHigh = ["high", "h", "adjHigh"].some((k) => first?.[k] != null);
          row.hasLow = ["low", "l", "adjLow"].some((k) => first?.[k] != null);
          row.hasAdjusted = ["adjClose", "adjusted_close"].some((k) => first?.[k] != null);
          row.fields = Object.keys(first).slice(0, 20);
          console.log(
            `   bars ${rows.length} · ${row.firstDate} .. ${row.lastDate} · ` +
              `high=${row.hasHigh} low=${row.hasLow} adjClose=${row.hasAdjusted}`
          );
        }
      } catch {
        row.parseNote = "200 JSON that did not parse into a bar array";
      }
    }
  } catch (e) {
    row.error = String(e?.message ?? e);
    row.verdict = `RED — request failed: ${row.error}`;
    console.log(`   >>> ${row.verdict}`);
  }
  console.log("");
  results.push(row);
  await new Promise((r) => setTimeout(r, 500));
}

console.log("══ SUMMARY ══");
for (const r of results) {
  console.log(`  ${r.provider.padEnd(12)} ${r.verdict}`);
}
const green = results.filter((r) => r.verdict?.startsWith("GREEN"));
console.log(`\n  reachable: ${green.length} of ${results.length}`);

// ── THE PART THE STATUS CODES DO NOT SAY ─────────────────────────────────────
// Reachability is a technical question and it is the ONLY one this probe answers.
// Presenting a green row as "we can use this" would be the more expensive error,
// so the licensing position is printed alongside the result rather than left for
// someone to discover after building an ingest against it.
console.log(`
  LICENSING — NOT ANSWERED BY ANY STATUS CODE ABOVE:

  Tiingo, Alpaca and marketstack free and personal tiers are INTERNAL-USE. That is
  the same restriction FMP raised, and it is the reason a $20,000 quote exists at
  all. A free tier is fine for PROBING FIDELITY against the frozen dump; it is not
  a licence to serve bars on a public website.

  So a GREEN row here means "we can measure this provider's data quality today",
  NOT "we can ship it on Monday". The cheapest properly-licensed DISPLAY path
  identified so far is Tiingo's EOD+IEX Redistribution Business tier at about
  $250/month. Verify current terms and pricing with the vendor before committing --
  that figure is from research, not from this run, and this run cannot check it.

  The bars decision is therefore COMMERCIAL AND LICENSING, not technical.`);

const outPath = path.join(OUT_DIR, "BARS-PROVIDER-PROBE.json");
fs.writeFileSync(
  outPath,
  JSON.stringify({ probedAt: new Date().toISOString(), userAgent: UA, results }, null, 2)
);
console.log(`\nwrote ${path.relative(process.cwd(), outPath)}`);
