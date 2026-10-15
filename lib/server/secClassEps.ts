// QUARTERLY EPS PER LISTED SHARE CLASS, READ FROM THE 10-Q ITSELF (#552 COWORK #243/#244/#245).
//
// ── THE GAP ───────────────────────────────────────────────────────────────
// An Up-C or two-class filer (CVNA, GSHD) states its quarterly EPS only on
// StatementClassOfStockAxis ("per Class A share"). companyfacts publishes
// undimensioned facts only, so every such quarter read "Not reported".
//
// ── THE RULE (owner ruling, COWORK #244) ──────────────────────────────────
// The class is taken from the filing's own cover page, never from a list:
//   - the cover registers exactly ONE security (one dei:TradingSymbol);
//   - that TradingSymbol is the listed ticker;
//   - its dei:Security12bTitle names "Class X Common Stock";
//   - CommonClassXMember carries the EPS.
// Otherwise nothing is filled and the cell stays "Not reported".
//
// ── WHICH FILING (COWORK #245) ────────────────────────────────────────────
// Each quarter from the NEWEST 10-Q that states it: a 10-Q restates its
// year-ago comparative after a split (CVNA's Q2 FY2026 10-Q states Q2 FY2025
// at $0.26 post-split, first filed as $1.28), so the newest statement is on
// today's basis wherever one exists. A quarter stated only before a split
// keeps its filed value and is moved by secSplitAdjust at read time.
//
// ONLY A BLANK CELL IS FILLED, only a three-month frame, only USD per share.
// PURE except withClassEps, which takes the caller's gated fetch.
import type { ExtractResult, FieldValue } from "./secExtract";
import { SEC_FIELD_INDEX } from "./secFields";
import { FILING_INSTANCE_MAX_BYTES, pickInstanceName } from "./secFilingFill";
import { symbolSpellings } from "../symbolSpellings.mjs";

/** The most 10-Q instances read per filer (newest first): two years of quarters and their comparatives. */
export const CLASS_EPS_MAX_FILINGS = 6;
/** How many of the newest stored quarters a blank EPS must sit in to be worth a read. */
export const CLASS_EPS_QUARTERS = 8;

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

export type ClassEpsFact = { concept: "EarningsPerShareDiluted" | "EarningsPerShareBasic"; start: string; end: string; member: string | null; val: number };
export type ClassCover = { symbols: string[]; titles: string[] };
export type ClassInstance = { cover: ClassCover; eps: ClassEpsFact[] };

/** Contexts: id -> {start, end, dims}; dims as [axis, member] local names. */
function contexts(xml: string) {
  const out = new Map<string, { start: string | null; end: string | null; dims: [string, string][] }>();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    const start = m[2].match(/<(?:[\w-]+:)?startDate>\s*([\d-]+)/)?.[1] ?? null;
    const end = m[2].match(/<(?:[\w-]+:)?endDate>\s*([\d-]+)/)?.[1] ?? m[2].match(/<(?:[\w-]+:)?instant>\s*([\d-]+)/)?.[1] ?? null;
    const dims = [...m[2].matchAll(/<(?:[\w-]+:)?explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]*)/g)]
      .map((d) => [d[1].replace(/^.*:/, ""), d[2].replace(/^.*:/, "")] as [string, string]);
    out.set(m[1], { start, end, dims });
  }
  return out;
}

/** The USD-per-share unit ids of an instance. */
function perShareUnits(xml: string): Set<string> {
  const out = new Set<string>();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?unit>/g)) {
    if (/iso4217:USD\b/.test(m[2]) && /shares\b/.test(m[2])) out.add(m[1]);
  }
  return out;
}

/** One instance's cover-page securities and its three-month EPS, undimensioned and per class. */
export function parseClassInstance(xml: string): ClassInstance {
  const ctx = contexts(xml);
  const units = perShareUnits(xml);
  const cover: ClassCover = { symbols: [], titles: [] };
  for (const m of xml.matchAll(/<dei:(TradingSymbol|Security12bTitle)\b[^>]*>\s*([^<]+?)\s*<\/dei:\1>/g)) {
    (m[1] === "TradingSymbol" ? cover.symbols : cover.titles).push(m[2].trim());
  }
  const eps: ClassEpsFact[] = [];
  for (const m of xml.matchAll(/<us-gaap:(EarningsPerShareDiluted|EarningsPerShareBasic)\b([^>]*)>\s*([^<]+?)\s*<\/us-gaap:\1>/g)) {
    const c = ctx.get(m[2].match(/\bcontextRef="([^"]+)"/)?.[1] ?? "");
    const unit = m[2].match(/\bunitRef="([^"]+)"/)?.[1];
    const val = Number(m[3]);
    if (!c?.start || !c.end || !unit || !units.has(unit) || !Number.isFinite(val)) continue;
    const d = days(c.start, c.end);
    if (d < 80 || d > 119) continue;
    let member: string | null;
    if (c.dims.length === 0) member = null;
    else if (c.dims.length === 1 && c.dims[0][0] === "StatementClassOfStockAxis") member = c.dims[0][1];
    else continue;
    eps.push({ concept: m[1] as ClassEpsFact["concept"], start: c.start, end: c.end, member, val });
  }
  return { cover, eps };
}

/**
 * The class member the cover identifies for the listed ticker, or why not.
 * Exactly one security registered, its symbol the listed one (any of the
 * symbol's spellings), its title naming "Class X Common Stock".
 */
export function listedClassMember(cover: ClassCover, symbol: string): { member: string } | { refused: string } {
  const syms = [...new Set(cover.symbols.map((s) => s.toUpperCase()))];
  if (syms.length !== 1) return { refused: `${syms.length} securities on the cover` };
  const spellings = new Set(symbolSpellings(symbol).map((s: string) => s.toUpperCase()));
  if (!spellings.has(syms[0])) return { refused: `cover symbol ${syms[0]} is not the listed ticker` };
  const titles = [...new Set(cover.titles)];
  if (titles.length !== 1) return { refused: `${titles.length} security titles on the cover` };
  const m = titles[0].match(/\bClass\s+([A-Z])\b[^,;]*\bCommon\s+Stock\b/i);
  if (!m) return { refused: "the cover title names no share class" };
  return { member: `CommonClass${m[1].toUpperCase()}Member` };
}

export type ClassEpsFill = { end: string; key: "epsDiluted" | "epsBasic"; val: number; accession: string };

/**
 * The fills, given the filer's instances NEWEST FIRST. The class is fixed by
 * the newest instance's cover; each blank quarter (start..end of a stored
 * quarter) takes the member's value from the first (newest) instance stating
 * that frame. An undimensioned figure for the frame anywhere means the filer
 * states one plain EPS, and the class figure is not used for it.
 */
export function classEpsFills(
  symbol: string,
  instances: { accession: string; parsed: ClassInstance }[],
  blanks: { start: string; end: string; key: "epsDiluted" | "epsBasic" }[],
): { member: string | null; fills: ClassEpsFill[]; refused?: string } {
  if (!instances.length) return { member: null, fills: [], refused: "no 10-Q instance" };
  const id = listedClassMember(instances[0].parsed.cover, symbol);
  if ("refused" in id) return { member: null, fills: [], refused: id.refused };
  const concept = (key: string) => (key === "epsDiluted" ? "EarningsPerShareDiluted" : "EarningsPerShareBasic");
  const fills: ClassEpsFill[] = [];
  for (const b of blanks) {
    const sameFrame = (f: ClassEpsFact) => f.concept === concept(b.key) && f.end === b.end && Math.abs(days(f.start, b.start)) <= 7;
    if (instances.some((i) => i.parsed.eps.some((f) => sameFrame(f) && f.member === null))) continue;
    for (const i of instances) {
      const hit = i.parsed.eps.find((f) => sameFrame(f) && f.member === id.member);
      if (hit) { fills.push({ end: b.end, key: b.key, val: hit.val, accession: i.accession }); break; }
    }
  }
  return { member: id.member, fills };
}

/** The extracted quarters' blank EPS cells worth a read: the newest CLASS_EPS_QUARTERS, Q1-Q3, net income present. */
export function blankEpsCells(extracted: Pick<ExtractResult, "quarters">): { start: string; end: string; key: "epsDiluted" | "epsBasic" }[] {
  const ni = SEC_FIELD_INDEX["netIncome"];
  const out: { start: string; end: string; key: "epsDiluted" | "epsBasic" }[] = [];
  const qs = [...extracted.quarters].sort((a, b) => b.end.localeCompare(a.end)).slice(0, CLASS_EPS_QUARTERS);
  for (const p of qs) {
    // A Q4 IS NEVER IN A 10-Q (the 10-K states the year), so a blank Q4 is
    // not a reason to read one; #897's derived Q4 covers it on the page.
    if (!p.start || p.fp === "Q4" || p.values[ni]?.val == null) continue;
    for (const key of ["epsDiluted", "epsBasic"] as const) if (p.values[SEC_FIELD_INDEX[key]]?.val == null) out.push({ start: p.start, end: p.end, key });
  }
  return out;
}

/** Writes the fills into the extracted quarters, as filed. Returns how many. */
export function applyClassEps(extracted: Pick<ExtractResult, "quarters">, fills: ClassEpsFill[], member: string): number {
  let n = 0;
  for (const f of fills) {
    const p = extracted.quarters.find((q) => q.end === f.end);
    const i = SEC_FIELD_INDEX[f.key];
    if (!p || p.values[i]?.val != null) continue;
    const cell: FieldValue = {
      val: f.val,
      tag: f.key === "epsDiluted" ? "EarningsPerShareDiluted" : "EarningsPerShareBasic",
      ns: "us-gaap",
      unit: "USD/shares",
      derived: "as-filed",
      covers: [p.start!, p.end],
    };
    p.values[i] = cell;
    n++;
  }
  if (n) (extracted as Partial<ExtractResult>).notes?.push(`eps: ${n} quarter cell(s) read per ${member} share from the 10-Q (listed class, cover page)`);
  return n;
}

/**
 * THE ONE CALL a companyfacts reader makes after extracting, before
 * withInstanceEps. A set with no blank quarterly EPS beside a filed net income
 * costs nothing; otherwise submissions, then the index and instance of up to
 * CLASS_EPS_MAX_FILINGS 10-Qs, newest first, stopping as soon as every blank
 * is answered or the newest cover identifies no class. Any failure leaves the
 * set as extracted.
 */
export async function withClassEps(
  symbol: string,
  cik: string,
  extracted: ExtractResult,
  get: (url: string) => Promise<Response>,
): Promise<number> {
  if (extracted.reportingCurrency && extracted.reportingCurrency !== "USD") return 0;
  const blanks = blankEpsCells(extracted);
  if (!blanks.length) return 0;
  try {
    const subs = (await (await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).json()) as {
      filings?: { recent?: { form?: string[]; accessionNumber?: string[] } };
    };
    const r = subs.filings?.recent ?? {};
    const tenQs = (r.form ?? []).map((f, i) => ({ f, i })).filter((x) => x.f === "10-Q").slice(0, CLASS_EPS_MAX_FILINGS);
    const instances: { accession: string; parsed: ClassInstance }[] = [];
    for (const { i } of tenQs) {
      const accession = r.accessionNumber?.[i] ?? "";
      const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}`;
      const idx = (await (await get(`${base}/index.json`)).json()) as { directory?: { item?: { name?: string; size?: string | number }[] } };
      const items = idx.directory?.item ?? [];
      const name = pickInstanceName(items.map((it) => String(it.name ?? "")));
      if (!name || Number(items.find((it) => it.name === name)?.size ?? 0) > FILING_INSTANCE_MAX_BYTES) continue;
      instances.push({ accession, parsed: parseClassInstance(await (await get(`${base}/${name}`)).text()) });
      // THE NEWEST COVER DECIDES: no class identified, no further reads.
      if (instances.length === 1 && "refused" in listedClassMember(instances[0].parsed.cover, symbol)) break;
      const { fills } = classEpsFills(symbol, instances, blanks);
      if (fills.length === blanks.length) break;
    }
    const { member, fills, refused } = classEpsFills(symbol, instances, blanks);
    if (!member || !fills.length) {
      if (refused) console.warn(`[sec-class-eps] ${symbol}: ${refused}`);
      return 0;
    }
    return applyClassEps(extracted, fills, member);
  } catch (err) {
    console.warn(`[sec-class-eps] ${symbol}: read failed`, err);
    return 0;
  }
}
