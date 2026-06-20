import { getDiffSizeBucket, normalizeSeverity } from "../src/eval/martian.ts";
import type { GoldenPr, GoldenComment } from "../src/eval/types.ts";

interface MartianGolden {
  comment: string;
  severity: string;
}

interface MartianPr {
  pr_title: string;
  original_url: string | null;
  source_repo?: string;
  golden_comments: MartianGolden[];
  golden_source_file?: string;
}

interface BenchmarkData {
  [url: string]: MartianPr;
}

const MARTIAN_REPO = "/tmp/opencode/martian-check";
const OUT_DIR = "fixtures/real/martian";

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed (exit ${exitCode}): ${stderr.trim()}`);
  }
  return stdout;
}

function parseUrl(url: string): { owner: string; repo: string; number: number } {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!m) throw new Error(`unparseable PR url: ${url}`);
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

async function fetchDiff(url: string): Promise<string> {
  try {
    const d = (await run(["gh", "pr", "diff", url])).trim();
    if (d) return d;
  } catch (e) {
    console.error(`  ! gh pr diff failed for ${url}: ${e instanceof Error ? e.message : e}`);
  }
  return "";
}

async function main(): Promise<void> {
  const dataPath = `${MARTIAN_REPO}/offline/results/benchmark_data.json`;
  const dataFile = Bun.file(dataPath);
  if (!(await dataFile.exists())) {
    console.error(`Martian benchmark_data.json not found at ${dataPath}`);
    console.error(`Clone https://github.com/withmartian/code-review-benchmark there first.`);
    process.exit(1);
  }
  const data = (await dataFile.json()) as BenchmarkData;
  const urls = Object.keys(data);
  console.error(`[fetch-martian] ${urls.length} PRs to port`);

  const out: GoldenPr[] = [];
  let totalGolden = 0;
  let skipped = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const pr = data[url];
    const ctx = parseUrl(url);
    console.error(`[${i + 1}/${urls.length}] ${url} — ${pr.pr_title.slice(0, 50)}`);

    const diff = await fetchDiff(url);
    if (!diff) {
      console.error(`  ! no diff; skipping`);
      skipped++;
      continue;
    }

    const golden: GoldenComment[] = (pr.golden_comments || []).map((g) => ({
      comment: g.comment,
      severity: normalizeSeverity(g.severity),
    }));
    totalGolden += golden.length;

    out.push({
      id: `${ctx.owner}/${ctx.repo}#${ctx.number}`,
      url,
      diff,
      meta: {
        owner: ctx.owner,
        repo: ctx.repo,
        number: ctx.number,
        title: pr.pr_title,
        body: "No description provided.",
        author: "unknown",
      },
      golden,
    });

    const bucket = getDiffSizeBucket(diff);
    console.error(`  diff bucket=${bucket} golden=${golden.length}`);
  }

  await Bun.write(`${OUT_DIR}/martian.json`, JSON.stringify(out, null, 2));
  console.error(`\n[fetch-martian] wrote ${out.length} PRs / ${totalGolden} golden to ${OUT_DIR}/martian.json`);
  console.error(`[fetch-martian] skipped (no diff): ${skipped}`);

  const buckets: Record<string, number> = {};
  for (const pr of out) {
    const b = getDiffSizeBucket(pr.diff);
    buckets[b] = (buckets[b] || 0) + 1;
  }
  console.error(`[fetch-martian] diff-size distribution:`, buckets);
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
