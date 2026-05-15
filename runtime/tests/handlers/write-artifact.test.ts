import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/policy/index.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    evaluatePolicies: vi.fn((ctx: any) => {
      if (ctx.content && ctx.content.includes("TODO")) {
        return {
          passed: false,
          violations: [
            { severity: "hard_stop", message: "content contains placeholder", rule_id: "HC-2" }
          ]
        };
      }
      return { passed: true, violations: [] };
    })
  };
});

import { ritsu_write_artifact } from "../../src/handlers/write-artifact.js";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

describe("ritsu_write_artifact", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-write-artifact-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should block content with placeholders", async () => {
    const params = {
      type: "design-sheet",
      filename: "design-sheet-test.md",
      content: "## 1. 任务识别 (Intake)\n- 任务类型: TODO\n- 当前目标: 待定",
    };

    const result = await ritsu_write_artifact(params);
    expect(result.content[0].text).toContain("[HC-2] content contains placeholder");
  });

  it("should allow content with words like TodoMVC (false positive fix)", async () => {
    const params = {
      type: "design-sheet",
      filename: "design-sheet-todomvc.md",
      content: "## 1. 任务识别 (Intake)\n- 任务类型: 新功能\n- 当前目标: 参考 TodoMVC 实现\n- 风险等级: standard\n## 2. 方案与边界 (Plan)\n- 交付目标: 完成\n- 纳入范围: 全部\n- 不纳入范围: 无\n## 3. 技术契约 (Contract)\n- API / 接口契约: n/a\n- 数据模型: n/a\n- 组件契约: n/a\n## 4. 决策理由 (Decision Rationale)\n- 关键决策: n/a\n- 被拒绝方案: n/a\n## 5. 代价与风险 (Metrics & Risks)\n- 回滚步骤: n/a\n## 6. 实施清单 (Execution)\n- 实施步骤:\n  - [ ] `test.ts`: init\n- 验证计划: manual",
    };

    const result = await ritsu_write_artifact(params);
    if (result.isError) {
        expect(result.content[0].text).not.toContain("[HC-2] content contains placeholder");
    } else {
        expect(result.isError).toBeUndefined();
    }
  });

  it("should validate artifact schema sections", async () => {
    const params = {
      type: "design-sheet",
      filename: "design-sheet-invalid.md",
      content: "Short content",
    };

    const result = await ritsu_write_artifact(params);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ArtifactValidationError");
  });

  it("should write artifact successfully if valid", async () => {
    const filename = "design-sheet-valid.md";
    const params = {
      type: "design-sheet",
      filename,
      content: "## 1. 任务识别 (Intake)\n- 任务类型: 新功能\n- 当前目标: test\n- 风险等级: standard\n## 2. 方案与边界 (Plan)\n- 交付目标: test\n- 纳入范围: test\n- 不纳入范围: test\n## 3. 技术契约 (Contract)\n- API / 接口契约: test\n- 数据模型: test\n- 组件契约: test\n## 4. 决策理由 (Decision Rationale)\n- 关键决策: test\n- 被拒绝方案: test\n## 5. 代价与风险 (Metrics & Risks)\n- 回滚步骤: test\n## 6. 实施清单 (Execution)\n- 实施步骤:\n  - [ ] `index.ts`: test\n- 验证计划: test",
    };

    const result = await ritsu_write_artifact(params);
    if (result.isError) {
      console.error("WRITE ERROR:", result.content[0].text);
    }
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(existsSync(data.path)).toBe(true);
  });
});
