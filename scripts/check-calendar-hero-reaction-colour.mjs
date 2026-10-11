// THE CALENDAR HERO AND THE REACTION CAPTION'S COLOUR (#552 COWORK #202 items 1–2).
//   1. /earnings-calendar's top card carries a library image (both sizes on
//      disk) under a dark shade, in its OWN clipped layer: the card itself is
//      never overflow:hidden, or the ticker search's dropdown would be cut off.
//   2. The slider caption colours ONLY the stock's %: a direction attribute on
//      that figure, judged on the printed figure (0.0% is flat), coloured from
//      the shared toneColor; the S&P span carries no direction and no colour.
// Plus mutations of the direction rule, each caught.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("1. the calendar hero");
{
  const src = fs.readFileSync("app/earnings-calendar/page.tsx", "utf8");
  const imgs = [...src.matchAll(/\/news-art\/([a-z0-9-]+\.webp)/g)].map((m) => m[1]);
  check("it names library art, both sizes", imgs.includes("any-earnings-02.webp") && imgs.includes("any-earnings-02-sm.webp"), imgs.join(","));
  check("every named file exists", imgs.length > 0 && imgs.every((f) => fs.existsSync(`public/news-art/${f}`)));
  check("the image sits in its own layer, with a shade", /className="earnCalHero"[\s\S]{0,700}className="earnCalHeroShade"/.test(src));
  const card = (src.match(/\.earnCalIntroCard \{[^}]*\}/) ?? [""])[0];
  check("the card itself is not overflow:hidden (the search dropdown must not clip)", card.length > 0 && !/overflow\s*:\s*hidden/.test(card), card.slice(0, 80));
  check("the layer clips and sits behind the text; the card (z 2) keeps the search dropdown above later sections", /\.earnCalHero \{[^}]*overflow: hidden[^}]*\}/.test(src) && /\.earnCalHero \{[^}]*z-index: -1/.test(src) && /\.earnCalIntroCard \{[^}]*position: relative; z-index: 2;/.test(src));
  check("decorative: empty alt, hidden from assistive tech", /className="earnCalHero" aria-hidden="true"/.test(src) && /earnCalHeroImg"[\s\S]{0,400}alt=""/.test(src));
}

console.log("\n2. the reaction caption");
const slider = fs.readFileSync("app/stock/[symbol]/earnings/ReactionDaySlider.tsx", "utf8");
const page = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
{
  check("the stock's % carries a direction", /<span className="rdsPct" data-dir=\{dayDir\(v\)\}>\{dayPctText\(v\)\}<\/span>/.test(slider));
  check("the S&P span carries none", /<span className="rdsMarket">[^<]*\{dayPctText\(m\)\}<\/span>/.test(slider) && !/rdsMarket"[^>]*data-dir/.test(slider));
  check("the page colours it from the shared tones", /\.rdsPct\[data-dir="up"\] \{ color: \$\{toneColor\("good"\)\}; \}/.test(page) && /\.rdsPct\[data-dir="down"\] \{ color: \$\{toneColor\("weak"\)\}; \}/.test(page));
  check("nothing colours the S&P figure", !/\.rdsMarket[^{]*\{[^}]*toneColor/.test(page));
  check("the sign is kept", /const dayPctText = \(v: number\) => `\$\{v >= 0 \? "\+" : ""\}/.test(slider));
}

console.log("\n3. the direction rule, on the printed figure");
const body = (slider.match(/const dayDir = (\(v: number\)[^;]*?=> \{[\s\S]*?\n\};)/) ?? [])[1];
const lift = (src) => new Function(`return ${src.replace(/\(v: number\): "up" \| "down" \| "flat"/, "(v)").replace(/;$/, "")}`)();
if (!body) check("dayDir found", false);
else {
  const dayDir = lift(body);
  const cases = [[3.04, "up"], [-3.0, "down"], [0.04, "flat"], [-0.04, "flat"], [0, "flat"], [0.05, "up"], [-0.05, "down"]];
  for (const [v, want] of cases) check(`${v} → ${want}`, dayDir(v) === want, String(dayDir(v)));
  const mutant = (from, to, probe) => {
    if (!body.includes(from)) { check(`mutant "${from}" applies`, false); return; }
    let held; try { held = probe(lift(body.replace(from, to))); } catch { held = false; }
    check(`mutant caught: ${from} → ${to}`, !held);
  };
  mutant("Number(v.toFixed(1))", "v", (f) => f(0.04) === "flat");
  mutant('shown > 0 ? "up"', 'shown >= 0 ? "up"', (f) => f(0) === "flat");
  mutant('shown < 0 ? "down"', 'shown < -1 ? "down"', (f) => f(-0.5) === "down");
}

console.log(failures === 0 ? "\ncalendar-hero-reaction-colour: all checks passed" : `\ncalendar-hero-reaction-colour: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
