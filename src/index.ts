import * as core from "@actions/core";
import * as github from "@actions/github";
import OpenAI from "openai";
import type { CommentSpec, Category, Severity } from "./types.ts";

export const SYSTEM_PROMPT =
  "You are a practical code reviewer. Be concise, direct, and non-technical. Focus on: bugs, logic errors, potential security issues, and practical improvements. Skip formatting, style, or cosmetic nitpicks. Write in plain language anyone can understand.";

export const STRUCTURED_SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the given PR diff and report concrete problems as a JSON array of structured findings.

Focus on: bugs, logic errors, security issues, performance problems, and best-practice violations. Skip formatting, style, or cosmetic nitpicks. Only report real, actionable issues — do not invent problems or pad with trivia.

For each finding you MUST provide:
- "file": the file path as shown in the diff
- "line": the line number in the NEW version of the file where the issue occurs (an integer)
- "category": one of "logic", "security", "performance", "best-practice", "test", "comment"
- "severity": one of "critical", "high", "medium", "low" (impact level: critical=exploit/data-loss/crash, high=likely bug, medium=probable issue, low=minor)
- "message": a concise plain-language description of the issue (1-2 sentences)
- "rationale": the reason this is a problem — the "why", including context or consequence (MANDATORY; never omit)
- "suggestion": optional concrete fix or next step

Rules (RIE essential criteria):
- Relevance: only comment on issues introduced or exposed by this diff.
- Informativeness: every finding must state the reason/context (rationale). Vague comments like "this is wrong" with no why are forbidden.
- Expression: be concise, objective, and precise.

Respond as JSON: {"findings": [ ... ]}. If there are no real issues, respond {"findings": []}.`;

export interface ReviewResult {
  review: string;
  usage: any;
}

export interface StructuredReviewResult {
  findings: CommentSpec[];
  usage: any;
}

const VALID_CATEGORIES: Category[] = ["logic", "security", "performance", "best-practice", "test", "comment"];
const VALID_SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

function coerceCategory(v: unknown): Category {
  const s = String(v ?? "").toLowerCase().trim().replace(/_/g, "-").replace(/\s+/g, "-");
  if (VALID_CATEGORIES.includes(s as Category)) return s as Category;
  if (s === "bug" || s === "correctness" || s === "error") return "logic";
  if (s === "perf") return "performance";
  if (s === "nit" || s === "style") return "comment";
  return "best-practice";
}

function coerceSeverity(v: unknown): Severity {
  const s = String(v ?? "").toLowerCase().trim();
  if (VALID_SEVERITIES.includes(s as Severity)) return s as Severity;
  if (s === "crit" || s === "blocker") return "critical";
  if (s === "warn" || s === "warning") return "high";
  if (s === "info" || s === "trivial") return "low";
  return "medium";
}

function coerceLine(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? "0").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function extractJson(content: string): any | null {
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
        return null;
      }
    }
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function parseFindings(content: string): CommentSpec[] {
  const parsed = extractJson(content);
  if (!parsed) return [];
  const arr: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed.findings) ? parsed.findings : [];
  const out: CommentSpec[] = [];
  for (const f of arr) {
    if (!f || typeof f !== "object") continue;
    const message = String(f.message ?? "").trim();
    if (!message) continue;
    out.push({
      file: String(f.file ?? f.path ?? f.filename ?? "unknown").trim(),
      line: coerceLine(f.line ?? f.lineNumber ?? f.startLine),
      category: coerceCategory(f.category ?? f.type),
      severity: coerceSeverity(f.severity),
      message,
      rationale: String(f.rationale ?? f.reason ?? f.context ?? "").trim(),
      suggestion: f.suggestion ? String(f.suggestion).trim() : undefined,
    });
  }
  return out;
}

export async function reviewDiff(
  diff: string,
  prTitle: string,
  prBody: string,
  apiKey: string,
  baseURL = "https://opencode.ai/zen/go/v1",
  model = "deepseek-v4-flash",
): Promise<ReviewResult> {
  const openai = new OpenAI({ baseURL, apiKey });

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `## PR: ${prTitle}\n\n${prBody}\n\n## Diff\n\n${diff}`,
      },
    ],
    stream: false,
  });

  const review = response.choices[0]?.message?.content;
  if (!review) {
    throw new Error("No review content returned from OpenCode");
  }
  return { review, usage: response.usage };
}

export async function reviewDiffStructured(
  diff: string,
  prTitle: string,
  prBody: string,
  apiKey: string,
  baseURL = "https://opencode.ai/zen/go/v1",
  model = "deepseek-v4-flash",
): Promise<StructuredReviewResult> {
  const openai = new OpenAI({ baseURL, apiKey });

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: STRUCTURED_SYSTEM_PROMPT },
      {
        role: "user",
        content: `## PR: ${prTitle}\n\n${prBody}\n\n## Diff\n\n\`\`\`diff\n${diff}\n\`\`\``,
      },
    ],
    stream: false,
    temperature: 0.1,
    response_format: { type: "json_object" as const },
  });

  const content = response.choices[0]?.message?.content ?? "";
  const findings = parseFindings(content);
  if (findings.length === 0 && content.trim().length > 0) {
    core.info(`[reviewDiffStructured] warning: parsed 0 findings from non-empty response`);
  }
  return { findings, usage: response.usage };
}

export function formatTokenFooter(usage: any): string {
  const input = usage?.prompt_tokens;
  const cached = usage?.prompt_tokens_details?.cached_tokens;
  const output = usage?.completion_tokens;

  const inStr = input != null ? String(input) : "Error fetching the data";
  const cachedStr = cached != null ? String(cached) : "Error fetching the data";
  const uncachedStr =
    input != null && cached != null
      ? String(input - cached)
      : "Error fetching the data";
  const outStr = output != null ? String(output) : "Error fetching the data";

  return `**Tokens:** ${inStr} in (${cachedStr} cached · ${uncachedStr} uncached) · ${outStr} out`;
}

export function buildReviewBody(review: string, usage: any): string {
  return `## OpenCode Code Review\n\n${review}\n\n---\n${formatTokenFooter(usage)}`;
}

async function run(): Promise<void> {
  try {
    const opencodeApiKey = core.getInput("opencode_api_key", {
      required: true,
    });
    const { owner, repo } = github.context.repo;
    const prNumber = github.context.issue.number;
    const pr = github.context.payload.pull_request;

    if (!pr) {
      core.setFailed("This action must be triggered by a pull_request event");
      return;
    }

    const ghToken = core.getInput("github_token", { required: true });
    const octokit = github.getOctokit(ghToken);
    core.info(`Fetching diff for PR #${prNumber} in ${owner}/${repo}`);

    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });

    const diff = files
      .map(
        (f) =>
          `### ${f.filename} (${f.status})\n\`\`\`diff\n${f.patch || "Binary or empty"}\n\`\`\``,
      )
      .join("\n\n");

    const prTitle = pr.title;
    const prBody = pr.body || "No description provided.";

    core.info(`Sending ${files.length} files to OpenCode for review...`);

    const { review, usage } = await reviewDiff(
      diff,
      prTitle,
      prBody,
      opencodeApiKey,
    );
    const reviewBody = buildReviewBody(review, usage);

    core.info("Looking for existing review comment...");
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    const existing = comments.find(
      (c) =>
        c.user?.login === "github-actions[bot]" &&
        (c.body ?? "").startsWith("## OpenCode Code Review"),
    );

    if (existing) {
      core.info(`Updating existing comment #${existing.id}...`);
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body: reviewBody,
      });
    } else {
      core.info("Posting new review comment...");
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: reviewBody,
      });
    }

    core.info("Review posted successfully");
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : "Unknown error");
  }
}

if (process.env.GITHUB_ACTIONS === "true") {
  run();
}
