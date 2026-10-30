#!/usr/bin/env python3
"""武器の改良の比較画像（docs/proto/compare-weapons.png）。ゲームには組み込まない。

  python3 tools/proto/make_compare_weapons.py
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_proto_art import OUT_DOC  # noqa: E402
from make_preview import BG, INK, HEAD, label, panel  # noqa: E402
from make_proto_set_v2 import KINDS, NAMES, soldier_v2, paint_ground  # noqa: E402
from make_weapons_v2 import soldier_w  # noqa: E402

PHONE = 1170 / 480  # 防衛戦の実寸：1ドット＝約2.44画素
WEAPON_NAMES = {"ashigaru": "刀", "spearman": "槍", "archer": "弓", "gunner": "火縄銃", "medic": "杖（錫杖）", "cavalry": "薙刀"}


def bottom_paste(im, sp, cx, bottom):
    im.alpha_composite(sp, (int(cx - sp.width / 2), int(bottom - sp.height)))


def make():
    W = 1800
    Z = 5
    row_h = 220
    H = 150 + 90 + len(KINDS) * row_h + 40 + 560
    im = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(im)
    label(d, (40, 24), "兵士の武器の改良（左：今の試作　右：改良した武器）", 40)
    label(d, (40, 80), "兵士の体・画風はそのまま。武器だけを大きくデフォルメし、光沢・穂先・弓の形・銃身を強調した（5倍、騎兵は4倍）。", 22)
    top = 130
    panel(im, d, (30, top, W - 30, top + 90 + len(KINDS) * row_h + 10), "6兵種 × 待機・攻撃（味方）")
    label(d, (520, top + 50), "今の試作", 26, (120, 90, 60), "ma")
    label(d, (1300, top + 50), "改良した武器", 26, (30, 90, 160), "ma")
    d.line((900, top + 50, 900, top + 80 + len(KINDS) * row_h), fill=(200, 176, 140), width=3)
    for r, k in enumerate(KINDS):
        y = top + 90 + r * row_h
        label(d, (60, y + 70), NAMES[k], 28)
        label(d, (60, y + 108), WEAPON_NAMES[k], 20, (110, 90, 70))
        bottom = y + row_h - 20
        for i, pose in enumerate(("idle", "attack")):
            z = 4 if k == "cavalry" else Z
            old = soldier_v2(k, "ally", pose, 0).image(z)
            new = soldier_w(k, "ally", pose, 0).image(z)
            bottom_paste(im, old, 380 + i * 280, bottom)
            bottom_paste(im, new, 1130 + i * 340, bottom)
        if r == 0:
            for i, n in enumerate(("待機", "攻撃")):
                label(d, (380 + i * 280, y - 6), n, 18, INK, "ma")
                label(d, (1130 + i * 340, y - 6), n, 18, INK, "ma")
    # スマホの実寸：草原の上に味方・敵
    y0 = top + 90 + len(KINDS) * row_h + 40
    panel(im, d, (30, y0, W - 30, H - 20), "スマホでの実際の大きさ（防衛戦・iPhone 390px幅・画素密度3、草原の上）")
    for j, (name, fn) in enumerate((("今の試作", soldier_v2), ("改良した武器", soldier_w))):
        gy = y0 + 60 + j * 240
        g = paint_ground(int((W - 220) / PHONE), int(200 / PHONE), seed=11 + j).resize((W - 220, 200), Image.NEAREST)
        im.alpha_composite(g, (180, gy))
        label(d, (60, gy + 86), name, 24, HEAD)
        x = 230
        for team in ("ally", "enemy"):
            for k in KINDS:
                for pose in ("idle", "attack"):
                    sp = fn(k, team, pose, 0).image()
                    sp = sp.resize((round(sp.width * PHONE), round(sp.height * PHONE)), Image.NEAREST)
                    bottom_paste(im, sp, x, gy + 170)
                    x += 56 if pose == "idle" else 66
                x += 2
            x += 30
    path = os.path.join(OUT_DOC, "compare-weapons.png")
    im.convert("RGB").save(path)
    return path


if __name__ == "__main__":
    print(make())
