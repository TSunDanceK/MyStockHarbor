// SCREENSHOT THE /stock ABOUT BLOCK ON A VERCEL PREVIEW (PR 3 render, #518).
//
// The agent sandbox is refused *.vercel.app, and previews sit behind Vercel
// SSO. A runner can reach them, and a `_vercel_share` link (minted by the
// owner's Vercel connector, valid 23 hours) sets the access cookie. The link
// is passed as the relay's SYMBOLS input — never committed.
//
//   SYMBOLS="<share url for /stock/X> ONDS AAPL ABVX AZN" node scripts/preview-screenshots.mjs
//
// Headless Chrome over the DevTools protocol with Node's built-in WebSocket —
// no npm install on the runner. For each symbol: the "About …" section,
// clipped to its box, at desktop (1280) and mobile (390) widths. Written as
// base64 PNG into data/sec/preview-screenshots.json, which the relay uploads;
// .github/workflows/preview-screenshots-commit.yml decodes them onto a
// throwaway branch so the PR's diff carries no images.
//
// Read-only: loads pages, writes one file.
import fs from "node:fs";
import { spawn } from "node:child_process";

const args = (process.env.SYMBOLS || "").split(/\s+/).filter(Boolean);
const share = args.find((a) => /^https?:\/\//.test(a));
const symbols = args.filter((a) => !/^https?:\/\//.test(a));
if (!share || !symbols.length) throw new Error("SYMBOLS must be '<share url> SYM SYM …'");
const origin = new URL(share).origin;

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
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

await send("Page.enable");
await send("Runtime.enable");

async function load(url) {
  events.length = 0;
  const nav = await send("Page.navigate", { url });
  if (nav.errorText) console.log(`  navigate ${url.replace(/_vercel_share=[^&]+/, "_vercel_share=…")}: ${nav.errorText}`);
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    if (events.some((e) => e.method === "Page.loadEventFired")) break;
  }
  await sleep(2500); // client charts and fonts settle
}

// THE SHARE LINK FIRST: it sets the SSO-bypass cookie, then redirects.
await load(share);
console.log(`share link landed on ${String(await evaluate("location.href")).replace(/_vercel_share=[^&]+/, "_vercel_share=…")}`);

const out = { origin, takenAt: new Date().toISOString(), shots: {} };
for (const sym of symbols) {
  for (const [label, width, mobile] of [["desktop", 1280, false], ["mobile", 390, true]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile });
    await load(`${origin}/stock/${encodeURIComponent(sym)}`);
    // The About section: the <section> whose heading reads "About …".
    const box = await evaluate(`(() => {
      const h = [...document.querySelectorAll("h2")].find((e) => /^About /.test(e.textContent.trim()));
      const s = h && h.closest("section");
      if (!s) return null;
      s.scrollIntoView();
      const r = s.getBoundingClientRect();
      return { x: 0, y: r.top + window.scrollY, width: document.documentElement.clientWidth, height: r.height,
               text: s.innerText.slice(0, 1600) };
    })()`);
    if (!box) {
      console.log(`${sym} ${label}: no About section (title: ${await evaluate("document.title")})`);
      out.shots[`${sym}-${label}`] = { error: "no About section", title: await evaluate("document.title") };
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
