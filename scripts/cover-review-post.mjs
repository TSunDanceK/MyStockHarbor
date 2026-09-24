// POST THE MULTI-CLASS NEEDS-REVIEW LIST ON #552 (#552 COWORK #37, addendum).
//
// Reads the review hash (lib/server/secCoverReview.ts) and each listed
// symbol's stored fact set; DROPS every entry that now has a usable cover or a
// cited map row, so nothing sticks after it is resolved. Posts one comment on
// #552 only when the open list differs from the last one posted in the past
// fortnight (a marker carries its hash). Symbols, classes and reasons only: no
// values, no links. Redis: 2 commands a run (HGETALL, MGET), read-only.
//   node scripts/cover-review-post.mjs [--dry]
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import crypto from "node:crypto";
import { Redis } from "@upstash/redis";

const dry = process.argv.includes("--dry");
const ISSUE = 552;
const { coverIsUsable } = await import("../lib/server/secCoverAuto.ts");
const { COVER_SHARES_MAX_AGE_DAYS } = await import("../lib/server/secValuation.ts");
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const HASH = keyOf("lib/server/secCoverReview.ts", "SEC_COVER_REVIEW_HASH");
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const MAP = JSON.parse(fs.readFileSync("data/sec/share-classes.json", "utf8")).entries;

const redis = Redis.fromEnv();
const all = (await redis.hgetall(HASH)) ?? {};
const syms = Object.keys(all).sort();
const sets = syms.length ? await redis.mget(...syms.map((s) => `${FACTS}:${s}`)) : [];
const today = new Date().toISOString().slice(0, 10);
const open = syms.filter((s, i) => !MAP[s] && !coverIsUsable(sets[i]?.cover ?? null, today, COVER_SHARES_MAX_AGE_DAYS));
console.log(`review entries ${syms.length}; still open ${open.length}; Redis commands ${syms.length ? 2 : 1}`);
if (!open.length) process.exit(0);

const lines = open.map((s) => {
  const e = typeof all[s] === "string" ? JSON.parse(all[s]) : all[s];
  return `- ${s}: ${e.why}${e.classes?.length ? ` (${e.classes.join(", ")})` : ""}`;
});
const hash = crypto.createHash("sha1").update(lines.join("\n")).digest("hex").slice(0, 12);
const marker = `<!-- cover-review:${hash} -->`;
const body = [
  "CODE-A (automated) — multi-class share counts needing review",
  "",
  `OWNER: nothing to do unless you want these valued — ${open.length} compan${open.length === 1 ? "y's" : "ies'"} market cap reads "Not available" because the cover states shares per class with no total, no cited map row, and no one-for-one statement in the filing. A person reading each filing can add a data/sec/share-classes.json row by PR.`,
  "",
  ...lines,
  "",
  "Entries clear themselves once a plain total or a map row exists.",
  marker,
].join("\n");
if (dry) { console.log(body); process.exit(0); }

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repo || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required (or pass --dry)");
const gh = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
};
const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
const recent = [];
for (let page = 1; page <= 5; page++) {
  const batch = await gh(`/issues/${ISSUE}/comments?since=${since}&per_page=100&page=${page}`);
  recent.push(...batch);
  if (batch.length < 100) break;
}
if (recent.some((c) => String(c.body ?? "").includes(marker))) {
  console.log("unchanged since the last post; nothing posted");
  process.exit(0);
}
await gh(`/issues/${ISSUE}/comments`, { method: "POST", body: JSON.stringify({ body }) });
console.log(`posted ${open.length} entries on #${ISSUE}`);
