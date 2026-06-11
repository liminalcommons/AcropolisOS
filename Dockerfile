# syntax=docker/dockerfile:1.7

# acropolisOS Next.js application image.
# Multi-stage build keeps the runner image lean while preserving drizzle-kit
# for first-boot migrations driven by docker-entrypoint.sh.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3030
RUN apk add --no-cache bash postgresql-client \
    && addgroup -S app && adduser -S app -G app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/app ./app
COPY --from=builder /app/components ./components
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/functions ./functions
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scenarios ./scenarios
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/next-env.d.ts ./
COPY --from=builder /app/postcss.config.mjs ./
COPY --from=builder /app/tsconfig.json ./
# vitest.config.ts carries the @/ alias — without it, in-container `npx vitest
# run` (the documented quality gate) fails to collect every test importing @/lib.
COPY --from=builder /app/vitest.config.ts ./
COPY --from=builder /app/workers ./workers
COPY --from=builder /app/middleware.ts ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json* ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/data /app/uploads /app/ontology \
    && chown -R app:app /app

USER app
EXPOSE 3030

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
