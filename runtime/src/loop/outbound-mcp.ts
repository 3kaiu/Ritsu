import { existsSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot } from "../handlers/_utils.js";

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

/**
 * Sends a notification to Slack.
 * Falls back to local log if SLACK_WEBHOOK_URL is not set.
 */
export async function notifySlack(message: string): Promise<boolean> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    logLocalEvent("slack-notifications.log", `SLACK NOTIFICATION: ${message}`);
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    return response.ok;
  } catch (err) {
    console.error(`[ritsu-outbound] Failed to send Slack notification:`, err);
    return false;
  }
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
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    logLocalEvent(
      "github-actions.log",
      `GITHUB PR COMMENT (${owner}/${repo}#${prNumber}): ${comment}`,
    );
    return false;
  }

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
    return response.ok;
  } catch (err) {
    console.error(`[ritsu-outbound] Failed to post GitHub comment:`, err);
    return false;
  }
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
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    logLocalEvent(
      "github-actions.log",
      `GITHUB COMMIT STATUS (${owner}/${repo}@${sha.substring(0, 7)}): [${state}] ${description} (context: ${context})`,
    );
    return false;
  }

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
        description: description.substring(0, 140), // GitHub limits description to 140 chars
        context,
        target_url: targetUrl,
      }),
    });
    return response.ok;
  } catch (err) {
    console.error(`[ritsu-outbound] Failed to post GitHub status:`, err);
    return false;
  }
}
