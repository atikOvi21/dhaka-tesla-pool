# Dependency decisions and references

Verified host: Node 24.19.0, npm 11.17.0. Direct versions and resolved transitive versions are in package.json/package-lock.json. Use npm ci. Generated Prisma client is not committed; run db:generate before typecheck/build.

Selected Prisma 7.10.0 (stable 7 line; CLI advertised an 8 release candidate, deliberately not adopted), @prisma/client and adapter-pg matched exactly. It uses the PostgreSQL driver adapter, generated TypeScript client, and explicit prisma7.config.ts passed to every command. Prisma 7 seeding is explicit, so Compose invokes it after migrate deploy. React 19.3, Express 5.2.1, Vite 8.3, plugin-react 6.1.1, Vitest 5.0.1, TypeScript 7.0.2 installed and passed local type/build/HTTP checks on Node 24. Node image tracks 24; PostgreSQL tracks maintained 17 major. Lockfile pins npm resolution; container base tags receive patches rather than being immutable digests.

Official references consulted:
- [Vite getting started / Node requirements](https://vite.dev/guide/)
- [React Router declarative installation](https://reactrouter.com/start/declarative/installation)
- [Express 5 migration behavior](https://expressjs.com/en/guide/migrating-5/)
- [Prisma 7 configuration](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)
- [Prisma 7 seeding](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding)
- [Prisma PostgreSQL driver](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql)
- [connect-pg-simple session schema](https://github.com/voxpelli/node-connect-pg-simple/blob/main/table.sql)
- [Node scrypt API](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)
- [Compose health/startup ordering](https://docs.docker.com/compose/how-tos/startup-order/)

## Audit at initial install

npm reported four high entries: prisma, @prisma/config, deepmerge-ts, mysql2 (some entries are transitive rollups). Deepmerge-ts has recursive-object stack exhaustion; mysql2 has authentication downgrade and compressed protocol advisories. Prisma CLI brings these into migration/build tooling; this app uses pg, not mysql2, and configuration is local trusted code. npm's proposed automatic fix downgraded Prisma to 6.19.3, a major API change, so no blind audit fix --force was applied.

The API runtime image prunes dev, peer and optional dependencies; all three omission flags are needed because @prisma/client declares the CLI as an optional peer. The final prune audited 104 packages with zero vulnerabilities, and direct inspection confirmed prisma, @prisma/config, deepmerge-ts and mysql2 absent. Migration tooling stays in a separate init target; host npm audit --omit=dev still reports these optional-peer findings. Runtime audit result and Docker verification are recorded in progress.md. These findings remain a documented tooling limitation, to revisit when a stable compatible patched Prisma release is available. Do not claim an all-dependency clean audit.


## Backend authentication checkpoint

Added express-session 1.19.0, connect-pg-simple 10.0.0 and express-rate-limit 8.7.0 (resolved in lockfile), plus community TypeScript definitions. Consulted the [session middleware API](https://expressjs.com/en/resources/middleware/session/), [PostgreSQL session-store options](https://github.com/voxpelli/node-connect-pg-simple), and [rate-limit configuration](https://express-rate-limit.mintlify.app/reference/configuration). Inspected the installed store source for Math.ceil expiry rounding, disableTouch and prune/close behavior.

Install/build still report the same four high Prisma-tooling advisories, with no forced upgrades. Final auth runtime pruning audited 115 packages with zero vulnerabilities; the four advisory-related tooling packages remain excluded from the running API image. This does not claim the whole development dependency tree or container OS is vulnerability-free.

## Frontend authentication checkpoint

Added development-only Vitest/jsdom, React Testing Library/user-event/jest-dom and Playwright. Exact versions are in the lockfile. Browser tests use installed Microsoft Edge on Windows and the same Docker images with isolated tmpfs PostgreSQL. No additional frontend runtime dependency was needed. Docker full dependency installation still reported four high tooling advisories; API runtime pruning reported 142 packages and zero vulnerabilities. This is not an all-dependency or OS clean-audit claim.
