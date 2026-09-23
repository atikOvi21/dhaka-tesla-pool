# Project instructions

- Read [architecture](docs/architecture.md), [assumptions](docs/assumptions.md), [ERD](docs/erd.md), [API contract](docs/api-contract.md), and [progress](docs/progress.md) before feature work.
- The supplied five-page PRD is authoritative; distinguish it from our assumptions. Keep the story cast consistent.
- Modular monolith: React/Vite/TypeScript in apps/web, Express/TypeScript in apps/api, PostgreSQL through Prisma. Controllers handle HTTP; services own business rules.
- One browser origin with /api proxy. Cookie sessions in PostgreSQL; identities come from sessions. No client-authoritative prices, owners, states, or capacity.
- Money is integer poisha; distance is integer meters. Preserve historical fare inputs and events.
- Seat changes require transactions, locks, eligibility rechecks, and consistent lock order. SQL checks alone do not prevent overbooking.
- Preserve data. Never reset a database or Git history as routine setup. Seeds insert missing demo records without overwriting existing ones.
- Use npm workspaces and commit package-lock.json. Check relevant version-specific docs; avoid unnecessary dependencies.
- Run typecheck, tests, build, and relevant real-PostgreSQL checks. Record only checks actually executed.
- Work on feature/* with logical type(scope): description commits; merge to master only after review. Later integrate pre-release and release/v1.0.0. No automatic publishing/deployment.
- Frontend and backend authentication are verified on feature/auth; see [authentication](docs/authentication.md). Await review before merging. The next requested milestone will be the complete single-passenger ride lifecycle; do not start it without instruction.
- Update docs and truthful AI disclosure alongside changes; never invent candidate acceptance/rejection decisions.
