# Wave 0 Implementation Plan — Foundation + Measurement Scaffold

**Projects:** P1 (Diff Chunking Engine) + P14 (Golden Eval Scaffold)
**Cluster:** A (Diff Intake) + E (Evaluation)
**Goal:** Build the universal foundation (chunker + shared types) and the
measurement scaffold (Martian golden eval + two-pass judge) so every later
wave is measured against evidence, not intuition.

---

## 1. Overview

Wave 0 delivers two things that unblock the entire pipeline:

1. **P1 — Diff Chunking Engine** (`src/chunker.ts` + `src/types.ts`): decomposes
   a PR diff into per-file/per-hunk units targeting the 10–50 line sweet spot
   (arXiv:2606.15689). Replaces the flat `files.map(...).join` concat at
   `src/index.ts:86`. No dependencies; unblocks P4/P5/P6/P14.

2. **P14 — Golden Evaluation Harness** (`src/eval/` + `scripts/eval.ts`): a
   minimal scoring harness grounded in RESEARCH.md §8. Scores the reviewer
   against the Martian Code Review Benchmark (50 PRs / 136 golden comments)
   using the two-pass judge, emits P/R/F1 + severity-weighted F1, stratifies
   by diff size. Pins P3's `CommentSpec` structured-finding type early
   (PLAN.md Decision #4).

**Exit criteria:**
- P1: `src/chunker.ts` + `src/types.ts` compile; chunker produces hunks in the
  10–50 line sweet spot, splits >150, merges tiny adjacent.
- P14: `scripts/eval.ts` can score the current single-shot baseline on the
  Martian 50 PRs → produces an `EvalReport` with P/R/F1 + diff-size
  stratification. Expected "before" number: ~Sonnet 27.1% F1 (or lower for
  deepseek-v4-flash single-shot).

---

## 2. Dependency Graph

```
Phase 1 (sequential — critical path):
  Agent A: src/types.ts ──────────────────────────────────────────┐
                                                                  │
Phase 2 (parallel — 2 agents after A):                            │
  Agent B: src/chunker.ts ←──────────── Agent A                   │
  Agent C: src/eval/types.ts ←─────── Agent A                     │
                                                                  │
Phase 3 (parallel — 3 agents after C):                            │
  Agent D: src/eval/martian.ts + fixtures/real/martian/ ← Agent C │
  Agent E: src/eval/judge.ts ←────────── Agent A + Agent C        │
  Agent F: src/eval/metrics.ts ←───────── Agent C                 │
                                                                  │
Phase 4 (sequential — integration, after B + D + E + F):          │
  Agent G: src/index.ts adapter + scripts/eval.ts ← all above ────┘
                                                                  │
Phase 5 (sequential — measurement, after G):                      │
  Agent H: baseline eval run + PLAN.md update ← Agent G           │
```

**Key dependency notes:**
- Agent A is the single critical-path bottleneck. Everything depends on the
  shared types. It must complete first.
- Agent E (judge) depends on both Agent A (CommentSpec) and Agent C (eval
  types: MatchResult, JudgeVerdict). So E starts in Phase 3, not Phase 2.
- Agent G (integration) depends on ALL other agents. It is the sole owner of
  `src/index.ts` modifications to prevent merge conflicts.
- Agent H (measurement) depends on G and requires `OPENCODE_API_KEY` to run
  the live eval.

---

## 3. Agent Roster

| Agent | Model Tier | Scope | Phase | Depends On |
|---|---|---|---|---|
| **A** | `glm-5.2` | `src/types.ts` — shared types + pinned CommentSpec | 1 | — |
| **B** | `glm-5.2` | `src/chunker.ts` — diff chunking engine | 2 | A |
| **C** | `deepseek-v4-flash` | `src/eval/types.ts` — eval domain types | 2 | A |
| **D** | `deepseek-v4-flash` | `src/eval/martian.ts` + `fixtures/real/martian/` — Martian port | 3 | C |
| **E** | `glm-5.2` | `src/eval/judge.ts` — two-pass judge (deterministic + LLM) | 3 | A, C |
| **F** | `deepseek-v4-flash` | `src/eval/metrics.ts` — P/R/F1 + stratification | 3 | C |
| **G** | `glm-5.2` | `src/index.ts` structured-finding adapter + `scripts/eval.ts` runner | 4 | B, D, E, F |
| **H** | `glm-5.2` | Baseline eval run + PLAN.md status/changes update | 5 | G |

**Model tier rationale:**
- `glm-5.2` (best/reasoning): used for tasks requiring design judgment — type
  system design (A), diff parsing/split-merge logic (B), judge prompt design +
  LLM adjudication (E), integration of all modules (G), and interpreting eval
  results (H).
- `deepseek-v4-flash` (cheap/mechanical): used for well-specified, low-ambiguity
  tasks — eval type definitions following Agent A's patterns (C), data
  porting/loading (D), and metric computation with defined formulas (F).

---

## 4. Interface Contracts

These are the **exact** TypeScript signatures each agent must implement. Agents
MUST NOT deviate from these contracts without updating this document first.
This is the contract layer that enables parallel work.

### 4.1 `src/types.ts` (Agent A) — shared across all modules

```ts
// ── PR context ──
export interface PrContext {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  isAIAuthored?: boolean;
}

// ── Severity = impact level (for severity-weighted F1, P14) ──
// DESIGN DECISION: supersede the P1 sketch's Severity enum (which conflated
// category and impact). See §8 "Design Decisions" below.
export type Severity = "critical" | "high" | "medium" | "low";

// ── Category = what kind of issue ──
export type Category =
  | "logic"
  | "security"
  | "performance"
  | "best-practice"
  | "test"
  | "comment";

// ── Token usage ──
export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

// ── Pinned from P3 (PLAN.md Decision #4) ──
// Every comment the reviewer emits must conform to this shape.
export interface CommentSpec {
  file: string;
  line: number;
  category: Category;
  severity: Severity;
  message: string;
  rationale: string;   // I.E2: mandatory reason/context (arXiv:2410.06515)
  suggestion?: string;
}

// ── Diff file (mirrors GitHub API octokit pulls.listFiles shape) ──
export interface DiffFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  patch?: string;
  additions: number;
  deletions: number;
}
```

### 4.2 `src/chunker.ts` (Agent B)

```ts
import type { DiffFile } from "./types.ts";

export interface Hunk {
  file: string;
  status: "added" | "modified" | "removed" | "renamed";
  oldStart: number;
  newStart: number;
  lineCount: number;
  content: string;
  pathContext?: string;
}

export const SWEET_SPOT = { min: 10, max: 50 } as const;
export const HARD_CAP = 150;

export function chunkDiff(files: DiffFile[]): Hunk[];
export function splitOversizedHunk(h: Hunk, max?: number): Hunk[];
export function mergeTinyHunks(hs: Hunk[], min?: number): Hunk[];
```

### 4.3 `src/eval/types.ts` (Agent C)

```ts
import type { CommentSpec, Severity, Category, PrContext } from "../types.ts";

export interface GoldenComment {
  file: string;
  lineStart: number;
  lineEnd: number;
  type: Category;
  severity: Severity;
  description: string;
}

export interface GoldenPr {
  id: string;
  diff: string;
  meta: PrContext;
  golden: GoldenComment[];
}

export type JudgeVerdict = "true_positive" | "false_positive" | "partial_match";

export interface QualitativeScores {
  depth: number;     // 1-5
  context: number;   // 1-5
  specificity: number; // 1-5
  suggestion: number;  // 1-5
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
```

### 4.4 `src/eval/martian.ts` (Agent D)

```ts
import type { GoldenPr } from "./types.ts";

export function loadMartianFixture(dir: string): Promise<GoldenPr[]>;
export function getDiffSizeBucket(diff: string): import("./types.ts").DiffSizeBucket;
```

### 4.5 `src/eval/judge.ts` (Agent E)

```ts
import type { CommentSpec } from "../types.ts";
import type { GoldenComment, MatchResult } from "./types.ts";

export function judgePass1(
  findings: CommentSpec[],
  golden: GoldenComment[],
): { matched: MatchResult[]; deferred: { finding: CommentSpec; golden: GoldenComment }[] };

export function judgePass2(
  deferred: { finding: CommentSpec; golden: GoldenComment }[],
  apiKey: string,
  baseURL?: string,
): Promise<MatchResult[]>;

export function judge(
  findings: CommentSpec[],
  golden: GoldenComment[],
  apiKey: string,
  baseURL?: string,
): Promise<MatchResult[]>;
```

### 4.6 `src/eval/metrics.ts` (Agent F)

```ts
import type { MatchResult, EvalReport, DiffSizeBucket, Category } from "./types.ts";
import type { CommentSpec } from "../types.ts";
import type { GoldenComment } from "./types.ts";

export const SEVERITY_WEIGHTS: Record<string, number>; // critical 4, high 2, medium 1, low 0.5

export function computeMetrics(
  matches: MatchResult[],
  findings: CommentSpec[],
  golden: GoldenComment[],
  model: string,
  diffBuckets: Map<string, DiffSizeBucket>,
): EvalReport;

export function formatReport(report: EvalReport): string;
```

### 4.7 `src/index.ts` additions (Agent G)

```ts
// NEW: structured-finding mode (alongside existing reviewDiff)
export interface StructuredReviewResult {
  findings: CommentSpec[];
  usage: any;
}

export async function reviewDiffStructured(
  diff: string,
  prTitle: string,
  prBody: string,
  apiKey: string,
  baseURL?: string,
  model?: string,
): Promise<StructuredReviewResult>;
```

### 4.8 `scripts/eval.ts` (Agent G)

```ts
// CLI entry point. Usage:
//   bun run scripts/eval.ts [--model <id>] [--limit <n>] [--fixture-dir <path>]
// Runs the structured reviewer on each Martian PR, judges against golden,
// computes metrics, prints + writes EvalReport JSON.
```

---

## 5. Task Specifications

### Agent A — Type Foundation (`src/types.ts`)

**Model:** `glm-5.2`
**Phase:** 1 (critical path — starts first, blocks everything)
**Depends on:** nothing

**Task:** Create `src/types.ts` with the shared type definitions specified in
§4.1 above. This file is imported by every other module.

**Key responsibilities:**
1. Define `PrContext`, `Severity`, `Category`, `Usage`, `CommentSpec`,
   `DiffFile` exactly as specified in §4.1.
2. Resolve the Severity/Category design tension (see §8 below). The P1 sketch
   in PROJECTS.md conflates severity (impact) with category (what kind). Use
   `Severity = "critical" | "high" | "medium" | "low"` so P14's
   severity-weighted F1 (critical 4×, high 2×, medium 1×, low 0.5×) works
   directly. Use `Category` for the issue-type enum.
3. Ensure `CommentSpec` includes the mandatory `rationale` field (I.E2 from
   arXiv:2410.06515 — Informativeness is the top 19.3% failure).
4. Ensure `DiffFile` mirrors the GitHub API `pulls.listFiles` response shape
   so it's compatible with the existing `octokit.rest.pulls.listFiles` output
   at `src/index.ts:80`.

**Constraints:**
- TypeScript, ESM, strict mode. No comments in code.
- `src/types.ts` must contain ONLY type exports (no runtime code) so it can be
  imported everywhere without side effects.
- Do NOT modify `src/index.ts` — Agent G owns that file.

**Verification:** `bun run build` passes (typechecks via bundler).

---

### Agent B — Chunker Engine (`src/chunker.ts`)

**Model:** `glm-5.2`
**Phase:** 2 (after Agent A)
**Depends on:** Agent A (`src/types.ts`)

**Task:** Create `src/chunker.ts` implementing the diff chunking engine per
P1 spec (arXiv:2606.15689).

**Key responsibilities:**
1. **Parse `patch` into hunks.** Unified diff format: each hunk starts with
   `@@ -oldStart,oldLen +newStart,newLen @@`. Parse the hunk header and
   content lines (lines starting with `+`, `-`, ` `). Group by file.
2. **Measure line count.** `lineCount` = number of changed lines (additions +
   deletions) in the hunk, NOT total lines including context. This is the
   metric that maps to the diff-size buckets in 2606.15689.
3. **Split oversized hunks** (`splitOversizedHunk`): if `lineCount > max`
   (default `SWEET_SPOT.max = 50`), split at logical boundaries — prefer
   splitting at function/block boundaries (blank lines, dedent) over
   mid-function splits. Each split hunk gets its own `@@` header with correct
   line numbers. Hard-cap: any hunk > `HARD_CAP` (150) MUST be split; hunks
   51–150 MAY be split if a logical boundary exists.
4. **Merge tiny hunks** (`mergeTinyHunks`): coalesce adjacent hunks from the
   same file with `lineCount < min` (default `SWEET_SPOT.min = 10`) into a
   single hunk to avoid wasting LLM calls on trivially small units. Only
   merge hunks from the SAME file; do not cross file boundaries.
5. **Attach `pathContext`**: derive a module/directory hint from the file path
   (e.g., `"src/auth/"` for `"src/auth/login.ts"`) for later routing (P4).
6. **`chunkDiff(files)`**: the top-level function. Takes `DiffFile[]` (the
   octokit response), parses each file's `patch`, runs split + merge, returns
   `Hunk[]`.

**Algorithm guidance:**
- Parse hunks with a regex or line-by-line parser on the `patch` string.
- For splitting: scan for blank context lines (` ` followed by nothing) or
  dedent points as split candidates. If none exist, split at even intervals.
- Recompute `oldStart`/`newStart` for each split hunk from the original hunk
  header + accumulated offsets.
- Edge cases: binary files (no `patch`), files with no hunks, renamed files,
  files with only additions or only deletions.

**Constraints:**
- Import types from `src/types.ts` (`DiffFile`).
- Export `Hunk` interface from `src/chunker.ts` (not `src/types.ts` — Hunk is
  chunker-specific).
- No comments in code. ESM, strict.
- Do NOT modify `src/index.ts`.

**Verification:**
- `bun run build` passes.
- Test mentally against `fixtures/sample.diff`: should produce ~4 hunks (one
  per file), each in the 10–50 line range or smaller.
- Test edge case: a hunk with 200 changed lines should be split into ≥4 hunks.

---

### Agent C — Eval Domain Types (`src/eval/types.ts`)

**Model:** `deepseek-v4-flash`
**Phase:** 2 (after Agent A, parallel with Agent B)
**Depends on:** Agent A (`src/types.ts`)

**Task:** Create `src/eval/types.ts` with the eval-specific types specified in
§4.3 above. This is the type layer for the entire evaluation harness.

**Key responsibilities:**
1. Define `GoldenComment`, `GoldenPr`, `JudgeVerdict`, `QualitativeScores`,
   `MatchResult`, `DiffSizeBucket`, `BucketMetrics`, `CategoryMetrics`,
   `EvalReport` exactly as specified in §4.3.
2. Import `CommentSpec`, `Severity`, `Category`, `PrContext` from
   `../types.ts` — do NOT re-define them.
3. Ensure `EvalReport` includes both aggregate metrics AND stratified
   breakdowns (`byDiffSize`, `byCategory`) per RESEARCH.md §8.3 must #6.
4. `EvalReport` must include `model: string` so results are attributable to a
   specific model run.

**Constraints:**
- Type-only file (no runtime code). ESM, strict, no comments.
- Do NOT modify `src/index.ts`.

**Verification:** `bun run build` passes.

---

### Agent D — Martian Fixture Port (`src/eval/martian.ts` + `fixtures/real/martian/`)

**Model:** `deepseek-v4-flash`
**Phase:** 3 (after Agent C)
**Depends on:** Agent C (`src/eval/types.ts`)

**Task:** Port the Martian Code Review Benchmark (50 PRs / 136 golden comments)
into `fixtures/real/martian/` and write a loader that converts it to
`GoldenPr[]`.

**Key responsibilities:**
1. **Clone/inspect the Martian benchmark repo** at
   `https://github.com/withmartian/code-review-benchmark`. Inspect its data
   format — likely JSON or markdown files with PR diffs and golden comments.
2. **Convert to our `GoldenPr[]` format.** Each Martian PR becomes a
   `GoldenPr` with `id`, `diff` (the unified diff string), `meta` (PrContext
   reconstructed from repo/PR metadata), and `golden` (GoldenComment[] mapped
   from Martian's golden annotations).
3. **Map Martian's categories/severities** to our `Category` and `Severity`
   enums. If Martian uses different category names, map them:
   - Security-related → `"security"`
   - Performance-related → `"performance"`
   - Logic/correctness → `"logic"`
   - Test-related → `"test"`
   - Comment/doc → `"comment"`
   - Other → `"best-practice"`
   For severity, map to `critical`/`high`/`medium`/`low` based on Martian's
   severity field. If Martian has no severity, default to `"medium"`.
4. **Store the converted data** in `fixtures/real/martian/` as JSON files
   (one per PR, or a single `martian.json` array). The data must be
   self-contained (no runtime cloning needed).
5. **Write `loadMartianFixture(dir)`**: reads the JSON files from the given
   directory and returns `GoldenPr[]`.
6. **Write `getDiffSizeBucket(diff)`**: counts changed lines in a diff string
   and returns the bucket (`"<10"`, `"10-50"`, `"50-150"`, `">150"`). Count
   only `+` and `-` lines (excluding `+++`/`---` file headers). This is used
   by the metrics agent for stratification.

**Constraints:**
- The fixture data must be committed to `fixtures/real/martian/` (not
  gitignored). These are test data, not secrets.
- If the Martian repo is large, store only the essential data (diff + golden
  comments + metadata), not the full repo.
- Do NOT modify `src/index.ts`.

**Verification:**
- `bun run build` passes.
- `loadMartianFixture("fixtures/real/martian")` returns 50 `GoldenPr` objects
  with a total of ~136 golden comments.
- `getDiffSizeBucket` correctly classifies a 5-line diff as `"<10"` and a
  200-line diff as `">150"`.

---

### Agent E — Two-Pass Judge (`src/eval/judge.ts`)

**Model:** `glm-5.2`
**Phase:** 3 (after Agents A + C)
**Depends on:** Agent A (`CommentSpec`), Agent C (`MatchResult`, `JudgeVerdict`)

**Task:** Implement the two-pass judge protocol from RESEARCH.md §8.1 / §8.3
(arXiv:2606.15689).

**Key responsibilities:**

1. **Pass 1 — deterministic matching** (`judgePass1`):
   - For each (finding, golden) pair, check:
     a. **Normalized file-path match**: normalize both file paths (lowercase,
        strip leading `./`, normalize separators to `/`) and compare.
     b. **Line-range overlap ±5**: `finding.line` must be within ±5 of the
        golden's `[lineStart, lineEnd]` range.
     c. **Comment-type compatibility**: `finding.category` must be compatible
        with `golden.type` (allow semantic aliases — e.g., `"logic"` matches
        `"logic"`, `"security"` matches `"security"`, etc.).
   - If all three conditions match → `MatchResult` with
     `verdict: "true_positive"`.
   - If none match → the pair is deferred to Pass 2.
   - Pass 1 handles ~70% of cases deterministically (per 2606.15689).
   - Return `{ matched: MatchResult[], deferred: [...] }`.

2. **Pass 2 — LLM adjudication** (`judgePass2`):
   - For each deferred (finding, golden) pair, call `glm-5.2` at `temp 0` with
     a prompt that asks it to classify the match as:
     - `"true_positive"` — the finding addresses the same issue as the golden
     - `"false_positive"` — the finding is unrelated to the golden
     - `"partial_match"` — the finding is related but incomplete/inexact (0.5
       TP weight)
   - Also collect 4 qualitative dimensions on a 1–5 scale: Depth, Context
     awareness, Specificity, Suggestion correctness.
   - Use the OpenAI SDK (same pattern as `src/index.ts`) with
     `baseURL = "https://opencode.ai/zen/go/v1"`, `model = "glm-5.2"`,
     `temperature = 0`.
   - Parse the LLM's JSON response into `MatchResult` with `QualitativeScores`.
   - Handle LLM failures gracefully: if the LLM call fails or returns
     unparseable JSON, default to `"false_positive"` (never inflate scores).

3. **`judge()` orchestrator**: runs Pass 1, then Pass 2 on deferred cases,
   returns all `MatchResult[]`.

**Prompt design for Pass 2:**
- System: "You are a code review judge. Compare a generated review finding to
  a golden reference comment and classify the match. Respond as JSON."
- User: include the diff context, the finding (file, line, message, category,
  severity, rationale), and the golden comment (file, line range, type,
  description).
- Output schema: `{ "verdict": "true_positive"|"false_positive"|"partial_match",
  "depth": 1-5, "context": 1-5, "specificity": 1-5, "suggestion": 1-5,
  "reasoning": "..." }`
- Use `response_format: { type: "json_object" }` if supported, otherwise
  extract JSON from the response text.

**Constraints:**
- Import `CommentSpec` from `../types.ts`, eval types from `./types.ts`.
- Use the `openai` SDK (already a dependency).
- No comments in code. ESM, strict.
- Do NOT modify `src/index.ts`.
- Batch LLM calls where possible to avoid rate limits (process deferred cases
  sequentially or with limited concurrency).

**Verification:**
- `bun run build` passes.
- Pass 1 correctly matches a finding at line 10 to a golden at line 12 (within
  ±5) in the same file with the same category.
- Pass 1 defers a finding in a different file from the golden.

---

### Agent F — Metrics Engine (`src/eval/metrics.ts`)

**Model:** `deepseek-v4-flash`
**Phase:** 3 (after Agent C)
**Depends on:** Agent C (`src/eval/types.ts`)

**Task:** Implement P/R/F1 computation, severity-weighted F1, and diff-size
stratification per RESEARCH.md §8.3.

**Key responsibilities:**

1. **Severity weights** (`SEVERITY_WEIGHTS`):
   ```ts
   { critical: 4, high: 2, medium: 1, low: 0.5 }
   ```
   (arXiv:2606.15689)

2. **`computeMetrics(matches, findings, golden, model, diffBuckets)`**:
   - **TP counting**: `true_positive` = 1.0 TP, `partial_match` = 0.5 TP,
     `false_positive` = 0 TP.
   - **Precision** = TP / (TP + FP) where FP = findings with no match (or
     `false_positive` verdicts). Count all unmatched findings as FP.
   - **Recall** = TP / (TP + FN) where FN = golden comments with no matching
     finding. Count all unmatched golden comments as FN.
   - **F1** = 2 × (P × R) / (P + R), with guard for P+R=0.
   - **Severity-weighted F1**: weight each TP by the golden comment's severity
     weight. `weightedTP = sum(verdict_weight × severity_weight)` where
     `verdict_weight` is 1.0 for TP, 0.5 for partial. Then:
     `weightedF1 = 2 × (weightedP × weightedR) / (weightedP + weightedR)`.
   - **Diff-size stratification** (`byDiffSize`): bucket each PR by its diff
     size (from `diffBuckets` map), compute P/R/F1 per bucket. Buckets:
     `<10`, `10-50`, `50-150`, `>150`.
   - **Per-category breakdown** (`byCategory`): for each `Category`, compute
     P/R/F1 using only findings and golden comments of that category.
   - Return `EvalReport` with all aggregate + stratified metrics.

3. **`formatReport(report)`**: produce a human-readable summary string with:
   - Model name, total PRs, total golden, total findings
   - Aggregate P/R/F1 + severity-weighted F1
   - Diff-size bucket table (bucket | P | R | F1 | count)
   - Per-category table (category | P | R | F1)
   - Comparison to SOTA scoreboard: "Sonnet 27.1% (baseline to beat), Haiku
     36.4% (SOTA)"

**Constraints:**
- Import types from `./types.ts` and `../types.ts`.
- Handle edge cases: zero findings (P=0), zero golden (R=0), empty bucket
  (report 0, don't divide by zero).
- No comments in code. ESM, strict.
- Do NOT modify `src/index.ts`.

**Verification:**
- `bun run build` passes.
- Given 10 TP, 5 FP, 3 FN → P = 10/15 = 0.667, R = 10/13 = 0.769,
  F1 = 0.714.
- Severity-weighted: a critical TP (weight 4) counts 4× a low TP (weight 0.5).

---

### Agent G — Integration & Eval Runner (`src/index.ts` + `scripts/eval.ts`)

**Model:** `glm-5.2`
**Phase:** 4 (after Agents B, D, E, F)
**Depends on:** ALL other agents

**Task:** This is the integration agent. It is the SOLE owner of `src/index.ts`
modifications and creates the eval runner script. It wires all modules
together.

**Key responsibilities:**

1. **Structured-finding adapter in `src/index.ts`** (`reviewDiffStructured`):
   - Add a new exported function `reviewDiffStructured` (see §4.7) that:
     a. Uses the same flat-concat diff approach as the existing `reviewDiff`
        (for the baseline measurement — do NOT use the chunker here yet; the
        baseline is the current single-shot approach).
     b. Modifies the system prompt to request structured JSON output: an array
        of objects matching `CommentSpec` (file, line, category, severity,
        message, rationale, suggestion).
     c. Uses `response_format: { type: "json_object" }` if the API supports
        it, otherwise instruct the model to wrap output in ```json fences and
        parse accordingly.
     d. Parses the response into `CommentSpec[]`. Handle parse failures
        gracefully (return empty array + log error).
     e. Returns `{ findings: CommentSpec[], usage }`.
   - DO NOT remove or break the existing `reviewDiff` function — the GitHub
     Action still uses it. Add `reviewDiffStructured` alongside it.
   - The structured prompt should include:
     - The PR title + body + diff (same as current)
     - Instructions to identify bugs, logic errors, security issues,
       performance problems, and best-practice violations
     - The JSON output schema with field descriptions
     - The mandatory `rationale` field (I.E2 from arXiv:2410.06515)

2. **`scripts/eval.ts` — the eval runner**:
   - CLI interface: `bun run scripts/eval.ts [--model <id>] [--limit <n>]
     [--fixture-dir <path>] [--output <path>]`
   - Defaults: `model = "deepseek-v4-flash"`, `limit = 50` (all PRs),
     `fixture-dir = "fixtures/real/martian"`, `output = stdout + JSON file`.
   - Flow:
     a. Load Martian fixture via `loadMartianFixture(fixtureDir)`.
     b. Apply `--limit` if specified (for quick test runs).
     c. For each `GoldenPr`:
        - Call `reviewDiffStructured(pr.diff, pr.meta.title, pr.meta.body,
          apiKey, baseURL, model)` → `CommentSpec[]`.
        - Record the diff-size bucket via `getDiffSizeBucket(pr.diff)`.
        - Log progress (PR id, # findings, elapsed time).
     d. For each PR: run `judge(findings, pr.golden, apiKey, baseURL)` →
        `MatchResult[]`.
     e. Aggregate all matches across all PRs.
     f. Call `computeMetrics(allMatches, allFindings, allGolden, model,
        diffBuckets)`.
     g. Print `formatReport(report)` to stdout.
     h. Write the `EvalReport` JSON to `--output` path (if specified).
   - Handle errors per-PR: if a single PR fails (API error, parse error), log
     it and continue with the remaining PRs. Report how many PRs succeeded.
   - Rate limiting: add a small delay between API calls if needed to avoid
     hitting rate limits. Process PRs sequentially (not in parallel) for the
     baseline run to ensure reproducibility.

3. **Wire chunker into `src/index.ts`** (minimal, for future use):
   - Import `chunkDiff` from `./chunker.ts`.
   - In the `run()` function (GitHub Action entry point), replace the flat
     concat at `src/index.ts:86` with `chunkDiff(files)`. For now, still send
     all hunks as a single call (the per-hunk routing is P4, Wave 1). This
     prepares the wiring without changing the generation approach.
   - Actually — DO NOT change the Action's behavior yet. The baseline must be
     measured on the CURRENT flat-concat approach. Instead, just ensure the
     chunker is importable and leave the Action flow as-is. The eval script
     uses the flat concat for the baseline. (The chunker is exercised by
     P14's stratification, not by the generation pipeline yet.)
   - Revise: leave `src/index.ts:86` as-is for the Action. The chunker module
     exists and is available. Agent H can optionally run a post-chunker eval
     comparison, but the baseline is flat-concat.

**Constraints:**
- SOLE owner of `src/index.ts` changes. No other agent touches this file.
- DO NOT break the existing `reviewDiff` function or the GitHub Action flow.
- DO NOT commit `dist/` changes.
- No comments in code. ESM, strict.
- Must run `bun run build` after all changes.

**Verification:**
- `bun run build` passes.
- `bun run scripts/eval.ts --limit 1` runs end-to-end on 1 Martian PR and
  produces a partial EvalReport (no crash).
- The existing `bun run test:local` still works (Action flow not broken).

---

### Agent H — Baseline Eval Run + PLAN.md Update

**Model:** `glm-5.2`
**Phase:** 5 (after Agent G)
**Depends on:** Agent G (full eval runner)

**Task:** Run the baseline evaluation on all 50 Martian PRs, record the
"before" number, and update PLAN.md.

**Key responsibilities:**

1. **Run the full eval:**
   ```bash
   export OPENCODE_API_KEY=...  # from .env
   bun run scripts/eval.ts --model deepseek-v4-flash \
     --fixture-dir fixtures/real/martian \
     --output eval-results/wave-0-baseline.json
   ```
   - Run with `deepseek-v4-flash` (the current baseline model).
   - If time/budget allows, also run with `glm-5.2` for comparison.
   - Record: P, R, F1, severity-weighted F1, per-bucket F1, per-category
     recall.

2. **Sanity-check the results:**
   - The F1 should be near or below Sonnet 27.1% (RESEARCH.md §8.4: "A
     pr-reviewer result near or below Sonnet 27.1% on real PRs is the expected
     baseline for a single-shot unchunked reviewer").
   - If F1 is significantly above 36.4% (Haiku SOTA), investigate — possible
     data contamination or judge calibration issue.
   - Check diff-size stratification: confirm the 10–50 bucket scores higher
     than >150 (if any >150 PRs exist in the fixture).
   - Check per-category recall: Performance should be near 0% (universal blind
     spot per 2606.15689).

3. **Update PLAN.md:**
   - **Status tracker**: set P1 → `done`, P14 → `done`.
   - **Changes log**: add a row with date, projects (P1, P14), change summary,
     eval delta (the baseline F1 number), and commit hash (once committed).
   - **Eval scoreboard**: fill in "Our score" column with the baseline numbers.
   - **Decisions log**: add a row for the Severity/Category design decision
     (see §8 below).
   - **Memory**: add any learnings from the baseline run (e.g., judge
     calibration notes, API rate limit issues, Martian data format quirks).

4. **Write a brief summary** of the baseline results in
   `implementation-plans/wave-0-results.md` (optional but recommended for
   traceability).

**Constraints:**
- Do NOT modify any source code. Only run the eval and update docs.
- Report synthetic and real results separately if any synthetic data is used
  (RESEARCH.md §8.3 must #3). The Martian benchmark is all real PRs.
- If the eval fails partway through, record partial results and diagnose.

**Verification:**
- `eval-results/wave-0-baseline.json` exists and contains a valid `EvalReport`.
- PLAN.md status tracker shows P1 + P14 as `done`.
- PLAN.md eval scoreboard has the baseline numbers filled in.

---

## 6. Design Decisions to Resolve

### 6.1 Severity vs. Category (Agent A must resolve)

**The tension:** The P1 sketch in PROJECTS.md defines:
```ts
export type Severity = "bug" | "security" | "perf" | "nit" | "best-practice";
```
This conflates issue TYPE (security, perf, best-practice) with impact level
(bug, nit). Meanwhile, P14's severity-weighted F1 uses weights:
`critical 4×, high 2×, medium 1×, low 0.5×` — which requires an impact-level
enum, not a type enum.

**Resolution (Agent A should implement this):**
```ts
export type Severity = "critical" | "high" | "medium" | "low";
export type Category = "logic" | "security" | "performance" | "best-practice" | "test" | "comment";
```
- `Category` = what kind of issue (maps to per-category recall in P14).
- `Severity` = how impactful (maps to severity-weighted F1 in P14).
- `CommentSpec` has both `category: Category` and `severity: Severity`.
- This supersedes the P1 sketch's Severity definition. Agent H logs this as a
  decision in PLAN.md's decisions log.
- Downstream impact: P12 (Severity tagging) will use the new `Severity` enum
  for impact levels and `Category` for issue types. P4 (Router) escalation
  checks `category === "security"` rather than `severity === "security"`.

### 6.2 Baseline measurement scope (Agent G must resolve)

**The tension:** Should the baseline run use the chunker (P1) or the flat
concat?

**Resolution:** The baseline MUST use the flat concat (the current approach at
`src/index.ts:86`) to establish the "before" number. The chunker's effect on
F1 is measured in Wave 1 (P4 per-hunk routing). P14 uses the chunker only for
diff-size stratification (bucketing PRs by size), not for generation.

### 6.3 Martian data format variability (Agent D must handle)

The Martian benchmark repo's exact data format is not known until inspected.
Agent D must:
1. Inspect the repo structure first.
2. Adapt the loader to the actual format.
3. If the format is incompatible or the repo is unavailable, fall back to
   documenting the gap and using the existing `fixtures/sample.diff` as a
   single-PR smoke test. Flag the issue for resolution.

### 6.4 Judge LLM cost management (Agent E must handle)

Pass 2 calls `glm-5.2` for each deferred case. With 50 PRs × ~3 findings × ~3
golden comments, there could be hundreds of deferred pairs. To manage cost:
- Only defer cases where Pass 1 found a PARTIAL signal (same file but line
  mismatch, or different file but same category + nearby line).
- Cap Pass 2 calls at a configurable limit (default 200).
- Batch where the API supports it.

---

## 7. Verification Gates

After each phase, the coordinating agent must verify:

| Phase | Gate | Command | Expected |
|---|---|---|---|
| 1 | Agent A done | `bun run build` | Compiles; `src/types.ts` exists |
| 2 | Agents B + C done | `bun run build` | Compiles; chunker + eval types exist |
| 3 | Agents D + E + F done | `bun run build` | Compiles; martian loader, judge, metrics exist |
| 3 | Martian data loaded | manual check | `fixtures/real/martian/` has 50 PRs / ~136 golden |
| 4 | Agent G done | `bun run build` | Compiles; `reviewDiffStructured` exists |
| 4 | Smoke test | `bun run scripts/eval.ts --limit 1` | Runs 1 PR end-to-end without crash |
| 4 | Action not broken | `bun run test:local` | Still works (uses `OPENCODE_API_KEY`) |
| 5 | Baseline run | `bun run scripts/eval.ts` | Full 50-PR eval produces EvalReport |
| 5 | Sanity check | compare to SOTA | F1 near/below 27.1% (Sonnet baseline) |

---

## 8. Risk Mitigation

| Risk | Mitigation |
|---|---|
| Agent A types don't match downstream needs | Agent A publishes contracts FIRST (Phase 1); all agents code against §4 contracts, not against Agent A's output |
| Merge conflicts on `src/index.ts` | Agent G is the SOLE owner of `src/index.ts` changes. No other agent touches it. |
| Martian repo format unexpected | Agent D inspects first, adapts loader, falls back to sample.diff smoke test if needed |
| LLM judge inflates scores (Pass 2) | Default to `false_positive` on parse failure; use temp 0; cap deferred cases |
| API rate limits during eval | Agent G processes PRs sequentially with small delay; Agent H can resume from partial results |
| Baseline F1 unexpectedly high (data contamination) | Agent H flags it; check if Martian PRs are in model training data (RESEARCH.md §10 open question) |
| `CommentSpec` JSON parse failures | `reviewDiffStructured` handles gracefully (empty array + log); eval continues per-PR |
| `Severity` enum change breaks PROJECTS.md alignment | Agent H logs the decision in PLAN.md; downstream projects (P12, P4) updated in their respective waves |

---

## 9. File Manifest

### New files created in Wave 0:

| File | Agent | Purpose |
|---|---|---|
| `src/types.ts` | A | Shared types: PrContext, Severity, Category, Usage, CommentSpec, DiffFile |
| `src/chunker.ts` | B | Diff chunking engine: chunkDiff, splitOversizedHunk, mergeTinyHunks, Hunk |
| `src/eval/types.ts` | C | Eval domain types: GoldenComment, GoldenPr, MatchResult, EvalReport, etc. |
| `src/eval/martian.ts` | D | Martian fixture loader + diff-size bucketing |
| `src/eval/judge.ts` | E | Two-pass judge: deterministic Pass 1 + LLM Pass 2 (glm-5.2) |
| `src/eval/metrics.ts` | F | P/R/F1, severity-weighted F1, diff-size + category stratification |
| `scripts/eval.ts` | G | Eval runner CLI: load fixture → review → judge → metrics → report |
| `fixtures/real/martian/*.json` | D | Ported Martian benchmark data (50 PRs / 136 golden) |
| `eval-results/wave-0-baseline.json` | H | Baseline eval output |

### Files modified in Wave 0:

| File | Agent | Change |
|---|---|---|
| `src/index.ts` | G | Add `reviewDiffStructured` + `StructuredReviewResult` (existing functions untouched) |
| `PLAN.md` | H | Status tracker (P1, P14 → done), changes log, eval scoreboard, decisions log |

### Files NOT touched:

| File | Reason |
|---|---|
| `dist/index.mjs` | Never commit dist changes unless shipping |
| `action.yml` | No Action input changes in Wave 0 |
| `package.json` | No new dependencies needed (uses existing `openai` SDK) |
| `scripts/local-test.ts` | No changes needed; eval runner is separate |
| `RESEARCH.md` | No research changes; evidence is fixed |
| `PROJECTS.md` | Type sketches are reference only; actual types in `src/types.ts` |

---

## 10. Execution Summary (for the coordinating agent)

```
Phase 1: Agent A (glm-5.2) → src/types.ts
         ─── verify: bun run build ───

Phase 2: Agent B (glm-5.2) → src/chunker.ts          ┐
         Agent C (flash)   → src/eval/types.ts        ┘
         ─── verify: bun run build ───

Phase 3: Agent D (flash)   → src/eval/martian.ts + fixtures/real/martian/
         Agent E (glm-5.2) → src/eval/judge.ts
         Agent F (flash)   → src/eval/metrics.ts
         ─── verify: bun run build + fixture load check ───

Phase 4: Agent G (glm-5.2) → src/index.ts (adapter) + scripts/eval.ts
         ─── verify: bun run build + smoke test (--limit 1) + test:local ───

Phase 5: Agent H (glm-5.2) → run full eval + update PLAN.md
         ─── verify: eval-results/wave-0-baseline.json + PLAN.md updated ───
```

**Total agents:** 8
**Parallelism:** Phase 2 (2 agents), Phase 3 (3 agents)
**Critical path:** A → C → E → G → H (5 sequential steps)
**Estimated API calls for baseline run:** ~50 reviewer calls + ~200 judge calls
  (glm-5.2 for judge, deepseek-v4-flash for reviewer)
