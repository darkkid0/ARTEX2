---
last_mapped_commit: 6a2bba46378cbeaab2b39c03df7ace2fb2318f57
last_mapped_at: 2026-10-10
---
# Codebase Structure

**Analysis Date:** 2026-10-10

## Directory Layout

```
ARTEX/
├── cmd/artex/          # Single binary entry point (main.go, main_test.go)
├── agent/              # LLM agents: Planner, Worker, MainAgent, ChatAgent + tools/prompts (46 files)
├── server/             # HTTP API + orchestration: Manager, Engine, Scheduler, DTOs (61 non-test files)
├── db/                 # PostgreSQL access: schema.sql (embedded), per-domain stores (52 non-test files)
├── guard/              # Safety boundary: PreToolUse audit/intercept gate
├── intercept/          # User-configured intercept rules + human approval workflow
├── traffic/            # MITM recording proxy + SQLite index + sha256 blob store
├── evidence/           # Finding↔traffic evidence binding, hash verification, export staging
├── enrich/             # Background DNS/HTTP asset auto-completion engine
├── llmpool/            # LLM failover pool (ordered members, health registry)
├── llmrec/             # llm.Provider recording decorator → PostgreSQL
├── notify/             # Notification channels + filters + rendering
├── report/             # Findings/report Markdown + CSV generation
├── selfupdate/         # Staged binary swap, rollback, GitHub release checks
├── sidequestion/       # /btw side-question service (own README, context snapshot capture)
├── mcphttp/            # Remote MCP client (Streamable HTTP + legacy SSE)
├── config/             # config.json loading, DSN resolution, path helpers
├── web/                # Next.js 16 frontend (static export, embedded into binary)
│   └── src/
│       ├── app/        # App Router: (auth)/ (main)/ (external)/ route groups
│       ├── components/ # Shared components + ui/ (61 shadcn primitives)
│       ├── lib/        # api.ts (typed API client), types.ts (contract), utils, mock/
│       ├── hooks/      # use-current-user, use-side-questions, use-lg, use-mobile
│       ├── navigation/ # sidebar-items.ts (single source of nav)
│       ├── stores/     # preferences store (zustand-style provider)
│       ├── config/     # app-config.ts
│       ├── scripts/    # theme-boot.tsx, generate-theme-presets.ts
│       └── styles/     # global styles
├── skills/             # Bundled agent skills (api-recon, playwright-cli, scopesentry) — SKILL.md format
├── data/               # Runtime data (gitignored): transcripts/, traffic/, tasks/, evidence/, sessions/
├── docs/               # Design docs (Chinese, not committed per .gitignore pattern /docs/ except tracked ones)
├── screenshots/        # README screenshots (committed)
├── build.sh            # Cross-platform release builder (Go cross-compile + UPX + zip)
├── install.sh / start.sh / start.bat / update.sh / reset-password.sh / dev.sh
├── Dockerfile / docker-compose.yml / docker-compose.bench.yml
├── go.mod / go.sum     # Go 1.26.3 module github.com/Autumn-27/artex
└── .github/workflows/release.yml
```

## Directory Purposes

**`cmd/artex/`:**
- Purpose: process entry — flags, boot order, shutdown, exit-code update protocol
- Contains: `main.go` (all wiring lives here), `main_test.go`
- Key files: `cmd/artex/main.go`

**`agent/`:**
- Purpose: every LLM agent and its tool/prompt machinery
- Contains: agents (`planner.go`, `worker.go`, `mainagent.go`, `chat.go`, `retester.go`), tools (`tools.go`, `toolcatalog.go`, `tools_insert.go`, `tools_digest.go`), prompts (`prompt.go`, `promptcatalog.go`), lifecycle (`compaction.go`, `deferred.go`, `goals.go`, `constraints.go`, `finding_workflow.go`, `finding_recorder.go`), provider plumbing (`provider.go`), noa compaction adapter (`noa.go`, `coldgraph.go`)
- Key files: `agent/planner.go` (Plan at :355), `agent/worker.go` (Execute at :349), `agent/tools.go` (ToolSet :53)

**`server/`:**
- Purpose: everything the HTTP process owns — routes, orchestration, state
- Contains: `server.go` (route table, 264 routes), `manager.go` (Manager + Task), `engine.go` (planner/worker loops), `dto.go`, `assembly.go` (skill/MCP wiring), `orchestration.go` (host+orchestration tools), `scheduler.go`, `notifier.go`, plus per-domain handler files (`conversations.go`, `task_archives.go`, `task_llm.go`, `side_questions.go`, `finding_traffic.go`, `intercept.go`, `assets.go`, …), auth (`auth.go`, `basic_auth.go`), webui embed (`webui_embed.go` build-tagged, `webui_stub.go`)
- Key files: `server/server.go` (Handler at :661), `server/engine.go` (Run at :748), `server/dto.go`

**`db/`:**
- Purpose: single PostgreSQL persistence package, split by domain across files
- Contains: `db.go` (Open + seeds + embedded `schema.sql`), `exploration.go` (graph store), `assets.go`, `companies.go`, `tasks.go`, `config.go` (LLM profiles), `conversation.go`, `findings.go`, `finding_cases.go`, `task_archives*.go`, `chat_mentions.go`, `commands.go`, `constraints.go`, `company_scope.go`, `asset_dsl.go`, `asset_intercept*.go`, `constants.go`
- Key files: `db/db.go`, `db/schema.sql` (58 tables, idempotent), `db/exploration.go`

**`guard/`, `intercept/`:**
- Purpose: tool-call safety gate and human-approval workflow
- Key files: `guard/guard.go`, `intercept/intercept.go`, `intercept/prompt.go`, `intercept/review_context.go`

**`traffic/`, `evidence/`, `enrich/`:**
- Purpose: network capture + provenance + asset completion
- Key files: `traffic/traffic.go` (Traffic struct :137, Open :176), `evidence/store.go`, `enrich/enrich.go`

**`llmpool/`, `llmrec/`:**
- Purpose: provider failover and call recording
- Key files: `llmpool/pool.go` (Pool :48, Stream :82), `llmpool/health.go`, `llmrec/llmrec.go` (Wrap :81)

**`notify/`, `report/`, `selfupdate/`, `sidequestion/`, `mcphttp/`, `config/`:**
- Purpose: independent subsystems with narrow public APIs
- Key files: `notify/notify.go` + `notify/channel.go`, `report/report.go` + `report/findings.go`, `selfupdate/selfupdate.go` + `selfupdate/github.go` + `selfupdate/stage.go`, `sidequestion/service.go` + `sidequestion/capture.go`, `mcphttp/client.go`, `config/config.go`

**`web/`:**
- Purpose: Next.js frontend; `npm run build:static` output is copied to `server/webui/dist` and embedded via `-tags embedui`
- Key files: `web/next.config.mjs` (export/mock/rewrite modes), `web/src/lib/api.ts` (1411 lines), `web/src/lib/types.ts` (1717 lines — the type contract), `web/biome.json`

**`skills/`:**
- Purpose: agent skills loaded at runtime (filesystem; mounted into Docker)
- Contains: `skills/api-recon/SKILL.md` + scripts, `skills/playwright-cli/SKILL.md` + references, `skills/scopesentry/SKILL.md`

**`data/` (runtime, gitignored):**
- Purpose: all mutable runtime state outside PostgreSQL
- Contains: `data/transcripts/*.jsonl` (per-session transcripts, naming `exp<id>-*` / `conv-<id>.jsonl`), `data/traffic/` (`_index/index.sqlite`, `_blobs/sha256/…`), `data/tasks/<taskID>/<intentID>/<workspace>` (agent working dirs), `data/evidence/`, `data/sessions/`

## Key File Locations

**Entry Points:**
- `cmd/artex/main.go`: backend binary; boot, listening, shutdown
- `web/src/app/layout.tsx`: frontend root layout (fonts, theme boot, preferences provider)
- `web/src/app/(external)/page.tsx`: `/` redirect → `/function/tasks`
- `start.sh` / `start.bat`: supervisor scripts (relaunch semantics, required for one-click update)
- `install.sh` / `build.sh` / `update.sh`: install, release build, self-update helpers

**Configuration:**
- `config/config.go`: config.json + env (`ARTEX_PG_DSN`) resolution, `BaseDir`, `SkillDir`
- `config.example.json`: template for DB connection
- `.env.example` / `docker-compose.yml`: deployment env (`POSTGRES_PASSWORD`, `ANTHROPIC_API_KEY`, `ARTEX_IMAGE`/`ARTEX_TAG`)
- `.env`: present locally, gitignored — never read contents
- `web/next.config.mjs`: three frontend modes (dev rewrite / static export / Vercel mock)
- `web/tsconfig.json`: strict TS, path alias `@/*` → `web/src/*`
- `go.mod`: Go 1.26.3, module `github.com/Autumn-27/artex`

**Core Logic:**
- `server/engine.go`: exploration runtime (planner/worker loops, claim, steer, kill)
- `server/manager.go`: task lifecycle, settings, wiring
- `agent/tools.go` + `agent/toolcatalog.go`: agent tool surface (~50 tools)
- `db/schema.sql` + `db/exploration.go`: data model for graph/exploration
- `guard/guard.go` + `intercept/intercept.go`: approval/safety workflow

**Testing:**
- Go tests colocated: `*_test.go` next to every package file (161 files repo-wide, incl. `cmd/artex/main_test.go`, `server/core_test.go`, `db/db_test.go`, `traffic/traffic_store_test.go`, …)
- Frontend tests: colocated `.test.mjs` — `web/src/lib/activity-merge.test.mjs`, `web/src/lib/chat-mentions.test.mjs`
- E2E validation artifacts: `sidequestion/VALIDATION.md`, `sidequestion/validation-2026-09-10.json`

## Naming Conventions

**Files (Go):**
- Lowercase, underscore-separated domain files: `task_llm.go`, `finding_cases.go`, `company_scope.go`, `asset_intercept_match.go`
- Tests mirror source with `_test.go` suffix in the same package/directory
- Build-tagged variants paired: `webui_embed.go` / `webui_stub.go`

**Files (frontend):**
- Components: `kebab-case.tsx` (`exploration-graph.tsx`, `mention-textarea.tsx`, `finding-retest-dialog.tsx`)
- Route pages: Next convention `page.tsx` / `layout.tsx` / `not-found.tsx`
- Route-group internals: `_components/` (underscore = non-routing) with `*-tab.tsx` for task detail tabs
- Tests: `*.test.mjs` colocated with source

**Directories:**
- Go: single-word lowercase package names matching import path (`db`, `traffic`, `llmpool`)
- Frontend: route groups in `(parentheses)`; feature folders `function/` and `system/` under `(main)`
- Skills: one directory per skill containing `SKILL.md`

**Symbols (observed, applies when writing new code):**
- Go: exported types unadorned (`Task`, `Engine`, `Manager`); constructors `NewX` (`NewManager`, `NewEngine`, `NewPlanner`); receivers short (`m *Manager`, `e *Engine`, `t *Task`, `s *Server`)
- Settings keys: `settingXxx` consts (`server/manager.go:251`)

## Where to Add New Code

**New HTTP endpoint:**
- Handler: new `func (s *Server) name(w http.ResponseWriter, r *http.Request)` in the matching domain file under `server/` (create `server/<domain>.go` if none)
- Route: register with `mux.HandleFunc("METHOD /api/…", s.name)` in `server/server.go` `Handler()` (grouped by domain with section comments)
- Response shapes: serialize in `server/dto.go`; mirror the type into `web/src/lib/types.ts` and add a client fn in `web/src/lib/api.ts`
- Tests: `server/<domain>_test.go` colocated

**New agent tool:**
- Implementation: method on `ToolSet` in `agent/tools.go` (or a focused file like `agent/tools_insert.go`), schema registered via `agent/toolcatalog.go`
- Orchestration/host tools (task-level, not agent-level): `server/orchestration.go` (`roTool`/`wrTool` helpers)
- DB-backed overrides (description/schema/agent binding): seeded in the `tools` table — see `db/db.go` seed functions

**New PostgreSQL table/column:**
- Add idempotent DDL to `db/schema.sql` (`CREATE TABLE IF NOT EXISTS`, guarded backfills — see the comment at `db/schema.sql:457`)
- Access methods in a new or existing `db/<domain>.go` file
- Seed data (rules, agents, prompts): follow `seedBuiltins`/`seedDefaultInterceptRulesV3` patterns in `db/db.go`

**New notification channel:**
- Implement `notify.Channel` (`notify/channel.go:13`) in `notify/<kind>.go`, register in the `notify.Get` factory (`notify/notify.go`), add tests (`notify/<kind>_test.go` precedent: `notify/email_test.go`, `notify/channels_test.go`)

**New frontend page:**
- Page: `web/src/app/(main)/function/<feature>/page.tsx` (product features) or `web/src/app/(main)/system/<feature>/page.tsx` (admin screens)
- Add nav entry in `web/src/navigation/sidebar/sidebar-items.ts` (single source for the sidebar)
- Page-specific components: `web/src/app/(main)/<feature>/_components/`
- Reusable components: `web/src/components/`; shadcn primitives stay in `web/src/components/ui/` (61 files)
- API bindings: `web/src/lib/api.ts`; types: `web/src/lib/types.ts`

**New background engine/subsystem:**
- Follow the `enrich/` pattern: own top-level package with `New(...)`, worker pool, `Close()`; wire it in `server/manager.go` `NewManager` and expose through Manager accessors
- Runtime toggles: settings key const in `server/manager.go:251-277` + getter/setter pair + UI settings wiring

**New skill (agent capability pack):**
- `skills/<name>/SKILL.md` (+ optional `scripts/`, `references/`); visibility per agent via the `agent_skill_visibility` table (`db/schema.sql:888`)

**Utilities:**
- Go: keep shared helpers inside the owning package; truly generic code goes into the external `norma` framework, not this repo
- Frontend: `web/src/lib/*.ts` for pure helpers (with colocated `.test.mjs` where logic warrants)

## Special Directories

**`data/`:**
- Purpose: runtime state (transcripts, traffic blobs, task workspaces, evidence)
- Generated: Yes (by the running backend and agents)
- Committed: No (`.gitignore` line 2)

**`server/webui/dist/`:**
- Purpose: static frontend build copied from `web/out` for binary embedding
- Generated: Yes (build step in `build.sh`)
- Committed: No (`.gitignore` line `server/webui/dist/`)

**`screenshots/`:**
- Purpose: README imagery
- Generated: No
- Committed: Yes

**`skills/`:**
- Purpose: runtime-loaded agent skills; bind-mounted over the image copy in Docker (`docker-compose.yml`)
- Generated: No
- Committed: Yes

**`.planning/`:**
- Purpose: GSD planning artifacts (this document set)
- Generated: Yes (tooling)
- Committed: Yes (unless excluded later)

**`docs/`:**
- Purpose: design documents (Chinese); `.gitignore` has a `/docs/` rule but two tracked design docs exist (`docs/拒止污染治理方案.md`, `docs/漏洞流量证据.md`)
- Generated: No
- Committed: Partially (tracked files override the ignore rule)

---

*Structure analysis: 2026-10-10*
