import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewportSize: { width: Number(process.env.W || 1560), height: 1000 } });
await p.goto("file://" + (process.env.OUT || "/tmp/harness.html"));
const r = await p.evaluate(() => {
  const main = document.getElementById("mainColumn");
  const side = document.getElementById("sideColumn");
  const m = main.getBoundingClientRect(), s = side.getBoundingClientRect();
  // The widest descendant of the main column, and what it is.
  // ONLY WHAT IS ACTUALLY PAINTED. An element inside an overflow-x:auto
  // ancestor has a layout box wider than its clip, and measuring that box
  // would report an overlap the reader never sees — the exact kind of wrong
  // answer this harness exists to replace.
  const clipped = (el) => {
    for (let n = el.parentElement; n && n !== main.parentElement; n = n.parentElement) {
      const o = getComputedStyle(n);
      if (o.overflowX !== "visible" || o.overflow !== "visible") return true;
    }
    return false;
  };
  let worst = { w: 0, tag: "", cls: "" };
  let worstCard = 0;
  for (const el of main.querySelectorAll("*")) {
    const b = el.getBoundingClientRect();
    if (el.classList.contains("card") && b.right > worstCard) worstCard = b.right;
    if (clipped(el)) continue;
    if (b.right > worst.w) worst = { w: b.right, tag: el.tagName, cls: (el.className || "").toString().slice(0, 40) };
  }
  return {
    mainLeft: Math.round(m.left), mainRight: Math.round(m.right), mainWidth: Math.round(m.width),
    sideLeft: Math.round(s.left), sideRight: Math.round(s.right),
    mainScrollWidth: main.scrollWidth, mainClientWidth: main.clientWidth,
    worstRight: Math.round(worst.w), worstTag: worst.tag, worstCls: worst.cls,
    worstCard: Math.round(worstCard),
  };
});
await b.close();
const overlap = r.worstRight - r.sideLeft;
console.log(`main box   ${r.mainLeft}..${r.mainRight} (w ${r.mainWidth}, scrollWidth ${r.mainScrollWidth})`);
console.log(`aside box  ${r.sideLeft}..${r.sideRight}`);
console.log(`widest PAINTED descendant reaches ${r.worstRight}  <${r.worstTag} class="${r.worstCls}">`);
console.log(`widest .card right edge      ${r.worstCard}  (column ends ${r.mainRight})`);
console.log(overlap > 1
  ? `*** OVERLAP: main content crosses ${overlap}px into the aside ***`
  : `clean: main content stops ${-overlap}px short of the aside`);
