# Backup and Restore Runbook

## Export backup

Production:

```powershell
npx wrangler d1 export smartfinance-saas-prod --remote --output backups/smartfinance-saas-prod.sql
```

Staging:

```powershell
npx wrangler d1 export smartfinance-saas-staging --remote --output backups/smartfinance-saas-staging.sql
```

## Restore workflow

1. Create a new D1 database or use D1 Time Travel if the incident requires point-in-time recovery.
2. Import the exported SQL into the recovery database:

```powershell
npx wrangler d1 execute <database-name> --remote --file backups/<file>.sql
```

3. Update the target `database_id` only after smoke checks pass.
4. Run:

```powershell
corepack pnpm smoke:deploy
corepack pnpm test:e2e:staging
```

## Stripe after restore

1. Replay Stripe webhooks that happened after the backup snapshot.
2. Verify `GET /api/billing/subscription`.
3. Verify `GET /api/usage`.

## Notes

- Do not restore production directly without validating on staging first.
- `UPLOAD_BINARY_STORAGE` is currently `disabled`, so this runbook covers D1 state only.
