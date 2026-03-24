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
    .filter((item): item is InsightChartIndicator => allowed.has(item as InsightChartIndicator));
}

export function getAllPosts(): BlogPost[] {
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
    };
  });

   return posts.sort((a, b) => {
    if (a.date === b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? 1 : -1;
  });
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
    };
}
