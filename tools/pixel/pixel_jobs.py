"""新ドット絵の上級職・大将・戦死のコマ・渡河の川（v105.2）。

上級職は基本職の体に、かぶりもの・兜の飾り・武器・馬の色の違いを重ねて描く（味方の藍はそのまま）。
大将は赤い具足に金の鍬形の兜と母衣（ほろ）。戦死のコマは待機の絵を倒したもの。
"""
from __future__ import annotations

import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools", "proto"))
from make_proto_set_v2 import (  # noqa: E402
    Sprite2, ramp, SKIN, AI, RED, GOLD, WOOD, WHITE, IRON, HATS, FLAG, EYE, WATER_BG, SAND, GRASS, mix,
)
from make_weapons_v2 import BLADE, LACQ, TASSEL, BRASS, SPARK, arm, katana, yari, yumi, teppo, shakujo, soldier_w  # noqa: E402

STEELK = ramp((70, 82, 104))  # 黒鉄の兜
CRIMSON = ramp((196, 40, 44))  # 赤備えの朱
PURPLE = ramp((128, 76, 168))  # 医王の紫の頭巾
HAIR = [(30, 24, 28), (52, 40, 44), (84, 66, 70)]
SILVER = [(150, 154, 168), (196, 200, 214), (232, 236, 246)]
BLACKH = [(22, 22, 30), (40, 40, 52), (66, 66, 82), (96, 96, 116), (130, 130, 150)]
GREYH = [(70, 74, 82), (104, 108, 118), (142, 146, 156), (180, 184, 194), (214, 218, 226)]
WHITEH = [(150, 146, 140), (196, 192, 184), (226, 222, 214), (244, 242, 236), (255, 255, 252)]


# ===== かぶりもの（体の座標・oy は待機の上下） =====
def kabuto_c(R, cheek=GOLD[2]):
    def f(s, oy):
        for i, y in enumerate((8, 9, 10, 11)):
            s.rect(5 + (1 if i == 3 else 0), y + oy, 8, y + oy, R[1] if i % 2 else R[2])
        s.rect(7, 3 + oy, 16, 7 + oy, R[2])
        s.rect(8, 2 + oy, 15, 2 + oy, R[2])
        s.rect(8, 3 + oy, 11, 4 + oy, R[3])
        s.rect(9, 2 + oy, 10, 2 + oy, R[4])
        s.rect(14, 4 + oy, 16, 7 + oy, R[1])
        s.rect(7, 7 + oy, 16, 7 + oy, R[0])
        s.rect(16, 6 + oy, 17, 8 + oy, R[2])
        s.set(17, 6 + oy, cheek)
    return f


def hachimaki(hair=HAIR, band=WHITE, tail=True, long=False):
    """髷（まげ）と鉢巻き。long：長い髪（剣聖）"""
    def f(s, oy):
        s.rect(8, 4 + oy, 16, 7 + oy, hair[1])
        s.rect(9, 3 + oy, 15, 3 + oy, hair[1])
        s.rect(9, 4 + oy, 12, 4 + oy, hair[2])
        s.rect(8, 6 + oy, 16, 6 + oy, band[2])
        s.rect(8, 6 + oy, 11, 6 + oy, band[3])
        s.rect(11, 1 + oy, 13, 2 + oy, hair[1])  # 髷
        s.set(11, 1 + oy, hair[2])
        s.rect(7, 7 + oy, 8, 11 + oy, hair[0])
        if tail:  # 鉢巻きの端がなびく
            s.line(7, 6 + oy, 4, 8 + oy, band[1])
            s.line(7, 7 + oy, 5, 9 + oy, band[2])
        if long:
            s.rect(5, 7 + oy, 7, 14 + oy, hair[1])
            s.rect(5, 7 + oy, 5, 14 + oy, hair[2])
    return f


def cowl(R):
    """僧兵・医王の頭巾（顔の下まで覆い、目だけ出す）"""
    def f(s, oy):
        s.rect(7, 2 + oy, 16, 13 + oy, R[2])
        s.rect(8, 1 + oy, 15, 1 + oy, R[2])
        s.rect(8, 2 + oy, 11, 4 + oy, R[3])
        s.rect(15, 3 + oy, 16, 13 + oy, R[1])
        s.rect(11, 9 + oy, 15, 10 + oy, SKIN[2])  # 目の出る所
        s.set(13, 10 + oy, EYE)
        s.set(13, 9 + oy, (120, 70, 50))
        s.rect(7, 12 + oy, 16, 13 + oy, R[1])
    return f


def purple_hood(s, oy):
    s.rect(8, 3 + oy, 16, 7 + oy, PURPLE[2])
    s.rect(9, 2 + oy, 15, 2 + oy, PURPLE[2])
    s.rect(9, 3 + oy, 11, 4 + oy, PURPLE[3])
    s.rect(14, 4 + oy, 16, 7 + oy, PURPLE[1])
    s.rect(7, 7 + oy, 8, 13 + oy, PURPLE[1])
    s.rect(8, 7 + oy, 16, 7 + oy, GOLD[2])  # 金の額当て
    s.rect(11, 4 + oy, 12, 5 + oy, GOLD[3])


def eboshi_hat(s, oy):
    """弓聖：髪と白い鉢巻き（烏帽子は top で上へ）"""
    hachimaki(tail=False)(s, oy)


# ===== 兜の大きな飾り（枠の上へはみ出せる。Pen の座標） =====
def crest_crescent(big=True):
    def f(p, oy):
        pts = [(7, -2), (8, -3), (9, -4), (10, -4)] + [(13, -4), (14, -4), (15, -3), (16, -2)] if big else []
        for x, y in pts:
            p.set(x, y + oy, GOLD[2])
            p.set(x, y + 1 + oy, GOLD[1])
        for x in range(9, 15):
            p.set(x, -1 + oy, GOLD[2])
            p.set(x, 0 + oy, GOLD[1])
        p.set(11, -2 + oy, GOLD[3])
        p.set(12, -2 + oy, GOLD[3])
    return f


def crest_horns(p, oy):
    """鍬形（くわがた）：2本の金の角"""
    for i in range(6):
        p.set(8 - i * 0.4, 1 - i + oy, GOLD[2])
        p.set(9 - i * 0.4, 1 - i + oy, GOLD[1])
        p.set(15 + i * 0.4, 1 - i + oy, GOLD[2])
        p.set(14 + i * 0.4, 1 - i + oy, GOLD[1])
    p.set(6, -5 + oy, GOLD[3])
    p.set(17, -5 + oy, GOLD[3])
    p.rect(10, 0 + oy, 13, 1 + oy, GOLD[2])
    p.rect(11, -1 + oy, 12, -1 + oy, (220, 50, 50))  # 前立ての赤い玉


def crest_sun(p, oy):
    """日輪の前立て（銃将）"""
    for dx, dy in ((0, -1), (1, -1), (-1, 0), (0, 0), (1, 0), (2, 0), (0, 1), (1, 1), (-1, -1), (2, -1), (0, -2), (1, -2)):
        p.set(11 + dx, dy + oy, GOLD[2] if dy > -1 else GOLD[3])
    p.rect(11, 0 + oy, 12, 0 + oy, (230, 70, 50))


def eboshi_top(p, oy):
    """烏帽子（えぼし）：黒く高い帽子"""
    for i in range(7):
        p.rect(10 + i * 0.3, 3 - i + oy, 14 + i * 0.3, 3 - i + oy, (30, 28, 36) if i % 2 else (52, 50, 62))
    p.set(11, 0 + oy, (90, 88, 104))
    p.rect(9, 4 + oy, 15, 4 + oy, (30, 28, 36))


def topknot_glow(p, oy):
    """剣聖：頭のまわりの金の光"""
    for x, y in ((5, 2), (18, 1), (4, 6), (19, 5), (7, -1), (16, -1)):
        p.glow(x, y + oy, (255, 236, 150))


def horo(s, oy):
    """大将の母衣（ほろ）：背中にふくらむ赤い布"""
    R = CRIMSON
    s.blob(3.5, 9 + oy, 3.6, 6.5, R)
    s.rect(1, 4 + oy, 5, 4 + oy, GOLD[2])
    s.line(5, 3 + oy, 5, 17 + oy, WOOD[1])


# ===== 騎兵の乗り手のかぶりもの（ry は乗り手の基準） =====
def rider_kabuto(R, horns=False):
    def f(s, ry):
        s.rect(13, ry - 1, 18, ry, R[2])
        s.rect(14, ry - 2, 17, ry - 2, R[3])
        s.rect(13, ry, 18, ry, R[1])
        s.rect(12, ry, 12, ry + 3, R[1])
        if not horns:
            s.set(15, ry - 3, GOLD[2])
            s.set(16, ry - 3, GOLD[3])
    return f


def rider_hood(gold=False, scarf=False):
    def f(s, ry):
        B = BLACKH
        s.rect(12, ry - 2, 18, ry + 4, B[1])
        s.rect(13, ry - 2, 15, ry - 1, B[2])
        s.rect(15, ry + 2, 18, ry + 2, SKIN[2])  # 目の出る所
        s.set(17, ry + 2, EYE)
        if gold:
            s.rect(14, ry - 1, 17, ry - 1, GOLD[2])
        if scarf:
            s.line(12, ry + 3, 9, ry + 5, (200, 40, 40))
            s.line(12, ry + 4, 9, ry + 6, (150, 30, 30))
    return f


def rider_jingasa(H, mon=None):
    def f(s, ry):
        s.rect(11, ry - 1, 20, ry - 1, H[1])
        s.rect(11, ry - 1, 14, ry - 1, H[2])
        s.rect(13, ry - 2, 18, ry - 2, H[2])
        s.rect(15, ry - 3, 16, ry - 3, H[3])
        s.rect(12, ry, 19, ry, H[0])
        if mon:
            s.set(15, ry - 2, mon)
    return f


def rider_horns(p, ry):
    for i in range(5):
        p.set(13 - i * 0.4, ry - 2 - i, GOLD[2])
        p.set(18 + i * 0.4, ry - 2 - i, GOLD[2])
    p.rect(15, ry - 3, 16, ry - 3, GOLD[3])


# ===== 騎兵の武器（ry：乗り手の基準） =====
def cav_arm(p, team, x1, ry):
    A = AI[team]
    p.rect(16, ry + 6, x1 - 1, ry + 7, A[1])
    p.rect(x1, ry + 6, x1 + 1, ry + 7, SKIN[2])


def cav_yari(p, team, atk, ry):
    """槍騎兵・赤備え：まっすぐな長槍と大きな穂先"""
    if atk:
        cav_arm(p, team, 20, ry)
        p.line(6, ry + 6, 34, ry + 6, WOOD[2])
        p.line(6, ry + 7, 34, ry + 7, WOOD[1])
        p.rect(32, ry + 8, 33, ry + 9, TASSEL[1])
        for i, (t, b) in enumerate(((-1, 2), (-2, 3), (-2, 3), (-1, 2), (-1, 2), (0, 1), (0, 1), (0, 0))):
            p.rect(35 + i, ry + 6 + t, 35 + i, ry + 6 + b, BLADE[2])
            p.set(35 + i, ry + 6 + t, BLADE[3])
        for x, y in ((2, ry + 4), (4, ry + 4), (3, ry + 10)):
            p.glow(x, y)
    else:
        cav_arm(p, team, 19, ry)
        p.line(20, ry + 12, 20, ry - 9, WOOD[2])
        p.line(21, ry + 12, 21, ry - 9, WOOD[1])
        p.rect(19, ry - 8, 22, ry - 7, TASSEL[1])
        for i, (l, r) in enumerate(((-1, 2), (-2, 3), (-2, 3), (-1, 2), (-1, 2), (0, 1), (0, 1), (0, 0))):
            y = ry - 10 - i
            p.rect(20 + l, y, 20 + r, y, BLADE[2])
            p.set(20 + l, y, BLADE[3])


def cav_bow(p, team, atk, ry):
    """弓騎兵：前に構えた大きな弓"""
    bx = 24
    cav_arm(p, team, bx - 2, ry)
    pts = [(bx - 2, ry - 9), (bx, ry - 6), (bx + 1, ry - 2), (bx + 1, ry + 3), (bx + 1, ry + 8), (bx, ry + 12), (bx - 2, ry + 15)]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        p.line(x0, y0, x1, y1, LACQ[1])
        p.line(x0 + 1, y0, x1 + 1, y1, LACQ[0])
    p.rect(bx + 1, ry + 5, bx + 2, ry + 7, GOLD[2])
    sx = 16 if atk else bx - 2
    p.line(bx - 2, ry - 9, sx, ry + 6, WHITE[3])
    p.line(sx, ry + 6, bx - 2, ry + 15, WHITE[3])
    if atk:
        p.line(15, ry + 6, 32, ry + 6, WOOD[3])
        p.rect(33, ry + 5, 34, ry + 7, BLADE[2])
        p.set(35, ry + 6, BLADE[3])


def cav_gun(p, team, atk, ry):
    """騎馬鉄砲：前へ向けた火縄銃"""
    cav_arm(p, team, 21, ry)
    p.rect(14, ry + 7, 22, ry + 8, WOOD[2])
    p.rect(20, ry + 5, 35, ry + 7, IRON[1])
    p.rect(20, ry + 5, 35, ry + 5, IRON[3])
    p.rect(20, ry + 7, 35, ry + 7, IRON[0])
    for x in (24, 30):
        p.rect(x, ry + 5, x, ry + 7, BRASS[1])
    if atk:
        for x, y, c in ((36, ry + 6, (255, 236, 150)), (37, ry + 6, (255, 236, 150)), (36, ry + 5, (255, 168, 64)), (36, ry + 7, (255, 168, 64)), (37, ry + 4, (255, 168, 64)), (37, ry + 8, (255, 168, 64))):
            p.glow(x, y, c)
        for x, y in ((33, ry + 2), (34, ry + 1), (35, ry + 2)):
            p.glow(x, y, (210, 210, 206))


def cav_ninjato(p, team, atk, ry):
    """忍者・忍頭：まっすぐな忍者刀と手裏剣"""
    if atk:
        cav_arm(p, team, 21, ry)
        p.line(23, ry + 6, 33, ry + 2, BLADE[3])
        p.line(23, ry + 7, 33, ry + 3, BLADE[1])
        p.rect(21, ry + 5, 22, ry + 8, (30, 28, 36))
        for x, y in ((36, ry - 2), (37, ry - 1), (35, ry - 1), (36, ry), (36, ry - 1)):
            p.set(x, y, GREYH[3] if (x, y) != (36, ry - 1) else GREYH[0])  # 手裏剣
        for x, y in ((30, ry - 1), (32, ry - 2), (34, ry - 3)):
            p.glow(x, y)
    else:
        cav_arm(p, team, 19, ry)
        p.line(20, ry + 5, 25, ry - 6, BLADE[3])
        p.line(21, ry + 5, 26, ry - 6, BLADE[1])
        p.rect(19, ry + 5, 21, ry + 7, (30, 28, 36))


def ninja_horse_style(gold):
    return {"horse": BLACKH, "mane": (20, 20, 26), "cloth": BLACKH, "hat": rider_hood(gold=gold, scarf=gold), "weapon": cav_ninjato}


# ===== 上級職（味方だけ。基本職の体に重ねる） =====
JOBS = {
    "samurai": ("ashigaru", {"hat": kabuto_c(STEELK), "top": crest_crescent(False)}),
    "kensei": ("ashigaru", {"hat": hachimaki()}),
    "sword_saint": ("ashigaru", {"hat": hachimaki(hair=[SILVER[0], SILVER[1], SILVER[2]], band=CRIMSON[1:5], long=True), "top": topknot_glow}),
    "sohei": ("spearman", {"hat": cowl(WHITEH)}),
    "spear_commander": ("spearman", {"top": crest_crescent(True)}),
    "bow_saint": ("archer", {"hat": eboshi_hat, "top": eboshi_top}),
    "gun_commander": ("gunner", {"hat": kabuto_c(BLACKH), "top": crest_sun}),
    "healing_master": ("medic", {"hat": purple_hood}),
    "ninja": ("cavalry", ninja_horse_style(False)),
    "shinobi_head": ("cavalry", ninja_horse_style(True)),
    "kibateppo": ("cavalry", {"hat": rider_jingasa(IRON, GOLD[2]), "weapon": cav_gun}),
    "yarikiba": ("cavalry", {"weapon": cav_yari}),
    "yumikiba": ("cavalry", {"hat": rider_jingasa(HATS["archer"]), "weapon": cav_bow}),
    "akazonae": ("cavalry", {"hat": rider_kabuto(CRIMSON, horns=True), "top": rider_horns, "cloth": CRIMSON, "weapon": cav_yari}),
    "iron_cavalry": ("cavalry", {"hat": rider_kabuto(GREYH, horns=True), "top": rider_horns, "horse": GREYH, "mane": (60, 62, 70), "cloth": GREYH}),
}
JOB_NAMES = {
    "samurai": "侍", "kensei": "剣豪", "sword_saint": "剣聖", "sohei": "僧兵", "spear_commander": "槍将", "bow_saint": "弓聖",
    "gun_commander": "銃将", "healing_master": "医王", "ninja": "忍者", "shinobi_head": "忍頭", "kibateppo": "騎馬鉄砲",
    "yarikiba": "槍騎兵", "yumikiba": "弓騎兵", "akazonae": "赤備え", "iron_cavalry": "鉄騎将",
}


GENERAL = ("ashigaru", {"hat": kabuto_c(BLACKH, GOLD[3]), "top": crest_horns, "back": horo})


def job_sprite(job, team, pose, frame):
    base, style = JOBS[job]
    return soldier_w(base, team, pose, frame, style=style)


def general_sprite(pose, frame):
    return soldier_w(GENERAL[0], "enemy", pose, frame, style=GENERAL[1])


def fallen(sp):
    """戦死：待機の絵を後ろへ倒す（素材は右向きなので、頭が左）"""
    out = Sprite2(sp.h, sp.w)
    for y in range(sp.h):
        for x in range(sp.w):
            c = sp.px[y][x]
            if c is not None:
                out.px[sp.w - 1 - x][y] = mix(c, (60, 60, 70), 0.25)
    return out


def ford():
    """渡河の川（道を横切る浅瀬。縦長で、道の向きに合わせて回して置く）"""
    rnd = random.Random(4)
    s = Sprite2(24, 64)
    for y in range(64):
        w = 8 + (2 if 10 < y < 54 else 0) + rnd.choice((0, 0, 1))
        cx = 12 + (1 if (y // 9) % 2 else 0)
        for x in range(cx - w - 2, cx + w + 3):
            d = abs(x - cx)
            if d <= w:
                k = 1 if d > w - 2 else 2
                if (x * 5 + y * 3) % 13 == 0 or (abs(x - cx + 3) < 1 and y % 6 < 2):
                    k = 4 if d < w - 3 else 3
                s.set(x, y, WATER_BG[k])
            elif d <= w + 2:
                s.set(x, y, SAND[1] if d <= w + 1 else mix(SAND[0], GRASS[1], 0.5))
    # 端（道の外）は草に溶けるよう少し欠く
    for y in (0, 1, 62, 63):
        for x in range(24):
            if rnd.random() < 0.5:
                s.px[y][x] = None
    return s
