// app/api/debug-fmp/route.ts
// One-off diagnostic: probes which FMP endpoints/fields the current API key
// actually returns, so we can decide what to build on the earnings page.
// Hit /api/debug-fmp?probe=fmp&symbol=TSLA . Safe to delete after use.
//
// Returns, per endpoint: ok, http status, row count, the KEYS of the first row,
// and a trimmed sample of the first row — enough to judge availability without
// dumping full statements.

export const dynamic = "force-dynamic";

const FMP_BASE = "https://financialmodelingprep.com/stable";

type Probe = {
  endpoint: string;
  ok: boolean;
  status: number | null;
  count: number | null;
  firstRowKeys: string[] | null;
  sample: unknown;
  error?: string;
};

function trimRow(row: unknown): unknown {
  if (!row || typeof row !== "object") return row;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (n >= 40) break;
    out[k] = typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}…` : v;
    n += 1;
  }
  return out;
}

async function probe(path: string): Promise<Probe> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return { endpoint: path, ok: false, status: null, count: null, firstRowKeys: null, sample: null, error: "FMP_API_KEY not set" };
  }
  const url = `${FMP_BASE}${path}${path.includes("?") ? "&" : "?"}apikey=${apiKey}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const arr = Array.isArray(body) ? body : body != null ? [body] : [];
    const first = arr[0] ?? null;
    return {
      endpoint: path,
      ok: res.ok && arr.length > 0,
      status: res.status,
      count: arr.length,
      firstRowKeys: first && typeof first === "object" ? Object.keys(first as Record<string, unknown>) : null,
      sample: first != null ? trimRow(first) : (body ?? null),
    };
  } catch (e) {
    return { endpoint: path, ok: false, status: null, count: null, firstRowKeys: null, sample: null, error: String(e) };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("probe") !== "fmp") {
    return new Response(JSON.stringify({ error: "add ?probe=fmp to run" }), {
      status: 400,
      headers: { "content-type": "application/json", "x-robots-tag": "noindex" },
    });
  }
  const symbol = (searchParams.get("symbol") || "TSLA").toUpperCase().replace(/[^A-Z0-9.-]/g, "");

  const paths = [
    `/analyst-estimates?symbol=${symbol}&period=quarter&limit=12`,
    `/analyst-estimates?symbol=${symbol}&period=annual&limit=6`,
    `/income-statement?symbol=${symbol}&period=quarter&limit=2`,
    `/cash-flow-statement?symbol=${symbol}&period=quarter&limit=2`,
    `/balance-sheet-statement?symbol=${symbol}&period=quarter&limit=1`,
    `/revenue-product-segmentation?symbol=${symbol}&period=annual&structure=flat`,
    `/revenue-geographic-segmentation?symbol=${symbol}&period=annual&structure=flat`,
  ];

  const results = await Promise.all(paths.map((p) => probe(p)));

  return new Response(JSON.stringify({ symbol, generatedAtUtc: new Date().toISOString(), results }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json", "x-robots-tag": "noindex" },
  });
}
