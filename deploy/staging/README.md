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
