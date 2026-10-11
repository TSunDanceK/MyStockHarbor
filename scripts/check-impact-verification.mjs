// IMPACT.COM SITE VERIFICATION (#563 COWORK #167).
//
// The root layout (app/layout.tsx) wraps every page, "/" included, and its
// <head> must carry
//   <meta name="impact-site-verification" value="9aa5dfcb-1339-4383-b1e8-7c2ac0ab674b">
// with the attribute `value`, which is what Impact reads. Next's metadata.other
// would render `content=` instead, so a mutant that switches the tag to
// `content=` (or drops it, or changes the ID) must be caught.
//
// BOTH TAGS STAY (#563 COWORK #170/#171): the older entry in the metadata
// object, other["impact-site-verification"] = cfd647ce…, which Next renders
// as content=, is kept beside the raw value= tag. Dropping either one, or
// changing the old ID, must be caught too.
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
/** The older ID, as it stood in app/layout.tsx before #838 (copied from git history, not retyped). */
const OLD_ID = "cfd647ce-ddd8-4f2a-921f-3763ef298b2a";
const src = fs.readFileSync(LAYOUT, "utf8");

let seq = 0;
/** The verification tag as the layout's <head> renders it, or "" when it isn't there. */
async function headOf(source) {
  const head = source.slice(source.indexOf("<head>"), source.indexOf("</head>"));
  const tag = head.match(/<meta name="impact-site-verification"[^\n]*?\/>/)?.[0];
  const konst = source.match(/^const IMPACT_SITE_VERIFICATION = "[^"]*";$/m)?.[0];
  if (!tag || !konst || source.indexOf("<head>") < 0) return "";
  const file = path.join("app", `.check-impact-${process.pid}-${seq++}.tsx`);
  fs.writeFileSync(file, `${konst}\nexport default function Tag() { return (${tag}); }\n`);
  try {
    const mod = await import(pathToFileURL(path.resolve(file)).href);
    return renderToStaticMarkup(React.createElement(mod.default));
  } finally { fs.rmSync(file, { force: true }); }
}

/** The older tag: the metadata object's other["impact-site-verification"] = OLD_ID (rendered by Next as content=). */
const oldTag = (source) => {
  const code = stripComments(source, { file: LAYOUT });
  const meta = code.slice(code.indexOf("export const metadata"), code.indexOf("export default"));
  return new RegExp(`\\bother: \\{\\s*"impact-site-verification": "${OLD_ID}",?\\s*\\}`).test(meta);
};
/** The newer tag: the raw <meta ... value="ID"> in <head>, rendered once, never as content=. */
const newTag = (head) => {
  const tags = head.match(/<meta name="impact-site-verification"[^>]*>/g) ?? [];
  return tags.length === 1 && new RegExp(`^<meta name="impact-site-verification" value="${ID}"/?>$`).test(tags[0]) && !/content=/.test(tags[0]);
};
const rule = (head, source = src) => oldTag(source) && newTag(head);

let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };

const head = await headOf(src);
check(`the older tag stays: metadata other["impact-site-verification"] = "${OLD_ID}" (rendered as content=)`, oldTag(src));
check(`the newer tag: the layout's <head> carries <meta name="impact-site-verification" value="${ID}"> (value=, not content=)`, newTag(head));
for (const [label, from, to] of [
  ["the tag rendered with content= (the metadata API's form)", "{...{ value: IMPACT_SITE_VERIFICATION }}", "content={IMPACT_SITE_VERIFICATION}"],
  ["the tag dropped", '<meta name="impact-site-verification" {...{ value: IMPACT_SITE_VERIFICATION }} />', ""],
  ["the wrong ID", 'const IMPACT_SITE_VERIFICATION = "9aa5dfcb', 'const IMPACT_SITE_VERIFICATION = "0aa5dfcb'],
  ["the older tag dropped", '    "impact-site-verification": "cfd647ce-ddd8-4f2a-921f-3763ef298b2a",\n', ""],
  ["the older tag's ID changed", '"impact-site-verification": "cfd647ce-', '"impact-site-verification": "0fd647ce-'],
]) {
  if (!src.includes(from)) { check(`mutant "${label}" applies`, false); continue; }
  let ok;
  const m = src.replace(from, to);
  try { ok = rule(await headOf(m), m); } catch { ok = false; }
  check(`mutant "${label}" is caught`, !ok);
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
