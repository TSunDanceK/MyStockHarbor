// Prints stored sets as gzip+base64 chunks so a check can pin real filers
// (#535 COWORK #23: WKHS, AUR, BYND, NBIS). Read-only.
import zlib from "node:zlib";
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();
for (const s of (process.env.SYMBOLS || "WKHS AUR BYND NBIS").split(/\s+/).filter(Boolean)) {
  const set = await redis.get(`msh:sec:facts:v1:${s}`);
  if (!set) { console.log(`FIXTURE ${s} MISSING`); continue; }
  const b = zlib.gzipSync(Buffer.from(JSON.stringify(set))).toString("base64");
  const parts = b.match(/.{1,900}/g);
  parts.forEach((p, i) => console.log(`FX|${s}|${i}|${parts.length}|${p}`));
}
