# Receipt OCR

This directory is reserved for the canonical first-party receipt OCR pipeline.

Planned v1:

- Python worker using PaddleOCR.
- Node service adapter called by `server/routes/upload.js`.
- Parser that extracts merchant, date, total, currency, raw text, and confidence.
- No mobile-side OCR service dependency for production.

The Expo app should upload receipt images to the backend; the backend owns OCR, parsing, persistence, deduplication, and categorization.
