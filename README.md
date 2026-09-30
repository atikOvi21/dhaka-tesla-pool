# Dhaka Tesla Pool

Share a seat. Split the fare. Survive Dhaka traffic.

A small ride-pooling MVP for RoBenDevs’ Software Engineer Internship assessment. Jashim drives Bullet, a three-seat vehicle; Nusrat, Rafiq, and Shirin request compatible trips. The application keeps each passenger's fare private and prevents overselling Bullet.

**Status: the MVP is deployed on Render with Neon PostgreSQL.** Authentication, shared rides, fares, cancellation and driver actions are implemented. The video upload and personal AI-example details are still pending.

Extended submission deadline: **30 September 2026, 23:59 Bangladesh time**. Requirements: [supplied PRD](Dhaka_Tesla_Pool_PRD_Internship.pdf).

## Implemented versus planned

Implemented backend: PostgreSQL sessions, passenger registration, passenger/driver login, logout, CSRF protection and role checks. The app uses Express, Prisma, database constraints and Docker Compose.

Implemented UI: passenger registration, both-role login, session restoration, role-protected landing pages, logout, retryable failures and accessible responsive forms.

Implemented rides: route and seat selection, fare previews, booking, driver availability, acceptance, arrival, start, individual drop-off, completion, cancellation and history. Screens check for updates every five seconds.

Compatible bookings can share a vehicle. Each booking stays together. A 20% discount applies when at least two separate active bookings remain at arrival. Real PostgreSQL tests cover seat competition and cancellation/arrival races.

Pooling was merged into master. The pre-release and release/v1.0.0 branches were created and pushed. The supplied Render log confirms deployment of commit 2b03c46 on 26 September. The authentication error-message fix was later published in release commit e1437a2; its public redeployment has not been confirmed. [Current evidence and remaining checks](docs/progress.md) distinguish local tests from public checks.

**Live app: [https://dhaka-tesla-pool-hyie.onrender.com](https://dhaka-tesla-pool-hyie.onrender.com)**

Free hosting may take about a minute or longer to wake after inactivity. Please keep the tab open.

Use this root URL for the demo. It opens /login when signed out, /passenger for a signed-in passenger, or /driver for a signed-in driver. /foundation is a supporting system-status page, not the main submission page.

Public readiness and page routes were checked. The candidate also reported checking full capacity and cancellation before arrival. Full public security and restart checks are not all recorded yet. [Deployment guide](docs/deployment.md)

**Video Link:** [Open Google Drive folder](https://drive.google.com/drive/folders/1EYClYW4iLF_SQltxZ1SqtcQ9-hLmzDPx?usp=sharing) - Video upload pending. [Timed outline and submission checklist](docs/demo-and-submission.md)

Repository: https://github.com/atikOvi21/dhaka-tesla-pool (public access verified without authentication). Authentication screenshots: [login](docs/images/auth-login-desktop.png), [passenger](docs/images/auth-passenger-desktop.png), [mobile registration](docs/images/auth-register-mobile.png). Foundation screenshots: [desktop](docs/images/foundation-desktop.png) / [mobile](docs/images/foundation-mobile.png).

## Quick start — Docker

Prerequisite: Docker Desktop running Linux containers (or Docker Engine), Compose v2, port 8080 available. Node 24 is used by the optional local environment helper; otherwise copy .env.example and replace SESSION_SECRET with a securely generated random secret. No host PostgreSQL installation is needed.

```powershell
node scripts/setup-local-env.mjs
docker compose up --build -d
docker compose ps -a
```

The environment helper works on Windows/macOS/Linux and preserves existing settings and secrets. Open **http://localhost:8080**. The root opens login or your role-specific workspace. Visit **http://localhost:8080/foundation** for connectivity status. Initial image downloads can take several minutes. Subsequent `docker compose up` uses the built images. Database health gates the one-shot migration/seed service, which must exit successfully before API startup; API readiness gates the frontend.

```powershell
docker compose logs init api
curl.exe -i http://localhost:8080/api/v1/health/live
curl.exe -i http://localhost:8080/api/v1/health/ready
docker compose down
```

`down` preserves the named `postgres_data` volume. Do not add `-v` unless intentionally deleting all data. App/database credentials are **local demo defaults**, not deployment secrets. Frontend binds loopback; DB/API are internal. Changing PostgreSQL initialization credentials does not change existing volume credentials. URL-encode reserved characters if customizing passwords in connection URLs.

Migrations are versioned under `apps/api/prisma/migrations`. The init service runs `prisma migrate deploy`, never schema reset/db push. It seeds only when `SEED_DEMO=true` (local default). Seed reruns insert missing cast/reference records, preserving passwords, profiles, vehicles and all application history. To rerun explicitly:

```powershell
docker compose run --rm init
```

## Local development

Node **24.x**, npm (verified with 11.17.0), Docker Compose for PostgreSQL. Commands run from repository root; on PowerShell use `npm.cmd` if script execution policy blocks `npm`.

```powershell
node scripts/setup-local-env.mjs
npm ci
npm run db:generate
docker compose -f compose.yaml -f compose.dev.yaml up -d db
npm run db:migrate
npm run db:seed
npm run dev:api
```

In another terminal: `npm run dev:web`. Open **http://localhost:5173**; Vite proxies `/api` to localhost:3000. The optional dev Compose file exposes PostgreSQL only at 127.0.0.1:5433. Use the same two `-f` options when stopping that development DB. Stop a full Compose stack before switching modes. No CORS configuration is needed.

## Tests

After the local environment setup and dependency installation above:

```powershell
npm run db:generate
npm run typecheck
npm run build
docker compose -f compose.auth-test.yaml up -d --wait db
npm run test:auth -w @dtp/api
npm run test:rides -w @dtp/api
npm test -w @dtp/api
npm test -w @dtp/web
node scripts/verify-hosted.mjs
docker compose build --pull=false
docker compose -f compose.e2e.yaml up --no-build -d --wait
docker compose -f compose.e2e.yaml run --rm --no-deps init npm run test:db
npm run test:e2e -w @dtp/web -- pooling.browser.spec.ts --project=desktop
docker compose -f compose.e2e.yaml down
docker compose -f compose.auth-test.yaml down
git diff --check
```

Browser tests use installed Edge on Windows; on other platforms install Playwright Chromium with npm exec -w @dtp/web -- playwright install chromium. See [browser setup](docs/authentication.md#frontend-authentication). Root npm test runs the shared API suite only, not every test.

25 September release checkpoint: **32 PostgreSQL ride/pooling + 19 PostgreSQL auth + 7 API/hosted-route tests, 24 frontend tests, 17 database/seed checks, and one real shared-pooling browser journey passed**. Typechecks, builds, fresh disposable Compose startup and the hosted session smoke passed. The latter uses a simulated trusted TLS proxy, not a live cloud endpoint. See [actual results, corrections and limits](docs/progress.md).

The capacity test uses two Express instances, independent PostgreSQL connections and concurrent HTTP requests competing for the last seat; three repetitions each assign exactly one passenger. Real tests also verify rollback, idempotency, cancellation/arrival ordering, ownership and exact fare snapshots. The browser demonstrates separate sessions, three seats/full waiting, independent fares/drop-offs and pre-arrival cancellation. Disposable stacks preserve the development database.

The foundation checker repeats the seed and compares tables; it is not the concurrency proof.

## Demo cast and environment

| Account | Email                  | Role                                         |
| ------- | ---------------------- | -------------------------------------------- |
| Jashim  | jashim@demo.dhaka.test | Driver of Bullet, 3 seats, initially offline |
| Nusrat  | nusrat@demo.dhaka.test | Passenger                                    |
| Rafiq   | rafiq@demo.dhaka.test  | Passenger                                    |
| Shirin  | shirin@demo.dhaka.test | Passenger                                    |

All initial demo passwords: `DemoOnly!Dhaka2026`. **Demo only; use /login for either role.** Database stores salted scrypt hashes, never plaintext. Existing passwords are not reset by seeding. Banani–Mohakhali (3 km) and Banani–Gulshan 1 (4 km) share a compatibility group; Dhanmondi–Mirpur supplies a noncompatible example. All are simplified demo data, not road routing.

| Variable                                        | Purpose                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB | Local Compose initialization and internal API connection                              |
| DATABASE_URL                                    | Host-run Prisma/API PostgreSQL URL; Compose uses internal db hostname                 |
| PORT                                            | Host API port; default 3000 (Vite proxy expects this)                                 |
| WEB_PORT                                        | Compose frontend port; default 8080                                                   |
| NODE_ENV                                        | development locally; production in API container                                      |
| SEED_DEMO                                       | Explicit permission to insert demo users; true locally, disable for real environments |

Run `node scripts/setup-local-env.mjs` once before startup. It creates .env if missing, generates a random SESSION_SECRET only when missing/placeholder, and preserves existing configuration. The secret must remain stable across restarts. SESSION_COOKIE_SECURE=false is only for loopback HTTP; HTTPS deployment uses true. AUTH_ORIGINS lists exact allowed browser origins (update it when changing WEB_PORT). Host TRUST_PROXY_HOPS=0; Compose uses one private Nginx hop.

AUTH_TEST_DATABASE_URL targets only the isolated test database.

Authentication setup, limits, API usage, browser verification and manual review steps: [authentication guide](docs/authentication.md).

Focused backend verification (no browser automation):

```powershell
docker compose -f compose.auth-test.yaml up -d --wait db
npm run typecheck -w @dtp/api
npm run test:auth -w @dtp/api
npm test -w @dtp/api
npm run build -w @dtp/api
node scripts/auth-runtime-smoke.mjs
docker compose -f compose.auth-test.yaml down
```

The runtime smoke command requires the main Compose stack running and briefly restarts its API to prove PostgreSQL session persistence. Auth integration tests use disposable PostgreSQL on :5434 and never reset the development database. Authenticated sessions last 8 fixed hours; pre-login CSRF sessions last 1 hour. Login/register share 10 attempts per IP per 15 minutes; token bootstrap allows 60.

These process-local limits reset on restart.

## Architecture and ownership

[Architecture and transaction plan](docs/architecture.md) · [ERD/table rationale](docs/erd.md) · [PRD requirements versus assumptions](docs/assumptions.md) · [API contract](docs/api-contract.md) · [agent instructions](AGENTS.md)

```mermaid
flowchart LR
  B[Browser] --> W[React / Router]
  W -->|same origin /api/v1| A[Node.js Express]
  A --> P[Prisma / SQL]
  P --> D[(PostgreSQL)]
```

```text
apps/web       React UI, CSS Modules, fetch wrapper, Vite/Nginx proxy
apps/api       HTTP layer, Prisma schema/migrations/seed, health and DB checks
docs           Architecture, ERD, assumptions, API contract, verification
compose.yaml   Frontend/API/init/PostgreSQL with named storage
```

Controllers handle HTTP; services enforce prices, ownership, state and seat allocation. Foreign keys, role constraints and partial active indexes defend database invariants. A bounded seat counter alone cannot ensure membership consistency: ride mutations acquire the same transaction-scoped database advisory lock and update membership/counter/history atomically. This database-wide serialization limits throughput; fine-grained locking is a future improvement.

## Matching and fare calculations

A whole booking joins the oldest eligible pool (created_at, then ID): same pickup zone and route compatibility group, pool ACCEPTED, driver online, enough remaining seats. No fit means REQUESTED. Driver acceptance takes the selected request first, then oldest compatible waiting requests that fit. Pre-arrival cancellation refills a nonempty pool; cancellation of the last member cancels that trip. No joining after arrival.

Money uses integer poisha: **100 poisha = 1 BDT**. Distance uses integer meters. The base fare is 2000 poisha per seat; the distance rate is 1000 poisha per km per seat.

```text
soloPoisha = floor((seats * (2000 * 1000 + distanceMeters * 1000) + 500) / 1000)
sharedPoisha = floor((soloPoisha * 8000 + 5000) / 10000)
```

Calculations use BigInt and round half-up to the nearest poisha. Nusrat pays 5000 solo / 4000 shared. Rafiq pays 6000 / 4800. One booking with two seats does not count as two bookings.

The shared price is only an estimate before arrival. Arrival saves the final fare; later drop-offs do not change it. [Exact fare rules](docs/ride-lifecycle.md)

## API overview

Base /api/v1; success { data }, errors { error: { code, message } }. PostgreSQL session cookies identify users; all mutations require a session-bound X-CSRF-Token, including login/registration. GET /auth/csrf bootstraps it. Booking creation also requires Idempotency-Key.

- Auth: /auth/register, /auth/login, /auth/me, /auth/logout.
- Reference and estimate: /zones, /routes, /fare-estimates.
- Passenger: /ride-requests, /ride-requests/active, own detail and cancellation.
- Driver: /driver/profile, /driver/availability, waiting requests/acceptance, pools/arrival/start/individual drop-off/completion.
- Health: /health/live and /health/ready.

[Methods, payloads, permissions, pagination and error codes](docs/api-contract.md). Passenger responses never include another passenger's fare/private booking; driver views expose names/routes/seats/statuses without emails/fares.

## Database diagram

```mermaid
erDiagram
  users ||--o| driver_profiles : has
  users ||--o| vehicles : owns
  users ||--o{ ride_requests : requests
  users |o--o{ ride_events : acts
  zones ||--o{ routes : pickup
  zones ||--o{ routes : destination
  zones ||--o{ pools : pickup_snapshot
  routes ||--o{ ride_requests : follows
  vehicles ||--o{ pools : serves
  pools ||--o{ pool_memberships : contains
  ride_requests ||--o| pool_memberships : assigned_once
  pools |o--o{ ride_events : history
  ride_requests |o--o{ ride_events : history
  sessions {
    string sid PK
    json sess
    timestamp expire
  }
```

[Full ERD, ten-table rationale, indexes and constraints](docs/erd.md). Database constraints backstop the service's atomic membership/counter/event updates; they do not replace the common transaction lock.

## Stack choices and realistic alternatives

| Choice                               | Why it fits; alternative; when to switch                                                                                                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React + Vite + Router + TypeScript   | Mandated React, simple SPA with typed boundaries; Next.js is an alternative if SSR/SEO or server rendering becomes important.                                                                                                                                    |
| Node + Express                       | Mandated Node, explicit small HTTP layer; Fastify for schema-driven performance, NestJS if a much larger team needs framework conventions.                                                                                                                       |
| REST                                 | Resource/lifecycle actions are easy to inspect and test; GraphQL if clients genuinely require varied nested projections.                                                                                                                                         |
| PostgreSQL                           | Transactions, row locks, partial unique indexes suit contested seats; MySQL is viable with different active-uniqueness design; SQLite for single-user prototypes only.                                                                                           |
| Prisma 7 + SQL migrations            | Typed queries and reviewable migrations; SQL retained for PostgreSQL constraints. Drizzle/raw SQL if ORM friction dominates complex matching queries.                                                                                                            |
| PostgreSQL sessions                  | Revocable sessions across instances without another datastore; JWTs if external clients need delegated stateless tokens, with a revocation strategy.                                                                                                             |
| Scrypt                               | Node's built-in memory-hard hashing avoids native addon deployment work; Argon2id if operational support warrants a dedicated hashing package.                                                                                                                   |
| Zod                                  | Shared TypeScript-friendly input validation; JSON Schema/Ajv if schema interoperability becomes more important.                                                                                                                                                  |
| CSS Modules                          | Scoped styles without a design-system dependency; utility CSS/component library if repeated UI patterns outgrow this small app.                                                                                                                                  |
| React state/auth context + fetch     | Small UI needs no global cache library; TanStack Query if cache invalidation/loading complexity grows.                                                                                                                                                           |
| 5-second ride polling                | Easy failure/reconnect behavior; SSE/WebSockets if measured freshness or polling load demands it.                                                                                                                                                                |
| Vitest + Supertest + real PostgreSQL | Fast HTTP tests plus actual DB semantics; Playwright verifies authentication and separate-session passenger/driver journeys against real PostgreSQL.                                                                                                             |
| Docker Compose                       | Repeatable local setup and deployment fallback. Render Free + Neon Free run the public demo; an existing free VM running Compose is an alternative. Switch only when measured availability/traffic requires managed capacity outside this no-payment assessment. |

[Dependency notes and version-specific references](docs/dependencies.md) record observed advisories and documentation consulted.

## Workflow and limitations

`feature/* -> master -> pre-release -> release/v1.0.0`. Earlier feature branches were already included in master. Pooling was added with normal merge e58f479.

The authentication error-message fix was merged and pushed to master, pre-release and release/v1.0.0 at e1437a2 on 30 September. The video-folder link was subsequently merged into master. This README update records the known deployment and verification results; it does not deploy the app. Older checkpoint notes in the supporting guides describe the status at those dates.

Driver cancellation and reassignment are outside this MVP. Routes use demo zones and distances. There is no GPS, real payment processing, chat, password reset or email verification.

Ride writes run one at a time across the database. Authentication rate limits reset when the API restarts. Free hosting can sleep or hit quotas. Known dependency warnings are listed in [dependency notes](docs/dependencies.md).

## AI Usage

OpenAI Codex helped with design documents, code, tests, debugging and deployment instructions. The candidate supplied the project requirements and reviewed the stack and Git commits.

The candidate reported these choices on 25 September:

- Accepted, reported by the candidate on 25 September: AI assistance for typical request/accept ride implementation. **Candidate reason still needed**; do not infer it from passing tests.
- Changed/rejected, reported by the candidate: they did not choose all AI-proposed UI designs. **Specific UI example and reason still needed.** The candidate also reports thoroughly reviewing Git commits and stack choices.
- Observed implementation correction: Prisma validation required composite uniqueness for role-bearing one-to-one relations; Codex added it and reran checks. This is a technical correction, not an invented candidate rejection.

The candidate still needs to provide the personal reasons and a specific changed UI example. These details have not been invented. The [progress record](docs/progress.md) keeps the earlier AI-assisted work and test corrections.

## Frontend authentication verification

On 30 September, all 29 frontend tests passed using `npm test -w @dtp/web -- --pool=threads --maxWorkers=1`. Frontend type checks and the production build also passed. The single-thread option avoided a local worker-startup issue. These were local checks, not a fresh public browser test.

See [the authentication guide](docs/authentication.md#frontend-authentication) for isolated browser tests and manual steps. Run `npm test -w @dtp/web` for the 29 focused UI tests (21 authentication and 8 rides); root `npm test` currently runs API tests only.

The implementation keeps TypeScript at the boundaries: `src/api.ts` handles requests/errors, `src/auth/AuthContext.tsx` manages session state, `src/auth/AuthPages.tsx` contains forms and role guards, and `src/App.tsx` defines routes. The function bodies use familiar JavaScript/React patterns. Generated Prisma files are not tutorial entry points and should not be edited.

## Demonstrate the ride lifecycle

Follow the [exact separate-session shared-pooling demonstration and test commands](docs/ride-lifecycle.md#manual-demonstration). Open https://dhaka-tesla-pool-hyie.onrender.com/login (or http://localhost:8080/login locally) in separate browser sessions for Nusrat and Jashim, then use /passenger and /driver. Add Rafiq in another session on Banani-Gulshan 1 and Shirin on Banani-Mohakhali. Bullet holds three seats; an additional passenger waits. At arrival, their respective fares finalize at 40/48/40 BDT.

Without another active booking, Nusrat pays the 50 BDT solo fare. Drop off each booking before completing the pool. Histories are at /passenger/history and /driver/history.

Ride screenshots: [passenger desktop](docs/images/ride-passenger-desktop.png), [driver mobile](docs/images/ride-driver-mobile.png).

Shared-pooling screenshots: [passenger desktop](docs/images/pooling-passenger-desktop.png), [driver mobile](docs/images/pooling-driver-mobile.png).
