import type { CommentSpec, Severity, Category, PrContext } from "../types.ts";

export interface GoldenComment {
  comment: string;
  severity: Severity;
  file?: string;
  lineStart?: number;
  lineEnd?: number;
  type?: Category;
}

export interface GoldenPr {
  id: string;
  url: string;
  diff: string;
  meta: PrContext;
  golden: GoldenComment[];
}

export type JudgeVerdict = "true_positive" | "false_positive" | "partial_match";

export interface QualitativeScores {
  depth: number;
  context: number;
  specificity: number;
  suggestion: number;
}

export interface MatchResult {
  verdict: JudgeVerdict;
  finding: CommentSpec;
  golden: GoldenComment;
  qualitative?: QualitativeScores;
}

export type DiffSizeBucket = "<10" | "10-50" | "50-150" | ">150";

export interface BucketMetrics {
  bucket: DiffSizeBucket;
  p: number;
  r: number;
  f1: number;
  count: number;
}

export interface CategoryMetrics {
  p: number;
  r: number;
  f1: number;
}

export interface EvalReport {
  model: string;
  precision: number;
  recall: number;
  f1: number;
  severityWeightedF1: number;
  byDiffSize: BucketMetrics[];
  byCategory: Record<Category, CategoryMetrics>;
  tp: number;
  fp: number;
  fn: number;
  totalPrs: number;
  totalGolden: number;
  totalFindings: number;
}

export interface PrEvalRecord {
  prId: string;
  bucket: DiffSizeBucket;
  findings: CommentSpec[];
  golden: GoldenComment[];
  matches: MatchResult[];
}
