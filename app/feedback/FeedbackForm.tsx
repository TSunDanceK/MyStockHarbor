"use client";

import { useRef, useState, type CSSProperties, type FormEvent } from "react";

type Status = "idle" | "submitting" | "success" | "error";

export default function FeedbackForm() {
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot -- real users never see/fill this
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState("");

  // Captured once per mount. Sent back to the server so it can reject
  // submissions that come back suspiciously fast (a common bot tell),
  // alongside the honeypot field below.
  const startedAtRef = useRef<number>(Date.now());

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (status === "submitting") return;

    if (message.trim().length < 10) {
      setStatus("error");
      setErrorText("Please add a little more detail before submitting.");
      return;
    }

    setStatus("submitting");
    setErrorText("");

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          email,
          website,
          startedAt: startedAtRef.current,
        }),
      });

      const data = await res.json().catch(() => ({}) as { error?: string });

      if (!res.ok) {
        setStatus("error");
        setErrorText(data?.error ?? "Something went wrong. Please try again.");
        return;
      }

      setStatus("success");
      setMessage("");
      setEmail("");
    } catch {
      setStatus("error");
      setErrorText("Something went wrong. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div style={successBoxStyle}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
          Thanks — feedback sent!
        </div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, opacity: 0.85 }}>
          We read every message. If you left an email and it needs a reply,
          we&apos;ll get back to you when we can.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor="feedback-message" style={labelStyle}>
          What&apos;s on your mind? *
        </label>
        <textarea
          id="feedback-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="A feature you'd like to see, a bug you spotted, or anything else..."
          rows={6}
          required
          style={textareaStyle}
        />
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor="feedback-email" style={labelStyle}>
          Your email (optional)
        </label>
        <input
          id="feedback-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={inputStyle}
        />
        <div style={{ fontSize: 12, opacity: 0.6, lineHeight: 1.5 }}>
          Only used if we need to follow up on your message — never stored,
          shared, or added to any mailing list.
        </div>
      </div>

      {/* Honeypot field. Hidden from sighted users via off-screen CSS and
          removed from the tab order; simple spam bots that blindly fill in
          every input will populate it, and the API route silently drops any
          submission where it's non-empty. */}
      <div style={honeypotWrapStyle} aria-hidden="true">
        <label htmlFor="feedback-website">Leave this field blank</label>
        <input
          id="feedback-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {status === "error" ? <div style={errorBoxStyle}>{errorText}</div> : null}

      <button
        type="submit"
        disabled={status === "submitting"}
        style={{
          ...submitButtonStyle,
          opacity: status === "submitting" ? 0.7 : 1,
          cursor: status === "submitting" ? "default" : "pointer",
        }}
      >
        {status === "submitting" ? "Sending…" : "Send Feedback"}
      </button>
    </form>
  );
}

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "rgba(241,245,249,0.86)",
};

const textareaStyle: CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.04)",
  color: "#f1f5f9",
  padding: "12px 14px",
  fontSize: 15,
  lineHeight: 1.6,
  fontFamily: "inherit",
  resize: "vertical",
};

const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.04)",
  color: "#f1f5f9",
  padding: "12px 14px",
  fontSize: 15,
  fontFamily: "inherit",
};

const honeypotWrapStyle: CSSProperties = {
  position: "absolute",
  left: "-9999px",
  width: 1,
  height: 1,
  overflow: "hidden",
};

const errorBoxStyle: CSSProperties = {
  border: "1px solid rgba(248,113,113,0.30)",
  background: "rgba(248,113,113,0.08)",
  color: "#fecaca",
  borderRadius: 12,
  padding: "10px 14px",
  fontSize: 14,
};

const successBoxStyle: CSSProperties = {
  border: "1px solid rgba(34,197,94,0.28)",
  background: "rgba(34,197,94,0.08)",
  borderRadius: 16,
  padding: 20,
};

const submitButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 46,
  padding: "12px 20px",
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.34)",
  background:
    "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(37,99,235,0.14))",
  color: "#dbeafe",
  fontWeight: 900,
  fontSize: 14,
  letterSpacing: "0.02em",
};
