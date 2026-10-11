// IMPACT.COM SITE VERIFICATION (#563 COWORK #167).
//
// The root layout (app/layout.tsx) wraps every page, "/" included, and its
// <head> must carry
//   <meta name="impact-site-verification" value="9aa5dfcb-1339-4383-b1e8-7c2ac0ab674b">
// with the attribute `value`, which is what Impact reads. Next's metadata.other
// would render `content=` instead, so a mutant that switches the tag to
// `content=` (or drops it, or changes the ID) must be caught.
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

register("./lib/tsx-render-hooks.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const React = await import("react");

const LAYOUT = "app/layout.tsx";
const ID = "9aa5dfcb-1339-4383-b1e8-7c2ac0ab674b";
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

const rule = (head) => {
  const tags = head.match(/<meta name="impact-site-verification"[^>]*>/g) ?? [];
  return tags.length === 1 && new RegExp(`^<meta name="impact-site-verification" value="${ID}"/?>$`).test(tags[0]) && !/content=/.test(tags[0]);
};

let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };

const head = await headOf(src);
check(`the layout's <head> carries <meta name="impact-site-verification" value="${ID}"> (value=, not content=)`, rule(head));
for (const [label, from, to] of [
  ["the tag rendered with content= (the metadata API's form)", "{...{ value: IMPACT_SITE_VERIFICATION }}", "content={IMPACT_SITE_VERIFICATION}"],
  ["the tag dropped", '<meta name="impact-site-verification" {...{ value: IMPACT_SITE_VERIFICATION }} />', ""],
  ["the wrong ID", 'const IMPACT_SITE_VERIFICATION = "9aa5dfcb', 'const IMPACT_SITE_VERIFICATION = "0aa5dfcb'],
]) {
  if (!src.includes(from)) { check(`mutant "${label}" applies`, false); continue; }
  let ok;
  try { ok = rule(await headOf(src.replace(from, to))); } catch { ok = false; }
  check(`mutant "${label}" is caught`, !ok);
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
