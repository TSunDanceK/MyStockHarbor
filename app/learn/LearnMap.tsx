// app/learn/LearnMap.tsx
// THE /learn OVERVIEW AS A MAP (#563 COWORK #166 PR 3). Replaces the wall of
// cards: every lesson and guide is a node with its title only, grouped by the
// existing sections (one lane each, in the sections' own colours) and joined
// into one learning path, lane after lane. Each node:
//   - is a real <a href> in the server HTML (crawlable; it opens the lesson);
//   - carries a "?" (native <details>) that reveals its short description,
//     which is in the HTML too, closed on arrival.
// On a phone (640 px and under) the lanes become one vertical path.
// Server-rendered; no client code.
import Link from "next/link";
import { lessonsByCategory } from "./all-lessons";

export type MapNode = { href: string; title: string; summary: string };
export type MapLane = { id: string; label: string; tone: string; nodes: MapNode[] };

/**
 * The standalone guides (titles and lines as the old cards had them). "How to
 * Identify Stock Trends" was also listed here, but it is a Basics lesson: the
 * path visits it once, there.
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

/** The path, in order: the existing sections, each in its existing colour. */
export function learnLanes(): MapLane[] {
  return [
    { id: "basics", label: "Basics", tone: "#93c5fd", nodes: lessons("Basics") },
    { id: "indicators", label: "Indicators", tone: "#d8b4fe", nodes: lessons("Indicators") },
    { id: "divergencies", label: "Divergencies", tone: "#fde047", nodes: lessons("Divergencies") },
    { id: "financial", label: "How to read financial data", tone: "#5eead4", nodes: lessons("Fundamentals") },
    { id: "guides", label: "In-depth guides", tone: "#86efac", nodes: IN_DEPTH_GUIDES },
    { id: "risk", label: "Risk management", tone: "#86efac", nodes: RISK_GUIDES },
  ];
}

export default function LearnMap({ lanes = learnLanes() }: { lanes?: MapLane[] }) {
  let step = 0;
  return (
    <nav className="lmMap" aria-label="Learning path" data-learn-map="">
      <ol className="lmLanes">
        {lanes.map((lane) => (
          <li key={lane.id} className="lmLane" data-lane={lane.id} style={{ ["--lm-tone" as string]: lane.tone }}>
            <h2 className="lmLaneLabel">{lane.label}</h2>
            <ol className="lmNodes">
              {lane.nodes.map((n) => {
                step++;
                return (
                  <li key={n.href} className="lmNode" data-step={step}>
                    <Link href={n.href} className="lmLink">{n.title}</Link>
                    <details className="lmQ">
                      <summary aria-label={`What is “${n.title}” about?`} title="What is this?">?</summary>
                      <p className="lmTip">{n.summary}</p>
                    </details>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
      <style>{LEARN_MAP_CSS}</style>
      {/* An open note near the edge is nudged back on screen (progressive: without it the note still opens). */}
      <script dangerouslySetInnerHTML={{ __html: LEARN_MAP_NUDGE }} />
    </nav>
  );
}

/** Keep an open "?" note inside the viewport: shift it left by however far it runs past the right edge, or right past the left. */
export const LEARN_MAP_NUDGE = `document.addEventListener("toggle",function(e){var d=e.target;if(!d||!d.classList||!d.classList.contains("lmQ")||!d.open)return;var p=d.querySelector(".lmTip");if(!p)return;p.style.marginLeft="";var r=p.getBoundingClientRect(),w=document.documentElement.clientWidth,m=8;if(r.right>w-m)p.style.marginLeft=(w-m-r.right)+"px";else if(r.left<m)p.style.marginLeft=(m-r.left)+"px";},true);`;

// The path: each lane's nodes sit on a line in the lane's colour; a vertical
// line on the left joins one lane to the next. On a phone every node stacks on
// that left line, so the whole path reads top to bottom.
export const LEARN_MAP_CSS = `
.lmMap{margin-top:22px;}
.lmLanes,.lmNodes{list-style:none;margin:0;padding:0;}
.lmLanes{position:relative;display:grid;gap:22px;padding-left:22px;}
.lmLanes::before{content:"";position:absolute;left:6px;top:10px;bottom:10px;width:2px;background:linear-gradient(180deg,#93c5fd,#d8b4fe,#fde047,#5eead4,#86efac);opacity:.45;border-radius:2px;}
.lmLane{position:relative;min-width:0;}
.lmLane::before{content:"";position:absolute;left:-21px;top:6px;width:12px;height:12px;border-radius:50%;background:#06080d;border:2px solid var(--lm-tone);box-sizing:border-box;}
.lmLaneLabel{margin:0 0 10px;font-size:var(--fs-label);font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:var(--lm-tone);}
.lmNodes{position:relative;display:flex;flex-wrap:wrap;gap:12px 10px;align-items:center;}
.lmNode{position:relative;display:inline-flex;align-items:center;gap:6px;padding:7px 8px 7px 14px;border-radius:999px;border:1px solid rgba(148,163,184,0.24);background:#0b1220;min-width:0;max-width:100%;}
.lmNode::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--lm-tone);flex:0 0 auto;}
.lmNode+.lmNode::after{content:"";position:absolute;right:100%;top:50%;width:10px;height:2px;background:var(--lm-tone);opacity:.6;}
.lmLink{color:#f1f5f9;text-decoration:none;font-weight:800;font-size:var(--fs-read);line-height:1.3;min-width:0;}
.lmLink:hover,.lmLink:focus-visible{text-decoration:underline;}
.lmQ{position:static;}
.lmQ>summary{list-style:none;display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;border:1px solid rgba(148,163,184,0.4);color:#cbd5e1;font-size:var(--fs-label);font-weight:900;cursor:pointer;}
.lmQ>summary::-webkit-details-marker{display:none;}
.lmQ[open]>summary{background:var(--lm-tone);color:#06080d;border-color:var(--lm-tone);}
.lmTip{position:absolute;z-index:5;left:0;top:calc(100% + 6px);width:min(300px,80vw);margin:0;padding:10px 12px;border-radius:12px;border:1px solid rgba(148,163,184,0.3);background:#0f1624;color:#cbd5e1;font-size:var(--fs-read);line-height:1.5;box-shadow:0 12px 28px rgba(0,0,0,.45);}
@media(max-width:640px){
.lmNodes{display:grid;gap:8px;}
.lmNode{display:flex;border-radius:12px;}
.lmNode+.lmNode::after{right:auto;left:-12px;top:-9px;width:2px;height:10px;}
.lmLink{flex:1 1 auto;}
.lmTip{position:static;width:auto;margin-top:6px;box-shadow:none;}
.lmQ[open]{flex-basis:100%;}
.lmNode:has(.lmQ[open]){flex-wrap:wrap;}
}
`;
