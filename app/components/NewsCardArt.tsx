// The picture on a news card. One component, all three surfaces.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// Step 0 stopped the publisher hotlink on four render sites and gave art back
// to one. The other three went imageless on main and stayed that way for a
// whole step, because a missing picture fails no build, no test and no type —
// the check script's assertions were greps for identifiers, and identifiers
// survive being wrapped in `{false ? ... : null}`.
//
// Split into a plan (lib/server/news/art.ts planCardArt) and this renderer, both
// halves are testable by running them: the rule by calling it, the markup by
// rendering it. scripts/check-news-art.mjs does exactly that.
//
// Serving follows claude/image-policy-2026-09-13.md: a plain <img srcset>, never
// next/image (these are fixed pre-generated sizes, so the optimiser would bill a
// meter for work already done), and width and height on every graphic so the box
// is reserved before the file lands.
import type { CSSProperties } from "react";
import type { CardArt } from "@/lib/server/news/art";
import GeneratedNewsArt from "@/app/components/GeneratedNewsArt";

export type NewsCardArtProps = {
  plan: CardArt;
  /** The ticker the generated card draws. Unused when the plan is library art. */
  symbol: string;
  /** Percent move over the sparkline window; null renders the flat state. */
  changePct: number | null;
  /** Closing prices, oldest first. Empty renders no line. */
  points: number[];
  /**
   * Widths this image will actually occupy, for srcset selection. The library
   * ships 320w and 1200w, so this only decides which one the browser takes.
   */
  sizes: string;
  style?: CSSProperties;
};

export default function NewsCardArt({
  plan, symbol, changePct, points, sizes, style,
}: NewsCardArtProps) {
  if (plan.kind === "none") return null;

  if (plan.kind === "generated") {
    return (
      <GeneratedNewsArt
        symbol={symbol}
        changePct={changePct}
        points={points}
        variant={plan.variant}
        style={style}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={plan.art.src}
      srcSet={plan.art.srcSet}
      sizes={sizes}
      width={plan.art.width}
      height={plan.art.height}
      alt=""
      loading="lazy"
      style={style}
    />
  );
}
