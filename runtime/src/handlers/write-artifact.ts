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
  ARTIFACT_VALID_TYPES,
  getCanonicalArtifactType,
  getSharedDir,
  getArtifactLayer,
  ARTIFACT_REGISTRY,
} from "../shared.js";
import {
  getProjectRoot,
  textResult,
  jsonErrorResult,
} from "./_utils.js";

const RITSU_DIR = ".ritsu";
const ARTIFACT_SCHEMA_KEY_MAP: Record<string, string> = {
  "design-sheet": "design_sheet",
  "design-brief": "design_brief",
  "dev-report": "delivery_report",
  "assurance-sheet": "assurance_sheet",
};

type ArtifactSchemaSection = {
  title?: string;
  fields?: Array<{ label?: string }>;
  conditional_fields?: Array<{ fields?: Array<{ label?: string }> }>;
};

export type ArtifactContentValidationIssueCode =
  | "artifact_schema_missing_section"
  | "artifact_schema_missing_field_label";

export type ArtifactContentValidationIssue = {
  code: ArtifactContentValidationIssueCode;
  message: string;
  path: string;
  artifact_type: string;
  section_title?: string;
  field_label?: string;
  actual?: string[];
};

export type ArtifactValidationViolation = {
  code: ArtifactContentValidationIssueCode;
  severity: "error";
  path: string;
  artifact_type: string;
  message: string;
  expected?: string[];
  actual?: string[];
};

export type ArtifactWriteViolationCode =
  | "missing_required_fields"
  | "placeholder_content"
  | "invalid_artifact_type"
  | "filename_prefix_mismatch"
  | "path_traversal"
  | "file_exists"
  | "atomic_write_failed";

export type ArtifactWriteViolation = {
  code: ArtifactWriteViolationCode;
  severity: "error";
  path: string;
  message: string;
  artifact_type?: string;
  expected?: string[];
  actual?: string[];
};

export const ARTIFACT_WRITE_ERROR_TYPE = "ArtifactWriteError";
export const ARTIFACT_VALIDATION_ERROR_TYPE = "ArtifactValidationError";

export type ArtifactErrorViolation =
  | ArtifactWriteViolation
  | ArtifactValidationViolation;

export type ArtifactErrorPayload = {
  error: {
    type: string;
    message: string;
    violations: ArtifactErrorViolation[];
  };
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

function listSectionTitles(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, "").trim())
    .filter(Boolean);
}

function listFieldLabels(sectionBody: string): string[] {
  const labels = sectionBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^-+\s*([^:]+):/);
      return match?.[1]?.trim() ?? "";
    })
    .filter(Boolean);
  return Array.from(new Set(labels));
}

function extractMarkerLabel(marker: string): string {
  const colonIdx = marker.indexOf(":");
  if (colonIdx === -1) return marker.trim();
  return marker.slice(0, colonIdx).trim();
}

export function collectArtifactMarkerActuals(
  content: string,
  marker: string,
): string[] {
  const label = extractMarkerLabel(marker);
  if (!label) return [];

  const matchedLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(`${label}:`))
    .filter(Boolean);

  return Array.from(new Set(matchedLines));
}

export function validateArtifactContentDetailed(
  type: string,
  content: string,
): ArtifactContentValidationIssue | null {
  return collectArtifactContentIssuesDetailed(type, content)[0] ?? null;
}

export function collectArtifactContentIssuesDetailed(
  type: string,
  content: string,
): ArtifactContentValidationIssue[] {
  const schemaKey = ARTIFACT_SCHEMA_KEY_MAP[type];
  if (!schemaKey) return [];

  const schema = getArtifactSchemas()[schemaKey];
  const requiredSections = schema?.required_sections;
  if (!Array.isArray(requiredSections) || requiredSections.length === 0) {
    return [];
  }

  const issues: ArtifactContentValidationIssue[] = [];

  for (const section of requiredSections) {
    const title = typeof section?.title === "string" ? section.title.trim() : "";
    if (!title) continue;

    const body = getSectionBody(content, title);
    if (body === null) {
      issues.push({
        code: "artifact_schema_missing_section",
        artifact_type: type,
        section_title: title,
        path: `artifact.sections.${title}`,
        message: `artifact schema validation failed: missing required section '## ${title}'`,
        actual: listSectionTitles(content),
      });
      continue;
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
        issues.push({
          code: "artifact_schema_missing_field_label",
          artifact_type: type,
          section_title: title,
          field_label: label,
          path: `artifact.sections.${title}.fields.${label}`,
          message: `artifact schema validation failed: section '${title}' missing field label '${label}'`,
          actual: listFieldLabels(body),
        });
      }
    }
  }

  return issues;
}

export function buildArtifactValidationViolation(
  issue: ArtifactContentValidationIssue,
): ArtifactValidationViolation {
  return {
    code: issue.code,
    severity: "error",
    path: issue.path,
    artifact_type: issue.artifact_type,
    message: issue.message,
    expected:
      issue.code === "artifact_schema_missing_section"
        ? issue.section_title
          ? [`## ${issue.section_title}`]
          : undefined
        : issue.field_label
          ? [issue.field_label]
          : undefined,
    actual: issue.actual ?? [],
  };
}

export function buildArtifactValidationViolations(
  issues: ArtifactContentValidationIssue[],
): ArtifactValidationViolation[] {
  return issues.map(buildArtifactValidationViolation);
}

export function joinArtifactViolationMessages(
  violations: Array<{ message: string }>,
): string {
  return violations
    .map((violation) => violation.message)
    .filter(Boolean)
    .join("; ");
}

export function buildArtifactErrorPayload(
  type: string,
  violations: ArtifactErrorViolation[],
  fallbackMessage: string,
): ArtifactErrorPayload {
  return {
    error: {
      type,
      message: joinArtifactViolationMessages(violations) || fallbackMessage,
      violations,
    },
  };
}

function artifactWriteErrorResult(
  fallbackMessage: string,
  violations: ArtifactWriteViolation[],
): CallToolResult {
  return jsonErrorResult(
    buildArtifactErrorPayload(
      ARTIFACT_WRITE_ERROR_TYPE,
      violations,
      fallbackMessage,
    ),
  );
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

  if (!type || !filename || !content) {
    return artifactWriteErrorResult("type, filename, content are required", [
      {
        code: "missing_required_fields",
        severity: "error",
        path: "params",
        message: "type, filename, content are required",
        expected: ["type", "filename", "content"],
        actual: [
          ...(!type ? [] : ["type"]),
          ...(!filename ? [] : ["filename"]),
          ...(!content ? [] : ["content"]),
        ],
      },
    ]);
  }

  // 占位符拦截 — runtime 当前只对 artifact 内容做最小约束
  const placeholderPattern = /\bTODO\b|待定|暂不处理|后续完善|\bTBD\b/;
  if (placeholderPattern.test(content)) {
    return artifactWriteErrorResult(
      "content contains placeholder (TODO/待定/暂不处理/后续完善/TBD), write rejected",
      [
        {
          code: "placeholder_content",
          severity: "error",
          path: "content",
          message:
            "content contains placeholder (TODO/待定/暂不处理/后续完善/TBD), write rejected",
          artifact_type: type,
          expected: ["content without placeholder markers"],
          actual: ["placeholder detected"],
        },
      ],
    );
  }

  // 产物类型校验
  if (!ARTIFACT_VALID_TYPES.includes(type as any)) {
    return artifactWriteErrorResult(
      `invalid artifact type: ${type}. Valid: ${ARTIFACT_VALID_TYPES.join(", ")}`,
      [
        {
          code: "invalid_artifact_type",
          severity: "error",
          path: "type",
          message: `invalid artifact type: ${type}. Valid: ${ARTIFACT_VALID_TYPES.join(", ")}`,
          artifact_type: type,
          expected: [...ARTIFACT_VALID_TYPES],
          actual: [type],
        },
      ],
    );
  }

  // 文件名前缀校验（按 artifact-schema.yaml 命名契约）
  const expectedPrefix = ARTIFACT_REGISTRY.find(a => a.type === getCanonicalArtifactType(type))?.prefix;
  if (expectedPrefix && !filename.startsWith(expectedPrefix)) {
    return artifactWriteErrorResult(
      `filename must start with '${expectedPrefix}' for type '${type}', got: ${filename}`,
      [
        {
          code: "filename_prefix_mismatch",
          severity: "error",
          path: "filename",
          message: `filename must start with '${expectedPrefix}' for type '${type}', got: ${filename}`,
          artifact_type: type,
          expected: [expectedPrefix],
          actual: [filename],
        },
      ],
    );
  }

  // 路径穿越防护
  if (
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    return artifactWriteErrorResult(
      "filename must not contain path traversal (..) or directory separators",
      [
        {
          code: "path_traversal",
          severity: "error",
          path: "filename",
          message:
            "filename must not contain path traversal (..) or directory separators",
          artifact_type: type,
          expected: ["single basename without path separators"],
          actual: [filename],
        },
      ],
    );
  }

  const validationIssues = collectArtifactContentIssuesDetailed(type, content);
  if (validationIssues.length > 0) {
    const violations = buildArtifactValidationViolations(validationIssues);
    return jsonErrorResult(
      buildArtifactErrorPayload(
        ARTIFACT_VALIDATION_ERROR_TYPE,
        violations,
        "artifact schema validation failed",
      ),
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
      return artifactWriteErrorResult(
        `file already exists: ${filename}. Set overwrite=true to replace.`,
        [
          {
            code: "file_exists",
            severity: "error",
            path: "filename",
            message: `file already exists: ${filename}. Set overwrite=true to replace.`,
            artifact_type: type,
            expected: ["overwrite=true", "new filename"],
            actual: [filename],
          },
        ],
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
    } catch {
      // ignore cleanup errors
    }
    return artifactWriteErrorResult(`atomic write failed: ${e.message}`, [
      {
        code: "atomic_write_failed",
        severity: "error",
        path: "filesystem",
        message: `atomic write failed: ${e.message}`,
        artifact_type: type,
        actual: [e?.message ?? "unknown error"],
      },
    ]);
  }
  const sizeBytes = statSync(mdPath).size;
  const normalizedArtifactMeta = {
    ...(artifactMeta ?? {}),
    type,
    canonical_type: getCanonicalArtifactType(type),
    layer: getArtifactLayer(type),
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
