import fs from "fs";
import path from "path";
import matter from "gray-matter";

const postsDirectory = path.join(process.cwd(), "content/insights");
const snapshotsDirectory = path.join(process.cwd(), "content/insight-snapshots");

export type BlogPost = {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  symbol?: string | null;
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
  content: string;
  snapshot: InsightSnapshot | null;
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

function toOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSnapshotBySlug(slug: string): InsightSnapshot | null {
  const fullPath = path.join(snapshotsDirectory, `${slug}.json`);

  if (!fs.existsSync(fullPath)) return null;

  try {
    const raw = fs.readFileSync(fullPath, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;

    const rawChartPoints = Array.isArray(data.chartPoints) ? data.chartPoints : [];

    const chartPoints: InsightSnapshotPoint[] = rawChartPoints
      .map((point) => {
        const p = point as Record<string, unknown>;
        const close = Number(p.close);

        return {
          date: String(p.date ?? ""),
          close,
          high:
            p.high === undefined || p.high === null ? undefined : Number(p.high),
          low: p.low === undefined || p.low === null ? undefined : Number(p.low),
          volume:
            p.volume === undefined || p.volume === null
              ? undefined
              : Number(p.volume),
        };
      })
      .filter(
        (point) => point.date && typeof point.close === "number" && Number.isFinite(point.close)
      );

    return {
      symbol: String(data.symbol ?? ""),
      companyName:
        typeof data.companyName === "string" ? data.companyName : undefined,
      snapshotDate:
        typeof data.snapshotDate === "string" ? data.snapshotDate : undefined,
      snapshotTime:
        typeof data.snapshotTime === "string" ? data.snapshotTime : undefined,
      price: toOptionalNumber(data.price),
      trend: typeof data.trend === "string" ? data.trend : undefined,
      lastMA50: toOptionalNumber(data.lastMA50),
      lastMA200: toOptionalNumber(data.lastMA200),
      lastWeeklyMA200: toOptionalNumber(data.lastWeeklyMA200),
      ma50Pct: toOptionalNumber(data.ma50Pct),
      ma200Pct: toOptionalNumber(data.ma200Pct),
      weeklyMA200Pct: toOptionalNumber(data.weeklyMA200Pct),
      chartPoints,
    };
  } catch {
    return null;
  }
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
    };
  });

  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
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
    content,
    snapshot: getSnapshotBySlug(slug),
  };
}
