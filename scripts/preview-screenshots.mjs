// SCREENSHOT THE /stock ABOUT BLOCK ON A VERCEL PREVIEW (PR 3 render, #518).
//
// The agent sandbox is refused *.vercel.app, and previews sit behind Vercel
// SSO, so this runs on a GitHub runner: .github/workflows/preview-screenshots.yml.
//
// ── CREDENTIALS NEVER ARRIVE AS INPUTS (owner, #518) ─────────────────────
// The repo is public and workflow logs are readable, and a dispatch input is
// printed in the log. The first version took a `_vercel_share` link as the
// relay's SYMBOLS input, which put a live access link in three run logs
// (35790746955, 35790835526, 35792976694 — logs deleted). Now:
//   PREVIEW_URL  the deployment's origin only; any query string, and any
//                `_vercel_share` / token-looking parameter, is refused.
//   VERCEL_AUTOMATION_BYPASS_SECRET  Vercel's "Protection Bypass for
//                Automation" secret, from a masked repo secret. Sent as the
//                x-vercel-protection-bypass header; never logged.
//
//   PREVIEW_URL=https://<deployment>.vercel.app SYMBOLS="ONDS AAPL" \
//     VERCEL_AUTOMATION_BYPASS_SECRET=… node scripts/preview-screenshots.mjs
//
// Headless Chrome over the DevTools protocol with Node's built-in WebSocket —
// no npm install on the runner. For each symbol: the "About …" section,
// clipped to its box, at desktop (1280) and mobile (390) widths, written as
// base64 PNG into data/sec/preview-screenshots.json.
//
// Read-only: loads pages, writes one file.
import fs from "node:fs";
import { spawn } from "node:child_process";

const raw = (process.env.PREVIEW_URL || "").trim();
if (!raw) throw new Error("PREVIEW_URL is required (the deployment origin)");
const url = new URL(raw);
if (url.search || url.hash || /share|token|bypass|secret/i.test(raw)) {
  throw new Error("PREVIEW_URL must be a bare origin: no query string, no share link, no token");
}
const origin = url.origin;
// OPTIONAL SECTION TOKEN (Relay B, 2026-09-23): SYMBOLS may carry one
// "section=<name>" token choosing which block is clipped. Default "about" keeps
// every existing dispatch unchanged. Names map to a heading test below; the
// token is validated against that fixed list, so no free text reaches the page.
const SECTIONS = {
  about: "/^About /",
  returns: "/close-over-close change/i",
};
const tokens = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const sectionToken = tokens.find((t) => t.startsWith("section="));
const section = sectionToken ? sectionToken.slice("section=".length) : "about";
if (!Object.hasOwn(SECTIONS, section)) throw new Error(`section= takes one of: ${Object.keys(SECTIONS).join(", ")}`);
const symbols = tokens.filter((t) => t !== sectionToken);
if (!symbols.length) throw new Error("SYMBOLS is required");
if (symbols.some((s) => !/^[A-Z0-9.\-]{1,10}$/i.test(s))) throw new Error("SYMBOLS takes ticker symbols only");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "";
if (!BYPASS) throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET is not set (a masked repo secret)");

const chrome = [process.env.CHROME, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"]
  .find((c) => c && fs.existsSync(c));
if (!chrome) throw new Error("no Chrome on this runner");
const port = 9333;
const proc = spawn(chrome, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  `--remote-debugging-port=${port}`, "--user-data-dir=/tmp/shot-profile",
  ...(process.env.CHROME_ARGS || "").split(/\s+/).filter(Boolean), "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === "page");
  } catch { /* not up yet */ }
}
if (!target) throw new Error(`Chrome (${chrome}) did not start`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) events.push(msg);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))?.result?.value;

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
// VERCEL'S SECURITY CHECKPOINT challenges a "HeadlessChrome" user agent
// (first run, 35790746955). A regular desktop Chrome string, and a wait for
// the challenge page to hand over (below).
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
await send("Network.setUserAgentOverride", { userAgent: UA });
// The bypass secret as a header on every request; set-bypass-cookie makes the
// client-side navigations that follow carry it too.
await send("Network.setExtraHTTPHeaders", { headers: {
  "x-vercel-protection-bypass": BYPASS,
  "x-vercel-set-bypass-cookie": "true",
} });

async function load(url) {
  events.length = 0;
  const nav = await send("Page.navigate", { url });
  if (nav.errorText) console.log(`  navigate ${url}: ${nav.errorText}`);
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    if (events.some((e) => e.method === "Page.loadEventFired")) break;
  }
  // The checkpoint runs its challenge and reloads into the page: wait for it.
  for (let i = 0; i < 60; i++) {
    const title = String(await evaluate("document.title").catch(() => ""));
    if (!/Security Checkpoint/i.test(title)) break;
    await sleep(500);
  }
  await sleep(2500); // client charts and fonts settle
}


const out = { origin, takenAt: new Date().toISOString(), shots: {} };
for (const sym of symbols) {
  for (const [label, width, mobile] of [["desktop", 1280, false], ["mobile", 390, true]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile });
    await load(`${origin}/stock/${encodeURIComponent(sym)}`);
    // The chosen section: the <section> whose h2 matches (default "About …").
    const box = await evaluate(`(() => {
      const h = [...document.querySelectorAll("h2")].find((e) => ${SECTIONS[section]}.test(e.textContent.trim()));
      const s = h && h.closest("section");
      if (!s) return null;
      s.scrollIntoView();
      const r = s.getBoundingClientRect();
      return { x: 0, y: r.top + window.scrollY, width: document.documentElement.clientWidth, height: r.height,
               text: s.innerText.slice(0, 1600) };
    })()`);
    if (!box) {
      console.log(`${sym} ${label}: no ${section} section (title: ${await evaluate("document.title")})`);
      out.shots[`${sym}-${label}`] = { error: `no ${section} section`, title: await evaluate("document.title") };
      continue;
    }
    const { data } = await send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true,
      clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 4000), scale: 1 },
    });
    out.shots[`${sym}-${label}`] = { png: data, text: box.text, height: Math.round(box.height) };
    console.log(`${sym} ${label}: ${Math.round(box.height)}px`);
    console.log(box.text.split("\n").slice(0, 12).map((l) => `    | ${l}`).join("\n"));
  }
}

fs.mkdirSync("data/sec", { recursive: true });
fs.writeFileSync("data/sec/preview-screenshots.json", JSON.stringify(out));
ws.close();
proc.kill();
console.log("wrote data/sec/preview-screenshots.json");
