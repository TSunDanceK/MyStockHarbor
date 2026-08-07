// ---------------------------------------------------------------------------
// The 11 sectors, as one shared list.
//
// SINGLE SOURCE OF TRUTH for anything sector-shaped on the site. Imported by
// the header nav (app/components/SiteHeader.tsx), the sitemap (app/sitemap.ts),
// the company profile block (app/components/CompanyProfile.tsx) and the
// /sector route family. Before this file there was no sector constant anywhere
// in the repo -- sector existed only as a free-text value on cached FMP
// profile/screener records (lib/server/fundamentalsCache.ts) and as a category
// filter key in lib/screenerFields.ts.
//
// `fmpLabel` is the exact string FMP returns on a company profile. That is the
// value stored on every cached fundamentals row, so it is what a sector ->
// constituents lookup has to match on. `aliases` exists because FMP (and the
// wider industry) is not perfectly consistent about these names -- "Health
// Care" vs "Healthcare", "Materials" vs "Basic Materials", "Consumer Staples"
// vs "Consumer Defensive" -- and a silently unmatched sector would show up as
// an empty page rather than an error. normaliseSectorLabel() below folds all
// known spellings onto one slug.
//
// Deliberately free of any server/Redis import so it can be read by client
// components, the sitemap and server components alike without pulling the
// Redis client into a client bundle.
// ---------------------------------------------------------------------------

export type SectorDef = {
  /** URL slug: /sector/{slug}/news */
  slug: string;
  /** Exact FMP profile value. Matched against the cached `sector` field. */
  fmpLabel: string;
  /** Display name used in headings, nav and metadata. */
  name: string;
  /** Short form for tight spaces (nav flyout, pills). */
  shortName: string;
  /** One-line plain-English description, used in the lead copy and meta. */
  blurb: string;
  /** Other spellings seen in the wild, lowercased. */
  aliases: string[];
};

export const SECTORS: SectorDef[] = [
  {
    slug: "technology",
    fmpLabel: "Technology",
    name: "Technology",
    shortName: "Technology",
    blurb:
      "Software, semiconductors, hardware and IT services -- the sector that usually sets the tone for the wider market.",
    aliases: ["information technology", "tech"],
  },
  {
    slug: "healthcare",
    fmpLabel: "Healthcare",
    name: "Healthcare",
    shortName: "Healthcare",
    blurb:
      "Drugmakers, biotech, medical devices and health insurers -- headlines here often turn on trial data and regulation.",
    aliases: ["health care", "healthcare & pharmaceuticals"],
  },
  {
    slug: "financial-services",
    fmpLabel: "Financial Services",
    name: "Financial Services",
    shortName: "Financials",
    blurb:
      "Banks, insurers, payments and asset managers -- the sector most directly exposed to interest rates and credit.",
    aliases: ["financial", "financials", "finance"],
  },
  {
    slug: "consumer-cyclical",
    fmpLabel: "Consumer Cyclical",
    name: "Consumer Cyclical",
    shortName: "Consumer Cyclical",
    blurb:
      "Retail, autos, travel and leisure -- discretionary spending, so it tends to move with consumer confidence.",
    aliases: ["consumer discretionary", "consumer cyclicals"],
  },
  {
    slug: "consumer-defensive",
    fmpLabel: "Consumer Defensive",
    name: "Consumer Defensive",
    shortName: "Consumer Defensive",
    blurb:
      "Food, drink, household goods and discount retail -- the things people buy regardless of the economic backdrop.",
    aliases: ["consumer staples", "consumer defensives"],
  },
  {
    slug: "energy",
    fmpLabel: "Energy",
    name: "Energy",
    shortName: "Energy",
    blurb:
      "Oil and gas producers, refiners and services -- headlines usually track the commodity before the company.",
    aliases: ["oil & gas", "oil and gas"],
  },
  {
    slug: "industrials",
    fmpLabel: "Industrials",
    name: "Industrials",
    shortName: "Industrials",
    blurb:
      "Aerospace, defence, machinery, rail and freight -- a read on real-world activity rather than sentiment.",
    aliases: ["industrial goods", "industrial"],
  },
  {
    slug: "basic-materials",
    fmpLabel: "Basic Materials",
    name: "Basic Materials",
    shortName: "Basic Materials",
    blurb:
      "Miners, chemicals, steel and packaging -- the raw-input end of the market, and an early cyclical signal.",
    aliases: ["materials", "basic material"],
  },
  {
    slug: "utilities",
    fmpLabel: "Utilities",
    name: "Utilities",
    shortName: "Utilities",
    blurb:
      "Power, water and grid operators -- income-led and rate-sensitive, and increasingly an AI-datacentre story.",
    aliases: ["utility"],
  },
  {
    slug: "real-estate",
    fmpLabel: "Real Estate",
    name: "Real Estate",
    shortName: "Real Estate",
    blurb:
      "REITs and property operators -- yield-driven, and the sector most tied to the direction of long rates.",
    aliases: ["realestate", "real estate investment trusts"],
  },
  {
    slug: "communication-services",
    fmpLabel: "Communication Services",
    name: "Communication Services",
    shortName: "Communication",
    blurb:
      "Telecoms, media, streaming and the big platform advertisers -- part utility, part high-growth tech.",
    aliases: ["communication", "communications", "telecommunications", "telecom"],
  },
];

const BY_SLUG = new Map(SECTORS.map((sector) => [sector.slug, sector]));

/**
 * Every spelling we accept -> the canonical sector. Built from fmpLabel, name
 * and aliases so a cached row saying "Health Care" still lands on /healthcare.
 */
const BY_LABEL = new Map<string, SectorDef>();

for (const sector of SECTORS) {
  const keys = [sector.fmpLabel, sector.name, sector.shortName, ...sector.aliases];
  for (const key of keys) {
    BY_LABEL.set(key.trim().toLowerCase(), sector);
  }
}

export const SECTOR_SLUGS: string[] = SECTORS.map((sector) => sector.slug);

export function getSectorBySlug(slug: string): SectorDef | null {
  return BY_SLUG.get(String(slug ?? "").trim().toLowerCase()) ?? null;
}

/**
 * Maps a raw FMP sector string (however it is spelled) onto our canonical
 * sector, or null when it is empty/unrecognised. Callers should treat null as
 * "unclassified" rather than as an error -- the profile backfill runs on a
 * rolling cap, so some symbols legitimately have no sector cached yet.
 */
export function getSectorByLabel(label: string | null | undefined): SectorDef | null {
  if (!label) return null;
  return BY_LABEL.get(String(label).trim().toLowerCase()) ?? null;
}

/** Convenience: raw FMP sector string -> our slug, or null. */
export function sectorSlugFromLabel(label: string | null | undefined): string | null {
  return getSectorByLabel(label)?.slug ?? null;
}

export function sectorNewsPath(slug: string): string {
  return `/sector/${slug}/news`;
}
