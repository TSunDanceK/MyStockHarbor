import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Risk Disclaimer | MyStockHarbor",
  description:
    "Read the MyStockHarbor risk disclaimer covering educational use, market risk, no financial advice, and limitation of liability.",
};

export default function RiskDisclaimerPage() {
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
          <h1 style={{ marginTop: 0, fontSize: 34, fontWeight: 900 }}>
            Risk Disclaimer
          </h1>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            Trading and investing in financial markets involve substantial risk
            and may result in the loss of some or all of your capital.
          </p>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            The information provided on MyStockHarbor is for educational and
            informational purposes only. Nothing on this website should be
            interpreted as financial advice, investment advice, or a
            recommendation to buy or sell any security.
          </p>

          <h2 style={{ marginTop: 28, fontSize: 24, fontWeight: 850 }}>
            No Financial Advice
          </h2>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            MyStockHarbor does not provide personalized financial advice.
            Content, tools, indicators, and analysis provided on this platform
            are intended solely for educational use.
          </p>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            Users should conduct their own research and consult with a qualified
            financial professional before making any investment decisions.
          </p>

          <h2 style={{ marginTop: 28, fontSize: 24, fontWeight: 850 }}>
            Market Risk
          </h2>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            Financial markets can be volatile and unpredictable. Past
            performance of any strategy, indicator, or security does not
            guarantee future results.
          </p>

          <h2 style={{ marginTop: 28, fontSize: 24, fontWeight: 850 }}>
            Limitation of Liability
          </h2>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            MyStockHarbor is not responsible for any losses or damages resulting
            from the use of information, tools, or analysis provided on this
            website.
          </p>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            By using this website, you acknowledge that all trading and
            investment decisions are made at your own risk.
          </p>
        </section>
      </div>
    </main>
  );
}
