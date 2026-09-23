# Requirements and decisions

## Explicit PRD requirements

Source: supplied Dhaka_Tesla_Pool_PRD_Internship.pdf, read in full (5 pages).
Sections 3–6 require passenger and driver flows, capacity-safe shared rides, individual fares and history, React or Next.js, Node.js, a designed database, and Docker Compose with migrations/seeds. Geography and fare rules may be simplified if documented. Sections 7–12 require trade-offs, architecture/ERD, honest AI disclosure, meaningful branch/commit history, and meaningful behavior/concurrency tests. Sections 13–16 require an eventual accessible repository, at most six-minute video, free hosting or documented reproducible Docker fallback, and no secrets or fabricated process.

## Candidate-agreed assumptions (not dictated by the PRD)

- Seed Jashim (driver), Bullet (3 seats), Nusrat, Rafiq, Shirin (passengers). Registration creates passengers only; drivers are seeded. One role/account and vehicle/driver.
- One active booking/passenger and pool/vehicle (therefore driver). A request reserves one or more seats for a single immutable route. Cancelled requests are terminal; retries create new requests.
- Matching: same pickup zone AND same compatibility group, enough free seats, ACCEPTED pool, online driver. Banani → Mohakhali (3,000 m) and Banani → Gulshan 1 (4,000 m) share `banani-east-demo`. These are invented demo distances and compatibility, not real road routing. No pool fit leaves REQUESTED. Acceptance creates a pool and considers compatible waiting requests by created_at, id, skipping those that do not fit.
- Joining after arrival is forbidden. Drop-offs release allocations without reopening matching. Drivers cannot go offline with an active pool. Driver cancellation/reassignment is outside MVP.
- Cash only. Passenger cancellation only in REQUESTED/MATCHED; no charge. Arrival freezes fares. Separate drop-offs are supported; pool completion requires every non-cancelled booking completed.
- Poll active screens approximately every 5 seconds in later milestones. Authentication context only; native fetch wrapper; CSS Modules. Free hosting provider remains undecided.

## Lifecycle

Booking: REQUESTED → MATCHED → DRIVER_ARRIVED → IN_PROGRESS → COMPLETED.
REQUESTED or MATCHED → CANCELLED. COMPLETED/CANCELLED are terminal.
Pool: ACCEPTED → DRIVER_ARRIVED → STARTED → COMPLETED.
All bookings cancelled before arrival → CANCELLED pool.
Arrival atomically closes boarding, snapshots final fares, changes active bookings, and writes events. Start updates pool/bookings together. Drop-off completes one booking and releases its membership. Cancellation retains the membership/history and releases only its seats. Repeated actions must not duplicate events/side effects.

## Pricing design (not implemented)

Store integers: 100 poisha = 1 BDT; distance in meters.
Version `demo-v1`: base 2,000 poisha/seat; rate 1,000 poisha/km/seat.
Solo maximum = roundHalfUp(seats × (basePoisha × 1000 + distanceMeters × ratePoishaPerKm) / 1000).
Use integer arithmetic (BigInt intermediates) and nonnegative half-up rounding: floor((numerator + denominator/2) / denominator).
Final = roundHalfUp(soloPoisha × (10000 - discountBps) / 10000).
Discount is 2,000 basis points (20%) iff at least TWO separate active bookings remain at arrival. Two seats in one booking count as one booking.
Nusrat: 1 seat × (20 + 3×10) = 50 BDT solo / 40 BDT pooled. Rafiq: 60 / 48 BDT. Pre-arrival display solo maximum and provisional pooled estimate, clearly conditional.
Snapshot seats, distance, base, rate, pricing version, solo/estimate at request creation; actual discount, final fare, and finalization timestamp at arrival. Final remains null until arrival; cancelled requests never finalize. Historical snapshots never use new configuration.

## Foundation implementation choices

- REST and npm workspaces keep a small monolith navigable without extra framework infrastructure.
- PostgreSQL sessions will use `connect-pg-simple`'s sid/sess/expire layout, mapped by Prisma now; middleware is implemented in the backend authentication checkpoint; see authentication.md.
- Scrypt hashes demo passwords with independent random salts; store algorithm/parameters for future verification. No plaintext password column.
- Composite role foreign keys enforce driver/passenger ownership in SQL. Partial unique indexes enforce active-resource limits. Membership seat counter consistency remains a transactional service responsibility for the pooling milestone.
- API health is public and discloses only status. Readiness checks PostgreSQL plus the migrated users table, with bounded query/connection timeouts. No business endpoint stubs returning fabricated success.
- Demo seed is opt-in with SEED_DEMO=true; Compose enables it for this local assessment setup. Insert-only upserts preserve passwords, vehicle changes, requests, and history on reruns.

No substantive conflict found between the PRD and the supplied plan. Deadline comes from the candidate's request, not the PDF. Public deployment, screenshots of product flows, video, complete business tests, and AI accepted/rejected examples remain later deliverables.
