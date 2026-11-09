# Apolles container image (staging). Build from the repository root:
#   docker build -t apolles-staging-app .
# or let deploy/staging/docker-compose.yml build it (see deploy/staging/README.md).
# No secrets go into the image: every setting comes from the environment at run time.

FROM node:22-bookworm-slim AS base
# openssl: Prisma's schema engine (it applies the migrations) needs libssl, and Prisma reads
# the installed OpenSSL version to pick the right engine build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# ---- build: install, generate the Prisma client, build Next ----
FROM base AS build
WORKDIR /app
# Corepack installs exactly the pnpm version in package.json ("packageManager").
COPY package.json pnpm-lock.yaml .npmrc ./
RUN corepack enable && pnpm --version
# Same rules as local and CI: the lockfile is the only source of versions, and pnpm 10 runs
# no dependency install scripts (none are allow-listed).
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec prisma generate && pnpm exec next build
# Prisma downloads its schema engine on first use (not in an install script). Fetch it now,
# for this platform, so the running container never downloads anything; fail if it is missing.
RUN pnpm exec prisma version \
  && ls node_modules/.pnpm/@prisma+engines@*/node_modules/@prisma/engines/ | grep -q '^schema-engine-'
# The Prisma CLI (migrations, `prisma db seed`) and what the seed script imports.
RUN node deploy/staging/collect-node-modules.mjs /out \
    prisma @prisma/client @prisma/adapter-pg @node-rs/argon2 zod

# ---- runtime: the standalone Next server, plus Prisma CLI, migrations and the seed ----
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Everything is owned by root and read-only for the app user, except Next's cache folder.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
# The seed runs as TypeScript from source (Node strips the types), like `pnpm db:seed`.
COPY --from=build /app/src ./src
COPY deploy/staging/entrypoint.sh /usr/local/bin/apolles-entrypoint
RUN chmod 0755 /usr/local/bin/apolles-entrypoint \
  && mkdir -p .next/cache \
  && chown node:node .next/cache
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/apolles-entrypoint"]
