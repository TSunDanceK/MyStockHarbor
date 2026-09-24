// CAPEX — FOLLOW THE MONEY: READ-ONLY FEASIBILITY PROBE (#563 queue item 1).
//
// Nothing here writes anywhere. No Redis, no credential, no FMP. It runs on a
// relay runner because the agent sandbox is refused data.sec.gov, www.sec.gov,
// efts.sec.gov and api.usaspending.gov with 403 CONNECT. Every answer is
// printed to the log, which is the only thing that leaves the runner in a form
// the sandbox can read.
//
// PART selects one question, so each fits the read-only job's 30-minute limit
// and the parts run side by side:
//
//   frames    capex / acquisitions / R&D / revenue coverage over the universe,
//             from the XBRL frames API (one call returns every filer for one
//             concept and period), us-gaap vs ifrs-full, annual vs quarterly;
//             plus quarterly derivability from companyfacts on a sample.
//   segments  segment revenue: companyfacts carries NO dimensional facts, so
//             this reads the XBRL instance of each sampled filer's latest
//             10-K / 20-F and counts revenue facts on a segment axis.
//   links     named suppliers/customers in 10-K text: extractor output plus
//             the cue sentences it ran over, for a hand check. SHARD=i/n.
//   fts       how many 10-Ks in 12 months name NAME (NVIDIA | TSMC | ASML),
//             and in how many the sentence reads as a supplier relationship.
//   8k        8-K Item 1.01 over 12 months across the universe, and on a
//             sample, whether the counterparty maps to a ticker.
//   usa       USAspending.gov contract awards over 12 months, recipients
//             mapped name → CIK, amounts by SIC division, API behaviour.
//
// The universe is data/sec/registrants.json (every profiled symbol's CIK).
// Sector grouping here is the SEC SIC DIVISION (a public standard), NOT the
// site's sector labels: the resolver that owns those is Relay A's and is being
// rebuilt, and data/sec/sic-sector.json was derived by voting with FMP sectors.
import fs from "node:fs";

const PART = (process.env.PART || process.argv[2] || "").trim();
const UA_SEC =
  process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; capex feasibility probe)";
const UA_PLAIN = "MyStockHarbor/1.0 capex feasibility probe";

// ── the window: 12 months to the probe date ─────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);
const YEAR_AGO = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);

// ── universe ────────────────────────────────────────────────────────────────
const reg = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const UNIVERSE = new Map(); // cik(int) -> {symbols, sic, annualForm}
for (const [sym, r] of Object.entries(reg)) {
  if (!r?.cik) continue;
  const cik = Number(r.cik);
  const u = UNIVERSE.get(cik) ?? { symbols: [], sic: r.sic ?? null, annualForm: r.annualForm ?? null };
  u.symbols.push(sym);
  UNIVERSE.set(cik, u);
}
const tick = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const TICKERS = new Map(); // cik -> {name, tickers[]}
for (const [cik, name, ticker] of tick.data) {
  const t = TICKERS.get(cik) ?? { name, tickers: [] };
  t.tickers.push(ticker);
  TICKERS.set(cik, t);
}
const symToCik = new Map();
for (const [cik, u] of UNIVERSE) for (const s of u.symbols) symToCik.set(s, cik);
for (const [cik, t] of TICKERS) for (const s of t.tickers) if (!symToCik.has(s)) symToCik.set(s, cik);

// ── polite fetch: ≤6 req/s per host family, retry on 429/5xx ────────────────
const last = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requests = 0, bytes = 0;
async function get(url, { json = true, method = "GET", body, host = new URL(url).host, gapMs = 170 } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = (last.get(host) ?? 0) + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    last.set(host, Date.now());
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          "User-Agent": host.endsWith("sec.gov") ? UA_SEC : UA_PLAIN,
          "Accept-Encoding": "gzip, deflate",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(Number(process.env.FETCH_TIMEOUT_MS || 60_000)),
      });
    } catch (e) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    requests++;
    if (res.status === 404) return { status: 404, data: null, headers: res.headers };
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    bytes += text.length;
    if (!res.ok) return { status: res.status, data: null, text: text.slice(0, 300), headers: res.headers };
    return { status: res.status, data: json ? JSON.parse(text) : text, headers: res.headers };
  }
  return { status: 0, data: null };
}

// ── deterministic sampling ──────────────────────────────────────────────────
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sample(arr, n, seed) {
  const r = rng(seed), a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}
// AI / data-centre supply chain: the population the page is about. Stated as a
// purposive sample; the random half is what the rates generalise from.
const PURPOSIVE = [
  "NVDA", "AMD", "AVGO", "MU", "INTC", "QCOM", "MRVL", "AMAT", "LRCX", "KLAC",
  "SMCI", "DELL", "HPE", "ANET", "CSCO", "VRT", "ETN", "JBL", "CRDO", "COHR",
  "MSFT", "GOOGL", "AMZN", "META", "ORCL",
];
const tenKFilers = [...UNIVERSE].filter(([, u]) => u.annualForm === "10-K").map(([c]) => c);
const purposiveCiks = PURPOSIVE.map((s) => symToCik.get(s)).filter(Boolean);
const randomCiks = sample(tenKFilers.filter((c) => !purposiveCiks.includes(c)), 25, 20260923);
const LINK_SAMPLE = [...purposiveCiks, ...randomCiks];
const label = (cik) => (UNIVERSE.get(cik)?.symbols?.[0] ?? TICKERS.get(cik)?.tickers?.[0] ?? String(cik));

// ── SIC division (the SEC/OSHA standard ranges) ─────────────────────────────
function sicDivision(sic) {
  const n = Number(sic);
  if (!sic || !Number.isFinite(n)) return "unknown";
  if (n < 1000) return "A agriculture";
  if (n < 1500) return "B mining & oil/gas";
  if (n < 1800) return "C construction";
  if (n < 4000) return "D manufacturing";
  if (n < 5000) return "E transport, comms, utilities";
  if (n < 5200) return "F wholesale";
  if (n < 6000) return "G retail";
  if (n < 6800) return "H finance, insurance, real estate";
  if (n < 9000) return "I services";
  return "J public admin / other";
}

// ── submissions (cached per run) ────────────────────────────────────────────
const pad = (c) => String(c).padStart(10, "0");
const subCache = new Map();
async function submissions(cik) {
  if (subCache.has(cik)) return subCache.get(cik);
  const r = await get(`https://data.sec.gov/submissions/CIK${pad(cik)}.json`);
  subCache.set(cik, r.data);
  return r.data;
}
function recentRows(sub) {
  const f = sub?.filings?.recent;
  if (!f) return [];
  return f.form.map((form, i) => ({
    form, filingDate: f.filingDate[i], accn: f.accessionNumber[i],
    primaryDocument: f.primaryDocument[i], items: f.items?.[i] ?? "",
    reportDate: f.reportDate?.[i] ?? "",
  }));
}
const docUrl = (cik, accn, doc) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/${doc}`;

// ── text utilities ──────────────────────────────────────────────────────────
function htmlToText(html) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&#8217;|&#x2019;|&rsquo;/gi, "'")
    .replace(/&#8220;|&#8221;|&#x201c;|&#x201d;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#8212;|&#x2014;|&mdash;/gi, "—")
    .replace(/&#8211;|&#x2013;|&ndash;/gi, "–")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*/g, "\n");
}
function sentences(text) {
  return text
    .split(/\n+/)
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z("“])/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 30 && s.length <= 1500);
}

// ── company-name dictionary (for mapping a named party to a ticker) ─────────
const SUFFIX =
  /\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LTD|LIMITED|LLC|L ?P|PLC|N ?V|S ?A|AG|SE|HOLDINGS?|GROUP|THE|CLASS [A-C]|NEW|DE|ADR|SA DE CV|TECHNOLOGIES|TECHNOLOGY)\b/g;
const normName = (s) =>
  ` ${String(s).toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]+/g, " ")} `
    .replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
const NAME_TO_CIK = new Map();
for (const [cik, t] of TICKERS) {
  const n = normName(t.name);
  if (n.length >= 3 && !NAME_TO_CIK.has(n)) NAME_TO_CIK.set(n, cik);
}
// Short forms in 10-K prose that do not equal the registrant name. Each one is
// a real registrant in company-tickers; the CIK is looked up, not typed.
const ALIASES = {
  TSMC: "TSM", "Taiwan Semiconductor": "TSM", NVIDIA: "NVDA", ASML: "ASML",
  Samsung: null, "SK hynix": null, Foxconn: null, "Hon Hai": null, // not SEC registrants: named, unmappable
  Apple: "AAPL", Microsoft: "MSFT", Amazon: "AMZN", "Amazon Web Services": "AMZN", AWS: "AMZN",
  Google: "GOOGL", Alphabet: "GOOGL", Meta: "META", Oracle: "ORCL", Intel: "INTC", AMD: "AMD",
  "Advanced Micro Devices": "AMD", Broadcom: "AVGO", Qualcomm: "QCOM", Micron: "MU", Dell: "DELL",
  "Hewlett Packard Enterprise": "HPE", HPE: "HPE", Cisco: "CSCO", Walmart: "WMT", Costco: "COST",
  "Home Depot": "HD", "Lowe's": "LOW", Target: "TGT", "Best Buy": "BBY", Boeing: "BA", Lockheed: "LMT",
  "Lockheed Martin": "LMT", "General Motors": "GM", Ford: "F", Tesla: "TSLA", "McKesson": "MCK",
  "Cardinal Health": "CAH", Cencora: "COR", AmerisourceBergen: "COR", CVS: "CVS", UnitedHealth: "UNH",
  "Applied Materials": "AMAT", "Lam Research": "LRCX", "KLA": "KLAC", Arrow: "ARW", Avnet: "AVT",
  "TD Synnex": "SNX", Jabil: "JBL", Flex: "FLEX", Celestica: "CLS", "Super Micro": "SMCI",
  Supermicro: "SMCI", CoreWeave: "CRWV", Arista: "ANET", Marvell: "MRVL", "Texas Instruments": "TXN",
  GlobalFoundries: "GFS", "United Microelectronics": "UMC", UMC: "UMC", "Amkor": "AMKR",
  "Sony": "SONY", Nokia: "NOK", Ericsson: "ERIC", "Verizon": "VZ", "AT&T": "T", "T-Mobile": "TMUS",
  Comcast: "CMCSA", Nike: "NKE", "Procter & Gamble": "PG", Kroger: "KR", Medtronic: "MDT",
};
const ALIAS_RE = new RegExp(
  `\\b(${Object.keys(ALIASES).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&")).join("|")})\\b`,
  "g"
);
// Registrant-style names in prose: "Foo Bar Inc." / "Foo Corporation" etc.
const ORG_RE =
  /\b((?:[A-Z][A-Za-z0-9&'.-]*\s){0,4}[A-Z][A-Za-z0-9&'.-]*,?\s(?:Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.,? Ltd\.?|Ltd\.?|Limited|LLC|L\.P\.|plc|N\.V\.|S\.A\.|AG|SE|GmbH))(?=[\s,.;)]|$)/g;
function namedParties(sentence, selfCik) {
  const out = new Map(); // display -> {cik|null, ticker|null, how}
  for (const m of sentence.matchAll(ALIAS_RE)) {
    const t = ALIASES[m[1]];
    const cik = t ? symToCik.get(t) ?? null : null;
    if (cik && cik === selfCik) continue;
    out.set(m[1], { cik, ticker: t, how: "alias" });
  }
  for (const m of sentence.matchAll(ORG_RE)) {
    const disp = m[1].replace(/^(The|and|with|from|by|of|to|Our|our)\s+/, "").trim();
    const cik = NAME_TO_CIK.get(normName(disp)) ?? null;
    if (cik && cik === selfCik) continue;
    if ([...out.keys()].some((k) => disp.includes(k))) continue;
    out.set(disp, { cik, ticker: cik ? TICKERS.get(cik)?.tickers?.[0] ?? null : null, how: "org" });
  }
  return out;
}
const SUPPLIER_CUE = /\b(suppliers?|vendors?|sole[- ]source[ds]?|single[- ]source[ds]?|foundr(y|ies)|contract manufactur\w*|manufactured (for us )?by|fabricat\w+ by|purchase[sd]? (\w+ ){0,3}from|procure\w* from|rely on|relies on|depend(s|ent)? (up)?on|licens\w+ from)\b/i;
const CUSTOMER_CUE = /\b(customers?|accounted for (approximately |about )?\d+(\.\d+)?%|\d+(\.\d+)?% of (our )?(total |consolidated )?(net )?(revenue|revenues|sales)|distributors?|resellers?)\b/i;
const roleOf = (s) => {
  const sup = SUPPLIER_CUE.test(s), cus = CUSTOMER_CUE.test(s);
  return sup && !cus ? "supplier" : cus && !sup ? "customer" : sup && cus ? "both-cues" : null;
};

async function latestAnnual(cik, forms = ["10-K"]) {
  const sub = await submissions(cik);
  const row = recentRows(sub).find((r) => forms.includes(r.form));
  return row ? { ...row, name: sub.name, sic: sub.sic } : null;
}

// ═════════════════════════════════════════════════════════════════════════════
async function partFrames() {
  // Chains: us-gaap as secFields.ts ships capex (read from the source, not typed
  // here, so this cannot measure a chain the site does not use).
  const src = fs.readFileSync("lib/server/secFields.ts", "utf8");
  const capexChain = JSON.parse(
    (src.match(/key: "capex", chain: (\[[^\]]+\])/) ?? [])[1] ?? '["PaymentsToAcquirePropertyPlantAndEquipment"]'
  );
  const METRICS = {
    capex: { "us-gaap": capexChain, "ifrs-full": ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"] },
    acquisitions: {
      "us-gaap": ["PaymentsToAcquireBusinessesNetOfCashAcquired"],
      "ifrs-full": ["CashFlowsUsedInObtainingControlOfSubsidiariesOrOtherBusinessesClassifiedAsInvestingActivities"],
    },
    rnd: {
      "us-gaap": ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
      "ifrs-full": ["ResearchAndDevelopmentExpense"],
    },
    revenue: {
      "us-gaap": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"],
      "ifrs-full": ["Revenue"],
    },
  };
  const IFRS_UNITS = ["USD", "EUR", "GBP", "JPY", "CAD", "CHF", "AUD", "CNY", "TWD", "INR", "BRL", "KRW", "SEK", "DKK", "NOK", "HKD", "MXN", "ILS", "ZAR", "CLP", "COP", "ARS", "IDR", "PHP"];
  const years = ["CY2021", "CY2022", "CY2023", "CY2024", "CY2025"];
  const quarters = ["CY2025Q1", "CY2025Q2", "CY2025Q3", "CY2025Q4", "CY2026Q1", "CY2026Q2"];
  console.log(`capex chain read from secFields.ts: ${JSON.stringify(capexChain)}`);
  const hits = {}; // metric -> period -> Map(cik -> {tax, concept, val, unit})
  const both = []; // capex filers carrying both us-gaap chain concepts in one annual frame
  const frameBytes = {};
  for (const [metric, byTax] of Object.entries(METRICS)) {
    hits[metric] = {};
    for (const period of [...years, ...quarters]) {
      const m = (hits[metric][period] = new Map());
      for (const [tax, concepts] of Object.entries(byTax)) {
        const units = tax === "us-gaap" ? ["USD"] : period.includes("Q") ? ["USD", "EUR"] : IFRS_UNITS;
        for (const concept of concepts) {
          for (const unit of units) {
            const r = await get(`https://data.sec.gov/api/xbrl/frames/${tax}/${concept}/${unit}/${period}.json`);
            if (!r.data) continue;
            frameBytes[metric] = (frameBytes[metric] ?? 0) + JSON.stringify(r.data).length;
            for (const d of r.data.data) {
              if (!UNIVERSE.has(d.cik)) continue;
              const prev = m.get(d.cik);
              if (prev && metric === "capex" && tax === "us-gaap" && prev.concept !== concept && !period.includes("Q")) {
                both.push({ cik: d.cik, period, a: prev.val, b: d.val, ca: prev.concept, cb: concept });
              }
              if (!prev) m.set(d.cik, { tax, concept, val: d.val, unit });
            }
          }
        }
      }
    }
  }
  const N = UNIVERSE.size;
  const byForm = (set) => {
    const o = {};
    for (const cik of set) { const f = UNIVERSE.get(cik).annualForm ?? "none"; o[f] = (o[f] ?? 0) + 1; }
    return o;
  };
  const universeForms = byForm(UNIVERSE.keys());
  console.log(`\n=== FRAMES: universe ${N} CIKs; annual forms ${JSON.stringify(universeForms)} ===`);
  for (const metric of Object.keys(METRICS)) {
    console.log(`\n-- ${metric}`);
    for (const period of [...years, ...quarters]) {
      const m = hits[metric][period];
      let g = 0, i = 0;
      const units = {};
      for (const v of m.values()) { v.tax === "us-gaap" ? g++ : i++; units[v.unit] = (units[v.unit] ?? 0) + 1; }
      const nonUsd = Object.entries(units).filter(([u]) => u !== "USD").map(([u, c]) => `${u}:${c}`).join(" ");
      console.log(`${period.padEnd(9)} filers ${String(m.size).padStart(5)} (${((100 * m.size) / N).toFixed(1)}%)  us-gaap ${g}  ifrs ${i}${nonUsd ? `  non-USD ${nonUsd}` : ""}`);
    }
    // five-year completeness: filer has all five annual frames
    const all5 = [...UNIVERSE.keys()].filter((c) => years.every((y) => hits[metric][y].has(c)));
    const latest = hits[metric]["CY2025"];
    console.log(`  all 5 years CY2021–CY2025: ${all5.length}; CY2025 by annual form ${JSON.stringify(byForm(latest.keys()))}`);
  }
  // capex / revenue computable
  const cr = [...hits.capex.CY2025.keys()].filter((c) => hits.revenue.CY2025.has(c));
  console.log(`\ncapex/revenue computable CY2025: ${cr.length} of ${N}`);
  // both us-gaap capex concepts in one annual frame: agreement
  if (both.length) {
    const diffs = both.map((x) => Math.abs(x.a - x.b) / Math.max(Math.abs(x.a), Math.abs(x.b), 1));
    const w5 = diffs.filter((d) => d <= 0.05).length;
    console.log(`\ncapex: ${both.length} filer-years carry BOTH ${capexChain.join(" + ")} in one annual frame; within 5%: ${w5}; median gap ${(100 * diffs.sort((a, b) => a - b)[Math.floor(diffs.length / 2)]).toFixed(1)}%`);
    for (const x of both.slice(0, 12)) console.log(`   ${label(x.cik)} ${x.period} ${x.ca}=${x.a} ${x.cb}=${x.b}`);
  }
  // sector-level aggregate (SIC division) and the byte size of that layer
  const agg = {};
  for (const [cik, v] of hits.capex.CY2025) {
    if (v.unit !== "USD") continue;
    const div = sicDivision(UNIVERSE.get(cik).sic);
    agg[div] = agg[div] ?? { filers: 0, capex: 0 };
    agg[div].filers++; agg[div].capex += v.val;
  }
  console.log(`\nCY2025 capex by SIC division (USD filers only, universe):`);
  for (const [d, a] of Object.entries(agg).sort()) console.log(`   ${d.padEnd(34)} filers ${String(a.filers).padStart(4)}  $${(a.capex / 1e9).toFixed(1)}bn`);
  // Layer-1 storage: 4 metrics x ~15 sectors x (5 years + 6 quarters) x {sum, filers, median}
  const layer1 = {};
  for (const metric of Object.keys(METRICS)) for (let s = 0; s < 15; s++) for (const p of [...years, ...quarters])
    layer1[`${metric}|sector${s}|${p}`] = { sum: 123456789012, filers: 123, median: 12345678901 };
  console.log(`\nlayer-1 aggregate record (sector totals, all metrics, 11 periods): ~${JSON.stringify(layer1).length} bytes as one JSON value`);
  console.log(`frames payload bytes read per metric: ${JSON.stringify(frameBytes)}`);

  // ── quarterly derivability on a sample (companyfacts carries the YTD facts)
  const qSample = sample(tenKFilers, 120, 7);
  let direct = 0, derivable = 0, none = 0;
  const qtrEnd = (end) => end.slice(0, 7);
  for (const cik of qSample) {
    const r = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cik)}.json`);
    const facts = r.data?.facts?.["us-gaap"] ?? {};
    const concept = capexChain.find((c) => facts[c]?.units?.USD);
    if (!concept) { none++; continue; }
    const rows = facts[concept].units.USD.filter((f) => f.form === "10-Q" || f.form === "10-K");
    const dur = (f) => (Date.parse(f.end) - Date.parse(f.start)) / 864e5;
    const since = rows.filter((f) => f.end >= "2025-07-01");
    const threeMonth = new Set(since.filter((f) => dur(f) > 80 && dur(f) < 100).map((f) => qtrEnd(f.end)));
    const ytd = since.filter((f) => dur(f) >= 170);
    // a quarter is derivable when a YTD fact and the prior YTD (or 3M) of the same start exist
    const derived = new Set();
    for (const f of ytd) {
      const prior = rows.find((p) => p.start === f.start && dur(p) > 60 && dur(p) < dur(f) - 60 && (dur(f) - dur(p)) < 100);
      if (prior) derived.add(qtrEnd(f.end));
    }
    const all = new Set([...threeMonth, ...derived]);
    if (threeMonth.size >= 3) direct++;
    else if (all.size >= 3) derivable++;
    else none++;
  }
  console.log(`\nquarterly capex, 120 random 10-K filers (last ~4 quarters): ≥3 direct 3-month facts ${direct}; needs YTD differencing ${derivable}; not available ${none}`);
}

// ═════════════════════════════════════════════════════════════════════════════
async function partSegments() {
  const randomAll = sample([...UNIVERSE.keys()].filter((c) => !purposiveCiks.includes(c)), 75, 11);
  const cohort = [...purposiveCiks, ...randomAll];
  const REV = /^(us-gaap:(Revenues|RevenueFromContractWithCustomerExcludingAssessedTax|RevenueFromContractWithCustomerIncludingAssessedTax|SalesRevenueNet)|ifrs-full:Revenue)$/;
  const tally = { filers: 0, noInstance: 0, segAxis2: 0, segAxis1: 0, prodAxis: 0, customAxis: 0, neither: 0 };
  const rows = [];
  let instBytes = 0;
  for (const cik of cohort) {
    const a = await latestAnnual(cik, ["10-K", "20-F", "40-F"]);
    if (!a) { tally.noInstance++; continue; }
    const idx = await get(docUrl(cik, a.accn, "index.json"));
    const file = idx.data?.directory?.item?.map((x) => x.name).find((n) => /_htm\.xml$/i.test(n)) ??
      idx.data?.directory?.item?.map((x) => x.name).find((n) => /\.xml$/i.test(n) && !/(FilingSummary|_cal|_def|_lab|_pre|MetaLinks)/i.test(n));
    if (!file) { tally.noInstance++; rows.push(`${label(cik)} ${a.form} ${a.filingDate}: no XBRL instance`); continue; }
    const inst = await get(docUrl(cik, a.accn, file), { json: false });
    if (!inst.data) { tally.noInstance++; continue; }
    tally.filers++;
    instBytes += inst.data.length;
    const x = inst.data;
    // contexts -> [{axis, member}]
    const ctx = new Map();
    for (const m of x.matchAll(/<(?:xbrli:)?context\b[^>]*id="([^"]+)"[\s\S]*?<\/(?:xbrli:)?context>/g)) {
      const dims = [...m[0].matchAll(/<xbrldi:explicitMember[^>]*dimension="([^"]+)"[^>]*>([^<]+)</g)].map((d) => [d[1], d[2].trim()]);
      ctx.set(m[1], dims);
    }
    const members = { seg: new Set(), prod: new Set(), custom: new Set() };
    for (const f of x.matchAll(/<([a-z-]+:[A-Za-z]+)\b[^>]*contextRef="([^"]+)"[^>]*>/g)) {
      if (!REV.test(f[1])) continue;
      // A segment fact usually carries srt:ConsolidationItemsAxis=OperatingSegmentsMember
      // beside the segment axis; that axis says "segment total", not a second cut.
      const dims = (ctx.get(f[2]) ?? []).filter(([ax]) => ax !== "srt:ConsolidationItemsAxis");
      if (dims.length !== 1) continue; // single-axis breakdowns only
      const [axis, member] = dims[0];
      if (axis === "us-gaap:StatementBusinessSegmentsAxis" || axis === "ifrs-full:SegmentsAxis") members.seg.add(member);
      else if (axis === "srt:ProductOrServiceAxis" || axis === "ifrs-full:ProductsAndServicesAxis") members.prod.add(member);
      else if (!/Geograph|Country|Region|Consolidat|Restatement|Adjust|Scenario|Legal|Range|Currency/i.test(axis)) members.custom.add(`${axis}=${member}`);
    }
    if (members.seg.size >= 2) tally.segAxis2++;
    else if (members.seg.size === 1) tally.segAxis1++;
    if (members.prod.size >= 2) tally.prodAxis++;
    if (members.custom.size >= 2) tally.customAxis++;
    if (members.seg.size < 2 && members.prod.size < 2 && members.custom.size < 2) tally.neither++;
    const isP = purposiveCiks.includes(cik);
    rows.push(`${isP ? "P" : "R"} ${label(cik)} ${a.form} ${a.filingDate} seg[${members.seg.size}] ${[...members.seg].slice(0, 6).join(",")} | prod[${members.prod.size}] ${[...members.prod].slice(0, 5).join(",")} | custom[${members.custom.size}] ${[...members.custom].slice(0, 3).join(",")}`);
  }
  console.log(`\n=== SEGMENTS: latest annual XBRL instance, ${cohort.length} filers (${purposiveCiks.length} purposive P + ${randomAll.length} random R) ===`);
  console.log(JSON.stringify(tally));
  const rOnly = rows.filter((r) => r.startsWith("R "));
  const rSeg = rOnly.filter((r) => !/seg\[[01]\]/.test(r)).length;
  console.log(`random subset: ${rOnly.length} read; ≥2 segment-axis revenue members: ${rSeg}`);
  console.log(`instance bytes read: ${instBytes}`);
  for (const r of rows) console.log("  " + r);
  console.log(`\nSUMMARY ${JSON.stringify(tally)}; random subset ≥2 segment members ${rSeg} of ${rOnly.length}`);
}

// ═════════════════════════════════════════════════════════════════════════════
async function partLinks() {
  const [i, n] = (process.env.SHARD || "1/1").split("/").map(Number);
  const mine = LINK_SAMPLE.filter((_, k) => k % n === i - 1);
  console.log(`\n=== LINKS shard ${i}/${n}: ${mine.length} of ${LINK_SAMPLE.length} filers ===`);
  const totals = { filers: 0, cueSentences: 0, links: 0, mapped: 0 };
  for (const cik of mine) {
    const a = await latestAnnual(cik, ["10-K"]);
    if (!a) { console.log(`\n## ${label(cik)}: no 10-K in recent filings`); continue; }
    const r = await get(docUrl(cik, a.accn, a.primaryDocument), { json: false });
    if (!r.data) { console.log(`\n## ${label(cik)}: document fetch ${r.status}`); continue; }
    totals.filers++;
    const sents = sentences(htmlToText(r.data));
    const cue = sents.filter((s) => SUPPLIER_CUE.test(s) || CUSTOMER_CUE.test(s));
    // candidate pool for the hand check: cue sentences with a capitalised token
    // that is not sentence-initial and not a generic word
    const GENERIC = /^(We|Our|The|In|If|For|Company|Item|Part|Risk|United|States|U\.S\.|US|Federal|China|Chinese|Taiwan|Europe|European|Asia|Note|Notes|Form|Annual|Report|SEC|GAAP|Board|Directors|Inc|Corporation|Consolidated|Financial|Statements|Fiscal|Year|Quarter|Accordingly|As|This|These|Such|Any|Some|Certain|Additionally|However|Although|Many|Most|Each|All)$/;
    const pool = cue.filter((s) => s.split(/\s+/).slice(1).some((w) => /^[A-Z][a-zA-Z&-]{2,}/.test(w) && !GENERIC.test(w.replace(/[^A-Za-z.&-]/g, ""))));
    totals.cueSentences += cue.length;
    const links = new Map();
    for (const s of cue) {
      const role = roleOf(s);
      if (!role) continue;
      for (const [name, v] of namedParties(s, cik)) {
        const k = `${role}:${name}`;
        if (!links.has(k)) links.set(k, { role, name, ...v, quote: s.slice(0, 260) });
      }
    }
    totals.links += links.size;
    totals.mapped += [...links.values()].filter((l) => l.cik).length;
    console.log(`\n## ${label(cik)} ${a.form} ${a.filingDate} ${a.accn} sentences ${sents.length} cue ${cue.length} pool ${pool.length}`);
    console.log(`EXTRACTED (${links.size}):`);
    for (const l of links.values()) console.log(`  [${l.role}] ${l.name} -> ${l.ticker ?? "unmapped"} (${l.how}) :: ${l.quote}`);
    console.log(`POOL (first 30, for the hand check):`);
    pool.slice(0, 30).forEach((s, k) => console.log(`  p${k}: ${s.slice(0, 320)}`));
  }
  console.log(`\nTOTALS ${JSON.stringify(totals)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
async function partFts() {
  const NAME = process.env.NAME || "NVIDIA";
  const QUERIES = { NVIDIA: ['"NVIDIA"'], TSMC: ['"TSMC"', '"Taiwan Semiconductor"'], ASML: ['"ASML"'] }[NAME];
  const SELF = { NVIDIA: "NVDA", TSMC: "TSM", ASML: "ASML" }[NAME];
  const selfCik = symToCik.get(SELF);
  const filings = new Map(); // adsh -> {cik, file, name}
  let reported = {};
  for (const q of QUERIES) {
    for (let from = 0; from < 2000; from += 100) {
      const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=10-K&dateRange=custom&startdt=${YEAR_AGO}&enddt=${TODAY}&from=${from}`;
      const r = await get(url);
      const h = r.data?.hits;
      if (!h) { console.log(`fts ${q} from ${from}: status ${r.status}`); break; }
      if (from === 0) reported[q] = h.total;
      for (const x of h.hits) {
        const [adsh, file] = x._id.split(":");
        if (x._source.form !== "10-K") continue; // exhibits of a 10-K also index under form 10-K via root_forms; keep main form only
        const cik = Number(x._source.ciks?.[0]);
        const prev = filings.get(adsh);
        const isMain = /10-?k/i.test(file) || !prev;
        if (!prev || isMain) filings.set(adsh, { cik, file, name: x._source.display_names?.[0] ?? "" });
      }
      if (h.hits.length < 100) break;
    }
  }
  console.log(`\n=== FTS ${NAME}: 10-K filings ${YEAR_AGO}..${TODAY}; EDGAR totals ${JSON.stringify(reported)}; distinct filings ${filings.size} ===`);
  const NAME_RE = { NVIDIA: /\bNVIDIA\b/i, TSMC: /\b(TSMC|Taiwan Semiconductor)\b/i, ASML: /\bASML\b/ }[NAME];
  const cls = { supplier: 0, customer: 0, competitor: 0, other: 0, self: 0, notFound: 0 };
  const ex = { supplier: [], customer: [], competitor: [], other: [] };
  const CAP = Number(process.env.CAP || 450);
  const list = [...filings.entries()].slice(0, CAP);
  const COMP = /\b(compet\w*|rival)\b/i;
  const inUniverse = { supplier: 0, any: 0 };
  for (const [adsh, f] of list) {
    if (f.cik === selfCik) { cls.self++; continue; }
    // the hit may be an exhibit; read the filing's main document instead
    const sub = await submissions(f.cik);
    const row = recentRows(sub).find((r) => r.accn === adsh);
    const doc = row?.primaryDocument ?? f.file;
    const r = await get(docUrl(f.cik, adsh, doc), { json: false });
    if (!r.data) { cls.notFound++; continue; }
    const hitsS = sentences(htmlToText(r.data)).filter((s) => NAME_RE.test(s));
    if (!hitsS.length) { cls.notFound++; continue; }
    const kinds = new Set(hitsS.map((s) => (SUPPLIER_CUE.test(s) ? "supplier" : CUSTOMER_CUE.test(s) ? "customer" : COMP.test(s) ? "competitor" : "other")));
    const k = kinds.has("supplier") ? "supplier" : kinds.has("customer") ? "customer" : kinds.has("competitor") ? "competitor" : "other";
    cls[k]++;
    if (UNIVERSE.has(f.cik)) { inUniverse.any++; if (k === "supplier") inUniverse.supplier++; }
    const s = hitsS.find((x) => (k === "supplier" ? SUPPLIER_CUE.test(x) : k === "customer" ? CUSTOMER_CUE.test(x) : k === "competitor" ? COMP.test(x) : true));
    if (ex[k].length < 25) ex[k].push(`${f.name.slice(0, 40)} :: ${s.slice(0, 300)}`);
  }
  console.log(`read ${list.length} filings (cap ${CAP}); by strongest context: ${JSON.stringify(cls)}; in our universe: ${JSON.stringify(inUniverse)}`);
  for (const [k, arr] of Object.entries(ex)) {
    console.log(`\n-- ${k} examples (${arr.length})`);
    arr.forEach((s, i) => console.log(`  ${k[0]}${i}: ${s}`));
  }
}

// ═════════════════════════════════════════════════════════════════════════════
async function part8k() {
  const all = [];
  let done = 0;
  for (const cik of UNIVERSE.keys()) {
    const sub = await submissions(cik);
    for (const r of recentRows(sub)) {
      if (!/^8-K/.test(r.form) || r.filingDate < YEAR_AGO) continue;
      if (r.items.split(",").map((s) => s.trim()).includes("1.01")) all.push({ cik, ...r });
    }
    if (++done % 500 === 0) console.log(`  submissions read ${done}/${UNIVERSE.size}, 1.01 so far ${all.length}`);
  }
  const filers = new Set(all.map((x) => x.cik));
  const amend = all.filter((x) => x.form !== "8-K").length;
  console.log(`\n=== 8-K ITEM 1.01, ${YEAR_AGO}..${TODAY}, universe ${UNIVERSE.size} CIKs ===`);
  console.log(`filings ${all.length} (8-K/A ${amend}) from ${filers.size} filers`);
  const bySic = {};
  for (const x of all) { const d = sicDivision(UNIVERSE.get(x.cik).sic); bySic[d] = (bySic[d] ?? 0) + 1; }
  console.log(`by SIC division ${JSON.stringify(bySic)}`);
  // counterparty on a random sample
  const S = sample(all.filter((x) => x.form === "8-K"), Number(process.env.N8K || 120), 101);
  let named = 0, mapped = 0;
  const COUNTER = /\b(?:by and )?(?:between|among)\s+(?:the Company|[A-Z][^,;()]{2,80}?)(?:,|\s)(?:[^;]{0,200}?)\band\s+([A-Z][A-Za-z0-9&.,' -]{2,90}?)(?=\s*(?:\(|,|;| a | an |\.\s))|\bwith\s+([A-Z][A-Za-z0-9&.' -]{2,70}?(?:Inc\.?|Corporation|Corp\.?|LLC|L\.P\.|Ltd\.?|N\.A\.|plc|Company|Bank))/g;
  const out = [];
  for (const x of S) {
    const r = await get(docUrl(x.cik, x.accn, x.primaryDocument), { json: false });
    if (!r.data) { out.push(`${label(x.cik)} ${x.filingDate}: fetch ${r.status}`); continue; }
    const t = htmlToText(r.data).replace(/\s+/g, " ");
    const at = t.search(/Item\s*1\.01/i);
    const sect = at >= 0 ? t.slice(at, at + 2500).split(/Item\s*(?:1\.02|2\.\d\d|3\.\d\d|5\.\d\d|7\.01|8\.01|9\.01)/i)[0] : t.slice(0, 2500);
    const parties = new Map();
    for (const m of sect.matchAll(COUNTER)) {
      const p = (m[1] ?? m[2] ?? "").trim().replace(/\s+(as|the|a)$/i, "");
      if (p && !/^(the Company|the Lenders|the lenders|certain|each|other|various|its|the Borrower|the Purchasers)/i.test(p)) parties.set(p, null);
    }
    for (const [name, v] of namedParties(sect, x.cik)) parties.set(name, v);
    const resolved = [...parties.entries()].map(([p, v]) => {
      const cik = v?.cik ?? NAME_TO_CIK.get(normName(p)) ?? null;
      return { p, cik: cik === x.cik ? null : cik };
    });
    if (resolved.length) named++;
    if (resolved.some((q) => q.cik)) mapped++;
    out.push(`${label(x.cik)} ${x.filingDate} ${x.accn} parties: ${resolved.map((q) => `${q.p}${q.cik ? `=>${TICKERS.get(q.cik)?.tickers[0]}` : ""}`).join(" | ") || "(none)"}\n      TEXT: ${sect.slice(0, 700)}`);
  }
  console.log(`\nsample ${S.length}: extractor named ≥1 party in ${named}; ≥1 party mapped to a ticker in ${mapped}`);
  out.forEach((o, i) => console.log(`  k${i}: ${o}`));
}

// ═════════════════════════════════════════════════════════════════════════════
async function partUsa() {
  const API = "https://api.usaspending.gov/api/v2";
  const start = "2025-09-01", end = "2026-08-31"; // 12 full months
  const filters = { time_period: [{ start_date: start, end_date: end }], award_type_codes: ["A", "B", "C", "D"] };
  const t0 = Date.now();
  console.log(`usaspending: starting (pages ${process.env.USA_PAGES || 30}, detail ${process.env.USA_DETAIL || 600})`);
  const cnt = await get(`${API}/search/spending_by_award_count/`, { method: "POST", body: { filters }, gapMs: 400 });
  console.log(`\n=== USASPENDING contracts ${start}..${end} ===`);
  console.log(`award count: ${JSON.stringify(cnt.data?.results ?? cnt)} (${Date.now() - t0} ms)`);
  const hdr = [...(cnt.headers?.entries?.() ?? [])].filter(([k]) => /rate|limit|retry|cache|server|x-/i.test(k));
  console.log(`response headers of note: ${JSON.stringify(hdr)}`);
  const ot = await get(`${API}/search/spending_over_time/`, { method: "POST", body: { group: "month", filters }, gapMs: 400 });
  const total = (ot.data?.results ?? []).reduce((a, r) => a + (r.aggregated_amount ?? 0), 0);
  console.log(`total obligations (spending_over_time, month buckets): $${(total / 1e9).toFixed(1)}bn`);
  // top recipients by obligations, paged
  const rec = [];
  const PAGES = Number(process.env.USA_PAGES || 30);
  let lat = [];
  for (let page = 1; page <= PAGES; page++) {
    const t = Date.now();
    const r = await get(`${API}/search/spending_by_category/recipient/`, {
      method: "POST", body: { filters, category: "recipient", limit: 100, page }, gapMs: 400,
    });
    lat.push(Date.now() - t);
    console.log(`  recipient page ${page}: status ${r.status} ${Date.now() - t} ms`);
    if (!r.data) { console.log(`recipient page ${page}: status ${r.status} ${r.text ?? ""}`); break; }
    rec.push(...r.data.results);
    if (!r.data.page_metadata?.hasNext) break;
  }
  lat.sort((a, b) => a - b);
  console.log(`recipient rows ${rec.length}; page latency median ${lat[Math.floor(lat.length / 2)]} ms, max ${lat[lat.length - 1]} ms`);
  const topSum = rec.reduce((a, r) => a + (r.amount ?? 0), 0);
  console.log(`top ${rec.length} recipients hold $${(topSum / 1e9).toFixed(1)}bn (${((100 * topSum) / total).toFixed(1)}% of total)`);
  // parent roll-up for the top recipients
  const TOP_DETAIL = Number(process.env.USA_DETAIL || 600);
  const mappedBy = { name: 0, parent: 0 };
  const matched = [];
  const unmatchedTop = [];
  let mappedAmt = 0;
  const bySector = {};
  const sicCache = new Map();
  for (let k = 0; k < rec.length; k++) {
    const r = rec[k];
    let cik = NAME_TO_CIK.get(normName(r.name ?? "")) ?? null;
    let how = cik ? "name" : null;
    let parentName = null;
    if (!cik && k < TOP_DETAIL && r.recipient_id) {
      const d = await get(`${API}/recipient/${encodeURIComponent(r.recipient_id)}/`, { gapMs: 250 });
      parentName = d.data?.parent_name ?? null;
      const pc = parentName ? NAME_TO_CIK.get(normName(parentName)) : null;
      if (pc) { cik = pc; how = "parent"; }
    }
    if (cik) {
      mappedBy[how]++;
      mappedAmt += r.amount ?? 0;
      let sic = UNIVERSE.get(cik)?.sic;
      if (!sic) {
        if (!sicCache.has(cik)) sicCache.set(cik, (await submissions(cik))?.sic ?? null);
        sic = sicCache.get(cik);
      }
      const div = sicDivision(sic);
      bySector[div] = bySector[div] ?? { recipients: 0, amount: 0 };
      bySector[div].recipients++; bySector[div].amount += r.amount ?? 0;
      if (matched.length < 400) matched.push(`${String(k + 1).padStart(4)} ${r.name} ${parentName ? `[parent ${parentName}] ` : ""}=> ${TICKERS.get(cik)?.tickers[0]} (${how}) $${((r.amount ?? 0) / 1e6).toFixed(0)}m${UNIVERSE.has(cik) ? " U" : ""}`);
    } else if (k < 150) unmatchedTop.push(`${String(k + 1).padStart(4)} ${r.name}${parentName ? ` [parent ${parentName}]` : ""} $${((r.amount ?? 0) / 1e6).toFixed(0)}m`);
  }
  const inU = matched.filter((m) => m.endsWith(" U")).length;
  console.log(`mapped recipients ${mappedBy.name + mappedBy.parent} of ${rec.length} (by name ${mappedBy.name}, by parent ${mappedBy.parent}); in our universe (of first 400 listed) ${inU}`);
  console.log(`mapped dollars $${(mappedAmt / 1e9).toFixed(1)}bn = ${((100 * mappedAmt) / topSum).toFixed(1)}% of the top-${rec.length} dollars, ${((100 * mappedAmt) / total).toFixed(1)}% of all contract obligations`);
  console.log(`by recipient SIC division:`);
  for (const [d, a] of Object.entries(bySector).sort((a, b) => b[1].amount - a[1].amount))
    console.log(`   ${d.padEnd(34)} recipients ${String(a.recipients).padStart(4)}  $${(a.amount / 1e9).toFixed(1)}bn`);
  const layer = JSON.stringify(matched.map((m) => ({ t: "XXXX", a: 1234567890, n: 1234 })));
  console.log(`contracts-layer record (one row per mapped recipient: ticker, amount, awards): ~${layer.length} bytes for ${matched.length} rows`);
  console.log(`\nMATCHED (first ${matched.length}):`);
  matched.forEach((m) => console.log("  " + m));
  console.log(`\nUNMATCHED among the top 150:`);
  unmatchedTop.forEach((m) => console.log("  " + m));
}

// WHY ifrs-full FRAMES CAME BACK EMPTY after CY2021: status of the frame calls
// themselves, and which frames/units a few known IFRS filers' own facts carry.
async function partIfrsDiag() {
  for (const [tax, c, u, p] of [["ifrs-full", "Revenue", "USD", "CY2024"], ["ifrs-full", "Revenue", "EUR", "CY2024"],
    ["ifrs-full", "Revenue", "USD", "CY2021"], ["ifrs-full", "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", "USD", "CY2024"]]) {
    const r = await get(`https://data.sec.gov/api/xbrl/frames/${tax}/${c}/${u}/${p}.json`);
    console.log(`frame ${tax}/${c}/${u}/${p}: status ${r.status} rows ${r.data?.data?.length ?? "-"} ${r.text ?? ""}`);
  }
  for (const sym of ["AZN", "NVS", "SAP", "TM", "ASML", "TSM", "HSBC", "SHOP"]) {
    const cik = symToCik.get(sym);
    if (!cik) { console.log(`${sym}: no CIK`); continue; }
    const r = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cik)}.json`);
    const f = r.data?.facts ?? {};
    const tx = Object.keys(f).map((t) => `${t}:${Object.keys(f[t]).length}`).join(" ");
    const rev = f["ifrs-full"]?.Revenue?.units ?? {};
    const capex = f["ifrs-full"]?.PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities?.units ?? {};
    const show = (units) => Object.entries(units).map(([unit, rows]) => `${unit}[${rows.length}; frames ${[...new Set(rows.map((x) => x.frame).filter(Boolean))].slice(-6).join(",")}; latest end ${rows.map((x) => x.end).sort().pop()}; forms ${[...new Set(rows.map((x) => x.form))].join("/")}]`).join(" ");
    console.log(`${sym} cik ${cik} status ${r.status} taxonomies ${tx}\n   Revenue ${show(rev) || "-"}\n   Capex ${show(capex) || "-"}`);
  }
}

// IFRS COVERAGE FROM companyfacts, because data.sec.gov serves NO ifrs-full
// frames after CY2021 (404) while the filers' own companyfacts carry them.
// Every 20-F / 40-F filer in the universe, annual CY2024 and CY2025 frames.
async function partIfrsCf() {
  const CH = {
    capex: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", "PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets"],
    revenue: ["Revenue", "RevenueFromContractsWithCustomers", "RevenueFromSaleOfGoods"],
    rnd: ["ResearchAndDevelopmentExpense"],
    acquisitions: ["CashFlowsUsedInObtainingControlOfSubsidiariesOrOtherBusinessesClassifiedAsInvestingActivities"],
  };
  const fpi = [...UNIVERSE].filter(([, u]) => u.annualForm === "20-F" || u.annualForm === "40-F").map(([c]) => c);
  const t = { filers: fpi.length, read: 0, ifrs: 0, usgaapOnly: 0, neither: 0 };
  const res = {};
  for (const m of Object.keys(CH)) res[m] = { CY2024: 0, CY2025: 0, usd: 0, nonUsd: 0, units: {} };
  for (const cik of fpi) {
    const r = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cik)}.json`);
    const f = r.data?.facts;
    if (!f) continue;
    t.read++;
    const ifrs = f["ifrs-full"];
    if (!ifrs) { f["us-gaap"] ? t.usgaapOnly++ : t.neither++; continue; }
    t.ifrs++;
    for (const [m, chain] of Object.entries(CH)) {
      const c = chain.find((x) => ifrs[x]);
      if (!c) continue;
      let got24 = false, got25 = false, unit25 = null;
      for (const [unit, rows] of Object.entries(ifrs[c].units)) {
        for (const x of rows) {
          if (x.frame === "CY2024") got24 = true;
          if (x.frame === "CY2025") { got25 = true; unit25 = unit25 ?? unit; }
        }
      }
      if (got24) res[m].CY2024++;
      if (got25) { res[m].CY2025++; unit25 === "USD" ? res[m].usd++ : res[m].nonUsd++; res[m].units[unit25] = (res[m].units[unit25] ?? 0) + 1; }
    }
  }
  console.log(`\n=== IFRS via companyfacts: ${JSON.stringify(t)} ===`);
  for (const [m, v] of Object.entries(res)) console.log(`${m.padEnd(13)} CY2024 ${v.CY2024}  CY2025 ${v.CY2025} (USD ${v.usd}, non-USD ${v.nonUsd}) units ${JSON.stringify(v.units)}`);
}

// D2 CANDIDATE RECEIVERS (#563 COWORK #1): for each name, the latest annual
// filing's revenue broken out on the SEGMENT axis and on the PRODUCT/SERVICE
// axis, with the filer's OWN label for each member (from its label linkbase),
// the current and prior fiscal-year values, and the accession. This is what
// the curated list is chosen from; nothing is summed across companies.
const RECEIVER_CANDIDATES = (process.env.SYMBOLS ||
  "NVDA AMD AVGO MRVL INTC MU ARM ALAB CRDO MPWR TSM ASML AMAT LRCX KLAC TER SMCI DELL HPE ANET CSCO CIEN COHR LITE FN JBL CLS FLEX VRT ETN GEV PWR EME FIX MTZ HUBB NVT MOD TT JCI GLW WDC STX SNDK NTAP MSFT AMZN GOOGL ORCL IBM CRWV NBIS APLD IREN EQIX DLR CEG VST TLN AAOI AMKR ONTO SNPS CDNS")
  .split(/[,\s]+/).filter(Boolean);
function parseLabels(xml) {
  // loc label -> element name; label resource -> text (standard/terse); arc from loc -> resource
  const locs = new Map(), res = new Map(), out = new Map();
  for (const m of xml.matchAll(/<(?:link:)?loc\b[^>]*xlink:href="[^"#]*#([^"]+)"[^>]*xlink:label="([^"]+)"/g)) locs.set(m[2], m[1]);
  for (const m of xml.matchAll(/<(?:link:)?loc\b[^>]*xlink:label="([^"]+)"[^>]*xlink:href="[^"#]*#([^"]+)"/g)) locs.set(m[1], m[2]);
  for (const m of xml.matchAll(/<(?:link:)?label\b([^>]*)>([^<]*)<\/(?:link:)?label>/g)) {
    const lab = (m[1].match(/xlink:label="([^"]+)"/) ?? [])[1];
    const role = (m[1].match(/xlink:role="([^"]+)"/) ?? [])[1] ?? "";
    if (!lab) continue;
    const arr = res.get(lab) ?? [];
    arr.push({ role, text: m[2].trim() });
    res.set(lab, arr);
  }
  for (const m of xml.matchAll(/<(?:link:)?labelArc\b([^>]*)\/?>/g)) {
    const from = (m[1].match(/xlink:from="([^"]+)"/) ?? [])[1];
    const to = (m[1].match(/xlink:to="([^"]+)"/) ?? [])[1];
    const el = locs.get(from);
    if (!el || !res.has(to)) continue;
    const pick = (r) => res.get(to).find((x) => x.role.endsWith(r))?.text;
    const text = pick("/terseLabel") ?? pick("/label") ?? res.get(to)[0].text;
    // element ids look like "mu_DRAMProductsMember"; key by the local name
    out.set(el.replace(/^[^_]+_/, ""), text);
  }
  return out;
}
const camel = (m) => m.replace(/^[^:]+:/, "").replace(/Member$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
async function partReceivers() {
  const REV = /^(us-gaap:(Revenues|RevenueFromContractWithCustomerExcludingAssessedTax|RevenueFromContractWithCustomerIncludingAssessedTax)|ifrs-full:(Revenue|RevenueFromContractsWithCustomers))$/;
  console.log(`\n=== RECEIVERS: ${RECEIVER_CANDIDATES.length} candidates ===`);
  for (const sym of [...new Set(RECEIVER_CANDIDATES)]) {
    const cik = symToCik.get(sym);
    if (!cik) { console.log(`\n## ${sym}: no CIK`); continue; }
    const a = await latestAnnual(cik, ["10-K", "20-F", "40-F"]);
    if (!a) { console.log(`\n## ${sym}: no annual filing in recent`); continue; }
    const idx = await get(docUrl(cik, a.accn, "index.json"));
    const names = idx.data?.directory?.item?.map((x) => x.name) ?? [];
    const instName = names.find((n) => /_htm\.xml$/i.test(n)) ?? names.find((n) => /\.xml$/i.test(n) && !/(FilingSummary|_cal|_def|_lab|_pre|MetaLinks)/i.test(n));
    const labName = names.find((n) => /_lab\.xml$/i.test(n));
    if (!instName) { console.log(`\n## ${sym} ${a.form} ${a.filingDate} ${a.accn}: no XBRL instance`); continue; }
    const inst = (await get(docUrl(cik, a.accn, instName), { json: false })).data ?? "";
    const labels = labName ? parseLabels((await get(docUrl(cik, a.accn, labName), { json: false })).data ?? "") : new Map();
    const pe = (inst.match(/<dei:DocumentPeriodEndDate[^>]*>([^<]+)</) ?? [])[1];
    const cur = (inst.match(/<dei:CurrentFiscalYearEndDate[^>]*>([^<]+)</) ?? [])[1];
    const ctx = new Map();
    for (const m of inst.matchAll(/<(?:xbrli:)?context\b[^>]*id="([^"]+)"[\s\S]*?<\/(?:xbrli:)?context>/g)) {
      const dims = [...m[0].matchAll(/<xbrldi:explicitMember[^>]*dimension="([^"]+)"[^>]*>([^<]+)</g)].map((d) => [d[1], d[2].trim()]);
      const st = (m[0].match(/<(?:xbrli:)?startDate>([^<]+)</) ?? [])[1];
      const en = (m[0].match(/<(?:xbrli:)?endDate>([^<]+)</) ?? [])[1];
      ctx.set(m[1], { dims, st, en });
    }
    // fiscal-year durations present on revenue facts: newest end = current FY
    const byAxis = { seg: new Map(), prod: new Map() }; // member -> {cy, py}
    let fyEnd = null, total = null, unit = null;
    const facts = [];
    for (const f of inst.matchAll(/<([a-z-]+:[A-Za-z]+)\b([^>]*)contextRef="([^"]+)"([^>]*)>([^<]*)</g)) {
      if (!REV.test(f[1])) continue;
      const c = ctx.get(f[3]);
      if (!c?.st || !c?.en) continue;
      const days = (Date.parse(c.en) - Date.parse(c.st)) / 864e5;
      if (days < 340 || days > 380) continue;
      const v = Number(f[5].replace(/,/g, ""));
      if (!Number.isFinite(v)) continue;
      const u = ((f[2] + f[4]).match(/unitRef="([^"]+)"/) ?? [])[1];
      facts.push({ c, v, u });
      if (!fyEnd || c.en > fyEnd) fyEnd = c.en;
    }
    for (const { c, v, u } of facts) {
      const dims = c.dims.filter(([ax]) => ax !== "srt:ConsolidationItemsAxis");
      const gap = (Date.parse(fyEnd) - Date.parse(c.en)) / 864e5;
      const when = c.en === fyEnd ? "cy" : gap > 330 && gap < 400 ? "py" : null;
      if (!when) continue;
      if (!dims.length && when === "cy") { total = total ?? v; unit = unit ?? u; }
      if (dims.length !== 1) continue;
      const [axis, member] = dims[0];
      const k = axis === "us-gaap:StatementBusinessSegmentsAxis" || axis === "ifrs-full:SegmentsAxis" ? "seg"
        : axis === "srt:ProductOrServiceAxis" || axis === "ifrs-full:ProductsAndServicesAxis" ? "prod" : null;
      if (!k) continue;
      const row = byAxis[k].get(member) ?? {};
      if (row[when] === undefined) row[when] = v;
      byAxis[k].set(member, row);
    }
    const fmt = (v) => (v === undefined ? "—" : `${(v / 1e9).toFixed(2)}bn`);
    console.log(`\n## ${sym} ${a.form} filed ${a.filingDate} accn ${a.accn} FY end ${fyEnd ?? pe ?? "?"} total ${fmt(total ?? undefined)} ${unit ?? ""} labels ${labels.size}`);
    for (const [k, name] of [["seg", "SEGMENT"], ["prod", "PRODUCT"]]) {
      for (const [member, r] of [...byAxis[k]].sort((x, y) => (y[1].cy ?? 0) - (x[1].cy ?? 0)).slice(0, 12)) {
        const local = member.replace(/^[^:]+:/, "");
        const lab = labels.get(local) ?? camel(member);
        const g = r.cy !== undefined && r.py ? ` (${(((r.cy - r.py) / Math.abs(r.py)) * 100).toFixed(0)}%)` : "";
        console.log(`  ${name} ${member} "${lab}" FY ${fmt(r.cy)} prior ${fmt(r.py)}${g}`);
      }
    }
  }
}

const PARTS = { frames: partFrames, segments: partSegments, links: partLinks, fts: partFts, "8k": part8k, usa: partUsa, ifrsdiag: partIfrsDiag, ifrscf: partIfrsCf, receivers: partReceivers };
if (!PARTS[PART]) {
  console.error(`FATAL: PART must be one of ${Object.keys(PARTS).join(", ")}`);
  process.exit(2);
}
const t0 = Date.now();
await PARTS[PART]();
console.log(`\n[${PART}] requests ${requests}, bytes read ${(bytes / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s. Redis commands: 0 (no store touched).`);
