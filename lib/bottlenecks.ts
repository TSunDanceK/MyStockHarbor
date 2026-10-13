import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { buildBottleneckHub, buildHubCompanies, type BottleneckHub } from "./bottleneckHub";
import { defaultGrade, isGrade, type Grade, type Side } from "./bottleneckPage";

const bottlenecksDirectory = path.join(process.cwd(), "content/bottlenecks");

export type BottleneckCompany = {
  name: string;
  ticker: string | null;
  pct: number;
  blurb: string;
  /** How replaceable it is (#563 COWORK #158): the data file's `grade`, else the default rule. */
  grade: Grade;
};

export type BottleneckPost = {
  slug: string;
  symbol: string;
  companyName: string;
  category: string;
  domain: string;
  title: string;
  date: string;
  summary: string;
  disclaimer: string;
  // Optional per-post overrides for the intro sentence under each chart
  // heading - most stocks are fine with the generic template sentence, but
  // some (e.g. companies with no real customer concentration, like large
  // diversified advertisers) need an honest, specific caveat instead.
  supplyChainNote: string;
  customersNote: string;
  supplyChain: BottleneckCompany[];
  customers: BottleneckCompany[];
  /** "What could change this map" (#158): 2–3 hedged bullets, optional; the card hides without them. */
  watch: string[];
  /** The day the page's data last changed, when set; the JSON-LD's dateModified (else `date`). */
  updated: string;
};

// How many distinct stock pages name a company, across both charts (see
// getBottleneckCompanyCounts below).
export type BottleneckCompanyCount = {
  name: string;
  ticker: string | null;
  count: number;
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

function normalizeCompanies(value: unknown, side: Side): BottleneckCompany[] {
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

      return { name, ticker, pct, blurb, grade: isGrade(record.grade) ? record.grade : defaultGrade(side, pct, blurb) };
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
    category: String(data.category || "").trim(),
    domain: String(data.domain || "").trim(),
    title: String(data.title || ""),
    date: formatFrontmatterDate(data.date),
    summary: String(data.summary || "").trim(),
    disclaimer: String(data.disclaimer || "").trim(),
    supplyChainNote: String(data.supplyChainNote || "").trim(),
    customersNote: String(data.customersNote || "").trim(),
    supplyChain: normalizeCompanies(data.supplyChain, "supplier"),
    customers: normalizeCompanies(data.customers, "customer"),
    watch: Array.isArray(data.watch) ? data.watch.map((w: unknown) => String(w ?? "").trim()).filter(Boolean).slice(0, 3) : [],
    updated: formatFrontmatterDate(data.updated),
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

// The /bottlenecks hub (#125 COWORK): leaderboard, dependency web, themes and
// stat tiles, all computed here at build time from the content files. The
// keying and counting rules live in lib/bottleneckHub.ts (pure, so
// scripts/check-bottlenecks-hub.mjs can drive them): a company is keyed by
// its ticker when present, otherwise by its normalised name plus a small alias
// map, and counted once per stock page that names it.
// The web's sector arcs (#563 COWORK #131, only past WEB.maxDots connected
// pages) need each stock's sector: the page passes A's SEC resolver in.
export function getBottleneckHub(sectorOf?: (symbol: string) => string | null): BottleneckHub {
  return buildBottleneckHub(getAllBottleneckPosts(), sectorOf);
}

// How many distinct stock pages name each company - as a supplier or as a
// customer - keyed as above. Sorted highest count first, alphabetical on ties.
// (It used to key by the raw name string and count raw entries, which split
// "Amazon (AWS)" from "Amazon.com, Inc. (AWS)".)
export function getBottleneckCompanyCounts(): BottleneckCompanyCount[] {
  return buildHubCompanies(getAllBottleneckPosts()).map(({ name, ticker, count }) => ({ name, ticker, count }));
}
