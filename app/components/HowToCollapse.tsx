"use client";

import { useId, useState } from "react";

// Collapsed-by-default "how to use" card shown in the hero of every
// pickers/screener page and the chart-pattern plays pages. Shows only the
// title until clicked; expands in place to reveal the explanation. Shared
// so all pages (PickerResultPage and ScreenerShell) get identical
// behaviour and styling from one place.
//
// The body is ALWAYS rendered and hidden with the `hidden` attribute when
// collapsed, rather than being conditionally mounted.
//
// That distinction is the whole point of this comment. The previous version
// was `{open ? <p>{body}</p> : null}`, and because this is a client component
// defaulting to closed, the paragraph was absent from the server-rendered
// markup entirely -- it only ever came into existence after a click, and
// crawlers do not click. Across the ~25 condition screener pages that was
// roughly 1,100 words of hand-written explanation that reached nobody.
//
// Easy to check wrongly: the text does appear in view-source either way,
// because Next serialises the prop into the RSC flight payload for hydration.
// But that copy sits inside a <script> tag, not the document body. Verified on
// production by fetching a page and stripping script tags -- the explainer
// vanished, while prose rendered normally survived.
//
// `hidden` keeps the visible behaviour and the accessibility tree identical to
// before (it is the standard accordion pattern, and screen readers skip a
// hidden panel exactly as they skipped an unmounted one), while putting the
// text in the document where it can actually be read.
export default function HowToCollapse({
  title,
  body,
}: {
  title?: string;
  body?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (!body) return null;

  return (
    <div className="heroHowTo">
      <button
        type="button"
        className="heroHowToToggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
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
      <div id={panelId} hidden={!open}>
        <p>{body}</p>
      </div>
    </div>
  );
}
