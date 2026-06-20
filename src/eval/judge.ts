import OpenAI from "openai";
import type { CommentSpec, Category } from "../types.ts";
import type { GoldenComment, MatchResult, JudgeVerdict, QualitativeScores } from "./types.ts";

const JUDGE_MODEL = "glm-5.2";
const MAX_PAIRS_PER_CALL = 250;
const MAX_DIFF_CHARS = 16000;

type Deferred = { finding: CommentSpec; golden: GoldenComment };

function normalizePath(p: string): string {
  return p.toLowerCase().replace(/^\.\//, "").replace(/\\/g, "/").trim();
}

const CATEGORY_ALIASES: Record<Category, Category[]> = {
  logic: ["logic"],
  security: ["security"],
  performance: ["performance"],
  "best-practice": ["best-practice", "logic"],
  test: ["test"],
  comment: ["comment", "best-practice"],
};

function categoriesCompatible(a: Category, b: Category): boolean {
  const alias = CATEGORY_ALIASES[a] || [a];
  return alias.includes(b) || a === b;
}

function lineOverlap(findingLine: number, golden: GoldenComment): boolean {
  if (golden.lineStart == null) return false;
  const start = golden.lineStart;
  const end = golden.lineEnd ?? golden.lineStart;
  return findingLine >= start - 5 && findingLine <= end + 5;
}

export function judgePass1(
  findings: CommentSpec[],
  golden: GoldenComment[],
): { matched: MatchResult[]; deferred: Deferred[] } {
  const matched: MatchResult[] = [];
  const deferred: Deferred[] = [];
  for (const finding of findings) {
    for (const g of golden) {
      if (g.file == null || g.lineStart == null) {
        deferred.push({ finding, golden: g });
        continue;
      }
      const fileOk = normalizePath(finding.file) === normalizePath(g.file);
      const lineOk = lineOverlap(finding.line, g);
      const catOk = g.type == null || categoriesCompatible(finding.category, g.type);
      if (fileOk && lineOk && catOk) {
        matched.push({ verdict: "true_positive", finding, golden: g });
      } else {
        deferred.push({ finding, golden: g });
      }
    }
  }
  return { matched, deferred };
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function normalizeVerdict(v: string): JudgeVerdict {
  const s = v.toLowerCase().trim();
  if (s === "true_positive" || s === "true positive" || s === "tp") return "true_positive";
  if (s === "partial_match" || s === "partial" || s === "partial match") return "partial_match";
  return "false_positive";
}

function buildPass2Prompt(deferred: Deferred[], diff: string): string {
  const diffContext = diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, 10000) + "\n...[truncated]...\n" + diff.slice(-5000)
    : diff;
  const pairs = deferred.map((d, i) => ({
    pair_id: i,
    finding: {
      file: d.finding.file,
      line: d.finding.line,
      category: d.finding.category,
      severity: d.finding.severity,
      message: d.finding.message,
      rationale: d.finding.rationale,
      suggestion: d.finding.suggestion ?? null,
    },
    golden: {
      severity: d.golden.severity,
      file: d.golden.file ?? null,
      line: d.golden.lineStart ?? null,
      comment: d.golden.comment,
    },
  }));
  return `You are a code review judge. Compare each generated review finding to its paired golden reference comment and classify whether they describe the same underlying issue.

PR diff (for context):
${diffContext}

For EACH pair below, respond with a verdict:
- "true_positive": the finding addresses the same underlying issue as the golden comment
- "false_positive": the finding is unrelated to the golden comment
- "partial_match": the finding is related but incomplete or inexact

Also rate the FINDING (not the golden) on 4 dimensions, 1-5:
- depth: how thoroughly the finding explains the issue
- context: awareness of surrounding code/intent
- specificity: how precisely the finding pinpoints the issue
- suggestion: correctness/usefulness of the suggested fix (1 if none/irrelevant)

Pairs to judge:
${JSON.stringify(pairs, null, 2)}

Respond as JSON: {"results": [{"pair_id": 0, "verdict": "true_positive", "depth": 4, "context": 3, "specificity": 4, "suggestion": 2, "reasoning": "..."}, ...]}`;
}

export async function judgePass2(
  deferred: Deferred[],
  apiKey: string,
  baseURL = "https://opencode.ai/zen/go/v1",
  diff = "",
): Promise<MatchResult[]> {
  if (deferred.length === 0) return [];
  const pairs = deferred.slice(0, MAX_PAIRS_PER_CALL);
  const openai = new OpenAI({ baseURL, apiKey });
  let results: MatchResult[];
  try {
    const resp = await openai.chat.completions.create({
      model: JUDGE_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: "You are a precise code review judge. Respond only with JSON." },
        { role: "user", content: buildPass2Prompt(pairs, diff) },
      ],
      response_format: { type: "json_object" as const },
    });
    const raw = resp.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed.results) ? parsed.results : Array.isArray(parsed) ? parsed : [];
    results = pairs.map((d, i) => {
      const row = arr.find((r: any) => r.pair_id === i) || arr[i];
      const verdict = row ? normalizeVerdict(row.verdict) : "false_positive";
      const qual: QualitativeScores | undefined = row
        ? {
            depth: clampScore(row.depth),
            context: clampScore(row.context),
            specificity: clampScore(row.specificity),
            suggestion: clampScore(row.suggestion),
          }
        : undefined;
      return { verdict, finding: d.finding, golden: d.golden, qualitative: qual };
    });
  } catch {
    results = pairs.map((d) => ({ verdict: "false_positive" as JudgeVerdict, finding: d.finding, golden: d.golden }));
  }
  return results;
}

export async function judge(
  findings: CommentSpec[],
  golden: GoldenComment[],
  apiKey: string,
  baseURL?: string,
  diff = "",
): Promise<MatchResult[]> {
  const { matched, deferred } = judgePass1(findings, golden);
  const adjudicated = await judgePass2(deferred, apiKey, baseURL, diff);
  return [...matched, ...adjudicated];
}
