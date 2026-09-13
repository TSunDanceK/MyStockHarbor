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
// see claude/news-api-market-survey-2026-09-13.md). The candidates were probed
// from outside Vercel and answered, but the IP the request comes from is the
// part that matters: SEC and Nasdaq both treat datacentre ranges differently
// from residential ones, and an answer obtained from somewhere else is not
// evidence about this site.
//
// This route exists to settle that BEFORE any adapter is written, in the same
// spirit as /api/debug/fmp-endpoints -- measured verdicts, no assumptions
// carried forward.
//
// DELIBERATELY INERT
// ------------------
// No Redis reads or writes, no FMP calls, no cache population, no new npm
// package (the lockfile cannot be regenerated from the agent sandbox, so the
// XML is parsed with regexes rather than a parser dependency -- crude, but a
// probe only needs field names and counts, not a correct tree).
//
// See README.md in this folder. SAFE TO DELETE once the adapter lands and the
// verdicts are recorded.

type Probe = {
  group: "per-stock" | "headlines" | "wire" | "reference";
  name: string;
  url: string;
  kind: "xml" | "json";
  note?: string;
};

// SEC's fair-access policy requires a declared User-Agent carrying a contact
// address, and will block a generic one. Set SEC_USER_AGENT in Vercel env, in
// BOTH Production and Preview, to something like
// "MyStockHarbor contact@example.com". The fallback is deliberately obvious so
// an unset var shows up in the results rather than silently looking like a
// network failure.
const SEC_UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (CONTACT-NOT-SET)";
const GENERIC_UA =
  "Mozilla/5.0 (compatible; MyStockHarborBot/1.0; +https://www.mystockharbor.com)";

function buildProbes(symbols: string[]): Probe[] {
  const perStock: Probe[] = symbols.map((s) => ({
    group: "per-stock" as const,
    name: `nasdaq rssoutbound symbol=${s}`,
    url: `https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(s)}`,
    kind: "xml" as const,
  }));

  return [
    ...perStock,
    // Category feeds: one poll serves the headlines page AND seeds every
    // sector page, which is the whole reason news stops scaling per symbol.
    {
      group: "headlines",
      name: "nasdaq category=Markets",
      url: "https://www.nasdaq.com/feed/rssoutbound?category=Markets",
      kind: "xml",
    },
    {
      group: "headlines",
      name: "nasdaq category=Earnings",
      url: "https://www.nasdaq.com/feed/rssoutbound?category=Earnings",
      kind: "xml",
    },
    {
      group: "headlines",
      name: "nasdaq category=Stocks",
      url: "https://www.nasdaq.com/feed/rssoutbound?category=Stocks",
      kind: "xml",
      note: "category value guessed -- confirm against the category values seen on items",
    },
    {
      group: "headlines",
      name: "marketwatch topstories",
      url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
      kind: "xml",
      note: "carries media:content AND media:credit -- the image-permission signal",
    },
    {
      group: "headlines",
      name: "cnbc markets",
      url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
      kind: "xml",
    },
    {
      group: "headlines",
      name: "google news rss search (MU)",
      url: "https://news.google.com/rss/search?q=Micron+Technology+stock&hl=en-US&gl=US&ceid=US:en",
      kind: "xml",
      note: "settles whether the existing fallback in lib/stock-news-data.ts is alive or dead code",
    },
    // Wires: the one leg where longer extracts and the wire's own images are
    // defensible, because releases are issued for republication.
    {
      group: "wire",
      name: "globenewswire public companies",
      url: "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire---Public-Companies",
      kind: "xml",
      note: "items self-tag to securities (stock symbols + ISINs)",
    },
    {
      group: "wire",
      name: "prnewswire financial services",
      url: "https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss",
      kind: "xml",
    },
    {
      group: "wire",
      name: "businesswire home",
      url: "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEFpRXw==",
      kind: "xml",
    },
    // Reference data: free sector labels and the ticker->CIK map.
    {
      group: "reference",
      name: "sec submissions (MU CIK 723125)",
      url: "https://data.sec.gov/submissions/CIK0000723125.json",
      kind: "json",
      note: "gives tickers, exchanges, sicDescription and filings.recent",
    },
    {
      group: "reference",
      name: "sec company_tickers.json",
      url: "https://www.sec.gov/files/company_tickers.json",
      kind: "json",
      note: "ticker -> CIK map; confirm the real entry count",
    },
  ];
}

function isSec(url: string) {
  return url.includes("sec.gov");
}

async function fetchWithTimeout(url: string, ms: number) {
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

// Split a feed into item blocks. Handles both RSS <item> and Atom <entry>.
function itemBlocks(xml: string): string[] {
  const rss = xml.match(/<item[\s>][\s\S]*?<\/item>/gi);
  if (rss && rss.length) return rss;
  const atom = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi);
  return atom ?? [];
}

// Distinct child tag names across the sampled items, so the adapter author can
// see what is actually available rather than what the docs claim.
function fieldNames(blocks: string[]): string[] {
  const seen = new Set<string>();
  for (const block of blocks.slice(0, 10)) {
    const inner = block.replace(/^<(item|entry)[\s>][^>]*>?/i, "");
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

function firstItemSample(block: string | undefined) {
  if (!block) return null;
  const pick = [
    "title",
    "link",
    "pubDate",
    "guid",
    "dc:creator",
    "category",
    "nasdaq:tickers",
    "media:credit",
    "media:content",
    "description",
  ];
  const out: Record<string, string> = {};
  for (const tag of pick) {
    const v = tagValue(block, tag);
    if (v) out[tag] = v.slice(0, 200);
  }
  // media:content / media:credit are frequently self-closing with the value in
  // an attribute, so the tag-pair read above misses them.
  const selfClosing = block.match(/<(media:content|media:thumbnail|enclosure)[^>]*\/?>/gi) ?? [];
  if (selfClosing.length) out["_mediaTags"] = selfClosing.slice(0, 3).join(" ").slice(0, 300);
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
      try {
        const { status, contentType, body, ms } = await fetchWithTimeout(p.url, 12000);
        const common = {
          ...base,
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
            topLevelKeys: Object.keys(data).slice(0, 30),
            entryCount: filings
              ? (filings.accessionNumber?.length ?? 0)
              : Object.keys(data).length,
            recentFields: filings ? Object.keys(filings) : undefined,
            sample: filings
              ? {
                  name: data.name,
                  tickers: data.tickers,
                  exchanges: data.exchanges,
                  sicDescription: data.sicDescription,
                  form0: filings.form?.[0],
                  filingDate0: filings.filingDate?.[0],
                  items0: filings.items?.[0],
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
          firstItem: firstItemSample(blocks[0]),
        };
      } catch (err) {
        const e = err as Error;
        return {
          ...base,
          verdict: "FAIL",
          reason: e.name === "AbortError" ? "timeout after 12s" : `${e.name}: ${e.message}`,
        };
      }
    })
  );

  const pass = results.filter((r) => r.verdict === "PASS").length;

  // Reported, never echoed: the value carries an email address and this output
  // gets pasted around. A set-but-malformed value otherwise looks identical to
  // a network failure on the two sec.gov probes.
  const rawSecUa = process.env.SEC_USER_AGENT ?? "";
  const secUserAgent = {
    set: Boolean(rawSecUa),
    hasContact: rawSecUa.includes("@"),
    length: rawSecUa.length,
  };

  return Response.json(
    {
      ok: true,
      probedAt: new Date().toISOString(),
      region: process.env.VERCEL_REGION ?? null,
      env: process.env.VERCEL_ENV ?? null,
      secUserAgent,
      symbols,
      summary: `${pass}/${results.length} PASS`,
      results,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
