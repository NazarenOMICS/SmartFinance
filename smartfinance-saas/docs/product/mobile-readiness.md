# Mobile Readiness Notes

The first commercial release remains web-first, but the architecture must not block a future Expo/React Native app.

## Required invariants

- Bearer-token auth works for every protected endpoint.
- Shared contracts and SDK are React-agnostic.
- Upload and export flows remain transport-neutral.
- Billing state is resolved server-side and exposed over API.

## Explicit non-goals for v1

- Native mobile UI implementation
- Shared design-system primitives across web and native
- Offline-first sync
