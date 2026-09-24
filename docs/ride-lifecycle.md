# Shared ride lifecycle

Compatible bookings share Bullet's three seats. A booking can reserve multiple seats but is never split across vehicles. Authentication, cancellation, histories and the original solo journey remain supported.

## Matching and capacity

Every ride mutation first takes the same PostgreSQL transaction advisory lock (73421, 1). Matching, acceptance, cancellation, availability, arrival, start, drop-off and completion follow this protocol across API instances. There is no second locking protocol.

A new booking joins the oldest eligible pool, ordered by created_at then UUID. Eligibility requires identical pickup zone and compatibility group, ACCEPTED status, an online driver and enough remaining capacity for the entire booking. Otherwise it stays REQUESTED. The stored demo routes support Banani-Mohakhali and Banani-Gulshan 1 sharing; no map service is used.

Driver acceptance creates a pool, assigns the selected booking first, then considers compatible waiting requests by created_at/id. Oversized bookings are skipped without splitting them. When a matched cancellation frees capacity and other members remain, the same scan fills the available seats. Cancelling the last member cancels that pool; waiting requests do not silently replace the entire trip.

Assignments, seat counters, request states and events commit together. A conditional capacity update and existing unique/check constraints provide backstops. Idempotent creation and action replays return before repeating assignment or event writes. One active request per passenger and pool per driver/vehicle remain enforced.

The advisory lock serializes all ride writes database-wide. This is an explicit MVP throughput limit, including writes for unrelated vehicles. Transactions contain only database work, use a five-second lock timeout and fifteen-second transaction timeout, and retry P2034 whole-transaction conflicts at most twice. Read summaries use repeatable-read snapshots. Fine-grained locks are a future scaling improvement, outside this milestone.

## Lifecycle and individual fares

Arrival closes boarding and atomically finalizes every non-cancelled member. Starting updates all active bookings. Each booking drops off independently and releases only its own seats exactly once. Freed seats after arrival do not reopen matching. Completion requires every non-cancelled booking completed. Cancelled memberships stay in history.

Cancellation is valid only in REQUESTED/MATCHED. If cancellation commits before arrival, that booking is excluded from the discount calculation. If arrival commits first, cancellation conflicts. Last-member cancellation cancels the pool. Drivers cannot go offline with an active pool.

Pricing version **demo-pool-v1** uses integer poisha and stored quote inputs:

- Solo maximum: floor((seats * (basePoisha * 1000 + distanceMeters * ratePoishaPerKm) + 500) / 1000).
- Base is 2000 poisha per seat; rate is 1000 poisha/km per seat.
- At least two distinct active bookings at arrival qualify for a 2000-basis-point discount. Two seats in one booking count as one booking.
- Discounted fare: floor((storedSoloMaximumPoisha * 8000 + 5000) / 10000), using BigInt intermediates. This is nonnegative half-up rounding after the existing solo rounding.
- Nusrat: 5000 solo -> 4000 shared (40 BDT). Rafiq: 6000 -> 4800 (48 BDT). Shirin on the 3 km route: 5000 -> 4000.
- No qualifying sharing at arrival means the stored solo maximum. Pre-arrival cancellation has no charge and final fare stays null.

Before arrival the UI shows the solo maximum and conditional shared estimate, never a promised final price. Actual discount_bps, final_fare_poisha and finalized_at are stored once at arrival. The arrival event records the applied pricing version, discount and eligible booking count. Later drop-offs, route/configuration changes and replays do not recalculate finalized fares.

### Existing bookings and compatibility

No migration or development reset was needed. Existing base/rate/distance/seats, solo maximum, original provisional quote and pricing_version remain unchanged. All unfinalized bookings, including demo-solo-v1 quotes, can receive the new shared discount calculated from their stored solo maximum. Their API provisionalPooledPoisha is the current conditional shared offer before arrival. For terminal/finalized records that field retains the stored original quote.

fare.pricingVersion identifies the original quote. poolingPricingVersion identifies the currently offered policy while unfinalized. finalPricingVersion comes from arrival-event metadata; historical events without this metadata fall back to the quote version. Existing finalized/completed fares are never upgraded or rewritten.

## UI, privacy and retries

Passenger workspaces show only their own route, seats, status and fares, with a sharing boolean indicating a shared assignment. They do not receive another passenger's identity, email, request details or fare. Driver views expose necessary names, routes, seats and statuses, with no passenger emails or monetary fields.

Driver screens list every membership (including cancelled records) and offer individual drop-offs. Completion appears only when all required drop-offs finish. Five-second polling refreshes assignments and membership changes without overlapping reads; navigation/logout aborts reads. Completed and cancelled results remain visible in details/history.

The browser retains uncertain request keys/payloads in passenger-scoped sessionStorage, never credentials. Reload can discover the committed booking. Confirmed/recovered intents are cleared; new intents get new keys. Mutations are never blindly retried.

## Manual demonstration

Open http://localhost:8080/login in independent browser profiles/sessions for Jashim, Nusrat, Rafiq and Shirin. Ordinary tabs and multiple incognito windows in the same browser generally share cookies; use separate profiles. Initial passwords: DemoOnly!Dhaka2026.

1. Jashim (jashim@demo.dhaka.test): /driver -> Go online.
2. Nusrat (nusrat@demo.dhaka.test): /passenger -> Banani to Mohakhali, one seat -> Preview fare (50 BDT maximum / 40 BDT conditional shared) -> Request ride.
3. Jashim: accept Nusrat's request.
4. Rafiq (rafiq@demo.dhaka.test): request Banani to Gulshan 1, one seat. It joins the same pool; his conditional fare is 48 BDT from a 60 BDT maximum.
5. Shirin (shirin@demo.dhaka.test): request Banani to Mohakhali, one seat. Jashim sees 3/3 allocated seats and all three destinations/statuses.
6. In another independent session register a test passenger and request a compatible one-seat ride. It remains waiting because Bullet is full.
7. Refresh passenger/driver pages. Jashim selects Mark arrival. Final fares are Nusrat 40, Rafiq 48 and Shirin 40 BDT.
8. Jashim selects Start trip, then drops off each booking individually. Remaining passengers' final fares stay fixed, and the waiting booking does not join after drop-offs.
9. After all drop-offs select Complete trip. Check /passenger/history and /driver/history, including direct detail links.
10. Cancel the extra waiting request. For a cancellation demo, create/accept Nusrat and let Rafiq join; Rafiq cancels before arrival. Nusrat remains assigned and pays 50 BDT if no replacement joins before arrival. Cancelled membership remains visible to Jashim.
11. Complete that ride and go offline. /foundation remains available. Never erase development data to repeat a demo.

Frontend routes remain /passenger, /passenger/history, /passenger/bookings/:id, /driver, /driver/history and /driver/trips/:id. The API endpoint list is unchanged; see [API contract](api-contract.md).

## Verification

From repository root, after installing dependencies and configuring the environment:

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

Backend tests use an isolated PostgreSQL database and unique routes/groups per scenario. The last-seat test sends concurrent authenticated HTTP requests through two Express apps backed by independent Prisma adapters/PG connections, verifies different backend PIDs, and repeats three times. One joins and one remains waiting with no alternative pool. This is actual shared-capacity verification, not a mocked or sequential substitute.

Browser tests use the existing isolated :8081 Docker stack and separate cookie contexts. The pooling browser test restarts only that disposable API before its journey to reset process-local authentication limits; production limits are unchanged. It verifies full capacity, waiting, individual prices/drop-offs, histories and pre-arrival cancellation. See progress.md for actual results and any unresolved failures.

## Next milestone and release work

Deployment and submission readiness are next, rather than additional product features. Public HTTPS/proxy/cookie configuration, an accessible repository or approved submission path, the six-minute demo video, and genuine candidate AI-usage examples still require completion/review. Docker remains the reproducible local fallback. Existing tooling advisories and process-local authentication limiting remain documented. This milestone does not claim unlimited throughput or a public production deployment.
