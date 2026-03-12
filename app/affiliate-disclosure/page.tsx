import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Affiliate Disclosure | MyStockHarbor",
  description:
    "Read the MyStockHarbor affiliate disclosure explaining how links to third-party platforms may earn us a commission.",
};

export default function AffiliateDisclosurePage() {
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
            Affiliate Disclosure
          </h1>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            Some links on MyStockHarbor may be affiliate links. This means that
            if you click a link to a third-party platform and choose to sign up
            or make a purchase, MyStockHarbor may receive a commission at no
            extra cost to you.
          </p>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            These commissions may help support the operation, maintenance, and
            development of this website, including free tools, educational
            content, and market analysis features.
          </p>

          <h2 style={{ marginTop: 28, fontSize: 24, fontWeight: 850 }}>
            Editorial Independence
          </h2>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            MyStockHarbor aims to provide honest, clear, and useful information.
            Any opinions, platform summaries, or comparisons shown on this site
            are intended to reflect genuine editorial judgment and are not
            influenced solely by affiliate relationships.
          </p>

          <h2 style={{ marginTop: 28, fontSize: 24, fontWeight: 850 }}>
            No Additional Cost to You
          </h2>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            Clicking an affiliate link does not increase the price you pay. In
            some cases, a third-party platform may provide promotional offers or
            benefits through special partner links, but this is not guaranteed.
          </p>

          <h2 style={{ marginTop: 28, fontSize: 24, fontWeight: 850 }}>
            Your Responsibility
          </h2>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            You should always do your own research before opening an account,
            purchasing a product, or using any financial platform. MyStockHarbor
            is for educational and informational purposes only and does not
            provide financial advice.
          </p>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            If you have any questions, you can contact us at{" "}
            <a
              href="mailto:admin@mystockharbor.co.uk"
              style={{ color: "#93c5fd", textDecoration: "none", fontWeight: 700 }}
            >
              admin@mystockharbor.co.uk
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
