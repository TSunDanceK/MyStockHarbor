// TWELVE MONTHS OF EPS FROM THE FILINGS THEMSELVES (#552 COWORK #33).
//
// The stored-set path (secValuation.fourConsecutiveQuarters) sums four stored
// quarters, deriving Q4 as the year less Q1-Q3. B's census found 51 quarterly
// filers it refuses, and measured why (scripts/no-ttm-eps-probe.mjs):
//   - a 52/53-week filer's 16-week quarter falls outside the quarter band, so
//     the window has a gap (COST, PEP, AZO, DPZ, AAP);
//   - a split inside the window: the newer 10-Q restates its comparatives
//     post-split and the older 10-Q does not (NFLX, NOW, BKNG, CRWD, TPL);
//   - EPS stated only per class on StatementClassOfStockAxis, which
//     companyfacts drops (V, BRK.B, HSY, COKE, BKR, KKR, JEF);
//   - partnerships state net income per limited-partnership UNIT (WES, MPLX).
//
// ONE RULE COVERS ALL FOUR, and it is the standard one:
//
//     TTM = fiscal year (latest 10-K)
//         + year-to-date (latest 10-Q)
//         - the same year-to-date a year earlier (the same 10-Q's comparative)
//
// The 10-Q states both year-to-date figures on ONE share basis (it restates the
// comparative for a split), there is no Q4 to derive, no quarter band to fit,
// and the per-class figure is read where the filer put it.
//
// THE SAME GUARDS AS derivedQ4Eps, NOTHING LOOSER:
//   - the three periods chain: the year-to-date starts the day after the
//     fiscal year ends, the comparative starts when that year started and is
//     the same length, a year earlier;
//   - one EPS concept for all three; diluted wherever the filer states a
//     diluted figure, basic only for a filer that states none at all (BRK),
//     and the basis says which;
//   - the three weighted share counts (year, year-to-date, prior year-to-date)
//     within Q4_SHARE_BASIS_TOLERANCE of EACH OTHER: a split between the 10-K
//     and the 10-Q, or a share issuance inside the window, puts them on
//     different bases, and that is refused, not adjusted;
//   - USD per share only;
//   - ONE CLASS: the cited listed class (data/sec/share-classes.json), else
//     the undimensioned figure, else the only class the filer states. Several
//     classes and no citation is refused.
//
// USED ONLY WHERE THE STORED PATH REFUSES, so no figure that is on the page
// today moves. PURE except withInstanceEps, which takes the caller's gated fetch.
import sharesFile from "@/data/sec/share-classes.json";
import type { ExtractResult } from "./secExtract";
import { encodePeriod, type InstanceEps, type StoredFactSet } from "./secFactCodec";
import { FILING_INSTANCE_MAX_BYTES, pickInstanceName } from "./secFilingFill";
import { Q4_SHARE_BASIS_TOLERANCE, ttmEpsFromSet } from "./secValuation";
import { lookupSpellingIn } from "../symbolSpellings.mjs";

const ENTRIES = (sharesFile as unknown as { entries: Record<string, { listed: string; epsMember?: string }> }).entries;

/** EPS concepts in the order tried; each family's diluted first. */
export const INSTANCE_EPS_CONCEPTS: { concept: string; kind: "diluted" | "basic"; shares: "diluted" | "basic" }[] = [
  { concept: "EarningsPerShareDiluted", kind: "diluted", shares: "diluted" },
  { concept: "EarningsPerShareBasicAndDiluted", kind: "diluted", shares: "diluted" },
  { concept: "NetIncomeLossNetOfTaxPerOutstandingLimitedPartnershipUnitDiluted", kind: "diluted", shares: "diluted" },
  { concept: "NetIncomeLossPerOutstandingLimitedPartnershipUnitDiluted", kind: "diluted", shares: "diluted" },
  { concept: "EarningsPerShareBasic", kind: "basic", shares: "basic" },
  { concept: "NetIncomeLossPerOutstandingLimitedPartnershipUnitBasicNetOfTax", kind: "basic", shares: "basic" },
  { concept: "NetIncomeLossPerOutstandingLimitedPartnershipUnit", kind: "basic", shares: "basic" },
];
const SHARE_CONCEPTS = {
  diluted: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageLimitedPartnershipUnitsOutstandingDiluted"],
  basic: ["WeightedAverageNumberOfSharesOutstandingBasic", "WeightedAverageLimitedPartnershipUnitsOutstanding"],
};
const WANTED = new Set([...INSTANCE_EPS_CONCEPTS.map((c) => c.concept), ...SHARE_CONCEPTS.diluted, ...SHARE_CONCEPTS.basic]);

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;
/** How far a start may sit from where the chain puts it (a 52/53-week year lands on a weekday). */
export const CHAIN_SLACK_DAYS = 3;
/** How far the comparative's end may sit from a year before (the same reason). */
export const COMPARATIVE_SLACK_DAYS = 10;

export type DurationFact = { concept: string; start: string; end: string; member: string | null; val: number; usd: boolean };

/**
 * Duration facts for the EPS and share concepts, from one instance: those with
 * no dimension (member null) and those on StatementClassOfStockAxis ALONE.
 * Anything on another axis (a segment, a legal entity) is not the company's
 * per-share figure and is left out.
 */
export function parseDurationFacts(xml: string): DurationFact[] {
  const units = new Map<string, boolean>();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?unit>/g)) {
    units.set(m[1], /iso4217:USD\b/.test(m[2]));
  }
  const ctx = new Map<string, { start: string; end: string; member: string | null } | null>();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    const start = m[2].match(/<(?:[\w-]+:)?startDate>\s*([\d-]+)/)?.[1];
    const end = m[2].match(/<(?:[\w-]+:)?endDate>\s*([\d-]+)/)?.[1];
    const dims = [...m[2].matchAll(/<(?:[\w-]+:)?(?:explicitMember|typedMember)[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]*)/g)];
    if (!start || !end) { ctx.set(m[1], null); continue; }
    if (dims.length === 0) ctx.set(m[1], { start, end, member: null });
    else if (dims.length === 1 && /(?:^|:)StatementClassOfStockAxis$/.test(dims[0][1])) ctx.set(m[1], { start, end, member: dims[0][2].replace(/^.*:/, "") });
    else ctx.set(m[1], null);
  }
  const out: DurationFact[] = [];
  for (const m of xml.matchAll(/<([\w-]+):(\w+)\b([^>]*)>\s*([^<]+?)\s*<\/\1:\2>/g)) {
    if (!WANTED.has(m[2])) continue;
    const ref = m[3].match(/\bcontextRef="([^"]+)"/)?.[1];
    const c = ref ? ctx.get(ref) : null;
    const val = Number(m[4]);
    if (!c || !Number.isFinite(val)) continue;
    const unit = m[3].match(/\bunitRef="([^"]+)"/)?.[1];
    out.push({ concept: m[2], start: c.start, end: c.end, member: c.member, val, usd: unit ? units.get(unit) === true : false });
  }
  return out;
}

/**
 * Which class's figures to read: the cited one where the filer states it,
 * else the undimensioned figure, else the only class stated. Null (refused)
 * when several classes are stated and none is cited, or the cited class is
 * not among them.
 */
export function pickMember(facts: DurationFact[], cited: string | null): { member: string | null } | null {
  const eps = facts.filter((f) => INSTANCE_EPS_CONCEPTS.some((c) => c.concept === f.concept));
  if (cited && eps.some((f) => f.member === cited)) return { member: cited };
  if (eps.some((f) => f.member === null)) return { member: null };
  if (cited) return null;
  const classes = [...new Set(eps.map((f) => f.member))];
  return classes.length === 1 ? { member: classes[0] } : null;
}

export type InstanceTtm = { ok: true; eps: InstanceEps } | { ok: false; why: string };

/**
 * FY (10-K) + YTD (10-Q) - prior YTD (the 10-Q's comparative), or why not.
 * `k` and `q` are the two instances' facts; `cited` is the listed class, if any.
 */
export function ttmFromInstances(
  k: DurationFact[],
  q: DurationFact[],
  cited: string | null,
  filings: { k: string | null; q: string | null },
): InstanceTtm {
  const picked = pickMember([...q, ...k], cited);
  if (!picked) return { ok: false, why: "several share classes state EPS and none is cited" };
  const mine = (list: DurationFact[]) => list.filter((f) => f.member === picked.member);
  const K = mine(k), Q = mine(q);

  // The newest year-to-date in the 10-Q, and the fiscal year it follows.
  const ytdEnd = Q.map((f) => f.end).sort().at(-1);
  if (!ytdEnd) return { ok: false, why: "the 10-Q states no EPS for the class" };
  const years = K.filter((f) => { const d = days(f.start, f.end); return d >= 350 && d <= 380; });
  const fyEnd = years.map((f) => f.end).filter((e) => e < ytdEnd).sort().at(-1);
  if (!fyEnd) return { ok: false, why: "the 10-K states no fiscal year before the 10-Q" };
  const fyStart = years.find((f) => f.end === fyEnd)!.start;

  // A diluted concept is used if the filer states ANY diluted EPS; basic only if none.
  const statesDiluted = [...K, ...Q].some((f) => INSTANCE_EPS_CONCEPTS.some((c) => c.concept === f.concept && c.kind === "diluted"));
  for (const c of INSTANCE_EPS_CONCEPTS) {
    if (c.kind === "basic" && statesDiluted) continue;
    const fy = K.find((f) => f.concept === c.concept && f.end === fyEnd && f.start === fyStart);
    const ytd = Q.filter((f) => f.concept === c.concept && f.end === ytdEnd && Math.abs(days(fyEnd, f.start) - 1) <= CHAIN_SLACK_DAYS)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    if (!fy || !ytd) continue;
    const len = days(ytd.start, ytd.end);
    const prior = Q.find((f) => f.concept === c.concept && Math.abs(days(fyStart, f.start)) <= CHAIN_SLACK_DAYS
      && Math.abs(days(f.end, ytdEnd) - 365) <= COMPARATIVE_SLACK_DAYS && Math.abs(days(f.start, f.end) - len) <= 7);
    if (!prior) return { ok: false, why: `no prior-year year-to-date for ${c.concept}` };
    if (![fy, ytd, prior].every((f) => f.usd)) return { ok: false, why: "EPS not stated in USD per share" };

    // THE SHARE-BASIS GUARD, as derivedQ4Eps: one kind, never mixed.
    const shareOf = (list: DurationFact[], p: DurationFact) =>
      list.find((f) => SHARE_CONCEPTS[c.shares].includes(f.concept) && f.start === p.start && f.end === p.end)?.val ?? null;
    const sy = shareOf(K, fy), sc = shareOf(Q, ytd), sp = shareOf(Q, prior);
    if (sy === null || sc === null || sp === null || Math.min(sy, sc, sp) <= 0) return { ok: false, why: `no ${c.shares} share count for all three periods` };
    // PAIRWISE, NOT AGAINST THE YEAR ALONE: a six-month average sits between
    // its quarters, so a count that jumped mid-year (COF's Discover shares,
    // 384M -> 640M) passes a year-only test while each year-to-date is on a
    // different basis from the other. All three within the tolerance of each other.
    if (Math.max(sy, sc, sp) / Math.min(sy, sc, sp) - 1 > Q4_SHARE_BASIS_TOLERANCE) {
      return { ok: false, why: `share basis moved between the 10-K and the 10-Q (${sy} vs ${sc}/${sp})` };
    }
    const val = Math.round((fy.val + ytd.val - prior.val) * 10_000) / 10_000;
    return {
      ok: true,
      eps: {
        val, periodEnd: ytdEnd, yearEnd: fyEnd, ytdStart: ytd.start, ytdDays: Math.round(len),
        kind: c.kind, member: picked.member, concept: c.concept, k: filings.k, q: filings.q,
      },
    };
  }
  return { ok: false, why: "no EPS concept stated for the fiscal year and the year-to-date" };
}

/** The cited class to read EPS for, if the symbol has one. */
export function citedEpsMember(symbol: string): string | null {
  const e = lookupSpellingIn(ENTRIES, String(symbol ?? "").toUpperCase())?.value;
  return e ? e.epsMember ?? e.listed : null;
}

/**
 * THE ONE CALL a companyfacts reader makes after extracting. A set whose own
 * quarters or year give twelve months costs nothing and gets nothing; otherwise
 * five SEC requests (submissions, and the index and instance of the newest 10-Q
 * and 10-K) through the caller's gated fetch. Any failure leaves it absent.
 */
export async function withInstanceEps(
  symbol: string,
  cik: string,
  extracted: ExtractResult,
  get: (url: string) => Promise<Response>,
  today = new Date().toISOString().slice(0, 10),
): Promise<InstanceEps | undefined> {
  if (extracted.reportingCurrency && extracted.reportingCurrency !== "USD") return undefined;
  const probe = {
    quarters: extracted.quarters.map(encodePeriod),
    years: extracted.years.map(encodePeriod),
    cur: extracted.reportingCurrency,
  } as Pick<StoredFactSet, "quarters" | "years" | "cur">;
  if (ttmEpsFromSet(probe, {}, today)) return undefined;
  try {
    const subs = (await (await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).json()) as {
      filings?: { recent?: { form?: string[]; accessionNumber?: string[] } };
    };
    const r = subs.filings?.recent ?? {};
    const forms = r.form ?? [];
    const qi = forms.findIndex((f) => f === "10-Q");
    const ki = forms.findIndex((f) => f === "10-K");
    // The 10-Q must be newer than the 10-K (submissions are newest first);
    // otherwise the year IS the latest twelve months and the stored path has it.
    if (qi < 0 || ki < 0 || qi > ki) return undefined;
    const read = async (i: number) => {
      const accession = r.accessionNumber?.[i] ?? "";
      const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}`;
      const idx = (await (await get(`${base}/index.json`)).json()) as { directory?: { item?: { name?: string; size?: string | number }[] } };
      const items = idx.directory?.item ?? [];
      const name = pickInstanceName(items.map((it) => String(it.name ?? "")));
      if (!name || Number(items.find((it) => it.name === name)?.size ?? 0) > FILING_INSTANCE_MAX_BYTES) return null;
      return { accession, facts: parseDurationFacts(await (await get(`${base}/${name}`)).text()) };
    };
    const q = await read(qi);
    const k = q ? await read(ki) : null;
    if (!q || !k) return undefined;
    const out = ttmFromInstances(k.facts, q.facts, citedEpsMember(symbol), { k: k.accession, q: q.accession });
    if (!out.ok) {
      console.warn(`[sec-instance-eps] ${symbol}: ${out.why}`);
      return undefined;
    }
    return out.eps;
  } catch (err) {
    console.warn(`[sec-instance-eps] ${symbol}: read failed`, err);
    return undefined;
  }
}
