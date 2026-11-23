#!/usr/bin/env python3
"""1-bit scribbly field backgrounds, in the LLC map style."""
from PIL import Image, ImageDraw
import math, random

W, H = 384, 216
SCALE = 4
rng = random.Random(23)


def ink(img, x, y, c=0):
    if 0 <= x < img.size[0] and 0 <= y < img.size[1]:
        img.putpixel((int(x), int(y)), c)


def brush(img, x, y, r=0, c=0):
    x, y = int(round(x)), int(round(y))
    if r <= 0:
        ink(img, x, y, c)
        return
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r + r:
                ink(img, x + dx, y + dy, c)


def walk(img, x0, y0, x1, y1, amp=0.7, r=0):
    n = max(2, int(math.hypot(x1 - x0, y1 - y0) * 1.6))
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy) or 1
    px, py = -dy / length, dx / length
    ox = oy = 0
    for i in range(n + 1):
        t = i / n
        wob = math.sin(t * math.pi * (0.7 + rng.random() * 0.6)) * amp
        ox = ox * 0.6 + (rng.random() * 2 - 1) * amp * 0.5
        oy = oy * 0.6 + (rng.random() * 2 - 1) * amp * 0.5
        x = x0 + dx * t + px * wob + ox
        y = y0 + dy * t + py * wob + oy
        brush(img, x, y, r)


def blob(img, cx, cy, rx, ry, step=12, amp=1.2, r=0):
    pts = []
    for i in range(step):
        a = (i / step) * math.tau + rng.random() * 0.08
        jx = 1 + (rng.random() * 2 - 1) * 0.12
        jy = 1 + (rng.random() * 2 - 1) * 0.12
        pts.append((cx + math.cos(a) * rx * jx, cy + math.sin(a) * ry * jy))
    for i, (x, y) in enumerate(pts):
        nx, ny = pts[(i + 1) % len(pts)]
        walk(img, x, y, nx, ny, amp=amp, r=r)


def circle(img, cx, cy, rad, amp=0.4, r=0):
    blob(img, cx, cy, rad, rad, step=max(8, int(rad * 1.4)), amp=amp, r=r)


def stick(img, x, y, h=18, arm=7, heading=0, wave=False, sit=False):
    """y is ground (feet), or the seat if sit=True."""
    head_r = 2.4
    hx = x + heading * 2
    hy = y - (10 if sit else h)
    circle(img, hx, hy, head_r, amp=0.25, r=0)
    hip_y = y if sit else y - 1
    hip_x = x + heading
    walk(img, hx, hy + head_r, hip_x, hip_y, amp=0.35)
    if sit:
        walk(img, hip_x, hip_y, hip_x + 7, hip_y + 1, amp=0.25)  # thighs
        walk(img, hip_x + 7, hip_y + 1, hip_x + 7, hip_y + 6, amp=0.2)  # shins hanging
        walk(img, hip_x, hip_y, hip_x + 2, hip_y + 6, amp=0.2)
    else:
        walk(img, hip_x, hip_y, x - 4 + heading * 0.3, y + 1, amp=0.3)
        walk(img, hip_x, hip_y, x + 4 + heading * 0.3, y + 1, amp=0.3)
    ay = hy + 4
    if wave:
        walk(img, hx, ay, hx - arm, ay + 2, amp=0.3)
        walk(img, hx, ay, hx + arm, ay - 6, amp=0.3)
    else:
        walk(img, hx, ay, hx - arm, ay + 3, amp=0.3)
        walk(img, hx, ay, hx + arm, ay + 2, amp=0.3)


def tree(img, x, y, canopy=16, trunk=16, lean=0):
    # trunk
    walk(img, x, y, x + lean, y - trunk, amp=0.5, r=0)
    walk(img, x + 1, y, x + lean + 1, y - trunk, amp=0.4, r=0)
    # canopy: two overlapping blobs
    cx, cy = x + lean, y - trunk - canopy * 0.35
    blob(img, cx, cy, canopy * 0.85, canopy * 0.7, step=14, amp=1.1)
    blob(img, cx - canopy * 0.15, cy + 2, canopy * 0.55, canopy * 0.5, step=10, amp=1.0)
    # a couple of inner doodle marks
    walk(img, cx - 4, cy, cx + 3, cy + 3, amp=0.6)


def cloud(img, x, y, s=18):
    blob(img, x, y, s, s * 0.45, step=12, amp=0.9)
    blob(img, x - s * 0.45, y + 1, s * 0.55, s * 0.38, step=10, amp=0.8)
    blob(img, x + s * 0.4, y + 2, s * 0.5, s * 0.35, step=10, amp=0.8)


def bench(img, x, y, w=28):
    # seat slats
    walk(img, x, y - 8, x + w, y - 8, amp=0.25)
    walk(img, x + 1, y - 6, x + w - 1, y - 6, amp=0.25)
    # back
    walk(img, x, y - 14, x + w, y - 14, amp=0.3)
    walk(img, x, y - 14, x, y - 8, amp=0.2)
    walk(img, x + w, y - 14, x + w, y - 8, amp=0.2)
    # legs
    walk(img, x + 3, y - 6, x + 2, y, amp=0.2)
    walk(img, x + w - 3, y - 6, x + w - 2, y, amp=0.2)
    walk(img, x + 8, y - 6, x + 8, y, amp=0.2)
    walk(img, x + w - 8, y - 6, x + w - 8, y, amp=0.2)


def swing(img, x, y, h=44, w=36):
    # wide A-frame
    top_l, top_r = x + 10, x + w - 10
    walk(img, x, y, top_l, y - h, amp=0.35)
    walk(img, x + 1, y, top_l + 1, y - h, amp=0.25)
    walk(img, x + w, y, top_r, y - h, amp=0.35)
    walk(img, x + w - 1, y, top_r - 1, y - h, amp=0.25)
    walk(img, top_l, y - h, top_r, y - h, amp=0.2)
    # ropes
    seat_y = y - 16
    rx0, rx1 = x + 14, x + w - 14
    walk(img, rx0, y - h + 1, rx0, seat_y, amp=0.15)
    walk(img, rx1, y - h + 1, rx1, seat_y, amp=0.15)
    # seat
    walk(img, rx0 - 2, seat_y, rx1 + 2, seat_y, amp=0.15)
    walk(img, rx0 - 2, seat_y + 1, rx1 + 2, seat_y + 1, amp=0.15)


def tuft(img, x, y, s=3):
    walk(img, x, y, x - s, y - s - 1, amp=0.2)
    walk(img, x, y, x, y - s - 2, amp=0.2)
    walk(img, x, y, x + s, y - s - 1, amp=0.2)


def path(img, pts, amp=0.8):
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        # two edges of a path, opening wider in the middle
        mid = 1 - abs((i / max(1, len(pts) - 2)) * 2 - 1) if len(pts) > 2 else 0.5
        spread = 6 + mid * 5
        # skip a gap in the very center so the playmat stays clear
        if 150 < (x0 + x1) / 2 < 234 and 90 < (y0 + y1) / 2 < 150:
            continue
        nx, ny = x1 - x0, y1 - y0
        L = math.hypot(nx, ny) or 1
        px, py = -ny / L * spread, nx / L * spread
        walk(img, x0 + px, y0 + py, x1 + px, y1 + py, amp=amp)
        walk(img, x0 - px * 0.7, y0 - py * 0.7, x1 - px * 0.7, y1 - py * 0.7, amp=amp)


def sun(img, cx, cy, rad=10):
    circle(img, cx, cy, rad, amp=0.3)
    for i in range(8):
        a = i * math.tau / 8 + 0.2
        x0 = cx + math.cos(a) * (rad + 3)
        y0 = cy + math.sin(a) * (rad + 3)
        x1 = cx + math.cos(a) * (rad + 8)
        y1 = cy + math.sin(a) * (rad + 8)
        walk(img, x0, y0, x1, y1, amp=0.2)


def draw():
    img = Image.new("L", (W, H), 255)
    # sparse sky dots (very light)
    for _ in range(18):
        ink(img, rng.randint(0, W - 1), rng.randint(4, 70), 0)

    cloud(img, 58, 26, 16)
    cloud(img, 120, 16, 11)
    cloud(img, 300, 22, 13)
    sun(img, 352, 28, 9)

    # far grass line, broken in the center
    for x in range(0, 130, 7):
        walk(img, x, 118 + rng.randint(-1, 1), x + 6, 118 + rng.randint(-1, 1), amp=0.5)
    for x in range(260, W, 7):
        walk(img, x, 118 + rng.randint(-1, 1), min(W - 1, x + 6), 118 + rng.randint(-1, 1), amp=0.5)

    # left grove
    tree(img, 36, 150, canopy=18, trunk=22, lean=-1)
    tree(img, 68, 158, canopy=14, trunk=18, lean=2)
    tree(img, 18, 168, canopy=12, trunk=16, lean=-2)
    bench(img, 86, 170, w=30)
    stick(img, 96, 162, h=12, arm=5, heading=0.3, sit=True)
    stick(img, 136, 178, h=18, arm=7, heading=-0.3, wave=True)

    # right grove + swing
    tree(img, 350, 155, canopy=17, trunk=20, lean=1)
    tree(img, 372, 170, canopy=13, trunk=16, lean=2)
    swing(img, 278, 180, h=46, w=38)
    stick(img, 297, 164, h=12, arm=5, heading=0.15, sit=True)  # on the swing seat

    # path from lower left toward lower right, clearing the center
    path(img, [
        (0, 200), (50, 188), (110, 176), (160, 168),
        (192, 164), (224, 168), (280, 180), (340, 196), (383, 208),
    ])

    # grass tufts — dense at edges, almost none in the center clearing
    for _ in range(55):
        x = rng.randint(2, W - 3)
        y = rng.randint(130, H - 4)
        # keep the playmat clearing mostly empty
        if 130 < x < 255 and 70 < y < 165:
            if rng.random() > 0.12:
                continue
        tuft(img, x, y, s=rng.choice((2, 2, 3)))

    # a few tiny flowers / dots
    for _ in range(20):
        x = rng.randint(4, W - 4)
        y = rng.randint(140, H - 6)
        if 130 < x < 255 and y < 165:
            continue
        ink(img, x, y, 0)
        if rng.random() < 0.5:
            ink(img, x + 1, y, 0)

    save(img, "field_doodle_park")


def save(img, name):
    out = img.resize((W * SCALE, H * SCALE), Image.Resampling.NEAREST)
    out = out.convert("1")
    path_out = "assets/ui/" + name + ".png"
    out.save(path_out, optimize=True)
    print("wrote", path_out, out.size)


def star(img, x, y, big=False):
    ink(img, x, y, 0)
    if big:
        ink(img, x - 1, y, 0)
        ink(img, x + 1, y, 0)
        ink(img, x, y - 1, 0)
        ink(img, x, y + 1, 0)


def sprinkles(img, n, seed, clear=(130, 255, 70, 165), density_center=0.08):
    r = random.Random(seed)
    for _ in range(n):
        x = r.randint(2, W - 3)
        y = r.randint(2, H - 3)
        if clear[0] < x < clear[1] and clear[2] < y < clear[3] and r.random() > density_center:
            continue
        star(img, x, y, big=r.random() < 0.12)


def draw_nebula_dock():
    """Space dock: ring station, shuttle, dish, gantry, sparse stars."""
    global rng
    rng = random.Random(77)
    img = Image.new("L", (W, H), 255)
    sprinkles(img, 70, 77)

    # small planet / crescent, upper right
    blob(img, 348, 36, 16, 16, step=14, amp=0.4)
    # inner crescent cut by skipping the left side — a second inner arc
    for i in range(8):
        a = -0.6 + i * 1.8 / 7
        x0 = 348 + math.cos(a) * 8
        y0 = 36 + math.sin(a) * 9
        x1 = 348 + math.cos(a + 0.25) * 8
        y1 = 36 + math.sin(a + 0.25) * 9
        walk(img, x0, y0, x1, y1, amp=0.2)

    # left ring dock (like the card's circular station)
    cx, cy, rx, ry = 58, 150, 36, 22
    blob(img, cx, cy, rx, ry, step=16, amp=0.6)
    blob(img, cx, cy, rx - 8, ry - 6, step=12, amp=0.4)
    # docking arms
    walk(img, cx + rx - 2, cy - 4, cx + rx + 22, cy - 14, amp=0.3)
    walk(img, cx + rx + 22, cy - 14, cx + rx + 28, cy - 8, amp=0.25)
    walk(img, cx + rx - 4, cy + 6, cx + rx + 18, cy + 16, amp=0.3)
    # a little shuttle docked on the upper arm
    walk(img, cx + rx + 20, cy - 18, cx + rx + 34, cy - 16, amp=0.2)
    blob(img, cx + rx + 28, cy - 20, 8, 4, step=8, amp=0.3)
    # tower on the ring
    walk(img, cx - 4, cy - ry, cx - 4, cy - ry - 16, amp=0.2)
    walk(img, cx + 4, cy - ry, cx + 4, cy - ry - 16, amp=0.2)
    walk(img, cx - 4, cy - ry - 16, cx + 4, cy - ry - 16, amp=0.15)
    circle(img, cx, cy - ry - 20, 4, amp=0.2)

    # tiny helmeted doodle on the dock
    circle(img, cx + 10, cy - 6, 2.4, amp=0.2)
    walk(img, cx + 10, cy - 4, cx + 10, cy + 6, amp=0.2)
    walk(img, cx + 10, cy + 6, cx + 6, cy + 10, amp=0.2)
    walk(img, cx + 10, cy + 6, cx + 14, cy + 10, amp=0.2)

    # right: dish antenna + vertical mast
    mast_x, mast_y = 350, 178
    walk(img, mast_x, mast_y, mast_x, mast_y - 50, amp=0.25)
    walk(img, mast_x + 1, mast_y, mast_x + 1, mast_y - 50, amp=0.2)
    # dish
    blob(img, mast_x - 10, mast_y - 44, 14, 9, step=12, amp=0.4)
    walk(img, mast_x - 10, mast_y - 44, mast_x - 22, mast_y - 52, amp=0.2)
    # base platform
    walk(img, mast_x - 16, mast_y, mast_x + 16, mast_y, amp=0.25)
    walk(img, mast_x - 16, mast_y, mast_x - 14, mast_y + 8, amp=0.2)
    walk(img, mast_x + 16, mast_y, mast_x + 14, mast_y + 8, amp=0.2)

    # long gantry / walkway along the bottom, opening in the center
    pts = [(0, 200), (50, 188), (110, 176), (155, 170), (230, 170), (290, 184), (340, 196), (383, 206)]
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        if 155 < (x0 + x1) / 2 < 230:
            continue
        walk(img, x0, y0, x1, y1, amp=0.45)
        walk(img, x0, y0 + 5, x1, y1 + 5, amp=0.4)
        # occasional cross-tie
        if i % 2 == 0 and not (155 < x0 < 230):
            walk(img, x0, y0, x0, y0 + 5, amp=0.15)

    save(img, "field_nebula_dock")


def draw_battle_station():
    """Mech battle station: saucer platform, side turrets, a command tower, a small mech."""
    global rng
    rng = random.Random(41)
    img = Image.new("L", (W, H), 255)

    def saucer_arc(cx, cy, rx, ry, a0, a1, steps=16, skip_center=False, amp=0.35):
        for i in range(steps):
            t0 = a0 + (a1 - a0) * i / steps
            t1 = a0 + (a1 - a0) * (i + 1) / steps
            x0, y0 = cx + math.cos(t0) * rx, cy + math.sin(t0) * ry
            x1, y1 = cx + math.cos(t1) * rx, cy + math.sin(t1) * ry
            if skip_center and 145 < (x0 + x1) / 2 < 240:
                continue
            walk(img, x0, y0, x1, y1, amp=amp)

    # wide saucer rim, like the card's circular platform — open in the middle
    saucer_arc(192, 200, 230, 48, 0.12 * math.pi, 0.88 * math.pi, steps=18, skip_center=True, amp=0.4)
    saucer_arc(192, 200, 230, 40, 0.12 * math.pi, 0.88 * math.pi, steps=18, skip_center=True, amp=0.3)
    # side lips of the deck
    saucer_arc(192, 148, 210, 28, 1.05 * math.pi, 1.35 * math.pi, steps=8, skip_center=False, amp=0.35)
    saucer_arc(192, 148, 210, 28, 1.65 * math.pi, 1.95 * math.pi, steps=8, skip_center=False, amp=0.35)

    def turret(tx, ty, h=24, facing=1, fat=10):
        walk(img, tx - fat, ty, tx + fat, ty, amp=0.25)
        walk(img, tx - fat, ty, tx - fat + 2, ty - h, amp=0.3)
        walk(img, tx + fat, ty, tx + fat - 2, ty - h, amp=0.3)
        walk(img, tx - fat + 2, ty - h, tx + fat - 2, ty - h, amp=0.2)
        blob(img, tx, ty - h - 5, 8, 6, step=10, amp=0.3)
        walk(img, tx + facing * 5, ty - h - 6, tx + facing * 18, ty - h - 9, amp=0.2)
        walk(img, tx + facing * 5, ty - h - 2, tx + facing * 18, ty - h - 5, amp=0.2)
        walk(img, tx + facing * 18, ty - h - 9, tx + facing * 18, ty - h - 5, amp=0.15)

    turret(46, 172, h=22, facing=1, fat=11)
    turret(292, 184, h=16, facing=-1, fat=8)

    # small boxy mech on the left deck
    mx, my = 92, 178
    walk(img, mx - 6, my - 16, mx + 6, my - 16, amp=0.2)
    walk(img, mx - 5, my - 16, mx - 5, my - 5, amp=0.2)
    walk(img, mx + 5, my - 16, mx + 5, my - 5, amp=0.2)
    walk(img, mx - 5, my - 5, mx + 5, my - 5, amp=0.15)
    walk(img, mx - 3, my - 16, mx - 3, my - 22, amp=0.15)
    walk(img, mx + 3, my - 16, mx + 3, my - 22, amp=0.15)
    walk(img, mx - 3, my - 22, mx + 3, my - 22, amp=0.15)
    circle(img, mx, my - 24, 3.0, amp=0.2)
    walk(img, mx - 4, my - 5, mx - 6, my + 2, amp=0.2)
    walk(img, mx + 4, my - 5, mx + 6, my + 2, amp=0.2)
    walk(img, mx - 6, my - 12, mx - 14, my - 8, amp=0.2)
    walk(img, mx + 6, my - 12, mx + 13, my - 16, amp=0.2)

    # right command tower with side pods, echoing the card
    sx, sy = 338, 178
    walk(img, sx - 11, sy, sx + 11, sy, amp=0.25)
    walk(img, sx - 7, sy, sx - 5, sy - 34, amp=0.28)
    walk(img, sx + 7, sy, sx + 5, sy - 34, amp=0.28)
    walk(img, sx - 5, sy - 34, sx + 5, sy - 34, amp=0.2)
    walk(img, sx, sy - 34, sx, sy - 50, amp=0.2)
    walk(img, sx - 3, sy - 46, sx + 3, sy - 46, amp=0.15)
    blob(img, sx - 16, sy - 18, 9, 7, step=10, amp=0.3)
    blob(img, sx + 16, sy - 16, 8, 6, step=10, amp=0.3)
    walk(img, sx + 16, sy - 22, sx + 16, sy - 38, amp=0.15)
    walk(img, sx + 16, sy - 38, sx + 22, sy - 34, amp=0.15)

    # deck rivets
    r = random.Random(41)
    for _ in range(28):
        x = r.randint(4, W - 5)
        y = r.randint(150, H - 6)
        if 130 < x < 255 and y < 175:
            continue
        ink(img, x, y, 0)

    save(img, "field_battle_station")


if __name__ == "__main__":
    draw()
    draw_nebula_dock()
    draw_battle_station()
