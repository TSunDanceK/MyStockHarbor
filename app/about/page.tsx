import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About MyStockHarbor | Trading Dashboard & Market Education",
  description:
    "Learn about MyStockHarbor, an educational trading dashboard built to help traders explore market context, technical indicators, and risk management tools.",
};

export default function AboutPage() {
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
            About MyStockHarbor
          </h1>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            MyStockHarbor is an educational trading dashboard designed to help
            beginner and intermediate traders better understand market context,
            technical indicators, and risk management.
          </p>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            The platform was created to simplify technical analysis and make
            trading tools easier to explore through a clean dashboard, visual
            signals, educational content, and practical utilities.
          </p>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            MyStockHarbor combines chart-based analysis with learning resources
            so traders can build confidence in reading price action, trend
            strength, momentum, and market structure.
          </p>

          <h2 style={{ marginTop: 28, fontSize: 24, fontWeight: 850 }}>
            What the platform includes
          </h2>

          <ul style={{ lineHeight: 1.9, paddingLeft: 22, opacity: 0.92 }}>
            <li>Free stock dashboard with technical indicator overlays</li>
            <li>Trend and stretch scoring to simplify market context</li>
            <li>Stock pickers to help surface potential opportunities</li>
            <li>Trading utilities for position sizing and liquidation risk</li>
            <li>Educational lessons covering core trading concepts</li>
            <li>Market benchmarks and news to support broader analysis</li>
          </ul>

          <h2 style={{ marginTop: 28, fontSize: 24, fontWeight: 850 }}>
            Important notice
          </h2>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            MyStockHarbor is provided for educational and informational purposes
            only. The content on this website does not constitute financial
            advice, investment advice, or a recommendation to buy or sell any
            security.
          </p>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            Trading and investing involve risk. Always do your own research and
            consult a qualified professional where appropriate before making
            financial decisions.
          </p>

          <h2 style={{ marginTop: 28, fontSize: 24, fontWeight: 850 }}>
            Contact
          </h2>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            Questions, suggestions, and feedback are always welcome.
          </p>

          <p style={{ fontSize: 16 }}>
            <Link
              href="/contact"
              style={{
                color: "#93c5fd",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              Contact MyStockHarbor →
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
