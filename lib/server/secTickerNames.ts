// A COMPANY NAME AND LISTING VENUE FOR A TICKER, FROM SEC'S OWN FILE — for the
// /earnings-calendar grid, which used FMP's /stable/stock-list for names
// (#535 COWORK #18 §3).
//
// Read from the committed company_tickers_exchange file (data/sec/
// company-tickers.json), columns by NAME, once per process. Kept apart from
// secTickerMap's TickerEntry on purpose: that map is refreshed and stored, and
// carrying ~10,000 names through it would grow every stored copy for a field
// only this page reads.
//
// The committed exchange-directory snapshot's name is preferred where it has
// one (it is the same name the stock page shows); SEC's conformed name
// ("NVIDIA CORP") is the fallback, never an invented one.
import fs from "node:fs";
import path from "node:path";
import { snapshotCompanyName } from "./companyNameSnapshot";
import { cleanListingName } from "./listingName";
import { lookupBySpelling } from "../symbolSpellings.mjs";

type Row = { name: string; exchange: string | null };
let cached: Map<string, Row> | null = null;

function load(): Map<string, Row> {
  if (cached) return cached;
  const map = new Map<string, Row>();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/sec/company-tickers.json"), "utf8")) as {
      fields?: string[]; data?: unknown[][];
    };
    const idx = (n: string) => (raw.fields ?? []).findIndex((f) => String(f).toLowerCase() === n);
    const iName = idx("name"), iTicker = idx("ticker"), iExchange = idx("exchange");
    if (iName !== -1 && iTicker !== -1) {
      for (const row of raw.data ?? []) {
        if (!Array.isArray(row)) continue;
        const t = String(row[iTicker] ?? "").trim().toUpperCase();
        if (!t || map.has(t)) continue;
        const ex = iExchange === -1 ? null : String(row[iExchange] ?? "").trim() || null;
        map.set(t, { name: String(row[iName] ?? "").trim(), exchange: ex });
      }
    }
  } catch {
    // An unreadable file leaves every name blank; the grid then skips the row
    // rather than showing one without a name.
  }
  cached = map;
  return map;
}

/** SEC's listing venue for the ticker (Nasdaq, NYSE, OTC, …), or null. */
export function secExchangeFor(symbol: string): string | null {
  return lookupBySpelling(load(), symbol)?.value?.exchange ?? null;
}

/** The name the grid shows: the directory snapshot's, else SEC's; "" when neither. */
export function gridCompanyName(symbol: string): string {
  // THE COMPANY, NOT THE SECURITY (#552 COWORK #23): "Cintas Corporation -
  // Common Stock" reads as "Cintas Corporation".
  return cleanListingName(snapshotCompanyName(symbol) || lookupBySpelling(load(), symbol)?.value?.name || "");
}

/** The grid's admission test: a Nasdaq or NYSE listing, per SEC's own file. */
export const GRID_EXCHANGES = new Set(["Nasdaq", "NYSE"]);
export const gridAdmits = (symbol: string): boolean => GRID_EXCHANGES.has(secExchangeFor(symbol) ?? "");
