#!/usr/bin/env python3
"""Cut animated layers out of the LLC logo and map, and write 1-bit pixel frames."""
from pathlib import Path
from collections import deque
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parent
FX = ROOT / "assets" / "fx"
FX.mkdir(parents=True, exist_ok=True)

def load_rgba(path):
    return Image.open(path).convert("RGBA")

def ink_mask(arr):
    return (arr[:, :, 3] > 20) & (arr[:, :, 0] < 80)

def connected_components(mask):
    h, w = mask.shape
    visited = np.zeros((h, w), dtype=bool)
    comps = []
    for y in range(h):
        row = mask[y]
        if not row.any():
            continue
        for x in np.flatnonzero(row):
            if visited[y, x]:
                continue
            q = deque([(int(x), int(y))])
            visited[y, x] = True
            pts = []
            while q:
                cx, cy = q.popleft()
                pts.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        q.append((nx, ny))
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            comps.append({
                "pts": pts,
                "area": len(pts),
                "x0": min(xs), "y0": min(ys),
                "x1": max(xs), "y1": max(ys),
            })
    return comps

def erase_points(arr, pts):
    for x, y in pts:
        arr[y, x] = (0, 0, 0, 0)

def fill_white(arr, pts, pad=0):
    h, w = arr.shape[:2]
    if pad:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        x0, x1 = max(0, min(xs) - pad), min(w, max(xs) + pad + 1)
        y0, y1 = max(0, min(ys) - pad), min(h, max(ys) + pad + 1)
        arr[y0:y1, x0:x1] = (255, 255, 255, 255)
    else:
        for x, y in pts:
            arr[y, x] = (255, 255, 255, 255)

def crop_points(src_arr, pts, pad=0, transparent=True):
    h, w = src_arr.shape[:2]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0, x1 = max(0, min(xs) - pad), min(w, max(xs) + pad + 1)
    y0, y1 = max(0, min(ys) - pad), min(h, max(ys) + pad + 1)
    if transparent:
        out = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
        for x, y in pts:
            out[y - y0, x - x0] = src_arr[y, x]
    else:
        out = np.full((y1 - y0, x1 - x0, 4), 255, dtype=np.uint8)
        out[:, :, 3] = 255
        for x, y in pts:
            out[y - y0, x - x0] = src_arr[y, x]
    return Image.fromarray(out, "RGBA"), (x0, y0, x1, y1)

def sheet(frames, pad_to=None):
    """Horizontal sprite sheet. All frames the same size."""
    if pad_to is None:
        w = max(f.width for f in frames)
        h = max(f.height for f in frames)
    else:
        w, h = pad_to
    out = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        x = i * w + (w - f.width) // 2
        y = (h - f.height) // 2
        out.paste(f, (x, y), f)
    return out, w, h, len(frames)

def scale_nn_centered(im, scale, box=None):
    """Nearest-neighbour scale about the centre, same canvas size."""
    w, h = im.size
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    small = im.resize((nw, nh), Image.NEAREST)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(small, ((w - nw) // 2, (h - nh) // 2), small)
    return canvas

def tiny_plus(w, h, arm=None):
    """A small 4-point plus in the centre of a transparent canvas."""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = im.load()
    cx, cy = w // 2, h // 2
    if arm is None:
        arm = max(2, min(w, h) // 10)
    thick = 1 if min(w, h) < 40 else 2
    for i in range(-arm, arm + 1):
        for t in range(-thick // 2, thick // 2 + 1):
            x, y = cx + i, cy + t
            if 0 <= x < w and 0 <= y < h:
                px[x, y] = (0, 0, 0, 255)
            x, y = cx + t, cy + i
            if 0 <= x < w and 0 <= y < h:
                px[x, y] = (0, 0, 0, 255)
    return im

def tiny_star(w, h):
    """A very small 4-point sparkle (plus with slightly longer arms)."""
    return tiny_plus(w, h, arm=max(3, min(w, h) // 8))

def shorten_toward(arr, pts, cx, cy, trim=5):
    """Trim a few pixels off each ray tip."""
    if not pts:
        return []
    dists = [((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 for x, y in pts]
    cutoff = max(dists) - trim
    return [p for p, d in zip(pts, dists) if d <= cutoff]

# ---------------------------------------------------------------------------
# LOGO
# ---------------------------------------------------------------------------
logo = load_rgba(ROOT / "assets" / "logo.png")
logo_arr = np.array(logo)
lw, lh = logo.size
lmask = ink_mask(logo_arr)
lcomps = connected_components(lmask)

# Identify sparkles / pluses / speed lines by bbox (unique enough)
def find_comp(x0, y0, x1, y1, slack=4):
    for c in lcomps:
        if abs(c["x0"] - x0) <= slack and abs(c["y0"] - y0) <= slack \
           and abs(c["x1"] - x1) <= slack and abs(c["y1"] - y1) <= slack:
            return c
    raise SystemExit(f"logo component not found: {(x0,y0,x1,y1)}")

logo_parts = {
    "sparkle_l": find_comp(36, 271, 189, 457),
    "sparkle_r": find_comp(1199, 157, 1300, 275),
    "plus_l":    find_comp(193, 482, 235, 528),
    "plus_r":    find_comp(1115, 387, 1188, 457),
    "speed_l1":  find_comp(155, 741, 222, 776),
    "speed_l2":  find_comp(147, 799, 213, 827),
    "speed_l3":  find_comp(162, 842, 226, 893),
    "speed_r1":  find_comp(1110, 741, 1184, 782),
    "speed_r2":  find_comp(1127, 799, 1201, 818),
    "speed_r3":  find_comp(1119, 842, 1192, 888),
}

base = logo_arr.copy()
meta = {}  # name -> {box, frames, fw, fh}

def add_twinkle(name, comp, pad=6, kind="star"):
    erase_points(base, comp["pts"])
    im, box = crop_points(logo_arr, comp["pts"], pad=pad, transparent=True)
    w, h = im.size
    if kind == "star":
        frames = [im, scale_nn_centered(im, 0.62), tiny_star(w, h)]
    else:
        frames = [im, scale_nn_centered(im, 0.55), tiny_plus(w, h, arm=max(2, min(w, h)//6))]
    sheet_im, fw, fh, n = sheet(frames, pad_to=(w, h))
    sheet_im.save(FX / f"{name}.png")
    meta[name] = {"box": box, "fw": fw, "fh": fh, "frames": n, "kind": "twinkle"}

add_twinkle("sparkle_l", logo_parts["sparkle_l"], pad=8, kind="star")
add_twinkle("sparkle_r", logo_parts["sparkle_r"], pad=8, kind="star")
add_twinkle("plus_l", logo_parts["plus_l"], pad=6, kind="plus")
add_twinkle("plus_r", logo_parts["plus_r"], pad=6, kind="plus")

def add_speed(name, comps, pad=4):
    pts = []
    for c in comps:
        pts.extend(c["pts"])
        erase_points(base, c["pts"])
    im, box = crop_points(logo_arr, pts, pad=pad, transparent=True)
    w, h = im.size
    # frame 2: slightly shorter lines (scale X toward the banner / inner edge)
    # We'll just scale 0.82 about the vertical centre, horizontal toward the
    # opposite side is handled in CSS via transform-origin. Here: shrink a bit.
    short = scale_nn_centered(im, 0.84)
    sheet_im, fw, fh, n = sheet([im, short], pad_to=(w, h))
    sheet_im.save(FX / f"{name}.png")
    meta[name] = {"box": box, "fw": fw, "fh": fh, "frames": n, "kind": "speed"}

add_speed("speed_l", [logo_parts["speed_l1"], logo_parts["speed_l2"], logo_parts["speed_l3"]])
add_speed("speed_r", [logo_parts["speed_r1"], logo_parts["speed_r2"], logo_parts["speed_r3"]])

Image.fromarray(base, "RGBA").save(ROOT / "assets" / "logo_base.png")

# ---------------------------------------------------------------------------
# MAP
# ---------------------------------------------------------------------------
mp = load_rgba(ROOT / "assets" / "map.png")
mp_arr = np.array(mp)
mw, mh = mp.size
mcomps = connected_components(ink_mask(mp_arr))

def find_m(x0, y0, x1, y1, slack=3):
    for c in mcomps:
        if abs(c["x0"] - x0) <= slack and abs(c["y0"] - y0) <= slack \
           and abs(c["x1"] - x1) <= slack and abs(c["y1"] - y1) <= slack:
            return c
    # fallback: closest by bbox
    best, bestd = None, 1e9
    for c in mcomps:
        d = abs(c["x0"]-x0)+abs(c["y0"]-y0)+abs(c["x1"]-x1)+abs(c["y1"]-y1)
        if d < bestd:
            best, bestd = c, d
    if best and bestd <= 20:
        return best
    raise SystemExit(f"map component not found: {(x0,y0,x1,y1)} closest d={bestd}")

map_base = mp_arr.copy()

# Cloud — opaque white under it (map is opaque), then transparent cut? 
# Map is fully opaque white. For the canvas draw of map_base, we keep opaque
# white where the cloud was, and overlay the drifting cloud on top.
cloud = find_m(285, 66, 396, 125)
# pad so drift doesn't leave a hole; we'll fill a wider white rect
fill_white(map_base, cloud["pts"], pad=2)
im, box = crop_points(mp_arr, cloud["pts"], pad=12, transparent=True)
# For the hole: the cloud overlay must fully cover the erased area even when
# it drifts. We'll fill the original cloud pixels with white (already done).
# Drift is ~10-14% of cloud width (~12px). Pad of 12 on the sprite is for
# rotation/visual, position includes that pad.
im.save(FX / "cloud.png")
meta["cloud"] = {"box": box, "fw": im.width, "fh": im.height, "frames": 1, "kind": "cloud"}

# Sun rays (not the disk)
SUN_CX, SUN_CY = 871.5, 89.5
ray_keys = [
    (822, 120, 837, 141),
    (819, 37, 834, 55),
    (918, 85, 943, 90),
    (871, 136, 876, 158),
    (800, 85, 824, 90),
    (908, 120, 924, 135),
    (909, 37, 927, 55),
    (870, 18, 876, 39),
]
rays = [find_m(*k) for k in ray_keys]
# Square sprite centred on the sun, 144x144 at (800, 18)
SX, SY, SS = 800, 18, 144
full = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
short = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
fp, sp = full.load(), short.load()
for r in rays:
    fill_white(map_base, r["pts"], pad=0)
    short_pts = shorten_toward(mp_arr, r["pts"], SUN_CX, SUN_CY, trim=5)
    for x, y in r["pts"]:
        if 0 <= x - SX < SS and 0 <= y - SY < SS:
            fp[x - SX, y - SY] = tuple(mp_arr[y, x])
    for x, y in short_pts:
        if 0 <= x - SX < SS and 0 <= y - SY < SS:
            sp[x - SX, y - SY] = tuple(mp_arr[y, x])
sheet_im, fw, fh, n = sheet([full, short], pad_to=(SS, SS))
sheet_im.save(FX / "sun_rays.png")
meta["sun_rays"] = {"box": (SX, SY, SX + SS, SY + SS), "fw": fw, "fh": fh, "frames": n, "kind": "sun"}

# Fighters — white out, overlay sprites (single frame; motion is CSS)
fighter_l = find_m(650, 286, 697, 348)
fighter_r = find_m(730, 296, 770, 353)
for name, comp, pad in (("fighter_l", fighter_l, 8), ("fighter_r", fighter_r, 8)):
    fill_white(map_base, comp["pts"], pad=1)
    im, box = crop_points(mp_arr, comp["pts"], pad=pad, transparent=True)
    im.save(FX / f"{name}.png")
    meta[name] = {"box": box, "fw": im.width, "fh": im.height, "frames": 1, "kind": "fighter"}

# Grass tufts
grass_boxes = [
    (205, 460, 220, 474),
    (345, 501, 361, 513),
    (470, 482, 492, 500),
    (586, 536, 600, 548),
    (794, 527, 809, 538),
]
for i, b in enumerate(grass_boxes):
    # pad extra on top and sides for sway
    comp = find_m(*b)
    fill_white(map_base, comp["pts"], pad=1)
    im, box = crop_points(mp_arr, comp["pts"], pad=8, transparent=True)
    im.save(FX / f"grass_{i}.png")
    meta[f"grass_{i}"] = {"box": box, "fw": im.width, "fh": im.height, "frames": 1, "kind": "grass"}

# PLAY NOW sign — frame AND letters (letters are separate components)
play = find_m(602, 414, 815, 474)
# gather every ink pixel inside the sign's bounding box
px0, py0, px1, py1 = play["x0"], play["y0"], play["x1"], play["y1"]
play_pts = [(x, y) for y in range(py0, py1 + 1) for x in range(px0, px1 + 1)
            if ink_mask(mp_arr)[y, x]]
fill_white(map_base, play_pts, pad=1)
im, box = crop_points(mp_arr, play_pts, pad=10, transparent=True)
im.save(FX / "play_now.png")
meta["play_now"] = {"box": box, "fw": im.width, "fh": im.height, "frames": 1, "kind": "play"}

# Door hover: do NOT cut from the base. Draw an ajar leaf over the doorway.
# Measured from the pixel dump (origin x=320): door interior ~ (334, 334)-(376, 392)
# Frame roughly (323, 325)-(382, 393). Overlay covers the opening + a swung leaf.
DOOR = (326, 324, 384, 393)
dx0, dy0, dx1, dy1 = DOOR
dw, dh = dx1 - dx0, dy1 - dy0
door = Image.new("RGBA", (dw, dh), (0, 0, 0, 0))
px = door.load()
# Interior hole (white first to cover knob, then a dark gap on the right
# as the leaf swings left/out).
# Draw a slightly open door: leaf hinged at left, swung maybe 20-25% open,
# revealing a black scribbly gap on the right of the opening.
# Cover the original knob and interior with the new art.
# Opening inside the existing frame (leave frame in the base).
# Interior of original door is about (334-326, 334-324) = (8, 10) to (376-326, 392-324)=(50, 68)
ix0, iy0, ix1, iy1 = 8, 10, 50, 68
# Fill interior white first (erases knob when overlaid), then draw gap + leaf.
for y in range(iy0, iy1):
    for x in range(ix0, ix1):
        px[x, y] = (255, 255, 255, 255)
# Dark gap on the right third of the opening (ajar)
gap_x = ix0 + 28
for y in range(iy0 + 1, iy1 - 1):
    # wobbly gap edge
    wobble = 1 if (y // 3) % 2 == 0 else 0
    for x in range(gap_x + wobble, ix1 - 1):
        px[x, y] = (0, 0, 0, 255)
# Leaf: a vertical panel covering the left+middle, with a knob near the gap
for y in range(iy0 + 1, iy1 - 1):
    # left edge of leaf (just inside frame)
    px[ix0 + 1, y] = (0, 0, 0, 255)
    if y % 5 != 0:
        px[ix0 + 2, y] = (0, 0, 0, 255)
    # right edge of leaf (the gap side)
    wobble = 1 if (y // 4) % 2 == 0 else 0
    px[gap_x - 1 + wobble, y] = (0, 0, 0, 255)
    px[gap_x - 2 + wobble, y] = (0, 0, 0, 255)
# top / bottom of leaf
for x in range(ix0 + 1, gap_x):
    px[x, iy0 + 1] = (0, 0, 0, 255)
    px[x, iy0 + 2] = (0, 0, 0, 255)
    px[x, iy1 - 2] = (0, 0, 0, 255)
    px[x, iy1 - 3] = (0, 0, 0, 255)
# knob on the leaf, near the open edge
kx, ky = gap_x - 8, (iy0 + iy1) // 2
for y in range(ky - 3, ky + 4):
    for x in range(kx - 3, kx + 4):
        if 0 <= x < dw and 0 <= y < dh and (x - kx) ** 2 + (y - ky) ** 2 <= 8:
            px[x, y] = (0, 0, 0, 255)
door.save(FX / "door_open.png")
meta["door_open"] = {"box": DOOR, "fw": dw, "fh": dh, "frames": 1, "kind": "door"}

Image.fromarray(map_base, "RGBA").save(ROOT / "assets" / "map_base.png")

# Write a CSS snippet with exact percentages so we can paste / include.
LOGO_W, LOGO_H = lw, lh
MAP_W, MAP_H = mw, mh

def pct_box(box, W, H):
    x0, y0, x1, y1 = box
    return {
        "left": x0 / W * 100,
        "top": y0 / H * 100,
        "width": (x1 - x0) / W * 100,
        "height": (y1 - y0) / H * 100,
    }

lines = []
lines.append("/* auto-generated positions from build_fx.py — logo % of 1337x954, map % of 1024x596 */")
for name, m in meta.items():
    group = "logo" if name.split("_")[0] in ("sparkle", "plus", "speed") else "map"
    W, H = (LOGO_W, LOGO_H) if group == "logo" else (MAP_W, MAP_H)
    p = pct_box(m["box"], W, H)
    lines.append(
        f"/* {name} box={m['box']} {m['fw']}x{m['fh']} x{m['frames']} */ "
        f"left:{p['left']:.4f}%; top:{p['top']:.4f}%; width:{p['width']:.4f}%; height:{p['height']:.4f}%;"
    )

pos_path = FX / "positions.txt"
pos_path.write_text("\n".join(lines) + "\n")
print("wrote", ROOT / "assets" / "logo_base.png")
print("wrote", ROOT / "assets" / "map_base.png")
print("fx files:")
for p in sorted(FX.iterdir()):
    if p.suffix == ".png":
        im = Image.open(p)
        print(f"  {p.name:16s} {im.size}")
print("\n".join(lines))
