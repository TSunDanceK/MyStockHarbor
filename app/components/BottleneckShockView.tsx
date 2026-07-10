"use client";

import Link from "next/link";
import { useState } from "react";
import BottleneckPieChart, { NEON_PALETTE } from "./BottleneckPieChart";
import type { BottleneckCompany, BottleneckPost } from "@/lib/bottlenecks";

type Panel = "supply" | "customers";

function severityForPct(pct: number): { label: string; color: string } {
  if (pct >= 15) return { label: "Critical", color: "#FF9E8A" };
  if (pct >= 8) return { label: "High", color: "#FFD27F" };
  return { label: "Moderate", color: "#8FE3D8" };
}

function CompanyRow({
  company,
  color,
}: {
  company: BottleneckCompany;
  color: string;
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

        {/* Percentage and severity badge sit together, always - no separate
            "shock mode" needed, this is just a second lens on the same
            reliance figure. */}
        <span
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#8a97ad",
              whiteSpace: "nowrap",
            }}
          >
            ~{company.pct}%
          </span>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: severity.color,
              background: `${severity.color}1a`,
              border: `1px solid ${severity.color}66`,
              borderRadius: 999,
              padding: "2px 8px",
              whiteSpace: "nowrap",
            }}
          >
            {severity.label}
          </span>
        </span>
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
  className,
}: {
  heading: string;
  description: string;
  companies: BottleneckCompany[];
  className?: string;
}) {
  const segments = companies.map((company, index) => ({
    name: company.name,
    ticker: company.ticker,
    pct: company.pct,
    color: NEON_PALETTE[index % NEON_PALETTE.length],
  }));

  return (
    <section
      className={`bottleneckChartBlock${className ? ` ${className}` : ""}`}
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
          />
        ))}
      </div>
    </section>
  );
}

export default function BottleneckShockView({ post }: { post: BottleneckPost }) {
  // Mobile-only: which single chart panel is showing. Desktop always shows
  // both side by side and ignores this - the toggle itself is hidden above
  // 860px via CSS (see .bottleneckMobileToggle in page.tsx's <style> block),
  // and the CSS media query that hides the non-selected panel
  // (.bottleneckMobileHidden) only takes effect below that same breakpoint.
  const [mobilePanel, setMobilePanel] = useState<Panel>("supply");

  const supplyChainDescription =
    post.supplyChainNote ||
    `Companies ${post.symbol} relies on to design, manufacture, package, and assemble its hardware.`;

  const customersDescription =
    post.customersNote ||
    `Companies that make up an outsized share of ${post.symbol}'s revenue - who ${post.symbol} relies on to buy from it.`;

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
          {post.companyName} ({post.symbol}): Who It Depends On
        </h1>

        <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
          {post.summary}
        </p>
      </section>

      <div
        className="bottleneckMobileToggle"
        role="group"
        aria-label="Chart panel"
        style={{
          display: "none",
          gap: 4,
          padding: 4,
          marginTop: 20,
          width: "fit-content",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 999,
        }}
      >
        <button
          type="button"
          onClick={() => setMobilePanel("supply")}
          style={{
            cursor: "pointer",
            border: "none",
            borderRadius: 999,
            padding: "7px 16px",
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: 0.2,
            background:
              mobilePanel === "supply" ? "rgba(147, 197, 253, 0.16)" : "transparent",
            color: mobilePanel === "supply" ? "#93c5fd" : "#8a97ad",
            boxShadow:
              mobilePanel === "supply" ? "0 0 12px rgba(147, 197, 253, 0.3)" : "none",
            transition: "all 0.18s ease",
          }}
        >
          Supply chain
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel("customers")}
          style={{
            cursor: "pointer",
            border: "none",
            borderRadius: 999,
            padding: "7px 16px",
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: 0.2,
            background:
              mobilePanel === "customers" ? "rgba(95, 212, 199, 0.16)" : "transparent",
            color: mobilePanel === "customers" ? "#5FD4C7" : "#8a97ad",
            boxShadow:
              mobilePanel === "customers" ? "0 0 12px rgba(95, 212, 199, 0.3)" : "none",
            transition: "all 0.18s ease",
          }}
        >
          Customers
        </button>
      </div>

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
          heading="Supply-chain dependency"
          description={supplyChainDescription}
          companies={post.supplyChain}
          className={mobilePanel === "customers" ? "bottleneckMobileHidden" : undefined}
        />

        <ChartBlock
          heading="Customer concentration"
          description={customersDescription}
          companies={post.customers}
          className={mobilePanel === "supply" ? "bottleneckMobileHidden" : undefined}
        />
      </div>
    </>
  );
}
