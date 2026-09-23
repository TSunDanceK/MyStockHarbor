// Read-only: msh:redis-units:v1 per-hour history-bulk units and per-caller reads,
// for today and yesterday (#535 COWORK #12 item 3, the history-bulk flag).
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();
for (const d of [0, 1, 2]) {
  const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
  const h = (await redis.hgetall(`msh:redis-units:v1:${day}`)) ?? {};
  const hours = Object.entries(h).filter(([k]) => /^history-bulk:h\d\d:units$/.test(k))
    .map(([k, v]) => [k.slice(14, 16), Number(v)]).sort();
  const callers = Object.entries(h).filter(([k]) => /^history-bulk:[^h][^:]*:(reads|units)$/.test(k) || /^history-bulk:h[a-z][^:]*:(reads|units)$/.test(k));
  console.log(day, "hourly history-bulk units:", hours.map(([hh, v]) => `${hh}:${v}`).join(" "));
  console.log(day, "callers:", callers.map(([k, v]) => `${k.slice(13)}=${v}`).join(" "));
}
