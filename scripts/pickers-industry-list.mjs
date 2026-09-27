// Which Pickers universe names a preset's industry holds under A's resolver
// (Relay B, #553 COWORK #24: confirm /semiconductor-stocks = A's 29 on #578).
// READ-ONLY. Resolves exactly as scripts/lib/classification-needed.mjs does
// (10-K override -> SIC table -> major group, from the committed files), which
// is lib/server/staticProfile's order with no cache -- #578 passes cached: null.
// The page also drops notes and preferreds (excludeNonEquity); none carries an
// operating industry label here, and any that did would show as an extra name.
//
//   relay task: write-pickers-industry-list   (SYMBOLS = the industry label,
//   default "Semiconductors").  Redis: 1 GET, once.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { resolveTaxonomy } from "./lib/classification-needed.mjs";

const industry = (process.env.SYMBOLS || process.argv[2] || "Semiconductors").trim();
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const data = {
  overrides: read("data/sec/classification-overrides.json").overrides ?? {},
  registrants: read("data/sec/registrants.json").rows ?? {},
  classification: read("data/sec/sic-classification.json"),
};
const redis = Redis.fromEnv();
const raw = await redis.get("msh:pickers:v10:symbols");
const list = Array.isArray(raw) ? raw : Array.isArray(raw?.symbols) ? raw.symbols : [];
const universe = [...new Set(list.map((x) => String(typeof x === "string" ? x : x?.symbol ?? "").toUpperCase()).filter(Boolean))];
const hits = universe.filter((s) => resolveTaxonomy(s, data).industry === industry).sort();
console.log(`universe ${universe.length}; industry "${industry}": ${hits.length}`);
console.log(hits.join(", "));
console.log("Redis commands: 1 (read-only)");
