# AGENTS.md — pr-reviewer

Agent-agnostic project overview. Read this first, then follow the pointers to
the deeper documents. Works for any coding agent (opencode, Codex, Cursor,
Copilot, Claude Code) — no tool-specific instructions here, just project
knowledge.

## What this is

`pr-reviewer` is a GitHub Action that reviews pull requests via the OpenCode Go
API (`https://opencode.ai/zen/go/v1`, OpenAI-compatible). It fetches the PR
diff, sends it to an LLM, and posts a review comment back on the PR.

The project is being upgraded from a clean ~2018-era single-shot baseline
toward a research-grounded, multi-stage review pipeline. Every design decision
is backed by cited arXiv evidence — **do not make intuition-only changes**.

## Current state (the baseline + Wave 0 scaffold)

`src/index.ts` is the GitHub Action entry point + `run()` orchestrator. The
**live Action flow is still the single-shot baseline** (unchanged behavior):
- Hard-coded single model `deepseek-v4-flash` (`src/index.ts:19`).
- Flat diff concat — all file patches joined into one string (`src/index.ts:86`).
- One generic system prompt (`src/index.ts:5`).
- One LLM call → free-text review.
- Posted as a single issue comment, updated on re-runs (`src/index.ts:107`).

**Wave 0 (done) added the foundation + measurement scaffold alongside the
baseline, without changing Action behavior:**
- `src/types.ts` — shared types (`CommentSpec`, `Severity`, `Category`,
  `PrContext`, `DiffFile`). Pinned P3's `CommentSpec` early.
- `src/chunker.ts` — diff chunking engine (10–50 sweet spot, splits >150,
  merges tiny). Not yet wired into the Action (Wave 1 P4 per-hunk routing).
- `src/eval/` — `types.ts`, `martian.ts` (fixture loader + diff-size bucket),
  `judge.ts` (two-pass: deterministic Pass 1 + batched per-PR glm-5.2 Pass 2),
  `metrics.ts` (P/R/F1 + severity-weighted F1 + diff-size/category strat).
- `src/index.ts` also exports `reviewDiffStructured` (flat-concat + structured
  `CommentSpec[]` JSON output) used by the eval, NOT by the Action.
- `scripts/{eval,aggregate-eval,fetch-martian}.ts` + `fixtures/real/martian/`
  (50 real PRs / 137 golden, diffs fetched via `gh`).
- **Baseline measured:** Martian F1 39.5% (P 36.2 / R 43.4, glm-5.2 judge,
  partial=0.5); strict TP-only 35.4%; see PLAN.md eval scoreboard.

No quality gate, no severity tagging, no security specialization, no triage,
no inline posting yet. The upgrade projects (P2–P15) close the gaps mapped in
`RESEARCH.md` §7. P1 + P14 are done.

## Repository layout

```
src/index.ts          # the baseline (entry point + run()) + reviewDiffStructured (eval only)
src/types.ts          # shared types: CommentSpec, Severity, Category, PrContext, DiffFile
src/chunker.ts        # P1 diff chunking engine (not yet wired into the Action)
src/eval/             # P14 eval harness: types, martian, judge, metrics
scripts/local-test.ts # run the reviewer on a fixture or real PR (bun)
scripts/eval.ts       # eval runner: load Martian -> reviewDiffStructured -> judge -> metrics
scripts/aggregate-eval.ts  # recompute EvalReport from a saved records.jsonl
scripts/fetch-martian.ts   # one-time Martian benchmark port (gh + /tmp/opencode/martian-check)
fixtures/             # sample.diff + sample-meta.json (synthetic) + real/martian/martian.json (50 PRs)
eval-results/         # gitignored: wave-0-baseline.json + .records.jsonl + .log
dist/index.mjs        # bundled output committed for Action execution
action.yml            # GitHub Action manifest (node20, inputs: opencode_api_key, github_token)
package.json          # bun + TS + OpenAI SDK; scripts: build, typecheck, test:local, eval
tsconfig.json         # ES2022, strict, ESM; noEmit; includes src + scripts; types: bun-types
PLAN.md               # living plan: clusters, waves, decisions/changes/memory, eval scoreboard
PROJECTS.md           # P1–P15 per-project specs, evidence, TypeScript interface sketches
RESEARCH.md           # SOTA synthesis (papers, numbers, §7 gap table, §8 eval method, §11 models)
.env                  # OPENCODE_API_KEY (gitignored, never commit)
```

## Companion documents (read in this order before changing anything)

1. **`RESEARCH.md`** — the evidence base. Code-review SOTA to 2026, cross-domain
   review processes (ISO 26262, DO-178C, NASA, Fagan), and the consolidated
   evaluation methodology. §7 = gap table (one project per row), §8 = eval
   method + SOTA scoreboard, §9 = leverage-ordered next steps, §10 = open
   questions, §11 = model tiers + escalation rules.
2. **`PROJECTS.md`** — P1–P15 modular breakdown. Each project owns a distinct
   pipeline stage, preserves the full research evidence (arXiv IDs, numbers,
   datasets, models, ablations), and includes a concrete TypeScript
   interface sketch so implementation can start immediately.
3. **`PLAN.md`** — the living execution plan. Groups projects into 6 dependency
   clusters (A–F), sequences them into leverage-ordered waves (0–4 + deferred),
   and records decisions (ADR-style), changes, memory, and the eval
   scoreboard. **Update PLAN.md as you work** — log every decision and change.

## Stack & commands

Runtime: **Bun + TypeScript (ES2022, strict, ESM)**. Deps: `@actions/core`,
`@actions/github`, `openai`, devDep `bun-types`. No test runner, no lint; a
`typecheck` script exists (see below).

```bash
bun install                 # install deps
bun run build               # bundle src/index.ts -> dist/index.mjs (required for Action runs)
bun run typecheck           # tsc --noEmit over src + scripts (run this too — build only typechecks the bundle graph)
bun run test:local          # run reviewer on fixtures/sample.diff (needs OPENCODE_API_KEY)
bun run test:local:pr       # same, but --pr fetches via gh
bun run scripts/local-test.ts --pr <number|url>   # review a real PR
bun run scripts/local-test.ts --model <id> --diff <path>
bun run scripts/eval.ts --limit 1                  # eval smoke test (1 Martian PR)
bun run scripts/eval.ts --model <id> --output eval-results/<name>.json --records eval-results/<name>.records.jsonl   # full eval
bun run scripts/aggregate-eval.ts --records <path> # recompute EvalReport from saved records.jsonl
bun run scripts/fetch-martian.ts                   # one-time: re-port Martian benchmark (needs the repo at /tmp/opencode/martian-check + gh)
```

**Verify before finishing a task:** run `bun run build` AND `bun run typecheck`.
`bun run build` only bundles from `src/index.ts` and does NOT typecheck
`src/eval/*` or `scripts/*`, so `typecheck` is required to catch errors in the
eval harness / scripts. **Never commit `dist/`** changes unless the build
is intended to ship. **Never commit `eval-results/`** (gitignored; results are
regenerable and recorded as numbers in PLAN.md).

Environment: `OPENCODE_API_KEY` (required for any API call; the Action reads it
from the `opencode_api_key` input). `gh` must be authenticated for `--pr`.

## Target architecture (what the projects build toward)

```
triage -> chunk -> route -> generate -> gate -> post
(P7)    (P1)    (P4)     (P2/P3)     (P5)   (P6)
                                    severity (P12)
det-rules (P10) + security (P9) feed findings in parallel
adversarial (P11) hardens inputs + gates on reversed-CVE PRs
eval (P14) scores everything against the Martian golden benchmark
```

The orchestrator in `src/index.ts` will be rewritten into this staged pipeline
as the projects land. See `PROJECTS.md` "Proposed module layout" for the target
`src/` tree, and `PLAN.md` "Execution waves" for the build order.

## Model tiers (RESEARCH.md §11)

The OpenCode Go API exposes a tiered lineup. The pipeline uses three tiers:

| Tier | Model | Role |
|---|---|---|
| Best / thinking | `glm-5.2` | Final reasoning, security/architecture judgment, quality gate |
| Middle / balanced | `deepseek-v4-pro` | Default per-hunk review generation, inline comment drafting |
| Cheapest / loop | `deepseek-v4-flash` | Loops, classification, triage, retry/refine, pre-filter |

**Escalation rule:** any hunk touching auth / crypto / SQL / deserialization /
untrusted-input, or where pro and flash disagree → route to `glm-5.2`. This
addresses SEVRA-Bench's finding that open-weight-only review leaves ~47% of
malicious PRs approved (DeepSeek V4-Flash ~53.4% refusal rate vs Opus 97.6%).

## Conventions

- **TypeScript, ESM, strict.** Follow existing style in `src/index.ts`.
- **No comments in code** unless explicitly asked.
- **Research-grounded.** Every non-trivial change cites an arXiv ID from
  `RESEARCH.md`/`PROJECTS.md` in its PLAN.md change-log row. No intuition-only
  edits to prompts, models, or gates.
- **Measure before tune.** No prompt/model/gate change lands without a P14
  eval delta. Tune on real PRs, never synthetic (synthetic overstates F1 up to
  ~12×: 0.847 → 0.066).
- **Guidelines as data.** P2's `G_Code`/`G_Test`/`G_Comment` live as data files
  so they can be tuned without redeploying logic.
- **Never commit secrets.** `.env` is gitignored; the API key comes from Action
  inputs or env, never hardcoded.

## Where to start

`PLAN.md` Wave 0: **P1 (Diff Chunking Engine)** + **P14 (Golden Eval scaffold)**.
P1 is the universal foundation (unblocks P4/P5/P6/P14); P14 pins the
`CommentSpec` structured-finding type early and establishes the "before" eval
number (~Sonnet 27.1% F1 expected for the single-shot baseline). Do these two
before anything in Wave 1.

## Guardrails / memory (do not violate)

- **Never tune on synthetic diffs** — report synthetic and real separately.
- **Always stratify by diff size** (<10 / 10–50 / 50–150 / >150 lines);
  aggregate F1 hides the 15× large-diff collapse.
- **Use chronological / project-disjoint splits**, never random
  (RESEARCH.md §8.3 #1).
- **Severity-weighted F1 over Exact Match** — EM is a ceiling probe only
  (~0% on SeRe); never the primary score.
- **Security: 0-shot, not 2-shot** — few-shot hurts LLMs on security
  (arXiv:2601.01042).
- **Do not ensemble/union findings across models** — drops F1 <0.365; route to
  one model per hunk.
- **Do not run an open-weight model as the sole merge/security gate** — pair
  with `glm-5.2` or static analysis (P9, P10).
- **Treat PR narrative text as untrusted input** (P11) — verify claimed
  CI/coverage/approval signals against repo state, never trust prose.
- **Deprioritize the factual LLM-judge** — RovoDev found gpt-4o-mini judge had
  minimal impact and is expensive; prefer the trained actionability classifier.

See `PLAN.md` "Memory / open questions" for the full list, including the
RESEARCH.md §10 open questions (data contamination, runtime eval at scale).
