#!/bin/sh
# Start-up for the Apolles staging container (see deploy/staging/README.md):
#   1. refuse to start anywhere but staging;
#   2. apply the committed database migrations (owner-approved for staging only);
#   3. start the Next server on port 3000.
set -eu

if [ "${APP_ENV:-}" != "staging" ]; then
  echo "Refusing to start: this image runs only as staging and needs APP_ENV=staging." >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Refusing to start: DATABASE_URL is not set." >&2
  exit 1
fi

cd /app

echo "Applying committed database migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "Starting Apolles (staging) on port 3000."
export PORT=3000
export HOSTNAME=0.0.0.0
exec node server.js
