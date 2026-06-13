import { runExecutionLoop } from "./execution-loop.js";
import { evaluatePolicies } from "../policy/index.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getProjectRoot } from "../handlers/_utils.js";

export interface ThinkLoopConfig {
  goal: string;
  targetDesignPath?: string;
  maxIterations?: number;
  tokenBudget?: number;
  timeoutMs?: number;
}

/**
 * Think Loop: generates and refines design sheet, verifying it against DDD,
 * Clean Architecture, naming conventions, utility sprawl, and dead designs.
 */
export async function runThinkLoop(config: ThinkLoopConfig): Promise<{ passed: boolean; reason: string }> {
  const root = getProjectRoot();
  const targetDesignPath = config.targetDesignPath ?? resolve(root, ".ritsu/design-sheet.md");
  
  const ritsuDir = dirname(targetDesignPath);
  if (!existsSync(ritsuDir)) {
    mkdirSync(ritsuDir, { recursive: true });
  }

  // Pre-scaffold a basic design sheet template if it doesn't exist
  if (!existsSync(targetDesignPath)) {
    const defaultTemplate = `# Design Sheet - Feature Design
Goal: ${config.goal}

## 1. 目标 (Goal)
Implement the feature requested.

## 2. 范围 (Scope)
- In Scope:
  - runtime/src/cli/daemon.ts
- Out of Scope:
  - None

## 3. 算法与数据结构评估 (Algorithms & Data Structures)
Evaluate alternative approaches:
- **Option A (Array Scan)**:
  - Time Complexity: O(N)
  - Space Complexity: O(1)
- **Option B (Hash Map Index) [Selected]**:
  - Time Complexity: O(1) average lookup
  - Space Complexity: O(N) memory
- **Comparison**: Option B is chosen for sub-millisecond lookup latency, trading off minimal space.

## 4. 架构方案折中矩阵 (Architectural Options & Trade-off Matrix)
We compare the following design patterns:
- **Alternative 1 (REST Polling)**:
  - Pros: Simple to implement.
  - Cons: High polling overhead.
- **Alternative 2 (WebSocket Connection) [Selected]**:
  - Pros: Real-time, low latency.
  - Cons: Requires persistent connection management.
- **Decision Matrix**: Alternative 2 is selected as real-time updates are a core product requirement.

## 6. 实施清单 (Execution)
### Verification Plan
- contracts:
  id: C1
  description: Dummy contract for feature
  test_file_hint: tests/dummy.test.ts
`;
    writeFileSync(targetDesignPath, defaultTemplate, "utf-8");
  }

  const verifyFn = async (iteration: number) => {
    console.error(`[ritsu-think-loop] Verifying design sheet (iteration ${iteration})...`);
    
    if (!existsSync(targetDesignPath)) {
      return {
        passed: false,
        reason: `Design sheet file does not exist at '${targetDesignPath}'`,
        tokensUsed: 0,
        fixableByRetry: true,
      };
    }

    const content = readFileSync(targetDesignPath, "utf-8");
    
    const policyResult = evaluatePolicies({
      action: "write_artifact",
      target: "design-sheet",
      content: content,
      context: {
        skill: "think",
      }
    });

    if (!policyResult.passed) {
      const reasons = policyResult.violations
        .map((v) => `- [${v.rule_id}] ${v.message} Suggestion: ${v.suggestion ?? "Please fix the violation."}`)
        .join("\n");
      
      return {
        passed: false,
        reason: `Design verification failed with policy violations:\n${reasons}`,
        tokensUsed: 100,
        fixableByRetry: true,
      };
    }

    return {
      passed: true,
      reason: "Design sheet successfully passed all Clean Architecture & DDD guardrail checks.",
      tokensUsed: 100,
      fixableByRetry: false,
    };
  };

  const result = await runExecutionLoop({
    goal: `Create a clean architectural design at ${targetDesignPath} for goal: "${config.goal}". Enforce DDD, Clean Architecture, proper file naming, no micro-file sprawl, and no dead designs.`,
    skill: "think",
    tier: "P1",
    maxIterations: config.maxIterations ?? 3,
    tokenBudget: config.tokenBudget ?? 100_000,
    timeoutMs: config.timeoutMs ?? 180_000,
    verifyFn,
  });

  return {
    passed: result.passed,
    reason: result.reason,
  };
}
