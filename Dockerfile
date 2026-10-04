# syntax=docker/dockerfile:1

# Field Notes in one image: the web server ("node server.js", the default command) and the database
# migrations ("node migrate.mjs"). docker-compose.yml runs both; see "Self-hosting with Docker" in the README.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Install scripts are skipped: nothing here needs them, and embedded-postgres (a test-only dependency)
# would otherwise try to unpack a database server.
RUN npm ci --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 BUILD_STANDALONE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# The migration command as one self-contained file, so the runtime image needs neither tsx nor the sources.
# (pg is CommonJS and calls require, which an ES module lacks, so the bundle gets one.)
RUN node_modules/.bin/esbuild scripts/migrate.ts --bundle --platform=node --format=esm --target=node22 \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
      --external:pg-native --outfile=migrate.mjs

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/migrate.mjs ./migrate.mjs
USER node
EXPOSE 3000
# Healthy only when the app answers 200, which it does only while the database responds.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
