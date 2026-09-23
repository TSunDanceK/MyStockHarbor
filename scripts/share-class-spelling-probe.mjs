// WHICH SPELLING OF A SHARE CLASS DOES EACH QUOTE VENDOR ACCEPT?
//
// WHY THIS RUNS ON A RUNNER AND NOT IN THE SANDBOX. The agent sandbox answers
// 403 CONNECT for stooq.com and query1.finance.yahoo.com alike, so the question
// "does Yahoo want BRK.B or BRK-B" cannot be asked from there at all. It can be
// asked here, and the answer decides whether lib/stock-news-data.ts converts on
// the Yahoo leg. Converting without it would be a guess dressed as a fix: the
// dot spelling is what the page asks for today, and if Yahoo is the vendor that
// already accepts it, a conversion would BREAK the one leg that works.
//
// THE CONTROL IS THE POINT. Each vendor is asked three things, not one:
//
//   AAPL    a symbol with no share class at all. If this fails, the vendor is
//           down or blocked and the two BRK answers mean nothing. Every
//           conclusion below is gated on it.
//   BRK.B   the dotted spelling -- what the app sends today, unconverted.
//   BRK-B   the dashed spelling -- what toDashed would send.
//
// A vendor that accepts both needs no conversion. A vendor that accepts exactly
// one tells us which way to convert. A vendor that accepts neither, with AAPL
// green, is a vendor with no Berkshire B at all, which is a different finding
// and must not be read as a spelling result.
//
// WHAT COUNTS AS ACCEPTED, AND WHY IT IS NOT THE STATUS CODE. Yahoo answers an
// unknown symbol with HTTP 404 and a JSON error, but it also answers a KNOWN
// symbol whose range is empty with HTTP 200 and a result carrying no price. A
// status-only classifier calls the second one a pass. So acceptance here means
// A PRICE CAME BACK -- the same test the shipped code applies (finite and
// strictly greater than zero, because Stooq is known to serve a literal 0) --
// and the price is printed so the reader can check it against the real quote
// rather than trusting a boolean.
//
// STOOQ IS PROBED TOO, THOUGH IT IS NOT A SPELLING QUESTION. The proposal to
// delete the Stooq leg rests on claude/stooq-inaccessible-sec-viable-2026-09-12.md,
// which is ten days old. A removal argued from a stale measurement is the same
// error as a conversion argued from none, so both Stooq endpoints are re-asked
// here and the proposal stands on today's answer or not at all.
//
// TIINGO IS ASKED AND IS EXPECTED TO ANSWER NOTHING. It appears in no shipped
// module -- scripts/bars-provider-probe.mjs evaluated it and it was declined on
// 2026-09-12 -- and the relay holds no TIINGO_API_KEY, so both spellings will
// return the same 401. That is recorded as NO EVIDENCE rather than skipped,
// because "we asked and could not tell" and "we did not ask" are different
// facts and only one of them is honest about a request that was made.
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = process.argv[2] || ".";

// Honest and identifying on every request that does not need otherwise. The one
// exception is the Yahoo leg, which is sent the SHIPPED browser User-Agent
// deliberately -- see YAHOO_UA below.
const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; share-class spelling probe)";

// COPIED FROM lib/stock-news-data.ts ON PURPOSE. The shipped Yahoo leg sends a
// desktop-browser User-Agent because Yahoo answers 429 to bare ones, and a probe
// that sent a different UA would be measuring a different endpoint's mood. If
// the shipped constant changes, this should change with it.
const YAHOO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CHALLENGE_MARKERS = [
  "requires JavaScript to verify your browser",
  "Checking your browser",
  "cf-browser-verification",
  "Just a moment",
];

const SYMBOLS = [
  { label: "AAPL", spelling: "control", value: "AAPL" },
  { label: "BRK.B", spelling: "dotted", value: "BRK.B" },
  { label: "BRK-B", spelling: "dashed", value: "BRK-B" },
];

const finitePositive = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;

// ── The vendors ────────────────────────────────────────────────────────────
// Each returns { price, note }. price === null means "no price came back", and
// note carries why, so a 404 and an empty-but-200 read differently in the table.

// Yahoo's v8 chart endpoint, called exactly as lib/stock-news-data.ts calls it:
// same path, same encodeURIComponent, same interval, same range, same headers.
// fetchYahooQuote reads meta.regularMarketPrice, so that is what is read here.
async function probeYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: { "User-Agent": YAHOO_UA, accept: "application/json" },
  });
  const text = await res.text();
  if (CHALLENGE_MARKERS.some((m) => text.includes(m))) {
    return { url, status: res.status, price: null, note: "browser challenge" };
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      url,
      status: res.status,
      price: null,
      note: `non-JSON body (${text.slice(0, 60).replace(/\s+/g, " ")})`,
    };
  }
  const err = json?.chart?.error;
  if (err) {
    return { url, status: res.status, price: null, note: `error: ${err.code ?? ""} ${err.description ?? ""}`.trim() };
  }
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) return { url, status: res.status, price: null, note: "no result[0].meta" };
  const price = meta.regularMarketPrice;
  return finitePositive(price)
    ? { url, status: res.status, price, note: `meta.symbol=${meta.symbol ?? "?"}` }
    : { url, status: res.status, price: null, note: `meta present, regularMarketPrice=${JSON.stringify(price)}` };
}

// Stooq's quote CSV, called as fetchStooqQuote calls it: lowercased, ".us"
// appended, field 4 (index 3) of line 2.
async function probeStooqQuote(symbol) {
  const url = `https://stooq.com/q/l/?s=${symbol.toLowerCase()}.us&f=sd2t2l&h&e=csv`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const text = await res.text();
  if (CHALLENGE_MARKERS.some((m) => text.includes(m))) {
    return { url, status: res.status, price: null, note: "browser challenge (not data)" };
  }
  const lines = text.trim().split("\n");
  if (lines.length < 2) {
    return { url, status: res.status, price: null, note: `${lines.length} line(s) of CSV` };
  }
  const price = Number(lines[1].split(",")[3] ?? "");
  return finitePositive(price)
    ? { url, status: res.status, price, note: lines[1].trim() }
    : { url, status: res.status, price: null, note: `row: ${lines[1].trim().slice(0, 60)}` };
}

// Stooq's daily history CSV, as fetchStooqHistory calls it. "A price came back"
// here means at least one parseable close, since history is a series.
async function probeStooqHistory(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}.us&i=d`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const text = await res.text();
  if (CHALLENGE_MARKERS.some((m) => text.includes(m))) {
    return { url, status: res.status, price: null, note: "browser challenge (not data)" };
  }
  const lines = text.trim().split("\n");
  const last = lines[lines.length - 1] ?? "";
  const close = Number(last.split(",")[4] ?? "");
  return finitePositive(close)
    ? { url, status: res.status, price: close, note: `${lines.length - 1} rows, last: ${last.trim()}` }
    : { url, status: res.status, price: null, note: `${lines.length} line(s), last: ${last.trim().slice(0, 60)}` };
}

// Tiingo, unauthenticated. Expected to be uninformative -- see the header.
const TIINGO_KEY = process.env.TIINGO_API_KEY ?? "";
const tiingoHeaders = () =>
  TIINGO_KEY
    ? { "User-Agent": UA, accept: "application/json", Authorization: `Token ${TIINGO_KEY}` }
    : { "User-Agent": UA, accept: "application/json" };

async function probeTiingoQuote(symbol) {
  const url = `https://api.tiingo.com/iex/${encodeURIComponent(symbol.toLowerCase())}`;
  const res = await fetch(url, { headers: tiingoHeaders() });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    return { url, status: res.status, price: null, note: "needs a key — NO EVIDENCE about spelling" };
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    return { url, status: res.status, price: null, note: `non-JSON (${text.slice(0, 60)})` };
  }
  const row = Array.isArray(json) ? json[0] : json;
  const price = row?.last ?? row?.tngoLast ?? row?.prevClose;
  return finitePositive(price)
    ? { url, status: res.status, price, note: `ticker=${row?.ticker ?? "?"}` }
    : { url, status: res.status, price: null, note: JSON.stringify(json).slice(0, 80) };
}

async function probeTiingoHistory(symbol) {
  const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(
    symbol.toLowerCase()
  )}/prices`;
  const res = await fetch(url, { headers: tiingoHeaders() });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    return { url, status: res.status, price: null, note: "needs a key — NO EVIDENCE about spelling" };
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    return { url, status: res.status, price: null, note: `non-JSON (${text.slice(0, 60)})` };
  }
  const row = Array.isArray(json) ? json[json.length - 1] : null;
  const price = row?.close;
  return finitePositive(price)
    ? { url, status: res.status, price, note: `${json.length} rows, last date ${row?.date ?? "?"}` }
    : { url, status: res.status, price: null, note: JSON.stringify(json).slice(0, 80) };
}

const LEGS = [
  { vendor: "Yahoo", endpoint: "v8 chart (quote AND history — one endpoint)", run: probeYahoo, shipped: true },
  { vendor: "Stooq", endpoint: "quote CSV (/q/l/)", run: probeStooqQuote, shipped: true },
  { vendor: "Stooq", endpoint: "history CSV (/q/d/l/)", run: probeStooqHistory, shipped: true },
  { vendor: "Tiingo", endpoint: "IEX quote (/iex/)", run: probeTiingoQuote, shipped: false },
  { vendor: "Tiingo", endpoint: "daily history (/tiingo/daily/)", run: probeTiingoHistory, shipped: false },
];

console.log("SHARE-CLASS SPELLING PROBE — BRK.B vs BRK-B, with AAPL as the control");
console.log(`User-Agent (non-Yahoo legs): ${UA}`);
console.log(`Tiingo key present: ${TIINGO_KEY ? "yes" : "no (expected — the relay holds none)"}`);
console.log(
  "FMP is NOT probed: it needs FMP_API_KEY, which the read-only relay job\n" +
    "deliberately does not hold. Its dashed spelling is already evidenced by\n" +
    "buildFmpSymbol and by phase0-adjustment-probe.mjs's measured screener rows.\n"
);

const rows = [];
for (const leg of LEGS) {
  console.log(`── ${leg.vendor} · ${leg.endpoint}${leg.shipped ? "" : "  (not shipped)"}`);
  for (const sym of SYMBOLS) {
    let out;
    try {
      out = await leg.run(sym.value);
    } catch (err) {
      out = { url: "", status: 0, price: null, note: `threw: ${err?.message ?? err}` };
    }
    const verdict = out.price == null ? "no price" : `PRICE ${out.price}`;
    console.log(`   ${sym.label.padEnd(6)} (${sym.spelling.padEnd(7)}) HTTP ${String(out.status).padEnd(3)} ${verdict}`);
    console.log(`          ${out.note}`);
    rows.push({
      vendor: leg.vendor,
      endpoint: leg.endpoint,
      shipped: leg.shipped,
      symbol: sym.value,
      spelling: sym.spelling,
      status: out.status,
      price: out.price,
      note: out.note,
    });
    // Courtesy spacing. These are public endpoints being asked three questions
    // each; there is no reason to ask them back to back.
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log("");
}

// ── The conclusion, stated per vendor and GATED ON THE CONTROL ─────────────
// Written out rather than left to the reader, because the whole point of the
// run is a decision: convert, or do not.
console.log("── VERDICTS ────────────────────────────────────────────────────");
const verdicts = [];
for (const leg of LEGS) {
  const mine = rows.filter((r) => r.vendor === leg.vendor && r.endpoint === leg.endpoint);
  const ctl = mine.find((r) => r.spelling === "control");
  const dot = mine.find((r) => r.spelling === "dotted");
  const dash = mine.find((r) => r.spelling === "dashed");
  let verdict;
  if (ctl?.price == null) {
    verdict =
      "NO EVIDENCE — the AAPL control returned no price, so this vendor is down, " +
      "blocked or unauthenticated here and its BRK answers say nothing about spelling.";
  } else if (dot?.price != null && dash?.price != null) {
    verdict = "ACCEPTS BOTH — no conversion needed on this leg.";
  } else if (dash?.price != null) {
    verdict = "WANTS THE DASH — convert with toDashed before calling.";
  } else if (dot?.price != null) {
    verdict = "WANTS THE DOT — do NOT convert; converting would break this leg.";
  } else {
    verdict =
      "ACCEPTS NEITHER — the control works, so this vendor simply has no " +
      "Berkshire B row. Not a spelling result.";
  }
  console.log(`${leg.vendor} · ${leg.endpoint}`);
  console.log(`   ${verdict}\n`);
  verdicts.push({ vendor: leg.vendor, endpoint: leg.endpoint, shipped: leg.shipped, verdict });
}

const outPath = path.join(OUT_DIR, "share-class-spelling-probe.json");
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify({ probedAt: new Date().toISOString(), rows, verdicts }, null, 2)
);
console.log(`Wrote ${outPath}`);
