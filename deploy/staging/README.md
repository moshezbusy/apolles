# Apolles staging on the VPS

Staging runs at **https://staging.apolles.com** on the owner's VPS, next to the other sites.
It holds **demo data only**, never real agencies or real bookings.

```
Browser → Cloudflare → shared Caddy (HTTPS, network n8n_default) → apolles-staging:3000 → apolles-staging-db
```

- `apolles-staging` is the app container. It is built from the `Dockerfile` at the repository
  root. On every start it refuses to run unless `APP_ENV=staging`, applies the committed
  database migrations, then starts the server on port 3000.
- `apolles-staging-db` is PostgreSQL 16. Its data lives in the Docker volume
  `apolles-staging_apolles_staging_db`. It sits on the private network `apolles_staging_net`,
  which has no route out, and only the app and the worker can reach it.
- `apolles-staging-worker` is the background worker: the same image, run as a separate
  process (`src/worker.ts`). It runs the job queue (daily hotel content refresh and, later,
  booking reconciliation and emails). It does not run migrations; the app container does.
  It is capped at 256 MB. Logs: `docker compose -p apolles-staging logs --tail 50 apolles-staging-worker`.
- No container publishes a port. The only way in is through Caddy. Other containers on
  the `n8n_default` network can still reach `apolles-staging:3000` directly, bypassing
  Cloudflare and `cf_only`. That is acceptable for demo-only staging; revisit it for production.
- Staging has no email provider yet (`EMAIL_PROVIDER=staging-log`). Every email the app
  would send, including set-password and reset links, is written as one JSON line to the
  app container's log, and the operator passes the links on by hand. This works only together
  with `APP_ENV=staging`; with any other value the app refuses to send.

Every command below runs on the VPS as `moshezbusy`.

## 1. First install

### 1.1 Get the code

```sh
git clone https://github.com/moshezbusy/apolles.git /home/moshezbusy/apolles-staging
cd /home/moshezbusy/apolles-staging
git checkout <branch-or-commit-the-owner-named>
cd deploy/staging
```

### 1.2 Create `deploy/staging/.env`

This file holds the settings and the database password. It stays on the server only: git
ignores it, and the Docker build leaves it out of the image. **Never print it, paste it, or
commit it.**

Replace the two `<owner email>` placeholders, then run this from `deploy/staging`. It generates
the database password on the server and never shows it:

The block refuses to run if `.env` already exists, because running it again would create a new
database password while the database volume keeps the old one. It runs in a subshell, so the
restrictive file permissions (`umask 077`) do not change your terminal.

```sh
test ! -e .env || { echo ".env already exists: stop, do not overwrite it"; false; } && (
umask 077
DB_PASSWORD="$(openssl rand -hex 32)"
cat > .env <<EOF
# Apolles staging. Generated on the server. Never commit, print or share.
POSTGRES_PASSWORD=${DB_PASSWORD}
DATABASE_URL=postgresql://apolles:${DB_PASSWORD}@apolles-staging-db:5432/apolles_staging
APP_ENV=staging
EMAIL_PROVIDER=staging-log
APP_URL=https://staging.apolles.com
ADMIN_ALERT_EMAIL=<owner email>
# Caddy hands the app exactly one address: the visitor's (see section 4).
TRUSTED_PROXY_HOPS=1
# Demo bank details shown on the agent balance page. Not a real account.
BANK_DETAILS_BENEFICIARY=Apolles Staging (demo)
BANK_DETAILS_BANK_NAME=Demo Bank
BANK_DETAILS_ACCOUNT_NUMBER=000000000
BANK_DETAILS_IBAN=XX00 DEMO 0000 0000 0000 00
BANK_DETAILS_SWIFT=DEMOXXXX
# The first admin, created by the seed step (section 1.4).
SEED_ADMIN_EMAIL=<owner email>
EOF
chmod 600 .env
)
```

What each setting means:

| Variable | Value on staging | Meaning |
|---|---|---|
| `POSTGRES_PASSWORD` | generated | Password of the staging database. Docker uses it only the first time it creates the database (see "Good to know"). |
| `DATABASE_URL` | generated | How the app reaches the database. It uses the same password. |
| `APP_ENV` | `staging` | Marks this deployment as staging. Without it, the container does not start and the log email provider refuses to work. Set it **only** here. |
| `EMAIL_PROVIDER` | `staging-log` | Writes emails to the container log instead of sending them. Staging only. |
| `APP_URL` | `https://staging.apolles.com` | The address used in the links inside emails. |
| `ADMIN_ALERT_EMAIL` | owner | Receives security alerts. On staging these also go to the log. |
| `TRUSTED_PROXY_HOPS` | `1` | How the app finds the visitor's IP for rate limits (section 4). |
| `BANK_DETAILS_*` | demo text | Shown to agents as the top-up account. Use demo values on staging. |
| `SEED_ADMIN_EMAIL` | owner | The first admin account, created by the seed. |

### 1.3 Build and start

From `deploy/staging`. Note that `--build` runs the Next.js build on the VPS itself. It
briefly uses a lot of memory (about 1 to 2 GB), on a server shared with the other sites, so
start it when the server is quiet. The containers are capped (app 1 GB, database 512 MB) so a
runaway staging cannot take the other sites down.

```sh
docker compose -p apolles-staging up -d --build
docker compose -p apolles-staging ps
docker compose -p apolles-staging logs --tail 50 apolles-staging
```

The app log should show the migrations, then `Starting Apolles (staging) on port 3000.` and
`Ready`. The `n8n_default` network must already exist, because the shared Caddy uses it. If
compose says it is missing, stop and check the Caddy setup instead of creating it.

### 1.4 Create the first admin (seed)

From `deploy/staging`:

```sh
docker compose -p apolles-staging exec apolles-staging node node_modules/prisma/build/index.js db seed
```

It prints `Admin created. A set-password email was sent.` together with one line like this:

```
{"type":"staging-email","to":"<owner email>","subject":"Set your Apolles password","text":"... https://staging.apolles.com/set-password/<secret> ..."}
```

Send the owner **only the link**, privately (not in a group or a ticket). It works once, for 60
minutes. Running the seed again is safe: it creates nothing new and says whether the admin
already exists or still has to set a password. If the link expired, use "Forgot password"
on the login page, then read the new link from the log (next section).

### 1.5 Links the app emails later (forgot password, new agents)

```sh
docker compose -p apolles-staging logs apolles-staging | grep '"type":"staging-email"'
```

These lines contain secret links. Do not copy the whole log anywhere. Docker keeps at most
3 × 10 MB of this log, and every link expires after 60 minutes.

## 2. Caddy site block

The shared Caddy proxy runs in Docker on the `n8n_default` network and already serves the
other sites with the `cf_only` snippet. To add staging:

1. Back up the Caddyfile first:

   ```sh
   cp /home/moshezbusy/n8n/Caddyfile /home/moshezbusy/n8n/Caddyfile.bak-$(date +%Y%m%d%H%M%S)
   ```

   The Caddyfile is mounted into the container as a single file. Edit it **in place** (for
   example with `nano`) and do not replace the file with a new one (no `mv`, no tools that
   write a new file and rename it), or the container keeps seeing the old content.
2. Add this block. It follows the existing sites' pattern, with two small differences
   explained under the block:

   ```caddy
   staging.apolles.com {
   	import cf_only
   	header {
   		Strict-Transport-Security "max-age=31536000"
   		X-Content-Type-Options "nosniff"
   		?Referrer-Policy "strict-origin-when-cross-origin"
   		X-Robots-Tag "noindex, nofollow"
   		-Server
   	}
   	reverse_proxy apolles-staging:3000 {
   		header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
   	}
   }
   ```

   - `?Referrer-Policy` with a question mark sets this header **only if the app has not set
     one**. The set-password pages have a secret in their address, so the app sends the
     stricter `Referrer-Policy: no-referrer` there. Without the `?`, Caddy replaces it (tested
     with Caddy 2.11). All other pages get `strict-origin-when-cross-origin` as before.
   - The `header_up X-Forwarded-For ...` line hands the app the visitor's real IP (section 4).
3. Validate, then reload:

   ```sh
   docker exec caddy caddy validate --config /etc/caddy/Caddyfile
   docker exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```

4. Check that `https://staging.apolles.com/login` loads, and that the **existing sites still
   answer**.
5. In Cloudflare, `staging.apolles.com` needs a proxied (orange-cloud) DNS record like the
   other sites. Otherwise `cf_only` rejects the requests.

## 3. Updating to a new commit

From `/home/moshezbusy/apolles-staging`:

```sh
git fetch
git checkout <new-commit-or-branch>      # or: git pull, when following a branch
cd deploy/staging
docker compose -p apolles-staging up -d --build
docker compose -p apolles-staging logs --tail 50 apolles-staging
```

The new container applies any new migrations before it starts. Migrations only move forward.
Going back to an older commit does not undo them, so ask before rolling back across a database
change. The database volume and `.env` are kept. Old app images can be listed with
`docker image ls apolles-staging-app` and removed with `docker image rm <id>`.

Stop staging, keeping the data: `docker compose -p apolles-staging down`.
**Never** add `-v` to that command: it deletes the database volume.

## 4. Visitor IP addresses (rate limits) — why `header_up` and `TRUSTED_PROXY_HOPS=1`

The app limits sign-in and password attempts per visitor IP. It reads the IP from the
`X-Forwarded-For` header and trusts only the last `TRUSTED_PROXY_HOPS` entries, the ones
added by our own proxies (`src/server/client-ip.ts`).

Here a request passes two proxies: Cloudflare, then Caddy. By default Caddy does **not**
trust Cloudflare's `X-Forwarded-For`. It replaces the header with the address it was connected
from, which is a Cloudflare edge server. The app would then see Cloudflare's IPs, so many
visitors would share one rate limit, and one attacker could lock others out.

The fix used here is the `header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}`
line in the site block. It sets `X-Forwarded-For` to exactly one address: the visitor IP that
Cloudflare puts in its `CF-Connecting-IP` header. This is safe because:

- `import cf_only` already rejects every request that does not come from Cloudflare, so the
  header always comes from Cloudflare;
- Cloudflare overwrites any `CF-Connecting-IP` a visitor sends themselves;
- whatever `X-Forwarded-For` the visitor sends is thrown away, not passed on.

So the app sees a single trusted entry, and `TRUSTED_PROXY_HOPS=1` is the right value. If
the header were ever missing, the app treats the IP as `unknown`. It never takes an address
the visitor made up.

This was chosen over the alternative (Caddy's global `trusted_proxies` with Cloudflare's IP
ranges plus `client_ip_headers CF-Connecting-IP`) because it changes only the staging site
block. It does not touch the global options shared with the other sites, and it does not
need a copy of Cloudflare's IP list.

Tested locally with Caddy 2.11. A request with `X-Forwarded-For: 6.6.6.6` and
`CF-Connecting-IP: 203.0.113.7` reached the app as `X-Forwarded-For: 203.0.113.7`. Without the
line, it arrived as the proxy's own address.

## 5. Automatic updates from `main`

`deploy/staging/auto-update.sh` keeps staging on the latest `main` without anyone logging in.
Cron runs it every 5 minutes. When `main` has not moved, it does nothing. When `main` has
moved, it moves the checkout to the new commit and rebuilds the app container. New migrations
apply on start, as in section 3.

Install it once, from `/home/moshezbusy/apolles-staging`:

1. Run it once by hand and read the output. It must end with `staging is now at <commit>`.
   This also proves that `git fetch` works without a password prompt, which cron needs.

   ```sh
   deploy/staging/auto-update.sh
   ```

2. Add the cron line. The command replaces any older line for this script, so running it
   twice is safe:

   ```sh
   (crontab -l 2>/dev/null | grep -v 'apolles-staging/deploy/staging/auto-update.sh'; echo '*/5 * * * * /home/moshezbusy/apolles-staging/deploy/staging/auto-update.sh >> /home/moshezbusy/apolles-staging-update.log 2>&1') | crontab -
   ```

What to expect:

- **The log:** `/home/moshezbusy/apolles-staging-update.log` gets one line per update, and
  the error when an update fails.
- **A failed build:** the previous version keeps running. That commit is not tried again;
  the next commit on `main` is. To retry the same commit, delete
  `~/.apolles-staging-failed` and wait 5 minutes.
- **Local edits:** if someone edits a tracked file on the server, git refuses to move and the
  log shows it. The edit is never discarded.
- **Memory:** a build can start at any time of day and briefly uses 1 to 2 GB (see 1.3). The
  container limits still protect the other sites.
- **To stop:** remove the line with `crontab -e`.

## Good to know

- **Changing the database password later**: Postgres takes `POSTGRES_PASSWORD` only when it
  first creates the volume. Changing it in `.env` afterwards breaks the app's connection.
  Change it inside Postgres first, then update both lines in `.env`:

  ```sh
  docker compose -p apolles-staging exec apolles-staging-db psql -U apolles -d apolles_staging -c "ALTER USER apolles PASSWORD 'new-password'"
  ```
- **No live keys here, ever.** Staging must never get production credentials or real
  agency data.
- The image has no secrets in it. Everything comes from `.env` when the container starts.

## 6. Demo mode (until Expedia's test keys arrive)

`docker-compose.yml` sets `SUPPLIER_MODE: fake` for the app and the worker (both must agree: the
worker's jobs check and follow up the same demo bookings). While it is set:

- search, hotel pages and bookings use made-up hotels and rates (`src/server/supplier/fake.ts`);
- every page shows a yellow "Demo mode" banner;
- each start adds the demo destinations and hotels (Paris, Rome, Barcelona, London, Athens,
  Dubai). Every demo id starts with `demo-`, and real data is never touched;
- nothing is sent to Expedia or to any hotel;
- several rooms per booking are allowed (plan 10). With the real supplier they stay off until
  they are checked on Expedia's test system (plan 10, "Verify with Expedia test keys").

The app refuses the fake supplier whenever `APP_ENV=production`.

When the Expedia test keys are on the server, delete both `environment:` blocks with `SUPPLIER_MODE`
(app and worker) from `docker-compose.yml` and restart. The next catalog sync then marks the demo hotels inactive,
because they are not in Expedia's file.

### 6.1 Demo login (agent)

In demo mode each start also creates **Demo Travel Agency**, with USD 10,000 of demo
balance, and its agent **demo-agent@apolles.test**. While that agent has no password, the
start writes a one-time link to choose one (it works once, for 60 minutes). Read the link with:

```sh
docker compose -p apolles-staging logs apolles-staging | grep "Demo agent"
```

For a fresh link without restarting, run:

```sh
docker compose -p apolles-staging exec apolles-staging node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./prisma/ts-loader.mjs prisma/demo-seed.ts
```

No password is ever written in code.

## 7. AI search connector (MCP)

**What it is.** An agent can connect Claude to Apolles and ask it to search hotels in plain
words. It is **search only**: the assistant cannot book, cancel or see balances, and it only
sees what that agent could see on the search page. The connector is a small extra container,
`apolles-staging-mcp` (same image, 128 MB, no database and no Expedia keys). It reaches the
app only through the app's internal AI API, as `apolles-staging:3000` on the shared Docker
network `n8n_default`. It is **not** on the database network (`apolles_staging_net`): it faces
the internet, so it must have no way to the database.

The connector only starts with the compose profile `ai`. A plain `docker compose up` (and the
automatic update of section 5) leaves it out, so staging keeps updating while the settings below
are not there yet.

**The switch.** `AI_SEARCH_ENABLED` in `deploy/staging/.env`. It is **off unless the value is
exactly `true`**. Owner decision: it stays off on production until Expedia has answered. To
test on staging, add `AI_SEARCH_ENABLED=true`.

`APP_URL` must also be set in `deploy/staging/.env` (it already is, for the app; the connector
now needs it too, as its login server address, and does not start without it).

Add these three lines to `deploy/staging/.env` (they are also listed, without values, in
`.env.example`), then recreate the containers:

```sh
AI_SEARCH_ENABLED=true
MCP_PUBLIC_URL=https://mcp-staging.<domain>
AI_MCP_SERVICE_KEY=<run: openssl rand -base64 48>
```

- `MCP_PUBLIC_URL` is the connector's own public address: a new subdomain, `https`, no path.
- `AI_MCP_SERVICE_KEY` is the secret the connector uses to talk to the app. Generate it on the
  server with `openssl rand -base64 48`, paste it into `.env`, and never print or share it.
  It must be at least 32 characters: with a shorter one the connector does not start and the
  app refuses every connector call.
  The app container and the connector container both get it from `.env`. The connector gets
  nothing else from that file, only `MCP_PUBLIC_URL`, `AI_MCP_SERVICE_KEY` and `APP_URL`
  (passed on as `APP_PUBLIC_URL`). A test (`src/server/ai/compose.test.ts`) fails if the
  database or Expedia settings ever reach it.

Once the three lines are in `.env`, start everything with the `ai` profile:

```sh
cd /home/moshezbusy/apolles-staging/deploy/staging
docker compose -p apolles-staging --profile ai up -d --build
docker compose -p apolles-staging logs --tail 50 apolles-staging-mcp
```

The log should end with `Apolles MCP server listening on port 8080.` If a setting is missing
or wrong, it says `Refusing to start:` and names the variable (never its value), and the
container keeps restarting until it is fixed. The other containers are not affected.

The automatic update (section 5) runs a plain `up`, so it does **not** update the connector:
after an update it keeps running the old version. Run the `--profile ai` command above again
to update it, or add the line `COMPOSE_PROFILES=ai` to `deploy/staging/.env` (only once the
three lines above are there): then every `up`, including the automatic one, includes it.

**Caddy.** Two edits to the Caddyfile (back it up and edit in place, as in section 2):

1. A new site block for the subdomain. It follows the staging block in section 2, with the
   same `header_up` line:

   ```caddy
   mcp-staging.<domain> {
   	import cf_only
   	header {
   		Strict-Transport-Security "max-age=31536000"
   		X-Content-Type-Options "nosniff"
   		Referrer-Policy "no-referrer"
   		X-Robots-Tag "noindex, nofollow"
   		-Server
   	}
   	reverse_proxy apolles-staging-mcp:8080 {
   		header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
   	}
   }
   ```

   The `header_up` line hands the connector the assistant's real IP, as in section 4. The
   connector passes it on to the app, so its limits count each caller on its own: without the
   line, every caller would look like one of a few Cloudflare addresses and share one limit.

2. In the existing `staging.apolles.com` block, **before** its `reverse_proxy`, hide the
   app's internal AI API, so it can never be reached from the internet:

   ```caddy
   	@aiapi path /api/ai/*
   	respond @aiapi 404
   ```

   The app also refuses that API (404) for any request that names the public address
   `staging.apolles.com`, which every request through Caddy does. So the API stays closed to the
   internet even if this rule is missing or a path trick gets past it; keep the rule anyway, as
   a second layer.

Validate and reload as in section 2. The new subdomain needs a proxied (orange-cloud) DNS record
in Cloudflare. Claude connects from Anthropic's addresses, `160.79.104.0/21` and
`153.61.208.0/20`: do not block them in a firewall.

**How to test.**

1. Log in to staging as an agent, open **Settings**, then the AI assistants tab, and click **Connect assistant**. It shows a connection link, valid for 10 minutes.
2. In Claude: Settings, Connectors, **Add custom connector**. Use the address
   `<MCP_PUBLIC_URL>/mcp` (for example `https://mcp-staging.<domain>/mcp`).
3. Click **Connect**. Use the same browser where you clicked Connect assistant. If Apolles
   asks you to sign in, sign in, then click Connect assistant again and repeat. Approve. Then
   ask Claude to search for hotels, for example "hotels in Paris, 2 adults, 10 to 12 December".

**ChatGPT (optional test).** In ChatGPT: Settings, Connectors (called Apps in some versions),
add a custom connector, use the same address `<MCP_PUBLIC_URL>/mcp`, choose OAuth as the
sign-in, then approve in Apolles as above. Full MCP connectors need ChatGPT Business or
Enterprise; on Pro only read actions work, which is all the connector has (search only). These
facts come from search summaries, not from the real screens: confirm them on the real screen.

**How to revoke.** The agent clicks revoke next to the assistant in the same Settings tab (it then shows
"Assistant disconnected."). To stop everything at once, remove `AI_SEARCH_ENABLED`
from `.env` (or set it to anything but `true`) and recreate the containers (with
`--profile ai`, as above): every connector call is then refused. Changing `AI_MCP_SERVICE_KEY` cuts the connector off from the app.
