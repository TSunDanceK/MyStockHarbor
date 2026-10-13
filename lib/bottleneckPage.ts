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

/** A row's optional `listing` (#563 COWORK #188): listed only outside the US, or private. */
export type Listing = "non-us" | "private";
export const isListing = (v: unknown): v is Listing => v === "non-us" || v === "private";

/**
 * WHAT A ROW WITH NO TICKER IS (#563 COWORK #188). "Not a listed company" was
 * the default and so landed on LSEG, Samsung, MediaTek, Adyen and every other
 * company listed outside the US. Now, in order:
 *   - the data file's `listing` field, where set;
 *   - "unnamed": a customer or supplier the filing does not name;
 *   - "government" first for one sovereign customer ("U.S. Government"), which
 *     the filings report as one customer;
 *   - "group": not a single company (a bucket, an end market, a region);
 *   - "government": a public body (NASA, the U.S. Air Force);
 *   - "private": the blurb says it is privately held;
 *   - else "non-us": a named company with no US ticker on this site, which is
 *     true of a foreign-listed firm and, less precisely, of a private one the
 *     blurb does not call private (set `listing: private` on those).
 */
export type EntityKind = "listed" | "non-us" | "private" | "government" | "group" | "unnamed";
const UNNAMED = /\b(unnamed|undisclosed|not named)\b|^(?:the )?(?:largest|second[- ]largest|third[- ]largest)\b|\bcustomer [A-Z]\b|"customer [a-z]"/i;
const GROUP = /not a single company/i;
const GROUP_NAME = /\b(suppliers|agencies|customers|consumers|providers|governments|users|distributors|wholesalers|retailers|resellers|partners|end[- ]markets?|others?|rest of|segments?|cohort|channel|investors|shareholders|purchasers|buyers|clients|operators|vendors|contractors|carriers|payers|merchants|advertisers|developers|subscribers|members|insiders|makers|mills|group of|in-house|construction|toll roads)\b|\b(?:materials|launch)$|^(north|south|latin|central)\s+america\b|\basia[- ]pacific\b|^europe\b|middle east|\binternational\b|outside the u\.?s|^(energy|healthcare|industrial|consumer|retail|automotive|aerospace|data cent(?:er|re)s?|telecom)\b|\bODM group\b/i;
const GOVERNMENT = /\b(NASA|(?:U\.?S\.?|US|federal|national) government|U\.?S\.? (Air Force|Army|Navy|Space Force|Marine Corps|Intelligence Community|Department of)|Department of|Ministry of|Research Institute|ISRO|space agency)\b/i;
const SOVEREIGN = /^(?:the )?(?:U\.?S\.?|US|United States)(?: federal)? government\b/i;
// #563 COWORK #190: also "not a publicly traded company", "no publicly traded
// shares", "no longer a publicly traded company", "taken private" and "a private,
// family-owned company" -- the blurbs' own wording for ~25 private rows that read
// "No US listing". "private-label" and "private fleet" are not a company.
// A state-owned company "not publicly traded" is not private (COFCO).
const STATE_OWNED = /\bstate[- ](?:owned|controlled)\b|\bcrown corporation\b/i;
const PRIVATE = /\bprivately[- ]held\b|\bprivate(?:ly)? (?:company|firm|held|owned)\b|\bis (?:a )?private\b|\bremains private\b|\bnot publicly (?:traded|listed)\b|\b(?:not|no longer) (?:a )?publicly[- ]traded\b|\bno publicly[- ]traded shares\b|\btaken (?:fully )?private\b|\bprivate,? (?:[\w-]+,? ){0,3}(?:company|companies|firm|conglomerate)\b|\bprivate, [\w-]+-owned\b/i;

export function entityKind(c: { name: string; blurb: string; ticker?: string | null; listing?: Listing }): EntityKind {
  if (c.ticker) return "listed";
  if (c.listing) return c.listing;
  if (UNNAMED.test(c.name)) return "unnamed";
  // ONE SOVEREIGN CUSTOMER: "U.S. Government", "U.S. Federal Government (all
  // agencies combined)" — the filings report it as one customer, so it is one
  // here, whatever the blurb says about its agencies. Not "… & …", "… and …"
  // or "state & local" (several governments, a group).
  if (SOVEREIGN.test(c.name) && !/\s(?:&|and)\s|state|local|,/i.test(c.name.replace(/\([^)]*\)/g, ""))) return "government";
  if (GROUP.test(c.blurb) || GROUP_NAME.test(c.name)) return "group";
  if (GOVERNMENT.test(c.name)) return "government";
  if (PRIVATE.test(c.blurb) && !STATE_OWNED.test(c.blurb)) return "private";
  return "non-us";
}

/** The label under an unlisted row. "No US listing" never says a listed company is not listed. */
export const UNLISTED_WORDS: Record<Exclude<EntityKind, "listed">, string> = {
  "non-us": "No US listing",
  private: "Private company",
  government: "Government body",
  group: "Not a single company",
  unnamed: "Name not disclosed",
};

/** What an unlisted row is (#188): see entityKind. */
export function unlistedWords(name: string, blurb: string, listing?: Listing): string {
  const kind = entityKind({ name, blurb, listing });
  return kind === "listed" ? "" : UNLISTED_WORDS[kind];
}

/** A single named company (or public body): what "a single big customer" may mean (#188). */
export const isSingleNamed = (c: { name: string; blurb: string; ticker?: string | null; listing?: Listing }) =>
  !["group", "unnamed"].includes(entityKind(c));

export type FaqItem = { q: string; a: string };

/**
 * "Does X depend on a single big customer?" (#563 COWORK #188). The meter's
 * largest share can be a group or a region (KDP's 52% of "all other
 * customers", MELI's 55% Brazil): that is not a single customer. Only a
 * single named company (entityKind not group / unnamed) answers yes or partly,
 * at the meter's own bands; otherwise the answer says no single named customer
 * is that large, and names the bigger group. Hedged, never advice.
 */
export function singleCustomerAnswer(meter: Meter, customers?: { name: string; pct: number; blurb: string; ticker?: string | null; listing?: Listing }[]): string {
  const bands = { high: 40, medium: 20 };
  if (!customers) {
    return meter.level === "High" ? `It may: the largest customer or group on this map is ~${meter.pct}% of the mapped reliance.`
      : meter.level === "Medium" ? `Partly: the largest customer or group on this map is ~${meter.pct}%, which may matter but is not the whole picture.`
      : `Not on this map. ${meter.why}`;
  }
  if (meter.pct === null) return `Not on this map. ${meter.why}`;
  const byPct = [...customers].sort((a, b) => b.pct - a.pct);
  const single = byPct.find(isSingleNamed), group = byPct[0];
  if (single && single.pct >= bands.high) return `It may: ${single.name} is ~${single.pct}% of the mapped reliance, the largest single named customer on this map.`;
  if (single && single.pct >= bands.medium) return `Partly: ${single.name} is ~${single.pct}% of the mapped reliance, which may matter but is not the whole picture.`;
  const bigger = group && !isSingleNamed(group) && group.pct >= bands.medium ? ` The largest share (~${group.pct}%) is ${group.name}, a group rather than one customer.` : "";
  return `Not on this map: no single named customer reaches ~${bands.medium}% of the mapped reliance.${bigger}`;
}
/** Three questions from the data: the biggest supplier, one big customer or not, the linked listed stocks. */
export function buildFaq(o: {
  name: string; symbol: string;
  suppliers: { name: string; pct: number; grade: Grade }[];
  customerMeter: Meter;
  listed: string[];
  /** The customer rows (#188): only a single NAMED company answers "a single big customer". */
  customers?: { name: string; pct: number; blurb: string; ticker?: string | null; listing?: Listing }[];
}): FaqItem[] {
  const top = o.suppliers[0];
  return [
    {
      q: `Who is ${o.name}'s biggest supplier?`,
      a: top ? `On this map, ${top.name}, at an estimated ~${top.pct}% of the mapped reliance (${GRADE_WORDS[top.grade].toLowerCase()}). The shares are editorial estimates, not audited figures.` : `This page maps no suppliers for ${o.name}.`,
    },
    {
      q: `Does ${o.name} depend on a single big customer?`,
      a: singleCustomerAnswer(o.customerMeter, o.customers),
    },
    {
      q: `Which listed stocks are linked to ${o.symbol} here?`,
      a: o.listed.length ? `${o.listed.join(", ")}. Each links to its own chart and, where one exists, its own map.` : `None of the companies mapped here has a listed ticker on this site.`,
    },
  ];
}
