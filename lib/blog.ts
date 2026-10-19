import fs from "fs";
import path from "path";
import matter from "gray-matter";

const postsDirectory = path.join(process.cwd(), "content/insights");

export type InsightChartIndicator =
  | "MA50"
  | "MA200"
  | "EMA20"
  | "VWMA(20)"
  | "Bollinger(20,2)"
  | "RSI(14)"
  | "MACD(12,26,9)"
  | "Stochastic(14,3)"
  | "ATR(14)"
  | "Volume";

export type BlogPost = {
  slug: string;
  title: string;
  date: string;
  /** When the post's TEXT last changed (frontmatter `updated`); "" when it never has. */
  updated: string;
  excerpt: string;
  symbol?: string | null;
  timeframe: "d" | "w";
  chartBars: number | null;
  chartIndicators: InsightChartIndicator[];
  overallBreakdown: string;
  latestNews: string;
  latestEarnings: string;
  investorUsefulInfo: string;
  /** The frontmatter's `heroArt` (a news-art image name that overrides the automatic picture), else null. */
  heroArt: string | null;
};

export type InsightSnapshotPoint = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type InsightSnapshot = {
  symbol: string;
  companyName?: string;
  snapshotDate?: string;
  snapshotTime?: string;
  price?: number | null;
  trend?: string;
  lastMA50?: number | null;
  lastMA200?: number | null;
  lastWeeklyMA200?: number | null;
  ma50Pct?: number | null;
  ma200Pct?: number | null;
  weeklyMA200Pct?: number | null;
  /** Tiingo path only: what the price is ("close, 29 Sep 2026"), read at render. */
  priceLabel?: string;
  /** Set when the priced fields were read at render from stored Tiingo bars. */
  source?: "tiingo";
  chartPoints: InsightSnapshotPoint[];
};

export type BlogPostFull = {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  symbol?: string | null;
  timeframe: "d" | "w";
  chartBars: number | null;
  chartIndicators: InsightChartIndicator[];
  overallBreakdown: string;
  latestNews: string;
  latestEarnings: string;
  investorUsefulInfo: string;
  content: string;
};

function formatFrontmatterDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
}

function normalizeFrontmatterText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeChartBars(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  if (rounded < 20) return 20;
  if (rounded > 400) return 400;
  return rounded;
}

function normalizeChartIndicators(value: unknown): InsightChartIndicator[] {
  const allowed = new Set<InsightChartIndicator>([
    "MA50",
    "MA200",
    "EMA20",
    "VWMA(20)",
    "Bollinger(20,2)",
    "RSI(14)",
    "MACD(12,26,9)",
    "Stochastic(14,3)",
    "ATR(14)",
    "Volume",
  ]);

  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item).trim())
    .filter((item): item is InsightChartIndicator =>
      allowed.has(item as InsightChartIndicator)
    );
}

// Single source of truth for reading + sorting every post's frontmatter.
// Cheap even at large scale (frontmatter-only parse, no markdown body), but
// still O(n) in the number of files - getAllPosts(), getPaginatedPosts(),
// and searchPosts() all share this so there's only one place that walks
// content/insights/.
function readSortedPosts(): BlogPost[] {
  if (!fs.existsSync(postsDirectory)) return [];

  const fileNames = fs
    .readdirSync(postsDirectory)
    .filter((fileName) => fileName.endsWith(".md"));

  const posts = fileNames.map((fileName) => {
    const slug = fileName.replace(/\.md$/, "");
    const fullPath = path.join(postsDirectory, fileName);
    const fileContents = fs.readFileSync(fullPath, "utf8");

    const { data } = matter(fileContents);

    return {
      slug,
      title: String(data.title || ""),
      date: formatFrontmatterDate(data.date),
      updated: formatFrontmatterDate(data.updated),
      excerpt: String(data.excerpt || data.summary || ""), // a new-format post (#563 COWORK #132) has a summary, no excerpt
      symbol: data.symbol ? String(data.symbol) : null,
      timeframe: (data.timeframe === "w" ? "w" : "d") as "d" | "w",
      chartBars: normalizeChartBars(data.chartBars),
      chartIndicators: normalizeChartIndicators(data.chartIndicators),
      overallBreakdown: normalizeFrontmatterText(data.overallBreakdown),
      latestNews: normalizeFrontmatterText(data.latestNews),
      latestEarnings: normalizeFrontmatterText(data.latestEarnings),
      investorUsefulInfo: normalizeFrontmatterText(data.investorUsefulInfo),
      heroArt: typeof data.heroArt === "string" && data.heroArt.trim() ? data.heroArt.trim() : null,
    };
  });

  return posts.sort((a, b) => {
    // Same date: by slug, so "newer" and "previous" never depend on the order the filesystem lists files in.
    if (a.date === b.date) return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? 1 : -1;
  });
}

// Full, unbounded list - still needed for the sitemap (every post needs a
// URL there) and for generateStaticParams on the post pages. Do NOT pass
// the result of this straight into a client component's props for the
// /insights list - see getPaginatedPosts() below, which is what the list
// page actually renders. Shipping the full array to the browser is exactly
// the unbounded-DOM/hydration-payload problem that got fixed here.
export function getAllPosts(): BlogPost[] {
  return readSortedPosts();
}

// ── Posts on the same ticker (#553): "Previous insight on SYM", "Newer insight
// on SYM", and the stock page's Insights list. Computed from content/insights
// when the page is built (no manual edits): add a post and every older post on
// that ticker points at it, and it points back.

/** The date the post's TEXT last changed: its `updated`, else its `date`. The JSON-LD's dateModified and the sitemap's lastmod. */
export function insightModifiedDate(post: Pick<BlogPost, "date" | "updated">): string {
  return post.updated || post.date;
}

export type InsightLink = { slug: string; title: string; date: string };

const toInsightLink = (post: BlogPost): InsightLink => ({ slug: post.slug, title: post.title, date: post.date });

/** Every post on a ticker, newest first (case-insensitive). */
export function getInsightsForSymbol(symbol: string | null | undefined): BlogPost[] {
  const want = String(symbol ?? "").trim().toUpperCase();
  if (!want) return [];
  return readSortedPosts().filter((post) => post.symbol?.toUpperCase() === want);
}

/**
 * For the post `slug` on `symbol`: the previous post on the same ticker (the
 * next one back in time), and the NEWEST post on it when that is newer than
 * this one (null on the newest post itself, so only older posts get a banner).
 */
export function getSameSymbolLinks(slug: string, symbol: string | null | undefined): { previous: InsightLink | null; newest: InsightLink | null } {
  const list = getInsightsForSymbol(symbol);
  const at = list.findIndex((post) => post.slug === slug);
  if (at < 0) return { previous: null, newest: null };
  return {
    previous: at + 1 < list.length ? toInsightLink(list[at + 1]) : null,
    newest: at > 0 ? toInsightLink(list[0]) : null,
  };
}

export type PaginatedPosts = {
  posts: BlogPost[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

// Bounded page of posts for the /insights list UI. However large
// content/insights/ grows, the browser only ever receives `pageSize` posts -
// the DOM size and hydration payload for the list page stay flat over time.
export function getPaginatedPosts(page: number, pageSize: number): PaginatedPosts {
  const all = readSortedPosts();
  const totalCount = all.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    posts: all.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    totalCount,
    totalPages,
  };
}

export type InsightSearchResult = {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  symbol: string | null;
};

// Search across the FULL history (not just the current page) without ever
// shipping the full history to the client. The route handler in
// app/api/insights/search calls this server-side and returns only the
// capped `results` array - the response size stays bounded regardless of
// how many posts exist.
export function searchPosts(query: string, limit = 30): InsightSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const all = readSortedPosts();
  const results: InsightSearchResult[] = [];

  for (const post of all) {
    if (results.length >= limit) break;

    const haystack = `${post.title} ${post.symbol ?? ""} ${post.excerpt}`.toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        slug: post.slug,
        title: post.title,
        date: post.date,
        excerpt: post.excerpt,
        symbol: post.symbol ?? null,
      });
    }
  }

  return results;
}

// ── Related-posts selection ("More Insights" cross-linking module) ─────────
//
// Powers app/components/RelatedInsights.tsx, rendered on every
// /insights/[slug] post page. Mirrors the deterministic, no-I/O selection
// pattern already shipped for stock pages (see getRelatedSymbols() in
// lib/curatedSymbols.ts / RelatedStocks.tsx): a July 2026 GSC audit found
// individual insight posts have exactly ONE inbound internal link each —
// their listing on the paginated /insights archive (PAGE_SIZE = 20). This
// gives every post page a small, stable set of links to OTHER post pages
// too, so Google (and readers) have more than one path to each post.
//
// Selection logic (deterministic — no Math.random()/Date.now()):
//  - Always excludes the current post itself.
//  - If `currentSymbol` is set, other posts about that SAME symbol are
//    the most topically related, so they're listed first (there may be
//    zero or a few).
//  - The rest of the slots are filled with the most RECENT remaining posts
//    by `date` (readSortedPosts() already returns newest-first), which is
//    simple, deterministic, and gives every post — including brand-new
//    ones — a natural promotion path via being linked from older posts.
export function getRelatedPosts(
  currentSlug: string,
  currentSymbol: string | null,
  count = 8
): BlogPost[] {
  const all = readSortedPosts().filter((post) => post.slug !== currentSlug);

  const related: BlogPost[] = [];
  const usedSlugs = new Set<string>();

  if (currentSymbol) {
    const upperSymbol = currentSymbol.toUpperCase();
    for (const post of all) {
      if (related.length >= count) break;
      if (post.symbol && post.symbol.toUpperCase() === upperSymbol) {
        related.push(post);
        usedSlugs.add(post.slug);
      }
    }
  }

  for (const post of all) {
    if (related.length >= count) break;
    if (usedSlugs.has(post.slug)) continue;
    related.push(post);
    usedSlugs.add(post.slug);
  }

  return related;
}

export function getPostBySlug(slug: string): BlogPostFull {
  const fullPath = path.join(postsDirectory, `${slug}.md`);
  const fileContents = fs.readFileSync(fullPath, "utf8");

  const { data, content } = matter(fileContents);

  return {
    slug,
    title: String(data.title || ""),
    date: formatFrontmatterDate(data.date),
    excerpt: String(data.excerpt || data.summary || ""), // a new-format post (#563 COWORK #132) has a summary, no excerpt
    symbol: data.symbol ? String(data.symbol) : null,
    timeframe: (data.timeframe === "w" ? "w" : "d") as "d" | "w",
    chartBars: normalizeChartBars(data.chartBars),
    chartIndicators: normalizeChartIndicators(data.chartIndicators),
    overallBreakdown: normalizeFrontmatterText(data.overallBreakdown),
    latestNews: normalizeFrontmatterText(data.latestNews),
    latestEarnings: normalizeFrontmatterText(data.latestEarnings),
    investorUsefulInfo: normalizeFrontmatterText(data.investorUsefulInfo),
    content,
  };
}
