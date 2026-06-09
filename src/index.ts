import * as core from "@actions/core";
import * as github from "@actions/github";
import OpenAI from "openai";

function formatTokenFooter(usage: any): string {
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

async function run(): Promise<void> {
  try {
    const deepseekApiKey = core.getInput("deepseek_api_key", { required: true });
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

    core.info(`Sending ${files.length} files to DeepSeek for review...`);

    const openai = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey: deepseekApiKey,
    });

    const response = await openai.chat.completions.create({
      model: "deepseek-v4-flash",
      messages: [
        {
          role: "system",
          content:
            "You are a practical code reviewer. Be concise, direct, and non-technical. Focus on: bugs, logic errors, potential security issues, and practical improvements. Skip formatting, style, or cosmetic nitpicks. Write in plain language anyone can understand.",
        },
        {
          role: "user",
          content: `## PR: ${prTitle}\n\n${prBody}\n\n## Diff\n\n${diff}`,
        },
      ],
      stream: false,
      thinking: { type: "disabled" },
    } as any);

    const review = response.choices[0]?.message?.content;
    if (!review) {
      core.setFailed("No review content returned from DeepSeek");
      return;
    }

    const reviewBody = `## DeepSeek Code Review\n\n${review}\n\n---\n${formatTokenFooter(response.usage)}`;

    core.info("Looking for existing review comment...");
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    const existing = comments.find(
      (c) =>
        c.user?.login === "github-actions[bot]" &&
        (c.body ?? "").startsWith("## DeepSeek Code Review"),
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

run();
