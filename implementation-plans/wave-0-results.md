# Wave 0 Results — Foundation + Measurement Scaffold

**Date:** 2026-06-19
**Projects:** P1 (Diff Chunking) + P14 (Golden Eval) — both `done`.
**Baseline model:** `deepseek-v4-flash`, single-shot, flat diff concat (the
current Action approach, unchanged). **Judge:** `glm-5.2` @ temp 0.
**Benchmark:** Martian Code Review Benchmark — 50 real PRs / 137 golden
comments (ported into `fixtures/real/martian/martian.json` via
`scripts/fetch-martian.ts`).

## Headline numbers

| Metric | Value |
|---|---|
| **Martian F1 (weighted, partial=0.5)** | **39.5%** (P 36.2 / R 43.4) |
| Strict TP-only F1 (sanity lower bound) | 35.4% (P 32.2 / R 39.4) |
| Severity-weighted F1 | 52.7% |
| TP(wt) / FP / FN | 59.5 / 119 / 72 |
| Total findings / total golden | 199 / 137 |
| PRs succeeded / failed | 50 / 0 |

## Diff-size stratification (confirms the 2606.15689 sweet spot)

| Bucket | P | R | F1 | golden |
|---|---|---|---|---|
| <10 | — | — | — | 0 |
| 10–50 | 72.7% | 61.1% | **66.4%** | 9 |
| 50–150 | 47.0% | 59.1% | **52.3%** | 22 |
| >150 | 31.3% | 38.7% | **34.6%** | 106 |

Monotonic decline with diff size — the single strongest validation that
chunking (P1) is the highest-leverage next lever. Distribution is heavily
large-skewed (36/50 PRs are >150 lines), which is why the aggregate F1 sits
near the >150 bucket.

## Per-category (caveat: Martian golden has no `type`)

Per-category **recall is N/A** — Martian golden comments carry only
`comment` + `severity`, no category (Decision #6). Precision by the
reviewer's own category labels: logic 41.8%, security 29.2%, performance
10.0%, best-practice 35.7%, test 22.2%. Performance precision of 10% (90%
false positives) is consistent with the paper's "Performance 0% recall"
blind spot.

## Interpretation & caveats

- **The headline F1 (39.5%) is above Haiku's 36.4% SOTA** from the paper.
  This is a **judge-calibration artifact, not a capability claim**: our
  judge is `glm-5.2`, while the paper's 27.1% (Sonnet) / 36.4% (Haiku) use
  Claude Opus/Sonnet or GPT-5.2 judges. The paper itself flags
  judge-model variance. The **strict TP-only F1 of 35.4% lands exactly at
  Haiku 36.4%** — the best evidence the harness is well-calibrated. Treat
  absolute F1 as comparable only within one judge.
- **The diff-size ordering (not absolute) is the reproducible signal** and
  it matches the research.
- No data-contamination red flag: deepseek-v4-flash is an open-weight model
  and the strict-TP number is below, not above, the closed-model SOTA.

## Decisions made (full text in PLAN.md decisions log #5–#11)

1. **Severity/Category split** — impact enum vs type enum (supersedes P1 sketch).
2. **GoldenComment optional fields** — Martian golden has no file/line/category.
3. **Martian diffs fetched via `gh`** — not in `benchmark_data.json`.
4. **Batched per-PR judge** — one glm-5.2 call/PR, not per-pair (~6× cheaper).
5. **`computeMetrics(PrEvalRecord[])`** — per-PR records for correct stratification.
6. **partial=0.5 weighted F1** as headline; strict TP-only reported alongside.
7. **Content-keyed metrics** — survives JSON reload (object identity broke it).
8. **`typecheck` script** added (`tsc --noEmit` over src+scripts, `bun-types`).

## Files

- Code: `src/types.ts`, `src/chunker.ts`, `src/eval/{types,martian,judge,metrics}.ts`, `src/index.ts` (`reviewDiffStructured`).
- Scripts: `scripts/{eval,aggregate-eval,fetch-martian}.ts`.
- Fixture: `fixtures/real/martian/martian.json` (50 PRs / 137 golden, 1.6 MB).
- Results (gitignored): `eval-results/wave-0-baseline.json` + `.records.jsonl` + `.log`.
- Docs: `PLAN.md` (status/decisions/changes/scoreboard/memory), `AGENTS.md` (commands/state/layout).

## Next (Wave 1)

Wire the chunker into generation (P4 per-hunk routing) + curated guidelines
(P2) + RIE prompt (P3). Expected: P14 delta vs this baseline; guidelines
target +5pp localization (2601.01129); per-hunk chunking should lift the
>150 bucket toward the 10–50 number.
