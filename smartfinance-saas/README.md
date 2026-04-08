# SmartFinance SaaS

Foundation monorepo for the Cloudflare-first, multi-tenant SmartFinance SaaS.

## Workspace layout

- `apps/web`: React + Vite shell for the SaaS frontend
- `apps/api`: Hono-based Cloudflare Worker API
- `apps/mobile`: reserved placeholder for future Expo/React Native work
- `packages/contracts`: shared schemas and DTOs
- `packages/client-sdk`: typed API client usable from web and future mobile
- `packages/domain`: pure business rules and plan definitions
- `packages/database`: D1-oriented schema helpers and bootstrap logic
- `packages/config`: runtime env parsing
- `packages/observability`: request ids and logger helpers
- `packages/ui-web`: web-only shared UI primitives

## Commands

```bash
corepack enable
pnpm install
pnpm check
pnpm dev:web
pnpm dev:api
```

## Status

This repo intentionally starts as a clean skeleton. Legacy business logic should be extracted selectively from the original SmartFinance repo and adapted into the new layers in this order:

1. `contracts`
2. `domain`
3. `database`
4. `api`
5. `web`
