// IMPACT.COM SITE VERIFICATION (#563 COWORK #167).
//
// The root layout (app/layout.tsx) wraps every page, "/" included, and its
// <head> must carry
//   <meta name="impact-site-verification" value="9aa5dfcb-1339-4383-b1e8-7c2ac0ab674b">
// with the attribute `value`, which is what Impact reads. Next's metadata.other
// would render `content=` instead, so a mutant that switches the tag to
// `content=` (or drops it, or changes the ID) must be caught.
//
// ONE TAG ONLY (#563 COWORK #184, replacing the #170/#171 "keep both" ruling):
// the older content= entry (metadata.other, the old ID) is gone. The check
// asserts exactly one impact-site-verification tag, the value= one, and that
// the old ID appears nowhere in app/ or lib/; restoring the old entry, or a
// second tag, must be caught.
//
// The layout itself can't be rendered here (next/font only loads inside Next),
// so the check takes the tag's JSX and the ID constant out of the layout's own
// source, confirms the tag sits inside <head>, and renders exactly that JSX with
// React's server renderer: the HTML that comes out is the HTML the page serves.
//
//   node scripts/check-impact-verification.mjs
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/tsx-render-hooks.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const React = await import("react");

const LAYOUT = "app/layout.tsx";
const ID = "9aa5dfcb-1339-4383-b1e8-7c2ac0ab674b";
/** The retired ID: it must not come back anywhere in app/ or lib/ (#184). Split so this file does not match itself. */
const OLD_ID = ["cfd647ce", "ddd8-4f2a-921f-3763ef298b2a"].join("-");
const src = fs.readFileSync(LAYOUT, "utf8");

let seq = 0;
/** The verification tags as the layout's <head> renders them, or "" when there are none. */
async function headOf(source) {
  const head = source.slice(source.indexOf("<head>"), source.indexOf("</head>"));
  // EVERY verification tag in <head>, so a second one is rendered (and counted) too.
  const found = head.match(/<meta name="impact-site-verification"[^>]*?\/>/g);
  const tag = found ? `<>${found.join("")}</>` : null;
  const konst = source.match(/^const IMPACT_SITE_VERIFICATION = "[^"]*";$/m)?.[0];
  if (!tag || !konst || source.indexOf("<head>") < 0) return "";
  const file = path.join("app", `.check-impact-${process.pid}-${seq++}.tsx`);
  fs.writeFileSync(file, `${konst}\nexport default function Tag() { return (${tag}); }\n`);
  try {
    const mod = await import(pathToFileURL(path.resolve(file)).href);
    return renderToStaticMarkup(React.createElement(mod.default));
  } finally { fs.rmSync(file, { force: true }); }
}

/** No Impact entry through the metadata API (it renders content=), and the retired ID nowhere in the app's sources. */
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(tsx?|mjs|js|json)$/.test(e.name) ? [path.join(dir, e.name)] : []));
const noOldTag = (source, files = ["app", "lib"].flatMap(walk).filter((f) => f !== LAYOUT)) => {
  const code = stripComments(source, { file: LAYOUT });
  const meta = code.slice(code.indexOf("export const metadata"), code.indexOf("export default"));
  return !/"impact-site-verification"\s*:/.test(meta) && !source.includes(OLD_ID.slice(0, 8)) && files.every((f) => !fs.readFileSync(f, "utf8").includes(OLD_ID.slice(0, 8)));
};
/** Exactly one tag: the raw <meta ... value="ID"> in <head>, never content=. */
const newTag = (head) => {
  const tags = head.match(/<meta name="impact-site-verification"[^>]*>/g) ?? [];
  return tags.length === 1 && new RegExp(`^<meta name="impact-site-verification" value="${ID}"/?>$`).test(tags[0]) && !/content=/.test(tags[0]);
};
const rule = (head, source = src) => noOldTag(source) && newTag(head);

let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };

const head = await headOf(src);
check(`one tag only: the layout's <head> carries <meta name="impact-site-verification" value="${ID}"> (value=, not content=), and nothing else`, newTag(head));
check(`the retired ${OLD_ID.slice(0, 8)}… tag is gone: no metadata.other entry, the old ID nowhere in app/ or lib/`, noOldTag(src));
for (const [label, from, to] of [
  ["the tag rendered with content= (the metadata API's form)", "{...{ value: IMPACT_SITE_VERIFICATION }}", "content={IMPACT_SITE_VERIFICATION}"],
  ["the tag dropped", '<meta name="impact-site-verification" {...{ value: IMPACT_SITE_VERIFICATION }} />', ""],
  ["the wrong ID", 'const IMPACT_SITE_VERIFICATION = "9aa5dfcb', 'const IMPACT_SITE_VERIFICATION = "0aa5dfcb'],
  ["a second tag in <head>", '<meta name="impact-site-verification" {...{ value: IMPACT_SITE_VERIFICATION }} />', '<><meta name="impact-site-verification" {...{ value: IMPACT_SITE_VERIFICATION }} /><meta name="impact-site-verification" {...{ value: IMPACT_SITE_VERIFICATION }} /></>'],
  ["the old content= entry restored", "    images: [\"https://www.mystockharbor.com/og-image-v2.png\"],\n  },\n};", `    images: ["https://www.mystockharbor.com/og-image-v2.png"],\n  },\n  other: {\n    "impact-site-verification": "${OLD_ID}",\n  },\n};`],
]) {
  if (!src.includes(from)) { check(`mutant "${label}" applies`, false); continue; }
  let ok;
  const m = src.replace(from, to);
  try { ok = rule(await headOf(m), m); } catch { ok = false; }
  check(`mutant "${label}" is caught`, !ok);
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
