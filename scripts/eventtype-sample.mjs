// One real poll across all three free adapters, digested down to the RAW INPUTS
// that §7's cascade reads. Step 6 of claude/news-adapter-spec-2026-09-13.md.
//
// ── WHY A DIGEST AND NOT THE PAYLOADS ──────────────────────────────────────
// The measurement asks what fraction of items get an eventType from each leg.
// Answering it needs the derivation to run over a real poll — but if the
// derivation ran HERE, on the runner, the number would describe a
// reimplementation of the cascade rather than the cascade. So this script
// makes no judgement at all: it emits, per item, only what the cascade reads
// (a form + item codes, a subject list, a title), and scripts/check-event-type.mjs
// runs the SHIPPED lib/server/news/eventType.ts over the result locally.
//
// It also keeps the payload small enough to survive the log tail, which a full
// capture of 16 Google News feeds plus 16 SEC submissions documents would not.
//
// ── WHY A RUNNER ───────────────────────────────────────────────────────────
// The sandbox is refused news.google.com, globenewswire.com, prnewswire.com and
// data.sec.gov with 403 CONNECT. All four are reachable from an Actions runner.
//
// THE QUERIES ARE NOT CHOSEN HERE. scripts/fixtures/eventtype-sample-queries.json
// is generated locally by running the real step-2 normaliser over the real
// Nasdaq display-name fixture and taking every Nth usable row — deterministic,
// and not picked by what the sample was expected to show.
//
//   node scripts/eventtype-sample.mjs
import fs from "node:fs";
import { emitPayload, requestedPayload } from "./lib/relay-capture.mjs";

const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; news adapter evaluation)";
const LOCALE = "hl=en-US&gl=US&ceid=US:en";
const QUERIES = JSON.parse(fs.readFileSync("scripts/fixtures/eventtype-sample-queries.json", "utf8"));
const GNEWS_PER_QUERY = 12;
const SEC_PER_SYMBOL = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url, headers = {}) => {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, ...headers } });
    if (!res.ok) { console.log(`  HTTP ${res.status} ${url.slice(0, 90)}`); return null; }
    return await res.text();
  } catch (err) { console.log(`  ERROR ${String(err).slice(0, 90)}`); return null; }
};

// Deliberately crude extraction: these are not the adapters' parsers and must
// not be mistaken for them. Everything they produce is a raw string that the
// real parsers would also have seen.
const blocksOf = (xml) => xml.split("<item>").slice(1);
const tag = (block, name) =>
  block.match(new RegExp(`<${name.replace(":", "\\:")}[^>]*>([\\s\\S]*?)</${name.replace(":", "\\:")}>`))?.[1] ?? null;
const tagAll = (block, name) => {
  const out = [];
  const re = new RegExp(`<${name.replace(":", "\\:")}[^>]*>([\\s\\S]*?)</${name.replace(":", "\\:")}>`, "g");
  let m; while ((m = re.exec(block))) out.push(m[1]);
  return out;
};
const unwrap = (v) => (v ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "").trim();

const wanted = requestedPayload();
const rows = [];

// ───────────────────────────────────────────────────────────── GOOGLE NEWS
if (!wanted || wanted === "eventtype-gnews") {
  console.log(`\n=== Google News: ${QUERIES.length} queries`);
  for (const { symbol, query } of QUERIES) {
    const xml = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${LOCALE}`);
    if (!xml) continue;
    const items = blocksOf(xml).slice(0, GNEWS_PER_QUERY);
    console.log(`  ${symbol}: ${items.length} items`);
    for (const b of items) rows.push({ src: "gnews", symbol, title: unwrap(tag(b, "title")) });
    await sleep(400);
  }
  emitPayload("eventtype-gnews", rows.map((r) => JSON.stringify(r)).join("\n"));
}

// ─────────────────────────────────────────────────────────────────── WIRES
if (!wanted || wanted === "eventtype-wire") {
  const wire = [];
  for (const [id, url] of [
    ["globenewswire", "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies"],
    ["prnewswire", "https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss"],
  ]) {
    const xml = await get(url);
    if (!xml) continue;
    const items = blocksOf(xml);
    console.log(`  ${id}: ${items.length} items`);
    for (const b of items) {
      wire.push({
        src: "wire", feed: id,
        title: unwrap(tag(b, "title")),
        // BOTH subject elements, exactly as wireProvider reads them, and with
        // its same length filter: the feeds carry 3-letter codes beside the
        // long labels and the codes are not subjects.
        subjects: [...tagAll(b, "prn:subject"), ...tagAll(b, "dc:subject")].map(unwrap).filter((v) => v.length > 4),
      });
    }
  }
  emitPayload("eventtype-wire", wire.map((r) => JSON.stringify(r)).join("\n"));
}

// ───────────────────────────────────────────────────────────── SEC FILINGS
if (!wanted || wanted === "eventtype-sec") {
  const sec = [];
  for (const { symbol, cik } of QUERIES) {
    // data.sec.gov's fair-access cap is 10 req/sec; this is far under it.
    const body = await get(`https://data.sec.gov/submissions/CIK${cik}.json`, { accept: "application/json" });
    if (!body) continue;
    let recent;
    try { recent = JSON.parse(body)?.filings?.recent ?? {}; } catch { console.log(`  ${symbol}: unparseable`); continue; }
    const forms = recent.form ?? [];
    const n = Math.min(forms.length, SEC_PER_SYMBOL);
    console.log(`  ${symbol}: ${forms.length} filings, taking ${n}`);
    // AGGREGATED BY (form, items), WITH A COUNT — unlike a headline, a filing's
    // derivation inputs are categorical, and 120 identical `Form 4 / no items`
    // rows carry exactly as much information as one row saying n=120. The
    // distribution the measurement reports is unchanged; the payload is ~6x
    // smaller and survives the log tail comfortably.
    const counts = new Map();
    for (let i = 0; i < n; i += 1) {
      const key = `${forms[i] ?? ""}\u0000${(recent.items ?? [])[i] ?? ""}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      const [form, items] = key.split("\u0000");
      sec.push({ src: "sec", symbol, form, items, n: count });
    }
    await sleep(200);
  }
  const totalFilings = sec.reduce((a, r) => a + r.n, 0);
  console.log(`  ${sec.length} distinct (form, items) shapes over ${totalFilings} filings`);
  emitPayload("eventtype-sec", sec.map((r) => JSON.stringify(r)).join("\n"));
}

console.log("\n=== done");
