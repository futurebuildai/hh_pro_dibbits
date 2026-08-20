# fixtures-live — verbatim captures off the running staging ERP

Recorded 2026-08-20 (DIB-501) from `https://dibbits-staging.gablelbm.com/api/portal/v1/*`,
signed in as the DOCUMENTED staging demo account provisioned by HardscapeOS
migration `0055_portal_demo_fixtures.sql` (`portal.demo@dibbits.example`; the
password is documented in that migration, deliberately not repeated here).

These are the other half of `fixtures/`: those were transcribed from the Go
structs before DIB-479 had merged to a reachable server; these are what the
server actually said. `erp-staging-recorded.test.ts` runs the adapter over
them.

**One edit only:** every `token` value is replaced with
`live-capture-token-redacted`. A staging-signed JWT is a live credential for
up to 12 hours and does not belong in history. Everything else is byte-level
verbatim (re-serialized with stable indentation).

| Fixture | Route | Worth noticing |
|---|---|---|
| `login.json` | `POST /login` | no `expires_at` — C-1 confirmed live |
| `refresh.json` | `POST /token/refresh` | nanosecond-precision `expires_at` |
| `me.json` | `GET /me` | `capabilities` present (DIB-479 extension, live) |
| `config.json` | `GET /config` | real dealer branding, `#E8A74E` |
| `catalog-search-paver.json` | `GET /catalog/search?q=paver&limit=3` | `base_uom: "PC"` — the UOM drift |
| `catalog-search-sand.json` | `GET /catalog/search?q=sand&limit=5` | `T`, `BAG`, `PC` in one page |
| `dashboard.json` | `GET /dashboard` | composed AR balance + `recent_orders` |
| `billing-summary.json` | `GET /billing/summary` | |
| `orders-page.json` / `order-detail.json` | `GET /orders[/{id}]` | `INVOICED`, `PICKUP`, Go zero `requested_date`, `#`-prefixed order numbers |
| `invoices-page.json` / `invoice-detail.json` | `GET /invoices[/{id}]` | `PAID`, zero balance, order link |
| `quotes-page.json` / `quote-detail.json` | `GET /quotes[/{id}]` | `DRAFT` + `ACCEPTED`, priced lines on detail |
| `error-404.json` | any missing/cross-tenant id | `{"error":"not found"}` |
| `error-401.json` | any anonymous read | `{"error":"unauthorized"}` |

To re-record: `npx vitest run --config vitest.live.config.ts` exercises the
live server through the real adapter (see `verification/`), and the curl
transcript in `NOTES-dib-501.md` reproduces every capture by hand.
