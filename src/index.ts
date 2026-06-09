import * as core from "@actions/core";
import * as github from "@actions/github";
import OpenAI from "openai";

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

    const octokit = github.getOctokit(process.env.GITHUB_TOKEN!);
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

    core.info("Posting review comment...");

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: `## DeepSeek Code Review\n\n${review}`,
    });

    core.info("Review posted successfully");
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : "Unknown error");
  }
}

run();
