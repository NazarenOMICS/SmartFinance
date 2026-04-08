# Foundation Architecture

## Principles

- Web-first launch, mobile-ready contracts from day one
- Cloudflare Worker is the production API surface
- D1 is the system of record for user-scoped business data
- R2 stores uploaded binaries; the database stores metadata only
- Shared packages own contracts, domain rules, and API client behavior

## Layering rules

1. `contracts` define the shape of API inputs and outputs.
2. `domain` contains pure business rules and plan capabilities.
3. `database` contains D1 schema helpers, bootstrap logic, and tenant-aware query helpers.
4. `apps/api` wires auth, validation, routing, and orchestration.
5. `apps/web` renders UI and consumes the typed SDK.

## Mobile-readiness constraints

- No browser-only APIs outside `apps/web`
- No auth or upload flow may require cookies
- The SDK must work with a token provider, not React hooks
- Upload contracts must be usable by web and future mobile clients
