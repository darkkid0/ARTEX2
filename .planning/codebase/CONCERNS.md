---
last_mapped_commit: 6a2bba46378cbeaab2b39c03df7ace2fb2318f57
last_mapped_at: 2026-10-10
---
# Codebase Concerns

**Analysis Date:** 2026-10-10

ARTEX is a Go 1.26 LLM-driven pentest-orchestration platform (22 packages, ~98k lines of non-vendor Go, 161 test files) with an embedded Next.js 16 frontend. The codebase is unusually well-commented and security-aware for its size, but concentrates significant risk in a few large files, in-memory-only state, and a release-only CI pipeline that never runs the test suite.

## Tech Debt

**`server.go` God object (highest-impact debt):**
- Issue: A single 4,002-line file defines the `Server` struct (8+ mutexes: `scheduleMu`, `concMu`, `cfgMu`, `chatMu`, `queueMu`, `profMu`, `provCacheMu`, `taskAgentMu`), 264 HTTP route registrations, 114 functions, and helper types. `server/server_mgmt.go` adds another 2,232 lines.
- Files: `server/server.go`, `server/server_mgmt.go`
- Impact: Every feature (chat, triggers, LLM profiles, archives, SSE, workspace) edits the same file → merge conflicts, lock-ordering bugs, hard onboarding. Lock discipline is by convention only; nothing prevents a new handler from grabbing `cfgMu` then `profMu` in a different order elsewhere.
- Fix approach: Extract route groups into per-domain files (chat, llm, triggers, workspace) behind small interfaces; keep `Server` as a composition root. Do this incrementally per feature area — not a big-bang split.

**In-memory-only state lost on restart:**
- Issue: P3 trigger queue (`triggerQ`/`triggerActive`/`triggerCfg` under `queueMu`), per-task chat busy map (`chatBusy`, `chatCancel`), provider caches (`provByProfile`), and the Guard audit ring buffer (capped at 2000 entries, `guard/guard.go:181-189`) all live only in process memory.
- Files: `server/server.go:79-104`, `guard/guard.go:33,181-189`
- Impact: A restart drops pending trigger fires (mitigated: scheduler re-fires from DB watermarks, per `server/server.go:85-86`) and erases the tool-call audit trail. The audit log is the safety boundary's evidence — losing it on restart weakens the security story.
- Fix approach: Persist Guard audit entries to PostgreSQL (the `activity` table or a dedicated `guard_audit` table); the trigger queue already has a documented DB recovery path — leave it.

**No-op GC endpoint:**
- Issue: `POST /api/gc` returns `{"removed": 0}` — a documented stub ("GC not yet implemented in the new asset store").
- Files: `server/server.go:3953-3957`, route at `server/server.go:819`
- Impact: Frontend/agents may believe asset garbage collection works; orphaned blob files accumulate.
- Fix approach: Either implement blob-GC against the content-addressed store (`traffic/traffic.go:545-556` pattern) or remove the route and any UI calling it.

**RoE (rules-of-engagement) scope mechanism removed, not replaced:**
- Issue: `guard/guard.go:3-4` states the RoE authorization-scope mechanism was removed with "a replacement may be added later". `enrich/enrich.go:6` still claims "HTTP probing is gated by RoE (§5.2)" — the comment is stale; `enrich/enrich.go:122` (`ProbeSite`) enqueues unconditionally.
- Files: `guard/guard.go`, `enrich/enrich.go`
- Impact: The platform auto-probes any URL an agent enriches, with no scope gate — for a pentest tool this is both a safety gap and a documentation/reality mismatch.
- Fix approach: Re-add an allowlist scope check (asset/company scope already exists in `db/company_scope.go` — wire it into `enrich.Engine.enqueue`), or correct the doc comments.

**Error-swallowing at scale:**
- Issue: 366 `_ =` / `, _ :=` discards in `server/` alone (excluding tests), plus ~20 `//nolint:errcheck` on `defer tx.Rollback()` (those are benign). Individual discards are mostly justified in comments, but there is no lint gate keeping the count from growing.
- Files: `server/*.go` (e.g., `server/conversations.go:537` uses `context.Background()` detached from request lifecycle)
- Impact: Silent failures in error paths that were "unlikely to fail".
- Fix approach: Add `errcheck`/`golangci-lint` with a baseline file; new violations fail CI.

**No static analysis or test gating in CI:**
- Issue: `.github/workflows/release.yml` is the only workflow. It triggers on tag push / manual dispatch only, and contains zero `go test`, `go vet`, `biome check`, or frontend `npm test` steps — it only cross-compiles and smoke-tests `-h`.
- Files: `.github/workflows/release.yml`
- Impact: The 161 Go test files and 2 frontend test files never run in automation. Regressions reach releases undetected.
- Fix approach: Add a PR/push CI workflow running `go vet ./... && go test ./...` (Postgres service container already exists in the release workflow — copy that stanza) and `npm run check` in `web/`.

**Frontend tests are orphaned:**
- Issue: `web/src/lib/activity-merge.test.mjs` and `chat-mentions.test.mjs` use `node:test`, but `web/package.json` has no `test` script and nothing invokes them.
- Files: `web/package.json`, `web/src/lib/*.test.mjs`
- Impact: They rot silently; contributors don't know they exist.
- Fix approach: Add `"test": "node --test src/lib/*.test.mjs"` (needs a TS-capable loader — Node 22 `--experimental-strip-types` or tsx) and wire into CI.

**Very new Go requirement:**
- Issue: `go.mod` declares `go 1.26.3` — bleeding-edge toolchain; distro-packaged Go will fail to build.
- Files: `go.mod:3`
- Impact: Contributor friction; CI/`install.sh` (`install.sh:94`) already demand a manual Go install.
- Fix approach: Acceptable for now; document the exact toolchain version in README (partially done).

## Known Bugs

No open bug trackers or TODO/FIXME markers were found in source (zero `TODO`/`FIXME`/`HACK` comments in all non-vendor Go and frontend code — issues are instead documented in `CHANGELOG.md` §修复的问题 with regression tests, e.g. the 0.3.15 security-audit fixes). The following latent defects were identified by inspection:

**Stale-capacity GC comment / drop-on-full enrichment:**
- Symptoms: `enrich.Engine.enqueue` silently drops DNS/HTTP enrichment jobs when the channel is full (`enrich/enrich.go:128-136`) — best-effort by design, but assets then permanently lack `attrs.dns`/`attrs.http` with only a log line.
- Files: `enrich/enrich.go:128-136`
- Trigger: Burst of new assets faster than the worker pool drains.
- Workaround: None; re-probe by re-touching the asset.

**Trigger queue unbounded growth under a stalled agent:**
- Symptoms: `triggerQ` is buffered in-memory per agent; if an agent's runs never complete (LLM hang without timeout), queued fires accumulate with no cap.
- Files: `server/server.go:79-91`
- Trigger: Long-running/stuck agent conversation with active P3 triggers.
- Workaround: Restart (queue is rebuilt from watermarks).

## Security Considerations

The codebase shows strong security hygiene in most areas (bcrypt password storage, first-run password bootstrap race fixed via PK constraint at `server/auth.go:189`, SSRF dial-guard in notify with DNS-rebinding coverage at `notify/ssrf_test.go`, credential masking with rebind-detection at `notify/mask.go`, hardened self-update with host allowlist + SHA256 at `selfupdate/github.go:30-49`, zip-slip tests at `server/skill_upload_test.go:222`, workspace path traversal neutralized at `server/workspace.go:29-36`). Remaining open items:

**JWT passed in URL query string:**
- Risk: `extractToken` accepts `?token=` for SSE connections (`server/auth.go:106-113`). URLs land in proxy logs, browser history, and `Referer` headers. Tokens are valid 7 days (`jwtTTL`, `server/auth.go:23`) and cannot be revoked (HS256, no server-side session list).
- Files: `server/auth.go:23,106-113`
- Current mitigation: JWT required on all routes; token only in query for SSE (EventSource cannot set headers).
- Recommendations: Move SSE auth to a short-lived one-time ticket exchanged via cookie/header; or accept `Last-Event-ID`-style reconnect with cookie auth (cookies work on same-origin EventSource).

**LLM API keys stored plaintext in PostgreSQL:**
- Risk: `llm_profiles.api_key` is plain `TEXT` (`db/schema.sql:369`). Masked on API read (`db/config.go:21-22`, `__masked__` scheme in `notify/mask.go`) but plaintext at rest in DB dumps, backups, and `pg_dump` output.
- Files: `db/schema.sql:369-370`, `db/config.go:81-84`
- Current mitigation: Read-path masking only (`profileCols` vs `profileColsKey` split, `db/config.go:83-84`).
- Recommendations: Envelope-encrypt with a key from `jwt.key`-style file or environment; at minimum document backup exposure.

**`InsecureSkipVerify: true` in MCP HTTP client:**
- Risk: `mcphttp/client.go:106,131` disables TLS verification unconditionally. The enrich package's use (`enrich/enrich.go:90-96`) is justified (MITM proxy re-signs everything — comment documents this), but the MCP client connects to operator-configured servers where a MITM could inject tool definitions into agent context.
- Files: `mcphttp/client.go:106,131`
- Current mitigation: None for MCP path.
- Recommendations: Verify certs by default; offer a per-server opt-out setting.

**No CSRF defense for cookie-authenticated surface:**
- Risk: Basic-auth gate sets a session cookie (`server/basic_auth.go:112-119`); state-changing routes accept POST without CSRF tokens or Origin checks. CORS `Access-Control-Allow-Origin: *` is the default (`server/server.go:3962`), with credentials only mirrored for localhost dev pairing (`server.go:3967-3974`).
- Files: `server/server.go:3960-3982`, `server/basic_auth.go`
- Current mitigation: Primary auth is `Authorization: Bearer` (not auto-sent cross-origin); cookie path is the Basic Auth gate only.
- Recommendations: Add `Origin`/`Sec-Fetch-Site` validation on mutating routes when a gate cookie is present.

**Auth endpoints lack rate limiting:**
- Risk: `/api/auth/login` (`server/auth.go:261-296`) and the Basic Auth gate allow unlimited attempts; bcrypt's ~50ms/cost is the only brake. No account lockout or backoff.
- Files: `server/auth.go`, `server/basic_auth.go:140-143`
- Current mitigation: bcrypt cost + single fixed username (`ARTEX`).
- Recommendations: Simple per-IP token-bucket (the notify package already implements one — reuse the pattern).

**Arbitrary Python/shell execution is a design feature, gated only by intercept rules:**
- Risk: Custom tools run Python via `execPython` (`server/customtool.go:379-415`) and shell commands through the Bash tool (`server/customtool.go:331-351`), inheriting session proxy env. Guard interception (`guard/guard.go:83`) applies only DB-seeded regex rules; a user disabling built-in rules removes all destructive-command gating (the changelog's v3 seed rule for delete endpoints exists precisely because of this class of gap).
- Files: `server/customtool.go`, `guard/guard.go`, `db/db.go:583-600` (v3 seed rule)
- Current mitigation: Intercept rules are seedable and priority-ordered; "ask" action routes to human approval (`intercept/intercept.go:8-12`).
- Recommendations: Keep as designed (pentest platform), but surface a prominent warning when all built-in deny rules are disabled.

**Docker compose disables TLS to Postgres:**
- Risk: `sslmode=disable` on the app→DB DSN (`docker-compose.yml:23`); DB password travels plaintext on the compose network.
- Files: `docker-compose.yml:23`
- Current mitigation: Traffic stays on the internal compose network; Postgres port is not published to the host.
- Recommendations: Acceptable for the default deployment; document for users exposing the DB.

**`.env` permissions:**
- Risk: `.env` (contains `POSTGRES_PASSWORD`) is mode 644 on this checkout. Gitignored (`/.env` in `.gitignore:43`), so not committed — but world-readable on disk.
- Files: `.env` (existence only; contents not read per policy)
- Recommendations: `chmod 600` in `install.sh` post-copy.

## Performance Bottlenecks

**Traffic data growth is manual-lifecycle:**
- Problem: `data/` holds 27 GB / ~180k files on this deployment. Bodies ≤256 KB inline into `index.sqlite`; larger spill to content-addressed blobs (`traffic/traffic.go:90-92,545-556`). Deletion is host-scoped (`DeleteHost`, `traffic/traffic.go:1030`) and reclaim required a dedicated fix (`traffic/reclaim_test.go:35-52`).
- Files: `traffic/traffic.go`
- Cause: No retention policy/TTL — everything is kept until an operator deletes per-host.
- Improvement path: Add age/size-based retention with the existing staged-delete machinery (`StageDeleteHostsExact`, `traffic/traffic.go:1373`).

**Whole-graph load inside intent transaction:**
- Problem: Intent state transitions load all exploration nodes and edges into memory inside the write transaction (`db/exploration.go:455-478`); the comment bets "图规模对真实任务很小" (graph is small for real tasks).
- Files: `db/exploration.go:444-478`
- Cause: Protected/downstream-reachability computed in Go over the full graph per intent operation.
- Improvement path: Fine until ~10⁴ nodes/task; at that point precompute reachability or scope the query to connected components.

**Activity table unbounded:**
- Problem: `activity` (per-step agent telemetry incl. token counts, `db/schema.sql:298-316`) has 5 indexes and no partitioning/retention; every planner round and tool call appends rows.
- Files: `db/schema.sql:298-338`, `db/exploration.go:1204-1212`
- Cause: History is a feature (session transcripts paginate from it).
- Improvement path: Monthly range partitions + a retention job, or archive with the existing task-archive flow (`db/task_archives.go`).

**Guard audit copy on every read:**
- Problem: `Guard.Audit()` deep-copies up to 2000 entries per call (`guard/guard.go:191-197`); the audit UI polls it.
- Files: `guard/guard.go:181-197`
- Cause: Simple mutex + slice design.
- Improvement path: Negligible at current scale; switch to a cursor-based read if the UI polls faster.

## Fragile Areas

**LLM provider wiring (`applyLLM` / profile caches):**
- Files: `server/server.go:56-118,441,570`, `server/task_llm.go`
- Why fragile: Five interacting caches/registries (`provByProfile`, `llmHealth` circuit-breaker, `taskAgents` bundles, `profChatAgents`, global `llmProv`) with documented invalidation rules ("cleared on profile edits, then repopulated by active reapply"). `llmHealth` deliberately lives outside the caches so chain rebuilds don't erase breaker state (`server.go:107-111`) — subtle by design, easy to break when touching profile save/delete paths.
- Safe modification: Always go through `applyLLM`/`saveLLMRetryPolicy`; never mutate `provByProfile` directly; keep the `provCacheGen` generation check intact.
- Test coverage: `server/llmpool_test.go`, `server/chat_llm_resolve_test.go`, `server/engine_cancelcause_test.go` exist but failover-chain rebuild paths are thinly covered.

**Task delete / archive-restore choreography:**
- Files: `server/task_archives.go`, `server/task_delete_barrier_test.go`, `db/task_archives_restore.go`, `server/manager.go:1442-1538`
- Why fragile: Delete installs an execution barrier (`engine.beginTaskOperation`, `server/engine_timeout.go:46-54`), stages traffic trees, restores them on failure (`manager.go:1533-1538` restores both traffic AND files after partial failure), and coordinates with schema-migration advisory locks (`db/db.go:89-98`). Multiple failure points each with rollback duties.
- Safe modification: Preserve the stage-then-commit-then-reap ordering (`traffic/traffic.go:1030-1060`); never delete blobs before the index transaction commits.
- Test coverage: `task_delete_barrier_test.go`, `task_delete_concurrency_test.go`, `db/task_archives_restore.go` tests — decent, but the multi-error rollback join paths deserve fault-injection tests.

**Self-update 3-process dance:**
- Files: `selfupdate/selfupdate.go:16-27`, `selfupdate/bootstrap.go`, `start.sh`, `start.bat`
- Why fragile: Upgrade spans three process restarts via exit code 75, staged binary + SHA256 + smoke test + auto-rollback after 3 failed boots (`maxAttempts`, `selfupdate/selfupdate.go:38`). Windows/Unix path symmetry handled manually (`ResolvePaths`).
- Safe modification: Any change must keep the marker file (`artex.upgrade.json`) protocol stable — old and new versions exchange it.
- Test coverage: `selfupdate_test.go`, `github_test.go` cover pieces; the full 3-boot sequence is script-level and untested in CI.

**Idempotent schema.sql as migration log:**
- Files: `db/schema.sql` (1,531 lines, 58 tables, 89 indexes, inline `ALTER TABLE ... IF NOT EXISTS` blocks and seed procedures)
- Why fragile: No versioned migrations — evolution is appended conditional DDL (e.g. `db/db.go:583-600` seeds intercept-rule v3 guarded by a settings flag). Long archive transactions must coordinate via advisory lock with startup DDL (`db/db.go:89-98`), and startup has deadlock-retry logic (`db/db.go:41-45,63-76`).
- Safe modification: Append new `IF NOT EXISTS` blocks; never edit existing ones (they no-op on upgraded DBs, so edits silently diverge deployed schemas).
- Test coverage: `db/db_test.go`, `llm_records_migrate_test.go` — schema-drift across old versions is the untested surface.

## Scaling Limits

**Single-instance architecture:**
- Current capacity: One process owns all agent runtime state (engine goroutines, `sync.Map`s in `server/engine.go:140-145`, per-task `Manager.tasks` map with `RWMutex`).
- Limit: Cannot run two server instances against one PostgreSQL DB — engine loops, chat-busy serialization, and trigger queues would double-run tasks.
- Scaling path: Vertical only. Horizontal would require extracting the engine into a lease-based worker (DB as queue) — a re-architecture, not a config change.

**PostgreSQL connection pool:**
- Current capacity: `maxOpenConns = 32` (`db/db.go:27-31`), sized below PG's default `max_connections=100` and above the app's known nesting depth (schema advisory lock + `seedBuiltins`).
- Limit: Each task's planner/worker/chat share the pool; ~10-15 concurrent agent runs with activity writes will saturate it, and callers block on `db.SQL` rather than queueing agent work.
- Scaling path: Raise alongside PG `max_connections`, or add admission control at task level (concurrency limiter already exists — `server/manager.go:292-318` — but doesn't cover chat/agent paths uniformly).

**SQLite traffic index:**
- Current capacity: Single `index.sqlite` with FTS5 + incremental vacuum (`traffic/traffic.go:275-292`); one writer mutex (`wmu`) serializes all recording.
- Limit: High-traffic captures serialize through one lock and one file; the comment at `traffic/traffic.go:1698-1700` notes a multi-GB copy under that lock would stall `record()` (which go-mitmproxy calls inline).
- Scaling path: Shard per-host index files, or move the index to Postgres and keep blobs content-addressed.

## Dependencies at Risk

**`github.com/Autumn-27/norma` v0.4.3:**
- Risk: Core LLM agent framework (providers, tools, hooks, transcripts) is a same-author personal package — the project's single most critical dependency, with bus-factor 1 and no visible external governance.
- Impact: A breaking norma release or abandonment stalls all agent development.
- Migration plan: Vendoring or forking under the RuoJi6 org; the interface surface used (`llm.Provider`, `actool.CoreTool`, `hook.Registry`) is small enough to wrap behind local interfaces if norma drifts.

**`github.com/lqqyt2423/go-mitmproxy` v1.9.2:**
- Risk: Third-party MITM proxy embedded deeply (`traffic/traffic.go:36,109-214`); upstream is a solo-maintained project. ARTEX depends on its addon hook semantics (`sink.RequestError` → passthrough, `traffic/traffic.go:402-403`).
- Impact: TLS-interception bugs or upstream breakage hits the core capture feature.
- Migration plan: None short-term; pin the version and monitor upstream issues.

**`github.com/satori/go.uuid` v1.2.0 (indirect):**
- Risk: Unmaintained library (known issue: non-crypto-safe random in old versions) pulled in transitively.
- Impact: Indirect only — appears in `go.sum` via a dependency; no direct calls found in ARTEX source.
- Migration plan: Watch for it dropping out on dependency upgrades; do not adopt directly.

**`modernc.org/sqlite` v1.52.0:**
- Risk: Pure-Go SQLite transpiled from C — slower than cgo drivers and occasionally lagging SQLite releases.
- Impact: Traffic index throughput ceiling (see Scaling Limits).
- Migration plan: Acceptable while single-writer mutex dominates; revisit if index is sharded.

**Go 1.26.3 toolchain:**
- Risk: `go.mod` requires the newest Go release; `golang.org/x/*` and modernc libraries must all track it.
- Impact: Security patches to older toolchains won't apply; CI depends on `go-version-file`.
- Migration plan: Bump promptly with each Go release; the release workflow already pins via `go-version-file`.

## Missing Critical Features

**Test execution in CI:**
- Problem: No workflow runs `go test ./...` or frontend tests (see Tech Debt).
- Blocks: Confidence in the 161 existing Go test files ever paying off; safe dependency upgrades.

**Audit-log persistence:**
- Problem: Guard audit (the record of blocked/allowed destructive tool calls) is memory-only and capped at 2000 entries.
- Blocks: Security incident review, compliance evidence after restarts.

**Asset-store GC:**
- Problem: `POST /api/gc` is a stub.
- Blocks: Reclaiming orphaned blob storage after task deletion edge cases.

**Agent run-rate limiting on chat/main-agent paths:**
- Problem: The concurrency limiter covers task admission (`server/manager.go:292-318`), but chat-driven main-agent runs serialize per task only (`chatBusy`), not against a global budget.
- Blocks: Predictable LLM spend under many concurrent chat sessions.

## Test Coverage Gaps

**CI never runs any of these tests** (highest-priority gap — everything below is unenforced):

**Failover-chain rebuild paths:**
- What's not tested: Provider cache invalidation and circuit-breaker state preservation across profile save/delete/activate sequences (`server/server.go:98-111`, `server/task_llm.go`).
- Files: `server/llmpool_test.go`, `server/chat_llm_resolve_test.go`
- Risk: Silent mis-routing of agent LLM traffic or rate-limiter doubling — the exact bugs the comments warn about.
- Priority: High

**Self-update full sequence:**
- What's not tested: The 3-boot choreography (stage → swap → rollback) end-to-end; only units (`selfupdate_test.go`, `github_test.go`).
- Files: `selfupdate/bootstrap.go`, `start.sh`, `start.bat`
- Risk: A bricked update is the worst user outcome for a self-updating security tool.
- Priority: High

**Intercept rule evaluation against adversarial inputs:**
- What's not tested: User-authored regex rules with pathological (though RE2-linear) patterns, and rule-priority interactions allow/deny/ask across nested tool calls.
- Files: `intercept/intercept.go`, `guard/guard_test.go`
- Risk: A bypassed deny rule on a destructive command — the platform's core safety promise.
- Priority: High

**Schema drift across upgrade paths:**
- What's not tested: Startup against databases seeded several versions back (the `IF NOT EXISTS`/flag-guarded seed chain, e.g. intercept v1→v3 in `db/db.go:583-600`).
- Files: `db/schema.sql`, `db/db_test.go`
- Risk: Long-lived deployments (the tool's own update mechanism encourages them) hitting migration errors.
- Priority: Medium

**Frontend logic:**
- What's not tested: Everything except `activity-merge` and `chat-mentions` merge logic; no component or API-layer tests; no test script wired up.
- Files: `web/src/lib/`, `web/src/app/`
- Risk: SSE cursor/reconnect and scope-filtering regressions reach production.
- Priority: Medium

**Multi-error rollback in delete flows:**
- What's not tested: Partial-failure joins where traffic restore AND file restore both run (`server/manager.go:1533-1538`) — fault injection only.
- Files: `server/manager.go`, `db/task_archives_restore.go`
- Risk: Orphaned blobs or half-deleted tasks after a crashed delete.
- Priority: Medium

---

*Concerns audit: 2026-10-10*
