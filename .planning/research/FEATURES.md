# Feature Research

**Domain:** AI refusal-contamination governance for an autonomous AI penetration-testing platform (brownfield: Go backend + Next.js operator console)
**Researched:** 2026-10-10
**Confidence:** MEDIUM-HIGH (pentest-domain and OWASP-standard items verified against primary sources; governance-platform and UX patterns from corroborated vendor/industry sources)

> Methodology note: the GSD research-plan seam (gsd-tools.cjs) could not run in this environment (no Node.js binary available), so providers were used directly via websearch/webfetch. Confidence tiers were assigned per the source-hierarchy heuristic: standards and official vendor docs = HIGH; cross-checked vendor analyses = MEDIUM; single-source commentary = LOW. No LOW-confidence claim is presented as authoritative below.

---

## Framing: What "Refusal Contamination Governance" Maps To

ARTEX's problem — a model's refusal statements written into a persistent exploration graph, then read back by downstream agents and amplified into cascading refusals — is a **benign-instance of OWASP ASI06: Memory & Context Poisoning** (OWASP Top 10 for Agentic Applications, 2026). The contamination mechanism (model writes a belief into persistent state → later sessions act on it) is structurally identical to what OWASP classifies, even though the "poison" here is the model's own safety policy rather than an attacker's payload. This matters for feature research because it means the ASI06 control set is the most directly applicable standard, and vendor adoption of ASI06 controls has already crossed into "table-stakes for evaluation" territory as of mid-2026 (per Vectorize's procurement-checklist analysis, corroborated by feature-request issues across Mem0/Letta/CrewAI).

Second frame: AI pentest platforms (XBOW, Pentera, CyberSilo agentic pentesting) have converged on a governance checklist — documented authorization, enforceable scope, human approval gates, preserved logs and validation evidence, pause/constrain capability. ARTEX's design doc solutions A–N should be judged against both frames.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features an operator of an AI-agent governance system expects in v1. Missing any of these makes the governance story feel incomplete — the operator cannot trust or verify the cleanup.

| Feature | Why Expected | Complexity | Notes | Design Doc Coverage |
|---------|--------------|------------|-------|---------------------|
| **Write-path screening of agent memory writes** | OWASP ASI06 layer-1 control ("every retain operation gets policy-evaluated before content lands in storage"); guardrails frameworks (NeMo Guardrails, OpenAI Agents SDK guardrails, Llama Guard) all treat output inspection before persistence as baseline | LOW-MEDIUM | Screening must distinguish self-referential refusal statements from objective negative observations — in pentest, "connection refused / 403" are high-frequency true observations, so naive keyword matching fails (documented 16% FP rates for generic guardrails like NeMo on adversarial benchmarks) | ✅ D/L: self-referential keyword set (bare "拒绝" banned), degrade-first/reject-second. **Covered, and domain-tuned beyond generic products** |
| **Operator cleanup UI: soft-dismiss, hard delete, edit** | Content-moderation editorial workflows (Drupal Workflows, AWS A2I human-review queues) all provide dispositions beyond binary keep/delete; reversible-first deletion frameworks (LogRocket undo/soft-delete decision framework) treat soft delete + confirmation-gated hard delete as the standard pair | MEDIUM | Soft-dismiss must render as tombstone (reduced opacity/strikethrough), not vanish — operator needs to know governance happened | ✅ C: DELETE (confirm dialog) / PATCH dismissed / PATCH summary-detail. **Covered** |
| **Dismissed content fully hidden from the model side, across every read path** | The single most common failure mode in memory-governance systems is partial filtering — poisoned content leaking through inheritance, summaries, or direct id lookups (ASI06 vector 2: cross-scope promotion; scope-isolation is a prescribed control). OWASP Agent Memory Guard's read+write dual screening exists precisely because read-path-only or write-path-only filtering is known-insufficient | MEDIUM | Must cover: list views, cross-task inheritance/merge, cold-digest folding, overview counters, AND single-node id reads (lineage edges and history keep dead ids alive) | ✅ Q1: full-path filtering incl. GetNode placeholder + inheritance merge page + graph_overview direct reads; agent tools never receive include_dismissed. **Covered exceptionally thoroughly — this is where the design doc exceeds typical implementations** |
| **Governance audit log that survives archival** | Immutable audit trails are the #1 table stakes across all surveyed LLM governance platforms (Braintrust/Galileo/Fiddler/Credo comparison: "immutable trace logs, scorer results attached to each trace" = Layer-2 production audit); ASI06 layer 5 requires per-decision audit events | LOW-MEDIUM | Key trap (design doc correctly identified): activity logs that cascade-delete with task archival erase governance history. Independent table required | ✅ Q2: `governance_log` independent table (finding_cases paradigm) + activity dual-write for in-task display. **Covered** |
| **Authorization recorded as first-class, queryable data with expiry fail-safe** | AI-pentest governance frameworks (XBOW: "record who approved the test, the authorized scope, configuration, where human approval is required"; NIST CSRC RoE definition; SOC 2 pentest evidence requirements) — written authorization is the foundation of the entire domain | MEDIUM | Expiry semantics must fail safe (deny) with pre/post reminders, because silently-fully-denied tasks are their own failure mode | ✅ J: `task_authorizations` table (authorizer/valid_until/scope/action_level) + `get_authorization` read-only tool + guard wiring + expiry deny/ask configurable. **Covered; matches X-BOW checklist almost line-for-line** |
| **Refusal-rate baseline metric** | Over-refusal is a measured, benchmarked phenomenon (FalseReject, OR-BENCH, XSTest — refusal rate is a first-class eval metric for all major model releases); "you cannot govern what you do not measure" | LOW-MEDIUM | Critical methodology point the design doc got right: metrics must query raw DB, not the operator-filtered view, or dismissals shrink the numerator and the baseline drifts | ✅ N: scheduler watermark audit job + independent results table + per-task card. **Covered (per-task scope — see gaps for the cross-task version)** |
| **Machine retry-with-correction, bounded to one attempt** | Agent-framework standard: LangGraph interrupt/resume feeds the human decision reason back to the agent; bounded retry avoids infinite token burn (OpenAI Agents SDK tripwires halt execution and leave retry policy to the application — every production system adds a bound) | LOW | Retry must not write graph state (no refusal trace on retry path) and must not be distinguishable from legitimate waiting rounds | ✅ H-L2: corrective user message via existing resume mechanism, retry once, activity-only logging. **Covered** |
| **Escalation to human on persistent failure** | The "autonomy dial-back" pattern is universal: consecutive-failure counters → system custody → human alert (Cortex "approval inbox is the floor"; IBM/Credo human-oversight requirements; EU AI Act human-oversight provisions) | LOW | N=3 failures → hint custody, M=2 more → operator alert; parameters must be configurable | ✅ H-L3: hint-based system custody + explicit operator alert, both via existing channels. **Covered (with activity-backfill for restart-resilient counters)** |
| **Fail-open default for low-stakes classifiers + cost throttling** | Guardrail best practice: fail action configurable per channel, fail-open for availability-sensitive/low-stakes classifications ("宁漏勿错"); cost throttling is required when the classifier sits on a hot loop (planner rounds fire repeatedly) | LOW | Without throttling, a refusal-looping task becomes an LLM-billing loop — the governance system must not become its own incident | ✅ K: `llm_judge_fail_action` reuse + task-level throttle (10 min default, settings-configurable). **Covered** |
| **Detection-to-remediation linkage** | Moderation queue UX standard: every flagged item links directly to its disposition action (one click from report row → cleanup). Detached reports rot | LOW | The audit card's rows must deep-link into the graph node with cleanup actions, not just display | ✅ N→C: audit card items jump to dismiss/delete. **Covered** |
| **Guided task creation with authorization templates** | ROE templates are standard industry practice in manual pentest (scope boundaries, authorized actions, exclusions, deliverables in every RoE document); input normalization at creation time is cheaper than runtime correction (design doc's own thesis, validated by industry practice) | LOW | Templates must sync-fill both description and structured fields (constraints + credentials), not just paste text | ✅ M: 3–5 scenario templates, one-click fill, syncs J credential fields + paired allow/deny constraints. **Covered** |
| **Prompt-level authorization discipline deployed across ALL agent roles, with migration for existing deployments** | System-prompt policy is the baseline layer every stack expects (XBOW authorization framework; guardrails layering always includes behavioral instruction); migration for brownfield is the differentiating half — reseed must cover existing DBs or governance silently doesn't apply to old deployments | MEDIUM | 8 agents, 3 seed paths (BuiltinPromptSeeds / reporter one-shot migration / retester advisory-lock migration) | ✅ A+I: unified discipline section, per-role tailoring, reseed flags, priority arbitration (deny > credentials > discipline). **Covered** |

### Differentiators (Competitive Advantage)

Features that set ARTEX's governance apart from both generic guardrails products and competing AI-pentest platforms. Not expected, but valuable.

| Feature | Value Proposition | Complexity | Notes | Design Doc Coverage |
|---------|-------------------|------------|-------|---------------------|
| **Degradation-not-blocking contamination handling** | Generic guardrails block (tripwire) — which in an autonomous loop risks retry-storms and new idle loops. Degrading a suspected refusal to `confidence=inferred` + note turns the contamination into a weak-evidence re-verify trigger instead of a dead-end marker. This is a novel middle disposition between allow and block | LOW-MEDIUM | Only degradation library with an upgrade path: second consecutive hit in the same batch escalates to forced rewrite | ✅ Q13/L-primary: degradation-first, reject-second. **Differentiator as designed** |
| **Domain-tuned self-referential keyword classifier** | Generic classifiers show material false-positive rates on domain content (NeMo Guardrails: 16.22% FP in adversarial benchmark studies); the self-referential pattern set ("拒绝执行" but never bare "拒绝", compound-only ethics terms) is a pentest-specific craft that avoids systematically destroying true negative observations | LOW | Must be treated as living config — see gaps for the tuning feedback loop | ✅ Q3: covered in design; tuning workflow is a gap (see below) |
| **Clean-room rerun with lineage preservation** | Context quarantine/clean-slate restart is a known multi-agent pattern (sub-agent context isolation as firebreak), but exposing it as an operator option with `derived_from` lineage on the new intent — so post-hoc analysis can trace "this direction was refused, then re-executed clean" — is beyond what frameworks ship | MEDIUM | Requires terminal-intent handling (cancel/blocked_reason skip-claim) that current Frontier/ClaimIntent lacks — real new behavior, not just a flag | ✅ E: fresh=true + derived_from + cancel/skip-claim. **Differentiator** |
| **Archival-surviving, disposal-aware metrics methodology** | Auditing raw DB (dismissing records doesn't shrink the refusal count) is methodologically superior to naive dashboards and directly answers the "did the model/prompt change help?" question — the metric cannot be gamed by the governance actions themselves | LOW | Per-task today; a cross-task trend view would be a further differentiator (see gaps) | ✅ N data-plane: covered. Cross-task view: gap |
| **Consecutive-failure counters that survive restarts via activity backfill** | Small craft detail with outsized effect: naive in-memory counters reset on process restart, so long-running refusal tasks never accumulate to escalation. Reconstructing the base from the activity stream is a correctness differentiator | LOW | Covered by the same activity records H-L2 already writes | ✅ H-L2 revision ⑤: covered |
| **Prove-goal evidence screening** | Screening evidence citations to `prove_goal` (a refusal-fact could prematurely close a task — worse than contaminating the planner) is a contamination vector generic memory-guard products don't think about because they lack a "goal completion" concept | LOW | Reuses the shared keyword helper | ✅ D/L extension: covered |

### Gaps (Feature-Level Items the Design Doc Does NOT Cover)

These are not defects — most are deliberately deferred or out of proportion for a single-operator embedded platform — but the roadmap should know they exist.

| Gap | Why It Matters | Suggested Disposition |
|-----|----------------|----------------------|
| **Keyword-set tuning feedback loop** | Q3 says "上线后按误伤反馈调" — i.e., tuning requires a code change + reseed cycle. Every false positive/miss costs a redeploy | v1.x: move keyword set to settings (or add a "was this disposition wrong?" marker on degraded facts feeding N's report). LOW complexity, high operator-QoL return |
| **Cross-task refusal trend dashboard** | N is per-task. The stated motivation ("换了模型/改了提示词之后到底好了多少") is inherently a comparison across tasks/models — needs an aggregate view over the results table | v1.x: read-only aggregate API + simple trend card over `governance` results table. LOW complexity (data already lands in the independent table) |
| **Quarantine/hold disposition** | OWASP Agent Memory Guard defines 4 dispositions (allow/redact/quarantine/block); ARTEX has degrade(≈redact)/reject(block)/dismiss(≈remove) but no "flagged, pending operator review" intermediate state. N's audit card partially substitutes (detect → act), but flagged facts remain model-visible until a human acts | Accept for v1 (degradation + audit card covers the operational loop); revisit if operator review latency proves problematic |
| **Undo for hard delete** | Hard delete is irreversible (activity keeps the text via ON DELETE SET NULL, but the node and its edges are gone). Reversible-actions frameworks suggest grace-period undo for destructive ops | Accept for v1 (confirm dialog + governance_log + dismiss-as-preferred-path is defensible); an "restore last deleted fact" affordance would be cheap if demanded |
| **Tamper-evident audit records** | ASI06 layer 5 prescribes HMAC-signed audit event delivery; governance_log rows are plain rows an operator (or DBA) could edit | Out of proportion for single-operator embedded platform — document as accepted limitation, revisit for multi-operator |
| **Worker-side refusal classification** | K classifies planner empty rounds; N counts refusal facts. A worker that refuses and simply ends its turn without calling record_fact produces no trace in either | Accept for v1 (worker refusals without graph writes still show in activity/transcript; full worker-round classification would double judge cost for marginal coverage) |
| **Batch operations on facts** | Explicitly deferred (首期不做). Common in moderation tooling once contamination volume grows | Correct deferral — single-operator scale doesn't need it; revisit only if N's reports show high per-task contamination counts |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative | Design Doc Position |
|---------|---------------|-----------------|-------------|---------------------|
| **Agent-side fact deletion tools** ("let the model clean up its own refusals") | Feels autonomous; no operator latency | Gives the model history-rewriting power — creates a new, worse contamination class (model erases real observations too, audit trail becomes untrustworthy) | API+UI-only human operations (design doc's choice) | ✅ Explicitly excluded (5.1 constraint 5) — correct |
| **Automatic silent cleanup** (system auto-deletes detected contamination) | Zero operator burden | Destroys the audit trail and the measurement baseline; false positives become silent data loss; operator never learns the model's failure patterns | Degrade (visible, reversible) + report + one-click manual action | ✅ Implied by L-primary + N→C loop — correct |
| **Bare-keyword refusal matching** ("just match 拒绝/refuse") | Trivially simple to build | Catastrophic FP rate in this domain: "connection refused / 403 拒绝访问 / 请求被拒绝" are the most common legitimate negative observations in pentest; systematic degradation of true observations is itself graph pollution (confidence semantics corrupted + spurious re-verify intents) | Self-referential pattern set with explicit ban on bare markers | ✅ Q3 — correct, and the hardest-won constraint in the doc |
| **Fine-tuning the model to stop refusing** | "Fix it at the model level" | Wrong layer: expensive, model-version-locked, doesn't survive model swaps, and doesn't repair already-poisoned graphs; also doesn't address the graph-read contamination loop | Prompt discipline (A/I) + runtime controls (D/L, H, K) at the platform layer | ✅ Project scope statement — correct |
| **Tasks-row JSON credentials column** | One fewer table | `json_populate_record` whole-row UPDATE in archive-restore breaks on schema drift in both upgrade and rollback directions | Independent table + archive-snapshot wiring | ✅ 12.2.1 — correct engineering anti-feature |
| **General content moderation of all facts** ("flag anything suspicious") | One system for all quality issues | Scope explosion; conflation of refusal-governance semantics with general fact-quality; different failure modes need different dispositions | Keep scope to refusal contamination; findings already have their own lifecycle | Should remain out of scope |

## Feature Dependencies

```
[A/I: Prompt discipline + reseed] (source-level, no deps)
    └──reduces demand on──> [D/L: write-path screening]
                                 └──shares──> [Q3 keyword helper] <──reused by──> [K: classifier prompt context]
                                                                                    [prove_goal evidence screening]
[C: fact cleanup DB+API]
    ├──requires──> [governance_log table + archive wiring]
    ├──requires──> [Q1 full-path dismissed filtering] (without it, cleanup is cosmetic for the model side)
    └──is target of──> [N: audit card jump-to-cleanup]

[H-L2: refusal classifier + corrective retry]
    ├──requires──> [WriteCounts.Intents] (new counting)
    ├──requires──> [activity backfill for counter recovery]
    ├──merges──> [K: LLM-judge binary classification]
    └──feeds──> [H-L3: custody + operator alert] (N=3 / M=2 counters)

[J: task_authorizations table]
    ├──requires──> [archive snapshot/restore wiring] (same pattern as governance_log)
    ├──is sync-filled by──> [M: task templates]
    └──wires into──> [guard ReviewBackground] + [A discipline-section priority clause]

[N: baseline report]
    ├──requires──> [L degradation notes] + [H-L2 activity records] (data sources)
    ├──requires──> [raw-DB data plane] (dismissal must not skew counts)
    └──links to──> [C cleanup actions]

[E: clean-room rerun]
    ├──requires──> [terminal-intent cancel / blocked_reason skip-claim in Frontier+ClaimIntent]
    └──enhances──> [A: prompts already treat historical refusals as stale false positives]
```

### Dependency Notes

- **C requires Q1 filtering**: cleanup without full read-path hiding is operator-theater — the model still sees the dismissed record. The design doc correctly sequences these as one unit (C includes Q1).
- **M sync-fills J**: task templates must write credential fields, so M after J (or same batch) — the doc's §17 batch plan respects this.
- **N's data sources include L and H-L2 outputs**: baseline reporting should come after (or with) the mechanisms it measures, else the first reports are empty.
- **K merges into H-L2** (Q12): same PR, shared triggering condition — do not plan as separate features.
- **E is the only feature requiring engine-side frontier/claim changes**: everything else is additive routing, prompt content, or new tables. E is therefore the risk-孤 island — sensible to phase after the core loop works.

## MVP Definition

### Launch With (v1)

The design doc's §17 batch plan is well-formed against this research. v1 must include all of:

- [ ] **A + I + H-L1: discipline prompts across all 8 agents + reseed/migration** — source-level suppression is the cheapest layer and the precondition for everything else being rarely needed
- [ ] **C + Q1 + governance_log: fact cleanup with full-path model-side hiding + archival-surviving audit** — without this, contamination is permanent and governance is unauditable (both are hard table-stakes misses)
- [ ] **D/L with Q3 keyword set: write-path screening, degrade-first** — the ASI06 layer-1 control; the domain-tuned keyword set is what makes it usable
- [ ] **H-L2 + K: planner refusal classifier + bounded corrective retry + throttled judge** — the empty-round refusal form has no other remediation
- [ ] **J: first-class authorization credentials + get_authorization + expiry fail-safe** — the pentest-domain foundation (XBOW checklist item #1)
- [ ] **N + F + B: refusal baseline report + triage docs + authorization templates** — measurement closes the loop; F/B are documentation-grade but part of the governance story
- [ ] **E + H-L3: clean-room rerun + escalation custody** — included per user decision (Q4/Q7 override); E is the only feature touching engine claim logic, so schedule it after C/H-L2 are stable

### Add After Validation (v1.x)

- [ ] **Keyword-set tuning loop** (settings-based set or disposition-feedback markers) — trigger: first false-positive complaint from operators
- [ ] **Cross-task refusal trend view** over N's results table — trigger: more than a handful of completed tasks; also directly serves model-comparison decisions
- [ ] **Restore-last-deleted-fact affordance** — trigger: any operator mis-delete incident
- [ ] **SummaryOnly node search** (NodeFilter change, already sketched in the doc as optional) — trigger: q= full-payload noise annoys operators

### Future Consideration (v2+)

- [ ] **Quarantine disposition state** — defer until operator review latency proves the audit-card loop insufficient
- [ ] **Tamper-evident audit records (HMAC signing)** — defer until multi-operator/multi-tenant deployment is real
- [ ] **Graph-state snapshots/rollback to known-good** (ASI06 layer 5 recovery) — heavy machinery; dismiss+delete+archive covers realistic recovery needs
- [ ] **Worker-round refusal classification** — defer unless N shows material unmeasured worker refusal volume

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Doc Est. |
|---------|------------|---------------------|----------|----------|
| A+I: discipline prompts + reseed (8 agents) | HIGH | LOW | P1 | 1 day |
| C+Q1: fact cleanup + full hiding + governance_log | HIGH | MEDIUM | P1 | ~1 day (within batch) |
| D/L: write-path degrade/reject + keyword set | HIGH | LOW-MEDIUM | P1 | 0.5–1 day |
| H-L2+K: planner hard-line + judge classifier | HIGH | MEDIUM | P1 | 1 day |
| J: authorization credentials + tool + guard | HIGH | MEDIUM | P1 | 1–1.5 days |
| N: refusal baseline report + audit card | HIGH | LOW | P1 | 1 day |
| M: task templates (sync-fill) | MEDIUM-HIGH | LOW | P1 | 0.5 day |
| E: clean-room rerun with lineage | MEDIUM | MEDIUM | P1 (user-pinned) | 二期 batch |
| H-L3: escalation custody | MEDIUM-HIGH | LOW | P1 (user-pinned) | 二期 batch |
| F+B: triage docs + authorization SOP | MEDIUM | LOW | P1 | 0.5 day |
| Keyword tuning loop (v1.x) | MEDIUM | LOW | P2 | — |
| Cross-task trend dashboard (v1.x) | MEDIUM | LOW | P2 | — |
| Quarantine state (v2) | LOW-MEDIUM | MEDIUM | P3 | — |
| Tamper-evident audit (v2) | LOW (now) | MEDIUM | P3 | — |

**Priority key:** P1 = must have for launch · P2 = add when triggered · P3 = future consideration

## Competitor / Reference Feature Analysis

| Feature | XBOW (AI pentest platform) | Pentera (automated pentest) | OWASP Agent Memory Guard (ASI06 ref.) | LangGraph / OpenAI Agents SDK | ARTEX Plan (A–N) |
|---------|---------------------------|------------------------------|----------------------------------------|-------------------------------|------------------|
| Documented authorization (who/scope/validity) | ✅ "record who approved, authorized scope, config" | ✅ approval workflows | — (out of scope) | — | ✅ J task_authorizations |
| Write-time memory screening | — | — | ✅ allow/redact/quarantine/block | ✅ tripwires (halt) | ✅ D/L degrade-first (novel middle disposition) |
| Operator cleanup of poisoned entries | — | — | ✅ quarantine review + snapshot rollback | — | ✅ C dismiss/delete/edit + Q1 hiding |
| Audit trail surviving retention/archival | ✅ "logs preserved to trace what happened" | ✅ audit logging | ✅ per-decision events, SIEM | — | ✅ governance_log (independent table) |
| Refusal/false-positive measurement | Partial (validated findings emphasis) | — | Partial (FP noted as evaluation criterion) | ❌ app-level | ✅ N baseline (raw-DB methodology) |
| Retry-with-correction policy | — | — | — | ✅ LangGraph resume-with-reason; SDK leaves policy to app | ✅ H-L2 bounded retry |
| Human escalation on persistent failure | ✅ "where human approval is required" | ✅ approval workflows | ✅ quarantine→human | ✅ interrupt/HITL | ✅ H-L3 custody+alert |
| Clean-slate rerun with lineage | — | — | Partial (snapshot rollback) | ✅ context quarantine pattern (internal) | ✅ E derived_from (exposed to operator) |
| Pause/constrain capability | ✅ "can testing be paused, constrained" | ✅ | — | — | ✓ existing platform + E skip-claim |
| Templated engagement inputs (RoE) | ✅ (scope definition guidance) | ✅ | — | — | ✅ M templates |

Read: ARTEX's plan covers every pentest-domain governance expectation (XBOW/Pentera column) and every ASI06 control layer except tamper-evidence and snapshots, while adding a disposition (degradation) that no surveyed reference implements. The plan's two genuinely novel elements — degradation-first contamination handling and dismissal-immune metrics — are also its most defensible differentiators.

## Sources

### HIGH confidence (official standards / primary vendor documentation)
- OWASP Top 10 for Agentic Applications 2026 — ASI06 Memory & Context Poisoning definition and five-layer control set (genai.owasp.org; detailed walkthrough: vectorize.io/articles/owasp-asi06, cross-corroborated across Auth0, Teleport, Promptfoo, Arnica analyses)
- OWASP Agent Memory Guard reference implementation — four dispositions, tamper baselines, snapshot rollback (owasp.org/www-project-agent-memory-guard/)
- NIST CSRC — Rules of Engagement (ROE) glossary definition
- LangGraph human-in-the-loop documentation — interrupt/resume with rejection-reason feedback (docs.langchain.com; langchain.com/blog)
- OpenAI Agents SDK — Guardrails/tripwire documentation (openai.github.io/openai-agents-python/guardrails/)
- XBOW — "Ethical Considerations in AI-Driven Penetration Testing: A Governance Framework" (xbow.com/blog, May 2026, fetched in full): authorization/scope, accountability, pause/constrain, validated findings, governance checklist

### MEDIUM confidence (corroborated vendor/industry analysis)
- AI governance platform feature comparison 2026 — four-layer governance stack, immutable trace logs, RBAC, audit export as table stakes (braintrust.dev; corroborating: Galileo, Fiddler, Credo AI positioning)
- Pentest RoE industry practice — scope boundaries, authorization, stop conditions, testing windows (securelayer7, mainnerve, hexnode, rootshellsecurity)
- Over-refusal measurement practice — FalseReject (arXiv 2505.08054), OR-BENCH, refusal-rate as first-class metric
- Guardrails false-positive findings — NeMo Guardrails ~16% FP rate on adversarial-context benchmark (arXiv 2605.06669v2); Llama Guard 3 ~4% FP (digitalapplied.com reference); FPR <5% as 2026 benchmark target (futureagi.com)
- Automated pentest platform features — Pentera approval workflows + audit logging (pentera.io); agentic pentest human approval gates (cybersilo.tech)
- Soft-delete/undo design framework — reversible-actions decision framework (blog.logrocket.com); soft-delete + audit-log patterns (community-corroborated)

### LOW confidence (single-source, directional only — not load-bearing above)
- Context-quarantine as named multi-agent pattern (dataaspirant.com, chierhu.medium.com engineering analyses)
- Agentic AI human-oversight checklist details (sweet.security, cortexrizi.com vendor guidance)

---
*Feature research for: ARTEX refusal-contamination governance (AI autonomous pentest platform, brownfield)*
*Researched: 2026-10-10*
