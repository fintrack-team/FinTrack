# Contributing to FinTrack <!-- omit in toc -->

First off, thank you for considering contributing to FinTrack! This guide covers everything you need to get the project running from scratch and understand the development workflow.

Please read our [Code of Conduct](./CODE_OF_CONDUCT.md) before contributing. To report a security vulnerability, see [SECURITY.md](./SECURITY.md) instead of opening a public issue.

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Project Overview](#project-overview)
- [Getting Started](#getting-started)
  - [1. Preparation](#1-preparation)
  - [2. Docker (Recommended)](#2-docker-recommended)
  - [3. Local Installation](#3-local-installation)
- [Environment Variables](#environment-variables)
- [Database Management](#database-management)
- [Running Individual Apps](#running-individual-apps)
  - [API](#api)
  - [Web App](#web-app)
  - [Telegram Bot](#telegram-bot)
  - [Shared Types Package](#shared-types-package)
- [Testing](#testing)
  - [Test Tiers](#test-tiers)
  - [Environment Files](#environment-files)
  - [Running Tests](#running-tests)
  - [Test Database Setup](#test-database-setup)
  - [Tips](#tips)
- [Extending the Project](#extending-the-project)
  - [Adding an API Module (`apps/api`)](#adding-an-api-module-appsapi)
  - [Adding a Web Page / Feature (`apps/web`)](#adding-a-web-page--feature-appsweb)
  - [Adding a Bot Command (`apps/bot`)](#adding-a-bot-command-appsbot)
- [Development Workflow](#development-workflow)
  - [Branch Naming](#branch-naming)
  - [Commit Conventions](#commit-conventions)
  - [Quality Gates](#quality-gates)
  - [Useful Commands](#useful-commands)
  - [Script Naming Convention](#script-naming-convention)
  - [When To Move Scripts To Root](#when-to-move-scripts-to-root)
  - [Database Changes](#database-changes)
- [Pull Request Process](#pull-request-process)
  - [Contribution Flow](#contribution-flow)
  - [Lightweight Changes](#lightweight-changes)
  - [Merge Strategy](#merge-strategy)
- [Troubleshooting](#troubleshooting)
  - [Database is in a broken state / migrations fail](#database-is-in-a-broken-state--migrations-fail)
  - [Stale `node_modules`, lock files, or build output](#stale-node_modules-lock-files-or-build-output)
- [Questions?](#questions)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Project Overview

FinTrack is a monorepo managed by [Turborepo](https://turbo.build/).

- `apps/api`: Node.js/Express backend with Prisma.
- `apps/web`: Next.js/React frontend with Tailwind CSS.
- `apps/bot`: Telegram bot for quick transaction entry.
- `packages/types`: Shared TypeScript definitions and Zod schemas.

---

## Getting Started

**Prerequisites:** Node.js 22 (CI and Docker target; `engines` allows 18+), PostgreSQL 15, pnpm 10+, Docker & Docker Compose.

### 1. Preparation

Regardless of the installation method, start by setting up your environment variables:

```bash
git clone https://github.com/BODMAT/FinTrack.git
cd FinTrack

# Use the dx CLI to create all necessary .env files from examples
bash dx setup
# → Edit each apps/*/.env. In Docker, compose overrides the PostgreSQL/Redis/Mongo hosts.
```

### 2. Docker (Recommended)

The `dx` script is a project-agnostic Docker Executioner CLI that wraps `docker compose` commands. Run `bash dx help` to see all available commands.

#### Development Mode

Each service is accessible directly on its own port for easier debugging.

**Commands:**

- `bash dx run setup:dx` — **First-time setup:** start all containers + initialize both dev and test databases (migrate + seed).
- `bash dx dev` — Start all containers in detached mode (without DB initialization).
- `bash dx ps` — List containers with their current status and health (`init` service with `Exited` status is normal in dev mode).
- `bash dx logs` — Follow logs for all services (or `bash dx logs api` for a specific service).
- `bash dx api` — Open a shell inside the API container (shortcut for `bash dx shell api`).
- `bash dx run prisma:api:studio:dx` — Start Prisma Studio inside the API container.
- `bash dx run db:api:setup:dx` — Initialize dev database inside Docker (migrate + seed).
- `bash dx run db:api:test:setup:dx` — Initialize test database (`fintrack_test`) inside Docker.
- `bash dx run db:api:test:reset:dx` — Wipe and re-initialize the test database.
- `bash dx run test:api:dx` — Run all API tests inside Docker.
- `bash dx restart api` — Restart a service after changing its `.env` file.
- `bash dx down` — Stop and remove containers.

**Access Points:**

- **Web App:** http://localhost:5173/FinTrack
- **API:** http://localhost:8000/api
- **Swagger Docs:** http://localhost:8000/api-docs
- **Prisma Studio:** http://localhost:5555 (only after running `bash dx run prisma:api:studio:dx`)
- **pgAdmin:** http://localhost:5050 (Login: `admin@fintrack.dev` / `admin`)
  - _Setup:_ Right-click Servers → Register → Server.
  - _Connection:_ Host: `postgres`, Port: `5432`, Database: `fintrack`, Username: `fintrack`, Password: `fintrack`.

#### Production Mode

All services are proxied behind Nginx. Only port `8080` is exposed externally — Nginx routes requests to the appropriate service internally.

**Commands:**

- `bash dx pbuild` — Build all production images (required before first run).
- `bash dx prod` — Start the production stack.
- `bash dx plogs` — Follow production logs (or `bash dx plogs api` for a specific service).
- `bash dx pshell api` — Open a shell inside a running production container.
- `bash dx pdown` — Stop and remove production containers (requires confirmation).

**Access Points:**

- **Web App:** http://localhost:8080/FinTrack
- **API:** http://localhost:8080/api
- **Swagger Docs:** http://localhost:8080/api-docs
- _Prisma Studio and pgAdmin are disabled in production by default for security reasons._

### 3. Local Installation

For those who prefer running dependencies (Node, Postgres etc.) manually.

```bash
# Install dependencies
pnpm install

# Create both dev (fintrack) and test (fintrack_test) DBs, run migrations, and seed the dev DB
# (shared packages are built automatically when you run `pnpm run dev`)
pnpm run setup:local

# Start all apps via Turborepo
pnpm run dev
```

**Access Points:**

- **Web App:** http://localhost:5173/FinTrack
- **API:** http://localhost:8000/api
- **Swagger Docs:** http://localhost:8000/api-docs
- **Prisma Studio:** http://localhost:5555 (only after running `pnpm run prisma:api:studio`)
- **pgAdmin (locally installed app or via browser):**
  - **Desktop App:** Use your natively installed pgAdmin 4 application.
    - _Setup:_ Right-click Servers → Register → Server.
    - _Connection:_ Host: `localhost`, Port: `5432`, Database/Username/Password: (your local Postgres credentials).
  - **Web Interface (via Docker):** Run only the tool: `bash dx dev pgadmin`.
    - _Access:_ http://localhost:5050 (Login: `admin@fintrack.dev` / `admin`).
    - _Setup:_ Right-click Servers → Register → Server.
    - _Connection to local DB:_ Use Host: `host.docker.internal` (Win/Mac) or `172.17.0.1` (Linux).

---

## Environment Variables

`bash dx setup` copies all example files automatically. For manual setup:

| File                 | Example                      | Notes                                                                                                                                |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `.env` (repo root)   | `.env.example`               | Docker Compose build args — `NEXT_PUBLIC_TELEGRAM_BOT_ID`                                                                            |
| `apps/api/.env`      | `apps/api/.env.example`      | Dev + Docker — secrets; Docker hosts injected by compose                                                                             |
| `apps/api/.env.test` | `apps/api/.env.test.example` | Tests — `fintrack_test`; Docker hosts rewritten by `scripts/test-env.cjs`                                                            |
| `apps/web/.env`      | `apps/web/.env.example`      | Set `NEXT_PUBLIC_API_URL`, `NEXTAUTH_SECRET`, Google OAuth                                                                           |
| `apps/bot/.env`      | `apps/bot/.env.example`      | Dev + Docker — `TELEGRAM_BOT_TOKEN`; Docker hosts injected by compose. Prod values live on the VM (see README → Bot VM Deploy Setup) |

Each example file is split into REQUIRED (app won't boot without these) and
OPTIONAL (safe defaults + feature toggles) blocks; `apps/api/.env.example` adds a
REQUIRED IN PRODUCTION block (localhost defaults that must be overridden before
deploying) — read each file for per-variable details.

---

## Database Management

After applying migrations, you can populate your database using one of the following methods:

#### Option A: Automatic Setup (Fastest)

The easiest way to get a fully working environment with migrations applied and rich test data populated.

- **Docker:** `bash dx run db:api:setup:dx`
- **Local:** `pnpm run db:api:setup`

#### Option B: Reset & Refresh

Wipes the database schema and re-initializes it with fresh seed data. Useful for development resets.

- **Docker:** `bash dx run db:api:reset:dx`
- **Local:** `pnpm run db:api:reset`

#### Option C: Seed Data (Manual)

Best for a fresh install to get basic test accounts and system defaults.

- **Docker:** `bash dx run prisma:api:seed:dx`
- **Local:** `pnpm run prisma:api:seed`

#### Option D: Database Dump (Team sync)

Best for working with realistic data or sharing progress with the team.

**1. Create a Dump (Export)**
To share your data with a colleague:

- **Docker:** `bash dx run dump:db:dx`
- **Local:** `pnpm run dump:db`
- _The dump file will be created in the `dumps/db/` directory._

**2. Restore (Append Mode)**
Adds data from a `.sql` file in `dumps/db/` to your existing records without deleting anything.

- **Docker:** `bash dx run restore:db:dx`
- **Local:** `pnpm run restore:db`

**3. Restore (Wipe & Sync Mode)**
Clears your current schema and restores the dump exactly. Best for a full sync.

- **Docker:** `bash dx run restore:db:reset:dx`
- **Local:** `pnpm run restore:db:reset`

> **Note:** You can combine them! For example, run **Seed** to get admin users, then **Restore (Append)** a dump with specific transactions. If you use **Wipe & Sync**, it will remove any previously seeded data.

#### Option E: Test Database Management

The test database (`fintrack_test`) is separate from the dev DB and is used exclusively by automated tests. Tests are self-contained — they do not seed data; each test creates and cleans up its own records.

**Setup (first time or after a migration):**

- **Docker:** `bash dx run db:api:test:setup:dx`
- **Local:** `pnpm run db:api:test:setup`

**Full reset (wipe schema + re-run all migrations):**

- **Docker:** `bash dx run db:api:test:reset:dx`
- **Local:** `pnpm run db:api:test:reset`

> Run a reset whenever migrations change or tests leave the DB in a broken state.

---

## Running Individual Apps

### API

```bash
cd apps/api

cp .env.example .env
# fill in the REQUIRED block (DATABASE_URL, ACCESS_TOKEN_SECRET, GOOGLE_CLIENT_ID, TELEGRAM_BOT_TOKEN ...);
# OPTIONAL vars (GROQ_API_KEY_1, STRIPE_*, ...) gate features and can stay empty

pnpm run prisma:migrate:dev  # apply migrations
pnpm run prisma:seed         # optional seed data
pnpm run dev                 # tsc -w + nodemon
```

**Tests:**

```bash
pnpm run test:unit         # unit tests only (no DB, fast)
pnpm run test:integration  # integration tests (requires fintrack_test DB)
pnpm run test:light        # unit + integration (used by pre-push hook)
pnpm run test:stress       # stress / load tests
pnpm run test:e2e          # end-to-end tests
pnpm run test              # all test tiers
pnpm run test:watch        # watch mode (unit + integration)
```

Tests load `.env.test` automatically — no manual `NODE_ENV` export needed. Ensure `fintrack_test` exists first (`pnpm run db:api:test:setup` from the repo root).

### Web App

```bash
cd apps/web

cp .env.example .env
# set NEXT_PUBLIC_API_URL, NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXT_PUBLIC_TELEGRAM_BOT_ID

pnpm run dev    # http://localhost:5173/FinTrack
```

**Production (Docker):**

```bash
# from repo root
bash dx pbuild web   # build web image
bash dx prod web     # start web container
```

### Telegram Bot

```bash
cd apps/bot

cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN with your Telegram bot token (from @BotFather)
# fill in API_URL to point at the running API, and REDIS_URL

pnpm run dev   # tsc -w + nodemon dist/bot.js
```

**Production (Docker):**

```bash
# from repo root
bash dx pbuild bot   # build bot image
bash dx prod bot     # start bot container
```

### Shared Types Package

```bash
# build before running any app
pnpm --filter @fintrack/types build
```

---

## Testing

### Test Tiers

| Tier            | Script (app-level) | Root shortcut     | What it covers              | Needs DB              |
| --------------- | ------------------ | ----------------- | --------------------------- | --------------------- |
| **unit**        | `test:unit`        | —                 | Pure logic, no I/O          | No                    |
| **integration** | `test:integration` | —                 | HTTP handlers via Supertest | Yes (`fintrack_test`) |
| **light**       | `test:light`       | `test:api:light`  | unit + integration combined | Yes                   |
| **stress**      | `test:stress`      | `test:api:stress` | High-volume / concurrency   | Yes                   |
| **e2e**         | `test:e2e`         | `test:api:e2e`    | Full user flows             | Yes                   |
| **all**         | `test`             | `test:api`        | Every tier                  | Yes                   |

Every tier has a `:dx` variant that targets the Docker environment (e.g. `test:light:dx`, `test:api:light:dx`).

### Environment Files

| File                 | Used by                         | DB host                                                                        |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| `apps/api/.env.test` | local + Docker `test:*` scripts | `localhost`; `:dx` scripts rewrite it to `postgres` via `scripts/test-env.cjs` |

### Running Tests

**Local:**

```bash
# from repo root
pnpm run test:api:light        # unit + integration (quick feedback loop)
pnpm run test:api              # all tiers
pnpm run test:api:stress       # stress suite
pnpm run test:api:e2e          # e2e suite

# from apps/api
pnpm run test:unit
pnpm run test:integration
pnpm run test                  # all tiers
pnpm run test:watch            # watch mode
```

**Docker:**

```bash
bash dx run test:api:dx            # all API tests inside the container
bash dx run test:api:light:dx      # light tests inside the container
```

Or via root scripts:

```bash
bash dx run test:api:light:dx
bash dx run test:api:dx
```

### Test Database Setup

Tests require a dedicated `fintrack_test` database. `setup:local` / `setup:dx` create and migrate it automatically on first run.

If you need to (re-)initialize it manually:

```bash
# Local
pnpm run db:api:test:setup   # create + migrate
pnpm run db:api:test:reset   # wipe + create + migrate

# Docker
bash dx run db:api:test:setup:dx
bash dx run db:api:test:reset:dx
```

> Run `db:api:test:reset` after any schema migration or if tests leave the database in a broken state.

### Tips

- Tests are self-contained — each test creates and tears down its own data.
- API test files run one at a time (`fileParallelism: false` in `apps/api/vitest.config.ts`) because integration suites share one database.
- The pre-push hook runs type-check, web tests, and light API tests automatically — only stress and e2e need manual triggering.
- CI runs the full suite (`pnpm run test`) against a live PostgreSQL service.

---

## Extending the Project

### Adding an API Module (`apps/api`)

Each feature domain lives under `apps/api/src/modules/<name>/` and consists of three files:

```
apps/api/src/modules/<name>/
  service.ts     ← Prisma queries and business logic
  controller.ts  ← HTTP handlers: parse request, validate with Zod, call service, send response
  route.ts       ← Express Router: wire middleware (auth, rate-limit) + controllers
```

After creating the three files, register the router in `apps/api/src/routes/apiRoutes.ts`:

```ts
import { myRouter } from "../modules/<name>/route.js";
apiRouter.use("/<name>", myRouter);
```

If the module introduces new request/response shapes, add Zod schemas to `packages/types` first — both the API and the web app import from there.

If it requires a new database model, add it to `apps/api/prisma/schema.prisma` and run:

```bash
pnpm exec prisma migrate dev --name <name> # inside apps/api
```

---

### Adding a Web Page / Feature (`apps/web`)

Each protected page follows this structure:

```
apps/web/src/
  api/<name>.ts                               ← typed API functions (Axios + Zod via handleRequest)
  app/(protected)/<name>/
    page.tsx                                  ← async Server Component: prefetch + Suspense wrapper
    <Name>Client.tsx                          ← "use client": TanStack Query hooks + UI
    _components/                              ← page-scoped sub-components
  store/<name>.ts                             ← Zustand store (only if state is truly global)
```

**`src/api/<name>.ts`** — call `handleRequest(api.get/post/..., zodSchema)` for automatic validation:

```ts
import { handleRequest } from "@/utils/api";
import api from "./api";
import { myResponseSchema, type MyResponse } from "@fintrack/types";

export const getMyData = async (): Promise<MyResponse> =>
  handleRequest(api.get("/my-endpoint"), myResponseSchema);
```

**`page.tsx`** — async server component, wraps client in `<Suspense>`:

```tsx
import { Suspense } from "react";
import { MyClient } from "./MyClient";
import { prefetchProtected } from "@/lib/server/prefetchProtected";

export default async function MyPage() {
  const initialData = await prefetchProtected();
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <MyClient initialData={initialData} />
    </Suspense>
  );
}
```

**`MyClient.tsx`** — client component with TanStack Query:

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { getMyData } from "@/api/<name>";

export function MyClient({ initialData }: { initialData: … }) {
  const { data } = useQuery({ queryKey: ["my-data"], queryFn: getMyData });
  // render UI
}
```

---

### Adding a Bot Command (`apps/bot`)

The bot currently lives in a single file `apps/bot/src/bot.ts`. Add new commands directly there:

```ts
bot.command("mycommand", async (ctx) => {
  await ctx.reply("Hello from mycommand");
});
```

When the number of commands grows, extract handlers into separate files and import them into `bot.ts`.

---

## Development Workflow

### Branch Naming

This project uses [Conventional Branch](https://conventional-branch.github.io/):

```
<type>/<short-description>
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.

Examples:

- `feat/monobank-import`
- `fix/refresh-token-expiry`
- `chore/update-deps`

### Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.
Common scopes: `api`, `web`, `bot`, `types`, `ci`, `docker`.

Commit format:

- use a `scope` when the change clearly belongs to one app or area
- use repo-level scopes such as `api`, `web`, `bot`, `types`, `ci`, or
  `docker` for broad changes
- use narrower scopes only when they add real signal, and keep them
  consistent across the repo
- omit the `scope` only for very small or repo-wide changes
- `subject` must stay on one line
- use the imperative mood
- keep the subject short and specific
- keep the subject at or below 72 characters
- add a `body` only when the reason is not obvious, the change is large,
  or the commit changes behavior in a way that needs context
- mark breaking changes with `!` in the subject and a `BREAKING CHANGE:`
  note in the body when applicable

Body format:

- separate the body from the subject with one blank line
- explain `why`, not `what`
- use one or more paragraphs when needed
- wrap lines at about 72 characters
- keep the body concise and avoid filler
- use `BREAKING CHANGE:` to describe the migration impact when the
  change is not backwards compatible

List format in commit bodies:

- use a blank line before every list
- do not indent normal bullet lists
- start every bullet with `-`
- start every bullet with a lowercase letter
- when you use labels in a list, keep the `label: detail` pattern
  consistent across the whole list
- keep the bullet style consistent within the same commit message

Examples:

```text
feat(web): add dark mode toggle
```

```text
fix(api): revoke all sessions on password change

Previously only the current session was invalidated, leaving other
active sessions valid after a password reset. This left a security
gap for users who changed their password.
```

```text
feat(api)!: rename transaction status fields

Client integrations that read the transaction status payload must be
updated before deploying this change.

BREAKING CHANGE: the transaction status payload shape changed and
existing clients must be updated.
```

```text
test(api): add coverage for untested API paths

Add coverage for the main untested API flows:

- auth guards: 401 checks for protected endpoints
- authz: role and verification rules
- user and ai flows: happy paths and negative cases
```

### Quality Gates

| Gate           | Trigger                         | What runs                                                                                                                                                                          |
| -------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pre-commit** | `git commit`                    | If pnpm is available: `lint-staged`; otherwise Docker fallback: `bash dx run lint-staged`                                                                                          |
| **pre-push**   | `git push`                      | If pnpm is available: type-check + web tests + light API tests; otherwise Docker fallback: `bash dx run check-types` + `bash dx run test:web:dx` + `bash dx run test:api:light:dx` |
| **CI**         | PR / push to `master` or `main` | Full integration tests, security audit, Docker build                                                                                                                               |

> Integration tests (`pnpm run test`) require a live PostgreSQL instance — run them manually via `pnpm run test:api` when working on API changes, or let CI handle them.

### Useful Commands

- `pnpm run test:api:light` — Run unit + integration tests locally (fastest feedback loop).
- `pnpm run test:api` — Run all API test tiers locally.
- `bash dx run test:api:light:dx` — Run light tests inside Docker (same as pre-push hook).
- `pnpm run tidy` — Run ESLint and Prettier fixers.
- `pnpm run build` — Build all packages and apps.
- `pnpm run check-types` — Type-check all packages without emitting.
- `pnpm run db:api:reset` — Wipe and re-seed the dev database.
- `pnpm run db:api:test:reset` — Wipe and re-migrate the test database.
- `pnpm run reinstall` — Wipe `node_modules` and reinstall dependencies (`reinstall:dx` for Docker — preserves database volumes).
- `pnpm run reinstall:fresh` — Wipe `node_modules`, lock files, build output and reinstall (`reinstall:fresh:dx` for Docker).
- `pnpm run clean:dist` — Remove build output and lint/build caches only (`clean:dist:dx` for Docker).
- `pnpm run clean:locks` — Remove all lock files only (run `pnpm install` after to regenerate).

### Script Naming Convention

Use different patterns for **root** and **app-level** scripts:

1. **Root `package.json` (monorepo orchestration):**  
   `action:scope[:type][:env]`

2. **`apps/*/package.json` (local app scripts):**  
   `action[:type][:env]`

Where:

- `action`: operation (`test`, `db`, `prisma`, `dev`, `setup`)
- `scope`: target app/package (`api`, `web`, `bot`) — only for root scripts
- `type` (optional): subtype (`e2e`, `light`, `stress`, `migrate`, `clean`, `test`)
- `env` (optional): execution environment (`dx` for Docker)

Examples:

- Root: `test:api`, `test:api:e2e:dx`, `db:api:test:reset`, `prisma:api:seed`
- App-level (`apps/api`): `test`, `test:e2e`, `test:watch`, `prisma:migrate:deploy`

### When To Move Scripts To Root

Move a script from `apps/*` to root when at least one is true:

- It is run from CI/Husky as a standard repo entrypoint.
- It needs cross-app coordination (for example `api + web`, or `db + prisma + seed`).
- It requires environment switching (`local` vs `dx`) that should be uniform for contributors.
- It should be discoverable as a team-wide workflow (`setup`, `test`, `db reset`, `release checks`).

Keep a script only in `apps/*` when:

- It is purely app-internal and called mainly by developers working in that app.
- It is a low-level primitive used by root orchestration (`prisma:migrate:deploy`, `test:watch`, `dev`).

### Database Changes

1. Modify `apps/api/prisma/schema.prisma`.
2. Run `pnpm exec prisma migrate dev --name <migration_name>` in `apps/api`.
3. Update `packages/types` if data structures changed.

#### Migration Naming

Migration names use `snake_case` and follow the pattern:

```
<action>_<target>[_<detail>]
```

| Action   | When to use                          |
| -------- | ------------------------------------ |
| `create` | new table                            |
| `add`    | new column, index, or constraint     |
| `remove` | drop column, index, or table         |
| `rename` | rename a column or table             |
| `alter`  | change type, nullability, or default |
| `init`   | first / baseline migration           |

Examples:

```bash
pnpm exec prisma migrate dev --name init_schema
pnpm exec prisma migrate dev --name create_transactions_table
pnpm exec prisma migrate dev --name add_category_to_transactions
pnpm exec prisma migrate dev --name add_unique_email_to_users
pnpm exec prisma migrate dev --name add_index_on_transactions_user_id
pnpm exec prisma migrate dev --name remove_legacy_token_from_sessions
pnpm exec prisma migrate dev --name rename_amount_to_total_in_transactions
pnpm exec prisma migrate dev --name alter_balance_type_to_decimal
```

Prisma prepends a timestamp automatically — the name you provide becomes the human-readable suffix: `20240518143022_add_category_to_transactions`.

## Pull Request Process

### Contribution Flow

The standard cycle for any change — bug fix, feature, or chore. Small, low-risk changes can take a shorter path — see [Lightweight Changes](#lightweight-changes).

1. **Open an issue** using one of the templates in [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE/) — [`fix_request.md`](./.github/ISSUE_TEMPLATE/fix_request.md), [`feat_request.md`](./.github/ISSUE_TEMPLATE/feat_request.md), or [`chore_request.md`](./.github/ISSUE_TEMPLATE/chore_request.md). Keep the prefilled title prefix (`fix: `, `feat: `, `chore: `) and fill every section before writing any code.
2. **Create a branch** from `master` following the [Branch Naming](#branch-naming) convention. Optionally prefix with the issue number for traceability: `feat/42-csv-export`, `fix/17-refresh-token`.
3. **Make your changes** — commit incrementally following [Commit Conventions](#commit-conventions).
4. Quality checks run automatically — lint + format on `git commit`, type-check + web tests + light API tests on `git push`. See [Quality Gates](#quality-gates) for the full breakdown.
5. **Open a PR** targeting `master` — GitHub auto-loads [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md). Reuse the issue title verbatim, fill every section (Description, Type of change, How Has This Been Tested?, Checklist), and link the issue with `Closes #N` so GitHub auto-closes it on merge.
6. **After merge** — delete the branch.

### Lightweight Changes

The contribution flow scales to the **size and risk** of the change. Small, low-risk changes do not need a tracking issue, the full PR template, or a blocking approval — they are still opened as a PR and still run through CI; only the tracking issue, the long template, and the required review are dropped.

**Lightweight flow** (no issue, short PR description) — use it when _all_ of these hold:

- the change is self-contained and reviewable at a glance
- it does not change behavior in a non-obvious way
- it does not touch the database schema / migrations, a public API contract, or security-sensitive code
- it is a fix, docs, config, or chore — not a new feature or module

Examples: a typo or docs edit, a config tweak, a dependency bump, a one-file bug fix.

**Merging a lightweight PR** — once CI is green, the author may merge their own PR without waiting for an approval. Review is welcome but not blocking: a reviewer can comment before or after merge, and anything they flag is fixed in a follow-up. This keeps trivial work from stalling on a second pair of eyes it does not need. A **full-flow** PR still needs a reviewer's approval before merge.

**Full flow** (issue + full [`PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md)) — use it when _any_ of these hold:

- a new feature or module
- a behavior or contract change, a database migration, or anything security-related
- a breaking change
- anything that benefits from design discussion before coding

> Commit count is a rough hint, not the rule — branches are squash-merged, so they collapse to a single commit in `master` regardless of how many you made. Gate on **scope and risk**, not on commit count. **When in doubt, use the full flow**, and a reviewer can always ask to promote a lightweight PR to the full process.

Which path applies is enforced automatically by [`.github/CODEOWNERS`](./.github/CODEOWNERS): it lists the sensitive paths — database schema and migrations, any `.env*.example`, auth and middleware code, `packages/types`, CI workflows, and deploy config. A PR that touches any of them needs an owner's approval before it can merge; a PR that touches none can be self-merged once CI is green. (Branch protection: `0` baseline approvals + **Require review from Code Owners**.)

The PR template carries this short form in a comment at the top — for a
lightweight PR, delete the full template and use that **What / Why / Testing**
form instead.

### Merge Strategy

**PRs into `master`** are merged via **squash commit** — all branch commits collapse into one, keeping the main history clean and linear.

**Stacked branches** (a branch based off another feature branch, not `master`) are merged into their parent via a regular **merge commit** to preserve the intermediate history:

```
master
  └── feat/payment-system        ← squash-merged into master when ready
        └── feat/payment-webhook ← regular-merged into feat/payment-system
```

Once the parent branch is squash-merged into `master`, rebase any surviving child branches onto `master` before continuing.

**Delete branches after merging** — once a branch is merged into `master`, delete it to keep the repository clean. GitHub preserves all deleted branches and their commits, so they can be restored at any time if needed.

## Troubleshooting

### Database is in a broken state / migrations fail

Drop everything and rebuild from scratch:

**Local:**

```bash
pnpm run db:api:drop:all   # drops fintrack + fintrack_test DBs and the fintrack role
pnpm run setup:local       # recreates both DBs, runs migrations, seeds dev DB
```

**Docker:**

```bash
bash dx downv              # stop and remove all containers and volumes
bash dx run setup:dx       # start containers + initialize both DBs
```

### Stale `node_modules`, lock files, or build output

`scripts/clean.sh` (wired into `package.json`) wipes any combination of
`node_modules` / lock files / build output across the whole monorepo. Local
variants prompt for confirmation; `:dx` variants skip confirmation (`-y`) and
target the Docker environment — run them via `bash dx run <script>` or
`pnpm run <script>`.

**Common workflows:**

```bash
# Reinstall after a dependency or package-manager change
pnpm run reinstall              # wipe node_modules + pnpm install (host)
bash dx run reinstall:dx        # same, Docker (stops containers, wipes node_modules volumes, restarts)

# Fresh reinstall — wipe lock files and build output too
pnpm run reinstall:fresh        # host
bash dx run reinstall:fresh:dx  # Docker

# Clear only build output and lint/build caches
pnpm run clean:dist             # host
bash dx run clean:dist:dx       # Docker runner

# Remove lock files and regenerate
pnpm run clean:locks && pnpm install                     # host
bash dx run clean:locks:dx && bash dx exec pnpm install  # Docker
```

> **Note (Docker):** `node_modules` directories are Docker named volumes — they cannot be removed via `rm`, so there is no `clean:modules:dx`. Use `reinstall:dx` instead: stops containers, removes `node_modules` volumes via the Docker API, restarts. Database volumes (`postgres_data`, `pgadmin_data`) are preserved.

Run `bash scripts/clean.sh --help` for the full flag reference and list of `--dist` targets.

---

## Questions?

Reach out via [fintrack.community@gmail.com](mailto:fintrack.community@gmail.com).
