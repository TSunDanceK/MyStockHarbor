// Dumps REAL Nasdaq Trader display names, so the news company-name normaliser can
// be tested against the universe rather than against names someone made up.
//
// WHY THIS NEEDS A RUNNER. The agent sandbox's egress policy refuses
// www.nasdaqtrader.com with 403 CONNECT (re-tested 2026-09-13T10:42Z — a policy
// denial, same class as the vercel.app and production hosts). That directory is
// where lib/stock-news-data.ts's fetchCompanyName reads the name it hands the
// news path, RAW and uncleaned, so it is the only honest source for a fixture.
//
// IT DUMPS ONLY. No normalising happens here on purpose: the sample is committed
// as data and every judgement about it is made in
// scripts/check-company-name.mjs, where it can be re-run offline and argued with.
// A probe that both produces the data and grades it can only ever agree with
// itself (claude/traps/two-validators-for-one-value.md).
//
//   node scripts/company-name-sample.mjs [outDir]
const NASDAQ_LISTED = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt";
const OTHER_LISTED = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt";

const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; company-name fixture)";

// The symbols this site actually publishes on, taken from content/insights/.
// THE POINT OF NAMING THEM: a fixture drawn only from a systematic sample would
// be representative of the directory, not of the universe this normaliser will
// actually be asked about.
const COVERED = (
  "AAL AAPL ACHR AMZN ASTS AVAV AVGO BA BABA BBAI CELH CHWY CLSK COIN COST CVNA " +
  "CVX DIS DKNG EA GEV GME HUM INTC IONQ ISRG MARA META MRVL MSFT MSTR MU NIO " +
  "NKE NOC NOW NVDA ONDS ORCL PFE PLTR QBTS QS RCL RGTI RIOT SOFI SOUN TMUS " +
  "TSLA TXN UHS VRT VZ WFC ZS"
).split(/\s+/);

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const text = await res.text();
  // A 200 carrying HTML is not data. Stooq taught this one.
  if (/^\s*</.test(text)) throw new Error(`${url} -> looks like HTML, not a pipe file`);
  return text;
}

function rows(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("Symbol|") || trimmed.startsWith("ACT Symbol|")) continue;
    if (trimmed.startsWith("File Creation Time")) continue;
    const cols = trimmed.split("|");
    if (cols.length < 2) continue;
    const symbol = (cols[0] || "").trim();
    const name = (cols[1] || "").trim();
    if (symbol && name) out.push([symbol, name]);
  }
  return out;
}

const [nasdaqTxt, otherTxt] = await Promise.all([fetchText(NASDAQ_LISTED), fetchText(OTHER_LISTED)]);
const all = [...rows(nasdaqTxt), ...rows(otherTxt)];
console.log(`[sample] directory rows: ${all.length}`);

const bySymbol = new Map();
for (const [symbol, name] of all) if (!bySymbol.has(symbol)) bySymbol.set(symbol, name);

console.log("\n----- COVERED (symbols this site publishes on) -----");
const missing = [];
for (const symbol of COVERED) {
  const name = bySymbol.get(symbol);
  if (name) console.log(`${symbol}|${name}`);
  else missing.push(symbol);
}
if (missing.length) console.log(`[sample] not in directory: ${missing.join(", ")}`);

// EVERY Nth ROW, NOT A RANDOM SAMPLE. Deterministic, so a re-run of this probe is
// comparable with the last one, and spread across the whole file so the awkward
// shapes (ADRs, plc, N.V., S.A., funds, trusts) turn up on their own rather than
// being hand-picked to make the normaliser look good.
const STRIDE = 131;
console.log(`\n----- SYSTEMATIC (every ${STRIDE}th row of ${all.length}) -----`);
for (let i = 0; i < all.length; i += STRIDE) console.log(`${all[i][0]}|${all[i][1]}`);

console.log("\n[sample] done");
