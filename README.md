# KDP Scout

A deliberately small Chrome extension for capturing structured Amazon book-market observations during KDP niche research.

## V0

V0 does one job: open an Amazon.com book product page, click KDP Scout, inspect the extracted fields, and save a dated observation to Chrome local storage.

It currently captures:

- title
- ASIN
- displayed price when recognized
- Amazon rating count when recognized
- overall **Books** Best Sellers Rank (not category rank) when recognized
- publisher
- publication date
- page count
- canonical Amazon URL
- observation timestamp

There is intentionally no backend, authentication, AI, search-result scanning, market scoring, or background crawling yet.

## Build

```bash
npm install
npm run typecheck
npm run build
```

The unpacked extension is emitted to `dist/`.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this repo's `dist/` folder.
5. Open an Amazon.com book product page.
6. Click the KDP Scout extension icon.
7. Review the captured fields and choose **Save observation**.

After code changes, run `npm run build` and press **Reload** on the extension card in `chrome://extensions`.

## V0 design constraints

- Reads only the active tab after the user explicitly opens the extension.
- Makes no background Amazon requests.
- Stores observations only in `chrome.storage.local`.
- Requests only `activeTab`, `scripting`, and `storage` permissions.
- Keeps extraction and storage separate from future scoring logic.

## Next milestone

Test this against a small set of real Amazon book pages and harden the extractors where Amazon's page variants differ. Only after product-page capture is reliable should KDP Scout add search-result capture and market grouping.
