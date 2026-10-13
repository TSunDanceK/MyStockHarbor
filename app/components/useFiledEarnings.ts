"use client";

// The client side of the earnings-link rule (#552 COWORK #197). One fetch of
// the filed list per page load, shared by every component that asks; until it
// arrives -- or if it fails -- hasFiledEarnings is false and no earnings link
// renders ("only when", never a disabled link).
import { useCallback, useEffect, useState } from "react";
import { hasFiledEarningsIn } from "@/lib/filedEarningsLinks";

let shared: Promise<ReadonlySet<string> | null> | null = null;
let known: ReadonlySet<string> | null = null;

function loadFiled(): Promise<ReadonlySet<string> | null> {
  if (!shared) {
    shared = fetch("/api/sec/filed-earnings")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { symbols?: unknown } | null) => {
        known = Array.isArray(j?.symbols) ? new Set(j.symbols.map(String)) : null;
        if (!known) shared = null; // a failed read is retried on the next mount
        return known;
      })
      .catch(() => {
        shared = null;
        return null;
      });
  }
  return shared;
}

export function useFiledEarnings(): { hasFiledEarnings: (symbol: string | null | undefined) => boolean } {
  const [filed, setFiled] = useState<ReadonlySet<string> | null>(known);
  useEffect(() => {
    if (known) return;
    let live = true;
    loadFiled().then((s) => { if (live && s) setFiled(s); });
    return () => { live = false; };
  }, []);
  // Stable until the list arrives, so it can sit in a useMemo's dependencies.
  const hasFiledEarnings = useCallback((symbol: string | null | undefined) => hasFiledEarningsIn(filed, symbol), [filed]);
  return { hasFiledEarnings };
}
