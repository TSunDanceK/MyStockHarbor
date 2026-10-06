// /upcoming-ipos: WHAT A ROW'S PROFILE SAYS, AND HOW (#553 COWORK #159 PR 1).
//
// PURE and import-free: the server builds the stored profile
// (lib/server/ipoProfiles.ts), the client list renders it, and the check runs
// every rule here on fixtures. Everything shown comes from SEC EDGAR (public
// domain): the filer's submissions JSON, its registration filings and the
// filing-fee exhibit. Nothing is estimated; a fact that is not on file is
// simply not shown.

/** One filing of the registration story, newest last. */
export type IpoProfileFiling = { form: string; date: string; acc: string; doc: string | null };

/** The stored profile of one IPO filer, keyed by CIK. JSON-safe, figures as filed. */
export type IpoProfile = {
  v: 1;
  cik: string;
  /** The newest filing date in the filer's IPO record when this was built: the refresh key. */
  basedOn: string;
  sic: string | null;
  sicDescription: string | null;
  city: string | null;
  /** Business-address state or country, as EDGAR describes it ("CA", "CAYMAN ISLANDS"). */
  region: string | null;
  incorporatedIn: string | null;
  /** MMDD, as filed. */
  fiscalYearEnd: string | null;
  /** True only when EDGAR's filer category names an emerging growth company. */
  emergingGrowth: boolean;
  /** Registration, amendment, prospectus and listing filings (oldest first). */
  filings: IpoProfileFiling[];
  /** The fee exhibit's total maximum aggregate offering price (ffd:TtlOfferingAmt), USD. */
  maxDealSize: number | null;
  /** Which filing that figure was read from. */
  maxDealSizeFrom: { form: string; date: string } | null;
};

export const REGISTRATION = /^(S-1|F-1)$/;
export const REG_AMENDMENT = /^(S-1|F-1)\/A$/;
export const PRICED = /^424B[14]$/;
export const LISTED = /^8-A12B$/;
export const PROFILE_FORMS = /^(S-1|S-1\/A|F-1|F-1\/A|424B1|424B4|8-A12B)$/;

/** SIC 6770 (blank checks) or a name that says "blank check": a SPAC. */
export function isSpac(sic: string | null | undefined, company: string): boolean {
  const code = String(sic ?? "").trim();
  if (/\bblank[- ]check\b/i.test(company)) return true;
  if (code) return code === "6770";
  // NO SIC ON FILE YET (#553 COWORK #187): the profile fills over the first
  // nights after a filer appears, so until then the name decides. Once the SIC
  // is known it wins, both ways.
  return SPAC_NAME.test(company);
}

/** The name a blank-check company files under: "... Acquisition Corp", "... Acquisition Corp. II". */
export const SPAC_NAME = /\bacquisition\s+(corp(oration)?|co|company|inc|ltd|limited)\b/i;

/** A foreign private issuer registers on Form F-1. */
export function isForeignFiler(filings: readonly { form: string }[]): boolean {
  return filings.some((f) => /^F-1(\/A)?$/.test(f.form));
}

export type IpoKind = "company" | "spac" | "foreign";

/** The row's type badge: a SPAC first (it is the bigger difference), then a foreign filer. */
export function ipoKind(sic: string | null | undefined, company: string, filings: readonly { form: string }[]): IpoKind {
  if (isSpac(sic, company)) return "spac";
  if (isForeignFiler(filings)) return "foreign";
  return "company";
}

export type TimelineStep = { key: "filed" | "amended" | "terms" | "priced" | "listed"; label: string; date: string | null; detail: string | null; done: boolean };

const lastOf = (fs: readonly IpoProfileFiling[], re: RegExp) => [...fs].reverse().find((f) => re.test(f.form)) ?? null;
const firstOf = (fs: readonly IpoProfileFiling[], re: RegExp) => fs.find((f) => re.test(f.form)) ?? null;

/**
 * Where the filing stands: first S-1/F-1 -> amendments -> terms set -> priced
 * (424B1/424B4) -> listed (8-A12B). A step not reached yet is not done; the
 * page greys it. `termsDate` is the row's own "terms set" date for the upcoming
 * table (the amendment its price range was read from).
 */
export function ipoTimeline(filings: readonly IpoProfileFiling[], termsDate: string | null): TimelineStep[] {
  const filed = firstOf(filings, REGISTRATION);
  const amendments = filings.filter((f) => REG_AMENDMENT.test(f.form));
  const priced = lastOf(filings, PRICED);
  const listed = lastOf(filings, LISTED);
  const amendDetail = amendments.length
    ? `${amendments.length} amendment${amendments.length === 1 ? "" : "s"}${amendments.length > 1 ? `, ${amendments[0].date} to ${amendments[amendments.length - 1].date}` : ""}`
    : null;
  const termsSet = termsDate;
  return [
    { key: "filed", label: filed ? `First filed (${filed.form})` : "First filed", date: filed?.date ?? null, detail: null, done: Boolean(filed) },
    { key: "amended", label: "Amended", date: amendments.length ? amendments[amendments.length - 1].date : null, detail: amendDetail, done: amendments.length > 0 },
    { key: "terms", label: "Terms set", date: termsSet, detail: null, done: Boolean(termsSet) || Boolean(priced) },
    { key: "priced", label: "Priced (final prospectus)", date: priced?.date ?? null, detail: priced ? priced.form : null, done: Boolean(priced) },
    { key: "listed", label: "Listed (exchange registration)", date: listed?.date ?? null, detail: null, done: Boolean(listed) },
  ];
}

/** The latest registration filing (the S-1/F-1 or its newest amendment). */
export function latestRegistration(filings: readonly IpoProfileFiling[]): IpoProfileFiling | null {
  return lastOf(filings, /^(S-1|F-1)(\/A)?$/);
}

/** The filing's document on EDGAR, or its index when the primary document is unknown. */
export function filingUrl(cik: string, f: IpoProfileFiling): string {
  const c = String(Number(cik));
  const acc = f.acc.replace(/-/g, "");
  return f.doc
    ? `https://www.sec.gov/Archives/edgar/data/${c}/${acc}/${encodeURIComponent(f.doc)}`
    : `https://www.sec.gov/Archives/edgar/data/${c}/${acc}/${f.acc}-index.htm`;
}

/** The company's EDGAR filing index. */
export function companyFilingsUrl(cik: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(cik).padStart(10, "0")}&type=&dateb=&owner=include&count=40`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "December 31" from EDGAR's MMDD, or null. */
export function fiscalYearEndLabel(mmdd: string | null | undefined): string | null {
  const m = /^(\d{2})(\d{2})$/.exec(String(mmdd ?? ""));
  if (!m) return null;
  const mo = Number(m[1]), d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${MONTHS[mo - 1]} ${d}` : null;
}

/** "Software · Austin, TX" — the industry and HQ line, either part when known. */
export function industryHqLine(p: Pick<IpoProfile, "sicDescription" | "city" | "region"> | null | undefined): string | null {
  if (!p) return null;
  const titled = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
  const hq = [p.city ? titled(p.city) : null, p.region ? (p.region.length <= 3 ? p.region.toUpperCase() : titled(p.region)) : null].filter(Boolean).join(", ");
  const parts = [p.sicDescription ? titled(p.sicDescription) : null, hq || null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** "$125.0 million" / "$1.20 billion". */
export function formatDealUsd(v: number | null | undefined): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)} billion`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)} million`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

export const SPAC_NOTE =
  "This is a SPAC (blank-check company). It has no business of its own yet. It raises cash to buy a private company later, usually within 18–24 months. Its units (the \"U\" ticker) typically split later into shares and warrants.";
