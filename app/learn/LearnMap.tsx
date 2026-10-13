// app/learn/LearnMap.tsx
// THE /learn OVERVIEW AS A SPIDER MAP (#563 COWORK #169, reworking #166 PR 3).
// A central hub, "Learn", with the six sections branching from it in their
// existing colours, and each section fanning out to its lessons on curved
// wires. Leaves show titles only; each one's short description sits in a card
// that appears on hover, keyboard focus, or a first tap.
//
//   - Crawlable: every lesson is a real <a href> in the server HTML, exactly
//     once, and every description is in the HTML (the card, hidden until wanted).
//   - Pop: hover or focus scales a node up (1.08×) with a glow in its colour,
//     brightens its wire and dims the rest of the map; hovering a section lights
//     its whole branch. Reduced motion keeps the highlight but drops the motion.
//   - Touch: there is no hover, so the first tap on a lesson pops it and shows
//     its card, and a second tap opens it; a tap on a section lights its branch.
//   - Layout: one set of nodes, two arrangements. Where the map is at least 54rem
//     wide, three branches each side of the hub (positions computed here, from
//     fixed row heights, so labels never overlap). Narrower, the hub at the top
//     and each section as its own mini spider (section, then its lessons either
//     side of one centre spine), stacked.
// Server-rendered; a few lines of inline script handle the touch taps only.
import { lessonsByCategory } from "./all-lessons";

export type MapNode = { href: string; title: string; summary: string };
export type MapLane = { id: string; label: string; tone: string; nodes: MapNode[] };

/**
 * The standalone guides (titles and lines as the old cards had them). "How to
 * Identify Stock Trends" was also listed here, but it is a Basics lesson: the
 * map shows it once, there.
 */
export const IN_DEPTH_GUIDES: MapNode[] = [
  { href: "/how-to-read-stock-charts", title: "How to Read Stock Charts", summary: "A beginner-friendly guide to trend, support, resistance, and chart context." },
  { href: "/best-stock-indicators-for-beginners", title: "Best Stock Indicators for Beginners", summary: "Learn which indicators matter most when you are just starting out." },
  { href: "/trading-setups", title: "Trading Setups Hub", summary: "An overview of common setups (breakouts, oversold moves, dips and divergence) and how traders think about each." },
];
export const RISK_GUIDES: MapNode[] = [
  { href: "/position-sizing-guide", title: "Position Sizing Guide", summary: "Learn how traders size positions based on stop loss distance and account risk." },
  { href: "/stop-loss-strategy", title: "Stop Loss Strategy", summary: "Understand how stop losses help limit downside and improve trade discipline." },
  { href: "/trading-risk-management", title: "Trading Risk Management", summary: "Explore the core principles traders use to protect capital and manage losses." },
  { href: "/risk-reward-ratio", title: "Risk Reward Ratio", summary: "Learn how traders compare potential reward against possible downside before entering." },
  { href: "/margin-trading-explained", title: "Margin Trading Explained", summary: "Understand leverage, liquidation risk and why margin needs careful control." },
];

const lessons = (cat: string): MapNode[] =>
  lessonsByCategory(cat).map((l) => ({ href: `/learn/${encodeURIComponent(l.slug)}`, title: l.title, summary: l.summary }));

/** The six sections, in learning order, each in its existing colour. The first three branch left of the hub, the rest right. */
export function learnLanes(): MapLane[] {
  return [
    { id: "basics", label: "Basics", tone: "#93c5fd", nodes: lessons("Basics") },
    { id: "indicators", label: "Indicators", tone: "#d8b4fe", nodes: lessons("Indicators") },
    { id: "divergences", label: "Divergences", tone: "#fde047", nodes: lessons("Divergencies") },
    { id: "financial", label: "How to read financial data", tone: "#5eead4", nodes: lessons("Fundamentals") },
    { id: "guides", label: "In-depth guides", tone: "#86efac", nodes: IN_DEPTH_GUIDES },
    { id: "risk", label: "Risk management", tone: "#86efac", nodes: RISK_GUIDES },
  ];
}

// ── GEOMETRY (px at a 16 px root; written out in rem so the map scales with it) ──
/** A leaf's height, the gap between leaves, the gap between branches, a wire column's width. */
export const ROW = 44, GAP = 8, PITCH = ROW + GAP, BRANCH_GAP = 20, WIRE = 36;
const rem = (px: number) => `${+(px / 16).toFixed(4)}rem`;
const groupH = (n: number) => n * PITCH - GAP;

/** Where each branch's section node sits on its side, and the side's height. */
export function sideLayout(lanes: MapLane[]) {
  let y = 0;
  const centres = lanes.map((l) => { const c = y + groupH(l.nodes.length) / 2; y += groupH(l.nodes.length) + BRANCH_GAP; return c; });
  return { height: y - BRANCH_GAP, centres };
}

/** A branch's wires: section (at the hub-side edge) to each leaf (at the outer edge). */
function BranchWires({ lane, side }: { lane: MapLane; side: "l" | "r" }) {
  const h = groupH(lane.nodes.length), mid = h / 2;
  const [sx, lx] = side === "l" ? [WIRE, 0] : [0, WIRE];
  return (
    <svg className="lmWires lmBranchWires" viewBox={`0 0 ${WIRE} ${h}`} style={{ width: rem(WIRE), height: rem(h) }} aria-hidden="true" focusable="false">
      {lane.nodes.map((_, i) => {
        const y = i * PITCH + ROW / 2;
        return <path key={i} className="lmWire" data-i={i} pathLength={1} d={`M${sx} ${mid} C${WIRE / 2} ${mid} ${WIRE / 2} ${y} ${lx} ${y}`} />;
      })}
    </svg>
  );
}

/** The trunk on one side: the hub (inner edge) to each section on that side. */
function TrunkWires({ lanes, side, height }: { lanes: MapLane[]; side: "l" | "r"; height: number }) {
  const { height: h, centres } = sideLayout(lanes);
  const top = (height - h) / 2, hub = height / 2;
  const [hx, sx] = side === "l" ? [WIRE, 0] : [0, WIRE];
  return (
    <svg className="lmWires lmTrunk" viewBox={`0 0 ${WIRE} ${height}`} style={{ width: rem(WIRE), height: rem(height) }} aria-hidden="true" focusable="false">
      {lanes.map((l, i) => <path key={l.id} className="lmTrunkWire" data-lane={l.id} pathLength={1} d={`M${hx} ${hub} C${WIRE / 2} ${hub} ${WIRE / 2} ${top + centres[i]} ${sx} ${top + centres[i]}`} />)}
    </svg>
  );
}

function Branch({ lane, side }: { lane: MapLane; side: "l" | "r" }) {
  return (
    <section className="lmGroup" data-lane={lane.id} data-side={side} style={{ ["--lm-tone" as string]: lane.tone, ["--lm-rows" as string]: Math.ceil(lane.nodes.length / 2) }} aria-label={lane.label}>
      <button type="button" className="lmNode lmSection" aria-label={`${lane.label}: highlight this branch`}>{lane.label}</button>
      <BranchWires lane={lane} side={side} />
      <ul className="lmLeaves">
        {lane.nodes.map((n, i) => {
          const id = `lm-d-${lane.id}-${i}`;
          return (
            <li key={n.href} className="lmLeafItem">
              <a href={n.href} className="lmNode lmLeaf" data-i={i} aria-label={n.title} aria-describedby={id}>
                <span className="lmTitle">{n.title}</span>
                <span className="lmCard" id={id} role="tooltip">{n.summary}<span className="lmCardHint" aria-hidden="true">Tap again to open</span></span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function LearnMap({ lanes = learnLanes() }: { lanes?: MapLane[] }) {
  const left = lanes.slice(0, 3), right = lanes.slice(3);
  const L = sideLayout(left), R = sideLayout(right), H = Math.max(L.height, R.height);
  return (
    <div className="lmWrap">
      <nav className="lmMap" aria-label="Learning map: every lesson by section" data-learn-map="" style={{ ["--lm-h" as string]: rem(H) }}>
        <div className="lmSide" data-side="l" style={{ ["--lm-top" as string]: rem((H - L.height) / 2) }}>
          {left.map((l) => <Branch key={l.id} lane={l} side="l" />)}
        </div>
        <TrunkWires lanes={left} side="l" height={H} />
        <div className="lmHub" aria-hidden="true">Learn</div>
        <TrunkWires lanes={right} side="r" height={H} />
        <div className="lmSide" data-side="r" style={{ ["--lm-top" as string]: rem((H - R.height) / 2) }}>
          {right.map((l) => <Branch key={l.id} lane={l} side="r" />)}
        </div>
      </nav>
      <style>{learnMapCss(lanes)}</style>
      <script dangerouslySetInnerHTML={{ __html: LEARN_MAP_TOUCH }} />
    </div>
  );
}

/**
 * TOUCH (no hover): the first tap on a lesson pops it and shows its card, the
 * second opens it; a tap on a section lights its branch; a tap elsewhere clears.
 */
export const LEARN_MAP_TOUCH = `(function(){if(!window.matchMedia||!matchMedia("(hover: none)").matches)return;var clear=function(){document.querySelectorAll(".lmMap .is-active").forEach(function(e){e.classList.remove("is-active")})};document.addEventListener("click",function(e){var n=e.target&&e.target.closest?e.target.closest(".lmMap .lmNode"):null;if(!n){clear();return}if(n.classList.contains("is-active")){if(n.classList.contains("lmSection"))clear();return}e.preventDefault();clear();n.classList.add("is-active")},true)})();`;

/** "Something in this lane is active": hovered, focused (by keyboard) or tapped. */
const active = (sel: string) => [`${sel}:hover`, `${sel}:focus-visible`, `${sel}.is-active`].join(",");

export function learnMapCss(lanes: MapLane[]) {
  const maxLeaves = Math.max(...lanes.map((l) => l.nodes.length));
  // A leaf's own wire brightens with it; a lane's trunk wire brightens with anything in that lane.
  const leafWires = Array.from({ length: maxLeaves }, (_, i) => `.lmGroup:has(${active(`.lmLeaf[data-i="${i}"]`)}) .lmWire[data-i="${i}"]`).join(",");
  const trunkWires = lanes.map((l) => `.lmMap:has(.lmGroup[data-lane="${l.id}"] :is(${active(".lmNode")})) .lmTrunkWire[data-lane="${l.id}"]`).join(",");
  return `
.lmWrap{container-type:inline-size;margin-top:22px;}
.lmMap{position:relative;display:flex;flex-direction:column;align-items:stretch;gap:${rem(28)};}
.lmMap ul{list-style:none;margin:0;padding:0;}
.lmSide{display:contents;}
.lmTrunk,.lmBranchWires{display:none;}
.lmHub{order:-1;align-self:center;display:grid;place-items:center;min-width:${rem(104)};height:${rem(56)};padding:0 ${rem(16)};border-radius:999px;background:#13213f;border:2px solid #5fd4c7;color:#f8fafc;font-weight:900;font-size:var(--fs-read);letter-spacing:.04em;box-shadow:0 0 22px rgba(95,212,199,.25);}
/* Narrow: a centre spine from the hub down; each section a mini spider on it. */
.lmMap::before{content:"";position:absolute;left:calc(50% - 1px);top:${rem(28)};bottom:${rem(ROW / 2)};width:2px;background:linear-gradient(180deg,#5fd4c7,#93c5fd,#d8b4fe,#fde047,#5eead4,#86efac);opacity:.35;border-radius:2px;}
.lmGroup{position:relative;display:flex;flex-direction:column;align-items:center;gap:${rem(12)};}
.lmLeaves{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:${rem(24)};row-gap:${rem(GAP)};width:100%;}
.lmLeafItem{position:relative;min-width:0;}
.lmLeafItem:nth-child(odd)::after,.lmLeafItem:nth-child(even)::before{content:"";position:absolute;top:50%;width:${rem(12)};height:2px;background:var(--lm-tone);opacity:.5;}
.lmLeafItem:nth-child(odd)::after{right:-${rem(12)};}
.lmLeafItem:nth-child(even)::before{left:-${rem(12)};}
/* The nodes. */
.lmNode{position:relative;box-sizing:border-box;border-radius:14px;border:1px solid color-mix(in srgb,var(--lm-tone) 45%,transparent);background:#0b1220;color:#f1f5f9;text-decoration:none;font:inherit;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,opacity .18s ease,border-color .18s ease;}
.lmSection{z-index:1;display:grid;place-items:center;min-width:${rem(128)};max-width:${rem(200)};min-height:${rem(ROW)};padding:${rem(4)} ${rem(14)};background:color-mix(in srgb,var(--lm-tone) 16%,#0b1220);border-color:var(--lm-tone);color:var(--lm-tone);font-weight:900;font-size:var(--fs-label);letter-spacing:.06em;text-transform:uppercase;text-align:center;line-height:1.15;}
.lmLeaf{display:flex;align-items:center;min-height:${rem(56)};height:100%;padding:${rem(6)} ${rem(12)};}
.lmTitle{min-width:0;overflow-wrap:anywhere;font-weight:800;font-size:${rem(13)};line-height:1.2;}
.lmCard{position:absolute;z-index:6;top:calc(100% + ${rem(6)});left:0;width:min(${rem(260)},calc(100vw - 2.5rem));padding:${rem(10)} ${rem(12)};border-radius:12px;border:1px solid color-mix(in srgb,var(--lm-tone) 55%,transparent);background:#0f1624;color:#cbd5e1;font-size:var(--fs-read);font-weight:500;line-height:1.5;text-transform:none;letter-spacing:0;box-shadow:0 14px 30px rgba(0,0,0,.5);visibility:hidden;opacity:0;transform:translateY(-4px);transition:opacity .15s ease,transform .15s ease,visibility .15s;pointer-events:none;}
.lmLeafItem:nth-child(even) .lmCard{left:auto;right:0;}
.lmCardHint{display:none;margin-top:${rem(6)};font-size:var(--fs-fine);color:var(--lm-tone);font-weight:800;}
.lmLeaf.is-active .lmCardHint{display:block;}
/* Pop: the node scales and glows; its card shows; the rest dims; its wires brighten. */
:is(${active(".lmNode")}){transform:scale(1.08);z-index:5;border-color:var(--lm-tone);box-shadow:0 0 0 1px var(--lm-tone),0 0 20px color-mix(in srgb,var(--lm-tone) 45%,transparent);outline:none;}
:is(${active(".lmLeaf")}) .lmCard{visibility:visible;opacity:1;transform:none;}
.lmMap:has(${active(".lmNode")}) .lmNode{opacity:.4;}
.lmMap:has(${active(".lmNode")}) :is(${active(".lmNode")}){opacity:1;}
.lmMap .lmGroup:has(${active(".lmSection")}) .lmNode{opacity:1;border-color:var(--lm-tone);}
.lmGroup:has(${active(".lmSection")}) .lmWire,${leafWires},${trunkWires}{opacity:1;stroke-width:2.5;}
.lmWire,.lmTrunkWire{fill:none;stroke:var(--lm-tone,#5fd4c7);stroke-width:1.6;opacity:.45;transition:opacity .18s ease,stroke-width .18s ease;stroke-dasharray:1;stroke-dashoffset:0;animation:lmDraw .9s ease-out both;}
${lanes.map((l) => `.lmTrunkWire[data-lane="${l.id}"]{stroke:${l.tone};}`).join("")}
@keyframes lmDraw{from{stroke-dashoffset:1;}}
/* Wide: three branches each side of the hub, on curved wires. */
@container (min-width:54rem){
.lmMap{display:grid;grid-template-columns:minmax(0,1fr) ${rem(WIRE)} ${rem(104)} ${rem(WIRE)} minmax(0,1fr);align-items:center;gap:0;height:var(--lm-h);}
.lmMap::before{display:none;}
.lmSide{display:flex;flex-direction:column;gap:${rem(BRANCH_GAP)};align-self:start;padding-top:var(--lm-top);}
.lmTrunk{display:block;align-self:start;}
.lmHub{order:0;min-width:0;width:${rem(104)};padding:0;}
.lmGroup{display:grid;align-items:center;gap:0;}
.lmSide[data-side="l"] .lmGroup{grid-template-columns:minmax(0,1fr) ${rem(WIRE)} auto;grid-template-areas:"leaves wires section";}
.lmSide[data-side="r"] .lmGroup{grid-template-columns:auto ${rem(WIRE)} minmax(0,1fr);grid-template-areas:"section wires leaves";}
.lmSection{grid-area:section;width:${rem(128)};min-width:0;}
.lmBranchWires{display:block;grid-area:wires;}
.lmLeaves{grid-area:leaves;display:flex;flex-direction:column;gap:${rem(GAP)};}
.lmLeafItem::before,.lmLeafItem::after{display:none!important;}
.lmLeaf{height:${rem(ROW)};min-height:0;padding:${rem(4)} ${rem(12)};}
.lmTitle{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:${rem(13.5)};line-height:1.15;}
.lmSide[data-side="l"] .lmCard{left:0;right:auto;}
.lmSide[data-side="r"] .lmCard{left:auto;right:0;}
}
@media (prefers-reduced-motion:reduce){
.lmNode,.lmCard,.lmWire,.lmTrunkWire{transition:none;}
.lmWire,.lmTrunkWire{animation:none;}
:is(${active(".lmNode")}){transform:none;}
:is(${active(".lmLeaf")}) .lmCard{transform:none;}
}
`;
}
