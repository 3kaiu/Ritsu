import { describe, expect, it } from "vitest";
import {
  extractContractsFromProposal,
  buildMinimalDesignSheet,
} from "../src/openspec-bridge.js";

describe("openspec-bridge", () => {
  it("extracts bullets from requirements section", () => {
    const md = `# Proposal

## Requirements
- User can reset password via email link
- Rate limit login attempts to 5 per minute
`;
    const contracts = extractContractsFromProposal(md, "add-auth");
    expect(contracts.length).toBeGreaterThanOrEqual(2);
    expect(contracts[0].id).toBe("OS-add-auth-1");
    expect(contracts[0].test_file_hint).toContain("add-auth");
  });

  it("builds minimal design sheet with contract table", () => {
    const sheet = buildMinimalDesignSheet("feat-x", [
      {
        id: "OS-feat-x-1",
        description: "Do the thing",
        test_file_hint: "openspec/changes/feat-x/",
        openspec_ref: "proposal.md",
      },
    ], "openspec/changes/feat-x/proposal.md");
    expect(sheet).toContain("OS-feat-x-1");
    expect(sheet).toContain("Design Sheet");
  });
});
