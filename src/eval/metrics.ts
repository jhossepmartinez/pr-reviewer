import type { MatchResult, EvalReport, DiffSizeBucket, CategoryMetrics, BucketMetrics, PrEvalRecord } from "./types.ts";
import type { CommentSpec, Category, Severity } from "../types.ts";
import type { GoldenComment } from "./types.ts";

export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 4,
  high: 2,
  medium: 1,
  low: 0.5,
};

const ALL_CATEGORIES: Category[] = [
  "logic",
  "security",
  "performance",
  "best-practice",
  "test",
  "comment",
];

function verdictWeight(v: MatchResult["verdict"]): number {
  if (v === "true_positive") return 1;
  if (v === "partial_match") return 0.5;
  return 0;
}

function safeDiv(a: number, b: number): number {
  if (b === 0) return 0;
  return a / b;
}

function f1(p: number, r: number): number {
  if (p + r === 0) return 0;
  return (2 * p * r) / (p + r);
}

interface PrAgg {
  tpFindings: number;
  tpGolden: number;
  matchedFindingsCount: number;
  matchedGoldenCount: number;
  totalFindings: number;
  totalGolden: number;
  weightedTpP: number;
  weightedTpR: number;
  totalGoldenWeight: number;
  catTpFindings: Map<Category, number>;
  catTpGolden: Map<Category, number>;
  catFindings: Map<Category, number>;
  catGolden: Map<Category, number>;
}

function findingKey(f: CommentSpec): string {
  return `${f.file}|${f.line}|${f.message}`;
}

function goldenKey(g: GoldenComment): string {
  return `${g.file ?? ""}|${g.lineStart ?? ""}|${g.comment}`;
}

function aggregatePr(rec: PrEvalRecord): PrAgg {
  const fBest = new Map<string, number>();
  const gBest = new Map<string, number>();
  const gForF = new Map<string, GoldenComment>();

  for (const m of rec.matches) {
    const w = verdictWeight(m.verdict);
    if (w > 0) {
      const fk = findingKey(m.finding);
      const gk = goldenKey(m.golden);
      if (w > (fBest.get(fk) ?? 0)) {
        fBest.set(fk, w);
        gForF.set(fk, m.golden);
      }
      if (w > (gBest.get(gk) ?? 0)) gBest.set(gk, w);
    }
  }

  let tpFindings = 0;
  let tpGolden = 0;
  let weightedTpP = 0;
  let weightedTpR = 0;
  let totalGoldenWeight = 0;
  let matchedFindingsCount = 0;
  let matchedGoldenCount = 0;

  for (const f of rec.findings) {
    const fk = findingKey(f);
    const w = fBest.get(fk) ?? 0;
    tpFindings += w;
    if (w > 0) {
      matchedFindingsCount++;
      const g = gForF.get(fk);
      const sw = g ? SEVERITY_WEIGHTS[g.severity] ?? 1 : 1;
      weightedTpP += w * sw;
    }
  }
  for (const g of rec.golden) {
    const gk = goldenKey(g);
    const sw = SEVERITY_WEIGHTS[g.severity] ?? 1;
    totalGoldenWeight += sw;
    const w = gBest.get(gk) ?? 0;
    tpGolden += w;
    if (w > 0) {
      matchedGoldenCount++;
      weightedTpR += w * sw;
    }
  }

  const catTpFindings = new Map<Category, number>();
  const catTpGolden = new Map<Category, number>();
  const catFindings = new Map<Category, number>();
  const catGolden = new Map<Category, number>();
  for (const cat of ALL_CATEGORIES) {
    catTpFindings.set(cat, 0);
    catTpGolden.set(cat, 0);
    catFindings.set(cat, 0);
    catGolden.set(cat, 0);
  }
  for (const f of rec.findings) {
    catFindings.set(f.category, (catFindings.get(f.category) ?? 0) + 1);
    const w = fBest.get(findingKey(f)) ?? 0;
    if (w > 0) catTpFindings.set(f.category, (catTpFindings.get(f.category) ?? 0) + w);
  }
  for (const g of rec.golden) {
    if (g.type) {
      catGolden.set(g.type, (catGolden.get(g.type) ?? 0) + 1);
      const w = gBest.get(goldenKey(g)) ?? 0;
      if (w > 0) catTpGolden.set(g.type, (catTpGolden.get(g.type) ?? 0) + w);
    }
  }

  return {
    tpFindings,
    tpGolden,
    matchedFindingsCount,
    matchedGoldenCount,
    totalFindings: rec.findings.length,
    totalGolden: rec.golden.length,
    weightedTpP,
    weightedTpR,
    totalGoldenWeight,
    catTpFindings,
    catTpGolden,
    catFindings,
    catGolden,
  };
}

export function computeMetrics(records: PrEvalRecord[], model: string): EvalReport {
  const aggs = records.map(aggregatePr);
  let totalFindings = 0;
  let totalGolden = 0;
  let tpF = 0;
  let tpG = 0;
  let matchedFindings = 0;
  let matchedGolden = 0;
  let wtpP = 0;
  let wtpR = 0;
  let totalGW = 0;

  const buckets: Record<DiffSizeBucket, { tpF: number; tf: number; tpG: number; tg: number }> = {
    "<10": { tpF: 0, tf: 0, tpG: 0, tg: 0 },
    "10-50": { tpF: 0, tf: 0, tpG: 0, tg: 0 },
    "50-150": { tpF: 0, tf: 0, tpG: 0, tg: 0 },
    ">150": { tpF: 0, tf: 0, tpG: 0, tg: 0 },
  };
  const catAgg: Record<Category, { tpF: number; tf: number; tpG: number; tg: number }> = {} as Record<Category, { tpF: number; tf: number; tpG: number; tg: number }>;
  for (const cat of ALL_CATEGORIES) catAgg[cat] = { tpF: 0, tf: 0, tpG: 0, tg: 0 };

  for (let i = 0; i < records.length; i++) {
    const a = aggs[i];
    const rec = records[i];
    totalFindings += a.totalFindings;
    totalGolden += a.totalGolden;
    tpF += a.tpFindings;
    tpG += a.tpGolden;
    matchedFindings += a.matchedFindingsCount;
    matchedGolden += a.matchedGoldenCount;
    wtpP += a.weightedTpP;
    wtpR += a.weightedTpR;
    totalGW += a.totalGoldenWeight;

    const b = buckets[rec.bucket];
    b.tpF += a.tpFindings;
    b.tf += a.totalFindings;
    b.tpG += a.tpGolden;
    b.tg += a.totalGolden;

    for (const cat of ALL_CATEGORIES) {
      catAgg[cat].tpF += a.catTpFindings.get(cat) ?? 0;
      catAgg[cat].tf += a.catFindings.get(cat) ?? 0;
      catAgg[cat].tpG += a.catTpGolden.get(cat) ?? 0;
      catAgg[cat].tg += a.catGolden.get(cat) ?? 0;
    }
  }

  const precision = safeDiv(tpF, totalFindings);
  const recall = safeDiv(tpG, totalGolden);
  const f1Score = f1(precision, recall);
  const weightedP = safeDiv(wtpP, totalFindings);
  const weightedR = safeDiv(wtpR, totalGW);
  const severityWeightedF1 = f1(weightedP, weightedR);

  const byDiffSize: BucketMetrics[] = (["<10", "10-50", "50-150", ">150"] as DiffSizeBucket[]).map((bucket) => {
    const b = buckets[bucket];
    const p = safeDiv(b.tpF, b.tf);
    const r = safeDiv(b.tpG, b.tg);
    return { bucket, p, r, f1: f1(p, r), count: b.tg };
  });

  const byCategory: Record<Category, CategoryMetrics> = {} as Record<Category, CategoryMetrics>;
  for (const cat of ALL_CATEGORIES) {
    const c = catAgg[cat];
    const p = safeDiv(c.tpF, c.tf);
    const r = safeDiv(c.tpG, c.tg);
    byCategory[cat] = { p, r, f1: f1(p, r) };
  }

  return {
    model,
    precision,
    recall,
    f1: f1Score,
    severityWeightedF1,
    byDiffSize,
    byCategory,
    tp: Math.round(tpG * 10) / 10,
    fp: totalFindings - matchedFindings,
    fn: totalGolden - matchedGolden,
    totalPrs: records.length,
    totalGolden,
    totalFindings,
  };
}

export function formatReport(report: EvalReport): string {
  const pct = (n: number) => (n * 100).toFixed(1) + "%";
  const lines: string[] = [];
  lines.push(`=== Eval Report: ${report.model} ===`);
  lines.push(`PRs: ${report.totalPrs} | golden: ${report.totalGolden} | findings: ${report.totalFindings}`);
  lines.push(`TP(wt): ${report.tp} | FP: ${report.fp} | FN: ${report.fn}  [partial_match counts 0.5]`);
  lines.push(`Precision: ${pct(report.precision)} | Recall: ${pct(report.recall)} | F1: ${pct(report.f1)}`);
  lines.push(`Severity-weighted F1: ${pct(report.severityWeightedF1)}`);
  lines.push("");
  lines.push("By diff size:");
  lines.push("  bucket   | P     | R     | F1    | golden");
  for (const b of report.byDiffSize) {
    lines.push(`  ${b.bucket.padEnd(8)} | ${pct(b.p).padStart(5)} | ${pct(b.r).padStart(5)} | ${pct(b.f1).padStart(5)} | ${b.count}`);
  }
  lines.push("");
  lines.push("By category (recall N/A when golden lacks type — Martian golden has no category):");
  lines.push("  category      | P     | R     | F1");
  for (const [cat, m] of Object.entries(report.byCategory)) {
    lines.push(`  ${cat.padEnd(13)} | ${pct(m.p).padStart(5)} | ${pct(m.r).padStart(5)} | ${pct(m.f1).padStart(5)}`);
  }
  lines.push("");
  lines.push("SOTA comparison: Sonnet 27.1% (baseline to beat) | Haiku 36.4% (SOTA, Claude/GPT judge)");
  return lines.join("\n");
}
