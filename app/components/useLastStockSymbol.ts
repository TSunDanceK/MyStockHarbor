"use client";

// The last stock symbol the visitor looked at, live (#553 COWORK #238).
//
// Who writes it: every place a stock is picked ends in rememberSymbol
// (lib/symbol.ts): the dashboard / homepage analyser and its ?symbol= deep
// links (DashboardClient), and any /stock/SYM page (this hook, and
// StockPagesBottomNav). Search, picker rows, the ticker and the symbol pickers
// all navigate to one of those. rememberSymbol now also fires SYMBOL_CHANGED, and
// the `storage` event covers other tabs, so a reader here updates the moment a
// symbol is chosen, with no reload and no navigation.
//
// `pathname`: pass the current path to also make a /stock/SYM page the
// remembered symbol (the header does); pass null to only read (the mobile home).
import { useEffect, useRef, useState } from "react";

import { readStored } from "@/lib/browserStorage";
import { onRememberedSymbolChange, rememberSymbol, SYMBOL_STORAGE_KEY } from "@/lib/symbol";

export function cleanSymbol(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");

  return cleaned || "AAPL";
}

export function symbolFromPathname(pathname: string | null) {
  if (!pathname) return null;

  const match = pathname.match(/^\/stock\/([^/]+)/i);
  if (!match?.[1]) return null;

  try {
    return cleanSymbol(decodeURIComponent(match[1]));
  } catch {
    return cleanSymbol(match[1]);
  }
}

export function useLastStockSymbol(pathname: string | null) {
  const [lastSymbol, setLastSymbol] = useState("AAPL");
  // On a /stock/SYM page the URL is the truth; a change elsewhere must not override it.
  const pathSymbolRef = useRef<string | null>(null);

  useEffect(() => {
    const pathSymbol = symbolFromPathname(pathname);
    pathSymbolRef.current = pathSymbol;

    if (pathSymbol) {
      setLastSymbol(pathSymbol);
      rememberSymbol(pathSymbol);
      return;
    }

    setLastSymbol(cleanSymbol(readStored(SYMBOL_STORAGE_KEY)));
  }, [pathname]);

  useEffect(
    () =>
      onRememberedSymbolChange((symbol) => {
        if (pathSymbolRef.current) return;
        setLastSymbol(cleanSymbol(symbol));
      }),
    []
  );

  return lastSymbol;
}
