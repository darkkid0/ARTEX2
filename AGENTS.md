<!-- GSD:project-start source:PROJECT.md -->

## Project

**ARTEX — AI 拒止与记录污染治理**

ARTEX 是一个 AI 自主渗透测试系统：Go 单二进制后端驱动 LLM agent（planner/worker 等 8 个角色）对授权目标执行侦察、利用与验证，Next.js 前端静态导出后嵌入二进制提供操作台。本项目的任务是在代码层面**长久、彻底地治理「AI 拒止与记录污染」**：模型以道德/合规理由拒绝执行授权任务、并把「拒绝」写进探索图（facts），导致后续 planner/worker 读图后被传染、级联拒止的问题。治理范围覆盖写入侧、读取侧、规划侧、授权凭据、度量闭环与操作文档。

**Core Value:** **在授权范围内，agent 全程正常执行任务，拒止声明不再进入探索图、不再传染后续规划，且污染一旦发生操作员可在代码层面精确清除/修正/审计。**

### Constraints

- **Tech stack**: Go 1.26（单包扁平布局，依赖方向 cmd → server → 域包 → db）+ Next.js 16 静态导出；提示词经 reseed 追加版本不覆盖 — 与既有架构模式保持一致
- **数据安全**: UpdateFactPayload 必须 bump content_version（UpdateGoalPayload 不 bump，不能照抄）；审计落独立表不落 activity（归档会级联删除）；关键词集禁用裸"拒绝"防误伤真实否定观察
- **优先级仲裁**: deny 约束 > 授权凭据 > 默认执行纪律 — 所有提示词段与凭据逻辑必须遵守该序（二审修订③）
- **验证口径**: 每个方案带验收标准（文档 §19，16+ 条），含构造性验收（如"connection refused 不触发拦截"）；H 第三层二期条目本次纳入后正常验收
- **回滚**: 所有改动须可回滚（reseed 追加版本、独立表、settings flag 开关、分流器独立于主路径）

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- Go 1.26.3 - Entire backend: HTTP API, agent engine, MITM proxy, DB layer (`go.mod`, entry point `cmd/artex/main.go`)
- TypeScript 5.9.3 - Entire frontend (`web/tsconfig.json`), strict mode, no `noEmit`-off builds (Next handles compile)
- Shell (bash/sh) - operational scripts: `build.sh`, `install.sh`, `start.sh`, `dev.sh`, `update.sh`, `reset-password.sh`, Windows twin `start.bat`
- SQL - single schema file `db/schema.sql` (embedded via `go:embed`, ~1530 lines, ~55 tables)
- Python 3.12 - runtime base image only (`Dockerfile` uses `python:3.12-slim-bookworm` for recon tooling); no Python source in repo

## Runtime

- Go backend: single static binary, `CGO_ENABLED=0`, optional `-tags embedui` embeds the frontend via `go:embed all:webui/dist` (`server/webui_embed.go`)
- Frontend dev: Node.js 22 (Next dev server on :5173); production frontend is a **static export** (`NEXT_EXPORT=1 next build` → `web/out`) served by the Go binary — no Node runtime in production
- OS targets: linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64 (`build.sh` release matrix)
- Go modules - lockfile: `go.sum` present (159 module lines)
- npm - lockfile: `web/package-lock.json` present

## Frameworks

- Next.js ^16.2.9 - frontend framework, static export + React Compiler enabled (`web/next.config.mjs`: `reactCompiler: true`)
- React ^19.2.7 - UI (React 19, RSC-aware, `components.json` sets `rsc: true`)
- Tailwind CSS ^4.1.5 (via `@tailwindcss/postcss`) - styling; CSS-first config in `web/src/app/globals.css`
- shadcn/ui (radix-nova style) + radix-ui ^1.6.0 + `@base-ui/react` - component system (`web/components.json`)
- `net/http` (Go stdlib) - backend API server; **no router framework** — Go 1.22+ method-pattern mux (`server/server.go`, e.g. `mux.HandleFunc("GET /api/tasks/{id}/asset-refs", ...)`)
- `github.com/Autumn-27/norma` v0.4.3 - the agent runtime SDK. All LLM/planning/worker capability comes from it. Sub-packages used: `llm`, `tool`, `transcript`, `permission`, `agentcore`, `harness`, `skill`, `hook`, `compaction`, `noaadapter`, `mcp` (usage counts in imports: llm×46, tool×42, transcript×15, permission×12, agentcore×11, harness×10)
- Go: stdlib `go test` (test files co-located throughout `db/`, `server/`, `agent/`, `notify/`, `traffic/`, `evidence/`, `guard/`, `intercept/`, `config/`)
- Frontend: `node:test` + `node:assert/strict` (`.test.mjs` files, e.g. `web/src/lib/activity-merge.test.mjs`, `web/src/lib/chat-mentions.test.mjs`) — no Jest/Vitest
- Biome ^2.5.1 - lint + format + organize-imports (`web/biome.json`, scripts `lint`/`format`/`check`)
- Husky ^9 + lint-staged ^16 - pre-commit Biome check on `*.{js,ts,jsx,tsx}`
- postcss ^8.5 - Tailwind pipeline
- ts-node ^10.9 - theme-preset generation script (`web/src/scripts/generate-theme-presets.ts`)
- Docker / Docker Compose - deployment (`Dockerfile`, `docker-compose.yml`; bench variant `docker-compose.bench.yml` + gitignored `Dockerfile.bench`)
- GitHub Actions - release pipeline (`.github/workflows/release.yml`: Node 22 export → Go cross-compile → multi-arch Docker → ZIP + SHA256SUMS → GitHub Release)

## Key Dependencies

- `github.com/Autumn-27/norma` v0.4.3 - agent SDK: LLM provider abstraction, tool exec, permissions, harness, context compaction, MCP client core. Whole engine depends on it (`agent/provider.go`, `agent/worker.go`, `agent/planner.go`)
- `github.com/jackc/pgx/v5` v5.10.0 - PostgreSQL driver via `database/sql` stdlib interface (`db/db.go`: `sql.Open("pgx", ...)`)
- `modernc.org/sqlite` v1.52.0 - pure-Go (CGO-free) SQLite used ONLY for the traffic-recording sidecar index incl. FTS5 trigram search (`traffic/traffic.go`)
- `github.com/lqqyt2423/go-mitmproxy` v1.9.2 - embedded MITM recording proxy (`traffic/traffic.go`)
- `github.com/golang-jwt/jwt/v5` v5.3.1 - auth tokens HS256, 7-day TTL (`server/auth.go`)
- `golang.org/x/crypto` v0.55.0 - bcrypt password hashing (`server/auth.go`, `server/basic_auth.go`)
- `github.com/projectdiscovery/dnsx` v1.2.3 + `github.com/miekg/dns` v1.1.72 - DNS resolution for asset enrichment (`enrich/enrich.go`)
- `github.com/klauspost/compress` v1.18.6 - compression (archive/blob paths)
- `github.com/google/uuid` v1.6.0 - id generation
- `zustand` ^5.0.14 - client state (`web/src/stores/preferences`, `createStore` from `zustand/vanilla`)
- `zod` ^4.4.3 + `react-hook-form` ^7.80 + `@hookform/resolvers` - forms & validation
- `@tanstack/react-table` ^8.21.3 - data tables
- `@antv/g6` ^5 + `@antv/graphin` ^3 + `@xyflow/react` ^12 - graph visualizations (exploration graph, coverage graph)
- `recharts` ^3.8 - charts; `@fullcalendar/react` ^7 - calendar; `@dnd-kit/*` - drag & drop
- `react-markdown` ^10 + `remark-gfm` ^4 - markdown rendering (transcripts, reports)
- `sonner` ^2, `vaul` ^1, `cmdk` ^1, `embla-carousel-react` ^8, `react-resizable-panels` ^4 - UI primitives
- `next-themes` ^0.4, `geist` ^1.7 fonts, `lucide-react` icons, `simple-icons` ^16
- `date-fns` ^4.4 + `temporal-polyfill` ^1 - date handling
- `sirupsen/logrus`, `gorilla/websocket` (go-mitmproxy deps), `bluemonday`/`gorilla/css` (HTML sanitize), `tidwall/gjson` (fast JSON reads)

## Configuration

- Config file `config.json` (copy from `config.example.json`): only `database` (Postgres DSN or fields) + `skill_dir`. Resolution order: `ARTEX_CONFIG` env > CWD/config.json > binary-dir/config.json (`config/config.go:Path`)
- Secrets/config live in env vars and DB, NOT in config.json. Full env var inventory (Go side):
- Frontend env: `NEXT_PUBLIC_MOCK=1` (full-mock demo mode, no backend), `NEXT_PUBLIC_SSE_BASE` (SSE origin override), `AUTOPENTEST_API` (dev /api rewrite target, default `http://localhost:8787`), `NEXT_EXPORT=1` (static export)
- `.env` / `.env.example` - Docker Compose only: `ARTEX_IMAGE` (ruoji6/artex), `ARTEX_TAG`, `POSTGRES_USER/PASSWORD/DB`, LLM keys passthrough. `.env` is gitignored
- `build.sh` - cross-platform builder: frontend export → `go:embed` → `CGO_ENABLED=0 go build -tags embedui` → optional UPX → zip per target
- `Dockerfile` - runtime image only (pre-built binary copied in): python:3.12-slim + Node 22 + recon tooling (ripgrep, nmap, dnsutils, whois…) + Playwright MCP/CLI/chromium preinstalled globally
- `install.sh` - interactive installer (all-Docker or local-build path)
- `server/webui_embed.go` (`-tags embedui`) vs `server/webui_stub.go` (dev, no embed)

## Platform Requirements

- Go 1.26.3, Node.js 22, a PostgreSQL instance (docker-compose provides one on port 5433 in the example config)
- `dev.sh` runs backend (:8787) + MITM proxy (:8788) + Next dev (:5173) together
- Tests: `go test ./...` (backend), `node --test`-style `.test.mjs` files (frontend, run individually)
- Single Go binary serving UI + API + SSE on :8787 and the recording proxy on :8788
- Requires PostgreSQL 16 (compose uses `postgres:16-alpine`; the app auto-creates the database if missing and applies schema idempotently at startup via advisory lock, `db/db.go`)
- Docker image `ruoji6/artex` (linux/amd64 + linux/arm64); data persisted in `/app/data` volume; `skills/` bind-mountable
- Self-update protocol: exit code 75 → start script relaunches (`start.sh`, `selfupdate/` package)
- Optional reverse proxy (nginx) in front of :8787; SSE is same-origin so no extra config needed (README)

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Overview

- **Go backend** (Go 1.26.3): flat package layout at repo root — `server/`, `db/`, `agent/`, `traffic/`, `intercept/`, `llmpool/`, `sidequestion/`, `guard/`, `notify/`, `evidence/`, `llmrec/`, `mcphttp/`, `enrich/`, `selfupdate/`, `report/`, `config/` (~98k LOC excluding `data/`)
- **Next.js frontend** (`web/`): Next 16 + React 19 + TypeScript 5.9 + Tailwind 4 + shadcn/ui, linted/formatted by Biome 2.5 (~58k LOC)

## Naming Patterns

- Files: `snake_case.go` grouped by domain, not by type — `server/finding_traffic.go`, `server/finding_traffic_export.go`, `db/task_templates.go`, `db/task_archives_restore.go`
- Tests: `*_test.go` co-located beside the code they test (`guard/guard.go` ↔ `guard/guard_test.go`)
- Packages: single lowercase word, no underscores — `sidequestion`, `llmpool`, `mcphttp`
- Constructors: `NewX` returning concrete types — `server.New(ctx, m, ...)`, `traffic.Open(dir, addr)`, `db.Open(dsn)`, `llmpool.New(members, registry)`
- Methods on receivers: `s *Server`, `m *Manager`, `f *notifyFixture`
- Sentinel errors: exported `ErrXxx` — `db.ErrFindingNotFound`, `db.ErrEvidenceConflict`, `db.ErrAssetIPInvalid`, `db.ErrActiveLLMProfileDelete`. Error text may be Chinese when user-facing: `errors.New("分页位置无效，请重新搜索")` (`db/chat_mentions.go:25`)
- Interfaces: small, consumer-side, lowercase for unexported (`basicAuthSettingsStore`, `mcpClient`, `toolUsageRecorder` in `server/`), exported for cross-package contracts (`agent.FindingRecorder`, `notify.Channel`)
- Test helpers: lowercase fixtures with `t.Helper()` first line — `trafficEvidenceServer(t)`, `newNotifyFixture(t)`, `fakeProv`, `fakeRT`, `okProv`, `failProv`, `member()`
- Files/directories: `kebab-case.ts` / `kebab-case.tsx` — `activity-merge.ts`, `date-range-picker.tsx`, `side-question-workspace.tsx`. Enforced by Biome rule `useFilenamingConvention: "error"` (`web/biome.json:87`)
- Components: named function exports, PascalCase symbol — `export function CopyButton(...)` (`web/src/components/copy-button.tsx`). `export default` only for Next.js `page.tsx`/`layout.tsx` files
- Types: `PascalCase` in `web/src/lib/types.ts` (163 exported types — the single domain-model source). String-literal unions over enums: `export type TaskStatus = "created" | "queued" | ...`
- Zustand stores: `createXStore` factory pattern — `createPreferencesStore` (`web/src/stores/preferences/preferences-store.ts`), built with `createStore` from `zustand/vanilla`
- Props: `type XProps = { ... }` object type (not `interface`) for components — see `CopyButtonProps` in `web/src/components/copy-button.tsx:16-24`
- Tests: colocated `*.test.mjs` — `web/src/lib/activity-merge.test.mjs` imports from `./activity-merge.ts`

## Code Style

- `gofmt` standard; no `.golangci.yml`, no golangci-lint config detected. Linting is implicit via `go vet` and review
- `//nolint:errcheck` used sparingly for intentionally discarded errors (e.g., unlock in `TestMain` defer — `db/testmain_test.go:30`)
- Max ~4000-line files exist (`server/server.go`) but the norm is 200–900-line domain files
- Formatter: 2-space indent, **lineWidth 120**, LF line endings, double quotes (`quoteStyle: "double"`), semicolons always, trailing commas all, arrow parens always
- Linter preset `recommended` plus strict extras:
- Excluded from lint: `src/components/ui` and `src/components/calendar` (shadcn-generated code — do NOT hand-edit these; put customizations in wrapper components)
- Pre-commit: husky + lint-staged run `biome check --write` on staged JS/TS (`web/.husky/pre-commit` → `npm exec -- lint-staged`), and regenerate theme presets (`npm run generate:presets`)

## Import Organization

- Example: `server/notify_api_test.go:3-18`, `db/db.go:7-19`
- Live example: `web/src/app/(main)/dashboard/page.tsx:1-22`, `web/src/components/copy-button.tsx:1-11`
- `@/*` → `web/src/*` (`web/tsconfig.json` `paths`). Always use `@/lib/api`, `@/components/ui/button`, `@/lib/types` — never deep relative paths across directories

## Error Handling

- Idiomatic `if err != nil { return ..., err }` wrapping — `server/server.go` alone has 101 occurrences
- Wrap with context: `fmt.Errorf("bad json: %w", err)` (`server/schedules.go:94`); error strings may be Chinese when surfaced to UI
- Inspect with `errors.Is` for sentinels (`server/finding_traffic.go:95-98`) and `errors.As` for typed errors (`*pgconn.PgError` in `server/task_metadata.go:33`, `db/db.go:58`)
- Postgres-specific handling by SQLSTATE code: deadlock `40P01` retry loop (`db/db.go:53-75`), FK violation `23503` (`server/engine.go:22`), invalid JSONB `22P05` (`db/exploration.go:25-38`)
- Sentinel errors defined in the owning package's data-access file, checked by callers via `errors.Is` — follow this pattern; do not string-match error text
- HTTP handlers: `writeJSON(w, code, v)` / `writeErr(w, code, msg)` helpers only (`server/server.go:3987-3996`). `writeErr` returns `{"error": msg}`. Use `404`/`400`/`409`/`413` semantically as in `server/task_templates_test.go:88-101`
- `panic()` only for startup-time impossibilities (`server/webui_embed.go:27` embed failure); never in request paths
- `log.Printf`/`log.Fatalf` from stdlib `log` with `[component]` prefix — `[auth]`, `[engine]`, `[retester]` (`server/server.go:150-262`). No logrus/slog. Log fields as inline context, one line per event
- Fire-and-forget drops are counted and logged with a reason classifier rather than silently ignored (`server/engine.go:29-56` — `dropReason`, `bumpDrop`, `preview` helpers)
- Async functions; `toast.success` / `toast.error` from `sonner` for user-facing feedback (`web/src/components/copy-button.tsx:61-66`)
- API layer in `web/src/lib/api.ts` is the single backend client (`/api/*` proxied to Go); mock mode (`NEXT_PUBLIC_MOCK=1`) short-circuits through `web/src/lib/mock/handler.ts` which returns safe defaults on miss — never let a page crash on missing mock data
- `??` over `||` (enforced `useNullishCoalescing`); never floating promises (enforced)

## Comments

- Comments explain **WHY and contract**, not what. This codebase has exceptionally dense rationale comments — both languages:
- Test files get a **file-header block** describing scope and safety caveats: `server/notify_api_test.go:20-31` (why global `step()` is never called — it would push real findings to production DingTalk/WeCom channels)
- Chinese is the dominant comment language; doc comments on exported English-identifier symbols are English (`db/db.go:1-3`)
- Package doc comment at top of primary file: `// Package db is the PostgreSQL data source for ARTEX (取代旧 graph 单文件 SQLite)。` (`db/db.go:1`)
- `TODO/FIXME/HACK`: essentially absent in production code (0 in non-test, non-`data/` Go files) — issues are fixed, not annotated
- Light: single-line `//` comments on props and non-obvious behavior (`web/src/components/copy-button.tsx:17-22`), not formal `/** */` blocks

## Function Design

- Methods hang off their domain struct; unexported helpers directly above/below callers
- Small helper types in the same file as their consumer (`schemaExecer`, `schemaExecFunc` in `db/db.go:41-43` / `db/db_test.go:12`)
- Table-driven behavior via variadic closures injected for testability (`applySchemaWithRetry(ctx, execer, sleep func(time.Duration))` — sleep is injectable, `db/db.go:64`)
- Small pure functions colocated with their types in `web/src/lib/` (`mergeActivities` is 8 lines with a contract comment — `web/src/lib/activity-merge.ts:1-6`)
- `cn(...)` from `clsx` + `tailwind-merge` (`web/src/lib/utils.ts:4-6`) for all className merging
- Components take typed props with optional callbacks (`onChange?: (value: DateRange | undefined) => void` — `web/src/components/date-range-picker.tsx:11-14`); controlled-or-uncontrolled pattern via `value ?? internalState`
- `"use client"` at top of every interactive component (128 of 157 tsx files)

## Module Design

- One domain per flat package; packages depend downward only (`server` → `agent`/`db`/`traffic`/`notify`/`evidence`; `agent` → `db`; `db` → none)
- No barrel files; import the exact package
- Cross-cutting seams defined as small interfaces at the consumer (`server/tool_usage.go:14` `toolUsageRecorder`), satisfied by concrete types in `db/`
- `web/src/lib/types.ts` is the single shared domain-type module — add new backend-mirroring shapes there
- `web/src/lib/api.ts` exports one `api` object with all endpoint methods + `sseUrl`/`openSSE` helpers (`web/src/lib/api.ts:194-277`)
- shadcn/ui primitives live in `web/src/components/ui/` (generated, excluded from lint); composed feature components in `web/src/components/` (kebab-case); route-local components in `web/src/app/(main)/_components/`
- Config constants centralized: `web/src/config/app-config.ts`, `web/src/navigation/sidebar/sidebar-items.ts` (icon-driven nav definition with `LucideIcon` types)

## Build & Release Scripts

- `build.sh`: cross-platform release builder (5 targets: linux/darwin/windows × amd64/arm64), UPX optional, embeds exported frontend into single binary — flags `--release`, `--target OS/ARCH`; env vars documented in header (`build.sh:1-27`)
- `dev.sh`: parallel `go run ./cmd/artex` + `npm run dev` with process-group cleanup
- CI (`.github/workflows/release.yml`): tag-triggered release pipeline only — **no test workflow exists in CI**
- Version strings: `ARTEX_BUILD_VERSION` env injected at build; frontend version from `web/package.json` surfaced via `APP_CONFIG.version` (`web/src/config/app-config.ts:1-4`)

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

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

- One Go package per top-level directory; dependency direction is strictly `cmd → server → {agent, guard, intercept, traffic, …} → db`. Packages never import `server`.
- The agent runtime is built on the external `github.com/Autumn-27/norma` framework (`norma/llm`, `norma/harness`, `norma/tool`, `norma/hook`, `norma/transcript`, `norma/agentcore`, `norma/compaction`, `norma/noaadapter`, `norma/skill`, `norma/mcp`, `norma/permission`) — it provides the LLM Provider interface, tool/hook harness, and transcript store; ARTEX packages supply domain tools, prompts, and orchestration.
- Dual contract pattern: db package structs and `web/src/lib/types.ts` are the canonical contracts; `server/dto.go` maps one onto the other so internal DB models never leak over the API.
- Event-sourced-ish exploration: all agent work is recorded as `exploration_nodes` (intents/facts/findings) + `exploration_edges` + `activity` rows in PostgreSQL; the frontend reads and live-streams the same records.
- Wiring via function injection: `Server.New` installs closures into `Engine` (`SetAuthoritativeAgentResolver`, `SetReadiness`) and package-level vars (`agent.ToolAugment`, `agent.PromptOverride`) rather than interfaces.
- Build-tag embedding: `-tags embedui` embeds `server/webui/dist` (no-embed build 404s the SPA; run `next dev` separately).

## Layers

- Purpose: flags, banner, boot sequencing, graceful shutdown, exit-code protocol
- Location: `cmd/artex/main.go`
- Depends on: `server`, `agent`, `config`, `selfupdate`
- Used by: OS / `start.sh` supervisor
- Purpose: REST API + SSE streams + embedded SPA serving; auth (JWT HS256 from `data/jwt.key`, optional Basic Auth gate wrapping both /api and UI)
- Location: `server/server.go` (Handler() at `server/server.go:661`), per-domain handler files (`server/conversations.go`, `server/intercept.go`, `server/side_questions.go`, `server/finding_traffic.go`, `server/task_archives.go`, …)
- Contains: handlers, route table, CORS, DTO serialization
- Depends on: Manager, Engine, agent, db, all domain packages
- Used by: frontend, scripts
- Purpose: run exploration tasks — planner/worker loops, admission control (concurrency caps), archives, notifications, schedules
- Location: `server/engine.go` (1245 lines), `server/manager.go` (1862), `server/orchestration.go`, `server/scheduler.go`, `server/notifier.go`
- Depends on: agent, db, guard, intercept, traffic, llmpool, llmrec
- Used by: HTTP layer
- Purpose: LLM-driven planner/worker/main-agent/chat agents, tool catalogs, prompt catalog, compaction, side questions, retester
- Location: `agent/` (46 files)
- Depends on: norma framework, db (via db.Node/db.Activity types), intercept (hook context)
- Used by: server orchestration
- Purpose: every tool call passes Guard PreToolUse hooks; intercept rules can block or require human approval; audit entries recorded
- Location: `guard/guard.go`, `intercept/intercept.go`
- Depends on: db (rules), norma/hook
- Used by: agent runs via harness HookRunner
- Purpose: PostgreSQL persistence — schema apply, seeding, per-domain stores; plus the separate traffic SQLite index under `data/traffic/_index/index.sqlite`
- Location: `db/` (52 non-test files), `db/schema.sql`; traffic index in `traffic/traffic.go`
- Depends on: pgx/v5 stdlib driver, modernc.org/sqlite (traffic only)
- Used by: all layers above
- Purpose: dashboard/task/chat/system UI; static export (`output: "export"`), embedded into the binary or served by `next dev`
- Location: `web/src/`
- Depends on: `/api/*` only (dev mode proxies via `web/next.config.mjs` rewrites to `http://localhost:8787`)
- Used by: humans

## Data Flow

### Primary Exploration Flow

### Traffic Recording Flow

### Chat / Side-question Flow

- Durable state: PostgreSQL (tasks, graph, activity, settings, LLM profiles, schedules) + filesystem (`data/`: transcripts JSONL, traffic blobs, per-task workspaces under `data/tasks/<taskID>/`, evidence)
- In-process state: `Manager.tasks map[string]*Task` guarded by `mu`; `Engine` uses `sync.Map` fields (started/paused/deleting/lastAct…); `Broadcaster.subs`
- Frontend: client-side auth token (`web/src/lib/auth.ts`), cookie-backed UI preferences (`web/src/lib/preferences/`), no server components state beyond routing

## Key Abstractions

- Purpose: in-memory handle over a persisted task + its exploration store, lifecycle state, LLM chain state
- Examples: `server/manager.go:29` (`Task` struct), `:80` (`taskLifecycleState` with mutex-guarded snapshot/update)
- Pattern: snapshot-mutate under lock; goroutine wake-up via notify channel
- Purpose: per-exploration facade over the graph tables (nodes/edges/anchors)
- Examples: `db/exploration.go:172` — `AddIntent`, `AddGoal`, `Link`, `SetNodeState`, `Frontier`, `ClaimIntent`
- Pattern: store-per-aggregate; DB methods return typed `*ExplorationStore` bound to an expID
- Purpose: uniform tool schema/run contract shared by built-in, host, MCP, and skill tools
- Examples: `agent/tools.go:53` (`ToolSet`), `server/orchestration.go:65` (`orchestrationTools`), `server/assembly.go` (skill/MCP augment wiring)
- Pattern: registry + DB `tools` table overrides (description/schema/per-agent binding) applied in `agent/assembly.go:AugmentTools`
- Purpose: PreToolUse/PostToolUse/Stop interception points used by guard, steering, compaction
- Examples: `guard/guard.go:55` (`Hooks()`), `server/engine.go:578` (`steerHooks`)
- Pattern: hooks composed and injected into agent runs
- Purpose: pluggable notification sink
- Examples: `notify/channel.go:13`; implementations `notify/dingtalk.go`, `notify/email.go`, `notify/feishu.go`, `notify/telegram.go`, `notify/webhook.go`, `notify/http.go`
- Pattern: `notify.Get(kind)` factory + per-channel config maps

## Entry Points

- Location: `cmd/artex/main.go` (`run()` at :47)
- Triggers: `start.sh`/`start.bat` supervisor (relaunches on exit; exit code 75 = restart for self-update), `install.sh`, docker ENTRYPOINT
- Responsibilities: flags (`-addr :8787`, `-data`, `-proxy :8788`), selfupdate bootstrap, open Manager + stores, start HTTP + MITM proxy, graceful shutdown
- Location: `server.New` (`server/server.go:147`), `Handler()` (`server/server.go:661`)
- Triggers: any `/api/*` request or SPA route
- Responsibilities: JWT/Basic auth gate → CORS → route mux → handler → DTO
- Location: `traffic.Open` + `tr.Start()` (`server/manager.go:440` goroutine)
- Triggers: target HTTP(S) traffic pointed at :8788
- Responsibilities: MITM recording, CA cert provisioning to agent shells
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

### Don't add a new top-level Go module boundary per feature

### Don't bypass Guard for tool execution

## Error Handling

- Named cancellation causes threaded to activity traces (`agent/cancelcause.go`, `cmd/artex/main.go:shutdownContext`)
- PG error classification helpers: `isPostgresDeadlock` (`db/db.go:41`), `isFKViolation`/`dropReason` (`server/engine.go:24-50`), retryable model error check (`server/engine.go:82`)
- Deadlock retry ladder for schema apply (`db/db.go:53`)
- Rollback-first file staging for task deletion (`server/manager.go:1580` `stageTaskFiles` with `commit/rollback`)
- Terminal-reason modeling for agent runs (`agent/terminalreason.go` → `norma/harness.TerminalReason`)
- HTTP: `writeJSON`/`writeErr` helpers, handler guards like `decodeConversationRequest` (`server/conversations.go:28`)

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-fast` for a trivial task inline, with no subagents and no PLAN.md
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

## Quality Gates（质量门禁 — 强制）

`.planning/QUALITY_GATES.md` 是本项目的强制性工作流规则（AI Development Review Protocol）。讨论/上下文捕获、规划与实施产出的自审加独立审查门禁适用于：阶段讨论/上下文工件、阶段 PLAN、plan/任务拆分文档、quick task 计划、实施产出、文档产出，以及任何声称完成的状态更新。完整定义、证据格式、豁免与过渡条款以该文件为准，本节仅为使用索引。

**门禁一览（fail-closed：证据缺失或未达 3 轮连续通过 = 禁止进入工作流下一步）：**

| Gate | 拦截点 | 证据文件 |
|------|--------|----------|
| Gate 0 — Discuss/Context Readiness | 阶段讨论/上下文工件被视为就绪、可进入规划 | 随上下文工件记录 |
| Gate R — Research Readiness | `{N}-RESEARCH.md` 被 pattern-mapper 或 planner 消费（先 `--research-phase` 产出 RESEARCH.md，过 Gate R 后才允许全量 plan） | `{N}-GATE-R-REVIEW.md` |
| Gate P — Patterns Readiness | `{N}-PATTERNS.md` 被 planner 消费（磁盘版必须与受审候选字节一致） | `{N}-GATE-P-REVIEW.md` |
| Gate A — Plan Readiness | 任何新建/更新的 PLAN.md 进入实施 | 随 plan/quick 目录记录 |
| Gate B — Implementation Completion | 实施产出提交、状态标记完成（代码与纯文档输出同权，quick task 不豁免） | `<plan-id>-GATE-B.md` / `<quick-id>-GATE-B.md` / `<phase-id>-PHASE-GATE-B-REVIEW.md`（独立文件背书） |

**硬性规则（摘自 QUALITY_GATES.md，冲突时以原文为准）：**

- **三连续通过 + 归零语义**：每个 gate 需自审 + 独立审查 3 轮连续无确认问题；任何确认修复或实质性变更把连续通过计数归零并重审，证据文件必须显式记录重启。
- **Gate B 是文件背书 gate**：独立证据文件必须在第一轮独立审查前创建/打开，逐轮追加（轮次、首行 PASS/ISSUES、审查范围、裁决、确认修复的严重度/根因/修复/验证命令与结果、归零记录）；SUMMARY.md、状态行、roadmap 行、commit message、最终回复只能引用，不能替代磁盘证据。缺证据 = 任务/plan/phase 不可提交、不算完成，即使测试全绿。
- **严禁伪造独立审查 PASS（硬性红线）**：审查者必须与作者/实施者分离；每轮 PASS 必须可追溯到真实执行的独立审查（独立 subagent 的真实输出或人工确认）；不得虚构审查结论或轮次。违反 = 相关 gate 全部重跑、计数归零、相关任务不得提交，并如实记录违规与整改。
- **独立审查优先使用 gsd-core 能力**：先检查 `gsd-code-reviewer` / `gsd-plan-checker` / `gsd-verifier` / `gsd-secure-phase` / `gsd-validate-phase` 等内置审查/校验 agent 与 skill；仅当不存在适用能力才允许通用 subagent，并在 gate 证据中记录理由。
- **MCP 工具协调**：代码发现与结构溯源按 `codebase-memory-mcp > CodeGraph > shell search` 顺序；gate 证据记录各工具覆盖的责任面，或记录纯文档/只读任务不适用的原因。
- **禁止一炮到底**：除非满足第二段复用豁免（RESEARCH.md/PATTERNS.md 已在磁盘且 Gate R/P 证据齐全），禁止单次运行完整 research→PLAN.md 链路；存量无证据工件不豁免——消费前必须补跑 Gate R/P 至 3/3。
- **Bypass**：仅限用户明确指令点名豁免内容与理由，并记录在相关 plan、summary 或 state 文档中。

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
