import { WEB, type DependencyWeb } from "@/lib/bottleneckHub";

// THE DEPENDENCY WEB at the top of /bottlenecks (#125 COWORK).
//
// A plain server-rendered <svg>: no chart library, no client code. The
// geometry comes from buildDependencyWeb() in lib/bottleneckHub.ts. The eight
// most-shared companies are hubs in the middle, sized by how many stock pages
// name them; every mapped stock is a dot on the rim with a line to each hub
// it names.
//
// HOVER / TAP WITHOUT JAVASCRIPT. Each hub is a focusable <g>, and the
// stylesheet below uses :has() on the wrapper: while hub i is hovered or
// focused (a tap focuses it), its lines and the stocks it reaches light up,
// every other line dims, and caption i ("N stocks depend on X") replaces the
// default caption. The captions are HTML under the drawing, so they wrap and
// size like any other text. Lines and rim dots never move; nothing is
// transformed.
//
// Hidden at 560px and under (the hero shows a top-10 list there instead): a
// web this dense is not legible at phone width.

export const HUB_COLORS = ["#5FD4C7", "#93c5fd", "#f0abfc", "#fcd34d", "#86efac", "#fca5a5", "#c4b5fd", "#fdba74"];

export default function BottleneckWeb({ web }: { web: DependencyWeb }) {
  const { hubs, stocks } = web;
  if (!hubs.length) return null;
  const hubIndex = new Map(hubs.map((h, i) => [h.key, i]));

  const css = hubs
    .map(
      (_, i) =>
        `.bnWebWrap:has(.bnHub-${i}:hover, .bnHub-${i}:focus) .bnLinks-${i} { stroke-opacity: 0.9; }\n` +
        `.bnWebWrap:has(.bnHub-${i}:hover, .bnHub-${i}:focus) .bnTo-${i} { fill: ${HUB_COLORS[i % HUB_COLORS.length]}; fill-opacity: 1; }\n` +
        `.bnWebWrap:has(.bnHub-${i}:hover, .bnHub-${i}:focus) .bnCap-${i} { display: block; }`
    )
    .join("\n");

  return (
    <div className="bnWebWrap">
      <svg
        className="bnWeb"
        viewBox={`0 0 ${WEB.width} ${WEB.height}`}
        role="group"
        aria-label={`Dependency web: ${stocks.length} mapped stocks and the ${hubs.length} companies they name most often`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {hubs.map((h, i) => (
          <g key={h.key} className={`bnLinks bnLinks-${i}`} stroke={HUB_COLORS[i % HUB_COLORS.length]} strokeOpacity={0.2} strokeWidth={1}>
            {stocks
              .filter((s) => s.hubs.includes(h.key))
              .map((s) => (
                <line key={s.slug} x1={s.x} y1={s.y} x2={h.x} y2={h.y} />
              ))}
          </g>
        ))}

        {stocks.map((s) => (
          <a key={s.slug} href={`/bottlenecks/${s.slug}`} aria-label={`${s.companyName} (${s.symbol})`}>
            <circle
              className={`bnStock ${s.hubs.map((k) => `bnTo-${hubIndex.get(k)}`).join(" ")}`}
              cx={s.x}
              cy={s.y}
              r={4}
              fill={s.hubs.length ? "#cbd5e1" : "#475569"}
              fillOpacity={s.hubs.length ? 0.7 : 0.6}
            >
              <title>{`${s.symbol}: ${s.companyName}`}</title>
            </circle>
          </a>
        ))}

        {hubs.map((h, i) => {
          const color = HUB_COLORS[i % HUB_COLORS.length];
          return (
            <g
              key={h.key}
              className={`bnHub bnHub-${i}`}
              tabIndex={0}
              role="button"
              aria-label={`${h.count} stocks depend on ${h.name}`}
            >
              <circle cx={h.x} cy={h.y} r={h.r} fill="#0b1220" stroke={color} strokeWidth={2} />
              <text x={h.x} y={h.y - 1} textAnchor="middle" fill="#f1f5f9" style={{ fontSize: "0.8125rem", fontWeight: 800 }}>
                {h.label}
              </text>
              <text x={h.x} y={h.y + 14} textAnchor="middle" fill={color} style={{ fontSize: "0.75rem", fontWeight: 800 }}>
                ×{h.count}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="bnCapDefault" style={{ margin: "8px 0 0", fontSize: "var(--fs-read)", color: "rgba(241,245,249,0.7)", textAlign: "center" }}>
        Hover or tap a hub to see who names it
      </p>
      {hubs.map((h, i) => (
        <p key={h.key} className={`bnCap bnCap-${i}`} style={{ margin: "8px 0 0", fontSize: "var(--fs-read)", textAlign: "center", color: HUB_COLORS[i % HUB_COLORS.length], fontWeight: 700 }}>
          {h.count} stocks depend on {h.name}
        </p>
      ))}

      <style>{`
        .bnCap { display: none; }
        .bnHub { cursor: pointer; outline: none; }
        .bnHub:focus-visible circle { stroke-width: 3; }
        .bnLinks line { pointer-events: none; transition: stroke-opacity 0.15s; }
        .bnWebWrap:has(.bnHub:hover, .bnHub:focus) .bnCapDefault { display: none; }
        .bnWebWrap:has(.bnHub:hover, .bnHub:focus) .bnLinks { stroke-opacity: 0.03; }
        .bnWebWrap:has(.bnHub:hover, .bnHub:focus) .bnStock { fill-opacity: 0.25; }
${css}
      `}</style>
    </div>
  );
}
