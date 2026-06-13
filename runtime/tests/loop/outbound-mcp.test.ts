import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  notifySlack,
  postGithubPrComment,
  postGithubCommitStatus,
} from "../../src/loop/outbound-mcp.js";
import { existsSync, rmSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("outbound mcp notifications", () => {
  let testRoot: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-outbound-"));
    originalEnv = { ...process.env };
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe("offline fallback mode", () => {
    it("logs Slack notifications locally if SLACK_WEBHOOK_URL is missing", async () => {
      delete process.env.SLACK_WEBHOOK_URL;
      const success = await notifySlack("Hello Slack!");
      
      expect(success).toBe(false);
      const logPath = join(testRoot, ".ritsu", "slack-notifications.log");
      expect(existsSync(logPath)).toBe(true);
      const content = readFileSync(logPath, "utf-8");
      expect(content).toContain("SLACK NOTIFICATION: Hello Slack!");
    });

    it("logs GitHub PR comments locally if GITHUB_TOKEN is missing", async () => {
      delete process.env.GITHUB_TOKEN;
      const success = await postGithubPrComment("owner", "repo", 42, "PR comment text");

      expect(success).toBe(false);
      const logPath = join(testRoot, ".ritsu", "github-actions.log");
      expect(existsSync(logPath)).toBe(true);
      const content = readFileSync(logPath, "utf-8");
      expect(content).toContain("GITHUB PR COMMENT (owner/repo#42): PR comment text");
    });

    it("logs GitHub statuses locally if GITHUB_TOKEN is missing", async () => {
      delete process.env.GITHUB_TOKEN;
      const success = await postGithubCommitStatus("owner", "repo", "sha123456", "success", "All green!");

      expect(success).toBe(false);
      const logPath = join(testRoot, ".ritsu", "github-actions.log");
      expect(existsSync(logPath)).toBe(true);
      const content = readFileSync(logPath, "utf-8");
      expect(content).toContain("GITHUB COMMIT STATUS (owner/repo@sha1234): [success] All green!");
    });
  });

  describe("online mode (using fetch mock)", () => {
    beforeEach(() => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/test";
      process.env.GITHUB_TOKEN = "test-token";
    });

    it("sends fetch request for Slack notification", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      globalThis.fetch = fetchMock;

      const success = await notifySlack("Online notification");
      expect(success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/test",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ text: "Online notification" }),
        })
      );
    });

    it("sends fetch request to post GitHub PR comment", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      globalThis.fetch = fetchMock;

      const success = await postGithubPrComment("3kaiu", "Ritsu", 12, "Review completed");
      expect(success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.github.com/repos/3kaiu/Ritsu/issues/12/comments",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "token test-token",
          }),
          body: JSON.stringify({ body: "Review completed" }),
        })
      );
    });
  });
});
