// THE RE-READ REQUESTS A LAGGING FEED IS HOLDING OPEN (#552 COWORK #222), for
// the check-in. READS ONLY, despite the write- task prefix (the store read needs
// the credential): 1 GET of the manifest, nothing else. Prints every request
// held open by a kept prior for more than SEC_HELD_OPEN_LIST_DAYS, with
// companyfacts' newest period end against the filed one (`ff`), through the
// SHIPPED heldOpenRequests. With ALL=1, every current hold, however short.
//   relay task: write-held-open-requests
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const R = await import("../lib/server/secRereadRequests.ts");
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const manifest = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
if (!manifest?.symbols) { console.log("no manifest"); process.exit(1); }
const days = process.env.ALL ? -1 : R.SEC_HELD_OPEN_LIST_DAYS;
const rows = R.heldOpenRequests(manifest, R.SEC_REREAD_REQUESTS, Date.now(), days);
const held = Object.values(manifest.symbols).filter((e) => e?.keptOpen).length;
console.log(`held open by a kept prior for more than ${Math.max(days, 0)} days: ${rows.length} (symbols held at all: ${held})`);
for (const r of rows) {
  console.log(`  ${r.symbol.padEnd(6)} ${r.days}d since ${new Date(r.keptSince).toISOString().slice(0, 10)}; requested ${r.requestedAt.slice(0, 10)}; feed newest end ${r.feedEnd ?? "none"} vs ff ${r.ff ?? "none"}`);
}
console.log("\nRedis commands used by this read: 1");
