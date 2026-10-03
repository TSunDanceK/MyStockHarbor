// THE KEY LINE (#552 COWORK #94): on every page that shows an estimated or
// derived figure, saying what the mark means. Only the kinds on the page are
// listed, and nothing renders when there are none.
import { ESTIMATE_COLOUR, ESTIMATE_SIGN, type EstimateMark } from "./estimateMark";

export function EstimateKey({ marks, style }: { marks: (EstimateMark | null | undefined)[]; style?: React.CSSProperties }) {
  const kinds = new Set(marks.filter((m): m is EstimateMark => Boolean(m)).map((m) => m.kind));
  if (!kinds.size) return null;
  return (
    <div data-estimate-key="" style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.8, ...style }}>
      {kinds.has("estimate") ? (
        <div>
          <span style={{ color: ESTIMATE_COLOUR, fontWeight: 700 }}>{ESTIMATE_SIGN} Estimate</span>
          {": a line the filing doesn't tag is filled by a back-tested method. Hover or tap the figure for the method and date."}
        </div>
      ) : null}
      {kinds.has("derived") ? (
        <div>
          <span style={{ fontWeight: 700 }}>derived</span>
          {": computed from figures the company filed. Hover or tap the figure for how."}
        </div>
      ) : null}
    </div>
  );
}
