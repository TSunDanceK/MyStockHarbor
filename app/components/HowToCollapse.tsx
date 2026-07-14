"use client";

import { useState } from "react";

// Collapsed-by-default "how to use" card shown in the hero of every
// pickers/screener page and the chart-pattern plays pages. Shows only the
// title until clicked; expands in place to reveal the explanation. Shared
// so all pages (PickerResultPage and ScreenerShell) get identical
// behaviour and styling from one place.
export default function HowToCollapse({
  title,
  body,
}: {
  title?: string;
  body?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!body) return null;

  return (
    <div className="heroHowTo">
      <button
        type="button"
        className="heroHowToToggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="heroHowToLabel">{title}</span>
        <span
          className="heroHowToChevron"
          aria-hidden="true"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        >
          ▸
        </span>
      </button>
      {open ? <p>{body}</p> : null}
    </div>
  );
}
