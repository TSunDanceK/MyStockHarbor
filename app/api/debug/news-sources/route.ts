import { guardDebugRequest } from "@/lib/server/backfillAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Debug-only probe: can a Vercel function reach the candidate free news
// sources, and what does each one actually return?
//
// WHY IT EXISTS
// -------------
// FMP needs removing from the news path (commercial licence quoted at $20K;
// see claude/news-api-market-survey-2026-09-13.md). The candidates all answered
// when probed from outside Vercel -- but the IP the request comes from is the
// part that matters, and run 1 proved it: every Nasdaq feed timed out from
// iad1 while answering fine elsewhere.
//
// RUN 1 VERDICTS (2026-09-13, iad1, preview)
// ------------------------------------------
//   FAIL  nasdaq rssoutbound  x8, all uniform 12s timeouts -> block, not load
//   PASS  google news rss     100 items / 95 days for MU, 452ms
//   PASS  data.sec.gov        1001 filings, sicDescription present
//   PASS  globenewswire       ticker in <category>
//   PASS  prnewswire          prn:industry, media:credit = "PRNewswire"
//   PASS  marketwatch         media:credit = "Sean Rayford/Getty Images"
//   PASS  cnbc                30 items, metadata:sponsored flag
//   FAIL  businesswire        951 bytes, no items -- dead feed token, dropped
//   FAIL  sec company_tickers 403 (SEC_USER_AGENT was unset)
//
// WHAT RUN 2 ADDS
// ---------------
// 1. Nasdaq at 25s with one retry. A uniform timeout could in principle be a
//    slow origin; this settles block-versus-slow rather than assuming.
// 2. Google News query precision. It is a PLAIN TEXT SEARCH with no notion of
//    a ticker: q=MU matches Manchester United. Five query shapes are scored by
//    what fraction of returned headlines actually mention the company, so the
//    production query shape is chosen on evidence. AAPL is in the set on
//    purpose -- "Apple" is the worst precision case available.
//
// DELIBERATELY INERT
// ------------------
// No Redis reads or writes, no FMP calls, no cache population, no new npm
// package (the lockfile cannot be regenerated from the agent sandbox, so the
// XML is parsed with regexes -- a probe needs field names and counts, not a
// correct tree).
//
// See README.md in this folder. SAFE TO DELETE once the adapter lands.

type Probe = {
  group: "per-stock" | "headlines" | "wire" | "reference" | "query-shape";
  name: string;
  url: string;
  kind: "xml" | "json";
  note?: string;
  retry?: boolean;
  timeoutMs?: number;
  // When set, headlines are scored for whether they actually mention this
  // company / ticker -- the precision measure for text-search sources.
  expect?: { name: string; ticker: string };
};

const SEC_UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (CONTACT-NOT-SET)";
const GENERIC_UA =
  "Mozilla/5.0 (compatible; MyStockHarborBot/1.0; +https://www.mystockharbor.com)";

// Company names for the probe symbols. Production reads these from the
// universe; hardcoded here so the probe is self-contained.
const NAMES: Record<string, string> = {
  MU: "Micron Technology",
  PLAB: "Photronics",
  AAPL: "Apple",
  ASTS: "AST SpaceMobile",
  CYRX: "Cryoport",
};

function gnews(query: string) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

function buildProbes(symbols: string[]): Probe[] {
  // --- Nasdaq, retested properly before being written off -----------------
  const nasdaq: Probe[] = [
    {
      group: "per-stock",
      name: "nasdaq rssoutbound symbol=MU",
      url: "https://www.nasdaq.com/feed/rssoutbound?symbol=MU",
      kind: "xml",
      retry: true,
      timeoutMs: 25000,
      note: "run 1: 12s timeout. 25s + retry settles block-vs-slow",
    },
    {
      group: "headlines",
      name: "nasdaq category=Markets",
      url: "https://www.nasdaq.com/feed/rssoutbound?category=Markets",
      kind: "xml",
      retry: true,
      timeoutMs: 25000,
    },
  ];

  // --- Google News query shapes, scored for precision ---------------------
  // The whole question: does a text search return this company's news, or
  // everything containing these characters?
  const shapes: Probe[] = [
    { label: "bare ticker", q: "MU" },
    { label: "ticker + stock", q: "MU stock" },
    { label: "name in quotes", q: '"Micron Technology"' },
    { label: "name in quotes + stock", q: '"Micron Technology" stock' },
    { label: "name + ticker qualifier", q: '"Micron Technology" (MU) stock' },
  ].map((s) => ({
    group: "query-shape" as const,
    name: `gnews MU — ${s.label} — q=${s.q}`,
    url: gnews(s.q),
    kind: "xml" as const,
    expect: { name: "Micron", ticker: "MU" },
  }));

  // --- Google News per symbol, using the name-based shape ----------------
  const perStock: Probe[] = symbols.map((sym) => {
    const name = NAMES[sym] ?? sym;
    return {
      group: "per-stock" as const,
      name: `gnews ${sym} — "${name}" stock`,
      url: gnews(`"${name}" stock`),
      kind: "xml" as const,
      expect: { name: name.split(" ")[0], ticker: sym },
    };
  });

  return [
    ...nasdaq,
    ...shapes,
    ...perStock,
    {
      group: "headlines",
      name: "marketwatch topstories",
      url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
      kind: "xml",
      note: "media:credit carries the image-permission signal",
    },
    {
      group: "headlines",
      name: "cnbc markets",
      url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
      kind: "xml",
    },
    {
      group: "wire",
      name: "globenewswire public companies",
      url: "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire---Public-Companies",
      kind: "xml",
      note: "ticker arrives in <category>",
    },
    {
      group: "wire",
      name: "prnewswire financial services",
      url: "https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss",
      kind: "xml",
    },
    {
      group: "reference",
      name: "sec submissions (MU CIK 723125)",
      url: "https://data.sec.gov/submissions/CIK0000723125.json",
      kind: "json",
    },
    {
      group: "reference",
      name: "sec company_tickers.json",
      url: "https://www.sec.gov/files/company_tickers.json",
      kind: "json",
      note: "run 1: 403 with SEC_USER_AGENT unset",
    },
  ];
}

function isSec(url: string) {
  return url.includes("sec.gov");
}

async function fetchOnce(url: string, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const started = Date.now();
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "user-agent": isSec(url) ? SEC_UA : GENERIC_UA,
        accept:
          "application/atom+xml,application/rss+xml,application/xml,application/json,text/xml,*/*",
        "accept-language": "en-GB,en;q=0.9",
      },
    });
    const body = await res.text();
    return {
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function itemBlocks(xml: string): string[] {
  const rss = xml.match(/<item[\s>][\s\S]*?<\/item>/gi);
  if (rss && rss.length) return rss;
  const atom = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi);
  return atom ?? [];
}

// Inline HTML inside <description> pollutes a naive tag scan (run 1 reported
// "a", "b", "br", "p", "strong" as GlobeNewswire fields). Strip descriptions
// before scanning so the field list is the feed's real vocabulary.
function fieldNames(blocks: string[]): string[] {
  const seen = new Set<string>();
  for (const block of blocks.slice(0, 10)) {
    const inner = block
      .replace(/^<(item|entry)[\s>][^>]*>?/i, "")
      .replace(/<description[\s\S]*?<\/description>/gi, "")
      .replace(/<content[\s\S]*?<\/content>/gi, "")
      .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
    const tags = inner.match(/<([a-zA-Z][\w:.-]*)(\s|\/?>)/g) ?? [];
    for (const raw of tags) {
      const name = raw.replace(/^<|[\s/>]+$/g, "");
      if (name.toLowerCase() === "item" || name.toLowerCase() === "entry") continue;
      seen.add(name);
    }
  }
  return [...seen].sort();
}

function tagValue(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2019;/g, "’")
    .replace(/\s+/g, " ")
    .trim();
}

function dateRange(blocks: string[]) {
  const stamps: number[] = [];
  for (const b of blocks) {
    const raw = tagValue(b, "pubDate") ?? tagValue(b, "published") ?? tagValue(b, "updated");
    if (!raw) continue;
    const t = Date.parse(raw);
    if (Number.isFinite(t)) stamps.push(t);
  }
  if (!stamps.length) return { newest: null, oldest: null, spanDays: null };
  const min = Math.min(...stamps);
  const max = Math.max(...stamps);
  return {
    newest: new Date(max).toISOString(),
    oldest: new Date(min).toISOString(),
    spanDays: Math.round((max - min) / 86400000),
  };
}

// The precision measure. A text-search feed will happily return articles that
// merely contain the characters searched for, so count how many headlines
// actually name the company, and surface the ones that do not.
function precision(blocks: string[], expect: { name: string; ticker: string }) {
  const titles = blocks
    .map((b) => tagValue(b, "title"))
    .filter((t): t is string => Boolean(t));
  if (!titles.length) return null;

  const nameRe = new RegExp(expect.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const tickerRe = new RegExp(`\\b${expect.ticker}\\b`);

  const hits = titles.filter((t) => nameRe.test(t) || tickerRe.test(t));
  const misses = titles.filter((t) => !nameRe.test(t) && !tickerRe.test(t));

  return {
    titles: titles.length,
    matched: hits.length,
    matchPct: Math.round((hits.length / titles.length) * 100),
    // The off-target headlines are the whole point -- eyeball these.
    sampleMisses: misses.slice(0, 5).map((t) => t.slice(0, 110)),
    sampleHits: hits.slice(0, 3).map((t) => t.slice(0, 110)),
  };
}

function firstItemSample(block: string | undefined) {
  if (!block) return null;
  const pick = [
    "title",
    "link",
    "source",
    "pubDate",
    "guid",
    "dc:creator",
    "category",
    "nasdaq:tickers",
    "prn:industry",
    "prn:subject",
    "media:credit",
    "metadata:sponsored",
  ];
  const out: Record<string, string> = {};
  for (const tag of pick) {
    const v = tagValue(block, tag);
    if (v) out[tag] = v.slice(0, 180);
  }
  const selfClosing = block.match(/<(media:content|media:thumbnail|enclosure)[^>]*\/?>/gi) ?? [];
  if (selfClosing.length) out["_mediaTags"] = selfClosing.slice(0, 2).join(" ").slice(0, 240);
  return out;
}

export async function GET(request: Request) {
  const denied = await guardDebugRequest(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const symbols = (params.get("symbols") ?? "MU,PLAB,AAPL,ASTS,CYRX")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 8);

  const probes = buildProbes(symbols);

  const results = await Promise.all(
    probes.map(async (p) => {
      const base = { group: p.group, name: p.name, url: p.url, note: p.note };
      const timeout = p.timeoutMs ?? 12000;
      let attempts = 0;

      const attempt = async (): Promise<Record<string, unknown>> => {
        attempts += 1;
        const { status, contentType, body, ms } = await fetchOnce(p.url, timeout);
        const common = {
          ...base,
          attempts,
          status,
          contentType: contentType.split(";")[0],
          bytes: body.length,
          ms,
        };

        if (status < 200 || status >= 300) {
          return { ...common, verdict: "FAIL", reason: `HTTP ${status}` };
        }
        const head = body.slice(0, 200).trimStart().toLowerCase();
        if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
          return { ...common, verdict: "FAIL", reason: "returned HTML, not a feed" };
        }

        if (p.kind === "json") {
          const data = JSON.parse(body) as Record<string, unknown>;
          const filings = (data.filings as { recent?: Record<string, unknown[]> } | undefined)
            ?.recent;
          return {
            ...common,
            verdict: "PASS",
            entryCount: filings
              ? (filings.accessionNumber?.length ?? 0)
              : Object.keys(data).length,
            sample: filings
              ? {
                  name: data.name,
                  tickers: data.tickers,
                  exchanges: data.exchanges,
                  sicDescription: data.sicDescription,
                }
              : (Object.values(data)[0] ?? null),
          };
        }

        const blocks = itemBlocks(body);
        if (!blocks.length) {
          return { ...common, verdict: "FAIL", reason: "no <item> or <entry> elements" };
        }
        return {
          ...common,
          verdict: "PASS",
          itemCount: blocks.length,
          ...dateRange(blocks),
          fields: fieldNames(blocks),
          precision: p.expect ? precision(blocks, p.expect) : undefined,
          firstItem: p.expect ? undefined : firstItemSample(blocks[0]),
        };
      };

      try {
        return await attempt();
      } catch (err) {
        const e = err as Error;
        const firstReason =
          e.name === "AbortError" ? `timeout after ${timeout / 1000}s` : `${e.name}: ${e.message}`;
        if (!p.retry) return { ...base, attempts, verdict: "FAIL", reason: firstReason };
        try {
          const retried = await attempt();
          return { ...retried, note: `${p.note ?? ""} (first attempt: ${firstReason})`.trim() };
        } catch (err2) {
          const e2 = err2 as Error;
          return {
            ...base,
            attempts,
            verdict: "FAIL",
            reason:
              e2.name === "AbortError"
                ? `timeout after ${timeout / 1000}s on both attempts -- treat as blocked`
                : `${e2.name}: ${e2.message}`,
          };
        }
      }
    })
  );

  const pass = results.filter((r) => r.verdict === "PASS").length;

  const rawSecUa = process.env.SEC_USER_AGENT ?? "";

  return Response.json(
    {
      ok: true,
      probedAt: new Date().toISOString(),
      region: process.env.VERCEL_REGION ?? null,
      env: process.env.VERCEL_ENV ?? null,
      secUserAgent: {
        set: Boolean(rawSecUa),
        hasContact: rawSecUa.includes("@"),
        length: rawSecUa.length,
      },
      symbols,
      summary: `${pass}/${results.length} PASS`,
      readingGuide:
        "query-shape rows: compare precision.matchPct and read precision.sampleMisses -- that is what a text search returns when it does not know what a ticker is.",
      results,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
