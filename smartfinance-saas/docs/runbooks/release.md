# Release Runbook

Foundation checklist before shipping the first SaaS milestone:

1. Run `corepack pnpm check`
2. Apply D1 migrations in the target environment
3. Verify `/api/health`
4. Verify `/api/system/schema`
5. Sign in with a development or Clerk-backed user
6. Trigger `/api/onboard`
7. Confirm usage snapshot resolves correctly

This runbook will expand as uploads, billing, and staging environments are implemented.
