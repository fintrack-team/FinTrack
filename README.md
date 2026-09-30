# FinTrack <!-- omit in toc -->

> **Personal Finance Tracker** — a full-stack monorepo for tracking income and expenses, with AI-powered analytics, Monobank integration, multi-currency support, and a donation system.

[![CI](https://github.com/BODMAT/FinTrack/actions/workflows/ci.yml/badge.svg)](https://github.com/BODMAT/FinTrack/actions)
[![Docker Images](https://img.shields.io/badge/GHCR-Images-blue?logo=docker)](https://github.com/BODMAT/FinTrack/packages)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-22-green)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)

---

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Overview](#overview)
- [Screenshots](#screenshots)
- [Tech Stack](#tech-stack)
  - [Backend (`apps/api`)](#backend-appsapi)
  - [Frontend (`apps/web`)](#frontend-appsweb)
  - [Telegram Bot (`apps/bot`)](#telegram-bot-appsbot)
  - [Monorepo](#monorepo)
- [Getting Started](#getting-started)
- [Backend](#backend)
  - [Backend Architecture](#backend-architecture)
  - [Database Schema](#database-schema)
  - [API Modules](#api-modules)
  - [Security](#security)
- [Frontend](#frontend)
  - [Frontend Architecture](#frontend-architecture)
  - [Pages & Features](#pages--features)
  - [State Management](#state-management)
- [Deployment Topology](#deployment-topology)
- [CI/CD](#cicd)
  - [Auto Migration Secrets (GitHub)](#auto-migration-secrets-github)
  - [Web Vercel Deploy Setup](#web-vercel-deploy-setup)
  - [Bot VM Deploy Setup](#bot-vm-deploy-setup)
  - [Docker Images (GHCR)](#docker-images-ghcr)
- [License](#license)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

---

## Overview

FinTrack is a monorepo (Turborepo) personal finance application that allows users to manually track transactions or import them directly from **Monobank** via its public API. The app provides a visual dashboard, AI-powered financial analysis using LLM models (Groq / Gemini), a donation leaderboard backed by **Stripe**, and a full admin panel for user and error management.

**Core capabilities:**

- Manual transaction management (CRUD) with location tagging (Leaflet map)
- Monobank read-only integration — fetch accounts and import statement transactions
- AI chat analytics powered by Groq / Gemini with user-provided API key support
- Multi-currency support: USD, UAH, EUR
- Dashboard with income/expense summaries and interactive charts
- Google OAuth + email/password authentication with session hardening
- Internationalization: English, Ukrainian, German
- Admin panel — user management, error log review, system stats
- Donation system with Stripe Checkout and public leaderboard
- Dark / light theme, fully responsive

---

## Screenshots

| Dashboard                               | Transactions                                  | Analytics                               |
| --------------------------------------- | --------------------------------------------- | --------------------------------------- |
| ![Dashboard](screenshots/dashboard.png) | ![Transactions](screenshots/transactions.png) | ![Analytics](screenshots/analytics.png) |

| Monobank Import                              | Admin Panel                           | Donation                              |
| -------------------------------------------- | ------------------------------------- | ------------------------------------- |
| ![Monobank Import](screenshots/monobank.png) | ![Admin Panel](screenshots/admin.png) | ![Donation](screenshots/donation.png) |

---

## Tech Stack

### Backend (`apps/api`)

| Layer      | Technology                                             |
| ---------- | ------------------------------------------------------ |
| Runtime    | Node.js 22, TypeScript 5.9                             |
| Framework  | Express 4                                              |
| ORM / DB   | Prisma 6 + PostgreSQL 15                               |
| Auth       | JWT (access + session tokens), bcrypt, Google OAuth    |
| Validation | Zod 4                                                  |
| AI         | OpenAI SDK (`openai`) → Groq & Gemini compatible       |
| Payments   | Stripe                                                 |
| Docs       | Swagger / OpenAPI (swagger-jsdoc + swagger-ui-express) |
| Testing    | Vitest + Supertest (integration tests)                 |
| Security   | Helmet, CORS, CSRF middleware, express-rate-limit      |

### Frontend (`apps/web`)

| Layer          | Technology                                        |
| -------------- | ------------------------------------------------- |
| Framework      | Next.js 16 (App Router), React 19, TypeScript 5.8 |
| Styling        | Tailwind CSS 4                                    |
| State          | Zustand 5                                         |
| Server state   | TanStack Query 5                                  |
| Auth bridge    | NextAuth 4 + `@auth/prisma-adapter`               |
| Charts         | Chart.js 4 + react-chartjs-2                      |
| Maps           | Leaflet + react-leaflet                           |
| Animations     | Framer Motion 12                                  |
| i18n           | i18next + react-i18next (EN / UK / DE)            |
| Forms / select | react-select 5                                    |
| HTTP client    | Axios 1.16                                        |
| Testing        | Vitest 4 + Testing Library                        |

### Telegram Bot (`apps/bot`)

| Layer     | Technology                  |
| --------- | --------------------------- |
| Runtime   | Node.js 22, TypeScript 5.9  |
| Framework | Grammy 1 (Telegram Bot API) |
| Config    | dotenv                      |

### Monorepo

| Tool                | Purpose                                   |
| ------------------- | ----------------------------------------- |
| pnpm 10             | Package manager with workspace support    |
| Turborepo 2         | Task orchestration and pipeline caching   |
| `dx` (CLI)          | Project-agnostic Docker Executioner       |
| `packages/types`    | Shared Zod schemas and TypeScript types   |
| Husky + lint-staged | Pre-commit hooks                          |
| Prettier + ESLint   | Formatting and linting                    |
| Docker              | Production & Development containerization |
| GitHub Actions      | CI/CD pipeline + GHCR + Trivy Scan        |

---

## Getting Started

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full setup guide, environment variables, and development workflow.

---

## Backend

### Backend Architecture

The API follows a **module-based architecture** — each feature domain (`auth`, `transaction`, `ai`, `user`, `summary`, `donation`, `admin`, `user-api-key`) exposes its own `controller.ts`, `service.ts`, and `route.ts`. Business logic lives in services; controllers handle HTTP and delegate to services; routes wire up middleware and controllers. Monobank integration is not a separate module — it lives inside the `transaction` module and is exposed under the `/transactions/monobank/*` sub-route.

All incoming request bodies and query parameters are validated with **Zod** schemas sourced from the shared `packages/types` package, keeping the frontend and backend in sync.

### Database Schema

The database uses **PostgreSQL 15** managed via Prisma migrations. Key models:

| Model                    | Description                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `User`                   | Core user profile; roles: `USER`, `ADMIN`; `isVerified` flag                                     |
| `AuthMethod`             | Polymorphic auth: `EMAIL`, `TELEGRAM`, `GOOGLE` per user                                         |
| `EmailVerificationToken` | Short-lived token for email address verification; hashed at rest, auto-expires                   |
| `Session`                | Hardened session store with token hash, family ID, IP, user-agent, revocation                    |
| `Transaction`            | Income/expense record; supports `MANUAL` and `MONOBANK` sources; currencies: `USD`, `UAH`, `EUR` |
| `Location`               | Optional lat/lng attached to a transaction (1:1)                                                 |
| `Message`                | AI conversation history per user                                                                 |
| `UserApiKey`             | Encrypted user-provided API keys for `GROQ` or `GEMINI`                                          |
| `ErrorLog`               | Client-reported errors; admin-reviewable with `OPEN` / `RESOLVED` status                         |
| `DonationPayment`        | Stripe payment records: `PENDING`, `SUCCEEDED`, `CANCELED`, `FAILED`                             |
| `StripeWebhookEvent`     | Idempotency log for processed Stripe webhook events; deduplicates replays via unique event ID    |

### API Modules

| Module                   | Route prefix               | Highlights                                                                         |
| ------------------------ | -------------------------- | ---------------------------------------------------------------------------------- |
| `auth`                   | `/auth`                    | Login, register, token refresh, Google OAuth exchange, logout, session list/revoke |
| `user`                   | `/users`                   | Get/update/delete profile, manage auth methods                                     |
| `user-api-key`           | `/user-api-keys`           | CRUD for user AI provider keys (AES-encrypted at rest)                             |
| `transaction`            | `/transactions`            | Full CRUD with pagination, search, date range filtering                            |
| `transaction (monobank)` | `/transactions/monobank/*` | Fetch accounts, preview transactions, import, delete imported                      |
| `summary`                | `/summary`                 | Aggregated totals and chart time-series data                                       |
| `ai`                     | `/ai`                      | Send prompt + transaction data to LLM, retrieve history, check limits              |
| `donation`               | `/donations`               | Create Stripe Checkout session, webhook handler, leaderboard                       |
| `admin`                  | `/admin`                   | User list, role update, session revocation, error log management, stats            |

Interactive Swagger docs are served at `/api-docs` automatically in dev and test; in production they are exposed only when `ENABLE_SWAGGER_IN_PROD=true`.

### Security

- **Session hardening** — sessions store a bcrypt-hashed token, family ID for rotation detection, IP, user-agent, and a `revokedAt` timestamp.
- **CSRF middleware** on all state-mutating routes.
- **Rate limiting** via `express-rate-limit`, configurable per route group.
- **Helmet** for HTTP security headers.
- **API key encryption** — user AI provider keys stored AES-encrypted (`utils/crypto.ts`).
- **CORS** restricted to configured origins via `CORS_ORIGINS` env var.
- **Role-based access** — `ADMIN` role gates the `/admin` namespace via `authz` middleware.

---

## Frontend

### Frontend Architecture

The web app uses **Next.js 16 App Router** with a clear separation between server components (data prefetching via `lib/server/prefetchProtected.ts`) and client components. All protected routes are nested under the `app/(protected)/` route group and gated by `ProtectedClientGate`.

API communication is split into typed modules under `src/api/` (one file per domain), all built on a shared Axios instance (`api.ts`) with a 401-interceptor for transparent token refresh. Every response is validated against Zod schemas from `@fintrack/types`.

### Pages & Features

#### Dashboard (`/dashboard`)

- Summary cards: total balance, income, expenses, savings
- Income vs. expense chart (Chart.js) with animated transitions
- Period selector: week / month / year / custom range
- Source filter: all / manual / Monobank

#### Transactions (`/transactions`)

- Paginated, searchable transaction list
- Add / edit / delete via popup forms with full validation
- Location picker (Leaflet map) for geo-tagging a transaction
- Multi-currency: USD, UAH, EUR
- Monobank-sourced transactions displayed with source badge

#### Monobank Integration (`/monobank`)

- Token input with validation (minimum 20 characters)
- Account selector popup (masked PAN, type, ISO currency code)
- Preview fetched transactions before importing
- Import selected transactions into the user account
- Statistics overview and per-account stored transaction list
- Cooldown timer that respects Monobank API rate limits

#### Analytics (`/analytics`)

- AI chat panel — sends transaction data + free-text prompt to LLM
- Model selector (Groq llama-3.1-8b-instant and others)
- Typing text animation for streamed responses
- History list of previous AI conversations
- Custom API key management popup (Groq / Gemini)
- Usage indicator and donor-unlocked elevated limits

#### Donation (`/donation`)

- Stripe Checkout integration for one-time or permanent support
- Donation result popup (success / cancel states)
- Public leaderboard showing donor names and contribution totals

#### Admin Panel (`/admin`) — `ADMIN` role only

- Overview stats: users, admins, verified accounts, active sessions, open errors
- Insight charts for growth and activity trends
- User table with role toggle and session revocation per user
- Error log table: filter by `OPEN` / `RESOLVED`, resolve with admin notes

### State Management

| Zustand store      | Responsibility                                       |
| ------------------ | ---------------------------------------------------- |
| `useAuthStore`     | Authenticated user object and `isAuthenticated` flag |
| `theme`            | Light / dark theme preference                        |
| `period`           | Global date range used by dashboard and summary      |
| `popup`            | Global popup open/close state                        |
| `burger`           | Mobile navigation menu state                         |
| `monobankCooldown` | Monobank fetch cooldown countdown                    |

TanStack Query manages all server state with `staleTime: 5 min` and `gcTime: 30 min`. Mutations trigger targeted query invalidations.

---

## Deployment Topology

Production deployment flow:

- **Vercel** -> `apps/web` (Next.js)
- **Render** -> `apps/api` (Express + Prisma)
- **Supabase** -> PostgreSQL
- **Oracle Cloud VM** -> `apps/bot` (Telegram bot — `VM.Standard.E2.1.Micro`, Docker container)

The web app is deployed to Vercel with the **Root Directory** set to `apps/web` (Next.js + Turborepo are auto-detected, so there are no build or output overrides). The `/FinTrack` basePath redirects and the NextAuth path rewrite live in [`apps/web/next.config.ts`](./apps/web/next.config.ts), so they apply identically on Vercel and on the Docker self-host build. Project settings and env vars live in the Vercel dashboard — see [Web Vercel Deploy Setup](#web-vercel-deploy-setup).

The API is deployed to Render via the [`render.yaml`](./render.yaml) Blueprint (Render → New → Blueprint → select repo). It builds `apps/api/Dockerfile`, auto-deploys on `master`, and health-checks `/api/health`. All secrets are declared `sync: false` — set their values in the Render dashboard (Environment tab), never in the file.

The bot is deployed by the `deploy-bot` job in [`release.yml`](./.github/workflows/release.yml): after images build and scan, it SSHes into the VM, pulls `ghcr.io/fintrack-team/fintrack-bot:latest`, and recreates the `fintrack-bot` container (`--restart unless-stopped`, `--env-file ~/bot.env`). This replaces a Watchtower polling setup with a push-based deploy gated on a green build. One-time VM setup is required — see [Bot VM Deploy Setup](#bot-vm-deploy-setup).

Database migrations are applied automatically from GitHub Actions on pushes to `master` when Prisma schema or migrations change.

---

## CI/CD

GitHub Actions runs the following checks on every pull request and push to `master`/`main`:

1.  **Migration Drift** — non-blocking check that `schema.prisma` matches migrations (advisory).
2.  **Format & Lint** — `prettier`, `eslint`, and ToC freshness check.
3.  **Type check** — `tsc --noEmit` across the monorepo.
4.  **Security Audit** — `pnpm audit` and dependency review.
5.  **Tests** — Vitest + Supertest API tests and Vitest web and bot tests against a real PostgreSQL container.
6.  **Release Gate** — on push to `master`/`main`, `gate.yml` listens for CI completion and dispatches `release.yml` only when CI succeeds; if CI fails, dispatch is skipped and a failure is logged.
7.  **Release Workflow (`release.yml`)** — also triggers directly on push/PR to `master`/`main`; builds and (on push) publishes images to **GHCR**.
8.  **Security Scanning** — **Trivy** scans every Docker image for vulnerabilities (CRITICAL, HIGH).
9.  **CodeQL Analysis** — static analysis of JavaScript/TypeScript on every PR and push, plus a weekly scheduled scan.
10. **Prisma Auto-Migrate (`master`)** — applies `apps/api` migrations to Supabase after schema/migration changes.

### Auto Migration Secrets (GitHub)

1. Open GitHub repository -> `Settings` -> `Secrets and variables` -> `Actions`.
2. Add secret `SUPABASE_DATABASE_URL` (pooled connection string for app/runtime).
3. Add secret `SUPABASE_DIRECT_URL` (direct connection string for Prisma Migrate).
4. Push migration changes to `master` and verify workflow `Prisma Migrate Deploy (master)` in Actions tab.

### Web Vercel Deploy Setup

The web app deploys to Vercel from the repo. Unlike `render.yaml`, Vercel has no committed Blueprint — project settings and secrets live in the dashboard (or `vercel env`):

1. **Import the repo** (Vercel → Add New → Project). Set the **Root Directory** to `apps/web`; Vercel auto-detects Next.js and Turborepo and builds the app — leave the Build, Output, and Install commands on their defaults (no overrides).
2. **Set the env vars** from [`apps/web/.env.example`](./apps/web/.env.example) in the dashboard (Project → Settings → Environment Variables), with production values: point `NEXT_PUBLIC_API_URL` at the deployed Render API, set `NEXT_PUBLIC_SITE_ORIGIN` and `NEXTAUTH_URL` to the deployed web origin (`NEXTAUTH_URL` keeps the `/FinTrack` basePath: `<web-origin>/FinTrack/api/auth`).
3. **Align the API side**: add the deployed web origin to `CORS_ORIGINS` and set `FRONTEND_URL` in the Render dashboard, or browser requests and OAuth redirects break.

The app is served under the `/FinTrack` basePath (`next.config.ts`), which also redirects `/` → `/FinTrack` and rewrites the NextAuth path accordingly.

### Bot VM Deploy Setup

One-time provisioning of the Oracle `VM.Standard.E2.1.Micro` instance (x86_64) that runs the bot:

1. **Install Docker** on the VM and confirm the deploy user can run it without `sudo` (`sudo usermod -aG docker $USER`, then re-login).
2. **Create `~/bot.env`** in the deploy user's home from [`apps/bot/.env.example`](./apps/bot/.env.example), with production values: `API_URL` → deployed Render API, `REDIS_URL` → managed Redis (e.g. Upstash), `NODE_ENV=production` (and the production `TELEGRAM_BOT_TOKEN`).
3. **Generate an SSH key pair** for CI and add the public key to `~/.ssh/authorized_keys` on the VM.
4. **Add GitHub Actions secrets** (`Settings` -> `Secrets and variables` -> `Actions`):
   - `VM_HOST` — VM public IP / hostname.
   - `VM_USER` — deploy username.
   - `VM_SSH_KEY` — the private key from step 3.
5. **Open the Oracle security list / VM firewall** for outbound 443 (GHCR pull, Telegram, API). The bot is long-poll — no inbound port needed.

> The VM pulls the private GHCR image using the workflow's built-in `GITHUB_TOKEN` (auto-generated per run, scoped to `packages: read`, and revoked when the job ends — you neither create nor store it). The deploy script logs out of GHCR immediately after pulling.

After setup, every successful push to `master` recreates `fintrack-bot` automatically. To verify a deploy: `docker ps` and `docker logs --tail 50 fintrack-bot` on the VM.

**Granting operator access.** SSH is keyed per public key — `~/.ssh/authorized_keys` holds one line per operator. To give a team member shell access for logs/ops, have them generate their own key pair (`ssh-keygen -t ed25519`) and send you the **public** half only; append it to `authorized_keys` (`chmod 700 ~/.ssh`, `chmod 600 ~/.ssh/authorized_keys`). Each person uses their own key — never share a private key, and keep the CI deploy key (step 3) separate from personal keys so it can be rotated independently.

### Docker Images (GHCR)

| Component | Image Path                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------- |
| **API**   | [`ghcr.io/bodmat/fintrack-api`](https://github.com/BODMAT/FinTrack/pkgs/container/fintrack-api) |
| **Web**   | [`ghcr.io/bodmat/fintrack-web`](https://github.com/BODMAT/FinTrack/pkgs/container/fintrack-web) |
| **Bot**   | [`ghcr.io/bodmat/fintrack-bot`](https://github.com/BODMAT/FinTrack/pkgs/container/fintrack-bot) |

See [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) for the full configuration.

---

## License

[MIT](./LICENSE) © Makar Dzhehur, Bohdan Matula
