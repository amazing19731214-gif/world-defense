#!/usr/bin/env python3
"""ドット絵の第2試作（v105試作2）。ゲームには組み込まない。

第1試作（make_proto_art.py）より描き込みと立体感を増やした、兵士1種（槍兵）・塔1種（弓の塔）・城1種（通常）・背景1種（草原と道と木）。

  python3 tools/proto/make_proto_art_v2.py

変えたこと：
- 色を4〜5段（濃い影・影・中間・明るい・ハイライト）にし、左上からの光で塗る。
- 輪郭線を、となりの色をぐっと暗くした色で描く（一色の輪郭より柔らかく立体的）。
- 草原は色むら（ゆるやかなノイズ）・草の房・花・小石・木の影を重ね、単調な平面にしない。
"""
from __future__ import annotations

import math
import os
import random
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_proto_art import OUT_ASSET  # noqa: E402

OUT2 = os.path.join(OUT_ASSET, "v2")


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def dark(c, k=0.45):
    return tuple(int(v * k) for v in c[:3])


def ramp(base, n=5):
    """濃い影 → ハイライトの段階"""
    deep = mix(dark(base, 0.42), (40, 20, 60), 0.25)
    hi = mix(base, (255, 248, 225), 0.55)
    out = []
    for i in range(n):
        t = i / (n - 1)
        out.append(mix(deep, base, t * 2) if t <= 0.5 else mix(base, hi, (t - 0.5) * 2))
    return out


class Sprite2:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[None] * w for _ in range(h)]

    def set(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.w and 0 <= y < self.h and c is not None:
            self.px[y][x] = tuple(c[:3])

    def get(self, x, y):
        return self.px[y][x] if 0 <= x < self.w and 0 <= y < self.h else None

    def rect(self, x0, y0, x1, y1, c):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.set(x, y, c)

    def line(self, x0, y0, x1, y1, c):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n):
            t = i / max(1, n - 1)
            self.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c)

    def blob(self, cx, cy, rx, ry, R, light=(-0.55, -0.65)):
        """楕円を光の向きで段階的に塗る（R：ramp）。左上が明るく、右下が暗い"""
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                dx, dy = (x - cx) / max(rx, 0.5), (y - cy) / max(ry, 0.5)
                d = dx * dx + dy * dy
                if d > 1:
                    continue
                shade = -(dx * light[0] + dy * light[1]) * 0.8 + (1 - d) * 0.35
                k = 0 if shade < -0.45 else 1 if shade < -0.05 else 2 if shade < 0.3 else 3 if shade < 0.55 else 4
                self.set(x, y, R[min(len(R) - 1, k)])

    def outline(self, k=0.38, only=None):
        """となりの色を暗くした輪郭線（選択的な輪郭）"""
        add = []
        for y in range(self.h):
            for x in range(self.w):
                if self.px[y][x] is not None:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    c = self.get(x + dx, y + dy)
                    if c is not None:
                        add.append((x, y, mix(dark(c, k), (34, 18, 24), 0.35)))
                        break
        for x, y, c in add:
            self.px[y][x] = c
        return self

    def image(self, scale=1):
        im = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        for y in range(self.h):
            for x in range(self.w):
                if self.px[y][x] is not None:
                    im.putpixel((x, y), (*self.px[y][x], 255))
        return im.resize((self.w * scale, self.h * scale), Image.NEAREST) if scale != 1 else im


# ===== 色 =====
SKIN = [(176, 104, 78), (222, 150, 110), (248, 196, 150), (255, 222, 186)]
AI = {"ally": ramp((62, 92, 168)), "enemy": ramp((184, 52, 46))}  # 具足（藍／赤）
RED = ramp((206, 62, 50))  # 兜（朱）
GOLD = [(140, 88, 24), (200, 140, 36), (246, 198, 64), (255, 236, 150)]
STEEL = [(96, 104, 120), (156, 166, 182), (214, 222, 232), (250, 252, 255)]
WOOD = [(86, 50, 30), (124, 76, 42), (168, 112, 64), (206, 154, 98), (232, 196, 140)]
CLOTH = [(40, 36, 52), (64, 58, 80), (92, 86, 112)]
LACE = {"ally": (228, 236, 255), "enemy": (255, 226, 160)}  # 縅（おどし）の糸
FLAG = {"ally": ramp((76, 118, 210)), "enemy": ramp((214, 60, 52))}


# ===== 兵士：槍兵（22×26） =====
def spearman_v2(team="ally", pose="idle"):
    s = Sprite2(22, 26)
    A, F = AI[team], FLAG[team]
    atk = pose == "attack"
    # 背旗（家紋の丸）
    s.line(3, 1, 3, 17, WOOD[1])
    s.line(4, 1, 4, 17, WOOD[2])
    s.rect(0, 2, 2, 10, F[2])
    s.rect(0, 2, 0, 10, F[3])
    s.rect(2, 2, 2, 10, F[1])
    s.set(1, 5, (245, 240, 225))
    s.set(1, 6, (245, 240, 225))
    s.set(0, 5, F[4])
    # 脚：袴・すね当て・わらじ
    for lx in (8, 13):
        s.rect(lx, 21, lx + 2, 22, CLOTH[1])
        s.rect(lx, 21, lx, 22, CLOTH[2])
        s.rect(lx, 23, lx + 2, 24, A[1])
        s.set(lx, 23, A[3])
        s.rect(lx - 1, 25, lx + 2, 25, WOOD[3])
    # 草摺（腰の板）
    for i, x in enumerate(range(7, 17, 3)):
        s.rect(x, 19, x + 2, 20, A[2])
        s.rect(x, 19, x, 20, A[3])
        s.set(x + 2, 20, A[1])
        s.set(x + 1, 19, LACE[team])
    # 胴：板の段（明暗の筋）と縅の糸
    for y in range(13, 19):
        row = A[3] if y % 2 == 1 else A[2]
        s.rect(7, y, 16, y, row)
        s.set(7, y, A[4] if y % 2 else A[3])
        s.set(16, y, A[1])
    for y in (14, 16):
        for x in range(8, 16, 2):
            s.set(x, y, LACE[team])
    s.rect(7, 18, 16, 18, WOOD[1])  # 帯
    s.set(10, 18, GOLD[2])
    # 袖（肩の大きな板）
    s.rect(5, 13, 8, 17, A[2])
    s.rect(5, 13, 5, 17, A[3])
    s.rect(8, 14, 8, 17, A[1])
    s.set(6, 15, LACE[team])
    s.set(6, 17, LACE[team])
    # 顔
    s.rect(9, 8, 15, 13, SKIN[2])
    s.rect(9, 8, 10, 9, SKIN[3])
    s.rect(9, 12, 15, 13, SKIN[1])
    s.set(15, 11, SKIN[1])
    s.set(13, 10, (34, 24, 26))
    s.set(13, 9, (120, 70, 50))  # 眉
    s.set(14, 12, (200, 110, 96))  # 口
    s.set(11, 11, (255, 172, 150))  # ほお
    s.rect(8, 8, 8, 12, (70, 46, 40))  # もみあげ
    # 兜：しころ（首の後ろの段）・鉢・吹返し・前立て
    for i, y in enumerate((8, 9, 10, 11)):
        s.rect(5 + (1 if i == 3 else 0), y, 8, y, RED[1] if i % 2 else RED[2])
    s.rect(7, 3, 16, 7, RED[2])
    s.rect(8, 2, 15, 2, RED[2])
    s.rect(8, 3, 11, 4, RED[3])
    s.rect(9, 2, 10, 2, RED[4])
    s.rect(14, 4, 16, 7, RED[1])
    for x in (10, 13):  # 鋲
        s.set(x, 5, RED[0])
    s.rect(7, 7, 16, 7, RED[0])  # 眉庇の影
    s.rect(16, 6, 17, 8, RED[2])  # 吹返し
    s.set(17, 6, GOLD[2])
    # 前立て（金の三日月。陰影つき）
    for x, y, k in ((9, 1, 1), (10, 0, 2), (11, 0, 3), (12, 0, 3), (13, 0, 2), (14, 1, 1), (11, 1, 2), (12, 1, 1)):
        s.set(x, y, GOLD[k])
    # 腕（籠手）と槍
    if atk:
        s.rect(14, 15, 18, 16, A[1])
        s.rect(18, 15, 19, 16, SKIN[2])
        s.line(7, 16, 21, 16, WOOD[2])
        s.line(7, 17, 21, 17, WOOD[1])
        s.rect(19, 14, 21, 18, STEEL[2])
        s.line(19, 14, 21, 14, STEEL[3])
        s.set(21, 18, STEEL[1])
        s.rect(17, 15, 18, 18, (220, 50, 50))  # 房
    else:
        s.rect(15, 14, 17, 16, A[1])
        s.rect(17, 14, 18, 16, SKIN[2])
        s.line(18, 25, 18, 4, WOOD[2])
        s.line(19, 25, 19, 4, WOOD[1])
        s.rect(18, 0, 19, 3, STEEL[2])
        s.set(18, 0, STEEL[3])
        s.set(19, 3, STEEL[1])
        s.rect(17, 4, 20, 5, (220, 50, 50))  # 房
        s.set(17, 4, (255, 120, 110))
    s.outline()
    return s


# ===== 塔：弓の塔（42×56） =====
def arrow_tower_v2(team="ally"):
    s = Sprite2(42, 56)
    rnd = random.Random(7)
    STONE = [(92, 90, 88), (132, 128, 120), (170, 166, 156), (206, 202, 190), (230, 228, 218)]
    # 石垣の土台（ひとつずつ陰影のある石）
    for row, y in enumerate(range(46, 55, 3)):
        x = 4 - (row % 2) * 2
        while x < 38:
            w = rnd.choice((4, 5, 6))
            x1 = min(37, x + w - 1)
            s.rect(x, y, x1, y + 2, STONE[2])
            s.rect(x, y, x1, y, STONE[3])
            s.set(x, y, STONE[4])
            s.rect(x, y + 2, x1, y + 2, STONE[1])
            s.set(x1, y + 1, STONE[1])
            if rnd.random() < 0.3:
                s.set(x + 1, y + 1, (110, 150, 90))  # 苔
            x = x1 + 2
    # 柱（奥の2本は暗く、手前の2本は木目つき）
    for x, back in ((10, True), (30, True), (6, False), (33, False)):
        R = WOOD[:3] if back else WOOD[1:]
        s.rect(x, 21, x + 2, 45, R[1])
        s.rect(x, 21, x, 45, R[2])
        s.rect(x + 2, 21, x + 2, 45, R[0])
        if not back:
            for y in range(24, 45, 5):
                s.set(x + 1, y, R[0])
    # 筋かい（交差）と縄の結び目
    s.line(9, 25, 32, 42, WOOD[1])
    s.line(9, 26, 32, 43, WOOD[2])
    s.line(32, 25, 9, 42, WOOD[1])
    s.line(32, 26, 9, 43, WOOD[2])
    s.rect(6, 33, 35, 34, WOOD[2])
    s.rect(6, 34, 35, 34, WOOD[1])
    for x, y in ((7, 33), (34, 33), (20, 33)):
        s.set(x, y, (226, 196, 140))
        s.set(x, y + 1, (190, 156, 100))
    # 足場（板目）
    s.rect(3, 18, 38, 21, WOOD[2])
    s.rect(3, 18, 38, 18, WOOD[3])
    s.rect(3, 21, 38, 21, WOOD[0])
    for x in range(5, 38, 4):
        s.set(x, 19, WOOD[1])
        s.set(x + 2, 20, WOOD[1])
    # 手すりと、前に垂らした幕（家紋）
    s.rect(3, 13, 38, 13, WOOD[3])
    for x in range(4, 39, 5):
        s.rect(x, 13, x, 17, WOOD[2])
    F = FLAG[team]
    s.rect(14, 14, 27, 20, F[2])
    s.rect(14, 14, 27, 14, F[3])
    s.rect(14, 20, 27, 20, F[1])
    for x, y in ((20, 16), (21, 16), (20, 17), (21, 17)):
        s.set(x, y, (245, 240, 225))
    s.set(19, 17, (245, 240, 225))
    s.set(22, 16, (245, 240, 225))
    # 弓兵（陣笠・弓を引く）
    s.rect(18, 8, 23, 12, SKIN[2])
    s.rect(18, 8, 19, 9, SKIN[3])
    s.set(22, 10, (34, 24, 26))
    HAT = [(90, 72, 50), (130, 106, 74), (172, 146, 106), (206, 184, 140)]
    s.rect(15, 7, 26, 7, HAT[1])
    s.rect(17, 6, 24, 6, HAT[2])
    s.rect(19, 5, 22, 5, HAT[3])
    s.rect(15, 7, 18, 7, HAT[2])
    s.rect(18, 13, 23, 13, AI[team][2])
    s.line(27, 3, 29, 8, WOOD[1])
    s.line(29, 8, 29, 13, WOOD[1])
    s.line(29, 13, 27, 17, WOOD[1])
    s.line(26, 4, 26, 16, (230, 225, 210))
    s.line(23, 10, 31, 10, (240, 236, 220))
    s.set(32, 10, STEEL[2])
    # 屋根（瓦の段・反り・鬼瓦）
    ROOF = [(30, 36, 60), (48, 58, 92), (70, 84, 128), (100, 118, 168), (150, 168, 210)]
    for i, (y, x0, x1) in enumerate(((0, 13, 28), (1, 9, 32), (2, 6, 35), (3, 3, 38), (4, 1, 40))):
        s.rect(x0, y, x1, y, ROOF[2] if i % 2 == 0 else ROOF[1])
        s.rect(x0, y, x0 + 4, y, ROOF[3])
    s.rect(14, 0, 22, 0, ROOF[4])
    s.set(0, 3, ROOF[2])  # 軒の反り
    s.set(41, 3, ROOF[2])
    s.rect(2, 5, 39, 5, ROOF[0])  # 軒下の影
    s.rect(12, 0, 13, 0, GOLD[2])  # 鬼瓦
    s.rect(28, 0, 29, 0, GOLD[2])
    for x in (6, 35):
        s.rect(x, 6, x + 1, 12, WOOD[1])
    # のぼり旗
    s.line(39, 6, 39, 45, WOOD[1])
    s.rect(40, 8, 41, 22, F[2])
    s.rect(40, 8, 40, 22, F[3])
    s.outline()
    return s


# ===== 城（通常・108×92） =====
def castle_v2():
    W, H = 108, 92
    s = Sprite2(W, H)
    cx = W // 2
    rnd = random.Random(3)
    STONE = [(86, 84, 82), (124, 120, 114), (160, 156, 146), (196, 192, 180), (224, 222, 210)]
    WALL = [(170, 164, 150), (214, 208, 194), (242, 238, 226), (255, 253, 245)]
    ROOF = [(26, 32, 54), (42, 52, 84), (62, 76, 118), (92, 110, 160), (140, 160, 206)]
    BLACK = [(28, 26, 32), (52, 50, 60), (80, 78, 92)]
    # 石垣：裾が広がる反り。石ごとの陰影
    top = 62
    for y in range(top, H - 1):
        t = (y - top) / (H - 1 - top)
        half = 38 + 12 * t * t
        s.rect(cx - half, y, cx + half, y, STONE[2])
    for r, y in enumerate(range(top, H - 2, 4)):
        t = (y - top) / (H - 1 - top)
        half = int(38 + 12 * t * t)
        x = cx - half + (r % 2) * 3
        while x < cx + half - 2:
            w = rnd.choice((5, 6, 7, 8))
            x1 = min(cx + half - 1, x + w - 1)
            c = STONE[2] if rnd.random() < 0.7 else STONE[1]
            s.rect(x, y, x1, y + 2, c)
            s.rect(x, y, x1, y, STONE[3] if c == STONE[2] else STONE[2])
            s.set(x, y, STONE[4])
            s.rect(x, y + 3, x1, y + 3, STONE[0])
            x = x1 + 2
    # 右側は日陰
    for y in range(top, H - 1):
        for x in range(cx + 20, W):
            c = s.get(x, y)
            if c:
                s.set(x, y, mix(c, (40, 40, 70), 0.25))
    # 門（屋根つき）
    s.rect(cx - 7, H - 14, cx + 7, H - 2, WOOD[1])
    s.rect(cx - 7, H - 14, cx - 6, H - 2, WOOD[2])
    s.line(cx, H - 13, cx, H - 2, WOOD[0])
    for y in (H - 11, H - 6):
        for x in (cx - 4, cx + 3):
            s.set(x, y, GOLD[2])
    s.rect(cx - 9, H - 16, cx + 9, H - 15, ROOF[2])
    s.rect(cx - 9, H - 16, cx - 2, H - 16, ROOF[3])

    def tier(y, half, h, rh):
        # 白壁（上）と黒い下見板（下）、格子窓、千鳥破風つきの屋根
        s.rect(cx - half, y, cx + half, y + h, WALL[2])
        s.rect(cx - half, y, cx - half + 2, y + h, WALL[3])
        s.rect(cx + half - 3, y, cx + half, y + h, WALL[1])
        s.rect(cx - half, y + h - 3, cx + half, y + h, BLACK[1])
        s.rect(cx - half, y + h - 3, cx + half, y + h - 3, BLACK[2])
        for x in range(cx - half + 4, cx + half - 4, 7):
            s.rect(x, y + 2, x + 3, y + 4, BLACK[0])
            s.set(x + 1, y + 3, BLACK[2])
            s.set(x + 3, y + 2, BLACK[2])
        ry = y - rh
        for i in range(rh):
            hw = half + 6 - i * 2
            s.rect(cx - hw, ry + rh - 1 - i, cx + hw, ry + rh - 1 - i, ROOF[2] if i % 2 == 0 else ROOF[1])
            s.rect(cx - hw, ry + rh - 1 - i, cx - hw + 5, ry + rh - 1 - i, ROOF[3])
        s.set(cx - half - 7, ry + rh - 2, ROOF[2])  # 軒の反り
        s.set(cx + half + 7, ry + rh - 2, ROOF[2])
        s.set(cx - half - 8, ry + rh - 3, ROOF[3])
        s.set(cx + half + 8, ry + rh - 3, ROOF[1])
        s.rect(cx - half - 5, ry + rh, cx + half + 5, ry + rh, ROOF[0])
        # 千鳥破風（中央の三角）
        for i in range(5):
            s.rect(cx - 6 + i, ry - i + 1, cx + 6 - i, ry - i + 1, ROOF[2])
        s.rect(cx - 2, ry - 2, cx + 2, ry, WALL[2])
        s.set(cx, ry - 3, GOLD[2])
        s.rect(cx - 6, ry + 1, cx + 6, ry + 1, GOLD[1])

    tier(50, 34, 11, 5)
    tier(34, 25, 10, 5)
    tier(19, 16, 9, 5)
    # 天守の最上階の屋根としゃちほこ
    ty = 10
    for i in range(5):
        hw = 14 - i * 2
        s.rect(cx - hw, ty + 4 - i, cx + hw, ty + 4 - i, ROOF[2] if i % 2 == 0 else ROOF[1])
        s.rect(cx - hw, ty + 4 - i, cx - hw + 3, ty + 4 - i, ROOF[3])
    s.rect(cx - 15, ty + 5, cx + 15, ty + 5, ROOF[0])
    for sx in (-6, 6):
        s.rect(cx + sx - 1, ty - 3, cx + sx, ty, GOLD[2])
        s.set(cx + sx - (1 if sx < 0 else 0), ty - 4, GOLD[3])
        s.set(cx + sx + (1 if sx < 0 else -1), ty - 1, GOLD[1])
    # のぼり旗（家紋）
    F = FLAG["ally"]
    for x in (cx - 46, cx + 44):
        s.line(x, 30, x, 66, WOOD[1])
        s.rect(x + 1, 32, x + 4, 52, F[2])
        s.rect(x + 1, 32, x + 1, 52, F[3])
        s.rect(x + 4, 32, x + 4, 52, F[1])
        s.set(x + 2, 37, (245, 240, 225))
        s.set(x + 3, 37, (245, 240, 225))
        s.set(x + 2, 38, (245, 240, 225))
    s.outline()
    return s


# ===== 背景：草原・道・木（192×120） =====
def value_noise(w, h, cell, seed):
    rnd = random.Random(seed)
    gw, gh = w // cell + 2, h // cell + 2
    g = [[rnd.random() for _ in range(gw)] for _ in range(gh)]
    out = [[0.0] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            fx, fy = x / cell, y / cell
            x0, y0 = int(fx), int(fy)
            tx, ty = fx - x0, fy - y0
            tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
            a = g[y0][x0] + (g[y0][x0 + 1] - g[y0][x0]) * tx
            b = g[y0 + 1][x0] + (g[y0 + 1][x0 + 1] - g[y0 + 1][x0]) * tx
            out[y][x] = a + (b - a) * ty
    return out


GRASS = [(84, 140, 70), (106, 164, 78), (128, 186, 88), (154, 204, 100), (186, 222, 120)]


def tree_v2(kind="round", seed=1):
    rnd = random.Random(seed)
    if kind == "pine":
        s = Sprite2(26, 34)
        s.rect(11, 22, 14, 32, WOOD[1])
        s.rect(11, 22, 11, 32, WOOD[2])
        s.rect(14, 22, 14, 32, WOOD[0])
        G = [(36, 78, 58), (50, 104, 70), (70, 132, 82), (100, 160, 96), (140, 190, 120)]
        for y, half in ((4, 4), (9, 7), (14, 10), (19, 12)):
            s.blob(13, y + 2, half, 3.4, G)
        s.set(13, 1, G[3])
        s.outline()
        return s
    if kind == "sakura":
        s = Sprite2(30, 32)
        s.rect(13, 20, 16, 30, WOOD[0])
        s.rect(13, 20, 13, 30, WOOD[1])
        s.line(14, 22, 9, 17, WOOD[0])
        P = [(168, 92, 120), (214, 128, 160), (240, 168, 196), (252, 204, 222), (255, 236, 244)]
        for (x, y, r) in ((9, 12, 6), (20, 11, 7), (15, 7, 7), (14, 15, 7), (6, 17, 4), (23, 17, 5)):
            s.blob(x, y, r, r * 0.8, P)
        for _ in range(10):
            s.set(rnd.randrange(4, 26), rnd.randrange(4, 20), P[4])
        s.outline()
        return s
    if kind == "bush":
        s = Sprite2(18, 12)
        for (x, y, r) in ((5, 7, 4.5), (11, 6, 5), (14, 8, 3.5)):
            s.blob(x, y, r, r * 0.8, GRASS[:4] + [(200, 230, 150)])
        s.set(6, 5, (250, 236, 170))
        s.set(12, 4, (250, 236, 170))
        s.outline()
        return s
    # 広葉樹：葉のかたまりを重ねて光の向きで塗る
    s = Sprite2(30, 34)
    s.rect(13, 20, 16, 32, WOOD[1])
    s.rect(13, 20, 13, 32, WOOD[2])
    s.rect(16, 20, 16, 32, WOOD[0])
    s.set(14, 25, WOOD[0])
    s.set(15, 29, WOOD[0])
    s.line(15, 23, 20, 18, WOOD[1])
    L = [(40, 92, 56), (60, 122, 64), (88, 152, 74), (126, 184, 90), (176, 214, 120)]
    for (x, y, r) in ((9, 14, 7), (20, 14, 7), (14, 8, 8), (15, 17, 7), (6, 18, 4.5), (24, 19, 4.5)):
        s.blob(x, y, r, r * 0.85, L)
    for _ in range(14):
        x, y = rnd.randrange(4, 26), rnd.randrange(3, 22)
        if s.get(x, y):
            s.set(x, y, L[1] if rnd.random() < 0.5 else L[4])
    s.outline()
    return s


def ground_v2(W=192, H=120, seed=5, road=True):
    """明るく温かみのある草原：ゆるやかな色むら・草の房・花・小石、曲がった道"""
    im = Image.new("RGBA", (W, H))
    n1 = value_noise(W, H, 20, seed)
    n2 = value_noise(W, H, 6, seed + 1)
    rnd = random.Random(seed)
    px = im.load()

    def road_d(x, y):
        cy = 64 + 16 * math.sin(x / 34)
        return abs(y - cy)

    for y in range(H):
        for x in range(W):
            v = n1[y][x] * 0.7 + n2[y][x] * 0.3
            k = 1 if v < 0.36 else 2 if v < 0.58 else 3
            if v > 0.74:
                k = 4
            c = GRASS[k]
            if (x + y * 3) % 7 == 0 and v > 0.5:  # 細かいゆらぎ（ディザ）
                c = GRASS[k - 1]
            px[x, y] = (*c, 255)
    # 道（端は暗く、轍と小石）
    if road:
        SAND = [(150, 112, 70), (196, 156, 102), (226, 192, 136), (240, 214, 164), (250, 234, 196)]
        for y in range(H):
            for x in range(W):
                d = road_d(x, y)
                if d < 11:
                    k = 2 if d < 9 else 1
                    if abs(d - 5) < 0.6 and x % 3:
                        k = 1  # 轍
                    if d < 3 and (x * 7 + y) % 11 == 0:
                        k = 3
                    px[x, y] = (*SAND[k], 255)
                elif d < 12.5:
                    px[x, y] = (*mix(SAND[0], GRASS[0], 0.4), 255)
                elif d < 14 and y > 64 + 16 * math.sin(x / 34):
                    px[x, y] = (*GRASS[0], 255)  # 道の下の草の影
        for _ in range(26):
            x = rnd.randrange(W)
            y = int(64 + 16 * math.sin(x / 34) + rnd.uniform(-8, 8))
            if 0 <= y < H:
                px[x, y] = (*SAND[3], 255)
                if y + 1 < H:
                    px[x, y + 1] = (*SAND[0], 255)
    # 草の房・花・小石（道の外）
    for _ in range(170):
        x, y = rnd.randrange(1, W - 1), rnd.randrange(2, H - 1)
        if road and road_d(x, y) < 15:
            continue
        r = rnd.random()
        if r < 0.55:  # 草の房（明るい先と暗い根元）
            px[x, y] = (*GRASS[0], 255)
            px[x, y - 1] = (*GRASS[3], 255)
            if x + 1 < W:
                px[x + 1, y - 1] = (*GRASS[4], 255)
        elif r < 0.85:  # 花（白・黄・桃）と葉
            col = rnd.choice(((255, 250, 236), (255, 222, 96), (250, 160, 190), (190, 170, 255)))
            px[x, y] = (*col, 255)
            px[x, y + 1] = (*GRASS[1], 255)
            if rnd.random() < 0.5 and x + 1 < W:
                px[x + 1, y] = (*col, 255)
        else:  # 小石
            px[x, y] = (186, 182, 170, 255)
            px[x + 1, y] = (150, 146, 136, 255)
            px[x, y + 1] = (110, 106, 100, 255)
    # 木（種類を混ぜる）と影
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sp = shadow.load()
    trees = [("round", 18, 40, 1), ("pine", 46, 32, 2), ("sakura", 150, 36, 3), ("round", 176, 42, 4),
             ("bush", 98, 30, 5), ("round", 30, 112, 6), ("sakura", 92, 116, 7), ("pine", 132, 112, 8), ("bush", 170, 108, 9), ("bush", 62, 104, 10)]
    for kind, x, bottom, sd in trees:
        for yy in range(bottom - 3, bottom + 2):
            for xx in range(x - 11, x + 12):
                if 0 <= xx < W and 0 <= yy < H and ((xx - x) / 11) ** 2 + ((yy - bottom + 1) / 3) ** 2 <= 1:
                    sp[xx, yy] = (24, 60, 30, 90)
    im.alpha_composite(shadow)
    for kind, x, bottom, sd in sorted(trees, key=lambda t: t[2]):
        t = tree_v2(kind, sd).image()
        im.alpha_composite(t, (x - t.width // 2, bottom - t.height + 1))
    return im


if __name__ == "__main__":
    os.makedirs(OUT2, exist_ok=True)
    for team in ("ally", "enemy"):
        for pose in ("idle", "attack"):
            spearman_v2(team, pose).image().save(os.path.join(OUT2, f"spearman_{team}_{pose}.png"))
        arrow_tower_v2(team).image().save(os.path.join(OUT2, f"tower_arrow_{team}.png"))
    castle_v2().image().save(os.path.join(OUT2, "castle_1.png"))
    for k in ("round", "pine", "sakura", "bush"):
        tree_v2(k, 2).image().save(os.path.join(OUT2, f"tree_{k}.png"))
    ground_v2().save(os.path.join(OUT2, "ground.png"))
    print("ok")
