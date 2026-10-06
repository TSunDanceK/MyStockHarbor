// THE DUE-STRIP CUT, RE-RANKED FROM THE LIVE STORE (#552 COWORK #185).
//
// READ-ONLY. data/due-strip.json is the forward sections' membership: the
// largest 150 of the analysis universe by market cap, frozen in the repo so a
// page build never pays a read for it. This prints that ranking again, from
// the same inputs the committed file names in its `source`:
//
//   market cap = cover-page shares (PICKERS_SEC_KEY, inputs.shares.val)
//              × Tiingo close (TIINGO_EOD_LAST_KEY, .c)
//   over every row of PICKERS_SEC_KEY (see FROM below)
//
// and compares it with the committed cut: who enters, who leaves, and every
// name that would rank inside the cut on cap but is missing an input (so a gap
// in shares or closes is named, not silently ranked out -- the WFC/JNJ case).
// The last line, CUT150_JSON, is the new `symbols` array; paste it into the
// file with today's generatedAt. Run: relay task "write-due-strip-rank" (monthly,
// at the first check-in of the month; see the file's _comment).
//
// Commands: 1 GET (universe) or 1 HKEYS (UNIVERSE=sec) + 2 HMGETs. Every other command is refused before
// it leaves.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { toDashed } from "../lib/symbolSpellings.mjs";

const READS = new Set(["get", "hmget", "hkeys"]);
const counts = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    for (const c of Array.isArray(body?.[0]) ? body : [body]) {
      const op = String(c?.[0]).toLowerCase();
      if (!READS.has(op)) throw new Error(`read guard: ${op} refused`);
      counts[op] = (counts[op] ?? 0) + 1;
    }
  }
  return realFetch(input, init);
};

const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const UNIVERSE_KEY = keyOf("lib/server/pickersBuilder.ts", "PICKERS_SYMBOLS_KEY");
const SEC_KEY = keyOf("lib/server/pickersSecFundamentals.ts", "PICKERS_SEC_KEY");
const TIINGO_PREFIX = keyOf("lib/server/marketData/keys.ts", "TIINGO_PREFIX");
const EOD_KEY = TIINGO_PREFIX ? `${TIINGO_PREFIX}eod-last:v1` : null;
if (!UNIVERSE_KEY || !SEC_KEY || !EOD_KEY) { console.error("FATAL: a store key moved"); process.exit(2); }
if (!/TIINGO_EOD_LAST_KEY = `\$\{TIINGO_PREFIX\}eod-last:v1`/.test(fs.readFileSync("lib/server/marketData/keys.ts", "utf8"))) {
  console.error("FATAL: TIINGO_EOD_LAST_KEY changed shape"); process.exit(2);
}

const CUT = Number(process.env.CUT || 150);
const NAMED = (process.env.NAMED || "WFC JNJ JPM BAC GS MS V").split(/\s+/).filter(Boolean);
const redis = Redis.fromEnv();
const dashed = toDashed;
const parse = (v) => { if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } } return v ?? null; };

// THE RULE (#552 COWORK #185): every symbol with a row in the SEC hash -- every
// company we hold cover-page shares for. The analysis universe (685 symbols)
// left out WFC, JNJ and MS entirely, which is how WFC missed the calendar
// while clearing the bar. UNIVERSE=pickers measures the old rule.
const FROM = process.env.UNIVERSE === "pickers" ? "pickers" : "sec";
const universe = FROM === "sec" ? await redis.hkeys(SEC_KEY) : await redis.get(UNIVERSE_KEY);
if (!Array.isArray(universe) || !universe.length) { console.error("FATAL: no universe list"); process.exit(2); }
const fields = [...new Set(universe.map(dashed))];
console.log(`ranking over: ${FROM === "sec" ? "every row of the SEC hash" : "the analysis universe"}`);
const secRaw = await redis.hmget(SEC_KEY, ...fields);
const eodRaw = await redis.hmget(EOD_KEY, ...fields);
const at = (raw, f, i) => parse(Array.isArray(raw) ? raw[i] : raw?.[f]);

const rows = fields.map((f, i) => {
  const shares = Number(at(secRaw, f, i)?.inputs?.shares?.val);
  const close = Number(at(eodRaw, f, i)?.c);
  return { f, shares: shares > 0 ? shares : null, close: close > 0 ? close : null };
});
const ranked = rows.filter((r) => r.shares && r.close).map((r) => ({ ...r, cap: r.shares * r.close })).sort((a, b) => b.cap - a.cap);
const rankOf = new Map(ranked.map((r, i) => [r.f, i + 1]));

const doc = JSON.parse(fs.readFileSync("data/due-strip.json", "utf8"));
const committed = doc.symbols;
// KEEP THE COMMITTED SPELLING (BRK.B stays BRK.B); a new entrant keeps the store's.
const spelled = new Map(committed.map((s) => [dashed(s), s]));
const top = ranked.slice(0, CUT).map((r) => spelled.get(r.f) ?? r.f);
const floor = ranked[CUT - 1]?.cap ?? Infinity;

console.log(`universe ${fields.length} · ranked (shares and close) ${ranked.length} · cut ${CUT} · cap at rank ${CUT}: ${(floor / 1e9).toFixed(1)}B`);
console.log(`committed cut generatedAt ${doc.generatedAt}`);
const enter = top.filter((s) => !committed.includes(s));
const leave = committed.filter((s) => !top.includes(s));
console.log(`\nENTER (${enter.length}): ${enter.map((s) => `${s}#${rankOf.get(dashed(s))}`).join(" ") || "none"}`);
console.log(`LEAVE (${leave.length}): ${leave.map((s) => `${s}${rankOf.has(dashed(s)) ? `#${rankOf.get(dashed(s))}` : " (unranked)"}`).join(" ") || "none"}`);

console.log("\nNAMED:");
for (const s of NAMED) {
  const r = rows.find((x) => x.f === dashed(s));
  console.log(`  ${s.padEnd(6)} ${!r ? "not in the universe" : `shares ${r.shares ? "yes" : "NO"} · close ${r.close ? "yes" : "NO"} · rank ${rankOf.get(r.f) ?? "—"} · in new cut ${top.includes(spelled.get(r.f) ?? r.f) ? "yes" : "no"} · in committed ${committed.some((c) => dashed(c) === r.f) ? "yes" : "no"}`}`);
}

// A NAME MISSING ONE INPUT CANNOT BE RANKED, AND MUST NOT DROP SILENTLY: list
// every committed name now unranked, with which input it lacks.
const unranked = committed.filter((s) => !rankOf.has(dashed(s)));
console.log(`\nCOMMITTED BUT UNRANKED (${unranked.length}): ${unranked.map((s) => {
  const r = rows.find((x) => x.f === dashed(s));
  return `${s}(${!r ? "not in universe" : [!r.shares && "no shares", !r.close && "no close"].filter(Boolean).join("+")})`;
}).join(" ") || "none"}`);
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
console.log(`CUT150_JSON ${JSON.stringify(top)}`);
