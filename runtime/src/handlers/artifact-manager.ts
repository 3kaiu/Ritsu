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
import { resolve, join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { load as loadYaml } from "js-yaml";
import {
  ARTIFACT_VALID_TYPES,
  getCanonicalArtifactType,
  getSharedDir,
  getArtifactLayer,
  ARTIFACT_REGISTRY,
  isRecord,
  getStageForSkill,
  isArtifactTypeAllowedForStage,
  getStageArtifactTypes,
  detectArtifactTypeFromFileName,
} from "../shared.js";
import type { ArtifactType } from "../shared.js";
import {
  getProjectRoot,
  textResult,
  errorResult,
  jsonErrorResult,
  ts,
} from "./_utils.js";
import { evaluatePolicies } from "../policy/index.js";
import { appendEvent } from "../ctx-writer.js";
import { validateEvent } from "../event-validator.js";
import {
  extractQualityGateExecutionContext,
  normalizeQualityGateStatusToken,
  parseQualityGatePct,
  readQualityGateSnapshot,
  validateQualityGateSnapshotContext,
  validateQualityGateSnapshotWorktree,
} from "../quality-gates.js";
import { emitViolationEvent } from "../violation-events.js";
import { autoCheckpoint } from "../context-lifecycle.js";
import { syncFromDesignSheet } from "../contract-registry.js";

function isArtifactType(value: string): value is ArtifactType {
  return ARTIFACT_VALID_TYPES.some((artifactType) => artifactType === value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const RITSU_DIR = ".ritsu";
const ARTIFACT_SCHEMA_KEY_MAP: Record<string, string> = {
  "design-sheet": "design_sheet",
  "design-brief": "design_brief",
  "dev-report": "delivery_report",
  "assurance-sheet": "assurance_sheet",
  "coordination-sheet": "coordination_sheet",
};

type ArtifactSchemaSection = {
  title?: string;
  fields?: ArtifactSchemaField[];
  conditional_fields?: Array<{ fields?: ArtifactSchemaField[] }>;
};

type ArtifactSchemaField = {
  label?: string;
  sub_fields?: ArtifactSchemaField[];
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
  | "policy_violation"
  | "placeholder_content"
  | "invalid_artifact_type"
  | "filename_prefix_mismatch"
  | "path_traversal"
  | "file_exists"
  | "artifact_event_invalid"
  | "atomic_write_failed"
  | "quality_gates_missing_snapshot"
  | "quality_gates_invalid_snapshot"
  | "quality_gates_report_incomplete"
  | "quality_gates_result_mismatch"
  | "quality_gates_context_mismatch"
  | "quality_gates_worktree_mismatch";

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

export function buildArtifactSummary(content: string): string {
  const firstMeaningfulLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));

  const summary = firstMeaningfulLine ?? "artifact written";
  return summary.slice(0, 160);
}

function collectFieldLabels(fields: ArtifactSchemaField[] | undefined): string[] {
  if (!Array.isArray(fields)) return [];

  const labels: string[] = [];
  for (const field of fields) {
    const label = typeof field?.label === "string" ? field.label.trim() : "";
    if (label) labels.push(label);
    labels.push(...collectFieldLabels(field?.sub_fields));
  }
  return labels;
}

function pickContextValue(
  params: Record<string, unknown>,
  key: string,
): unknown {
  if (params[key] !== undefined) {
    return params[key];
  }
  const context =
    params.context &&
    typeof params.context === "object" &&
    !Array.isArray(params.context)
      ? (params.context as Record<string, unknown>)
      : undefined;
  return context?.[key];
}

function buildArtifactWrittenEvent(
  params: Record<string, unknown>,
  filename: string,
  artifactMeta: Record<string, unknown>,
): Record<string, unknown> {
  const event: Record<string, unknown> = {
    ts: ts(),
    status: "artifact_written",
    artifact: filename,
    artifact_meta: artifactMeta,
  };

  const skill = pickContextValue(params, "skill");
  const domain = pickContextValue(params, "domain");
  const correlationId = pickContextValue(params, "correlation_id");
  const traceId = pickContextValue(params, "trace_id");
  const spanId = pickContextValue(params, "span_id");
  const parentSpanId = pickContextValue(params, "parent_span_id");
  const agent = pickContextValue(params, "agent");

  if (typeof skill === "string" && skill) event.skill = skill;
  if (typeof domain === "string" && domain) event.domain = domain;
  if (typeof correlationId === "string" && correlationId) {
    event.correlation_id = correlationId;
  }
  if (typeof traceId === "string" && traceId) event.trace_id = traceId;
  if (typeof spanId === "string" && spanId) event.span_id = spanId;
  if (typeof parentSpanId === "string" && parentSpanId) {
    event.parent_span_id = parentSpanId;
  }
  if (agent && typeof agent === "object" && !Array.isArray(agent)) {
    event.agent = agent;
  }

  return event;
}

function validateArtifactWrittenEvent(
  event: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const validation = validateEvent(event);
  if (!validation.valid) {
    return {
      ok: false,
      message: validation.errors?.join(", ") ?? "event validation failed",
    };
  }
  return { ok: true };
}

async function appendArtifactWrittenEvent(
  event: Record<string, unknown>,
): Promise<void> {
  const root = getProjectRoot();
  await appendEvent(root, event);
}

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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractLabeledValue(content: string, label: string): string | null {
  const pattern = new RegExp(
    `^[\\t >-]*${escapeRegex(label)}\\s*:\\s*(.+)$`,
    "mi",
  );
  const match = content.match(pattern);
  return match?.[1]?.trim() ?? null;
}

async function validateDevReportQualityGates(
  root: string,
  content: string,
  currentContext: ReturnType<typeof extractQualityGateExecutionContext>,
): Promise<
  | { ok: true }
  | {
      ok: false;
      code:
        | "quality_gates_missing_snapshot"
        | "quality_gates_invalid_snapshot"
        | "quality_gates_report_incomplete"
        | "quality_gates_result_mismatch"
        | "quality_gates_context_mismatch"
        | "quality_gates_worktree_mismatch";
      message: string;
      expected?: string[];
      actual?: string[];
    }
> {
  const snapshotResult = readQualityGateSnapshot(root);
  if (!snapshotResult.ok) {
    return {
      ok: false,
      code:
        snapshotResult.reason === "missing"
          ? "quality_gates_missing_snapshot"
          : "quality_gates_invalid_snapshot",
      message: snapshotResult.message,
      expected: ["run ritsu_run_quality_gates before writing dev-report"],
      actual: [snapshotResult.path],
    };
  }

  const { snapshot } = snapshotResult;
  const contextValidation = validateQualityGateSnapshotContext(
    snapshot,
    currentContext,
  );
  if (!contextValidation.ok) {
    return {
      ok: false,
      code: "quality_gates_context_mismatch",
      message: contextValidation.message,
      expected: contextValidation.expected,
      actual: contextValidation.actual,
    };
  }

  const worktreeValidation = await validateQualityGateSnapshotWorktree(
    root,
    snapshot,
  );
  if (!worktreeValidation.ok) {
    return {
      ok: false,
      code: "quality_gates_worktree_mismatch",
      message: worktreeValidation.message,
      expected: worktreeValidation.expected,
      actual: worktreeValidation.actual,
    };
  }

  const expectedLines = [
    `总状态: ${snapshot.status}`,
    `Lint: ${snapshot.lint.status}`,
    `Test: ${snapshot.test.status}`,
  ];
  const actualLines: string[] = [];

  const reportStatus = extractLabeledValue(content, "总状态");
  const lintStatus = extractLabeledValue(content, "Lint");
  const testStatus = extractLabeledValue(content, "Test");

  const missingLabels = [
    ...(reportStatus ? [] : ["总状态"]),
    ...(lintStatus ? [] : ["Lint"]),
    ...(testStatus ? [] : ["Test"]),
  ];
  if (missingLabels.length > 0) {
    return {
      ok: false,
      code: "quality_gates_report_incomplete",
      message: `dev-report must include structured quality gate fields: ${missingLabels.join(", ")}`,
      expected: expectedLines,
      actual: missingLabels,
    };
  }

  const reportStatusValue = reportStatus ?? "";
  const lintStatusValue = lintStatus ?? "";
  const testStatusValue = testStatus ?? "";

  actualLines.push(`总状态: ${reportStatusValue}`);
  actualLines.push(`Lint: ${lintStatusValue}`);
  actualLines.push(`Test: ${testStatusValue}`);

  if (normalizeQualityGateStatusToken(reportStatusValue) !== snapshot.status) {
    return {
      ok: false,
      code: "quality_gates_result_mismatch",
      message: "dev-report quality gate overall status does not match the latest snapshot",
      expected: [`总状态: ${snapshot.status}`],
      actual: [`总状态: ${reportStatusValue}`],
    };
  }
  if (normalizeQualityGateStatusToken(lintStatusValue) !== snapshot.lint.status) {
    return {
      ok: false,
      code: "quality_gates_result_mismatch",
      message: "dev-report lint status does not match the latest quality gate snapshot",
      expected: [`Lint: ${snapshot.lint.status}`],
      actual: [`Lint: ${lintStatusValue}`],
    };
  }
  if (normalizeQualityGateStatusToken(testStatusValue) !== snapshot.test.status) {
    return {
      ok: false,
      code: "quality_gates_result_mismatch",
      message: "dev-report test status does not match the latest quality gate snapshot",
      expected: [`Test: ${snapshot.test.status}`],
      actual: [`Test: ${testStatusValue}`],
    };
  }

  const expectedCoveragePct = snapshot.coverage?.summary.lines?.pct;
  if (typeof expectedCoveragePct === "number") {
    const coverageValue = extractLabeledValue(content, "覆盖率 (Lines)");
    if (!coverageValue) {
      return {
        ok: false,
        code: "quality_gates_report_incomplete",
        message:
          "dev-report must include '覆盖率 (Lines)' when the latest quality gate captured coverage",
        expected: [`覆盖率 (Lines): ${expectedCoveragePct}%`],
        actual: actualLines,
      };
    }

    const actualCoveragePct = parseQualityGatePct(coverageValue);
    actualLines.push(`覆盖率 (Lines): ${coverageValue}`);
    if (
      actualCoveragePct === null ||
      Math.abs(actualCoveragePct - expectedCoveragePct) > 0.01
    ) {
      return {
        ok: false,
        code: "quality_gates_result_mismatch",
        message: "dev-report line coverage does not match the latest quality gate snapshot",
        expected: [`覆盖率 (Lines): ${expectedCoveragePct}%`],
        actual: [`覆盖率 (Lines): ${coverageValue}`],
      };
    }
  }

  return { ok: true };
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
      ...collectFieldLabels(section.fields),
      ...((Array.isArray(section.conditional_fields)
        ? section.conditional_fields.flatMap((group) =>
            collectFieldLabels(group.fields),
          )
        : []) as string[]),
    ];

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

  // Deep Content Validation (Batch 1.2 / 1.3)
  if (type === "design-sheet") {
    const executionBody = getSectionBody(content, "6. 实施清单 (Execution)");
    if (!executionBody || !executionBody.includes("verification_plan") || !executionBody.includes("contracts:")) {
      issues.push({
        code: "artifact_schema_missing_field_label",
        artifact_type: type,
        section_title: "6. 实施清单 (Execution)",
        field_label: "contracts",
        path: "artifact.sections.6.fields.contracts",
        message: "design-sheet P2 must contain structured 'contracts' in verification_plan",
      });
    }
  }

  if (type === "dev-report") {
    if (!content.includes("Quality Gates") && !content.includes("quality_gates_result")) {
      issues.push({
        code: "artifact_schema_missing_field_label",
        artifact_type: type,
        section_title: "交付摘要",
        field_label: "quality_gates_result",
        path: "artifact.sections.交付摘要.fields.quality_gates_result",
        message: "dev-report must contain 'Quality Gates' result (lint/test status)",
      });
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
  // Route to patch if action is "patch"
  if (params.action === "patch") {
    return ritsu_patch_artifact(params);
  }

  const type = String(params.type ?? "");
  const filename = String(params.filename ?? "");
  const content = String(params.content ?? "");
  const artifactMeta = isRecord(params.artifact_meta)
    ? params.artifact_meta
    : undefined;
  const summary = buildArtifactSummary(content);
  const normalizedArtifactMeta = {
    ...(artifactMeta ?? {}),
    type,
    canonical_type: getCanonicalArtifactType(type),
    layer: getArtifactLayer(type),
    size_bytes: Buffer.byteLength(content, "utf-8"),
    summary:
      typeof artifactMeta?.summary === "string" && artifactMeta.summary.trim()
        ? artifactMeta.summary.trim()
        : summary,
  };

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

  const root = getProjectRoot();

  // 政策引擎拦截
  const skill = pickContextValue(params, "skill");
  const policyResult = evaluatePolicies({
    action: "write_artifact",
    target: filename,
    content: content,
    context: typeof skill === "string" ? { skill } : undefined,
  });

  if (!policyResult.passed) {
    const topViolation = policyResult.violations.find((v) => v.severity === "fatal" || v.severity === "hard_stop") || policyResult.violations[0];
    
    // C4a: Emit violation event
    await emitViolationEvent(
      root,
      topViolation.rule_id,
      topViolation.severity,
      topViolation.message,
      topViolation.evidence,
    );

    const violations = policyResult.violations
      .filter((v) => v.severity === "fatal" || v.severity === "hard_stop")
      .map((v) => ({
        code: "policy_violation" as const,
        severity: "error" as const,
        path: "content",
        message: `[${v.rule_id}] ${v.message}`,
        artifact_type: type,
        expected: [v.suggestion ?? "Comply with policy"],
        actual: [v.evidence ?? "Policy violation"],
      }));
    
    return artifactWriteErrorResult(
      "write rejected by policy engine",
      violations
    );
  }

  // 产物类型校验
  if (!isArtifactType(type)) {
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

  // 阶段感知产物校验：检查产物类型是否匹配当前 span 的阶段
  if (typeof skill === "string" && skill) {
    const stage = getStageForSkill(skill);
    if (!isArtifactTypeAllowedForStage(type, stage)) {
      (normalizedArtifactMeta as Record<string, unknown>)._stage_warning =
        `Artifact type '${type}' may not be intended for stage '${stage}' (skill: ${skill}). ` +
        `Expected one of: ${getStageArtifactTypes(stage).join(", ") || "any"}. ` +
        `This is a soft warning — the write proceeds.`;
    }
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
    // Also emit violation for schema failure
    await emitViolationEvent(root, "AP-Schema", "error", validationIssues[0].message);

    const violations = buildArtifactValidationViolations(validationIssues);
    return jsonErrorResult(
      buildArtifactErrorPayload(
        ARTIFACT_VALIDATION_ERROR_TYPE,
        violations,
        "artifact schema validation failed",
      ),
    );
  }

  if (type === "dev-report") {
    const qualityGateValidation = await validateDevReportQualityGates(
      root,
      content,
      extractQualityGateExecutionContext(params),
    );
    if (!qualityGateValidation.ok) {
      await emitViolationEvent(
        root,
        "AP-5",
        "fatal",
        qualityGateValidation.message,
        (qualityGateValidation.actual ?? [qualityGateValidation.message]).join("; "),
      );
      return artifactWriteErrorResult(
        qualityGateValidation.message,
        [
          {
            code: qualityGateValidation.code,
            severity: "error",
            path: "content",
            message: qualityGateValidation.message,
            artifact_type: type,
            expected: qualityGateValidation.expected,
            actual: qualityGateValidation.actual,
          },
        ],
      );
    }
  }

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

  const artifactWrittenEvent = buildArtifactWrittenEvent(
    params,
    filename,
    normalizedArtifactMeta,
  );
  const artifactEventValidation = validateArtifactWrittenEvent(
    artifactWrittenEvent,
  );
  if (!artifactEventValidation.ok) {
    return artifactWriteErrorResult("artifact event validation failed", [
      {
        code: "artifact_event_invalid",
        severity: "error",
        path: "artifact_meta",
        message: `artifact event validation failed: ${artifactEventValidation.message}`,
        artifact_type: type,
      },
    ]);
  }

  // 原子写入 — write-to-temp + rename，防止崩溃时产生撕裂文件
  const tmpPath = join(dir, `.tmp-${randomUUID()}`);
  try {
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, mdPath);
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup errors
    }
    return artifactWriteErrorResult(`atomic write failed: ${message}`, [
      {
        code: "atomic_write_failed",
        severity: "error",
        path: "filesystem",
        message: `atomic write failed: ${message}`,
        artifact_type: type,
        actual: [message],
      },
    ]);
  }
  const sizeBytes = statSync(mdPath).size;
  normalizedArtifactMeta.size_bytes = sizeBytes;
  artifactWrittenEvent.artifact_meta = normalizedArtifactMeta;
  await appendArtifactWrittenEvent(artifactWrittenEvent);

  // Auto-checkpoint after artifact write for session recovery
  try {
    const skill = pickContextValue(params, "skill");
    if (typeof skill === "string" && skill) {
      autoCheckpoint(root, skill, normalizedArtifactMeta.summary || type);
    }
  } catch {
    // best-effort
  }

  // Sync contract registry on design-sheet write
  if (type === "design-sheet") {
    try {
      const content = readFileSync(mdPath, "utf-8");
      const filename = basename(mdPath);
      syncFromDesignSheet(root, content, filename, artifactMeta?.domain ? String(artifactMeta.domain) : undefined);
    } catch {
      // best-effort
    }
  }

  return textResult(
    JSON.stringify({
      path: mdPath,
      size_bytes: sizeBytes,
      artifact_meta: normalizedArtifactMeta,
    }),
  );
}

// ─── Patch Artifact (incremental markdown replacement) ───

export async function ritsu_patch_artifact(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const filename = String(params.filename ?? "");
  const targetContent = String(params.target_content ?? "");
  const replacementContent = String(params.replacement_content ?? "");

  if (!filename || !targetContent) {
    return errorResult("filename and target_content are required");
  }

  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return errorResult("filename must not contain path traversal (..) or directory separators");
  }

  const filePath = resolve(root, ".ritsu", filename);

  if (!existsSync(filePath)) {
    return errorResult(`file not found: ${filename}`);
  }

  const currentContent = readFileSync(filePath, "utf-8");

  const matchIndex = currentContent.indexOf(targetContent);
  if (matchIndex === -1) {
    return errorResult("target_content not found in the file. Ensure you provide exact matches including whitespace.");
  }

  const firstMatchIndex = currentContent.indexOf(targetContent);
  const lastMatchIndex = currentContent.lastIndexOf(targetContent);

  if (firstMatchIndex !== lastMatchIndex) {
    return errorResult("target_content matches multiple times in the file. Please provide a more specific, unique block of text.");
  }

  const newContent = currentContent.replace(targetContent, replacementContent);

  const skill = params.skill ?? (params.context && typeof params.context === "object" && !Array.isArray(params.context) ? (params.context as Record<string, unknown>).skill : undefined);
  const policyResult = evaluatePolicies({
    action: "write_artifact",
    target: filename,
    content: newContent,
    context: typeof skill === "string" ? { skill } : undefined,
  });

  if (!policyResult.passed) {
    const topViolation = policyResult.violations.find((v) => v.severity === "fatal" || v.severity === "hard_stop") || policyResult.violations[0];

    await emitViolationEvent(
      root,
      topViolation.rule_id,
      topViolation.severity,
      topViolation.message,
      topViolation.evidence,
    );

    const artifactType = detectArtifactTypeFromFileName(filename) || undefined;
    return jsonErrorResult({
      error: {
        type: "ArtifactWriteError",
        message: "patch rejected by policy engine",
        violations: policyResult.violations
          .filter((v) => v.severity === "fatal" || v.severity === "hard_stop")
          .map((v) => ({
            code: "policy_violation",
            severity: "error",
            path: "content",
            message: `[${v.rule_id}] ${v.message}`,
            artifact_type: artifactType,
            expected: [v.suggestion ?? "Comply with policy"],
            actual: [v.evidence ?? "Policy violation"],
          })),
      }
    });
  }

  writeFileSync(filePath, newContent, "utf-8");
  const sizeBytes = statSync(filePath).size;

  await appendEvent(root, {
    ts: ts(),
    status: "artifact_written",
    artifact: filename,
    artifact_meta: {
      type: "patch",
      size_bytes: sizeBytes,
      summary: `Patched ${filename}`,
    },
  });

  return textResult(JSON.stringify({
    path: filePath,
    size_bytes: sizeBytes,
    patched: true,
  }));
}
