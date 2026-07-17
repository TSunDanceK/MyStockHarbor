import Link from "next/link";

// Small inline pill-style link, matching ShareButton's visual weight so it
// can sit directly next to it -- via PageShareBar's `showFeedback` prop on
// most pages, or inline in a page's own nav row (e.g. the Insights article
// page). Deliberately a plain server-rendered <Link> to /feedback: no
// client JS, no modal, no fixed positioning.
export default function FeedbackButton() {
  return (
    <Link
      href="/feedback"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 14px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.06)",
        color: "#f1f5f9",
        fontSize: 13,
        fontWeight: 700,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true">💬</span>
      Feedback
    </Link>
  );
}
