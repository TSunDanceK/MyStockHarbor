"use client";

import React, { useEffect, useMemo, useState } from "react";

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

export default function PickersClient() {
  const [sections, setSections] = useState<PickerSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [universeSize, setUniverseSize] = useState<number | null>(null);
  const [estimatedApiCalls, setEstimatedApiCalls] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const res = await fetch("/api/pickers", { cache: "no-store" });
        if (!res.ok) throw new Error("Pickers API failed");

        const data = (await res.json()) as {
          updatedAt?: string;
          universeSize?: number;
          estimatedApiCalls?: number;
          sections?: PickerSection[];
        };
        const safeSections = Array.isArray(data?.sections) ? data.sections : [];

        if (!cancelled) {
          setSections(safeSections);
          setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
          setUniverseSize(
            typeof data?.universeSize === "number" ? data.universeSize : null
          );
          setEstimatedApiCalls(
            typeof data?.estimatedApiCalls === "number"
              ? data.estimatedApiCalls
              : null
          );
        }
      } catch {
        if (!cancelled) {
          setErr("Failed to load stock ideas.");
          setSections([]);
          setUpdatedAt(null);
          setUniverseSize(null);
          setEstimatedApiCalls(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const safeSections = useMemo(() => {
    return Array.isArray(sections) ? sections : [];
  }, [sections]);

  return (
    <section aria-label="Live stock idea results">
      {loading ? (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 18,
            padding: 18,
            background: "#0b1220",
            maxWidth: 980,
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 950, letterSpacing: "-0.2px" }}>
            We are gathering stocks for you, please wait…
          </div>
          <div style={{ marginTop: 8, opacity: 0.75 }}>
            First load can take around 10–15 seconds. Cached loads are usually much faster.
          </div>

          <div
            style={{
              marginTop: 14,
              width: 420,
              maxWidth: "100%",
              height: 10,
              borderRadius: 999,
              overflow: "hidden",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.16)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: "35%",
                borderRadius: 999,
                background: "rgba(59,130,246,0.95)",
                animation: "pickersBar 1.1s linear infinite",
              }}
            />
          </div>

          <style>{`
            @keyframes pickersBar {
              0% { transform: translateX(-60%); opacity: 0.55; }
              50% { transform: translateX(140%); opacity: 0.95; }
              100% { transform: translateX(320%); opacity: 0.55; }
            }
          `}</style>
        </div>
      ) : null}

      {err ? (
        <div
          style={{
            border: "1px solid rgba(239,68,68,0.18)",
            borderRadius: 16,
            padding: 16,
            background: "rgba(239,68,68,0.08)",
            color: "#fecaca",
            maxWidth: 980,
          }}
        >
          {err}
        </div>
      ) : null}

      <div
        style={{
          marginTop: loading || err ? 20 : 0,
          display: "grid",
          gap: 16,
          maxWidth: 980,
        }}
      >
        {safeSections.map((sec) => {
          const items = Array.isArray(sec.items) ? sec.items : [];

          return (
            <section
              key={sec.title}
              style={{
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 16,
                padding: 16,
                background: "#0b1220",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "baseline",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: 22,
                      fontWeight: 950,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {sec.title}
                  </h2>
                  {sec.description ? (
                    <p
                      style={{
                        margin: "8px 0 0",
                        fontSize: 14,
                        opacity: 0.72,
                        lineHeight: 1.6,
                      }}
                    >
                      {sec.description}
                    </p>
                  ) : null}
                </div>

                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {items.length ? `${items.length} stocks` : "No matches yet"}
                </div>
              </div>

              <div
                style={{
                  marginTop: 14,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
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
                    <span>{it.symbol}</span>
                    {it.note ? (
                      <span
                        style={{
                          fontSize: 12,
                          opacity: 0.65,
                          fontWeight: 700,
                        }}
                      >
                        {it.note}
                      </span>
                    ) : null}
                  </a>
                ))}
              </div>
            </section>
          );
        })}

        {!loading && !err && (updatedAt || universeSize || estimatedApiCalls) ? (
          <div
            style={{
              marginTop: 4,
              paddingTop: 6,
              fontSize: 11,
              lineHeight: 1.6,
              opacity: 0.48,
              textAlign: "right",
            }}
          >
            {updatedAt ? (
              <div>
                Last picker refresh: {new Date(updatedAt).toLocaleString()}
              </div>
            ) : null}
            {universeSize != null ? (
              <div>Universe scanned: {universeSize} stocks</div>
            ) : null}
            {estimatedApiCalls != null ? (
              <div>Estimated calls used on refresh: {estimatedApiCalls}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
