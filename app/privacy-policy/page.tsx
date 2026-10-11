import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | MyStockHarbor",
  description:
    "Read the MyStockHarbor privacy policy explaining how data is collected and used on this website.",
};

export default function PrivacyPolicyPage() {
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
            Privacy Policy
          </h1>

          <p style={{ fontSize: 16, lineHeight: 1.7 }}>
            MyStockHarbor respects your privacy and is committed to protecting
            your personal data. This privacy policy explains how information may
            be collected and used when you visit this website.
          </p>

          <h2 style={{ marginTop: 28 }}>Information We May Collect</h2>

          <p style={{ fontSize: 16, lineHeight: 1.7 }}>
            We may collect limited information such as browser type, device
            information, and website usage statistics to help improve the
            functionality and performance of the site.
          </p>

          <h2 style={{ marginTop: 28 }}>Cookies</h2>

          <p style={{ fontSize: 16, lineHeight: 1.7 }}>
            This website may use cookies or similar technologies to improve user
            experience, analyze traffic, and measure the effectiveness of
            content or affiliate links.
          </p>

          <h2 style={{ marginTop: 28 }}>Third-Party Services</h2>

          <p style={{ fontSize: 16, lineHeight: 1.7 }}>
            MyStockHarbor may contain links to third-party platforms. These
            external websites operate under their own privacy policies and terms
            of service, and we are not responsible for their practices.
          </p>

          <h2 style={{ marginTop: 28 }}>Data Security</h2>

          <p style={{ fontSize: 16, lineHeight: 1.7 }}>
            We take reasonable measures to ensure the website is secure, but no
            online platform can guarantee complete security.
          </p>

          <h2 style={{ marginTop: 28 }}>Contact</h2>

          <p style={{ fontSize: 16, lineHeight: 1.7 }}>
            If you have questions regarding this privacy policy, please contact
            us at{" "}
            <a
              href="mailto:admin@mystockharbor.co.uk"
              style={{ color: "#93c5fd", textDecoration: "none" }}
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
