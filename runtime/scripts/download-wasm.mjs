/**
 * postinstall: 下载预编译 WASM 模块
 *
 * 如果本地已有 pkg/（开发者自行构建或 CI 产物），跳过下载。
 * 否则从 GitHub Release 下载对应版本的预编译 WASM。
 */

import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(__dirname, "../pkg");
const VERSION = "3.5.1";
const REPO = "3kaiu/Ritsu";
const ASSET_NAME = `ritsu-core-wasm-${VERSION}.tar.gz`;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    get(url, { headers: { "User-Agent": "ritsu-mcp-server" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", reject);
  });
}

async function main() {
  // 如果 pkg/ 已存在（本地构建或 CI），跳过
  if (existsSync(resolve(PKG_DIR, "ritsu_core.js"))) {
    console.log("[ritsu] WASM pkg already exists, skipping download");
    return;
  }

  // 如果没有 Rust 工具链，尝试从 GitHub Release 下载
  const releaseUrl = `https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET_NAME}`;
  const tarPath = resolve(PKG_DIR, "wasm.tar.gz");

  mkdirSync(PKG_DIR, { recursive: true });

  try {
    console.log(`[ritsu] Downloading pre-built WASM from ${releaseUrl}`);
    await download(releaseUrl, tarPath);

    const { execSync } = await import("node:child_process");
    execSync(`tar -xzf "${tarPath}" -C "${PKG_DIR}"`, { stdio: "inherit" });
    console.log("[ritsu] WASM module ready");
  } catch (e) {
    console.warn(`[ritsu] Pre-built WASM not available (${e.message})`);
    console.warn("[ritsu] Running in pure JS mode (ajv fallback). For WASM acceleration, install Rust toolchain and run: npm run build:wasm");
  }
}

main();
