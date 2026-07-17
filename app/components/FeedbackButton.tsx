import Link from "next/link";

// Site-wide floating feedback entry point. Deliberately a plain link to
// /feedback (not a modal) per owner's preference -- keeps this component a
// server component with zero client JS, and gives /feedback its own indexable
// URL rather than trapping the flow inside a client-only overlay.
export default function FeedbackButton() {
  return (
    <>
      <Link
        href="/feedback"
        className="feedbackFab"
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 60,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 18px",
          borderRadius: 999,
          border: "1px solid rgba(59,130,246,0.36)",
          background:
            "linear-gradient(135deg, rgba(59,130,246,0.94), rgba(37,99,235,0.94))",
          color: "#f8fafc",
          textDecoration: "none",
          fontWeight: 800,
          fontSize: 13,
          letterSpacing: "0.02em",
          boxShadow: "0 10px 26px rgba(37,99,235,0.38)",
        }}
      >
        <span aria-hidden="true">💬</span>
        <span className="feedbackFabLabel">Feedback</span>
      </Link>
      <style>{`
        @media (max-width: 480px) {
          .feedbackFabLabel { display: none; }
          .feedbackFab { padding: 13px !important; }
        }
      `}</style>
    </>
  );
}
