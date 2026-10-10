---
last_mapped_commit: 6a2bba46378cbeaab2b39c03df7ace2fb2318f57
last_mapped_at: 2026-10-10
---
<!-- refreshed: 2026-10-10 -->

# Architecture

**Analysis Date:** 2026-10-10

## System Overview

ARTEX is an AI autonomous penetration-testing system: a Go backend (single binary, modular monolith) that drives LLM agents against scoped targets, plus a Next.js frontend that is statically exported and embedded into the binary.

```text
┌──────────────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js 16 SPA, React 19)                │
│        web/src/app (route groups: (auth) (main) (external))          │
│        lib/api.ts → fetch /api/* · lib/types.ts = type contract      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  /api/* JSON + SSE  (JWT or Basic Auth)
┌──────────────────────────────▼───────────────────────────────────────┐
│                     HTTP API + UI host (server pkg)                  │
│  Handler(): `server/server.go` — 264 routes on http.ServeMux         │
│  DTO layer `server/dto.go` · SSE via `server/broadcast.go`           │
│  State `server/manager.go` (Manager) · Runtime `server/engine.go`    │
└───────┬──────────────┬───────────────┬───────────────┬──────────────┘
        │              │               │               │
        ▼              ▼               ▼               ▼
┌──────────────┐ ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐
│ agent pkg    │ │ guard +     │ │ traffic pkg  │ │ supporting pkgs  │
│ Planner /    │ │ intercept   │ │ MITM proxy   │ │ llmpool llmrec   │
│ Worker /     │ │ (approval   │ │ :8788 + blob │ │ enrich evidence  │
│ MainAgent /  │ │ workflow)   │ │ store        │ │ notify report    │
│ ChatAgent    │ │ `guard/`    │ │ `traffic/`   │ │ selfupdate mcphttp│
│ `agent/`     │ │ `intercept/`│ │              │ │ sidequestion     │
└──────┬───────┘ └─────────────┘ └──────────────┘ └──────────────────┘
       │                all above persist through ▼
┌──────▼───────────────────────────────────────────────────────────────┐
│  db pkg — PostgreSQL (pgx/v5 database/sql driver)                    │
│  `db/db.go` Open + seed · `db/schema.sql` embedded, 58 tables        │
│  Stores: DB / AssetStore / ExplorationStore (db/exploration.go)      │
└──────┬──────────────────────────────────────────┬────────────────────┘
       ▼                                          ▼
┌───────────────────┐                 ┌─────────────────────────────┐
│ PostgreSQL        │                 │ data/ (filesystem, gitignored)│
│ (state source)    │                 │ transcripts/*.jsonl · traffic │
└───────────────────┘                 │ blobs · task workspaces       │
                                      └─────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| main entry | boot order: log capture → selfupdate bootstrap → open stores → HTTP serve; exit code = update protocol | `cmd/artex/main.go` |
| Manager | process-wide state: PG handles, in-memory task map, runtime settings (traffic/LLM record/web search/proxy toggles) | `server/manager.go` |
| Server | HTTP surface: auth (JWT + optional Basic), route registration, per-task chat/main-agent orchestration, schedulers | `server/server.go` |
| Engine | event-driven exploration runtime: planner loop + N worker loops per task, pause/kill/steer, activity emit | `server/engine.go` |
| DTO mapping | reshapes db structs into exactly the frontend shapes in `web/src/lib/types.ts` | `server/dto.go` |
| Broadcaster | per-task in-process pub/sub feeding SSE; storage and live stream share one Publish call | `server/broadcast.go` |
| Scheduler | 5s tick; schedules, goal/finding/timeout watermarks | `server/scheduler.go` |
| Planner / Worker / MainAgent / ChatAgent | LLM agents built on norma harness; tool loops, compaction, findings | `agent/planner.go`, `agent/worker.go`, `agent/mainagent.go`, `agent/chat.go` |
| ToolSet | ~50 agent tools (graph read/write, assets, findings, bash, todo…) | `agent/tools.go`, `agent/toolcatalog.go` |
| Guard | safety boundary: PreToolUse hook gate, audit log, Observer/G5 attribution | `guard/guard.go` |
| Interceptor | user-configured intercept rules → pending approvals with channels | `intercept/intercept.go` |
| Traffic | embedded go-mitmproxy; SQLite index + sha256 content-addressed blob store | `traffic/traffic.go` |
| Evidence | binds findings ↔ traffic refs, verifies/stages bodies for export | `evidence/store.go` |
| Enrich | background DNS/HTTP asset auto-completion engine (4 workers) | `enrich/enrich.go` |
| LLM pool / recorder | failover chain (`llmpool/pool.go`); recording Provider decorator (`llmrec/llmrec.go`) | `llmpool/`, `llmrec/` |
| Notify | channels (dingtalk/email/feishu/telegram/webhook/http), filters, rendering | `notify/` |
| Selfupdate | staged-binary swap + rollback with exit-code-75 restart handshake | `selfupdate/selfupdate.go` |
| db pkg | PostgreSQL access; idempotent embedded schema; per-domain store files | `db/db.go`, `db/schema.sql` |
| Frontend API client | typed fetch wrapper; mock mode for Vercel demo | `web/src/lib/api.ts` |

## Pattern Overview

**Overall:** Modular monolith with flat, package-per-domain Go layout + embedded static SPA.

**Key Characteristics:**
- One Go package per top-level directory; dependency direction is strictly `cmd → server → {agent, guard, intercept, traffic, …} → db`. Packages never import `server`.
- The agent runtime is built on the external `github.com/Autumn-27/norma` framework (`norma/llm`, `norma/harness`, `norma/tool`, `norma/hook`, `norma/transcript`, `norma/agentcore`, `norma/compaction`, `norma/noaadapter`, `norma/skill`, `norma/mcp`, `norma/permission`) — it provides the LLM Provider interface, tool/hook harness, and transcript store; ARTEX packages supply domain tools, prompts, and orchestration.
- Dual contract pattern: db package structs and `web/src/lib/types.ts` are the canonical contracts; `server/dto.go` maps one onto the other so internal DB models never leak over the API.
- Event-sourced-ish exploration: all agent work is recorded as `exploration_nodes` (intents/facts/findings) + `exploration_edges` + `activity` rows in PostgreSQL; the frontend reads and live-streams the same records.
- Wiring via function injection: `Server.New` installs closures into `Engine` (`SetAuthoritativeAgentResolver`, `SetReadiness`) and package-level vars (`agent.ToolAugment`, `agent.PromptOverride`) rather than interfaces.
- Build-tag embedding: `-tags embedui` embeds `server/webui/dist` (no-embed build 404s the SPA; run `next dev` separately).

## Layers

**Entry / process layer:**
- Purpose: flags, banner, boot sequencing, graceful shutdown, exit-code protocol
- Location: `cmd/artex/main.go`
- Depends on: `server`, `agent`, `config`, `selfupdate`
- Used by: OS / `start.sh` supervisor

**HTTP layer:**
- Purpose: REST API + SSE streams + embedded SPA serving; auth (JWT HS256 from `data/jwt.key`, optional Basic Auth gate wrapping both /api and UI)
- Location: `server/server.go` (Handler() at `server/server.go:661`), per-domain handler files (`server/conversations.go`, `server/intercept.go`, `server/side_questions.go`, `server/finding_traffic.go`, `server/task_archives.go`, …)
- Contains: handlers, route table, CORS, DTO serialization
- Depends on: Manager, Engine, agent, db, all domain packages
- Used by: frontend, scripts

**Orchestration layer:**
- Purpose: run exploration tasks — planner/worker loops, admission control (concurrency caps), archives, notifications, schedules
- Location: `server/engine.go` (1245 lines), `server/manager.go` (1862), `server/orchestration.go`, `server/scheduler.go`, `server/notifier.go`
- Depends on: agent, db, guard, intercept, traffic, llmpool, llmrec
- Used by: HTTP layer

**Agent layer:**
- Purpose: LLM-driven planner/worker/main-agent/chat agents, tool catalogs, prompt catalog, compaction, side questions, retester
- Location: `agent/` (46 files)
- Depends on: norma framework, db (via db.Node/db.Activity types), intercept (hook context)
- Used by: server orchestration

**Safety layer:**
- Purpose: every tool call passes Guard PreToolUse hooks; intercept rules can block or require human approval; audit entries recorded
- Location: `guard/guard.go`, `intercept/intercept.go`
- Depends on: db (rules), norma/hook
- Used by: agent runs via harness HookRunner

**Data layer:**
- Purpose: PostgreSQL persistence — schema apply, seeding, per-domain stores; plus the separate traffic SQLite index under `data/traffic/_index/index.sqlite`
- Location: `db/` (52 non-test files), `db/schema.sql`; traffic index in `traffic/traffic.go`
- Depends on: pgx/v5 stdlib driver, modernc.org/sqlite (traffic only)
- Used by: all layers above

**Frontend layer:**
- Purpose: dashboard/task/chat/system UI; static export (`output: "export"`), embedded into the binary or served by `next dev`
- Location: `web/src/`
- Depends on: `/api/*` only (dev mode proxies via `web/next.config.mjs` rewrites to `http://localhost:8787`)
- Used by: humans

## Data Flow

### Primary Exploration Flow

1. User creates a task: `POST /api/tasks` → `s.createTask` (`server/server.go`) → `pgdb` insert, Manager registers in-memory `*Task` (`server/manager.go:831` `taskFromPG`)
2. Engine starts the task: `Engine.Run` (`server/engine.go:748`) — idempotent per task; registers one planner routine + N worker routines (`mgr.Workers()`, default 3) + deadline coordinator
3. Planner loop: `Engine.plannerLoop` (`server/engine.go:800`) wakes on `Task.Notify()`/heartbeat → `Planner.Plan` (`agent/planner.go:355`) consults the frontier graph via `db.ExplorationStore` and emits new intents/facts
4. Workers claim: `Engine.claimNext` (`server/engine.go:1237`) reads `Frontier(20)` and `ClaimIntent` (atomic open→running in PG) → `Worker.Execute` (`agent/worker.go:349`) runs the tool loop
5. Tool calls: every call passes `guard.Guard` PreToolUse (`guard/guard.go:57`) → `intercept.Interceptor` rules; matches become pending approvals exposed at `/api/intercept/pending` with a decision channel
6. Writes: findings/facts/assets/edges persist through `db.ExplorationStore` (`db/exploration.go`) and `db.AssetStore` (`db/assets.go`)
7. Activity: `Engine.emitActivity` (`server/engine.go:640`) → `appendActivity` (PG `activity` table) + `Broadcaster.Publish` (`server/broadcast.go`) → SSE handlers (`/api/logs/stream`, task streams in `server/server.go:3009+`) → frontend
8. LLM calls: provider wrapped as `llmrec.Recorder` (`llmrec/llmrec.go:81`) inside `llmpool.Pool` failover (`llmpool/pool.go:82 Stream` / `:130 Complete`); transcripts appended to JSONL under `data/transcripts/` via `norma/transcript.NewStore`

### Traffic Recording Flow

1. MITM proxy on :8788 (`traffic.Open` `traffic/traffic.go:176`) intercepts target traffic; `sink.Response` (`traffic/traffic.go:392`) records each flow
2. Bodies >threshold spill to content-addressed blobs `data/traffic/_blobs/sha256/<2-hex>/…`; index lives in `data/traffic/_index/index.sqlite`
3. `evidence.Store` (`evidence/store.go`) binds findings ↔ traffic refs, verifies sha256, stages exports (`StageFindingsExport`)

### Chat / Side-question Flow

1. Chat page posts a message → main-agent run launched on server background ctx (survives page reload), serialized per task by `chatBusy` (`server/server.go:69`)
2. `/btw` side questions: `sidequestion.SideQuestionService.Answer` (`sidequestion/service.go:22`) uses a PG-stored immutable context snapshot; streamed over SSE (`server/side_questions.go:529+`)

**State Management:**
- Durable state: PostgreSQL (tasks, graph, activity, settings, LLM profiles, schedules) + filesystem (`data/`: transcripts JSONL, traffic blobs, per-task workspaces under `data/tasks/<taskID>/`, evidence)
- In-process state: `Manager.tasks map[string]*Task` guarded by `mu`; `Engine` uses `sync.Map` fields (started/paused/deleting/lastAct…); `Broadcaster.subs`
- Frontend: client-side auth token (`web/src/lib/auth.ts`), cookie-backed UI preferences (`web/src/lib/preferences/`), no server components state beyond routing

## Key Abstractions

**Task (server.Task):**
- Purpose: in-memory handle over a persisted task + its exploration store, lifecycle state, LLM chain state
- Examples: `server/manager.go:29` (`Task` struct), `:80` (`taskLifecycleState` with mutex-guarded snapshot/update)
- Pattern: snapshot-mutate under lock; goroutine wake-up via notify channel

**ExplorationStore:**
- Purpose: per-exploration facade over the graph tables (nodes/edges/anchors)
- Examples: `db/exploration.go:172` — `AddIntent`, `AddGoal`, `Link`, `SetNodeState`, `Frontier`, `ClaimIntent`
- Pattern: store-per-aggregate; DB methods return typed `*ExplorationStore` bound to an expID

**CoreTool (norma actool.CoreTool):**
- Purpose: uniform tool schema/run contract shared by built-in, host, MCP, and skill tools
- Examples: `agent/tools.go:53` (`ToolSet`), `server/orchestration.go:65` (`orchestrationTools`), `server/assembly.go` (skill/MCP augment wiring)
- Pattern: registry + DB `tools` table overrides (description/schema/per-agent binding) applied in `agent/assembly.go:AugmentTools`

**Hook registry (norma/hook):**
- Purpose: PreToolUse/PostToolUse/Stop interception points used by guard, steering, compaction
- Examples: `guard/guard.go:55` (`Hooks()`), `server/engine.go:578` (`steerHooks`)
- Pattern: hooks composed and injected into agent runs

**Channel (notify.Channel):**
- Purpose: pluggable notification sink
- Examples: `notify/channel.go:13`; implementations `notify/dingtalk.go`, `notify/email.go`, `notify/feishu.go`, `notify/telegram.go`, `notify/webhook.go`, `notify/http.go`
- Pattern: `notify.Get(kind)` factory + per-channel config maps

## Entry Points

**Backend binary (`artex`):**
- Location: `cmd/artex/main.go` (`run()` at :47)
- Triggers: `start.sh`/`start.bat` supervisor (relaunches on exit; exit code 75 = restart for self-update), `install.sh`, docker ENTRYPOINT
- Responsibilities: flags (`-addr :8787`, `-data`, `-proxy :8788`), selfupdate bootstrap, open Manager + stores, start HTTP + MITM proxy, graceful shutdown

**HTTP server:**
- Location: `server.New` (`server/server.go:147`), `Handler()` (`server/server.go:661`)
- Triggers: any `/api/*` request or SPA route
- Responsibilities: JWT/Basic auth gate → CORS → route mux → handler → DTO

**Traffic proxy:**
- Location: `traffic.Open` + `tr.Start()` (`server/manager.go:440` goroutine)
- Triggers: target HTTP(S) traffic pointed at :8788
- Responsibilities: MITM recording, CA cert provisioning to agent shells

**Scheduler:**
- Location: `server/scheduler.go:38` (`New`, 5s tick)
- Triggers: wall clock
- Responsibilities: task schedules, goal/finding/timeout watermarks

## Architectural Constraints

- **Threading:** single process, goroutine-per-routine model: per task one planner goroutine + N workers + deadline coordinator, all under one task-scoped context (`server/engine.go:224` `registerTaskRoutines`); deletion cancels that context and drains. Cancellations carry named causes (`context.CancelCauseFunc`) — see `cmd/artex/main.go` shutdownContext comment.
- **Global state:** `server.BuildVersion`, `agent.ToolAugment`, `agent.PromptOverride` (package-level wiring vars), Manager singleton per process, in-memory log sink (`server.StartLogCapture`).
- **Circular imports:** none observed; layering is one-directional. Context-carried values (`intercept.WithTaskContext`, `llmrec.WithTaskID`) substitute for imports.
- **Contracts:** frontend types in `web/src/lib/types.ts` (1717 lines) must stay in sync with `server/dto.go` output; changing one means changing the other.
- **Schema migrations:** `db/schema.sql` is re-executed every boot and must stay idempotent (`IF NOT EXISTS`/`OR REPLACE`); column backfills guarded by existence checks (see `db/schema.sql:457` comment). No migration framework.
- **Update protocol:** process exit code is part of the contract with `start.sh` (0 = stop, 75 = relaunch for staged update); `main()` must return, not `os.Exit`, to preserve defers (`cmd/artex/main.go` comment).
- **Single-tenant auth:** one admin account (JWT HS256 key at `data/jwt.key`, generated at boot); optional Basic Auth gate in front of everything.

## Anti-Patterns

### Keep db structs out of the API surface

**What happens:** handlers must not return `db.*` structs directly.
**Why it's wrong:** the frontend contract is `web/src/lib/types.ts`; internal models would leak field formats (unix ints, raw JSONB).
**Do this instead:** reshape in `server/dto.go` and emit exactly the spec shapes (stated in the `server/dto.go` header comment).

### Don't add a new top-level Go module boundary per feature

**What happens:** feature code tempting to isolate in `internal/…` trees.
**Why it's wrong:** the codebase convention is flat package-per-domain with `db/` as the single persistence package split by file.
**Do this instead:** add files to the relevant existing package (`db/<domain>.go`, `server/<domain>.go`, `agent/<domain>.go`); create a new top-level package only for a genuinely standalone subsystem (precedent: `sidequestion/`, `evidence/`).

### Don't bypass Guard for tool execution

**What happens:** agents invoking tools directly without hooks.
**Why it's wrong:** audit + intercept approval is the documented safety boundary (docs §11, `guard/guard.go` header).
**Do this instead:** run all agent tool loops through the harness hook runner wired to `guard.Guard.Hooks()`.

## Error Handling

**Strategy:** explicit error returns; `log.Printf` with `[pkg]` prefixes for operational events; no panic-based control flow outside boot (`log.Fatalf` only at startup paths).

**Patterns:**
- Named cancellation causes threaded to activity traces (`agent/cancelcause.go`, `cmd/artex/main.go:shutdownContext`)
- PG error classification helpers: `isPostgresDeadlock` (`db/db.go:41`), `isFKViolation`/`dropReason` (`server/engine.go:24-50`), retryable model error check (`server/engine.go:82`)
- Deadlock retry ladder for schema apply (`db/db.go:53`)
- Rollback-first file staging for task deletion (`server/manager.go:1580` `stageTaskFiles` with `commit/rollback`)
- Terminal-reason modeling for agent runs (`agent/terminalreason.go` → `norma/harness.TerminalReason`)
- HTTP: `writeJSON`/`writeErr` helpers, handler guards like `decodeConversationRequest` (`server/conversations.go:28`)

## Cross-Cutting Concerns

**Logging:** stdlib `log` to stderr + in-memory capture for the `/logs` page and SSE stream (`server.StartLogCapture`, `cmd/artex/main.go:69`). Convention: `log.Printf("[pkg] message")` with Chinese operational text.

**Validation:** at handler boundaries (manual decode+validate in each handler and `server/dto.go`); DB-level constraints in `db/schema.sql` (FKs, triggers, `try_inet` safe cast).

**Authentication:** JWT HS256 issued by `/api/auth/*` (`server/auth.go`, `basic_auth.go`); token stored client-side (`web/src/lib/auth.ts`, cookie mirror for the Next proxy gate `web/src/proxy.ts`); optional HTTP Basic Auth gate wraps API + UI (`server/server.go:976`).

**Config layering:** `config.json` + `ARTEX_PG_DSN` env → `config/config.go` (`PostgresDSN` at `config/config.go:137`, `Redact` for safe logging); runtime settings live in the PG `settings` table keyed by constants in `server/manager.go:251-277`.

---

*Architecture analysis: 2026-10-10*
