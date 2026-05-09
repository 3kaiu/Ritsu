/**
 * postinstall: 下载预编译 WASM 模块
 *
 * 优先级：
 * 1. 本地已有 pkg/（开发者自行构建）→ 跳过
 * 2. 从 GitHub Release 下载对应版本 → 解压到 pkg/
 * 3. 下载失败 → 纯 JS 回退（ajv），打印提示
 */

import { createWriteStream, existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:https";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(__dirname, "../pkg");

let VERSION = "3.5.1";
try {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8"));
  VERSION = pkg.version ?? VERSION;
} catch {}

const REPO = "3kaiu/Ritsu";
const ASSET_NAME = "ritsu-core-wasm.tar.gz";

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    get(url, { headers: { "User-Agent": "ritsu-mcp-server" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", reject);
  });
}

async function main() {
  if (existsSync(resolve(PKG_DIR, "ritsu_core.js"))) {
    console.log("[ritsu] WASM pkg already exists, skipping download");
    return;
  }

  const releaseUrl = `https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET_NAME}`;
  const tarPath = resolve(PKG_DIR, ASSET_NAME);

  mkdirSync(PKG_DIR, { recursive: true });

  try {
    console.log(`[ritsu] Downloading pre-built WASM v${VERSION}...`);
    await download(releaseUrl, tarPath);
    execSync(`tar -xzf "${tarPath}" -C "${PKG_DIR}" --strip-components=1`, { stdio: "inherit" });
    rmSync(tarPath, { force: true });
    console.log("[ritsu] ✅ WASM module ready");
  } catch (e) {
    console.warn(`[ritsu] ⚠️  Pre-built WASM not available (${e.message})`);
    console.warn("[ritsu] Running in pure JS mode (ajv fallback).");
    console.warn("[ritsu] For WASM acceleration: install Rust toolchain + run `npm run build:wasm`");
  }
}

main();
