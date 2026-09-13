// Getting a payload out of a relay run and into this repo, intact.
//
// ── THE PROBLEM THIS SOLVES, AND THE ROUTE THAT DOES NOT ───────────────────
// Relay payloads are read back through the job log, and the job log is read
// from its TAIL. A large capture printed mid-run is pushed out of reach by
// everything printed after it — which is exactly how step 4 ended up with a
// reconstructed GlobeNewswire fixture instead of a verbatim one.
//
// AN ACTIONS ARTIFACT DOES NOT FIX IT. Tested 2026-09-13: the artifact download
// API redirects to productionresultssa16.blob.core.windows.net, and the sandbox
// refuses that host with 403 CONNECT. An artifact is LESS reachable from here
// than stdout is, not more. (relay.yml already uploads one; it is for a human
// with a browser, not for this session.)
//
// ── WHAT ACTUALLY WORKS ────────────────────────────────────────────────────
// Three rules, all enforced here rather than remembered:
//
//   1. ONE PAYLOAD PER DISPATCH. Selected by the relay's existing `symbols`
//      input, so no workflow file has to change — workflow_dispatch inputs are
//      read from the default branch, and adding one costs a merge.
//   2. PRINTED LAST, after every summary line, so the tail reaches it.
//   3. BYTE-ACCOUNTED. The emitter states the exact byte count before the
//      payload and repeats it after. A truncated read is then detectable
//      instead of looking like a complete small payload — which is the failure
//      mode that matters, because a fixture silently missing its last items
//      still parses.
//
// The delimiters are deliberately unlikely to occur in feed or filing content.
export const BEGIN = "<<<<<<<< RELAY-PAYLOAD BEGIN";
export const END = ">>>>>>>> RELAY-PAYLOAD END";

/** Which payload this dispatch should emit, from the relay's `symbols` input. */
export function requestedPayload() {
  return (process.env.SYMBOLS ?? "").trim();
}

/**
 * Emit one payload, or explain why it was skipped.
 *
 * Returns true if it was emitted, so a caller can tell the difference between
 * "not requested" and "requested and empty".
 */
export function emitPayload(name, text, { requested = requestedPayload() } = {}) {
  if (requested && requested !== name) return false;
  if (!requested) {
    console.log(`[capture] ${name}: ${Buffer.byteLength(text, "utf8")} bytes available — ` +
      `dispatch with symbols="${name}" to emit it`);
    return false;
  }

  const bytes = Buffer.byteLength(text, "utf8");
  console.log(`\n${BEGIN} ${name} bytes=${bytes}`);
  console.log(text);
  console.log(`${END} ${name} bytes=${bytes}`);

  // ── A PER-LINE CENSUS, BECAUSE THE TOTAL SAYS "WRONG" BUT NOT "WHERE" ─────
  // The payload is read back out of a job log and copied into a fixture BY
  // HAND, which is the error-prone step this whole module exists around. A
  // total byte count catches a bad copy — it caught an 8-byte slip across 40
  // lines — but then leaves you bisecting 40 lines by eye to find it. The
  // census makes the mismatch point at its own line. Costs ~5 bytes per line.
  const census = text.split("\n").map((l) => Buffer.byteLength(l, "utf8")).join(",");
  console.log(`[capture] ${name} line-bytes: ${census}`);
  return true;
}
