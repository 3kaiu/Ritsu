export type CtxEvent = {
  ts: string;
  correlation_id: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  span_kind?: "root" | "internal";
  skill: string;
  domain: string;
  status: "started" | "done" | "failed" | "artifact_written" | "violation_detected";
  step?: string;
  artifact?: string;
  artifact_meta?: {
    type?: string;
    canonical_type?: string;
    layer?: string;
    size_bytes?: number;
    summary?: string;
  };
  error?: string;
  cost?: {
    tokens_in?: number;
    tokens_out?: number;
    model?: string;
    duration_ms?: number;
  };
  violation?: {
    rule_id: string;
    severity: string;
    evidence?: string;
    blocked?: boolean;
  };
};

export type ArtifactWrittenCtxEvent = CtxEvent & {
  status: "artifact_written";
  artifact_meta?: NonNullable<CtxEvent["artifact_meta"]>;
};

export type TraceSpanNode = {
  id: string;
  parent?: string;
  events: CtxEvent[];
  children?: TraceSpanNode[];
};

export type RuntimeMetadata = {
  packageVersion: string | null;
  protocolVersion: string | null;
};

export type TaskSummary = {
  skill: string;
  domain: string;
  startTs: string;
  endTs?: string;
  status: "in_progress" | "completed" | "failed";
  artifacts: string[];
  error?: string;
  totalTokensIn: number;
  totalTokensOut: number;
};
