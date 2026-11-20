#!/usr/bin/env python3
"""Draw 1-bit 80x80 stick-figure card art in a chunky wobbly MS Paint line."""
from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, "/workspace/llc/mockup")
import build_v2 as v2

OUT = Path("/workspace/llc/game/assets/art")
SRC80 = Path("/workspace/llc/game/assets")  # arts used by build go through convert; we'll save final 80s
HI = 320  # draw at 4x, nearest-down to 80


def new_canvas(seed):
    return v2.Canvas(HI, HI, seed=seed)


def to_80(c: v2.Canvas) -> Image.Image:
    bw = c.im.point(lambda p: 0 if p < 128 else 255, mode="L")
    return bw.resize((80, 80), Image.Resampling.NEAREST)


def wobble_circle(c: v2.Canvas, cx, cy, r, thick, n=28, jitter=1.6):
    rng = c.rng
    ph = rng.uniform(0, 7)
    pts = []
    for i in range(n + 1):
        a = i / n * 2 * math.pi
        rr = r + jitter * math.sin(a * 3.2 + ph) + rng.uniform(-0.6, 0.6)
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    c.stroke_points(pts, thick / 2.0)
    return pts


def scribble_ball(c: v2.Canvas, cx, cy, r, thick):
    """Loopy scribbled circle, not a solid stipple blob."""
    rng = c.rng
    # a few overlapping wobbly outlines
    for k in range(3):
        wobble_circle(
            c,
            cx + rng.uniform(-3, 3),
            cy + rng.uniform(-3, 3),
            r + rng.uniform(-5, 4),
            thick=thick + rng.uniform(-0.6, 0.6),
            n=26,
            jitter=2.4,
        )
    # inner looping scribble
    pts = []
    ph = rng.uniform(0, 6)
    for i in range(40):
        t = i / 39
        a = t * 3.4 * 2 * math.pi + ph
        rr = r * (0.15 + 0.75 * t) * (0.85 + 0.15 * math.sin(a * 2))
        pts.append((cx + math.cos(a) * rr + rng.uniform(-1.2, 1.2),
                    cy + math.sin(a) * rr + rng.uniform(-1.2, 1.2)))
    c.stroke_points(pts, max(1.6, thick * 0.45))
    # a couple of crossing squiggles
    c.wobble_line(cx - r * 0.5, cy - r * 0.15, cx + r * 0.45, cy + r * 0.35,
                  thick * 0.7, jitter=2.0, overshoot=0)
    c.wobble_line(cx - r * 0.2, cy - r * 0.5, cx + r * 0.3, cy + r * 0.2,
                  thick * 0.65, jitter=1.8, overshoot=0)


def pixel_crown(c: v2.Canvas, cx, cy, w=52, h=26, thick=7):
    """Blocky 1-bit pixel crown (3-5 merlons on a band)."""
    # Draw on a 9x4 cell grid so it stays crisp when downscaled.
    cols, rows = 9, 4
    cell = 6
    pattern = [
        "1 1 1 1 1",
        "111111111",
        "111111111",
        "111111111",
    ]
    # pattern rows are 9-wide already if we use this:
    pattern = [
        "101010101",
        "111111111",
        "111111111",
    ]
    rows = len(pattern)
    cols = len(pattern[0])
    cell = 7
    x0 = int(cx - (cols * cell) / 2)
    y0 = int(cy - rows * cell)
    for j, row in enumerate(pattern):
        for i, ch in enumerate(row):
            if ch == "1":
                # filled square cell
                for dy in range(cell):
                    for dx in range(cell):
                        c.stamp(x0 + i * cell + dx, y0 + j * cell + dy, 1.0)


def save(name: str, c: v2.Canvas):
    im80 = to_80(c)
    OUT.mkdir(parents=True, exist_ok=True)
    im80.save(OUT / f"{name}_80.png")
    im80.resize((640, 640), Image.Resampling.NEAREST).save(OUT / f"{name}_x8.png")
    # also keep a hi-res 1-bit for debugging
    c.im.point(lambda p: 0 if p < 128 else 255, mode="L").save(OUT / f"{name}_hi.png")
    print("stick", name)
    return im80


def draw_stick_runner():
    c = new_canvas(seed=11)
    # running to the right, leaning forward
    hx, hy, hr = 168, 96, 30
    wobble_circle(c, hx, hy, hr, thick=11, jitter=1.8)
    # dot eyes
    c.stamp(hx - 8, hy - 2, 3.2)
    c.stamp(hx + 10, hy - 4, 3.2)
    # little smile
    c.wobble_line(hx - 6, hy + 10, hx + 10, hy + 11, 3.2, jitter=0.4, overshoot=0)
    # torso: neck to hips, leaning
    hips = (196, 190)
    c.wobble_line(hx, hy + hr - 2, hips[0], hips[1], 11, jitter=1.1, overshoot=0)
    # front arm (right, forward/up)
    c.wobble_line(hx + 6, hy + hr + 18, 268, 150, 9.5, jitter=1.0, overshoot=0)
    # back arm
    c.wobble_line(hx - 4, hy + hr + 20, 86, 168, 9.5, jitter=1.0, overshoot=0)
    # front leg
    c.wobble_line(hips[0], hips[1], 268, 268, 10, jitter=1.0, overshoot=0)
    # back leg
    c.wobble_line(hips[0], hips[1], 118, 286, 10, jitter=1.0, overshoot=0)
    # tiny feet
    c.wobble_line(268, 268, 292, 272, 8, jitter=0.3, overshoot=0)
    c.wobble_line(118, 286, 92, 292, 8, jitter=0.3, overshoot=0)
    # speed lines behind
    for y, x0, x1 in ((70, 20, 90), (110, 16, 78), (150, 24, 86), (200, 20, 70), (250, 30, 80)):
        c.wobble_line(x0, y, x1, y + 2, 6.5, jitter=0.4, overshoot=0)
    return save("stick_runner", c)


def draw_box_knight():
    c = new_canvas(seed=22)
    hx, hy, hr = 160, 118, 28
    wobble_circle(c, hx, hy, hr, thick=11, jitter=1.5)
    # eyes (chin of the circle will peek below the helmet)
    c.stamp(hx - 9, hy + 6, 3.2)
    c.stamp(hx + 9, hy + 6, 3.2)
    # square box helmet OVER the head: fill white so the circle doesn't show through, then restroke
    bw, bh = 84, 58
    bx, by = hx - bw / 2, hy - hr - 22
    pts, _ = c.wobble_roundrect(bx, by, bw, bh, r_corner=3, thick=11, jitter=0.8)
    poly = pts[:-1] if pts and pts[-1] == pts[0] else pts
    c.fill_polygon(poly, color=v2.WHITE)
    c.stroke_points(pts, 5.5)
    # visor slit
    c.wobble_line(hx - 18, by + bh * 0.62, hx + 18, by + bh * 0.62, 7, jitter=0.3, overshoot=0)
    # torso
    hips = (160, 214)
    c.wobble_line(hx, hy + hr, hips[0], hips[1], 11, jitter=0.9, overshoot=0)
    # left arm + shield
    c.wobble_line(hx - 4, hy + hr + 22, 84, 188, 9.5, jitter=0.9, overshoot=0)
    # simple round-ish shield (circle outline with a cross)
    wobble_circle(c, 74, 200, 32, thick=10, jitter=1.2)
    c.wobble_line(74, 176, 74, 224, 5.5, jitter=0.3, overshoot=0)
    c.wobble_line(52, 200, 96, 200, 5.5, jitter=0.3, overshoot=0)
    # right arm + sword
    c.wobble_line(hx + 4, hy + hr + 20, 232, 170, 9.5, jitter=0.9, overshoot=0)
    # sword: blade up, short crossguard
    c.wobble_line(232, 178, 232, 78, 9, jitter=0.4, overshoot=0)
    c.wobble_line(214, 168, 250, 168, 7, jitter=0.3, overshoot=0)
    c.stamp(232, 78, 5)
    # legs
    c.wobble_line(hips[0], hips[1], 118, 292, 10, jitter=0.8, overshoot=0)
    c.wobble_line(hips[0], hips[1], 206, 292, 10, jitter=0.8, overshoot=0)
    c.wobble_line(118, 292, 100, 296, 8, jitter=0.3, overshoot=0)
    c.wobble_line(206, 292, 226, 296, 8, jitter=0.3, overshoot=0)
    return save("box_knight", c)


def draw_lord_of_lines():
    c = new_canvas(seed=33)
    hx, hy, hr = 150, 118, 28
    # cape first, hanging off the left shoulder — a simple triangle that stays behind/aside
    cape = [(138, 154), (52, 250), (128, 230), (138, 154)]
    c.stroke_points(cape, 6)
    wobble_circle(c, hx, hy, hr, thick=11, jitter=1.5)
    c.stamp(hx - 8, hy - 2, 3.2)
    c.stamp(hx + 8, hy - 2, 3.2)
    c.wobble_line(hx - 6, hy + 10, hx + 8, hy + 11, 3.2, jitter=0.3, overshoot=0)
    # pixel crown on the head
    pixel_crown(c, hx, hy - hr + 4)
    # torso
    hips = (150, 220)
    c.wobble_line(hx, hy + hr, hips[0], hips[1], 11, jitter=0.9, overshoot=0)
    # left arm slightly out (cape side)
    c.wobble_line(hx - 2, hy + hr + 18, 84, 200, 9.5, jitter=0.9, overshoot=0)
    # right arm holds staff
    c.wobble_line(hx + 4, hy + hr + 18, 226, 180, 9.5, jitter=0.9, overshoot=0)
    # staff
    c.wobble_line(238, 62, 226, 296, 9, jitter=0.5, overshoot=0)
    c.wobble_line(238, 62, 238, 38, 7, jitter=0.2, overshoot=0)
    c.wobble_line(222, 50, 254, 50, 7, jitter=0.2, overshoot=0)
    c.stamp(238, 38, 5)
    # legs
    c.wobble_line(hips[0], hips[1], 112, 296, 10, jitter=0.8, overshoot=0)
    c.wobble_line(hips[0], hips[1], 192, 296, 10, jitter=0.8, overshoot=0)
    c.wobble_line(112, 296, 96, 300, 8, jitter=0.3, overshoot=0)
    c.wobble_line(192, 296, 210, 300, 8, jitter=0.3, overshoot=0)
    return save("lord_of_lines", c)


def draw_erase():
    """Stick figure being wiped by a simple rectangular eraser."""
    c = new_canvas(seed=44)
    # eraser: simple 3-D box, tilted, upper right
    # front face
    ex, ey, ew, eh = 150, 36, 140, 88
    # draw a tilted rectangle as four wobble sides + a top face
    p1, p2, p3, p4 = (150, 48), (274, 70), (250, 150), (126, 128)
    c.stroke_points([p1, p2, p3, p4, p1], 8)
    # top/side lid
    p5, p6 = (178, 22), (300, 44)
    c.stroke_points([p1, p5, p6, p2], 8)
    # a couple of face lines so it reads as a block
    c.wobble_line(138, 88, 262, 110, 5, jitter=0.4, overshoot=0)
    # crumbs
    for pt in [(130, 150), (148, 168), (170, 158), (120, 176), (200, 170), (110, 200)]:
        c.stamp(pt[0], pt[1], 3.2)
    # stick figure, lower left, mid-erase (right arm fading / missing)
    hx, hy, hr = 108, 168, 28
    wobble_circle(c, hx, hy, hr, thick=11, jitter=1.6)
    c.stamp(hx - 8, hy - 2, 3.2)
    c.stamp(hx + 8, hy - 2, 3.2)
    c.wobble_line(hx - 6, hy + 10, hx + 8, hy + 11, 3.2, jitter=0.3, overshoot=0)
    hips = (112, 250)
    c.wobble_line(hx, hy + hr, hips[0], hips[1], 11, jitter=0.9, overshoot=0)
    # left arm
    c.wobble_line(hx - 2, hy + hr + 16, 48, 230, 9.5, jitter=0.9, overshoot=0)
    # right arm goes into the eraser crumbs and stops short (being erased)
    c.wobble_line(hx + 4, hy + hr + 16, 150, 200, 9, jitter=1.2, overshoot=0)
    # dashed remainder
    c.wobble_line(158, 196, 176, 190, 4.5, jitter=0.6, overshoot=0)
    c.stamp(188, 186, 2.4)
    # legs
    c.wobble_line(hips[0], hips[1], 74, 306, 10, jitter=0.8, overshoot=0)
    c.wobble_line(hips[0], hips[1], 154, 306, 10, jitter=0.8, overshoot=0)
    return save("erase", c)


def draw_dot_dummy():
    """Scribble-ball creature with stick limbs, not a stipple blob."""
    c = new_canvas(seed=55)
    # body: loopy scribble
    scribble_ball(c, 160, 204, 58, thick=8)
    # head: outline + a couple loose loops, leave the face open
    wobble_circle(c, 160, 100, 50, thick=10, jitter=2.0)
    wobble_circle(c, 162, 102, 44, thick=6, jitter=2.2)
    # one loose inner scribble above the face
    c.wobble_line(140, 74, 180, 78, 5, jitter=2.4, overshoot=0)
    c.wobble_line(148, 64, 170, 70, 5, jitter=2.0, overshoot=0)
    # face sits in the open lower half of the head
    c.stamp(146, 100, 4.5)
    c.stamp(176, 100, 4.5)
    c.wobble_line(146, 118, 176, 120, 4, jitter=0.5, overshoot=0)
    # stick arms
    c.wobble_line(110, 180, 48, 210, 10, jitter=1.0, overshoot=0)
    c.wobble_line(210, 180, 274, 210, 10, jitter=1.0, overshoot=0)
    c.stamp(48, 210, 7)
    c.stamp(274, 210, 7)
    # stick legs
    c.wobble_line(140, 250, 118, 306, 10, jitter=0.8, overshoot=0)
    c.wobble_line(180, 250, 204, 306, 10, jitter=0.8, overshoot=0)
    c.stamp(118, 306, 7)
    c.stamp(204, 306, 7)
    return save("dot_dummy", c)


def main():
    draw_stick_runner()
    draw_box_knight()
    draw_lord_of_lines()
    draw_erase()
    draw_dot_dummy()
    # contact sheet of x8
    names = ["stick_runner", "box_knight", "lord_of_lines", "erase", "dot_dummy"]
    sheet = Image.new("RGB", (640 * 5 + 16, 656), (255, 255, 255))
    for i, n in enumerate(names):
        im = Image.open(OUT / f"{n}_x8.png").convert("RGB")
        sheet.paste(im, (8 + i * 640, 8))
    sheet.save(OUT / "sticks_sheet.png")
    print("sheet", sheet.size)


if __name__ == "__main__":
    main()
