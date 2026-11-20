#!/usr/bin/env python3
"""Pixel UI chrome, pixel map, and card/pack rebuild with Bagel Fat One + stick art."""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path("/workspace/llc/game")
ASSETS = ROOT / "assets"
UI = ASSETS / "ui"
FONT = ASSETS / "fonts" / "BagelFatOne-Regular.ttf"

sys.path.insert(0, "/workspace/llc/mockup")
sys.path.insert(0, str(ROOT))
import build_v2 as v2
import build_assets as ba

v2.FONT_PATH = FONT
v2._font_cache.clear()
ba.v2 = v2

# Slightly shorter effects so the blobby font stays readable at card size.
SHORT_FX = {
    "dot_dummy": "Once per turn: cannot be destroyed by battle.",
    "smudge": "An attacking monster loses 300 ATK.",
    "stick_runner": "Can attack the turn it is played.",
    "erase": "Destroy 1 monster with 1000 ATK or less.",
    "squiggle_worm": "When played, draw 1 card.",
    "quick_sketch": "Draw 2 cards, then discard 1 card.",
    "whoops": "Negate an attack. That monster loses 400 ATK.",
    "box_knight": "If this destroys a monster in battle, it gains 200 ATK.",
    "ink_flood": "All monsters lose 400 ATK until end of turn.",
    "lord_of_lines": "Once per turn: gains 200 ATK for each monster you control.",
}


# ---------------------------------------------------------------------------
# Tiny 1-bit pixel canvas (integer coords, 1px stroke)
# ---------------------------------------------------------------------------
class Pix:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.p = [0] * (w * h)

    def _i(self, x, y):
        return y * self.w + x

    def set(self, x, y, v=1):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            self.p[self._i(x, y)] = 1 if v else 0

    def get(self, x, y):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.p[self._i(x, y)]
        return 0

    def line(self, x0, y0, x1, y1, v=1):
        x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
        dx, dy = abs(x1 - x0), abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx - dy
        while True:
            self.set(x0, y0, v)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x0 += sx
            if e2 < dx:
                err += dx
                y0 += sy

    def rect(self, x, y, w, h, fill=False):
        x, y, w, h = int(x), int(y), int(w), int(h)
        if fill:
            for yy in range(y, y + h):
                for xx in range(x, x + w):
                    self.set(xx, yy, 1)
        else:
            self.line(x, y, x + w - 1, y)
            self.line(x, y + h - 1, x + w - 1, y + h - 1)
            self.line(x, y, x, y + h - 1)
            self.line(x + w - 1, y, x + w - 1, y + h - 1)

    def ellipse(self, cx, cy, rx, ry, fill=False):
        # Midpoint ellipse, outline only (or fill)
        cx, cy, rx, ry = int(cx), int(cy), int(rx), int(ry)
        pts = []
        for i in range(360):
            a = math.radians(i)
            pts.append((int(round(cx + math.cos(a) * rx)), int(round(cy + math.sin(a) * ry))))
        if fill:
            # scanline from unique outline
            rows = {}
            for x, y in pts:
                rows.setdefault(y, []).append(x)
            for y, xs in rows.items():
                if xs:
                    for x in range(min(xs), max(xs) + 1):
                        self.set(x, y, 1)
        else:
            for i in range(len(pts)):
                self.set(*pts[i], 1)

    def to_image(self, scale=4) -> Image.Image:
        im = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        px = im.load()
        for y in range(self.h):
            for x in range(self.w):
                if self.p[self._i(x, y)]:
                    px[x, y] = (0, 0, 0, 255)
                else:
                    px[x, y] = (255, 255, 255, 255)
        if scale != 1:
            im = im.resize((self.w * scale, self.h * scale), Image.Resampling.NEAREST)
        return im

    def to_transparent(self, scale=4, paper=False) -> Image.Image:
        im = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        px = im.load()
        for y in range(self.h):
            for x in range(self.w):
                if self.p[self._i(x, y)]:
                    px[x, y] = (0, 0, 0, 255)
                elif paper:
                    px[x, y] = (255, 255, 255, 255)
        if scale != 1:
            im = im.resize((self.w * scale, self.h * scale), Image.Resampling.NEAREST)
        return im


def paste_label(rgba: Image.Image, text, xy, size, anchor="ct"):
    v2.paste_text(rgba, text, xy, size=size, fill=v2.BLACK, anchor=anchor)


# ---------------------------------------------------------------------------
# MAP — 256x176, 1px stroke, 4x nearest = 1024x704
# ---------------------------------------------------------------------------
def build_map():
    W, H, G = 256, 176, 112  # ground y
    SCALE = 4
    p = Pix(W, H)

    # Ground, one consistent line (with a 1px step only at the path junction, still 1px thick)
    p.line(4, G, 46, G)
    # shop sits on ground: skip under the shop footprint, resume between buildings, skip under arena, resume
    # shop x=40..124, arena ~148..236
    p.line(4, G, 39, G)
    p.line(125, G, 147, G)
    p.line(237, G, 251, G)

    # Path: from bottom center up, fork to shop DOOR and arena entrance
    # door will be at (74, G-20)..(74, G)
    p.line(128, H - 3, 128, G + 10)
    p.line(127, H - 3, 127, G + 10)  # 2-wide path so it reads as a road, both 1px neighbors = even 2px band
    p.line(129, H - 3, 129, G + 10)
    # left branch to shop door (cx 82)
    p.line(128, G + 10, 82, G)
    p.line(127, G + 10, 81, G)
    p.line(129, G + 10, 83, G)
    # right branch to arena bottom
    p.line(128, G + 10, 190, G)
    p.line(127, G + 10, 189, G)
    p.line(129, G + 10, 191, G)

    # Grass tufts (tiny 2-3px marks), same 1px weight
    rng = random.Random(7)
    for _ in range(22):
        gx = rng.randint(8, 248)
        gy = rng.randint(G + 8, H - 6)
        # keep off the central path
        if 122 <= gx <= 134 and gy > G + 8:
            continue
        p.line(gx, gy, gx, gy - 3)
        p.line(gx - 2, gy - 1, gx, gy - 3)
        p.line(gx + 2, gy - 1, gx, gy - 3)

    # Sun (top right) — 1px circle + 1px rays, fully in bounds
    sx, sy, sr = 228, 22, 12
    p.ellipse(sx, sy, sr, sr, fill=False)
    for i in range(8):
        a = math.radians(i * 45)
        p.line(
            int(sx + math.cos(a) * (sr + 3)),
            int(sy + math.sin(a) * (sr + 3)),
            int(sx + math.cos(a) * (sr + 8)),
            int(sy + math.sin(a) * (sr + 8)),
        )

    # One cloud, left of sun, simple 3-hump, 1px, fully in bounds
    def cloud(cx, cy):
        p.ellipse(cx - 10, cy, 8, 5, fill=False)
        p.ellipse(cx, cy - 3, 9, 6, fill=False)
        p.ellipse(cx + 10, cy, 7, 5, fill=False)
        p.line(cx - 17, cy + 4, cx + 16, cy + 4)
    cloud(70, 22)

    # Tree, far left, same 1px weight, sits on the ground
    tx, ty = 22, G
    p.line(tx, ty, tx, ty - 36)  # trunk
    # canopy: a simple jagged blob of 1px outline
    canopy = [
        (tx, ty - 58), (tx + 12, ty - 52), (tx + 16, ty - 40),
        (tx + 10, ty - 32), (tx - 10, ty - 32), (tx - 16, ty - 42),
        (tx - 12, ty - 54), (tx, ty - 58),
    ]
    for a, b in zip(canopy, canopy[1:]):
        p.line(*a, *b)
    # a couple of inner leaf marks
    p.line(tx - 4, ty - 48, tx + 3, ty - 42)
    p.line(tx + 2, ty - 50, tx + 8, ty - 44)

    # ---- SHOP, sitting on the ground. One sign on the facade, not on the roof. ----
    # body
    shx, shy, shw, shh = 40, G - 56, 84, 56
    p.rect(shx, shy, shw, shh, fill=False)
    # flat awning / roof cap (does not contain text)
    p.line(shx - 6, shy, shx + shw + 5, shy)
    p.line(shx - 4, shy - 6, shx + shw + 3, shy - 6)
    p.line(shx - 6, shy, shx - 4, shy - 6)
    p.line(shx + shw + 5, shy, shx + shw + 3, shy - 6)
    # awning stripes (1px ticks)
    for i in range(8):
        x = shx + 6 + i * 10
        p.line(x, shy - 6, x + 4, shy)
    # door, on the ground
    dw, dh = 16, 20
    dx, dy = shx + 34, G - dh
    p.rect(dx, dy, dw, dh, fill=False)
    p.set(dx + dw - 4, dy + dh // 2)  # knob
    # two windows
    p.rect(shx + 8, shy + 16, 18, 14, fill=False)
    p.line(shx + 8 + 9, shy + 16, shx + 8 + 9, shy + 29)
    p.line(shx + 8, shy + 23, shx + 25, shy + 23)
    p.rect(shx + shw - 26, shy + 16, 18, 14, fill=False)
    p.line(shx + shw - 17, shy + 16, shx + shw - 17, shy + 29)
    p.line(shx + shw - 26, shy + 23, shx + shw - 8, shy + 23)
    # Facade sign — reserved box UNDER the awning, on the wall, fully inside the building
    # leave it empty for text after upscale
    sign = (shx + 18, shy + 2, 48, 12)  # x,y,w,h native
    p.rect(*sign, fill=False)

    # ---- BATTLE arena sitting on the ground ----
    acx, acy, arx, ary = 190, G - 26, 42, 22
    p.ellipse(acx, acy, arx, ary, fill=False)
    p.ellipse(acx, acy, arx - 6, ary - 5, fill=False)
    # posts around the ring (short 1px sticks)
    for a in (20, 80, 140, 200, 260, 320):
        ang = math.radians(a)
        px = int(round(acx + math.cos(ang) * arx))
        py = int(round(acy + math.sin(ang) * ary))
        p.line(px, py, px, py - 6)
    # two tiny stick fighters (1px, inside the inner oval)
    def fighter(fx, fy, face):
        p.ellipse(fx, fy, 2, 2, fill=False)  # head (tiny)
        p.set(fx, fy)  # fill the 2px head a bit
        p.line(fx, fy + 2, fx, fy + 8)  # body
        p.line(fx, fy + 4, fx + 5 * face, fy + 1)  # front arm / weapon
        p.line(fx, fy + 4, fx - 4 * face, fy + 6)
        p.line(fx, fy + 8, fx + 4 * face, fy + 14)
        p.line(fx, fy + 8, fx - 3 * face, fy + 14)
        p.line(fx + 5 * face, fy + 1, fx + 8 * face, fy - 3)  # sword
    fighter(acx - 12, acy - 4, 1)
    fighter(acx + 14, acy - 2, -1)
    # BATTLE sign — reserved box ABOVE the ring, with a gap, fully in bounds
    bsign = (acx - 28, 36, 56, 13)
    p.rect(*bsign, fill=False)
    # posts from sign to ring
    p.line(bsign[0] + 8, bsign[1] + bsign[3], int(acx - 20), int(acy - ary))
    p.line(bsign[0] + bsign[2] - 9, bsign[1] + bsign[3], int(acx + 20), int(acy - ary))
    # COMING SOON plank BELOW the ring, on/just under the ground, no overlap with the oval
    # oval bottom is acy+ary = G-26+22 = G-4, so plank starts at G+2
    csign = (acx - 32, G + 3, 64, 12)
    p.rect(*csign, fill=False)

    # small fence far right, on the ground
    for i in range(4):
        fx = 240 + i * 3
        p.line(fx, G, fx, G - 8)
    p.line(240, G - 5, 251, G - 5)

    rgba = p.to_image(scale=SCALE)  # white paper, black ink, 1024x704
    # Paste labels into reserved boxes (at display resolution) so letters never clip the box.
    def label_in_box(box_native, text, size):
        x, y, w, h = [v * SCALE for v in box_native]
        # fill the interior white first (keep the 1px*scale border)
        inset = SCALE
        ImageDraw.Draw(rgba).rectangle(
            [x + inset, y + inset, x + w - inset - 1, y + h - inset - 1],
            fill=(255, 255, 255, 255),
        )
        paste_label(rgba, text, (x + w // 2, y + h // 2 - 1), size=size, anchor="cm")

    label_in_box(sign, "SHOP", 22)
    label_in_box(bsign, "BATTLE", 22)
    label_in_box(csign, "COMING SOON", 16)

    rgba.save(ASSETS / "map.png")
    # hotspots in percentages of the final image
    fw, fh = W * SCALE, H * SCALE
    def box_pct(x, y, w, h, pad=2):
        return {
            "x": (x - pad) / W,
            "y": (y - pad) / H,
            "w": (w + pad * 2) / W,
            "h": (h + pad * 2) / H,
        }
    # shop: building + awning
    shop_hs = box_pct(shx - 6, shy - 6, shw + 12, shh + 6, pad=3)
    # battle: sign + ring + plank
    battle_hs = box_pct(csign[0] - 8, bsign[1], 80, (csign[1] + csign[3]) - bsign[1], pad=3)
    (ASSETS / "map_hotspots.json").write_text(
        json.dumps({"shop": shop_hs, "battle": battle_hs}, indent=2), encoding="utf-8"
    )
    print("map", rgba.size, "shop", shop_hs, "battle", battle_hs)
    return rgba


# ---------------------------------------------------------------------------
# UI chrome
# ---------------------------------------------------------------------------
def build_button_frame():
    # 24x24, 6px corners for border-image, 1px black wobbly-pixel edge
    n = 24
    p = Pix(n, n)
    # slightly stepped, not a perfect rectangle
    p.line(2, 1, n - 4, 1)
    p.line(n - 3, 2, n - 2, 3)
    p.line(n - 2, 4, n - 2, n - 4)
    p.line(n - 3, n - 3, n - 4, n - 2)
    p.line(n - 5, n - 2, 3, n - 2)
    p.line(2, n - 3, 1, n - 4)
    p.line(1, n - 5, 1, 3)
    p.line(2, 2, 2, 2)
    im = p.to_transparent(scale=3, paper=True)  # 72x72
    im.save(UI / "btn.png")
    print("btn", im.size)


def build_shelf():
    # long 1-bit shelf: two wobbly-but-1px-consistent rails
    W, H = 400, 10
    p = Pix(W, H)
    # top rail at y=2, bottom at y=6, mild 1px vertical steps every so often
    y = 2
    for x in range(0, W):
        if x % 37 == 18:
            y = 1 if y == 2 else 2
        p.set(x, y)
        p.set(x, y + 4)
    im = p.to_transparent(scale=4, paper=False)
    im.save(UI / "shelf.png")
    print("shelf", im.size)


def build_new_burst():
    # scribbly pixel starburst, 48x48, 1px spikes, transparent bg
    n = 48
    p = Pix(n, n)
    cx, cy = 24, 24
    rng = random.Random(3)
    # 14 irregular spikes
    for i in range(14):
        a = i / 14 * 2 * math.pi + rng.uniform(-0.08, 0.08)
        r0 = 6
        r1 = 18 + (i % 3) * 3 + rng.randint(0, 3)
        # slightly off-angle second edge so the spike has width 1-2
        a2 = a + 0.14
        p.line(cx + math.cos(a) * r0, cy + math.sin(a) * r0, cx + math.cos(a) * r1, cy + math.sin(a) * r1)
        p.line(cx + math.cos(a2) * r0, cy + math.sin(a2) * r0, cx + math.cos(a) * r1, cy + math.sin(a) * r1)
        p.line(cx + math.cos(a) * r0, cy + math.sin(a) * r0, cx + math.cos(a2) * r0, cy + math.sin(a2) * r0)
    # inner ring
    p.ellipse(cx, cy, 8, 8, fill=False)
    im = p.to_transparent(scale=4, paper=False)
    im.save(UI / "new_burst.png")
    print("burst", im.size)


def build_scraps():
    rng = random.Random(9)
    for i, (w, h) in enumerate(((11, 8), (9, 10), (12, 7), (8, 8))):
        p = Pix(w, h)
        # irregular polygon outline
        pts = []
        for k in range(6):
            a = k / 6 * 2 * math.pi
            rr_x = w * 0.4 + rng.uniform(-1, 1)
            rr_y = h * 0.4 + rng.uniform(-1, 1)
            pts.append((int(w / 2 + math.cos(a) * rr_x), int(h / 2 + math.sin(a) * rr_y)))
        pts.append(pts[0])
        for a, b in zip(pts, pts[1:]):
            p.line(*a, *b)
        im = p.to_transparent(scale=4, paper=True)
        # make interior white, border black already
        # flood interior? skip — a hollow scrap is fine; fill it
        # cheap fill: for each row, fill between first and last ink if we also want paper
        im.save(UI / f"scrap_{i}.png")
    print("scraps ok")


def build_pixel_icons():
    """16x16 1-bit type icons, consistent 1px weight, returned as 16x16 L images."""
    def from_rows(rows):
        im = Image.new("L", (16, 16), 255)
        px = im.load()
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch in "#@":
                    px[x, y] = 0
        return im

    monster = from_rows([
        "................",
        "....#......#....",
        "...##......##...",
        "..#..######..#..",
        "..#..........#..",
        "...#.#....#.#...",
        "...#.#....#.#...",
        "....#......#....",
        "....#..##..#....",
        ".....#....#.....",
        "......####......",
        "................",
        "................",
        "................",
        "................",
        "................",
    ])
    spell = from_rows([
        "................",
        ".......#........",
        ".......#........",
        "....#..#..#.....",
        ".....#.#.#......",
        ".......#........",
        "..#...#.#...#...",
        ".#############..",
        "..#...#.#...#...",
        ".......#........",
        ".....#.#.#......",
        "....#..#..#.....",
        ".......#........",
        ".......#........",
        "................",
        "................",
    ])
    trap = from_rows([
        "................",
        "................",
        "..###########...",
        "..#.........#...",
        "...#.......#....",
        "...#.......#....",
        "....#.....#.....",
        "....#..#..#.....",
        ".....#.#.#......",
        ".....#.#.#......",
        "......#.#.......",
        "......#.#.......",
        ".......#........",
        ".......#........",
        "................",
        "................",
    ])
    return monster, spell, trap


# ---------------------------------------------------------------------------
# Cards + packs
# ---------------------------------------------------------------------------
def rebuild_cards():
    # Point ba at the new font (already done via v2.FONT_PATH)
    for spec in ba.CARDS:
        if spec["id"] in SHORT_FX:
            spec["effect"] = SHORT_FX[spec["id"]]

    stick_ids = {"stick_runner", "box_knight", "lord_of_lines", "erase", "dot_dummy"}
    arts = {}
    for spec in ba.CARDS:
        name = spec["id"]
        if name in stick_ids:
            arts[name] = Image.open(ASSETS / "art" / f"{name}_80.png").convert("L")
        else:
            recipe, thresh = ba.ART_RECIPES[name]
            # convert_art uses v2.SRC, already pointed at game assets by ba
            v2.SRC = ASSETS / "src"
            arts[name] = v2.convert_art(name, recipe, thresh, v2.ART_PX)

    star = Image.open(ASSETS / "star.png")
    monster_i, spell_i, trap_i = build_pixel_icons()

    # Monkeypatch icons
    v2.icon_monster = lambda: monster_i
    v2.icon_spell = lambda: spell_i
    v2.icon_trap = lambda: trap_i

    # Slightly tighter text sizes for the wider blobby font
    orig_build = ba.build_card

    def build_card(spec, arts, star, cw=ba.CARD_W, ch=ba.CARD_H):
        # Temporarily wrap paste sizes by patching after the fact is hard;
        # just call original (size 24/16/17) and hope wrap works. If names overflow
        # we'll adjust. Bagel names at 24 already fit. Effects at 16 wrap to 2 lines.
        return orig_build(spec, arts, star, cw, ch)

    built = []
    for spec in ba.CARDS:
        rgba, body = ba.build_card(spec, arts, star)
        rgba.save(ASSETS / "cards" / f"{spec['id']}.png")
        body.save(ASSETS / "masks" / f"{spec['id']}.png")
        built.append(rgba)
        print("card", spec["name"], rgba.size)
    ba.compose_set_sheet(built)
    return built


def rebuild_packs():
    # Re-run pack drawer with the new font already on v2.FONT_PATH
    ba.make_pack()
    print("packs rebuilt")


def main():
    UI.mkdir(parents=True, exist_ok=True)
    build_map()
    build_button_frame()
    build_shelf()
    build_new_burst()
    build_scraps()
    rebuild_cards()
    rebuild_packs()
    print("build_ui done")


if __name__ == "__main__":
    main()
