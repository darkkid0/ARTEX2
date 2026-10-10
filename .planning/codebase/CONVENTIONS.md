---
last_mapped_commit: 6a2bba46378cbeaab2b39c03df7ace2fb2318f57
last_mapped_at: 2026-10-10
---
# Coding Conventions

**Analysis Date:** 2026-10-10

## Overview

ARTEX is a two-codebase project:

- **Go backend** (Go 1.26.3): flat package layout at repo root — `server/`, `db/`, `agent/`, `traffic/`, `intercept/`, `llmpool/`, `sidequestion/`, `guard/`, `notify/`, `evidence/`, `llmrec/`, `mcphttp/`, `enrich/`, `selfupdate/`, `report/`, `config/` (~98k LOC excluding `data/`)
- **Next.js frontend** (`web/`): Next 16 + React 19 + TypeScript 5.9 + Tailwind 4 + shadcn/ui, linted/formatted by Biome 2.5 (~58k LOC)

Comments and UI strings are predominantly **Chinese**; exported Go identifiers and doc comments are English. Expect bilingual code comments everywhere — this is intentional, not inconsistent.

## Naming Patterns

**Go:**
- Files: `snake_case.go` grouped by domain, not by type — `server/finding_traffic.go`, `server/finding_traffic_export.go`, `db/task_templates.go`, `db/task_archives_restore.go`
- Tests: `*_test.go` co-located beside the code they test (`guard/guard.go` ↔ `guard/guard_test.go`)
- Packages: single lowercase word, no underscores — `sidequestion`, `llmpool`, `mcphttp`
- Constructors: `NewX` returning concrete types — `server.New(ctx, m, ...)`, `traffic.Open(dir, addr)`, `db.Open(dsn)`, `llmpool.New(members, registry)`
- Methods on receivers: `s *Server`, `m *Manager`, `f *notifyFixture`
- Sentinel errors: exported `ErrXxx` — `db.ErrFindingNotFound`, `db.ErrEvidenceConflict`, `db.ErrAssetIPInvalid`, `db.ErrActiveLLMProfileDelete`. Error text may be Chinese when user-facing: `errors.New("分页位置无效，请重新搜索")` (`db/chat_mentions.go:25`)
- Interfaces: small, consumer-side, lowercase for unexported (`basicAuthSettingsStore`, `mcpClient`, `toolUsageRecorder` in `server/`), exported for cross-package contracts (`agent.FindingRecorder`, `notify.Channel`)
- Test helpers: lowercase fixtures with `t.Helper()` first line — `trafficEvidenceServer(t)`, `newNotifyFixture(t)`, `fakeProv`, `fakeRT`, `okProv`, `failProv`, `member()`

**TypeScript/React:**
- Files/directories: `kebab-case.ts` / `kebab-case.tsx` — `activity-merge.ts`, `date-range-picker.tsx`, `side-question-workspace.tsx`. Enforced by Biome rule `useFilenamingConvention: "error"` (`web/biome.json:87`)
- Components: named function exports, PascalCase symbol — `export function CopyButton(...)` (`web/src/components/copy-button.tsx`). `export default` only for Next.js `page.tsx`/`layout.tsx` files
- Types: `PascalCase` in `web/src/lib/types.ts` (163 exported types — the single domain-model source). String-literal unions over enums: `export type TaskStatus = "created" | "queued" | ...`
- Zustand stores: `createXStore` factory pattern — `createPreferencesStore` (`web/src/stores/preferences/preferences-store.ts`), built with `createStore` from `zustand/vanilla`
- Props: `type XProps = { ... }` object type (not `interface`) for components — see `CopyButtonProps` in `web/src/components/copy-button.tsx:16-24`
- Tests: colocated `*.test.mjs` — `web/src/lib/activity-merge.test.mjs` imports from `./activity-merge.ts`

## Code Style

**Go:**
- `gofmt` standard; no `.golangci.yml`, no golangci-lint config detected. Linting is implicit via `go vet` and review
- `//nolint:errcheck` used sparingly for intentionally discarded errors (e.g., unlock in `TestMain` defer — `db/testmain_test.go:30`)
- Max ~4000-line files exist (`server/server.go`) but the norm is 200–900-line domain files

**TypeScript (Biome 2.5, `web/biome.json`):**
- Formatter: 2-space indent, **lineWidth 120**, LF line endings, double quotes (`quoteStyle: "double"`), semicolons always, trailing commas all, arrow parens always
- Linter preset `recommended` plus strict extras:
  - `noCommonJs: "error"`, `noImportCycles: "error"`, `noEmptyBlockStatements: "error"`, `noParameterAssign: "error"`, `noInferrableTypes: "error"`, `noNestedTernary: "warn"`
  - React/Next domains: `noNestedComponentDefinitions: "error"`, `noUndeclaredVariables: "error"`, `noUndeclaredDependencies: "error"`
  - Async discipline: `noFloatingPromises: "error"`, `noMisusedPromises: "error"`, `useNullishCoalescing: "error"`
  - Tailwind: `useSortedClasses: "on"` (class order auto-sorted)
- Excluded from lint: `src/components/ui` and `src/components/calendar` (shadcn-generated code — do NOT hand-edit these; put customizations in wrapper components)
- Pre-commit: husky + lint-staged run `biome check --write` on staged JS/TS (`web/.husky/pre-commit` → `npm exec -- lint-staged`), and regenerate theme presets (`npm run generate:presets`)

## Import Organization

**Go (standard grouping, enforced by convention):**
1. Stdlib
2. Third-party
3. Project packages (`github.com/Autumn-27/artex/...`)
- Example: `server/notify_api_test.go:3-18`, `db/db.go:7-19`

**TypeScript — exact group order enforced by Biome `organizeImports` (`web/biome.json:14-25`):**
1. `react` / `react/**`
2. blank line
3. `next/**`
4. blank line
5. `:PACKAGE:` (npm packages — lucide-react, recharts, sonner, date-fns…)
6. blank line
7. `:ALIAS:` (`@/components/...`, `@/lib/...`, `@/config/...`)
8. blank line
9. `:PATH:` (relative `./x`, `../x`)
- Live example: `web/src/app/(main)/dashboard/page.tsx:1-22`, `web/src/components/copy-button.tsx:1-11`

**Path Aliases:**
- `@/*` → `web/src/*` (`web/tsconfig.json` `paths`). Always use `@/lib/api`, `@/components/ui/button`, `@/lib/types` — never deep relative paths across directories

## Error Handling

**Go:**
- Idiomatic `if err != nil { return ..., err }` wrapping — `server/server.go` alone has 101 occurrences
- Wrap with context: `fmt.Errorf("bad json: %w", err)` (`server/schedules.go:94`); error strings may be Chinese when surfaced to UI
- Inspect with `errors.Is` for sentinels (`server/finding_traffic.go:95-98`) and `errors.As` for typed errors (`*pgconn.PgError` in `server/task_metadata.go:33`, `db/db.go:58`)
- Postgres-specific handling by SQLSTATE code: deadlock `40P01` retry loop (`db/db.go:53-75`), FK violation `23503` (`server/engine.go:22`), invalid JSONB `22P05` (`db/exploration.go:25-38`)
- Sentinel errors defined in the owning package's data-access file, checked by callers via `errors.Is` — follow this pattern; do not string-match error text
- HTTP handlers: `writeJSON(w, code, v)` / `writeErr(w, code, msg)` helpers only (`server/server.go:3987-3996`). `writeErr` returns `{"error": msg}`. Use `404`/`400`/`409`/`413` semantically as in `server/task_templates_test.go:88-101`
- `panic()` only for startup-time impossibilities (`server/webui_embed.go:27` embed failure); never in request paths
- `log.Printf`/`log.Fatalf` from stdlib `log` with `[component]` prefix — `[auth]`, `[engine]`, `[retester]` (`server/server.go:150-262`). No logrus/slog. Log fields as inline context, one line per event
- Fire-and-forget drops are counted and logged with a reason classifier rather than silently ignored (`server/engine.go:29-56` — `dropReason`, `bumpDrop`, `preview` helpers)

**TypeScript:**
- Async functions; `toast.success` / `toast.error` from `sonner` for user-facing feedback (`web/src/components/copy-button.tsx:61-66`)
- API layer in `web/src/lib/api.ts` is the single backend client (`/api/*` proxied to Go); mock mode (`NEXT_PUBLIC_MOCK=1`) short-circuits through `web/src/lib/mock/handler.ts` which returns safe defaults on miss — never let a page crash on missing mock data
- `??` over `||` (enforced `useNullishCoalescing`); never floating promises (enforced)

## Comments

**When to Comment:**
- Comments explain **WHY and contract**, not what. This codebase has exceptionally dense rationale comments — both languages:
  - Go: `// A 402 is deterministic: one failure must open the breaker, so the NEXT request skips that profile entirely instead of paying for another round-trip.` (`llmpool/pool_test.go:113-114`)
  - TS: `web/src/lib/utils.ts:9-18` explains the Radix DismissableLayer double-dismiss race before giving the fix
- Test files get a **file-header block** describing scope and safety caveats: `server/notify_api_test.go:20-31` (why global `step()` is never called — it would push real findings to production DingTalk/WeCom channels)
- Chinese is the dominant comment language; doc comments on exported English-identifier symbols are English (`db/db.go:1-3`)
- Package doc comment at top of primary file: `// Package db is the PostgreSQL data source for ARTEX (取代旧 graph 单文件 SQLite)。` (`db/db.go:1`)
- `TODO/FIXME/HACK`: essentially absent in production code (0 in non-test, non-`data/` Go files) — issues are fixed, not annotated

**JSDoc/TSDoc:**
- Light: single-line `//` comments on props and non-obvious behavior (`web/src/components/copy-button.tsx:17-22`), not formal `/** */` blocks

## Function Design

**Go:**
- Methods hang off their domain struct; unexported helpers directly above/below callers
- Small helper types in the same file as their consumer (`schemaExecer`, `schemaExecFunc` in `db/db.go:41-43` / `db/db_test.go:12`)
- Table-driven behavior via variadic closures injected for testability (`applySchemaWithRetry(ctx, execer, sleep func(time.Duration))` — sleep is injectable, `db/db.go:64`)

**TypeScript:**
- Small pure functions colocated with their types in `web/src/lib/` (`mergeActivities` is 8 lines with a contract comment — `web/src/lib/activity-merge.ts:1-6`)
- `cn(...)` from `clsx` + `tailwind-merge` (`web/src/lib/utils.ts:4-6`) for all className merging
- Components take typed props with optional callbacks (`onChange?: (value: DateRange | undefined) => void` — `web/src/components/date-range-picker.tsx:11-14`); controlled-or-uncontrolled pattern via `value ?? internalState`
- `"use client"` at top of every interactive component (128 of 157 tsx files)

## Module Design

**Go:**
- One domain per flat package; packages depend downward only (`server` → `agent`/`db`/`traffic`/`notify`/`evidence`; `agent` → `db`; `db` → none)
- No barrel files; import the exact package
- Cross-cutting seams defined as small interfaces at the consumer (`server/tool_usage.go:14` `toolUsageRecorder`), satisfied by concrete types in `db/`

**TypeScript:**
- `web/src/lib/types.ts` is the single shared domain-type module — add new backend-mirroring shapes there
- `web/src/lib/api.ts` exports one `api` object with all endpoint methods + `sseUrl`/`openSSE` helpers (`web/src/lib/api.ts:194-277`)
- shadcn/ui primitives live in `web/src/components/ui/` (generated, excluded from lint); composed feature components in `web/src/components/` (kebab-case); route-local components in `web/src/app/(main)/_components/`
- Config constants centralized: `web/src/config/app-config.ts`, `web/src/navigation/sidebar/sidebar-items.ts` (icon-driven nav definition with `LucideIcon` types)

## Build & Release Scripts

- `build.sh`: cross-platform release builder (5 targets: linux/darwin/windows × amd64/arm64), UPX optional, embeds exported frontend into single binary — flags `--release`, `--target OS/ARCH`; env vars documented in header (`build.sh:1-27`)
- `dev.sh`: parallel `go run ./cmd/artex` + `npm run dev` with process-group cleanup
- CI (`.github/workflows/release.yml`): tag-triggered release pipeline only — **no test workflow exists in CI**
- Version strings: `ARTEX_BUILD_VERSION` env injected at build; frontend version from `web/package.json` surfaced via `APP_CONFIG.version` (`web/src/config/app-config.ts:1-4`)

---

*Convention analysis: 2026-10-10*
