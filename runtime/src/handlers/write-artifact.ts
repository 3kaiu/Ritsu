import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { ARTIFACT_VALID_TYPES, ARTIFACT_PREFIX_MAP } from "../shared.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";

const RITSU_DIR = ".ritsu";

export async function ritsu_write_artifact(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const type = String(params.type ?? "");
  const filename = String(params.filename ?? "");
  const content = String(params.content ?? "");
  const htmlContent = params.html_content ? String(params.html_content) : null;
  const artifactMeta = params.artifact_meta as
    | Record<string, unknown>
    | undefined;

  if (!type || !filename || !content)
    return errorResult("type, filename, content are required");

  // 占位符拦截 — ctx 类型豁免，AGENTS.md (handoff) 也豁免 init 阶段
  const placeholderPattern = /TODO|待定|暂不处理|后续完善|TBD/;
  if (placeholderPattern.test(content) && type !== "ctx") {
    return errorResult(
      "content contains placeholder (TODO/待定/暂不处理/后续完善/TBD), write rejected",
    );
  }

  // 产物类型校验
  if (!ARTIFACT_VALID_TYPES.includes(type as any)) {
    return errorResult(
      `invalid artifact type: ${type}. Valid: ${ARTIFACT_VALID_TYPES.join(", ")}`,
    );
  }

  // 文件名前缀校验（按 artifact-schema.yaml 命名契约）
  const expectedPrefix = ARTIFACT_PREFIX_MAP[type];
  if (expectedPrefix && !filename.startsWith(expectedPrefix)) {
    return errorResult(
      `filename must start with '${expectedPrefix}' for type '${type}', got: ${filename}`,
    );
  }

  // 路径穿越防护
  if (
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    return errorResult(
      "filename must not contain path traversal (..) or directory separators",
    );
  }

  const root = getProjectRoot();
  const dir = resolve(root, RITSU_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const mdPath = resolve(dir, filename);

  // 覆盖保护 — 已存在文件需确认
  if (existsSync(mdPath)) {
    const overwrite = params.overwrite === true || params.overwrite === "true";
    if (!overwrite) {
      return errorResult(
        `file already exists: ${filename}. Set overwrite=true to replace.`,
      );
    }
  }

  writeFileSync(mdPath, content, "utf-8");
  const sizeBytes = statSync(mdPath).size;

  let htmlPath: string | null = null;
  if (htmlContent && (type === "diagnosis" || type === "review-stamp")) {
    const htmlFilename = filename.replace(/\.(md|jsonl)$/, ".html");
    htmlPath = resolve(dir, htmlFilename);
    writeFileSync(htmlPath, htmlContent, "utf-8");
  }

  return textResult(
    JSON.stringify({
      path: mdPath,
      html_path: htmlPath,
      size_bytes: sizeBytes,
      artifact_meta: artifactMeta ?? null,
    }),
  );
}
