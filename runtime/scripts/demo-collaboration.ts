import { ritsu_init_trust_key } from "../src/handlers/init-trust-key.js";
import { ritsu_open_span } from "../src/handlers/open-span.js";
import { ritsu_write_artifact } from "../src/handlers/write-artifact.js";
import { ritsu_list_pending_tasks, ritsu_claim_task } from "../src/handlers/task-protocol.js";
import { ritsu_claim_file, ritsu_release_file } from "../src/handlers/file-lease.js";
import { ritsu_close_span } from "../src/handlers/close-span.js";
import { ritsu_verify_trace } from "../src/handlers/verify-trace.js";
import { existsSync, rmSync } from "node:fs";

/**
 * In-process Ritsu MCP handlers demo (trace, lease, task claim).
 */
async function runDemo() {
  console.log("🚀 Starting Multi-Agent Collaboration Demo...");
  
  // 1. Init Key
  await ritsu_init_trust_key({});
  console.log("✅ Trust key initialized.");

  // 2. Planner: Open Root Span & Write Coordination Sheet
  const rootRes = await ritsu_open_span({ skill: "think", domain: "fullstack", name: "Multi-Agent Mission", step: "1/1" });
  const rootData = JSON.parse((rootRes.content[0] as any).text);
  if (rootData.error) {
    console.error("❌ open_span failed:", rootData.message || rootData.error);
    process.exit(1);
  }
  const { trace_id, span_id: root_span } = rootData;
  
  const sheetContent = `## Intent & Trace\n- Original Goal: Test Multi-Agent\n- Trace ID: ${trace_id}\n\n## Child Spans\n- Span Declarations:\n| Span ID | Agent Role | Sub-task Description | Priority |\n| --- | --- | --- | --- |\n| span-fe-01 | frontend | Implement UI | P0 |\n| span-be-01 | backend | Implement API | P0 |\n\n## Handoff Matrix\n- Dependencies: None\n- Shared Context: API Spec v1\n`;
  const writeRes = await ritsu_write_artifact({ 
    type: "coordination-sheet", 
    filename: "coordination-sheet-01.md", 
    content: sheetContent,
    artifact_meta: { type: "coordination-sheet", size_bytes: sheetContent.length, summary: "Task breakdown" }
  });
  console.log("✅ writeRes:", JSON.stringify(writeRes.content[0]));
  console.log("✅ Coordination sheet written.");

  // 3. Worker FE: List & Claim
  const listRes = await ritsu_list_pending_tasks({});
  const { tasks } = JSON.parse((listRes.content[0] as any).text);
  console.log(`✅ Pending tasks: ${tasks.length}`);

  await ritsu_claim_task({ span_id: "span-fe-01", agent_id: "agent-fe-01" });
  console.log("✅ Task span-fe-01 claimed.");

  // 4. Worker FE: Claim File & Work
  await ritsu_claim_file({ path: "src/ui.ts", span_id: "span-fe-01" });
  console.log("✅ File src/ui.ts locked.");

  // 5. Worker FE: Finish
  await ritsu_close_span({ trace_id, span_id: "span-fe-01", status: "done", skill: "dev", domain: "frontend", step: "1/1" });
  console.log("✅ Span span-fe-01 closed. Leases should be auto-released.");

  // 6. Verify Trace
  const verifyRes = await ritsu_verify_trace({ trace_id });
  const verify = JSON.parse((verifyRes.content[0] as any).text);
  console.log(`✅ Trace verification: ${verify.valid ? "PASSED" : "FAILED"} (${verify.violation_count} violations)`);

  if (verify.valid) {
    console.log("🎉 Integration Test Successful!");
  } else {
    console.error("❌ Integration Test Failed!");
    process.exit(1);
  }
}

runDemo().catch(console.error);
