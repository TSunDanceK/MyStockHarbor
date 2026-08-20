"use client";

import { useState } from "react";
import Link from "next/link";
import { NEON_PALETTE } from "@/app/components/BottleneckPieChart";
import type { BottleneckCompanyCount } from "@/lib/bottlenecks";

const ROW_GAP = 10;
// How many rows to render before a "See more" button. This used to be a
// scroll window instead: every company rendered, with maxHeight + overflowY
// clipping it to ten rows. Two problems with that on a phone.
//
// 1. A scrolling box inside a scrolling page is a coin toss under a thumb --
//    you cannot tell which one a drag is going to move, and once the inner
//    one hits its end the gesture does nothing at all.
// 2. `overflowY: auto` makes the OTHER axis compute to `auto` as well, so the
//    box was horizontally scrollable too, and it had something to scroll --
//    see the grid-track note below.
//
// Capping what is rendered instead removes both, and matches what
// BottleneckList already does directly above it.
const PAGE_SIZE = 10;

export default function BottleneckLeaderboard({
  counts,
}: {
  counts: BottleneckCompanyCount[];
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const visible = counts.slice(0, visibleCount);
  const remaining = counts.length - visible.length;
  const maxCount = counts.length > 0 ? counts[0].count : 0;

  return (
    <section
      style={{
        background: "#0b1220",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        padding: 20,
        boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
      }}
    >
      <h2
        style={{
          marginTop: 0,
          marginBottom: 4,
          fontSize: 18,
          fontWeight: 850,
        }}
      >
        Bottleneck Leaderboard
      </h2>
      <p
        style={{
          marginTop: 0,
          marginBottom: 16,
          fontSize: 12.5,
          opacity: 0.6,
          lineHeight: 1.5,
        }}
      >
        How many times each company has shown up as a bottleneck - supplier
        or customer - across every stock page built so far.
      </p>

      {counts.length === 0 ? (
        <div style={{ fontSize: 13, opacity: 0.6 }}>No data yet.</div>
      ) : (
        <div
          style={{
            display: "grid",
            // minmax(0, 1fr), not the implicit `auto`. An auto track is
            // allowed to grow to its max-content width, and the company name
            // is `white-space: nowrap` -- so "Taiwan Semiconductor
            // Manufacturing Company (TSM)" sized the column and the whole
            // block ran off the side of a phone. The ellipsis never got a
            // chance to fire, because there was no narrower width for it to
            // fire at. The 0 minimum also overrides each row's default
            // `min-width: auto`, which would otherwise refuse to shrink below
            // its own content for the same reason.
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: ROW_GAP,
          }}
        >
          {visible.map((company, index) => {
            const color = NEON_PALETTE[index % NEON_PALETTE.length];
            const barPct =
              maxCount > 0
                ? Math.max(6, Math.round((company.count / maxCount) * 100))
                : 0;

            const row = (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#f1f5f9",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        opacity: 0.4,
                        marginRight: 6,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {index + 1}.
                    </span>
                    {company.name}
                    {company.ticker ? (
                      <span style={{ color: "#5FD4C7" }}>
                        {" "}
                        ({company.ticker})
                      </span>
                    ) : null}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color,
                      flexShrink: 0,
                    }}
                  >
                    ×{company.count}
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 6,
                    height: 6,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.08)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${barPct}%`,
                      height: "100%",
                      borderRadius: 999,
                      background: color,
                      boxShadow: `0 0 6px ${color}`,
                    }}
                  />
                </div>
              </div>
            );

            return company.ticker ? (
              <Link
                key={company.name}
                href={`/stock/${encodeURIComponent(company.ticker)}`}
                prefetch={false}
                style={{
                  display: "block",
                  minWidth: 0,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                {row}
              </Link>
            ) : (
              <div key={company.name} style={{ minWidth: 0 }}>
                {row}
              </div>
            );
          })}
        </div>
      )}

      {remaining > 0 ? (
        <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            style={{
              cursor: "pointer",
              borderRadius: 999,
              border: "1px solid rgba(95,212,199,0.35)",
              background: "rgba(95,212,199,0.12)",
              color: "#a7f3ec",
              padding: "9px 18px",
              fontSize: 12.5,
              fontWeight: 800,
              letterSpacing: 0.2,
              fontFamily: "inherit",
              transition: "all 0.18s ease",
            }}
          >
            See more ({remaining} more)
          </button>
        </div>
      ) : null}

      <div
        style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            opacity: 0.55,
            fontWeight: 800,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          Why it matters
        </div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, opacity: 0.75 }}>
          A company that keeps showing up here isn&apos;t just important to
          one stock - it&apos;s a shared dependency across many of them. If a
          name high on this list runs into trouble - an outage, a shortage,
          a regulatory action, a bad quarter - the disruption can ripple
          across every business that relies on it, not just the one you
          started on. The higher the count, the more concentrated - and
          systemic - that risk becomes.
        </p>
      </div>
    </section>
  );
}
