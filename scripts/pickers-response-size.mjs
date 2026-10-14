// HOW BIG IS /api/pickers, AGAINST VERCEL'S 4.5 MB FUNCTION RESPONSE LIMIT
// (#552 COWORK #233 S0(b)). Reads only.
//
// The route answers with publicPickersPayload(pickersWithoutBars(payload)) on
// every path that does not build (pickersBuilder.handlePickersRequest), so this
// reads the stored v10 payload exactly as readPickersV10 does (manifest, then
// one MGET of its chunks), runs the SAME two functions on it and measures the
// JSON body NextResponse.json would send: raw UTF-8 bytes (what the limit is
// measured on), plus gzip and brotli for the wire. Bytes only: no value is
// printed. With `LIVE=1` (no-credential task) it instead fetches the public
// URL once and reports status, encoding and sizes.
//
//   relay tasks: write-pickers-response-size (1 GET + 1 MGET)
//                pickers-response-live      (1 public GET, no credentials)
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import zlib from "node:zlib";

const LIMIT = 4.5 * 1024 * 1024;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

if (process.env.LIVE === "1") {
  const url = "https://www.mystockharbor.com/api/pickers";
  for (const enc of ["identity", "gzip, br"]) {
    try {
      const res = await fetch(url, { headers: { "accept-encoding": enc, "user-agent": "msh-relay-size-probe" } });
      const body = Buffer.from(await res.arrayBuffer()); // fetch decodes; this is the uncompressed body
      console.log(
        `LIVE accept=${JSON.stringify(enc)} status=${res.status} content-encoding=${res.headers.get("content-encoding") ?? "-"} ` +
          `content-length=${res.headers.get("content-length") ?? "-"} body=${body.length} (${mb(body.length)}) ` +
          `json=${/^\s*\{/.test(body.subarray(0, 64).toString()) ? "yes" : "no"} x-vercel-cache=${res.headers.get("x-vercel-cache") ?? "-"}`
      );
    } catch (err) {
      console.log(`LIVE accept=${JSON.stringify(enc)} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  process.exit(0);
}

const { Redis } = await import("@upstash/redis");
const { publicPickersPayload } = await import("../lib/pickerPerf.ts");
const { pickersWithoutBars } = await import("../lib/pickersPublic.ts");
const src = fs.readFileSync("lib/server/pickersBuilder.ts", "utf8");
const MANIFEST = (src.match(/export const PICKERS_MANIFEST_KEY = "([^"]+)"/) ?? [])[1];
if (!MANIFEST) throw new Error("PICKERS_MANIFEST_KEY not found");

const redis = Redis.fromEnv();
const manifest = await redis.get(MANIFEST);
if (!manifest?.head || !Array.isArray(manifest.chunkKeys)) throw new Error("no v10 manifest stored");
const chunks = manifest.chunkKeys.length ? await redis.mget(...manifest.chunkKeys) : [];
const records = chunks.flat();
if (records.length !== manifest.recordCount) throw new Error(`chunks hold ${records.length}, manifest says ${manifest.recordCount}`);
const payload = { ...manifest.head, signalRecords: records };

const stored = Buffer.byteLength(JSON.stringify(payload));
const body = JSON.stringify(publicPickersPayload(pickersWithoutBars(payload)));
const raw = Buffer.byteLength(body);
const gz = zlib.gzipSync(body).length;
const br = zlib.brotliCompressSync(body).length;
const n = records.length;
const perRecord = (raw - Buffer.byteLength(JSON.stringify(publicPickersPayload(pickersWithoutBars({ ...payload, signalRecords: [] }))))) / n;
const fixed = raw - perRecord * n;
const crossAt = Math.floor((LIMIT - fixed) / perRecord);

console.log(`cachedAt ${new Date(manifest.cachedAt).toISOString()} records ${n} chunks ${manifest.chunkKeys.length}`);
console.log(`STORED payload ${stored} B (${mb(stored)})`);
console.log(`RESPONSE body ${raw} B (${mb(raw)}) = ${(100 * raw / LIMIT).toFixed(1)}% of 4.5 MB; gzip ${gz} B (${mb(gz)}); brotli ${br} B (${mb(br)})`);
console.log(`per record ${Math.round(perRecord)} B; fixed ${Math.round(fixed)} B; 4.5 MB crossed at ~${crossAt} records`);
for (const N of [1000, 1150, 1500, 3000]) console.log(`PROJECT N=${N} body ~${mb(fixed + perRecord * N)}`);
console.log("Redis commands: 2");
