// READ-ONLY (Relay C, #563 COWORK #12): print the capex page's three stored
// records, so the page can be rendered and screenshotted locally against the
// exact data production shows. 3 GETs, no writes.
//   relay task: write-capex-records-dump (credentialled only to read the store)
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const keys = ["msh:capex:spending:v1", "msh:capex:receivers:v1", "msh:capex:contracts:v1"];
const values = await redis.mget(...keys);
for (let i = 0; i < keys.length; i++) {
  console.log(`=== ${keys[i]} ${values[i] ? JSON.stringify(values[i]).length : 0} bytes`);
  console.log(JSON.stringify(values[i]));
}
console.log("Redis commands: 1 MGET (3 keys), 0 writes.");
