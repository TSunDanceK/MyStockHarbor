// THE PICKERS UNIVERSE, AS SYMBOLS ONLY (#552 COWORK #37), so a preset's
// membership under the SEC classification can be computed from the shipped
// resolver offline. Symbols only: no price, no value. Reads only.
//   relay task: write-pickers-universe-list
//   Redis cost: 1 GET.
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const u = ((await redis.get(keyOf("lib/server/pickersBuilder.ts", "PICKERS_SYMBOLS_KEY"))) ?? []).map((s) => String(s).toUpperCase()).sort();
console.log(`UNIVERSE ${u.length}`);
for (let i = 0; i < u.length; i += 40) console.log(`U ${u.slice(i, i + 40).join(",")}`);
console.log("Redis commands: 1");
