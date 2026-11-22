# MERVO

**Intelligent business management and AI-powered point of sale.** MERVO is a multi-tenant SaaS platform for retail, restaurants and service businesses: a fast POS that keeps selling offline, a double-entry ledger behind every transaction, and an AI assistant that answers questions with figures computed from your own data.

- Landing page, pricing and public storefronts
- POS with barcode/QR scanning, variants, split payments, refunds, suspended sales, printable receipts, offline queue with idempotency
- Inventory with weighted-average costing, transfers, purchase orders, low-stock alerts, shrinkage signals and restock recommendations
- Double-entry finance: journal, trial balance, P&L, balance sheet, cash flow, expenses, receivables/payables
- CRM with segments, credit limits and loyalty history
- Employees, shifts, attendance, leave and payroll
- Restaurant floor plan, kitchen display, menu and reservations
- E-commerce storefront that shares real stock and creates real sales
- Automation engine with templates, approvals and run history
- Subscription plans with signed payment-gateway webhooks
- Super-admin console for workspaces, plans, AI providers, jobs and support

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router, React 19, Server Actions) |
| Language | TypeScript 5.9, strict |
| Styling | Tailwind CSS 3.4, CSS-variable theming (light/dark) |
| Data | PostgreSQL via Drizzle ORM; embedded PGlite for local/CI when `DATABASE_URL` is absent |
| Auth | scrypt password hashing, opaque hashed session cookies, TOTP MFA, granular permissions |
| Jobs | Postgres-backed queue (`FOR UPDATE SKIP LOCKED`), worker process or cron drain |
| AI | Provider adapter (Agnes AI, OpenAI, Hugging Face, custom OpenAI-compatible) with encrypted keys and deterministic SQL tool calling |
| Tests | Vitest against a real embedded Postgres |

## Getting started

```bash
npm install
cp .env.example .env        # set AUTH_SECRET and ENCRYPTION_KEY at minimum
npm run db:seed             # plans, settings, AI providers, roles, super admin, demo workspace
npm run dev                 # http://localhost:3000
npm run worker              # optional: background jobs (separate terminal)
```

Without `DATABASE_URL`, MERVO starts an embedded PGlite database under `.data/` so the whole product runs with no external services. Set `DATABASE_URL` (and optionally `DIRECT_URL`) to point at real Postgres for production.

### Demo credentials (seed only — never enable demo seeding in production)

| Role | Email | Password |
| --- | --- | --- |
| Owner | `owner@mervo.app` | `MervoDemo#2025` |
| Manager | `manager@mervo.app` | `MervoManager#2025` |
| Cashier | `cashier@mervo.app` | `MervoCashier#2025` |
| Super admin | `admin@mervo.app` | `MervoAdmin#2025` |

The demo workspace ("Mervo Demo Mart") ships with two branches and ~45 days of sales, stock and ledger history.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server on `0.0.0.0:3000` |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint (`next lint`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest suite (real embedded Postgres per process) |
| `npm run verify` | typecheck + tests + production build |
| `npm run db:generate` | Generate a versioned Drizzle migration |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Idempotent platform seed (+ demo workspace with `MERVO_SEED_CLI=1`) |
| `npm run worker` | Long-lived job worker (never on serverless) |

## Architecture

```
src/
  app/
    (auth)/            login, register, forgot/reset password, verify email (+ server actions)
    (app)/             authenticated shell: dashboard, pos, sales, products, inventory,
                       customers, suppliers, finance, reports, employees, restaurant,
                       ai, automation, settings/*, onboarding
    (admin)/admin/     super-admin console: overview, tenants, plans, ai, jobs, support
    api/               pos/sales, pos/sync, ai/chat, reports/export, health, cron/run,
                       webhooks/[gateway], store/[slug]/order, admin/ai/test,
                       super-admin/overview
    receipt/[id]/      public, shareable receipt (UUID acts as verification token)
    store/[slug]/      public storefront
    pricing/           public plan comparison
  components/          design system, shell, POS terminal, AI chat, storefront, charts
  server/
    auth/              permissions, session core, session helpers
    ai/                providers, tools, agent, insights
    db/                schema, driver, migrations, seed, bootstrap
    jobs/              queue, handlers, worker
    lib/               money (BigInt minor units), crypto, rate limit, validation, http
    payments/          gateway adapters + webhook verification
    services/          sales, inventory, finance, reports, crm, employees,
                       restaurant, automation, subscriptions, tenants
    actions/           server actions (catalog, sales, crm, team, ops, platform, onboarding)
drizzle/               versioned SQL migrations (initial schema + ledger integrity)
tests/                 money, pricing, auth, sales, inventory, tenancy, ai, subscriptions
```

### Money and ledgers

Amounts are `numeric(18,2)` decimal strings, computed with BigInt minor units — no floating point touches money. Quantities are 3dp. Every sale, refund, purchase, expense and payroll approval posts a balanced journal entry; journal lines, stock movements and audit events are protected by database triggers that reject `UPDATE`/`DELETE`, so corrections are posted as compensating entries instead of edits.

### Multi-tenancy and security

- Every tenant-owned table carries `tenant_id`; queries are scoped explicitly and Postgres row-level security is installed by migration.
- Sessions use opaque random tokens stored as SHA-256 hashes in `HttpOnly`, `SameSite=Lax` cookies; server actions and API routes re-check permissions against the database.
- Roles (owner, admin, manager, cashier, accountant, inventory manager, waiter, chef, HR, support, auditor) carry granular permission strings; the UI hides what the server would reject anyway.
- MFA is TOTP-based; secrets and AI provider keys are encrypted with AES-256-GCM (`ENCRYPTION_KEY`).
- Login attempts are rate-limited with lockout, webhooks are signature-verified and de-duplicated by provider event id, and privileged actions write to an append-only audit log.

### AI that cannot invent numbers

`askMervo` routes a question to a provider adapter, but every figure it can speak comes back from a tenant-scoped SQL tool:

`get_sales_summary`, `get_profit_summary`, `get_inventory_status`, `get_top_products`, `get_customer_insights`, `get_branch_performance`, `get_expense_summary`, `forecast_sales`, `recommend_restock`, `generate_business_report` (plus product, customer, employee and restaurant lookups).

Each result is tagged `actual`, `estimate` or `recommendation`. Forecasts use ordinary least squares plus a weekday seasonal index and are always labelled estimates. Without an API key the assistant runs in deterministic mode: answers are still computed from real data, just not narrated by a model. Model choice lives in the database and is managed from the super-admin console — nothing is hardcoded.

## Deployment (Vercel)

1. Create a Postgres database (Neon, Supabase, RDS…) and set `DATABASE_URL` (pooled) and `DIRECT_URL` (direct) on the project.
2. Set `APP_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, and any provider keys (`AGNES_API_KEY`, `OPENAI_API_KEY`, `HF_TOKEN`, `PAYSTACK_*`, `FLUTTERWAVE_*`, `STRIPE_*`).
3. Set `CRON_SECRET` and keep `vercel.json`'s cron entry (`/api/cron/run`; daily on Vercel Hobby, tighten it on Pro) — serverless cannot host the persistent worker.
4. Run `npm run db:migrate` once against the production database, then optionally `npm run db:seed` with `SEED_DEMO=0`.
5. Deploy the `main` branch. Health check: `GET /api/health`.

Embedded PGlite is for local development and CI only: on Vercel the filesystem is ephemeral, so production **must** set `DATABASE_URL`.

## Testing

```bash
npm run typecheck
npm test          # 8 files, 79 tests, real embedded Postgres
npm run build
```

Coverage includes decimal money maths, tax-inclusive/exclusive cart totals, auth and permission boundaries, sale posting with stock and journal assertions, refunds and immutability, inventory valuation and transfers, tenant isolation, AI tool scoping and plan limits/webhook idempotency.

## Brand

MERVO is always written M-E-R-V-O. Black and white primary surfaces, charcoal `#101418`, dark surface `#171E24`, neon green `#39FF14` for highlights, secondary green `#20B26B` for actions, light `#F6F8F7` for backgrounds. No purple, no gradients.

## Known limitations

- Payment gateways are integrated and signature-ready, but live collection requires merchant credentials and a public webhook URL.
- Email delivery (verification, invitations, digests) writes to the platform log until an SMTP/Resend key is configured.
- Product images and storefront banners expect Cloudinary credentials; the UI falls back to a typographic placeholder.
- PGlite is single-process: use real Postgres whenever more than one instance runs.
