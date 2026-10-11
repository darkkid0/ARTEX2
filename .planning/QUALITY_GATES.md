# Quality Gates: AI Development Review Protocol

**Defined:** 2026-06-09
**Status:** Project workflow rule

## Purpose

To reduce omissions, hallucinated assumptions, incomplete task splits, and implementation drift, discussion/context capture, planning, and implementation all require self-review plus independent review before the workflow may advance.

These gates apply to phase discussion/context artifacts, phase plans, plan/task split documents, quick-task plans, implementation output, documentation output, and any task status update that claims completion.

Plan-phase step gates: Gate R (Research Readiness) and Gate P (Patterns Readiness) are step-level gates between Gate 0 and Gate A. They force the main session to run `$gsd-plan-phase <N> --research-phase <N>` first (research-only mode produces only RESEARCH.md), pass Gate R 3/3, obtain the PATTERNS.md candidate via a read-only pattern-mapper dispatch, pass Gate P 3/3, and only then run the full `$gsd-plan-phase <N>` which auto-skips research and Section 7.8 because RESEARCH.md/PATTERNS.md already exist. Running the full research-to-PLAN.md chain in one shot is prohibited unless the second-segment reuse exemption applies (artifacts on disk with Gate R/P evidence complete).

Quick tasks are not exempt. In this project, `/gsd-quick` default shortcuts do not bypass gate requirements: after a quick task `PLAN.md` is created or updated, Gate A must pass before implementation; after quick-task implementation or documentation output changes, Gate B must pass before committing or claiming completion.

Gate B is a file-backed gate. A summary, roadmap/state row, commit message, or diary entry can reference Gate B, but none of them can replace the required on-disk Gate B evidence file.

MCP and tool coordination must be explicit. For code discovery and structural source grounding, use tools in this order: `codebase-memory-mcp > CodeGraph > shell search`. Gate evidence should record which responsibilities were covered by codebase-memory-mcp, CodeGraph, shell commands, and tests, or state why a tool was not applicable for a docs-only or read-only task.

## Gate 0: Discuss/Context Readiness

Before a created or updated phase discussion/context artifact may be treated as ready for planning:

1. The context author must perform a self-retrospective of the discussion output and captured decisions.
2. The context author must request an independent review of the discussion/context artifacts.
3. The context author must adjudicate the independent review findings rather than accepting them blindly.
4. Confirmed issues must be fixed in the context, discussion log, and related state documents where applicable.
5. After any confirmed fix or material context/discussion change, the consecutive-pass counter resets to zero.
6. Planning may start only after three consecutive review rounds return no confirmed issues.

The self-retrospective must check at least:

- Scope matches `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, and existing phase/prior-phase context.
- User decisions are captured as durable planning input, while rejected alternatives remain in the discussion log rather than the canonical context.
- Out-of-scope v1 services, features, approval workflows, compliance duties, and external integrations are not introduced.
- Assumptions, implementation discretion, deferred items, canonical references, and code-context pointers are explicit enough for a planner to use without reopening the user discussion.
- The context does not prematurely design task splits, implementation details, or verification results that belong to later planning or execution gates.

## Gate R: Research Readiness

Before `{PADDED_PHASE}-RESEARCH.md` may be consumed by pattern-mapping or planning, it must pass this gate:

1. **Applicable artifact:** `{PADDED_PHASE}-RESEARCH.md` (e.g. `01-RESEARCH.md`). `{PADDED_PHASE}-VALIDATION.md` is NOT produced by `gsd-plan-phase --research-phase <N>` (gsd-core research-only mode exits before Section 5.5+). VALIDATION.md is created by Section 5.5 per its own skip conditions (both `nyquist_validation_enabled` and `research_enabled` active and RESEARCH.md containing a `## Validation Architecture` section); it is created when research actually runs (new research or a `--research` re-run) and also on `--reviews`/`--gaps`/`--skip-research` runs when a RESEARCH.md already exists on disk. The standard second-segment full run (existing RESEARCH.md, no `--research`) skips Section 5.5 via Section 5.1's "Use existing, skip to step 6" and surfaces a missing-VALIDATION.md prompt at Section 7.5 instead. Gate R does not require VALIDATION.md to exist.
2. **Trigger point:** After RESEARCH.md is written to disk and before the pattern-mapper step starts. The research author must perform a self-retrospective of the research output before requesting independent review.
3. **Review scope at minimum:**
   - Consistency with the root REQUIREMENTS.md single-source-of-truth index, ROADMAP.md, PROJECT.md, and the phase goal.
   - Frozen technology stack and architecture boundary constraints from `.planning/research/` are honored; no new technology or architecture is silently introduced.
   - No out-of-scope v1 services, features, or compliance duties are introduced.
   - Validation architecture completeness where RESEARCH.md contains a Validation Architecture section.
   - Explicit assumptions, deferred items, canonical references, and code-context pointers are usable by a planner without reopening user discussion.
4. **Evidence file:** `{PADDED_PHASE}-GATE-R-REVIEW.md` in the phase directory (e.g. `01-GATE-R-REVIEW.md`), recording self-retrospective, independent review rounds, adjudication, confirmed fixes, and the final consecutive-pass count. Gate R evidence records only the intended handling of VALIDATION.md; the actual outcome is appended after Section 5.5 creates it (on a research run or a `--reviews`/`--gaps`/`--skip-research` run with an on-disk RESEARCH.md) or the second-segment Section 7.5 prompt is resolved.
5. **Three consecutive passes and reset:** Same semantics as Gate 0 — three full independent review rounds with no confirmed issues after adjudication. Any confirmed fix or material research change resets the counter to zero.
6. **Fail-closed:** If Gate R evidence is missing or not at 3/3, pattern-mapping and planning MUST NOT consume RESEARCH.md.
7. **Transition clause:** pre-existing RESEARCH.md files (created before this gate existed, without `{PADDED_PHASE}-GATE-R-REVIEW.md`) are not exempt: before a future replan may consume them, the main session must run Gate R on the existing artifact and record 3/3 passes. This applies to the second-segment reuse exemption and the `--reviews` replan path alike.
8. **Relationship:** Gate R depends on Gate 0 having passed. Gate A does not replace Gate R/P; it is an independent gate at the PLAN.md level.
9. **VALIDATION.md provisioning:** Gate R does not require VALIDATION.md to exist at review time, but before the second-segment full run (reuse run) the main session SHOULD create `{PADDED_PHASE}-VALIDATION.md` by performing the Section 5.5 equivalent: after confirming the Gate-R-approved RESEARCH.md contains a `## Validation Architecture` section, render the full gsd-core template (`gsd-core/templates/VALIDATION.md`) and fill its frontmatter (`{N}` / `{phase-slug}` / `{date}`), so the second-segment run does not hit the Section 7.5 missing prompt. If RESEARCH.md has no `## Validation Architecture` section, follow the native Section 5.5 behavior: warn and continue without creating the file (plans may fail Dimension 8). If the Section 7.5 missing prompt still appears (VALIDATION.md not provisioned before the run), handle it via the native three options and record the actual outcome in `{PADDED_PHASE}-GATE-R-REVIEW.md`: option 1 (`--research` re-run) regenerates RESEARCH.md and resets Gate R (choose only if a re-review is acceptable); option 2 (disable Nyquist) is a config change; option 3 (continue anyway) leaves the Dimension 8 gap open and VALIDATION.md must still be provisioned afterwards via the Section 5.5 equivalent, with the evidence backfilled.

## Gate P: Patterns Readiness

Before `{PADDED_PHASE}-PATTERNS.md` may be consumed by the planner, it must pass this gate:

1. **Applicable artifact:** `{PADDED_PHASE}-PATTERNS.md` (candidate and main-session disk version both fall under Gate P — the candidate is obtained by the main session dispatching a read-only gsd-pattern-mapper agent or equivalent read-only research; gsd-core has no patterns-only flag, so running the full `$gsd-plan-phase` to trigger Section 7.8 is prohibited because it would reach the planner out of order).
2. **Trigger point:** After PATTERNS.md is written to disk and before the planner starts. The pattern-mapping author must perform a self-retrospective before requesting independent review.
3. **Review scope at minimum:**
   - Fidelity of the new-file-to-existing-pattern mapping; no architecture drift.
   - Core-path port/transaction/state-machine pattern identification is present and consistent with RESEARCH.md conclusions.
   - No cross-domain write-table violations, prohibited dependency directions, or business-meaningful shared/common escape layers are introduced.
   - Exemptions: if research was natively skipped (`--skip-research` / `--gaps` / `--reviews` / interactive "Skip research"), the Gate P evidence must record an explicit exemption reason for the missing Gate R evidence; silent pass-through is prohibited. The exemption applies ONLY when no RESEARCH.md exists on disk — if a pre-existing RESEARCH.md would be consumed by the planner, Gate R (per its transition clause) must still be run and pass 3/3 on it before the planner consumes it; recording a research-skip exemption cannot waive Gate R for an on-disk RESEARCH.md.
4. **Evidence file:** `{PADDED_PHASE}-GATE-P-REVIEW.md` in the phase directory (e.g. `01-GATE-P-REVIEW.md`), recording self-retrospective, independent review rounds, adjudication, confirmed fixes, and the final consecutive-pass count.
5. **Three consecutive passes and reset:** Same semantics as Gate R.
6. **Fail-closed:** If Gate P evidence is missing or not at 3/3, the planner MUST NOT consume PATTERNS.md. This covers ALL paths into the planner, including research-skip branches.
7. **Relationship:** Gate P depends on Gate R having passed (or a recorded exemption). Gate A does not replace Gate R/P.
8. **Byte-consistency of the disk version:** the main session's on-disk PATTERNS.md must be byte-identical to the reviewed candidate; any change after Gate P passes is a material change that resets the consecutive-pass counter to zero and requires re-review before the planner may consume it.
9. **Transition clause:** phases whose RESEARCH.md/PATTERNS.md already exist on disk without Gate R/P evidence (e.g. pre-existing phase directories) are not exempt: before a future replan may consume those artifacts, the main session must run Gate R (and Gate P for PATTERNS.md) on the existing artifacts and record 3/3 passes in `{PADDED_PHASE}-GATE-R-REVIEW.md` / `{PADDED_PHASE}-GATE-P-REVIEW.md`. This applies to the `--reviews` replan path and the second-segment reuse exemption alike.

## Gate A: Plan Readiness

Before any created or updated plan may enter implementation:

1. The author must perform a self-retrospective of the plan.
2. The author must request an independent review of the plan.
3. The author must adjudicate the independent review findings rather than accepting them blindly.
4. Confirmed issues must be fixed in the plan and related planning documents.
5. After any confirmed fix or material plan change, the consecutive-pass counter resets to zero.
6. Implementation may start only after three consecutive review rounds return no confirmed issues.

The self-retrospective must check at least:

- Scope matches `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, and any phase context.
- Requirements, success criteria, dependencies, tests, and rollback/recovery concerns are mapped.
- No out-of-scope v1 services or features are introduced.
- Assumptions, risks, and open questions are explicit.
- Work is split into implementable tasks with clear verification.
- Relevant prior decisions, repeated omission patterns, similar Gate findings, and project invariants from `.planning/` source-of-truth files have been reflected in the plan or explicitly dismissed as not applicable.

For quick tasks, Gate A evidence must live in `.planning/quick/<task>/` and must be recorded after `PLAN.md` exists but before implementation edits begin. The evidence must include self-retrospective, independent review, adjudication, fixes for confirmed issues, final consecutive-pass count, and MCP/tool coordination status.

## Gate B: Implementation Completion

Before implementation output may be committed or task/plan status may be marked complete:

1. The implementer must perform a self-retrospective of the actual diff and produced artifacts.
2. The implementer must request an independent review of the implementation output.
3. The implementer must adjudicate the independent review findings.
4. Confirmed issues must be recorded in the standalone Gate B file, fixed, verified, and recorded again with the fix/verification evidence before the next review round.
5. After any confirmed fix or material output change, the consecutive-pass counter resets to zero and that reset must be recorded in the standalone Gate B file.
6. Commit and status updates are allowed only after three consecutive review rounds return no confirmed issues.

For quick tasks, Gate B is required for code changes and documentation-only output alike. The implementer must create Gate B evidence in `.planning/quick/<task>/` before committing the quick-task artifacts or claiming completion.

Standalone Gate B evidence artifacts are mandatory:

- Phase plan work must create or update `.planning/phases/<phase>/<plan-id>-GATE-B.md` before creating or updating `<plan-id>-SUMMARY.md` as complete, updating roadmap/state completion, committing the plan output, or claiming the plan is done.
- Phase-level completion must create or update `.planning/phases/<phase>/<phase-id>-PHASE-GATE-B-REVIEW.md`, or an explicitly named phase-level Gate B evidence file in the same phase directory, before the phase is marked complete.
- Quick tasks must create or update `.planning/quick/<task>/<quick-id>-GATE-B.md`, or the established `GATE-B.md` name for older quick directories, before `SUMMARY.md`, state rows, commits, or user-facing completion claims.
- `SUMMARY.md` may summarize Gate B and link to the evidence file, but it must not be the only location containing review rounds, adjudication, confirmed fixes, or final pass counts.
- Missing required Gate B evidence means the task, plan, or phase is not committable and not complete, even when tests pass.

Gate B live evidence protocol:

- The required standalone Gate B evidence file must be created or opened before the first independent implementation review round.
- Every independent review round must be appended to that same Gate B file before any follow-up work starts. The entry must include the review round, first-line result (`PASS` or `ISSUES`), scope reviewed, and adjudication.
- If a review reports `ISSUES`, each finding must be adjudicated in the Gate B file as confirmed or dismissed. Dismissed findings require a written reason.
- Every confirmed issue must get a Gate B entry before the next review round that records severity, affected artifacts, root cause or trigger, fix summary, files changed, verification commands/results, and `consecutive_passes: 0` or equivalent reset wording.
- Fixes that exist only in source code, shell history, chat, a later `SUMMARY.md`, `STATE.md`, roadmap row, commit message, or final response do not count as Gate B evidence.
- After any confirmed fix or material output change, previous PASS rounds no longer count. The next independent review is restart round 1/3, and the Gate B file must make that restart explicit.
- `SUMMARY.md`, state rows, roadmap rows, commits, and user-facing completion claims are blocked until the Gate B file contains all review rounds, all adjudications, all confirmed-fix evidence, final verification, and three consecutive no-confirmed-issue rounds.

The self-retrospective must check at least:

- The diff matches the approved plan and does not introduce hidden scope.
- Tests, migrations, seeds, OpenAPI/docs, and operational notes are updated where applicable.
- Money, state machine, permissions, audit, idempotency, and configuration behavior remain consistent with project rules.
- Local verification results are recorded, including tests that could not be run and why.
- No unrelated user changes are reverted or overwritten.
- Source-of-truth self-audit was completed before independent review. The audit must cross-check the plan tasks, requirement ids, working diff, tests, migrations, OpenAPI/docs, audit/security, idempotency, state machine, ledger, background jobs, and operational notes.
- MCP/tool coordination was completed: source-of-truth verification, codebase-memory-mcp structural context first where applicable, CodeGraph fallback where applicable, and targeted shell/test verification.
- The required standalone Gate B evidence file exists at the expected path and is referenced by any later summary or state update.

## Independent Review Rules

- Reviews must be independent of the author or implementer whenever the workflow supports independent review.
- The review prompt must ask for a first-line result of `PASS` or `ISSUES`.
- A `PASS` counts only when the review evidence is coherent.
- If the independent review reports `ISSUES`, each issue must be verified. False positives may be dismissed with a written reason; real issues must be fixed.
- Three consecutive passes means three full review rounds in a row with no confirmed issues after adjudication.
- If any material change affects the reviewed context, plan, implementation output, verification result, or review basis after a pass, the pass counter for that gate resets.
- Recording gate evidence, committing an already-reviewed diff, or updating status according to an already-passed gate does not reset the counter unless it changes scope, reviewed artifacts, or verification conclusions.
- If independent review is technically unavailable, the workflow must fail closed, record the technical reason in gate evidence, and ask the user before bypassing this rule.
- **严禁伪造独立审查 PASS（硬性红线）**：审查者必须与作者/实施者分离。任何 agent 不得以自己名义冒充独立审查者，不得编造、虚构或猜测独立审查的 `PASS`/`ISSUES` 首行结论，不得在未真实执行独立审查的情况下在 gate 证据文件中记录审查轮次或连续通过计数。Gate 证据中的每一轮 `PASS` 必须可追溯到真实执行的独立审查（独立 subagent 的真实输出、人工确认，或等效可核查记录）；审查 prompt 必须要求首行 `PASS`/`ISSUES` 且审查输出必须原样归档。违反本规则视为伪造审查证据：相关 gate 全部重跑，连续通过计数归零，相关任务不得提交，并须在证据文件中如实记录违规事实与整改结论，不得以任何理由掩饰。
- **独立审查优先使用 gsd-core 能力**：发起独立审查时，必须先检查是否存在适用的 `gsd-core` 内置能力（如 `gsd-code-reviewer`、`gsd-plan-checker`、`gsd-verifier`、`gsd-secure-phase`、`gsd-validate-phase` 等审查/校验/验证类 agent 或 skills），优先使用内置能力执行独立审查；仅当不存在适用的 gsd-core 能力时才允许创建通用 subagent，且 gate 证据必须记录该理由。
- **优先使用当前可用的 MCP 工具辅助工作**：在代码发现、结构定位、上下文检索与验证过程中，应优先使用当前会话可用的 MCP 工具（如 `codebase-memory-mcp` 知识图谱、`codegraph` 代码图谱、`context7` 文档检索等）辅助工作；在适用场景下，MCP 工具优先于纯文本 grep/read 搜索，`codebase-memory-mcp > CodeGraph > shell search` 的既有工具优先级继续适用。gate 证据应记录使用了哪些 MCP 工具、以及未使用时的原因。

## Evidence

Each gated task should retain concise evidence near the work artifact:

- Phase or plan work: store the evidence in that phase/plan directory.
- Quick tasks: store the evidence in the relevant `.planning/quick/<task>/` directory.
- If no task directory exists yet, record the gate outcome in the working summary or create a small review note next to the plan.

Evidence should include:

- Self-retrospective summary.
- Independent review result.
- Adjudication.
- Fix summary, affected artifacts, and verification evidence for every confirmed issue.
- Final consecutive-pass count.
- For Gate B, the standalone evidence file path and any later summary/state references to it.

## Bypass

This gate may be bypassed only by an explicit user instruction naming the bypass and the reason. A bypass must be recorded in the relevant plan, summary, or state document.
