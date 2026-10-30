#!/usr/bin/env python3
"""第2試作の画風でそろえた全素材のプレビュー。ゲームには組み込まない。

  python3 tools/proto/make_preview_set_v2.py [今の戦場の画面写真]

出力（docs/proto/）：
- sheet-v2.png：全素材の一覧と、スマホでの実寸の兵士
- field-v2-defense.png：防衛戦（横向き）を iPhone 390px幅・画素密度3の実寸で、今の絵・第1試作・新しい絵と比較
- field-v2-siege.png：攻城戦（縦向き）の実寸
- ground-tone-v2.png：背景の彩度・コントラストの調整前後（兵士を置いて比較）
"""
from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_proto_art import OUT_DOC  # noqa: E402
from make_preview import BG, INK, HEAD, label, panel, place, road_dist, scene_defense  # noqa: E402
from make_proto_set_v2 import (  # noqa: E402
    KINDS, NAMES, POSES, POSE_NAMES, GRASS, GRASS_V2, soldier_v2, tower_v2, castle_set_v2, tree_set_v2,
    rock_v2, fence_v2, lantern_v2, bridge_v2, paint_ground, shadow,
)

PHONE = 1170 / 480  # 防衛戦：1ドット＝約2.44画素（390px幅・画素密度3）
TOWER_NAMES = {"arrow": "弓の塔", "cannon": "大砲の塔", "gun": "鉄砲の塔", "ice": "水攻めの塔"}


def river_x(y):
    return 335 + 6 * math.sin(y / 24)


def ground(pal=None, seed=5):
    g = paint_ground(480, 300, road_dist=road_dist, river_x=river_x, seed=seed, pal=pal, flowers=700)
    br = bridge_v2(30, 24).image()
    g.alpha_composite(br, (int(river_x(150)) - br.width // 2, 150 - br.height // 2))
    return g


DECOR = [("round", 30, 60), ("pine", 70, 40), ("sakura", 150, 42), ("round", 300, 52), ("pine", 390, 70), ("bamboo", 470, 66),
         ("round", 40, 272), ("pine", 120, 292), ("sakura", 300, 272), ("round", 380, 288), ("bamboo", 462, 290),
         ("rock", 200, 140), ("rock", 262, 292), ("bush", 172, 160), ("bush", 20, 200), ("bush", 420, 230),
         ("lantern", 250, 150), ("fence", 196, 236), ("bush", 96, 248)]


def decor_sprite(k, i):
    return {"rock": rock_v2, "fence": fence_v2, "lantern": lantern_v2}[k]() if k in ("rock", "fence", "lantern") else tree_set_v2(k, i)


def scene_defense_v2(pal=None, units=True):
    g = ground(pal)
    things = []
    for i, (k, x, y) in enumerate(DECOR):
        if road_dist(x, y - 4) > 18 and abs(x - river_x(y)) > 16:
            things.append((y, decor_sprite(k, i), x, y, k not in ("fence", "lantern")))
    for t, x, y in (("arrow", 165, 128), ("cannon", 300, 118), ("gun", 368, 248), ("ice", 230, 266)):
        things.append((y, tower_v2(t), x, y, True))
    things.append((168, castle_set_v2(2), 418, 168, False))
    if units:
        squads = [((150, 82), ["spearman", "ashigaru", "archer"]), ((150, 220), ["cavalry", "spearman"]), ((300, 150), ["gunner", "archer", "medic"])]
        for (cx, cy), kinds in squads:
            n = 0
            for row in range(2):
                for col in range(3):
                    k = kinds[n % len(kinds)]
                    n += 1
                    things.append((cy + row * 5 + 6, soldier_v2(k, "ally", "attack" if col == 2 else "idle", n % 2), cx - col * 10 + row * 3, cy + row * 5 + 6, False))
        for i, (x, y) in enumerate(((20, 152), (34, 146), (48, 154), (62, 148), (100, 120), (112, 112), (98, 186), (110, 196), (128, 92), (128, 210))):
            k = ["ashigaru", "spearman", "archer", "gunner"][i % 4]
            things.append((y, soldier_v2(k, "enemy", "walk", i % 2), x, y, False))
    things.sort(key=lambda t: t[0])
    for _, sp, x, y, sh in things:
        if sh:
            shadow(g, x, y, sp.w * 0.42, 3)
        place(g, sp, x, y)
    return g


def scene_siege_v2():
    """攻城戦の縦向き：地面は入れ替え、兵士・塔・城は立てたまま"""
    g = ground().transpose(Image.TRANSPOSE)
    things = []
    for i, (k, x, y) in enumerate(DECOR):
        if road_dist(x, y - 4) > 18 and abs(x - river_x(y)) > 16:
            things.append((x, decor_sprite(k, i), y, x, k not in ("fence", "lantern")))
    for t, x, y in (("arrow", 165, 128), ("gun", 360, 245), ("cannon", 300, 118)):
        things.append((x, tower_v2(t, "enemy"), y, x, True))
    things.append((460, castle_set_v2(1, "enemy"), 150, 470, False))
    for cx, cy in ((90, 150), (230, 82), (230, 220)):
        for i in range(6):
            k = KINDS[i]
            things.append((cx + (i // 3) * 9, soldier_v2(k, "ally", "walk", i % 2), cy - 10 + (i % 3) * 10, cx + (i // 3) * 9, False))
    for i, (x, y) in enumerate(((300, 150), (310, 140), (310, 160), (390, 150), (398, 142))):
        things.append((x, soldier_v2(["spearman", "archer", "ashigaru", "gunner", "spearman"][i], "enemy", "idle", i % 2), y, x, False))
    things.sort(key=lambda t: t[0])
    for _, sp, x, y, sh in things:
        if sh:
            shadow(g, x, y, sp.w * 0.42, 3)
        place(g, sp, x, y)
    return g


def make_sheet():
    W, H = 1900, 2030
    im = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(im)
    label(d, (40, 24), "ドット絵 素材一覧（第2試作の画風で統一）", 40)
    label(d, (40, 80), "ゲームにはまだ組み込んでいません。左上からの光・4〜5段の色・となりの色を暗くした輪郭線で統一。", 22)
    # 兵士（4倍）
    panel(im, d, (30, 120, W - 30, 1000), "兵士6種 × 味方（藍）/ 敵（赤）× 5コマ（4倍）")
    for i, n in enumerate(POSE_NAMES):
        for half in (0, 1):
            label(d, (190 + half * 860 + i * 136 + 50, 170), n, 18, INK, "ma")
    label(d, (190 + 300, 196), "味方", 22, (40, 80, 160), "ma")
    label(d, (190 + 860 + 300, 196), "敵", 22, (170, 50, 40), "ma")
    for r, k in enumerate(KINDS):
        y = 230 + r * 128
        label(d, (60, y + 40), NAMES[k], 26)
        for half, team in enumerate(("ally", "enemy")):
            for i, (pose, f) in enumerate(POSES):
                sp = soldier_v2(k, team, pose, f).image(4)
                im.alpha_composite(sp, (190 + half * 860 + i * 136 + 50 - sp.width // 2, y + 112 - sp.height))
    # 塔（3倍）
    panel(im, d, (30, 1020, W - 30, 1300), "塔4種（味方の旗 / 攻城戦の敵の旗、3倍）")
    x = 60
    for k in ("arrow", "cannon", "gun", "ice"):
        for team in ("ally", "enemy"):
            sp = tower_v2(k, team).image(3)
            im.alpha_composite(sp, (x, 1070))
            x += sp.width + 12
        label(d, (x - 12 - 135, 1250), TOWER_NAMES[k], 22, INK, "ma")
        x += 40
    # 城（3倍）
    panel(im, d, (30, 1320, 1100, 1720), "城：通常 / 強化（3倍）")
    sp = castle_set_v2(1).image(3)
    im.alpha_composite(sp, (60, 1700 - sp.height))
    sp2 = castle_set_v2(2).image(3)
    im.alpha_composite(sp2, (60 + sp.width + 40, 1700 - sp2.height))
    label(d, (60 + sp.width + 40 + sp2.width // 2, 1376), "強化：4層・隅櫓・軒先の金", 20, INK, "ma")
    # 背景素材（3倍）
    panel(im, d, (1120, 1320, W - 30, 1720), "背景（3倍）")
    x, y = 1150, 1370
    for sp in [tree_set_v2(k, 2) for k in ("round", "pine", "sakura", "bamboo")]:
        t = sp.image(3)
        im.alpha_composite(t, (x, y + 110 - t.height))
        x += t.width + 10
    x = 1150
    for sp in (tree_set_v2("bush", 2), rock_v2(), lantern_v2(), fence_v2(), bridge_v2()):
        t = sp.image(3)
        im.alpha_composite(t, (x, 1600 - t.height))
        x += t.width + 12
    tiles = [paint_ground(48, 32, seed=3), paint_ground(48, 32, road_dist=lambda x, y: abs(y - 16), seed=6),
             paint_ground(48, 32, river_x=lambda y: 24 + 3 * math.sin(y / 8), seed=4)]
    for i, t in enumerate(tiles):
        im.alpha_composite(t.resize((144, 96), Image.NEAREST), (1150 + i * 156, 1610))
    # スマホでの実寸
    panel(im, d, (30, 1740, W - 30, H - 20), "スマホでの実際の大きさ（防衛戦・390px幅・画素密度3。1ドット＝約2.44画素）")
    x = 60
    for team in ("ally", "enemy"):
        for k in KINDS:
            sp = soldier_v2(k, team, "idle", 0).image()
            sp = sp.resize((int(sp.width * PHONE), int(sp.height * PHONE)), Image.NEAREST)
            im.alpha_composite(sp, (x, 1880 - sp.height))
            label(d, (x + sp.width // 2, 1890), NAMES[k], 18, INK, "ma")
            x += sp.width + 22
        x += 40
    label(d, (60, 1940), "かぶりもの（鉄色の陣笠・赤い兜・茶の陣笠・黒い陣笠・白い頭巾・馬）と武器（刀・槍・弓・鉄砲・杖）で兵種を見分ける。", 20)
    label(d, (60, 1972), "兵士は細部を増やさず、武器は明るい鋼色・黒など背景と反対の色にした。縦向きの攻城戦では約1.2倍大きく表示される。", 20)
    path = os.path.join(OUT_DOC, "sheet-v2.png")
    im.convert("RGB").save(path)
    return path


def make_fields(current=None):
    out = []
    S = (1170, 731)
    v1 = scene_defense().resize(S, Image.NEAREST)
    v3 = scene_defense_v2().resize(S, Image.NEAREST)
    cols = [("今の絵", Image.open(current).convert("RGBA").resize(S))] if current else []
    cols += [("第1試作", v1), ("新しい絵（第2試作の画風で全素材）", v3)]
    im = Image.new("RGBA", (40 + len(cols) * (1170 + 40), 731 + 130), BG)
    d = ImageDraw.Draw(im)
    label(d, (20, 16), "防衛戦（横向き）　iPhone 390px幅・画素密度3の実寸（1170×731ドット）", 30, HEAD)
    for i, (name, sc) in enumerate(cols):
        x = 20 + i * (1170 + 40)
        im.alpha_composite(sc, (x, 70))
        label(d, (x + 585, 70 + 731 + 12), name, 28, HEAD, "ma")
    path = os.path.join(OUT_DOC, "field-v2-defense.png")
    im.convert("RGB").save(path)
    out.append(path)
    im = Image.new("RGBA", (879 + 40, 1407 + 120), BG)
    d = ImageDraw.Draw(im)
    label(d, (20, 16), "攻城戦（縦向き）の実寸　879×1407ドット", 30, HEAD)
    im.alpha_composite(scene_siege_v2().resize((879, 1407), Image.NEAREST), (20, 70))
    path = os.path.join(OUT_DOC, "field-v2-siege.png")
    im.convert("RGB").save(path)
    out.append(path)
    return out


def make_tone():
    """背景の彩度・コントラストの調整前後。同じ場所を実寸で切り出す"""
    box = (60, 40, 300, 200)
    a = scene_defense_v2(GRASS_V2).crop(box)
    b = scene_defense_v2(GRASS).crop(box)
    w, h = int((box[2] - box[0]) * PHONE), int((box[3] - box[1]) * PHONE)
    im = Image.new("RGBA", (w * 2 + 100, h + 140), BG)
    d = ImageDraw.Draw(im)
    label(d, (30, 18), "背景の調整：兵士より目立たないよう、草原の彩度とコントラストを抑えた（実寸の一部）", 28, HEAD)
    im.alpha_composite(a.resize((w, h), Image.NEAREST), (30, 70))
    im.alpha_composite(b.resize((w, h), Image.NEAREST), (w + 70, 70))
    label(d, (30 + w // 2, h + 82), "調整前（第2試作の草原）", 26, HEAD, "ma")
    label(d, (w + 70 + w // 2, h + 82), "調整後（今回）", 26, HEAD, "ma")
    path = os.path.join(OUT_DOC, "ground-tone-v2.png")
    im.convert("RGB").save(path)
    return path


if __name__ == "__main__":
    print(make_sheet())
    for p in make_fields(sys.argv[1] if len(sys.argv) > 1 else None):
        print(p)
    print(make_tone())
