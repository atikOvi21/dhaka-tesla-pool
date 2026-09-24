# Progress

## Current checkpoint - single-booking ride lifecycle verified

Verified 24 September 2026. Branch: **feature/ride-lifecycle**. Authentication was integrated into master first; rides remain on their feature branch for review. No push, deployment, release branch, history rewrite, or shared-pooling implementation.

### Authentication integration

Inspected the actual five outstanding paths: apps/api/src/app.test.ts and apps/api/src/auth/{auth.integration.test.ts,config.ts,index.ts,service.ts}. Compared each with HEAD through the same TypeScript formatter and reviewed the remaining method-chain whitespace diff. Confirmed formatting only, with no altered string contents or behavior. Backend typecheck, 19 isolated PostgreSQL auth tests and five API tests passed. Preserved the edits in **641615a - style(auth): preserve existing backend formatting**. Fast-forwarded feature/auth into master locally, then created feature/ride-lifecycle from master.

### Completed behavior

All requested reference, passenger and driver endpoints are implemented. Passenger UI supports route/seat selection, solo fare preview, idempotent creation, active booking, cancellation, details and history. Driver UI supports online/offline, paginated waiting requests, acceptance, arrival, start, individual drop-off, pool completion, details and history. Five-second polling avoids overlapping reads and aborts on navigation/logout. Authentication, CSRF, retryable failures, role guards, accessibility and /foundation remain available. Protected detail/history deep links work.

One booking per pool may reserve multiple seats. No permanent single-booking constraint was added. Shared matching, extra bookings and pooling discounts are pending. Solo 3 km / one seat is 50 BDT; final fare freezes at arrival. Pre-arrival cancellation has no charge. Same-key retries return the original booking even after cancellation; changed payload conflicts. The browser retains uncertain submission intent in sessionStorage, clears it when confirmed/recovered, and never automatically replays mutations.

Every ride mutation acquires the same PostgreSQL transaction advisory lock before reading business state. This provides consistent cross-process serialization at demo scale, including cancellation/arrival and competing acceptance. Requests, memberships, allocated seats, fare finalization and events commit atomically. Reads use repeatable-read transactions. Explicit limitations and the future row-lock plan are in [ride lifecycle](ride-lifecycle.md) and [architecture](architecture.md).

### Checks actually run

- Authentication integration gate: backend typecheck, **19 auth/PostgreSQL tests + 5 shared API tests passed**.
- **17 ride/PostgreSQL tests passed** through npm run test:rides -w @dtp/api on disposable PostgreSQL :5434. Covers complete lifecycle, half-up rounding and seats, immutable fare snapshots, invalid inputs, active uniqueness, concurrent idempotent retries, competing acceptance, offline acceptance, cancellation/acceptance and cancellation/arrival races, availability race, ownership/privacy, histories, repeated actions and rollback after a forced later database-write failure.
- **22 frontend tests passed** through npm test -w @dtp/web: 16 authentication + 6 ride tests. Covers retained/recovered/new request keys, duplicate submissions, polling cleanup and error/expiry handling. An initial recovery assertion ran before its React cleanup effect; it now correctly waits for that effect.
- **5 shared API tests passed again** after ride integration.
- **One real ride browser journey passed** using separate Nusrat/Jashim contexts against isolated Nginx/API/PostgreSQL :8081. Covered lost successful booking response and reload recovery, complete lifecycle at 50 BDT, both histories, direct detail navigation, refresh, a two-seat matched cancellation, zero remaining allocation, going offline and no browser errors.
- **Two existing authentication/mobile browser regressions passed** against the same isolated stack. No browser tooling blocker.
- Root npm run typecheck and npm run build passed for both workspaces.
- Full docker compose build passed. Final web-only rebuild passed after updating /foundation's status text. docker compose up --no-build -d --wait passed with main database/API/web healthy and init successful.
- Main :8080 readiness and routes returned 200. Direct /passenger/history, /driver/history and /foundation returned the SPA entry.
- Desktop passenger and mobile driver ride screenshots were visually inspected; no overflow in the browser checks. Screenshots are under docs/images.
- git diff --check passed.
- No unrelated foundation test cycle or development-data reset. Backend fixtures used unique test identities/routes in the disposable database; browser fixtures lived in a separate tmpfs stack. Both test stacks were stopped/removed afterward. Main :8080 remains running.
- Docker full dependency installation still reports four high tooling advisories; runtime prune audits 142 packages with zero vulnerabilities. No forced upgrade or all-dependency clean claim. Prisma/pg emitted a future pg@9 concurrent-query deprecation warning during tests; installed pg8 tests passed.

### Commits and handoff

- **641615a** - style(auth): preserve existing backend formatting (included in master)
- **359bd3a** - feat(rides): implement transactional single-booking lifecycle
- **590368d** - feat(rides): add passenger and driver journey screens
- Documentation checkpoint: **docs(rides): record lifecycle verification and demo guide** (see git log for its hash).
- No outstanding application/user edits are intended to remain; final git status is checked after the documentation commit.

Use [exact manual demonstration steps and test commands](ride-lifecycle.md#manual-demonstration). Login at http://localhost:8080/login in two independent browser sessions: nusrat@demo.dhaka.test and jashim@demo.dhaka.test, both initial password DemoOnly!Dhaka2026. Passenger and driver histories are /passenger/history and /driver/history.

No milestone blocker remains. Ready for review and the next milestone: shared pooling and last-seat concurrency. That milestone has not started. The current acceptance races do not claim multi-booking last-seat safety. Remaining limitations include coarse serialized ride writes, no shared matching/discount, process-local authentication rate limits, no account recovery/email verification, no public HTTPS deployment, and the recorded tooling advisories. Candidate AI accepted/rejected examples still need actual candidate input.

---

## Historical checkpoint - complete authentication verified

Branch: **feature/auth**. Backend authentication was preserved; no backend integration change was needed. Frontend work uses React, straightforward TypeScript, React Router, CSS Modules and native fetch. No ride features, merge, push or deployment.

### Completed

Passenger registration signs in immediately; passenger/driver login routes by the returned role. Session restoration has distinct loading, anonymous and retryable failure states. Protected workspaces reject wrong roles. Logout ends the server session; expiry is detected on focus/visibility and a 60-second visible-page check. CSRF is fetched before mutations and refreshed after login/registration; no automatic mutation retries or localStorage credentials. Forms have labels, validation, keyboard focus, disabled submission, password clearing and retained name/email after errors. Foundation remains public at /foundation. Ride functionality is explicitly upcoming.

### Checks actually run

- 16 frontend Vitest/Testing Library tests passed.
- 19 real-PostgreSQL auth tests and 5 shared API tests passed using the isolated browser-test database.
- Two Playwright journeys passed using headless Microsoft Edge: desktop against real Nginx/API/PostgreSQL, plus mobile layout/keyboard validation.
- Verified registration, seeded Nusrat and Jashim, wrong password, reload, direct protected navigation, wrong-role denial, logout/access afterward, test-session expiry, offline recovery and intercepted GET /auth/me 503 recovery.
- Frontend typecheck and production build passed; full Docker build passed, including API build. Final frontend-only rebuild after formatting/title cleanup passed. Final frontend typecheck passed again.
- Main Docker API/web/database are healthy. Direct GET /driver returned 200 through Nginx; /api/v1/health/ready returned ready.
- Desktop login/passenger and mobile registration screenshots visually inspected; committed under docs/images.
- git diff --check passed before the implementation commit.
- Development records/volume were preserved. The disposable stack was stopped and removed after verification; the main :8080 stack remains running. Browser fixtures used a separate stack at :8081 with a tmpfs database; backend regression tests ran there too. No repeated foundation validation or public deployment.
- Docker full install still reported four high tooling advisories; runtime prune reported zero vulnerabilities. No forced upgrades.

Reproduction commands and manual review are in [authentication](authentication.md#frontend-authentication). Backend regression command used:
```powershell
docker compose -f compose.e2e.yaml run --rm --no-deps -e AUTH_TEST_DATABASE_URL=postgresql://dtp_test:dtp_test_only@db:5432/dhaka_tesla_auth_test init npm exec -w @dtp/api -- vitest run src/auth/auth.integration.test.ts src/app.test.ts
```

### Git and handoff

- e620770 - feat(auth): add PostgreSQL sessions and verified backend authentication
- f8edb91 - docs(auth): record backend verification and frontend handoff
- f3d717e - feat(auth): complete frontend forms and protected session flows
- Documentation commit: docs(auth): record full authentication verification and review steps (see git log for its hash).
- Remain on feature/auth; master is unchanged. Frontend edits incorporate the existing frontend formatting.
- Five pre-existing backend edits remain excluded from these commits: app.test.ts and auth/{auth.integration.test.ts,config.ts,index.ts,service.ts}. Do not discard them or silently include them in frontend work.

Authentication is functionally ready for merge review. No verification blocker remains. Review/preserve the outstanding backend formatting changes before integration. Existing limitations: process-local rate limits, no password recovery/email verification, tooling advisories, no public HTTPS deployment. AI acceptance/rejection disclosure still needs actual candidate input.

Next task, only when requested: implement the complete single-passenger ride lifecycle, beginning with agreed API/state transitions and ownership rules, then transactional backend behavior, UI and focused lifecycle tests. Do not begin pooling, fare or ride implementation during this authentication checkpoint.

---

## Historical backend checkpoint — backend authentication verified

Branch: **feature/auth**. Foundation master was fast-forwarded to 80f9995 after inspecting its recorded verification and PRD-compliant commit subjects. No history rewrite, push, release branch, or authentication merge into master.

At checkpoint start, three pre-existing frontend formatting edits were present: apps/web/index.html, apps/web/src/api.ts, apps/web/src/main.tsx. They were temporarily stashed only for the branch transition, restored, and excluded from backend commits. No frontend authentication or business features were implemented.

### Completed behavior

All five auth endpoints: anonymous CSRF bootstrap, passenger-only registration, passenger/driver login (seed-compatible scrypt), safe /me, logout. Strict validated/normalized email and names, unmodified passwords, duplicate-email constraint handling including races. PostgreSQL-backed sessions with regeneration, explicit save-before-success, fixed eight-hour authenticated / one-hour anonymous expiry, cleanup, matching cookie clearing, exact CSRF/origin checks, reusable auth/role middleware reading authoritative user roles, IP rate limits and bounded password hashing concurrency.

Local HTTP works with explicitly insecure loopback-only cookies; public deployment requires HTTPS/Secure. Nginx forwards a single trusted hop and overwrites client forwarding headers. Existing sessions schema needed no migration. Full details: [authentication](authentication.md).

### Checks actually run for this checkpoint

- Backend TypeScript check passed after integration tests were added.
- Full auth integration suite: **19 passed**, using isolated PostgreSQL dhaka_tesla_auth_test on :5434.
- Initial auth run: 16/17 passed; one assertion incorrectly assumed store expiry had millisecond precision. Installed connect-pg-simple source confirms Math.ceil to whole seconds. Corrected tolerance to <1 second for storage and independently asserted the exact application deadline; all 19 tests then passed.
- Covered registration/hash/password preservation, input/role injection, concurrent duplicate emails, seeded passenger/driver login and authorization, generic invalid credentials, me, session fixation/rotation, CSRF missing/invalid/foreign origin/cross-session/stale token, logout invalidation, persistence after app/store reconstruction, DB/application expiry, pruning, cookie tampering, both rate limiters, secure proxy cookies/config validation, malformed requests, database role changes, and fail-closed session-store errors without private details.
- Five shared health/error API tests passed because the shared app/error boundary changed.
- Backend production build passed locally and in Docker.
- One full Compose rebuild for changed dependency/runtime/proxy configuration passed; init exited successfully, API/web/database became healthy. The existing frontend was built as part of Compose, but no frontend feature work/browser automation was performed.
- node scripts/auth-runtime-smoke.mjs passed: live Nginx-to-API passenger/driver login, CSRF, cookie flags, rotation, actual API container restart retaining the original session, and logout rejecting replayed cookies.
- Runtime dependency prune: 115 packages audited, zero vulnerabilities; prisma/@prisma/config/deepmerge-ts/mysql2 confirmed absent from API image. Four existing high development/init-tooling advisories remain; no force upgrade.
- git diff --check passed. Local setup helper ran without replacing the existing session secret.
- No repeated foundation database/concurrency/browser test cycle. Auth fixtures stayed in the isolated test database; runtime smoke used only the seeded accounts and temporary sessions.

### Git checkpoint

- e620770 — feat(auth): add PostgreSQL sessions and verified backend authentication
- Documentation checkpoint commit: docs(auth): record backend verification and frontend handoff (see git log for its hash).
- Auth remains on feature/auth. master remains at verified foundation 80f9995.
- Only the three user frontend formatting edits are intended to remain uncommitted.

### Reproduce / next steps

```powershell
node scripts/setup-local-env.mjs
docker compose -f compose.auth-test.yaml up -d --wait db
npm run typecheck -w @dtp/api
npm run test:auth -w @dtp/api
npm test -w @dtp/api
npm run build -w @dtp/api
docker compose up --build -d
node scripts/auth-runtime-smoke.mjs
docker compose -f compose.auth-test.yaml down
```

Main runtime: http://localhost:8080; host Vite remains http://localhost:5173 when started separately. The main Compose stack is left running for review. The disposable auth-test database is stopped/removed after verification; development database/storage are preserved. For a fresh checkout, run npm ci and npm run db:generate before host tests.

No backend checkpoint blocker remains. Limitations: in-memory rate limits reset on restart and are not shared across API instances; no password recovery/email verification; four existing tooling advisories; no public HTTPS deployment or browser authentication testing. No frontend auth screens exist yet, so the foundation page still labels UI authentication as coming next. Accepted/rejected AI examples still await genuine candidate input.

**Exact next frontend checkpoint:** continue on feature/auth, preserving existing formatting edits. Extend fetch with JSON/status-aware errors/CSRF; add auth context with loading, signed-out, signed-in and failure states; restore /auth/me without treating 500/network failures as logout; implement accessible passenger registration and both-role login; refresh CSRF after authentication; add logout and role-protected passenger/driver placeholder landings while retaining connectivity. Then verify refresh, both roles, denied navigation, expiry/token recovery and logout in the browser. Backend middleware stays authoritative. No booking/pooling/fare work and no merge into master yet. See [detailed handoff](authentication.md#frontend-authentication).

---

# Foundation checkpoint — historical record

## Milestone 1 — foundation complete

Verified on 23 September 2026 (Bangladesh time). PRD read completely (5 pages). Workspace initially contained only the supplied PDF; no prior repository/instructions. Host Node 24.19.0, npm 11.17.0; Docker Engine 28.4.0, Compose 2.39.4. Docker Desktop was started for verification. Python unavailable; temporary ignored pdf-parse extracted all pages.

Implemented: documentation/diagrams/contract, typed frontend/API workspaces, ten-table Prisma schema, one SQL migration with additional constraints, repeatable demo seed, Docker images/Compose/init/readiness, connectivity page and tests. All business/auth routes remain planned.

## Checks actually executed

| Check | Result |
|---|---|
| npm run db:generate | Passed; Prisma 7.10 client generated |
| npm run typecheck | Passed both apps, including seed/check script |
| npm test | 5 Vitest/Supertest health/error contract tests passed |
| npm run build | Express TypeScript and Vite production builds passed |
| npm run db:migrate | Applied initial migration to real PostgreSQL 17 |
| npm run db:seed | Created 4 cast users, Bullet, 5 zones and 3 demo routes |
| npm run test:db | 17 checks passed on real PostgreSQL; constraint fixtures rolled back |
| docker compose run --rm init npm run test:db | Same 17 checks passed inside Linux container |
| docker compose config --quiet | Passed |
| docker compose up --build -d | Built all images, init exited 0; API/frontend/database healthy |
| Repeated Compose init | Existing migration/seed tolerated; data retained in named volume |
| HTTP through Nginx | /health/live and /health/ready returned 200 with expected envelopes |
| Actual database outage | Stopped project DB; readiness 503 DATABASE_UNAVAILABLE, liveness 200; restarted successfully |
| Headless Edge browser | Real connectivity, retry, 390px mobile without horizontal overflow, simulated 503/recovery, no page errors |
| Screenshot inspection | Desktop 1280px and mobile 390px visually inspected; screenshots in docs/images |
| git diff --check | Passed before final documentation commit |
| npm audit / npm audit --omit=dev | Four high entries from Prisma tooling/optional peer; not a clean host audit |
| Final runtime dependency pruning | npm audited 104 packages, 0 vulnerabilities; prisma/@prisma/config/deepmerge-ts/mysql2 confirmed absent from API image |

The database checks compare all ten tables before/after TWO seed reruns, check distinct salted hash formats, reject wrong roles/capacity/active duplicates/invalid finalization and releases, preserve per-passenger idempotency uniqueness after cancellation, and allow a new request after cancellation. They do not simulate seat allocation or prove pooling concurrency, which has not been implemented.

The built-in browser-control runtime crashed twice before opening a page. A temporary Playwright install under ignored .tmp drove headless installed Edge instead; desktop/mobile screenshots and the successful browser result came from that fallback. The browser runner is diagnostic tooling, not a new app dependency. Sandbox process/file tools later failed to initialize; approved elevated commands completed the work without changing user identity or global Git trust. A per-command safe.directory exception was used for the workspace's mixed Windows ownership.

## Reproduce

From repository root, copy .env.example to .env only if absent:

```powershell
docker compose up --build -d
docker compose ps -a
docker compose run --rm init npm run test:db
curl.exe -i http://localhost:8080/api/v1/health/live
curl.exe -i http://localhost:8080/api/v1/health/ready
```

For host checks: npm ci, npm run db:generate, npm run typecheck, npm test, npm run build. For host DB checks, start db with compose.dev.yaml as described in README; npm run db:migrate, npm run db:seed, npm run test:db. Full Compose intentionally does not expose DB on the host. Visit http://localhost:8080 to inspect/retry connectivity. Containers are left running for review; docker compose down stops them while preserving the database volume.

## Git record

- master: 5a937e1 — chore(repo): bootstrap assessment repository with supplied PRD
- feature/project-foundation: 29498d9 — docs(design): record architecture schema and planned API contracts
- e7d4fb9 — feat(foundation): scaffold typed apps and health connectivity page
- 5d4e3c6 — feat(database): add constrained PostgreSQL schema and repeatable demo seed
- Subsequent Docker and verification/documentation commits on the same feature branch; see git log --oneline.

No remote, push, merge, release branch, or deployment. All milestone work stays on feature/project-foundation for candidate review. No commit history was rewritten.

## Limitations / next work

No remaining environment blocker for foundation. Four high npm advisories remain in development/init Prisma tooling, excluded from runtime image; details in dependencies.md. No public deployment, authentication, booking, pooling, fare service, or business concurrency tests. Screenshots show only foundation. Candidate AI accepted/rejected examples and final video remain pending, not invented.

Next small milestone: **authentication** — PostgreSQL session middleware/store, scrypt verification, passenger-only registration, CSRF, login/logout/me, session regeneration/expiry, rate limits, role/privacy tests, small frontend auth context/forms. Then request/idempotency/fare estimates; transactional pooling/driver lifecycle with concurrency tests; full UI/story demo; master integration; pre-release validation/free hosting decision/video; release/v1.0.0.
