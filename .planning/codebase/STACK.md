---
last_mapped_commit: 6a2bba46378cbeaab2b39c03df7ace2fb2318f57
last_mapped_at: 2026-10-10
---
# Technology Stack

**Analysis Date:** 2026-10-10

## Languages

**Primary:**
- Go 1.26.3 - Entire backend: HTTP API, agent engine, MITM proxy, DB layer (`go.mod`, entry point `cmd/artex/main.go`)
- TypeScript 5.9.3 - Entire frontend (`web/tsconfig.json`), strict mode, no `noEmit`-off builds (Next handles compile)

**Secondary:**
- Shell (bash/sh) - operational scripts: `build.sh`, `install.sh`, `start.sh`, `dev.sh`, `update.sh`, `reset-password.sh`, Windows twin `start.bat`
- SQL - single schema file `db/schema.sql` (embedded via `go:embed`, ~1530 lines, ~55 tables)
- Python 3.12 - runtime base image only (`Dockerfile` uses `python:3.12-slim-bookworm` for recon tooling); no Python source in repo

## Runtime

**Environment:**
- Go backend: single static binary, `CGO_ENABLED=0`, optional `-tags embedui` embeds the frontend via `go:embed all:webui/dist` (`server/webui_embed.go`)
- Frontend dev: Node.js 22 (Next dev server on :5173); production frontend is a **static export** (`NEXT_EXPORT=1 next build` → `web/out`) served by the Go binary — no Node runtime in production
- OS targets: linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64 (`build.sh` release matrix)

**Package Managers:**
- Go modules - lockfile: `go.sum` present (159 module lines)
- npm - lockfile: `web/package-lock.json` present

## Frameworks

**Core:**
- Next.js ^16.2.9 - frontend framework, static export + React Compiler enabled (`web/next.config.mjs`: `reactCompiler: true`)
- React ^19.2.7 - UI (React 19, RSC-aware, `components.json` sets `rsc: true`)
- Tailwind CSS ^4.1.5 (via `@tailwindcss/postcss`) - styling; CSS-first config in `web/src/app/globals.css`
- shadcn/ui (radix-nova style) + radix-ui ^1.6.0 + `@base-ui/react` - component system (`web/components.json`)
- `net/http` (Go stdlib) - backend API server; **no router framework** — Go 1.22+ method-pattern mux (`server/server.go`, e.g. `mux.HandleFunc("GET /api/tasks/{id}/asset-refs", ...)`)

**Agent SDK (critical):**
- `github.com/Autumn-27/norma` v0.4.3 - the agent runtime SDK. All LLM/planning/worker capability comes from it. Sub-packages used: `llm`, `tool`, `transcript`, `permission`, `agentcore`, `harness`, `skill`, `hook`, `compaction`, `noaadapter`, `mcp` (usage counts in imports: llm×46, tool×42, transcript×15, permission×12, agentcore×11, harness×10)

**Testing:**
- Go: stdlib `go test` (test files co-located throughout `db/`, `server/`, `agent/`, `notify/`, `traffic/`, `evidence/`, `guard/`, `intercept/`, `config/`)
- Frontend: `node:test` + `node:assert/strict` (`.test.mjs` files, e.g. `web/src/lib/activity-merge.test.mjs`, `web/src/lib/chat-mentions.test.mjs`) — no Jest/Vitest

**Build/Dev:**
- Biome ^2.5.1 - lint + format + organize-imports (`web/biome.json`, scripts `lint`/`format`/`check`)
- Husky ^9 + lint-staged ^16 - pre-commit Biome check on `*.{js,ts,jsx,tsx}`
- postcss ^8.5 - Tailwind pipeline
- ts-node ^10.9 - theme-preset generation script (`web/src/scripts/generate-theme-presets.ts`)
- Docker / Docker Compose - deployment (`Dockerfile`, `docker-compose.yml`; bench variant `docker-compose.bench.yml` + gitignored `Dockerfile.bench`)
- GitHub Actions - release pipeline (`.github/workflows/release.yml`: Node 22 export → Go cross-compile → multi-arch Docker → ZIP + SHA256SUMS → GitHub Release)

## Key Dependencies

**Critical (Go):**
- `github.com/Autumn-27/norma` v0.4.3 - agent SDK: LLM provider abstraction, tool exec, permissions, harness, context compaction, MCP client core. Whole engine depends on it (`agent/provider.go`, `agent/worker.go`, `agent/planner.go`)
- `github.com/jackc/pgx/v5` v5.10.0 - PostgreSQL driver via `database/sql` stdlib interface (`db/db.go`: `sql.Open("pgx", ...)`)
- `modernc.org/sqlite` v1.52.0 - pure-Go (CGO-free) SQLite used ONLY for the traffic-recording sidecar index incl. FTS5 trigram search (`traffic/traffic.go`)
- `github.com/lqqyt2423/go-mitmproxy` v1.9.2 - embedded MITM recording proxy (`traffic/traffic.go`)
- `github.com/golang-jwt/jwt/v5` v5.3.1 - auth tokens HS256, 7-day TTL (`server/auth.go`)
- `golang.org/x/crypto` v0.55.0 - bcrypt password hashing (`server/auth.go`, `server/basic_auth.go`)
- `github.com/projectdiscovery/dnsx` v1.2.3 + `github.com/miekg/dns` v1.1.72 - DNS resolution for asset enrichment (`enrich/enrich.go`)
- `github.com/klauspost/compress` v1.18.6 - compression (archive/blob paths)
- `github.com/google/uuid` v1.6.0 - id generation

**Frontend (critical):**
- `zustand` ^5.0.14 - client state (`web/src/stores/preferences`, `createStore` from `zustand/vanilla`)
- `zod` ^4.4.3 + `react-hook-form` ^7.80 + `@hookform/resolvers` - forms & validation
- `@tanstack/react-table` ^8.21.3 - data tables
- `@antv/g6` ^5 + `@antv/graphin` ^3 + `@xyflow/react` ^12 - graph visualizations (exploration graph, coverage graph)
- `recharts` ^3.8 - charts; `@fullcalendar/react` ^7 - calendar; `@dnd-kit/*` - drag & drop
- `react-markdown` ^10 + `remark-gfm` ^4 - markdown rendering (transcripts, reports)
- `sonner` ^2, `vaul` ^1, `cmdk` ^1, `embla-carousel-react` ^8, `react-resizable-panels` ^4 - UI primitives
- `next-themes` ^0.4, `geist` ^1.7 fonts, `lucide-react` icons, `simple-icons` ^16
- `date-fns` ^4.4 + `temporal-polyfill` ^1 - date handling

**Infrastructure (Go, indirect but load-bearing):**
- `sirupsen/logrus`, `gorilla/websocket` (go-mitmproxy deps), `bluemonday`/`gorilla/css` (HTML sanitize), `tidwall/gjson` (fast JSON reads)

## Configuration

**Environment:**
- Config file `config.json` (copy from `config.example.json`): only `database` (Postgres DSN or fields) + `skill_dir`. Resolution order: `ARTEX_CONFIG` env > CWD/config.json > binary-dir/config.json (`config/config.go:Path`)
- Secrets/config live in env vars and DB, NOT in config.json. Full env var inventory (Go side):
  - `ARTEX_PG_DSN` - Postgres connection (overrides config.json)
  - `ARTEX_SKILL_DIR` - skills root (overrides config file; default `<basedir>/skills`)
  - `ARTEX_CONFIG` - config file path override
  - `ARTEX_LLM_PROVIDER` (anthropic|openai|openai-responses), `ARTEX_LLM_MODEL`, `ARTEX_LLM_BASE_URL`, `ARTEX_LLM_PROXY`, `ARTEX_LLM_STREAM` (`agent/provider.go:FromEnv`)
  - `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` - LLM credentials (also configurable in-app via DB `llm_profiles`)
  - `ARTEX_NOTIFY_ALLOW_LOCAL` - allow notify targets on loopback/LAN (SSRF guard, `notify/http.go`)
  - `ARTEX_WORKER_CHAT` - worker chat toggle
  - Build/CI only: `ARTEX_TARGET_OS/ARCH/TARGETS`, `ARTEX_BUILD_VERSION`, `ARTEX_OUTPUT(_DIR)`, `ARTEX_PACKAGE(_DIR)`, `ARTEX_COMPRESS`, `ARTEX_UPX_ARGS`, `ARTEX_SKIP_FRONTEND`, `ARTEX_SKIP_NPM_CI`, `ARTEX_GOSUMDB`, `ARTEX_RELEASE`
- Frontend env: `NEXT_PUBLIC_MOCK=1` (full-mock demo mode, no backend), `NEXT_PUBLIC_SSE_BASE` (SSE origin override), `AUTOPENTEST_API` (dev /api rewrite target, default `http://localhost:8787`), `NEXT_EXPORT=1` (static export)
- `.env` / `.env.example` - Docker Compose only: `ARTEX_IMAGE` (ruoji6/artex), `ARTEX_TAG`, `POSTGRES_USER/PASSWORD/DB`, LLM keys passthrough. `.env` is gitignored

**Build:**
- `build.sh` - cross-platform builder: frontend export → `go:embed` → `CGO_ENABLED=0 go build -tags embedui` → optional UPX → zip per target
- `Dockerfile` - runtime image only (pre-built binary copied in): python:3.12-slim + Node 22 + recon tooling (ripgrep, nmap, dnsutils, whois…) + Playwright MCP/CLI/chromium preinstalled globally
- `install.sh` - interactive installer (all-Docker or local-build path)
- `server/webui_embed.go` (`-tags embedui`) vs `server/webui_stub.go` (dev, no embed)

## Platform Requirements

**Development:**
- Go 1.26.3, Node.js 22, a PostgreSQL instance (docker-compose provides one on port 5433 in the example config)
- `dev.sh` runs backend (:8787) + MITM proxy (:8788) + Next dev (:5173) together
- Tests: `go test ./...` (backend), `node --test`-style `.test.mjs` files (frontend, run individually)

**Production:**
- Single Go binary serving UI + API + SSE on :8787 and the recording proxy on :8788
- Requires PostgreSQL 16 (compose uses `postgres:16-alpine`; the app auto-creates the database if missing and applies schema idempotently at startup via advisory lock, `db/db.go`)
- Docker image `ruoji6/artex` (linux/amd64 + linux/arm64); data persisted in `/app/data` volume; `skills/` bind-mountable
- Self-update protocol: exit code 75 → start script relaunches (`start.sh`, `selfupdate/` package)
- Optional reverse proxy (nginx) in front of :8787; SSE is same-origin so no extra config needed (README)

---

*Stack analysis: 2026-10-10*
