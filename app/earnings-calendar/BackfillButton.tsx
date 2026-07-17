"use client";

import { useState } from "react";
import type React from "react";

// Owner-only "fill this date in now" control, rendered at the bottom of
// app/earnings-calendar/page.tsx. Greyed out once the date is already fully
// quoted (nothing left to fetch). Otherwise reveals an inline code entry
// that posts to /api/earnings-calendar/backfill-date -- same safety rules
// as normal browsing (site-wide FMP budget always enforced), just without
// the hourly cap for this one date. Wrong-code lockout (3 attempts / 10
// min) is enforced server-side; this component just surfaces the resulting
// message.
export default function BackfillButton({ date, complete }: { date: string; complete: boolean }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(complete);

  if (isComplete) {
    return (
      <button
        type="button"
        disabled
        style={{
          ...btnStyle,
          opacity: 0.35,
          cursor: "default",
        }}
      >
        Backfill (this date is fully populated)
      </button>
    );
  }

  async function submit() {
    setStatus("loading");
    setMessage(null);

    try {
      const res = await fetch("/api/earnings-calendar/backfill-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, key: code }),
      });

      const json = await res.json().catch(() => ({}));

      if (res.status === 429) {
        setStatus("error");
        setMessage(json?.error || "Too many failed attempts. Try again later.");
        return;
      }

      if (res.status === 403) {
        setStatus("error");
        setMessage("Incorrect code.");
        return;
      }

      if (!res.ok) {
        setStatus("error");
        setMessage(json?.error || "Something went wrong.");
        return;
      }

      setStatus("done");
      setIsComplete(Boolean(json?.complete));
      setMessage(
        `Populated ${json?.fetchedCount ?? "?"} of ${json?.totalCandidates ?? "?"} tickers${
          json?.complete ? " -- date is now fully populated." : " -- some remain, run again if needed."
        }`
      );
      setCode("");
    } catch {
      setStatus("error");
      setMessage("Network error -- try again.");
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={btnStyle}>
        Backfill this date
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Backfill code"
          style={{
            padding: "7px 10px",
            borderRadius: 9,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.03)",
            color: "#e2e8f0",
            fontSize: 12.5,
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={status === "loading" || !code}
          style={{ ...btnStyle, opacity: status === "loading" || !code ? 0.5 : 1 }}
        >
          {status === "loading" ? "Populating..." : "Submit"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setMessage(null);
            setCode("");
            setStatus("idle");
          }}
          style={{ ...btnStyle, background: "transparent" }}
        >
          Cancel
        </button>
      </div>

      {message ? (
        <div
          style={{
            fontSize: 12,
            color: status === "error" ? "#fca5a5" : "#86efac",
          }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 9,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.03)",
  color: "#e2e8f0",
  textDecoration: "none",
  fontWeight: 700,
  fontSize: 12.5,
  cursor: "pointer",
};
