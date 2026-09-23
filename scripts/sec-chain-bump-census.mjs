// DOES A CHAIN EDIT ENLARGE THE RE-READ QUEUE? — counted, not argued.
//
// A chain edit moves secChainsHash, and needsReread selects every manifest
// entry whose stored `c` differs from it. Sets ALREADY stale on chains (written
// before the last chain edit on main) are in the queue either way; the edit
// adds exactly the sets that were re-read under MAIN's current chains since
// then. This prints the three populations so the cost of landing an edit now,
// against landing it after the catch-up finishes, is a number.
//
//   main hash    the chains as main ships them: the branch's with the entries
//                named in DROP removed (the edit under review)
//   branch hash  the chains as this branch ships them
//
// Credentialled (Upstash) and READ-ONLY: one GET of the manifest.
//   relay task: write-chain-bump-census
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { lift } from "./lib/earnings-plan.mjs";

const FIELD = process.env.FIELD || "revenue";
const DROP = (process.env.DROP || "RevenueFromContractWithCustomerIncludingAssessedTax").split(",").filter(Boolean);

const F = await lift(fs.readFileSync("lib/server/secFields.ts", "utf8"));
const branchHash = F.secChainsHash();
const field = F.SEC_FIELDS.find((f) => f.key === FIELD);
if (!field || !DROP.every((t) => field.chain.includes(t))) {
  console.error(`FATAL: ${FIELD}'s chain does not contain ${DROP.join(", ")}`); process.exit(2);
}
const shipped = [...field.chain];
field.chain.length = 0; field.chain.push(...shipped.filter((t) => !DROP.includes(t)));
const mainHash = F.secChainsHash();
field.chain.length = 0; field.chain.push(...shipped);
if (mainHash === branchHash) { console.error("FATAL: removing DROP did not move the hash"); process.exit(2); }

const manifestKey = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_MANIFEST_KEY = "([^"]+)"/) ?? [])[1];
const manifest = await new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN,
}).get(manifestKey);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }

const tally = { branch: [], main: [], older: [], absent: [], noSet: [] };
for (const [sym, e] of Object.entries(manifest.symbols)) {
  if (!e?.cik) continue;
  if (e.contentHash == null) { tally.noSet.push(sym); continue; }
  const c = e.c ?? null;
  if (c === null) tally.absent.push(sym);
  else if (c === branchHash) tally.branch.push(sym);
  else if (c === mainHash) tally.main.push(sym);
  else tally.older.push(sym);
}
const stored = tally.branch.length + tally.main.length + tally.older.length + tally.absent.length;
console.log(`main chains hash ${mainHash} · branch chains hash ${branchHash}`);
console.log(`stored sets with a CIK: ${stored} (no stored set yet: ${tally.noSet.length})`);
console.log(`  already stale on chains, queued either way: ${tally.older.length + tally.absent.length}` +
  ` (older hash ${tally.older.length}, no c recorded ${tally.absent.length})`);
console.log(`  current under MAIN's chains — the edit re-queues these: ${tally.main.length}`);
if (tally.main.length) console.log(`    ${tally.main.slice(0, 60).join(" ")}${tally.main.length > 60 ? " …" : ""}`);
console.log(`  already on the BRANCH's chains: ${tally.branch.length}`);
console.log(tally.main.length === 0
  ? "\n>> The edit adds nothing to the queue: every stored set is already chain-stale."
  : `\n>> The edit enlarges the chain-stale queue by ${tally.main.length} of ${stored}.`);
