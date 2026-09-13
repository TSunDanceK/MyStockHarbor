"""One-shot: convert the investor datasheet PNGs in public/images/datasheets to
WebP and repoint the video frontmatter at them.

WHY
---
Measured 2026-09-13: the ten PNGs totalled 35.4 MB, and ifx-june-2026.png alone
was 16.8 MB -- a single image shipped to every visitor of one page, with no
width/height on the <img> so it shifted layout too. See
claude/image-policy-2026-09-13.md.

SETTINGS, AND WHY THESE
-----------------------
Native resolution, quality 92. The datasheets are 16:9 renders of an HTML
template: flat dark panels, fine table text, a photographic background. The
DatasheetViewer has a zoom-to-natural-size mode, so downscaling would quietly
remove a feature -- and at q92 native the saving is already 90-97%, so there is
nothing to buy by going smaller. A 2x-zoom A/B of a dense text region against
the source PNG showed no visible difference in glyph edges or gradient banding.

RGBA sources are flattened onto the template's own near-black (#030712) rather
than white, so the transparent border does not become a bright fringe.
ifx-june-2026.png was RGBA, which is most of why it was 16.8 MB.

Kept in the repo as a record of how the committed files were produced; it is
not wired into the build and does not need to run again.
"""

import json
import os
import re
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEETS = ROOT / "public" / "images" / "datasheets"
VIDEOS = ROOT / "content" / "videos"

QUALITY = 92
FLATTEN_BG = (3, 7, 18)  # matches the datasheet template ground

# Orphan: content/videos/1sI-5NmBCds.md (MOD) has `datasheetImage:` blank, so
# this file is served by nothing. Removed rather than converted.
ORPHANS = {"mod-august-2026.png"}

# The source filename carries a doubled extension and the frontmatter repeats
# it. Both are corrected here.
RENAMES = {"alab-august-2026.png.png": "alab-august-2026.webp"}


def out_name(src: str) -> str:
    if src in RENAMES:
        return RENAMES[src]
    return re.sub(r"\.png$", ".webp", src, flags=re.IGNORECASE)


def main() -> int:
    if not SHEETS.is_dir():
        print(f"missing {SHEETS}", file=sys.stderr)
        return 1

    mapping = {}
    before = after = 0
    rows = []

    for src in sorted(os.listdir(SHEETS)):
        if not src.lower().endswith(".png"):
            continue
        path = SHEETS / src
        size_in = path.stat().st_size
        before += size_in

        if src in ORPHANS:
            path.unlink()
            rows.append((src, size_in, 0, "REMOVED (orphaned)"))
            continue

        im = Image.open(path)
        if im.mode == "RGBA":
            bg = Image.new("RGB", im.size, FLATTEN_BG)
            bg.paste(im, mask=im.split()[3])
            im = bg
        else:
            im = im.convert("RGB")

        dest_name = out_name(src)
        dest = SHEETS / dest_name
        im.save(dest, "WEBP", quality=QUALITY, method=6)
        size_out = dest.stat().st_size
        after += size_out
        path.unlink()

        mapping[f"/images/datasheets/{src}"] = f"/images/datasheets/{dest_name}"
        rows.append((src, size_in, size_out, dest_name))

    # Repoint the frontmatter.
    touched = []
    for md in sorted(VIDEOS.glob("*.md")):
        text = md.read_text(encoding="utf-8")
        original = text
        for old, new in mapping.items():
            text = text.replace(old, new)
        if text != original:
            md.write_text(text, encoding="utf-8")
            touched.append(md.name)

    width = max(len(r[0]) for r in rows)
    print(f"{'file':<{width}}  {'before':>10}  {'after':>9}  result")
    for name, a, b, note in rows:
        pct = f"{b / a * 100:.0f}%" if b else "--"
        print(f"{name:<{width}}  {a:>10,}  {b:>9,}  {pct:>4}  {note}")
    print()
    print(f"total {before:,} -> {after:,} bytes  ({after / before * 100:.1f}%)")
    print(f"saved {(before - after) / 1e6:.1f} MB")
    print(f"frontmatter updated: {', '.join(touched)}")
    print(json.dumps(mapping, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
