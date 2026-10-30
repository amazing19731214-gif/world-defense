#!/usr/bin/env python3
"""WORLD DEFENSE ドット絵の試作（v105試作）。

ゲームにはまだ組み込まない。兵士6種・塔4種・城・背景をコードで1ドットずつ描き、
assets/proto/ に等倍のPNG、docs/proto/ に一覧と実寸の比較画像を出す。

  python3 tools/proto/make_proto_art.py

方針：
- 1ドットの輪郭線（こげ茶）と、上からの光（明・中・暗の3段）で統一する。
- 兵士は 20×24 ドット、騎兵は 30×26 ドット。ゲームでは2倍前後（高精細の描画で整数に近い倍率）で表示する想定。
- 味方は藍色の具足と背旗、敵は赤い具足と背旗で区別する（同じ絵を色だけ替える）。
"""
from __future__ import annotations

import math
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_ASSET = os.path.join(ROOT, "assets", "proto")
OUT_DOC = os.path.join(ROOT, "docs", "proto")

OUTLINE = (52, 34, 30, 255)

# ===== 色 =====
P = {
    "skin": (248, 204, 160), "skinD": (214, 158, 118),
    "eye": (40, 28, 26),
    "white": (246, 242, 230), "whiteD": (206, 200, 186),
    "steel": (214, 222, 230), "steelD": (140, 150, 162),
    "wood": (170, 112, 62), "woodD": (118, 74, 40), "woodL": (204, 150, 92),
    "black": (46, 44, 52), "blackL": (84, 84, 96),
    "gold": (246, 200, 72), "goldD": (196, 140, 40),
    "pants": (70, 62, 78),
    "green": (96, 168, 84), "greenD": (60, 120, 62),
    "water": (90, 170, 236), "waterL": (190, 232, 255), "waterD": (52, 110, 190),
    "stone": (168, 166, 158), "stoneD": (120, 118, 112), "stoneL": (204, 202, 194),
    "roof": (58, 70, 104), "roofL": (96, 112, 152), "roofD": (36, 44, 70),
    "wall": (244, 240, 228), "wallD": (206, 200, 186),
    "horse": (164, 98, 52), "horseD": (110, 62, 34), "horseL": (204, 140, 84), "mane": (60, 38, 30),
    "fire": (255, 168, 64), "fireL": (255, 236, 150),
}
# 味方（藍）と敵（赤）。兵種ごとの差し色は帽子・背旗・小物で出す
TEAMS = {
    "ally": {"armor": (60, 88, 150), "armorL": (98, 130, 196), "armorD": (38, 56, 104), "flag": (70, 110, 200), "flagL": (150, 190, 250)},
    "enemy": {"armor": (176, 54, 48), "armorL": (220, 96, 82), "armorD": (120, 34, 34), "flag": (210, 60, 52), "flagL": (255, 150, 130)},
}
HATS = {  # 陣笠・兜の色（明・暗）
    "ashigaru": ((92, 98, 116), (60, 64, 80)),
    "spearman": ((196, 64, 52), (136, 40, 36)),
    "archer": ((150, 128, 96), (104, 86, 62)),
    "gunner": ((46, 44, 52), (26, 24, 30)),
    "medic": ((240, 240, 236), (196, 204, 210)),
    "cavalry": ((196, 64, 52), (136, 40, 36)),
}


class Sprite:
    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.px = [[None] * w for _ in range(h)]

    def set(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.w and 0 <= y < self.h and c is not None:
            self.px[y][x] = c if len(c) == 4 else (*c, 255)

    def rect(self, x0, y0, x1, y1, c):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.set(x, y, c)

    def line(self, x0, y0, x1, y1, c):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n):
            t = i / max(1, n - 1)
            self.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c)

    def ellipse(self, cx, cy, rx, ry, c):
        for y in range(int(cy - ry), int(cy + ry) + 1):
            for x in range(int(cx - rx), int(cx + rx) + 1):
                if ((x - cx) / max(rx, 0.5)) ** 2 + ((y - cy) / max(ry, 0.5)) ** 2 <= 1.0:
                    self.set(x, y, c)

    def outline(self, color=OUTLINE):
        """塗った部分の外側に1ドットの輪郭線を付ける（上下左右）"""
        add = []
        for y in range(self.h):
            for x in range(self.w):
                if self.px[y][x] is not None:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < self.w and 0 <= ny < self.h and self.px[ny][nx] is not None and self.px[ny][nx] != color:
                        add.append((x, y))
                        break
        for x, y in add:
            self.px[y][x] = color
        return self

    def image(self, scale=1):
        im = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        for y in range(self.h):
            for x in range(self.w):
                if self.px[y][x] is not None:
                    im.putpixel((x, y), self.px[y][x])
        return im.resize((self.w * scale, self.h * scale), Image.NEAREST) if scale != 1 else im


# ===== 兵士（20×24） =====
def lighten(c, k=40):
    return tuple(min(255, v + k) for v in c[:3])


def hat_jingasa(s, oy, hat, hatD):
    """陣笠：とがった円すい。左上が明るい"""
    hl = lighten(hat, 46)
    s.rect(9, 3 + oy, 10, 3 + oy, hat)
    s.rect(7, 4 + oy, 12, 4 + oy, hat)
    s.rect(5, 5 + oy, 14, 5 + oy, hat)
    s.rect(4, 6 + oy, 15, 6 + oy, hat)
    s.rect(4, 7 + oy, 15, 7 + oy, hatD)  # つばの影
    s.rect(8, 4 + oy, 9, 4 + oy, hl)
    s.rect(6, 5 + oy, 8, 5 + oy, hl)


def hat_kabuto(s, oy, hat, hatD):
    """兜：丸い鉢、しころ、金の前立て（三日月）"""
    hl = lighten(hat, 50)
    s.rect(7, 3 + oy, 13, 3 + oy, hat)
    s.rect(6, 4 + oy, 14, 7 + oy, hat)
    s.rect(7, 4 + oy, 9, 5 + oy, hl)
    s.rect(5, 7 + oy, 6, 10 + oy, hatD)  # しころ（首の後ろ）
    s.rect(6, 7 + oy, 14, 7 + oy, hatD)
    for x, y in ((8, 2), (9, 2), (10, 1), (11, 1), (12, 2), (13, 2)):
        s.set(x, y + oy, P["gold"])
    s.set(10, 2 + oy, P["goldD"])
    s.set(11, 2 + oy, P["goldD"])


def soldier(kind: str, team: str = "ally", pose: str = "idle", frame: int = 0) -> Sprite:
    T = TEAMS[team]
    s = Sprite(20, 24)
    bob = 1 if (pose == "idle" and frame == 1) else 0
    step = (pose == "walk") * (1 if frame == 0 else -1)
    atk = pose == "attack"
    oy = bob  # 上半身の上下
    # 背旗（さしもの）：味方は青系、敵は赤系。衛生兵は持たない
    if kind != "medic":
        s.line(3, 1 + oy, 3, 15 + oy, P["woodD"])
        s.rect(0, 1 + oy, 2, 8 + oy, T["flag"])
        s.rect(0, 1 + oy, 0, 8 + oy, T["flagL"])
        s.set(1, 4 + oy, T["flagL"])
    # 脚（歩きは前後に開く）
    s.rect(7 - step, 19, 8 - step, 22, P["pants"])
    s.rect(11 + step, 19, 12 + step, 22, P["pants"])
    s.rect(6 - step, 23, 8 - step, 23, P["black"])
    s.rect(11 + step, 23, 13 + step, 23, P["black"])
    # 胴（具足：横の板の筋）・袖
    if kind == "medic":
        body, bodyD, bodyL = P["white"], P["whiteD"], P["white"]
    else:
        body, bodyD, bodyL = T["armor"], T["armorD"], T["armorL"]
    s.rect(6, 14 + oy, 13, 18 + oy, body)
    s.rect(6, 16 + oy, 13, 16 + oy, bodyD)
    s.rect(7, 14 + oy, 8, 15 + oy, bodyL)
    s.rect(6, 18 + oy, 13, 18 + oy, bodyD)
    s.rect(6, 17 + oy, 13, 17 + oy, P["woodD"] if kind != "medic" else (110, 170, 210))  # 帯
    if kind != "medic":
        s.rect(5, 14 + oy, 6, 16 + oy, bodyD)  # 袖（肩の板）
    # 顔
    s.rect(7, 8 + oy, 13, 13 + oy, P["skin"])
    s.rect(7, 13 + oy, 13, 13 + oy, P["skinD"])
    s.rect(7, 8 + oy, 7, 11 + oy, P["mane"])  # 後ろ髪
    s.set(11, 10 + oy, P["eye"])
    s.set(13, 10 + oy, P["eye"])
    s.set(11, 9 + oy, P["skinD"])
    s.set(12, 12 + oy, (232, 150, 130))  # 口
    s.set(10, 11 + oy, (250, 180, 160))  # ほお
    # かぶりもの
    hat, hatD = HATS[kind]
    if kind == "medic":
        s.rect(6, 4 + oy, 13, 7 + oy, P["white"])  # 頭巾
        s.rect(7, 3 + oy, 12, 3 + oy, P["white"])
        s.rect(6, 8 + oy, 7, 13 + oy, P["white"])
        s.rect(6, 7 + oy, 13, 7 + oy, (110, 170, 210))
        s.rect(9, 5 + oy, 10, 5 + oy, (110, 190, 120))  # 薬草の印
        s.set(9, 4 + oy, (110, 190, 120))
    elif kind == "spearman":
        hat_kabuto(s, oy, hat, hatD)
    else:
        hat_jingasa(s, oy, hat, hatD)
        if kind == "gunner":
            s.set(9, 4 + oy, P["gold"])
    # 腕と武器
    ax = 2 if atk else 0
    if kind == "ashigaru":
        s.rect(13, 15 + oy, 14 + ax, 16 + oy, P["skin"])
        if atk:
            s.line(15 + ax, 15 + oy, 19, 15 + oy, P["steel"])
            s.line(15 + ax, 16 + oy, 19, 16 + oy, P["steelD"])
            s.set(15 + ax, 14 + oy, P["gold"])
        else:
            s.line(15, 15 + oy, 18, 9 + oy, P["steel"])
            s.line(16, 15 + oy, 19, 10 + oy, P["steelD"])
            s.set(15, 16 + oy, P["gold"])
    elif kind == "spearman":
        s.rect(13, 15 + oy, 14, 16 + oy, P["skin"])
        if atk:
            s.line(8, 16 + oy, 19, 16 + oy, P["wood"])
            s.rect(17, 15 + oy, 19, 17 + oy, P["steel"])
            s.set(19, 16 + oy, P["steelD"])
            s.set(16, 15 + oy, T["flag"])  # 房
        else:
            s.line(15, 23, 15, 2 + oy, P["wood"])
            s.rect(15, 0, 15, 2 + oy, P["steel"])
            s.set(16, 1, P["steelD"])
            s.set(14, 3 + oy, T["flag"])
    elif kind == "archer":
        s.rect(4, 10 + oy, 5, 17 + oy, P["woodL"])  # 矢筒
        s.rect(4, 8 + oy, 5, 9 + oy, P["white"])
        s.rect(13, 15 + oy, 14, 16 + oy, P["skin"])
        bx = 16 + (1 if atk else 0)
        s.line(bx, 8 + oy, bx + 2, 12 + oy, P["woodD"])
        s.line(bx + 2, 12 + oy, bx + 2, 18 + oy, P["woodD"])
        s.line(bx + 2, 18 + oy, bx, 22, P["woodD"])
        s.line(bx - 1, 9 + oy, bx - 1, 21, P["whiteD"])
        if atk:
            s.line(11, 15 + oy, 19, 15 + oy, P["white"])
            s.set(19, 15 + oy, P["steel"])
    elif kind == "gunner":
        s.rect(12, 15 + oy, 14, 16 + oy, P["skin"])
        s.line(8, 17 + oy, 13, 16 + oy, P["woodD"])
        s.line(13, 15 + oy, 19, 14 + oy, P["blackL"])
        s.line(13, 16 + oy, 18, 15 + oy, P["black"])
        s.set(10, 18 + oy, P["woodD"])
        if atk:
            s.set(19, 13 + oy, P["fireL"])
            s.set(19, 12 + oy, P["fire"])
            s.set(18, 12 + oy, P["fire"])
    elif kind == "medic":
        s.rect(13, 15 + oy, 14, 16 + oy, P["skin"])
        s.line(16, 8 + oy, 16, 23, P["woodL"])  # 杖
        s.ellipse(16, 6 + oy, 1.5, 1.5, P["gold"])
        s.set(16, 6 + oy, P["fireL"])
        s.rect(3, 15 + oy, 5, 18 + oy, (120, 170, 110))  # 薬箱
        s.rect(3, 15 + oy, 5, 15 + oy, (170, 210, 150))
        if atk:
            for (x, y) in ((18, 4), (19, 7), (17, 2), (14, 3)):
                s.set(x, y + oy, (150, 255, 160))
    s.outline()
    return s


def cavalry(team: str = "ally", pose: str = "idle", frame: int = 0) -> Sprite:
    """騎兵：横向きの馬（右向き）と、兜の乗り手。歩きは脚が前後に、攻撃は槍を前へ"""
    T = TEAMS[team]
    s = Sprite(32, 28)
    run = pose == "walk"
    atk = pose == "attack"
    up = 1 if (run and frame == 0) else 0
    by = 17 - up  # 胴の中心の高さ
    # 尾
    s.line(7, by - 2, 4, by + 3, P["mane"])
    s.line(6, by - 2, 3, by + 2, P["mane"])
    # 胴
    s.ellipse(14, by, 8.5, 4, P["horse"])
    s.rect(8, by - 3, 20, by - 2, P["horseL"])
    s.rect(9, by + 3, 19, by + 3, P["horseD"])
    # 首と頭（右上へ）
    for i in range(6):
        s.rect(19 + i * 0.6, by - 3 - i, 22 + i * 0.6, by - 1 - i, P["horse"])
    s.rect(21, by - 9, 26, by - 6, P["horse"])
    s.rect(25, by - 7, 28, by - 5, P["horse"])  # 鼻づら
    s.rect(27, by - 6, 28, by - 5, P["horseD"])
    s.set(23, by - 8, P["eye"])
    s.set(22, by - 10, P["horse"])  # 耳
    s.rect(19, by - 8, 20, by - 2, P["mane"])  # たてがみ
    # 脚（2ドット幅。走りは前後に開く）
    legs = [(9, 0), (12, 0), (17, 0), (20, 0)]
    if run:
        legs = [(8, -1), (12, 1), (16, -1), (21, 1)] if frame == 0 else [(10, 1), (11, -1), (18, 1), (19, -1)]
    for x, d in legs:
        s.line(x, by + 3, x + d, by + 8, P["horseD"])
        s.line(x + 1, by + 3, x + 1 + d, by + 8, P["horse"])
        s.rect(x + d, by + 9, x + 1 + d, by + 9, P["black"])
    # 鞍の布
    s.rect(11, by - 4, 17, by - 3, T["armor"])
    s.rect(11, by - 2, 17, by - 2, T["armorD"])
    # 乗り手
    ry = by - 13
    s.rect(12, ry + 5, 16, ry + 8, T["armor"])
    s.rect(12, ry + 7, 16, ry + 7, P["woodD"])
    s.rect(13, ry + 5, 13, ry + 6, T["armorL"])
    s.rect(13, ry + 1, 17, ry + 4, P["skin"])
    s.set(16, ry + 2, P["eye"])
    s.rect(13, ry + 1, 13, ry + 3, P["mane"])
    hat, hatD = HATS["cavalry"]
    s.rect(12, ry - 1, 17, ry, hat)
    s.rect(13, ry - 2, 16, ry - 2, hat)
    s.set(14, ry - 3, P["gold"])
    s.set(15, ry - 3, P["gold"])
    s.line(10, ry - 3, 10, ry + 8, P["woodD"])  # 背旗
    s.rect(7, ry - 3, 9, ry + 2, T["flag"])
    s.rect(7, ry - 3, 7, ry + 2, T["flagL"])
    if atk:
        s.line(15, ry + 6, 31, ry + 5, P["wood"])
        s.rect(29, ry + 4, 31, ry + 6, P["steel"])
    else:
        s.line(17, ry + 7, 25, ry - 3, P["wood"])
        s.rect(25, ry - 5, 26, ry - 3, P["steel"])
    s.outline()
    return s


KINDS = ["ashigaru", "spearman", "archer", "gunner", "medic", "cavalry"]
NAMES = {"ashigaru": "足軽", "spearman": "槍兵", "archer": "弓兵", "gunner": "鉄砲兵", "medic": "衛生兵", "cavalry": "騎兵"}
POSES = [("idle", 0), ("idle", 1), ("walk", 0), ("walk", 1), ("attack", 0)]
POSE_NAMES = ["待機1", "待機2", "歩き1", "歩き2", "攻撃"]


def unit(kind, team="ally", pose="idle", frame=0):
    return cavalry(team, pose, frame) if kind == "cavalry" else soldier(kind, team, pose, frame)


# ===== 塔（36×48）：石の土台・木の櫓・屋根。上の兵と武器で種類が分かる =====
def tower(kind: str, team: str = "ally") -> Sprite:
    """team：味方の塔は藍の旗、攻城戦の敵の塔は赤の旗"""
    s = Sprite(36, 48)
    # 石の土台
    s.rect(4, 41, 31, 46, P["stone"])
    s.rect(4, 41, 31, 41, P["stoneL"])
    s.rect(4, 46, 31, 46, P["stoneD"])
    for x in range(6, 31, 6):
        s.set(x, 43, P["stoneD"])
        s.set(x + 3, 45, P["stoneD"])
    # 櫓の柱と筋かい
    for x in (7, 27):
        s.rect(x, 18, x + 1, 40, P["wood"])
        s.rect(x + 1, 18, x + 1, 40, P["woodD"])
    s.line(9, 22, 26, 38, P["woodD"])
    s.line(26, 22, 9, 38, P["woodD"])
    s.rect(7, 30, 28, 31, P["wood"])
    # 足場と手すり
    s.rect(4, 16, 31, 18, P["woodL"])
    s.rect(4, 18, 31, 18, P["woodD"])
    for x in range(5, 31, 4):
        s.rect(x, 12, x, 16, P["wood"])
    s.rect(4, 12, 31, 12, P["wood"])
    # 旗（左右）
    s.line(3, 4, 3, 16, P["woodD"])
    s.rect(0, 4, 2, 9, TEAMS[team]["flag"])
    s.rect(0, 4, 0, 9, TEAMS[team]["flagL"])
    hat_y = 6
    if kind in ("arrow", "gun"):
        # 小さな屋根
        s.rect(6, 2, 29, 3, P["roof"])
        s.rect(4, 4, 31, 5, P["roof"])
        s.rect(4, 5, 31, 5, P["roofD"])
        s.rect(8, 2, 14, 2, P["roofL"])
        s.rect(7, 6, 7, 11, P["woodD"])
        s.rect(28, 6, 28, 11, P["woodD"])
        hat_y = 7
    if kind == "arrow":
        # 弓兵の頭と弓
        s.rect(14, hat_y + 2, 19, hat_y + 5, P["skin"])
        s.set(18, hat_y + 3, P["eye"])
        s.rect(12, hat_y + 1, 21, hat_y + 1, HATS["archer"][0])
        s.rect(14, hat_y, 19, hat_y, HATS["archer"][0])
        s.line(23, hat_y - 1, 25, hat_y + 3, P["woodD"])
        s.line(25, hat_y + 3, 23, hat_y + 8, P["woodD"])
        s.line(22, hat_y, 22, hat_y + 7, P["whiteD"])
    elif kind == "gun":
        s.rect(13, hat_y + 2, 18, hat_y + 5, P["skin"])
        s.set(17, hat_y + 3, P["eye"])
        s.rect(11, hat_y + 1, 20, hat_y + 1, HATS["gunner"][0])
        s.rect(13, hat_y, 18, hat_y, HATS["gunner"][0])
        s.line(14, hat_y + 6, 33, hat_y + 5, P["blackL"])
        s.line(14, hat_y + 7, 24, hat_y + 6, P["woodD"])
        s.set(34, hat_y + 4, P["fire"])
    elif kind == "cannon":
        # 屋根なし・大砲
        s.ellipse(15, 8, 6, 4.5, P["black"])
        s.rect(15, 5, 31, 10, P["black"])
        s.rect(15, 5, 31, 6, P["blackL"])
        s.rect(30, 4, 32, 11, P["blackL"])
        s.rect(13, 3, 15, 4, P["goldD"])
        s.ellipse(11, 12, 3, 3, P["woodD"])  # 車輪
        s.ellipse(11, 12, 1, 1, P["gold"])
    elif kind == "ice":
        # 水攻め：大きな樽と流れ落ちる水
        s.rect(8, 0, 25, 11, P["wood"])
        s.rect(8, 0, 25, 1, P["water"])
        s.rect(9, 0, 13, 0, P["waterL"])
        s.rect(8, 3, 25, 3, P["blackL"])
        s.rect(8, 8, 25, 8, P["blackL"])
        s.rect(10, 2, 11, 10, P["woodL"])
        s.rect(26, 6, 29, 8, P["woodD"])  # 樋
        s.rect(29, 7, 32, 30, P["water"])
        s.rect(30, 7, 30, 30, P["waterL"])
        s.ellipse(31, 31, 4, 2, P["waterL"])
    s.outline()
    return s


# ===== 城（通常 72×64・強化 80×76） =====
def castle(level: int) -> Sprite:
    big = level >= 2
    W, H = (80, 76) if big else (72, 64)
    s = Sprite(W, H)
    cx = W // 2
    base_top = H - 18
    # 石垣（下ほど広い）
    for i, y in enumerate(range(base_top, H - 1)):
        half = 26 + (y - base_top) * 0.6 + (4 if big else 0)
        s.rect(cx - half, y, cx + half, y, P["stone"])
    for y in range(base_top + 3, H - 1, 4):
        for x in range(cx - 30, cx + 31, 7):
            s.set(x + (y // 4 % 2) * 3, y, P["stoneD"])
    s.rect(cx - 26, base_top, cx + 26, base_top, P["stoneL"])
    s.rect(cx - 4, H - 9, cx + 4, H - 2, P["woodD"])  # 門
    s.rect(cx - 4, H - 9, cx + 4, H - 9, P["black"])
    s.rect(cx, H - 8, cx, H - 2, P["black"])

    def tier(y, half, h, roof_half):
        # 白壁と窓、その上に反った屋根
        s.rect(cx - half, y, cx + half, y + h, P["wall"])
        s.rect(cx - half, y + h, cx + half, y + h, P["wallD"])
        for x in range(cx - half + 3, cx + half - 2, 6):
            s.rect(x, y + 2, x + 1, y + 3, P["black"])
        ry = y - 4
        s.rect(cx - roof_half, ry + 2, cx + roof_half, ry + 3, P["roof"])
        s.rect(cx - roof_half + 3, ry, cx + roof_half - 3, ry + 1, P["roof"])
        s.rect(cx - roof_half + 3, ry, cx - 2, ry, P["roofL"])
        s.set(cx - roof_half - 1, ry + 1, P["roof"])  # 軒の反り
        s.set(cx + roof_half + 1, ry + 1, P["roof"])
        s.rect(cx - roof_half, ry + 3, cx + roof_half, ry + 3, P["roofD"])

    if big:
        tier(base_top - 9, 24, 8, 29)
        tier(base_top - 21, 17, 8, 22)
        tier(base_top - 33, 11, 8, 15)
        top = base_top - 41
    else:
        tier(base_top - 9, 20, 8, 25)
        tier(base_top - 21, 12, 8, 17)
        top = base_top - 29
    # てっぺんの屋根としゃちほこ
    s.rect(cx - 7, top + 2, cx + 7, top + 3, P["roof"])
    s.rect(cx - 4, top, cx + 4, top + 1, P["roof"])
    s.set(cx - 5, top - 1, P["gold"])
    s.set(cx + 5, top - 1, P["gold"])
    s.set(cx - 5, top - 2, P["goldD"])
    s.set(cx + 5, top - 2, P["goldD"])
    if big:
        for x in (cx - 33, cx + 33):  # 強化：のぼり旗
            s.line(x, base_top - 22, x, base_top + 4, P["woodD"])
            s.rect(x + 1, base_top - 22, x + 4, base_top - 10, TEAMS["ally"]["flag"])
            s.rect(x + 1, base_top - 22, x + 1, base_top - 10, TEAMS["ally"]["flagL"])
        s.rect(cx - 2, top - 3, cx + 2, top - 1, P["gold"])
    s.outline()
    return s


# ===== 背景（16×16の地面・道・川、木・松・岩・花） =====
import random


def tile(kind: str, seed: int = 0) -> Sprite:
    rnd = random.Random(seed)
    s = Sprite(16, 16)
    if kind == "grass":
        s.rect(0, 0, 15, 15, (126, 186, 92))
        for _ in range(9):
            x, y = rnd.randrange(16), rnd.randrange(16)
            s.set(x, y, (104, 164, 80))
            s.set(x, y - 1, (150, 206, 108))
        if seed % 3 == 0:
            x, y = rnd.randrange(2, 14), rnd.randrange(2, 14)
            s.set(x, y, (250, 236, 170) if seed % 2 else (240, 160, 190))
    elif kind == "road":
        s.rect(0, 0, 15, 15, (232, 204, 150))
        for _ in range(6):
            x, y = rnd.randrange(16), rnd.randrange(16)
            s.set(x, y, (206, 174, 120))
        s.set(rnd.randrange(16), rnd.randrange(16), (250, 230, 190))
    elif kind == "water":
        s.rect(0, 0, 15, 15, P["water"])
        for _ in range(3):
            x, y = rnd.randrange(12), rnd.randrange(16)
            s.rect(x, y, x + 3, y, P["waterL"])
        s.set(rnd.randrange(16), rnd.randrange(16), P["waterD"])
    return s


def tree(kind: str = "round") -> Sprite:
    s = Sprite(24, 30)
    s.rect(10, 20, 13, 28, P["wood"])
    s.rect(12, 20, 13, 28, P["woodD"])
    if kind == "pine":
        for i, (y, half) in enumerate(((2, 3), (7, 6), (12, 9), (17, 11))):
            s.ellipse(12, y + 2, half, 3, P["greenD"])
            s.ellipse(11, y + 1, half - 2, 2, (80, 150, 80))
        s.rect(10, 22, 13, 28, P["wood"])
    else:
        s.ellipse(12, 12, 10, 9, P["greenD"])
        s.ellipse(11, 10, 8, 7, P["green"])
        s.ellipse(9, 7, 4, 3, (150, 210, 110))
        for x, y in ((15, 13), (6, 14), (13, 6)):
            s.set(x, y, (60, 120, 62))
    s.outline()
    return s


def rock() -> Sprite:
    s = Sprite(16, 11)
    s.ellipse(8, 6, 7, 4.5, P["stone"])
    s.ellipse(6, 4, 3, 2, P["stoneL"])
    s.rect(4, 9, 12, 9, P["stoneD"])
    s.outline()
    return s


def bridge() -> Sprite:
    s = Sprite(32, 16)
    s.rect(0, 5, 31, 10, P["wood"])
    for x in range(0, 32, 4):
        s.rect(x, 5, x, 10, P["woodD"])
    s.rect(0, 3, 31, 3, P["woodL"])
    s.rect(0, 12, 31, 12, P["woodL"])
    for x in (2, 15, 29):
        s.rect(x, 2, x + 1, 13, P["woodD"])
    s.outline()
    return s


if __name__ == "__main__":
    os.makedirs(OUT_ASSET, exist_ok=True)
    os.makedirs(OUT_DOC, exist_ok=True)
    for k in KINDS:
        for team in TEAMS:
            for (pose, fr) in POSES:
                unit(k, team, pose, fr).image().save(os.path.join(OUT_ASSET, f"{k}_{team}_{pose}{fr}.png"))
    for t in ("arrow", "cannon", "gun", "ice"):
        for team in TEAMS:
            tower(t, team).image().save(os.path.join(OUT_ASSET, f"tower_{t}_{team}.png"))
    for lv in (1, 2):
        castle(lv).image().save(os.path.join(OUT_ASSET, f"castle_{lv}.png"))
    for k in ("grass", "road", "water"):
        tile(k, 3).image().save(os.path.join(OUT_ASSET, f"tile_{k}.png"))
    tree("round").image().save(os.path.join(OUT_ASSET, "tree.png"))
    tree("pine").image().save(os.path.join(OUT_ASSET, "pine.png"))
    rock().image().save(os.path.join(OUT_ASSET, "rock.png"))
    bridge().image().save(os.path.join(OUT_ASSET, "bridge.png"))
    print("ok")
