// Is there a free source carrying the forward-looking EXPECTED IPO DATE, and
// from which egress can it be reached?
//
// Runs on a runner: the agent sandbox is refused api.nasdaq.com, www.sec.gov
// AND data.sec.gov with 403 CONNECT (re-tested 2026-09-14T18:46Z -- a policy
// denial recorded in the proxy's own recentRelayFailures, so it is the sandbox
// refusing, NOT the source).
//   dispatch relay.yml, task `ipo-sources`
//
// ── WHAT THIS RUNNER IS, AND WHAT IT IS NOT ────────────────────────────────
// A GitHub Actions runner is a DATACENTRE IP. It is therefore:
//   NOT the owner's residential UK path (P1a) -- nothing here can stand in for
//   that, and a PASS here must not be written into the residential cell.
//   NOT Vercel either (P1b) -- different ASN, different reputation. A PASS here
//   would NOT overturn the measured Vercel block, and a FAIL here would not
//   confirm it.
// It is a third egress path and is reported as its own row. The whole point of
// claude/news-adapter-spec-2026-09-13.md's verdict table is that reachability is
// a property of the (source, egress) PAIR, so this file never collapses them.
//
// EVERY NUMBER PRINTED HERE IS COUNTED FROM A PAYLOAD IN THIS RUN. Where a
// question cannot be answered from what came back, this prints the words "NOT
// MEASURED" and why, rather than a plausible number. Section 7 of the brief
// requires every cell measured and no cell inferred, and a probe that quietly
// estimates is worse than one that reports a gap.
import fs from "node:fs";

const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; sonnybrindle@mystockharbor.com; IPO calendar source evaluation)";
// sec.gov's fair-access policy keys off a declared UA with a contact address. A
// missing one returns 403 with a body reading "Request Rate Threshold Exceeded"
// while NOT being a rate limit -- do not add backoff for that page, add a header.
const SEC_UA = process.env.SEC_USER_AGENT || "MyStockHarbor sonnybrindle@mystockharbor.com";

const TODAY = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => iso(new Date(TODAY.getTime() + n * 86400000));
const TODAY_ISO = iso(TODAY);
const PLUS_30 = daysFromNow(30);
const MINUS_30 = daysFromNow(-30);
const MINUS_60 = daysFromNow(-60);

const raws = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Timing print lives in a `finally` so that a host which NEVER SETTLES prints a
// line too. claude/news-flip-done-2026-09-14.md §1 records that shape: Nasdaq's
// news feeds did not error from Vercel, they hung for 25s. A missing line is a
// measurement, but only if you arranged for the line to exist.
async function timedFetch(url, headers, timeoutMs = 30000) {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let out = { url, ok: false, status: 0, ms: 0, bytes: 0, contentType: "", body: "", error: null };
  try {
    const res = await fetch(url, { headers, signal: ctl.signal, redirect: "follow" });
    const body = await res.text();
    out = {
      url,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      bytes: body.length,
      contentType: res.headers.get("content-type") ?? "",
      body,
      error: null,
    };
  } catch (err) {
    out = {
      url,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      bytes: 0,
      contentType: "",
      body: "",
      error: `${err.name}: ${err.message}`,
    };
  } finally {
    clearTimeout(timer);
    console.log(
      `   HTTP ${out.status || "—"} · ${out.ms}ms · ${out.bytes} bytes · ${
        out.contentType || "no content-type"
      }${out.error ? ` · ERROR ${out.error}` : ""}`
    );
  }
  return out;
}

const CHALLENGE = [
  "requires JavaScript to verify",
  "Checking your browser",
  "cf-browser-verification",
  "Access Denied",
  "Request Rate Threshold Exceeded",
];
const challengeHit = (body) => CHALLENGE.find((m) => body.includes(m)) ?? null;

console.log("=".repeat(78));
console.log("IPO SOURCE PROBE — 2026-09-14");
console.log("=".repeat(78));
console.log(`egress:      GitHub Actions runner (DATACENTRE IP — not residential, not Vercel)`);
console.log(`User-Agent:  ${UA}`);
console.log(`SEC UA:      ${SEC_UA.includes("@") ? "declared, with contact" : "NO CONTACT — SEC will 403"}`);
console.log(`today:       ${TODAY_ISO}   next30: ${TODAY_ISO}..${PLUS_30}   last30: ${MINUS_30}..${TODAY_ISO}`);
console.log(`last60:      ${MINUS_60}..${TODAY_ISO}`);

// ══════════════════════════════════════════════════════════════════════════
// A. NASDAQ IPO CALENDAR
// THREE REQUESTS TOTAL. No loop, no bulk scrape, no tight retry. A 403 or a
// challenge page is a FINDING: record it and stop.
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(78)}\nA. NASDAQ — api.nasdaq.com/api/ipo/calendar\n${"═".repeat(78)}`);

const NASDAQ_MONTHS = ["2026-09", "2026-10", "2026-08"];
const nasdaq = {};
let nasdaqStopped = false;

for (const month of NASDAQ_MONTHS) {
  if (nasdaqStopped) {
    console.log(`\n── ${month}: SKIPPED — a previous month was refused, and the brief says stop.`);
    nasdaq[month] = { skipped: true };
    continue;
  }
  const url = `https://api.nasdaq.com/api/ipo/calendar?date=${month}`;
  console.log(`\n── ${month}\n   ${url}`);
  const r = await timedFetch(url, { "User-Agent": UA, accept: "application/json" });

  const marker = challengeHit(r.body);
  if (marker) {
    console.log(`   >>> CHALLENGE/REFUSAL PAGE — marker: "${marker}"`);
    console.log(`   head: ${r.body.slice(0, 300).replace(/\s+/g, " ")}`);
    nasdaq[month] = { status: r.status, ms: r.ms, bytes: r.bytes, refused: marker };
    nasdaqStopped = true;
    continue;
  }
  if (!r.ok || r.error) {
    console.log(`   >>> NOT REACHABLE from this runner.`);
    console.log(`   head: ${r.body.slice(0, 300).replace(/\s+/g, " ")}`);
    nasdaq[month] = { status: r.status, ms: r.ms, bytes: r.bytes, error: r.error };
    nasdaqStopped = true;
    continue;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(r.body);
  } catch (err) {
    console.log(`   >>> 200 but NOT JSON: ${err.message}`);
    nasdaq[month] = { status: r.status, notJson: true };
    nasdaqStopped = true;
    continue;
  }

  raws[`nasdaq-${month}.json`] = r.body;
  console.log(`   >>> REACHABLE — JSON parsed`);
  console.log(`   top-level keys: ${Object.keys(parsed).join(", ")}`);
  const data = parsed.data ?? {};
  console.log(`   data keys (the buckets): ${Object.keys(data).join(", ")}`);

  const buckets = {};
  for (const [name, bucket] of Object.entries(data)) {
    // Nasdaq's buckets are reported as {headers:{...}, rows:[...]} but that is
    // NOT verified -- discover the row array rather than assuming the shape.
    let rows = null;
    if (Array.isArray(bucket)) rows = bucket;
    else if (bucket && typeof bucket === "object") {
      if (Array.isArray(bucket.rows)) rows = bucket.rows;
      else {
        const arr = Object.values(bucket).find((v) => Array.isArray(v));
        if (arr) rows = arr;
      }
    }
    if (!rows) {
      console.log(`   · ${name}: no row array found (value type ${typeof bucket})`);
      buckets[name] = { rows: 0, fields: [] };
      continue;
    }
    const fields = rows.length ? Object.keys(rows[0]) : [];
    console.log(`   · ${name}: ${rows.length} rows`);
    if (fields.length) console.log(`     REAL field names: ${fields.join(", ")}`);
    buckets[name] = { rows: rows.length, fields, data: rows };
  }
  nasdaq[month] = { status: r.status, ms: r.ms, bytes: r.bytes, buckets };
}

// ── Nasdaq analysis: only over what actually came back ────────────────────
const nasdaqReachable = Object.values(nasdaq).some((m) => m && m.buckets);
console.log(`\n── NASDAQ ANALYSIS`);
if (!nasdaqReachable) {
  console.log(`   NOT MEASURED — no month returned a parseable payload from this runner.`);
  console.log(`   Every Nasdaq content question below is therefore unanswerable HERE.`);
  console.log(`   That is a statement about THIS egress path only.`);
} else {
  // Pool every bucket row across the months that answered.
  const allRows = [];
  for (const [month, m] of Object.entries(nasdaq)) {
    if (!m || !m.buckets) continue;
    for (const [bname, b] of Object.entries(m.buckets)) {
      for (const row of b.data ?? []) allRows.push({ month, bucket: bname, row });
    }
  }
  console.log(`   pooled rows across answered months: ${allRows.length}`);

  const DATE_KEYS = [
    "expectedPriceDate", "pricedDate", "date", "ipoDate", "expectedDate", "dealDate", "filedDate",
  ];
  const PRICE_KEYS = ["proposedSharePrice", "sharePrice", "priceRange", "price"];
  const SHARE_KEYS = ["sharesOffered", "shares", "numberOfShares"];
  const VALUE_KEYS = ["dollarValueOfSharesOffered", "dealSize", "offerSize", "proposedExchange"];
  const MCAP_KEYS = ["marketCap", "marketcap", "marketCapitalization"];

  const keysSeen = new Set();
  for (const { row } of allRows) for (const k of Object.keys(row)) keysSeen.add(k);
  console.log(`   union of ALL field names seen: ${[...keysSeen].sort().join(", ")}`);

  const pickKey = (row, keys) => keys.find((k) => row[k] !== undefined && row[k] !== null && `${row[k]}`.trim() !== "");
  const dayPrecise = (v) => /^\d{1,2}\/\d{1,2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(`${v}`.trim());
  const toIso = (v) => {
    const s = `${v}`.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return null;
  };

  // MARKET CAP: the page has a Market Cap column. Does this source carry one?
  const mcapRows = allRows.filter(({ row }) => pickKey(row, MCAP_KEYS));
  console.log(`   rows carrying ANY market-cap-shaped field: ${mcapRows.length} / ${allRows.length}`);
  if (!mcapRows.length) {
    console.log(`   >>> the Market Cap column LOSES ITS SOURCE if the page moves to Nasdaq.`);
  }

  // DATE PRECISION across every row that has a date at all.
  let precise = 0, placeholder = 0, noDate = 0;
  const placeholderSamples = [];
  for (const { row } of allRows) {
    const k = pickKey(row, DATE_KEYS);
    if (!k) { noDate++; continue; }
    if (dayPrecise(row[k])) precise++;
    else {
      placeholder++;
      if (placeholderSamples.length < 10) placeholderSamples.push(`${k}=${JSON.stringify(row[k])}`);
    }
  }
  console.log(`   date precision — day-precise: ${precise} · placeholder/other: ${placeholder} · no date field: ${noDate}`);
  if (placeholderSamples.length) console.log(`   placeholder samples: ${placeholderSamples.join(" | ")}`);

  // THE PAGE'S REAL COVERAGE: upcoming rows in the next 30 days carrying BOTH a
  // usable date AND at least one pricing field. This is the number that decides
  // whether the page renders populated or empty.
  const upcomingBuckets = ["upcoming", "upcomingTable"];
  const upcomingRows = allRows.filter(({ bucket }) =>
    upcomingBuckets.includes(bucket) || /upcoming/i.test(bucket)
  );
  let usable = 0, inWindow = 0;
  const usableSamples = [];
  for (const { row } of upcomingRows) {
    const dk = pickKey(row, DATE_KEYS);
    const isoDate = dk ? toIso(row[dk]) : null;
    if (!isoDate || isoDate < TODAY_ISO || isoDate > PLUS_30) continue;
    inWindow++;
    const hasPricing = Boolean(
      pickKey(row, PRICE_KEYS) || pickKey(row, SHARE_KEYS) || pickKey(row, VALUE_KEYS.slice(0, 3))
    );
    if (hasPricing) {
      usable++;
      if (usableSamples.length < 5) usableSamples.push(JSON.stringify(row).slice(0, 220));
    }
  }
  console.log(`   upcoming rows total: ${upcomingRows.length}`);
  console.log(`   ...falling inside ${TODAY_ISO}..${PLUS_30}: ${inWindow}`);
  console.log(`   ...AND carrying >=1 pricing field  >>> PAGE COVERAGE: ${usable}`);
  for (const s of usableSamples) console.log(`     sample: ${s}`);

  // Do priced rows for the last 30 days reproduce "Recent IPOs"?
  const pricedRows = allRows.filter(({ bucket }) => /priced/i.test(bucket));
  let pricedInWindow = 0;
  for (const { row } of pricedRows) {
    const dk = pickKey(row, DATE_KEYS);
    const isoDate = dk ? toIso(row[dk]) : null;
    if (isoDate && isoDate >= MINUS_30 && isoDate <= TODAY_ISO) pricedInWindow++;
  }
  console.log(`   priced rows total: ${pricedRows.length} · inside ${MINUS_30}..${TODAY_ISO}: ${pricedInWindow}`);
  console.log(`   >>> "Recent IPOs" reproducible from priced bucket: ${pricedInWindow > 0 ? "YES" : "NO"}`);
}

// ══════════════════════════════════════════════════════════════════════════
// B. NASDAQ TERMS — the licence question gates use REGARDLESS of reachability
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(78)}\nB. NASDAQ TERMS OF USE + robots.txt\n${"═".repeat(78)}`);

const TERMS_URLS = [
  "https://www.nasdaq.com/robots.txt",
  "https://www.nasdaq.com/terms-of-service",
  "https://www.nasdaq.com/legal-disclaimer",
];
const terms = {};
for (const url of TERMS_URLS) {
  console.log(`\n── ${url}`);
  const r = await timedFetch(url, { "User-Agent": UA });
  if (!r.ok) {
    console.log(`   >>> could not read (status ${r.status}${r.error ? `, ${r.error}` : ""})`);
    terms[url] = { status: r.status, error: r.error };
    continue;
  }
  raws[`nasdaq-terms-${url.split("/").pop() || "root"}.txt`] = r.body;
  if (url.endsWith("robots.txt")) {
    console.log(`   ── robots.txt VERBATIM (first 3000 chars) ──`);
    console.log(r.body.slice(0, 3000));
    // The operative question for /api/: is it disallowed?
    const apiRules = r.body.split("\n").filter((l) => /api/i.test(l));
    console.log(`   lines mentioning "api": ${apiRules.length ? apiRules.join(" | ") : "NONE"}`);
  } else {
    const text = r.body
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    console.log(`   extracted text: ${text.length} chars`);
    // Pull the sentences that actually bear on programmatic use, so the results
    // doc can QUOTE rather than summarise as "seems fine".
    const TOPICS = [
      /scrap\w*/i, /robot/i, /spider/i, /crawl\w*/i, /data min\w*/i, /automated/i,
      /programmatic/i, /\bapi\b/i, /redistribut\w*/i, /republish\w*/i,
      /commercial/i, /personal use/i, /non-?commercial/i, /extract\w*/i, /framing|frame/i,
    ];
    const sentences = text.split(/(?<=[.;])\s+/);
    const hits = sentences.filter((s) => s.length > 40 && s.length < 900 && TOPICS.some((t) => t.test(s)));
    console.log(`   clauses touching programmatic/redistribution/commercial use: ${hits.length}`);
    hits.slice(0, 25).forEach((s, i) => console.log(`   [${i + 1}] ${s.trim()}`));
    if (!hits.length) console.log(`   >>> SILENT on these topics in the fetched text (or the text is JS-rendered).`);
    terms[url] = { status: r.status, chars: text.length, hits: hits.length };
  }
  await sleep(300);
}

// ══════════════════════════════════════════════════════════════════════════
// C. SEC EDGAR — the licence-clean floor. Public domain, no terms problem.
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(78)}\nC. SEC EDGAR — last 60 days (${MINUS_60}..${TODAY_ISO})\n${"═".repeat(78)}`);

const secHeaders = { "User-Agent": SEC_UA, accept: "*/*", "accept-encoding": "gzip, deflate" };
const sec = { reachable: false };

// The quarterly form index enumerates EVERY filing by form type. One request
// answers "how many S-1/A in the window" exactly, rather than sampling.
const IDX_URL = "https://www.sec.gov/Archives/edgar/full-index/2026/QTR3/form.idx";
console.log(`\n── form index\n   ${IDX_URL}`);
const idx = await timedFetch(IDX_URL, secHeaders, 60000);

const idxMarker = challengeHit(idx.body);
if (idxMarker) {
  console.log(`   >>> REFUSED — marker: "${idxMarker}"`);
  console.log(`   NOTE: that body is NOT a rate limit. Check the User-Agent header before any backoff.`);
  sec.refused = idxMarker;
} else if (!idx.ok) {
  console.log(`   >>> NOT REACHABLE (status ${idx.status}${idx.error ? `, ${idx.error}` : ""})`);
  sec.error = idx.error ?? `HTTP ${idx.status}`;
} else {
  sec.reachable = true;
  console.log(`   >>> REACHABLE`);
  const lines = idx.body.split("\n");
  // form.idx is fixed-width: Form Type | Company Name | CIK | Date Filed | File Name
  const filings = [];
  for (const line of lines) {
    const m = line.match(/^(\S[\S\s]{0,11}\S)\s{2,}(.+?)\s{2,}(\d{4,10})\s{2,}(\d{4}-\d{2}-\d{2})\s{2,}(\S+)\s*$/);
    if (!m) continue;
    const [, form, company, cik, date, file] = m;
    if (date < MINUS_60 || date > TODAY_ISO) continue;
    filings.push({ form: form.trim(), company: company.trim(), cik, date, file });
  }
  console.log(`   filings parsed inside the 60-day window: ${filings.length}`);

  const countOf = (f) => filings.filter((x) => x.form === f).length;
  const FORMS = ["S-1", "S-1/A", "F-1", "F-1/A", "8-A12B", "424B4", "424B1"];
  console.log(`   ── form counts in window (exact, from the index, not sampled)`);
  for (const f of FORMS) console.log(`     ${f.padEnd(8)} ${countOf(f)}`);
  sec.formCounts = Object.fromEntries(FORMS.map((f) => [f, countOf(f)]));

  // ── The five-by-hand test. A cover-page parser that works on 3 of 5 is not a
  // pipeline, so the hit rate is reported honestly, per filing.
  const candidates = filings.filter((x) => x.form === "S-1/A").slice(-5);
  console.log(`\n── FIVE S-1/A COVER PAGES, tried by hand (${candidates.length} available)`);
  sec.covers = [];

  for (const f of candidates) {
    const accession = f.file.split("/").pop().replace(/\.txt$/, "");
    const noDash = accession.replace(/-/g, "");
    console.log(`\n   ${f.form} · ${f.company} · CIK ${f.cik} · filed ${f.date}`);
    const idxJson = `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${noDash}/index.json`;
    await sleep(150); // SEC fair access: <=10 req/s. Nowhere near it, deliberately.
    const ij = await timedFetch(idxJson, secHeaders);
    const row = { company: f.company, cik: f.cik, date: f.date, accession };
    if (!ij.ok) {
      console.log(`     >>> index.json unreadable — cover NOT assessable`);
      row.result = "index unreadable";
      sec.covers.push(row);
      continue;
    }
    let primary = null;
    try {
      const items = JSON.parse(ij.body).directory?.item ?? [];
      const htm = items
        .filter((it) => /\.htm$/i.test(it.name) && !/^R\d+\.htm$/i.test(it.name))
        .sort((a, b) => Number(b.size) - Number(a.size));
      primary = htm[0]?.name ?? null;
    } catch (err) {
      console.log(`     >>> index.json not parseable: ${err.message}`);
    }
    if (!primary) {
      console.log(`     >>> no primary .htm found — cover NOT assessable`);
      row.result = "no primary doc";
      sec.covers.push(row);
      continue;
    }
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${noDash}/${primary}`;
    console.log(`     doc: ${primary}`);
    await sleep(150);
    const doc = await timedFetch(docUrl, secHeaders, 60000);
    if (!doc.ok) {
      console.log(`     >>> document unreadable`);
      row.result = "doc unreadable";
      sec.covers.push(row);
      continue;
    }
    const text = doc.body
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#\d+;/g, " ")
      .replace(/\s+/g, " ");
    const cover = text.slice(0, 60000);

    // 1. price range on the cover
    const priceRange =
      cover.match(/\$\s?([\d.]+)\s*(?:and|to|-|–|—)\s*\$\s?([\d.]+)\s+per\s+share/i) ||
      cover.match(/between\s+\$\s?([\d.]+)\s+and\s+\$\s?([\d.]+)/i);
    // 2. share count on the cover
    const shares =
      cover.match(/([\d,]{5,})\s+shares\s+of\s+(?:our\s+)?(?:common|ordinary)\s+(?:stock|shares)/i) ||
      cover.match(/offering\s+([\d,]{5,})\s+shares/i);
    // 3. proposed ticker + exchange
    const ticker = cover.match(/(?:symbol|ticker)\s*[""“”'']?\s*[:]?\s*[""“”'']?\s*([A-Z]{1,5})\b/);
    const exchange = cover.match(
      /(New York Stock Exchange|NYSE American|Nasdaq Global Select Market|Nasdaq Global Market|Nasdaq Capital Market|NYSE|Nasdaq)/i
    );
    // 4. THE DECISIVE ONE — an expected LISTING DATE, anywhere in the document.
    const DATE_PHRASES = [
      /expected to (?:begin|commence) trading[^.]{0,160}/i,
      /trading (?:is expected to|will) (?:begin|commence)[^.]{0,160}/i,
      /expect(?:ed)? to list[^.]{0,160}/i,
      /on or about\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}[^.]{0,120}/,
      /delivery[^.]{0,80}on or about[^.]{0,120}/i,
    ];
    const dateHits = [];
    for (const re of DATE_PHRASES) {
      const m = text.match(re);
      if (m) dateHits.push(m[0].trim().slice(0, 220));
    }

    row.priceRange = priceRange ? `$${priceRange[1]}–$${priceRange[2]}` : null;
    row.shares = shares ? shares[1] : null;
    row.ticker = ticker ? ticker[1] : null;
    row.exchange = exchange ? exchange[1] : null;
    row.listingDatePhrases = dateHits;
    row.result = "assessed";

    console.log(`     price range : ${row.priceRange ?? "NOT FOUND"}`);
    console.log(`     shares      : ${row.shares ?? "NOT FOUND"}`);
    console.log(`     ticker      : ${row.ticker ?? "NOT FOUND"}`);
    console.log(`     exchange    : ${row.exchange ?? "NOT FOUND"}`);
    if (dateHits.length) {
      console.log(`     LISTING-DATE LANGUAGE (${dateHits.length}):`);
      dateHits.forEach((h) => console.log(`       "${h}"`));
    } else {
      console.log(`     LISTING-DATE LANGUAGE: NONE FOUND`);
    }
    sec.covers.push(row);
  }

  const assessed = sec.covers.filter((c) => c.result === "assessed");
  const withPrice = assessed.filter((c) => c.priceRange).length;
  const withShares = assessed.filter((c) => c.shares).length;
  const withTicker = assessed.filter((c) => c.ticker).length;
  const withExchange = assessed.filter((c) => c.exchange).length;
  const withDate = assessed.filter((c) => c.listingDatePhrases?.length).length;
  console.log(`\n   ── COVER-PAGE HIT RATE (honest, out of ${assessed.length} assessed)`);
  console.log(`     price range     ${withPrice}/${assessed.length}`);
  console.log(`     share count     ${withShares}/${assessed.length}`);
  console.log(`     proposed ticker ${withTicker}/${assessed.length}`);
  console.log(`     exchange        ${withExchange}/${assessed.length}`);
  console.log(`     ANY listing-date language ${withDate}/${assessed.length}`);
  sec.hitRate = { assessed: assessed.length, withPrice, withShares, withTicker, withExchange, withDate };
}

raws["sec-summary.json"] = JSON.stringify(sec, null, 2);
raws["nasdaq-summary.json"] = JSON.stringify(
  Object.fromEntries(
    Object.entries(nasdaq).map(([k, v]) => [
      k,
      v && v.buckets
        ? { ...v, buckets: Object.fromEntries(Object.entries(v.buckets).map(([b, x]) => [b, { rows: x.rows, fields: x.fields }])) }
        : v,
    ])
  ),
  null,
  2
);

// ══════════════════════════════════════════════════════════════════════════
// RAW PAYLOADS — the evidence. Written for the artifact AND printed, because
// the sandbox that reads this cannot reach the Actions artifact blob host; the
// run log is the only channel that actually gets the bytes home.
// Printed LAST so that a truncated log still carries the analysis above.
// ══════════════════════════════════════════════════════════════════════════
fs.mkdirSync("data/sec", { recursive: true });
for (const [name, body] of Object.entries(raws)) {
  fs.writeFileSync(`data/sec/ipo-probe-${name}`, body);
}
console.log(`\n${"═".repeat(78)}\nRAW PAYLOADS (${Object.keys(raws).length} files)\n${"═".repeat(78)}`);
const CAP = 350000;
for (const [name, body] of Object.entries(raws)) {
  const truncated = body.length > CAP;
  console.log(`\n<<<RAW name=${name} bytes=${body.length}${truncated ? " TRUNCATED=true" : ""}>>>`);
  console.log(truncated ? body.slice(0, CAP) : body);
  console.log(`<<<ENDRAW name=${name}>>>`);
}
console.log(`\nDONE ${new Date().toISOString()}`);
