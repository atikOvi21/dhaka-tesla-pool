# Free deployment procedure

Status: configuration prepared and local hosting behavior checked; **no public deployment or live URL is claimed**. Deadline: 27 September 2026, 23:59 Bangladesh time (UTC+06:00). Deploy the reviewed release/v1.0.0 branch, not an unreviewed feature branch.

## Chosen option and limits

Use one **Render Free Node web service** for Express plus the built React SPA, with **Neon Free PostgreSQL**. This preserves one browser origin for session cookies/CSRF and uses the existing database/session design. A native Node service avoids managing two public services or another reverse proxy. Local Docker keeps its separate Nginx/API/PostgreSQL setup.

Render Free provides 750 workspace instance-hours/month, sleeps after 15 idle minutes, and takes about a minute to wake. Its filesystem is ephemeral. Free Render PostgreSQL expires after 30 days, so it is not the primary database choice. Stay on Free, avoid adding payment details, and inspect bandwidth/build-minute limits; do not approve an upgrade or charge. [Render free limits](https://render.com/docs/free)

Neon Free currently provides 100 CU-hours/project/month, 0.5 GB storage and 5 GB public transfer. Compute sleeps after five idle minutes; quota exhaustion can suspend compute. Free usage does not bill overages. Keep this an assessment/demo database and close unused polling tabs. [Official Neon limits, checked 25 September 2026](https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md)

This is feasible for a small assessment before the deadline, subject to account creation, provider capacity/verification and remaining free quota. It is not a production availability guarantee. Alternatives: free Render PostgreSQL is simpler but temporary; an already available free VM can run Compose but needs TLS, backups and operations. Switch to managed paid capacity only outside this no-payment assessment, when measured traffic/availability requirements warrant it.

## Create the database (candidate action)

1. Sign in to Neon and select **Free**, without a paid upgrade. Create an isolated project such as dhaka-tesla-demo, PostgreSQL 17, near Render's Singapore region where available.
2. Create/select the assessment database. Copy its **direct connection string** (pooling disabled). The small API and session pools do not require a pooler; direct connections also keep migrations and the current session/transaction assumptions straightforward.
3. Keep the supplied TLS connection options. Never use NODE_TLS_REJECT_UNAUTHORIZED=0 or disable certificate verification. Put this URL only in Render's secret environment field DATABASE_URL, never Git, screenshots, README or chat.
4. The insert-only demo seed creates the cast and routes. Do not point this deployment at your development database or reuse development secrets.

See [Neon connection instructions](https://neon.com/docs/connect/connect-from-any-app). Hosted PostgreSQL connectivity/TLS remains to be verified against the actual account.

## Create the web service (candidate action)

The reviewed configuration is [render.yaml](../render.yaml). It explicitly selects plan: free and disables automatic deployment. A Blueprint can read this file from release/v1.0.0; alternatively use New Web Service with these exact settings:

| Setting | Value |
|---|---|
| Repository | https://github.com/atikOvi21/dhaka-tesla-pool |
| Branch | release/v1.0.0 |
| Runtime / region / plan | Node / Singapore / Free |
| Root directory | repository root (leave empty) |
| Build command | npm ci --include=dev && npm run db:generate && npm run build |
| Start command | node scripts/start-hosted.mjs |
| Health check | /api/v1/health/ready |
| Auto deploy | Off; manually deploy the reviewed commit |

[Render Blueprint fields](https://render.com/docs/blueprint-spec) and [Node version selection](https://render.com/docs/node-version) describe these settings.

Set these environment variables:

| Variable | Value |
|---|---|
| NODE_VERSION | 24 (package engines also bound Node to 24.x) |
| NODE_ENV | production |
| WEB_DIST_DIR | apps/web/dist |
| DATABASE_URL | Neon direct TLS URL, secret |
| SESSION_SECRET | new random secret of at least 32 characters; Blueprint generates one |
| AUTH_ORIGINS | exact assigned https://YOUR-SERVICE.onrender.com origin, no trailing slash |
| SESSION_COOKIE_SECURE | true |
| TRUST_PROXY_HOPS | 1, for Render's immediate trusted proxy |
| SEED_DEMO | true for this public assessment demo only |

Render supplies PORT; do not hard-code it in the dashboard. For a manual secret, generate it locally with node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))" and paste only into the secret field. Keep it stable across restarts.

If the assigned URL is not known before creation, use an HTTPS placeholder origin, obtain the actual assigned domain, update AUTH_ORIGINS and redeploy before testing login. Do not assume your requested service name equals the assigned domain. No custom domain purchase is necessary. Render provides TLS for its assigned subdomain. [Render TLS](https://render.com/docs/tls)

Startup runs prisma migrate deploy, optional insert-only seed, then starts Express. A failed migration/seed prevents serving the application. There is no reset/db push. Free Render lacks a pre-deploy command, so this single-instance assessment keeps migration tooling installed and runs it during startup. The full dependency tree retains the recorded tooling advisories; it does not inherit the separately pruned Compose runtime's zero-advisory result. Review [dependency notes](dependencies.md). No automatic major downgrade/upgrade is performed.

Render terminates TLS and forwards to Express directly. Do not add the local Nginx container in front of this service: its local HTTP configuration overwrites the protocol header. Keep the service behind the provider proxy only; verify forwarding and client-IP behavior before sharing. [Express proxy trust](https://expressjs.com/en/guide/behind-proxies/)

## Public acceptance gate (must run before claiming live)

- Open the actual HTTPS URL and /api/v1/health/ready; require 200 and data.status=ready after any cold start.
- Check /login, direct /passenger/history and /driver/history load the SPA. Protected data must still require login.
- Register a disposable passenger; verify login, refresh and logout. In browser storage confirm the session cookie is HttpOnly, Secure, SameSite=Lax, and never localStorage.
- Use independent profiles for Nusrat/Rafiq/Jashim; run the shared-ride demo, check 40/48 BDT and independent statuses/history. Never print session cookies or database URLs in a recording.
- Wrong origin/token must reject mutations. Verify the proxy preserves HTTPS and distinct client IPs; do not broaden trust to all proxies as a workaround.
- Restart the web service once and verify the existing session and trip history survive. Expect a temporary readiness failure if Neon is waking; the UI should allow retry.
- Confirm the dashboard says Free and inspect quota usage. Do not pay if account verification or resource availability prevents deployment. Record the exact constraint and use the reproducible Docker fallback.
- Only after passing these checks, replace the README deployment placeholder with the real URL and record the deployed commit/time. These public checks have **not** been performed by the local release gate.

## Local checks and fallback

The isolated browser stack uses newly initialized tmpfs PostgreSQL on :8081. Existing development data at :8080 is preserved. Run the commands in [README](../README.md#tests). The optional node scripts/verify-hosted.mjs requires built apps and the disposable :5434 database; it tests startup/migrations/seed, SPA routing, Secure-cookie session rotation and CSRF through a simulated trusted HTTPS proxy. It is not actual public TLS validation.

If free hosting is unavailable, document the actual account/provider failure and supply Docker: clone the release branch, run node scripts/setup-local-env.mjs, then docker compose up --build -d. Open http://localhost:8080 and use the supplied cast. The setup helper generates a local secret; migrations and seed run automatically. docker compose down preserves the named database volume; never add -v during routine operation. The PRD permits this reproducible fallback when free backend hosting cannot be obtained.
