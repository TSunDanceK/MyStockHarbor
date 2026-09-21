"use client";

import { useState } from "react";
import type React from "react";

// Owner-only "fill this date in now" control, rendered at the bottom of
// app/earnings-calendar/page.tsx. Greyed out only when the date has no earnings
// to pull at all. Otherwise reveals an inline code entry that posts to
// /api/earnings-calendar/backfill-date -- same safety rules as normal browsing
// (site-wide FMP budget always enforced), just without the hourly cap for this
// one date. Wrong-code lockout (3 attempts / 10 min) is enforced server-side.
// ── WHY THIS NO LONGER READS THE COMPLETENESS FLAG ─────────────────────────
//
// It used to grey itself out on `complete`, which is the very flag the
// empty-day poisoning corrupts. A date wrongly marked complete-and-empty
// therefore disabled the one control that could have refilled it: the manual
// override switched itself off at exactly the moment it was needed, and told
// the owner "this date is fully populated" while showing zero companies.
// Measured on 2026-09-14.
//
// AN OVERRIDE MUST NOT BE GATED ON THE STATE IT OVERRIDES. The only thing that
// can make backfilling meaningless is there being nothing to fetch, so
// `hasEarnings` -- the candidate count -- is the only gate left. Re-running on
// an already-full date is harmless: it re-quotes from cache and marks it
// complete again.
export default function BackfillButton({
  date,
  hasEarnings,
}: {
  date: string;
  hasEarnings: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (!hasEarnings) {
    return (
      <button type="button" disabled style={{ ...btnStyle, opacity: 0.35, cursor: "default" }}>
        Backfill (no earnings on this date)
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
      setMessage(
        `Populated ${json?.usListedCount ?? "?"} US-listed of ${json?.totalCandidates ?? "?"} candidates${
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
