import { computeMetrics, formatReport } from "../src/eval/metrics.ts";
import type { PrEvalRecord } from "../src/eval/types.ts";

function parseArgs(argv: string[]): { records: string; model: string; output: string | null } {
  const out = { records: "", model: "deepseek-v4-flash", output: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--records") out.records = argv[++i] ?? "";
    else if (a === "--model") out.model = argv[++i] ?? out.model;
    else if (a === "--output") out.output = argv[++i] ?? null;
    else if (a === "-h" || a === "--help") {
      console.log("Usage: bun run scripts/aggregate-eval.ts --records <path> [--model <id>] [--output <path>]");
      process.exit(0);
    }
  }
  if (!out.records) {
    console.error("Error: --records <path> is required");
    process.exit(1);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const file = Bun.file(args.records);
  if (!(await file.exists())) {
    console.error(`Error: records file not found: ${args.records}`);
    process.exit(1);
  }
  const text = await file.text();
  const records: PrEvalRecord[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      records.push(JSON.parse(t));
    } catch {
      console.error(`Skipping unparseable line`);
    }
  }
  console.error(`[aggregate] loaded ${records.length} records`);
  if (records.length === 0) {
    console.error("No records; cannot compute metrics.");
    process.exit(1);
  }
  const report = computeMetrics(records, args.model);
  console.log(formatReport(report));
  if (args.output) {
    await Bun.write(args.output, JSON.stringify(report, null, 2));
    console.error(`[aggregate] wrote report to ${args.output}`);
  }
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
