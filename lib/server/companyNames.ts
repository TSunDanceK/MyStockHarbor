// Lightweight symbol -> company name lookup for the screener/picker result
// cards. Sourced from the same public Nasdaq Trader symbol directory files
// that /api/symbols already parses, fetched once and cached (24h at the fetch
// layer, plus an in-process memo) so a picker page attaches names to up to ~36
// tickers with no per-symbol API calls. Best-effort by design: any symbol that
// doesn't resolve (thin ETFs, some foreign ADRs the directory omits) simply
// falls back to showing the ticker alone on the card.

const NASDAQ_LISTED = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt";
const OTHER_LISTED = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt";

// Trims the boilerplate share-class / instrument suffix the directory appends
// ("- Common Stock", "Class A Common Stock", "Ordinary Shares", etc.) so the
// card shows "Apple Inc." rather than "Apple Inc. - Common Stock".
function cleanName(raw: string) {
  let name = String(raw || "").trim();
  name = name.replace(
    /[\s,\u2013-]+(class\s+[a-z]\s+)?(common stock|ordinary shares?|common shares?|american depositary shares?|depositary shares?)\s*$/i,
    ""
  );
  name = name.replace(/\s{2,}/g, " ").trim();
  return name;
}

function parseInto(text: string, map: Map<string, string>) {
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("Symbol|") || trimmed.startsWith("ACT Symbol|")) continue;
    if (trimmed.startsWith("File Creation Time")) continue;

    const cols = trimmed.split("|");
    if (cols.length < 2) continue;

    const symbol = (cols[0] || "").trim().replace(/\$/g, ".").toUpperCase();
    const name = cleanName(cols[1] || "");
    if (!symbol || !name) continue;
    // Normal equity-style symbols only.
    if (!/^[A-Z][A-Z.\-]*$/.test(symbol)) continue;
    if (!map.has(symbol)) map.set(symbol, name);
  }
}

async function fetchDirectory(url: string) {
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

let memo: Map<string, string> | null = null;

export async function getCompanyNameMap(): Promise<Map<string, string>> {
  if (memo && memo.size) return memo;

  const map = new Map<string, string>();
  try {
    const [nasdaqTxt, otherTxt] = await Promise.all([
      fetchDirectory(NASDAQ_LISTED),
      fetchDirectory(OTHER_LISTED),
    ]);
    if (nasdaqTxt) parseInto(nasdaqTxt, map);
    if (otherTxt) parseInto(otherTxt, map);
  } catch {
    // fail open — return whatever resolved
  }

  if (map.size) memo = map;
  return map;
}
