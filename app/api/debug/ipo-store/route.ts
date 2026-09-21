import { NextResponse } from "next/server";

import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { readStoredIpoFilings, readStoredIpoFilingsMeta } from "@/lib/server/ipoSecStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Debug-only route (same shape as the other app/api/debug/* routes) for
// msh:ipo:filings:v1 -- the one key /upcoming-ipos renders from.
//
// ── WHY IT EXISTS ─────────────────────────────────────────────────────────
// The day IPO_PROVIDER flipped to "sec", Deal Size was a dash on 12 of 13
// Recent rows and Price Range was a dash on most of them too. FOUR different
// faults produce that identical page, and three of them are invisible from the
// outside:
//
//   terms === null                the cover was never fetched or never read.
//                                 Nothing parsed, so no parser change can fix
//                                 it -- the walk has to be repeated.
//   terms, all fields null        the parser DID read the cover and declined.
//                                 The stored value is a real answer and the
//                                 question moves to which parser wrote it.
//   terms populated, page blank   the store is fine and the READ or the render
//                                 is dropping it. A different bug entirely.
//   store empty / unreadable      the page renders its degraded state.
//
// Guessing between them is how the wrong fix ships, and the document already
// records which. A stale store is also SILENT BY DESIGN: the page keeps
// rendering an ageing window rather than failing, so nothing surfaces it.
//
// COSTS ONE REDIS GET, and no more than a page view does. readStoredIpoFilings
// is the SAME function /upcoming-ipos calls -- deliberately, so this cannot
// report health the page does not see. A second reader would be free to
// disagree with the page in exactly the details nobody checks.
//
//   /api/debug/ipo-store?key=...            the whole-store summary
//   /api/debug/ipo-store?key=...&symbols=ETRA,HYAC   plus those rows in full

/** A final prospectus is what puts a filer in the Recent (lower) table. */
const FINAL_PROSPECTUS = /^424B[14]$/;
/** An amendment carrying terms is what puts one in the Upcoming (upper) table. */
const TERMS_AMENDMENT = /^(S-1\/A|F-1\/A)$/;

export async function GET(request: Request) {
  const denied = await guardDebugRequest(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const wanted = (searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const [meta, records] = await Promise.all([
    readStoredIpoFilingsMeta(),
    readStoredIpoFilings(),
  ]);

  if (!records) {
    // NOT AN EMPTY STORE -- an unreadable one. The page's degraded state and a
    // genuinely empty window look the same to a reader and are not the same
    // fault, so they are named differently here.
    return NextResponse.json(
      {
        ok: false,
        problem: "readStoredIpoFilings() returned null",
        meaning:
          "no Upstash credentials, the key is missing, or the stored value is not " +
          "the expected shape. /upcoming-ipos would render its degraded state.",
        meta,
      },
      { status: 200 }
    );
  }

  const neverParsed = records.filter((r) => r.terms === null);
  const parsed = records.filter((r) => r.terms !== null);
  const withPrice = parsed.filter((r) => r.terms!.priceRangeLow !== null);
  const withShares = parsed.filter((r) => r.terms!.sharesOffered !== null);
  const declinedBoth = parsed.filter(
    (r) => r.terms!.priceRangeLow === null && r.terms!.sharesOffered === null
  );

  // The two table populations, measured separately: a fault that only touches
  // the filers carrying a 424B would be averaged away in a whole-store number,
  // and the Recent table is where the dashes were seen.
  const cohort = (re: RegExp) => {
    const rows = records.filter((r) => r.filings.some((f) => re.test(f.form)));
    return {
      filers: rows.length,
      termsNull: rows.filter((r) => r.terms === null).length,
      priceParsed: rows.filter((r) => r.terms?.priceRangeLow != null).length,
      sharesParsed: rows.filter((r) => r.terms?.sharesOffered != null).length,
    };
  };

  const spotlight = wanted.length
    ? records
        .filter((r) => {
          const sym = (r.terms?.proposedSymbol ?? "").toUpperCase();
          const co = (r.company ?? "").toUpperCase();
          // Matched on symbol AND company: the page may render a unit suffix
          // (HYACU) that the cover's stated symbol (HYAC) does not carry, and a
          // record whose cover never parsed has no symbol at all.
          return wanted.some((w) => sym === w || sym.startsWith(w) || co.includes(w));
        })
        .map((r) => ({
          cik: r.cik,
          company: r.company,
          sic: r.sic,
          termsIsNull: r.terms === null,
          terms: r.terms,
          filings: r.filings.map((f) => `${f.form}@${f.date}`),
        }))
    : [];

  return NextResponse.json({
    ok: true,
    key: "msh:ipo:filings:v1",
    meta: meta && {
      ...meta,
      fetchedAtIso: new Date(meta.fetchedAt).toISOString(),
      ageHours: Math.round(((Date.now() - meta.fetchedAt) / 3_600_000) * 10) / 10,
    },
    terms: {
      records: records.length,
      neverParsed: neverParsed.length,
      parsed: parsed.length,
      withPrice: withPrice.length,
      withShares: withShares.length,
      declinedBoth: declinedBoth.length,
      reading:
        "neverParsed high -> the covers were never read; re-walk. " +
        "declinedBoth high -> the parser read them and refused; the rule is the bug.",
    },
    upperCohort: cohort(TERMS_AMENDMENT),
    lowerCohort: cohort(FINAL_PROSPECTUS),
    spotlight,
    spotlightNote: wanted.length
      ? undefined
      : "pass ?symbols=ETRA,HYAC,TLAC to see individual records in full",
  });
}
