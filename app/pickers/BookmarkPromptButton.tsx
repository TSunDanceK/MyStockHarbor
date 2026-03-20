"use client";

import React, { useMemo, useState } from "react";

type BookmarkPromptButtonProps = {
  compact?: boolean;
};

export default function BookmarkPromptButton({
  compact = false,
}: BookmarkPromptButtonProps) {
  const [copied, setCopied] = useState(false);

  const shortcut = useMemo(() => {
    if (typeof navigator !== "undefined") {
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac")) return "⌘ + D";
    }
    return "Ctrl + D";
  }, []);

  async function handleBookmarkClick() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.alert(
        `Add this page to bookmarks with ${shortcut}.\n\nThe page link has also been copied for you.`
      );
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      window.alert(`Add this page to bookmarks with ${shortcut}.`);
    }
  }

  return (
    <button
      type="button"
      onClick={handleBookmarkClick}
      style={
        compact
          ? {
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 999,
              border: "1px solid rgba(250,204,21,0.28)",
              background:
                "linear-gradient(135deg, rgba(250,204,21,0.14), rgba(245,158,11,0.08))",
              color: "#fef3c7",
              fontSize: 12,
              fontWeight: 950,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              lineHeight: 1,
              boxSizing: "border-box",
              cursor: "pointer",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
              whiteSpace: "nowrap",
              maxWidth: "100%",
            }
          : {
              marginTop: 16,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid rgba(250,204,21,0.24)",
              background:
                "linear-gradient(135deg, rgba(250,204,21,0.10), rgba(15,23,42,0.12))",
              color: "#fef3c7",
              fontSize: 13,
              fontWeight: 800,
              lineHeight: 1.5,
              boxSizing: "border-box",
              maxWidth: 560,
              cursor: "pointer",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            }
      }
      aria-label="Add this page to bookmarks"
      title="Add this page to bookmarks"
    >
      <span
        aria-hidden="true"
        style={{
          fontSize: compact ? 12 : 14,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: compact ? 14 : 18,
        }}
      >
        ★
      </span>

      <span>
        {copied
          ? compact
            ? "Link copied"
            : "Link copied — press bookmark shortcut to save this page."
          : compact
            ? "Add me to bookmarks"
            : "Add me to bookmarks — check back hourly for new stock ideas."}
      </span>
    </button>
  );
}
