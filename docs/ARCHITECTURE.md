# SmartFinance + Genio Architecture

## Canonical Repositories

- `C:\Users\Naza\Documents\SmartFinance` is the backend/SaaS workspace.
- `C:\Users\Naza\Documents\SmartFinance-Mobile` is the standalone Expo mobile app.

## Source Of Truth

`SmartFinance/server` is the source of truth for finance data and behavior:

- SQLite database and migrations.
- REST API under `/api/*`.
- CSV/PDF/image imports.
- Deduplication, categorization, rules, savings, insights, export, and assistant logic.
- Future first-party receipt OCR with PaddleOCR.

`SmartFinance-Mobile` is a client:

- It owns Android/iOS UI, navigation, auth gate, camera/document picker, and API calls.
- It does not persist finance data locally in v1.
- It must use `EXPO_PUBLIC_API_URL` to reach the backend.

## Mobile Duplication Policy

`smartfinance-saas/apps/mobile` is documentation-only. Do not add an active Expo app there. Mobile code belongs in `SmartFinance-Mobile`.

## OCR Policy

The canonical OCR implementation belongs in `SmartFinance/server/ocr`.

Local OCR experiments in `SmartFinance-Mobile` are not canonical unless explicitly promoted into `SmartFinance/server`.
