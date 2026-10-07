// THE INDIVIDUAL BOTTLENECK PAGE, AS RULES (#563 COWORK #158).
//
// Everything the page decides from a data file, pure, so
// scripts/check-bottleneck-page.mjs can drive it on fixtures: the grade of
// each dependency, the two concentration meters, the two-sided map's rows,
// the generated FAQ and the short company name. The page and its server data
// (lib/server/bottleneckPage.ts) only draw what this returns.
//
// GRADES REPLACE "CRITICAL" (every row used to say it, even at 15%):
//   hard   "Hard to replace"     red    few named alternatives in the filings
//   some   "Some alternatives"   amber
//   spread "Spread out"          green
// A grade written in the data file wins; without one, the defaults below.

export type Grade = "hard" | "some" | "spread";
export type Side = "supplier" | "customer";

export const GRADE_WORDS: Record<Grade, string> = { hard: "Hard to replace", some: "Some alternatives", spread: "Spread out" };
export const GRADE_TONE: Record<Grade, string> = { hard: "#ef4444", some: "#f59e0b", spread: "#22c55e" };

/** A supplier the filing calls single-source, or a sole cloud/provider. */
const SINGLE = /single[- ]source|sole[- ](?:supplier|source|cloud|provider|manufacturer|foundry)/i;
/** A customer group the page calls diversified. */
const DIVERSIFIED = /thousands of|no single [a-z ]{0,30}(?:customer|agency|client|buyer|account)[^.]{0,80}(?:10%|ten per ?cent)/i;

/**
 * THE DEFAULT GRADE (#158): a supplier at 30% or more, or one described as
 * single-source or a sole cloud, is hard; 10–29% is some; under 10% is spread.
 * A customer group the page calls diversified ("thousands of", "no single …
 * > 10%") is spread; otherwise the same share bands.
 */
export function defaultGrade(side: Side, pct: number, blurb: string): Grade {
  if (side === "customer" && DIVERSIFIED.test(blurb)) return "spread";
  if (side === "supplier" && SINGLE.test(blurb)) return "hard";
  if (pct >= 30) return "hard";
  if (pct >= 10) return "some";
  return "spread";
}

export const isGrade = (v: unknown): v is Grade => v === "hard" || v === "some" || v === "spread";

export type Meter = { level: "High" | "Medium" | "Low"; pct: number | null; why: string; fill: number };

/** Supplier concentration: the top two shares together. High at 60%+, Medium 35–59%, Low under 35%. */
export function supplierMeter(pcts: number[]): Meter {
  const top = [...pcts].sort((a, b) => b - a).slice(0, 2);
  const sum = Math.round(top.reduce((a, b) => a + b, 0));
  const level = sum >= 60 ? "High" : sum >= 35 ? "Medium" : "Low";
  const why = top.length === 0 ? "No suppliers are mapped on this page."
    : top.length === 1 ? `The one mapped supplier makes up ~${sum}% of the mapped reliance.`
    : `The top two make up ~${sum}% of the mapped reliance.`;
  return { level, pct: top.length ? sum : null, why, fill: Math.min(100, sum) };
}

/** The page saying no single customer passes 10% of sales. */
export const NO_CUSTOMER_OVER_10 = /no single [a-z ]{0,30}(?:customer|agency|client|buyer|account)[^.]{0,80}(?:10%|ten per ?cent)/i;

/**
 * Customer concentration: the top customer's share, or Low when the page says
 * no single customer passes 10% (its note or a row's text). High at 40%+,
 * Medium 20–39%, Low under 20%.
 */
export function customerMeter(pcts: number[], text: string): Meter {
  if (NO_CUSTOMER_OVER_10.test(text)) return { level: "Low", pct: null, why: "The filings say no single customer passes 10% of sales.", fill: 8 };
  if (!pcts.length) return { level: "Low", pct: null, why: "No customers are mapped on this page.", fill: 0 };
  const top = Math.max(...pcts);
  const level = top >= 40 ? "High" : top >= 20 ? "Medium" : "Low";
  return { level, pct: top, why: `The largest customer or group is ~${top}% of the mapped reliance.`, fill: Math.min(100, top) };
}

/** The meter thresholds, for the page's own fine print and the check. */
export const METER_BANDS = { supplier: { high: 60, medium: 35 }, customer: { high: 40, medium: 20 } } as const;

/** At most this many boxes a side on the map; the rest roll up as "+N more". */
export const MAP_SIDE_MAX = 6;

export type MapNode = { key: string; label: string; pct: number; grade: Grade; anchor: string } | { key: string; more: number; pct: number };
/** One side of the map: the largest MAP_SIDE_MAX rows, then one "+N more" with the rest's combined share. */
export function mapSide<T extends { name: string; pct: number; grade: Grade }>(rows: T[], prefix: string): MapNode[] {
  const shown = rows.slice(0, MAP_SIDE_MAX).map((r, i) => ({ key: `${prefix}${i}`, label: r.name, pct: r.pct, grade: r.grade, anchor: `${prefix}-${i}` }));
  const rest = rows.slice(MAP_SIDE_MAX);
  return rest.length ? [...shown, { key: `${prefix}more`, more: rest.length, pct: Math.round(rest.reduce((a, r) => a + r.pct, 0)) }] : shown;
}

/** "Axon" from "Axon (AXON) Bottlenecks: …", else the registered name without its suffix. */
export function shortName(title: string, companyName: string): string {
  const fromTitle = title.split(" (")[0]?.trim();
  if (fromTitle && fromTitle.length <= 40 && !/bottleneck/i.test(fromTitle)) return fromTitle;
  return companyName.replace(/,?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|plc|N\.V\.|Ltd\.?|Limited|Holdings?)$/i, "").trim() || companyName;
}

/** Initials for a private or unnamed entry's badge. */
export function initials(name: string): string {
  const words = name.replace(/\([^)]*\)/g, "").split(/[\s&,.-]+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|and|the|inc|corp|co)$/i.test(w));
  return (words.slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?");
}

/** What an unlisted row is: a private company, or not a single company at all. */
export function unlistedWords(name: string, blurb: string): string {
  if (/not a single company/i.test(blurb) || /\b(suppliers|agencies|customers|consumers|providers|government|governments|users)\b/i.test(name)) return "Not a listed company";
  if (/private/i.test(blurb)) return "Private company";
  return "Not a listed company";
}

export type FaqItem = { q: string; a: string };
/** Three questions from the data: the biggest supplier, one big customer or not, the linked listed stocks. */
export function buildFaq(o: {
  name: string; symbol: string;
  suppliers: { name: string; pct: number; grade: Grade }[];
  customerMeter: Meter;
  listed: string[];
}): FaqItem[] {
  const top = o.suppliers[0];
  return [
    {
      q: `Who is ${o.name}'s biggest supplier?`,
      a: top ? `On this map, ${top.name}, at an estimated ~${top.pct}% of the mapped reliance (${GRADE_WORDS[top.grade].toLowerCase()}). The shares are editorial estimates, not audited figures.` : `This page maps no suppliers for ${o.name}.`,
    },
    {
      q: `Does ${o.name} depend on a single big customer?`,
      a: o.customerMeter.level === "High" ? `It may: the largest customer or group on this map is ~${o.customerMeter.pct}% of the mapped reliance.`
        : o.customerMeter.level === "Medium" ? `Partly: the largest customer or group on this map is ~${o.customerMeter.pct}%, which may matter but is not the whole picture.`
        : `Not on this map. ${o.customerMeter.why}`,
    },
    {
      q: `Which listed stocks are linked to ${o.symbol} here?`,
      a: o.listed.length ? `${o.listed.join(", ")}. Each links to its own chart and, where one exists, its own map.` : `None of the companies mapped here has a listed ticker on this site.`,
    },
  ];
}
