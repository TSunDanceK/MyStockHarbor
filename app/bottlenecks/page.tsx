import Link from "next/link";
import type { Metadata } from "next";
import { getAllBottleneckPosts } from "@/lib/bottlenecks";
import BottleneckList from "@/app/components/BottleneckList";

export const metadata: Metadata = {
  title: "Stock Bottlenecks | Supply Chain & Customer Dependency | MyStockHarbor",
  description:
    "See which companies a stock relies on most - key suppliers and customer concentration - broken down into simple pie charts, one stock built per day.",
  alternates: {
    canonical: "https://www.mystockharbor.com/bottlenecks",
  },
};

export const dynamic = "force-dynamic";

export default function BottlenecksIndexPage() {
  const posts = [...getAllBottleneckPosts()].sort((a, b) =>
    a.companyName.localeCompare(b.companyName)
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <Link
            href="/"
            style={{
              color: "#93c5fd",
              textDecoration: "none",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            ← Back to Dashboard
          </Link>
        </div>

        <section
          style={{
            background: "#0b1220",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
          }}
        >
          <h1
            style={{
              marginTop: 0,
              marginBottom: 16,
              fontSize: 34,
              lineHeight: 1.1,
              fontWeight: 900,
            }}
          >
            Stock Bottlenecks
          </h1>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            Every public company depends on other companies to function -
            suppliers it can&apos;t easily replace, and customers that make up
            an outsized share of its revenue. This section breaks that down
            for one stock at a time, with two pie charts per stock:{" "}
            <strong>supply-chain dependency</strong> and{" "}
            <strong>customer concentration</strong>.
          </p>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            New stock pages are added roughly one per day.
          </p>
        </section>

        <section style={{ marginTop: 24 }}>
          <BottleneckList posts={posts} />
        </section>
      </div>
    </main>
  );
}
