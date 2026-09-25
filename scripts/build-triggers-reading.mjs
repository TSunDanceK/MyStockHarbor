// Who triggers full Pickers builds (#544 attribution; #553 COWORK #51 item 2).
// Read-only. For each of the last 8 UTC days: the attribution hash
// (env|phase|entry|reason -> builds) beside the meter's
// history-bulk:pickers-build reads for the same day.
//
//   relay task: write-build-triggers-reading
//   Redis: 8 HGETALL + 8 HMGET = 16 commands, once.
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
let commands = 0;
for (let i = 7; i >= 0; i--) {
  const d = new Date(Date.now() - i * 86_400_000);
  const iso = d.toISOString().slice(0, 10);
  const trig = (await redis.hgetall(`msh:pickers-build-triggers:v1:${iso}`)) ?? {};
  commands++;
  const F = ["history-bulk:pickers-build:reads", "history-bulk:pickers-build:units"];
  const got = (await redis.hmget(`msh:redis-units:v1:${iso.replace(/-/g, "")}`, ...F)) ?? {};
  const [reads, units] = Array.isArray(got) ? got : F.map((f) => got[f]);
  commands++;
  const rows = Object.entries(trig).sort((a, b) => Number(b[1]) - Number(a[1]));
  const total = rows.reduce((a, [, n]) => a + Number(n), 0);
  console.log(`${iso}: attributed builds ${total}; meter pickers-build reads ${reads ?? "—"} (units ${units ?? "—"})`);
  for (const [k, n] of rows) console.log(`   ${String(n).padStart(4)}  ${k}`);
}
console.log(`Redis commands: ${commands} (read-only)`);
