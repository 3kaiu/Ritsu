import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { evaluatePolicies } from "../../src/policy/index.js";
import { getProjectRoot } from "../../src/handlers/_utils.js";

describe("DesignArchitectureDetector", () => {
  it("should detect DA-1 (DDD Layer Violation) for naming violations", () => {
    const content = `
# Design Sheet
- Proposed files:
  - runtime/src/domain/user-db.ts
  - runtime/src/domain/user.entity.ts
`;
    const result = evaluatePolicies({
      action: "write_artifact",
      target: "design-sheet",
      content,
      context: { skill: "think" },
    });

    expect(result.passed).toBe(false);
    const v = result.violations.find((violation) => violation.rule_id === "DA-1");
    expect(v).toBeDefined();
    expect(v?.message).toContain("contains infrastructure concepts");
  });

  it("should detect DA-1 (DDD Layer Violation) for dependency declarations", () => {
    const content = `
# Design Sheet
The Domain calls Infrastructure modules directly to fetch users.
`;
    const result = evaluatePolicies({
      action: "write_artifact",
      target: "design-sheet",
      content,
      context: { skill: "think" },
    });

    expect(result.passed).toBe(false);
    const v = result.violations.find((violation) => violation.rule_id === "DA-1");
    expect(v).toBeDefined();
    expect(v?.message).toContain("Domain layer depends directly on Infrastructure");
  });

  it("should detect DA-2 (Generic Utility Sprawl)", () => {
    const content = `
# Design Sheet
- Proposed files:
  - runtime/src/utils.ts
`;
    const result = evaluatePolicies({
      action: "write_artifact",
      target: "design-sheet",
      content,
      context: { skill: "think" },
    });

    expect(result.passed).toBe(false);
    const v = result.violations.find((violation) => violation.rule_id === "DA-2");
    expect(v).toBeDefined();
    expect(v?.message).toContain("Avoid creating generic top-level 'utils.ts'");
  });

  it("should detect DA-3 (Micro-File Sprawl)", () => {
    const content = `
# Design Sheet
- Proposed files:
  - runtime/src/domain/types/t1.ts
  - runtime/src/domain/types/t2.ts
  - runtime/src/domain/types/t3.ts
  - runtime/src/domain/types/t4.ts
  - runtime/src/domain/types/t5.ts
  - runtime/src/domain/types/t6.ts
`;
    const result = evaluatePolicies({
      action: "write_artifact",
      target: "design-sheet",
      content,
      context: { skill: "think" },
    });

    expect(result.passed).toBe(false);
    const v = result.violations.find((violation) => violation.rule_id === "DA-3");
    expect(v).toBeDefined();
    expect(v?.message).toContain("Consider consolidating into cohesive modules");
  });

  it("should detect DA-4 (Dead Design Guard)", () => {
    // Only mentioned once in the proposed list, never referenced in contracts
    const content = `
# Design Sheet
Proposed files:
- runtime/src/domain/user.ts
`;
    const result = evaluatePolicies({
      action: "write_artifact",
      target: "design-sheet",
      content,
      context: { skill: "think" },
    });

    expect(result.passed).toBe(false);
    const v = result.violations.find((violation) => violation.rule_id === "DA-4");
    expect(v).toBeDefined();
    expect(v?.message).toContain("has no defined consumer or client references");
  });

  it("should detect DA-5 (Algorithmic Complexity Validation) when Big-O is missing", () => {
    const content = `
# Design Sheet
We will scan the list to find the items. No alternative options.
`;
    const result = evaluatePolicies({
      action: "write_artifact",
      target: "design-sheet",
      content,
      context: { skill: "think" },
    });

    expect(result.passed).toBe(false);
    const v = result.violations.find((violation) => violation.rule_id === "DA-5");
    expect(v).toBeDefined();
    expect(v?.message).toContain("time and space complexities");
  });

  it("should detect DA-6 (Architectural Option Evaluation) when tradeoff matrix is missing", () => {
    const content = `
# Design Sheet
Time Complexity: O(N)
Space Complexity: O(1)
No alternative architectures considered. Just REST polling.
`;
    const result = evaluatePolicies({
      action: "write_artifact",
      target: "design-sheet",
      content,
      context: { skill: "think" },
    });

    expect(result.passed).toBe(false);
    const v = result.violations.find((violation) => violation.rule_id === "DA-6");
    expect(v).toBeDefined();
    expect(v?.suggestion).toContain("Alternative Architectures");
  });

  it("should pass when design conforms to all guidelines", () => {
    const content = `
# Design Sheet - Clean Design
Goal: Implement User Profile

- Proposed files:
  - runtime/src/domain/user.ts
  - runtime/src/infrastructure/user-db.ts

## 1. 目标 (Goal)
Implement clean user domains.

## 3. 算法评估 (Algorithms)
- Option A: Time O(N), Space O(1).
- Option B: Time O(1), Space O(N) vs Option A.

## 4. 架构折中矩阵 (Trade-off Matrix)
We compare alternatives:
- Alternative 1 (polling): simple but high cost.
- Alternative 2 (websocket) [Selected]: real-time vs polling.

## 6. 实施清单 (Execution)
We will implement the user.ts domain module.
Then we write the user-db.ts infrastructure module.

- contracts:
  - id: C1
    description: Get user domain model
    test_file_hint: tests/user.test.ts
`;
    const result = evaluatePolicies({
      action: "write_artifact",
      target: "design-sheet",
      content,
      context: { skill: "think" },
    });

    if (!result.passed) {
      console.log("Violations:", JSON.stringify(result.violations, null, 2));
    }
    expect(result.passed).toBe(true);
  });

  describe("DA-7 MasterGo D2C Integration", () => {
    const root = getProjectRoot();
    const specPath = resolve(root, "d2c-spec.json");

    afterEach(() => {
      if (existsSync(specPath)) {
        try {
          unlinkSync(specPath);
        } catch { /* ignore */ }
      }
    });

    it("should fail DA-7 if MasterGo content is provided but d2c-spec.json is missing", () => {
      const content = `
# Design Sheet
Goal: Implement screen based on https://mastergo.com/file/12345
`;
      if (existsSync(specPath)) {
        unlinkSync(specPath);
      }

      const result = evaluatePolicies({
        action: "write_artifact",
        target: "design-sheet",
        content,
        context: { skill: "think" },
      });

      expect(result.passed).toBe(false);
      const v = result.violations.find((violation) => violation.rule_id === "DA-7");
      expect(v).toBeDefined();
      expect(v?.message).toContain("d2c-spec.json' does not exist");
    });

    it("should fail DA-7 if d2c-spec.json exists but is not referenced in the design sheet", () => {
      const content = `
# Design Sheet
Goal: Implement screen based on https://mastergo.com/file/12345
`;
      // Create the spec file
      writeFileSync(specPath, JSON.stringify({ version: "1.0.0", nodes: [] }));

      const result = evaluatePolicies({
        action: "write_artifact",
        target: "design-sheet",
        content,
        context: { skill: "think" },
      });

      expect(result.passed).toBe(false);
      const v = result.violations.find((violation) => violation.rule_id === "DA-7");
      expect(v).toBeDefined();
      expect(v?.message).toContain("exists but is not referenced or integrated");
    });

    it("should pass DA-7 if d2c-spec.json exists and is referenced in the design sheet", () => {
      const content = `
# Design Sheet
Goal: Implement screen based on https://mastergo.com/file/12345
We integrate the design requirements specified in [d2c-spec.json](file:///Users/edy/CascadeProjects/Ritsu/d2c-spec.json).

## 3. 算法与数据结构评估 (Algorithms)
- Option A: Time O(N), Space O(1).
- Option B: Time O(1), Space O(N) vs Option A.

## 4. 架构方案折中矩阵 (Trade-off Matrix)
We compare alternatives:
- Alternative 1 (polling): simple but high cost.
- Alternative 2 (websocket) [Selected]: real-time vs polling.
`;
      // Create the spec file
      writeFileSync(specPath, JSON.stringify({ version: "1.0.0", nodes: [] }));

      const result = evaluatePolicies({
        action: "write_artifact",
        target: "design-sheet",
        content,
        context: { skill: "think" },
      });

      const v = result.violations.find((violation) => violation.rule_id === "DA-7");
      expect(v).toBeUndefined();
    });
  });
});
