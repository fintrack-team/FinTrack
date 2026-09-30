FROM node:24-alpine AS base
WORKDIR /app
RUN npm install -g npm@latest && \
    mkdir -p /tmp/patch && cd /tmp/patch && npm init -y && \
    npm install brace-expansion@^5.0.9 undici@^6.27.0 ip-address@^10.7.1 && \
    cp -r node_modules/brace-expansion node_modules/undici node_modules/ip-address /usr/local/lib/node_modules/npm/node_modules/ && \
    rm -rf /tmp/patch
COPY package.json /tmp/package.json
RUN corepack enable && \
    PNPM_VERSION=$(node -e "process.stdout.write(require('/tmp/package.json').packageManager.split('@')[1])") && \
    corepack prepare "pnpm@${PNPM_VERSION}" --activate

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
RUN apk add --no-cache libc6-compat
ENV HUSKY=0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/

RUN pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

ARG NEXT_PUBLIC_TELEGRAM_BOT_ID
ENV NEXT_PUBLIC_TELEGRAM_BOT_ID=$NEXT_PUBLIC_TELEGRAM_BOT_ID

COPY --from=deps /app ./
COPY packages/types ./packages/types
COPY apps/web ./apps/web

RUN pnpm --filter @fintrack/types build
RUN pnpm --filter fintrack-web build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
RUN npm install -g npm@latest && \
    mkdir -p /tmp/patch && cd /tmp/patch && npm init -y && \
    npm install brace-expansion@^5.0.9 undici@^6.27.0 ip-address@^10.7.1 && \
    cp -r node_modules/brace-expansion node_modules/undici node_modules/ip-address /usr/local/lib/node_modules/npm/node_modules/ && \
    rm -rf /tmp/patch
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=5173

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 5173

CMD ["node", "apps/web/server.js"]
