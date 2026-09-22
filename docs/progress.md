# Progress

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
