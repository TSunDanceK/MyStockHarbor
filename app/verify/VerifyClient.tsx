"use client";

import { useEffect, useState } from "react";

// Only ever redirect back into the one place this gate protects. Never
// trust `next` as an open redirect target -- it arrives as a URL search
// param, so treat it the same as any other user-controlled input.
function isSafeRedirectTarget(path: string): boolean {
  return /^\/stock\/[A-Za-z0-9.\-]+(\/(news|earnings))?(\?[^\s]*)?$/.test(path);
}

// Renders for a fraction of a second for a real visitor: fires the BotID
// check, then immediately forwards them on to the page they actually asked
// for. No puzzle, no visible interaction. See
// claude/stock-daily-rate-limit-2026-07-21.md for the full design and why
// this exists instead of a hard block or a visible CAPTCHA.
export default function VerifyClient({ next }: { next: string }) {
  const [denied, setDenied] = useState(false);
  const target = isSafeRedirectTarget(next) ? next : "/";

  useEffect(() => {
    let cancelled = false;

    fetch("/api/internal/verify-human", { method: "POST" })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          window.location.replace(target);
        } else {
          setDenied(true);
        }
      })
      .catch(() => {
        // Fail open on a network hiccup -- never trap a real visitor here
        // just because the check itself couldn't complete.
        if (!cancelled) window.location.replace(target);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (denied) {
    return (
      <div style={{ padding: 48, textAlign: "center", opacity: 0.75 }}>
        <p>We couldn&apos;t verify this request. Please try again later.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 48, textAlign: "center", opacity: 0.6 }}>
      <p>One moment…</p>
    </div>
  );
}
