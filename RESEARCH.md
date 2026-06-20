# Code Review: State of the Art (to 2026)

A synthesis of modern code-review research plus review processes from adjacent
engineering domains (automotive, aerospace, rockets, science). Compiled to
ground `pr-reviewer` development in evidence rather than guesswork.

Each paper entry below was extracted by a dedicated deep-read pass over the
full arXiv HTML and concentrates the methodology, datasets, concrete numbers,
and actionable lessons. Cross-domain standards (ISO 26262, DO-178C, NASA
review boards, scholarly peer review, Fagan inspection) are summarized from
the standards/Wikipedia.

Sources are arXiv papers (with venue where known). Dates follow each paper's
announcement year.

---

## 1. Landscape surveys (read these first)

### 1.1 Modern Code Reviews: Survey of Literature and Practice
Badampudi, Unterkalmsteiner, Britto — arXiv:2403.00088, ACM TOSEM 32(4)
107:1-107:61 (2023).

- **Method:** Systematic mapping study (244 primary studies, 2007-2021, 5 DBs)
  + Q-Methodology practitioner survey (25 valid respondents from 17 partner
  companies; 46 statements; 1,300 data points) + citation-based impact
  analysis.
- **Themes (5 + Other):** SS Support systems (125 papers); HOF Human/org
  factors (45); IOF Impact on product quality (39); CRP MCR process
  properties (27); ION Impact of dev processes/tools on MCR (27).
- **Key numbers:** 244 studies; 25 respondents; Q-Methodology 3 factors
  (F1 43% / 16.81% variance, F2 24%, F3 24%); only 2 of 36
  reviewer-recommendation tools have accessible links.
- **Core misalignment:** Most-researched areas (HOF, SS = 108 papers) are the
  ones practitioners value *least*; least-researched (IOF, CRP = 66 papers)
  are valued *most*. Senior devs (F1, ~16 yrs) value human-factor research;
  juniors (F2, ~6 yrs) and testers (F3) reject it.
- **Research agenda:** 19 RQs across 6 process steps (preparation, reviewer
  selection, code checking, reviewer interaction, review decision, overall),
  including risk-based review scoping, review-readiness scores, and
  explainability for deep-learning accept/reject automation.
- **Lesson for this tool:** Target the two practitioner-approved SS problems
  (summarizing/understanding changes, reviewer recommendation); make
  accept/reject reasoning explainable; provide a review-readiness score; ensure
  discoverability (the field's failure mode is tools practitioners never see).

### 1.2 Previously on... Automating Code Review
Heumuller & Ortmeier — arXiv:2508.18003, 2025 (under review at Information and
Software Technology).

- **Method:** Systematic review (Kitchenham); 691 candidates -> 24 included
  (May 2015 - Apr 2024) + 2 snowballing iterations.
- **Tasks formalized (3 primary):** ChQual (change quality estimation, score
  [0,1]); ComGen (comment generation); CodeRef (code refinement; CodeRef1
  conditioned on a comment is better than CodeRef2 original->revised).
- **Key numbers:** 24 papers; 48 task/metric combinations, 22 unique to one
  paper; 15/24 used black-box/no baselines; 16/24 published artifacts.
  Best ChQual ~78.6% PRE / 65.65% REC. ComGen TOP-1 exact match only ~2-6%
  (BLEU-4 ~5-8%). CodeRef TOP-1 EM ~12-18%. A synthetic-feature MLP baseline
  matched/beat all transformers except CodeReviewer on ChQual.
- **Methodological challenges:** Temporal bias / target leakage (only 1/24
  addressed it; random splits usually invalid - use chronological/project
  splits); unsuitable metrics (BLEU/CodeBLEU high but uninterpretable);
  inappropriate baselines; significance/effect sizes rarely reported;
  implementation bugs; small/single datasets; mostly Java-only.
- **Lesson:** Treat review as 3 separable tasks; always include a
  human-understandable baseline (e.g. no-change, simple complexity
  classifier); use chronological splits never random; comment generation is
  far from solved (~2-6% EM) so an LLM tool should rank/filter suggestions
  rather than expect correct autonomous comments.

### 1.3 A Survey of Code Review Benchmarks and Evaluation Practices in Pre-LLM
and LLM Era Khan, Wang, Zhang, Chen — arXiv:2602.13377, 2026.

- **Method:** 99 papers (58 pre-LLM + 41 LLM, Jan 2015 - Dec 2025); 5 domains,
  18 fine-grained tasks.
- **Taxonomy:** (1) Review Prioritization/Selection; (2) Change Understanding
  & Analysis (decomposition & impact analysis vanished in LLM era); (3) Peer
  Review (~60% of LLM-era datasets); (4) Review Assessment & Analysis; (5)
  Code Refinement.
- **Key datasets named:** CodeReviewer (Li 2022, ~138k-328k diffs, 9 langs);
  Tufano (~168k functions); CodeReviewQA (900 ex, 199 projects, 9 langs);
  CodeFuse-CR-Bench (601 ex, 70 Python projects); LLaMA-Reviewer (288k);
  RepoAudit (251k LoC CWE); SecureReviewer; RovoDev (internal).
- **Language shift:** Java 61% -> 34%; Python 12% -> 41% (top in LLM era);
  single-language 59% -> 24%; >=9 langs 2% -> 34%.
- **Trends:** Human-assistance -> autonomous end-to-end generative review;
  retrieval-based recommendation -> generation; standalone understanding
  "nearly vanished"; static text-match -> LLM-as-Judge (call for runtime
  metrics).
- **Limitations:** Macro-level tasks (impact analysis, tangled-change
  decomposition) overlooked in LLM era; static/"shallow" eval only - no
  functional/compile/runtime checks (a build-breaking fix can score high);
  BLEU/ROUGE poorly correlate with usefulness.
- **Lesson:** Benchmark across the full 18-task taxonomy; favor
  CodeReviewer/CodeReviewQA/CodeFuse-CR-Bench; evaluate on real multilingual
  PRs; add dynamic runtime checks (build + tests) since static text-match is
  the field's most-cited weakness.

---

## 2. LLM-based code review automation (the 2026 frontier)

### 2.1 RovoDev Code Reviewer (the flagship enterprise result)
Tantithamthavorn et al. — arXiv:2601.01129, ICSE'26 SEIP (Atlassian/Monash).

- **Architecture (3-stage, no fine-tuning of generator):**
  1. Zero-shot context-aware review-guided generation - **Claude 3.5 Sonnet**
     with structured prompt: persona (P), task (T), chain-of-thought, three
     review-guideline sets (G_Code, G_Test, G_Comment - crafted by Atlassian
     Engineering), PR title/description, linked Jira issue, code diff. Output
     = candidate comments with file path + line number.
  2. Factual-correctness quality check - **gpt-4o-mini** LLM-as-Judge, binary
     selection per comment.
  3. Actionability quality check - **ModernBERT** classifier (fine-tuned on 5
     months / 50,000+ RovoDev comments labeled `<comment, resolved?>`);
     filters vague/nitpick/non-actionable comments.
- **Context mechanism:** Zero-shot, no RAG, no historical retrieval (works on
  new projects with zero history). Clones repo on PR creation; gathers diff +
  PR title/description + linked Jira summary/description. Ablation: PR/Jira
  context adds only 1-3% - the **review guidelines are the highest-impact
  prompt component (+5pp localization)**.
- **Quality-check ablation:** Actionability (ModernBERT) = **+20pp location
  alignment, +15pp location+semantic**; factual-correctness LLM-judge had
  **minimal impact** (surprising) and is expensive - authors recommend
  prioritizing the actionability classifier.
- **Evaluation:** Offline (2,068 changes / 2,894 human comments / 1,468 PRs);
  Online (12-month GA deployment June 2024-June 2025; 2,000+ repos; 54,000+
  comments; 5,500+ engineers; avg 2.1 comments/PR); User feedback
  (thumbs + qualitative, Reflexive Thematic Analysis).
- **Key numbers:** Code resolution rate **38.70%** (RovoDev) vs 44.45% (human)
  - 5.8pp gap; PR cycle time median **14.35h vs 20.73h = -31%** (Q1 -56%, Q3
  -35%, p<.001, n=43,633 vs 42,981 PRs); human comments/PR **2.87 vs 4.45 =
  -35.6%** (p<.001). Offline: only 4% of comments human-aligned post-quality-
  check, but 38.70% drove code changes.
- **Integration:** Native Bitbucket, event-driven architecture; PR-creation
  event triggers clone -> generate -> quality gate -> post inline comments.
  Human-in-the-loop retains final authority.
- **Lesson (highest-value):** (1) Invest first in **curated review guidelines**
  as mandatory prompt input - they beat persona, CoT, and PR/Jira context
  combined. (2) A **trained actionability classifier** (ModernBERT on
  resolved/unresolved labels) is the single highest-leverage quality gate,
  far outperforming expensive LLM-judge factual checks. (3) Measure success by
  **code resolution rate**, not BLEU/semantic-similarity to human comments -
  only 4% matched humans yet 38.70% drove code changes.

### 2.2 Bigger Isn't Always Better: A Comparative Evaluation of LLMs
arXiv:2606.15689, 2026 (Kumar, Bararia, Raj - UIUC/Columbia/VibeOps).

- **Method:** 5 LLMs x 150 samples (100 synthetic + 50 real), 3 conditions.
  Two-pass judge (deterministic match ~70% + Claude Opus 4.6 adjudication).
  External validation on Martian Code Review Benchmark (50 PRs, 136 golden
  comments).
- **Models (15x cost range):** Claude Sonnet 4.6 ($3/$15), Claude Haiku 4.5
  ($0.80/$4), GPT-5.4 mini ($0.40/$1.60), Minimax M2.7 ($0.20/$1.10), GLM-5
  Turbo ($0.30/$1.20).
- **Headline numbers (n=150):** Haiku F1 **0.365** vs Sonnet **0.343** (+6.4%);
  Haiku recall 0.293 vs 0.248 (+18.1%); Haiku cost/review **$0.003 vs $0.010
  (3.2x cheaper)**; Haiku generates 38% more findings than Sonnet.
- **Synthetic-vs-real collapse:** Haiku F1 0.847 -> **0.066** (-92%); Sonnet
  0.796 -> 0.050 (-94%); Minimax 0.804 -> 0.007 (-99%). Synthetic eval
  overstates capability by up to ~12x. Best real-only F1 = 0.066 (near
  random).
- **Diff-size is the dominant predictor (Haiku F1):** <10 lines 0.657;
  10-50 lines ~0.800 (sweet spot); 50-150 ~0.07; **>150 lines 0.043**. ~15x
  drop small->large.
- **Per-category recall:** Security ~70% all models (commoditized); Logic
  Haiku 24.5% vs Sonnet 19.6%; **Performance 0% for 4/5 models** (universal
  blind spot); Best Practice ~0% all.
- **Ensembling hurts:** all union combos drop F1 below 0.365; models detect
  the same bugs, union just adds false positives.
- **External validation:** Haiku F1 36.4% vs Sonnet 27.1% on Martian (gap
  larger on real-only, +34%).
- **Lesson:** Default to Haiku-class models over Sonnet-class (equal/better
  recall at 3x lower cost); **diff chunking (per-function/per-hunk, target
  10-50 line sweet spot) is the single highest-leverage quality lever** given
  the 15x large-diff penalty; always evaluate on real merged PRs not
  synthetic; pair LLM with deterministic AST/data-flow rules for performance
  and architecture bugs where recall is ~0%.

### 2.3 Early-Stage Prediction of Review Effort in AI-Generated PRs
arXiv:2601.00753, MSR'26 (VNUHCM).

- **Method:** Binary "Circuit Breaker" LightGBM classifier (+ Stacking) on 35
  features (Intent, Context, Complexity) captured at T0 (creation) and T1
  (pre-review). Effort = sum of reviews+comments; "High Cost" = top 20%.
  "Ghosting" = Rejected + human feedback + no follow-up >14 days. SHAP for
  interpretability.
- **Dataset:** AIDev v1.0; 33,707 agent-authored PRs from 2,807 GitHub repos
  (>100 stars). Agents: Codex (21,799), Copilot (5,017), Devin (4,827),
  Claude 3.5 (523).
- **Key numbers:** LightGBM temporal split AUC **0.957**, PR-AUC 0.881;
  repo-disjoint AUC 0.834. Size-only baseline AUC 0.933 (temporal) -> 0.65
  (repo-disjoint). CodeBERT (text) AUC 0.52. At 20% review budget captures
  69% of high-effort PRs. Top SHAP features: additions, body_length,
  total_changes; **has_plan = strong negative predictor of ghosting**.
- **Headline findings:** Structural/footprint features far outperform
  semantic/text for triage ("agents tell less than they touch"); bimodal -
  28.3% instant merges vs iterative failures; ghosting driven by plan-less
  multi-component sprawls; signal is agent-agnostic (LOAO AUC >0.95).
- **Lesson:** A lightweight structural gate (patch size, file types, entropy,
  presence of a plan) could pre-rank incoming AI PRs by predicted review
  effort and flag plan-less sprawls at high ghosting risk - fast-track simple
  merges, prioritize the "expensive tail" before expending LLM review budget.

### 2.4 Group versus Individual Review Requests at Mozilla Firefox
Kucera et al. — arXiv:2601.01514, ICSE-SEIP 2026. (Corrected ID; was
mis-cited as 2601.01602 in the first pass.)

- **Method:** Empirical study of ~66,000 revisions in Mozilla Firefox,
  combining statistical modeling with a practitioner focus group.
- **Headline finding:** Group review requests (assigned to a reviewer group,
  any member can review) are associated with **improved review quality (fewer
  regressions)** while having **negligible association with review velocity**.
  Additional perceived benefits: balanced work distribution and training
  opportunities for new reviewers.
- **Lesson:** Review-request routing (group vs individual) affects quality more
  than speed - relevant if the tool ever recommends reviewer assignment
  strategy; a group-assignment pattern can reduce regression risk.

---

## 3. Human/social aspects and review-comment quality

### 3.1 Clear Code Review Comments (RIE framework)
Chen et al. — arXiv:2410.06515, ISSTA 2025 (PACMSE vol. 2, art. ISSTA056).

- **Method:** Literature review (251 papers, 47 CRC-related analyzed via open
  card sorting) + group interview (11 engineers) + online survey (112
  responses, 103 valid, 37 countries) + manual measurement (2,438 diff+CRC
  pairs across 9 languages, 2 annotators, Cohen's Kappa 0.87).
- **RIE attributes (practitioner-validated):**
  - **Relevance** - R.E1 [essential]: self-explanatory & relevant to the
    change. R.O1: specifies location. R.O2: shows correct understanding.
  - **Informativeness** - I.E1 [essential]: clear intention
    (question/problem/suggestion = actionable). I.E2 [essential]: provides
    reason or context. I.O1: suggests next step. I.O2: gives reference info.
  - **Expression** - E.E1 [essential]: concise & to-the-point. E.E2
    [essential]: polite & objective (code not person). E.O1: readable format.
    E.O2: proper syntax/grammar.
- **Key numbers:** **28.8% of CRCs lack clarity in >=1 attribute.** Per-
  attribute deficiency: Informativeness 19.3% (worst), Relevance 11.4%,
  Expression 5.8%. C++ worst language (63.6% all-positive). >=75% of
  practitioners rate each attribute important.
- **ClearCRC (automated evaluator):** Best = pre-trained LMs (CodeBERT
  balanced accuracy up to **73.04%**, F1 up to 94.61%; CodeReviewer 69.46% /
  94.61%). Pre-trained LMs strongly outperform much larger LLMs (Llama3-70B,
  CodeLlama-34B) which "perform poorly due to inability to acquire sufficient
  knowledge about clarity." Generalizes to newer projects with only ~3% drop.
- **Lesson (directly actionable for prompt + gating):** Bake RIE's essential
  criteria into the system prompt as hard output rules; add a post-generation
  gate (ClearCRC-style CodeBERT classifier or LLM self-check against the same
  rubric) that suppresses/rewrites any comment failing an essential criterion.
  Since **Informativeness (missing "why"/context) is the top failure (19.3%)**,
  force every comment to include an explicit rationale or reference, and treat
  vague comments ("This is wrong" with no why) as auto-rejects before posting.

### 3.2 Software Delegation Contracts: Measuring Reviewability
Schmalbach — arXiv:2606.17099, 2026.

- **Method:** Controlled pilot - 64 agent runs (Claude Code) on a ~600-line
  TypeScript API with seeded defects; 10 tasks; 2 model tiers (Sonnet 4.6,
  Haiku 4.5); 3 conditions (A=issue-style prompt, B=explicit contract,
  C=contract+required evidence bundle); 3 independent condition-blinded
  model-based reviewers = 192 reviews; 30 A/B matched pairs.
- **Delegation contract:** Tuple `<T,A,W,C>` = Task (objective, scope,
  non-goals, success criteria), Authority (allowed/forbidden actions), Work
  package (artifact + evidence), Acceptance context (who reviews, against
  what).
- **Key numbers:** Evidence sufficiency **3.90 -> 4.73 (+0.83/5, p<0.0001,
  Cliff's delta = 0.66)**, 22/30 pairs improved / 0 worsened. Ambiguity
  1.30 -> 1.07 (p=0.035). **Correctness: ALL 64 runs passed hidden acceptance
  checks, zero scope violations** - contracts buy reviewability, NOT
  correctness (the dissociation is the central result). Cost: tokens +13%,
  wall-clock +38%, patch size +45%. Weaker-tier (Haiku) effect ~2x Sonnet.
  Evidence is demand-elastic: residual-risks section 0% spontaneous -> 100%
  on demand.
- **Lesson:** A PR-review tool could measure/emit a **reviewability signal
  distinct from a correctness signal** (evidence sufficiency, presence of
  changed-files-with-reasons, known-limitations, residual-risks,
  reviewer-checklist fields); require/auto-synthesize a contract for
  AI-authored PRs; flag PRs missing residual-risk/limitation disclosures that
  agents never volunteer spontaneously; weight reviewability more heavily for
  weaker author models.

---

## 4. Security and adversarial review of/with AI

### 4.1 SeRe: Security-Related Code Review Dataset
Zhao et al. — arXiv:2601.01042, ICSE 2026.

- **Method:** Active-learning ensemble classifier. Pseudo-labels from
  lightweight LLMs (unanimous pos/neg kept) validated by DeepSeek-V3 ->
  balanced 3,000 initial set; iterative active learning sends only
  *inconsistent* (hardest) cases to humans; 4-of-5 voting => positive.
- **Dataset:** 373,824 raw review instances -> **6,732 security-related
  reviews** (15,132 comments); 5 langs (C, C++, C#, Java, Go); 311 repos.
  Largest public security-related CR dataset (vs Yu 614 / Paul 516).
- **Classifier:** 5 instruction-tuned 7-9B models; **Precision 92.75%,
  Recall 42.38%, F1 58.18%** (deliberate precision-first). Baselines: GPT-4o
  P 41.58%, DeepSeek-V3 P 59.68%. Fleiss' kappa 0.88.
- **Distribution:** Security is ~4% of review comments; >60% are memory-mgmt
  (38.99%) + concurrency (23.85%); 14 CWE-derived categories; 84% map to real
  CVE/CWE.
- **Benchmark (4,788-sample):** Generic CR models collapse on security -
  Auger BLEU 15.79 -> 3.67, EM 4.14% -> 0.0%; CodeReviewer EM 0.06% -> 0.02%.
  LLMs win semantic (DeepSeek-V3 SemSim 39.82%) but lose lexical. **Few-shot
  hurts LLMs** (0-shot beats 2-shot). Exact Match ~0% for every approach.
- **Lesson:** SeRe is a ready-made held-out eval set for security coverage
  (current SOTA ~0% EM, <40% SemSim - large headroom). Generic CR models and
  frontier LLMs drop sharply on security and few-shot doesn't help - argues
  for security-specialized fine-tuning on SeRe rather than prompt-only, plus
  a high-precision security classifier (their 4-of-5 ensemble, 92.75% P) as a
  gating stage.

### 4.2 SEVRA-BENCH: Social Engineering of Vulnerabilities in Review Agents
arXiv:2606.13757, 2026 (Melo, Fogliato, Zhou, Thaker, Wu - CMU/Microsoft/AWS).

- **Method:** Each malicious episode starts from a real CVE fix, reverses it
  (`git apply -R`) to reintroduce the vulnerability, submits as a PR under one
  of 15 social-engineering framings (diff held fixed, only narrative varies -
  isolates framing-susceptibility). Reviewer is a ReAct agent (inspect_ai,
  temp 0) over an isolated Gitea instance; system prompt deliberately omits
  security framing (measures spontaneous detection).
- **Dataset:** 1,062 malicious PRs across 10 CWE classes (top 10 of 2025 CWE
  Top-25) x 15 framings. 150 source CVE records.
- **15 framings:** Fake Bug Fix, Misleading Hardening, Build System
  Laundering, Refactoring, Unsafe Optimization, Appeal to Authority, Review
  Bias, Prior Approval Signal, AI Agent Authored, Dependency Compatibility
  Claim, Misleading Pass, False Coverage, Evidence Dilution, Out of
  Distribution, Emotional Appeal.
- **8 reviewer LLMs + Refusal Rate (RR, higher=better):** Opus 4.7 **97.6%**
  · GPT-5.5 **95.2%** · GLM-5 83% · Haiku 4.5 52.9% · **DeepSeek V4-Flash
  53.4%** · Kimi K2.5 52.3% · Grok Code Fast 39% · GPT-5.4-nano 35.6%.
  **Closed-vs-open gap ~45pp.**
- **Framing swings:** Open-weight RR swings up to **82pp for the same code**
  (DeepSeek: Appeal to Authority 100% vs Prior Approval 18.2%). Most reliable
  open-weight breakers: **Prior Approval Signal** (DeepSeek 18%, Kimi 14%),
  **Dependency Compatibility Claim** (Grok 12%), **Evidence Dilution**,
  **Fake Bug Fix**. Misleading Pass is the one framing that dents Opus (->84%).
- **Lesson (red-team blueprint):** Regenerate reversed-CVE PRs under the 15
  framings and gate the tool on them. Treat PR descriptions, commit messages,
  and inline comments as **untrusted, attacker-controlled text** flowing into
  reviewer context - prompt-injection/social-engineering defenses are
  mandatory (ignore claimed CI/coverage/approval signals in prose; verify
  against repo state). Do not run an open-weight model (DeepSeek ~53% RR) as
  the sole merge gate; pair with a frontier reviewer or static analysis.

---

## 5. Pre-LLM / ML foundations (for context)

- **Bacchelli & Bird, "Expectations, Outcomes, and Challenges of Modern Code
  Review"** MSR 2013 - defined MCR's social / quality / knowledge-transfer
  purposes.
- **CodeReviewer (Li et al., FSE 2022)** - pre-trained model for review-
  comment generation plus reviewer recommendation; the main pre-LLM baseline
  the LLM papers now beat. ~138k-328k diffs, 9 langs.
- **RevFinder and the reviewer-recommendation line** - early ML reviewer
  routing.

---

## 6. Review processes in other domains (transferable lessons)

### Automotive - ISO 26262 (functional safety)
Risk-based **ASIL A-D** from Severity x Exposure x Controllability; the rigor
of review/verification scales with risk. Formal **independence** requirements
(verifier must not be the author), **bidirectional traceability**
(requirement <-> code <-> test), regression analysis of defects to source.
Automotive SPICE adds SUP.1 Joint Review and SUP.2 Verification as assessed
process areas.
*Lesson: calibrate review depth to risk; maintain traceability.*

### Aerospace - DO-178C (avionics software)
**DAL A-E**; Level A demands 71 objectives, 30 with independence; mandatory
**bidirectional tracing** (HLR <-> LLR <-> source <-> test cases <-> results);
**MC/DC structural coverage** at Level A; objective-based "Stages of
Involvement" gates (SOI #1-4).
*Lesson: verification independence plus coverage evidence as a review exit
criterion.*

### Rockets / space - NASA systems-engineering review boards
NPR 7120.5 / 7150.2 and ECSS standards define gated lifecycle reviews:
SRR -> SDR -> PDR (Preliminary Design Review) -> CDR (Critical Design Review)
-> TRR (Test Readiness Review) -> FRR (Flight Readiness Review). Each has
explicit entry/exit criteria, an independent review board, and a recorded
disposition.
*Lesson: phased review with explicit entry/exit criteria and an independent
board.*

### Science - scholarly peer review
Single-blind / double-blind (dual-anonymous) / open review / registered
reports / preprints. Known biases: against negative studies, "role duality"
(reviewers who are also being evaluated game their reviews). AI is now being
used inside peer review (Nature survey), with prompt-injection concerns.
*Lesson: identity masking and bias mitigation; pre-register review criteria.*

### Traditional SE - Fagan inspection (1976)
Formal group process with explicit roles (author, reader, reviewer, moderator,
recorder): planning -> overview -> preparation -> meeting -> rework ->
follow-up. Explicit entry/exit criteria; reports 80-90% defect detection;
defects cost 10-100x less when caught early.
*Lesson: structured roles plus checklist-driven review.*

---

## 7. Where `pr-reviewer` stands vs. the state of the art

The current implementation (`src/index.ts`) is a clean baseline: PR diff +
title + body -> single LLM call (`deepseek-v4-flash`) -> one review comment,
with a "skip style nitpicks" system prompt. Against the literature this is
roughly ~2018-era single-shot review.

| SOTA capability | Source | Current tool | Gap |
|---|---|---|---|
| Curated review guidelines as mandatory prompt input | RovoDev (2601.01129) | generic "skip nitpicks" prompt | guidelines beat persona/CoT/context combined |
| Trained actionability classifier (ModernBERT on resolved labels) | RovoDev | none | the single highest-leverage quality gate (+20pp) |
| Diff chunking (per-hunk, 10-50 line sweet spot) | 2606.15689 | sends all files | F1 collapses 15x for >150-line diffs |
| Haiku-class model over Sonnet-class | 2606.15689 | deepseek-v4-flash | verify cost/recall Pareto; 3.2x cheaper possible |
| Repo/file context beyond the diff | RovoDev | diff only | RovoDev adds only 1-3% but enables inline comments |
| Inline per-hunk review comments | RovoDev / CodeReviewer | one big comment | lower signal, harder to act on |
| RIE-aligned prompt + clarity gate | ISSTA'25 (2410.06515) | generic prompt | 28.8% of comments lack clarity; Informativeness worst |
| Security specialization + classifier gate | SeRe (2601.01042) | generic | generic models collapse on security (EM ~0%) |
| Adversarial/red-team robustness | SEVRA-Bench (2606.13757) | none | DeepSeek-class ~53% refusal on malicious PRs |
| Reviewability/effort signal for AI PRs | MSR'26, Delegation Contracts | none | could flag plan-less/high-effort PRs |
| Risk-calibrated depth | ISO 26262 / DO-178C | one depth for all | no severity routing |
| Dynamic runtime checks (build + tests) | Khan survey (2602.13377) | none | static text-match is the field's most-cited weakness |

> See §8 for the consolidated validation methodology, verified public
> benchmarks, metric definitions, and a SOTA scoreboard with the exact
> numbers a reviewer must beat to claim state-of-the-art parity.

---

## 8. Evaluation methodology, benchmarks & SOTA metrics

The rest of this document summarizes *what* the field found. This section
consolidates *how* each paper validated its findings and *what numbers a
reviewer must beat* — so `pr-reviewer` can be measured against the state of
the art rather than against intuition. Today `scripts/local-test.ts` only
runs the reviewer on a fixture or real PR and prints the review body; it
computes no metrics and has no golden labels (see §8.4).

### 8.1 Per-paper validation breakdown

Uniform block per relevant paper: **Dataset / test cases · Methodology ·
Metrics · SOTA expected result · Mapping to pr-reviewer**.

**1.2 Heumuller & Ortmeir (Previously on... Automating Code Review)**
- *Dataset:* 24 included papers (May 2015 – Apr 2024), 2 snowballing
  iterations.
- *Methodology:* Systematic review (Kitchenham); 48 task/metric
  combinations across 3 formalized tasks — ChQual (change-quality score
  [0,1]), ComGen (comment generation), CodeRef (code refinement; CodeRef1
  conditioned on a comment beats CodeRef2 original→revised).
- *Metrics:* PRE/REC for ChQual; TOP-1 Exact Match + BLEU-4 for
  ComGen/CodeRef. 15/24 papers used black-box/no baselines; 16/24 published
  artifacts.
- *SOTA expected result:* ChQual ~78.6% PRE / 65.65% REC; ComGen TOP-1 EM
  ~2–6% (BLEU-4 ~5–8%); CodeRef TOP-1 EM ~12–18%. A synthetic-feature MLP
  baseline matched/beat all transformers except CodeReviewer on ChQual.
- *Mapping:* Treat review as 3 separable tasks; always include a
  human-understandable baseline (no-change, simple complexity classifier);
  use chronological/project splits **never random** (only 1/24 addressed
  temporal bias); comment generation is far from solved (~2–6% EM) so rank/
  filter suggestions rather than expect correct autonomous comments.

**1.3 Khan et al. (Survey of CR Benchmarks, pre-LLM + LLM era)**
- *Dataset:* 99 papers (58 pre-LLM + 41 LLM, Jan 2015 – Dec 2025); 5
  domains, 18 fine-grained tasks.
- *Methodology:* Taxonomy-based survey across the 18 tasks; dataset
  inventory.
- *Metrics named:* mostly static text-match (BLEU/ROUGE/EM/CodeBLEU) in the
  LLM era, increasingly LLM-as-Judge; **no functional/compile/runtime
  checks** — a build-breaking fix can score high.
- *SOTA expected result / recommended datasets:* CodeReviewer (~138k–328k
  diffs, 9 langs), Tufano (~168k functions), CodeReviewQA (900 ex, 199
  projects, 9 langs), CodeFuse-CR-Bench (601 ex, 70 Python projects),
  LLaMA-Reviewer (288k). Language shift Java 61%→34%, Python 12%→41%.
- *Mapping:* Benchmark across the full 18-task taxonomy; favor the datasets
  above; evaluate on real multilingual PRs; **add dynamic runtime checks
  (build + tests)** — static text-match is the field's most-cited weakness.

**2.1 RovoDev (Tantithamthavorn et al., ICSE'26 SEIP)**
- *Dataset:* Offline 2,068 changes / 2,894 human comments / 1,468 PRs;
  online 12-month GA deployment (June 2024 – June 2025), 2,000+ repos,
  54,000+ comments, 5,500+ engineers, avg 2.1 comments/PR; user feedback
  via thumbs + Reflexive Thematic Analysis.
- *Methodology:* 3-stage pipeline (zero-shot review-guided generation on
  Claude 3.5 Sonnet → gpt-4o-mini factual LLM-judge → ModernBERT
  actionability classifier trained on 5 months / 50,000+ resolved/
  unresolved labels). Ablations isolate each prompt component and each
  quality gate.
- *Metrics:* **Code resolution rate** (did the comment drive a code
  change), PR cycle time, comments/PR, location-alignment rate — *not*
  BLEU/semantic similarity to human comments.
- *SOTA expected result:* Code resolution 38.70% (RovoDev) vs 44.45%
  (human), −5.8pp gap; cycle time 14.35h vs 20.73h = **−31%** (p<.001,
  n≈43.6k vs 43.0k PRs); comments/PR 2.87 vs 4.45 = −35.6% (p<.001).
  Offline only 4% of comments human-aligned post-quality-check, yet 38.70%
  drove code changes. Ablation: actionability classifier **+20pp location
  alignment, +15pp location+semantic**; factual-correctness LLM-judge
  minimal impact. Guidelines beat persona/CoT/PR/Jira context combined
  (guidelines +5pp vs context +1–3%).
- *Mapping:* Measure success by code-resolution rate, not text similarity
  to human comments; the single highest-leverage quality gate is a *trained
  actionability classifier* (ModernBERT on resolved labels), not an
  LLM-judge factual check; curated review guidelines are the highest-impact
  prompt input.

**2.2 Kumar et al. (Bigger Isn't Always Better) — *primary offline
benchmark***
- *Dataset:* 150 samples = 100 synthetic mutation-injected bugs (13
  operators across TS/Python/Go, seed 42, median 5 lines) + 50 real bug-fix
  PRs mined from 8 repos (vercel/next.js, facebook/react, tiangolo/fastapi,
  pallets/flask, pydantic/pydantic, prisma/prisma, hashicorp/terraform,
  docker/compose; median 117 lines, max 562). External validation on the
  **Martian Code Review Benchmark** — 50 real PRs / 5 repos (Sentry,
  Grafana, Cal.com, Discourse, Keycloak) / 136 human-curated golden
  comments / Python, Go, TS, Ruby, Java / independent LLM judge.
- *Methodology:* 5 LLMs × 150 samples × 3 conditions (n=25, 100, 150).
  Ground truth = structured annotations (file, line range, comment type,
  severity, description). **Two-pass judge:** Pass 1 deterministic
  (normalized file-path match ∧ line-range overlap ±5 ∧ comment-type
  compatibility) handles ~70%; Pass 2 Claude Opus 4.6 (temp 0) adjudicates
  deferred cases as true_positive / false_positive / partial_match (0.5
  TP), plus 4 qualitative dims on 1–5 (Depth, Context awareness,
  Specificity, Suggestion correctness). Severity-weighted F1: critical 4×,
  high 2×, medium 1×, low 0.5×. All models run the identical production
  prompt, temp 0.1.
- *Metrics:* Precision, Recall, F1, severity-weighted F1, TP/FP/FN, 4
  qualitative scores, cost/review, output behavior (tokens, findings/
  sample).
- *SOTA expected result:* Haiku 4.5 F1 0.365 vs Sonnet 0.343 (+6.4%);
  Haiku recall 0.293 vs 0.248 (+18.1%); Haiku cost/review $0.003 vs $0.010
  (3.2× cheaper); Haiku 38% more findings. **Synthetic→real collapse:**
  Haiku 0.847→0.066 (−92%), Sonnet 0.796→0.050 (−94%), Minimax
  0.804→0.007 (−99%). **Diff size (Haiku F1):** <10 lines 0.657; 10–50
  ~0.800 (sweet spot); 50–150 ~0.07; >150 0.043 (~15× drop). **Per-category
  recall:** Security ~70% all models; Logic Haiku 24.5% vs Sonnet 19.6%;
  **Performance 0% for 4/5 models**; Best Practice ~0% all. Ensembling
  (union) hurts F1. **Martian external:** Haiku F1 36.4% (P 32.6 / R 41.2,
  56 TP/116 FP) vs Sonnet 27.1% (P 35.3 / R 22.1, 30 TP/55 FP) — Haiku #9
  on the leaderboard between Copilot and CodeRabbit.
- *Mapping:* This is the most directly-usable offline eval for a
  single-comment reviewer. Run pr-reviewer on Martian's 50 PRs, compute
  P/R/F1 + severity-weighted F1 vs the 136 golden comments via the
  two-pass judge, stratify by diff size, and compare to Haiku 36.4% /
  Sonnet 27.1%. Adopt the two-pass judge protocol verbatim. Reproduce the
  diff-size stratification to confirm the 10–50 line sweet spot (§9 step
  1). The 0% performance-bug recall argues for pairing the LLM with
  deterministic AST/data-flow rules.

**2.3 Early-Stage Prediction of Review Effort (MSR'26)**
- *Dataset:* AIDev v1.0 — 33,707 agent-authored PRs from 2,807 GitHub repos
  (>100 stars); agents Codex (21,799), Copilot (5,017), Devin (4,827),
  Claude 3.5 (523).
- *Methodology:* Binary "Circuit Breaker" LightGBM + Stacking on 35
  features (Intent, Context, Complexity) at T0 (creation) and T1
  (pre-review). Effort = sum of reviews+comments; "High Cost" = top 20%.
  "Ghosting" = Rejected + human feedback + no follow-up >14 days. SHAP for
  interpretability.
- *Metrics:* AUC, PR-AUC, recall-at-budget; temporal **and** repo-disjoint
  splits.
- *SOTA expected result:* LightGBM temporal AUC **0.957**, PR-AUC 0.881,
  repo-disjoint AUC 0.834. Size-only baseline AUC 0.933 (temporal) → 0.65
  (repo-disjoint). CodeBERT (text) AUC 0.52. At 20% review budget captures
  69% of high-effort PRs. Top SHAP: additions, body_length, total_changes;
  has_plan = strong negative predictor of ghosting.
- *Mapping:* A lightweight structural gate (patch size, file types,
  entropy, has_plan) could pre-rank incoming AI PRs by predicted review
  effort and flag plan-less sprawls at high ghosting risk — fast-track
  simple merges, spend the LLM budget only on the "expensive tail".
  Validates repo-disjoint (not just temporal) evaluation.

**3.1 Clear Code Review Comments / RIE (ISSTA'25)**
- *Dataset:* Literature review (251 papers, 47 CRC-related) + group
  interview (11 engineers) + online survey (112 responses, 103 valid, 37
  countries) + manual measurement (**2,438 diff+CRC pairs**, 9 languages,
  2 annotators, Cohen's κ = 0.87).
- *Methodology:* Open card sorting → RIE framework (Relevance /
  Informativeness / Expression, each with essential E and optional O
  criteria); ClearCRC automated evaluator trained on the 2,438 pairs.
- *Metrics:* Per-attribute clarity pass-rate; balanced accuracy, F1 for
  ClearCRC.
- *SOTA expected result:* **28.8% of CRCs lack clarity in ≥1 attribute.**
  Per-attribute deficiency: Informativeness 19.3% (worst), Relevance
  11.4%, Expression 5.8%; C++ worst language (63.6% all-positive). ≥75%
  of practitioners rate each attribute important. ClearCRC: CodeBERT
  balanced accuracy up to **73.04%**, F1 up to 94.61%; CodeReviewer
  69.46% / 94.61%; pre-trained LMs beat much larger LLMs (Llama3-70B,
  CodeLlama-34B).
- *Mapping:* Bake RIE's essential criteria (R.E1, I.E1, I.E2, E.E1, E.E2)
  into the system prompt as hard output rules; add a post-generation
  clarity gate (ClearCRC-style CodeBERT classifier or an LLM self-check
  against the RIE rubric) that suppresses/rewrites any comment failing an
  essential criterion. Since **Informativeness (missing "why"/context) is
  the top 19.3% failure**, force every comment to include an explicit
  rationale and treat vague comments as auto-rejects. The 2,438 pairs are
  a ready-made held-out clarity eval set.

**3.2 Software Delegation Contracts / Reviewability (Schmalbach)**
- *Dataset:* Controlled pilot — 64 agent runs (Claude Code) on a ~600-line
  TypeScript API with seeded defects; 10 tasks; 2 model tiers (Sonnet 4.6,
  Haiku 4.5); 3 conditions (A=issue prompt, B=explicit contract,
  C=contract + required evidence bundle); 3 independent condition-blinded
  model-based reviewers = 192 reviews; 30 A/B matched pairs.
- *Methodology:* Delegation contract tuple `<T,A,W,C>` = Task, Authority,
  Work package (artifact + evidence), Acceptance context. Blinded
  reviewing.
- *Metrics:* Evidence sufficiency (1–5), ambiguity, correctness (hidden
  acceptance checks, scope violations), cost (tokens, wall-clock, patch
  size); Cliff's delta for effect size.
- *SOTA expected result:* Evidence sufficiency 3.90 → 4.73 (+0.83/5,
  p<0.0001, Cliff's δ = 0.66), 22/30 pairs improved / 0 worsened.
  Ambiguity 1.30 → 1.07 (p=0.035). **All 64 runs passed hidden acceptance
  checks, zero scope violations** — contracts buy *reviewability*, NOT
  correctness (the dissociation is the central result). Cost: tokens +13%,
  wall-clock +38%, patch +45%. Weaker-tier (Haiku) effect ~2× Sonnet.
  Evidence is demand-elastic: residual-risks 0% spontaneous → 100% on
  demand.
- *Mapping:* Emit a **reviewability signal distinct from a correctness
  signal** (evidence sufficiency, changed-files-with-reasons, known-
  limitations, residual-risks, reviewer-checklist fields); require/auto-
  synthesize a contract for AI-authored PRs; flag PRs missing residual-
  risk/limitation disclosures that agents never volunteer spontaneously;
  weight reviewability more heavily for weaker author models.

**4.1 SeRe (Zhao et al., ICSE 2026)**
- *Dataset:* 373,824 raw review instances → **6,732 security-related
  reviews (15,132 comments)**; 5 languages (C, C++, C#, Java, Go); 311
  repos — the largest public security-related CR dataset. Benchmark subset
  4,788 samples.
- *Methodology:* Active-learning ensemble classifier. Pseudo-labels from
  lightweight LLMs (unanimous pos/neg kept) validated by DeepSeek-V3 →
  balanced 3,000 initial set; iterative active learning sends only
  *inconsistent* (hardest) cases to humans; 4-of-5 voting ⇒ positive. 5
  instruction-tuned 7–9B models.
- *Metrics:* Precision, Recall, F1 (precision-first design); Fleiss' κ;
  BLEU / EM / SemSim for generation.
- *SOTA expected result:* Classifier **P 92.75 / R 42.38 / F1 58.18**;
  baselines GPT-4o P 41.58, DeepSeek-V3 P 59.68; Fleiss' κ 0.88. Security
  is ~4% of review comments; >60% are memory-mgmt (38.99%) + concurrency
  (23.85%); 84% map to real CVE/CWE. Generation benchmark: Auger BLEU
  15.79 → 3.67, EM 4.14% → 0.0%; CodeReviewer EM 0.06% → 0.02%;
  DeepSeek-V3 SemSim 39.82% (best semantic, worst lexical). **Few-shot
  hurts LLMs** (0-shot beats 2-shot). Exact Match ~0% for every approach.
- *Mapping:* SeRe is a ready-made held-out eval set for security coverage —
  current SOTA ~0% EM, <40% SemSim leaves large headroom. Generic CR
  models and frontier LLMs collapse on security and few-shot doesn't help,
  arguing for security-specialized fine-tuning on SeRe plus a high-
  precision security classifier (the 4-of-5 ensemble, 92.75% P) as a
  gating stage.

**4.2 SEVRA-Bench (Melo et al.) — *primary security/red-team benchmark***
- *Dataset:* **1,062 malicious PRs** across 10 CWE classes (top 10 of the
  2025 CWE Top 25) × 15 social-engineering framings, from 150 source CVE
  records. Plus benign security-fix PRs to measure false declines.
  Released as a "retained challenge split" (two-stage filter: Haiku 4.5 +
  GPT-5.4-nano run the full set; a PR is retained if at least one model
  approves it).
- *Methodology:* Each episode reverses a real CVE fix (`git apply -R`) to
  reintroduce the vulnerability, then wraps the same diff in one of 15
  framings (diff held fixed, only narrative varies — isolates framing
  susceptibility). Reviewer = ReAct agent (`inspect_ai`, temp 0) over an
  isolated Gitea instance via an MCP tool subset (diff inspection, file
  reading, search, commit history, PR interaction); system prompt
  deliberately omits security framing (measures spontaneous detection).
  Repos squashed to prevent trivial detection. Fresh agent per PR (no
  memory).
- *Metrics:* **Refusal Rate (RR)** — fraction of malicious PRs not approved
  among valid non-infrastructure runs (primary); **Security Reason Rate
  (SRR)** — among blocked PRs, fraction whose rationale was security-
  motivated per an LLM judge; plus terminal-outcome breakdown (approval /
  submitted decline / timeout / no-submit / infra-failure-excluded).
  Standard errors as √(p̂(1−p̂)/n) per Bernoulli episode.
- *SOTA expected result (RR, higher=better):* Opus 4.7 **97.6%** · GPT-5.5
  **95.2%** · GLM-5 83% · DeepSeek V4-Flash 53.4% · Haiku 4.5 52.9% ·
  Kimi K2.5 52.3% · Grok Code Fast 39% · GPT-5.4-nano 35.6%. Closed-vs-open
  gap ~45pp. **Framing swings up to 82pp for the same code** (DeepSeek:
  Appeal to Authority 100% vs Prior Approval 18.2%). Most reliable open-
  weight breakers: Prior Approval Signal, Dependency Compatibility Claim,
  Evidence Dilution, Fake Bug Fix. Misleading Pass is the one framing that
  dents Opus (→84%).
- *Mapping:* This is the security robustness gate. Regenerate reversed-CVE
  PRs under the 15 framings and measure pr-reviewer's RR against
  DeepSeek-flash 53% / GLM-5 83% / Opus 98%. Treat PR descriptions, commit
  messages, and inline comments as **untrusted, attacker-controlled text**
  flowing into reviewer context — prompt-injection/social-engineering
  defenses are mandatory (ignore claimed CI/coverage/approval signals in
  prose; verify against repo state). Do **not** run an open-weight model
  (DeepSeek ~53% RR) as the sole merge gate; pair with a frontier reviewer
  or static analysis (see §11 escalation rule).

### 8.2 Verified public benchmarks (shortlist, with URLs)

**Priority for pr-reviewer (chosen above):**

| Benchmark | What it measures | Size | URL | Status |
|---|---|---|---|---|
| **Martian Code Review Benchmark** | Review quality on real PRs (P/R/F1 vs golden comments) | 50 PRs / 136 golden comments / 5 repos / 5 langs | https://github.com/withmartian/code-review-benchmark | Open source; independent LLM judge; offline track used as external validation in 2606.15689 |
| **SEVRA-Bench** | Adversarial security robustness (Refusal Rate, SRR) | 1,062 malicious PRs / 10 CWE / 15 framings | Harness: https://github.com/RedAI4Code/SEVRA · Dataset: https://github.com/rufimelo99/malicious-pr-bench | Open; uses `inspect_ai` + isolated Gitea; ReAct agents at temp 0 |

**Secondary (named in the surveys, useful for broader coverage):**

- **SeRe** — 6,732 security-related reviews / 15,132 comments; security
  classification (P/R/F1) and generation (BLEU/EM/SemSim). Largest public
  security-related CR dataset (2601.01042).
- **CodeFuse-CR-Bench** — 601 examples / 70 Python projects (Khan survey
  shortlist).
- **CodeReviewQA** — 900 examples / 199 projects / 9 languages (Khan survey
  shortlist).
- **CodeReviewer / Tufano / LLaMA-Reviewer** — large pre-LLM/PEFT
  generation corpora (~138k–328k / ~168k / 288k); the main pre-LLM
  baselines the LLM papers now beat. Good for chronological/project-
  disjoint splits.
- **RIE pairs** — 2,438 diff+comment pairs / 9 languages; clarity grading
  against the RIE essential criteria (2410.06515).
- **VibeOps 150-sample eval framework** — 100 synthetic (seed 42) + 50 real
  PRs from 8 repos; lives in the `vibeops-mcp/evals/` directory of the
  VibeOps repo (2606.15689 names the directory but not a clean top-level
  repo URL); HuggingFace dataset release still pending human validation of
  the real-PR annotations — listed with that caveat.

### 8.3 Metric definitions + methodological musts

**Metrics.**
- **Exact Match (EM)** — generated comment identical to reference after
  normalization. Universally low for review-comment generation (SeRe ~0%,
  ComGen 2–6%); useful as a ceiling probe, not a primary score.
- **BLEU / CodeBLEU / ROUGE** — lexical overlap. Field consensus (1.2,
  1.3): high scores **poorly correlate with usefulness**; report but never
  rely on them alone.
- **Semantic Similarity (SemSim)** — embedding-based match; DeepSeek-V3
  reaches ~39.82% on SeRe (best semantic, worst lexical). Better signal
  than BLEU but still not actionability.
- **Precision / Recall / F1** — over matched findings; use the **two-pass
  judge** (deterministic file+line±5+type match for ~70% of cases, frontier
  LLM at temp 0 adjudicating the rest as TP/FP/partial-0.5) to handle
  free-form comments with approximate line refs.
- **Severity-weighted F1** — critical 4×, high 2×, medium 1×, low 0.5×
  (2606.15689); rewards catching high-impact bugs.
- **Code resolution rate** — did the comment cause a code change (RovoDev
  38.70% SOTA vs human 44.45%); the deployment-grade metric that replaces
  text similarity to human comments.
- **RIE clarity pass-rate** — fraction of comments passing all essential
  RIE criteria (R.E1, I.E1, I.E2, E.E1, E.E2); SOTA deficiency 28.8%,
  ClearCRC bal-acc 73.04%.
- **Refusal Rate (RR) + Security Reason Rate (SRR)** — SEVRA-Bench's
  decision-level security metrics; RR = fraction of malicious PRs not
  approved; SRR = among blocked, fraction security-motivated.
- **AUC / PR-AUC** — for triage/effort classifiers; report on temporal
  **and** repo-disjoint splits (2601.00753).
- **Cost / cycle time** — $/review and PR cycle time (RovoDev −31% cycle
  time at 3.2× lower cost for Haiku vs Sonnet).

**Methodological musts (the field's most-cited fixes).**
1. **Chronological / project-disjoint splits, never random.** Only 1/24
   papers addressed temporal bias (1.2); random splits leak the future
   into the past. Size-only baselines can look strong on temporal (0.933
   AUC) and collapse on repo-disjoint (0.65).
2. **Always include a human-understandable baseline** (no-change, simple
   complexity classifier). 15/24 papers used black-box/no baselines; a
   synthetic-feature MLP matched/beat all transformers except CodeReviewer
   on ChQual.
3. **Evaluate on real merged PRs, not synthetic alone.** Synthetic eval
   overstates capability by up to ~12× (0.847 vs 0.066 F1); report
   synthetic and real results separately.
4. **Add dynamic runtime checks (build + tests).** Static text-match is
   the field's most-cited weakness (1.3); a build-breaking fix can score
   high.
5. **Report significance + effect sizes.** Rarely reported (1.2);
   Delegation Contracts reports Cliff's δ = 0.66, p<0.0001 as a model.
6. **Stratify by diff size.** F1 collapses 15× from the 10–50 line sweet
   spot to >150 lines; aggregate F1 hides this.

### 8.4 Mapping to pr-reviewer (current state vs what's missing)

**What `scripts/local-test.ts` does today:** loads a fixture diff (or
fetches a real PR via `gh pr diff`), calls `reviewDiff` once with the
hard-coded `deepseek-v4-flash`, and prints `buildReviewBody(review,
usage)`. **No golden comments, no matching, no metrics, no scoring
harness.** `fixtures/` contains a single synthetic case (`sample.diff` +
`sample-meta.json`).

**What's missing to measure against §8.5:**
1. **Golden-labeled fixture set** — port Martian's 50 PRs / 136 golden
   comments (and/or VibeOps's 50 real PRs) into `fixtures/` with
   structured annotations (file, line range, comment type, severity).
2. **Scoring harness** — implement the two-pass judge (Pass 1 deterministic
   file+line±5+type match; Pass 2 a frontier LLM at temp 0 returning
   TP/FP/partial) and emit P/R/F1 + severity-weighted F1 + the 4
   qualitative dims.
3. **Diff-size stratification** — bucket results by <10 / 10–50 / 50–150 /
   >150 lines to confirm the sweet spot and the large-diff collapse.
4. **Structured-finding adapter** — pr-reviewer currently emits one
   free-text comment. To compute P/R/F1 it must emit structured findings
   (file, line range, type, severity, description) like the 2606.15689
   prompt; this is a noted gap, not built in this doc-only change.
5. **Security red-team run** — run pr-reviewer on SEVRA-Bench's retained
   split and report RR + SRR.
6. **Real-not-synthetic discipline** — never report synthetic-only numbers;
   always pair with real-PR results.

**Concrete first eval recipe (Martian):** clone
`withmartian/code-review-benchmark`, run pr-reviewer on each of the 50 PRs
with a structured-finding prompt, match findings to the 136 golden
comments via the two-pass judge, compute P/R/F1 + severity-weighted F1,
stratify by diff size, and compare to **Haiku 36.4% / Sonnet 27.1%**. A
pr-reviewer result near or below Sonnet 27.1% on real PRs is the expected
baseline for a single-shot unchunked reviewer; beating Haiku 36.4%
requires the §9 changes (chunking first, then guidelines + actionability
gate).

### 8.5 SOTA scoreboard (the numbers to beat)

| Benchmark / metric | SOTA | Baseline to beat | Source |
|---|---|---|---|
| Martian F1 (50 real PRs) | Haiku 36.4% (P 32.6 / R 41.2) | Sonnet 27.1%; Haiku #9 on leaderboard | 2606.15689 |
| Real-only F1 (best model) | 0.066 (near random) | synthetic 0.847 (12× overstated) | 2606.15689 |
| F1 by diff size (Haiku) | 10–50 lines ~0.800 | >150 lines 0.043 (15× drop) | 2606.15689 |
| Per-category recall — Security | ~70% (all models) | — (commoditized) | 2606.15689 |
| Per-category recall — Performance | 0% (4/5 models) | — (universal blind spot) | 2606.15689 |
| SEVRA-Bench Refusal Rate | Opus 97.6%, GPT-5.5 95.2% | DeepSeek-flash 53.4%, GLM-5 83%, Haiku 52.9% | 2606.13757 |
| SEVRA framing swing | — (Opus worst case 84%) | DeepSeek 100%→18% (Prior Approval) = 82pp | 2606.13757 |
| SeRe security classifier | P 92.75 / R 42.38 / F1 58.18 | GPT-4o P 41.58; gen EM ~0% | 2601.01042 |
| RIE clarity | 28.8% of comments deficient | ClearCRC bal-acc 73.04% / F1 94.61% | 2410.06515 |
| RovoDev code resolution | 38.70% (vs human 44.45%) | cycle time −31%; comments/PR 2.87 vs 4.45 | 2601.01129 |
| ChQual / ComGen / CodeRef | 78.6% PRE / 65.65% REC | ComGen EM 2–6%; CodeRef EM 12–18% | 2508.18003 |
| Effort triage AUC | 0.957 (temporal) | 0.834 (repo-disjoint); size-only 0.65 | 2601.00753 |
| Delegation-contract reviewability | evidence 3.90→4.73 (δ=0.66) | all 64 runs passed hidden checks (reviewability ≠ correctness) | 2606.17099 |

---

## 9. Candidate next steps (ordered by leverage, with evidence)

1. **Chunk the diff per file/hunk and review each separately, then aggregate.**
   Evidence: 2606.15689 shows a 15x F1 collapse for >150-line diffs; the
   10-50 line bucket is the sweet spot (~0.800 F1). Highest-leverage single
   change.
2. **Curate review guidelines (G_Code, G_Test, G_Comment) and make them the
   core of the system prompt.** Evidence: RovoDev ablation - guidelines
   +5pp localization, beating persona/CoT/PR/Jira context combined (1-3%).
3. **Rewrite the system prompt against the RIE essential criteria**
   (R.E1, I.E1, I.E2, E.E1, E.E2) and force every comment to include an
   explicit rationale. Evidence: ISSTA'25 - 28.8% of comments lack clarity,
   Informativeness (missing "why") is the dominant 19.3% failure.
4. **Add a second-stage quality gate - prioritize a trained actionability
   classifier** (ModernBERT on resolved/unresolved labels, à la RovoDev) over
   an LLM-judge factual check. Evidence: RovoDev ablation - actionability
   +20pp location alignment; factual-correctness LLM-judge minimal impact and
   expensive.
5. **Evaluate on real merged PRs, not synthetic cases.** Evidence: 2606.15689
   - synthetic eval overstates capability by ~12x (0.847 vs 0.066 F1); build
   a small local fixture set of real bug-fix PRs for `scripts/local-test.ts`.
6. **Verify the model choice on the Pareto frontier.** Evidence: 2606.15689 -
   Haiku 4.5 beats Sonnet 4.6 on F1/recall at 3.2x lower cost; GPT-5.4 mini
   and Haiku define the frontier; Sonnet is dominated. Re-test
   `deepseek-v4-flash` against Haiku-class and GPT-5.4-mini-class on real PRs.
7. **Pair the LLM with deterministic AST/data-flow rules for performance and
   architecture bugs.** Evidence: 2606.15689 - LLM recall ~0% on performance
   bugs (N+1, unbounded queries) across all 5 models.
8. **Optional security specialization** using the SeRe dataset framing +
   a high-precision security classifier gate (92.75% P). Evidence: SeRe -
   generic CR models and frontier LLMs collapse on security (EM ~0%);
   few-shot doesn't help.
9. **Red-team against SEVRA-Bench-style adversarial PRs** (15 framings,
   especially Prior Approval Signal, Dependency Compatibility Claim, Evidence
   Dilution, Fake Bug Fix). Evidence: 2606.13757 - open-weight models
   (DeepSeek-class ~53% RR) are unreliable as a sole merge gate; treat PR
   narrative text as untrusted input.
10. **Optional reviewability/effort signal** (patch size, entropy, has_plan,
    evidence-bundle presence) to pre-rank AI-authored PRs. Evidence: MSR'26
    (AUC 0.957) and Delegation Contracts (reviewability dissociates from
    correctness).
11. **Optional risk-calibrated depth**: a lightweight severity tag on each
    finding (bug / security / perf / nit), inspired by ISO 26262 ASIL scaling.

---

## 10. Open questions the research flags but does not resolve

- **Does RAG/repo-context help once you chunk?** RovoDev found PR/Jira context
  only +1-3%, but they did not test cross-file repo context at hunk level.
- **Human replication of LLM-as-judge reviewability results.** Delegation
  Contracts used median-of-3 LLM reviewers; human replication is the key
  follow-up they name.
- **Data contamination in security benchmarks.** SEVRA-Bench notes frontier
  models may memorize public CVE patterns, inflating closed-source RR toward
  saturation.
- **Dynamic/runtime evaluation at scale.** Khan survey identifies this as the
  field's biggest gap - no major benchmark runs build + tests on proposed
  revisions.

---

## 11. Available models via the OpenCode Go API key

`pr-reviewer` is built on the OpenCode Go API (`https://opencode.ai/zen/go/v1`,
OpenAI-compatible). The current implementation hard-codes `deepseek-v4-flash`
(`src/index.ts`). The API exposes a tiered lineup that maps cleanly onto a
three-stage review pipeline informed by the research above.

### 11.1 Model tiers (by capability and cost)

| Tier | Model | Role | Why |
|---|---|---|---|
| **Best / thinking** | `glm-5.2` | Final reasoning, hard cases, security/ architecture judgment, the "quality-check" pass | Near-Opus-level thinking and overall coding capabilities. Use where reasoning depth matters most - the RovoDev "review-guided generation" stage and any adversarial/ security call (SEVRA-Bench shows frontier reasoning is what separates 97.6% refusal from 53%). |
| **Middle / balanced** | `deepseek-v4-pro` | Default review generation, inline comment drafting, the bulk of per-hunk review | Best cost-vs-capability balance. Strong enough for the 10-50 line diff sweet spot where 2606.15689 shows most value lives; cheap enough to run per-hunk after chunking. |
| **Cheapest / loop** | `deepseek-v4-flash` | Loops, iterations, classification, triage, retry/refine, the "expensive tail" pre-filter | Effectively free - can run many iterations (delegation-contract evidence bundles, multi-pass refinement, self-consistency sampling) without cost concern. Ideal for the MSR'26 structural effort-prediction gate and Delegation-Contracts evidence extraction. |

### 11.2 How the tiers map to the research-backed pipeline

- **Triage / pre-filter (flash):** Run the cheap structural gate first - patch
  size, entropy, file types, has_plan (MSR'26, AUC 0.957) - to fast-track
  simple merges and route only the "expensive tail" to LLM review. Flash is
  cheap enough to run this on every PR.
- **Per-hunk generation (pro):** After chunking the diff to the 10-50 line
  sweet spot (2606.15689), send each hunk to `deepseek-v4-pro` with curated
  review guidelines (RovoDev: guidelines beat persona/CoT/context combined).
  Pro balances cost and capability for the bulk of comments.
- **Hard-case escalation (glm-5.2):** Route security-sensitive hunks,
  architecture-level findings, and any hunk flagged as ambiguous to `glm-5.2`
  for near-Opus reasoning. SEVRA-Bench shows this is where frontier reasoning
  earns its cost - open-weight-only review leaves ~47% of malicious PRs
  approved.
- **Quality gate (glm-5.2 or flash):** RovoDev's highest-leverage gate is a
  trained actionability classifier (+20pp), not an LLM-judge factual check.
  Until a ModernBERT-style classifier is trained, use `glm-5.2` for the
  final go/no-go on each comment (correctness + RIE clarity check); use
  `deepseek-v4-flash` for cheap iterative refinement loops (e.g. "rewrite
  this comment to include a rationale" per ISSTA'25 Informativeness fix).

### 11.3 Other models on the endpoint (context, not default choices)

The OpenAI-compatible endpoint also exposes the broader frontier lineup
referenced throughout the research - useful for A/B evaluation and for
matching specific papers' setups:

- **Claude Opus 4.6 / Opus 4.7** - the SEVRA-Bench top performer (97.6% refusal
  rate) and the 2606.15689 adjudicator. Reference point for "best possible"
  security reasoning; cost-prohibitive as a default but valuable as a
  benchmark ceiling.
- **Claude Sonnet 4.6** - RovoDev's generation model; 2606.15689 shows it is
  *dominated* by Haiku-class on F1/recall at 3.2x the cost. Useful for
  reproducing RovoDev-style results, not as a production default.
- **Claude Haiku 4.5** - 2606.15689's Pareto-frontier winner (F1 0.365,
  3.2x cheaper than Sonnet, +18% recall). The evidence-based pick if a
  Claude-tier model is desired for generation; compare against
  `deepseek-v4-pro` on real PRs.
- **GPT-5.4 mini / GPT-5.5** - GPT-5.4 mini is the other 2606.15689
  Pareto-frontier model; GPT-5.5 is SEVRA-Bench's #2 (95.2% refusal).
  Reference points for cost/quality and security-capability ceilings.
- **gpt-4o-mini** - RovoDev's factual-correctness LLM-judge (binary selection).
  Note RovoDev found this stage *minimal impact* and expensive - prefer the
  trained actionability classifier pattern.
- **Minimax M2.7, GLM-5, Grok Code Fast, Kimi K2.5** - the 2606.15689 and
  SEVRA-Bench long tail. Minimax M2.7 and GLM-5 cluster mid-pack on review
  F1; Grok (39% RR) and Kimi (52.3% RR) are *not* safe as sole merge gates
  per SEVRA-Bench. Useful only for adversarial-robustness testing.
- **DeepSeek V4-Flash** - also appears in SEVRA-Bench at **53.4% refusal** on
  malicious PRs. Confirms the tier framing: flash is excellent for cheap
  loops and triage but must *not* be the sole security/merge gate - escalate
  to `glm-5.2` for security judgment.

### 11.4 Default config recommendation for `pr-reviewer`

Replace the hard-coded single-model call in `src/index.ts` with tiered routing:

- **Default generation:** `deepseek-v4-pro` (middle tier) per hunk.
- **Triage / pre-filter / refinement loops:** `deepseek-v4-flash` (cheapest).
- **Security, architecture, and final quality gate:** `glm-5.2` (best
  thinking, near-Opus).
- **Escalation rule:** any hunk touching auth/crypto/SQL/ deserialization/
  untrusted-input, or any hunk where pro and flash disagree, is routed to
  `glm-5.2`. This directly addresses SEVRA-Bench's finding that open-weight/
  cheap models miss ~47% of malicious PRs.

This three-tier design turns the research's "bigger isn't always better"
finding (2606.15689) into a cost strategy: spend the cheap budget on volume
loops and triage, spend the near-Opus budget only where reasoning depth
matters (security, hard cases, final gate), and let the middle tier carry
the routine work.
