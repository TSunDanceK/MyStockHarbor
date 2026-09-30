// "Classification needed": open, update or close ONE issue listing the Pickers
// universe symbols A's resolver cannot fully place, plus A's SIC-change
// notices (Relay B, #553 COWORK #3). Runs daily from
// .github/workflows/classification-needed.yml.
//
// NEVER WRITES data/sec/classification-overrides.json -- the owner approves a
// row and it lands by PR. The issue body carries no links, tokens or
// credentials (public repo; see cell() in scripts/lib/classification-needed.mjs).
//
// REDIS: 4 commands a run, all reads -- GET msh:pickers:v10:symbols (the
// Pickers universe), HGETALL msh:sec:sic-changes:v1 (A's notices), GET
// msh:universe:sec-changes:v1 (the delisting sweep's ticker changes, #553
// COWORK #22) and HGETALL msh:sec:succession-flags:v1 (A's possible
// holding-company successions, #553 COWORK #44 -- shown as flags, never
// linked). Daily, so 4 a day. The Actions secret is Upstash's read-only token.
//
//   node scripts/classification-needed.mjs            (writes the issue)
//   node scripts/classification-needed.mjs --dry      (prints the body only)
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { ISSUE_TITLE, buildRows, citedPredecessors, issueAction, issueBody, listingLines, successionLines } from "./lib/classification-needed.mjs";

const dry = process.argv.includes("--dry");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const data = {
  overrides: read("data/sec/classification-overrides.json").overrides ?? {},
  registrants: read("data/sec/registrants.json").rows ?? {},
  classification: read("data/sec/sic-classification.json"),
  descriptions: read("data/sec/descriptions.json").rows ?? {},
  names: read("data/company-names.json").rows ?? {},
};

const redis = Redis.fromEnv();
const raw = await redis.get("msh:pickers:v10:symbols");
const list = Array.isArray(raw) ? raw : Array.isArray(raw?.symbols) ? raw.symbols : null;
if (!list?.length) throw new Error("the Pickers universe (msh:pickers:v10:symbols) is empty or unreadable -- refusing to close the issue on no data");
const universe = [...new Set(list.map((x) => String(typeof x === "string" ? x : x?.symbol ?? "").trim().toUpperCase()).filter(Boolean))];
const notices = (await redis.hgetall("msh:sec:sic-changes:v1")) ?? {};
// The delisting sweep's ticker changes (#553 COWORK #22): information lines.
const LISTING_CHANGES_KEY = "msh:universe:sec-changes:v1";
const changeLog = await redis.get(LISTING_CHANGES_KEY);
// A's possible successions (lib/server/secSuccessionFlags.ts): flags only.
const SUCCESSION_FLAGS_KEY = "msh:sec:succession-flags:v1";
const successionFlags = (await redis.hgetall(SUCCESSION_FLAGS_KEY)) ?? {};
const succession = successionLines(successionFlags, citedPredecessors(read("data/sec/successor-ciks.json")));

const rows = buildRows(universe, data, notices);
const asOf = new Date().toISOString().slice(0, 10);
const listing = listingLines(changeLog, asOf);
const body = issueBody(rows, asOf, universe.length, listing, succession);
console.log(`universe ${universe.length}; unplaced ${rows.missing.length}; SIC-change notices ${rows.changed.length}; ticker changes ${listing.length}; possible successions ${succession.length}; Redis commands 4`);

if (dry) {
  console.log(body ?? "(nothing to classify -- the issue would be closed)");
  process.exit(0);
}

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

// The one open issue with exactly this title (issues only, not PRs).
let existing = null;
for (let page = 1; page <= 5 && !existing; page++) {
  const batch = await gh(`/issues?state=open&per_page=100&page=${page}`);
  existing = batch.find((i) => !i.pull_request && i.title === ISSUE_TITLE) ?? null;
  if (batch.length < 100) break;
}
const action = issueAction(existing, body);
if (action.kind === "create") await gh(`/issues`, { method: "POST", body: JSON.stringify({ title: ISSUE_TITLE, body }) });
if (action.kind === "update") await gh(`/issues/${existing.number}`, { method: "PATCH", body: JSON.stringify({ body }) });
if (action.kind === "close") {
  await gh(`/issues/${existing.number}`, {
    method: "PATCH",
    body: JSON.stringify({ body: `Nothing needs classification as of ${asOf}: every Pickers universe symbol has a sector and an industry, and there are no SIC-change notices, ticker changes or possible successions.`, state: "closed", state_reason: "completed" }),
  });
}
console.log(`issue: ${action.kind}${existing ? ` #${existing.number}` : ""}`);
