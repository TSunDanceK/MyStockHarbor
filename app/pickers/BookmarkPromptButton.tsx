"use client";

import React, { useMemo, useState } from "react";

export default function BookmarkPromptButton() {
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
      style={{
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
      }}
      aria-label="Add this page to bookmarks"
      title="Add this page to bookmarks"
    >
      <span
        aria-hidden="true"
        style={{
          fontSize: 14,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
        }}
      >
        ★
      </span>

      <span>
        {copied
          ? "Link copied — press bookmark shortcut to save this page."
          : "Add me to bookmarks — check back hourly for new stock ideas."}
      </span>
    </button>
  );
}
