# Project Research Summary

**Project:** ARTEX — Refusal-Contamination Governance Milestone (brownfield)
**Domain:** AI agent behavioral governance on an autonomous pentest platform (Go 1.26 modular monolith + Next.js 16 embedded frontend + PostgreSQL)
**Researched:** 2026-10-10
**Confidence:** HIGH

> Source files: `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`. This summary synthesizes them; the detail lives in those files.

## Executive Summary

This is a **governance feature on an existing, fully-verified stack** — not a technology-selection exercise. The problem class is a benign instance of **OWASP ASI06: Memory & Context Poisoning** (the model writes refusal beliefs into the persistent exploration graph; later sessions read and amplify them). The finalized design doc (`docs/拒止污染治理方案.md`, solutions A–N, decisions Q1–Q15) covers essentially every table stake the ASI06/pentest-governance literature prescribes, and its two genuinely novel elements — **degrade-first contamination disposition** and **dismissal-immune measurement** — are defensible differentiators no surveyed reference product implements. The decisive stack finding: **zero new dependencies**. Prompt reseeds, LLM-judge infrastructure, watermark schedulers, independent audit tables, `content_version` cache invalidation, and the reserved `dismissed` state all have working in-repo precedents mapped to specific line numbers. Every research file independently validated the doc's §17/§20 batch order as architectural seams, not just effort buckets.

The recommended approach is the doc's layered defense, built in six phases: **(1)** prompt discipline + reseed across all 8 agents (with the fabrication-cliff escape hatch in the same commit), **(2)** graph governance — fact cleanup, write-time intercept (D/L), full read-path dismissed filtering, `governance_log` (C + Q1 + D/L), **(3)** planner hard-line — `WriteCounts.Intents`, refusal triage, bounded corrective retry, throttled LLM judge (H-L2 + K in one PR), **(4)** authorization credentials + guard wiring + templates (J + M), **(5)** measurement + docs (N + F + B), **(6)** phase-2 items — clean-room rerun and escalation custody (E + H-L3). Fixed engineering disciplines cut across all phases: dismissed filtering must be pushed **into SQL on every read path** (post-fetch filtering leaks through counts/totals — this is the classic tenant-filter leak shape), every fact mutation must bump `content_version` **in the same UPDATE**, the three new tables each need **two-point archive wiring** (snapshot array + restore loop) guarded by a round-trip test harness built *before* the first table, K is a **new reviewer channel** reusing judge infrastructure but never the intercept rule table (`preToolUse` doesn't fire on tool-less planner rounds — code-verified), and `WriteCounts.Intents` is a **hidden prerequisite** for H-L2 (the milestone's only engine-facing signature change).

The highest risks are **doc-external** and all have cheap, sequenced mitigations that must become phase success criteria: (1) the "never refuse" discipline creates a **fabrication cliff** — models stop refusing and start fabricating confident false results, mitigated by an escape-hatch sentence shipped in the *same commit* as the discipline text; (2) degrade-first converts fact pollution into **intent pollution** (frontier flooded with recheck intents) — mitigated by a task-level degraded-fact monitor that N makes observable; (3) judge **fail-open composes into a silent kill switch** (dead profile → every suspicious round classified "allow") — mitigated by a three-state verdict, raw-output logging, and a per-task call budget; (4) authorization **expiry creates a silent deny wall** — mitigated by a mid-task expiry acceptance test and deny-table-before-judge ordering; (5) **archive/restore wiring omissions** silently destroy the governance guarantees — mitigated by a table-driven round-trip test. None of these require new scope; all require the roadmap to place the test *with* the code.

## Key Findings

### Recommended Stack

**Zero new external dependencies — deliberately.** The milestone lands in Go stdlib + existing pgx/norma + the existing Next.js frontend. Resist any temptation to add a rules engine, vector store, moderation service, or migration tool; each adds an ops surface the single-binary design exists to avoid.

**Core technologies (fixed — do not re-litigate):**
- **Go 1.26.3** — all governance logic (keyword classifiers, triage, judge plumbing, audit job); 264-route stdlib `http.ServeMux` precedent
- **norma v0.4.3** — agent runtime; `ExecuteWithMessage` resume path is the H-L2 corrective-retry vehicle; no norma API change required
- **PostgreSQL + pgx 5.10.0** — 3 new tables (`governance_log`, `task_authorizations`, audit results) via embedded idempotent `schema.sql`; independent-table decision is load-bearing (never columns on `tasks` — `json_populate_record` archive-restore drift)
- **Next.js static export + React 19 + shadcn/ui + @antv/g6** — fact dismiss/delete/edit buttons, "show dismissed" toggle, authorization form, audit card; pure additions, static-export safe

**Reuse map (verified in code):** reseed pattern (`orchestration.go:581–672`) for 6 agents; reporter one-shot migration; retester refresh **inside** advisory lock `7337741010` (`finding_retests.go:202–240`); judge infra (`intercept.go:429 Judge()`, fail-action `:316`) for K; scheduler watermark (`scheduler.go:30–58`) for N; `finding_cases` paradigm for audit tables; `task_constraints` paradigm for `task_authorizations`; `content_version`/`blockSignature` for cache coherence; `ExecuteWithMessage` for corrective retry. **pentest and auto agents have NO existing reseed path — two new functions needed.**

**Banned approaches (each code-verified as a planted bug):** never copy `UpdateGoalPayload` (no `content_version` bump — edited refusal text survives in cached digests forever); never bare "拒绝" in the keyword set ("connection refused"/"403 拒绝访问" are the dominant legitimate observations); never engine-side `HasActiveIntent()` as the produced-intents signal (needs `WriteCounts.Intents`); never guard/`preToolUse` as the fact-write interception point (fact writes are internal tool-handler mutations, not tool calls).

### Expected Features

**Must have (table stakes — all covered by the doc):** write-path screening of agent memory writes (D/L, domain-tuned beyond generic products); operator cleanup UI with soft-dismiss-as-tombstone + hard delete + edit (C); dismissed content hidden from the model side on **every** read path (Q1 — the doc exceeds typical implementations here); governance audit log surviving archival (Q2, independent table); authorization as first-class queryable data with fail-safe expiry (J — matches XBOW's checklist line-for-line); refusal-rate baseline metric queried from raw DB (N); bounded machine retry-with-correction (H-L2); escalation to human (H-L3); fail-open classifier + cost throttling (K); detection-to-remediation deep links (N→C); authorization templates (M); prompt discipline across all 8 agents with brownfield reseed migration (A+I).

**Should have (differentiators):** degrade-first disposition (novel middle between allow and block — converts contamination into weak-evidence re-verification work instead of dead-ends); dismissal-immune metrics methodology; clean-room rerun with `derived_from` lineage (E); restart-surviving failure counters via activity backfill; `prove_goal` evidence screening (a refusal fact cited as evidence would close a goal — worse than planner contamination).

**Defer (v1.x / v2+):** keyword-set tuning loop and cross-task trend dashboard (v1.x — data plane already lands in the right tables); quarantine disposition, tamper-evident audit records, graph snapshots/rollback, worker-round classification (v2+). **Hard v1 exclusions (risk-driven):** batch dismiss UI, user-editable keyword sets (injection surface), agent-side deletion tools (doc §5.1.5 ban — keep banned), auto-dismiss automation (converts audit into an unreviewed write path).

### Architecture Approach

Eight-layer defense-in-depth mapped onto the existing Go package structure: L0 authorization/templates → L1 prompt discipline → L2 write-time interception at tool entry (`recordOneFact`) → L3 planner behavioral triage → L4 fact CRUD storage → L5 read-path visibility filter → L6 guard context → L7 measurement. New code lands in existing packages (`agent/refusal.go` is the only new backend file besides the three db table files + `planner_classifier.go`), respecting the cmd → server → {agent, guard, intercept} → db dependency rule. Industry corroboration (MEDIUM, pattern-level): execution-layer guardrails catch what prompts miss; prompt discipline alone is the weakest layer (instruction dilution is a HIGH-consistency finding); read-path filtering is the necessary complement for pre-existing (存量) pollution.

**Major components:**
1. **`refusalMarkers` + `looksLikeRefusal`** — single shared self-referential keyword set (Q3); consumed by D (reject), L (degrade), and `prove_goal` evidence check; code-owned, kill-switch flag from day one
2. **Fact CRUD + dismissed filter** — kind-locked DELETE/PATCH/Dismiss with `content_version` bump in the same UPDATE; the dismissed predicate composed from one shared SQL helper across **six-plus** read paths (list, source-merge, `relatedTaskOverviews`, `graph_overview` direct read, cold-digest, `GetNode` placeholder — plus `q=` search and digest bodies per pitfalls research)
3. **Three independent tables with two-point archive wiring** — `governance_log`, `task_authorizations`, audit results; each registered in the snapshot array AND restore loop, enforced by a table-driven round-trip test
4. **Planner triage + `ClassifyPlannerRound`** — deterministic statistical gate first (0 new intents ∧ ¬GoalMet ∧ frontier/running empty), task-level throttle (10 min), three-state verdict, fail-open, llmrec ledger; **not** the intercept rule table
5. **Authorization stack** — `task_authorizations` table → `get_authorization` read-only tool → guard `WithReviewContext` extension (touches locked tests; ~0.5 day, not "one field") → expiry fail-safe deny with pre/post activity notices

### Critical Pitfalls (doc-external)

1. **Fabrication cliff (Pitfall 1, CRITICAL)** — "never refuse" discipline causes a binary collapse into fabricated confident results (78,631-eval study: one escape-hatch sentence recovers +15.6pp). A worker that refuses writes one polluted fact; a worker that fabricates writes false *findings*. **Fix:** escape-hatch sentence ships in the same commit as the discipline sections; acceptance test = broken-target task ends with honest failed records, zero fabricated successes.
2. **Frontier flooding via degrade-first (Pitfall 4, CRITICAL)** — per-batch counting means a one-refusal-per-call model never escalates; every degraded fact spawns a recheck intent → the planner plans around a flooded frontier. **Fix:** task-level degraded-fact rate monitor (implemented in D/L batch, observable via N); track recheck-intent rate as a first-class metric.
3. **Judge fail-open kill switch (Pitfall 6, CRITICAL)** — dead judge profile + fail-open + counter-reset-on-restart = H-L2 silently inert while operators believe the hard line is active. **Fix:** three-state verdict (`refusal|normal|assess_failed`), raw-output logging on parse failure, startup profile validation, per-task call budget, activity-backfill counter recovery.
4. **Silent deny wall on authorization expiry (Pitfall 7, CRITICAL)** — `valid_until` passes mid-task; guard denies everything; the task grinds at 100% deny with zero state change. Plus credential weight-lifting: the judge may resolve priority conflicts in favor of the "authoritative" credential over deterministic deny rules. **Fix:** expiry-transition acceptance test (live task straddles `valid_until`); deny-table evaluates before the judge; precedence sentence ships with the wiring; consider auto-pause.
5. **Dismissed leaks beyond the doc's path list (Pitfall 3, CRITICAL)** — `q=` ILIKE search, `facts_total` 1000-cap window distortion, digest *bodies* quoting patched text, cited-evidence dangling (met goal citing a later-dismissed fact). **Fix:** shared SQL predicate helper + table-driven leak-matrix tests; agent paths structurally unable to pass `include_dismissed`; dismiss-with-citations warns the operator.

Also load-bearing: **archive/restore round-trip harness must be built before the first new table** (Pitfall 8 — two hand-maintained table lists, no compiler forcing consistency); **discipline decay** in long sessions (Pitfall 2 — per-round re-injection of the one-liner, H-L2 stats as the detector); **keyword FP classes** third-person English ("refuse to") and quoted target content (Pitfall 5 — restrict/drop, document as known FP class, kill-switch flag).

## Implications for Roadmap

Six phases, mirroring the doc's §17/§20 batch order — all four research files independently derived the same order from dependencies. **Do not split the six-path filtering, the D/L keyword helper, or H-L2/K across phases.**

### Phase 1: Prompt Discipline & Reseed (A + I + H-L1)
**Rationale:** Source-level suppression is the cheapest layer and de-risks everything downstream; every later phase's prompt copy references this text; no schema, no API — pure reuse of the reseed machinery.
**Delivers:** Unified discipline section across all 8 agents (incl. new reseed paths for pentest/auto), table-driven reseed loop with per-agent flags, reporter one-shot migration, retester refresh inside advisory lock `7337741010`, per-round re-injection line (following `planner.go:461` precedent), narrowed "旧模型误报" line (Pitfall 14, prompt-half).
**Addresses:** A+I+H-L1 (FEATURES P1); **Avoids:** Pitfall 1 (escape hatch **same commit**), Pitfall 2 (re-injection wording), Pitfall 9 (four-DB-state migration matrix: fresh / stock / user-modified / modified-then-reset), Pitfall 11 (advisory-lock discipline), Pitfall 14.
**Must ship together:** discipline sections + escape-hatch sentence + honest-failure wording.

### Phase 2: Graph Governance — Cleanup, Intercept, Hiding (C + Q1 + D/L + governance_log)
**Rationale:** One batch owns Risks 1+2+3 (leak class, archive asymmetry, cache invalidation) because the keyword helper, `governance_log`, and the fact-CRUD paths share files; H-L2 touches the same `agent/tools.go` — landing this first avoids merge contention.
**Delivers:** `refusalMarkers` helper (single definition, kill-switch flag) → `recordOneFact` L/D branch (degrade-first, ≥2-in-batch reject) + `prove_goal` evidence screening → fact DELETE/PATCH/Dismiss with `content_version` bump in the same UPDATE → dismissed predicate in-SQL on **all** read paths → `governance_log` + two-point archive wiring → UI actions/toggle → **archive/restore round-trip test harness built FIRST**.
**Addresses:** C, Q1, D/L, Q2, Q3, Q13; **Avoids:** Pitfall 3 (leak-matrix tests incl. `q=`, window distortion, digest bodies, cited-evidence warning), Pitfall 4 (task-level degraded-fact monitor logic lands here), Pitfall 5 (third-person English exclusion decision; quoted-content FP class), Pitfall 8 (harness before table).
**Must ship together:** keyword helper + kill switch + first consumer; `UpdateFactPayload` + version bump + signature-change test.

### Phase 3: Planner Hard-Line — Triage + Judge (H-L2 + K, same PR)
**Rationale:** K consumes H-L2's triage preconditions (Q12 — same PR); requires Phase 2's same-file changes landed. `WriteCounts.Intents` is the hidden prerequisite (doc §10.2) and the milestone's only `Plan()`/engine signature ripple.
**Delivers:** `WriteCounts.Intents` + `addOneIntent` increment + `Plan()` return extension → post-`Plan()` triage gate → one corrective retry via `ExecuteWithMessage` → `ClassifyPlannerRound` (judge infra reuse, new template, llmrec ledger) with **three-state verdict**, raw-output logging, task-level throttle (10 min) + per-task call budget, startup profile validation → consecutive-failure counter with activity-backfill restart recovery.
**Addresses:** H-L2, K, Q8, Q12; **Avoids:** Pitfall 6 (three-state verdict in same PR, not follow-up), Pitfall 2 (H-L2 stats double as the decay detector), Pitfall 10 (corrective-message accumulation — verify `ExecuteWithMessage` transcript semantics during planning; detect compliance-theater intents).
**Must ship together:** `WriteCounts.Intents` + triage (without it, 0-new-intent detection is vacuous).

### Phase 4: Authorization & Templates (J + M)
**Rationale:** J depends on Phase 1's reseeded prompt text (the "凭据不减损 deny 约束" addendum rides the existing discipline section, no second reseed); M **sync-fills J's credential fields**, so M lands with or after J — never before.
**Delivers:** `task_authorizations` table (mirrors `task_constraints`) + two-point archive wiring + round-trip test extension → `get_authorization` read-only tool (readExpTool pattern, default-bound to 4 agents) → guard `WithReviewContext` Authorization attachment (locked tests updated in same change; `user_message`-only source gate NOT loosened) → expiry fail-safe deny + pre/post activity notices (+ consider auto-pause) → judge-prompt precedence sentence → M: 3–5 scenario templates, one-click sync-fill of description + constraints + credentials, operator-stop-record guidance (Pitfall 14, template-half).
**Addresses:** J, M, Q11; **Avoids:** Pitfall 7 (expiry-transition acceptance test is **non-negotiable**; deny-table-before-judge ordering; credential scoped strictly by task id), Pitfall 8 (third table wiring).
**Must ship together:** guard wiring + precedence sentence + expiry test (wiring without semantics is the risky half).

### Phase 5: Measurement & Docs (N + F + B)
**Rationale:** N measures layers 1–4 — it is meaningful only after L's note markers, H-L2's activity lines, and K's verdicts exist. Trivial (~1 day) only if earlier batches emitted the markers as specified. Closes the loop: audit card deep-links into Phase 2's cleanup actions.
**Delivers:** Watermark audit job (new `schedKey`, terminal-task scan, not in `SetTaskStatus`) + audit-result table (+ archive wiring) with `UNIQUE(task_id)` upsert + watermark advance in same transaction → raw-DB data plane (dismissal-immune; never through `ListByKind`) → re-run = revision-append → report card + task-detail card with `governance_log` dimensions (deletes/dismisses per task) + degraded-fact rate + recheck-intent rate (Pitfall 4 observability) + `assess_failed` ratio → F triage docs (incl. quoted-content FP class, judge-profile location) + B authorization SOP + first-run watermark skip documented.
**Addresses:** N, F, B, Q5; **Avoids:** Pitfall 12 (watermark skip/dupes), Pitfall 13 (baseline self-flattering — hard-delete timing), Risk 7 (measurement drift).
**Must ship together:** `UNIQUE(task_id)` + transactional watermark advance; report + governance_log dimensions.

### Phase 6 (v1 phase-2 slice): Clean-Room Rerun & Escalation (E + H-L3)
**Rationale:** User-pinned into v1 (Q4/Q7 override). E is the **only** engine-claim-logic change in the milestone — schedule strictly after C/H-L2 are stable. G's hint remediation retires when these land.
**Delivers:** E: fresh-intent rerun with `derived_from` edge; terminal refused intents via cancel path **or** new `blocked_reason` skip-claim filter in `Frontier`/`ClaimIntent` (verified: neither exists today; `SoftDeleteIntent` rejects terminal states — new behavior, not a flag) → H-L3: N=3 failures → hint custody, M=2 more → operator alert, counters recovered from activity on restart, composing only existing hint/activity/notify channels.
**Addresses:** E, H-L3; **Avoids:** Risk 6 (frontier/claim-filter gap — plan both the filter and the terminal-intent disposition; don't assume existing functions suffice).

### Phase Ordering Rationale

- **Dependencies force the order:** prompts → (keyword helper + governance_log) → (WriteCounts.Intents → triage → judge) → (authorization rides reseeded prompts; templates need the table) → measurement last (needs all upstream data markers).
- **Shared-file contention:** C/D/L and H-L2 both touch `agent/tools.go` — batch 2 before batch 3 avoids churn; J's guard work stays off both.
- **Same-PR locks from the doc:** H-L2+K (Q12), M with/after J (credential sync-fill), archive wiring per-table in the same commit as the table.
- **Risk ownership:** Phase 2 owns Risks 1/2/3; Phase 3 owns Risk 5; Phase 4 owns Risk 8; each risk's acceptance test lands in its phase.

### Pitfall-driven Acceptance Requirements

Doc-external acceptance criteria surfaced by research — **the roadmapper must map each into the owning phase's success criteria; losing any of these recreates a critical failure mode:**

1. **Escape-hatch sentence same-commit rule** (Pitfall 1 → Phase 1): the honest-failure escape hatch ships in the *same commit* as the discipline sections, never later. Acceptance: a task on a deliberately broken target ends with honest failed/inconclusive records and **zero fabricated successes**; retester never reports `reproduced` without a re-triggered PoC.
2. **Archive/restore round-trip harness before first table** (Pitfall 8 → Phase 2, extended in 4 and 5): a table-driven archive→restore round-trip test exists **before** `governance_log` is added; iterate the snapshot array asserting every table has a restore branch; each new table extends the harness in the same commit; expired credential after restore denies **visibly**.
3. **Frontier-flood monitor** (Pitfall 4 → Phase 2 implements, Phase 5 observes): task-level degraded-fact rate monitor (N degraded facts within M minutes → activity alert / task-level escalation to reject semantics); N reports track degraded-fact rate and **recheck-intent rate** as first-class metrics — a recheck-intent spike is the early-warning signature.
4. **Three-state judge verdict** (Pitfall 6 → Phase 3, same PR): `refusal|normal|assess_failed` — a parse/infra failure must **never** silently emit `normal`; raw judge output logged on parse failure; startup validation that `planner_refusal_check`'s profile resolves; per-task classifier call budget as cost circuit-breaker; `assess_failed` ratio surfaced in N's report.
5. **Expiry-transition test** (Pitfall 7 → Phase 4, non-negotiable): a live task straddling `valid_until` mid-run must flip guard decisions and must **not** silently burn rounds at 100% deny; deterministic deny-table evaluates **before** the judge sees anything; the judge-prompt precedence sentence (deny > credential) ships with the wiring; the `user_message`-only `ReviewBackground` source gate is not loosened.
6. **In-SQL filtering gates** (Risk 1 / Pitfall 3 → Phase 2): the dismissed predicate is pushed **into every SQL read** — no post-fetch filtering anywhere (post-fetch leaks through `total`/`hasMore`/counts and distorts the 1000-fact window). Leak-matrix table-driven tests over all surfaces: list page, `GetNode` single-read placeholder, `graph_overview` counts AND `recent_facts`, source-merge inherited pages, `relatedTaskOverviews`, cold-digest members AND digest bodies, `q=` ILIKE search; agent tool paths **structurally unable** to pass `include_dismissed` (not by convention); dismiss-with-cited-evidence warns the operator.
7. **WriteCounts.Intents prerequisite** (§10.2 / sequencing constraint → Phase 3 gate): H-L2's triage PR does not proceed without `WriteCounts.Intents` landing first — `HasActiveIntent()` conflates pre-existing open intents with this round's output and makes the 0-new-intent gate vacuous.
8. **Keyword helper + kill switch same commit as first consumer** (Pitfall 5 / constraint 1 → Phase 2): shared helper imported by both D/L and `prove_goal`; kill-switch settings flag flips behavior at runtime without redeploy; "server refuses to respond"-style third-person summaries must NOT degrade (acceptance 2b extended case).

### Research Flags

Phases likely needing deeper research during planning (`/gsd-plan-phase --research-phase`):
- **Phase 3 (H-L2 + K):** `Plan()` signature ripple into engine call sites needs a call-site inventory; `ExecuteWithMessage` transcript-persistence semantics are MEDIUM-confidence (Pitfall 10) and must be verified against norma behavior before designing corrective-message handling.
- **Phase 6 (E + H-L3):** E is genuinely new engine behavior — terminal-intent disposition choice (cancel vs blocked_reason skip-claim) is an open design decision; claim-filter semantics need a focused pass.

Phases with standard patterns (skip research-phase):
- **Phase 1:** reseed/migration machinery mapped to line numbers (`orchestration.go:581–672`, `:713–742`, `finding_retests.go:202–240`); pattern is copy-the-precedent.
- **Phase 2:** every seam verified (`task_constraints`, `finding_cases`, `SetNodeState` precedents); risk is test discipline, not discovery.
- **Phase 4:** guard wiring shape documented (extend via `WithReviewContext`, update locked tests) — documented risk, no open questions.
- **Phase 5:** watermark + `finding_cases` patterns; ~1 day of plumbing.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Every reuse claim verified in-repo with line numbers; industry validation HIGH (instruction hierarchy, OWASP APTS, over-refusal literature) |
| Features | MEDIUM-HIGH | ASI06/XBOW/NIST verified against primary sources; governance-platform table stakes from corroborated vendor analyses; note: gsd-tools seam was unavailable in the research environment (no Node binary) — providers used directly via websearch |
| Architecture | HIGH | All constraints verified against ARTEX source; industry corroboration MEDIUM (pattern-level) |
| Pitfalls | HIGH | All code-path claims read and verified in this repo; external failure-mode research (fabrication cliff, judge masking, soft-delete leaks) MEDIUM-HIGH |

**Overall confidence:** HIGH — this is brownfield work with a finalized design doc, a verified stack, and code-mapped seams. Residual uncertainty is concentrated in three implementation-time verifications, not in the plan's shape.

### Gaps to Address

- **`ExecuteWithMessage` transcript persistence semantics** (Pitfall 10, MEDIUM confidence): do corrective messages accumulate in planner context across rounds? Verify during Phase 3 planning; design message-marking/stripping accordingly.
- **English keyword coverage decision** (Pitfall 5): restrict `"refuse to"` to first-person collocations or drop it (doc declares 中文为主 — make it true). Decide in Phase 2; document as accepted under-coverage if dropped.
- **Auto-pause on authorization expiry** (Pitfall 7): whether guard expiry also pauses the task (vs. notices only) is a policy decision — make it in Phase 4 planning; the expiry test covers either choice.
- **E's terminal-intent disposition** (Risk 6): cancel path vs. `blocked_reason` skip-claim — open design choice for Phase 6 planning.
- **`StorePromptSource`-style provenance marker** (Pitfall 9): exact-match "user modified?" detection is brittle to whitespace; a provenance marker is the structural fix but adds schema — decide accept-vs-fix in Phase 1.
- **v1.x backlog items** (keyword tuning loop, cross-task trend view): data planes already land correctly; promote to a milestone when first triggered (first FP complaint / first model-comparison need).

## Sources

### Primary (HIGH confidence)
- `docs/拒止污染治理方案.md` — finalized design (solutions A–N, Q1–Q15, §17 batches, §19 acceptance, §20 order, §21 rollback) — authoritative for scope
- ARTEX codebase verification (this session): `go.mod`; `agent/tools.go` (WriteCounts:143, recordOneFact:1312–1351, proveGoal:1176–1202, graph_overview:445, relatedTaskOverviews:661–684); `agent/coldgraph.go` (blockSignature:285); `db/exploration.go` (SetNodeState:269, UpdateGoalPayload:276, Frontier:1141/ClaimIntent:1175); `db/exploration_sources.go:135–148`; `db/schema.sql` (dismissed states:189/234, content_version:201, task_constraints:287–296); `db/task_archives.go:578–600` / `task_archives_restore.go:245,313–329`; `intercept/intercept.go:308–316,429`; `intercept/review_context.go` + locked tests; `server/orchestration.go:581–672,713–742`; `server/finding_retests.go:202–240`; `server/scheduler.go:30–58`; `server/engine.go:137–172,771,978–1022`; `server/intent_intervention.go:31–34`; `guard/guard.go`
- OWASP Top 10 for Agentic Applications 2026 — ASI06 Memory & Context Poisoning, five-layer control set; OWASP Agent Memory Guard reference implementation
- XBOW governance framework for AI-driven pentesting (May 2026, fetched in full); NIST CSRC RoE definition
- OpenAI instruction hierarchy (arXiv:2404.13208; IH-Challenge 2025); Microsoft spotlighting / NIST AI 100-2 E2025
- PostgreSQL official docs ch.13 (advisory locks) — retester lock containment
- Over-refusal literature: XSTest (NAACL 2024), OR-Bench 2024, FalseReject (arXiv 2505.08054)

### Secondary (MEDIUM-HIGH / MEDIUM confidence)
- "Schema-Compliance-Trap" study (78,631 evals, 11 models) — fabrication cliff + one-line escape-hatch fix
- Lost in the Middle (Liu et al., TACL 2024) + 2026 attention-decay studies — discipline decay in long sessions
- 99Ravens red-team postmortem; "competing instructions overload"; arXiv 2608.27299 — credential weight-lifting risk
- LLM-judge production guidance (Patronus, Monte Carlo, DeepEval; Arize/Maxim/Galileo judge-failure modes; autorubric PR #6; FlowVerify/PerkinsLab 2026) — binary labels, fail-open masking, raw-output retention, cost circuit breakers
- Agent memory governance (Microsoft Foundry memory-poisoning defense 2025); multi-tenant filtering-leak literature (Kinetic Edge; OWASP Multi-Tenant Cheat Sheet) — in-SQL filtering, leak matrices
- Soft-delete leak research (qaskills.sh, safeguard.sh, voxire.com 2026) — residual leak paths
- Pentest agent failure baselines (AutoPenBench EMNLP 2025, CheckMate, PentestEval) — empty-progress loop context
- Defense-in-depth guardrail placement (Traversaal, Arthur AI, Frontier Model Forum 2025) — layer stacking corroboration

### Tertiary (LOW confidence — directional only, not load-bearing)
- Context-quarantine as named multi-agent pattern (engineering blog analyses)
- Vendor human-oversight checklists (sweet.security, cortexrizi.com)

---
*Research completed: 2026-10-10*
*Ready for roadmap: yes*
