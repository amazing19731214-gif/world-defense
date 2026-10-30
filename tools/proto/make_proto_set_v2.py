#!/usr/bin/env python3
"""第2試作の画風で全素材をそろえる（v105試作3）。ゲームには組み込まない。

  python3 tools/proto/make_proto_set_v2.py

- 兵士6種（22×26、騎兵は34×30）× 味方/敵 × 5コマ（待機1・待機2・歩き1・歩き2・攻撃）
- 塔4種（42×56）× 味方/敵、城（通常・強化）
- 背景：草原（兵士より目立たないよう彩度とコントラストを抑えた色）・道・川・橋・木5種・岩・柵・灯籠

兵士は細部を増やしすぎず、スマホで兜・武器・兵種が分かることを優先する：
武器は明るい鋼色や黒など背景と反対の色にし、かぶりものの形（兜・陣笠・頭巾）で兵種を分ける。
"""
from __future__ import annotations

import math
import os
import random
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_proto_art import OUT_ASSET  # noqa: E402
from make_proto_art_v2 import (  # noqa: E402
    Sprite2, mix, ramp, value_noise, SKIN, AI, RED, GOLD, STEEL, WOOD, CLOTH, LACE, FLAG,
)

OUT3 = os.path.join(OUT_ASSET, "v2set")

EYE = (34, 24, 26)
WHITE = [(176, 172, 164), (214, 210, 200), (240, 238, 230), (255, 254, 248)]
IRON = [(30, 30, 36), (50, 50, 58), (78, 78, 90), (120, 120, 134)]
FIRE = [(220, 90, 40), (255, 168, 64), (255, 236, 150)]
HERB = [(70, 130, 80), (110, 170, 110), (160, 210, 150)]
HATS = {  # 陣笠の色（暗・中・明・ハイライト）
    "ashigaru": [(52, 56, 70), (82, 88, 106), (118, 124, 144), (160, 166, 184)],  # 鉄色
    "archer": [(96, 74, 46), (142, 112, 72), (186, 156, 108), (220, 196, 150)],  # 茶
    "gunner": IRON,  # 黒
}
KINDS = ["ashigaru", "spearman", "archer", "gunner", "medic", "cavalry"]
NAMES = {"ashigaru": "足軽", "spearman": "槍兵", "archer": "弓兵", "gunner": "鉄砲兵", "medic": "衛生兵", "cavalry": "騎兵"}
POSES = [("idle", 0), ("idle", 1), ("walk", 0), ("walk", 1), ("attack", 0)]
POSE_NAMES = ["待機1", "待機2", "歩き1", "歩き2", "攻撃"]


# ===== 兵士（22×26） =====
def kabuto(s, oy):
    """赤い兜：しころ・鉢・吹返し・金の三日月"""
    for i, y in enumerate((8, 9, 10, 11)):
        s.rect(5 + (1 if i == 3 else 0), y + oy, 8, y + oy, RED[1] if i % 2 else RED[2])
    s.rect(7, 3 + oy, 16, 7 + oy, RED[2])
    s.rect(8, 2 + oy, 15, 2 + oy, RED[2])
    s.rect(8, 3 + oy, 11, 4 + oy, RED[3])
    s.rect(9, 2 + oy, 10, 2 + oy, RED[4])
    s.rect(14, 4 + oy, 16, 7 + oy, RED[1])
    s.rect(7, 7 + oy, 16, 7 + oy, RED[0])
    s.rect(16, 6 + oy, 17, 8 + oy, RED[2])
    s.set(17, 6 + oy, GOLD[2])
    for x, y, k in ((9, 1, 1), (10, 0, 2), (11, 0, 3), (12, 0, 3), (13, 0, 2), (14, 1, 1), (11, 1, 2), (12, 1, 1)):
        s.set(x, y + oy, GOLD[k])


def jingasa(s, oy, H, mon=None):
    """陣笠：平たい円すい。左上が明るく、つばの下は影"""
    s.rect(11, 3 + oy, 13, 3 + oy, H[2])
    s.rect(9, 4 + oy, 15, 4 + oy, H[1])
    s.rect(7, 5 + oy, 17, 5 + oy, H[1])
    s.rect(5, 6 + oy, 19, 6 + oy, H[1])
    s.rect(9, 4 + oy, 11, 4 + oy, H[2])
    s.rect(7, 5 + oy, 10, 5 + oy, H[2])
    s.rect(5, 6 + oy, 8, 6 + oy, H[2])
    s.set(11, 3 + oy, H[3])
    s.set(9, 4 + oy, H[3])
    s.rect(16, 5 + oy, 17, 5 + oy, H[0])
    s.rect(17, 6 + oy, 19, 6 + oy, H[0])
    s.rect(6, 7 + oy, 18, 7 + oy, H[0])  # つばの裏の影
    if mon:
        s.set(12, 5 + oy, mon)
        s.set(13, 5 + oy, mon)


def soldier_v2(kind, team="ally", pose="idle", frame=0, bare=False, style=None):
    """bare=True：武器と腕を描かず、輪郭線も付けない（武器を描き直すための体だけ）
    style：上級職・大将の描き分け {"hat": f(s, oy)（かぶりもの）, "back": f(s, oy)（背旗の代わり）}"""
    st = style or {}
    if kind == "cavalry":
        return cavalry_v2(team, pose, frame, bare, style)
    s = Sprite2(22, 26)
    A, F = AI[team], FLAG[team]
    oy = 1 if (pose == "idle" and frame == 1) else 0
    step = (1 if frame == 0 else -1) if pose == "walk" else 0
    atk = pose == "attack"
    medic = kind == "medic"
    # 背旗（衛生兵は持たない）。大将などは母衣（ほろ）など
    if st.get("back"):
        st["back"](s, oy)
    elif not medic:
        s.line(3, 1 + oy, 3, 17 + oy, WOOD[1])
        s.line(4, 1 + oy, 4, 17 + oy, WOOD[2])
        s.rect(0, 2 + oy, 2, 10 + oy, F[2])
        s.rect(0, 2 + oy, 0, 10 + oy, F[3])
        s.rect(2, 2 + oy, 2, 10 + oy, F[1])
        s.set(1, 5 + oy, (245, 240, 225))
        s.set(1, 6 + oy, (245, 240, 225))
    # 脚：袴・すね当て・わらじ（歩きは前後に開く）
    for lx, d in ((8, -step), (13, step)):
        x = lx + d
        s.rect(x, 21, x + 2, 22, CLOTH[1])
        s.rect(x, 21, x, 22, CLOTH[2])
        s.rect(x, 23, x + 2, 24, WHITE[1] if medic else A[1])
        s.set(x, 23, WHITE[3] if medic else A[3])
        s.rect(x - 1, 25, x + 2, 25, WOOD[3])
    # 胴と袖。衛生兵は白い羽織に水色の帯
    B = [WHITE[0], WHITE[1], WHITE[2], WHITE[3], WHITE[3]] if medic else A
    if not medic:
        for x in range(7, 17, 3):  # 草摺
            s.rect(x, 19 + oy, x + 2, 20 + oy, A[2])
            s.rect(x, 19 + oy, x, 20 + oy, A[3])
            s.set(x + 2, 20 + oy, A[1])
    else:
        s.rect(7, 19 + oy, 16, 20 + oy, WHITE[2])
        s.rect(7, 19 + oy, 7, 20 + oy, WHITE[3])
        s.rect(16, 19 + oy, 16, 20 + oy, WHITE[0])
    for y in range(13, 19):
        s.rect(7, y + oy, 16, y + oy, B[3] if y % 2 == 1 else B[2])
        s.set(7, y + oy, B[4] if y % 2 else B[3])
        s.set(16, y + oy, B[1])
    if not medic:
        for x in range(8, 16, 3):  # 縅の糸（少なめ）
            s.set(x, 15 + oy, LACE[team])
    s.rect(7, 18 + oy, 16, 18 + oy, (110, 170, 210) if medic else WOOD[1])  # 帯
    if not medic:
        s.set(10, 18 + oy, GOLD[2])
        s.rect(5, 13 + oy, 8, 17 + oy, A[2])  # 袖
        s.rect(5, 13 + oy, 5, 17 + oy, A[3])
        s.rect(8, 14 + oy, 8, 17 + oy, A[1])
    else:
        s.rect(13, 13 + oy, 14, 18 + oy, (226, 236, 248))  # 衿
    # 顔
    s.rect(9, 8 + oy, 15, 13 + oy, SKIN[2])
    s.rect(9, 8 + oy, 10, 9 + oy, SKIN[3])
    s.rect(9, 12 + oy, 15, 13 + oy, SKIN[1])
    s.set(13, 10 + oy, EYE)
    s.set(13, 9 + oy, (120, 70, 50))
    s.set(14, 12 + oy, (200, 110, 96))
    s.set(11, 11 + oy, (255, 172, 150))
    s.rect(8, 8 + oy, 8, 12 + oy, (70, 46, 40))
    # かぶりもの
    if st.get("hat"):
        st["hat"](s, oy)
    elif kind == "spearman":
        kabuto(s, oy)
    elif medic:
        s.rect(8, 3 + oy, 16, 7 + oy, WHITE[2])  # 白い頭巾
        s.rect(9, 2 + oy, 15, 2 + oy, WHITE[2])
        s.rect(9, 3 + oy, 11, 4 + oy, WHITE[3])
        s.rect(14, 4 + oy, 16, 7 + oy, WHITE[1])
        s.rect(7, 7 + oy, 8, 13 + oy, WHITE[1])
        s.rect(8, 7 + oy, 16, 7 + oy, (110, 170, 210))
        s.rect(11, 4 + oy, 12, 5 + oy, HERB[1])  # 薬草の印
        s.set(12, 3 + oy, HERB[2])
    else:
        jingasa(s, oy, HATS[kind], GOLD[2] if kind == "gunner" else None)
    if bare:
        return s
    # 腕と武器
    if kind == "ashigaru":  # 刀（長い刃を明るい鋼色で）
        s.rect(15, 14 + oy, 17, 16 + oy, A[1])
        s.rect(17, 14 + oy, 18, 15 + oy, SKIN[2])
        if atk:  # 前へ振り下ろす
            s.line(18, 16 + oy, 21, 22, STEEL[3])
            s.line(19, 16 + oy, 21, 20, STEEL[1])
            s.rect(17, 15 + oy, 18, 16 + oy, WOOD[0])
            s.set(18, 15 + oy, GOLD[2])
            for x, y in ((20, 8), (21, 10), (21, 12), (19, 7)):  # 振りの軌跡
                s.set(x, y + oy, (255, 255, 230))
        else:  # 刃を立てて構える
            s.line(18, 12 + oy, 21, 3 + oy, STEEL[3])
            s.line(19, 12 + oy, 21, 6 + oy, STEEL[1])
            s.line(17, 12 + oy, 20, 3 + oy, STEEL[2])
            s.rect(17, 14 + oy, 18, 16 + oy, WOOD[0])
            s.rect(17, 13 + oy, 19, 13 + oy, GOLD[2])  # 鍔
    elif kind == "spearman":
        if atk:
            s.rect(14, 15 + oy, 18, 16 + oy, A[1])
            s.rect(18, 15 + oy, 19, 16 + oy, SKIN[2])
            s.line(7, 16 + oy, 21, 16 + oy, WOOD[2])
            s.line(7, 17 + oy, 21, 17 + oy, WOOD[1])
            s.rect(19, 14 + oy, 21, 18 + oy, STEEL[2])
            s.line(19, 14 + oy, 21, 14 + oy, STEEL[3])
            s.rect(17, 15 + oy, 18, 18 + oy, (220, 50, 50))
        else:
            s.rect(15, 14 + oy, 17, 16 + oy, A[1])
            s.rect(17, 14 + oy, 18, 16 + oy, SKIN[2])
            s.line(18, 25, 18, 4 + oy, WOOD[2])
            s.line(19, 25, 19, 4 + oy, WOOD[1])
            s.rect(18, 0, 19, 3 + oy, STEEL[2])
            s.set(18, 0, STEEL[3])
            s.rect(17, 4 + oy, 20, 5 + oy, (220, 50, 50))
    elif kind == "archer":  # 大きな弓と矢筒
        s.rect(4, 9 + oy, 6, 17 + oy, WOOD[3])
        s.rect(4, 9 + oy, 4, 17 + oy, WOOD[4])
        s.rect(6, 9 + oy, 6, 17 + oy, WOOD[1])
        for x in (4, 5, 6):
            s.set(x, 8 + oy, WHITE[3])
        s.set(5, 7 + oy, WHITE[2])
        bx = 18 + (1 if atk else 0)
        s.rect(15, 14 + oy, bx - 1, 15 + oy, A[1])
        s.set(bx - 1, 15 + oy, SKIN[2])
        s.line(bx, 4 + oy, bx + 2, 9 + oy, WOOD[1])
        s.line(bx + 2, 9 + oy, bx + 2, 18 + oy, WOOD[1])
        s.line(bx + 2, 18 + oy, bx, 23, WOOD[1])
        s.line(bx + 1, 5 + oy, bx + 3, 10 + oy, WOOD[3])
        s.set(bx + 3, 14 + oy, GOLD[2])  # 握り
        sx = 13 if atk else bx - 1
        s.line(bx, 5 + oy, sx, 14 + oy, WHITE[3])
        s.line(sx, 14 + oy, bx, 22, WHITE[3])
        if atk:
            s.line(12, 14 + oy, 21, 14 + oy, WHITE[3])
            s.set(21, 14 + oy, STEEL[3])
            s.set(12, 13 + oy, (220, 60, 60))
    elif kind == "gunner":  # 火縄銃（黒い銃身と木の台）
        s.rect(14, 15 + oy, 16, 17 + oy, A[1])
        s.rect(16, 16 + oy, 17, 17 + oy, SKIN[2])
        s.rect(9, 16 + oy, 14, 17 + oy, WOOD[2])
        s.rect(9, 17 + oy, 14, 17 + oy, WOOD[1])
        s.line(14, 15 + oy, 21, 15 + oy, IRON[2])
        s.line(14, 16 + oy, 21, 16 + oy, IRON[0])
        s.set(15, 15 + oy, GOLD[2])
        s.set(11, 18 + oy, FIRE[0])  # 火縄
        if atk:
            s.rect(21, 13 + oy, 21, 18 + oy, FIRE[1])
            s.set(21, 15 + oy, FIRE[2])
            s.set(21, 16 + oy, FIRE[2])
            for x, y in ((19, 12), (20, 11), (18, 11)):
                s.set(x, y + oy, (200, 200, 196))
    elif medic:  # 杖と薬箱
        s.rect(15, 14 + oy, 17, 15 + oy, WHITE[1])
        s.rect(17, 14 + oy, 18, 15 + oy, SKIN[2])
        s.line(19, 7 + oy, 19, 25, WOOD[3])
        s.line(20, 8 + oy, 20, 25, WOOD[1])
        s.rect(18, 4 + oy, 21, 6 + oy, GOLD[2])
        s.set(18, 4 + oy, GOLD[3])
        s.set(21, 6 + oy, GOLD[0])
        s.rect(3, 13 + oy, 6, 18 + oy, HERB[1])
        s.rect(3, 13 + oy, 6, 13 + oy, HERB[2])
        s.rect(6, 14 + oy, 6, 18 + oy, HERB[0])
        s.set(4, 15 + oy, (250, 244, 220))
        if atk:
            for x, y in ((17, 2), (21, 1), (15, 5), (21, 9)):
                s.set(x, y + oy, (160, 255, 170))
    s.outline()
    return s


HORSE_BASE = [(84, 46, 26), (124, 70, 38), (168, 100, 56), (204, 140, 86), (232, 186, 130)]
MANE_BASE = (54, 34, 28)


def cavalry_v2(team="ally", pose="idle", frame=0, bare=False, style=None):
    """騎兵（34×30）：横向きの馬と、赤い兜の乗り手
    style：上級職の描き分け {"horse": 馬の色, "mane": たてがみの色, "hat": f(s, ry)（乗り手のかぶりもの）, "cloth": 鞍の布の色}"""
    st = style or {}
    HORSE = st.get("horse") or HORSE_BASE
    MANE = st.get("mane") or MANE_BASE
    s = Sprite2(34, 30)
    A, F = AI[team], FLAG[team]
    run, atk = pose == "walk", pose == "attack"
    by = 18 - (1 if (run and frame == 0) or (pose == "idle" and frame == 1) else 0)
    s.line(7, by - 2, 4, by + 4, MANE)  # 尾
    s.line(8, by - 2, 5, by + 4, (90, 60, 46))
    # 脚（奥の2本は暗く）
    legs = [(10, 0, 1), (13, 0, 0), (19, 0, 1), (22, 0, 0)]
    if run:
        legs = [(9, -2, 1), (13, 1, 0), (18, -1, 1), (23, 2, 0)] if frame == 0 else [(11, 1, 1), (12, -1, 0), (20, 1, 1), (21, -2, 0)]
    for x, d, back in legs:
        R = HORSE[0:3] if back else HORSE[1:4]
        s.line(x, by + 3, x + d, by + 8, R[0])
        s.line(x + 1, by + 3, x + 1 + d, by + 8, R[1])
        s.rect(x + d, by + 9, x + 1 + d, by + 9, IRON[1])
    s.blob(15, by, 9, 4.6, HORSE)  # 胴
    for i in range(6):  # 首
        s.rect(21 + i * 0.6, by - 3 - i, 24 + i * 0.6, by - 1 - i, HORSE[2] if i < 4 else HORSE[3])
    s.rect(23, by - 10, 28, by - 6, HORSE[2])  # 頭
    s.rect(23, by - 10, 26, by - 9, HORSE[3])
    s.rect(27, by - 8, 31, by - 5, HORSE[2])
    s.rect(30, by - 6, 31, by - 5, HORSE[1])
    s.set(30, by - 7, HORSE[0])
    s.set(25, by - 8, EYE)
    s.set(24, by - 10, HORSE[2])
    s.rect(21, by - 8, 22, by - 2, MANE)
    s.line(24, by - 8, 28, by - 5, A[1])  # 手綱
    # 鞍の布（チームの色。上級職は布の色を変えられる）
    CL = st.get("cloth") or A
    s.rect(12, by - 4, 19, by - 2, CL[2])
    s.rect(12, by - 4, 19, by - 4, CL[3])
    s.rect(12, by - 1, 19, by - 1, GOLD[1])
    # 乗り手
    ry = by - 13
    s.rect(13, ry + 5, 18, ry + 9, A[2])
    s.rect(13, ry + 5, 14, ry + 6, A[3])
    s.rect(13, ry + 8, 18, ry + 8, WOOD[1])
    s.rect(14, ry + 1, 18, ry + 4, SKIN[2])
    s.set(17, ry + 2, EYE)
    s.rect(14, ry + 1, 14, ry + 3, (70, 46, 40))
    if st.get("hat"):
        st["hat"](s, ry)
    else:
        s.rect(13, ry - 1, 18, ry, RED[2])  # 兜
        s.rect(14, ry - 2, 17, ry - 2, RED[3])
        s.rect(13, ry, 18, ry, RED[1])
        s.rect(12, ry, 12, ry + 3, RED[1])
        s.set(15, ry - 3, GOLD[2])
        s.set(16, ry - 3, GOLD[3])
        s.set(14, ry - 3, GOLD[1])
    s.line(11, ry - 4, 11, ry + 8, WOOD[1])  # 背旗
    s.rect(8, ry - 4, 10, ry + 2, F[2])
    s.rect(8, ry - 4, 8, ry + 2, F[3])
    if bare:
        return s
    if atk:
        s.line(16, ry + 6, 33, ry + 5, WOOD[2])
        s.rect(31, ry + 4, 33, ry + 6, STEEL[2])
        s.set(33, ry + 5, STEEL[3])
        s.set(29, ry + 6, (220, 50, 50))
    else:
        s.line(18, ry + 7, 27, ry - 3, WOOD[2])
        s.rect(27, ry - 6, 28, ry - 3, STEEL[2])
        s.set(27, ry - 6, STEEL[3])
        s.set(26, ry - 2, (220, 50, 50))
    s.outline()
    return s


# ===== 塔（42×56）：共通の石垣・櫓と、上に載る兵・武器で種類を分ける =====
STONE = [(92, 90, 88), (132, 128, 120), (170, 166, 156), (206, 202, 190), (230, 228, 218)]
ROOF = [(30, 36, 60), (48, 58, 92), (70, 84, 128), (100, 118, 168), (150, 168, 210)]
WATER = [(40, 86, 160), (60, 124, 200), (96, 166, 230), (160, 214, 250), (226, 246, 255)]


def tower_frame(s, team, roof=True, curtain=True):
    rnd = random.Random(7)
    for row, y in enumerate(range(46, 55, 3)):
        x = 4 - (row % 2) * 2
        while x < 38:
            x1 = min(37, x + rnd.choice((4, 5, 6)) - 1)
            s.rect(x, y, x1, y + 2, STONE[2])
            s.rect(x, y, x1, y, STONE[3])
            s.set(x, y, STONE[4])
            s.rect(x, y + 2, x1, y + 2, STONE[1])
            s.set(x1, y + 1, STONE[1])
            if rnd.random() < 0.3:
                s.set(x + 1, y + 1, (110, 150, 90))
            x = x1 + 2
    for x, back in ((10, True), (30, True), (6, False), (33, False)):
        R = WOOD[:3] if back else WOOD[1:]
        s.rect(x, 21, x + 2, 45, R[1])
        s.rect(x, 21, x, 45, R[2])
        s.rect(x + 2, 21, x + 2, 45, R[0])
        if not back:
            for y in range(24, 45, 5):
                s.set(x + 1, y, R[0])
    s.line(9, 25, 32, 42, WOOD[1])
    s.line(9, 26, 32, 43, WOOD[2])
    s.line(32, 25, 9, 42, WOOD[1])
    s.line(32, 26, 9, 43, WOOD[2])
    s.rect(6, 33, 35, 34, WOOD[2])
    s.rect(6, 34, 35, 34, WOOD[1])
    for x, y in ((7, 33), (34, 33), (20, 33)):
        s.set(x, y, (226, 196, 140))
        s.set(x, y + 1, (190, 156, 100))
    s.rect(3, 18, 38, 21, WOOD[2])
    s.rect(3, 18, 38, 18, WOOD[3])
    s.rect(3, 21, 38, 21, WOOD[0])
    for x in range(5, 38, 4):
        s.set(x, 19, WOOD[1])
        s.set(x + 2, 20, WOOD[1])
    s.rect(3, 13, 38, 13, WOOD[3])
    for x in range(4, 39, 5):
        s.rect(x, 13, x, 17, WOOD[2])
    F = FLAG[team]
    if curtain:
        s.rect(14, 14, 27, 20, F[2])
        s.rect(14, 14, 27, 14, F[3])
        s.rect(14, 20, 27, 20, F[1])
        for x, y in ((20, 16), (21, 16), (20, 17), (21, 17), (19, 17), (22, 16)):
            s.set(x, y, (245, 240, 225))
    if roof:
        for i, (y, x0, x1) in enumerate(((0, 13, 28), (1, 9, 32), (2, 6, 35), (3, 3, 38), (4, 1, 40))):
            s.rect(x0, y, x1, y, ROOF[2] if i % 2 == 0 else ROOF[1])
            s.rect(x0, y, x0 + 4, y, ROOF[3])
        s.rect(14, 0, 22, 0, ROOF[4])
        s.set(0, 3, ROOF[2])
        s.set(41, 3, ROOF[2])
        s.rect(2, 5, 39, 5, ROOF[0])
        s.rect(12, 0, 13, 0, GOLD[2])
        s.rect(28, 0, 29, 0, GOLD[2])
        for x in (6, 35):
            s.rect(x, 6, x + 1, 12, WOOD[1])
    s.line(39, 6, 39, 45, WOOD[1])  # のぼり旗
    s.rect(40, 8, 41, 22, F[2])
    s.rect(40, 8, 40, 22, F[3])


def head(s, x, y, team, H):
    """塔の上の兵（顔・陣笠・肩）"""
    s.rect(x, y + 3, x + 5, y + 7, SKIN[2])
    s.rect(x, y + 3, x + 1, y + 4, SKIN[3])
    s.set(x + 4, y + 5, EYE)
    s.rect(x - 3, y + 2, x + 8, y + 2, H[1])
    s.rect(x - 1, y + 1, x + 6, y + 1, H[2])
    s.rect(x + 1, y, x + 4, y, H[3])
    s.rect(x - 3, y + 2, x, y + 2, H[2])
    s.rect(x, y + 8, x + 5, y + 8, AI[team][2])


def tower_level(s, kind, team, level):
    """強化Lv（1〜5）の見た目：Lv2 左にものぼり旗、Lv3 金の軒（屋根なしの塔は足場の縁）、Lv4 金の手すり、Lv5 金の飾り"""
    F = FLAG[team]
    roof = kind in ("arrow", "gun")
    if level >= 2:  # 左にものぼり旗（家紋つき）
        s.line(4, 6, 4, 45, WOOD[1])
        s.rect(0, 7, 3, 24, F[2])
        s.rect(0, 7, 0, 24, F[3])
        s.rect(3, 7, 3, 24, F[1])
        s.rect(1, 12, 2, 13, (245, 240, 225))
    if level >= 3:
        if roof:
            s.rect(2, 5, 39, 5, GOLD[1])
            s.rect(2, 5, 12, 5, GOLD[2])
        else:
            s.rect(3, 21, 38, 21, GOLD[1])
            s.rect(3, 21, 12, 21, GOLD[2])
    if level >= 4:
        s.rect(3, 13, 38, 13, GOLD[2])
        s.rect(3, 13, 10, 13, GOLD[3])
    if level >= 5:  # 金の棟と鯱（屋根なしの塔は足場の角に金の飾り）
        if roof:
            s.rect(13, 0, 28, 0, GOLD[2])
            s.rect(13, 0, 18, 0, GOLD[3])
            for x in (12, 29):
                s.rect(x, 0, x, 1, GOLD[2])
        for x in ((1, 40) if roof else (3, 38)):
            y = 3 if roof else 12
            s.rect(x, y - 2, x, y, GOLD[2])
            s.set(x, y - 3, GOLD[3])
        s.rect(19, 46, 22, 47, GOLD[2])  # 石垣の金の紋
        s.set(19, 46, GOLD[3])


def tower_v2(kind, team="ally", level=1):
    s = Sprite2(42, 56)
    if kind == "arrow":
        tower_frame(s, team)
        head(s, 18, 5, team, HATS["archer"])
        s.line(27, 3, 29, 8, WOOD[1])
        s.line(29, 8, 29, 13, WOOD[1])
        s.line(29, 13, 27, 17, WOOD[1])
        s.line(26, 4, 26, 16, (230, 225, 210))
        s.line(23, 10, 31, 10, (240, 236, 220))
        s.set(32, 10, STEEL[2])
    elif kind == "gun":
        tower_frame(s, team)
        head(s, 16, 5, team, HATS["gunner"])
        s.set(18, 6, GOLD[2])
        s.rect(20, 11, 25, 12, WOOD[2])  # 銃の台
        s.line(22, 10, 38, 10, IRON[2])
        s.line(22, 11, 38, 11, IRON[0])
        s.set(24, 10, GOLD[2])
        s.rect(39, 9, 40, 12, FIRE[1])
        s.set(40, 10, FIRE[2])
        for x, y in ((37, 7), (38, 6), (36, 6)):  # 煙
            s.set(x, y, (210, 210, 206))
    elif kind == "cannon":
        tower_frame(s, team, roof=False, curtain=False)
        # 土嚢の胸壁
        for x in range(3, 38, 5):
            s.rect(x, 14, x + 4, 17, (196, 172, 120))
            s.rect(x, 14, x + 4, 14, (226, 206, 160))
            s.rect(x + 4, 15, x + 4, 17, (150, 126, 86))
        # 大砲：黒鉄の砲身（光の筋）・金の帯・木の台車
        s.blob(14, 9, 6, 4.5, IRON)
        s.rect(14, 6, 33, 11, IRON[1])
        s.rect(14, 6, 33, 7, IRON[2])
        s.rect(15, 6, 30, 6, IRON[3])
        s.rect(14, 11, 33, 11, IRON[0])
        s.rect(32, 5, 35, 12, IRON[2])
        s.rect(32, 5, 35, 5, IRON[3])
        s.rect(35, 7, 35, 10, IRON[0])
        for x in (19, 26):
            s.rect(x, 6, x, 11, GOLD[2])
            s.set(x, 6, GOLD[3])
        s.rect(7, 3, 9, 5, GOLD[1])  # 尾栓
        s.rect(10, 11, 24, 13, WOOD[2])
        s.rect(10, 11, 24, 11, WOOD[3])
        s.blob(13, 13, 3.6, 3.6, WOOD[:4])  # 車輪
        s.set(13, 13, GOLD[2])
        s.blob(22, 13, 3.6, 3.6, WOOD[:4])
        s.set(22, 13, GOLD[2])
        for x, y in ((2, 9), (3, 10), (2, 11), (4, 9), (3, 8)):  # 砲弾の山
            s.set(x, y, IRON[1] if (x + y) % 2 else IRON[3])
    elif kind == "ice":  # 水攻め：大きな水桶と、樋から落ちる水
        tower_frame(s, team, roof=False)
        s.rect(8, 2, 27, 15, WOOD[2])
        s.rect(8, 2, 10, 15, WOOD[3])
        s.rect(25, 2, 27, 15, WOOD[1])
        for x in range(11, 25, 3):
            s.line(x, 3, x, 15, WOOD[1])
        for y in (4, 12):
            s.rect(8, y, 27, y, IRON[2])
            s.rect(8, y, 12, y, IRON[3])
        s.rect(9, 1, 26, 2, WATER[2])
        s.rect(10, 1, 15, 1, WATER[4])
        s.set(20, 1, WATER[3])
        s.rect(27, 7, 33, 8, WOOD[2])  # 樋
        s.rect(27, 7, 33, 7, WOOD[3])
        s.rect(28, 6, 33, 6, WATER[2])
        for y in range(9, 46):  # 落ちる水
            w = 2 if y < 30 else 3
            for dx in range(w):
                s.set(33 + dx, y, WATER[3] if dx == 0 else WATER[2])
            if y % 5 == 0:
                s.set(33, y, WATER[4])
        for x, y in ((31, 45), (37, 45), (30, 44), (38, 44), (34, 43)):
            s.set(x, y, WATER[4])
    tower_level(s, kind, team, level)
    s.outline()
    return s


# ===== 城：通常（108×92）・強化（128×110） =====
def castle_set_v2(level=1, team="ally"):
    big = level >= 2
    W, H = (128, 110) if big else (108, 92)
    s = Sprite2(W, H)
    cx = W // 2
    rnd = random.Random(3 + level)
    WALL = [(170, 164, 150), (214, 208, 194), (242, 238, 226), (255, 253, 245)]
    BLACK = [(28, 26, 32), (52, 50, 60), (80, 78, 92)]
    top = H - 30
    base = 46 if big else 38
    spread = 14 if big else 12
    for y in range(top, H - 1):
        t = (y - top) / (H - 1 - top)
        half = base + spread * t * t
        s.rect(cx - half, y, cx + half, y, STONE[2])
    for r, y in enumerate(range(top, H - 2, 4)):
        t = (y - top) / (H - 1 - top)
        half = int(base + spread * t * t)
        x = cx - half + (r % 2) * 3
        while x < cx + half - 2:
            x1 = min(cx + half - 1, x + rnd.choice((5, 6, 7, 8)) - 1)
            c = STONE[2] if rnd.random() < 0.7 else STONE[1]
            s.rect(x, y, x1, y + 2, c)
            s.rect(x, y, x1, y, STONE[3] if c == STONE[2] else STONE[2])
            s.set(x, y, STONE[4])
            s.rect(x, y + 3, x1, y + 3, STONE[0])
            x = x1 + 2
    for y in range(top, H - 1):
        for x in range(cx + 20, W):
            c = s.get(x, y)
            if c:
                s.set(x, y, mix(c, (40, 40, 70), 0.25))
    # 門
    s.rect(cx - 7, H - 14, cx + 7, H - 2, WOOD[1])
    s.rect(cx - 7, H - 14, cx - 6, H - 2, WOOD[2])
    s.line(cx, H - 13, cx, H - 2, WOOD[0])
    for y in (H - 11, H - 6):
        for x in (cx - 4, cx + 3):
            s.set(x, y, GOLD[2])
    s.rect(cx - 9, H - 16, cx + 9, H - 15, ROOF[2])
    s.rect(cx - 9, H - 16, cx - 2, H - 16, ROOF[3])

    def tier(y, half, h, rh, gold):
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
        if gold:  # 強化：軒先の金
            s.rect(cx - half - 6, ry + rh - 1, cx + half + 6, ry + rh - 1, GOLD[1])
            s.rect(cx - half - 6, ry + rh - 1, cx - half + 4, ry + rh - 1, GOLD[2])
        s.set(cx - half - 7, ry + rh - 2, ROOF[2])
        s.set(cx + half + 7, ry + rh - 2, ROOF[2])
        s.set(cx - half - 8, ry + rh - 3, ROOF[3])
        s.set(cx + half + 8, ry + rh - 3, ROOF[1])
        s.rect(cx - half - 5, ry + rh, cx + half + 5, ry + rh, ROOF[0])
        for i in range(5):
            s.rect(cx - 6 + i, ry - i + 1, cx + 6 - i, ry - i + 1, ROOF[2])
        s.rect(cx - 2, ry - 2, cx + 2, ry, WALL[2])
        s.set(cx, ry - 3, GOLD[2])
        s.rect(cx - 6, ry + 1, cx + 6, ry + 1, GOLD[1])

    if big:
        # 石垣の両端の隅櫓
        for tx in (cx - 44, cx + 44):
            s.rect(tx - 8, top - 10, tx + 8, top - 1, WALL[2])
            s.rect(tx - 8, top - 10, tx - 6, top - 1, WALL[3])
            s.rect(tx - 8, top - 4, tx + 8, top - 1, BLACK[1])
            s.rect(tx - 3, top - 8, tx + 2, top - 6, BLACK[0])
            for i in range(4):
                hw = 11 - i * 2
                s.rect(tx - hw, top - 11 - i, tx + hw, top - 11 - i, ROOF[2] if i % 2 == 0 else ROOF[1])
                s.rect(tx - hw, top - 11 - i, tx - hw + 3, top - 11 - i, ROOF[3])
            s.rect(tx - 11, top - 11, tx + 11, top - 11, GOLD[1])
        tier(top - 12, 30, 11, 5, True)
        tier(top - 28, 23, 10, 5, True)
        tier(top - 43, 16, 9, 5, True)
        tier(top - 57, 10, 8, 5, True)
        ty = top - 66
        hw0 = 11
    else:
        tier(top - 12, 34, 11, 5, False)
        tier(top - 28, 25, 10, 5, False)
        tier(top - 43, 16, 9, 5, False)
        ty = top - 52
        hw0 = 14
    for i in range(5):
        hw = hw0 - i * 2
        s.rect(cx - hw, ty + 4 - i, cx + hw, ty + 4 - i, ROOF[2] if i % 2 == 0 else ROOF[1])
        s.rect(cx - hw, ty + 4 - i, cx - hw + 3, ty + 4 - i, ROOF[3])
    s.rect(cx - hw0 - 1, ty + 5, cx + hw0 + 1, ty + 5, GOLD[1] if big else ROOF[0])
    for sx in (-6, 6):  # しゃちほこ
        s.rect(cx + sx - 1, ty - 3, cx + sx, ty, GOLD[2])
        s.set(cx + sx - (1 if sx < 0 else 0), ty - 4, GOLD[3])
        s.set(cx + sx + (1 if sx < 0 else -1), ty - 1, GOLD[1])
        if big:
            s.set(cx + sx + (-2 if sx < 0 else 1), ty - 2, GOLD[2])
    F = FLAG[team]
    poles = (cx - 58, cx + 56) if big else (cx - 46, cx + 44)
    for x in poles:
        s.line(x, top - 34, x, top + 4, WOOD[1])
        s.rect(x + 1, top - 32, x + 4, top - 12, F[2])
        s.rect(x + 1, top - 32, x + 1, top - 12, F[3])
        s.rect(x + 4, top - 32, x + 4, top - 12, F[1])
        s.set(x + 2, top - 27, (245, 240, 225))
        s.set(x + 3, top - 27, (245, 240, 225))
        s.set(x + 2, top - 26, (245, 240, 225))
    s.outline()
    return s


# ===== 背景 =====
# 草原は兵士より目立たないよう、第2試作より彩度とコントラストを抑える（明るさと温かみは残す）
def soften(R, sat=0.72, con=0.7, warm=0.0):
    """彩度（sat）とコントラスト（con）を下げる。warm で明るく温かい色へ寄せる"""
    mid = R[len(R) // 2]
    out = []
    for c in R:
        c = mix(mid, c, con)
        g = sum(c) / 3
        c = tuple(int(g + (v - g) * sat) for v in c)
        out.append(mix(c, (236, 226, 170), warm) if warm else c)
    return out


GRASS_V2 = [(84, 140, 70), (106, 164, 78), (128, 186, 88), (154, 204, 100), (186, 222, 120)]
GRASS = soften(GRASS_V2, 0.8, 0.55, 0.16)
SAND = soften([(150, 112, 70), (196, 156, 102), (226, 192, 136), (240, 214, 164), (250, 234, 196)], 0.8, 0.75)
LEAF = soften([(40, 92, 56), (60, 122, 64), (88, 152, 74), (126, 184, 90), (176, 214, 120)], 0.8, 0.85)
PINE = soften([(36, 78, 58), (50, 104, 70), (70, 132, 82), (100, 160, 96), (140, 190, 120)], 0.8, 0.85)
SAKURA = soften([(168, 92, 120), (214, 128, 160), (240, 168, 196), (252, 204, 222), (255, 236, 244)], 0.75, 0.85)
WATER_BG = soften(WATER, 0.8, 0.8)


def tree_set_v2(kind="round", seed=1):
    rnd = random.Random(seed)
    if kind == "pine":
        s = Sprite2(26, 34)
        s.rect(11, 22, 14, 32, WOOD[1])
        s.rect(11, 22, 11, 32, WOOD[2])
        s.rect(14, 22, 14, 32, WOOD[0])
        for y, half in ((4, 4), (9, 7), (14, 10), (19, 12)):
            s.blob(13, y + 2, half, 3.4, PINE)
        s.set(13, 1, PINE[3])
    elif kind == "sakura":
        s = Sprite2(30, 32)
        s.rect(13, 20, 16, 30, WOOD[0])
        s.rect(13, 20, 13, 30, WOOD[1])
        s.line(14, 22, 9, 17, WOOD[0])
        for x, y, r in ((9, 12, 6), (20, 11, 7), (15, 7, 7), (14, 15, 7), (6, 17, 4), (23, 17, 5)):
            s.blob(x, y, r, r * 0.8, SAKURA)
        for _ in range(10):
            s.set(rnd.randrange(4, 26), rnd.randrange(4, 20), SAKURA[4])
    elif kind == "bush":
        s = Sprite2(18, 12)
        for x, y, r in ((5, 7, 4.5), (11, 6, 5), (14, 8, 3.5)):
            s.blob(x, y, r, r * 0.8, LEAF)
        s.set(6, 5, (240, 230, 180))
        s.set(12, 4, (240, 230, 180))
    elif kind == "bamboo":  # 竹：縦の幹と節、細い葉
        s = Sprite2(22, 36)
        BAM = soften([(70, 110, 60), (100, 146, 72), (136, 178, 92), (176, 206, 124), (210, 230, 160)], 0.8, 0.85)
        for x, top in ((6, 4), (11, 1), (16, 6)):
            s.rect(x, top, x + 1, 34, BAM[2])
            s.rect(x, top, x, 34, BAM[3])
            for y in range(top + 5, 34, 6):
                s.rect(x, y, x + 1, y, BAM[0])
        for x, y in ((3, 6), (9, 3), (14, 8), (18, 10), (2, 14), (13, 14), (19, 18), (4, 22)):
            s.line(x, y, x + 3, y - 1, BAM[1])
            s.line(x, y + 1, x + 2, y, BAM[3])
    else:
        s = Sprite2(30, 34)
        s.rect(13, 20, 16, 32, WOOD[1])
        s.rect(13, 20, 13, 32, WOOD[2])
        s.rect(16, 20, 16, 32, WOOD[0])
        s.set(14, 25, WOOD[0])
        s.line(15, 23, 20, 18, WOOD[1])
        for x, y, r in ((9, 14, 7), (20, 14, 7), (14, 8, 8), (15, 17, 7), (6, 18, 4.5), (24, 19, 4.5)):
            s.blob(x, y, r, r * 0.85, LEAF)
        for _ in range(14):
            x, y = rnd.randrange(4, 26), rnd.randrange(3, 22)
            if s.get(x, y):
                s.set(x, y, LEAF[1] if rnd.random() < 0.5 else LEAF[4])
    s.outline(0.55)
    return s


def rock_v2(seed=1):
    s = Sprite2(18, 12)
    R = soften(STONE, 0.9, 0.85)
    s.blob(8, 7, 7, 4.5, R)
    s.blob(13, 8, 4, 3, R)
    s.set(5, 4, R[4])
    s.set(7, 9, (120, 150, 100))
    s.outline(0.55)
    return s


def fence_v2():
    """柵（竹矢来）"""
    s = Sprite2(32, 16)
    for x in range(1, 32, 5):
        s.rect(x, 2, x + 1, 14, WOOD[2])
        s.rect(x, 2, x, 14, WOOD[3])
        s.set(x, 1, WOOD[3])
    for y in (5, 10):
        s.rect(0, y, 31, y, WOOD[1])
        s.rect(0, y - 1, 31, y - 1, WOOD[3])
    s.outline(0.55)
    return s


def lantern_v2():
    """石灯籠"""
    s = Sprite2(12, 20)
    R = soften(STONE, 0.9, 0.85)
    s.rect(2, 2, 9, 3, R[2])
    s.rect(3, 1, 8, 1, R[3])
    s.rect(5, 0, 6, 0, R[3])
    s.rect(3, 4, 8, 8, R[2])
    s.rect(3, 4, 4, 8, R[3])
    s.rect(5, 5, 6, 7, (255, 220, 140))
    s.rect(2, 9, 9, 10, R[1])
    s.rect(4, 11, 7, 16, R[2])
    s.rect(4, 11, 4, 16, R[3])
    s.rect(2, 17, 9, 19, R[1])
    s.rect(2, 17, 9, 17, R[3])
    s.outline(0.55)
    return s


def bridge_v2(length=34, deck=12):
    """木の橋（左右に渡る）：板の床・欄干・擬宝珠"""
    s = Sprite2(length, deck + 12)
    s.rect(0, 6, length - 1, deck + 5, WOOD[2])
    for x in range(0, length, 3):
        s.rect(x, 6, x, deck + 5, WOOD[1])
        s.set(x + 1, 7, WOOD[3])
    s.rect(0, deck + 5, length - 1, deck + 6, WOOD[0])  # 床の下の影
    for y in (3, deck + 8):  # 欄干
        s.rect(0, y, length - 1, y, (196, 74, 52))
        s.rect(0, y - 1, length - 1, y - 1, (226, 120, 90))
        for x in (1, length // 2, length - 3):
            s.rect(x, y - 2, x + 1, y + 2, (176, 60, 44))
            s.set(x, y - 3, GOLD[2])
            s.set(x + 1, y - 3, GOLD[1])
    s.outline(0.55)
    return s


def paint_ground(W, H, road_dist=None, river_x=None, seed=5, pal=None, flowers=150):
    """草原（色むら・草の房・花・小石）＋道＋川。river_x(y) は川の中心のx"""
    G = pal or GRASS
    im = Image.new("RGBA", (W, H))
    px = im.load()
    n1 = value_noise(W, H, 20, seed)
    n2 = value_noise(W, H, 6, seed + 1)
    rnd = random.Random(seed)
    for y in range(H):
        for x in range(W):
            v = n1[y][x] * 0.7 + n2[y][x] * 0.3
            k = 1 if v < 0.36 else 2 if v < 0.58 else 3
            if v > 0.76:
                k = 4
            c = G[k]
            if (x + y * 3) % 7 == 0 and v > 0.5:
                c = G[k - 1]
            px[x, y] = (*c, 255)
    rd = {}
    if road_dist:
        for y in range(H):
            for x in range(W):
                d = road_dist(x, y)
                rd[x, y] = d
                if d < 12:
                    k = 2 if d < 10 else 1
                    if abs(d - 6) < 0.6 and x % 3:
                        k = 1
                    if d < 3 and (x * 7 + y) % 11 == 0:
                        k = 3
                    px[x, y] = (*SAND[k], 255)
                elif d < 13.5:
                    px[x, y] = (*mix(SAND[0], G[0], 0.4), 255)
                elif d < 15:
                    px[x, y] = (*G[0], 255)
    if river_x:
        for y in range(H):
            cx = river_x(y)
            for x in range(int(cx) - 11, int(cx) + 12):
                if not (0 <= x < W) or rd.get((x, y), 99) < 12:
                    continue
                d = abs(x - cx)
                if d < 8:
                    k = 1 if d > 6 else 2
                    if (x * 5 + y * 3) % 17 == 0 or (abs(x - cx + 2) < 1 and y % 7 < 3):
                        k = 4 if d < 4 else 3
                    px[x, y] = (*WATER_BG[k], 255)
                elif d < 9.5:
                    px[x, y] = (*SAND[1], 255)  # 岸の砂
                elif d < 11:
                    px[x, y] = (*mix(SAND[0], G[0], 0.5), 255)
    for _ in range(flowers):
        x, y = rnd.randrange(1, W - 1), rnd.randrange(2, H - 1)
        if road_dist and rd.get((x, y), 99) < 16:
            continue
        if river_x and abs(x - river_x(y)) < 13:
            continue
        r = rnd.random()
        if r < 0.55:
            px[x, y] = (*G[0], 255)
            px[x, y - 1] = (*G[3], 255)
            px[x + 1, y - 1] = (*G[4], 255)
        elif r < 0.85:
            col = rnd.choice(((246, 242, 226), (240, 214, 120), (232, 170, 190), (196, 182, 236)))
            px[x, y] = (*col, 255)
            px[x, y + 1] = (*G[1], 255)
        else:
            px[x, y] = (176, 174, 164, 255)
            px[x + 1, y] = (146, 144, 136, 255)
            px[x, y + 1] = (112, 110, 104, 255)
    return im


def shadow(im, x, bottom, rx=11, ry=3):
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
    sp = sh.load()
    for yy in range(int(bottom - ry), int(bottom + ry)):
        for xx in range(int(x - rx), int(x + rx) + 1):
            if 0 <= xx < im.width and 0 <= yy < im.height and ((xx - x) / rx) ** 2 + ((yy - bottom + 1) / ry) ** 2 <= 1:
                sp[xx, yy] = (24, 50, 30, 80)
    im.alpha_composite(sh)


if __name__ == "__main__":
    os.makedirs(OUT3, exist_ok=True)
    n = 0
    for kind in KINDS:
        for team in ("ally", "enemy"):
            for pose, f in POSES:
                soldier_v2(kind, team, pose, f).image().save(os.path.join(OUT3, f"{kind}_{team}_{pose}{f}.png"))
                n += 1
    for kind in ("arrow", "cannon", "gun", "ice"):
        for team in ("ally", "enemy"):
            tower_v2(kind, team).image().save(os.path.join(OUT3, f"tower_{kind}_{team}.png"))
            n += 1
    for lv in (1, 2):
        castle_set_v2(lv).image().save(os.path.join(OUT3, f"castle_{lv}.png"))
        n += 1
    for k in ("round", "pine", "sakura", "bush", "bamboo"):
        tree_set_v2(k, 2).image().save(os.path.join(OUT3, f"tree_{k}.png"))
        n += 1
    for name, sp in (("rock", rock_v2()), ("fence", fence_v2()), ("lantern", lantern_v2()), ("bridge", bridge_v2())):
        sp.image().save(os.path.join(OUT3, f"{name}.png"))
        n += 1
    paint_ground(64, 64, seed=3).save(os.path.join(OUT3, "grass.png"))
    paint_ground(64, 64, river_x=lambda y: 32 + 4 * math.sin(y / 10), seed=4).save(os.path.join(OUT3, "river.png"))
    paint_ground(64, 64, road_dist=lambda x, y: abs(y - 32), seed=6).save(os.path.join(OUT3, "road.png"))
    print(n + 3, "files")
