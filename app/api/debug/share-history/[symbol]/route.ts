import { NextResponse } from "next/server";

// TEMPORARY diagnostic route — added to debug why the share-dilution history
// endpoint returns nothing on production. Calls the same candidate FMP URLs
// fetchShareHistory() tries, and returns status + a truncated body preview
// for each so we can see the real response shape. API key is never included
// in the response. Delete this route once the real fetchShareHistory() field
// mapping is fixed.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FMP_API_KEY not set" }, { status: 500 });
  }
  const enc = encodeURIComponent(symbol);
  const key = encodeURIComponent(apiKey);
  const candidates = [
    { label: "stable/historical-shares-float", url: `https://financialmodelingprep.com/stable/historical-shares-float?symbol=${enc}&apikey=${key}` },
    { label: "api/v3/historical/shares_float", url: `https://financialmodelingprep.com/api/v3/historical/shares_float/${enc}?apikey=${key}` },
    { label: "stable/shares-float", url: `https://financialmodelingprep.com/stable/shares-float?symbol=${enc}&apikey=${key}` },
  ];

  const results = [];
  for (const c of candidates) {
    try {
      const res = await fetch(c.url, { cache: "no-store" });
      const text = await res.text();
      results.push({
        label: c.label,
        status: res.status,
        ok: res.ok,
        bodyPreview: text.slice(0, 1200),
      });
    } catch (err) {
      results.push({ label: c.label, error: String(err) });
    }
  }

  return NextResponse.json({ symbol, results });
}
