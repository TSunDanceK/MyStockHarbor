// WHY NO CAP, AND WHY NO REASON (#553 COWORK #191 item 2, CODE-A #199 §4).
// READ-ONLY, ENFORCED (HMGET, HKEYS). For the named symbols: is there a picker
// SEC row, under which spelling, its unit, whether a cover share count is on it,
// and the refusals it carries. Then, over every row: how many have no share
// count AND no refusal (the "no cap, no reason" shape).
//
// PUBLIC LOG: symbols, refusal names, counts. No price, no share count.
//
//   node scripts/cap-reason-census.mjs   (relay: write-cap-reason-census)
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["HMGET", "HKEYS", "HGETALL"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    if (!cmds.length) throw new Error("census is read-only");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`census is read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const all = (await redis.hgetall("msh:pickers:sec-fundamentals:v1")) ?? {};
const NAMED = (process.env.NAMED || "BBVA NMR NVMI BABA RIO AFRM HRL TPG ZM MFG MKC-V RCI GFL").split(/\s+/);
for (const s of NAMED) {
  const spellings = [s, s.replace(/-/g, "."), s.replace(/\./g, "-")];
  const field = spellings.find((x) => all[x] !== undefined);
  if (!field) { console.log(`${s.padEnd(6)} no picker SEC row`); continue; }
  const r = parse(all[field]);
  console.log(`${s.padEnd(6)} row "${field}" · unit ${r.unit?.reporting}${r.unit?.converted ? " (converted)" : ""} · cover shares ${r.inputs?.shares ? `as of ${r.inputs.shares.asOf}` : "none"} · refusals [${(r.inputs?.refusals ?? []).join(", ")}]`);
}
let noShares = 0, noSharesNoReason = 0;
const examples = [];
for (const [f, raw] of Object.entries(all)) {
  const r = parse(raw);
  if (r?.inputs?.shares) continue;
  noShares++;
  if (!(r?.inputs?.refusals ?? []).length) { noSharesNoReason++; if (examples.length < 20) examples.push(f); }
}
console.log(`\nrows ${Object.keys(all).length} · no cover share count ${noShares} · of them with no refusal ${noSharesNoReason}${examples.length ? `: ${examples.join(" ")}` : ""}`);
console.log(`Redis commands ${commands} (read-only)`);
