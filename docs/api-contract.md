# API contract — target MVP

Base `/api/v1`. Only health endpoints are implemented in foundation; all routes below are planned unless marked implemented. JSON request/response; success `{ "data": ... }`; error `{ "error": { "code": "...", "message": "..." } }`. No active resource → 200 `{ "data": null }`. Timestamps ISO 8601 UTC, IDs UUID strings, money fields suffixed `Poisha`, distances `Meters`. Never serialize password hashes, session payloads, or another passenger's fares.

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
| POST /fare-estimates | routeId, seats | soloMaximumPoisha, provisionalPooledPoisha, currency=BDT, pricingVersion, provisional=true |
| POST /ride-requests | routeId, seats; Idempotency-Key | own booking; may remain REQUESTED or join eligible pool |
| GET /ride-requests/active | none | own active booking or null |
| GET /ride-requests?cursor=...&limit=20 | opaque cursor; limit 1–100 | data.items, data.nextCursor; own history |
| GET /ride-requests/:id | UUID | own booking or 404 |
| POST /ride-requests/:id/cancel | empty | own booking; only REQUESTED/MATCHED; repeated cancellation returns current booking |
| GET /driver/profile | none | own profile and vehicle; driver only |
| PATCH /driver/availability | online:boolean | profile; offline blocked with active pool |
| GET /driver/ride-requests | cursor, limit | waiting requests relevant to vehicle capacity; paginated, necessary route/seats only |
| POST /driver/ride-requests/:id/accept | empty | assigned pool; driver online; considers compatible waiting requests |
| GET /driver/pools/active | none | own active pool or null |
| GET /driver/pools?cursor=...&limit=20 | cursor, limit | data.items, data.nextCursor; own history |
| GET /driver/pools/:id | UUID | own pool and members or 404 |
| POST /driver/pools/:id/arrive | empty | atomically closes boarding/finalizes fares, returns pool |
| POST /driver/pools/:id/start | empty | atomically starts pool/bookings |
| POST /driver/pools/:id/memberships/:membershipId/complete | empty | completes own pool member, releases allocation |
| POST /driver/pools/:id/complete | empty | completes pool only if all non-cancelled bookings completed |

Safe user: id, name, email, role. Booking: id, route (zone labels and demo meters), seats, status, createdAt, updatedAt, fare (soloMaximumPoisha, provisionalPooledPoisha, finalFarePoisha nullable, finalizedAt nullable, currency), pool summary nullable, allowedActions. Pool: id, status, vehicle summary, capacitySnapshot, allocatedSeats, pickup, routeGroup, member summaries, timestamps, allowedActions. Driver member summaries include request/membership IDs, passenger display name, route, seats, status, joinedAt/releasedAt; no email or another passenger's private fare.

Use descending (createdAt,id) keyset history pagination with opaque encoded cursor; malformed cursor → 400, nextCursor=null at end. Waiting acceptance order is ascending createdAt,id regardless of listing order. `allowedActions` guides the UI; the backend revalidates every action. Replaying an already-applied lifecycle action returns current resource without writing new events; incompatible later/terminal state → 409. Returning 200 for replay does not permit replayed side effects. Body limits and exact password/name limits will be fixed and tested in authentication milestone.
