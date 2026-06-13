import { existsSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot } from "../handlers/_utils.js";
import { checkSideEffect, recordSideEffect } from "../context-lifecycle.js";

function logLocalEvent(filename: string, content: string): void {
  const root = getProjectRoot();
  const dir = resolve(root, ".ritsu");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const logFile = resolve(dir, filename);
  const timestamp = new Date().toISOString();
  appendFileSync(logFile, `[${timestamp}] ${content}\n`, "utf-8");
}

function getTraceParent(): { traceId: string; iteration: number } | null {
  const traceParent = process.env.RITSU_TRACE_PARENT;
  if (!traceParent) return null;
  const [traceId, iterationStr] = traceParent.split(":");
  const iteration = parseInt(iterationStr, 10);
  if (traceId && !isNaN(iteration)) {
    return { traceId, iteration };
  }
  return null;
}

/**
 * Sends a notification to Slack.
 * Falls back to local log if SLACK_WEBHOOK_URL is not set.
 */
export async function notifySlack(message: string): Promise<boolean> {
  const root = getProjectRoot();
  const trace = getTraceParent();
  const toolArgs = { message };
  
  if (trace) {
    const cached = checkSideEffect(root, trace.traceId, trace.iteration, "notifySlack", toolArgs);
    if (cached !== null) {
      console.error(`[ritsu-idempotency] Bypassing notifySlack (already run in this iteration).`);
      return cached;
    }
  }

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  let res: boolean;
  
  if (!webhookUrl) {
    logLocalEvent("slack-notifications.log", `SLACK NOTIFICATION: ${message}`);
    res = false;
  } else {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
      });
      res = response.ok;
    } catch (err) {
      console.error(`[ritsu-outbound] Failed to send Slack notification:`, err);
      res = false;
    }
  }

  if (trace) {
    recordSideEffect(root, trace.traceId, trace.iteration, "notifySlack", toolArgs, res);
  }
  return res;
}

/**
 * Posts a comment on a GitHub Pull Request.
 * Falls back to local log if GITHUB_TOKEN is not set.
 */
export async function postGithubPrComment(
  owner: string,
  repo: string,
  prNumber: number,
  comment: string,
): Promise<boolean> {
  const root = getProjectRoot();
  const trace = getTraceParent();
  const toolArgs = { owner, repo, prNumber, comment };

  if (trace) {
    const cached = checkSideEffect(root, trace.traceId, trace.iteration, "postGithubPrComment", toolArgs);
    if (cached !== null) {
      console.error(`[ritsu-idempotency] Bypassing postGithubPrComment (already run in this iteration).`);
      return cached;
    }
  }

  const token = process.env.GITHUB_TOKEN;
  let res: boolean;

  if (!token) {
    logLocalEvent(
      "github-actions.log",
      `GITHUB PR COMMENT (${owner}/${repo}#${prNumber}): ${comment}`,
    );
    res = false;
  } else {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Ritsu-Outbound-Bridge",
        },
        body: JSON.stringify({ body: comment }),
      });
      res = response.ok;
    } catch (err) {
      console.error(`[ritsu-outbound] Failed to post GitHub comment:`, err);
      res = false;
    }
  }

  if (trace) {
    recordSideEffect(root, trace.traceId, trace.iteration, "postGithubPrComment", toolArgs, res);
  }
  return res;
}

/**
 * Updates commit status on GitHub.
 * Falls back to local log if GITHUB_TOKEN is not set.
 */
export async function postGithubCommitStatus(
  owner: string,
  repo: string,
  sha: string,
  state: "error" | "failure" | "pending" | "success",
  description: string,
  context = "ritsu/loop-quality-gate",
  targetUrl?: string,
): Promise<boolean> {
  const root = getProjectRoot();
  const trace = getTraceParent();
  const toolArgs = { owner, repo, sha, state, description, context, targetUrl };

  if (trace) {
    const cached = checkSideEffect(root, trace.traceId, trace.iteration, "postGithubCommitStatus", toolArgs);
    if (cached !== null) {
      console.error(`[ritsu-idempotency] Bypassing postGithubCommitStatus (already run in this iteration).`);
      return cached;
    }
  }

  const token = process.env.GITHUB_TOKEN;
  let res: boolean;

  if (!token) {
    logLocalEvent(
      "github-actions.log",
      `GITHUB COMMIT STATUS (${owner}/${repo}@${sha.substring(0, 7)}): [${state}] ${description} (context: ${context})`,
    );
    res = false;
  } else {
    const url = `https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Ritsu-Outbound-Bridge",
        },
        body: JSON.stringify({
          state,
          description: description.substring(0, 140),
          context,
          target_url: targetUrl,
        }),
      });
      res = response.ok;
    } catch (err) {
      console.error(`[ritsu-outbound] Failed to post GitHub status:`, err);
      res = false;
    }
  }

  if (trace) {
    recordSideEffect(root, trace.traceId, trace.iteration, "postGithubCommitStatus", toolArgs, res);
  }
  return res;
}
