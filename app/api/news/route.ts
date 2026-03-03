import { NextResponse } from "next/server";

export const runtime = "nodejs";

type NewsItem = {
  title: string;
  link: string;
  pubDate: string | null;
  source: string | null;
};

// Lightweight RSS parse (good enough for Google News RSS)
function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemBlocks = xml.split("<item>").slice(1);

  for (const block of itemBlocks) {
    const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      ?? block.match(/<title>(.*?)<\/title>/)?.[1]
      ?? "";

    const link = block.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? null;

    // Google News uses <source> sometimes
    const source = block.match(/<source[^>]*>(.*?)<\/source>/)?.[1] ?? null;

    if (title && link) items.push({ title, link, pubDate, source });
  }

  return items;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "AAPL").toUpperCase();

  // Google News RSS search feed (multi-source aggregation). :contentReference[oaicite:3]{index=3}
  const q1 = encodeURIComponent(`${symbol} stock`);
  const q2 = encodeURIComponent(`US stock market`);

  const feeds = [
    { label: `${symbol}`, url: `https://news.google.com/rss/search?q=${q1}&hl=en-GB&gl=GB&ceid=GB:en` },
    { label: `Market`, url: `https://news.google.com/rss/search?q=${q2}&hl=en-GB&gl=GB&ceid=GB:en` },
  ];

  const out: { label: string; items: NewsItem[] }[] = [];

  for (const f of feeds) {
    try {
      const res = await fetch(f.url, { cache: "no-store" });
      const xml = await res.text();
      const items = parseRss(xml).slice(0, 8);
      out.push({ label: f.label, items });
    } catch {
      out.push({ label: f.label, items: [] });
    }
  }

  return NextResponse.json({ symbol, feeds: out });
}
