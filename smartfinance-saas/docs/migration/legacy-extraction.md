# Legacy Extraction Rules

The existing SmartFinance repo is treated as a frozen reference implementation.

## Migration workflow

1. Define or update the shared contract.
2. Extract the relevant business rule into `packages/domain`.
3. Rebuild the persistence flow in `packages/database`.
4. Expose it through `apps/api`.
5. Consume it in `apps/web`.

## Anti-patterns

- Do not copy Express routes directly into the new worker.
- Do not move browser-specific parsing logic into shared packages.
- Do not preserve legacy response shapes if they are screen-specific.
- Do not bypass tenant scoping for convenience.
