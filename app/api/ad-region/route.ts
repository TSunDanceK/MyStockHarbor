import { NextResponse } from "next/server";
import { isConsentRegion } from "@/lib/consentRegions";

// Is this visitor in the UK or the EU/EEA? Read server-side from Vercel's
// x-vercel-ip-country header and answered as a bare boolean (the country
// itself is not returned). A route rather than a header read in the page or
// the layout: reading a request header there would turn every cached picker
// page into a per-request render. The cookie banner and the partner-ad rail
// (app/components/CookieConsent.tsx, AffiliateRail.tsx) ask once per page
// load. No store reads, no Redis commands.
export const runtime = "edge";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const inScope = isConsentRegion(request.headers.get("x-vercel-ip-country"));
  return NextResponse.json({ inScope }, { headers: { "Cache-Control": "private, no-store" } });
}
