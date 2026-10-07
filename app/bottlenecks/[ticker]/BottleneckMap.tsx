// THE TWO-SIDED MAP (#563 COWORK #158 §3): suppliers on the left as labelled
// boxes with their share, curved links into the company, then links out to its
// customers on the right. Link thickness is the share; box borders and link
// colour follow the grade. At most 6 a side, the rest as "+N more". Each box
// links to its card below. A vertical version (suppliers, the company, then
// customers) replaces it at 640 px and under. Server-drawn; no client code.
import { GRADE_TONE, GRADE_WORDS, type MapNode } from "@/lib/bottleneckPage";

const NEUTRAL = "#64748b";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const tone = (n: MapNode) => ("more" in n ? NEUTRAL : GRADE_TONE[n.grade]);
const width = (pct: number) => 1.5 + Math.min(100, pct) * 0.16;

function Box({ n, x, y, w, h, href }: { n: MapNode; x: number; y: number; w: number; h: number; href: string | null }) {
  const label = "more" in n ? `+${n.more} more` : clip(n.label, Math.floor((w - 20) / 8));
  const inner = (
    <g data-map-box={"more" in n ? "more" : n.grade}>
      <rect x={x} y={y} width={w} height={h} rx={10} fill="#0f1624" stroke={tone(n)} strokeWidth={1.6} />
      <text x={x + 10} y={y + h / 2 - 3} fontSize={12.5} fontWeight={700} fill="#e2e8f0">{label}</text>
      <text x={x + 10} y={y + h / 2 + 13} fontSize={11.5} fill="#94a3b8">{"more" in n ? `~${n.pct}% together` : `~${n.pct}% · ${GRADE_WORDS[n.grade]}`}</text>
    </g>
  );
  return href ? <a href={href} aria-label={"more" in n ? `${n.more} more, see the list below` : `${n.label}, about ${n.pct}%: see its card`}>{inner}</a> : inner;
}

export default function BottleneckMap({ symbol, name, left, right, describe }: { symbol: string; name: string; left: MapNode[]; right: MapNode[]; describe: string }) {
  // ── WIDE: 760 × H ──
  const BW = 230, BH = 46, GAP = 12, CW = 150, CH = 64;
  const rows = Math.max(left.length, right.length, 1);
  const H = rows * BH + (rows - 1) * GAP + 24;
  const cx = 380, cy = H / 2;
  const yOf = (i: number, n: number) => 12 + (H - 24 - (n * BH + (n - 1) * GAP)) / 2 + i * (BH + GAP);
  const hrefOf = (n: MapNode, side: "s" | "c") => ("more" in n ? `#${side === "s" ? "suppliers" : "customers"}` : `#${n.anchor}`);
  // ── NARROW: 360 wide, stacked ──
  const NW = 360, NB = 300, NBH = 44, NG = 8, NCH = 56;
  const topH = left.length * (NBH + NG), botY0 = topH + 28 + NCH + 28;
  const NH = botY0 + right.length * (NBH + NG) + 4;
  const ncy = topH + 28 + NCH / 2;
  return (
    <figure className="bnMap" data-bn-map="" aria-label={describe} role="img">
      <svg className="bnMapWide" viewBox={`0 0 760 ${H}`} width="100%" aria-hidden="true" focusable="false" data-map-side-counts={`${left.length},${right.length}`}>
        {left.map((n, i) => {
          const y = yOf(i, left.length) + BH / 2;
          return <path key={`l${n.key}`} d={`M${BW} ${y} C ${BW + 70} ${y}, ${cx - CW / 2 - 70} ${cy}, ${cx - CW / 2} ${cy}`} fill="none" stroke={tone(n)} strokeOpacity={0.55} strokeWidth={width(n.pct)} data-link-pct={n.pct} />;
        })}
        {right.map((n, i) => {
          const y = yOf(i, right.length) + BH / 2;
          return <path key={`r${n.key}`} d={`M${cx + CW / 2} ${cy} C ${cx + CW / 2 + 70} ${cy}, ${760 - BW - 70} ${y}, ${760 - BW} ${y}`} fill="none" stroke={tone(n)} strokeOpacity={0.55} strokeWidth={width(n.pct)} data-link-pct={n.pct} />;
        })}
        {left.map((n, i) => <Box key={n.key} n={n} x={0} y={yOf(i, left.length)} w={BW} h={BH} href={hrefOf(n, "s")} />)}
        {right.map((n, i) => <Box key={n.key} n={n} x={760 - BW} y={yOf(i, right.length)} w={BW} h={BH} href={hrefOf(n, "c")} />)}
        <rect x={cx - CW / 2} y={cy - CH / 2} width={CW} height={CH} rx={14} fill="#13213f" stroke="#5fd4c7" strokeWidth={2} />
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={17} fontWeight={900} fill="#f8fafc">{symbol}</text>
        <text x={cx} y={cy + 15} textAnchor="middle" fontSize={11.5} fill="#cbd5e1">{clip(name, 20)}</text>
        {left.length ? <text x={0} y={9} fontSize={11} fontWeight={800} fill="#93c5fd" letterSpacing="0.06em">SUPPLIERS</text> : null}
        {right.length ? <text x={760} y={9} textAnchor="end" fontSize={11} fontWeight={800} fill="#5fd4c7" letterSpacing="0.06em">CUSTOMERS</text> : null}
      </svg>
      <svg className="bnMapNarrow" viewBox={`0 0 ${NW} ${NH}`} width="100%" aria-hidden="true" focusable="false">
        {left.map((n, i) => {
          const y = i * (NBH + NG) + NBH / 2;
          return <path key={`nl${n.key}`} d={`M${(NW + NB) / 2} ${y} C ${NW - 8} ${y}, ${NW - 8} ${ncy - NCH / 2 - 6}, ${NW / 2 + 40} ${ncy - NCH / 2}`} fill="none" stroke={tone(n)} strokeOpacity={0.55} strokeWidth={Math.max(1.5, width(n.pct) * 0.6)} />;
        })}
        {right.map((n, i) => {
          const y = botY0 + i * (NBH + NG) + NBH / 2;
          return <path key={`nr${n.key}`} d={`M${NW / 2 - 40} ${ncy + NCH / 2} C 8 ${ncy + NCH / 2 + 6}, 8 ${y}, ${(NW - NB) / 2} ${y}`} fill="none" stroke={tone(n)} strokeOpacity={0.55} strokeWidth={Math.max(1.5, width(n.pct) * 0.6)} />;
        })}
        {left.map((n, i) => <Box key={`nb${n.key}`} n={n} x={(NW - NB) / 2} y={i * (NBH + NG)} w={NB} h={NBH} href={hrefOf(n, "s")} />)}
        <rect x={NW / 2 - 90} y={ncy - NCH / 2} width={180} height={NCH} rx={14} fill="#13213f" stroke="#5fd4c7" strokeWidth={2} />
        <text x={NW / 2} y={ncy - 2} textAnchor="middle" fontSize={16} fontWeight={900} fill="#f8fafc">{symbol}</text>
        <text x={NW / 2} y={ncy + 15} textAnchor="middle" fontSize={11.5} fill="#cbd5e1">{clip(name, 26)}</text>
        {right.map((n, i) => <Box key={`nc${n.key}`} n={n} x={(NW - NB) / 2} y={botY0 + i * (NBH + NG)} w={NB} h={NBH} href={hrefOf(n, "c")} />)}
      </svg>
      <figcaption className="bnFine" data-fine-print="">Link thickness is the estimated share; colour is the grade (red: hard to replace, amber: some alternatives, green: spread out).</figcaption>
    </figure>
  );
}
