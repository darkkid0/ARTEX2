# Architecture Research

**Domain:** LLM-agent governance in an autonomous pentest platform — layered refusal-contamination defense (write-time interception, read-path visibility filtering, audit ledger, LLM-judge classifier, first-class authorization)
**Researched:** 2026-10-10
**Confidence:** HIGH (all architectural constraints verified against ARTEX source; industry patterns corroborated via 2025–2026 web sources, marked where MEDIUM/LOW)

> Brownfield note: this is NOT a greenfield architecture. The design doc `docs/拒止污染治理方案.md` (solutions A–N, decisions Q1–Q15) is fixed. This document maps each decided choice onto verified 2025–2026 architecture practice, identifies the seams where new code lands, and flags the cross-cutting risks the roadmap must sequence around.

---

## Standard Architecture

### System Overview — Layered Defense Mapped to ARTEX Components

The design doc's layered defense is a textbook **defense-in-depth placement model** (AIDDM-style: each control lives at a specific layer and catches what the others miss). Industry consensus in 2025–2026 is unambiguous: *no single guardrail holds under real-world load; resilience comes from stacking complementary layers across the execution chain* (input → reasoning → tool-entry → storage → read-path → measurement). ARTEX's scheme matches this exactly:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ L0 INPUT-SIDE: authorization & templates (soft→hard bridge)              │
│    M templates → task_authorizations (J) + allow/deny constraints (B)    │
├──────────────────────────────────────────────────────────────────────────┤
│ L1 PROMPT DISCIPLINE (soft): A/I reseed of 8 agents + H layer-1          │
│    agent/promptcatalog.go, worker.go, planner.go + reseed loop           │
├──────────────────────────────────────────────────────────────────────────┤
│ L2 WRITE-TIME INTERCEPTION (hard, tool-entry): D/L in recordOneFact      │
│    agent/tools.go — degrade (L) first, reject (D) on 2nd hit in batch;   │
│    same refusalMarkers helper validates prove_goal evidence              │
├──────────────────────────────────────────────────────────────────────────┤
│ L3 BEHAVIORAL TRIAGE (planner-side, hard): H layer-2 triage after Plan() │
│    WriteCounts.Intents gate → corrective retry (ExecuteWithMessage)      │
│    → K: ClassifyPlannerRound (new lightweight reviewer channel)          │
├──────────────────────────────────────────────────────────────────────────┤
│ L4 STORAGE: facts CRUD (C) — kind-locked DELETE/PATCH, content_version   │
│    bump, governance_log double-write (Q2)                                │
├──────────────────────────────────────────────────────────────────────────┤
│ L5 READ-PATH VISIBILITY FILTER (model-side hard hide): Q1 — dismissed    │
│    facts filtered on list / source-merge / inheritance / cold-digest /   │
│    graph_overview direct read / GetNode placeholder. UI uses             │
│    include_dismissed=true explicitly                                     │
├──────────────────────────────────────────────────────────────────────────┤
│ L6 GUARD CONTEXT: J wires task_authorizations into preToolUse review     │
│    (ReviewBackground extension) — fail-safe on expiry (deny by default)  │
├──────────────────────────────────────────────────────────────────────────┤
│ L7 MEASUREMENT: N refusal-baseline audit job (watermark) + independent   │
│    result table + report card → feeds back into C (audit→治理 closed loop)│
├──────────────────────────────────────────────────────────────────────────┤
│ PERSISTENCE: PostgreSQL — exploration_nodes (dismissed state reserved),  │
│ NEW independent tables: governance_log, task_authorizations, audit result│
│ (all wired into archive snapshot array + restore loop, 2 points each)    │
└──────────────────────────────────────────────────────────────────────────┘
```

**Why this placement is correct per current practice** (corroborated by Traversaal's defense-in-depth guide, Arthur's pre/post-LLM best practices, and Frontier Model Forum's 2025 agent-security brief — MEDIUM confidence, pattern-level):

- **Execution-layer guardrails** (enforced at the moment a tool call fires, independent of the model) catch what prompt-level and output-level controls miss. D/L sits exactly here — `recordOneFact` tool-entry — which is why the doc rejected DB-storage-layer interception: a storage-layer trigger would also fire for operator UI writes, complicate the shared helper's reuse by `proveGoal` evidence validation, and couple refusal semantics to the persistence layer where they don't belong.
- **Post-hoc read-path filtering** (L5) is the necessary complement: pollution written *before* the intercept existed (存量) can only be neutralized at read time. This mirrors the output-filtering layer in standard guardrail stacks.
- **Prompt discipline alone is the weakest layer** — research on instruction dilution confirms long system prompts degrade middle-position compliance ("lost in the middle" / "curse of instructions", HIGH-consistency finding across arXiv 2602.04294 and practitioner literature). The doc treats prompts as layer 1 of 8, never as the sole defense — correct.

### Component Responsibilities (new/changed code only)

| Component | Responsibility | Location (verified) |
|-----------|----------------|---------------------|
| `refusalMarkers` + `looksLikeRefusal` | Single shared self-referential keyword set (Q3); used by D (reject), L (degrade), and `proveGoal` evidence check | new helper in `agent/tools.go` (or small `agent/refusal.go`), one definition only |
| `recordOneFact` L/D branch | Degrade first (confidence→`inferred` + note), reject on ≥2 hits within same tool-call batch | `agent/tools.go:1312-1351` |
| `WriteCounts.Intents` | Count intents produced per planner round — prerequisite for H layer-2 triage; `addOneIntent` currently uncounted | `agent/tools.go:143,1032-1073`; `Plan()` return extended |
| Planner refusal triage | Post-`Plan()` gate: 0 new intents + !GoalMet + unmet goals + empty frontier/running → one corrective retry via `ExecuteWithMessage`; consecutive-failure counter in `engine.plannerRound`-adjacent memory + activity-log recovery on restart | `agent/planner.go:470-472`, `server/engine.go:137-172`, `server/intent_intervention.go:34` (resume path) |
| `ClassifyPlannerRound` | New lightweight reviewer channel: reuses judge infra (provider resolution, JSON verdict parsing, llmrec ledger, fail-action) — NOT the intercept rule table, NOT `intercept_pending`; task-level throttle (10 min default) | new, beside `intercept/`; template in `intercept/prompt.go` style |
| `DeleteFact` / `UpdateFactPayload` / `DismissFact` | kind-locked fact CRUD; `UpdateFactPayload` **must** bump `content_version` (unlike `UpdateGoalPayload` which doesn't) | `db/exploration.go` (pattern: `SetNodeState:269`, `UpdateGoalPayload:276`) |
| `governance_log` | Independent append-style audit ledger: `id/task_id/node_id/action/detail/operator/created_at` (mirrors `finding_cases`); survives archive cascade | new table; wired into `db/task_archives.go:578-600` snapshot array AND `task_archives_restore.go:245` restore loop |
| `task_authorizations` | Independent credential table (mirrors `task_constraints` schema style): authorizer/valid_until/scope/action_level; avoids `json_populate_record` schema drift | new table; same two-point archive wiring |
| `get_authorization` tool | Read-only attestation tool bound to worker/planner/pentest/mainagent; returns compact JSON + one-line validity statement | `agent/tools.go` (`readExpTool` pattern) |
| Guard context extension | Attach authorization to review context; expiry → fail-safe deny + activity notice | `guard/guard.go` preToolUse, `intercept/review_context.go:16-90` (touches `BuildReviewInput` selection logic + tests) |
| Dismissed-visibility filter | `state='dismissed'` exclusion pushed into SQL on every model-side read path; `include_dismissed` query param on UI-facing endpoints only | `db/exploration.go` `listByKindPageFiltered`, `db/exploration_sources.go:117-160` merge pages, `agent/tools.go:445` (graph_overview direct read), `agent/tools.go:661-684` (`relatedTaskOverviews`), `agent/coldgraph.go` folding, `GetNode` single-read placeholder |
| Audit job (N) | Scheduler watermark scan of terminal tasks → independent result table; **raw-DB data plane** (ignores dismissed filter so the numerator can't shrink) | `server/scheduler.go` watermark pattern (5s tick, `schedKey*`); NOT inside `SetTaskStatus` |
| Reseed loop | Table-driven `reseed*Prompt` for 6 built-in agents (per-agent settings flag); reporter via `upgradeReporterTriggerMessage`-style one-time migration; retester merged INTO `seedFindingRetester` inside advisory lock `7337741010` | `server/orchestration.go:581-672`, `orchestration.go:713-742`, `server/finding_retests.go:202-240` |

## Recommended Project Structure

Brownfield — new code lands in existing packages, respecting the established dependency rule (cmd → server → {agent, guard, intercept, traffic, …} → db; packages never import server):

```
agent/
├── refusal.go              # NEW: refusalMarkers + looksLikeRefusal (single source, Q3)
├── tools.go                # MOD: recordOneFact L/D branch; proveGoal evidence check;
│                           #     WriteCounts.Intents; graph_overview dismissed filter (:445);
│                           #     get_authorization readExpTool; relatedTaskOverviews filter (:661)
├── planner.go              # MOD: Plan() returns WriteCounts; triage hook after :470
├── coldgraph.go            # MOD: fold excludes dismissed facts (visibility, not signature change)
├── promptcatalog.go        # MOD: discipline section for worker/pentest/mainagent/auto/goals (+reporter const)
└── worker.go / planner.go  # MOD: discipline sections

db/
├── exploration.go          # MOD: DeleteFact/UpdateFactPayload (content_version bump!)/DismissFact;
│                           #     dismissed predicate in listByKindPageFiltered + counts; Frontier/ClaimIntent
│                           #     blocked_reason filter (E groundwork, phase 2)
├── exploration_sources.go  # MOD: source-merge pages + totals filter dismissed
├── governance.go           # NEW: governance_log insert/query (finding_cases paradigm)
├── authorizations.go       # NEW: task_authorizations CRUD + expiry query
├── refusal_audit.go        # NEW: audit result table (N)
├── schema.sql              # MOD: 3 new tables + constraints
├── task_archives.go        # MOD: +3 table names in snapshot array (:578-600)
└── task_archives_restore.go# MOD: +3 table names in restore loop (:245)

guard/
└── guard.go                # MOD: preToolUse attaches authorization context; expiry fail-safe

intercept/
├── review_context.go       # MOD: ReviewBackground gains Authorization attachment (touches BuildReviewInput + tests)
└── planner_classifier.go   # NEW (or agent/): ClassifyPlannerRound + throttle state — judge infra reuse, no rule table

server/
├── server.go               # MOD: DELETE/PATCH /api/exploration/facts/{id}; include_dismissed params; audit report API
├── engine.go               # MOD: triage invocation near NotifyDone; consecutive-failure counter; restart recovery
├── orchestration.go        # MOD: table-driven reseed loop (6 agents) + reporter one-time migration
├── finding_retests.go      # MOD: retester refresh INSIDE seedFindingRetester advisory lock
└── scheduler.go            # MOD: watermark key for audit job

web/src/...                 # MOD: fact node actions (作废/删除/编辑), include_dismissed toggle,
                            #     authorization form block, task templates dropdown, audit card
```

**Structure rationale:**
- The refusal helper lives in `agent/` because both consumers (write interception, prove_goal evidence validation) are agent-side; db and server never need it — keeps the dependency direction clean.
- All three new tables get a dedicated db file each, mirroring `finding_cases.go` / `constraints.go` one-table-per-file convention, and each must be registered in **both** archive wiring points in the same commit (see Cross-Cutting Risk 2).
- `ClassifyPlannerRound` sits beside the judge infra it reuses but in its own file/channel — the doc explicitly forbids routing it through the intercept rule table or `intercept_pending`; a separate file makes that boundary enforceable in review.

## Architectural Patterns

### Pattern 1: Write-Time Interception at the Tool-Entry Layer (D/L placement)

**What:** Refusal detection fires inside the tool handler (`recordOneFact`), after the summary non-empty check, before `AddNode`. Hit #1 → degrade (write anyway, `confidence='inferred'`, payload note "疑似拒止声明，由系统降级"). Hit #2 within the same tool-call batch → hard error forcing single-item rewrite (batch errors are per-item via `errs[i]`, never whole-batch failure).

**When to use:** When the contaminating artifact has one narrow write funnel. ARTEX's funnel is exactly one: `AddNode(db.KindFact, …, "confirmed", …)` at tools.go:1342 (worker), plus the `proveGoal` evidence path (tools.go:1176-1202) — both covered by the same helper.

**Trade-offs:**
- Tool-entry placement keeps refusal semantics out of the storage layer and lets the same helper guard `prove_goal` (a refusal-fact used as evidence would mark a goal met — worse than planner contamination).
- The keyword set must be **self-referential patterns only** — bare "拒绝" is banned because "connection refused / 403 拒绝访问" are the highest-frequency *legitimate* negative observations in pentesting. Research on keyword/regex classifiers confirms systemic false-positive failure mode for over-broad matching (MEDIUM confidence, practitioner consensus). Full-text `contains`, case-insensitive, no positional constraints (model wording can't be guaranteed to front-load).
- Counting scope is deliberately minimal: **per tool-call batch only** (Q13) — cross-call counters would need graph queries or ToolSet state, disproportionate for the benefit.

**Why not storage-layer:** a DB-level trigger/check would also fire on operator API writes (the C-layer PATCH path legitimately edits summaries that may quote refusals) and would split the refusal definition across layers. Keep the invariant in one Go function; keep the DB kind-locked (`AND kind='fact'`) for id/safety invariants instead.

### Pattern 2: Read-Path Visibility Filtering with Version-Signature Cache Coherence (Q1 + content_version)

**What:** Soft-dismissed facts are hidden from the model side by pushing the predicate into every read query, and the existing `content_version` → `blockSignature` mechanism carries cache coherence for free — *provided every mutation path bumps the version*.

This is the **filter-at-the-data-access-layer** pattern that multi-tenant research consistently identifies as the only reliable shape: post-filtering on results leaks through counts, pagination totals, and aggregates ("filtering afterward is the specific mistake worth naming" — Kinetic Edge multi-tenant AI isolation, MEDIUM confidence; same failure class as a missed `WHERE tenant_id = ?`). ARTEX's dismissed-filter is structurally identical to tenant filtering — one missed read path = contamination leak into task B via inheritance.

**The six read paths that must all filter (Q1, verified):**

| # | Path | Location | Failure if missed |
|---|------|----------|-------------------|
| 1 | Own-task list | `db/exploration.go` `listByKindPageFiltered` + `countByKindFiltered` (totals must exclude too — else `total` leaks the hidden count) | list_facts shows pollution |
| 2 | Source-merge inherited pages | `db/exploration_sources.go:135-148` (both page and per-source count) | cross-task inheritance leak (acceptance #14) |
| 3 | `relatedTaskOverviews` | `agent/tools.go:661-684` | planner sees refusal via related-task overview |
| 4 | graph_overview direct read | `agent/tools.go:445` `ListByKind(db.KindFact, 1000)` — `facts_total` AND `recent_facts` | the most-read planner surface |
| 5 | cold-digest folding | `agent/coldgraph.go` (kind-based folding) | refusal text frozen into folded digest blocks |
| 6 | `GetNode` single read | node_detail / get_task_node_detail → "该记录已被操作员否定" placeholder | ids survive in lineage edges / evidence refs / history; single-read bypasses everything else |

**Cache coherence — content_version discipline:**

```go
// db/exploration.go — UpdateFactPayload MUST bump content_version.
// UpdateGoalPayload (:276) does NOT — copying it verbatim is the planted bug.
_, err = tx.Exec(`
  UPDATE exploration_nodes
     SET payload = $2, content_version = content_version + 1
   WHERE id = $1 AND kind = 'fact' AND exploration_id = $3`, id, payloadJSON, expID)
```

- `blockSignature` (`agent/coldgraph.go:285`) hashes sorted member ids × content_version (+ anchors), so any bump invalidates the cached digest body and forces re-compaction. `DismissFact` can simply reuse `SetNodeState` (already bumps at :269).
- **Write-path ordering matters:** payload rewrite and version bump must be in the **same UPDATE** (same transaction). Bump-first/payload-later (or vice versa across statements) opens a window where the signature changes but the digest re-folds the old refusal text — the exact stale-cache failure version-based invalidation is supposed to prevent (oneuptime/Redisson version-invalidation literature, MEDIUM confidence).
- Placeholder semantics at `GetNode`: returning a fixed placeholder string does **not** change any content_version, so signature stability is preserved; the placeholder must be produced at read time, never persisted (persisting it would mutate lineage-quoted text and break auditability).
- UI escape hatch: `include_dismissed=true` exists **only** on HTTP endpoints (`GET /api/exploration/nodes`, `/graph`, fact detail). Agent-side tool callers must have no way to set it — enforce structurally by not adding the flag to the agent-side `NodeFilter`/tool parameter structs (a flag a developer must remember not to pass is a flag that eventually gets passed; make the unfiltered path unreachable from agent code).

### Pattern 3: Independent Audit Ledger Decoupled from the Archival Cascade (Q2)

**What:** `governance_log` is a standalone table (paradigm: `finding_cases`: `id/task_id/node_id/action/detail/operator/created_at`, actions `fact_delete/fact_dismiss/fact_edit`) — deliberately NOT the `activity` table, because archiving deletes `activity` wholesale with the exploration (`task_archives.go` snapshot-then-delete; `exploration_nodes` likewise). An audit trail stored in activity vanishes exactly when it's most needed (post-incident review of an archived task).

**Why this is the right call per compliance-architecture practice** (append-only ledger literature, MEDIUM–HIGH consistency): audit trails are *evidence*, distinct from operational event streams; the standard is a separate, append-oriented store whose lifecycle is decoupled from business data retention. ARTEX's archive-cascade is the local equivalent of a business-retention purge — mixing the two means retention policy silently destroys compliance history. `finding_cases` already proves the pattern value in-repo (it does not cascade with exploration).

**Design rules:**
- **Double-write, distinct duties:** `governance_log` = durable audit ("operator deleted fact #N"); `activity` (Worker='system') = in-task activity-stream display. Both written at action time; after archive only governance_log survives.
- Hard-delete residue: `activity.node_id` is `ON DELETE SET NULL` (schema.sql:301) — text survives, reference nulls out; UI needs fallback copy for dangling activity rows.
- **Archive wiring is two-point and must be atomic as a change-set:** add the table name to the snapshot array (`task_archives.go:578-600`) **and** to the restore loop (`task_archives_restore.go:245`). Wiring only one side = data silently not archived, or restore failing on unknown table. The same two-line wiring is reused verbatim for `task_authorizations` (J) and the audit-result table (N) — three tables, three identical wiring changes, batchable per the doc's phase plan.
- The ledger is append-style: no UPDATE/DELETE paths in the db helper (insert + query only). If a correction is needed, append a compensating entry — do not mutate.

### Pattern 4: LLM-Judge Classifier as a Parallel Lightweight Channel (K within H layer-2)

**What:** `ClassifyPlannerRound(reason, situational) → refusal|normal` is a **new reviewer channel** that reuses the intercept judge's *infrastructure* — provider resolution, JSON verdict parsing, llmrec ledger, fail-action semantics — but shares **no** rule-table path: planner empty-rounds produce no tool call, so `preToolUse` never fires and `Match(tool, input)` has nothing to match. This was verified in-code and is the doc's explicit correction of a naive "just add an observe rule" reading.

**Integration rules grounded in 2025–2026 judge-engineering practice** (Arize/Maxim/Galileo judge-failure literature, MEDIUM–HIGH consistency):

- **Fire-on-suspicion gating:** the deterministic statistical gate (0 new intents && !GoalMet && unmet goals && frontier/running empty) runs *first*; the model is consulted at most once per suspected round. Never call the classifier on rounds that already produced intents — this is the single most important cost control.
- **Binary verdict, not scores:** `refusal|normal` only. Judge research is unanimous that binary/categorical labels are dramatically more consistent than numeric scores in production gates.
- **Task-level throttle (10 min default, settings-configurable):** planner rounds are engine-woken repeatedly (`NotifyDone` + heartbeat, engine.go:771); an unthrottled classifier turns a refusal loop into a token furnace. Within the window, disposition falls back to the statistical path and logs "分类器节流中" to activity — auditable degradation, not silent.
- **Fail-open (fail-action = `llm_judge_fail_action`, default allow):** classifier unavailable → pass through, prefer misses over false blocks (宁漏勿错). This matches the doc's overall conservative principle and the existing intercept default (`intercept/intercept.go:316`). Justification: a false `refusal` verdict injects a corrective retry — cheap but polluting; a false `normal` loses one round and the consecutive-failure counter still catches the pattern. **However** see Cross-Cutting Risk 5: fail-open + counter-reset-on-restart + weak prompts was the doc's identified "all three stack" failure — hence activity-log counter recovery.
- **Ledger reuse:** classification calls go through llmrec so usage accounting (Q8: retries count as independent captureRun) and the N-layer audit both see them.
- **No `intercept_pending`:** verdicts act immediately (retry or pass); there is no human-approval queue for planner rounds — don't borrow that machinery.

### Pattern 5: First-Class Authorization Context (J)

**What:** `task_authorizations` (one row per credential: authorizer / valid_until / scope / action_level ∈ {recon, exploit, shell}) as an independent table; a read-only `get_authorization` tool bound to worker/planner/pentest/mainagent; guard's `preToolUse` review context gains an Authorization attachment; expiry transitions guard from allow → deny (fail-safe) with pre/post-expiry activity notices.

**Why each element, per current agent-authorization practice** (Sennovate/Iternal/cordum 2026 guidance, MEDIUM confidence):

- **Credential as queryable evidence, not prompt assertion:** "提示词断言'已授权'不如一份可查询的授权凭据" — this mirrors the industry shift from prompt-level trust to verifiable, time-bound, agent-queryable entitlements. The attestation tool is the agentic analog of "trust but verify": the model checks authorization the way it checks any fact.
- **Time-bound credentials with fail-safe expiry:** NIST 800-207A-style short-lived, task-scoped grants; expiry must *deny* by default (settings can switch to `ask`) — never silently continue. The pre/post-expiry activity notices exist because the known failure mode of fail-safe transitions is the opposite one: a task quietly becomes all-deny and nobody notices (the doc calls this out explicitly).
- **Independent table, not tasks-row JSON/columns** (Q11, doc §12.2.1): archive restore uses `json_populate_record(NULL::tasks, …)` whole-row UPDATE — a tasks-row column breaks under cross-version archive restore (new-archive→old-binary restore fails with "column does not exist"; old-archive→new-binary restore produces NULL-semantics drift). Independent tables ride the snapshot-array/restore-loop two-point wiring instead. **This is the single most load-bearing schema decision in the doc — do not "simplify" it into a tasks column.**
- **Guard-context extension is not one line** (doc's honest estimate: ~0.5 day): `ReviewBackground` currently accepts only `Source == "user_message"` (review_context.go:16-20, selection in `BuildReviewInput`:62, tests lock worker_summary/empty/scheduler rejections at review_context_test.go:62-81). Adding Authorization touches the selection logic and its tests. Prefer attaching via the `WithReviewContext` environment struct over overloading `Source`.
- **Priority arbitration is architectural, not textual:** deny constraints > authorization credentials > default discipline (§3.1/§10.2/§12). The prompt must state that credentials do not diminish deny constraints — otherwise "已授权" becomes a jailbreak lever the model can use against the RoE lines. This mirrors least-privilege literature: capability grants never override explicit deny rules.
- **Transitional honesty (Q11):** until the table + tool exist, goals can only extract allow *text* constraints (B) that guard cannot read. The roadmap must not treat B and J as interchangeable — they are different layers with different enforcement points.

### Pattern 6: Idempotent Seed/Migration via Settings Flags + Advisory-Lock Containment

**What:** Prompt reseeds and one-time migrations ride the existing `settings` flag pattern: `reseed*Prompt` functions (orchestration.go:581-672) copy → bump a per-agent flag → `ResetPromptToDefault` appends a new version (history preserved, rollback = switch back). Reporter uses the `upgradeReporterTriggerMessage` one-time-migration shape (compare current text to code default; only append when unmodified). Retester's refresh is merged **into** `seedFindingRetester` inside advisory lock `7337741010`.

**Rules (verified against PostgreSQL locking semantics — HIGH confidence, official docs):**
- Retester must share the existing advisory lock, not open a parallel settings-flag migration: two migration functions racing on the same row is exactly the non-idempotent-DML race advisory locks exist to prevent. Session-level vs transaction-level matters — match whatever `seedFindingRetester` already uses (`pg_advisory_xact_lock` semantics release at commit; session-level pins a connection).
- All new flags must be idempotent under re-run (flag check before append) — re-runs happen on every server start.
- The 6 built-in agents' reseeds should be a **table-driven loop** (agent key → flag name → default const), not six copy-pasted functions — the doc specifies this (§11.3) and it halves the diff.
- User-modified prompts are never overwritten: compare-and-append-only preserves the existing rollback contract (agent_prompts version history).

## Data Flow

### Refusal Lifecycle Through the Layers

```
[worker/pentest attempts record_fact with refusal wording]
        │
        ▼
L2 recordOneFact ── looksLikeRefusal(summary)?                    (tool-entry, Q3 keyword set)
        │ no → AddNode(confirmed) as today
        │ yes (1st in batch) → degrade: confidence=inferred + note → AddNode → return success + 提示
        │ yes (≥2nd in batch) → error → model rewrites that single item
        ▼
[still-written refusal artifacts from before the intercept, or legacy data]
        │
        ▼
Operator: graph-tab → NodeDetailSheet → 作废/删除/编辑             (C, human-only)
        │ PATCH state='dismissed' → SetNodeState bumps content_version
        │ PATCH summary/detail → UpdateFactPayload bumps content_version  ← same UPDATE!
        │ DELETE → row gone, edges CASCADE, activity.node_id SET NULL
        ├──────────────► governance_log (independent table, survives archive)
        │
        ▼
L5 read paths re-query ── dismissed excluded in SQL (6 paths, Q1)
        │
        ▼
planner next wake → graph_overview/cold-digest recomputed
        └─ blockSignature differs (content_version) → digest body regenerated (no LLM reuse of stale)
```

### Cache-Invalidation Flow (the only cache in the governance path)

```
mutation (dismiss/edit/delete-adjacent)
    → content_version = content_version + 1     (same transaction as payload/state change)
    → next re-compaction: blockSignature(members×versions) ≠ stored signature
    → cache miss → re-fold (kind≠dismissed only) → LLM re-compaction → new body stored
```

There is no TTL and no event bus to get wrong — the entire coherence mechanism is the version stamp. This is why the doc repeatedly stresses the bump: a single mutation helper that forgets it resurrects patched refusal text inside otherwise-fresh digests.

### Planner Triage Flow (H layer-2 + K)

```
engine wakes planner → Plan() returns (GoalMet, Reason, WriteCounts{Intents,…})
        ▼
triage gate (deterministic): Intents==0 && !GoalMet && ∃unmet goal && frontier/running empty
        │ gate not hit → normal return (acceptance #8: legitimate empty round passes)
        ▼
throttle check (task-level, 10 min) ── in-window → statistical disposition + activity note
        │ out-of-window
        ▼
ClassifyPlannerRound(Reason, situational)        (judge infra, llmrec ledger)
        │ normal        → pass, activity "本轮判定为合理空轮"
        │ refusal       → 1 corrective retry via ExecuteWithMessage resume (fixed message)
        │ model error   → fail_action (allow) — pass, 宁漏勿错
        ▼
retry produced intents → counter reset; retry empty → counter++
        ▼
consecutive failures ≥ N (phase 2, layer 3) → hint takeover → M more → operator alert
        (counter source-of-truth: memory + activity stream; restart recovery reads activity)
```

### Authorization Data Flow (J)

```
UI template/task form → task_authorizations row (authorizer, valid_until, scope, action_level)
        │                                  (independent table; archive-wired both points)
        ├─► get_authorization tool (read-only) → agent sees credential JSON + validity line
        └─► guard preToolUse → WithReviewContext attaches Authorization
                → BuildReviewInput includes it → judge judges scope violations with evidence
                → valid_until passed → guard flips allow→deny (fail-safe) + activity notices (pre/post)
```

## Cross-Cutting Risks (roadmap must sequence around these)

These are the places where the design doc's architecture has known failure modes. Each maps to an acceptance criterion already in the doc — the roadmap should ensure the corresponding test lands in the **same phase** as the code.

### Risk 1: Visibility-filter completeness (the leak class)
**Pitfall:** dismissed filtering is a 6-path invariant; missing any one path resurrects contamination, and path 2 (source-merge) and path 6 (GetNode) are the two most likely to be forgotten because they live in different files from the list path. Post-filtering instead of in-SQL filtering leaks through `total`/`hasMore` counts.
**Sequencing answer:** one phase owns all six paths + acceptance #2/#14 (own-task + cross-task inheritance + single-read placeholder). Do not split "list paths" and "detail paths" across phases.

### Risk 2: Archive wiring asymmetry (data loss or restore failure)
**Pitfall:** `governance_log`, `task_authorizations`, and the audit-result table each need a row in the snapshot array **and** the restore loop. Wiring one side only produces silent non-archival or restore-time "unknown table". Whole-row `json_populate_record` restore is why independent tables were mandated at all.
**Sequencing answer:** each table's DB phase includes both wiring lines in the same commit; acceptance 2a (archive → restore → governance_log intact) is the gate.

### Risk 3: Cache-invalidation ordering (stale digest resurrection)
**Pitfall:** `UpdateFactPayload` without `content_version=content_version+1` (copying `UpdateGoalPayload`) leaves patched refusal text inside cached digest bodies indefinitely. Bump and payload rewrite must be one UPDATE.
**Sequencing answer:** the fact-CRUD phase includes acceptance #3 (graph_overview reflects edit on next planner wake).

### Risk 4: Advisory-lock contention (retester race)
**Pitfall:** a separate migration function for retester prompts racing `seedFindingRetester` (lock 7337741010) can interleave prompt-version writes. Session- vs transaction-level lock semantics also matter for connection pinning.
**Sequencing answer:** retester refresh is inside `seedFindingRetester`'s lock, in the prompts batch — never a standalone migration.

### Risk 5: Fail-open stacking (H layer-2 rendered inert)
**Pitfall:** weak prompts + counter reset on restart + classifier fail-open = long-running refusal tasks never accumulate consecutive failures. The doc's fix: layer-2 persists every refusal verdict to activity; on first post-restart refusal, recover the counter by scanning recent activity; only start from 1 when no records exist.
**Sequencing answer:** the triage phase ships the activity-recovery path with the counter, not later; acceptance #6 exercises it.

### Risk 6: Frontier/ClaimIntent claim-filter gap (E groundwork)
**Pitfall:** `Frontier`/`ClaimIntent` (db/exploration.go:1141/:1175) filter `state='open'` only and ignore `blocked_reason`; "blocked_reason + skip claim" is *new* behavior, not an existing path. Also `SoftDeleteIntent` rejects terminal states (`ErrIntentStateConflict`) — phase-2 clean-room rerun needs a cancel path or the blocked-skip filter for old intents.
**Sequencing answer:** phase 2 (E) must plan both the new filter and the terminal-intent disposition; don't assume existing functions suffice.

### Risk 7: Measurement drift (audit numerator shrinkage)
**Pitfall:** if the N-layer audit reads through dismissed-filtered views, operator cleanup shrinks the refusal rate — the metric drifts as governance succeeds, hiding exactly the trend it exists to show.
**Sequencing answer:** audit job queries raw SQL with dismissed as a *dimension*, never through `ListByKind`; acceptance #13 ("人工 dismiss 后分子不缩水").

### Risk 8: Guard-context ripple (J's underestimated surface)
**Pitfall:** `ReviewBackground`/`BuildReviewInput` selection logic and its locking tests (review_context_test.go:62-81) reject unexpected sources; bolting Authorization onto `Source` breaks the provenance guarantee ("background cannot override review policy").
**Sequencing answer:** extend via the `WithReviewContext` environment struct (Authorization as a sibling field), update the tests in the same change; budget 0.5 day per the doc, not "one field".

## Sequencing Guidance for the Roadmap

Dependency-derived order (matches and validates the doc's §20 batch plan — batch boundaries are architectural seams, not just effort estimates):

1. **Schema-independent prompt/migration batch (A + I + H layer-1 + M templates):** no new tables, no API. First because every later batch's prompt copy references the discipline text and the priority-arbitration wording; reseed flags are idempotent and rollback-safe (version history). Nothing downstream depends on it, but nothing downstream should wait for it either — it de-risks the source immediately.
2. **Graph-governance batch (C + D/L):** DB helpers → API → UI → tests. Lands the `refusalMarkers` helper (single definition), `governance_log` + its two-point archive wiring, `UpdateFactPayload` version bump, the six read-path filters, and `prove_goal` evidence validation. **This batch owns Risk 1+2+3.** H layer-2 touches the same files (`agent/tools.go` WriteCounts) — keeping this batch before H2 avoids merge contention.
3. **Planner hard-line batch (H layer-2 + K):** `WriteCounts.Intents` → `Plan()` return extension → triage → corrective retry (`ExecuteWithMessage` reuse) → `ClassifyPlannerRound` (judge infra reuse + throttle + fail-open) → activity-log counter recovery. **Owns Risk 4(no)—Risk 5(yes).** Needs batch 2's activity discipline? No — but needs the same-file changes from batch 2 landed first.
4. **Authorization batch (J):** `task_authorizations` table (+ two-point archive wiring) → `get_authorization` tool → guard/`WithReviewContext` extension → expiry fail-safe + notices → prompt addendum ("凭据不减损 deny 约束") → UI form last. **Owns Risk 8.** Depends on batch 1's prompt reseed being in place (the addendum rides the same discipline section).
5. **Measurement batch (N + F/B docs):** watermark audit job + independent result table (+ archive wiring) + report card + troubleshooting guide. **Last** because it measures layers 1–4 (needs L's note markers, H2's activity records, K's verdicts to exist to produce a meaningful baseline) and closes the loop into batch 2's cleanup actions (card → 作废/删除).
6. **Phase 2 (E + H layer-3):** clean-room rerun (new intent + `derived_from` edge; terminal old intents via cancel or blocked_reason skip-claim — new Frontier/ClaimIntent filter, Risk 6) and escalation takeover. Explicitly deferred; G's hint remediation retires when these land.

**Shared-infrastructure reuse points (verify, don't rebuild):**

| Infrastructure | Reused by | Reuse shape |
|---|---|---|
| judge infra (`wireInterceptReviewer`: provider resolution, verdict JSON parse, llmrec ledger, fail_action) | K classifier, N audit model calls | infra yes, rule table / `intercept_pending` **no** |
| archive snapshot array + restore loop | governance_log, task_authorizations, audit-result table | one table-name line per point, per table |
| `finding_cases` table paradigm | governance_log, audit-result table | column shape + no-cascade-with-exploration property |
| `task_constraints` table paradigm | task_authorizations | schema shape (CHECK action_level instead of allow/deny) |
| `reseed*Prompt` pattern / `upgradeReporterTriggerMessage` / `seedFindingRetester` lock | A + I across 6 built-in / reporter / retester agents | table-driven loop; compare-and-append; in-lock refresh |
| `ExecuteWithMessage` resume | H2 corrective retry | same path as `intent_intervention.go:34` |
| scheduler watermark pattern | N audit job | new `schedKey` + terminal-task scan; not inside `SetTaskStatus` |
| `content_version`/`blockSignature` | C mutations | reuse untouched; only feed it correct bumps |
| `readExpTool` pattern | `get_authorization` | ~40-line read-only tool |
| `NodeFilter` `kind`/`q` params | pollution hunting (UI) | optional `SummaryOnly` addition |

## Anti-Patterns

### Anti-Pattern 1: Filtering after fetch
**What people do:** fetch nodes normally, filter `dismissed` in Go before returning to the agent.
**Why it's wrong:** counts/totals/pagination leak the hidden data's shape; cold-digest folding operates on pre-filter sets; one new caller forgets the filter. Multi-tenant practice calls post-filtering *the* classic leak shape.
**Do instead:** predicate inside every SQL read (`listByKindPageFiltered`, counts, source stores, direct `ListByKind` at tools.go:445, `GetNode`), placeholder at single-read.

### Anti-Pattern 2: Audit trail in the operational event stream
**What people do:** put governance actions only in `activity` "because it's already there".
**Why it's wrong:** archive deletes activity with the exploration — compliance history evaporates exactly when an archived task is questioned.
**Do instead:** independent `governance_log` (append-only, archive-wired), activity as display-only companion.

### Anti-Pattern 3: Authorization as prompt assertion / tasks-row JSON
**What people do:** put `{"authorized": true}` in a tasks column or just repeat "已授权" in prompts.
**Why it's wrong:** whole-row restore via `json_populate_record` makes row-shape changes a cross-version archive hazard; prompt assertions are unqueryable and unrevisable by the agent; no expiry semantics.
**Do instead:** independent time-bound credential table + read-only attestation tool + guard-context injection + fail-safe expiry.

### Anti-Pattern 4: LLM judge on every planner round / fail-closed on judge errors
**What people do:** classify each empty round unconditionally; deny when the judge errors.
**Why it's wrong:** planner is engine-woken in a loop — unthrottled classification is a cost sink; fail-closed turns model outages into task deadlock (the exact "silent all-deny" failure the J expiry design guards against).
**Do instead:** deterministic statistical gate first → task-level throttle → fail-open (`llm_judge_fail_action`) with auditable activity entries.

### Anti-Pattern 5: Copying `UpdateGoalPayload` for fact edits
**What people do:** clone the nearest similar helper verbatim.
**Why it's wrong:** it doesn't bump `content_version`; patched refusal text survives inside cached cold-digest bodies indefinitely — invisible, unrecomputable pollution.
**Do instead:** `UpdateFactPayload` bumps `content_version` in the same UPDATE; test asserts signature change.

### Anti-Pattern 6: Agent-side escape hatches on the filtered path
**What people do:** add `include_dismissed` to the shared NodeFilter "for flexibility" and trust callers not to set it.
**Why it's wrong:** model-side visibility must be structurally guaranteed; a remembered convention is a future leak (acceptance #14 exists because lineage/inheritance leaks are the primary contamination vector).
**Do instead:** flag exists only on HTTP endpoints; agent-side structs never gain it.

## Scaling Considerations

| Concern | Current scale (single-instance, per-task) | Growth path |
|---------|------------------------------------------|-------------|
| Refusal keyword matching | O(len(markers) × len(summary)) per fact write — trivial | fine forever; if markers grow past ~50, precompile to a single regexp or Aho-Corasick — but resist ML classification at write time (latency on the hot tool path) |
| cold-digest re-compaction | version-bump invalidation re-runs LLM compaction per changed block | batch related edits in one operator action (one bump wave); per-task scope keeps this bounded |
| governance_log / audit tables | append-only, queried per task detail page | index on (task_id, created_at); never in planner hot path |
| Classifier cost | ≤1 call per suspected round per task per 10 min | throttle knob is the control; llmrec ledger makes spend visible |
| Archive size | 3 more tables in snapshot | each is task-scoped and small; restore loop cost unchanged |

## Sources

**Codebase (verified in this session — HIGH confidence for all architectural claims):**
- `docs/拒止污染治理方案.md` — the finalized design (all solutions A–N, decisions Q1–Q15, §17 batches, §19 acceptance, §20 order, §21 rollback)
- `agent/tools.go` (WriteCounts:143, recordOneFact:1312-1351, AddNode fact path:1342, proveGoal evidence:1176-1202, graph_overview read:445, relatedTaskOverviews:661-684, addOneIntent:1032-1073)
- `agent/coldgraph.go` (blockSignature:285, kind-based folding:97)
- `db/exploration.go` (SetNodeState bump:269, UpdateGoalPayload no-bump:276, SoftDeleteIntent:404-407, Frontier:1141/ClaimIntent:1175)
- `db/exploration_sources.go` (ListByKindPageWithSources:117, source merge:135-148)
- `db/task_archives.go` (snapshot table array:578-600) / `task_archives_restore.go` (restore loop:245, json_populate_record:313-329)
- `db/schema.sql` (fact state CHECK incl. dismissed:234, constraints CHECK:290, activity node_id ON DELETE SET NULL:301)
- `guard/guard.go` (preToolUse, RoE-removed note) · `intercept/review_context.go:16-90` + tests:62-81 · `intercept/intercept.go:316` (defaultJudgeFailAction="allow")
- `server/engine.go` (plannerRound:137-172, wake loop:771) · `server/scheduler.go` (watermark pattern:30-58) · `server/orchestration.go` (reseeds:581-672, reporter migration:713-742) · `server/finding_retests.go:202-240` (advisory lock 7337741010) · `server/intent_intervention.go:34` (ExecuteWithMessage resume)

**Web (2025–2026, corroboration — MEDIUM unless noted):**
- Layered guardrails / defense-in-depth placement: traversaal.ai defense-in-depth guide; arthur.ai pre/post-LLM guardrail best practices; hidekazu-konishi.com AIDDM; braintrust.dev guardrail tool survey; Frontier Model Forum "Emerging Security Practices for AI Agents" (2025); TraceSafe (arXiv 2604.07223)
- Instruction dilution / prompt-as-weak-layer: arXiv 2602.04294 (few-shot position bias, "lost in the middle"); mlops.community prompt-bloat; medium/data-science-collective long system prompts
- Read-path filtering / leak classes: kineticedge.io multi-tenant AI data isolation ("filter afterward" anti-pattern); OWASP Multi-Tenant Security Cheat Sheet; bugstrix cross-tenant leak patterns; redis.io data isolation
- Version-based cache invalidation: oneuptime.com version-based invalidation; redisson.pro invalidation glossary
- Audit ledger vs event log: vibeengines audit-logging system design (append-only/WORM, independent trail); dev.to Go/PostgreSQL audit-log paradigms; questdb append-only log
- LLM-judge integration: arize.com judge calibration (binary labels, insufficient-evidence class); getmaxim.ai judge debugging; galileo.ai judge failure modes (binary > 0–100, cost spirals); langwatch metrics taxonomy
- Agent authorization/expiry: sennovate.com agent authorization governance 2026 (fail-safe on expiry/revocation); iternal.ai agent security checklist (NIST 800-207A short-lived credentials); cordum.io production controls; akeyless/strata IAM guides
- Advisory locks/idempotent migration: PostgreSQL docs ch.13 explicit locking (HIGH); milanjovanovic.tech pg_advisory_xact_lock; Arize phoenix advisory-lock analysis (non-idempotent DML race)

---
*Architecture research for: ARTEX refusal-contamination governance (brownfield, design doc fixed)*
*Researched: 2026-10-10*
