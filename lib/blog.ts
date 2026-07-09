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
  excerpt: string;
  symbol?: string | null;
  timeframe: "d" | "w";
  chartBars: number | null;
  chartIndicators: InsightChartIndicator[];
  overallBreakdown: string;
  latestNews: string;
  latestEarnings: string;
  investorUsefulInfo: string;
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
      excerpt: String(data.excerpt || ""),
      symbol: data.symbol ? String(data.symbol) : null,
      timeframe: (data.timeframe === "w" ? "w" : "d") as "d" | "w",
      chartBars: normalizeChartBars(data.chartBars),
      chartIndicators: normalizeChartIndicators(data.chartIndicators),
      overallBreakdown: normalizeFrontmatterText(data.overallBreakdown),
      latestNews: normalizeFrontmatterText(data.latestNews),
      latestEarnings: normalizeFrontmatterText(data.latestEarnings),
      investorUsefulInfo: normalizeFrontmatterText(data.investorUsefulInfo),
    };
  });

  return posts.sort((a, b) => {
    if (a.date === b.date) return 0;
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

export function getPostBySlug(slug: string): BlogPostFull {
  const fullPath = path.join(postsDirectory, `${slug}.md`);
  const fileContents = fs.readFileSync(fullPath, "utf8");

  const { data, content } = matter(fileContents);

  return {
    slug,
    title: String(data.title || ""),
    date: formatFrontmatterDate(data.date),
    excerpt: String(data.excerpt || ""),
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
