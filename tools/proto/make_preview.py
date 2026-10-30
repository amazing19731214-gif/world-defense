#!/usr/bin/env python3
"""ドット絵の試作（v105試作）の確認用画像を作る。ゲームには組み込まない。

  python3 tools/proto/make_preview.py

出力（docs/proto/）：
- sheet.png        … 兵士6種（味方・敵、待機・歩き・攻撃）・塔4種・城2段階・背景の一覧
- field-defense.png … 実際の道の形で組んだ防衛戦（横向き）の見本と、今の絵の比較（iPhone 390px幅・画素密度3の実寸）
- field-siege.png   … 攻城戦（縦向き）の見本
"""
from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_proto_art import (  # noqa: E402
    KINDS, NAMES, POSES, POSE_NAMES, OUT_DOC, unit, tower, castle, tile, tree, rock, bridge,
)

FONT = "/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf"
BG = (243, 234, 212)
INK = (52, 40, 34)
HEAD = (34, 52, 70)


def font(size):
    return ImageFont.truetype(FONT, size)


def label(d, xy, text, size=22, fill=INK, anchor="la"):
    d.text(xy, text, font=font(size), fill=fill, anchor=anchor)


def panel(im, d, box, title):
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, 10, fill=(252, 246, 232), outline=(150, 120, 80), width=3)
    d.rounded_rectangle((x0, y0, x1, y0 + 40), 10, fill=HEAD)
    d.rectangle((x0, y0 + 30, x1, y0 + 40), fill=HEAD)
    label(d, (x0 + 14, y0 + 8), title, 24, (255, 236, 190))


# ===== 一覧 =====
def make_sheet():
    W, H = 1800, 1380
    im = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(im)
    label(d, (24, 18), "WORLD DEFENSE ドット絵の試作（v105試作・ゲームには未組み込み）", 34, HEAD)
    label(d, (24, 64), "すべてコードで1ドットずつ描いた独自の素材です。1ドットの輪郭線・上からの光・味方は藍／敵は赤で統一。下の図は4倍に拡大しています。", 20)
    # 兵士
    panel(im, d, (16, 100, 1784, 760), "兵士6種（上段：味方の藍・下段：敵の赤）")
    cw = 290
    for i, k in enumerate(KINDS):
        x0 = 30 + i * cw
        label(d, (x0 + cw // 2 - 20, 150), NAMES[k], 26, HEAD, "ma")
        for t, team in enumerate(("ally", "enemy")):
            y = 196 + t * 280
            for j, (pose, fr) in enumerate(POSES):
                sp = unit(k, team, pose, fr).image(4 if k != "cavalry" else 3)
                col, row = j % 3, j // 3
                im.alpha_composite(sp, (x0 + col * 90 + (0 if k != "cavalry" else -4), y + row * 120))
                if t == 0:
                    label(d, (x0 + col * 90 + 38, y + row * 120 + 100), POSE_NAMES[j], 15, (110, 90, 70), "ma")
    # 塔
    panel(im, d, (16, 780, 700, 1110), "塔4種（36×48ドット・3倍）")
    for i, (t, name) in enumerate((("arrow", "弓の塔"), ("cannon", "大砲の塔"), ("gun", "鉄砲の塔"), ("ice", "水攻めの塔"))):
        sp = tower(t).image(3)
        im.alpha_composite(sp, (40 + i * 165, 840))
        label(d, (40 + i * 165 + 54, 1000 + 40), name, 20, HEAD, "ma")
    # 城
    panel(im, d, (716, 780, 1300, 1110), "城（通常・強化）")
    for i, (lv, name) in enumerate(((1, "通常"), (2, "強化"))):
        sp = castle(lv).image(3)
        im.alpha_composite(sp, (740 + i * 250, 1090 - sp.height - 30))
        label(d, (740 + i * 250 + sp.width // 2, 1074), name, 20, HEAD, "ma")
    # 背景
    panel(im, d, (1316, 780, 1784, 1110), "背景（16ドットの地面・木・岩・橋）")
    x = 1336
    for k, sd, name in (("grass", 3, "草原"), ("road", 1, "道"), ("water", 2, "川")):
        sq = Image.new("RGBA", (32, 32))
        for yy in (0, 16):
            for xx in (0, 16):
                sq.alpha_composite(tile(k, sd + xx + yy).image(), (xx, yy))
        im.alpha_composite(sq.resize((96, 96), Image.NEAREST), (x, 840))
        label(d, (x + 48, 944), name, 18, HEAD, "ma")
        x += 112
    for sp, name, xx, yy in ((tree("round"), "木", 1336, 980), (tree("pine"), "松", 1416, 980), (rock(), "岩", 1500, 1030), (bridge(), "橋", 1580, 1030)):
        im.alpha_composite(sp.image(3 if sp.w < 30 else 3), (xx, yy))
        label(d, (xx + sp.w * 3 // 2, yy + sp.h * 3 + 4), name, 18, HEAD, "ma")
    # 実寸
    panel(im, d, (16, 1130, 1784, 1364), "スマホの実際の表示の大きさ（iPhone 画素密度3：戦場の兵士は約2.5倍の点で描かれる）")
    x = 40
    for k in KINDS:
        sp = unit(k, "ally", "idle", 0)
        im.alpha_composite(sp.image().resize((int(sp.w * 2.4375), int(sp.h * 2.4375)), Image.NEAREST), (x, 1200))
        x += sp.w * 3 + 14
    x += 30
    for k in KINDS[:4]:
        sp = unit(k, "enemy", "walk", 0)
        im.alpha_composite(sp.image().resize((int(sp.w * 2.4375), int(sp.h * 2.4375)), Image.NEAREST), (x, 1200))
        x += sp.w * 3
    label(d, (40, 1316), "横向きの防衛戦（390px幅・画素密度3）での実際の大きさ。縦向きの攻城戦では約1.2倍大きく表示されます。", 18)
    path = os.path.join(OUT_DOC, "sheet.png")
    im.convert("RGB").save(path)
    return path


# ===== 戦場の見本（ゲームと同じ道の形。ゲームの座標の半分の 480×300 ドットで組む） =====
UPPER = [(0, 300), (140, 300), (235, 165), (450, 165), (560, 300), (760, 300), (960, 300)]
LOWER = [(0, 300), (140, 300), (235, 440), (450, 440), (560, 300), (760, 300), (960, 300)]


def seg_dist(px, py, a, b):
    (ax, ay), (bx, by) = a, b
    vx, vy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy or 1)))
    return math.hypot(px - (ax + vx * t), py - (ay + vy * t))


def road_dist(x, y):
    d = 1e9
    for path in (UPPER, LOWER):
        for a, b in zip(path, path[1:]):
            d = min(d, seg_dist(x * 2, y * 2, a, b))
    return d / 2  # 半分の座標での距離


def field_ground():
    """草原・道・川を敷いた地面（480×300）"""
    W, H = 480, 300
    g = Image.new("RGBA", (W, H))
    for ty in range(0, H, 16):
        for tx in range(0, W, 16):
            g.alpha_composite(tile("grass", tx * 7 + ty * 13).image(), (tx, ty))
    road = tile("road", 5).image()
    edge = (176, 140, 92, 255)
    shade = (98, 150, 72, 255)
    gp = g.load()
    rp = road.load()
    for y in range(H):
        for x in range(W):
            dd = road_dist(x, y)
            if dd < 13:
                gp[x, y] = rp[x % 16, y % 16]
            elif dd < 14.5:
                gp[x, y] = edge
            elif dd < 16:
                gp[x, y] = shade
    # 川（右の一本道を横切る）と橋
    water = tile("water", 9).image().load()
    for y in range(H):
        cx = 335 + int(6 * math.sin(y / 24))
        for x in range(cx - 7, cx + 8):
            if road_dist(x, y) >= 13:
                gp[x, y] = water[x % 16, y % 16]
        gp[cx - 8, y] = (88, 140, 80, 255)
        gp[cx + 8, y] = (88, 140, 80, 255)
    br = bridge().image().rotate(90, expand=True)
    g.alpha_composite(br, (335 - br.width // 2 + int(6 * math.sin(150 / 24)), 150 - br.height // 2))
    return g


def decor():
    """木・岩（道と川を避けた位置）。(種類, x, 下端y)"""
    pts = [("round", 30, 60), ("pine", 70, 40), ("round", 150, 40), ("round", 300, 50), ("pine", 390, 70), ("round", 450, 60),
           ("round", 40, 270), ("pine", 120, 290), ("round", 300, 270), ("round", 380, 285), ("pine", 460, 270),
           ("rock", 200, 140), ("rock", 260, 290), ("round", 170, 160)]
    return [(k, x, y) for k, x, y in pts if road_dist(x, y - 4) > 18 and abs(x - 335) > 14]


def place(img, sp, x, bottom, scale=1):
    im = sp.image(scale) if hasattr(sp, "image") else sp
    img.alpha_composite(im, (int(x - im.width / 2), int(bottom - im.height)))


def scene_defense():
    g = field_ground()
    things = []  # (並びの基準y, 描く関数)
    for k, x, y in decor():
        sp = rock() if k == "rock" else tree(k)
        things.append((y, sp, x, y))
    for t, x, y in (("arrow", 165, 128), ("cannon", 300, 118), ("gun", 360, 245), ("ice", 230, 262)):
        things.append((y, tower(t), x, y))
    things.append((190, castle(2), 446, 190))
    # 味方の部隊（道の上で敵を止める）と、入口から来る敵
    squads = [((150, 82), ["spearman", "ashigaru", "archer"]), ((150, 220), ["cavalry", "spearman"]), ((300, 150), ["gunner", "archer", "medic"])]
    for (cx, cy), kinds in squads:
        n = 0
        for row in range(2):
            for col in range(3):
                k = kinds[n % len(kinds)]
                n += 1
                things.append((cy + row * 5 + 6, unit(k, "ally", "attack" if col == 2 else "idle", n % 2), cx - col * 9 + row * 3, cy + row * 5 + 6))
    for i, (x, y) in enumerate(((20, 152), (34, 146), (48, 154), (62, 148), (100, 120), (112, 112), (98, 186), (110, 196), (128, 92), (128, 210))):
        k = ["ashigaru", "spearman", "archer", "gunner"][i % 4]
        things.append((y, unit(k, "enemy", "walk", i % 2), x, y))
    things.sort(key=lambda t: t[0])
    for _, sp, x, y in things:
        place(g, sp, x, y)
    return g


def scene_siege():
    """攻城戦の縦向き：地面は入れ替え、兵士・塔・城は立てたまま"""
    g = field_ground().transpose(Image.TRANSPOSE)
    things = []
    for k, x, y in decor():
        sp = rock() if k == "rock" else tree(k)
        things.append((x, sp, y, x))
    for t, x, y in (("arrow", 165, 128), ("gun", 360, 245), ("cannon", 300, 118)):
        things.append((x, tower(t, "enemy"), y, x))  # 攻城戦の塔は敵（赤い旗）
    things.append((450, castle(1), 150, 470))
    for (cx, cy) in ((90, 150), (230, 82), (230, 220)):
        for i in range(6):
            k = ["spearman", "ashigaru", "archer", "gunner", "medic", "cavalry"][i]
            things.append((cx + (i // 3) * 8, unit(k, "ally", "walk", i % 2), cy - 8 + (i % 3) * 8, cx + (i // 3) * 8))
    for i, (x, y) in enumerate(((300, 150), (310, 140), (310, 160), (390, 150), (398, 142))):
        things.append((x, unit(["spearman", "archer", "ashigaru", "gunner", "spearman"][i], "enemy", "idle", i % 2), y, x))
    things.sort(key=lambda t: t[0])
    for _, sp, x, y in things:
        place(g, sp, x, y)
    return g


def make_fields(current_defense=None):
    """iPhone 390px幅・画素密度3（1170ドット）で、今の絵（あれば）と並べる"""
    d_scene = scene_defense().resize((1170, 731), Image.NEAREST)
    s_scene = scene_siege().resize((879, 1407), Image.NEAREST)
    out = []
    # 防衛戦（横向き）
    W = 1170 * (2 if current_defense else 1) + (60 if current_defense else 0) + 40
    im = Image.new("RGBA", (W, 731 + 120), BG)
    d = ImageDraw.Draw(im)
    label(d, (20, 16), "防衛戦（横向き）の見本　iPhone 390px幅・画素密度3の実寸（1170×731ドット）", 30, HEAD)
    x = 20
    if current_defense:
        cur = Image.open(current_defense).convert("RGBA").resize((1170, 731))
        im.alpha_composite(cur, (x, 70))
        label(d, (x + 585, 70 + 731 + 10), "今の絵", 28, HEAD, "ma")
        x += 1170 + 60
    im.alpha_composite(d_scene, (x, 70))
    label(d, (x + 585, 70 + 731 + 10), "試作のドット絵（同じ道の形・同じ大きさ）", 28, HEAD, "ma")
    path = os.path.join(OUT_DOC, "field-defense.png")
    im.convert("RGB").save(path)
    out.append(path)
    # 攻城戦（縦向き）
    im = Image.new("RGBA", (879 + 40, 1407 + 120), BG)
    d = ImageDraw.Draw(im)
    label(d, (20, 16), "攻城戦（縦向き）の見本　879×1407ドット", 30, HEAD)
    im.alpha_composite(s_scene, (20, 70))
    path = os.path.join(OUT_DOC, "field-siege.png")
    im.convert("RGB").save(path)
    out.append(path)
    return out


if __name__ == "__main__":
    os.makedirs(OUT_DOC, exist_ok=True)
    cur = sys.argv[1] if len(sys.argv) > 1 else None
    print(make_sheet())
    for p in make_fields(cur):
        print(p)
