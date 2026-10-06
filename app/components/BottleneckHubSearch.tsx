"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// The hero's search on /bottlenecks (#125 COWORK): the same match the list's
// own search uses (company name or ticker, substring, case-insensitive), shown
// as a short list of links to the matching stock pages. The Latest / A-Z list
// further down keeps its own search unchanged; this one answers "what does
// this stock depend on?" from the top of the page.

type Item = { slug: string; symbol: string; companyName: string };

const MAX_RESULTS = 6;

export default function BottleneckHubSearch({ items }: { items: Item[] }) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((p) => p.companyName.toLowerCase().includes(q) || p.symbol.toLowerCase().includes(q))
      .sort((a, b) => Number(b.symbol.toLowerCase() === q) - Number(a.symbol.toLowerCase() === q) || a.symbol.localeCompare(b.symbol))
      .slice(0, MAX_RESULTS);
  }, [items, query]);

  return (
    <div className="bnHubSearch">
      <label htmlFor="bn-hub-search" style={{ display: "block", fontSize: "var(--fs-read)", fontWeight: 800, color: "#cbd5e1", marginBottom: 6 }}>
        Search a stock: what does it depend on?
      </label>
      <input
        id="bn-hub-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Company name or ticker"
        autoComplete="off"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "11px 14px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(255,255,255,0.04)",
          color: "#f1f5f9",
          // 1rem so mobile Safari does not zoom the page when it is focused.
          fontSize: "var(--fs-read)",
          outline: "none",
        }}
      />
      {query.trim() ? (
        results.length ? (
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
            {results.map((p) => (
              <li key={p.slug} style={{ minWidth: 0 }}>
                <Link
                  href={`/bottlenecks/${p.slug}`}
                  prefetch={false}
                  style={{
                    display: "block",
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#f1f5f9",
                    textDecoration: "none",
                    fontSize: "var(--fs-read)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  <span style={{ color: "#93c5fd", fontWeight: 800 }}>{p.symbol}</span> {p.companyName}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: "8px 0 0", fontSize: "var(--fs-read)", color: "rgba(241,245,249,0.7)" }}>
            &ldquo;{query.trim()}&rdquo; has not been mapped yet.
          </p>
        )
      ) : null}
    </div>
  );
}
