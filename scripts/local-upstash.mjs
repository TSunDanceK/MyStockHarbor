// A stand-in Upstash, so the render path can be exercised locally.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// `/upcoming-ipos` under IPO_PROVIDER=sec reads `msh:ipo:filings:v1` and
// renders whatever is stored. Verifying that locally needs a Redis, and this
// sandbox has no Upstash credentials and cannot reach the production store --
// so the alternative to this file is "the first time real records meet the
// render path is in production", which is the order this build exists to avoid.
//
// ── IT IS A FIXTURE SERVER, NOT A REDIS ────────────────────────────────────
// It implements exactly what @upstash/redis sends for the commands this page's
// module graph issues: GET, SET, TTL, INCR, EXPIRE, DEL, and /pipeline. Nothing
// persists. Unknown keys answer null, which is the honest shape -- a page
// reading a key nothing has written should behave as it would in production
// against a cold store.
//
// THE POINT IS THE RECORDS, NOT THE SERVER. It is seeded from a real ingest
// document (scripts/ipo-ingest-probe.mjs's output, EDGAR-derived), so what the
// page renders is what the shipped classifier makes of real filings.
//
//   node scripts/local-upstash.mjs <document.json> [port] [sha256]
//
// then, in another shell:
//   UPSTASH_REDIS_REST_URL=http://127.0.0.1:8porting \
//   UPSTASH_REDIS_REST_TOKEN=local \
//   IPO_PROVIDER=sec npm run dev
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";

import "./lib/register-ts-here.mjs";

// DYNAMIC, because the static form is hoisted past the loader registration
// above and ipoSecStore's own `from "./redisCacheMode"` carries no extension.
// Constructing its Redis client here is inert -- there are no credentials in
// this environment, which is the entire reason this file exists.
const { IPO_FILINGS_REDIS_KEY } = await import("../lib/server/ipoSecStore.ts");

const docPath = process.argv[2];
const PORT = Number(process.argv[3] || 8079);
if (!docPath || !fs.existsSync(docPath)) {
  console.error(`usage: node scripts/local-upstash.mjs <document.json> [port]`);
  process.exit(1);
}

// ── VERIFY THE COPY BEFORE SERVING IT ─────────────────────────────────────
// A document that reached here through a log transport can arrive with a byte
// changed and still parse. That happened: one corrupted literal rendered
// "Nasdaq Capital Marktt" on 52 rows and looked exactly like a parser defect.
// Pass the sha256 the probe printed and this refuses a copy that does not match.
const text = fs.readFileSync(docPath, "utf8");
const expectSha = process.argv[4];
if (expectSha) {
  const got = crypto.createHash("sha256").update(text, "utf8").digest("hex");
  if (got !== expectSha) {
    console.error(`FATAL: ${docPath} does not match the expected sha256.`);
    console.error(`  expected ${expectSha}`);
    console.error(`  got      ${got}`);
    console.error(`A document that parses is not a document that survived the trip.`);
    process.exit(1);
  }
  console.log(`local-upstash: sha256 verified (${got.slice(0, 16)}…)`);
} else {
  console.warn(
    `local-upstash: NO sha256 GIVEN — serving ${docPath} unverified. A copy that ` +
      `parses can still carry a changed byte; pass the hash the probe printed as ` +
      `the 3rd argument.`
  );
}
const raw = JSON.parse(text);
// Accept either a bare stored document or the ingest probe's payload wrapper,
// so whichever artefact is to hand can be used without reshaping it by hand.
const doc = raw.records ? raw : raw.document?.records ? raw.document : null;
if (!doc || !Array.isArray(doc.records)) {
  console.error(
    `FATAL: ${docPath} carries no \`records\` array. This must be a stored IPO ` +
      `document — the thing writeStoredIpoFilings would SET — not a summary of one.`
  );
  process.exit(1);
}

const store = new Map();
// THE KEY IS IMPORTED, NOT TYPED. A local harness seeded under a key the app
// does not read would render an empty page and look like a classifier bug.
//
// ── STORED AS A STRING, BECAUSE THAT IS WHAT UPSTASH RETURNS ──────────────
// Upstash's REST API answers `{"result": "<the stored string>"}` and
// @upstash/redis JSON.parses it on the way out. Seeding a JS OBJECT here made
// the client hand back null, `readStoredIpoFilings` reported "no stored SEC
// filing records", and the page rendered its degraded state -- a harness bug
// wearing the exact costume of an empty store. Everything that goes in goes in
// as a string, the way a real SET delivers it.
store.set(IPO_FILINGS_REDIS_KEY, JSON.stringify(doc));

console.log(`local-upstash: ${doc.records.length} records seeded at ${IPO_FILINGS_REDIS_KEY}`);
console.log(`local-upstash: windowStart ${doc.windowStart} · lastIndexDate ${doc.lastIndexDate}`);

function run(cmd) {
  const [nameRaw, key, value] = cmd;
  const name = String(nameRaw).toLowerCase();
  switch (name) {
    case "get":
      return store.has(key) ? store.get(key) : null;
    case "set":
      store.set(key, value);
      return "OK";
    case "del":
      return store.delete(key) ? 1 : 0;
    case "ttl":
      return store.has(key) ? 3600 : -2;
    case "incr": {
      const n = (Number(store.get(key)) || 0) + 1;
      store.set(key, n);
      return n;
    }
    case "expire":
      return store.has(key) ? 1 : 0;
    case "exists":
      return store.has(key) ? 1 : 0;
    default:
      // NAMED, NOT SILENTLY ZEROED. A command this harness does not implement
      // returning a plausible-looking null is how a local render diverges from
      // production without anyone noticing which command did it.
      console.warn(`local-upstash: UNIMPLEMENTED ${name} ${key ?? ""} -> null`);
      return null;
  }
}

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : [];
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad json" }));
        return;
      }
      const pipeline = req.url?.includes("pipeline") || req.url?.includes("multi-exec");
      const out = pipeline
        ? payload.map((c) => ({ result: run(c) }))
        : { result: run(payload) };
      if (!pipeline) console.log(`local-upstash: ${payload[0]} ${payload[1] ?? ""}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`local-upstash: listening on http://127.0.0.1:${PORT}`);
  });
