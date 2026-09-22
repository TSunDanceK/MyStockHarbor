// FMP's industry label -> a v2 art tag. Layer 3 of the symbol-led picker.
//
// claude/news-art-v2-symbol-surfaces-2026-09-22.md has the measurement this
// table was built from. Pure lookup: no I/O, no network.
//
// ── THE PROBLEM, MEASURED ──────────────────────────────────────────────────
// art.ts's bucketFor() answers with one of nineteen `sector-*` buckets, and the
// v2 library has 67 subjects. Across the 2,619 symbols in
// data/static-profile.json those nineteen buckets collapse like this:
//
//   sector-banks       342 symbols   5 distinct v2 tags underneath
//   sector-biotech     333           5
//   sector-software    317           4   (software 166, cloud 69,
//                                         consumer-electronics 63, telecom 19)
//   sector-industrials 317          11
//
// Which is why every Technology stock shows servers and cables: Apple's
// industry is "Consumer Electronics" and Ondas's is "Communication Equipment",
// and both resolve to sector-software today.
//
// ── WHAT THIS TABLE IS NOT ─────────────────────────────────────────────────
// It is not a taxonomy and it is not complete. 144 industry labels exist in the
// snapshot; 124 have a tag here, 9 are still judged only half-right and are NOT
// live (see WEAK_LABELS below), and 11 have no
// honest tag at all. The last two groups fall through to LAYER 4, which is
// today's sector art and is exactly what they render now.
//
// ── ONE LABEL, ONE TAG, AND NO REGEXES ─────────────────────────────────────
// INDUSTRY_BUCKETS in art.ts matches lowercased substrings because it was
// mapping free text onto nineteen buckets and needed the slack. This maps a
// CLOSED SET of 144 exact labels from a committed snapshot onto 67 tags, so an
// exact lookup is both sufficient and safer: "Banks - Regional" cannot be
// caught by a pattern written for "Banks", and a label that changes upstream
// lands in the miss list instead of quietly matching something adjacent.
// scripts/check-news-art.mjs asserts every key here is a label the snapshot
// actually contains, and every value a subject the manifest actually holds.
import profile from "@/data/static-profile.json";

/**
 * 114 labels whose tag is not in dispute. Sorted by the symbol count each
 * carries, so the ones that matter most are readable first.
 */
const INDUSTRY_TAGS: Record<string, string> = {
  // ── Healthcare ──────────────────────────────────────────────────────────
  Biotechnology: "biotech", // 175
  "Medical - Devices": "medtech-devices", // 38
  "Medical - Instruments & Supplies": "medtech-devices", // 25
  "Medical - Equipment & Services": "medtech-devices", // 1
  "Medical - Specialties": "medtech-devices", // 2
  "Medical - Diagnostics & Research": "lab-diagnostics", // 26
  "Medical - Care Facilities": "hospitals", // 30
  "Drug Manufacturers - Specialty & Generic": "pharma", // 24
  "Drug Manufacturers - General": "pharma", // 16
  "Medical - Pharmaceuticals": "pharma", // 5

  // ── Financials ──────────────────────────────────────────────────────────
  "Banks - Regional": "banks", // 157
  "Banks - Diversified": "banks", // 20
  Banks: "banks", // 2
  "Asset Management": "asset-management", // 70
  "Financial - Capital Markets": "investment-banks", // 35
  "Investment - Banking & Investment Services": "investment-banks", // 9
  "Financial - Credit Services": "fintech-payments", // 33
  "Financial - Data & Stock Exchanges": "exchanges", // 10
  "Insurance - Property & Casualty": "insurance", // 42
  "Insurance - Life": "insurance", // 21
  "Insurance - Diversified": "insurance", // 16
  "Insurance - Brokers": "insurance", // 12
  "Insurance - Specialty": "insurance", // 9
  "Insurance - Reinsurance": "insurance", // 6

  // ── Technology ──────────────────────────────────────────────────────────
  // THE SPLIT THIS TABLE EXISTS FOR. All four of these are sector-software
  // today, and `Consumer Electronics` alone is 4 symbols including AAPL.
  "Software - Application": "software", // 121
  "Software - Infrastructure": "cloud", // 69
  "Software - Services": "software", // 3
  "Information Technology Services": "software", // 42
  Semiconductors: "chips", // 77
  "Consumer Electronics": "consumer-electronics", // 4
  "Internet Content & Information": "internet-platform", // 27
  "Telecommunications Services": "telecom", // 43
  // ── PROMOTED OUT OF WEAK_LABELS ON REVIEW, 2026-09-22 ──────────────────
  // This is the label that started the whole change: ONDS shows data-centre
  // imagery because "Communication Equipment" resolves to sector-software. It
  // is STILL only half right and the reason is kept where the row is — ONDS,
  // CSCO and MSI share this label, so a drone maker and a router vendor both
  // get radio towers. It is live because the reviewer looked at exactly that
  // trade and took it; every other weak label is still held back.
  //
  // What it is NOT is a fix for ONDS specifically. A drone company gets telecom
  // art, not drone art, because `drones` is not a subject the library holds.
  // A per-symbol override and new art are both deliberately out of this change.
  "Communication Equipment": "telecom", // 19

  // ── Energy and utilities ────────────────────────────────────────────────
  "Oil & Gas Exploration & Production": "oil-gas-upstream", // 41
  "Oil & Gas Integrated": "oil-gas-upstream", // 14
  "Oil & Gas Drilling": "oil-gas-upstream", // 9
  "Oil & Gas Energy": "oil-gas-upstream", // 1
  "Oil & Gas Midstream": "pipelines", // 37
  "Oil & Gas Equipment & Services": "oilfield-services", // 27
  "Oil & Gas Refining & Marketing": "refining", // 14
  "Regulated Electric": "utilities-grid", // 56
  "Regulated Gas": "utilities-grid", // 13
  "Regulated Water": "utilities-grid", // 7
  "Diversified Utilities": "utilities-grid", // 7
  "Independent Power Producers": "utilities-grid", // 7
  "Renewable Utilities": "utilities-grid", // 12
  Solar: "solar", // 6
  Uranium: "nuclear", // 3

  // ── Industrials ─────────────────────────────────────────────────────────
  "Industrial - Machinery": "machinery", // 55
  "Manufacturing - Tools & Accessories": "machinery", // 8
  "Manufacturing - Metal Fabrication": "machinery", // 7
  "Agricultural - Machinery": "machinery", // 7
  "Aerospace & Defense": "aerospace-defence", // 53
  "Engineering & Construction": "construction", // 28
  "Construction Materials": "construction", // 28
  "Residential Construction": "homebuilders", // 16
  "Marine Shipping": "shipping", // 24
  "Integrated Freight & Logistics": "trucking-logistics", // 11
  Trucking: "trucking-logistics", // 10
  Railroads: "railroads", // 8
  "Airlines, Airports & Air Services": "airlines", // 18
  "Waste Management": "waste-recycling", // 7
  "Industrial - Pollution & Treatment Controls": "waste-recycling", // 3
  "Staffing & Employment Services": "staffing-services", // 7

  // ── Materials ───────────────────────────────────────────────────────────
  "Chemicals - Specialty": "chemicals", // 35
  Chemicals: "chemicals", // 9
  Gold: "mining-precious", // 28
  "Other Precious Metals": "mining-precious", // 11
  Silver: "mining-precious", // 3
  Copper: "mining-industrial", // 5
  Aluminum: "mining-industrial", // 4
  Coal: "mining-industrial", // 6
  Steel: "steel", // 12
  "Packaging & Containers": "packaging-paper", // 14
  "Paper, Lumber & Forest Products": "packaging-paper", // 7

  // ── Consumer ────────────────────────────────────────────────────────────
  "Specialty Retail": "retail-stores", // 41
  "Discount Stores": "retail-stores", // 9
  "Department Stores": "retail-stores", // 4
  "Home Improvement": "retail-stores", // 3
  "Grocery Stores": "grocery", // 6
  "Apparel - Retail": "apparel", // 12
  "Apparel - Manufacturers": "apparel", // 12
  "Apparel - Footwear & Accessories": "apparel", // 8
  "Manufacturing - Textiles": "apparel", // 1
  "Luxury Goods": "luxury", // 4
  Restaurants: "restaurants", // 22
  "Packaged Foods": "packaged-food", // 26
  "Food Distribution": "packaged-food", // 6
  "Food Confectioners": "packaged-food", // 4
  "Beverages - Non-Alcoholic": "beverages", // 11
  "Beverages - Alcoholic": "beverages", // 8
  "Beverages - Wineries & Distilleries": "beverages", // 1
  "Agricultural Inputs": "agriculture", // 10
  "Agricultural Farm Products": "agriculture", // 8
  "Auto - Parts": "autos", // 24
  "Auto - Manufacturers": "autos", // 15
  "Auto - Dealerships": "autos", // 14
  "Auto - Recreational Vehicles": "autos", // 5
  "Travel Lodging": "hotels-resorts", // 8
  "Gambling, Resorts & Casinos": "casinos", // 17
  "Electronic Gaming & Multimedia": "gaming", // 4
  "Education & Training Services": "education", // 12

  // ── Media and real estate ───────────────────────────────────────────────
  Entertainment: "streaming-media", // 23
  Broadcasting: "streaming-media", // 4
  "Media & Entertainment": "streaming-media", // 1
  "Advertising Agencies": "advertising", // 10
  "REIT - Retail": "reit-commercial", // 21
  "REIT - Specialty": "reit-commercial", // 15
  "REIT - Industrial": "reit-commercial", // 14
  "REIT - Residential": "reit-commercial", // 13
  "REIT - Healthcare Facilities": "reit-commercial", // 12
  "REIT - Office": "reit-commercial", // 12
  "REIT - Diversified": "reit-commercial", // 10
  "REIT - Mortgage": "reit-commercial", // 11
  "REIT - Hotel & Motel": "reit-commercial", // 9

  // ── APPROVED ON REVIEW, 2026-09-22 ──────────────────────────────────────
  // Nine rows promoted out of WEAK_LABELS in one pass. Each is still only
  // half right and each reason is kept below, struck rather than deleted, so
  // the trade stays readable: a promoted row is a judgement someone made, not
  // a row that turned out to be correct after all.
  "Hardware, Equipment & Parts": "consumer-electronics", // 34 — a catch-all over connectors, sensors and instruments
  "Electrical Equipment & Parts": "machinery", // 24 — grid gear and motors; `utilities-grid` is the other half-fit
  "Computer Hardware": "consumer-electronics", // 20 — Dell and HPQ sell servers, not consumer gadgets
  "Industrial - Distribution": "machinery", // 17 — distributors, not makers
  "Travel Services": "hotels-resorts", // 14 — BKNG and EXPE are marketplaces, not owners
  "Medical - Healthcare Information Services": "software", // 13 — true of the delivery, silent about the domain
  "Real Estate - Services": "reit-commercial", // 13 — brokers and managers, not owners
  "Industrial Materials": "mining-industrial", // 13 — a catch-all; the image is a mine
  "Medical - Healthcare Plans": "insurance", // 11 — UNH is an insurer by economics, a healthcare company by story
};

/**
 * ── THE 19 LABELS THAT ARE ONLY HALF RIGHT, AND ARE THEREFORE NOT LIVE ────
 *
 * Every one of these has a tag that is arguable and a reason it is not simply
 * true. They are recorded here, WITH the reason and NOT in the live map, so
 * they fall through to layer 4 and render exactly what they render today. A row
 * moves up into INDUSTRY_TAGS one at a time, when someone decides the trade is
 * worth it — which is a judgement about a picture, not a code change anyone
 * should make on a hunch.
 *
 * 9 labels, 42 symbols, 1.6% of the universe, sit here. TEN have been reviewed
 * and promoted into the live map above — "Communication Equipment" on its own,
 * then nine more in one pass on 2026-09-22.
 *
 * `cybersecurity` is the sharpest example of why the list exists: "Security &
 * Protection Services" is guards, alarms and fences, and tagging it
 * `cybersecurity` would be a different industry, not an approximation of one.
 * That one is in the no-tag group below rather than here.
 */
export const WEAK_LABELS: Record<string, { tag: string; why: string; symbols: number }> = {
  Tobacco: { tag: "packaged-food", why: "the only consumer-goods image there is.", symbols: 7 },
  Publishing: { tag: "streaming-media", why: "print and books under a streaming image.", symbols: 6 },
  "Consulting Services": { tag: "staffing-services", why: "people-businesses, different work.", symbols: 6 },
  "Real Estate - Development": { tag: "construction", why: "closer than a REIT tower, still not the story.", symbols: 5 },
  "Technology Distributors": { tag: "consumer-electronics", why: "same shape, one sector over.", symbols: 5 },
  "Medical - Distribution": { tag: "pharma", why: "MCK/CAH move drugs; the pharma image is a lab or pills, not a warehouse.", symbols: 4 },
  "Financial - Mortgages": { tag: "banks", why: "originators and servicers, not deposit-takers.", symbols: 4 },
  "Financial - Conglomerates": { tag: "banks", why: "BRK-shaped. A vault asserts banking of a holding company.", symbols: 4 },
  "Real Estate - Diversified": { tag: "reit-commercial", why: "same caveat as Services.", symbols: 1 },
};

/**
 * The art tag for an industry label, or null.
 *
 * NULL IS THE COMMON AND CORRECT ANSWER for 30 of the 144 labels and for every
 * label the snapshot does not contain. The caller falls through to the sector
 * bucket, which is what those symbols render today, so a miss here costs
 * nothing and a wrong hit costs a picture that asserts something untrue.
 *
 * Trimmed but NOT lowercased: the labels are a closed set from a committed
 * snapshot, and case-folding would invite a near-miss to match.
 */
export function industryTag(industry: string | null | undefined): string | null {
  const label = String(industry ?? "").trim();
  if (!label) return null;
  return INDUSTRY_TAGS[label] ?? null;
}

/** Exposed for the check: every label the snapshot holds, with its count. */
export function snapshotIndustryCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  const rows = (profile as { rows?: Record<string, { industry?: string | null }> }).rows ?? {};
  for (const row of Object.values(rows)) {
    const label = String(row?.industry ?? "").trim();
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

/** Exposed for the check and the measurement scripts. */
export const INDUSTRY_TAG_LABELS = Object.keys(INDUSTRY_TAGS);
export const INDUSTRY_TAG_VALUES = Object.values(INDUSTRY_TAGS);
