export type Severity = "fatal" | "error" | "warn" | "hard_stop";

export interface PolicyViolation {
  rule_id: string;
  severity: Severity;
  message: string;
  evidence?: string;
  suggestion?: string;
  confidence?: number; // 0-1
}

export interface PolicyRule {
  id: string;
  name: string;
  severity: Severity;
  detector?: DetectorConfig;
  exemption?: ExemptionConfig[];
}

export type DetectorType =
  | "regex"
  | "cross_file"
  | "scope_diff"
  | "contract_coverage"
  | "preference_lint"
  | "ast_grep"
  | "ast";

export interface DetectorConfig {
  type: DetectorType;
  target?: "artifact_content" | "diff";
  patterns?: string[];
  [key: string]: unknown;
}

export interface ExemptionConfig {
  when: {
    skill?: string;
    target_file?: string;
  };
}

export interface PolicyCheckContext {
  action: "write_artifact" | "emit_event" | "commit_diff";
  target?: string;
  content?: string;
  context?: {
    skill?: string;
    correlation_id?: string;
    in_scope_files?: string[];
    /** Relative paths for ast-grep and other file-scoped detectors */
    scan_files?: string[];
  };
}

export interface DetectorPlugin {
  type: DetectorType;
  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[];
}
