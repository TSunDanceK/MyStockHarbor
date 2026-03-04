"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type PickerItem = {
  symbol: string;
  note?: string;
  tone?: "green" | "yellow" | "orange" | "red";
};

type PickerSection = {
  title: string;
  description?: string;
  items: PickerItem[];
};

function toneDot(tone?: string) {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#eab308";
  if (tone === "orange") return "#fb923c";
  if (tone === "red") return "#ef4444";
  return "rgba(255,255,255,0.35)";
}

export default function PickersPage() {
  const [sections, setSections] = useState<PickerSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const res = await fetch("/api/pickers", { cache: "no-store" });
        if (!res.ok) throw new Error("Pickers API failed");

        const data = (await res.json()) as any;

        // ✅ hard safety: never allow undefined into render
        const safeSections: PickerSection[] = Array.isArray(data?.sections) ? data.sections : [];

        if (!cancelled) setSections(safeSections);
      } catch (e: any) {
        if (!cancelled) {
          setErr("Failed to load pickers.");
          setSections([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const safeSections = useMemo(() => (Array.isArray(sections) ? sections : []), [sections]);

  return (
    <main
      style={{
        padding: 40,
        fontFamily: "system-ui, Arial",
        background: "#06080d",
        color: "#f1f5f9",
        minHeight: "100vh",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32, letterSpacing: "-0.3px" }}>Find Your Next Stock</h1>
          <p style={{ marginTop: 10, opacity: 0.75 }}>
            Pick a style → click a stock → jump straight into the dashboard.
          </p>
        </div>

<Link
  href="/"
  style={{
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    textDecoration: "none",
    color: "#f1f5f9",
    fontWeight: 800,
    background: "rgba(255,255,255,0.06)",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  }}
>
  ← Back to Dashboard
</Link>
      </div>

      <div style={{ marginTop: 18, maxWidth: 980 }}>
        {loading ? <div style={{ opacity: 0.75 }}>Loading…</div> : null}
        {err ? <div style={{ opacity: 0.75 }}>{err}</div> : null}
      </div>

      <div style={{ marginTop: 20, display: "grid", gap: 16, maxWidth: 980 }}>
        {safeSections.map((sec) => {
          const items = Array.isArray(sec.items) ? sec.items : [];

          return (
            <section
              key={sec.title}
              style={{
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 14,
                padding: 16,
                background: "#0b1220",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 950 }}>{sec.title}</div>
                  {sec.description ? <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>{sec.description}</div> : null}
                </div>

                <div style={{ fontSize: 12, opacity: 0.7 }}>{items.length ? `${items.length} stocks` : "No matches yet"}</div>
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {items.map((it) => (
                  <a
                    key={it.symbol}
                    href={`/?symbol=${encodeURIComponent(it.symbol)}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 12px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: "rgba(255,255,255,0.06)",
                      color: "#f1f5f9",
                      textDecoration: "none",
                      fontWeight: 900,
                    }}
                    title={it.note ?? "Open in dashboard"}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        background: toneDot(it.tone),
                        boxShadow: "0 0 0 3px rgba(255,255,255,0.04)",
                        flex: "0 0 auto",
                      }}
                    />
                    {it.symbol}
                    {it.note ? <span style={{ fontSize: 12, opacity: 0.65, fontWeight: 700 }}>{it.note}</span> : null}
                  </a>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
