# Release Runbook

## Goal

Ship only when worker, schema, auth, smoke, and Pages are aligned.

## Preconditions

1. `staging` and `production` must have separate D1 databases.
2. `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_API_URL`, Stripe secrets, and smoke tokens must exist in the target environment.
3. `UPLOAD_BINARY_STORAGE` stays `disabled` in this release train.
4. Production must set `CLERK_ISSUER_URL`, `CLERK_ALLOWED_AZP`, and `CLERK_JWKS_URL`.
5. Production smoke must have `SMARTFINANCE_BEARER_TOKEN`; missing token is a failed release.

## Required GitHub secrets and vars

- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_CLERK_PUBLISHABLE_KEY`, `SMARTFINANCE_BEARER_TOKEN`, optional Stripe secrets.
- Vars: `SMARTFINANCE_API_URL`, `SMARTFINANCE_WEB_URL`, `VITE_API_URL`, `PAGES_PROJECT_NAME`, optional staging URLs.
- Never commit `.env`, `.auth`, `.wrangler`, Playwright reports, screenshots, or bearer tokens.

## Manual release flow

1. Run `corepack pnpm check`
2. Run `corepack pnpm test:e2e`
3. Apply D1 migrations to the target environment
4. Deploy the Worker with `--keep-vars`
5. Build the web with the target `VITE_API_URL` and Clerk key
6. Deploy Pages
7. Run `corepack pnpm smoke:deploy`; prod requires an authenticated bearer token
8. Run `corepack pnpm test:e2e:staging` with the target URLs and bearer token
9. Verify `/api/health` and `/api/system/schema`
10. Verify login, onboarding, upload, and dashboard on the deployed web

## Commercial release checks

1. Stripe checkout opens correctly
2. Stripe portal opens correctly
3. Stripe webhook replay updates `subscription` and `usage`
4. `GET /api/usage` matches the expected plan
5. Assistant and upload errors are visible and recoverable in UI

## Rollback

1. Re-deploy the previous known-good Worker version
2. Re-deploy the previous known-good Pages build
3. If schema changed, do not roll back DB blindly; restore from D1 backup first
4. Replay any Stripe webhooks that arrived during the incident window
