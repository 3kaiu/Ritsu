import { describe, it, expect } from "vitest";
import { formatEvent, formatSkill, usage } from "../src/cli.js";

describe("cli utilities", () => {
  it("provides usage information", () => {
    const text = usage();
    expect(text).toContain("ritsu cat");
    expect(text).toContain("ENV:");
  });

  it("formats skill names", () => {
    expect(formatSkill("think")).toBe("think");
  });

  it("formats events into strings", () => {
    const event: any = {
      ts: "20260515-120000",
      correlation_id: "cid-1",
      skill: "think",
      domain: "fullstack",
      status: "done"
    };
    const output = formatEvent(event).replace(/\u001b\[\d+m/g, "");
    expect(output).toContain("cid-1");
    expect(output).toContain("think");
    expect(output).toContain("done");
  });

  it("includes optional fields in event output", () => {
    const event: any = {
      ts: "20260515-120000",
      correlation_id: "cid-1",
      skill: "dev",
      domain: "frontend",
      status: "artifact_written",
      step: "1/2",
      artifact: "test.md"
    };
    const output = formatEvent(event).replace(/\u001b\[\d+m/g, "");
    expect(output).toContain("step:1/2");
    expect(output).toContain("artifact:test.md");
  });
});
