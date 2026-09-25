# API contract — target MVP

Base `/api/v1`. Health and all five authentication endpoints are implemented. Reference data, ride lifecycle, automatic compatible matching and multi-booking pools are implemented. See [authentication](authentication.md) for exact limits, security behavior, and frontend integration steps. JSON request/response; success `{ "data": ... }`; error `{ "error": { "code": "...", "message": "..." } }`. No active resource → 200 `{ "data": null }`. Timestamps ISO 8601 UTC, IDs UUID strings, money fields suffixed `Poisha`, distances `Meters`. Never serialize password hashes, session payloads, or another passenger's fares.

Statuses: 200 read/action/replay, 201 new user/booking, 400 malformed/invalid input, 401 unauthenticated, 403 role/CSRF failure, 404 missing or inaccessible private resource, 409 state/capacity/idempotency conflict, 429 rate limited, 500 unexpected error, 503 dependency unavailable. Error codes include VALIDATION_ERROR, UNAUTHENTICATED, FORBIDDEN, CSRF_INVALID, NOT_FOUND, STATE_CONFLICT, CAPACITY_CONFLICT, IDEMPOTENCY_CONFLICT, ACTIVE_RESOURCE_EXISTS, RATE_LIMITED, INTERNAL_ERROR, DATABASE_UNAVAILABLE. Do not leak raw SQL errors.

Session cookie required except health, CSRF bootstrap, login/register, and reference data. All mutations require `X-CSRF-Token` from GET /auth/csrf, including login/register/logout. Fetch uses same-origin credentials. Login rotates session and CSRF token. Booking `Idempotency-Key` is required (1–128 printable ASCII characters), unique per passenger; identical normalized routeId/seats returns existing booking, changed payload → 409.

| Method and path | Input | Result / permission |
|---|---|---|
| GET /health/live | none | **Implemented:** 200 data.status=ok, no DB access |
| GET /health/ready | none | **Implemented:** 200 data.status=ready; 503 DATABASE_UNAVAILABLE if DB/schema check fails |
| GET /auth/csrf | none | data.csrfToken; creates/uses anonymous session |
| POST /auth/register | name, email, password | 201 safe user; passenger role only, establishes session |
| POST /auth/login | email, password | safe user; generic invalid-credentials failure |
| POST /auth/logout | empty | data=null; destroy session and clear cookie |
| GET /auth/me | none | safe user or 401 |
| GET /zones | none | array of id, name |
| GET /routes?pickupZoneId=... | optional UUID filter | id, pickupZoneId, destinationZoneId, demoDistanceMeters, compatibilityGroup |
| POST /fare-estimates | routeId, seats | soloMaximumPoisha, provisionalPooledPoisha (conditional 20% discount), currency=BDT, pricingVersion, provisional=true, poolingAvailable=true |
| POST /ride-requests | routeId, seats; Idempotency-Key | own MATCHED booking when an eligible pool fits, otherwise REQUESTED; 201 new / 200 replay |
| GET /ride-requests/active | none | own active booking or null |
| GET /ride-requests?cursor=...&limit=20 | opaque cursor; limit 1–100 | data.items, data.nextCursor; own history |
| GET /ride-requests/:id | UUID | own booking or 404 |
| POST /ride-requests/:id/cancel | empty | own booking; only REQUESTED/MATCHED; repeated cancellation returns current booking |
| GET /driver/profile | none | own profile and vehicle; driver only |
| PATCH /driver/availability | online:boolean | profile; offline blocked with active pool |
| GET /driver/ride-requests | cursor, limit | waiting requests relevant to vehicle capacity; paginated, necessary route/seats only |
| POST /driver/ride-requests/:id/accept | empty | assigned pool; driver online; selected booking first, then compatible waiting requests in creation/ID order |
| GET /driver/pools/active | none | own active pool or null |
| GET /driver/pools?cursor=...&limit=20 | cursor, limit | data.items, data.nextCursor; own history |
| GET /driver/pools/:id | UUID | own pool and members or 404 |
| POST /driver/pools/:id/arrive | empty | atomically closes boarding/finalizes fares, returns pool |
| POST /driver/pools/:id/start | empty | atomically starts pool/bookings |
| POST /driver/pools/:id/memberships/:membershipId/complete | empty | completes own pool member, releases allocation |
| POST /driver/pools/:id/complete | empty | completes pool only if all non-cancelled bookings completed |

Safe user: id, name, email, role. Booking: id, route (zone labels and demo meters), seats, status, createdAt, updatedAt, fare (soloMaximumPoisha, provisionalPooledPoisha, finalFarePoisha nullable, finalizedAt nullable, currency), pool summary nullable, allowedActions. Pool: id, status, vehicle summary, capacitySnapshot, allocatedSeats, pickup, routeGroup, member summaries, timestamps, allowedActions. Driver member summaries include request/membership IDs, passenger display name, route, seats, status, joinedAt/releasedAt; no email or another passenger's private fare.

Use descending (createdAt,id) keyset history pagination with opaque encoded cursor; malformed cursor → 400, nextCursor=null at end. Waiting requests are listed with descending keyset pagination; the driver explicitly chooses one. Automatic matching uses oldest eligible pool order (createdAt,id); waiting refill uses oldest fitting request order. `allowedActions` guides the UI; the backend revalidates every action. Replaying an already-applied lifecycle action returns current resource without writing new events; incompatible later/terminal state → 409. Returning 200 for replay does not permit replayed side effects. Authentication limits: JSON body 16 KiB, name 1–100 UTF-16 code units, password 12–128 UTF-16 code units preserved exactly, normalized email at most 254. Unknown fields are rejected. Additional implemented errors: EMAIL_UNAVAILABLE (409), INVALID_CREDENTIALS (401), AUTH_BUSY (503 with Retry-After).

## Implemented shared-pooling details

See [ride lifecycle](ride-lifecycle.md) for lock scope, state transitions, individual shared pricing, browser paths and demonstration steps. Routes include pickup/destination labels. Reference endpoints are public; fare estimates and booking routes require PASSENGER; all /driver routes require DRIVER. Unknown fields are rejected. Cancel/action bodies are empty JSON objects; availability accepts only online:boolean. /routes accepts only the optional pickupZoneId UUID; paginated lists accept cursor and limit.

Arrival returns DRIVER_ARRIVED and fixes each active booking's fare: a half-up-rounded 20% discount from its stored solo maximum when at least two distinct active bookings remain, otherwise no discount. FinalizedAt/finalFarePoisha remain null on pre-arrival cancellations. Repeated cancellation, acceptance while still MATCHED/ACCEPTED, same-state arrival/start, completed drop-off, and completed pool actions return the current resource without duplicate events. Other terminal/incompatible transitions return 409.

Passenger pool summaries expose a sharing boolean, never another passenger's membership or private data. Fare responses include discountBps, quoted pricingVersion, conditional poolingPricingVersion and applied finalPricingVersion. Existing quotes keep their original stored inputs; unfinalized quotes receive the new conditional offer and arrival policy without rewriting finalized history. See the ride guide for exact legacy semantics and rounding. Endpoint methods, pagination, auth and CSRF requirements are unchanged.
