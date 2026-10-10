---
last_mapped_commit: 6a2bba46378cbeaab2b39c03df7ace2fb2318f57
last_mapped_at: 2026-10-10
---
# External Integrations

**Analysis Date:** 2026-10-10

## APIs & External Services

**LLM Providers (core dependency):**
- Anthropic Messages API - primary LLM format
  - Client: `github.com/Autumn-27/norma/llm` (`llm.FormatAnthropic`), wired in `agent/provider.go:NewProvider`
  - Auth: `ANTHROPIC_API_KEY` env var OR API key stored in DB `llm_profiles.api_key` (in-app UI config, `db/config.go`)
  - Default model: `claude-opus-4-8`
- OpenAI Chat Completions API - alternate LLM format
  - Client: `norma/llm` (`llm.FormatOpenAI`), model default `gpt-4o`
  - Auth: `OPENAI_API_KEY` env or DB `llm_profiles`
- OpenAI Responses API - third format
  - Client: `norma/llm` (`llm.FormatOpenAIResponses`), model default `gpt-5`
- Any Anthropic/OpenAI-compatible gateway works via `ARTEX_LLM_BASE_URL` or `llm_profiles.base_url` (provider appends `/v1/messages`, `/chat/completions`, or `/responses`)
- LLM feature knobs: per-profile proxy (http/https/socks5), rate limits (req/s, req/min), context window, thinking/reasoning fields, streaming on/off, max_tokens + field name, session sticky header (`agent/provider.go:Config`)
- **LLM pool / failover**: multiple profiles chained by priority with circuit-breaker health tracking, state mirrored to PG (`llmpool/pool.go`, `llmpool/health.go`, `server/llmpool.go`)

**GitHub Releases (self-update):**
- Used for: version check + binary download + rollback (`selfupdate/github.go`)
- Endpoint: `https://api.github.com/repos/RuoJi6/ARTEX/releases/latest` (repo constant is hardcoded deliberately — configurable update source would be an RCE channel)
- Auth: none (public releases); Host allowlist + redirect check + SHA256SUMS verification guard the chain (`selfupdate/github.go:allowedHosts`)
- Frontend also queries api.github.com directly for update checks (GitHub CORS is `*`), but the backend endpoint is authoritative (`server/update.go:206`)

**ScopeSentry (ASM platform, MCP):**
- Used for: asset sync — pulls subdomains/web apps/services per project/task into ARTEX's company+asset model (`server/sync_scopesentry.go`)
- Transport: MCP over Streamable HTTP via `mcphttp.Client.Call`; the MCP row (url + `X-API-Key: ssk_...` header) lives in the `mcp_servers` DB table; no permission prompts for background sync
- Reference skill doc: `skills/scopesentry/SKILL.md` (endpoint `<host>/mcp`, header `X-API-Key` or `Authorization: Bearer ssk_...`)

**Notification Channels (outbound IM/email push on findings):**
- All implemented in the stdlib-only leaf package `notify/` (no DB/server deps; config passed as `map[string]any` from `notification_channels.config` JSONB)
- DingTalk custom robot - `notify/dingtalk.go` (HMAC-SHA256 sign support)
- Feishu / Lark custom robot - `notify/feishu.go` (HMAC-SHA256 timestamp sign)
- WeCom (企业微信) group robot - `notify/wecom.go`
- Telegram Bot API - `notify/telegram.go` (base `https://api.telegram.org`, sendMessage, 4096-char limit)
- Generic Webhook - `notify/webhook.go` (custom URL/method/headers/JSON `text/template`; covers Slack/Mattermost/Discord/self-hosted)
- SMTP Email - `notify/email.go` (`net/smtp`, STARTTLS/TLS, PlainAuth)
- Guards: SSRF protection blocks loopback/LAN targets unless `ARTEX_NOTIFY_ALLOW_LOCAL=1` (`notify/http.go`), credential masking in API responses (`notify/mask.go`), rate limits per channel kind
- Trigger events: `finding_created`, `finding_status_changed` (`notify/notify.go`), delivery log in `notification_deliveries`

**MCP (Model Context Protocol) servers:**
- stdio transport: `norma/mcp.NewStdioClient` — local command servers (e.g. seeded Playwright browser MCP: `["@playwright/mcp","--headless"]`, `db/db.go:255-264`)
- Streamable HTTP + legacy SSE transports: `mcphttp/client.go` (JSON-RPC over POST / long-lived GET; custom headers from MCP row env map, e.g. Bearer tokens)
- Server/tool registry: DB tables `mcp_servers`, `mcp_tools_cache`; discovery in `server/mcpdiscover.go`; tool naming scheme `mcp__<server>__<tool>`
- The Docker image preinstalls `@playwright/mcp`, `@playwright/cli`, and chromium so the browser MCP works offline at first run (`Dockerfile`)

**DNS resolution (enrichment):**
- dnsx with default public resolvers + miekg/dns for raw queries — resolves discovered domains and writes IP/`resolves` edges into the asset graph (`enrich/enrich.go`)

## Data Storage

**Databases:**
- PostgreSQL 16 — the sole system of record for the application (dual-graph architecture: asset graph + exploration graph)
  - Connection: env `ARTEX_PG_DSN` or `config.json` `database` block (`config/config.go:PostgresDSN`; no silent default — startup fails loudly)
  - Client: `github.com/jackc/pgx/v5/stdlib` through `database/sql` (`db/db.go`); pool cap 32; schema applied idempotently at boot from embedded `db/schema.sql` under a PG advisory lock (key 7337741001)
  - App auto-creates the target database if missing (connects to `postgres` maintenance DB, `db/db.go:ensureDatabase`)
  - ~55 tables: companies, assets, company_scope, explorations/exploration_nodes/edges/anchors, tasks, findings (+cases/retests/traffic bindings), llm_profiles (+health), mcp_servers, conversations, intercept_rules, notification_*, server_logs, side_question_*, task_schedules, etc.
- SQLite (embedded, sidecar only) — traffic-recording index
  - Client: `modernc.org/sqlite` (pure Go, no CGO) via `sql.Open("sqlite", ...)` (`traffic/traffic.go:194`)
  - Tables: `exchanges`, `exchange_bodies`, `blob_refs` + FTS5 trigram virtual table `ex_fts` (contentless, CJK-capable substring search; degrades gracefully if FTS5 missing)
  - File tree beside it: full HTTP exchange bodies + content-addressed blob store + MITM CA (`data/traffic/_index`, `_blobs`, `_ca`)

**File Storage:**
- Local filesystem only, anchored at the data dir (default `data/` next to the binary; `-data` flag):
  - `data/traffic/` - recorded HTTP exchanges + blobs + CA cert
  - `data/evidence/blobs/` - content-addressed finding evidence, independent of disposable traffic (`evidence/store.go`, SHA-256 addressed)
  - `data/transcripts/`, `data/sessions/`, `data/tasks/` - agent transcripts/session/workspace artifacts
  - Workspace file browsing/upload/download API (`server/workspace.go`, endpoints `/api/workspace/upload|download`)
- Object storage: none

**Caching:**
- None external. In-process only: MCP tool cache (DB table), intercept rule in-memory cache, LLM circuit-breaker state (memory-authoritative, mirrored to PG)

## Authentication & Identity

**Auth Provider:**
- Custom, fully local — no external IdP
- Primary: JWT HS256, 7-day TTL, signed with a 32-byte key auto-generated at `jwt.key` beside the binary (migrated out of the browsable data dir) — `server/auth.go`
- Password: single admin user, bcrypt hashed, first-run `/setup` gate enforced by DB primary-key constraint (only-first-set guarantee); change via `/api` with old-password check
- Optional second layer: HTTP Basic Auth gate with its own bcrypt hash + signed cookie (`server/basic_auth.go`, cookie `artex_basic_auth`, configurable in system settings)
- Dev-mode Next proxy enforces the same gate for dev-served pages (`web/src/proxy.ts`)

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/OTel/metrics SDK anywhere)

**Logs:**
- Go stdlib `log` to stderr, plus an in-memory capture sink started at boot (`server.StartLogCapture`, `server/logsink.go`) that persists rows to PG `server_logs` and streams live to the UI `/logs` page (SSE)
- No structured logging framework; level+tag+text columns

## CI/CD & Deployment

**Hosting:**
- Self-hosted: Docker Compose (app + postgres) or bare binary + start script; image `ruoji6/artex` on Docker Hub (amd64/arm64)

**CI Pipeline:**
- GitHub Actions `.github/workflows/release.yml`, tag-triggered (`v*`):
  1. Validate semver tag + `ARTEX_DOCKER_IMAGE` repo variable
  2. Frontend static export with Node 22
  3. Go cross-compile (go-version from `go.mod`) of embedded-UI binaries for 5 targets, ZIP + SHA256SUMS
  4. Multi-arch Docker build on native runners, each boot-tested against a temporary PostgreSQL (health, version, embedded UI)
  5. Push image tag + `latest`, upload ZIPs, publish GitHub Release (no overwriting published versions)

## Environment Configuration

**Required env vars (minimal run):**
- `ARTEX_PG_DSN` (or `config.json` database block) — mandatory, no fallback
- LLM access: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (or configure profiles in the UI; without any, the engine stays idle)
- Docker deploy additionally: `POSTGRES_PASSWORD` (compose fails fast if unset), `ARTEX_IMAGE`, `ARTEX_TAG`

**Optional env vars:**
- `ARTEX_LLM_PROVIDER|MODEL|BASE_URL|PROXY|STREAM`, `ARTEX_SKILL_DIR`, `ARTEX_CONFIG`, `ARTEX_NOTIFY_ALLOW_LOCAL`, `ARTEX_WORKER_CHAT`
- Frontend: `NEXT_PUBLIC_MOCK`, `NEXT_PUBLIC_SSE_BASE`, `AUTOPENTEST_API`, `NEXT_EXPORT`

**Secrets location:**
- `.env` (gitignored, Docker Compose only) — never committed
- LLM API keys, notify webhook URLs/tokens: stored in PG (`llm_profiles.api_key`, `notification_channels.config`) and masked as `*_hint` in API responses
- JWT signing key: `jwt.key` file beside binary (gitignored); MCP credentials: `mcp_servers.env`/headers map in PG

## Webhooks & Callbacks

**Incoming:**
- None. All `/api/*` endpoints are first-party UI/API traffic; no third-party inbound webhook receivers

**Outgoing:**
- Notification webhooks (DingTalk/Feishu/WeCom/Telegram/generic webhook/SMTP) fired on finding events — `notify/` package
- Generic webhook channel supports arbitrary user-defined URL/method/headers/JSON template (`notify/webhook.go`)
- LLM API calls, MCP server calls (stdio/HTTP/SSE), GitHub release checks, ScopeSentry sync (all covered above)

## Internal Integration Surface (backend ↔ frontend)

- REST `/api/*` served by Go net/http mux (`server/server.go`, ~200 routes); frontend calls via `fetch` wrapper `web/src/lib/api.ts`
- SSE for live streams: activity per task (`server/broadcast.go` pub/sub → `server/server.go:3015,3087`), side questions (`server/side_questions.go:544`), update progress (`server/update.go:339`); client uses `EventSource` (`web/src/lib/api.ts:openSSE`)
- In production the static frontend is embedded in the same binary/port; in dev, Next rewrites `/api/*` to `http://localhost:8787` (`web/next.config.mjs`)
- MITM recording proxy on :8788: workers route Bash/HTTP through it (`HTTP_PROXY` + `SSL_CERT_FILE`/`CURL_CA_BUNDLE` CA injection, `server/manager.go`); the Playwright browser MCP gets `--proxy-server` + `NODE_EXTRA_CA_CERTS` (`server/manager.go:syncBrowserMCPProxy`)

---

*Integration audit: 2026-10-10*
