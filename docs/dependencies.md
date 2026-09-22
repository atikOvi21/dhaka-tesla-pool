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
