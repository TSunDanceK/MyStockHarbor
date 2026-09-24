// A MULTI-CLASS FILER'S COVER-PAGE SHARE COUNT, FROM ITS OWN FILING
// (#552 COWORK #31).
//
// companyfacts publishes the default context only, and a multi-class filer
// states `dei:EntityCommonStockSharesOutstanding` ONCE PER CLASS, on the
// StatementClassOfStockAxis. So for META, V, MA, BRK, CMCSA, ACN, PLTR and
// ~60 more, companyfacts holds either nothing or an undimensioned value from
// a decade ago -- and valuationInputs rightly refused the count as missing or
// stale. Measured: 69 of the 82 non-ADS Pickers refusals are exactly this.
//
// THE FILING'S OWN INSTANCE carries the per-class facts. This reads them from
// the newest 10-Q/10-K and combines the classes on ONE cover date, weighted
// in listed-class equivalents by a CITED map (data/sec/share-classes.json):
//   - classes that are economically equal (1:1 convertible, equal dividend
//     and liquidation rights) weigh 1;
//   - a class that converts at a stated ratio weighs that ratio (BRK: one
//     Class A = 1,500 Class B);
//   - a filer with no entry, or a class on the cover the entry does not
//     name, is REFUSED exactly as before. Nothing is summed on a guess.
//
// PURE except withClassCover, which takes the caller's own rate-gated fetch.
import sharesFile from "@/data/sec/share-classes.json";
import type { CoverShares } from "./secExtract";
import { FILING_INSTANCE_MAX_BYTES, pickInstanceName } from "./secFilingFill";
import { lookupSpellingIn } from "../symbolSpellings.mjs";

export type ShareClassEntry = {
  /** The class member whose price this site quotes for the symbol. */
  listed: string;
  /** Listed-class equivalents per share, by StatementClassOfStockAxis member (local name). */
  weights: Record<string, number>;
  /** The filing's own words for each weight, verbatim. */
  evidence: string[];
  /** The 10-K the evidence is quoted from (accession). */
  source: string;
  /** The class to read EPS for, when not `listed` (BRK: per equivalent Class B share). See secInstanceEps. */
  epsMember?: string;
};

const ENTRIES = (sharesFile as unknown as { entries: Record<string, ShareClassEntry> }).entries;

export function shareClassesFor(symbol: string): ShareClassEntry | null {
  return lookupSpellingIn(ENTRIES, String(symbol ?? "").toUpperCase())?.value ?? null;
}

export type ClassCoverFact = { asOf: string; member: string; val: number };

/**
 * Every dei:EntityCommonStockSharesOutstanding fact whose context is dimensioned
 * by StatementClassOfStockAxis ALONE. A fact on any other axis (SPG's
 * LegalEntityAxis row for its operating partnership) is not a class count and
 * is left out; an undimensioned fact is companyfacts' business, not this one's.
 */
export function parseCoverClasses(xml: string): ClassCoverFact[] {
  const ctx = new Map<string, { asOf: string | null; member: string | null }>();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    const asOf = m[2].match(/<(?:[\w-]+:)?instant>\s*([\d-]+)/)?.[1] ?? null;
    const dims = [...m[2].matchAll(/<(?:[\w-]+:)?explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)/g)];
    const onlyClass = dims.length === 1 && /(?:^|:)StatementClassOfStockAxis$/.test(dims[0][1]);
    ctx.set(m[1], { asOf, member: onlyClass ? dims[0][2].replace(/^.*:/, "") : null });
  }
  const out: ClassCoverFact[] = [];
  for (const m of xml.matchAll(/<dei:EntityCommonStockSharesOutstanding\b[^>]*\bcontextRef="([^"]+)"[^>]*>\s*([^<]+?)\s*</g)) {
    const c = ctx.get(m[1]);
    const val = Number(m[2]);
    if (!c?.asOf || !c.member || !Number.isFinite(val)) continue;
    out.push({ asOf: c.asOf, member: c.member, val });
  }
  return out;
}

export type ClassCover =
  | { ok: true; cover: CoverShares }
  | { ok: false; why: string };

/**
 * The newest cover date's classes, weighted and summed, or why not.
 * EVERY class stated on that date must be in the entry: an unnamed class is
 * a share count we cannot price, and dropping it would understate the cap.
 */
export function coverFromClasses(
  facts: ClassCoverFact[],
  entry: ShareClassEntry,
  filing: { accession: string | null; filed: string | null },
): ClassCover {
  if (!facts.length) return { ok: false, why: "no per-class cover facts in the filing" };
  const asOf = facts.map((f) => f.asOf).sort().at(-1)!;
  const onDate = facts.filter((f) => f.asOf === asOf);
  const unknown = onDate.filter((f) => !(f.member in entry.weights));
  if (unknown.length) return { ok: false, why: `class not in the cited map: ${unknown.map((f) => f.member).join(", ")}` };
  if (!onDate.some((f) => f.member === entry.listed)) return { ok: false, why: `listed class ${entry.listed} not on the ${asOf} cover` };
  // The unknown-class refusal above is the ONLY guard against dropping a class:
  // a missing weight here would count as 0.
  const val = onDate.reduce((a, f) => a + f.val * (entry.weights[f.member] ?? 0), 0);
  if (!(val > 0)) return { ok: false, why: "weighted total is not positive" };
  return { ok: true, cover: { asOf, accession: filing.accession, filed: filing.filed, val: Math.round(val), derived: "computed" } };
}

/**
 * THE ONE CALL a companyfacts reader makes after extracting. A symbol with no
 * entry returns its cover unchanged and costs nothing; a cited multi-class
 * filer costs three SEC requests (submissions, the filing index, the
 * instance) through the caller's own gated fetch. Any failure keeps the
 * extractor's cover, so the page is never worse than before.
 */
export async function withClassCover(
  symbol: string,
  cik: string,
  cover: CoverShares | null,
  get: (url: string) => Promise<Response>,
): Promise<CoverShares | null> {
  const entry = shareClassesFor(symbol);
  if (!entry) return cover;
  try {
    const subs = (await (await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).json()) as {
      filings?: { recent?: { form?: string[]; accessionNumber?: string[]; filingDate?: string[] } };
    };
    const r = subs.filings?.recent ?? {};
    const i = (r.form ?? []).findIndex((f) => f === "10-Q" || f === "10-K");
    if (i < 0) return cover;
    const accession = r.accessionNumber?.[i] ?? null;
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(accession).replace(/-/g, "")}`;
    const idx = (await (await get(`${base}/index.json`)).json()) as { directory?: { item?: { name?: string; size?: string | number }[] } };
    const items = idx.directory?.item ?? [];
    const name = pickInstanceName(items.map((it) => String(it.name ?? "")));
    if (!name || Number(items.find((it) => it.name === name)?.size ?? 0) > FILING_INSTANCE_MAX_BYTES) return cover;
    const xml = await (await get(`${base}/${name}`)).text();
    const out = coverFromClasses(parseCoverClasses(xml), entry, { accession, filed: r.filingDate?.[i] ?? null });
    if (!out.ok) {
      console.warn(`[sec-cover-classes] ${symbol}: ${out.why}`);
      return cover;
    }
    return out.cover;
  } catch (err) {
    console.warn(`[sec-cover-classes] ${symbol}: read failed`, err);
    return cover;
  }
}
