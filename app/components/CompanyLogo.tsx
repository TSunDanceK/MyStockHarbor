"use client";

import { useState } from "react";

export default function CompanyLogo({
  domain,
  name,
  size = 44,
}: {
  domain?: string | null;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  if (!domain || failed) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 10,
          background: "rgba(95,212,199,0.12)",
          border: "1px solid rgba(95,212,199,0.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.42,
          fontWeight: 800,
          color: "#5FD4C7",
          flexShrink: 0,
        }}
      >
        {initial}
      </div>
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        background: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: size * 0.14,
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://logo.clearbit.com/${domain}`}
        alt={`${name} logo`}
        onError={() => setFailed(true)}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
      />
    </div>
  );
}
