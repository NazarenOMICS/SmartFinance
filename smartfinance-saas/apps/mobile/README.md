# Mobile App Stub

The canonical Genio mobile app does not live in this SaaS workspace.

Use the standalone repository instead:

```txt
C:\Users\Naza\Documents\SmartFinance-Mobile
```

Architecture rule:

- `SmartFinance-Mobile` owns the Expo/React Native app only.
- `SmartFinance/server` owns the API, SQLite database, imports, OCR, categorization, assistant, and all financial persistence.
- Mobile must talk to the backend through `EXPO_PUBLIC_API_URL`; it should not duplicate backend services or persist finance data locally in v1.

This directory intentionally remains as documentation only so the SaaS repo does not carry a second active mobile implementation.
