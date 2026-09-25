// PRINT NAMED SYMBOLS' STORED FACT SETS AS JSON, for a local render fixture
// (#552 COWORK #47 before/after). SEC values only. Reads only.
//   relay task: write-factset-dump   Redis cost: 1 MGET.
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const FACTS = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? [])[1];
const syms = (process.env.SYMBOLS || "AXTI,SPCX").split(",").filter(Boolean).slice(0, 5);
const sets = await redis.mget(...syms.map((s) => `${FACTS}:${s}`));
syms.forEach((s, i) => console.log(`SET ${s} ${sets[i] ? JSON.stringify(sets[i]) : "none"}`));
console.log("Redis commands: 1");
