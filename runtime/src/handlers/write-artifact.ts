import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { load as loadYaml } from "js-yaml";
import {
  ARTIFACT_LAYER_MAP,
  ARTIFACT_VALID_TYPES,
  ARTIFACT_PREFIX_MAP,
  getSharedDir,
} from "../shared.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";

const RITSU_DIR = ".ritsu";
const ARTIFACT_SCHEMA_KEY_MAP: Record<string, string> = {
  "intake-ticket": "intake_ticket",
  "delivery-plan": "delivery_plan",
  "delivery-report": "delivery_report",
  "assurance-report": "assurance_report",
  "release-advice": "release_advice",
  handoff: "handoff",
  diagnosis: "diagnosis",
  "review-stamp": "review_stamp",
  "optimize-report": "optimize_report",
};

type ArtifactSchemaSection = {
  title?: string;
  fields?: Array<{ label?: string }>;
  conditional_fields?: Array<{ fields?: Array<{ label?: string }> }>;
};

let cachedArtifactSchemas: Record<string, { required_sections?: ArtifactSchemaSection[] }> | null =
  null;

function getArtifactSchemas(): Record<
  string,
  { required_sections?: ArtifactSchemaSection[] }
> {
  if (cachedArtifactSchemas) return cachedArtifactSchemas;
  const schemaPath = resolve(getSharedDir(), "artifact-schema.yaml");
  if (!existsSync(schemaPath)) {
    cachedArtifactSchemas = {};
    return cachedArtifactSchemas;
  }

  try {
    const raw = readFileSync(schemaPath, "utf-8");
    const doc = loadYaml(raw) as {
      schemas?: Record<string, { required_sections?: ArtifactSchemaSection[] }>;
    };
    cachedArtifactSchemas = doc?.schemas ?? {};
  } catch {
    cachedArtifactSchemas = {};
  }

  return cachedArtifactSchemas;
}

function getSectionBody(content: string, title: string): string | null {
  const lines = content.split(/\r?\n/);
  const heading = `## ${title}`;
  const startIdx = lines.findIndex((line) => line.trim() === heading);
  if (startIdx === -1) return null;

  const buf: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) break;
    buf.push(lines[i]);
  }
  return buf.join("\n");
}

function validateArtifactContent(type: string, content: string): string | null {
  const schemaKey = ARTIFACT_SCHEMA_KEY_MAP[type];
  if (!schemaKey) return null;

  const schema = getArtifactSchemas()[schemaKey];
  const requiredSections = schema?.required_sections;
  if (!Array.isArray(requiredSections) || requiredSections.length === 0) {
    return null;
  }

  for (const section of requiredSections) {
    const title = typeof section?.title === "string" ? section.title.trim() : "";
    if (!title) continue;

    const body = getSectionBody(content, title);
    if (body === null) {
      return `artifact schema validation failed: missing required section '## ${title}'`;
    }

    const labels = [
      ...(Array.isArray(section.fields) ? section.fields : []),
      ...((Array.isArray(section.conditional_fields)
        ? section.conditional_fields.flatMap((group) =>
            Array.isArray(group.fields) ? group.fields : [],
          )
        : []) as Array<{ label?: string }>),
    ]
      .map((field) =>
        typeof field?.label === "string" ? field.label.trim() : "",
      )
      .filter(Boolean);

    for (const label of labels) {
      if (!body.includes(label)) {
        return `artifact schema validation failed: section '${title}' missing field label '${label}'`;
      }
    }
  }

  return null;
}

export async function ritsu_write_artifact(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const type = String(params.type ?? "");
  const filename = String(params.filename ?? "");
  const content = String(params.content ?? "");
  const artifactMeta = params.artifact_meta as
    | Record<string, unknown>
    | undefined;

  if (!type || !filename || !content)
    return errorResult("type, filename, content are required");

  // 占位符拦截 — runtime 当前只对 artifact 内容做最小约束
  const placeholderPattern = /TODO|待定|暂不处理|后续完善|TBD/;
  if (placeholderPattern.test(content)) {
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

  const validationError = validateArtifactContent(type, content);
  if (validationError) return errorResult(validationError);

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

  // 原子写入 — write-to-temp + rename，防止崩溃时产生撕裂文件
  const tmpPath = join(dir, `.tmp-${randomUUID()}`);
  try {
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, mdPath);
  } catch (e: any) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {}
    return errorResult(`atomic write failed: ${e.message}`);
  }
  const sizeBytes = statSync(mdPath).size;
  const normalizedArtifactMeta = {
    ...(artifactMeta ?? {}),
    type,
    layer: ARTIFACT_LAYER_MAP[type] ?? "system",
    size_bytes: sizeBytes,
  };

  return textResult(
    JSON.stringify({
      path: mdPath,
      size_bytes: sizeBytes,
      artifact_meta: normalizedArtifactMeta,
    }),
  );
}
