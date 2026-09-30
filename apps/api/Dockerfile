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
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/

RUN pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder

COPY --from=deps /app ./
COPY packages/types ./packages/types
COPY apps/api ./apps/api

RUN pnpm --filter @fintrack/types build
RUN pnpm --filter fintrack-api run prisma:generate
RUN pnpm --filter fintrack-api build

# ── deploy ────────────────────────────────────────────────────────────────────
FROM base AS deploy

COPY --from=builder /app ./
RUN pnpm --filter fintrack-api deploy --prod /deploy

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
RUN npm install -g npm@latest && \
    mkdir -p /tmp/patch && cd /tmp/patch && npm init -y && \
    npm install brace-expansion@^5.0.9 undici@^6.27.0 ip-address@^10.7.1 && \
    cp -r node_modules/brace-expansion node_modules/undici node_modules/ip-address /usr/local/lib/node_modules/npm/node_modules/ && \
    rm -rf /tmp/patch

ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S apiuser -u 1001

COPY --from=deploy /deploy ./

# pnpm deploy with ignore-scripts=true skips bin creation and engine download;
# re-create prisma bin and trigger engine setup as root before dropping privileges
RUN set -e && \
    PRISMA_PKG=$(ls node_modules/.pnpm | grep "^prisma@" | head -1) && \
    [ -n "$PRISMA_PKG" ] || { echo "ERROR: prisma package not found in .pnpm store"; exit 1; } && \
    mkdir -p node_modules/.bin && \
    ln -sf "../.pnpm/${PRISMA_PKG}/node_modules/prisma/build/index.js" node_modules/.bin/prisma
RUN node node_modules/.bin/prisma generate --schema prisma/schema.prisma

USER apiuser
EXPOSE 8000

CMD ["sh", "-c", "node node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && node dist/server.js"]
