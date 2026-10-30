#!/usr/bin/env python3
"""第1試作と第2試作の比較画像（docs/proto/compare-v2.png）。ゲームには組み込まない。

  python3 tools/proto/make_compare_v2.py
"""
from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_proto_art import OUT_DOC, unit, tower, castle, tile, tree  # noqa: E402
from make_proto_art_v2 import spearman_v2, arrow_tower_v2, castle_v2, ground_v2, tree_v2  # noqa: E402
from make_preview import BG, INK, label, panel, place  # noqa: E402

W, H = 192, 120  # 見本の戦場（同じ構図で第1・第2を並べる）


def road_y(x):
    return 64 + 16 * math.sin(x / 34)


def ground_v1():
    g = Image.new("RGBA", (W, H))
    for ty in range(0, H, 16):
        for tx in range(0, W, 16):
            g.alpha_composite(tile("grass", tx * 7 + ty * 13).image(), (tx, ty))
    rp = tile("road", 5).image().load()
    gp = g.load()
    for y in range(H):
        for x in range(W):
            d = abs(y - road_y(x))
            if d < 11:
                gp[x, y] = rp[x % 16, y % 16]
            elif d < 12.5:
                gp[x, y] = (176, 140, 92, 255)
    for k, x, b in (("round", 18, 40), ("pine", 46, 32), ("round", 176, 42), ("round", 30, 112), ("pine", 132, 112)):
        place(g, tree(k), x, b)
    return g


def scene(v2):
    g = ground_v2() if v2 else ground_v1()
    things = [(56, (arrow_tower_v2() if v2 else tower("arrow")), 104, 56)]
    for i, (x, y) in enumerate(((60, 62), (70, 66), (64, 72))):
        things.append((y, spearman_v2("ally", "attack" if i == 0 else "idle") if v2 else unit("spearman", "ally", "attack" if i == 0 else "idle"), x, y))
    for i, (x, y) in enumerate(((36, 50), (24, 56), (30, 64))):
        things.append((y, spearman_v2("enemy", "idle") if v2 else unit("spearman", "enemy", "walk", i % 2), x, y))
    things.sort(key=lambda t: t[0])
    for _, sp, x, y in things:
        place(g, sp, x, y)
    return g


def make():
    CW, CH = 1800, 2600
    im = Image.new("RGBA", (CW, CH), BG)
    d = ImageDraw.Draw(im)
    label(d, (40, 26), "ドット絵 第2試作の比較（左：第1試作　右：第2試作）", 40)
    label(d, (40, 82), "描き込みと立体感を増やした4点：槍兵・弓の塔・城・草原。ゲームにはまだ組み込んでいません。", 24)

    def pair(y, _h, title, left, right, note):
        h = 96 + max(left.height, right.height) + 56
        panel(im, d, (30, y, CW - 30, y + h), title)
        label(d, (60, y + 56), "第1試作", 26, (120, 90, 60))
        label(d, (CW // 2 + 20, y + 56), "第2試作", 26, (30, 90, 160))
        d.line((CW // 2, y + 56, CW // 2, y + h - 40), fill=(200, 176, 140), width=3)
        im.alpha_composite(left, (60, y + 96))
        im.alpha_composite(right, (CW // 2 + 20, y + 96))
        label(d, (60, y + h - 38), note, 20)
        return y + h + 20

    def row(sprites, scale, gap=24):
        imgs = [s.image(scale) for s in sprites]
        w = sum(i.width for i in imgs) + gap * (len(imgs) - 1)
        out = Image.new("RGBA", (w, max(i.height for i in imgs)), (0, 0, 0, 0))
        x = 0
        for i in imgs:
            out.alpha_composite(i, (x, out.height - i.height))
            x += i.width + gap
        return out

    # 兵士（6倍）
    v1 = row([unit("spearman", "ally", "idle"), unit("spearman", "ally", "attack"), unit("spearman", "enemy", "idle"), unit("spearman", "enemy", "attack")], 6)
    v2 = row([spearman_v2("ally", "idle"), spearman_v2("ally", "attack"), spearman_v2("enemy", "idle"), spearman_v2("enemy", "attack")], 6)
    y = pair(130, 0, "1. 兵士：槍兵（味方・敵 × 待機・攻撃、6倍）", v1, v2,
         "兜のしころ・吹返し・金の前立て、胴の板と縅の糸、袖、草摺、すね当て、槍の房と穂先の光。大きさは 20×24 → 22×26。")
    # 塔（5倍）
    v1 = row([tower("arrow", "ally"), tower("arrow", "enemy")], 5)
    v2 = row([arrow_tower_v2("ally"), arrow_tower_v2("enemy")], 5, 12)
    y = pair(y, 0, "2. 塔：弓の塔（味方・敵、5倍）", v1, v2, "瓦の段と反った軒・鬼瓦、柱の木目と筋かい、縄の結び目、家紋の幕、のぼり旗、ひとつずつ陰影のある石垣と苔。")
    # 城（4倍）
    y = pair(y, 0, "3. 城：通常（4倍）", castle(1).image(4), castle_v2().image(4),
         "三層の天守：瓦の段・千鳥破風・軒の反り・金のしゃちほこ、白壁と黒い下見板、格子窓、裾の広がる石垣（右は日陰）、門、のぼり旗。")
    # 背景（3倍）と、スマホでの実寸に近い大きさの見本
    s1, s2 = scene(False), scene(True)
    y = pair(y, 0, "4. 背景：草原と道と木（兵士・塔を置いた見本、3倍）", s1.resize((W * 3, H * 3), Image.NEAREST), s2.resize((W * 3, H * 3), Image.NEAREST),
         "草原の色むら・草の房・花（白黄桃紫）・小石、木の影。木は広葉樹・松・桜・茂みの4種で、左上からの光で立体的に。")
    # スマホの実寸（1ドット≒2.4画素なので約2倍で比較）
    panel(im, d, (30, y, CW - 30, y + 320), "スマホでの実際の大きさに近い表示（2倍）")
    im.alpha_composite(s1.resize((W * 2, H * 2), Image.NEAREST), (60, y + 60))
    im.alpha_composite(s2.resize((W * 2, H * 2), Image.NEAREST), (CW // 2 + 20, y + 60))
    out = os.path.join(OUT_DOC, "compare-v2.png")
    im.crop((0, 0, CW, y + 340)).convert("RGB").save(out)
    print(out)


if __name__ == "__main__":
    make()
