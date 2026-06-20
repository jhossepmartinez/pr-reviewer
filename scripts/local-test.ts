import { reviewDiff, buildReviewBody, SYSTEM_PROMPT } from "../src/index.ts";

const DEFAULT_FIXTURE_DIFF = "fixtures/sample.diff";
const DEFAULT_FIXTURE_META = "fixtures/sample-meta.json";
const DEFAULT_MODEL = "deepseek-v4-flash";

function parseArgs(argv: string[]): {
  pr?: string;
  diffPath: string;
  model: string;
} {
  const out = { diffPath: DEFAULT_FIXTURE_DIFF, model: DEFAULT_MODEL, pr: undefined as string | undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pr") {
      out.pr = argv[++i];
      if (!out.pr) {
        console.error("Error: --pr requires a value (PR number or URL)");
        process.exit(1);
      }
    } else if (a === "--diff") {
      out.diffPath = argv[++i];
      if (!out.diffPath) {
        console.error("Error: --diff requires a path");
        process.exit(1);
      }
    } else if (a === "--model") {
      out.model = argv[++i];
      if (!out.model) {
        console.error("Error: --model requires a value");
        process.exit(1);
      }
    } else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Error: unknown argument "${a}"`);
      printHelp();
      process.exit(1);
    }
  }
  return out;
}

function printHelp(): void {
  console.log(`Usage: bun run scripts/local-test.ts [options]

Options:
  --pr <number|url>   Fetch a real PR diff via \`gh pr diff\` (uses current repo remote).
  --diff <path>       Path to a diff file (default: ${DEFAULT_FIXTURE_DIFF}).
  --model <id>        OpenCode model id (default: ${DEFAULT_MODEL}).
  -h, --help          Show this help.

Environment:
  OPENCODE_API_KEY    Required. OpenCode API key (Bearer token for https://opencode.ai/zen/v1).

Examples:
  export OPENCODE_API_KEY=sk-...
  bun run scripts/local-test.ts
  bun run scripts/local-test.ts --pr 42
  bun run scripts/local-test.ts --model glm-5.1 --diff fixtures/other.diff
`);
}

async function readFixture(
  diffPath: string,
): Promise<{ diff: string; title: string; body: string }> {
  const diffFile = Bun.file(diffPath);
  if (!(await diffFile.exists())) {
    console.error(`Error: fixture diff not found at ${diffPath}`);
    process.exit(1);
  }
  const diff = await diffFile.text();

  const metaPath = diffPath.replace(/\.diff$/, "-meta.json");
  const metaFile = Bun.file(metaPath);
  let title = "Local test fixture";
  let body = "No description provided.";
  if (await metaFile.exists()) {
    try {
      const meta = await metaFile.json();
      title = meta.title ?? title;
      body = meta.body ?? body;
    } catch {
      console.error(`Warning: could not parse ${metaPath}, using defaults`);
    }
  }
  return { diff, title, body };
}

async function run(cmd: string[], opts: { cwd?: string } = {}): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    const trimmed = stderr.trim() || `(exit ${exitCode}, no stderr)`;
    console.error(`Error: \`${cmd.join(" ")}\` failed:\n${trimmed}`);
    process.exit(1);
  }
  return stdout;
}

async function resolveRepo(): Promise<{ owner: string; name: string }> {
  const json = await run([
    "gh",
    "repo",
    "view",
    "--json",
    "owner,name",
    "--jq",
    "{owner:.owner.login,name:.name}",
  ]);
  try {
    const parsed = JSON.parse(json);
    return { owner: parsed.owner, name: parsed.name };
  } catch {
    console.error(
      "Error: could not parse \`gh repo view\` output. Make sure gh is authenticated.",
    );
    process.exit(1);
  }
}

function parsePrRef(ref: string): { number: number } | { url: string } {
  if (/^\d+$/.test(ref)) return { number: parseInt(ref, 10) };
  return { url: ref };
}

async function fetchPr(
  prRef: string,
): Promise<{ diff: string; title: string; body: string }> {
  const { owner, name } = await resolveRepo();
  const ref = parsePrRef(prRef);

  const prArg =
    "number" in ref ? `${owner}/${name}#${ref.number}` : (ref.url as string);

  const diff = (
    await run(["gh", "pr", "diff", prArg], { cwd: process.cwd() })
  ).trim();
  if (!diff) {
    console.error(`Error: \`gh pr diff ${prArg}\` returned an empty diff`);
    process.exit(1);
  }

  const metaJson = await run([
    "gh",
    "pr",
    "view",
    prArg,
    "--json",
    "title,body",
  ]);
  let title = "No title";
  let body = "No description provided.";
  try {
    const parsed = JSON.parse(metaJson);
    title = parsed.title ?? title;
    body = parsed.body ?? body;
  } catch {
    // keep defaults
  }
  return { diff, title, body };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = process.env.OPENCODE_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    console.error(
      "Error: OPENCODE_API_KEY is not set. Export it before running local tests:\n  export OPENCODE_API_KEY=sk-...",
    );
    process.exit(1);
  }

  const source = args.pr ? `PR ${args.pr}` : `fixture ${args.diffPath}`;
  console.error(`[local-test] source: ${source}`);
  console.error(`[local-test] model:   ${args.model}`);
  console.error(`[local-test] system:  ${SYSTEM_PROMPT.slice(0, 60)}...`);
  console.error("");

  const { diff, title, body } = args.pr
    ? await fetchPr(args.pr)
    : await readFixture(args.diffPath);

  const t0 = performance.now();
  const { review, usage } = await reviewDiff(
    diff,
    title,
    body,
    apiKey,
    "https://opencode.ai/zen/go/v1",
    args.model,
  );
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

  console.error(`[local-test] API replied in ${elapsed}s`);
  console.error("");

  console.log(buildReviewBody(review, usage));
}

main().catch((err) => {
  console.error(
    `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
  );
  process.exit(1);
});
