import { reviewDiffStructured } from "../src/index.ts";
import { loadMartianFixture, getDiffSizeBucket } from "../src/eval/martian.ts";
import { judge } from "../src/eval/judge.ts";
import { computeMetrics, formatReport } from "../src/eval/metrics.ts";
import type { PrEvalRecord } from "../src/eval/types.ts";
import type { EvalReport } from "../src/eval/types.ts";
import { appendFile, writeFile } from "node:fs/promises";

const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_FIXTURE_DIR = "fixtures/real/martian";
const DEFAULT_LIMIT = 50;
const BASE_URL = "https://opencode.ai/zen/go/v1";

function parseArgs(argv: string[]): {
  model: string;
  limit: number;
  fixtureDir: string;
  output: string | null;
  records: string | null;
} {
  const out = { model: DEFAULT_MODEL, limit: DEFAULT_LIMIT, fixtureDir: DEFAULT_FIXTURE_DIR, output: null as string | null, records: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model") out.model = argv[++i];
    else if (a === "--limit") out.limit = parseInt(argv[++i] ?? "0", 10);
    else if (a === "--fixture-dir") out.fixtureDir = argv[++i];
    else if (a === "--output") out.output = argv[++i];
    else if (a === "--records") out.records = argv[++i];
    else if (a === "-h" || a === "--help") {
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
  console.log(`Usage: bun run scripts/eval.ts [options]

Options:
  --model <id>          OpenCode model id (default: ${DEFAULT_MODEL}).
  --limit <n>           Only evaluate the first <n> PRs (default: ${DEFAULT_LIMIT}).
  --fixture-dir <path>  Martian fixture dir (default: ${DEFAULT_FIXTURE_DIR}).
  --output <path>       Write EvalReport JSON to this path.
  --records <path>      Append each PR's record as JSONL (incremental, survives interruption).
  -h, --help            Show this help.

Environment:
  OPENCODE_API_KEY      Required. OpenCode API key.

Examples:
  bun run scripts/eval.ts --limit 1
  bun run scripts/eval.ts --model glm-5.2 --output eval-results/wave-0.json --records eval-results/wave-0.records.jsonl
`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENCODE_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    console.error("Error: OPENCODE_API_KEY is not set.");
    process.exit(1);
  }

  console.error(`[eval] model=${args.model} limit=${args.limit} fixture=${args.fixtureDir}`);
  const prs = await loadMartianFixture(args.fixtureDir);
  const subset = prs.slice(0, args.limit);
  console.error(`[eval] loaded ${prs.length} PRs; evaluating ${subset.length}`);
  if (args.records) await writeFile(args.records, "");

  const records: PrEvalRecord[] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < subset.length; i++) {
    const pr = subset[i];
    const t0 = performance.now();
    try {
      const { findings, usage } = await reviewDiffStructured(
        pr.diff,
        pr.meta.title,
        pr.meta.body,
        apiKey,
        BASE_URL,
        args.model,
      );
      const tokens = usage?.completion_tokens ?? "?";
      const matches = await judge(findings, pr.golden, apiKey, BASE_URL, pr.diff);
      const bucket = getDiffSizeBucket(pr.diff);
      const record: PrEvalRecord = { prId: pr.id, bucket, findings, golden: pr.golden, matches };
      records.push(record);
      if (args.records) await appendFile(args.records, JSON.stringify(record) + "\n");
      succeeded++;
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      const tpCount = matches.filter((m) => m.verdict !== "false_positive").length;
      console.error(
        `[${i + 1}/${subset.length}] ${pr.id} | bucket=${bucket} | findings=${findings.length} golden=${pr.golden.length} matches=${tpCount}/${matches.length} | ${elapsed}s ${tokens}tok`,
      );
    } catch (e) {
      failed++;
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      console.error(`[${i + 1}/${subset.length}] ${pr.id} FAILED (${elapsed}s): ${e instanceof Error ? e.message : e}`);
    }
    if (i < subset.length - 1) await sleep(500);
  }

  console.error(`\n[eval] succeeded=${succeeded} failed=${failed}`);
  if (records.length === 0) {
    console.error("No PRs succeeded; cannot compute metrics.");
    process.exit(1);
  }

  const report: EvalReport = computeMetrics(records, args.model);
  const text = formatReport(report);
  console.log(text);

  if (args.output) {
    const path = args.output;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
    try {
      await Bun.write(path, JSON.stringify(report, null, 2));
      console.error(`[eval] wrote report to ${path}`);
    } catch (e) {
      console.error(`[eval] could not write ${path}: ${e instanceof Error ? e.message : e}`);
    }
    void dir;
  }
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
