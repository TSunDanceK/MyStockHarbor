// Reading ONE filed revenue line from a filing's XBRL instance (Relay C, capex
// page, #563 COWORK #1 D2 / COWORK #2).
//
// WHY A PARSER OF OUR OWN: companyfacts and frames carry no dimensional facts
// (CODE-C #1 §2), and a segment or product line only exists as a fact whose
// context names a member on StatementBusinessSegmentsAxis / ProductOrServiceAxis.
// So the line is read from the filing's own instance, and its label from the
// filing's own label linkbase -- the filer's words, never ours.
//
// PURE AND IMPORT-FREE so the checks and the relay scripts load it in bare Node.

export type ReceiverAxis = "segment" | "product";

const AXES: Record<ReceiverAxis, string[]> = {
  segment: ["us-gaap:StatementBusinessSegmentsAxis", "ifrs-full:SegmentsAxis"],
  product: ["srt:ProductOrServiceAxis", "ifrs-full:ProductsAndServicesAxis"],
};

// Revenue concepts, in preference order. A filer may tag the same member under
// two of them; the first concept that carries BOTH years wins, so current and
// prior always come from one concept.
const REVENUE_CONCEPTS = [
  "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
  "us-gaap:Revenues",
  "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
  "ifrs-full:Revenue",
  "ifrs-full:RevenueFromContractsWithCustomers",
];

// Axes that sit beside the line's own axis without making it a different cut:
// "this is the segment total" rather than a second breakdown.
const NEUTRAL_AXES = new Set(["srt:ConsolidationItemsAxis"]);

type Context = { dims: Array<[string, string]>; start: string | null; end: string | null };

export function parseContexts(xml: string): Map<string, Context> {
  const out = new Map<string, Context>();
  for (const m of xml.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[\s\S]*?<\/(?:xbrli:)?context>/g)) {
    const body = m[0];
    const dims = [...body.matchAll(/<xbrldi:explicitMember[^>]*dimension="([^"]+)"[^>]*>([^<]+)</g)].map(
      (d) => [d[1].trim(), d[2].trim()] as [string, string]
    );
    const start = (body.match(/<(?:xbrli:)?startDate>([^<]+)</) ?? [])[1]?.trim() ?? null;
    const end = (body.match(/<(?:xbrli:)?endDate>([^<]+)</) ?? [])[1]?.trim() ?? null;
    out.set(m[1], { dims, start, end });
  }
  return out;
}

/** unit id -> ISO currency ("USD", "EUR"), for simple currency units only. */
export function parseUnits(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<(?:xbrli:)?unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?unit>/g)) {
    const measures = [...m[2].matchAll(/<(?:xbrli:)?measure>([^<]+)</g)].map((x) => x[1].trim());
    if (measures.length === 1 && /^iso4217:[A-Z]{3}$/.test(measures[0])) out.set(m[1], measures[0].slice(8));
  }
  return out;
}

export function documentPeriodEnd(xml: string): string | null {
  return (xml.match(/<dei:DocumentPeriodEndDate\b[^>]*>([^<]+)</) ?? [])[1]?.trim() ?? null;
}

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

export type MemberLine = {
  concept: string;
  fyStart: string;
  fyEnd: string;
  current: number;
  prior: number | null;
  currency: string;
};

/**
 * The filed fiscal-year figure for one member, and the year before it.
 *
 * `periodEnd` is the filing's DocumentPeriodEndDate: the current year is the
 * ~12-month duration ending within a week of it (52/53-week years end on a
 * weekday, not the calendar date), the prior year the one ending 330-400 days
 * earlier. Only contexts whose ONLY non-neutral dimension is this member on
 * this axis count -- a member crossed with a geography is a different line.
 */
export function readMemberLine(xml: string, element: string, axis: ReceiverAxis, periodEnd: string): MemberLine | null {
  const contexts = parseContexts(xml);
  const units = parseUnits(xml);
  const axes = new Set(AXES[axis]);
  const byConcept = new Map<string, { cy?: { v: number; st: string; en: string; cur: string }; py?: { v: number } }>();

  for (const f of xml.matchAll(/<([a-z][\w-]*:[A-Za-z]+)\b([^>]*?)\bcontextRef="([^"]+)"([^>]*)>([^<]*)</g)) {
    const concept = f[1];
    if (!REVENUE_CONCEPTS.includes(concept)) continue;
    const attrs = f[2] + f[4];
    if (/xsi:nil="true"/.test(attrs)) continue;
    const ctx = contexts.get(f[3]);
    if (!ctx?.start || !ctx.end) continue;
    const dims = ctx.dims.filter(([ax]) => !NEUTRAL_AXES.has(ax));
    if (dims.length !== 1 || !axes.has(dims[0][0]) || dims[0][1] !== element) continue;
    const span = days(ctx.start, ctx.end);
    if (span < 340 || span > 380) continue;
    const v = Number(f[5].replace(/,/g, "").trim());
    if (!Number.isFinite(v)) continue;
    const unitRef = (attrs.match(/\bunitRef="([^"]+)"/) ?? [])[1];
    const cur = unitRef ? units.get(unitRef) : undefined;
    if (!cur) continue;
    const slot = byConcept.get(concept) ?? {};
    const gap = days(ctx.end, periodEnd);
    if (Math.abs(gap) <= 7) slot.cy ??= { v, st: ctx.start, en: ctx.end, cur };
    else if (gap >= 330 && gap <= 400) slot.py ??= { v };
    byConcept.set(concept, slot);
  }

  const order = [...REVENUE_CONCEPTS];
  const both = order.find((c) => byConcept.get(c)?.cy && byConcept.get(c)?.py);
  const any = both ?? order.find((c) => byConcept.get(c)?.cy);
  if (!any) return null;
  const s = byConcept.get(any)!;
  return {
    concept: any,
    fyStart: s.cy!.st,
    fyEnd: s.cy!.en,
    current: s.cy!.v,
    prior: s.py?.v ?? null,
    currency: s.cy!.cur,
  };
}

/** Every member with fiscal-year revenue on an axis -- for discovery, not display. */
export function listMembers(xml: string, axis: ReceiverAxis, periodEnd: string): string[] {
  const contexts = parseContexts(xml);
  const axes = new Set(AXES[axis]);
  const seen = new Set<string>();
  for (const f of xml.matchAll(/<([a-z][\w-]*:[A-Za-z]+)\b[^>]*?\bcontextRef="([^"]+)"/g)) {
    if (!REVENUE_CONCEPTS.includes(f[1])) continue;
    const ctx = contexts.get(f[2]);
    if (!ctx?.start || !ctx.end || Math.abs(days(ctx.end, periodEnd)) > 7) continue;
    const dims = ctx.dims.filter(([ax]) => !NEUTRAL_AXES.has(ax));
    if (dims.length === 1 && axes.has(dims[0][0])) seen.add(dims[0][1]);
  }
  return [...seen];
}

/**
 * element local name ("DataCenterMember") -> the filer's label for it.
 *
 * Terse label first (what the filer's own tables print), then the standard
 * label; a trailing " [Member]" is the taxonomy's suffix, not the filer's word.
 * Works on a _lab.xml linkbase or a schema that embeds one.
 */
export function parseLabels(xml: string): Map<string, string> {
  const locs = new Map<string, string>();
  const res = new Map<string, Array<{ role: string; text: string }>>();
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<(?:link:)?loc\b([^>]*)\/?>/g)) {
    const href = (m[1].match(/xlink:href="[^"#]*#([^"]+)"/) ?? [])[1];
    const lab = (m[1].match(/xlink:label="([^"]+)"/) ?? [])[1];
    if (href && lab) locs.set(lab, href);
  }
  for (const m of xml.matchAll(/<(?:link:)?label\b([^>]*)>([\s\S]*?)<\/(?:link:)?label>/g)) {
    const lab = (m[1].match(/xlink:label="([^"]+)"/) ?? [])[1];
    const role = (m[1].match(/xlink:role="([^"]+)"/) ?? [])[1] ?? "";
    if (!lab) continue;
    const text = decodeXml(m[2].replace(/<[^>]+>/g, "")).trim();
    const arr = res.get(lab) ?? [];
    arr.push({ role, text });
    res.set(lab, arr);
  }
  for (const m of xml.matchAll(/<(?:link:)?labelArc\b([^>]*)\/?>/g)) {
    const from = (m[1].match(/xlink:from="([^"]+)"/) ?? [])[1];
    const to = (m[1].match(/xlink:to="([^"]+)"/) ?? [])[1];
    const href = from ? locs.get(from) : undefined;
    const found = to ? res.get(to) : undefined;
    if (!href || !found) continue;
    const pick = (r: string) => found.find((x) => x.role.endsWith(r))?.text;
    const text = (pick("/terseLabel") ?? pick("/label") ?? found[0].text).replace(/\s*\[Member\]$/, "");
    // ids look like "nvda_DataCenterMember"; key by the local name
    const local = href.replace(/^[^_]+_/, "");
    if (!out.has(local)) out.set(local, text);
  }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

export const localName = (element: string) => element.replace(/^[^:]+:/, "");

/** Case, spacing, punctuation and "&"/"and" folded, for a verbatim-presence test. */
export function foldForMatch(s: string): string {
  return decodeXml(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

/**
 * Is a sub-label genuinely the filer's words? "element": its words are the
 * element's own name ("DatacenterAndAIMember" -> "Datacenter and AI").
 * "filing-text": they appear in the filing document itself. Anything else is
 * not shown -- we never expand an acronym ourselves.
 */
export function subLabelVerified(
  sub: { text: string; source: "element" | "filing-text" },
  element: string,
  documentText: string | null
): boolean {
  const want = foldForMatch(sub.text);
  if (!want) return false;
  if (sub.source === "element") return foldForMatch(localName(element).replace(/Member$/, "")).includes(want);
  return documentText !== null && foldForMatch(documentText).includes(want);
}

/** % change, current vs prior fiscal year. Null when there is no positive prior. */
export function percentChange(current: number, prior: number | null): number | null {
  if (prior === null || !(prior > 0)) return null;
  return ((current - prior) / prior) * 100;
}

export type AnnualFiling = { accession: string; form: string; filingDate: string; primaryDocument: string; reportDate: string };

/** The newest 10-K / 20-F / 40-F in a submissions document. Amendments are not a new year. */
export function latestAnnual(submissions: unknown, forms = ["10-K", "20-F", "40-F"]): AnnualFiling | null {
  const f = (submissions as { filings?: { recent?: Record<string, string[]> } })?.filings?.recent;
  if (!f?.form) return null;
  for (let i = 0; i < f.form.length; i++) {
    if (!forms.includes(f.form[i])) continue;
    return {
      accession: f.accessionNumber[i],
      form: f.form[i],
      filingDate: f.filingDate[i],
      primaryDocument: f.primaryDocument?.[i] ?? "",
      reportDate: f.reportDate?.[i] ?? "",
    };
  }
  return null;
}

/** The XBRL instance and label linkbase in a filing folder's index.json item names. */
export function pickFilingFiles(names: string[]): { instance: string | null; labels: string | null; schema: string | null } {
  const instance =
    names.find((n) => /_htm\.xml$/i.test(n)) ??
    names.find((n) => /\.xml$/i.test(n) && !/(FilingSummary|_cal|_def|_lab|_pre|MetaLinks)/i.test(n)) ??
    null;
  const labels = names.find((n) => /_lab\.xml$/i.test(n)) ?? null;
  const schema = names.find((n) => /\.xsd$/i.test(n)) ?? null;
  return { instance, labels, schema };
}
