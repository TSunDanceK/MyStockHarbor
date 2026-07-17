// Thin server-component wrapper around ShareButton (and optionally
// FeedbackButton). Drop this into any server page — it avoids "use client"
// boundary issues while keeping the ShareButton logic entirely client-side.
//
// Usage:
//   import PageShareBar from "@/app/components/PageShareBar";
//   <PageShareBar url="https://..." title="..." text="..." showFeedback />

import ShareButton from "./ShareButton";
import FeedbackButton from "./FeedbackButton";

type Props = {
  url: string;
  title: string;
  text: string;
  align?: "left" | "right";
  showFeedback?: boolean;
};

export default function PageShareBar({
  url,
  title,
  text,
  align = "right",
  showFeedback = false,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        gap: 10,
        marginBottom: 14,
      }}
    >
      {showFeedback ? <FeedbackButton /> : null}
      <ShareButton url={url} title={title} text={text} />
    </div>
  );
}
