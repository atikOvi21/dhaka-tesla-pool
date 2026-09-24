# Single-booking ride lifecycle

Current implementation uses one booking per pool, with one or more seats. This is a milestone limit, not a permanent product or schema rule. Shared matching and discounts remain pending.

All ride mutations use a PostgreSQL transaction-scoped advisory lock (73421, 1), acquired before reading business state. Acceptance, cancellation, booking creation, availability and lifecycle changes share it across API instances. This deliberately serializes unrelated ride writes at demo scale. Transactions atomically write requests, memberships, seat counters, fares and events; rollback releases the lock. Existing partial unique indexes remain backstops. Reads use repeatable-read transactions for consistent summaries. No external work occurs inside transactions. P2034 transaction conflicts receive at most two whole-transaction retries; lock waits are bounded. Future fine-grained locking must replace this consistently for every writer, using the original ordered row-lock plan and new concurrency tests.

Pricing version demo-solo-v1 snapshots base 2000 poisha, rate 1000 poisha/km, seats and route distance. BigInt half-up rounding occurs after seat multiplication. The provisional pooled schema field equals the solo estimate for this milestone; no discount is advertised or applied. Arrival fixes final fare and discount=0. Pre-arrival cancellation leaves final fare null and incurs no charge.

Creation requires a passenger-scoped Idempotency-Key. Replay of identical route/seats returns the original booking, including terminal bookings; a different payload conflicts. The frontend retains the key and payload in sessionStorage (no credentials) for uncertain submissions and reload recovery. Changed details or a confirmed new intent receive a new key. Mutations are never automatically retried by the browser.

Ride screens poll every five seconds after the preceding read finishes, abort on navigation/logout, and provide retryable errors. Detail pages retain completed/cancelled results; current pages show the latest booking/trip alongside history. Passenger fare data is omitted from driver/waiting responses.

## Verification checkpoint

Backend service and HTTP boundary implemented. 16 focused real-PostgreSQL tests passed, covering lifecycle, pricing/rounding, immutable snapshots, idempotency races, one-active limits, competing acceptance, cancellation/arrival and offline/acceptance races, privacy, ownership, histories and invalid transitions. Frontend and browser verification are in progress; see progress.md for the final checkpoint.
