#!/usr/bin/env python3
"""新ドット絵（v105試作）の素材を、ゲームに埋め込む1枚の画像（アトラス）と地面の画像にまとめる。

  python3 tools/pixel/make_pixel_atlas.py

出力（assets/pixel/）：
- atlas.png：兵士6種×味方/敵×5コマ（武器の改良版）、塔4種×味方/敵、城（通常・強化）×味方/敵、木・岩・灯籠・柵
- atlas.json：コマの位置と足元の基準点 {名前: [x, y, 幅, 高さ, 基準x, 基準y]}
- ground.png：防衛戦の地面（ゲームの道の形・ゲームの座標の半分の 480×300）

絵は tools/proto（第2試作・武器の改良版）の関数で描く。ゲームの処理・保存データは変えない。
"""
from __future__ import annotations

import json
import math
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools", "proto"))
from make_proto_set_v2 import (  # noqa: E402
    KINDS, POSES, soldier_v2, tower_v2, castle_set_v2, tree_set_v2, rock_v2, fence_v2, lantern_v2, paint_ground,
)
from make_weapons_v2 import soldier_w  # noqa: E402

OUT = os.path.join(ROOT, "assets", "pixel")

# ゲームの道（index.template.html の upper / lower と同じ）
UPPER = [(0, 300), (140, 300), (235, 165), (450, 165), (560, 300), (760, 300), (960, 300)]
LOWER = [(0, 300), (140, 300), (235, 440), (450, 440), (560, 300), (760, 300), (960, 300)]


def seg_dist(px, py, a, b):
    (ax, ay), (bx, by) = a, b
    vx, vy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy or 1)))
    return math.hypot(px - (ax + vx * t), py - (ay + vy * t))


def road_dist(x, y):
    """半分の座標での道の中心からの距離（ゲームの道の幅に合わせて縮める）"""
    d = min(seg_dist(x * 2 + 1, y * 2 + 1, a, b) for path in (UPPER, LOWER) for a, b in zip(path, path[1:]))
    return d / 2 * 12 / 17  # paint_ground は 12 未満を道にする → ゲームの砂の幅（半径 約34）に合わせる


def bbox_bottom(sp):
    for y in range(sp.h - 1, -1, -1):
        if any(sp.px[y][x] is not None for x in range(sp.w)):
            return y + 1
    return sp.h


def frames():
    out = {}
    for kind in KINDS:
        for team in ("ally", "enemy"):
            for pose, f in POSES:
                sp = soldier_w(kind, team, pose, f)
                body = soldier_v2(kind, team, pose, f, bare=True)
                # 体は (2, 6) にずらして置いてある：体の中心と足の下端を基準にする
                out[f"{kind}_{team}_{pose}{f}"] = (sp, 2 + body.w // 2, 6 + bbox_bottom(body))
    for kind in ("arrow", "cannon", "gun", "ice"):
        for team in ("ally", "enemy"):
            sp = tower_v2(kind, team)
            out[f"tower_{kind}_{team}"] = (sp, sp.w // 2, bbox_bottom(sp))
    for lv in (1, 2):
        for team in ("ally", "enemy"):
            sp = castle_set_v2(lv, team)
            out[f"castle{lv}_{team}"] = (sp, sp.w // 2, bbox_bottom(sp))
    for i, k in enumerate(("round", "pine", "sakura", "bush", "bamboo")):
        for v in range(2):
            sp = tree_set_v2(k, 2 + v * 5 + i)
            out[f"tree_{k}{v}"] = (sp, sp.w // 2, bbox_bottom(sp))
    for name, sp in (("rock", rock_v2()), ("lantern", lantern_v2()), ("fence", fence_v2())):
        out[name] = (sp, sp.w // 2, bbox_bottom(sp))
    return out


def pack(items, width=512):
    """高さの順に棚へ並べる（1ドットの隙間）"""
    x = y = shelf = 0
    pos = {}
    for name, (sp, ax, ay) in sorted(items.items(), key=lambda kv: -kv[1][0].h):
        if x + sp.w > width:
            x, y, shelf = 0, y + shelf + 1, 0
        pos[name] = (x, y)
        x += sp.w + 1
        shelf = max(shelf, sp.h)
    return pos, y + shelf


def main():
    os.makedirs(OUT, exist_ok=True)
    items = frames()
    pos, h = pack(items)
    atlas = Image.new("RGBA", (512, h), (0, 0, 0, 0))
    meta = {}
    for name, (sp, ax, ay) in items.items():
        x, y = pos[name]
        atlas.alpha_composite(sp.image(), (x, y))
        meta[name] = [x, y, sp.w, sp.h, ax, ay]
    atlas.save(os.path.join(OUT, "atlas.png"), optimize=True)
    with open(os.path.join(OUT, "atlas.json"), "w") as f:
        json.dump({"frames": dict(sorted(meta.items()))}, f, separators=(",", ":"))
    paint_ground(480, 300, road_dist=road_dist, seed=5, flowers=700).save(os.path.join(OUT, "ground.png"), optimize=True)
    print(len(meta), "frames", atlas.size)


if __name__ == "__main__":
    main()
