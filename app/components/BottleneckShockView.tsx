"use client";

import Link from "next/link";
import { useState } from "react";
import BottleneckPieChart, { NEON_PALETTE } from "./BottleneckPieChart";
import type { BottleneckCompany, BottleneckPost } from "@/lib/bottlenecks";

type View = "dependency" | "shock";

function severityForPct(pct: number): { label: string; color: string } {
  if (pct >= 15) return { label: "Critical", color: "#FF9E8A" };
  if (pct >= 8) return { label: "High", color: "#FFD27F" };
  return { label: "Moderate", color: "#8FE3D8" };
}

function CompanyRow({
  company,
  color,
  view,
}: {
  company: BottleneckCompany;
  color: string;
  view: View;
}) {
  const severity = severityForPct(company.pct);

  return (
    <div
      style={{
        padding: "14px 0",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            flex: 1,
            minWidth: 0,
            fontSize: 16,
            fontWeight: 800,
            color: "#f1f5f9",
          }}
        >
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 999,
              background: color,
              boxShadow: `0 0 6px ${color}`,
            }}
          />
          <span
            title={company.name}
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {company.name}
          </span>
          {company.ticker ? (
            <span style={{ flexShrink: 0, color: "#5FD4C7" }}>
              ({company.ticker})
            </span>
          ) : null}
        </span>

        {view === "shock" ? (
          <span
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: severity.color,
              background: `${severity.color}1a`,
              border: `1px solid ${severity.color}66`,
              borderRadius: 999,
              padding: "3px 10px",
              whiteSpace: "nowrap",
            }}
          >
            {severity.label}
          </span>
        ) : (
          <span
            style={{
              flexShrink: 0,
              fontSize: 14,
              fontWeight: 700,
              color: "#8a97ad",
            }}
          >
            ~{company.pct}%
          </span>
        )}
      </div>

      <p
        style={{
          margin: 0,
          marginTop: 6,
          fontSize: 14,
          lineHeight: 1.6,
          opacity: 0.88,
        }}
      >
        {company.blurb}
      </p>

      {view === "shock" ? (
        <p
          style={{
            margin: 0,
            marginTop: 4,
            fontSize: 12.5,
            lineHeight: 1.5,
            opacity: 0.6,
            fontStyle: "italic",
          }}
        >
          ~{company.pct}% exposure estimate.
        </p>
      ) : null}

      {company.ticker ? (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <Link
            href={`/stock/${encodeURIComponent(company.ticker)}`}
            className="bnActionBtn bnActionBtn--blue"
          >
            Stock analysis →
          </Link>
          <Link
            href={`/stock/${encodeURIComponent(company.ticker)}/earnings`}
            className="bnActionBtn bnActionBtn--teal"
          >
            Earnings →
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function ChartBlock({
  heading,
  description,
  companies,
  view,
}: {
  heading: string;
  description: string;
  companies: BottleneckCompany[];
  view: View;
}) {
  const segments = companies.map((company, index) => ({
    name: company.name,
    ticker: company.ticker,
    pct: company.pct,
    color: NEON_PALETTE[index % NEON_PALETTE.length],
  }));

  return (
    <section
      className="bottleneckChartBlock"
      style={{
        background: "#0b1220",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        padding: 22,
        boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
        height: "100%",
        minWidth: 0,
      }}
    >
      <h2
        style={{ marginTop: 0, marginBottom: 8, fontSize: 21, fontWeight: 850 }}
      >
        {heading}
      </h2>
      <p style={{ fontSize: 14, lineHeight: 1.55, opacity: 0.85, marginBottom: 18 }}>
        {description}
      </p>

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
        <BottleneckPieChart segments={segments} />
      </div>

      <div>
        {companies.map((company, index) => (
          <CompanyRow
            key={`${company.ticker ?? company.name}-${index}`}
            company={company}
            color={NEON_PALETTE[index % NEON_PALETTE.length]}
            view={view}
          />
        ))}
      </div>
    </section>
  );
}

export default function BottleneckShockView({ post }: { post: BottleneckPost }) {
  const [view, setView] = useState<View>("dependency");

  const isShock = view === "shock";

  const title = isShock
    ? `${post.companyName} (${post.symbol}): Who Gets Hit If Something Breaks`
    : `${post.companyName} (${post.symbol}): Who It Depends On`;

  const intro = isShock
    ? `If ${post.symbol} were hit by a real supply shock — a key supplier failing, a component shortage, an outage, anything that stops it delivering normally — here's who absorbs it. The left chart shows how exposed ${post.symbol} itself is if one of its own suppliers falters; the right chart shows which of ${post.symbol}'s customers would feel it hardest if ${post.symbol} couldn't deliver.`
    : post.summary;

  const supplyChainDescription = isShock
    ? `Ranked by how much of ${post.symbol}'s own supply chain runs through each partner — this is the vulnerability ${post.symbol} carries if any one of these falters.`
    : post.supplyChainNote ||
      `Companies ${post.symbol} relies on to design, manufacture, package, and assemble its hardware.`;

  const customersDescription = isShock
    ? `If ${post.symbol} faced a shortage or outage, these are the customers most exposed — ranked by how much of their own business leans on ${post.symbol}.`
    : post.customersNote ||
      `Companies that make up an outsized share of ${post.symbol}'s revenue - who ${post.symbol} relies on to buy from it.`;

  const supplyChainHeading = isShock
    ? `If a supplier breaks, this is ${post.symbol}'s exposure`
    : "Supply-chain dependency";

  const customersHeading = isShock
    ? `Who gets hit if ${post.symbol} can't deliver`
    : "Customer concentration";

  return (
    <>
      <section
        className="bottleneckIntroCard"
        style={{
          background: "#0b1220",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
        }}
      >
        <div
          role="group"
          aria-label="Page view"
          style={{
            display: "inline-flex",
            gap: 4,
            padding: 4,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 999,
            marginBottom: 18,
          }}
        >
          <button
            type="button"
            onClick={() => setView("dependency")}
            style={{
              cursor: "pointer",
              border: "none",
              borderRadius: 999,
              padding: "7px 16px",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.2,
              background: !isShock ? "rgba(147, 197, 253, 0.16)" : "transparent",
              color: !isShock ? "#93c5fd" : "#8a97ad",
              boxShadow: !isShock ? "0 0 12px rgba(147, 197, 253, 0.3)" : "none",
              transition: "all 0.18s ease",
            }}
          >
            Dependency view
          </button>
          <button
            type="button"
            onClick={() => setView("shock")}
            style={{
              cursor: "pointer",
              border: "none",
              borderRadius: 999,
              padding: "7px 16px",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.2,
              background: isShock ? "rgba(255, 158, 138, 0.16)" : "transparent",
              color: isShock ? "#FF9E8A" : "#8a97ad",
              boxShadow: isShock ? "0 0 12px rgba(255, 158, 138, 0.3)" : "none",
              transition: "all 0.18s ease",
            }}
          >
            ⚡ Shock view
          </button>
        </div>

        <h1
          className="bottleneckTickerTitle"
          style={{
            marginTop: 0,
            marginBottom: 16,
            fontSize: 34,
            lineHeight: 1.1,
            fontWeight: 900,
          }}
        >
          {title}
        </h1>

        <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>{intro}</p>
      </section>

      <div
        className="bottleneckColumns"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
          marginTop: 24,
          alignItems: "start",
        }}
      >
        <ChartBlock
          heading={supplyChainHeading}
          description={supplyChainDescription}
          companies={post.supplyChain}
          view={view}
        />

        <ChartBlock
          heading={customersHeading}
          description={customersDescription}
          companies={post.customers}
          view={view}
        />
      </div>
    </>
  );
}
