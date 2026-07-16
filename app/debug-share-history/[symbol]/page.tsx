// TEMPORARY diagnostic page — added to debug why the share-dilution history
// endpoint returns nothing on production. Not linked from anywhere. Placed
// as a page (not /api/) since /api/ is disallowed in robots.txt and this
// needs to be fetchable. Calls the same candidate FMP URLs fetchShareHistory()
// tries and prints status + a truncated body preview for each. API key is
// never included in the output. Delete this page once done debugging.
export const dynamic = "force-dynamic";

export default async function DebugShareHistoryPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return <pre>FMP_API_KEY not set</pre>;
  }
  const enc = encodeURIComponent(symbol);
  const key = encodeURIComponent(apiKey);
  const candidates = [
    { label: "stable/income-statement (annual)", url: `https://financialmodelingprep.com/stable/income-statement?symbol=${enc}&period=annual&limit=10&apikey=${key}` },
    { label: "stable/income-statement (quarter)", url: `https://financialmodelingprep.com/stable/income-statement?symbol=${enc}&period=quarter&limit=8&apikey=${key}` },
    { label: "stable/key-metrics (annual)", url: `https://financialmodelingprep.com/stable/key-metrics?symbol=${enc}&period=annual&limit=10&apikey=${key}` },
  ];

  const results: Array<{ label: string; status?: number; ok?: boolean; bodyPreview?: string; error?: string }> = [];
  for (const c of candidates) {
    try {
      const res = await fetch(c.url, { cache: "no-store" });
      const text = await res.text();
      results.push({
        label: c.label,
        status: res.status,
        ok: res.ok,
        bodyPreview: text.slice(0, 1500),
      });
    } catch (err) {
      results.push({ label: c.label, error: String(err) });
    }
  }

  return (
    <pre style={{ whiteSpace: "pre-wrap", padding: 20, fontSize: 12 }}>
      {JSON.stringify({ symbol, results }, null, 2)}
    </pre>
  );
}
