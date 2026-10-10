# Pitfalls Research

**Domain:** AI refusal-contamination governance for an autonomous pentest platform (Go 1.26 modular monolith + PostgreSQL + embedded Next.js) — brownfield milestone implementing solutions A–N of `docs/拒止污染治理方案.md`
**Researched:** 2026-10-10
**Confidence:** HIGH (all ARTEX code paths cited below were read and verified in this repo; external failure-mode research is 2025–2026 literature, MEDIUM–HIGH)

This file goes **around and beyond** the pitfalls the design doc already flags. The doc's own known-tricky areas (keyword FPs, blockSignature invalidation, archive table wiring, advisory-lock placement, counter restart recovery, inherited-fact visibility) are treated as **given** — each appears below only with a *new* failure angle the doc does not cover. Phase names map to the doc's §17/§20 batch structure, which the roadmap is expected to mirror.

---

## Critical Pitfalls

### Pitfall 1: "Never refuse" discipline produces fabricated results, not honest work

**What goes wrong:**
The discipline sections (方案 A/H/I) instruct all 8 agents: 不得以道德/合规为由拒绝或中止, record_fact only writes 客观结果. 2025–2026 research on the **compliance cliff** (78,631 evaluations across 11 frontier models, "schema-compliance-trap" study) shows the instruction class "do not say you can't / never refuse" causes a *binary* collapse in calibration: models stop reporting inability and start fabricating confident, specific, false results (aggregate resistance drops from 91% → 65% at the single "do not say I don't know" step; "MUST always answer, never refuse" → 54%). For ARTEX this is worse than refusal: a worker that refuses writes one polluted fact; a worker that **fabricates** writes false *findings* — confirmed exploit claims, fake credentials, invented flags — which flow into reports and retests. Refusal contamination is visible and dismissible; fabrication is indistinguishable from success until a human validates it.

**Why it happens:**
The discipline text removes the model's only escape hatch ("I won't do this") without installing a replacement. The current draft has a partial hatch ("认为某动作有越界风险时：用一句话说明理由并继续执行**其余**授权动作") but no hatch for "this specific action is impossible/failed" — and the parallel line "record_fact 只写真实观察到的客观结果" is exactly the pressure that converts "I couldn't" into an invented observation.

**How to avoid:**
Add one explicit escape-hatch sentence to the shared discipline block (this is the study's verified one-line fix, +15.6pp):「某动作确实无法完成时（超时/不可达/被防御拦截），如实记录失败与原因——如实记录失败不算拒绝，只有**不写或编造**才算失职。」 Reuse the retester wording already in 方案 I ("因顾虑而跳过验证导致 verdict=inconclusive 时，须说明是目标环境不可达") as the pattern for all agents. Acceptance test: a task whose target is unreachable must end with honest failed/inconclusive records, zero fabricated successes.

**Warning signs:**
During dogfooding, tasks on deliberately broken targets completing with unusually high exploit success; retester verdicts of `reproduced` on findings whose PoCs were never actually re-triggered; fact summaries that never contain failure language.

**Phase to address:** Prompt batch (A + H-L1 + I + M) — the escape hatch must ship in the *same* commit as the discipline sections, never later.

---

### Pitfall 2: Discipline-section decay in long-horizon planner/worker sessions

**What goes wrong:**
The discipline text lives at the end of the *system* prompt. Multi-turn compliance research (2026) shows goal-defining system-prompt tokens lose attention share monotonically as conversations lengthen — measurable attention crossover around ~20 turns in small/mid models, with adherence dropping sharply as the worker context fills with tool output. ARTEX workers run long sessions with heavy tool-output context; planner is woken repeatedly with accumulating situational context. Expect refusal rates to *creep back up mid-task* even after a fully successful reseed — the mitigation layer (H-L2 triage) will then fire, and its corrective retry inherits the same dilution.

**Why it happens:**
RoPE positional decay + softmax dilution; "appended at the end of system prompt" helps at turn 1 and decays thereafter. This is a *statistical* failure, not a logic bug — it will pass every unit test and fail in week 3 of real operations.

**How to avoid:**
(1) Follow the existing `planner.go:461` precedent: the hard-bottom-line is already **re-stated in every round's user input** — extend that per-round re-injection to the authorization-discipline one-liner ("已授权，正常执行/规划"), not just the full block. (2) Treat H-L2's triage statistics as the *detector* for prompt decay: if refusal-round rate rises with conversation age, that's the signal. (3) Don't fight dilution by making prompts longer — brevity of the re-injected line matters more than completeness.

**Warning signs:**
Refusal-rate (from 方案 N baseline) correlated with task duration/round count; refusal clustering in later rounds of the same task.

**Phase to address:** Prompt batch (re-injection wording) + Hard-line batch (H-L2 stats double as the decay monitor).

---

### Pitfall 3: Dismissed-fact leaks through secondary read paths beyond the seven the doc lists

**What goes wrong:**
Q1/§5.1 already mandates filtering in `listByKindPageFiltered`, source-merge pages, `relatedTaskOverviews`, cold-digest, `graph_overview` direct read, and `GetNode` single read. Soft-delete research is unambiguous that the *residual* leak paths are always the unglamorous ones. For this codebase, four remain unlisted:

1. **The `q=` ILIKE search path** (`exploration.go:883-890`, full-payload search): unless the same `state!='dismissed'` predicate is applied there, an operator searching for pollution finds dismissed records re-appearing as if active — and any *future* agent-side search tool built on this filter leaks silently. The doc adds `include_dismissed` to `GET /nodes` and `/graph` — verify the `q` code path is inside that same gate.
2. **`facts_total` cap distortion:** `graph_overview` reads `ListByKind(db.KindFact, 1000)`. Filtering must happen in SQL, not post-fetch — otherwise with >1000 facts the dismissed ones crowd the window and the *non-dismissed* count/`recent_facts` becomes wrong in the other direction (hiding legitimate facts from the planner's situational view).
3. **Evidence citations already written:** 方案 D adds keyword rejection at `prove_goal` write time, but goals already marked `met` citing a fact that is *later* dismissed keep their justification dangling — nothing invalidates the met-goal. Decide explicitly: dismiss-with-cited-evidence warns the operator ("该记录被 1 个已达成目标引用").
4. **Cold-digest *bodies* quoting old text:** `blockSignature` covers member ids + content_version, so a PATCH correctly invalidates. But a digest of a *neighboring* block whose LLM-written body quoted the refusal summary by id/text is not keyed to the patched node. After any dismiss/edit, scan active digest bodies for the node id (cheap SQL) and force re-compaction of hits.

Also pin down by test: the agent tool path must be structurally unable to pass `include_dismissed=true` (parameter allowlist, not convention) — a future generic query-proxy would otherwise forward it.

**Why it happens:**
Soft delete is a predicate repeated by hand in every read path, forever; each new read path is a fresh chance to forget. The classic research finding: "one query, export, or cache layer that was never updated is a path where the deletion was never honored."

**How to avoid:**
Enforce at the lowest layer possible: a single SQL predicate helper (or partial view) that every fact-reading function composes, rather than scattering `AND state != 'dismissed'` literals. Write the leak matrix as table-driven tests: list / single-read / count / source-merge / related-task / digest-body / q-search, each asserting exact ids.

**Warning signs:**
Operator dismisses a fact, then sees it again in any view; planner behavior unchanged after dismissal; `facts_total` doesn't move.

**Phase to address:** Graph-governance batch (C + D/L). The leak matrix belongs in the acceptance tests, not just code review.

---

### Pitfall 4: Degrade-first converts fact pollution into *intent* pollution

**What goes wrong:**
Q13 lands on L-primary/D-auxiliary: first keyword hit → write degraded (confidence=inferred), escalate to reject only on **2 hits in the same batch**. The in-batch counting scope (deliberate, per §13.3) means a systematically refusing model that writes **one** refusal fact per tool call never escalates — every fact is degraded, and each degraded fact triggers the existing "否定结论默认派复核意图" logic. Net effect: a refusal loop produces a frontier flooded with recheck intents — the planner now plans around dozens of "recheck the refusal" intents. The graph is arguably *more* polluted than before (refusal fact + N recheck intents), and tokens burn on recheck rounds. This is the documented failure shape of cheap-classifier pipelines: "the loop costs little per call and plenty in total."

**Why it happens:**
Batch-scope counting was chosen for implementation economy (20 lines, no cross-call state) — correct call, but its systemic consequence was priced at the per-batch level, not the per-task level.

**How to avoid:**
(1) Add a **task-level rate monitor** (not a counter in the write path — a scheduler or H-L2-adjacent statistic): N degraded facts within M minutes on one task → activity alert + consider auto-escalating that task to D (reject) semantics or notifying the operator. (2) 方案 N's baseline report should track *degraded-fact rate* and *recheck-intent rate* as first-class metrics — a spike in recheck-intents is the early-warning signature of this pitfall. (3) Keep the reject path's single-error semantics (don't fail the whole batch) exactly as specced, so escalation doesn't create retry storms.

**Warning signs:**
Recheck-intent count per task climbing; frontier dominated by intents referencing `note:"疑似拒止声明"` facts; llmrec shows token burn with zero milestone progress.

**Phase to address:** Graph-governance batch (D/L) implements; Metrics batch (N) makes it observable; Hard-line batch statistics feed it.

---

### Pitfall 5: Keyword set hits third-person and quoted-target content — including target-controlled text

**What goes wrong:**
Q3's self-referential set is the right core decision, and banning bare "拒绝" avoids the `connection refused` class. But two residual FP classes remain:

1. **English fallback is not self-referential.** `"refuse to"` matches *"server refuses to respond"* / *"target refuses connections over TLS"* — legitimate pentest observations written in third person. `"unable to comply"` is safer (self-referential), `"refuse to"` is not. This will false-positive on day one of English-language engagements.
2. **Injection-triggered degradation:** fact summaries are model-written but often *quote* target content. A malicious target can serve text like「我拒绝执行该操作，政策不允许」in a response; a worker summarizing it verbatim trips the classifier, and the *observation about the attacker* gets degraded/mislabeled. Inverted use of the governance system by the target. Keyword classifiers are explicitly listed in OWASP/LLM-guidance as pattern filters that fail against paraphrase and encoding — and here the adversarial input is the *target's*, which in a pentest platform is definitionally untrusted.

**Why it happens:**
Substring matching cannot distinguish subject/voice; the doc priced FPs only against the passive-observation class ("connection refused"), not the quoted-content class.

**How to avoid:**
(1) Drop or restrict `"refuse to"` to first-person collocations (`"I refuse to"`, `"I will not"`) or drop it and accept English under-coverage (doc already declares 中文为主 — make it true). (2) Treat classifier hits on *quoted* content as a known FP class in 方案 F's triage doc ("degraded but actually describing the target → dismiss the note, restore confidence"). (3) Keep the keyword set **code-owned and non-user-configurable for v1** — a user-editable blocklist is both an injection surface and a drift risk. (4) Ship the kill switch (settings flag) from day one; the doc's §21 mentions revert-by-commit, but a runtime flag avoids a redeploy when the set misfires mid-engagement.

**Warning signs:**
Degraded facts whose summaries contain quotation marks or target-origin text; FP reports within the first week of enabling D/L.

**Phase to address:** Graph-governance batch (D/L). Acceptance 2b must add: "server refuses to respond" style summaries must **not** degrade; quoted-target-content case documented.

---

### Pitfall 6: Judge fail-open silently disables the entire refusal triage

**What goes wrong:**
方案 K fails open (`llm_judge_fail_action` default allow, 宁漏勿错). Correct conservative default — but composed with two other defaults it becomes a silent kill switch: judge profile misconfigured (`llm_judge_profile_id` points at a dead/removed profile — a *very* common ops state, since profiles live in the LLM config page but the judge setting lives in the intercept page per 方案 F), or the judge model starts returning unparseable output. Then *every* suspicious empty round is classified "allow" and H-L2 degrades to statistics-only — while the operators believe the hard line is active. Research note (autorubric PR #6, The Judge Problem): the standard failure is error-induced verdicts indistinguishable from real verdicts; the fix is a structural distinction (`is_error` / CANNOT_ASSESS), never string-matching prose. Also: discard-on-parse-failure makes misclassification *undiagnosable* — one production postmortem could not even recover the judge's raw output.

**Why it happens:**
Fail-open was chosen per-decision; nobody composed it across the deployment lifecycle (profile deleted → fail-open forever).

**How to avoid:**
(1) Structurally separate three outcomes in `ClassifyPlannerRound`: `refusal` / `normal` / `assess_failed` — never let a parse/infra failure emit `normal` silently; log raw judge output on parse failure. (2) Track judge call success rate per task in llmrec (already the accounting table); alert or surface in 方案 N's report when `assess_failed` ratio > threshold. (3) Startup validation: if `planner_refusal_check` is enabled, verify the judge profile resolves at boot and on profile deletion. (4) The 10-minute task-level throttle (§14.2) is right — also add a per-task **budget** (e.g. max classifier calls per task) as the cost circuit-breaker research recommends; multiple concurrently-refusing tasks multiply spend invisibly.

**Warning signs:**
H-L2 corrective retries never firing despite refusal symptoms; judge settings page showing a stale profile id; llmrec has zero judge-call rows for tasks that are visibly looping.

**Phase to address:** Hard-line batch (H-L2 + K). The three-state verdict belongs in the same PR, not a follow-up.

---

### Pitfall 7: Authorization expiry creates a silent deny wall — and credentials get weight-lifted over deny constraints

**What goes wrong:**
Two failure modes in 方案 J, both known in the fail-closed-authorization literature:

1. **Allow→deny transition = task death without an undertaker.** `valid_until` passes; guard flips to deny for exploit-level actions; the *planner keeps planning* and the worker keeps trying — every action denied, every round burning tokens, zero progress, no state change on the task. The doc's mitigation (two activity reminders) informs but does not *act*. Long-running tasks crossing validity boundaries are the common case, not the edge case (compare: lease-expiry detection in scheduler literature — a rising expiry rate precedes waves of duplicate/stuck work).
2. **Privilege confusion in the judge.** Wiring credentials into `ReviewBackground` (§12.2) hands the LLM judge a persuasive "exploit allowed" artifact. Empirical jailbreak research (99Ravens postmortem; "competing instructions overload" pattern) shows models resolve priority conflicts in favor of the *most authoritative-sounding* text. If the credential is the most recent/structured thing in the judge context, the judge starts allowing actions that the deterministic deny-rule table should have stopped. The doc's arbitration (deny > 凭据 > discipline) governs the *prompt text*; it does not automatically govern the *judge's* judgment.

**How to avoid:**
(1) On expiry detection (guard context), also flip task behavior: emit the activity line **and** a broadcast/notify (H-L3's channel exists even if H-L3 is phase 2), and consider auto-pausing the task (pausable per existing task states) rather than letting it grind. Add an acceptance test: task straddling `valid_until` mid-run must not silently burn N rounds at 100% deny. (2) In the judge prompt template, deny-constraint precedence must be stated *above* the credential, and the **deterministic rule table must evaluate before the judge sees anything** (keep the credential as context for "is this in-scope", never as an override token). (3) Verify FK/restore semantics: a restored task with a past `valid_until` must be denied immediately and *visibly* (this is also the acceptance item for archive/restore wiring — see Pitfall 8). (4) Guard wiring should scope the credential strictly by task id — the `ReviewBackground` structure currently binds only `user_message` source and *rejects* worker/scheduler sources (verified in `review_context.go`); adding an `Authorization` attachment must not loosen that source gate, or cross-task credential bleed becomes possible.

**Warning signs:**
Tasks with duration > validity window showing 100% deny rates in guard audit; llmrec spend on tasks with zero facts/findings after the expiry timestamp; judge allowing items the deny table lists.

**Phase to address:** Authorization batch (J). The expiry-transition acceptance test is non-negotiable; the judge-prompt precedence sentence must ship with the wiring.

---

### Pitfall 8: Archive/restore wiring omissions silently destroy the governance guarantees

**What goes wrong:**
The doc correctly mandates adding `governance_log`, `task_authorizations`, and the refusal-audit result table to both the snapshot array (`task_archives.go:578-600`) and the restore loop (`task_archives_restore.go:245`). The pitfall is the *shape* of the mistake, which the doc itself documents: this is a two-line edit in each of **two places per table**, with no compiler or test forcing consistency — the same class of bug as the "independent tables must be added to snapshot array + restore loop" note. Miss the restore line and the table archives fine but vanishes on restore: Q2's "governance_log 不随归档消失" guarantee silently breaks — audit trail exists until the first archive/restore cycle, which is exactly when operators rely on it. Miss the snapshot line and restore emits a row-count warning nobody reads. Additionally, restore of `task_authorizations` rows with past `valid_until` needs defined behavior (immediate deny + activity line — see Pitfall 7.3), or restored tasks resume in an undefined authorization state.

**Why it happens:**
Two parallel hand-maintained table-name lists; new tables are added by copy-paste under time pressure; tests exercise archive and restore separately, not the round-trip.

**How to avoid:**
(1) Write a **round-trip test**: create task with all three new tables populated → archive → restore → assert every row survives and authorization expiry behavior is exercised. Make the test table-driven over the snapshot list so a *new* table that forgot either side fails the test automatically (iterate the snapshot array, assert each has a restore branch). (2) Consider deriving the restore loop from the same table-list constant as the snapshot — a single source of truth is the structural fix.

**Warning signs:**
Post-restore task missing governance history; "table X restored 0 rows" lines in restore output; archive size grows but restore doesn't match.

**Phase to address:** Graph-governance batch (governance_log), Authorization batch (task_authorizations), Metrics batch (audit results) — each must extend the round-trip test, not just the arrays.

---

## Moderate Pitfalls

### Pitfall 9: Reseed version accumulation and the brittle "user modified?" detection

**What goes wrong:**
Every reseed/one-shot migration appends a full new prompt version (correct, non-destructive). But: (a) across future milestones, each rollout adds another version — prompt catalogs bloat and "which version is live" becomes tribal knowledge; (b) the reporter/retester migration pattern compares `CurrentPrompt(a.ID)` against the code constant to detect "user modified" (§11.3) — an **exact string match**. Any innocuous whitespace edit, or a future code-side tweak of the constant, breaks detection and the migration silently skips or double-applies.

**Prevention:**
Table-driven reseed loop (doc already suggests it); store a `prompt_source` marker or version tag alongside prompts rather than diffing bodies; accept version accumulation but add a settings-visible "prompt version map" page/endpoint for operators. Cap: never delete history (existing behavior is right), just make it legible.

**Phase to address:** Prompt batch. Verification: run migration against a DB with user-modified prompts, a fresh DB, and a DB where the prompt was modified *then reset*.

---

### Pitfall 10: Corrective-retry messages accumulate in the planner transcript

**What goes wrong:**
H-L2's corrective retry appends a user message via `ExecuteWithMessage` (resume path). Those messages persist in the session. A task with repeated refusals accumulates「你疑似拒止…请产出意图」messages — priming noise that (a) wastes context, (b) teaches the model that stalling produces these messages, and (c) interacts with Pitfall 1 (a model under compliance pressure may produce *performative* intents to stop the nagging — low-quality intents issued just to satisfy the triage).

**Prevention:**
Mark corrective messages as system-injected in the transcript (or strip from future-round context, keeping only in activity); detect "intent produced immediately after corrective retry with no tool calls" as a *compliance-theater* signature and count it separately from genuine progress in the H-L2 statistics. Confidence: MEDIUM — depends on `ExecuteWithMessage` persistence semantics; verify during implementation.

**Phase to address:** Hard-line batch.

---

### Pitfall 11: Advisory-lock discipline when adding migration code inside `seedFindingRetester`

**What goes wrong:**
The doc correctly places the retester reseed *inside* the existing transaction + `pg_advisory_xact_lock(7337741010)` (verified: `finding_retests.go:209`). Residual risks from the PostgreSQL advisory-lock literature: (a) any *other* new migration function taking a second advisory key in a different acquisition order → classic lock-ordering deadlock; (b) someone "helpfully" converts to session-level `pg_advisory_lock` with a pooled `*sql.DB` — the canonical Go bug where lock and unlock land on different pool connections, wedging the pipeline forever; (c) long work (prompt version append) inside the xact lock holds it longer than expected — acceptable here, but don't add LLM calls or network I/O inside that transaction later.

**Prevention:**
Keep exactly one advisory key namespace; document the key registry (`7337741010` = finding-retester seeding); never introduce session-level advisory locks through the pool; keep the critical section pure-DB.

**Phase to address:** Prompt batch (retester migration).

---

### Pitfall 12: Scheduler watermark first-run skip + non-idempotent audit rows

**What goes wrong:**
方案 N adds `schedKeyLastAuditedTask` following the existing watermark pattern — and the existing `init()` (verified: `scheduler.go`) **seeds the watermark to max-id on first run**, meaning tasks finished *before deployment* are never audited (acceptable, but must be documented or operators will read "0% refusal baseline" as "no refusals"). Conversely, if the process crashes between auditing and watermark advance, the next tick re-audits the same task → duplicate audit rows and doubled judge cost. Classic watermark hazard: "watermark advanced before output write commits = lost data on retry."

**Prevention:**
`UNIQUE(task_id)` on the audit result table with upsert (re-audit overwrites, never duplicates); advance the watermark in the same transaction as the result write; document the first-run skip in 方案 F's ops doc. Bonus: the skip gives a free "baseline starts at deployment" story for the report.

**Phase to address:** Metrics batch.

---

### Pitfall 13: Baseline metrics drift when governance actions delete the measured data

**What goes wrong:**
方案 N correctly reads raw DB rather than filtered views (so `dismissed` still counts). But **hard deletion** removes the row from *every* table except `governance_log` — an operator who cleans pollution before the audit job runs (or re-runs the report later) shifts the denominator/numerator arbitrarily. The doc's watermark trigger (audit at task completion) fixes timing, but nothing stops a post-hoc re-run from reporting a cleaner-than-reality task. The refusal baseline is a *governance effectiveness* metric; letting governance actions edit it makes the metric self-flattering.

**Prevention:**
Audit results are the immutable record (write-once at completion; re-runs append a new revision row, never overwrite). Include `governance_log` counts (deletes/dismisses per task) as report dimensions alongside raw rates — "refusal rate 12%, of which 8pp subsequently dismissed by operator" is the honest number.

**Phase to address:** Metrics batch.

---

### Pitfall 14: Discipline text over-generalizes — every refusal record is declared a "false positive"

**What goes wrong:**
The discipline line「读到此前记录中有'拒绝/不予执行'类内容时，视为旧模型的安全策略误报」is a useful countermeasure against cascade refusal, but it is unconditional. A fact recording *「目标方口头要求停止对 8080 的测试」*(a real RoE boundary event, recorded as the operator intends) would be equally ignored by a worker primed to treat all refusal-adjacent records as noise. The治理 system teaches agents to disregard exactly the records the operator writes to steer them.

**Prevention:**
Narrow the line: treat *self-declared model refusal* as stale-noise, but「操作员/deny 约束/hint 中的停止指令永远生效」must be stated alongside it. Belt-and-suspenders: such operator records should be written as hints/constraints (which structurally outrank), never as facts — add this to 方案 M's template guidance.

**Phase to address:** Prompt batch + Template batch (M).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Scattered `state != 'dismissed'` literals per query | 5-minute implementation | Every future read path re-rolls Pitfall 3; untestable | Never — use the shared predicate helper |
| Keyword set as inline slice in tools.go | One-file change | Two consumers (D/L + prove_goal) drift apart; can't kill-switch per environment | Acceptable for v1 *if* both sites import one shared helper (doc already requires this) — extract to config later |
| In-batch-only refusal counting (Q13) | No cross-call state, ~20 lines | Misses systematic per-call refusal (Pitfall 4) — needs compensating task-level monitor | Acceptable, *with* the N-metric monitor |
| Copy-pasting `UpdateGoalPayload` for `UpdateFactPayload` | Fast | Missing `content_version` bump → stale digest forever (doc flags; restated as the archetype of "copy the wrong precedent") | Never — the doc already bans it |
| Two hand-maintained archive table lists | Matches existing code style | Pitfall 8 class of bug recurs per new table | Acceptable for v1 only with the round-trip test |
| Skipping the judge `assess_failed` third state | Simpler enum | Pitfall 6 — silent triage disablement | Never |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Go `database/sql` + advisory locks | Lock/unlock on different pool connections (session-level) | Only `pg_advisory_xact_lock` inside one transaction (current code is correct — keep it) |
| Intercept judge config | Operator tunes judge in the LLM config page | Judge profile lives at `llm_judge_profile_id` in **intercept** settings (方案 F doc must be loud about this — it's the #1 misconfiguration behind Pitfall 6) |
| reseed settings flags | New flag per agent, copy-pasted functions | Table-driven loop over the six builtin agents (doc suggests; each still needs its own flag) |
| `json_populate_record` restore | Adding columns to `tasks` | New data in independent tables only (doc decided; don't relitigate) |
| scheduler watermarks | Assuming at-least-once is harmless | Audit writes must be idempotent (`UNIQUE(task_id)` upsert) — Pitfall 12 |
| Next.js embedded UI | Treating 20s graph-tab polling as consistent with agent-side filtering | After governance actions, trigger immediate re-pull (doc plans this); keep "show dismissed" state in URL so refresh doesn't silently flip the operator's view |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Cold-digest recompute churn after bulk dismiss | LLM compaction cost spike, planner latency after cleanup sessions | Batch governance actions; signature recompute is per-block — bulk dismiss of one block's members amortizes | >20 facts dismissed in one session on a large graph |
| Judge cost per refusing task | llmrec rows pile up on looping tasks | §14.2 throttle (10 min) + per-task call budget (Pitfall 6) | Any long-lived refusing task; multiplies with concurrent refusing tasks |
| `ListByKind(kind, 1000)` windows | facts_total/recent_facts wrong on big graphs | Push filtering into SQL; consider count query separate from window | Graphs >1000 facts (large engagements) |
| Prompt size growth via reseed accumulation | Token cost per round, dilution (Pitfall 2) | Keep discipline sections tight; resist adding "one more line" per incident | After 2–3 milestone rollouts |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Treating keyword-set hits as ground truth on target-quoted content | Target-controlled text manipulates governance state (Pitfall 5.2) | Degrade (not reject) on hit; operator review loop via N report; documented FP class |
| Credential text pasted into task descriptions as proof of authorization | Untrusted text wears authority; model/judge weight-lifts it (instruction-privilege-escalation class, arXiv 2608.27299) | Real authorization = `task_authorizations` rows (structured); template (M) steers users there; discipline text says credentials are verifiable *only* via `get_authorization` |
| `include_dismissed` forwarded by agent tool paths | Model-side visibility of dismissed records (the core Q1 guarantee) | Server-side: reject the param on agent-authenticated routes; UI-only flag |
| `governance_log` rows deletable/updatable via generic CRUD | Audit trail tampering | No UPDATE/DELETE endpoint, ever; DB role-level restriction if practical |
| Agent-side fact-deletion tool "just for convenience" | Model rewrites history | Doc already bans (§5.1.5) — keep it banned; governance is human-only |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Dismissed nodes rendered faded but without reason/actor | Operator can't tell what happened or why | Tooltip: who dismissed, when, from governance_log |
| Hard-delete confirm dialog without showing citations | Operator deletes a fact cited by a met goal (Pitfall 3.3) silently | Confirm dialog lists dependent references |
| "显示已否定" toggle silently resets on navigation | Operator thinks records vanished | Persist toggle in URL/localStorage |
| Audit card entries linking to actions the operator can't perform (inherited facts) | Dead-end links | Inherited/related-task entries render read-only with explanation |

## "Looks Done But Isn't" Checklist

- [ ] **Dismissed visibility:** verified on ALL of — list page, single `node_detail` read (placeholder text), `graph_overview` counts AND `recent_facts`, source-merge pages, `relatedTaskOverviews`, cold-digest members AND digest *bodies*, `q=` search path, agent tools structurally unable to pass `include_dismissed`
- [ ] **Keyword set:** "connection refused"/"403 拒绝访问" NOT caught; "我拒绝执行" caught and degraded; "server refuses to respond" NOT caught (or consciously accepted); same helper imported by both D/L and prove_goal evidence check; kill-switch flag flips behavior at runtime without redeploy
- [ ] **Reseed:** tested on fresh DB, stock DB, user-modified-prompt DB, and modified-then-reset DB; pentest + auto (agents with no prior reseed path) verified; reporter "user modified?" detection robust to whitespace
- [ ] **Archive/restore round-trip:** governance_log, task_authorizations, audit results all survive archive→restore; expired credential after restore denies visibly
- [ ] **H-L2:** legitimate wait (frontier non-empty) never triaged; retry fires exactly once per round; counter recovered from activity after restart; corrective messages don't accumulate unboundedly
- [ ] **Judge (K):** three-state verdict; raw output logged on parse failure; throttle window verified via activity; per-task budget enforced
- [ ] **Authorization (J):** mid-task expiry transition flips guard decisions (test crosses `valid_until` during a live task); deny > credential precedence holds in judge prompt; guard wiring doesn't loosen the `user_message`-only background source gate
- [ ] **Baseline (N):** report unaffected by operator dismiss/hard-delete timing; first-run watermark skip documented; re-run is revision-append not overwrite

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Fabricated findings shipped (Pitfall 1) | HIGH | Identify via retester disagreement + N-report anomalies; mark findings unverified; re-run affected intents with explicit "verify, don't trust prior records" hints; add escape-hatch line |
| Keyword set mass-FP in production (Pitfall 5) | LOW | Flip kill-switch flag; bulk-restore degraded facts (confidence + note cleanup via SQL); tighten set; redeploy flag change |
| Poisoned graph post-milestone (Pitfall 3/4 backlog) | MEDIUM | Use N-report + `q=` search to enumerate; batch dismiss via governance API (each action logged); watch digest recompute cost |
| Judge silently disabled (Pitfall 6) | LOW | Fix profile id; historical suspicious rounds are re-classifiable only manually — accept gap, fix metric |
| Task wedged at 100% deny post-expiry (Pitfall 7) | LOW | Extend `valid_until` (or re-authorize); task resumes next round; write postmortem activity line |
| Restore lost governance history (Pitfall 8) | MEDIUM | Rows unrecoverable if snapshot missed the table; if snapshot has them but restore skipped, re-run restore after fix |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 Fabrication cliff | Prompt batch | Broken-target task ends honest; zero fabricated successes |
| 2 Discipline decay | Prompt batch (+H-L2 as monitor) | Refusal-rate-vs-duration correlation flat in N-report |
| 3 Dismissed leaks | Graph-governance batch | Leak-matrix table tests (8 surfaces) |
| 4 Intent pollution via degrade | Graph-governance + Metrics | Recheck-intent rate metric; task-level degraded-fact alert fires in constructed loop |
| 5 Keyword FP classes | Graph-governance batch | Acceptance 2b extended cases; kill-switch flips live |
| 6 Judge fail-open masking | Hard-line batch | `assess_failed` path test; stale-profile startup warning; raw-output logging |
| 7 Expiry wall / credential confusion | Authorization batch | Mid-task expiry test; judge precedence prompt test; deny-table-before-judge ordering |
| 8 Archive/restore wiring | All three DB batches | Table-driven round-trip test over snapshot array |
| 9 Reseed accumulation | Prompt batch | Four-DB-state migration matrix |
| 10 Retry-message accumulation | Hard-line batch | Transcript-length bound test across repeated refusals |
| 11 Advisory-lock discipline | Prompt batch (retester) | Lock-key registry documented; code review gate on new advisory keys |
| 12 Watermark skip/dupes | Metrics batch | UNIQUE(task_id) upsert; crash-between test (or by-construction transactional) |
| 13 Baseline self-flattering | Metrics batch | Re-run produces revision, numbers immutable; governance_log dimensions shown |
| 14 Over-broad noise dismissal | Prompt + Template batches | Operator-stop-record scenario in acceptance |

**Sequencing constraints for the roadmap (derived from the above):**
1. Shared keyword-set helper + kill-switch flag must land in the **same commit** as the first D/L consumer (two consumers must never diverge).
2. The archive/restore round-trip test harness should be built **before** the first new table (governance_log) is added — retrofitting tests after three tables exist is how Pitfall 8 happens.
3. H-L2 needs `WriteCounts.Intents` **before** the triage PR (doc §10.2 — a hidden prerequisite that will otherwise silently break the 0-new-intent detection).
4. 方案 N's report depends on L's note marker, H-L2's activity lines, and K's verdict records existing — it is correctly last; also make it read `governance_log` from day one (Pitfall 13).
5. J's guard wiring must not proceed without the judge-prompt precedence sentence and the expiry-transition acceptance test — wiring without semantics is the risky half.

**Explicit v1 exclusions (risk-driven, beyond the doc's Q4/Q7 deferrals):**
- **Batch UI dismiss** (doc already defers) — bulk governance actions amplify Pitfall 3 leaks and Pitfall 4-adjacent digest churn.
- **User-editable keyword sets** — injection surface + drift (Pitfall 5).
- **Agent-side deletion/dismiss tools** — doc bans; keep banned even when operators ask.
- **Auto-dismiss automation (LLM-driven cleanup)** — tempting follow-up to N's report; converts audit into an unreviewed write path. Human-in-the-loop only for v1.
- **`SummaryOnly` NodeFilter** — optional per doc; harmless, but do not let it displace the leak-matrix tests in priority.

## Sources

**Codebase-verified (HIGH confidence — read in this repo, 2026-10-10):**
- `server/finding_retests.go:209` — `pg_advisory_xact_lock(7337741010)` inside seedFindingRetester transaction
- `agent/coldgraph.go:285-295` — `blockSignature` over member/anchor ids + content_version
- `intercept/review_context.go` — `ReviewBackground` source-gating to `user_message`; `BuildReviewInput` selection logic and its test
- `db/task_archives.go:570-605` — snapshot table array; restore path via `json_populate_record` (per doc §12.2.1)
- `server/scheduler.go:30-58` — watermark keys + first-run init seeding to max-id
- `db/schema.sql:234` — `fact.state IN ('confirmed','dismissed','origin')`; edges `ON DELETE CASCADE`; `activity.node_id` SET NULL
- `docs/拒止污染治理方案.md` — full design doc (solutions A–N, Q1–Q15)

**External failure-mode research (2025–2026, MEDIUM–HIGH confidence):**
- Lost in the Middle (Liu et al., TACL 2024) + 2026 attention-decay/GAR crossover studies — system-prompt compliance decay in long sessions
- "Schema-Compliance-Trap" study (78,631 evals, 11 models) — the "never refuse / don't say I don't know" binary cliff and the one-line escape-hatch fix
- Strix pentest-agent system prompt (public repo) — production example of scope-bounded "never refuse" discipline; scope is platform-verified, user text cannot expand it
- 99Ravens red-team postmortem (2025-09); promptinjectionpayloads.com "competing instructions overload" — instruction priority confusion, authority weight-lifting
- arXiv 2608.27299 — instruction privilege escalation in agent harnesses
- OWASP LLM Prompt Injection Prevention Cheat Sheet — pattern-filter limits, action screening, model-based guardrail caveats
- autorubric PR #6 (error-induced vs real verdicts); FlowVerify & PerkinsLab "LLM judge in production" (2026) — fail-open masking, parse brittleness, raw-output retention, cost circuit breakers
- qaskills.sh / safeguard.sh / voxire.com soft-delete leak research (2026) — leak matrices, count/row divergence, index and cache lag
- monpg.app, konadu.dev (PgBouncer), vubon.dev — advisory locks: session vs xact, pool pinning, lock-ordering deadlocks, key registries
- seeitflow.com, narcissmiclaus.com — watermark/replay idempotency, first-run watermark semantics
- AutoPenBench (EMNLP 2025 industry), CheckMate (arXiv 2512.11143), PentestEval (2025) — autonomous pentest agent failure baselines (21–31% end-to-end success; planner/executor stalls, empty-progress loops)

---
*Pitfalls research for: ARTEX refusal-contamination governance milestone*
*Researched: 2026-10-10*
