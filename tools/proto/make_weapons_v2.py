#!/usr/bin/env python3
"""武器を大きくした兵士の試作（武器だけ描き直す）。ゲームには組み込まない。

  python3 tools/proto/make_weapons_v2.py

兵士の体（make_proto_set_v2.py の soldier_v2 / cavalry_v2）はそのままに、武器と腕だけを大きくデフォルメして描く。
- 絵の枠を広げる：歩兵 22×26 → 30×31（体は左に2・上に5ずらして置く）、騎兵 34×30 → 44×36。
- 刀：太い刃に光沢の筋ときらめき、金の鍔、菱巻きの柄。攻撃は大きな振りの軌跡。
- 槍：木の葉形の大きな穂先（光沢つき）と赤い房。攻撃は前へ突き出し、勢いの線。
- 弓：黒漆に金の握りの大きな弓（2ドット幅）。攻撃は弦を引き、鋼の矢じりと矢羽根。
- 火縄銃：3ドット幅の銃身に光の筋と真鍮の帯、木の台。攻撃は大きな火と煙。
- 衛生兵の杖：大きな金の輪（錫杖）と鈴。回復の攻撃は緑の光。
- 騎兵：反りのある大きな刃の薙刀。攻撃は前へ突き出す。
"""
from __future__ import annotations

import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_proto_art import OUT_ASSET  # noqa: E402
from make_proto_set_v2 import (  # noqa: E402
    Sprite2, SKIN, AI, GOLD, STEEL, WOOD, WHITE, IRON, FIRE, HERB, KINDS, POSES, soldier_v2,
)

OUTW = os.path.join(OUT_ASSET, "v2weapon")
BLADE = [(84, 96, 120), (150, 164, 188), (210, 222, 238), (248, 252, 255)]  # 刃（暗→光）
LACQ = [(40, 22, 22), (92, 36, 30), (150, 58, 44)]  # 黒漆・朱
TASSEL = [(150, 30, 34), (220, 50, 50), (255, 130, 120)]
BRASS = [(150, 104, 40), (214, 160, 60), (255, 220, 120)]
SPARK = (255, 255, 236)


class Pen:
    """体の座標（22×26の枠）で描き、広げた枠へずらして置く"""

    def __init__(self, s, ox, oy):
        self.s, self.ox, self.oy = s, ox, oy
        self.fx = []  # 光・軌跡・煙（輪郭線を付けず、最後に重ねる）

    def glow(self, x, y, c=None):
        self.fx.append((x + self.ox, y + self.oy, c or SPARK))

    def set(self, x, y, c):
        self.s.set(x + self.ox, y + self.oy, c)

    def rect(self, x0, y0, x1, y1, c):
        self.s.rect(x0 + self.ox, y0 + self.oy, x1 + self.ox, y1 + self.oy, c)

    def line(self, x0, y0, x1, y1, c):
        self.s.line(x0 + self.ox, y0 + self.oy, x1 + self.ox, y1 + self.oy, c)


def paste(dst, src, ox, oy):
    for y in range(src.h):
        for x in range(src.w):
            if src.px[y][x] is not None:
                dst.set(x + ox, y + oy, src.px[y][x])


def arm(p, team, x1, y=14, oy=0, sleeve=None):
    """肩から手まで：籠手（具足の色）と手"""
    A = AI[team]
    p.rect(15, y + oy, x1 - 1, y + 1 + oy, sleeve or A[1])
    p.rect(15, y + oy, x1 - 1, y + oy, sleeve or A[2])
    p.rect(x1, y + oy, x1 + 1, y + 1 + oy, SKIN[2])


def katana(p, team, atk, oy):
    if atk:  # 前へ大きく振り下ろす：刃は右下へ、上に三日月の軌跡
        arm(p, team, 18, 14, oy)
        p.rect(18, 15 + oy, 20, 16 + oy, LACQ[0])  # 柄
        p.set(19, 15 + oy, LACQ[2])
        p.rect(20, 14 + oy, 21, 17 + oy, GOLD[2])  # 鍔
        p.set(20, 14 + oy, GOLD[3])
        p.line(22, 16 + oy, 27, 24 + oy, BLADE[3])  # 刃（3ドット幅）
        p.line(23, 16 + oy, 28, 24 + oy, BLADE[2])
        p.line(21, 17 + oy, 26, 25 + oy, BLADE[1])
        p.set(27, 25 + oy, BLADE[3])
        for x, y in ((21, 4), (24, 5), (26, 7), (27, 10), (27, 13), (22, 3), (19, 3)):  # 軌跡
            p.glow(x, y + oy)
        for x, y in ((23, 5), (25, 8), (26, 11)):
            p.glow(x, y + oy, (200, 220, 255))
    else:  # 刃を立てて構える：太い刃、光の筋、先のきらめき
        arm(p, team, 17, 14, oy)
        p.rect(17, 12 + oy, 19, 16 + oy, LACQ[0])  # 柄（菱巻き）
        p.set(18, 13 + oy, LACQ[2])
        p.set(18, 15 + oy, LACQ[2])
        p.rect(16, 11 + oy, 21, 11 + oy, GOLD[2])  # 鍔
        p.set(16, 11 + oy, GOLD[3])
        p.set(21, 11 + oy, GOLD[0])
        for i in range(13):  # 刃（右上へ、3ドット幅）
            x, y = 18 + i * 0.45, 10 - i + oy
            p.set(x - 1, y, BLADE[3])
            p.set(x, y, BLADE[2])
            p.set(x + 1, y, BLADE[1])
        p.set(23, -3 + oy, BLADE[3])
        for x, y in ((24, -4), (25, -3), (24, -2), (23, -5)):  # きらめき
            p.glow(x, y + oy)


def yari(p, team, atk, oy):
    if atk:  # 前へ突き出す
        arm(p, team, 18, 15, oy)
        p.line(5, 16 + oy, 22, 16 + oy, WOOD[2])
        p.line(5, 17 + oy, 22, 17 + oy, WOOD[1])
        p.rect(20, 18 + oy, 21, 20 + oy, TASSEL[1])  # 房（穂先の根元から下がる）
        p.set(20, 18 + oy, TASSEL[2])
        p.set(21, 21 + oy, TASSEL[0])
        p.rect(22, 15 + oy, 23, 18 + oy, BRASS[1])  # 口金
        for i, (t, b) in enumerate(((-1, 2), (-2, 3), (-2, 3), (-2, 3), (-1, 2), (-1, 2), (0, 1), (0, 1), (0, 0))):  # 先のとがった大きな穂先
            x = 24 + i
            p.rect(x, 16 + t + oy, x, 16 + b + oy, BLADE[2])
            p.set(x, 16 + t + oy, BLADE[3])
            p.set(x, 16 + b + oy, BLADE[1])
        for x, y in ((0, 14), (1, 14), (0, 19), (2, 19)):  # 勢いの線
            p.glow(x, y + oy)
    else:  # 立てて持つ：大きな穂先が頭の上に
        arm(p, team, 17, 14, oy)
        p.line(18, 25, 18, 2 + oy, WOOD[2])
        p.line(19, 25, 19, 2 + oy, WOOD[1])
        p.rect(18, 2 + oy, 21, 4 + oy, TASSEL[1])  # 房
        p.rect(18, 2 + oy, 21, 2 + oy, TASSEL[2])
        p.rect(19, 5 + oy, 21, 5 + oy, TASSEL[0])
        p.rect(18, 0 + oy, 19, 1 + oy, BRASS[1])  # 口金
        for i, (l, r) in enumerate(((-1, 2), (-2, 3), (-2, 3), (-2, 3), (-1, 2), (-1, 2), (0, 1), (0, 1), (0, 0))):  # 先のとがった大きな穂先
            y = -1 - i + oy
            p.rect(18 + l, y, 18 + r, y, BLADE[2])
            p.rect(18 + l, y, 18, y, BLADE[3] if i > 0 else BLADE[2])
            p.set(18 + r, y, BLADE[1])
            p.set(19, y, BLADE[1] if r > 1 else BLADE[2])
        p.set(18, -9 + oy, BLADE[3])
        for x, y in ((21, -8), (22, -7), (21, -6)):
            p.glow(x, y + oy)


def yumi(p, team, atk, oy):
    # 矢筒（背中）と矢羽根
    p.rect(4, 9 + oy, 6, 17 + oy, WOOD[3])
    p.rect(4, 9 + oy, 4, 17 + oy, WOOD[4])
    p.rect(6, 9 + oy, 6, 17 + oy, WOOD[1])
    for x in (4, 5, 6):
        p.set(x, 7 + oy, WHITE[3])
        p.set(x, 8 + oy, (220, 70, 60) if x == 5 else WHITE[2])
    bx = 21 if atk else 20
    arm(p, team, bx - 2, 14, oy)
    # 大きな弓（2ドット幅の黒漆、端は朱、握りは金）
    pts = [(bx - 3, -3), (bx - 1, -1), (bx, 2), (bx + 1, 6), (bx + 1, 10), (bx + 1, 14), (bx + 1, 18), (bx, 21), (bx - 1, 24), (bx - 3, 26)]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        p.line(x0, y0 + oy, x1, y1 + oy, LACQ[1])
        p.line(x0 + 1, y0 + oy, x1 + 1, y1 + oy, LACQ[0])
    for x, y in pts[:2] + pts[-2:]:
        p.set(x, y + oy, LACQ[2])
    p.rect(bx + 1, 13 + oy, bx + 2, 16 + oy, GOLD[2])
    p.set(bx + 1, 13 + oy, GOLD[3])
    sx = 12 if atk else bx - 3
    p.line(bx - 3, -3 + oy, sx, 14 + oy, WHITE[3])  # 弦
    p.line(sx, 14 + oy, bx - 3, 26 + oy, WHITE[3])
    if atk:  # 矢：鋼の矢じりと赤い矢羽根
        p.line(11, 14 + oy, 26, 14 + oy, WOOD[3])
        p.rect(27, 13 + oy, 28, 15 + oy, BLADE[2])
        p.set(29, 14 + oy, BLADE[3])
        p.set(27, 13 + oy, BLADE[3])
        p.rect(9, 13 + oy, 11, 13 + oy, (220, 70, 60))
        p.rect(9, 15 + oy, 11, 15 + oy, (220, 70, 60))


def teppo(p, team, atk, oy):
    arm(p, team, 16, 15, oy)
    p.rect(7, 16 + oy, 15, 18 + oy, WOOD[2])  # 台（木）
    p.rect(7, 16 + oy, 15, 16 + oy, WOOD[3])
    p.rect(7, 18 + oy, 15, 18 + oy, WOOD[1])
    p.rect(6, 17 + oy, 7, 19 + oy, WOOD[1])
    p.rect(14, 15 + oy, 27, 17 + oy, IRON[1])  # 銃身（3ドット幅）
    p.rect(14, 15 + oy, 27, 15 + oy, IRON[3])
    p.rect(14, 17 + oy, 27, 17 + oy, IRON[0])
    p.rect(27, 14 + oy, 27, 18 + oy, IRON[2])
    for x in (17, 22):  # 真鍮の帯
        p.rect(x, 15 + oy, x, 17 + oy, BRASS[1])
        p.set(x, 15 + oy, BRASS[2])
    p.rect(12, 14 + oy, 13, 15 + oy, BRASS[1])  # 火皿
    p.line(10, 19 + oy, 12, 20 + oy, FIRE[0])  # 火縄
    p.set(10, 19 + oy, FIRE[1])
    if atk:  # 大きな火と煙
        for x, y, c in ((28, 16, FIRE[2]), (29, 16, FIRE[2]), (28, 15, FIRE[1]), (28, 17, FIRE[1]), (29, 14, FIRE[1]), (29, 18, FIRE[1]),
                        (29, 15, FIRE[2]), (29, 17, FIRE[2]), (28, 13, FIRE[0]), (28, 19, FIRE[0])):
            p.glow(x, y + oy, c)
        for x, y in ((25, 11), (26, 10), (27, 11), (24, 9), (26, 12), (23, 10)):
            p.glow(x, y + oy, (214, 214, 210) if (x + y) % 2 else (176, 176, 172))


def shakujo(p, team, atk, oy):
    # 薬箱（背中）
    p.rect(3, 13 + oy, 6, 18 + oy, HERB[1])
    p.rect(3, 13 + oy, 6, 13 + oy, HERB[2])
    p.rect(6, 14 + oy, 6, 18 + oy, HERB[0])
    p.set(4, 15 + oy, (250, 244, 220))
    arm(p, team, 17, 14, oy, WHITE[1])
    p.line(19, 6 + oy, 19, 25, WOOD[3])  # 杖
    p.line(20, 6 + oy, 20, 25, WOOD[1])
    # 大きな金の輪（中が抜けた輪）と、左右に下がる小さな輪
    for y in range(-4, 5):
        for x in range(15, 25):
            d = ((x - 19.5) / 4.2) ** 2 + ((y - 0.3) / 4.2) ** 2
            if 0.5 < d <= 1.0:
                p.set(x, y + oy, GOLD[3] if (x < 19 and y < 0) else GOLD[2] if y < 3 else GOLD[1])
    p.rect(19, 4 + oy, 20, 5 + oy, GOLD[1])
    for x in (15, 24):
        p.set(x, 3 + oy, GOLD[2])
        p.set(x, 4 + oy, GOLD[1])
        p.set(x, 5 + oy, GOLD[2])
    if atk:  # 回復の緑の光
        for x, y in ((24, -3), (25, -1), (14, -2), (13, 1), (25, 4), (22, -4), (16, -4)):
            p.glow(x, y + oy, (170, 255, 180))
        for x, y in ((24, 0), (15, -1), (23, -2)):
            p.glow(x, y + oy)


WEAPON = {"ashigaru": katana, "spearman": yari, "archer": yumi, "gunner": teppo, "medic": shakujo}


def naginata(p, team, atk, ry):
    """騎兵の薙刀（反りのある大きな刃）"""
    A = AI[team]
    if atk:
        p.rect(16, ry + 6, 20, ry + 7, A[1])
        p.rect(20, ry + 6, 21, ry + 7, SKIN[2])
        p.line(10, ry + 6, 33, ry + 5, WOOD[2])
        p.line(10, ry + 7, 33, ry + 6, WOOD[1])
        p.rect(33, ry + 4, 34, ry + 7, BRASS[1])
        for i, (y0, y1) in enumerate(((ry + 4, ry + 7), (ry + 3, ry + 7), (ry + 3, ry + 6), (ry + 3, ry + 6), (ry + 2, ry + 5), (ry + 2, ry + 4), (ry + 1, ry + 3), (ry + 1, ry + 2))):
            p.rect(35 + i, y0, 35 + i, y1, BLADE[2])
            p.set(35 + i, y0, BLADE[3])
            p.set(35 + i, y1, BLADE[1])
        p.set(43, ry, BLADE[3])
        for x, y in ((2, ry + 3), (4, ry + 3), (3, ry + 9)):
            p.glow(x, y)
    else:
        p.rect(16, ry + 6, 19, ry + 7, A[1])
        p.rect(19, ry + 6, 20, ry + 7, SKIN[2])
        p.line(15, ry + 12, 29, ry - 5, WOOD[2])
        p.line(16, ry + 12, 30, ry - 5, WOOD[1])
        p.rect(29, ry - 7, 31, ry - 5, BRASS[1])
        for i in range(8):  # 反りのある刃（右上へ、先が曲がる）
            x, y = 31 + i * 0.55 + (i * i) * 0.04, ry - 8 - i
            p.set(x - 1, y, BLADE[3])
            p.set(x, y, BLADE[2])
            p.set(x + 1, y, BLADE[1])
        for x, y in ((37, ry - 17), (38, ry - 16), (37, ry - 15)):
            p.glow(x, y)
        p.set(28, ry - 4, TASSEL[1])
        p.set(27, ry - 4, TASSEL[2])


def soldier_w(kind, team="ally", pose="idle", frame=0, style=None):
    """style：上級職・大将の描き分け（make_proto_set_v2.soldier_v2 の style に加えて "weapon": f(pen, team, atk, oy または ry)）"""
    atk = pose == "attack"
    oy = 1 if (pose == "idle" and frame == 1) else 0
    weapon = (style or {}).get("weapon")
    if kind == "cavalry":
        ox, oyy = 2, 6
        s = Sprite2(46, 36)
        paste(s, soldier_v2("cavalry", team, pose, frame, bare=True, style=style), ox, oyy)
        by = 18 - (1 if (pose == "walk" and frame == 0) or (pose == "idle" and frame == 1) else 0)
        pen = Pen(s, ox, oyy)
        if (style or {}).get("top"):
            style["top"](pen, by - 13)  # 乗り手の兜の飾りなど（枠の上へはみ出せる）
        (weapon or naginata)(pen, team, atk, by - 13)
    else:
        ox, oyy = 2, 6
        s = Sprite2(32, 32)
        paste(s, soldier_v2(kind, team, pose, frame, bare=True, style=style), ox, oyy)
        pen = Pen(s, ox, oyy)
        if (style or {}).get("top"):
            style["top"](pen, oy)  # 兜の大きな飾りなど（体の枠の上へはみ出せる）
        (weapon or WEAPON[kind])(pen, team, atk, oy)
    s.outline()
    for x, y, c in pen.fx:
        s.set(x, y, c)
    return s


# 足元の位置（絵の中で体の中心と足の下端）：ゲームに置くときの基準
ANCHOR = {"soldier": (13, 31), "cavalry": (19, 35)}

if __name__ == "__main__":
    os.makedirs(OUTW, exist_ok=True)
    n = 0
    for kind in KINDS:
        for team in ("ally", "enemy"):
            for pose, f in POSES:
                soldier_w(kind, team, pose, f).image().save(os.path.join(OUTW, f"{kind}_{team}_{pose}{f}.png"))
                n += 1
    print(n, "files")
