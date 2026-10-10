# Stack Research

**Domain:** AI agent behavioral governance (refusal & record contamination control) on a brownfield Go pentest platform
**Researched:** 2026-10-10
**Confidence:** HIGH (stack is fixed and verified against code; external best-practice claims HIGH/MEDIUM as marked)

---

## Executive Orientation

ARTEX's refusal-contamination milestone is a **governance feature on an existing, well-understood stack** — not a greenfield technology selection. Every technical vehicle the finalized design doc (`docs/拒止污染治理方案.md`) requires already has a working precedent in the codebase: prompt reseeding, LLM-judge infrastructure, watermark scheduler jobs, independent audit tables, `content_version` cache invalidation, and schema-reserved `dismissed` state. The stack question is therefore not "what to use" but **"reuse which existing subsystem vs. build which new seam"** — and 2025–2026 industry practice independently validates the doc's design choices (instruction hierarchy, write-time guardrails, insert-only audit tables, fail-open LLM-as-judge with throttling).

**Zero new external dependencies are required.** The entire milestone lands in Go stdlib + existing pgx/norma usage + the existing Next.js frontend. This is a deliberate finding: resist any roadmap temptation to add a rules engine, a vector store, or a separate moderation service.

---

## Recommended Stack

### Core Technologies (fixed — do not re-litigate)

| Technology | Version (verified in repo) | Purpose in This Milestone | Why It Stays |
|------------|---------------------------|---------------------------|--------------|
| Go | 1.26.3 (`go.mod`) | All governance logic: keyword classifiers, refusal triage, judge plumbing, scheduler audit job | Single-binary deployment constraint; stdlib `http.ServeMux` route style already hosts 264 routes |
| norma harness | v0.4.3 (`github.com/Autumn-27/norma`) | Agent runtime for all 8 agents; `ExecuteWithMessage` resume path reused by H-layer-2 corrective retry | The prompt-seeding/reseed pattern is built on it; swapping agent frameworks mid-milestone is a rewrite |
| PostgreSQL + pgx/v5 | pgx 5.10.0; schema via embedded `db/schema.sql` (58 tables, idempotent `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... IF NOT EXISTS`) | New tables `governance_log`, `task_authorizations`; `dismissed` state; `content_version` bumps | Schema is already versioned in-file with ALTER guards; adding tables follows `task_constraints`/`finding_cases` precedent exactly |
| Next.js (static export) + React 19 + shadcn/ui | web/package.json 2.2.0; `NEXT_EXPORT=1 next build`; graph viz @antv/g6 ^5.1.1 | Fact dismiss/delete/edit buttons in `NodeDetailSheet` (`exploration-graph.tsx`); "show dismissed" toggle; refusal-audit card; task-authorization form | UI changes are pure additions to existing components; no new frontend deps needed (dialog/textarea/select all present in shadcn set) |

### Existing Infrastructure to REUSE (verified present in code)

| Infrastructure | Verified Location | Reused By (design doc) | Notes |
|----------------|-------------------|------------------------|-------|
| Prompt seed catalog + reseed pattern | `agent/promptcatalog.go` `BuiltinPromptSeeds()` (:113); `server/orchestration.go` `reseedGoalsPrompt`/`reseedMainAgentPrompt`/`reseedPlannerPrompt`/`reseedWorkerPrompt` (:581–672) | A, H-layer-1, I | Copy `reseedWorkerPrompt` shape per agent + settings flag bump; `ResetPromptToDefault` appends version, never overwrites → built-in rollback. **pentest and auto have NO existing reseed — two new functions needed** (doc Q6/Q9 verified) |
| Reporter/retester one-shot migration pattern | `upgradeReporterTriggerMessage` (`orchestration.go:713–742`); retester seeds inside advisory lock `7337741010` (`server/finding_retests.go:202–240`) | I | Retester prompt refresh **must be placed inside `seedFindingRetester`'s existing advisory-lock transaction** — a separate settings-flag migration would race the lock. This is the single trickiest reuse in the milestone |
| Guard (PreToolUse hook) | `guard/guard.go` | D/L (fact-write interception is a sibling seam, not the same hook), J (authorization context) | Note: `recordOneFact` interception happens inside the tool handler (`agent/tools.go:1317`), NOT via guard — guard reviews user-visible tool calls; fact writes are internal graph mutations. Do not conflate the two seams |
| LLM judge infra (provider resolution, verdict JSON parsing, llmrec ledger, fail-action) | `intercept/intercept.go` `Judge()` (:429), `defaultJudgeFailAction = "allow"` (:316), settings key `llm_judge_fail_action` (:308); prompt templates in `intercept/prompt.go` | K (planner-round refusal classifier) | **Reuse the infrastructure, NOT the rule table.** `preToolUse` never fires on a no-tool planner round, so K is a parallel lightweight reviewer channel (`ClassifyPlannerRound → refusal|normal`) — the doc's §14.2 analysis is code-verified correct |
| Scheduler watermark pattern | `server/scheduler.go:30–58` (`schedKeyLastFinding` etc., 5s tick, restart-safe) | N (audit job) | New `schedKeyLastAuditedTask` watermark; scan `status IN ('done','timeout')`. No re-scan branch (watermark semantics already dedupe) |
| Independent audit-table paradigm | `finding_cases` table (survives archive; activity tables are DELETEd with `exploration_id` on archive per `task_archives.go`) | Q2 (`governance_log`), N (audit results table) | Audit-in-`activity` would vanish on archive — the doc's Q2 decision matches industry best practice (insert-only, separate audit table; see Sources) |
| `content_version` cache invalidation | `db/schema.sql:201`; `agent/coldgraph.go:285` `blockSignature` covers summary/state/confidence | C (fact edit/dismiss), L (downgrade write) | Cold-digest invalidation works for free **only if** new write paths bump `content_version` (see Gotchas) |
| Reserved `dismissed` state | `db/schema.sql:189, 234` (`state IN ('confirmed','dismissed','origin')` for facts) — never yet used | C (soft-dismiss), Q1 (agent-side filtering) | Schema work already done; the build is filtering + API + UI |
| `task_constraints` table pattern | `db/schema.sql:287–296` (`allow/deny` CHECK, per-exploration FK) | J (`task_authorizations` clones this shape) | Independent table per doc §12.2.1 — do NOT add columns to `tasks` (archive/restore `json_populate_record` schema-drift hazard, verified: `task_archives_restore.go:313–329`) |
| Corrective-message resume mechanism | `ExecuteWithMessage` (`server/engine.go:978,1022`; `server/intent_intervention.go:31`) | H-layer-2 (one retry with fixed corrective user message) | Existing worker path; planner side reuses the same mechanism — no new engine machinery |
| Existing hint / activity / notify channels | engine hints, exploration activity, broadcast/notify | H-layer-3 (phase 2), N (operator alerting) | Third layer deliberately composes only these three — no new state machine |
| `exploration/nodes` `kind`+`q` filter API | `server/server.go:806`; ILIKE over full payload (`db/exploration.go:883–890`) | C (locate contaminated records) | `q` is full-payload ILIKE → false hits expected; optional `SummaryOnly` on `NodeFilter` is a one-line enhancement |

### New Build Required (no existing precedent — code-verified absent)

| Component | Design Doc | What's New | Effort Signal |
|-----------|-----------|------------|---------------|
| `task_authorizations` table + archive/restore wiring | J | Two new table rows in snapshot array (`task_archives.go:~583`) and restore loop (`task_archives_restore.go:~245`) | ~1–1.5 days incl. tool + guard wiring |
| `get_authorization` read-only tool | J | New read tool, patterned on `list_facts` readExpTool (~40 lines); default-bind to worker/planner/pentest/mainagent | included above |
| Guard `ReviewBackground` authorization attachment | J | Extending `intercept/review_context.go:16–20` struct or a `WithReviewContext` attachment field; touches `BuildReviewInput` selection logic + its locked tests (`review_context_test.go:62–81` currently rejects non-`user_message` sources) | ~0.5 day alone — **not** "add a field" |
| `refusalMarkers` self-referential keyword set + `looksLikeRefusal` helper | D/L (Q3) | Shared helper at `agent/tools.go:~1312` (`recordOneFact` post-summary-validation); **bare "拒绝/refused" is banned from the set** — "connection refused"/"403 拒绝访问" are high-frequency legitimate negative observations | <20 lines core; proves within same batch for L's ≥2 escalation |
| Confidence downgrade write path | L | On first keyword hit: rewrite `confidence='inferred'` + payload note, replace `"confirmed"` literal at `tools.go:1342` | folds into D implementation |
| `prove_goal` evidence screening | D | Same keyword helper applied to evidence facts at `tools.go:1176–1202` — a refusal fact used as evidence marks a goal met, worse than planner contamination | small |
| `WriteCounts.Intents` + `Plan()` return extension | H-2 | `WriteCounts` (`agent/tools.go:143`) currently has no Intents; `addOneIntent` must increment; `Plan()` signature grows — ripples to engine call sites | the main API-surface change of the milestone |
| Refusal triage + corrective retry + loss-counter | H-2 | Post-`Plan()` triage (0 new intents ∧ ¬GoalMet ∧ unmet goals exist ∧ frontier/running empty), one `ExecuteWithMessage` retry, activity log, counter persisted via activity replay on restart (doc §10.2 final revision) | ~1 day with K |
| `ClassifyPlannerRound` judge channel + throttle | K | New `planner_refusal_check` template (per `intercept/prompt.go` pattern), task-level throttle (settings, ~10 min), fail-open per `llm_judge_fail_action` | ~1 day; cheapest with H-2 in same PR |
| `governance_log` table + archive wiring | Q2 | `finding_cases`-shaped table: `id/task_id/node_id/action/detail/operator/created_at` | folds into C batch |
| Fact DELETE/PATCH API + `UpdateFactPayload` | C | `DELETE /api/exploration/facts/{id}`, `PATCH .../facts/{id}` (state/summary/detail), all SQL carrying `AND kind='fact'` | ~1–1.5 days with UI |
| Dismissed-fact read-path filtering | Q1 | Must cover **all six** read paths: `listByKindPageFiltered`, source-merge branch (`db/exploration_sources.go:135–148`), `relatedTaskOverviews` (`agent/tools.go:661–684`), cold-digest visibility, `graph_overview` direct read (`tools.go:445`), `GetNode` single-read (placeholder response) | the most leak-prone item; `include_dismissed` param on 3 endpoints, agent-side calls never pass it |
| Refusal-baseline audit job + report | N | Watermark job + results table + read-only API + task-detail card, drill-down to C's dismiss/delete | ~1 day |
| Task-description templates + authorization form | M, J-UI | Constant table (patterned on `builtinAgents`, `db/db.go:191`) + new-task dropdown; authz form deferrable per Q11 | ~half day |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| *None new — intentionally* | — | — | Every need is met by stdlib (`strings.Contains` classifier, `encoding/json` payload rewrite, `time` throttle), pgx, and existing in-repo packages. A regex or NLP dep for refusal classification is over-engineering: the Q3 self-referential keyword set is deliberately conservative and human-tunable |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `go test` (existing suite) | Unit tests patterned on `finding_cases_test.go` (delete-cascade) and `review_context_test.go` (input-selection locks) | Every reuse seam named above already has a test file to extend |
| Biome (`web`: lint/format/check) | Frontend changes | Existing husky pre-commit; no new tooling |
| Embedded schema.sql + ALTER IF NOT EXISTS | Schema migration | No migration framework in repo; idempotent-DDL is the house pattern — new tables follow it, never a migration tool |

---

## Research Findings Mapped to the Four Questions (2025–2026 practice validation)

### 1. Prompt-injection-of-behavioral-discipline (doc A/H-1/I)

Industry validation: **HIGH confidence** — the doc's three-layer priority arbitration (`deny constraints > authorization credentials > execution discipline`) is a faithful application of OpenAI's instruction-hierarchy model (system > developer > user > tool; arXiv:2404.13208, extended by IH-Challenge 2025) *inverted at the right place*: within ARTEX's own system-prompt text, scoped safety rules (deny) outrank authorization assertions so "I'm authorized" can never be model-replayed to cross scope — the exact failure mode instruction-hierarchy research warns about. Microsoft's spotlighting work (delimiting data vs. instructions; adopted in NIST AI 100-2 E2025 mitigations) supports the companion choice of delivering authorization as **queryable structured data** (`get_authorization`) rather than more prose — evidence beats assertion for models that over-refuse. Layered-section prompt structure (single titled discipline section appended to default prompts, per-role variants) is standard practice in agent harnesses and matches the doc's "统一底稿、按角色裁剪" (§11.2).

### 2. Structured authorization credentials as first-class context (doc J)

Industry validation: **HIGH confidence** — every serious 2025–2026 agentic-pentest framework (XBOW, CAI, HexSec, commercial scanner agents) carries scope/RoE as structured engagement data, and the OWASP APTS standard explicitly requires listing agents and authorized actions in RoE with independent scope validation. The doc's design (independent `task_authorizations` table, `authorizer/valid_until/scope/action_level`, expiry fail-closed to deny, `get_authorization` as read-only retrieval tool feeding guard context) is the textbook shape. The **fail-safe direction matters and is correct**: expired credential → guard deny (with pre/post-expiry activity reminders so a stale template doesn't silently deny everything). This "credential as retrievable fact" pattern also directly answers the over-refusal literature (XSTest/OR-Bench/FalseReject, 2024–2025): models refuse legitimate pentest work chiefly when authorization is invisible or vague — exactly the "模糊授权是模型自行收紧的温床" insight in doc §4.

### 3. Graph contamination: write-time interception vs downgrade vs post-hoc cleanup (doc C/D/L/Q1)

Industry validation: **HIGH confidence** — Microsoft's memory-poisoning guidance (Azure AI Foundry, 2025) and the broader agent-memory-governance literature converge on defense-in-depth: validate what is allowed to persist (write-time), govern what is visible at read time (read-time), and keep an immutable audit trail. The doc's triad maps exactly: L-then-D write-time interception (downgrade-first, reject-on-repeat), Q1 read-path hiding of `dismissed`, `governance_log` audit. The doc's decision that **downgrade (L) is primary, rejection (D) secondary** is the right call against a documented failure mode: hard tool-error rejection loops ("报错重写→再拒→再报错" is a new idle-burn vector), while downgraded facts become `inferred` weak evidence that routes into the existing "negative conclusions spawn re-verification intents" machinery — contamination converted into work, not deadlock. The Q3 self-referential-keyword design (self-statements only, bare "拒绝" banned, compounds-only for 道德/伦理) is validated by over-refusal/false-positive research: naive keyword classifiers on refusals are known to misfire on benign negative observations, which in a pentest domain ("connection refused") are the *dominant* fact type.

### 4. LLM-as-judge for refusal-round detection (doc K)

Industry validation: **MEDIUM-HIGH confidence** — binary LLM-as-judge classification with cheap models is standard production practice (Patronus, Monte Carlo, DeepEval guidance 2025–2026), and the doc's specific engineering constraints match the known production requirements: (a) trigger gating on cheap statistical pre-conditions (0 new intents ∧ frontier/running empty) before spending a model call — judge only when suspicious, at most once per round; (b) task-level throttling (~10 min, settings-configurable) because planner re-wakeup turns per-round judging into continuous token burn — this is the doc's own final-revision addition and it is correct; (c) fail-open (`llm_judge_fail_action`, default `allow` — verified at `intercept/intercept.go:316`) for a *false-positive-costly* classifier: misclassifying a legitimate idle round causes a pointless corrective retry (cheap, self-correcting), while fail-closed misfires compound; (d) do not parse natural language in Go for the terminal decision — send `tsx.Reason` + situational digest to the classifier instead. The doc's honest scoping (§14.2: this is a *new lightweight reviewer channel* reusing judge infra — provider resolution, verdict JSON parsing, llmrec ledger, fail-action — but not the intercept rule table, since `preToolUse` never fires on tool-less rounds) is code-verified correct and should be planned as ~1 day, not half.

---

## Alternatives Considered

| Recommended (per finalized doc) | Alternative | When Alternative Would Be Better |
|--------------------------------|-------------|----------------------------------|
| Reuse judge infra in a new `ClassifyPlannerRound` channel (K) | Add an observe-only intercept rule | Never here — preToolUse doesn't fire on tool-less planner rounds; rule-table `Match(tool, input)` can't express it. Only viable if ARTEX later adds a post-turn hook to norma |
| Downgrade-first (L) with ≥2-per-batch escalation to reject (D) | Reject-only at write time | Reject-only is defensible for a fully-unattended fleet, but the retry-loop idle-burn risk and the loss of "contamination→re-verification work" conversion make L-primary strictly better here |
| Independent tables (`governance_log`, `task_authorizations`) | Columns on `tasks` / rows in `activity` | Columns would ride archive snapshots but break cross-version restore (`json_populate_record` schema drift, verified); activity rows vanish on archive. Independent table is correct unless archive/restore is redesigned first |
| Keyword self-reference classifier (Q3) | Embedding/embedding-similarity refusal detector, or small fine-tuned classifier | Only if measured false-negative rate is high post-launch; requires new infra (no vector store in repo) and contradicts the "human-tunable, auditable" property the operator-facing design depends on |
| Retester prompt refresh inside `seedFindingRetester` advisory lock | Separate settings-flag migration like the other six agents | A separate migration races advisory lock `7337741010`; only viable if retester seeding is refactored first (out of scope) |
| Go stdlib for everything | Adding a rules engine (e.g., expr/cel), moderation API, or migration tool | None justified at this scope; each adds an ops surface the single-binary design exists to avoid |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| New external Go dependencies for classification/rules/migration | Single-binary, stdlib-first architecture; zero requirement gaps verified | stdlib `strings`/`encoding/json` + in-repo `intercept`/`llmpool`/`llmrec` packages |
| Bare "拒绝/refused" in the keyword set | "connection refused" / "403 拒绝访问" are the most common *legitimate* negative pentest observations; bare matching guarantees first-day false positives that poison confidence semantics and spawn junk re-verification intents | Q3 self-referential set (self-statement verbs, compound moral/ethics terms, EN self-statement fallbacks) |
| Copying `UpdateGoalPayload` for `UpdateFactPayload` | Verified: `UpdateGoalPayload` (`db/exploration.go:276`) does **not** bump `content_version` — a blind copy leaves edited refusal wording inside already-folded cold-digest forever | New helper with explicit `content_version = content_version + 1` |
| `SoftDeleteIntent` for terminal refused intents (phase-2 E) | Verified: only accepts `running/paused/open` — terminal states error out; and `Frontier`/`ClaimIntent` don't read `blocked_reason` | Cancel path or new blocked-reason claim filtering (new behavior, phase 2) |
| Engine-side `HasActiveIntent()` as the "produced intents this round" signal | Conflates pre-existing open intents with this round's output → frontier-empty check becomes vacuous | `WriteCounts.Intents` incremented in `addOneIntent`, returned from `Plan()` |
| Agent-side delete tool for facts | Introduces "model rewrites history" risk; violates record-integrity audit instinct (doc §5.1.5) | API + UI only, human-operated, under existing task-level authz |
| Guard hook as the fact-write interception point | Guard reviews tool calls via preToolUse; `recordOneFact` graph writes are internal tool-handler mutations | In-handler keyword check at `recordOneFact` + `proveGoal` evidence screening |

## Stack Patterns by Variant

**If an agent's prompt was operator-edited (not code default):**
- Reseed must append a new version and switch (`ResetPromptToDefault`), never overwrite — existing behavior, keep it; flag-guarded one-shot per agent (six builtin flags + reporter/retester migration flags)

**If the LLM classifier model is unavailable/rate-limited:**
- Fail-open per `llm_judge_fail_action` (default `allow`), log activity line, throttle window continues suppressing retries — never fail-closed for K

**If `valid_until` expires mid-task:**
- Guard flips exploit-class actions to deny (or `ask` if settings choose), pre-expiry + post-expiry activity reminders fire — fail-safe with visibility, not silent lockout

**If a refused intent is terminal-state and needs phase-2 clean rerun:**
- New intent with `derived_from` edge, old intent via cancel/blocked-skip — not `SoftDeleteIntent`

## Version Compatibility

| Component | Compatible With | Notes |
|-----------|-----------------|-------|
| norma v0.4.3 | Go 1.26.x | Prompt-seed and resume mechanisms used by A/H/I are stable in-repo abstractions; no norma API change required by this milestone |
| pgx/v5 5.10.0 | PostgreSQL (embedded schema.sql pattern) | New tables are plain DDL; advisory-lock reuse (`7337741010`) is the only concurrency surface |
| Next.js static export | go:embed single binary | All new UI is client-side additions over existing REST endpoints (PATCH/DELETE + query params) — static-export safe; no SSR/ISR features introduced |
| @antv/g6 ^5.1.1 | React 19 | Dismissed-node styling (reduced opacity/strikethrough + tooltip) uses existing graph render config; no version bump needed |

## Stack-Level Gotchas Affecting Phase Sequencing (for the roadmapper)

1. **Batch prompt work once (doc §17 batch 1):** A + H-layer-1 + I + M share the reseed machinery; splitting prompt edits across phases multiplies settings flags and migration review surface for no benefit. Retester/reporter migration has an advisory-lock constraint — same batch keeps the pattern review in one place.
2. **C before/with D/L:** keyword interception (D/L) and cleanup (C) both consume the shared `refusalMarkers` helper and the `governance_log` table — one batch (doc batch 2) avoids churn.
3. **H-2 and K in the same PR:** K consumes H-2's triage preconditions; `WriteCounts.Intents` (the milestone's only signature ripple into `Plan()`/engine) lands here. Sequence after prompt batches so acceptance tests can construct real refusal rounds.
4. **J's guard wiring is the underestimated item:** `ReviewBackground`/`BuildReviewInput` changes break a *locked test* (`review_context_test.go`); budget ~0.5 day for that seam alone, and schedule J after D/L so the keyword helper and the credential sentence in prompts land in already-reseeded text (J's prompt addendum rides the earlier reseed, not a second one).
5. **Q1 filtering is acceptance-critical and cross-cutting:** six read paths must filter dismissed facts (including single-read `GetNode` placeholder and source-merge inherited facts) or refusal contamination leaks via task lineage — this is验收 #14 and belongs in the same batch as C, not deferred.
6. **N last, but its data plumbing early:** L's downgrade `note` markers and H-2's refusal activity lines are N's numerator inputs — N's job/report is trivial (~1 day) only if the earlier batches emit the markers as specified.

## Sources

- Codebase verification (HIGH): `go.mod` (Go 1.26.3, norma v0.4.3, pgx v5.10.0); `agent/promptcatalog.go`, `agent/tools.go` (:1315–1392 recordOneFact, :143 WriteCounts, :1176–1202 proveGoal), `agent/coldgraph.go` (:285 blockSignature), `agent/planner.go`; `server/orchestration.go` (:581–672 reseeds, :713–742 reporter migration), `server/scheduler.go` (:30–58 watermarks), `server/engine.go` (:978/1022/1155 ExecuteWithMessage/NotifyDone), `server/intent_intervention.go`, `server/finding_retests.go` (:202–240 advisory lock); `intercept/intercept.go` (:308–316 fail-action, :429 Judge), `intercept/review_context.go` + locked tests; `guard/guard.go`; `db/schema.sql` (:189/234 dismissed states, :201 content_version, :287–296 task_constraints); `db/exploration.go` (:268–282 SetNodeState/UpdateGoalPayload); `db/task_archives.go` / `task_archives_restore.go` (snapshot/restore wiring points)
- Design doc (authoritative for scope): `docs/拒止污染治理方案.md` — 二审定稿, decisions Q1–Q15
- OpenAI instruction hierarchy (arXiv:2404.13208; IH-Challenge 2025) — layered priority design validation — HIGH
- Microsoft spotlighting / NIST AI 100-2 E2025 prompt-injection mitigations — structured-evidence-over-prose validation — HIGH
- OWASP APTS standard (RoE/scope requirements for agents); 2025–2026 agentic-pentest practice (XBOW, CAI, commercial agents) — authorization-as-first-class-data validation — HIGH
- Over-refusal literature (XSTest NAACL 2024, OR-Bench 2024, FalseReject 2025) — keyword false-positive risk + authorization-visibility root cause — HIGH
- Agent memory governance (Microsoft Foundry memory-poisoning defense, 2025; agent-memory-governance frameworks) — write-validate / read-govern / audit-trail triad validation — MEDIUM-HIGH
- LLM-as-judge production guidance (Patronus, Monte Carlo, DeepEval 2025–2026) — binary classification, cheap-model, gating/throttling, fallback semantics — MEDIUM-HIGH
- PostgreSQL audit-table practice (Red-Gate, Cybertec, community consensus) — insert-only separate audit table, immutability — HIGH

---
*Stack research for: ARTEX refusal & record-contamination governance milestone*
*Researched: 2026-10-10*
