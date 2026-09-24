# Authentication

Implemented routes: GET /api/v1/auth/csrf, POST /auth/register, POST /auth/login, POST /auth/logout, GET /auth/me (all under /api/v1). Frontend authentication is implemented and verified. The single-booking ride endpoints are now implemented; see [ride lifecycle](ride-lifecycle.md).

## Contract and security decisions

- Register JSON: name (trimmed, 1–100 UTF-16 code units), email (trimmed/lowercase, valid email, at most 254), password (12–128 UTF-16 code units). Password whitespace/Unicode are preserved exactly. Unknown fields, including role, are rejected. Server always creates PASSENGER.
- Login JSON: email/password with the same normalization/limits. Seed passwords remain compatible. Missing account/wrong password return identical 401 INVALID_CREDENTIALS responses; a dummy scrypt hash keeps verification work comparable.
- Safe user response: id, name, email, role only. Registration is 201; login/me 200; unauthenticated me 401. Duplicate email returns 409 EMAIL_UNAVAILABLE, including concurrent normalized-email races. Unique database email constraint is authoritative.
- Existing scrypt format retained: N=131072, r=8, p=1, 16 random salt bytes, 64-byte key; timing-safe comparison. Two concurrent scrypt operations per API process bound memory use (~256 MiB combined working memory); excess hashing requests receive 503 AUTH_BUSY with Retry-After: 2.
- express-session + connect-pg-simple use the existing sessions(sid,sess,expire) table. No schema migration was needed. Session data lives in PostgreSQL; browser receives only signed opaque dtp.sid cookie. No localStorage tokens.
- Login/registration regenerate the session ID, rotate CSRF, set userId, and save before success. Previous ID is destroyed. If registration succeeds in the database but saving its session fails, return a generic server error; the account exists and the client should retry login.
- Authenticated lifetime: fixed 8 hours, no sliding renewal. Anonymous CSRF lifetime: 1 hour. rolling=false, resave=false, saveUninitialized=false, disableTouch=true. An application authExpiresAt additionally enforces the exact authenticated deadline. Store expiry rounds up by less than one second; tests allow that storage rounding while checking the application deadline separately.
- Expired sessions are rejected on read. connect-pg-simple prunes expired rows roughly every 15 minutes (library jitter gives about 7.5–22.5 minutes). Tests explicitly verify rejection and pruning.
- Cookies: HttpOnly, SameSite=Lax, Path=/, no Domain. Secure defaults on in production. Explicit insecure cookies are accepted only for loopback AUTH_ORIGINS, supporting local HTTP Compose/Vite. Public deployment requires HTTPS origins and SESSION_COOKIE_SECURE=true. Cookie deletion uses matching attributes.
- Session secret: required, random, at least 32 characters; example placeholder is rejected. Keep it stable across API restarts or cookies become invalid. It is not logged or committed.
- GET /auth/csrf creates/saves an anonymous session and returns data.csrfToken. All unsafe /api/v1 requests pass the session/CSRF boundary. Require matching 64-character X-CSRF-Token AND exact allowed Origin; reject cross-site Fetch Metadata. GET token rejects an explicitly foreign origin. No CORS is enabled. CLI clients must supply Origin too.
- After login/registration, GET /auth/csrf again; old tokens fail. After logout, bootstrap a new token before another login. If expiry yields 401 and clears the cookie, bootstrap again anonymously.
- Auth responses are Cache-Control: no-store. Reusable requireAuth reads the current user from PostgreSQL; requireRole follows it and checks that current role. Test-only role routes are never mounted in the production server.
- Logout requires CSRF, destroys the stored session, clears cookie, returns data:null. Replayed old cookie cannot authenticate. Session storage outages fail closed with a generic 500, not 401; the frontend must distinguish server/network errors from signed-out state.
- Auth credential limiter: shared login/register budget of 10 requests per IP per 15 minutes, successful and invalid-input attempts included once CSRF passes. CSRF bootstrap: 60 requests/IP/15 minutes. 429 uses RATE_LIMITED and Retry-After. Default express-rate-limit IPv6 grouping applies.
- Limiter state is process-local and resets on API restart; multiple API instances/distributed attackers need shared limiting or an edge service. This limitation does not justify adding Redis now.
- Host development trusts no proxy. Compose trusts exactly one internal Nginx hop; API is not published. Nginx overwrites X-Forwarded-For with remote_addr and X-Forwarded-Proto with its scheme. Do not expose API directly or blindly expand hop trust. A future TLS ingress needs an explicit topology/config review.

## Run focused verification

From repository root, after npm ci and npm run db:generate:

```powershell
docker compose -f compose.auth-test.yaml up -d --wait db
npm run typecheck -w @dtp/api
npm run test:auth -w @dtp/api
npm test -w @dtp/api
npm run build -w @dtp/api
docker compose -f compose.auth-test.yaml down
```

AUTH_TEST_DATABASE_URL in .env must target the dedicated dhaka_tesla_auth_test database at loopback :5434. The runner refuses other database names or the development database, deploys migrations, seeds the isolated DB, and runs the auth suite. Test data stays in that disposable tmpfs database; down removes it. No development reset/truncation occurs.

Runtime check after starting Compose with a configured session secret:

```powershell
docker compose up --build -d
node scripts/auth-runtime-smoke.mjs
```

The smoke script logs in seeded Nusrat and Jashim through Nginx, checks cookie/CSRF behavior, restarts ONLY the API container, proves the original passenger session still works, then logs out both accounts. It prints no credentials/cookies and creates no development user records. This is HTTP/runtime verification, not browser automation.

Manual API sequence: GET /api/v1/auth/csrf while retaining cookies; POST /auth/login with Origin, X-CSRF-Token and demo email/password; GET /auth/me with the new cookie; GET /auth/csrf again; POST /auth/logout using that new token. Replace login with register and a new name/email/password to create a passenger. All state remains server-side.

## Frontend authentication

Routes: /login, /register, /passenger, /driver, and public /foundation. Root opens login or the current role's workspace. Nginx and Vite serve SPA deep links directly.

AuthContext restores GET /auth/me before routing; loading never flashes the login page. Only 401 becomes anonymous. Network/5xx failures show Retry and retain non-sensitive form drafts. Active sessions are rechecked every 60 seconds while visible and on window focus/visibility changes. Expiry or another-tab logout displays a sign-in message. This interval applies to authentication only, not the planned business polling.

The fetch wrapper sends same-origin cookies and obtains a fresh CSRF token before every mutation. It also refreshes after successful login/registration. Logout discards authenticated state; the next mutation bootstraps a new anonymous token. No credentials are kept in localStorage. Mutations are never automatically replayed, including when post-login token refresh fails; Retry checks the session instead. Password inputs are cleared after attempted requests, while name/email survive recoverable failures. Form fields and submit buttons are disabled during submission.

Role guards prevent the opposite workspace from rendering and link to the correct workspace. These are UI controls; server authorization remains authoritative. The role workspaces now provide the single-booking ride lifecycle; shared pooling remains upcoming.

### Reproduce browser verification

From the repository root, with npm dependencies installed and .env configured:

```powershell
npm test -w @dtp/web
npm run typecheck -w @dtp/web
npm run build -w @dtp/web
docker compose build
docker compose -f compose.e2e.yaml up --no-build -d --wait
npm run test:e2e -w @dtp/web
docker compose -f compose.e2e.yaml down
```

The separate Compose project runs the same application images at localhost:8081, with a tmpfs PostgreSQL database and no development volume. It seeds independent accounts, uses a unique registration email, and expires only that test user's session to verify recovery. Do not point these tests at development/production. Tests use installed Microsoft Edge on Windows; elsewhere install Playwright Chromium with npx playwright install chromium, or set BROWSER_CHANNEL to an installed compatible browser. Traces are disabled to avoid saving credentials/cookies.

Two browser tests cover the full desktop journey and a mobile registration/keyboard/layout check. The desktop journey exercises registration, Nusrat/Jashim login, wrong password, refresh, direct protected links, wrong roles, logout, session expiry, offline/503 recovery, empty browser storage and foundation readiness. Backend regression tests also ran against this isolated database (19 auth + 5 HTTP).

### Manual review

1. Start the main stack with docker compose up --build -d. Open http://localhost:8080/register and register a new passenger (name, unused email, 12-128-character password). Confirm /passenger opens, then refresh.
2. Sign out. At http://localhost:8080/login try a wrong password, then nusrat@demo.dhaka.test with DemoOnly!Dhaka2026. Visit /driver and confirm access is denied with a link back.
3. Sign out and log in as jashim@demo.dhaka.test with the same demo password. Confirm /driver, refresh, and try /passenger.
4. Sign out and open /driver or /passenger directly: login should appear after the session check.
5. In browser developer tools set Network to Offline, then refocus the page while signed in (or refresh). Confirm a retryable error. Restore networking and press Retry. A simulated GET /auth/me 503 is covered by automated tests.
6. Review registration and login at narrow mobile widths and use Tab/Enter. Check labels, focus indicators, validation and disabled submission.
7. Open http://localhost:8080/foundation for connectivity. Production deep links are served by Nginx, not just Vite.

Authentication excludes password reset/email verification and per-device session management. No public HTTPS deployment was tested. Authentication was reviewed and fast-forwarded into master at 641615a before feature/ride-lifecycle began. See the ride guide for the new business flows.
