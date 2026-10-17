// THE eTORO BANNERS ARE OUR OWN COPIES, AND THE LINK GOES THROUGH US (#553, 17 Oct).
//
// Hotlinked from eToro's banner server, the banners were hidden by readers' ad
// blockers (they match `med.etoro.com`): the image never loaded and a bare "Ad"
// label was left. The images are now files in public/partners/ (the originals
// from the partner portal, unaltered) and the links are /api/go/etoro-rail and
// /api/go/etoro-insight, which redirect to eToro's tracking links.
//   1. THE FILES: real JPEGs, the exact size the page reserves, byte-for-byte
//      the files supplied (pinned by hash: replacing one is a deliberate edit).
//   2. THE PAGE NAMES NO eTORO HOST: the creatives' image and link are ours.
//   3. THE TRACKING: each route key reaches its own banner id's click link,
//      under the existing real-visitor rule; /api/go is outside the middleware.
//   4. STALENESS: the risk warning is part of the image, so a copy goes stale.
//      Printed as a warning, not a failure, when the copies are over 100 days old.
// Each property is asserted again against a broken copy (the mutants).
import crypto from "node:crypto";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (s, find, repl) => { if (s.split(find).length - 1 !== 1) throw new Error(`mutation anchor not unique: ${find.slice(0, 60)}`); return s.replace(find, repl); };

// The supplied originals. To refresh a banner: save the new file from the portal, update its hash and ETORO_BANNERS_SAVED.
const FILES = [
  { path: "public/partners/etoro-160x600.jpg", width: 160, height: 600, sha256: "65e3d75233b1c8ccaae1d5b1abd78c730a04a90f7846f8b5dad24e17caca81d1" },
  { path: "public/partners/etoro-300x600.jpg", width: 300, height: 600, sha256: "f5987d1aec1a77d47cfc05bf6a8bea03349cd5dcf792c80c951d5c1de487f86c" },
];

/** A JPEG's pixel size from its start-of-frame marker, or null when it is not a JPEG. */
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

console.log("\n1. the files");
for (const f of FILES) {
  const buf = fs.existsSync(f.path) ? fs.readFileSync(f.path) : null;
  const size = buf ? jpegSize(buf) : null;
  check(`${f.path} is a JPEG of ${f.width}x${f.height}`, !!size && size.width === f.width && size.height === f.height, size ? `${size.width}x${size.height}` : "missing or not a JPEG");
  check(`${f.path} is the file that was supplied (hash)`, !!buf && crypto.createHash("sha256").update(buf).digest("hex") === f.sha256);
}
check("MUTATION: a changed file is caught by the hash", crypto.createHash("sha256").update(Buffer.concat([fs.readFileSync(FILES[0].path), Buffer.from([0])])).digest("hex") !== FILES[0].sha256);

console.log("\n2. the page names no eToro host");
const creatives = readCodeOnly("lib/affiliateCreatives.ts");
const rail = creatives.slice(creatives.indexOf("export const ETORO_RAIL"), creatives.indexOf("// TradingView's 160x600"));
const props = [
  ["the screener banner: our image, our link", rail, (s) => /ETORO_RAIL: RailCreative = \{\s*href: "\/api\/go\/etoro-rail",\s*imgSrc: "\/partners\/etoro-160x600\.jpg",\s*width: 160,\s*height: 600,/.test(s),
    (s) => once(s, 'imgSrc: "/partners/etoro-160x600.jpg"', 'imgSrc: "https://med.etoro.com/B21111_A128935_TGet.aspx"')],
  ["the insight banner: our image, our link", rail, (s) => /ETORO_INSIGHT_RAIL: RailCreative = \{\s*href: "\/api\/go\/etoro-insight",\s*imgSrc: "\/partners\/etoro-300x600\.jpg",\s*width: 300,\s*height: 600,/.test(s),
    (s) => once(s, 'href: "/api/go/etoro-insight"', 'href: "https://med.etoro.com/B21003_A128935_TClick.aspx"')],
  ["no creative's image or link is an eToro address", rail, (s) => !/(?:href|imgSrc): "https?:\/\/[^"]*etoro/.test(s),
    (s) => once(s, 'href: "/api/go/etoro-rail"', 'href: "https://med.etoro.com/x"')],
];

console.log("\n3. the tracking, through /api/go");
const route = readCodeOnly("app/api/go/[platform]/route.ts");
const middleware = readCodeOnly("middleware.ts");
props.push(
  ["the tracking links hold both banner ids, and never appear in a creative", creatives, (s) => /ETORO_TRACKING = \{\s*rail: "https:\/\/med\.etoro\.com\/B21111_A128935_TClick\.aspx",\s*insight: "https:\/\/med\.etoro\.com\/B21003_A128935_TClick\.aspx",\s*\} as const;/.test(s),
    (s) => once(s, "B21003_A128935_TClick", "B21111_A128935_TClick")],
  ["/api/go/etoro-rail reaches banner B21111's click link and /api/go/etoro-insight B21003's", route, (s) => /"etoro-rail": ETORO_TRACKING\.rail,\s*"etoro-insight": ETORO_TRACKING\.insight,/.test(s),
    (s) => once(s, '"etoro-insight": ETORO_TRACKING.insight,', '"etoro-insight": ETORO_TRACKING.rail,')],
  ["a request that has not earned the tag still lands on eToro, untagged", route, (s) => /"etoro-rail": "https:\/\/www\.etoro\.com\/",\s*"etoro-insight": "https:\/\/www\.etoro\.com\/",/.test(s),
    (s) => once(s, '"etoro-insight": "https://www.etoro.com/",', "")],
  ["public/partners/ is outside the middleware (no per-request Redis call for an image)", middleware, (s) => /news-art\/\|partners\/\)/.test(s),
    (s) => once(s, "|partners/", "")],
);
for (const [label, src, ok, mutate] of props) {
  check(label, ok(src));
  let broke;
  try { broke = ok(mutate(src)); } catch (e) { check(`MUTATION anchor for: ${label}`, false, e.message); continue; }
  check(`MUTATION: ${label} — broken source is caught`, !broke);
}

console.log("\n4. staleness");
const saved = creatives.match(/ETORO_BANNERS_SAVED = "(\d{4}-\d{2}-\d{2})"/)?.[1];
check("the save date is recorded", !!saved);
const days = saved ? Math.floor((Date.now() - Date.parse(saved)) / 86400000) : null;
if (days !== null && days > 100) console.log(`  WARN  the eToro banners were saved ${days} days ago (${saved}): the risk warning is part of the image. Re-save them from the partner portal, then update ETORO_BANNERS_SAVED and the hashes here.`);
else console.log(`  info  the eToro banners were saved ${saved} (${days} days ago)`);

console.log(failures ? `\n${failures} FAILED` : "\nThe eToro banners hold.");
process.exit(failures ? 1 : 0);
