// THE eTORO BANNER ON AN INSIGHT POST (#553, owner request 16 Oct): one 160x600
// banner at the foot of the right-hand column, under the sector card, with the
// same consent and region rules as the rest of the partner ads. Each property is
// asserted against the shipped source and again against a broken copy.
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const page = readCodeOnly("app/insights/[slug]/InsightPage.tsx");
const ad = readCodeOnly("app/components/InsightRailAd.tsx");
const creatives = readCodeOnly("lib/affiliateCreatives.ts");
const once = (src, find, repl) => { if (src.split(find).length - 1 !== 1) throw new Error(`mutation anchor not unique: ${find.slice(0, 50)}`); return src.replace(find, repl); };
const props = [
  ["the banner is the last thing in the right-hand rail, after the sector card", page,
    (s) => /<aside className="inRail">[\s\S]*d\.sectorMove \? \([\s\S]*<InsightRailAd creative=\{ETORO_INSIGHT_RAIL\} \/>\s*<\/aside>/.test(s),
    (s) => once(s, "<InsightRailAd creative={ETORO_INSIGHT_RAIL} />", "")],
  ["it is the banner the owner supplied (B21002), a click link over its image", creatives,
    (s) => /ETORO_INSIGHT_RAIL[\s\S]{0,200}href: "https:\/\/med\.etoro\.com\/B21002_A128935_TClick\.aspx"[\s\S]{0,100}imgSrc: "https:\/\/med\.etoro\.com\/B21002_A128935_TGet\.aspx"[\s\S]{0,60}width: 160,\s*height: 600/.test(s),
    (s) => once(s, "B21002_A128935_TClick", "B21111_A128935_TClick")],
  ["it shows only after Accept in the UK / EU / EEA (usePartnerAds), else renders nothing", ad,
    (s) => /const show = usePartnerAds\(TWO_COLUMNS_FROM\);\s*if \(!show\) return null;/.test(s),
    (s) => once(s, "if (!show) return null;", "")],
  ["it only shows while the page is two columns wide (the 900px collapse)", ad,
    (s) => /TWO_COLUMNS_FROM = 901/.test(s),
    (s) => once(s, "TWO_COLUMNS_FROM = 901", "TWO_COLUMNS_FROM = 0")],
  ["it is labelled Ad, and its link is rel=sponsored via the shared PartnerImage", ad,
    (s) => /<div style=\{AD_LABEL_STYLE\}>Ad<\/div>\s*<PartnerImage c=\{creative\} \/>/.test(s),
    (s) => once(s, "<div style={AD_LABEL_STYLE}>Ad</div>", "")],
];
for (const [label, src, ok, mutate] of props) {
  check(label, ok(src));
  let broke;
  try { broke = ok(mutate(src)); } catch (e) { check(`MUTATION anchor for: ${label}`, false, e.message); continue; }
  check(`MUTATION: ${label} — broken source is caught`, !broke);
}
const rail = readCodeOnly("app/components/AffiliateRail.tsx");
check("the shared PartnerImage link is rel=\"sponsored noopener noreferrer\"", /rel="sponsored noopener noreferrer"/.test(rail));
console.log(failures ? `\n${failures} FAILED` : "\nThe insight banner holds.");
process.exit(failures ? 1 : 0);
