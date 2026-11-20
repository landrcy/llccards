#!/usr/bin/env python3
"""Build LLC Cards game assets: star sprite, 10 card fronts, pack, map, masks."""
from __future__ import annotations

import math
import random
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps
import numpy as np

ROOT = Path("/workspace/llc/game")
ASSETS = ROOT / "assets"
SRC = ASSETS / "src"
REF = Path("/workspace/llc/ref")
MOCK = Path("/workspace/llc/mockup")

sys.path.insert(0, str(MOCK))
import build_v2 as v2

v2.SRC = SRC
v2.FONT_PATH = ASSETS / "fonts" / "MsPaintMouse-Regular.ttf"
v2._font_cache.clear()

CARD_W, CARD_H = 360, 472

CARDS = [
    {
        "id": "dot_dummy",
        "name": "DOT DUMMY",
        "stars": 1,
        "kind": "monster",
        "effect": "Once per turn, this card cannot be destroyed by battle.",
        "atk": 200,
        "def_": 400,
    },
    {
        "id": "smudge",
        "name": "SMUDGE",
        "stars": 1,
        "kind": "trap",
        "effect": "Your opponent's attacking monster loses 300 ATK.",
        "atk": None,
        "def_": None,
    },
    {
        "id": "stick_runner",
        "name": "STICK RUNNER",
        "stars": 2,
        "kind": "monster",
        "effect": "This card can attack the turn it is played.",
        "atk": 500,
        "def_": 200,
    },
    {
        "id": "erase",
        "name": "ERASE",
        "stars": 2,
        "kind": "spell",
        "effect": "Destroy 1 monster with 1000 ATK or less.",
        "atk": None,
        "def_": None,
    },
    {
        "id": "squiggle_worm",
        "name": "SQUIGGLE WORM",
        "stars": 3,
        "kind": "monster",
        "effect": "When this card is played, draw 1 card.",
        "atk": 900,
        "def_": 600,
    },
    {
        "id": "quick_sketch",
        "name": "QUICK SKETCH",
        "stars": 3,
        "kind": "spell",
        "effect": "Draw 2 cards, then discard 1 card.",
        "atk": None,
        "def_": None,
    },
    {
        "id": "whoops",
        "name": "WHOOPS!",
        "stars": 3,
        "kind": "trap",
        "effect": "Negate an attack. That monster loses 400 ATK.",
        "atk": None,
        "def_": None,
    },
    {
        "id": "box_knight",
        "name": "BOX KNIGHT",
        "stars": 4,
        "kind": "monster",
        "effect": "If this card destroys a monster in battle, it gains 200 ATK.",
        "atk": 1400,
        "def_": 1200,
    },
    {
        "id": "ink_flood",
        "name": "INK FLOOD",
        "stars": 4,
        "kind": "spell",
        "effect": "All face-up monsters lose 400 ATK until the end of the turn.",
        "atk": None,
        "def_": None,
    },
    {
        "id": "lord_of_lines",
        "name": "LORD OF LINES",
        "stars": 5,
        "kind": "monster",
        "effect": "Once per turn: this card gains 200 ATK for each monster you control.",
        "atk": 2000,
        "def_": 1600,
    },
]

# Convert recipes. Existing five keep their mockup choices.
ART_RECIPES = {
    "stick_runner": ("A", 208),
    "box_knight": ("A", 208),
    "quick_sketch": ("B", 208),
    "whoops": ("A", 208),
    "lord_of_lines": ("A", 208),
    "dot_dummy": ("A", 208),
    "squiggle_worm": ("A", 208),
    "erase": ("B", 208),
    "ink_flood": ("A", 208),
    "smudge": ("B", 208),
}

STAR_PATH = ASSETS / "star.png"


def extract_star() -> Image.Image:
    """Landry's star: silhouette, native 17x17 grid, solid full black."""
    src = Image.open(REF / "star.png").convert("RGB")
    arr = np.array(src)
    mask = ~((arr[:, :, 0] > 248) & (arr[:, :, 1] > 248) & (arr[:, :, 2] > 248))
    ys, xs = np.where(mask)
    l, t, r, b = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    sil = mask[t:b, l:r].astype(np.uint8)
    rows = cols = 17
    sh, sw = sil.shape
    cw, ch = sw / cols, sh / rows
    grid = np.zeros((rows, cols), dtype=np.uint8)
    for j in range(rows):
        for i in range(cols):
            y0, y1 = int(round(j * ch)), int(round((j + 1) * ch))
            x0, x1 = int(round(i * cw)), int(round((i + 1) * cw))
            cell = sil[y0:y1, x0:x1]
            if cell.size and cell.mean() >= 0.5:
                grid[j, i] = 1
    star = Image.new("RGBA", (cols, rows), (0, 0, 0, 0))
    px = star.load()
    for j in range(rows):
        for i in range(cols):
            if grid[j, i]:
                px[i, j] = (0, 0, 0, 255)
    star.save(STAR_PATH)
    # preview at 16x on white for review
    prev = Image.new("RGB", (cols * 16, rows * 16), (255, 255, 255))
    big = star.resize((cols * 16, rows * 16), Image.Resampling.NEAREST)
    prev.paste(Image.new("RGB", big.size, (255, 255, 255)), (0, 0))
    prev.paste(big.convert("RGB"), (0, 0), big)
    prev.save(ASSETS / "star_preview.png")
    print("star", star.size, "ink", int(grid.sum()))
    return star


def stamp_star_sprite(im: Image.Image, x, y, star: Image.Image):
    im.alpha_composite(star, (int(x), int(y)))


def build_card(spec, arts, star, cw=CARD_W, ch=CARD_H):
    """Same layout as mockup v2, but Landry's solid star and no baked FOIL label."""
    seed = 300 + sum(ord(c) for c in spec["id"])
    ink = v2.Canvas(cw, ch, seed=seed)
    kind = spec["kind"]

    margin = 7
    outer_thick = 9
    rad = 22
    ox, oy = margin + 4, margin + 4
    ow, oh = cw - 2 * (margin + 4) - 1, ch - 2 * (margin + 4) - 1
    outer_pts, _ = ink.wobble_roundrect(ox, oy, ow, oh, r_corner=rad, thick=outer_thick, jitter=1.5)

    v2.paste_text(ink.im, spec["name"], (28, 22), size=24, fill=v2.BLACK, anchor="lt")

    star_y = 54
    total = spec["stars"]
    star_w, gap = star.size[0], 3
    block = total * star_w + (total - 1) * gap
    sx = cw - 32 - block
    star_pos = [(sx + i * (star_w + gap), star_y) for i in range(total)]

    art_n = v2.ART_PX * 3
    win = 252
    wx = (cw - win) // 2
    wy = 76
    ax = wx + (win - art_n) // 2
    ay = wy + (win - art_n) // 2
    art_pts, _ = ink.wobble_roundrect(wx, wy, win, win, r_corner=12, thick=5, jitter=1.2)

    type_y = wy + win + 12
    if kind == "spell":
        label, ico = "[ SPELL ]", v2.icon_spell()
    elif kind == "trap":
        label, ico = "[ TRAP ]", v2.icon_trap()
    else:
        label, ico = "[ MONSTER ]", v2.icon_monster()

    if kind == "trap":
        bar_x, bar_w, bar_h = 28, cw - 56, 30
        bar_pts, _ = ink.wobble_roundrect(bar_x, type_y, bar_w, bar_h, r_corner=14, thick=3.5, jitter=1.0)
        ink.fill_polygon(bar_pts[:-1] if bar_pts[-1] == bar_pts[0] else bar_pts, color=v2.BLACK)
        ink.stroke_points(bar_pts, 1.5)
        effect_y = type_y + bar_h + 10
        trap_bar = (bar_x, type_y, bar_w, bar_h)
        ico_pos = None
    else:
        trap_bar = None
        ico_x, ico_y = 28, type_y + 2
        underline_y = type_y + 24
        ink.wobble_line(28, underline_y, cw - 28, underline_y, thick=2.4, jitter=1.3, overshoot=5)
        if kind == "spell":
            ink.wobble_line(30, underline_y + 5, cw - 30, underline_y + 5, thick=2.2, jitter=1.2, overshoot=4)
        effect_y = type_y + 34
        ico_pos = (ico_x, ico_y)

    max_w = cw - 56
    lines = v2.wrap_text(spec["effect"], size=16, max_width=max_w)
    if spec["atk"] is not None:
        ink.wobble_line(28, ch - 48, cw - 28, ch - 48, thick=2.4, jitter=1.2, overshoot=5)
    else:
        ink.wobble_line(28, ch - 36, cw - 36, ch - 36, thick=2.2, jitter=1.2, overshoot=4)

    rgba = v2.flood_outside_transparent(ink.im)
    cx, cy = cw // 2, ch // 2
    if rgba.getpixel((cx, cy))[3] == 0:
        rgba = Image.new("RGBA", (cw, ch), (255, 255, 255, 255))
        L = ink.im
        rgba.paste((0, 0, 0, 255), mask=L.point(lambda p: 255 if p < 128 else 0))

    for x, y in star_pos:
        stamp_star_sprite(rgba, x, y, star)

    art = arts[spec["id"]].resize((art_n, art_n), Image.Resampling.NEAREST)
    rgba.alpha_composite(v2.rgba_ink(art), (ax, ay))

    if kind == "trap":
        ico_im = ico
        bx, by, bw, bh = trap_bar
        for j in range(ico_im.size[1]):
            for i in range(ico_im.size[0]):
                if ico_im.getpixel((i, j)) < 128:
                    xx, yy = bx + 10 + i, by + 6 + j
                    if 0 <= xx < cw and 0 <= yy < ch:
                        rgba.putpixel((xx, yy), (255, 255, 255, 255))
        v2.paste_text(rgba, label, (bx + bw // 2 + 6, by + 5), size=16, fill=v2.WHITE, anchor="ct")
    else:
        rgba.alpha_composite(v2.rgba_ink(ico), ico_pos)
        v2.paste_text(rgba, label, (ico_pos[0] + 22, type_y), size=16, fill=v2.BLACK, anchor="lt")

    ey = effect_y
    for ln in lines[:4]:
        v2.paste_text(rgba, ln, (28, ey), size=16, fill=v2.BLACK, anchor="lt")
        ey += 19

    if spec["atk"] is not None:
        stats = f"ATK {spec['atk']}  /  DEF {spec['def_']}"
        v2.paste_text(rgba, stats, (cw // 2, ch - 38), size=17, fill=v2.BLACK, anchor="ct")

    # Body mask as RGBA alpha (white=opaque) for CSS mask-image
    body = Image.new("L", (cw, ch), 0)
    srcpx = rgba.load()
    bpx = body.load()
    for y in range(ch):
        for x in range(cw):
            if srcpx[x, y][3] > 0:
                bpx[x, y] = 255
    body_rgba = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    body_rgba.paste((255, 255, 255, 255), mask=body)
    return rgba, body_rgba


def convert_all_art():
    arts = {}
    # also dump A/B contact for new cards
    new_ids = ["dot_dummy", "smudge", "erase", "squiggle_worm", "ink_flood"]
    previews = []
    for name, (recipe, thresh) in ART_RECIPES.items():
        im = v2.convert_art(name, recipe, thresh, v2.ART_PX)
        arts[name] = im
        im.save(ASSETS / "art" / f"{name}_80.png")
        im.resize((v2.ART_PX * 8, v2.ART_PX * 8), Image.Resampling.NEAREST).save(
            ASSETS / "art" / f"{name}_x8.png"
        )
        if name in new_ids:
            # also produce the other recipe for QA
            other = "B" if recipe == "A" else "A"
            alt = v2.convert_art(name, other, thresh, v2.ART_PX)
            alt.resize((v2.ART_PX * 8, v2.ART_PX * 8), Image.Resampling.NEAREST).save(
                ASSETS / "art" / f"{name}_alt_{other}_x8.png"
            )
        print("art", name, recipe, thresh)
    return arts


def make_pack():
    """Sketchy Edition One booster wrapper, logo on front, jagged rip halves."""
    w, h = 280, 400
    c = v2.Canvas(w, h, seed=77)
    # outer pack body
    pts, _ = c.wobble_roundrect(18, 16, 244, 368, r_corner=20, thick=8, jitter=1.8)
    # inner panel
    c.wobble_roundrect(36, 34, 208, 200, r_corner=14, thick=4, jitter=1.2)
    # banner box near the bottom
    bpts, _ = c.wobble_roundrect(40, 250, 200, 70, r_corner=16, thick=4.5, jitter=1.2)
    # a few sparkles (plus signs / 4-point)
    def sparkle(cx, cy, arm=10, thick=3):
        c.wobble_line(cx - arm, cy, cx + arm, cy, thick, jitter=0.3, overshoot=0)
        c.wobble_line(cx, cy - arm, cx, cy + arm, thick, jitter=0.3, overshoot=0)
    sparkle(40, 40, 8, 2.6)
    sparkle(240, 46, 7, 2.4)
    sparkle(48, 236, 7, 2.4)
    sparkle(232, 340, 9, 2.8)
    sparkle(44, 360, 6, 2.2)

    rgba = v2.flood_outside_transparent(c.im)
    if rgba.getpixel((w // 2, h // 2))[3] == 0:
        rgba = Image.new("RGBA", (w, h), (255, 255, 255, 255))
        rgba.paste((0, 0, 0, 255), mask=c.im.point(lambda p: 255 if p < 128 else 0))

    # paste logo into the upper panel
    logo = Image.open(ASSETS / "logo.png").convert("RGBA")
    # contain into ~190x170
    box_w, box_h = 190, 170
    lw, lh = logo.size
    s = min(box_w / lw, box_h / lh)
    lw2, lh2 = max(1, int(lw * s)), max(1, int(lh * s))
    logo_r = logo.resize((lw2, lh2), Image.Resampling.NEAREST)
    lx = (w - lw2) // 2
    ly = 44 + (180 - lh2) // 2
    rgba.alpha_composite(logo_r, (lx, ly))

    v2.paste_text(rgba, "EDITION ONE", (w // 2, 264), size=26, fill=v2.BLACK, anchor="ct")
    v2.paste_text(rgba, "10 CARDS", (w // 2, 296), size=18, fill=v2.BLACK, anchor="ct")

    rgba.save(ASSETS / "pack_edition_one.png")

    # Locked / coming soon pack
    c2 = v2.Canvas(w, h, seed=88)
    c2.wobble_roundrect(18, 16, 244, 368, r_corner=20, thick=6, jitter=1.8)
    # dashed inner by drawing short ticks
    rng = c2.rng
    # big question mark will be text
    # padlock body
    c2.wobble_roundrect(110, 170, 60, 50, r_corner=8, thick=5, jitter=0.8)
    # shackle
    sh = []
    for i in range(16):
        a = math.pi + i / 15 * math.pi
        sh.append((140 + math.cos(a) * 22, 170 + math.sin(a) * 20))
    c2.stroke_points(sh, 2.6)
    c2.stamp(140, 194, 4)
    rgba2 = v2.flood_outside_transparent(c2.im)
    if rgba2.getpixel((w // 2, h // 2))[3] == 0:
        rgba2 = Image.new("RGBA", (w, h), (255, 255, 255, 255))
        rgba2.paste((0, 0, 0, 255), mask=c2.im.point(lambda p: 255 if p < 128 else 0))
    v2.paste_text(rgba2, "???", (w // 2, 110), size=48, fill=v2.BLACK, anchor="ct")
    v2.paste_text(rgba2, "COMING SOON", (w // 2, 280), size=22, fill=v2.BLACK, anchor="ct")
    rgba2.save(ASSETS / "pack_locked.png")

    # Jagged rip: split pack into top / bottom with a shared jagged edge around y=150
    rng = random.Random(123)
    jagged = []
    ymid = 150
    x = 0
    y = ymid
    while x <= w:
        jagged.append((x, int(y)))
        x += rng.randint(6, 14)
        y = ymid + rng.randint(-18, 18)
    jagged.append((w, ymid + rng.randint(-8, 8)))

    def split(src, keep="top"):
        out = Image.new("RGBA", src.size, (0, 0, 0, 0))
        # mask
        m = Image.new("L", src.size, 0)
        # polygon: top = (0,0) + jagged + (w,0); bottom = (0,h) + jagged + (w,h)
        if keep == "top":
            poly = [(0, 0)] + jagged + [(w, 0)]
        else:
            poly = [(0, h)] + jagged + [(w, h)]
        ImageDraw.Draw(m).polygon(poly, fill=255)
        out = Image.new("RGBA", src.size, (0, 0, 0, 0))
        out.paste(src, (0, 0), ImageChops_and(src, m))
        # draw the rip edge in black on the cut
        d = ImageDraw.Draw(out)
        # stamp along jagged with a slightly messy stroke
        edge = Image.new("L", src.size, 0)
        ed = ImageDraw.Draw(edge)
        ed.line(jagged, fill=255, width=4)
        # sprinkle a few tear whiskers
        for i in range(0, len(jagged) - 1, 2):
            x0, y0 = jagged[i]
            ang = rng.uniform(-1.2, 1.2)
            length = rng.randint(6, 16)
            x1 = x0 + int(math.cos(ang) * length)
            y1 = y0 + int((1 if keep == "bottom" else -1) * length * 0.7)
            ed.line([(x0, y0), (x1, y1)], fill=255, width=2)
        ink = Image.new("RGBA", src.size, (0, 0, 0, 0))
        ink.paste((0, 0, 0, 255), mask=edge)
        out.alpha_composite(ink)
        # keep original alpha of pack AND the split, plus rip ink
        return out

    def ImageChops_and(src, m):
        # src alpha * mask
        a = src.split()[-1]
        from PIL import ImageChops
        na = ImageChops.multiply(a, m)
        out = src.copy()
        out.putalpha(na)
        return out

    top = split(rgba, "top")
    bot = split(rgba, "bottom")
    top.save(ASSETS / "pack_rip_top.png")
    bot.save(ASSETS / "pack_rip_bottom.png")
    print("packs written")
    return jagged


def make_map():
    """Minimalist scribbly B&W town map with Shop and Battle."""
    w, h = 1100, 720
    c = v2.Canvas(w, h, seed=2026)

    # Ground / horizon
    c.wobble_line(20, 430, 1080, 450, thick=4.5, jitter=3.0, overshoot=8)
    # Second ground scribble
    c.wobble_line(30, 500, 1070, 490, thick=2.4, jitter=2.2, overshoot=6)

    # Path from bottom to the two places (Y fork)
    c.wobble_line(550, 700, 540, 560, thick=7, jitter=2.0, overshoot=4)
    c.wobble_line(540, 560, 340, 480, thick=6.5, jitter=2.2, overshoot=2)
    c.wobble_line(540, 560, 760, 490, thick=6.5, jitter=2.2, overshoot=2)
    # path edges, slightly thinner
    c.wobble_line(530, 700, 520, 555, thick=2.2, jitter=1.6, overshoot=2)
    c.wobble_line(570, 700, 560, 555, thick=2.2, jitter=1.6, overshoot=2)

    # Grass tufts
    rng = c.rng
    for _ in range(28):
        gx = rng.uniform(40, 1060)
        gy = rng.uniform(470, 690)
        for k in range(3):
            c.wobble_line(gx + k * 4 - 4, gy, gx + k * 4 - 4 + rng.uniform(-3, 3), gy - rng.uniform(8, 16),
                          thick=1.8, jitter=0.4, overshoot=0)

    # Sun (top right)
    sun_x, sun_y, sun_r = 980, 90, 38
    ring = [(sun_x + math.cos(i / 20 * 2 * math.pi) * sun_r,
             sun_y + math.sin(i / 20 * 2 * math.pi) * sun_r) for i in range(21)]
    c.stroke_points(ring, 2.4)
    for i in range(10):
        a = i * math.pi / 5 + 0.2
        c.wobble_line(sun_x + math.cos(a) * (sun_r + 8), sun_y + math.sin(a) * (sun_r + 8),
                      sun_x + math.cos(a) * (sun_r + 26), sun_y + math.sin(a) * (sun_r + 26),
                      thick=2.6, jitter=0.3, overshoot=0)

    # Clouds
    def cloud(cx, cy, s=1.0):
        for ox, oy, r in [(-30, 0, 16), (0, -8, 20), (28, 2, 15), (10, 8, 14)]:
            ring = [(cx + ox * s + math.cos(i / 14 * 2 * math.pi) * r * s,
                     cy + oy * s + math.sin(i / 14 * 2 * math.pi) * r * s) for i in range(15)]
            c.stroke_points(ring, 1.8)
    cloud(180, 90, 1.1)
    cloud(430, 70, 0.8)

    # Tree on far left
    tx, ty = 90, 430
    c.wobble_line(tx, ty, tx - 4, ty + 90, thick=7, jitter=1.0, overshoot=0)
    for ox, oy, r in [(-18, -10, 22), (8, -24, 26), (22, -4, 20), (-4, 10, 18)]:
        ring = [(tx + ox + math.cos(i / 14 * 2 * math.pi) * r,
                 ty + oy + math.sin(i / 14 * 2 * math.pi) * r) for i in range(15)]
        c.stroke_points(ring, 2.2)

    # ---- SHOP building (left-center) ----
    # body
    sx, sy, sw, sh_ = 230, 230, 280, 230
    shop_pts, _ = c.wobble_roundrect(sx, sy + 40, sw, sh_ - 40, r_corner=8, thick=6.5, jitter=1.6)
    # roof / awning triangle-ish
    roof = [(sx - 16, sy + 50), (sx + sw / 2, sy - 10), (sx + sw + 16, sy + 50), (sx - 16, sy + 50)]
    c.stroke_points(roof, 3.4)
    # awning stripes
    c.wobble_line(sx - 10, sy + 50, sx + sw + 10, sy + 50, thick=5.5, jitter=1.0, overshoot=2)
    c.wobble_line(sx - 8, sy + 66, sx + sw + 8, sy + 66, thick=3.5, jitter=1.0, overshoot=2)
    for i in range(8):
        x0 = sx + 10 + i * 34
        c.wobble_line(x0, sy + 50, x0 + 10, sy + 66, thick=2.4, jitter=0.3, overshoot=0)
    # door
    c.wobble_roundrect(sx + 110, sy + 150, 60, 76, r_corner=6, thick=4.5, jitter=0.8)
    c.stamp(sx + 158, sy + 190, 3)
    # windows
    c.wobble_roundrect(sx + 30, sy + 110, 70, 56, r_corner=4, thick=4, jitter=0.7)
    c.wobble_line(sx + 30, sy + 138, sx + 100, sy + 138, thick=2.2, jitter=0.4, overshoot=0)
    c.wobble_line(sx + 65, sy + 110, sx + 65, sy + 166, thick=2.2, jitter=0.4, overshoot=0)
    c.wobble_roundrect(sx + 180, sy + 110, 70, 56, r_corner=4, thick=4, jitter=0.7)
    c.wobble_line(sx + 180, sy + 138, sx + 250, sy + 138, thick=2.2, jitter=0.4, overshoot=0)
    c.wobble_line(sx + 215, sy + 110, sx + 215, sy + 166, thick=2.2, jitter=0.4, overshoot=0)
    # hanging sign
    c.wobble_line(sx + sw - 10, sy + 70, sx + sw + 30, sy + 110, thick=3, jitter=0.4, overshoot=0)
    sign_pts, _ = c.wobble_roundrect(sx + sw - 10, sy + 105, 120, 48, r_corner=10, thick=4.5, jitter=0.9)

    # ---- BATTLE arena (right of shop) ----
    bx, by = 700, 280
    # oval ring
    oval = []
    for i in range(28):
        a = i / 27 * 2 * math.pi
        oval.append((bx + 160 + math.cos(a) * 150 + c.rng.uniform(-3, 3),
                     by + 140 + math.sin(a) * 90 + c.rng.uniform(-3, 3)))
    oval.append(oval[0])
    c.stroke_points(oval, 3.4)
    # inner oval
    oval2 = []
    for i in range(24):
        a = i / 23 * 2 * math.pi
        oval2.append((bx + 160 + math.cos(a) * 118,
                      by + 140 + math.sin(a) * 64))
    oval2.append(oval2[0])
    c.stroke_points(oval2, 2.2)
    # posts
    for a in (0.2, 1.1, 2.2, 3.4, 4.5, 5.5):
        px = bx + 160 + math.cos(a) * 150
        py = by + 140 + math.sin(a) * 90
        c.wobble_line(px, py, px, py - 28, thick=3.5, jitter=0.4, overshoot=0)
    # two tiny stick fighters
    def fighter(fx, fy, facing=1):
        c.stamp(fx, fy, 5)  # head
        c.wobble_line(fx, fy + 6, fx, fy + 28, thick=3, jitter=0.3, overshoot=0)
        c.wobble_line(fx, fy + 12, fx + 14 * facing, fy + 4, thick=2.4, jitter=0.3, overshoot=0)
        c.wobble_line(fx, fy + 12, fx - 12 * facing, fy + 16, thick=2.4, jitter=0.3, overshoot=0)
        c.wobble_line(fx, fy + 28, fx + 10 * facing, fy + 44, thick=2.4, jitter=0.3, overshoot=0)
        c.wobble_line(fx, fy + 28, fx - 8 * facing, fy + 44, thick=2.4, jitter=0.3, overshoot=0)
        # little sword / stick
        c.wobble_line(fx + 14 * facing, fy + 4, fx + 26 * facing, fy - 8, thick=2.2, jitter=0.2, overshoot=0)
    fighter(bx + 120, by + 110, 1)
    fighter(bx + 210, by + 118, -1)
    # battle sign
    c.wobble_roundrect(bx + 70, by - 20, 180, 50, r_corner=10, thick=4.5, jitter=0.9)
    # coming soon plank
    c.wobble_roundrect(bx + 55, by + 220, 210, 36, r_corner=6, thick=3.5, jitter=0.8)

    # small fence near battle
    for i in range(5):
        fx = 980 + i * 22
        c.wobble_line(fx, 500, fx, 540, thick=2.6, jitter=0.3, overshoot=0)
    c.wobble_line(976, 512, 1070, 512, thick=2.2, jitter=0.6, overshoot=0)

    rgba = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    rgba.paste((0, 0, 0, 255), mask=c.im.point(lambda p: 255 if p < 128 else 0))

    # Labels
    v2.paste_text(rgba, "SHOP", (sx + sw // 2, sy + 18), size=36, fill=v2.BLACK, anchor="ct")
    # hanging sign text
    v2.paste_text(rgba, "SHOP", (sx + sw + 50, sy + 118), size=22, fill=v2.BLACK, anchor="ct")
    v2.paste_text(rgba, "BATTLE", (bx + 160, by + 2), size=32, fill=v2.BLACK, anchor="ct")
    v2.paste_text(rgba, "COMING SOON", (bx + 160, by + 228), size=18, fill=v2.BLACK, anchor="ct")
    v2.paste_text(rgba, "THE MAP", (w // 2, 28), size=28, fill=v2.BLACK, anchor="ct")

    rgba.save(ASSETS / "map.png")
    # white-bg preview already is white
    print("map written", rgba.size)

    # Hotspots in percentages of the map image (for the game)
    # shop building roughly x 214-530, y 220-460
    # battle ring roughly x 700-1010, y 260-530
    hotspots = {
        "shop": {"x": 214 / w, "y": 210 / h, "w": 330 / w, "h": 260 / h},
        "battle": {"x": 690 / w, "y": 250 / h, "w": 330 / w, "h": 290 / h},
    }
    (ASSETS / "map_hotspots.json").write_text(
        __import__("json").dumps(hotspots, indent=2), encoding="utf-8"
    )
    return rgba


def compose_set_sheet(cards_rgba):
    n = len(cards_rgba)
    gap = 16
    pad = 20
    w = pad * 2 + n * CARD_W + (n - 1) * gap
    # two rows of 5
    cols = 5
    rows = 2
    W = pad * 2 + cols * CARD_W + (cols - 1) * gap
    H = pad * 2 + rows * CARD_H + (rows - 1) * gap + 40
    sheet = Image.new("RGB", (W, H), (255, 255, 255))
    for i, im in enumerate(cards_rgba):
        r, c = divmod(i, cols)
        x = pad + c * (CARD_W + gap)
        y = pad + r * (CARD_H + gap)
        if im.mode == "RGBA":
            sheet.paste(im, (x, y), im)
        else:
            sheet.paste(im, (x, y))
    sheet.save(ASSETS / "set_sheet.png")
    print("set sheet", sheet.size)


def main():
    star = extract_star()
    arts = convert_all_art()
    built = []
    for spec in CARDS:
        rgba, body = build_card(spec, arts, star)
        rgba.save(ASSETS / "cards" / f"{spec['id']}.png")
        body.save(ASSETS / "masks" / f"{spec['id']}.png")
        built.append(rgba)
        print("card", spec["name"], rgba.size)
    compose_set_sheet(built)
    make_pack()
    make_map()
    print("done")


if __name__ == "__main__":
    main()
