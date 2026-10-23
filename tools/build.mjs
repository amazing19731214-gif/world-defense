#!/usr/bin/env node
// 配布用の単一 index.html を生成する。
//   node tools/build.mjs          … src/index.template.html + assets/ から index.html を書き出す
//   node tools/build.mjs --check  … index.html が最新か確認する（差分があれば終了コード1）
// 画像の参照先は assets/manifest.json の一か所で管理する。
// ファイルが存在しない画像は埋め込まれず、ゲーム内では仮アイコン（ベクター描画）になる。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(root, "assets");
const manifest = JSON.parse(fs.readFileSync(path.join(assetsDir, "manifest.json"), "utf8"));
const MIME = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const MAX_IMAGE_BYTES = 600 * 1024;
const warnings = [];

function dataUri(rel, label) {
  const file = path.join(assetsDir, rel);
  if (!fs.existsSync(file)) return null;
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime)
    throw new Error(`${label}: 対応していない形式です (${rel})。png / webp / jpg を使ってください。`);
  const buf = fs.readFileSync(file);
  if (buf.length > MAX_IMAGE_BYTES)
    warnings.push(`${label}: ${Math.round(buf.length / 1024)}KB と大きめです (${rel})`);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

const sprites = {};
for (const [name, rel] of Object.entries(manifest.sprites)) {
  const uri = dataUri(rel, `sprite ${name}`);
  if (uri) sprites[name] = uri;
  else warnings.push(`sprite ${name}: ${rel} が見つかりません（ベクター描画で代用）`);
}

const heroAssets = {};
const missingHero = [];
for (const [id, slots] of Object.entries(manifest.heroes)) {
  heroAssets[id] = {};
  for (const [slot, rel] of Object.entries(slots)) {
    const uri = dataUri(rel, `hero ${id}.${slot}`);
    if (uri) heroAssets[id][slot] = uri;
    else missingHero.push(`${id}.${slot}`);
  }
}

let html = fs.readFileSync(path.join(root, "src", "index.template.html"), "utf8");
for (const [marker, value] of [
  ["/*@@EMBEDDED_SPRITES@@*/ {}", sprites],
  ["/*@@HERO_ASSETS@@*/ {}", heroAssets],
]) {
  if (!html.includes(marker)) throw new Error(`テンプレートに ${marker} がありません`);
  html = html.replace(marker, () => JSON.stringify(value));
}
if (/sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|api[_-]?key\s*[:=]/i.test(html.replace(/data:[^"]+/g, ""))) {
  throw new Error("秘密情報らしき文字列が含まれています。HTMLに埋め込まないでください。");
}

const out = path.join(root, "index.html");
if (process.argv.includes("--check")) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (current !== html) {
    console.error("index.html が最新ではありません。node tools/build.mjs を実行してください。");
    process.exit(1);
  }
  console.log("index.html は最新です。");
} else {
  fs.writeFileSync(out, html);
  console.log(`index.html を生成しました (${Math.round(html.length / 1024)}KB)`);
}
for (const w of warnings) console.warn("注意: " + w);
if (missingHero.length) console.log(`仮アイコンで表示中の武将画像: ${missingHero.join(", ")}`);
