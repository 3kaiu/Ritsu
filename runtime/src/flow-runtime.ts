import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { load as loadYaml } from "js-yaml";
import { getSharedDir } from "./shared.js";
import { ts } from "./handlers/_utils.js";
import { ritsu_read_ctx } from "./handlers/read-ctx.js";
import { ritsu_read_agents } from "./handlers/read-agents.js";
import { ritsu_env_probe } from "./handlers/env-probe.js";
import { ritsu_get_changed_files } from "./handlers/get-changed-files.js";
import { ritsu_get_diff } from "./handlers/get-diff.js";
import { ritsu_list_artifacts } from "./handlers/list-artifacts.js";
import { ritsu_run_quality_gates } from "./handlers/run-quality-gates.js";
import { ritsu_contract_validate } from "./handlers/contract-validate.js";
import { ritsu_emit_event } from "./handlers/emit-event.js";
import {
  collectArtifactMarkerActuals,
  collectArtifactContentIssuesDetailed,
  buildArtifactValidationViolations,
  ritsu_write_artifact,
} from "./handlers/write-artifact.js";

export const FLOW_PHASES = [
  "think",
  "dev",
  "test",
  "hunt",
  "review",
  "extensions",
] as const;

export const FLOW_EXECUTOR_TYPES = [
  "deterministic",
  "tool",
  "ai_decision",
] as const;

type FlowPhase = (typeof FLOW_PHASES)[number];
type FlowExecutorType = (typeof FLOW_EXECUTOR_TYPES)[number];
type FlowRunStatus =
  | "planned"
  | "running"
  | "awaiting_ai"
  | "failed"
  | "completed";

export type FlowStepDefinition = {
  step_id: string;
  title?: string;
  executor_type: FlowExecutorType;
  action?: string;
  required_context?: string[];
  action_params?: Record<string, unknown>;
  decision_contract?: {
    required_decision_keys?: string[];
    required_artifacts?: string[];
    artifact_expectations?: Array<{
      type: string;
      required_contains?: string[];
    }>;
    allow_empty_decision_output?: boolean;
    notes?: string;
  };
  success_condition: string;
  on_failure: string;
  writes_artifact?: string[];
  optional?: boolean;
  notes?: string;
};

export type FlowManifest = {
  flow_id: string;
  phase: FlowPhase;
  intent: string;
  required_inputs: string[];
  prechecks: FlowStepDefinition[];
  steps: FlowStepDefinition[];
  verifications: FlowStepDefinition[];
  artifacts: string[];
  failure_recovery: string[];
  next_phase_rules: Array<{ when: string; next_phase: string }>;
  source_path?: string;
};

type FlowSection = "prechecks" | "steps" | "verifications";

type FlowStepResultStatus =
  | "pending"
  | "completed"
  | "failed"
  | "awaiting_ai"
  | "skipped";

type FlowStepResult = {
  step_id: string;
  title: string;
  section: FlowSection;
  executor_type: FlowExecutorType;
  action: string | null;
  status: FlowStepResultStatus;
  summary: string;
  started_at: string | null;
  completed_at: string | null;
  output?: unknown;
  error?: string;
  writes_artifact?: string[];
  optional?: boolean;
};

export type FlowStateRecord = {
  run_id: string;
  flow_id: string;
  phase: string;
  intent: string;
  correlation_id: string | null;
  status: FlowRunStatus;
  current_step: string | null;
  completed_steps: string[];
  pending_steps: string[];
  verification_status: "pending" | "passed" | "failed";
  artifact_outputs: string[];
  recovery_point: string | null;
  created_at: string;
  updated_at: string;
  source_path: string | null;
  context: Record<string, unknown>;
  next_phase_recommendations: string[];
  step_results: FlowStepResult[];
};

type FlowValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

type FlowExecutionOptions = {
  input_context?: Record<string, unknown>;
  stop_before_ai?: boolean;
  dry_run?: boolean;
};

type MaterializedStep = FlowStepDefinition & {
  section: FlowSection;
  index: number;
};

type CallResultLike = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

type FlowDecisionArtifactInput = {
  type: string;
  filename?: string;
  content: string;
  artifact_meta?: Record<string, unknown>;
  overwrite?: boolean;
};

type ApplyFlowDecisionOptions = {
  step_id?: string;
  summary?: string;
  decision_output?: unknown;
  artifacts?: FlowDecisionArtifactInput[];
  continue_after_apply?: boolean;
  stop_before_ai?: boolean;
};

export type FlowDecisionViolationCode =
  | "decision_output_not_object"
  | "missing_decision_keys"
  | "missing_required_artifacts"
  | "artifact_content_missing_markers"
  | "artifact_schema_missing_section"
  | "artifact_schema_missing_field_label";

export type FlowDecisionViolationSeverity = "error";

export type FlowDecisionViolation = {
  code: FlowDecisionViolationCode;
  severity: FlowDecisionViolationSeverity;
  step_id: string;
  message: string;
  path: string;
  artifact_type?: string;
  expected?: string[];
  actual?: string[];
};

export const FLOW_DECISION_CONTRACT_ERROR_TYPE =
  "FlowDecisionContractError";

export type FlowDecisionErrorPayload = {
  error: {
    type: string;
    message: string;
    violations: FlowDecisionViolation[];
  };
};

const FLOW_DECISION_VIOLATION_SEVERITY_ORDER: Record<
  FlowDecisionViolationSeverity,
  number
> = {
  error: 0,
};

function compareString(a: string | undefined, b: string | undefined): number {
  return (a ?? "").localeCompare(b ?? "");
}

function sortDecisionViolations(
  violations: FlowDecisionViolation[],
): FlowDecisionViolation[] {
  return [...violations].sort((left, right) => {
    const severityDelta =
      FLOW_DECISION_VIOLATION_SEVERITY_ORDER[left.severity] -
      FLOW_DECISION_VIOLATION_SEVERITY_ORDER[right.severity];
    if (severityDelta !== 0) return severityDelta;

    const stepDelta = compareString(left.step_id, right.step_id);
    if (stepDelta !== 0) return stepDelta;

    const pathDelta = compareString(left.path, right.path);
    if (pathDelta !== 0) return pathDelta;

    const codeDelta = compareString(left.code, right.code);
    if (codeDelta !== 0) return codeDelta;

    return compareString(left.message, right.message);
  });
}

export class FlowDecisionContractError extends Error {
  violations: FlowDecisionViolation[];

  constructor(message: string, violations: FlowDecisionViolation[]) {
    super(message);
    this.name = FLOW_DECISION_CONTRACT_ERROR_TYPE;
    this.violations = violations;
  }
}

export function joinFlowDecisionViolationMessages(
  violations: Array<{ message: string }>,
): string {
  return violations
    .map((violation) => violation.message)
    .filter(Boolean)
    .join("; ");
}

export function buildFlowDecisionErrorPayload(
  violations: FlowDecisionViolation[],
  fallbackMessage: string,
): FlowDecisionErrorPayload {
  return {
    error: {
      type: FLOW_DECISION_CONTRACT_ERROR_TYPE,
      message: joinFlowDecisionViolationMessages(violations) || fallbackMessage,
      violations,
    },
  };
}

function throwIfDecisionViolations(
  stepId: string,
  violations: FlowDecisionViolation[],
): void {
  if (violations.length === 0) return;
  const sortedViolations = sortDecisionViolations(violations);
  throw new FlowDecisionContractError(
    joinFlowDecisionViolationMessages(sortedViolations) ||
      `decision contract validation failed for step '${stepId}'`,
    sortedViolations,
  );
}

const PHASE_ARTIFACT_EXPECTATIONS: Record<string, string[]> = {
  think: ["think-ticket", "think-plan"],
  dev: ["dev-report"],
  test: [],
  hunt: ["diagnosis"],
  review: ["review-report", "review-advice"],
  extensions: [],
};

function getFlowsDir(): string {
  return resolve(getSharedDir(), "flows");
}

function getProjectRoot(): string {
  return process.env.RITSU_PROJECT_ROOT ?? process.cwd();
}

function getFlowStateDir(projectRoot = getProjectRoot()): string {
  return resolve(projectRoot, ".ritsu", "flows");
}

function ensureFlowStateDir(projectRoot = getProjectRoot()): string {
  const dir = getFlowStateDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function buildRunId(flowId: string): string {
  return `flow-${flowId}-${ts()}-${randomUUID().slice(0, 8)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStepList(value: unknown): FlowStepDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject).map((item) => ({
    step_id: String(item.step_id ?? ""),
    title: typeof item.title === "string" ? item.title : undefined,
    executor_type: String(item.executor_type ?? "") as FlowExecutorType,
    action: typeof item.action === "string" ? item.action : undefined,
    required_context: Array.isArray(item.required_context)
      ? item.required_context.map((entry) => String(entry))
      : undefined,
    action_params: isPlainObject(item.action_params) ? item.action_params : undefined,
    decision_contract: isPlainObject(item.decision_contract)
      ? {
          required_decision_keys: Array.isArray(item.decision_contract.required_decision_keys)
            ? item.decision_contract.required_decision_keys.map((entry) => String(entry))
            : undefined,
          required_artifacts: Array.isArray(item.decision_contract.required_artifacts)
            ? item.decision_contract.required_artifacts.map((entry) => String(entry))
            : undefined,
          artifact_expectations: Array.isArray(item.decision_contract.artifact_expectations)
            ? item.decision_contract.artifact_expectations
                .filter(isPlainObject)
                .map((entry) => ({
                  type: String(entry.type ?? ""),
                  required_contains: Array.isArray(entry.required_contains)
                    ? entry.required_contains.map((token) => String(token))
                    : undefined,
                }))
            : undefined,
          allow_empty_decision_output:
            item.decision_contract.allow_empty_decision_output === true,
          notes:
            typeof item.decision_contract.notes === "string"
              ? item.decision_contract.notes
              : undefined,
        }
      : undefined,
    success_condition: String(item.success_condition ?? ""),
    on_failure: String(item.on_failure ?? ""),
    writes_artifact: Array.isArray(item.writes_artifact)
      ? item.writes_artifact.map((entry) => String(entry))
      : undefined,
    optional: item.optional === true,
    notes: typeof item.notes === "string" ? item.notes : undefined,
  }));
}

function normalizeManifest(
  raw: Record<string, unknown>,
  sourcePath?: string,
): FlowManifest {
  return {
    flow_id: String(raw.flow_id ?? ""),
    phase: String(raw.phase ?? "") as FlowPhase,
    intent: String(raw.intent ?? ""),
    required_inputs: Array.isArray(raw.required_inputs)
      ? raw.required_inputs.map((entry) => String(entry))
      : [],
    prechecks: normalizeStepList(raw.prechecks),
    steps: normalizeStepList(raw.steps),
    verifications: normalizeStepList(raw.verifications),
    artifacts: Array.isArray(raw.artifacts)
      ? raw.artifacts.map((entry) => String(entry))
      : [],
    failure_recovery: Array.isArray(raw.failure_recovery)
      ? raw.failure_recovery.map((entry) => String(entry))
      : [],
    next_phase_rules: Array.isArray(raw.next_phase_rules)
      ? raw.next_phase_rules
          .filter(isPlainObject)
          .map((entry) => ({
            when: String(entry.when ?? ""),
            next_phase: String(entry.next_phase ?? ""),
          }))
      : [],
    source_path: sourcePath,
  };
}

export function validateFlowManifest(manifest: FlowManifest): FlowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest.flow_id) errors.push("missing flow_id");
  if (!manifest.phase) errors.push("missing phase");
  if (!FLOW_PHASES.includes(manifest.phase)) {
    errors.push(`invalid phase '${manifest.phase}'`);
  }
  if (!manifest.intent) errors.push("missing intent");
  if (!Array.isArray(manifest.required_inputs)) {
    errors.push("required_inputs must be an array");
  }

  const sections: Array<[FlowSection, FlowStepDefinition[]]> = [
    ["prechecks", manifest.prechecks],
    ["steps", manifest.steps],
    ["verifications", manifest.verifications],
  ];

  const seenStepIds = new Set<string>();
  for (const [sectionName, steps] of sections) {
    if (!Array.isArray(steps)) {
      errors.push(`${sectionName} must be an array`);
      continue;
    }
    if (sectionName === "steps" && steps.length === 0) {
      errors.push("steps must not be empty");
    }
    for (const step of steps) {
      if (!step.step_id) errors.push(`${sectionName}: missing step_id`);
      if (step.step_id && seenStepIds.has(step.step_id)) {
        errors.push(`duplicate step_id '${step.step_id}'`);
      }
      if (step.step_id) seenStepIds.add(step.step_id);
      if (!FLOW_EXECUTOR_TYPES.includes(step.executor_type)) {
        errors.push(
          `${sectionName}.${step.step_id || "<unknown>"} has invalid executor_type '${step.executor_type}'`,
        );
      }
      if (!step.success_condition) {
        errors.push(`${sectionName}.${step.step_id || "<unknown>"} missing success_condition`);
      }
      if (!step.on_failure) {
        errors.push(`${sectionName}.${step.step_id || "<unknown>"} missing on_failure`);
      }
      if (
        step.executor_type !== "ai_decision" &&
        (!step.action || !step.action.trim())
      ) {
        errors.push(`${sectionName}.${step.step_id || "<unknown>"} missing action`);
      }
      if (
        step.writes_artifact &&
        step.writes_artifact.some((artifact) => !manifest.artifacts.includes(artifact))
      ) {
        errors.push(
          `${sectionName}.${step.step_id || "<unknown>"} writes undeclared artifact`,
        );
      }
      if (step.decision_contract) {
        if (step.executor_type !== "ai_decision") {
          errors.push(
            `${sectionName}.${step.step_id || "<unknown>"} decision_contract is only valid for ai_decision steps`,
          );
        }
        if (
          step.decision_contract.required_decision_keys &&
          step.decision_contract.required_decision_keys.length === 0
        ) {
          errors.push(
            `${sectionName}.${step.step_id || "<unknown>"} decision_contract.required_decision_keys must not be empty`,
          );
        }
        if (
          step.decision_contract.required_artifacts &&
          step.decision_contract.required_artifacts.some(
            (artifact) =>
              !manifest.artifacts.includes(artifact) ||
              !(step.writes_artifact ?? []).includes(artifact),
          )
        ) {
          errors.push(
            `${sectionName}.${step.step_id || "<unknown>"} decision_contract.required_artifacts must be declared in writes_artifact`,
          );
        }
        if (
          step.decision_contract.artifact_expectations &&
          step.decision_contract.artifact_expectations.some(
            (expectation) =>
              !expectation.type ||
              !(step.writes_artifact ?? []).includes(expectation.type) ||
              !Array.isArray(expectation.required_contains) ||
              expectation.required_contains.length === 0,
          )
        ) {
          errors.push(
            `${sectionName}.${step.step_id || "<unknown>"} decision_contract.artifact_expectations must target writes_artifact entries and declare required_contains`,
          );
        }
      }
    }
  }

  if (!Array.isArray(manifest.failure_recovery) || manifest.failure_recovery.length === 0) {
    errors.push("failure_recovery must not be empty");
  }

  if (!Array.isArray(manifest.artifacts)) {
    errors.push("artifacts must be an array");
  }

  if (!Array.isArray(manifest.next_phase_rules) || manifest.next_phase_rules.length === 0) {
    errors.push("next_phase_rules must not be empty");
  }

  for (const rule of manifest.next_phase_rules) {
    if (!rule.when || !rule.next_phase) {
      errors.push("next_phase_rules entries require when and next_phase");
    }
  }

  const expectedArtifacts = PHASE_ARTIFACT_EXPECTATIONS[manifest.phase] ?? [];
  if (
    expectedArtifacts.length > 0 &&
    !manifest.artifacts.some((artifact) => expectedArtifacts.includes(artifact))
  ) {
    errors.push(
      `phase '${manifest.phase}' must declare at least one of: ${expectedArtifacts.join(", ")}`,
    );
  }

  const hasAiStep = manifest.steps.some((step) => step.executor_type === "ai_decision");
  if (!hasAiStep && manifest.phase !== "test") {
    warnings.push("flow has no ai_decision step; verify this is intentional");
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function loadFlowManifests(): FlowManifest[] {
  const dir = getFlowsDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .sort()
    .map((file) => {
      const fullPath = resolve(dir, file);
      const raw = readFileSync(fullPath, "utf-8");
      const doc = loadYaml(raw);
      const normalized = normalizeManifest(
        isPlainObject(doc) ? doc : {},
        fullPath,
      );
      return normalized;
    });
}

export function getFlowById(flowId: string): FlowManifest | null {
  return loadFlowManifests().find((flow) => flow.flow_id === flowId) ?? null;
}

export function selectFlow(phase?: string, intent?: string): FlowManifest | null {
  const manifests = loadFlowManifests();
  if (phase && intent) {
    return (
      manifests.find((flow) => flow.phase === phase && flow.intent === intent) ?? null
    );
  }
  if (phase) {
    return manifests.find((flow) => flow.phase === phase) ?? null;
  }
  return manifests[0] ?? null;
}

function materializeSteps(manifest: FlowManifest): MaterializedStep[] {
  const sections: Array<[FlowSection, FlowStepDefinition[]]> = [
    ["prechecks", manifest.prechecks],
    ["steps", manifest.steps],
    ["verifications", manifest.verifications],
  ];

  const out: MaterializedStep[] = [];
  let index = 0;
  for (const [section, steps] of sections) {
    for (const step of steps) {
      out.push({ ...step, section, index });
      index++;
    }
  }
  return out;
}

function buildInitialState(
  manifest: FlowManifest,
  options: FlowExecutionOptions,
): FlowStateRecord {
  const steps = materializeSteps(manifest);
  const now = ts();
  return {
    run_id: buildRunId(manifest.flow_id),
    flow_id: manifest.flow_id,
    phase: manifest.phase,
    intent: manifest.intent,
    correlation_id: null,
    status: options.dry_run ? "planned" : "running",
    current_step: steps[0]?.step_id ?? null,
    completed_steps: [],
    pending_steps: steps.map((step) => step.step_id),
    verification_status: "pending",
    artifact_outputs: [],
    recovery_point: steps[0]?.step_id ?? null,
    created_at: now,
    updated_at: now,
    source_path: manifest.source_path ?? null,
    context: { ...(options.input_context ?? {}) },
    next_phase_recommendations: manifest.next_phase_rules.map((rule) => rule.next_phase),
    step_results: steps.map((step) => ({
      step_id: step.step_id,
      title: step.title ?? step.step_id,
      section: step.section,
      executor_type: step.executor_type,
      action: step.action ?? null,
      status: "pending",
      summary: "",
      started_at: null,
      completed_at: null,
      writes_artifact: step.writes_artifact,
      optional: step.optional,
    })),
  };
}

function getStatePath(runId: string, projectRoot = getProjectRoot()): string {
  return resolve(ensureFlowStateDir(projectRoot), `${runId}.json`);
}

function writeState(state: FlowStateRecord, projectRoot = getProjectRoot()): void {
  state.updated_at = ts();
  writeFileSync(getStatePath(state.run_id, projectRoot), JSON.stringify(state, null, 2));
}

export function readFlowState(
  runId: string,
  projectRoot = getProjectRoot(),
): FlowStateRecord | null {
  const statePath = getStatePath(runId, projectRoot);
  if (!existsSync(statePath)) return null;
  const raw = readFileSync(statePath, "utf-8");
  return JSON.parse(raw) as FlowStateRecord;
}

export function getLatestFlowState(projectRoot = getProjectRoot()): FlowStateRecord | null {
  const dir = getFlowStateDir(projectRoot);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const path = resolve(dir, name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (files.length === 0) return null;
  return JSON.parse(readFileSync(files[0].path, "utf-8")) as FlowStateRecord;
}

function parseToolResult(result: CallResultLike): {
  ok: boolean;
  data: unknown;
  rawText: string;
  error: string | null;
} {
  const rawText =
    result.content?.find((entry) => entry.type === "text")?.text ?? "";
  let data: unknown = rawText;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = rawText;
  }
  const error =
    result.isError === true
      ? rawText.replace(/^❌\s*/, "") || "tool execution failed"
      : null;
  return { ok: result.isError !== true, data, rawText, error };
}

async function executeFlowAction(
  step: MaterializedStep,
  state: FlowStateRecord,
): Promise<{ ok: boolean; data: unknown; summary: string; error?: string }> {
  if (step.executor_type === "deterministic") {
    return {
      ok: true,
      data: {
        type: "deterministic",
        action: step.action ?? "noop",
        captured: Object.keys(state.context),
      },
      summary: `deterministic action '${step.action ?? "noop"}' recorded`,
    };
  }

  if (step.executor_type === "ai_decision") {
    return {
      ok: false,
      data: null,
      summary: "awaiting AI decision",
      error: "awaiting_ai",
    };
  }

  const action = step.action ?? "";
  const params = step.action_params ?? {};

  switch (action) {
    case "read_ctx": {
      const parsed = parseToolResult(await ritsu_read_ctx());
      return {
        ok: parsed.ok,
        data: parsed.data,
        summary: parsed.ok ? "ctx snapshot loaded" : "ctx snapshot failed",
        ...(parsed.error ? { error: parsed.error } : {}),
      };
    }
    case "read_agents": {
      const parsed = parseToolResult(await ritsu_read_agents({}));
      return {
        ok: parsed.ok,
        data: parsed.data,
        summary: parsed.ok ? "AGENTS baseline loaded" : "AGENTS baseline unavailable",
        ...(parsed.error ? { error: parsed.error } : {}),
      };
    }
    case "env_probe": {
      const parsed = parseToolResult(await ritsu_env_probe({}));
      return {
        ok: parsed.ok,
        data: parsed.data,
        summary: parsed.ok ? "environment probed" : "environment probe failed",
        ...(parsed.error ? { error: parsed.error } : {}),
      };
    }
    case "get_changed_files": {
      const parsed = parseToolResult(await ritsu_get_changed_files(params));
      return {
        ok: parsed.ok,
        data: parsed.data,
        summary: parsed.ok ? "changed files collected" : "changed files collection failed",
        ...(parsed.error ? { error: parsed.error } : {}),
      };
    }
    case "get_diff": {
      const parsed = parseToolResult(await ritsu_get_diff(params));
      return {
        ok: parsed.ok,
        data: parsed.data,
        summary: parsed.ok ? "diff snapshot collected" : "diff snapshot failed",
        ...(parsed.error ? { error: parsed.error } : {}),
      };
    }
    case "list_artifacts": {
      const parsed = parseToolResult(await ritsu_list_artifacts(params));
      return {
        ok: parsed.ok,
        data: parsed.data,
        summary: parsed.ok ? "artifact inventory collected" : "artifact inventory failed",
        ...(parsed.error ? { error: parsed.error } : {}),
      };
    }
    case "run_quality_gates": {
      const parsed = parseToolResult(await ritsu_run_quality_gates(params));
      const passed =
        isPlainObject(parsed.data) && parsed.data.passed === false ? false : parsed.ok;
      return {
        ok: passed,
        data: parsed.data,
        summary: passed ? "quality gates passed" : "quality gates failed",
        ...(passed ? {} : { error: parsed.error ?? "quality gates failed" }),
      };
    }
    case "contract_validate": {
      const parsed = parseToolResult(await ritsu_contract_validate(params));
      const passed =
        isPlainObject(parsed.data) && parsed.data.passed === false ? false : parsed.ok;
      return {
        ok: passed,
        data: parsed.data,
        summary: passed ? "contract validation passed" : "contract validation failed",
        ...(passed ? {} : { error: parsed.error ?? "contract validation failed" }),
      };
    }
    default:
      return {
        ok: false,
        data: null,
        summary: `unsupported flow action '${action}'`,
        error: `unsupported flow action '${action}'`,
      };
  }
}

function updateStepResult(
  state: FlowStateRecord,
  stepId: string,
  updater: (current: FlowStepResult) => FlowStepResult,
): void {
  const idx = state.step_results.findIndex((entry) => entry.step_id === stepId);
  if (idx === -1) return;
  state.step_results[idx] = updater(state.step_results[idx]);
}

function finalizePendingSteps(state: FlowStateRecord): void {
  state.pending_steps = state.step_results
    .filter((entry) => entry.status === "pending")
    .map((entry) => entry.step_id);
}

function attachContextForStep(
  state: FlowStateRecord,
  step: MaterializedStep,
  data: unknown,
): void {
  const actionKey = step.action ?? step.step_id;
  state.context[actionKey] = data;
  state.context[step.step_id] = data;
}

function computeVerificationStatus(state: FlowStateRecord): FlowStateRecord["verification_status"] {
  const verifications = state.step_results.filter((entry) => entry.section === "verifications");
  if (verifications.some((entry) => entry.status === "failed")) return "failed";
  if (verifications.length > 0 && verifications.every((entry) => entry.status === "completed")) {
    return "passed";
  }
  return "pending";
}

function getFlowSkill(state: FlowStateRecord): string {
  return FLOW_PHASES.includes(state.phase as FlowPhase) ? state.phase : "unknown";
}

function getFlowDomain(state: FlowStateRecord): string {
  const domain = state.context.domain;
  return typeof domain === "string" && domain.trim() ? domain : "unknown";
}

function getStepLabel(step: MaterializedStep, total: number): string {
  return `${step.index + 1}/${total}`;
}

async function ensureFlowStartedEvent(
  state: FlowStateRecord,
  manifest: FlowManifest,
): Promise<void> {
  if (state.correlation_id) return;
  const steps = materializeSteps(manifest);
  const result = await ritsu_emit_event({
    event_type: "started",
    step: steps.length > 0 ? getStepLabel(steps[0], steps.length) : "1/1",
    skill: getFlowSkill(state),
    domain: getFlowDomain(state),
  });
  const parsed = parseToolResult(result);
  if (parsed.ok && isPlainObject(parsed.data)) {
    state.correlation_id =
      typeof parsed.data.correlation_id === "string"
        ? parsed.data.correlation_id
        : null;
  }
}

async function emitFlowFailedEvent(
  state: FlowStateRecord,
  error: string,
): Promise<void> {
  if (!state.correlation_id) return;
  await ritsu_emit_event({
    event_type: "failed",
    correlation_id: state.correlation_id,
    skill: getFlowSkill(state),
    domain: getFlowDomain(state),
    error,
  });
}

async function emitFlowDoneEvent(state: FlowStateRecord): Promise<void> {
  if (!state.correlation_id) return;
  const total = state.step_results.length || 1;
  const artifact =
    state.artifact_outputs.length > 0
      ? state.artifact_outputs[state.artifact_outputs.length - 1]
      : undefined;
  await ritsu_emit_event({
    event_type: "done",
    correlation_id: state.correlation_id,
    step: `${total}/${total}`,
    skill: getFlowSkill(state),
    domain: getFlowDomain(state),
    ...(artifact ? { artifact } : {}),
  });
}

function buildDefaultArtifactFilename(
  type: string,
  runId: string,
  stepId: string,
  index: number,
): string {
  const safeRunId = runId.replace(/[^a-zA-Z0-9-]/g, "-");
  const safeStepId = stepId.replace(/[^a-zA-Z0-9-]/g, "-");
  return `${type}-${safeRunId}-${safeStepId}-${index + 1}.md`;
}

async function writeDecisionArtifacts(
  state: FlowStateRecord,
  step: MaterializedStep,
  artifacts: FlowDecisionArtifactInput[],
  totalSteps: number,
): Promise<Array<{ path: string; artifact_meta: Record<string, unknown>; size_bytes: number }>> {
  const results: Array<{
    path: string;
    artifact_meta: Record<string, unknown>;
    size_bytes: number;
  }> = [];

  for (let i = 0; i < artifacts.length; i++) {
    const artifact = artifacts[i];
    const writeResult = await ritsu_write_artifact({
      type: artifact.type,
      filename:
        artifact.filename ??
        buildDefaultArtifactFilename(artifact.type, state.run_id, step.step_id, i),
      content: artifact.content,
      artifact_meta: artifact.artifact_meta,
      overwrite: artifact.overwrite,
    });
    const parsed = parseToolResult(writeResult);
    if (!parsed.ok || !isPlainObject(parsed.data)) {
      throw new Error(
        parsed.error ?? `artifact write failed for type '${artifact.type}'`,
      );
    }

    const path = String(parsed.data.path ?? "");
    const sizeBytes = Number(parsed.data.size_bytes ?? 0);
    const artifactMeta = isPlainObject(parsed.data.artifact_meta)
      ? parsed.data.artifact_meta
      : {};
    const artifactMetaForEvent = {
      ...artifactMeta,
      summary:
        typeof artifactMeta.summary === "string" && artifactMeta.summary.trim()
          ? artifactMeta.summary
          : `flow artifact written: ${artifact.type}`,
    };

    results.push({
      path,
      artifact_meta: artifactMetaForEvent,
      size_bytes: sizeBytes,
    });

    if (state.correlation_id) {
      const eventResult = await ritsu_emit_event({
        event_type: "artifact_written",
        correlation_id: state.correlation_id,
        step: getStepLabel(step, totalSteps),
        skill: getFlowSkill(state),
        domain: getFlowDomain(state),
        artifact: path,
        artifact_meta: artifactMetaForEvent,
      });
      const eventParsed = parseToolResult(eventResult);
      if (!eventParsed.ok) {
        throw new Error(
          eventParsed.error ?? `artifact event emission failed for '${artifact.type}'`,
        );
      }
    }
  }

  return results;
}

function collectDecisionArtifactViolations(
  step: MaterializedStep,
  artifacts: FlowDecisionArtifactInput[],
): FlowDecisionViolation[] {
  const violations: FlowDecisionViolation[] = [];
  for (const artifact of artifacts) {
    violations.push(...collectArtifactContentExpectationViolations(step, artifact));
    violations.push(...collectArtifactSchemaViolations(step, artifact));
  }
  return violations;
}

function collectDecisionPayloadViolations(
  step: MaterializedStep,
  decisionOutput: unknown,
  artifactTypes: string[],
): FlowDecisionViolation[] {
  const contract = step.decision_contract;
  if (!contract) return [];

  const violations: FlowDecisionViolation[] = [];

  const outputIsObject = isPlainObject(decisionOutput);
  if (
    contract.allow_empty_decision_output !== true &&
    Array.isArray(contract.required_decision_keys) &&
    contract.required_decision_keys.length > 0
  ) {
    if (!outputIsObject) {
      violations.push(
        {
          code: "decision_output_not_object",
          severity: "error",
          step_id: step.step_id,
          path: "decision_output",
          message: `decision_output must be an object containing: ${contract.required_decision_keys.join(", ")}`,
          expected: contract.required_decision_keys,
          actual: [typeof decisionOutput],
        },
      );
    } else {
      const missingKeys = contract.required_decision_keys.filter(
        (key) => !(key in decisionOutput),
      );
      if (missingKeys.length > 0) {
        violations.push(
          {
            code: "missing_decision_keys",
            severity: "error",
            step_id: step.step_id,
            path: "decision_output",
            message: `decision_output is missing required keys: ${missingKeys.join(", ")}`,
            expected: contract.required_decision_keys,
            actual: Object.keys(decisionOutput),
          },
        );
      }
    }
  } else if (contract.allow_empty_decision_output !== true && !outputIsObject) {
    violations.push(
      {
        code: "decision_output_not_object",
        severity: "error",
        step_id: step.step_id,
        path: "decision_output",
        message: "decision_output must be an object",
        actual: [typeof decisionOutput],
      },
    );
  }

  if (Array.isArray(contract.required_artifacts) && contract.required_artifacts.length > 0) {
    const missingArtifacts = contract.required_artifacts.filter(
      (artifact) => !artifactTypes.includes(artifact),
    );
    if (missingArtifacts.length > 0) {
      violations.push(
        {
          code: "missing_required_artifacts",
          severity: "error",
          step_id: step.step_id,
          path: "artifacts",
          message: `step is missing required artifacts: ${missingArtifacts.join(", ")}`,
          expected: contract.required_artifacts,
          actual: artifactTypes,
        },
      );
    }
  }

  return violations;
}

function collectArtifactContentExpectationViolations(
  step: MaterializedStep,
  artifact: FlowDecisionArtifactInput,
): FlowDecisionViolation[] {
  const expectations = step.decision_contract?.artifact_expectations ?? [];
  const expectation = expectations.find((entry) => entry.type === artifact.type);
  if (!expectation) return [];

  const missingTokens = (expectation.required_contains ?? []).filter(
    (token) => !artifact.content.includes(token),
  );
  if (missingTokens.length === 0) return [];

  return missingTokens.map((missingToken) => ({
    code: "artifact_content_missing_markers",
    severity: "error",
    step_id: step.step_id,
    path: `artifacts.${artifact.type}.content.markers.${missingToken}`,
    artifact_type: artifact.type,
    message: `artifact content is missing required marker: ${missingToken}`,
    expected: [missingToken],
    actual: collectArtifactMarkerActuals(artifact.content, missingToken),
  }));
}

function collectArtifactSchemaViolations(
  step: MaterializedStep,
  artifact: FlowDecisionArtifactInput,
): FlowDecisionViolation[] {
  const issues = collectArtifactContentIssuesDetailed(artifact.type, artifact.content);
  if (issues.length === 0) return [];

  return buildArtifactValidationViolations(issues).map((violation) => ({
    code: violation.code,
    severity: violation.severity,
    step_id: step.step_id,
    path: `artifacts.${artifact.type}.${violation.path}`,
    artifact_type: violation.artifact_type,
    message: violation.message,
    expected: violation.expected,
    actual: violation.actual,
  }));
}

export async function runFlowManifest(
  manifest: FlowManifest,
  options: FlowExecutionOptions = {},
  existingState?: FlowStateRecord,
): Promise<FlowStateRecord> {
  const validation = validateFlowManifest(manifest);
  if (!validation.valid) {
    throw new Error(`invalid flow manifest: ${validation.errors.join("; ")}`);
  }

  const state = existingState ?? buildInitialState(manifest, options);
  const steps = materializeSteps(manifest);
  const stopBeforeAi = options.stop_before_ai !== false;

  if (options.dry_run) {
    writeState(state);
    return state;
  }

  state.status = "running";
  await ensureFlowStartedEvent(state, manifest);
  writeState(state);

  for (const step of steps) {
    const existing = state.step_results.find((entry) => entry.step_id === step.step_id);
    if (!existing || existing.status === "completed" || existing.status === "skipped") {
      continue;
    }

    state.current_step = step.step_id;
    state.recovery_point = step.step_id;
    updateStepResult(state, step.step_id, (current) => ({
      ...current,
      started_at: current.started_at ?? ts(),
    }));
    writeState(state);

    if (step.executor_type === "ai_decision" && stopBeforeAi) {
      updateStepResult(state, step.step_id, (current) => ({
        ...current,
        status: "awaiting_ai",
        summary: "awaiting AI decision",
      }));
      state.status = "awaiting_ai";
      finalizePendingSteps(state);
      state.verification_status = computeVerificationStatus(state);
      writeState(state);
      return state;
    }

    const executed = await executeFlowAction(step, state);
    if (executed.ok) {
      attachContextForStep(state, step, executed.data);
      updateStepResult(state, step.step_id, (current) => ({
        ...current,
        status: "completed",
        summary: executed.summary,
        completed_at: ts(),
        output: executed.data,
        error: undefined,
      }));
      if (!state.completed_steps.includes(step.step_id)) {
        state.completed_steps.push(step.step_id);
      }
      if (Array.isArray(step.writes_artifact)) {
        for (const artifact of step.writes_artifact) {
          if (!state.artifact_outputs.includes(artifact)) {
            state.artifact_outputs.push(artifact);
          }
        }
      }
      continue;
    }

    if (executed.error === "awaiting_ai") {
      updateStepResult(state, step.step_id, (current) => ({
        ...current,
        status: "awaiting_ai",
        summary: executed.summary,
      }));
      state.status = "awaiting_ai";
      finalizePendingSteps(state);
      state.verification_status = computeVerificationStatus(state);
      writeState(state);
      return state;
    }

    if (step.optional) {
      updateStepResult(state, step.step_id, (current) => ({
        ...current,
        status: "skipped",
        summary: `${executed.summary}; optional step skipped`,
        completed_at: ts(),
        error: executed.error,
        output: executed.data,
      }));
      continue;
    }

    updateStepResult(state, step.step_id, (current) => ({
      ...current,
      status: "failed",
      summary: executed.summary,
      completed_at: ts(),
      error: executed.error,
      output: executed.data,
    }));
    state.status = "failed";
    state.recovery_point = step.step_id;
    finalizePendingSteps(state);
    state.verification_status = computeVerificationStatus(state);
    await emitFlowFailedEvent(state, executed.error ?? executed.summary);
    writeState(state);
    return state;
  }

  state.status = "completed";
  state.current_step = null;
  state.recovery_point = null;
  finalizePendingSteps(state);
  state.verification_status = computeVerificationStatus(state);
  await emitFlowDoneEvent(state);
  writeState(state);
  return state;
}

export async function runFlowBySelection(
  selection: { flow_id?: string; phase?: string; intent?: string },
  options: FlowExecutionOptions = {},
): Promise<FlowStateRecord> {
  const manifest =
    (selection.flow_id ? getFlowById(selection.flow_id) : null) ??
    selectFlow(selection.phase, selection.intent);
  if (!manifest) {
    throw new Error("flow not found");
  }
  return runFlowManifest(manifest, options);
}

export async function resumeFlowRun(
  runId: string,
  options: FlowExecutionOptions = {},
): Promise<FlowStateRecord> {
  const state = readFlowState(runId);
  if (!state) throw new Error(`flow state not found: ${runId}`);
  const manifest = getFlowById(state.flow_id);
  if (!manifest) throw new Error(`flow manifest not found: ${state.flow_id}`);
  return runFlowManifest(
    manifest,
    {
      input_context: state.context,
      stop_before_ai: options.stop_before_ai,
      dry_run: options.dry_run,
    },
    state,
  );
}

export async function applyFlowDecision(
  runId: string,
  options: ApplyFlowDecisionOptions = {},
): Promise<FlowStateRecord> {
  const state = readFlowState(runId);
  if (!state) throw new Error(`flow state not found: ${runId}`);
  const manifest = getFlowById(state.flow_id);
  if (!manifest) throw new Error(`flow manifest not found: ${state.flow_id}`);

  const steps = materializeSteps(manifest);
  const stepId = options.step_id ?? state.current_step ?? "";
  if (!stepId) throw new Error("no current ai_decision step to apply");

  const step = steps.find((entry) => entry.step_id === stepId);
  if (!step) throw new Error(`flow step not found: ${stepId}`);
  if (step.executor_type !== "ai_decision") {
    throw new Error(`step '${stepId}' is not an ai_decision step`);
  }

  const result = state.step_results.find((entry) => entry.step_id === stepId);
  if (!result) throw new Error(`flow step result not found: ${stepId}`);
  if (result.status === "completed") {
    return options.continue_after_apply === false
      ? state
      : resumeFlowRun(runId, {
          stop_before_ai: options.stop_before_ai,
        });
  }
  if (result.status !== "awaiting_ai" && result.status !== "pending") {
    throw new Error(`step '${stepId}' is not awaiting_ai`);
  }

  const decisionArtifacts = options.artifacts ?? [];
  const allowedArtifactTypes = new Set(step.writes_artifact ?? []);
  for (const artifact of decisionArtifacts) {
    if (allowedArtifactTypes.size > 0 && !allowedArtifactTypes.has(artifact.type)) {
      throw new Error(
        `artifact type '${artifact.type}' is not allowed for step '${stepId}'`,
      );
    }
  }
  const decisionViolations = [
    ...collectDecisionPayloadViolations(
      step,
      options.decision_output ?? null,
      decisionArtifacts.map((artifact) => artifact.type),
    ),
    ...collectDecisionArtifactViolations(step, decisionArtifacts),
  ];
  throwIfDecisionViolations(step.step_id, decisionViolations);

  state.status = "running";
  state.current_step = step.step_id;
  state.recovery_point = step.step_id;
  await ensureFlowStartedEvent(state, manifest);

  const artifactResults = await writeDecisionArtifacts(
    state,
    step,
    decisionArtifacts,
    steps.length,
  );
  const decisionPayload = {
    summary: options.summary ?? "AI decision applied",
    decision_output: options.decision_output ?? null,
    artifacts: artifactResults,
  };
  attachContextForStep(state, step, decisionPayload);
  updateStepResult(state, step.step_id, (current) => ({
    ...current,
    status: "completed",
    summary: options.summary ?? "AI decision applied",
    started_at: current.started_at ?? ts(),
    completed_at: ts(),
    output: decisionPayload,
    error: undefined,
  }));

  if (!state.completed_steps.includes(step.step_id)) {
    state.completed_steps.push(step.step_id);
  }
  for (const artifactResult of artifactResults) {
    if (!state.artifact_outputs.includes(artifactResult.path)) {
      state.artifact_outputs.push(artifactResult.path);
    }
  }

  finalizePendingSteps(state);
  state.verification_status = computeVerificationStatus(state);
  writeState(state);

  if (options.continue_after_apply === false) {
    return state;
  }

  return runFlowManifest(
    manifest,
    {
      input_context: state.context,
      stop_before_ai: options.stop_before_ai !== false,
    },
    state,
  );
}

export function summarizeFlowCatalog() {
  return loadFlowManifests().map((flow) => {
    const validation = validateFlowManifest(flow);
    return {
      flow_id: flow.flow_id,
      phase: flow.phase,
      intent: flow.intent,
      source_path: flow.source_path ? basename(flow.source_path) : null,
      required_inputs: flow.required_inputs,
      precheck_count: flow.prechecks.length,
      step_count: flow.steps.length,
      verification_count: flow.verifications.length,
      artifacts: flow.artifacts,
      next_phases: flow.next_phase_rules.map((rule) => rule.next_phase),
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  });
}
