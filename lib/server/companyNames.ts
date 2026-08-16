// Lightweight symbol -> company name lookup for the screener/picker result
// cards. Sourced from the same public Nasdaq Trader symbol directory files
// that /api/symbols already parses, fetched once and cached (24h at the fetch
// layer, plus an in-process memo) so a picker page attaches names to up to ~36
// tickers with no per-symbol API calls. Best-effort by design: any symbol that
// doesn't resolve (thin ETFs, some foreign ADRs the directory omits) simply
// falls back to showing the ticker alone on the card.

const NASDAQ_LISTED = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt";
const OTHER_LISTED = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt";

const INSTRUMENT_SUFFIX_RE =
  /[\s,–-]+(class\s+[a-z]\s+)?(common stock|ordinary shares?|common shares?|american depositary shares?|american depositary receipts?|depositary shares?|depositary receipts?)\s*$/i;

// Collapses a name that repeats itself.
//
// The Nasdaq Trader directory sometimes concatenates the issuer name with the
// ADR/security description, which restates the same company. PAC is the worst
// case on the site:
//
//   "Grupo Aeroportuario Del Pacifico, S.A. B. de C.V. Grupo Aeroportuario Del
//    Pacifico, S.A. de C.V. (each representing 10 Series B shares)"
//
// 133 characters for a company whose name is four words long. Detect the repeat
// by looking for the opening few words appearing a second time, and cut there.
function collapseRepeat(name: string) {
  const words = name.split(/\s+/);
  if (words.length < 6) return name;
  // Three words is enough to be distinctive without over-matching a name that
  // legitimately starts and ends with the same single word.
  const head = words.slice(0, 3).join(" ");
  const rest = name.slice(head.length);
  const repeatAt = rest.toLowerCase().indexOf(head.toLowerCase());
  if (repeatAt < 0) return name;
  return name.slice(0, head.length + repeatAt);
}

// Trims the boilerplate share-class / instrument suffix the directory appends
// ("- Common Stock", "Class A Common Stock", "Ordinary Shares", etc.) so the
// card shows "Apple Inc." rather than "Apple Inc. - Common Stock", then drops
// the trailing instrument parenthetical and any restatement of the name itself.
function cleanName(raw: string) {
  let name = String(raw || "").trim();
  name = name.replace(INSTRUMENT_SUFFIX_RE, "");
  // Trailing parentheticals on this feed are always instrument descriptions
  // ("(each representing 10 Series B shares)", "(Cayman Islands)"), never part
  // of the company's name. Loop so a name ending in two of them loses both.
  for (let i = 0; i < 3; i += 1) {
    const next = name.replace(/\s*\([^()]*\)\s*$/, "").trim();
    if (next === name) break;
    name = next;
  }
  name = collapseRepeat(name);
  // The suffix may now be exposed at the end (it sat before the parenthetical).
  name = name.replace(INSTRUMENT_SUFFIX_RE, "");
  name = name.replace(/\s{2,}/g, " ").trim();
  // Tidy a cut that landed on a separator, but keep a trailing "." so
  // "S.A. de C.V." and "Inc." survive intact.
  name = name.replace(/[\s,;:–-]+$/, "").trim();
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
