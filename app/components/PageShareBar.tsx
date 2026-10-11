// Thin server-component wrapper around ShareButton.
// Drop this into any server page — it avoids "use client" boundary issues
// while keeping the ShareButton logic entirely client-side.
//
// Usage:
//   import PageShareBar from "@/app/components/PageShareBar";
//   <PageShareBar url="https://..." title="..." text="..." />

import ShareButton from "./ShareButton";

type Props = {
  url: string;
  title: string;
  text: string;
  align?: "left" | "right";
};

export default function PageShareBar({ url, title, text, align = "right" }: Props) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        marginBottom: 14,
      }}
    >
      <ShareButton url={url} title={title} text={text} />
    </div>
  );
}
