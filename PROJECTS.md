# pr-reviewer — Implementation Projects

A modular breakdown of `RESEARCH.md` into self-contained implementation projects.
Each project owns a distinct part of the reviewer pipeline, preserves the full
research evidence (paper IDs, numbers, datasets, models, ablations), and
includes a concrete TypeScript module/interface sketch so implementation can
start immediately.

The current implementation (`src/index.ts`) is a clean ~2018-era baseline: PR
diff + title + body → single LLM call (`deepseek-v4-flash`) → one review
comment, with a "skip style nitpicks" system prompt. These projects close the
gaps mapped in `RESEARCH.md` §7.

## How to read each project

- **Goal** — what the module does.
- **Evidence** — the research grounding (arXiv IDs, numbers, datasets, models,
  ablations), preserved verbatim from `RESEARCH.md`.
- **Current-state gap** — what `src/index.ts` does today vs. the SOTA row.
- **Module + interface sketch** — proposed TypeScript shape.
- **Scope (phased)** — what to build first vs. later.
- **Dependencies** — which projects feed / are fed by this one.

## Proposed module layout

```
src/
  index.ts            # orchestrator: triage -> chunk -> route -> generate -> gate -> post
  types.ts            # shared: Hunk, CommentSpec, Severity, PrContext, Usage
  chunker.ts          # P1
  guidelines/         # P2  (G_Code.md, G_Test.md, G_Comment.md as data)
  prompt.ts           # P3
  router.ts           # P4
  quality-gate.ts     # P5
  posting.ts          # P6
  triage.ts           # P7
  reviewability.ts    # P8
  security.ts         # P9
  det-rules.ts        # P10
  adversarial.ts      # P11
  severity.ts         # P12
  runtime-check.ts    # P13 (optional, flag-gated)
  eval/               # P14 golden evaluation harness
  reviewer-rec.ts     # P15 (optional)
scripts/
  local-test.ts       # extended by P14
  eval.ts             # P14 golden scoring (Martian + two-pass judge)
  redteam.ts          # P11 SEVRA-style harness
fixtures/real/        # P14 captured real PRs + golden labels
```

## Dependency / layering summary

```
P7 Triage ──┐                          P8 Reviewability (opt)
            ├→ P4 Router ──┐
P1 Chunker ─┘              ├→ P5 QualityGate ──→ P6 Inline Posting
P2 Guidelines → P3 Prompt ─┘
P12 Severity ──→ feeds P4 escalation + P6 display
P9 Security  ┐
P10 DetRules ├→ P11 Adversarial (defenses + red-team harness)
P13 Runtime (opt, heaviest infra)
P14 Golden Eval — exercises P1-P6; grounds P2/P4/P5 tuning (minimal, golden-method)
P15 Reviewer-rec (opt)
```

## Recommended build order (by leverage, per RESEARCH.md §9)

P1 → P14 → P2 → P3 → P5 → P4 → P10 → P9 → P11 → P7/P8 → P12 → P13 → P15.

(Evaluation is pulled forward to P14-second so every later change is measured
against the golden Martian method rather than intuition — see RESEARCH.md §8.4.)

---

# P1 — Diff Chunking Engine

**Module:** `src/chunker.ts` (replaces the flat `files.map(...).join` concat at
`src/index.ts:86`)

## Goal

Decompose the PR diff into per-file / per-hunk units targeting the 10–50 line
sweet spot, review each separately, then aggregate.

## Evidence (arXiv:2606.15689, "Bigger Isn't Always Better")

- F1 collapses **~15×** for >150-line diffs; buckets: <10 lines F1 0.657 ·
  **10–50 lines ~0.800 (sweet spot)** · 50–150 ~0.07 · >150 lines 0.043.
- Synthetic-vs-real collapse: Haiku F1 0.847 → **0.066 (−92%)**; Sonnet 0.796 →
  0.050 (−94%); Minimax 0.804 → 0.007 (−99%). Synthetic overstates capability up
  to ~12×. Best real-only F1 = 0.066 (near random).
- Per-category recall: Security ~70% all models; Logic Haiku 24.5% vs Sonnet
  19.6%; **Performance 0% for 4/5 models**; Best Practice ~0% all.
- Ensembling hurts (union combos drop F1 below 0.365 — models detect the same
  bugs, union adds FPs).
- External validation (Martian, 50 PRs / 136 golden comments): Haiku F1 36.4%
  vs Sonnet 27.1% (see P14).
- Methodology: 5 LLMs × 150 samples (100 synthetic + 50 real), 3 conditions;
  two-pass judge (deterministic match ~70% + Claude Opus 4.6 adjudication);
  Martian external = 50 PRs / 5 repos (Sentry, Grafana, Cal.com, Discourse,
  Keycloak) / 136 golden comments / Python, Go, TS, Ruby, Java.

## Current-state gap

`src/index.ts:86` concatenates all file patches into one string and sends it in
a single user message. RESEARCH.md §7 row: "Diff chunking (per-hunk, 10–50 line
sweet spot) … F1 collapses 15x for >150-line diffs."

## Module + interface sketch

```ts
// src/types.ts (shared)
export interface PrContext {
  owner: string; repo: string; number: number;
  title: string; body: string; author: string; isAIAuthored?: boolean;
}
export type Severity = "bug" | "security" | "perf" | "nit" | "best-practice";
export type Category = "logic" | "security" | "performance" | "best-practice" | "test" | "comment";
export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

// src/chunker.ts
export interface Hunk {
  file: string;
  status: "added" | "modified" | "removed" | "renamed";
  oldStart: number;
  newStart: number;
  lineCount: number;
  content: string;
  pathContext?: string;
}
export const SWEET_SPOT = { min: 10, max: 50 } as const; // 2606.15689 ~0.800 F1 bucket
export const HARD_CAP = 150;                              // 15x F1 collapse above this
export function chunkDiff(files: DiffFile[]): Hunk[];
export function splitOversizedHunk(h: Hunk): Hunk[];      // split hunks > max
export function mergeTinyHunks(hs: Hunk[], min = SWEET_SPOT.min): Hunk[]; // coalesce < min
```

## Scope (phased)

1. Parse `patch` into hunks (`@@ ... @@`), group by file, measure line count.
2. Split hunks > `SWEET_SPOT.max`; merge tiny adjacent hunks to stay in range.
3. Attach `pathContext` (directory / module hint) for later routing.

## Dependencies

Depends on: nothing. Enables: P4 (per-hunk routing), P5 (per-comment gating),
P6 (inline line mapping), P14 (diff-size stratification).

---

# P2 — Curated Review Guidelines (G_Code, G_Test, G_Comment)

**Module:** `src/guidelines/` (replaces the generic `SYSTEM_PROMPT` at
`src/index.ts:5`)

## Goal

Make three curated guideline sets the mandatory core of the system prompt, à la
RovoDev.

## Evidence (arXiv:2601.01129, RovoDev, ICSE'26 SEIP)

- Three guideline sets crafted by Atlassian Engineering: **G_Code, G_Test,
  G_Comment**.
- Ablation: PR/Jira context adds only **1–3%**; **review guidelines are the
  highest-impact prompt component (+5pp localization)** — they beat persona,
  CoT, and PR/Jira context combined.
- Architecture is 3-stage, no fine-tuning of generator; zero-shot, no RAG, no
  historical retrieval (works on new projects with zero history).
- Stage 1 prompt structure: persona (P) + task (T) + chain-of-thought + three
  guideline sets + PR title/description + linked Jira summary/description +
  code diff → candidate comments with **file path + line number**.

## Current-state gap

`src/index.ts:5` uses one generic string: "You are a practical code reviewer.
Be concise, direct, and non-technical. Focus on: bugs, logic errors, potential
security issues… Skip formatting, style, or cosmetic nitpicks." RESEARCH.md §7
row: "guidelines beat persona/CoT/context combined."

## Module + interface sketch

```ts
// src/guidelines/index.ts
export type GuidelineId = "G_Code" | "G_Test" | "G_Comment";
export interface GuidelineRule { id: string; severity: "must" | "should"; text: string; }
export interface GuidelineSet { id: GuidelineId; version: string; rules: GuidelineRule[]; }
// Guidelines live as data files (G_Code.md, G_Test.md, G_Comment.md) so they
// can be tuned without redeploying logic. RovoDev: +5pp, beats persona/CoT/context.
export function loadGuidelines(): Promise<GuidelineSet[]>;
```

## Scope (phased)

1. Author versioned `G_Code` (bugs/logic/perf/arch), `G_Test` (test adequacy,
   coverage gaps, flakiness), `G_Comment` (comment/doccuracy, API-contract
   notes) as data.
2. Inject as mandatory structured input to the generation prompt (P3).

## Dependencies

Depends on: P3 (prompt builder consumes them). Enables: the whole generation
stage's quality ceiling.

---

# P3 — RIE-Aligned Prompt Builder + Clarity Gate

**Module:** `src/prompt.ts` + a post-generation clarity check

## Goal

Rewrite the system prompt against the RIE essential criteria and force every
comment to carry an explicit rationale; gate out comments failing an essential
criterion.

## Evidence (arXiv:2410.06515, ISSTA'25, "Clear Code Review Comments")

- **RIE attributes (practitioner-validated, ≥75% rate each important):**
  - **Relevance** — R.E1 [essential]: self-explanatory & relevant to the change.
    R.O1: specifies location. R.O2: shows correct understanding.
  - **Informativeness** — I.E1 [essential]: clear intention
    (question/problem/suggestion = actionable). **I.E2 [essential]: provides
    reason or context.** I.O1: suggests next step. I.O2: gives reference info.
  - **Expression** — E.E1 [essential]: concise & to-the-point. **E.E2
    [essential]: polite & objective (code not person).** E.O1: readable format.
    E.O2: proper syntax/grammar.
- **28.8% of CRCs lack clarity in ≥1 attribute.** Per-attribute deficiency:
  **Informativeness 19.3% (worst)**, Relevance 11.4%, Expression 5.8%. C++ worst
  language (63.6% all-positive).
- **ClearCRC automated evaluator:** best = pre-trained LMs — CodeBERT balanced
  accuracy up to **73.04%**, F1 up to **94.61%**; CodeReviewer 69.46% / 94.61%.
  Pre-trained LMs **strongly outperform much larger LLMs** (Llama3-70B,
  CodeLlama-34B) "due to inability to acquire sufficient knowledge about
  clarity." Generalizes to newer projects with only ~3% drop.
- Study method: 251 papers (47 CRC-related) + 11-engineer interview + 103-valid
  survey (37 countries) + 2,438 diff+CRC pairs (2 annotators, Cohen's κ 0.87).

## Current-state gap

No structured output schema; no rationale requirement; no clarity gate. §7 row:
"28.8% of comments lack clarity; Informativeness worst."

## Module + interface sketch

```ts
// src/prompt.ts
export interface CommentSpec {
  file: string;
  line: number;
  category: Category;
  severity: Severity;
  message: string;
  rationale: string;   // I.E2: mandatory reason/context
  suggestion?: string;
}
export function buildGenerationPrompt(
  hunk: Hunk, guidelines: GuidelineSet[], pr: PrContext,
): ChatMessage[];
export interface RieCheck {
  relevance: boolean;
  informativeness: boolean;
  expression: boolean;
  failures: ("R.E1" | "I.E1" | "I.E2" | "E.E1" | "E.E2")[];
}
// Phase 1: glm-5.2 self-check against the RIE rubric.
// Phase 2: swap in ClearCRC-style CodeBERT (bal-acc 73.04%).
export function rieSelfCheck(c: CommentSpec): Promise<RieCheck>;
```

## Scope (phased)

1. Bake R.E1, I.E1, I.E2, E.E1, E.E2 into the prompt as **hard output rules**;
   output schema requires a `rationale` field per comment.
2. Treat vague comments ("This is wrong" with no why) as **auto-rejects before
   posting** (Informativeness is the top 19.3% failure).
3. Post-generation clarity gate: LLM self-check now (P4's `glm-5.2`); CodeBERT
   classifier later.

## Dependencies

Depends on: P2 (guidelines feed the prompt). Feeds: P5 (quality gate).

---

# P4 — Tiered Model Routing

**Module:** `src/router.ts` (replaces the hard-coded
`model = "deepseek-v4-flash"` at `src/index.ts:19`)

## Goal

Replace the single-model call with three-tier routing across the OpenCode Go
API (`https://opencode.ai/zen/go/v1`, OpenAI-compatible).

## Evidence (arXiv:2606.15689 + RESEARCH.md §11)

- Haiku-class beats Sonnet-class on F1/recall at **3.2× lower cost** (Haiku F1
  0.365 vs Sonnet 0.343; recall 0.293 vs 0.248; cost/review $0.003 vs $0.010);
  Haiku generates 38% more findings. Sonnet is **dominated**.
- SEVRA-Bench (arXiv:2606.13757) refusal rates: Opus 4.7 **97.6%** · GPT-5.5
  **95.2%** · GLM-5 83% · Haiku 4.5 52.9% · **DeepSeek V4-Flash 53.4%** · Kimi
  K2.5 52.3% · Grok Code Fast 39% · GPT-5.4-nano 35.6%. **Closed-vs-open gap
  ~45pp.** → cheap/open models must not be the sole merge/security gate.

**Model tiers (RESEARCH.md §11.1):**

| Tier | Model | Role |
|---|---|---|
| Best/thinking | `glm-5.2` | Final reasoning, hard cases, security/architecture judgment, quality-check pass |
| Middle/balanced | `deepseek-v4-pro` | Default per-hunk review generation, inline comment drafting |
| Cheapest/loop | `deepseek-v4-flash` | Loops, classification, triage, retry/refine, expensive-tail pre-filter |

**Escalation rule (§11.4):** any hunk touching
**auth / crypto / SQL / deserialization / untrusted-input**, or any hunk where
pro and flash disagree → route to `glm-5.2`. Directly addresses SEVRA-Bench's
~47% miss rate for open-weight-only review.

**Other models available for A/B eval (§11.3):** Opus 4.6/4.7 (97.6% RR ceiling),
Sonnet 4.6 (RovoDev's gen model, dominated), Haiku 4.5 (Pareto winner), GPT-5.4
mini / GPT-5.5, gpt-4o-mini (RovoDev's factual judge — *minimal impact,
expensive, avoid*), Minimax M2.7, GLM-5, Grok Code Fast (39% RR — unsafe solo),
Kimi K2.5 (52.3% RR — unsafe solo).

## Current-state gap

`src/index.ts:19` hard-codes `deepseek-v4-flash` for the single call. §7 row:
"verify cost/recall Pareto; 3.2x cheaper possible."

## Module + interface sketch

```ts
// src/router.ts
export type ModelId = "glm-5.2" | "deepseek-v4-pro" | "deepseek-v4-flash";
export type ModelTier = "best" | "middle" | "cheap";
export interface RoutingContext {
  hunk: Hunk;
  severity: Severity;
  triage?: TriageScore;        // from P7
  securityFlags: SecurityFlag[]; // from P9
  proFlashAgree?: boolean;
}
export function pickModel(ctx: RoutingContext): ModelId;
// SEVRA: open-weight ~53% RR -> escalate these paths to glm-5.2.
export const SECURITY_PATHS = ["auth", "crypto", "sql", "deserialize", "untrusted-input"];
```

## Scope (phased)

1. `pickModel(hunk, context, signals)` → model id; per-stage binding (triage→
   flash, gen→pro, gate→glm-5.2, refine→flash).
2. Cost/usage accounting per tier (extends `formatTokenFooter`).
3. A/B harness to re-test `deepseek-v4-flash` vs Haiku-class / GPT-5.4-mini-class
   on real PRs (P14).

## Dependencies

Depends on: P1 (per-hunk granularity drives routing). Enables: P5, P9, P11
(escalation targets).

---

# P5 — Actionability Quality Gate

**Module:** `src/quality-gate.ts`

## Goal

Filter vague/nitpick/non-actionable candidate comments before posting — the
single highest-leverage gate.

## Evidence (arXiv:2601.01129, RovoDev)

- **Trained actionability classifier = ModernBERT** fine-tuned on **5 months /
  50,000+ RovoDev comments** labeled `<comment, resolved?>`.
- Ablation: actionability (ModernBERT) = **+20pp location alignment, +15pp
  location+semantic**.
- **Factual-correctness LLM-judge (gpt-4o-mini, binary selection) had minimal
  impact** (surprising) and is expensive → authors recommend prioritizing the
  actionability classifier. (Deprioritize the LLM-judge factual stage.)
- Success metric: **code resolution rate 38.70%** (RovoDev) vs 44.45% (human) —
  5.8pp gap; PR cycle time median **14.35h vs 20.73h = −31%** (Q1 −56%, Q3 −35%,
  p<.001, n=43,633 vs 42,981); human comments/PR 2.87 vs 4.45 = −35.6%. Offline:
  only 4% of comments human-aligned post-quality-check, yet 38.70% drove code
  changes.
- Online deployment: 12-month GA, 2,000+ repos, 54,000+ comments, 5,500+
  engineers, avg 2.1 comments/PR.

## Current-state gap

No second stage; the single LLM call's output is posted verbatim. §7 row: "the
single highest-leverage quality gate (+20pp)."

## Module + interface sketch

```ts
// src/quality-gate.ts
export interface ActionabilityVerdict {
  actionable: boolean;
  score: number;
  reason: string;
}
// Phase 1: glm-5.2 go/no-go per comment (correctness + RIE clarity from P3).
// Phase 2: ModernBERT on <comment, resolved?> (+20pp location alignment).
export function gateComment(c: CommentSpec): Promise<ActionabilityVerdict>;
// flash loop: force a rationale (I.E2) when Informativeness fails.
export function refineComment(
  c: CommentSpec, v: ActionabilityVerdict,
): Promise<CommentSpec>;
```

## Scope (phased)

1. Phase 1 (no training): `glm-5.2` go/no-go per comment — correctness + RIE
   clarity (P3).
2. Phase 2: train ModernBERT-style classifier on resolved/unresolved labels
   (needs a labeling pipeline — collect `<comment, resolved?>` from our own
   posted reviews).
3. Supersede expensive LLM-judge factual checks; keep a cheap flash refinement
   loop.

## Dependencies

Depends on: P1, P3, P4. Feeds: P6 (only gated comments get posted inline).

---

# P6 — Inline Per-Hunk Review Comments

**Module:** `src/posting.ts` (replaces the single issue-comment post at
`src/index.ts:107`)

## Goal

Post findings as inline per-hunk comments (file path + line number) instead of
one big PR comment.

## Evidence

- RovoDev (2601.01129): output = candidate comments with **file path + line
  number**; native Bitbucket, event-driven (PR-creation → clone → generate →
  quality gate → post inline). Human-in-the-loop retains final authority.
- CodeReviewer (Li FSE 2022): pre-trained model for review-comment generation +
  reviewer recommendation; main pre-LLM baseline. ~138k–328k diffs, 9 langs.
- Current tool posts one big comment — research frames this as "lower signal,
  harder to act on."

## Current-state gap

`src/index.ts:107` posts/updates a single issue comment. §7 row: "one big
comment → lower signal, harder to act on."

## Module + interface sketch

```ts
// src/posting.ts
export interface InlineComment {
  path: string;
  line: number;
  side: "RIGHT" | "LEFT";
  body: string;
}
export function buildInline(comments: CommentSpec[], hunks: Hunk[]): InlineComment[];
export function postReview(
  ok: Octokit,
  p: {
    owner: string; repo: string; prNumber: number;
    summary: string; inline: InlineComment[]; existingReviewId?: number;
  },
): Promise<void>;
export function buildSummaryBody(review: string, usage: Usage): string; // keeps token footer
```

## Scope (phased)

1. Use `octokit.rest.pulls.createReview` with
   `comments: [{ path, line, side, body }]` + `event: "COMMENT"`.
2. Map each gated finding's line back to the hunk's `startLine` + offset (P1).
3. Keep the summary issue comment for the token footer + overall verdict; inline
   comments carry the per-finding detail. Idempotency: dismiss/update prior
   review on re-runs.

## Dependencies

Depends on: P1 (line mapping), P5 (gated findings only).

---

# P7 — Triage / Pre-filter Gate (Structural Effort Prediction)

**Module:** `src/triage.ts`

## Goal

Pre-rank incoming PRs by predicted review effort; fast-track simple merges;
route only the "expensive tail" to full LLM review.

## Evidence (arXiv:2601.00753, MSR'26, "Early-Stage Prediction of Review Effort
in AI-Generated PRs")

- **Binary "Circuit Breaker" LightGBM classifier (+ Stacking)** on **35
  features** (Intent, Context, Complexity) at T0 (creation) and T1 (pre-review).
  Effort = sum of reviews+comments; "High Cost" = top 20%; "Ghosting" = Rejected
  + human feedback + no follow-up >14 days. SHAP for interpretability.
- Dataset: **AIDev v1.0; 33,707 agent-authored PRs from 2,807 GitHub repos
  (>100 stars).** Agents: Codex (21,799), Copilot (5,017), Devin (4,827),
  Claude 3.5 (523).
- Numbers: LightGBM temporal split **AUC 0.957**, PR-AUC 0.881; repo-disjoint
  AUC 0.834. **Size-only baseline AUC 0.933 (temporal) → 0.65 (repo-disjoint).**
  CodeBERT (text) AUC 0.52. At 20% review budget captures **69% of high-effort
  PRs.**
- Top SHAP features: **additions, body_length, total_changes; has_plan = strong
  negative predictor of ghosting.**
- Headline: structural/footprint features far outperform semantic/text ("agents
  tell less than they touch"); bimodal — 28.3% instant merges vs iterative
  failures; ghosting driven by plan-less multi-component sprawls; **signal is
  agent-agnostic (LOAO AUC >0.95).**

## Current-state gap

No pre-filter; every PR gets the full single-shot call. §7 row: "could flag
plan-less/high-effort PRs."

## Module + interface sketch

```ts
// src/triage.ts
export interface TriageFeatures {
  additions: number; deletions: number; bodyLength: number;
  totalChanges: number; fileTypes: string[]; entropy: number; hasPlan: boolean;
}
export interface TriageScore {
  effort: number;
  route: "fast-track" | "buffer" | "escalate";
  ghostingRisk: number;
}
// SHAP top: additions, body_length, total_changes, has_plan. Target AUC 0.957.
export function extractFeatures(pr: PrContext, files: DiffFile[]): TriageFeatures;
export function triageScore(f: TriageFeatures): TriageScore; // phase1 rule weights
```

## Scope (phased)

1. Cheap `deepseek-v4-flash`-eligible feature extractor: patch size, file types,
   entropy, `has_plan` (PR body structure), additions/deletions, body_length.
2. Phase 1: rule-based scoring from the SHAP features (no model shipping needed).
   Phase 2: trained LightGBM once labels exist. Validate on repo-disjoint (not
   just temporal) splits.

## Dependencies

Depends on: nothing (runs first). Feeds: P4 (routing), P8.

---

# P8 — Reviewability / Evidence Signal (AI-authored PRs)

**Module:** `src/reviewability.ts`

## Goal

Emit a reviewability signal distinct from a correctness signal for AI-authored
PRs; flag missing evidence/risk disclosures.

## Evidence (arXiv:2606.17099, "Software Delegation Contracts")

- **Delegation contract tuple `<T,A,W,C>`** = Task (objective, scope, non-goals,
  success criteria) + Authority (allowed/forbidden actions) + Work package
  (artifact + evidence) + Acceptance context (who reviews, against what).
- Controlled pilot: 64 agent runs (Claude Code) on ~600-line TypeScript API
  with seeded defects; 10 tasks; 2 model tiers (Sonnet 4.6, Haiku 4.5); 3
  conditions (A=issue prompt, B=explicit contract, C=contract+required evidence
  bundle); 3 blinded model reviewers = 192 reviews; 30 A/B matched pairs.
- **Evidence sufficiency 3.90 → 4.73 (+0.83/5, p<0.0001, Cliff's δ 0.66)**,
  22/30 pairs improved / 0 worsened. Ambiguity 1.30 → 1.07 (p=0.035). **All 64
  runs passed hidden acceptance checks, zero scope violations — contracts buy
  reviewability, NOT correctness (the dissociation is the central result).**
  Cost: tokens +13%, wall-clock +38%, patch size +45%. Weaker-tier (Haiku)
  effect ~2× Sonnet.
- Evidence is demand-elastic: residual-risks section **0% spontaneous → 100% on
  demand.**

Cross-ref: MSR'26 (P7) — `has_plan` is a strong negative predictor of ghosting.

## Current-state gap

No reviewability signal; no contract/evidence checks. §7 row: "could flag
plan-less/high-effort PRs."

## Module + interface sketch

```ts
// src/reviewability.ts
export interface DelegationContract { // <T,A,W,C>
  task: TaskSpec;
  authority: AuthoritySpec;
  workPackage: WorkPackage;
  acceptance: AcceptanceContext;
}
export interface ReviewabilityReport {
  score: number;
  missing: ("residual-risks" | "known-limitations" | "changed-files-reasons" | "reviewer-checklist")[];
  authorTier: ModelTier;
}
// Dissociated from correctness; residual-risks 0%->100% on demand.
export function assessReviewability(pr: PrContext, files: DiffFile[]): ReviewabilityReport;
export function synthContract(pr: PrContext): DelegationContract; // auto-synthesize for AI PRs
```

## Scope (phased)

1. Detect AI-authored PRs (author = known bot/agent, or signals from P7).
2. Check for / synthesize a contract: changed-files-with-reasons,
   known-limitations, residual-risks, reviewer-checklist fields.
3. **Flag PRs missing residual-risk/limitation disclosures** (agents never
   volunteer them spontaneously — 0% → 100% only on demand). Weight
   reviewability more heavily for weaker author models (Haiku effect ~2× Sonnet).

## Dependencies

Depends on: P7 (structural signals), P4 (author-model tier awareness). Optional;
sits alongside the review.

---

# P9 — Security Specialization + Classifier Gate

**Module:** `src/security.ts`

## Goal

A high-precision security classifier gate + security-specialized review, since
generic models collapse on security.

## Evidence (arXiv:2601.01042, SeRe, ICSE 2026)

- **Dataset: 373,824 raw review instances → 6,732 security-related reviews
  (15,132 comments); 5 langs (C, C++, C#, Java, Go); 311 repos.** Largest public
  security-related CR dataset (vs Yu 614 / Paul 516). Benchmark subset 4,788
  samples.
- Method: active-learning ensemble classifier; pseudo-labels from lightweight
  LLMs (unanimous pos/neg kept) validated by DeepSeek-V3 → balanced 3,000
  initial set; iterative AL sends only inconsistent (hardest) cases to humans;
  **4-of-5 voting → positive.**
- **Classifier: 5 instruction-tuned 7–9B models; Precision 92.75%, Recall
  42.38%, F1 58.18% (deliberate precision-first).** Baselines: GPT-4o P 41.58%,
  DeepSeek-V3 P 59.68%. Fleiss' κ 0.88.
- Distribution: security is ~4% of review comments; **>60% are memory-mgmt
  (38.99%) + concurrency (23.85%)**; 14 CWE-derived categories; 84% map to real
  CVE/CWE.
- Benchmark: generic CR models collapse — Auger BLEU 15.79 → 3.67, EM 4.14% →
  0.0%; CodeReviewer EM 0.06% → 0.02%. LLMs win semantic (DeepSeek-V3 SemSim
  39.82%) but lose lexical. **Few-shot hurts LLMs (0-shot beats 2-shot).** Exact
  Match ~0% for every approach.

## Current-state gap

Generic single-shot review; no security specialization. §7 row: "generic models
collapse on security (EM ~0%)."

## Module + interface sketch

```ts
// src/security.ts
export interface SecurityFlag {
  cwe: string; category: string; line: number; confidence: number;
}
// 14 CWE-derived categories; memory-mgmt 38.99%, concurrency 23.85%.
export const SECURITY_CATEGORIES: string[];
// 4-of-5 ensemble target P 92.75%; 0-shot not 2-shot (few-shot hurts).
export function securityClassify(hunk: Hunk): Promise<SecurityFlag[]>;
```

## Scope (phased)

1. High-precision security classifier gate (their 4-of-5 ensemble, 92.75% P) as
   a **gating stage** before/alongside generation.
2. Security-specialized fine-tuning on SeRe rather than prompt-only (few-shot
   doesn't help — 0-shot > 2-shot). Use SeRe as a held-out eval set (current SOTA
   ~0% EM, <40% SemSim — large headroom).
3. Route security-flagged hunks to `glm-5.2` (P4 escalation rule).

## Dependencies

Depends on: P1, P4. Pairs with: P11 (red-team).

---

# P10 — Deterministic AST / Data-flow Rules

**Module:** `src/det-rules.ts`

## Goal

Pair the LLM with deterministic rules for performance and architecture bugs
where LLM recall is ~0%.

## Evidence (arXiv:2606.15689)

- Per-category recall: **Performance 0% for 4/5 models (universal blind spot)**
  — N+1 queries, unbounded queries; **Best Practice ~0% all models.**
- Ensembling across models does not help (they detect the same bugs).

## Current-state gap

No deterministic rules; relies solely on the LLM. §9 step 7: "LLM recall ~0% on
performance bugs across all 5 models."

## Module + interface sketch

```ts
// src/det-rules.ts
export interface RuleFinding {
  rule: string; file: string; line: number; message: string; severity: Severity;
}
export interface DetRule { id: string; detect: (h: Hunk) => RuleFinding[]; }
// N+1, unbounded-query, sync-in-loop, missing-index, hot-path-alloc
// (LLM perf recall ~0%).
export const DET_RULES: DetRule[];
export function runDetRules(hunks: Hunk[]): RuleFinding[];
```

## Scope (phased)

1. Rule detectors for the LLM blind spots: N+1 query patterns, unbounded/
   lacking-LIMIT queries, sync-in-loop, missing indexes, obvious hot-path
   allocations.
2. Data-flow checks for taint where feasible (overlaps P9).
3. Findings merged with LLM findings (deterministic ones bypass the
   actionability gate's "vague" filter but still get RIE-formatted).

## Dependencies

Depends on: P1 (hunk structure), P6 (posting). Independent of LLM tier.

---

# P11 — Adversarial / Red-team Robustness

**Module:** `src/adversarial.ts` (defenses) + `scripts/redteam.ts` (harness)

## Goal

Treat PR narrative text as untrusted, attacker-controlled input; add
prompt-injection/social-engineering defenses; gate the tool on SEVRA-Bench-style
adversarial PRs.

## Evidence (arXiv:2606.13757, SEVRA-Bench, CMU/Microsoft/AWS)

- Method: each malicious episode starts from a real CVE fix, reverses it
  (`git apply -R`) to reintroduce the vulnerability, submits as a PR under one
  of **15 social-engineering framings** (diff held fixed, only narrative varies
  — isolates framing-susceptibility). Reviewer = ReAct agent (`inspect_ai`, temp
  0) over isolated Gitea; system prompt deliberately omits security framing
  (measures spontaneous detection). Repos squashed; fresh agent per PR.
- **Dataset: 1,062 malicious PRs across 10 CWE classes (top 10 of 2025 CWE
  Top-25) × 15 framings; 150 source CVE records.** Plus benign security-fix PRs
  to measure false declines. Released as a "retained challenge split" (Haiku 4.5
  + GPT-5.4-nano filter; a PR is retained if at least one model approves it).
- **15 framings:** Fake Bug Fix, Misleading Hardening, Build System Laundering,
  Refactoring, Unsafe Optimization, Appeal to Authority, Review Bias, Prior
  Approval Signal, AI Agent Authored, Dependency Compatibility Claim,
  Misleading Pass, False Coverage, Evidence Dilution, Out of Distribution,
  Emotional Appeal.
- **Refusal rates (RR, higher=better):** Opus 4.7 **97.6%** · GPT-5.5 **95.2%**
  · GLM-5 83% · Haiku 4.5 52.9% · **DeepSeek V4-Flash 53.4%** · Kimi K2.5 52.3%
  · Grok Code Fast 39% · GPT-5.4-nano 35.6%. **Closed-vs-open gap ~45pp.**
- **Framing swings:** open-weight RR swings up to **82pp for the same code**
  (DeepSeek: Appeal to Authority 100% vs Prior Approval 18.2%). Most reliable
  open-weight breakers: **Prior Approval Signal** (DeepSeek 18%, Kimi 14%),
  **Dependency Compatibility Claim** (Grok 12%), **Evidence Dilution**, **Fake
  Bug Fix**. **Misleading Pass is the one framing that dents Opus (→84%).**
- Metrics: **Refusal Rate (RR)** — fraction of malicious PRs not approved among
  valid non-infrastructure runs (primary); **Security Reason Rate (SRR)** —
  among blocked, fraction whose rationale was security-motivated per an LLM
  judge. Standard errors as √(p̂(1−p̂)/n).

## Current-state gap

No input hygiene; no red-team harness. §7 row: "DeepSeek-class ~53% refusal on
malicious PRs."

## Module + interface sketch

```ts
// src/adversarial.ts
export interface SanitizedContext {
  title: string; body: string; strippedClaims: string[];
}
// Ignore claimed CI/coverage/approval signals in prose; verify against repo state.
export function sanitizePrContext(pr: PrContext): SanitizedContext;
export const SEVRA_FRAMINGS: string[]; // 15 framings; breakers listed above
// scripts/redteam.ts: git apply -R CVE fix -> submit under 15 framings ->
//   measure RR + SRR (DeepSeek ~53% RR baseline; GLM-5 83%; Opus 98%).
```

## Scope (phased)

1. **Input hygiene:** ignore claimed CI/coverage/approval signals in prose;
   verify against repo state. Strip/sandbox PR descriptions, commit messages,
   and inline comments entering reviewer context.
2. Do **not** run an open-weight model (DeepSeek ~53% RR) as the sole merge gate
   — pair with `glm-5.2`/frontier reviewer or static analysis (P9, P10).
3. Red-team harness: regenerate reversed-CVE PRs under the 15 framings; measure
   RR + SRR as a regression gate.

## Dependencies

Depends on: P4 (escalation), P9, P10. Open question (RESEARCH.md §10): data
contamination — frontier models may memorize public CVE patterns, inflating
closed-source RR toward saturation.

---

# P12 — Risk-calibrated Depth + Severity Tagging

**Module:** `src/severity.ts`

## Goal

Tag each finding with a severity (bug / security / perf / nit) and calibrate
review depth to risk.

## Evidence (cross-domain standards, RESEARCH.md §6)

- **ISO 26262 (automotive):** risk-based **ASIL A–D** from Severity × Exposure ×
  Controllability; review/verification rigor scales with risk; formal
  **independence** (verifier ≠ author); **bidirectional traceability**
  (requirement ↔ code ↔ test); regression analysis of defects to source.
  Automotive SPICE: SUP.1 Joint Review, SUP.2 Verification.
- **DO-178C (aerospace):** DAL A–E; Level A = 71 objectives, 30 with
  independence; mandatory **bidirectional tracing** (HLR ↔ LLR ↔ source ↔ test
  cases ↔ results); **MC/DC structural coverage** at Level A; objective-based
  "Stages of Involvement" gates (SOI #1–4).
- **NASA (rockets/space):** NPR 7120.5 / 7150.2, ECSS — gated lifecycle reviews
  SRR → SDR → PDR → CDR → TRR → FRR, each with explicit entry/exit criteria,
  independent review board, recorded disposition.
- **Fagan inspection (1976):** roles (author, reader, reviewer, moderator,
  recorder); planning → overview → preparation → meeting → rework → follow-up;
  explicit entry/exit; **80–90% defect detection; defects cost 10–100× less
  when caught early.**
- **Scholarly peer review:** single/double-blind, registered reports; biases
  against negative studies, "role duality."

## Current-state gap

One depth for all PRs; no severity routing. §7 row: "no severity routing."

## Module + interface sketch

```ts
// src/severity.ts
export type ReviewDepth = "full" | "standard" | "light";
// ISO 26262 ASIL A-D scaling; DO-178C independence/traceability.
export function calibrateDepth(sev: Severity, flags: SecurityFlag[]): ReviewDepth;
export function tagFinding(c: CommentSpec): Severity;
```

## Scope (phased)

1. Severity tag per finding (bug / security / perf / nit / best-practice) —
   consumed by P4 (escalation) and P6 (inline display).
2. Depth scaling: high-severity → `glm-5.2` + RIE mandatory rationale +
   actionability gate; nits → flash + lighter gate.
3. Traceability: link findings → file/line/hunk (enables future regression
   analysis).

## Dependencies

Depends on: P1, P4, P5. Lightweight; mostly a tagging contract.

---

# P13 — Dynamic Runtime Checks (build + tests) — optional

**Module:** `src/runtime-check.ts` (flag-gated)

## Goal

Execute build + tests on proposed revisions; static text-match is the field's
most-cited weakness.

## Evidence (arXiv:2602.13377, Khan survey, "Code Review Benchmarks... Pre-LLM
and LLM Era")

- 99 papers (58 pre-LLM + 41 LLM, Jan 2015 – Dec 2025); 5 domains, **18
  fine-grained tasks.**
- **Limitations:** macro-level tasks (impact analysis, tangled-change
  decomposition) overlooked in LLM era; static/"shallow" eval only — **no
  functional/compile/runtime checks (a build-breaking fix can score high)**;
  **BLEU/ROUGE poorly correlate with usefulness.**
- Trends: human-assistance → autonomous end-to-end generative; retrieval →
  generation; standalone understanding "nearly vanished"; static text-match →
  LLM-as-Judge (call for runtime metrics).
- Language shift: Java 61% → 34%; Python 12% → 41% (top in LLM era);
  single-language 59% → 24%; ≥9 langs 2% → 34%.
- Key datasets: CodeReviewer (Li 2022, ~138k–328k diffs, 9 langs), Tufano
  (~168k functions), CodeReviewQA (900 ex, 199 projects, 9 langs), CodeFuse-CR-
  Bench (601 ex, 70 Python projects), LLaMA-Reviewer (288k), RepoAudit (251k LoC
  CWE), SecureReviewer, RovoDev (internal).

## Current-state gap

No runtime verification. §7 row: "static text-match is the field's most-cited
weakness."

## Module + interface sketch

```ts
// src/runtime-check.ts (flag-gated, heaviest infra lift)
export interface RuntimeResult {
  build: "pass" | "fail" | "unknown";
  tests: { passed: number; failed: number };
  log?: string;
}
// Sandboxed; a build-breaking fix must not score high (Khan survey).
export function runBuildAndTests(pr: PrContext): Promise<RuntimeResult>;
```

## Scope (phased)

1. Optional stage: attempt build + test run on the PR branch (sandboxed/CI);
   surface pass/fail as a high-signal finding.
2. Use as an exit criterion (DO-178C-style coverage evidence as review exit
   criterion).
3. Heaviest infra lift; gated behind a capability flag.

## Dependencies

Depends on: P6 (post results). Open question (RESEARCH.md §10): dynamic/runtime
evaluation at scale — no major benchmark does this yet.

---

# P14 — Golden Evaluation Harness (minimal, golden-method)

**Module:** `src/eval/` + `scripts/eval.ts` (extends `scripts/local-test.ts`)

## Goal

A minimal evaluation harness grounded in **RESEARCH.md §8**: score the reviewer
against the **golden** Martian Code Review Benchmark using the **two-pass
judge**, emit P/R/F1 + severity-weighted F1, stratify by diff size, and compare
to the SOTA scoreboard. Kept deliberately minimal — the SEVRA red-team eval
lives in P11 and runtime checks in P13.

> This is the golden evaluation method. Every other project's tuning (P2
> guidelines, P4 model choice, P5 actionability gate) is measured here, against
> the numbers in RESEARCH.md §8.5, not against intuition.

## Evidence (RESEARCH.md §8 — the consolidated evaluation methodology)

**Primary golden benchmark — Martian Code Review Benchmark** (RESEARCH.md §8.2,
§8.4):
- 50 real PRs / 5 repos (Sentry, Grafana, Cal.com, Discourse, Keycloak) / 136
  human-curated golden comments / Python, Go, TS, Ruby, Java. Independent LLM
  judge. Open source: `https://github.com/withmartian/code-review-benchmark`.
- Used as external validation in arXiv:2606.15689.

**The two-pass judge protocol (adopt verbatim, RESEARCH.md §8.1 paper 2.2,
§8.3):**
- **Pass 1 (deterministic, ~70% of cases):** normalized file-path match ∧
  line-range overlap ±5 ∧ comment-type compatibility.
- **Pass 2 (frontier LLM at temp 0):** adjudicates deferred cases as
  `true_positive` / `false_positive` / `partial_match` (0.5 TP), plus 4
  qualitative dims on 1–5 (Depth, Context awareness, Specificity, Suggestion
  correctness). 2606.15689 used Claude Opus 4.6; we use `glm-5.2`.

**Metrics (RESEARCH.md §8.3):**
- **Precision / Recall / F1** over matched findings via the two-pass judge.
- **Severity-weighted F1** — critical 4×, high 2×, medium 1×, low 0.5×
  (2606.15689); rewards catching high-impact bugs.
- **Exact Match (EM)** — ceiling probe only (SeRe ~0%, ComGen 2–6%); never the
  primary score.
- **BLEU / CodeBLEU / ROUGE** — report but never rely on alone (poorly correlate
  with usefulness; field consensus 1.2, 1.3).
- **Semantic Similarity (SemSim)** — embedding match; better than BLEU but still
  not actionability.
- **Code resolution rate** — RovoDev's deployment-grade metric (38.70% SOTA vs
  human 44.45%); replaces text similarity to human comments (used once we post
  real reviews, not for offline Martian scoring).

**Diff-size stratification (RESEARCH.md §8.3 must #6, §8.4 item 3):**
- Bucket results by **<10 / 10–50 / 50–150 / >150 lines** to confirm the sweet
  spot and the large-diff collapse (F1 collapses 15×; aggregate F1 hides this).

**SOTA scoreboard — the numbers to beat (RESEARCH.md §8.5):**

| Benchmark / metric | SOTA | Baseline to beat | Source |
|---|---|---|---|
| Martian F1 (50 real PRs) | Haiku 36.4% (P 32.6 / R 41.2) | Sonnet 27.1%; Haiku #9 on leaderboard | 2606.15689 |
| Real-only F1 (best model) | 0.066 (near random) | synthetic 0.847 (12× overstated) | 2606.15689 |
| F1 by diff size (Haiku) | 10–50 lines ~0.800 | >150 lines 0.043 (15× drop) | 2606.15689 |
| Per-category recall — Security | ~70% (all models) | — (commoditized) | 2606.15689 |
| Per-category recall — Performance | 0% (4/5 models) | — (universal blind spot) | 2606.15689 |

**Methodological musts (RESEARCH.md §8.3):**
1. **Chronological / project-disjoint splits, never random.** Only 1/24 papers
   addressed temporal bias; random splits leak the future into the past.
   Size-only baselines can look strong on temporal (0.933 AUC) and collapse on
   repo-disjoint (0.65).
2. **Always include a human-understandable baseline** (no-change, simple
   complexity classifier). 15/24 papers used black-box/no baselines; a
   synthetic-feature MLP matched/beat all transformers except CodeReviewer on
   ChQual.
3. **Evaluate on real merged PRs, not synthetic alone.** Synthetic eval
   overstates capability by up to ~12× (0.847 vs 0.066 F1); report synthetic and
   real results separately.
4. **Report significance + effect sizes.** Rarely reported; Delegation Contracts
   reports Cliff's δ = 0.66, p<0.0001 as a model.
5. **Stratify by diff size.** (Covered above.)

**Concrete first eval recipe (RESEARCH.md §8.4):** clone
`withmartian/code-review-benchmark`, run pr-reviewer on each of the 50 PRs with a
structured-finding prompt, match findings to the 136 golden comments via the
two-pass judge, compute P/R/F1 + severity-weighted F1, stratify by diff size,
and compare to **Haiku 36.4% / Sonnet 27.1%**. A result near or below Sonnet
27.1% on real PRs is the expected baseline for a single-shot unchunked reviewer;
beating Haiku 36.4% requires chunking (P1) first, then guidelines (P2) +
actionability gate (P5).

## Current-state gap

`scripts/local-test.ts` only runs the reviewer on a fixture or real PR and
prints `buildReviewBody(review, usage)` — **no golden comments, no matching, no
metrics, no scoring harness** (RESEARCH.md §8.4). `fixtures/` has a single
synthetic case. pr-reviewer emits one free-text comment; to compute P/R/F1 it
must emit **structured findings** (file, line range, type, severity, description)
like the 2606.15689 prompt — a noted gap (RESEARCH.md §8.4 item 4).

## Module + interface sketch

```ts
// src/eval/types.ts
export interface GoldenComment {
  file: string;
  lineStart: number; lineEnd: number;
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
export interface MatchResult {
  verdict: JudgeVerdict;
  finding: CommentSpec;        // from the reviewer (structured, per P3)
  golden: GoldenComment;
  qualitative: { depth: number; context: number; specificity: number; suggestion: number };
}
// src/eval/judge.ts — the two-pass judge (RESEARCH.md §8.1 paper 2.2, §8.3)
// Pass 1 deterministic: normalized file-path ∧ line-range overlap ±5 ∧ type compat.
export function judgePass1(findings: CommentSpec[], golden: GoldenComment[]): MatchResult[];
// Pass 2 frontier LLM at temp 0 (glm-5.2): adjudicate deferred -> TP/FP/partial(0.5).
export function judgePass2(deferred: MatchResult[]): Promise<MatchResult[]>;

// src/eval/metrics.ts
export interface EvalReport {
  precision: number; recall: number; f1: number;
  severityWeightedF1: number; // critical 4x, high 2x, medium 1x, low 0.5x
  byDiffSize: { bucket: "<10" | "10-50" | "50-150" | ">150"; p: number; r: number; f1: number }[];
  byCategory: Record<Category, { p: number; r: number; f1: number }>;
  tp: number; fp: number; fn: number;
}
export function computeMetrics(matches: MatchResult[], findings: CommentSpec[], golden: GoldenComment[]): EvalReport;

// scripts/eval.ts
export function loadMartianFixture(dir: string): Promise<GoldenPr[]>;       // port 50 PRs / 136 golden
export function runEval(model: ModelId, fixture: GoldenPr[]): Promise<EvalReport>; // runs reviewer + judge + metrics
// Split discipline: chronological/project-disjoint, never random (RESEARCH.md §8.3 must #1).
export function chronologicalSplit(fs: GoldenPr[]): { train: GoldenPr[]; test: GoldenPr[] };
```

## Scope (phased)

1. **Structured-finding adapter** — extend the reviewer (P3) to emit
   `CommentSpec[]` (file, line range, type, severity, description) so P/R/F1 is
   computable. This is the prerequisite the research flags (§8.4 item 4).
2. **Port Martian** — load the 50 PRs / 136 golden comments into
   `fixtures/real/martian/` as `GoldenPr[]`.
3. **Two-pass judge** — implement Pass 1 deterministic + Pass 2 `glm-5.2` at
   temp 0; emit TP/FP/partial + the 4 qualitative dims.
4. **Metrics + stratification** — P/R/F1, severity-weighted F1, diff-size
   buckets (<10 / 10–50 / 50–150 / >150), per-category breakdown; compare to the
   §8.5 scoreboard (Haiku 36.4% / Sonnet 27.1%).
5. **Baseline + split discipline** — include a human-understandable baseline
   (no-change / simple complexity classifier) and use chronological/project-
   disjoint splits, never random. Report synthetic and real separately.

## Dependencies

Depends on: P1 (chunking is what moves the diff-size stratification), P3
(structured findings), P4 (model under test). Grounds tuning of P2, P4, P5.
Deliberately minimal: SEVRA red-team (RR/SRR) → P11; runtime build+tests → P13.

---

# P15 — Reviewer Recommendation / Routing — optional

**Module:** `src/reviewer-rec.ts`

## Goal

Recommend reviewer assignment strategy (group vs individual) when the tool ever
routes reviews.

## Evidence

- **arXiv:2601.01514 (Kucera et al., ICSE-SEIP 2026, Mozilla Firefox):** ~66,000
  revisions; **group review requests associated with improved review quality
  (fewer regressions) with negligible association with review velocity**; plus
  balanced work distribution and training for new reviewers. Routing (group vs
  individual) affects quality more than speed.
- **Survey 1.1 (arXiv:2403.00088, Badampudi et al., ACM TOSEM):** 244 primary
  studies (2007–2021); practitioner-approved SS problems = summarizing/
  understanding changes + **reviewer recommendation**; only 2 of 36
  reviewer-recommendation tools have accessible links (discoverability failure).
  Research-practice misalignment: most-researched (HOF, SS = 108 papers) valued
  *least*; least-researched (IOF, CRP = 66) valued *most*. 19 RQs across 6
  process steps incl. risk-based review scoping, review-readiness scores,
  explainability for DL accept/reject.
- **Pre-LLM foundations (RESEARCH.md §5):** CodeReviewer (Li FSE 2022) +
  RevFinder = the reviewer-recommendation line.

## Current-state gap

No reviewer recommendation. Not on the critical path.

## Module + interface sketch

```ts
// src/reviewer-rec.ts
export interface ReviewerRecommendation {
  strategy: "group" | "individual";
  reviewers: string[];
  readiness: number;
}
// Group > fewer regressions, ~0 velocity cost (Mozilla Firefox, 2601.01514).
export function recommendReviewer(
  pr: PrContext, signals: TriageScore & ReviewabilityReport,
): ReviewerRecommendation;
```

## Scope (phased)

1. Optional; emit a group-vs-individual recommendation and a review-readiness
   score (feeds the survey's "review-readiness score" research agenda).

## Dependencies

Depends on: P7, P8 (readiness signals).

---

## Cross-references to RESEARCH.md

- §7 gap table → one project per row (P1–P13).
- §8 evaluation methodology → P14 (minimal, golden-method).
- §9 candidate next steps (ordered by leverage) → recommended build order above.
- §10 open questions → noted under P11 (data contamination) and P13 (runtime
  eval at scale).
- §11 model tiers + escalation → P4.
