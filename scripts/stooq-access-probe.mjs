// CAN THIS PROJECT'S AUTOMATION REACH STOOQ AT ALL?
//
// Phase 0 could not answer the adjustment question because stooq.com served a
// GitHub Actions runner a JavaScript browser-verification interstitial instead of
// CSV -- every symbol, every spelling (run 34697400978, 2026-09-12T13:47Z):
//
//   <!DOCTYPE html>...<noscript>This site requires JavaScript to verify your
//   browser. Please enable JavaScript an...
//
// That is an anti-bot challenge, and it makes the access question prior to every
// data question. So this probe asks only that, across the endpoints that matter,
// and reports exactly what each one returns.
//
// WHAT THIS PROBE DOES NOT DO. It does not attempt to satisfy, bypass or
// fingerprint around the challenge -- no browser User-Agent spoofing, no cookie
// forging, no headless browser to execute the verification script. If a site
// declines automated access, the answer is "it declines automated access", and
// the decision about what to do instead belongs to the owner. Every request here
// carries the same honest, identifying User-Agent.
//
// WHY THE BULK ARCHIVE IS TESTED SEPARATELY AND MATTERS MOST. The build plan's
// Phase 1 does not want the per-symbol quote endpoint at all -- it wants the
// whole-market daily archive, fetched ONCE. That is a different, documented
// service on the same site, published for bulk download, and it may well have a
// different access posture. Phase 0 probed the per-symbol endpoint only because
// that was the cheap way to compare five tickers; the plan's real dependency is
// the archive, so a challenge on one does not settle the other.
export const UA =
  process.env.STOOQ_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; data-provider evaluation)";

const TARGETS = [
  ["per-symbol CSV (.com)", "https://stooq.com/q/d/l/?s=ko.us&i=d", "what Phase 0 used"],
  ["per-symbol CSV (.pl)", "https://stooq.pl/q/d/l/?s=ko.us&i=d", "the Polish mirror, same service"],
  ["bulk archive index (.com)", "https://stooq.com/db/h/", "THE ONE PHASE 1 ACTUALLY NEEDS"],
  ["bulk archive index (.pl)", "https://stooq.pl/db/h/", "mirror of the same"],
  ["bulk daily US zip", "https://static.stooq.com/db/h/d_us_txt.zip", "the archive file itself, if served directly"],
  ["site root (.com)", "https://stooq.com/", "is the challenge site-wide or endpoint-specific?"],
];

const looksLikeZip = (buf) => buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK"
const CHALLENGE_MARKER = "requires JavaScript to verify your browser";

export async function surveyStooqAccess() {
console.log("STOOQ ACCESS PROBE — can automation reach it, and on which endpoint?");
console.log(`User-Agent: ${UA}`);
console.log("No challenge-solving, no UA spoofing, no cookie forging. Honest requests only.\n");

const results = [];
for (const [label, url, why] of TARGETS) {
  console.log(`── ${label}`);
  console.log(`   ${url}`);
  console.log(`   (${why})`);
  const row = { label, url, why };
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
    row.status = res.status;
    row.contentType = res.headers.get("content-type");
    row.contentLength = res.headers.get("content-length");
    row.finalUrl = res.url;
    const buf = Buffer.from(await res.arrayBuffer());
    row.bytes = buf.length;
    row.isZip = looksLikeZip(buf);
    const head = buf.subarray(0, 300).toString("utf8");
    row.head = head.replace(/\s+/g, " ").slice(0, 220);
    row.isChallenge = head.includes(CHALLENGE_MARKER);
    row.isHtml = /^\s*<(!doctype|html)/i.test(head);

    const verdict = row.isChallenge
      ? "JS CHALLENGE — automated access declined"
      : row.isZip
        ? "ZIP ARCHIVE — usable"
        : row.isHtml
          ? "HTML (not a challenge) — wrong content type for data"
          : "NON-HTML payload — inspect below";
    console.log(`   HTTP ${row.status} · ${row.contentType ?? "no content-type"} · ${row.bytes} bytes`);
    if (row.finalUrl !== url) console.log(`   redirected to ${row.finalUrl}`);
    console.log(`   >>> ${verdict}`);
    console.log(`   head: ${row.head}`);
  } catch (e) {
    row.error = String(e?.message ?? e);
    console.log(`   >>> REQUEST FAILED: ${row.error}`);
  }
  console.log("");
  results.push(row);
  await new Promise((r) => setTimeout(r, 600));
}

console.log("══ SUMMARY ══");
const usable = results.filter((r) => r.isZip || (r.contentType ?? "").includes("text/plain") || (r.contentType ?? "").includes("csv"));
const challenged = results.filter((r) => r.isChallenge);
console.log(`  endpoints probed:            ${results.length}`);
console.log(`  behind the JS challenge:     ${challenged.length}  (${challenged.map((r) => r.label).join(", ") || "none"})`);
console.log(`  returning usable data:       ${usable.length}  (${usable.map((r) => r.label).join(", ") || "none"})`);
console.log("");
if (usable.length) {
  console.log("  AT LEAST ONE PATH WORKS. Phase 1 should use it and nothing else:");
  for (const r of usable) console.log(`    ${r.label} -> ${r.url}`);
} else if (challenged.length === results.length) {
  console.log("  NO AUTOMATED PATH. Every probed endpoint declines automation from this");
  console.log("  runner. This is an OWNER DECISION, not something to engineer around:");
  console.log("    - the archive could be downloaded manually and committed/uploaded, or");
  console.log("    - a different free source could be evaluated, or");
  console.log("    - Stooq may offer a documented paid/keyed bulk feed.");
  console.log("  DO NOT attempt to satisfy the challenge programmatically.");
} else {
  console.log("  MIXED — read the per-endpoint verdicts above before deciding.");
}

console.log(`\n${JSON.stringify({ probedAt: new Date().toISOString(), userAgent: UA, results }, null, 2)}`);
  return results;
}

// Runnable directly as well as importable. The phase0 probe calls
// surveyStooqAccess() when its own fetches come back refused, because "we cannot
// reach the source" is the correct answer to "how does the source compare" -- and
// answering it in the same run saves a dispatch.
if (import.meta.url === `file://${process.argv[1]}`) {
  await surveyStooqAccess();
}
