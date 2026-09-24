# Single-booking ride lifecycle

This milestone supports one booking per pool, with one or more seats. This is a temporary milestone limit, not a permanent product or schema rule. Shared matching, additional bookings and pooling discounts remain pending.

## Implemented behavior

Passenger requests move through REQUESTED -> MATCHED -> DRIVER_ARRIVED -> IN_PROGRESS -> COMPLETED. Cancellation is allowed only from REQUESTED or MATCHED. Pools move ACCEPTED -> DRIVER_ARRIVED -> STARTED -> COMPLETED. Cancelling the only booking before arrival cancels its pool and releases seats. Driver drop-off releases seats exactly once; completing the pool requires all drop-offs.

Drivers must be online to accept, can have only one active pool, and cannot go offline until it is terminal. Passengers have one active request. Route and seats are immutable after creation. Ownership, roles and transitions are checked server-side. Terminal records stay in history. No migration or permanent single-membership constraint was added.

## Transactions and pricing

All ride mutations use a PostgreSQL transaction-scoped advisory lock (73421, 1), acquired before reading business state. Acceptance, cancellation, booking creation, availability and lifecycle changes share it across API instances. This deliberately serializes unrelated ride writes at demo scale. Transactions atomically write requests, memberships, seat counters, fares and events; rollback releases the lock. Existing partial unique indexes remain backstops. Reads use repeatable-read transactions for consistent summaries. No external work occurs inside transactions. P2034 transaction conflicts receive at most two whole-transaction retries; lock waits are bounded. Future fine-grained locking must replace this consistently for every writer, using the original ordered row-lock plan and new concurrency tests.

Pricing version demo-solo-v1 snapshots base 2000 poisha, rate 1000 poisha/km, seats and stored route distance. BigInt half-up rounding occurs after seat multiplication: floor((seats * (base * 1000 + meters * rate) + 500) / 1000). The provisional pooled schema field equals the solo estimate in this milestone. Arrival fixes final fare and discount=0. Pre-arrival cancellation leaves final fare null and incurs no charge. Nusrat's one-seat 3 km trip costs 5000 poisha (50 BDT); two seats cost 100 BDT. The future pooled 40/48 BDT examples are not applied.

Creation requires a passenger-scoped Idempotency-Key. Replay of identical route/seats returns the original booking, including terminal bookings; a different payload conflicts. The frontend retains key and payload in sessionStorage (no credentials) for uncertain submissions and reload recovery. A recovered active booking clears the fulfilled intent. Changed details or a confirmed new intent receive a new key. Mutations are never automatically retried by the browser.

Ride screens poll every five seconds after the preceding read finishes, abort on navigation/logout, and provide retryable errors. Detail pages retain completed/cancelled results; current pages show the latest booking/trip and link to history. Waiting lists and histories support cursor pagination. Passenger fare data is omitted from driver/waiting responses.

## Manual demonstration

Main app: http://localhost:8080. Use two separate browser profiles, or a normal window and an incognito window, so passenger/driver cookies stay separate. Two ordinary tabs share cookies.

1. In the passenger window open /login and sign in as nusrat@demo.dhaka.test. In the driver window sign in as jashim@demo.dhaka.test. Both initial passwords are DemoOnly!Dhaka2026.
2. At /driver, Jashim selects Go online.
3. At /passenger, Nusrat selects Banani to Mohakhali (3 demo km), one seat, then Preview fare. Confirm 50.00 BDT and select Request ride.
4. Jashim sees Waiting requests within about five seconds and selects Accept request. His trip detail opens; Nusrat sees Driver assigned, Jashim and Bullet. Refresh both windows and confirm recovery.
5. Jashim selects Mark arrival. Nusrat sees final fare 50.00 BDT and cancellation is no longer offered.
6. Jashim selects Start trip, Mark Nusrat dropped off, then Complete trip.
7. View /passenger/history and /driver/history. Open the completed booking/trip details. Direct links and refresh work through Nginx.
8. Return both to Current ride. Create another request (try two seats: 100.00 BDT), accept it, then let Nusrat select Cancel request before arrival. Both see Cancelled; Jashim sees zero allocated seats and can go offline.
9. /foundation still checks connectivity. Use narrow mobile widths or keyboard Tab/Enter to inspect forms and controls.

Existing active rides must be completed or validly cancelled; do not erase the database to repeat a demo.

Frontend routes: /passenger, /passenger/history, /passenger/bookings/:id, /driver, /driver/history, /driver/trips/:id. See [API contract](api-contract.md) for the implemented /api/v1 endpoints.

## Reproduce focused verification

From repository root after npm ci, environment setup and Prisma generation:

```powershell
docker compose -f compose.auth-test.yaml up -d --wait db
npm run test:rides -w @dtp/api
npm run test:auth -w @dtp/api
npm test -w @dtp/api
npm test -w @dtp/web
npm run typecheck
npm run build
docker compose build
docker compose -f compose.e2e.yaml up --no-build -d --wait
npm run test:e2e -w @dtp/web
docker compose -f compose.e2e.yaml down
docker compose -f compose.auth-test.yaml down
```

The backend runner uses AUTH_TEST_DATABASE_URL and refuses the development database. Its fixtures have unique test-only identities/routes and stay in disposable PostgreSQL on :5434. The separate browser stack uses tmpfs PostgreSQL and the real application images at :8081. Tests do not erase development data. Edge is used on Windows; browser setup is shared with the authentication milestone.

Actual results: 17 ride/PostgreSQL tests; 22 frontend tests (16 auth, 6 rides); five shared API tests; 19 backend auth tests before branch integration; one complete two-session ride browser test and two authentication/mobile browser regressions. Workspace typechecks/builds and Docker builds passed. The ride browser test deliberately lost the server's successful booking response, recovered on reload, completed the full journey, checked both histories, then cancelled a matched booking and checked seat release. Desktop and mobile ride screenshots were visually inspected.

Screenshots: [passenger desktop](images/ride-passenger-desktop.png), [driver mobile](images/ride-driver-mobile.png).

## Remaining scope

Shared matching, multiple bookings per pool, the pooling discount, and last-seat competition among shared bookings are the next milestone. The current race tests cover competing acceptance and booking creation; they do not claim multi-booking capacity safety. No public deployment, real routing, GPS or payments. Authentication limitations and existing tooling advisories remain documented in authentication.md and dependencies.md.
