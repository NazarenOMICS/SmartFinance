# Frontend/Backend Audit

Fecha: 2026-04-10

## Alcance auditado

Se auditó el uso real de `api.*` en `apps/web/src` contra:

- `apps/web/src/api-core.js`
- `apps/web/src/api-adapter.js`
- `packages/client-sdk/src/client.ts`
- `apps/api/src/routes/*`

## Hallazgos principales

### Ya cubierto por backend nativo

- `Dashboard`
  - `getSummary`
  - `getTransactions`
  - `getEvolution`
  - `getCategoryTrend`
  - `searchTransactions`
  - `updateTransaction`
  - `deleteTransaction`
  - `markTransactionMovement`
- `Upload`
  - `getUploads`
  - `uploadFile`
  - `batchCreateTransactions`
  - `resumePendingGuidedReview`
  - `getCandidates`
  - `confirmCategory`
  - `rejectCategory`
  - `undoRejectCategory`
  - `undoConfirmCategory`
- `Rules`
  - `getRules`
  - `createRule`
  - `updateRule`
  - `deleteRule`
  - `getRuleInsights`
  - `resetRules`
- `Accounts`
  - `getAccounts`
  - `getConsolidatedAccounts`
  - `createAccount`
  - `updateAccount`
  - `deleteAccount`
  - `getAccountLinks`
  - `createAccountLink`
  - `reconcileAccountLink`
  - `deleteAccountLink`
  - `refreshRates`
- `Savings`
  - `getProjection`
  - `getInsights`
- `Installments`
  - `getInstallments`
  - `createInstallment`
  - `updateInstallment`
  - `deleteInstallment`
  - `getCommitments`
- `Recurring`
  - `getRecurring`
- `Assistant`
  - `assistantChat`
- `Bank formats`
  - `getBankFormats`
  - `saveBankFormat`
  - `deleteBankFormat`
  - `suggestBankFormat`

### Problemas encontrados en la auditoría

1. `api-adapter.js` seguía pisando flujos ya soportados por SDK/backend:
   - `upload`
   - `transactions`
   - `accounts`
   - `search`
   - `movement-kind`
   - `internal operations`
2. El dashboard seguía reconstruyendo `summary` del lado cliente en vez de usar el contrato oficial del backend.
3. La equivalencia de balances en `Accounts` se recalculaba en frontend aunque el backend ya exponía `converted_balance`.
4. `claimLegacy` existe como endpoint pero hoy sigue siendo un no-op.
5. No hay todavía cobertura e2e automática por botón/flujo; el check actual valida typecheck/test/build, no comportamiento visual completo.

## Cambios aplicados en esta ola

- Se eliminó el override legacy de `api-adapter.js` para:
  - summary/transactions/evolution/search
  - internal operations
  - movement kind
  - create/update/delete transaction
  - accounts
  - uploads
- `Dashboard` ya consume el `summary` completo del backend.
- `Accounts` usa `converted_balance` del backend consolidado.
- Summary/evolution/savings/category trend ahora respetan `preferred_currency` en links FX:
  - `internal_transfer` no cuenta
  - `fx_exchange` cuenta solo si el link define `preferred_currency` y la transacción corresponde a esa moneda

## Estado actual

### Alta confianza

- La mayoría de los botones visibles del frontend ya disparan rutas backend reales.
- El adapter quedó reducido a onboarding legacy puntual.
- Upload/review/rules ya no dependen de reconstrucciones tan grandes en frontend.

### Todavía pendiente

1. `claimLegacy`
   - Sigue siendo no-op.
2. Auditoría e2e por flujo
   - falta validar con browser real:
     - upload
     - candidate review
     - rule review
     - account linking FX
     - savings/dashboard parity
3. Exactitud contable final contra dataset legacy
   - falta comparar resultados con fixtures reales del legacy para cerrar diferencias residuales.

## Próximo bloque recomendado

1. E2E de flujos críticos del frontend:
   - dashboard
   - upload
   - recurring
   - rules
   - accounts/linking
   - savings
2. Comparación SaaS vs legacy sobre dataset fijo.
3. Cerrar cualquier botón que todavía dependa de estado local para “verse bien” aunque el backend haya fallado.
