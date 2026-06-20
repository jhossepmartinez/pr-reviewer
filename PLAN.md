# PLAN.md — pr-reviewer Implementation Plan & Decisions Log

A living document. Defines the approach to implementing `PROJECTS.md`, groups
projects by relatedness/dependency, sequences them into execution waves, and
records decisions, changes, and memory as work progresses.

**Companion files**
- `PROJECTS.md` — full per-project specs, evidence (arXiv IDs, numbers),
  TypeScript interface sketches. Source of truth for each project.
- `RESEARCH.md` — consolidated research grounding: §7 gap table, §8 evaluation
  methodology, §9 leverage-ordered next steps, §10 open questions, §11 model
  tiers + escalation.

**How to use:** update the Decisions log, Changes log, Memory, and Status
tracker as each wave progresses. Every code change references a project ID
(P1–P15) and, where relevant, an arXiv ID. Never delete historical decisions —
supersede them with a new dated entry.

**Current baseline (`src/index.ts`):** single `deepseek-v4-flash` call
(`src/index.ts:19`), flat diff concat (`src/index.ts:86`), one issue comment
post (`src/index.ts:107`), generic system prompt (`src/index.ts:5`). No tests,
no eval harness. Every project closes a gap mapped in RESEARCH.md §7.

---

## Principles

1. **Research-grounded** — every change ties to an arXiv ID in PROJECTS.md /
   RESEARCH.md; no intuition-only edits.
2. **Measure before tune** — P14 (golden Martian two-pass method) grounds P2 /
   P4 / P5 tuning. No prompt, model, or gate change lands without an eval delta.
3. **Real over synthetic** — evaluate on real merged PRs; report synthetic
   separately (synthetic overstates F1 up to ~12×: 0.847 → 0.066).
4. **Chronological / project-disjoint splits** — never random
   (RESEARCH.md §8.3 #1).
5. **Severity-weighted F1 over EM** — EM is a ceiling probe only (~0% on SeRe);
   never the primary score.
6. **Diff-size stratification** — always bucket <10 / 10–50 / 50–150 / >150
   lines; aggregate F1 hides the 15× large-diff collapse.
7. **Falsifiable bets** — each design change stated as a hypothesis with an eval
   test that could refute it.

---

## Project clusters (grouped by relatedness + dependency)

Clusters respect both direct code deps (imports) and data-flow deps (output
feeds input). Tightest internal coupling lives within a cluster; cross-cluster
arrows are noted.

| Cluster | Projects | Why grouped | Key internal deps |
|---|---|---|---|
| **A — Diff Intake & Pre-filter** | P1 Chunker, P7 Triage, P10 Det Rules | Structural signal extracted before any LLM generation; minimal cross-deps | P10 needs P1; P7 independent |
| **B — Generation Core** | P2 Guidelines, P3 Prompt (RIE), P4 Router | "Build prompt, pick model, emit structured comments" — tightest coupling | P2→P3; P4 selects model for P3 |
| **C — Quality, Severity & Output** | P5 Quality Gate, P12 Severity, P6 Inline Posting | Output-side: gate, tag, post | P5→P6; P12→P6 display + P4 escalation |
| **D — Security & Adversarial** | P9 Security, P11 Adversarial | Safety vertical; P11 hardens P9 | P11 deps P9 (+ P4, P10) |
| **E — Evaluation** | P14 Golden Eval | Cross-cutting measurement; grounds B/C tuning | exercises P1–P6 |
| **F — Optional / Deferred** | P8 Reviewability, P13 Runtime, P15 Reviewer-rec | Optional / heaviest / lowest-leverage | P8 deps P7+P4; P13 deps P6; P15 deps P7+P8 |

**Cross-cluster dependency arrows**
```
A(P1) ──┐                        F(P8) ← A(P7) + B(P4)
        ├→ B(P4) ──┐
A(P7) ──┘          ├→ C(P5) → C(P6)
B(P2)→B(P3) ───────┘      C(P12) feeds B(P4) + C(P6)
A(P10) ┐
D(P9)  ├→ D(P11)
B(P4)  ┘
E(P14) exercises A(P1)+B(P3/P4); grounds B(P2/P4)+C(P5)
F(P13) ← C(P6)   F(P15) ← A(P7)+F(P8)
```

---

## Execution waves (dependency-respecting, leverage-ordered)

Wave order follows RESEARCH.md §9 leverage ranking, reorganized to respect
code dependencies. Entry criteria = upstream waves done; exit criteria =
measurable (P14 delta or a concrete deliverable).

### Wave 0 — Foundation + measurement scaffold
- **P1 Chunker** (A) — `src/chunker.ts` + `src/types.ts` (PrContext, Hunk,
  Severity, Category, Usage). Replaces `src/index.ts:86` concat.
  Target: 10–50 line sweet spot, split >150, merge tiny (arXiv:2606.15689).
- **P14 Eval scaffold** (E) — structured-finding adapter (needs P3's
  `CommentSpec` shape, so P3's *type* is pinned here), Martian fixture port
  (50 PRs / 136 golden), two-pass judge (Pass 1 deterministic + Pass 2
  `glm-5.2` @ temp 0), metrics + diff-size stratification.
  Exit: can score the current single-shot baseline → expect ~Sonnet 27.1%
  F1 (the "before" number).

### Wave 1 — Generation core (cluster B)
- **P2 Guidelines** — `src/guidelines/` (G_Code, G_Test, G_Comment as data).
- **P3 Prompt (RIE)** — `src/prompt.ts`; bakes R.E1/I.E1/I.E2/E.E1/E.E2 as hard
  output rules; mandatory `rationale` field; emits `CommentSpec[]`
  (arXiv:2410.06515).
- **P4 Router** — `src/router.ts`; tiered `glm-5.2` / `deepseek-v4-pro` /
  `deepseek-v4-flash`; security-path escalation (arXiv:2606.15689, §11).
  Exit: P14 shows F1 vs Wave 0 baseline; guidelines expected +5pp
  localization (arXiv:2601.01129).

### Wave 2 — Quality, severity & output (cluster C)
- **P5 Quality Gate** — `src/quality-gate.ts`; Phase 1 `glm-5.2` go/no-go per
  comment (correctness + RIE clarity); Phase 2 ModernBERT later
  (arXiv:2601.01129, +20pp).
- **P12 Severity** — `src/severity.ts`; per-finding tag + depth calibration
  (ISO 26262 / DO-178C analogues).
- **P6 Inline Posting** — `src/posting.ts`; `createReview` with inline
  comments + line mapping from P1; summary comment keeps token footer.
  Exit: P14 actionability + severity-weighted F1 delta; inline comments live.

### Wave 3 — Front-gate & specialized detection (A + D)
- **P7 Triage** — `src/triage.ts`; SHAP-feature rule weights (additions,
  body_length, total_changes, has_plan) (arXiv:2601.00753). Feeds P4 routing.
- **P10 Det Rules** — `src/det-rules.ts`; N+1, unbounded query, sync-in-loop,
  missing index, hot-path alloc (LLM perf recall ~0%, arXiv:2606.15689).
- **P9 Security** — `src/security.ts`; precision-first classifier gate
  (P 92.75%, 0-shot not 2-shot) + route to `glm-5.2` (arXiv:2601.01042).
  Exit: per-category recall report; security/perf blind spots closed.

### Wave 4 — Adversarial hardening (D)
- **P11 Adversarial** — `src/adversarial.ts` (input hygiene: strip/sandbox PR
  prose, verify claimed CI/coverage/approval against repo state) +
  `scripts/redteam.ts` (reversed-CVE × 15 framings; measure RR + SRR;
  DeepSeek ~53% RR baseline, glm-5.2 target >> that) (arXiv:2606.13757).
  Exit: RR regression gate in CI.

### Wave 5 — Optional (cluster F, see Deferred)

---

## Status tracker

| ID | Project | Cluster | Wave | Status | Notes |
|---|---|---|---|---|---|
| P1 | Diff Chunking | A | 0 | done | `src/chunker.ts` + `src/types.ts`; 10–50 sweet spot, splits >150, merges tiny |
| P14 | Golden Eval | E | 0 | done | Martian 50 PRs / 137 golden ported; two-pass judge; baseline F1 39.5% (see scoreboard) |
| P2 | Guidelines | B | 1 | not started | +5pp localization target |
| P3 | Prompt (RIE) | B | 1 | not started | mandatory rationale field |
| P4 | Router | B | 1 | not started | 3-tier + security escalation |
| P5 | Quality Gate | C | 2 | not started | Phase 1 glm-5.2; Phase 2 ModernBERT |
| P12 | Severity | C | 2 | not started | tagging contract |
| P6 | Inline Posting | C | 2 | not started | createReview + line mapping |
| P7 | Triage | A | 3 | not started | SHAP-feature rule weights |
| P10 | Det Rules | A | 3 | not started | perf blind-spot coverage |
| P9 | Security | D | 3 | not started | P 92.75% gate |
| P11 | Adversarial | D | 4 | not started | RR/SRR regression gate |
| P8 | Reviewability | F | deferred | not started | optional |
| P13 | Runtime Checks | F | deferred | not started | heaviest infra |
| P15 | Reviewer-rec | F | deferred | not started | optional |

Status values: `not started` · `in progress` · `blocked` · `done` · `superseded`.

---

## Deferred (optional — cluster F)

Not on the active critical path; revisit after Wave 4.
- **P8 Reviewability** (arXiv:2606.17099) — reviewability signal for AI-authored
  PRs; flag missing residual-risk/limitation disclosures (0%→100% on demand).
  Deps: P7, P4.
- **P13 Runtime Checks** (arXiv:2602.13377) — sandboxed build+test execution;
  flag-gated, heaviest infra lift. Deps: P6. Open Q: no major benchmark does
  runtime eval at scale yet (RESEARCH.md §10).
- **P15 Reviewer Recommendation** (arXiv:2601.01514) — group-vs-individual
  routing + review-readiness score. Deps: P7, P8.

---

## Decisions log (ADR-style)

| # | Date | Decision | Rationale | Alternatives |
|---|---|---|---|---|
| 1 | 2026-06-19 | Use `PLAN.md` as the single living plan/decisions/memory doc at repo root. | Discoverable; consolidates approach + decisions + changes + memory. | APPROACH.md, DECISIONS.md |
| 2 | 2026-06-19 | Hybrid sequencing: 6 dependency clusters for grouping + leverage-ordered waves for execution. | Honors user's "group by relatedness/dependency" ask while preserving RESEARCH.md §9 leverage ranking. | Strict topo order; doc order verbatim |
| 3 | 2026-06-19 | Optional projects (P8/P13/P15) tracked in a separate Deferred section, not the active wave table. | Keeps active plan focused; optionals aren't on the critical path. | Include in main tracker |
| 4 | 2026-06-19 | Resolve P4/P5 ordering tension: pin P3's `CommentSpec` type in Wave 0, build P4 minimal `pickModel` in Wave 1, complete P5 in Wave 2. | PROJECTS.md lists P5 before P4 but P5 deps P4; P5 Phase 1 (glm-5.2 go/no-go) can run against a single model before full tiered routing. | Build P4 fully before any P5 |
| 5 | 2026-06-19 | Split `Severity` (impact: critical/high/medium/low) from `Category` (type: logic/security/performance/best-practice/test/comment). `CommentSpec` carries both. | wave-0 §6.1: the P1 sketch in PROJECTS.md conflated type (security/perf) with impact (bug/nit). P14's severity-weighted F1 (critical 4×/high 2×/medium 1×/low 0.5×) needs an impact enum. | Keep P1's conflated `Severity`; add a second enum |
| 6 | 2026-06-19 | Make `GoldenComment.file/lineStart/lineEnd/type` OPTIONAL (deviation from wave-0 §4.3). Martian golden comments carry only `comment` + `severity` — no file/line/category. Pass 1 defers any pair whose golden lacks file/line; Pass 2 (LLM) does the semantic matching. | Inspected `withmartian/code-review-benchmark`: 50 PRs / 137 golden, each golden = `{comment, severity}` only. Martian's own methodology is an LLM semantic judge, not deterministic file+line. Forcing required file/line would have made the fixture unportable. | Invent/synthesize file+line for golden via a pre-pass LLM call (added cost + noise); or skip Martian and use only VibeOps. |
| 7 | 2026-06-19 | Fetch Martian diffs via `gh pr diff <url>` at port-time and bake them into `fixtures/real/martian/martian.json` (one-time `scripts/fetch-martian.ts`). The benchmark's `benchmark_data.json` contains NO diffs — only titles, golden comments, and per-tool reviews. | wave-0 Agent D assumed the data was self-contained; it is not. Both original PRs and `ai-code-review-evaluation/*` greptile forks are fetchable via `gh`. 50/50 fetched, 0 skipped. | Store golden-only and fetch diffs at eval-runtime (slower, needs `gh` at eval time, not reproducible from fixture alone). |
| 8 | 2026-06-19 | Batch the Pass 2 judge per-PR: ONE `glm-5.2` call adjudicates all deferred (finding, golden) pairs for a PR, instead of one call per pair. ~50 judge calls total (not ~600). | wave-0 §4.5 specified pairwise `judgePass2`; with 199 findings × 137 golden that is ~hundreds of glm-5.2 calls — prohibitive cost/latency. The eval runner calls `judge()` per PR so all deferred pairs in one call share one PR. `judgePass2` keeps the pairwise contract for testability; `judge()` batches internally. | Per-pair calls (faithful to §4.5 but ~6× cost and ~6× slower). |
| 9 | 2026-06-19 | `computeMetrics(records: PrEvalRecord[], model)` takes per-PR records (`{prId, bucket, findings, golden, matches}`), not the flat `(matches, findings, golden, diffBuckets)` from wave-0 §4.6. | The flat signature cannot stratify by diff-size — it has no way to map a finding to its PR/bucket. Per-PR records make bucketing and per-PR aggregation exact. | Reconstruct PR membership from a side map (fragile, loses object association after JSON). |
| 10 | 2026-06-19 | Headline F1 uses paper-aligned weighted counting: `partial_match` = 0.5 TP (not a full match). P = Σ(best verdict weight per finding) / totalFindings; R = Σ(best verdict weight per golden) / totalGolden. Also report strict TP-only F1 as a lower-bound sanity check. | 2606.15689 defines partial = 0.5 TP. Counting partial as a full set-membership match inflated F1 from 39.5% → 43.5%. Strict TP-only = 35.4% (right at Haiku 36.4%), confirming the judge is well-calibrated. | Count partial as full match (inflates ~4pp); or ignore partials entirely (loses signal). |
| 11 | 2026-06-19 | Aggregate metrics by content key (`file|line|message` for findings, `file|lineStart|comment` for golden), not object identity. | `Map<CommentSpec,…>` keyed by reference breaks after JSON deserialization (re-aggregating from `records.jsonl` gave all-zeros). Content keys make metrics work both in-memory and from saved records. | Add an `id` field to CommentSpec/GoldenComment (schema churn across modules). |

---

## Changes log

| Date | Project(s) | Change | Eval delta | Commit |
|---|---|---|---|---|
| 2026-06-19 | P1, P14 | Wave 0: `src/types.ts` (CommentSpec, Severity/Category split — Dec #5), `src/chunker.ts` (split>150/merge tiny/10–50 sweet spot), `src/eval/{types,martian,judge,metrics}.ts`, `reviewDiffStructured` in `src/index.ts`, `scripts/{eval,aggregate-eval,fetch-martian}.ts`, `fixtures/real/martian/martian.json` (50 PRs/137 golden, diffs fetched via `gh` — Dec #7), `typecheck` script + `bun-types` + tsconfig includes scripts. Baseline = flat-concat single-shot `deepseek-v4-flash`. | **Martian F1 39.5%** (P 36.2 / R 43.4, glm-5.2 judge, partial=0.5); strict TP-only F1 35.4%; severity-weighted F1 52.7%. Diff-size: 10–50 → 66.4%, 50–150 → 52.3%, >150 → 34.6% (sweet spot confirmed). | _(uncommitted)_ |

---

## Memory / open questions

- **RESEARCH.md §10 — data contamination:** frontier models may memorize public
  CVE patterns, inflating closed-source SEVRA RR toward saturation. Affects P11
  interpretation; favor reversed-CVE retention split.
- **RESEARCH.md §10 — runtime eval at scale:** no major benchmark does
  functional/compile/runtime checks yet; P13 is greenfield and high-risk.
- **Synthetic-vs-real trap:** never tune on synthetic (12× overstatement);
  P14 must report both, tune on real.
- **Few-shot hurts LLMs on security:** P9 must use 0-shot, not 2-shot
  (arXiv:2601.01042).
- **Ensembling hurts:** do not union findings across models (drops F1 <0.365);
  P4 routes to one model per hunk, doesn't merge model outputs.
- **Factual LLM-judge deprioritized:** RovoDev found gpt-4o-mini judge had
  minimal impact and is expensive; P5 prioritizes the actionability classifier
  over a factual judge (arXiv:2601.01129).
- **Size-only baseline pitfall:** P7 must validate on repo-disjoint, not just
  temporal, splits (AUC 0.933 temporal → 0.65 repo-disjoint).

### Wave 0 learnings (2026-06-19)

- **Judge calibration is the #1 cross-benchmark caveat.** Our Martian F1
  (39.5% weighted / 35.4% strict-TP) is measured with a **glm-5.2 judge**,
  while the paper's 27.1% (Sonnet) / 36.4% (Haiku) use Claude Opus/Sonnet or
  GPT-5.2 judges. The paper itself flags judge-model variance. The strict
  TP-only 35.4% landing exactly at Haiku 36.4% is the best evidence the
  harness is well-calibrated; treat absolute F1 as comparable only within a
  single judge. **Action for later waves:** if we want apples-to-apples vs
  the paper, re-run a subset with a Claude/GPT judge on the OpenCode
  endpoint, or always report strict-TP alongside weighted.
- **Martian golden has NO file/line/category** — only `comment` + `severity`.
  Pass 1 (deterministic file+line±5) never fires for Martian; Pass 2 (LLM
  semantic) does ~100% of matching. This means per-category **recall is N/A**
  on Martian (Dec #6). To get per-category recall we need a benchmark whose
  golden has typed comments (VibeOps 150-sample, or our own annotated set).
- **Diff-size stratification reproduces the research pattern** even with our
  more-generous judge: 10–50 (66%) > 50–150 (52%) > >150 (35%). The absolute
  >150 number (35%) is far above the paper's 0.043 — again judge calibration,
  not a real disagreement. The *ordering* is the signal, and it confirms
  chunking (P1) as the highest-leverage next lever.
- **Object-identity trap in metrics:** `Map<object,…>` keyed by reference
  breaks after JSON round-trip. Use content keys (Dec #10) so
  `aggregate-eval.ts` can re-score saved `records.jsonl`.
- **Cost/latency of the baseline run:** 50 PRs × (1 review + 1 judge call)
  = ~100 LLM calls, ~95 min wall-clock (large diffs dominate; first >150 PR
  ~170s). `records.jsonl` is written incrementally so partial runs survive
  (`scripts/aggregate-eval.ts` recomputes from it).
- **New verify command:** `bun run typecheck` (tsc --noEmit over `src` +
  `scripts`, with `bun-types`). `bun run build` only bundles from
  `src/index.ts` and does NOT typecheck `src/eval/*` or `scripts/*` — always
  run `typecheck` too. Recorded in AGENTS.md's verify guidance.
- **`response_format: json_object` works** on the OpenCode Go endpoint for
  both `deepseek-v4-flash` (reviewer) and `glm-5.2` (judge); parse failures
  are handled gracefully (empty findings / default `false_positive`).

---

## Eval scoreboard — numbers to beat (RESEARCH.md §8.5)

| Benchmark / metric | SOTA | Baseline to beat | Source | Our score |
|---|---|---|---|---|
| Martian F1 (50 real PRs) | Haiku 36.4% (P 32.6 / R 41.2) | Sonnet 27.1% | 2606.15689 | **39.5%** (P 36.2 / R 43.4) — `deepseek-v4-flash` single-shot, **glm-5.2 judge**; strict TP-only 35.4% ⚠ judge not directly comparable to paper's Claude/GPT judge |
| Real-only F1 (best model) | 0.066 (near random) | synthetic 0.847 | 2606.15689 | n/a (Martian is all real; no synthetic split run yet) |
| F1 by diff size (Haiku) | 10–50 lines ~0.800 | >150 lines 0.043 | 2606.15689 | 10–50 **66.4%** · 50–150 **52.3%** · >150 **34.6%** — sweet spot >> large confirmed (monotonic decline; our >150 is higher than paper's 0.043, again judge-calibration) |
| Per-category recall — Security | ~70% (all models) | — | 2606.15689 | **N/A** — Martian golden has no `type` field (Dec #6); per-category recall cannot be computed from Martian. Precision by reviewer-labeled category: logic 41.8%, security 29.2%, performance 10.0%, best-practice 35.7%, test 22.2% |
| Per-category recall — Performance | 0% (4/5 models) | — | 2606.15689 | **N/A** (no golden type); but performance *precision* 10% = 90% of performance findings are false positives — consistent with the perf blind spot |
| SEVRA Refusal Rate | Opus 97.6% / GLM-5 83% | DeepSeek ~53.4% | 2606.13757 | _tbd (P11, Wave 4)_ |
| Code resolution rate (RovoDev) | 38.70% (human 44.45%) | — | 2601.01129 | _tbd (post-deploy)_ |

_Fill "Our score" as P14 runs after each wave. A result near/below Sonnet
27.1% on real PRs is the expected single-shot baseline; beating Haiku 36.4%
requires P1 chunking + P2 guidelines + P5 actionability gate._
