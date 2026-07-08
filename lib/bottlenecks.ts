import fs from "fs";
import path from "path";
import matter from "gray-matter";

const bottlenecksDirectory = path.join(process.cwd(), "content/bottlenecks");

export type BottleneckCompany = {
  name: string;
  ticker: string | null;
  pct: number;
  blurb: string;
};

export type BottleneckPost = {
  slug: string;
  symbol: string;
  companyName: string;
  title: string;
  date: string;
  summary: string;
  disclaimer: string;
  supplyChain: BottleneckCompany[];
  customers: BottleneckCompany[];
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

function normalizeCompanies(value: unknown): BottleneckCompany[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const record = item as Record<string, unknown>;
      const name = String(record.name ?? "").trim();
      const rawTicker = String(record.ticker ?? "")
        .trim()
        .toUpperCase();
      // Some suppliers/customers don't have a proper, reliably tradable
      // ticker on this site's data provider (e.g. companies that only trade
      // as thin OTC ADRs, or aren't independently publicly listed at all).
      // Those still show in the chart and list, just without a ticker -
      // the page hides the "Stock analysis"/"Earnings" links when this is null.
      const ticker = rawTicker || null;
      const pct = Number(record.pct);
      const blurb = String(record.blurb ?? "").trim();

      if (!name || !Number.isFinite(pct)) return null;

      return { name, ticker, pct, blurb };
    })
    .filter((item): item is BottleneckCompany => item !== null);
}

function readPost(fileName: string): BottleneckPost {
  const slug = fileName.replace(/\.md$/, "");
  const fullPath = path.join(bottlenecksDirectory, fileName);
  const fileContents = fs.readFileSync(fullPath, "utf8");

  const { data } = matter(fileContents);

  return {
    slug,
    symbol: String(data.symbol || slug).toUpperCase(),
    companyName: String(data.companyName || ""),
    title: String(data.title || ""),
    date: formatFrontmatterDate(data.date),
    summary: String(data.summary || "").trim(),
    disclaimer: String(data.disclaimer || "").trim(),
    supplyChain: normalizeCompanies(data.supplyChain),
    customers: normalizeCompanies(data.customers),
  };
}

export function getAllBottleneckPosts(): BottleneckPost[] {
  if (!fs.existsSync(bottlenecksDirectory)) return [];

  const fileNames = fs
    .readdirSync(bottlenecksDirectory)
    .filter((fileName) => fileName.endsWith(".md"));

  const posts = fileNames.map(readPost);

  return posts.sort((a, b) => {
    if (a.date === b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? 1 : -1;
  });
}

export function getBottleneckBySlug(slug: string): BottleneckPost {
  return readPost(`${slug}.md`);
}
