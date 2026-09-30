// THE SEC ARCHIVE, LAYER 1 (#552 COWORK #65; owner: Cloudflare R2, CODE-A #66).
//
// Every fact a filer published, kept: companyfacts normalised to one row per
// fact across EVERY taxonomy, concept and unit (not cut to SEC_FIELDS), plus
// the submissions metadata with its older pages. Layer 2 (today's fact sets)
// is to be REBUILT from here, so a chain or field change stops being a mass
// re-read from SEC. This module is pure: no dependency beyond node:crypto and
// node:zlib, so the backfill runs on a runner with no npm install.
//
// OBJECTS (private bucket; SEC data is public domain, the store is not listed):
//   facts/{cik10}.ndjson.br        line 1 a header, then one JSON array per fact
//   submissions/{cik10}.json.gz    { main, pages: [...] } as SEC served them
//   index.json                     per CIK: rows, newest accession/filed, hashes
import crypto from "node:crypto";
import zlib from "node:zlib";

// ── ROWS ─────────────────────────────────────────────────────────────────────
export const ROW_COLUMNS = ["taxonomy", "concept", "unit", "start", "end", "val", "accn", "fy", "fp", "form", "filed", "frame"];
export const ARCHIVE_VERSION = 1;

/** companyfacts JSON → header + one row per fact, nothing dropped. */
export function factsToRows(companyfacts) {
  const rows = [];
  const labels = {};
  for (const [taxonomy, concepts] of Object.entries(companyfacts?.facts ?? {})) {
    for (const [concept, def] of Object.entries(concepts ?? {})) {
      // Label and description are kept once per concept, not per row.
      labels[`${taxonomy}:${concept}`] = [def?.label ?? null, def?.description ?? null];
      for (const [unit, facts] of Object.entries(def?.units ?? {})) {
        for (const f of facts ?? []) {
          rows.push([taxonomy, concept, unit, f.start ?? null, f.end ?? null, f.val ?? null, f.accn ?? null,
            f.fy ?? null, f.fp ?? null, f.form ?? null, f.filed ?? null, f.frame ?? null]);
        }
      }
    }
  }
  const header = { v: ARCHIVE_VERSION, cik: companyfacts?.cik ?? null, entityName: companyfacts?.entityName ?? null, columns: ROW_COLUMNS, labels };
  return { header, rows };
}

/**
 * THE REVERSE: rows → the companyfacts shape the extractor reads. Layer 2 is
 * rebuilt through this, so it must reproduce every fact the payload carried
 * (checked round-trip in scripts/check-sec-archive.mjs).
 */
export function rowsToFacts(header, rows) {
  const facts = {};
  for (const r of rows) {
    const [taxonomy, concept, unit, start, end, val, accn, fy, fp, form, filed, frame] = r;
    const c = ((facts[taxonomy] ??= {})[concept] ??= (() => {
      const [label, description] = header?.labels?.[`${taxonomy}:${concept}`] ?? [null, null];
      return { label, description, units: {} };
    })());
    const f = { end, val, accn, fy, fp, form, filed };
    if (start !== null) f.start = start;
    if (frame !== null) f.frame = frame;
    (c.units[unit] ??= []).push(f);
  }
  return { cik: header?.cik ?? null, entityName: header?.entityName ?? null, facts };
}

export function encodeFacts({ header, rows }) {
  const text = [JSON.stringify(header), ...rows.map((r) => JSON.stringify(r))].join("\n");
  return zlib.brotliCompressSync(Buffer.from(text), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
}

export function decodeFacts(buf) {
  const [head, ...lines] = zlib.brotliDecompressSync(buf).toString("utf8").split("\n");
  return { header: JSON.parse(head), rows: lines.filter(Boolean).map((l) => JSON.parse(l)) };
}

/** The newest filing the facts carry: what the incremental job compares against. */
export function newestFiling(rows) {
  let best = null;
  for (const r of rows) if (r[10] && (!best || r[10] > best.filed || (r[10] === best.filed && r[6] > best.accn))) best = { filed: r[10], accn: r[6] };
  return best;
}

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// ── R2 (S3 API, AWS Signature V4) ────────────────────────────────────────────
const hmac = (key, s) => crypto.createHmac("sha256", key).update(s).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * SIGV4 HEADERS for one request. Pure (the clock is passed in), so the check
 * can hold it to AWS's published example. `path` is the object path under the
 * host ("/bucket/key" for R2's path style); each segment is URI-encoded once.
 */
export function signV4({ method, host, path, query = "", headers = {}, payloadHash, accessKeyId, secretAccessKey, region, service = "s3", amzDate }) {
  const date = amzDate.slice(0, 8);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${all[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalUri = path.split("/").map(enc).join("/");
  const canonicalRequest = [method, canonicalUri, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    headers: { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
    signature,
  };
}

/** A minimal R2 client: get / put / head. Credentials from the environment only. */
export function r2Client(env = process.env, fetchImpl = fetch) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) throw new Error("R2 credentials are not configured");
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const send = async (method, key, body = null, extra = {}) => {
    const payload = body ?? Buffer.alloc(0);
    const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const { headers } = signV4({ method, host, path: `/${R2_BUCKET}/${key}`, headers: extra, payloadHash: sha256(payload),
      accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, region: "auto", amzDate });
    delete headers.host; // fetch sets it
    const res = await fetchImpl(`https://${host}/${R2_BUCKET}/${key.split("/").map(enc).join("/")}`,
      { method, headers, body: method === "PUT" ? payload : undefined, signal: AbortSignal.timeout(120_000) });
    return res;
  };
  return {
    async get(key) {
      const res = await send("GET", key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 GET ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async put(key, body, contentType) {
      const res = await send("PUT", key, body, { "content-type": contentType });
      if (!res.ok) throw new Error(`R2 PUT ${res.status}`);
    },
  };
}
