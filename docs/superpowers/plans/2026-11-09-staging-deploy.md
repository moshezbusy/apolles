# Phase 1 · Plan 1c: Staging deploy on the owner's VPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Run the Plan 1 app as a staging environment at `https://staging.apolles.com` on the owner's existing VPS. The VPS already runs Docker and a shared Caddy reverse proxy that handles HTTPS behind Cloudflare. Staging holds demo data only.

**Owner decisions (in chat, 2026-11-09):**
- Host staging on the owner's VPS instead of Render. Production hosting stays open.
- Database migrations run automatically when the staging container starts. This is approved for staging only.
- Staging has no email provider yet. Set-password and reset emails are written to the container log (staging only), and the operator passes the links to the owner by hand. A real provider (Postmark) comes before any real agency.

## Global Constraints
- Everything from Plans 1 and 1b still applies.
- Logging email bodies is forbidden in production (R14). The staging exception must be opt-in, explicit, and impossible to turn on by accident in production:
  - it needs a dedicated provider value `EMAIL_PROVIDER=staging-log`;
  - it also needs `APP_ENV=staging`;
  - otherwise it throws.
- No secrets in the repo or the image. All secrets come from environment variables supplied at runtime.
- The image builds with `pnpm install --frozen-lockfile`, and install scripts follow the existing pnpm 10 policy.

---

### Task 1: Staging email provider

**Files:**
- Modify: `src/server/email/port.ts`.
- Create: `src/server/email/staging-log.ts`.
- Test: `src/server/email/staging-log.test.ts`, and extend `port.test.ts`.

**Interfaces:**
- `EMAIL_PROVIDER=staging-log` selects an adapter that writes one JSON line per email to stdout: `{ "type": "staging-email", to, subject, text }`.
- It throws unless `APP_ENV === "staging"`.

- [ ] **Step 1:** Write failing tests:
    - with APP_ENV=staging it logs the full message;
    - without APP_ENV, or with APP_ENV=production, `sendEmail` throws and nothing is logged;
    - the console adapter's production refusal is unchanged.
- [ ] **Step 2:** Implement, and document `APP_ENV` in `.env.example` by appending to the file.
- [ ] **Step 3:** Gate. Commit: `feat: staging-only email log provider`.

### Task 2: Container image and staging compose file

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `deploy/staging/docker-compose.yml`, `deploy/staging/entrypoint.sh`, `deploy/staging/README.md`.
- Modify: `next.config.ts` (`output: "standalone"`), if the image needs it.

**Interfaces:**
- **Multi-stage Dockerfile:**
    - Base image: Node 22 (bookworm-slim or alpine).
    - Build steps: corepack pnpm at the `packageManager` version, `pnpm install --frozen-lockfile`, `prisma generate`, `next build`.
    - The runtime stage runs as a non-root user and contains only what is needed to run the app, plus the Prisma CLI and migrations for the entrypoint.
- **Entrypoint:**
    - Applies committed migrations to `DATABASE_URL` (owner-approved, staging only).
    - Then starts the Next server on port 3000.
    - Refuses to start unless `APP_ENV=staging`.
- **Compose project `apolles-staging`:**
    - Service `apolles-staging-db` runs `postgres:16-alpine`. It uses a named volume and network `apolles_staging_net` only, with no published ports.
    - Service `apolles-staging` is the app. It joins `apolles_staging_net` and the external network `n8n_default`, so the shared Caddy can reach it. It publishes no ports and restarts `unless-stopped`.
    - Environment comes from `deploy/staging/.env` on the server, never committed. Variables: `DATABASE_URL`, `POSTGRES_PASSWORD`, `APP_ENV=staging`, `EMAIL_PROVIDER=staging-log`, `APP_URL=https://staging.apolles.com`, `ADMIN_ALERT_EMAIL`, `TRUSTED_PROXY_HOPS`, `BANK_DETAILS_*`, `SEED_ADMIN_EMAIL`.
- **README:** exact server steps for clone, `.env` creation (secrets generated on the server), build and up, seeding the admin, the Caddy site block, and updating to a new commit.

- [ ] **Step 1:** Build the image locally (`docker build`) and run it against a local Postgres with `APP_ENV=staging`. Smoke test: `/login` returns 200, the migrations applied, and `pnpm db:seed` works inside the container.
- [ ] **Step 2:** Gate: typecheck, lint, tests, build, e2e. Commit: `feat: staging container image and compose file`.

### Task 3 (operator, on the VPS — not an implementer task)
- Clone the branch into `/home/moshezbusy/apolles-staging`.
- Create `deploy/staging/.env` with generated secrets. Never print it.
- `docker compose up -d --build`.
- Add the Caddy site block `staging.apolles.com { import cf_only; header {...}; reverse_proxy apolles-staging:3000 }`:
    - back up the Caddyfile first;
    - run `caddy validate`, then `caddy reload`;
    - verify that the existing sites still answer.
- Seed the admin. Hand the set-password link to the owner from the container log.
