---
last_mapped_commit: 6a2bba46378cbeaab2b39c03df7ace2fb2318f57
last_mapped_at: 2026-10-10
---
# Testing Patterns

**Analysis Date:** 2026-10-10

## Test Framework

**Backend — Go standard library (no external assertion framework):**
- Runner: `go test ./...` (Go 1.26.3). README documents this as the test command (`README.md:364`)
- No testify **imports** — it appears only as an indirect dependency in `go.sum`. All assertions are stdlib `if !cond { t.Fatal... }` style
- No CI test workflow (`.github/workflows/release.yml` is release-only); tests run locally / by convention before release

**Frontend — Node.js built-in test runner:**
- `node:test` + `node:assert/strict`, NOT Jest/Vitest/Biome tests — `web/src/lib/activity-merge.test.mjs`, `web/src/lib/chat-mentions.test.mjs`
- No `test` script in `web/package.json`; run manually: `node --test src/lib/*.test.mjs` from `web/`

**Run Commands:**

```bash
go test ./...                      # All backend tests (skips PG suites without DB)
go test ./server/ -run TestFinding # One package / one test
go test -race ./...                # Concurrency checks (codebase uses sync/atomic heavily)
node --test src/lib/*.test.mjs     # Frontend (from web/; no npm script defined)
```

**Postgres dependency:** `server/`, `agent/`, `db/`, `evidence/` suites require a real PostgreSQL via `ARTEX_PG_DSN` (see `.env.example`). Tests degrade gracefully — no DSN → suites self-skip:

```go
if err != nil {
    t.Skipf("postgres unavailable (%v) — skipping", err)
}
```

(`server/task_templates_test.go:19`, 1,450 `t.Skip*` call sites repo-wide)

## Test File Organization

**Location:** Co-located with source, same package (white-box). `guard/guard.go` ↔ `guard/guard_test.go`. No `tests/` directory.

**Scale:** 161 test files / 697 `TestXxx` functions / 68 `t.Run` subtests outside `data/` (which contains vendored task fixtures — ignore it). Heaviest packages: `server` (52 files), `db` (49), `agent` (25), `notify` (11), `traffic` (7).

**Naming:**
- `TestXxx` for each behavior contract; names describe the contract, not the function: `TestHardFailureTripsBreakerImmediately`, `TestFailoverOnNoCredit`, `TestSessionHeaderSkippedWhenNoSessionID` (`llmpool/pool_test.go:115`, `agent/session_header_test.go:59`)
- Behavioral scenario files: one fixture file per feature area — `server/notify_api_test.go`, `server/intercept_review_test.go`

**Structure:** test files mirror the source file they cover (`server/finding_traffic_test.go` ↔ `server/finding_traffic.go`).

## Test Structure

**Suite Organization — plain functions, helper closures, file-header commentary:**

```go
// server/notify_api_test.go — file header states scope + safety caveats
func TestTaskTemplateHTTPCRUD(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")   // isolated data dir per test
	if err != nil {
		t.Skipf("postgres unavailable (%v) — skipping", err)
	}
	defer m.Close()

	do := func(method, path string, body any) (int, map[string]any) {  // local request helper
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		...
		return rec.Code, out
	}
	// act → assert with t.Fatalf on each contract point
}
```

(`server/task_templates_test.go:18-105`)

**Patterns:**
- `t.Helper()` as first line of every fixture/helper function (`server/finding_traffic_test.go:24`, `llmpool/pool_test.go` fixtures)
- `t.Cleanup(func(){ ... })` for DB-row deletion and state restore — never cross-test residue (`server/notify_api_test.go:65,83-87`, `server/task_templates_test.go:51`)
- `t.Setenv` for env-scoped config (`t.Setenv(notify.AllowLocalTargetsEnv, "1")` — `server/notify_api_test.go:51`)
- `t.TempDir()` for every filesystem touch — `traffic/traffic_test.go:40`, `selfupdate/selfupdate_test.go:15`
- `t.Context()` used in newer tests (`db/db_test.go:28`); `context.Background()` in older ones — prefer `t.Context()` for new tests
- Assertion style: `t.Fatalf` for aborting contracts (8632 uses), `t.Errorf` for continue-on-fail loops (2119), `t.Fatal(err)` when a setup step fails
- Subtests via `t.Run` for input-variant matrices: `t.Run(action, ...)` over allow/ask/deny (`intercept/prompt_test.go:13-23`), `t.Run(fmt.Sprint(n))` over boundary sizes (`sidequestion/context_test.go:38`)

**Parallelism:** almost none — 22 `t.Parallel()` calls total. Suites sharing the dev database serialize explicitly: `db/`, `agent/`, `server/`, `evidence/` `TestMain` functions all acquire PostgreSQL advisory lock `7337741002` so `go test ./...` never races cross-package cleanup (`db/testmain_test.go:12-31`, `agent/testmain_test.go:11-28`, `evidence/testmain_test.go`). Replicate this pattern if a new package touches PG.

## Shared Test Fixtures (server package)

The `server` package builds its HTTP tests on shared fixtures returning a request helper:

```go
// server/finding_traffic_test.go:23
func trafficEvidenceServer(t *testing.T) (*Server, *db.RecordedFinding, func(string, string, string) *httptest.ResponseRecorder)
```

- Creates a `Manager` in `t.TempDir()`, opens traffic store on `:0` (ephemeral port), seeds one task + finding, signs a JWT via `signJWT(s.jwtKey)`
- Returns a closure `request(method, path, body)` that injects the auth header and drives the full `s.Handler()` — tests exercise real routing/middleware, not handler internals
- Reused by `finding_traffic_test.go`, `finding_cases_test.go`, `notify_api_test.go:52`

Fixture-with-methods pattern for feature areas:

```go
type notifyFixture struct { s, pg, request, n, taskID, expID, cleanupMark ... }
func newNotifyFixture(t *testing.T) *notifyFixture   // sets env, isolates events, registers cleanups
func (f *notifyFixture) record(t, vulnclass, severity) int64
func (f *notifyFixture) deliver(t, chID, baseURL)
```

(`server/notify_api_test.go:34-130`)

## Mocking

**Framework:** none — hand-written fakes defined inline per test file.

**Patterns:**

Scripted fake providers (LLM streaming):

```go
type fakeProv struct {
	name   string
	calls  int
	events [][]llm.StreamEvent // events per call before the error
	errs   []error             // terminal error per call (nil = clean finish)
}
func (f *fakeProv) Stream(ctx, req) iter.Seq2[llm.StreamEvent, error] { ... }
// builders: okProv(name, text), failProv(name, status)
```

(`llmpool/pool_test.go:17-77`)

Fake HTTP transports (capture middleware):

```go
type fakeRT struct{ seen *http.Request }
func (f *fakeRT) RoundTrip(req *http.Request) (*http.Response, error) { ... }
```

(`agent/session_header_test.go:15-23`)

Closure-based fakes (side-question replay):

```go
Load: func(_ context.Context, after int64) ([]Exchange, error) { ... },
Save: func(_ context.Context, value Memory) error { *memory = value; return nil },
```

(`sidequestion/context_test.go:14-25`)

Boundary doubles at the seam the code defines (small consumer interfaces): `toolUsageRecorder`, `mcpClient`, `basicAuthSettingsStore` (`server/tool_usage.go:14`, `server/mcpdiscover.go:18`), `notify.Channel` implementations faked with `httptest.NewServer` receivers (`server/notify_api_test.go` — 489 `httptest.NewServer/NewRecorder` sites repo-wide).

**What to Mock:**
- LLM providers/streams, HTTP transports, notification HTTP receivers, filesystem via `t.TempDir()`, time via injectable funcs (`applySchemaWithRetry` takes `sleep func(time.Duration)` — `db/db.go:64`)
- Real Postgres via shared dev DB — do NOT mock the DB layer; tests assert real SQLSTATE behavior (`40P01` retries, `23503` FK violations)

**What NOT to Mock:**
- HTTP routing/middleware — always go through `s.Handler().ServeHTTP` (`server/task_templates_test.go:39-40`)
- Observables over return values: `stepRealtime/stepDigest` return nothing, so tests assert what the fake receiver received and the delivery-row state (`server/notify_api_test.go:29-31`)
- Guard audit behavior uses real `g.Hooks().PreToolUse` with JSON-marshaled input (`guard/guard_test.go:21-28`)

## Fixtures and Factories

**Test Data:**
- Inline struct literals + small factory functions per file: `member(id, name, rank, p)` (`llmpool/pool_test.go:79`), `activity(seq, kind, extra)` (`web/src/lib/activity-merge.test.mjs:5-12`), `testPaths(t)`/`fakeBin(t, ...)` (`selfupdate/selfupdate_test.go:14-37`)
- Seed rows via direct SQL inserts into the test store: `traffic/traffic_test.go:52-59`, `server/finding_traffic_test.go:68-78`
- Timestamped unique names to dodge unique constraints: `fmt.Sprintf("http-template-%d", time.Now().UnixNano())` (`server/task_templates_test.go:41`)

**Location:** no central `testdata/` for project packages; fixtures are code-local. (`data/tasks/**` testdata directories belong to vendored agent-task artifacts, not this project's tests.)

**Backend edge-cases over 127.0.0.1:** notify tests explicitly allow loopback (`t.Setenv(notify.AllowLocalTargetsEnv, "1")`) because the SSRF guard denies it by default; the deny behavior itself is covered in `notify/ssrf_test.go` (`server/notify_api_test.go:47-51`).

## Frontend Testing

**Framework:** `node:test` + `node:assert/strict` on `.test.mjs` files that import TS directly (`import { mergeActivities } from "./activity-merge.ts"` — Node's TS support).

**Structure:**

```js
import assert from "node:assert/strict";
import test from "node:test";

test("overlapping poll responses render tool 198 only once", () => {
  const merged = mergeActivities(mergeActivities([], first), second);
  assert.deepEqual(merged.map((item) => item.seq), [197, 198, 199]);
  assert.deepEqual(mergeActivities(merged, second), merged);   // idempotency
});
```

(`web/src/lib/activity-merge.test.mjs:1-21`)

**Patterns:**
- Test **pure lib functions only** (`activity-merge.ts`, `chat-mentions.ts`) — no component/DOM testing, no React Testing Library, no test runner config
- Cover ordering, dedup/idempotency, immutability (frozen inputs), and CJK-specific behavior (`web/src/lib/chat-mentions.test.mjs` tests Chinese mention triggers)
- `web/src/lib/mock/handler.ts` keeps request handling testable by routing through pure functions; mock data never mutated in place

**When adding pure logic to `web/src/lib/`:** write a colocated `*.test.mjs` with `node:test` following these two files.

## Coverage

**Requirements:** None enforced (no cover profile config, no CI gate).

**View Coverage:**

```bash
go test -cover ./...
go test -coverprofile=cover.out ./server/ && go tool cover -html=cover.out
```

## Test Types

**Unit Tests:**
- Dominant type. Pure-function contracts (`intercept/prompt_test.go` verdict parsing incl. malformed/fenced/truncated LLM output), policy state machines (`llmpool/health_policy_test.go` breaker ladder), header/transport injection (`agent/session_header_test.go`)

**Integration Tests:**
- HTTP API round-trips through the full server with real Postgres (`server/task_templates_test.go` CRUD + status-code contract), end-to-end notification delivery to local HTTP receivers (`server/notify_api_test.go`), self-update zip swap with fake binaries (`selfupdate/selfupdate_test.go`)

**E2E Tests:** Not used (no browser/E2E framework). `skills/playwright-cli` is a runtime skill for the pentest agents, not test infrastructure.

## Common Patterns

**Error-path testing — enumerate malformed inputs exhaustively:**

```go
for _, reply := range []string{
	"", "ALLOW", `{"decision":"allow"}`, `"decision":"allow","comment":null}`,
	"```json\n" + valid[:len(valid)-1],   // unclosed fence = truncated at MaxTokens
	valid + valid,
} {
	if got := ParseVerdict(reply); got.Action != "" {
		t.Errorf("accepted incomplete/ambiguous verdict: %q => %+v", reply, got)
	}
}
```

(`intercept/prompt_test.go:31-53`)

**Boundary + state-machine testing — walk the exact thresholds:**

```go
for _, n := range []int{19, 20, 21, 50} {   // 20-exchange window boundary
	t.Run(fmt.Sprint(n), func(t *testing.T) { ... })
}
```

(`sidequestion/context_test.go:38`)

**Async Testing:**
- Goroutine-safe fixtures: `sync.WaitGroup.Wait()` before teardown (`s.archiveWG.Wait()` — `server/finding_traffic_test.go:43`), wait on done channels (`<-s.side.done`)
- Cancelled-context construction for lifecycle tests: `ctx, cancel := context.WithCancel(context.Background()); cancel()` (`server/finding_traffic_test.go:40-41`)

**Error Testing (DB layer):**
- Inject typed `*pgconn.PgError{Code: "40P01"}` through an interface stub and assert retry delays exactly (`db/db_test.go:27-52`)

---

*Testing analysis: 2026-10-10*
