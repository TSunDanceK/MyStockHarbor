// THE "VIDEO BREAKDOWNS" 404 (#563 COWORK #70): a video the site itself links to
// must always render.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. The page 404s on an id the latest-videos list in the same render holds,
//      because the by-id read came back null (hourly budget spent, no
//      last-known-good copy for a brand-new video) and there is no article on
//      disk yet. ISR then caches the 404 for 30 minutes.
//   2. The header links to an id that list doesn't hold: the header read a
//      different limit, i.e. a different 24-hour cache entry.
//   3. The opposite error: an id no source knows rendering instead of a 404.
//
// The page is a Next server component and isn't rendered here; the rule it
// follows is lib/videoResolve.ts, driven directly, and both the metadata and
// the body are checked to use it (and only it) before notFound().
//
//   node scripts/check-video-404.mjs
import fs from "node:fs";
import ts from "typescript";
import { stripComments } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const RESOLVE = "lib/videoResolve.ts";
const PAGE = "app/insights/videos/[videoId]/page.tsx";
const LAYOUT = "app/layout.tsx";

async function load(src = fs.readFileSync(RESOLVE, "utf8")) {
  // toFallbackVideo stubbed: it builds a video from disk content (lib/videoContent.ts, unchanged).
  const unit = `const toFallbackVideo = (c) => ({ id: c.youtubeId, title: c.title, embedUrl: "disk:" + c.youtubeId });\n` +
    src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
  const js = ts.transpileModule(unit, { fileName: "r.ts", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

const NEW = { id: "s1qy20T2mSY", title: "Newest video", embedUrl: "https://www.youtube-nocookie.com/embed/s1qy20T2mSY" };
const LIST = [NEW, { id: "older1", title: "Older", embedUrl: "e" }];
const DISK = { youtubeId: "ondisk", title: "On disk" };

const rules = {
  "the newest video: by-id null, no article, in the list in hand → rendered with its title and embed": (M) => {
    const v = M.resolveVideo("s1qy20T2mSY", null, LIST, null);
    return v?.title === "Newest video" && v.embedUrl.endsWith("/embed/s1qy20T2mSY");
  },
  "an id no source knows → null, so the page 404s": (M) => M.resolveVideo("nope", null, LIST, null) === null,
  "the API's copy wins, then the list, then the disk": (M) =>
    M.resolveVideo("s1qy20T2mSY", { id: "s1qy20T2mSY", title: "API" }, LIST, DISK)?.title === "API" &&
    M.resolveVideo("ondisk", null, LIST, DISK)?.embedUrl === "disk:ondisk" &&
    M.resolveVideo("older1", null, LIST, DISK)?.title === "Older",
};
const staticRules = {
  "the page body and its metadata both resolve through the list, and 404 only on null": (_r, page) => {
    const meta = page.slice(page.indexOf("export async function generateMetadata"), page.indexOf("export default async function VideoPage"));
    const body = page.slice(page.indexOf("export default async function VideoPage"));
    const uses = (s) => /getLatestYouTubeVideos\(LATEST_VIDEOS_LIMIT\)/.test(s) && /const video = resolveVideo\(videoId, apiVideo, apiVideos, videoContent\);/.test(s);
    return uses(meta) && uses(body) && /if \(!video\) notFound\(\);/.test(body) && !/toFallbackVideo/.test(page);
  },
  "the header's link comes from the same list (same limit, one cache entry)": (_r, page, layout) =>
    /const \[latestVideo\] = await getLatestYouTubeVideos\(LATEST_VIDEOS_LIMIT\);/.test(layout) &&
    /import \{ LATEST_VIDEOS_LIMIT \} from "@\/lib\/videoResolve";/.test(layout) &&
    !/getLatestYouTubeVideos\(\d+\)/.test(layout) && !/getLatestYouTubeVideos\(\d+\)/.test(page),
};

console.log("\n=== 1. The resolver ===\n");
const M = await load();
for (const [n, r] of Object.entries(rules)) check(n, r(M));
console.log("\n=== 2. Static rules ===\n");
const code = (f) => stripComments(fs.readFileSync(f, "utf8"), { file: f });
const R = code(RESOLVE), P = code(PAGE), Ly = code(LAYOUT);
for (const [n, r] of Object.entries(staticRules)) check(n, r(R, P, Ly));

console.log("\n=== 3. Mutants: each must FAIL its rule ===\n");
const SRC = fs.readFileSync(RESOLVE, "utf8");
const mutants = [
  ["the newest video: by-id null, no article, in the list in hand → rendered with its title and embed", (s) => s.replace(" ?? apiVideos.find((v) => v.id === videoId)", "")],
  ["an id no source knows → null, so the page 404s", (s) => s.replace("apiVideos.find((v) => v.id === videoId)", "apiVideos[0]")],
  ["the API's copy wins, then the list, then the disk", (s) => s.replace("return apiVideo ?? apiVideos.find((v) => v.id === videoId) ?? (videoContent ? toFallbackVideo(videoContent) : null);", "return apiVideos.find((v) => v.id === videoId) ?? apiVideo ?? (videoContent ? toFallbackVideo(videoContent) : null);")],
];
for (const [n, mutate] of mutants) {
  const m = mutate(SRC);
  let bites = false;
  try { bites = !rules[n](await load(m)); } catch { bites = true; }
  check(`mutant bites: ${n}`, m !== SRC && bites, m !== SRC ? "" : "the mutation did not apply");
}
const staticMutants = [
  ["the page body and its metadata both resolve through the list, and 404 only on null", (r, p, l) => [r, p.replace("const video = resolveVideo(videoId, apiVideo, apiVideos, videoContent);\n\n  if (!video) notFound();", "const video = apiVideo;\n\n  if (!video) notFound();"), l]],
  ["the page body and its metadata both resolve through the list, and 404 only on null", (r, p, l) => [r, p.replace("getLatestYouTubeVideos(LATEST_VIDEOS_LIMIT),", "getLatestYouTubeVideos(5),"), l]],
  ["the header's link comes from the same list (same limit, one cache entry)", (r, p, l) => [r, p, l.replace("getLatestYouTubeVideos(LATEST_VIDEOS_LIMIT)", "getLatestYouTubeVideos(1)")]],
];
for (const [n, mutate] of staticMutants) {
  const out = mutate(R, P, Ly);
  const changed = out[1] !== P || out[2] !== Ly;
  check(`mutant bites: ${n}`, changed && !staticRules[n](...out), changed ? "" : "the mutation did not apply");
}
console.log(`\n${failures ? `${failures} FAILED` : "all passed"}\n`);
process.exit(failures ? 1 : 0);
