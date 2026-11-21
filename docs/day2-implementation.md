# Day 2: implementation notes

Scope: one end-to-end vertical slice, with real data. Browser -> DeepSpace server action -> PricesAPI Search -> normalized result -> React UI, protected by auth, caching and usage limits.

## 1. Architecture overview

DeepSpace scaffold (React 19 + Vite frontend, Hono Worker on Cloudflare, record storage in a Durable Object with SQLite). I added one server action, two server-only collections, and one page. I did not add D1, KV, extra Durable Objects or a UI library: the record Durable Object that DeepSpace already provides is enough, and its unique constraint gives atomic limits (see section 7).

DeepSpace primitives used and why:

| Primitive | Used for |
|---|---|
| Server actions (`src/actions`, `POST /api/actions/:name`) | the only backend entry point; JWT verified by the platform route before the action runs |
| Auth (`DeepSpaceAuthProvider`, `AuthGate`, `getAuthToken`) | sign-in; the verified `userId` scopes per-user quotas |
| Secrets (`deepspace secrets`) | `PRICESAPI_KEY`, bound to the Worker as a secret at deploy |
| Collections / record Durable Object | `search_cache` and `usage_claims`, with `uniqueOn` for atomic claims |
| `deepspace deploy` | hosting at `dealproof.app.space` |

Not used, on purpose: the integration proxy (PricesAPI is not in it, and a direct `fetch` keeps the key under our control), cron/jobs (no scheduled work yet), Yjs/canvas/presence/messaging/payments (nothing in the MVP needs them), real-time record subscriptions in the browser (cache and quota rows are server-only).

## 2. Main files

| File | Responsibility |
|---|---|
| `src/actions/index.ts` | `searchProducts` action: passes verified `userId`, query and key into the flow |
| `src/server/pricing/search.ts` | the flow: validate -> cache -> key check -> lock -> quota -> upstream -> store |
| `src/server/pricing/pricesapi.ts` | PricesAPI Search client (header auth, timeout, error mapping, no retries) |
| `src/server/pricing/normalize.ts` | query validation; normalizing and sanitizing the response |
| `src/server/pricing/quota.ts` | atomic claims: user slots, global slots, in-flight lock |
| `src/server/pricing/config.ts` | limits and TTL with env overrides |
| `src/schemas/pricing-schema.ts` | `search_cache`, `usage_claims` (denied to all browser roles) |
| `src/lib/pricing-types.ts` | types shared by Worker and UI |
| `src/lib/api.ts` | browser call to the action |
| `src/pages/(app)/(protected)/search.tsx` | UI: form, loading, errors, results |
| `src/server/**/*.test.ts` | 57 unit tests with an in-memory fake of the record tools |

## 3. Frontend-to-backend data flow

1. The user submits the form on `/search` (a protected route: signed-out visitors see a sign-in panel).
2. `searchProducts()` gets the session JWT (`getAuthToken()`) and POSTs `{ query }` to `/api/actions/searchProducts` with `Authorization: Bearer <jwt>`.
3. `action-routes.ts` verifies the JWT; no or invalid token -> 401 before any app code runs.
4. The action runs `runSearch` with the **verified** `userId` (never from the request body).
5. The result `{ success, data | error, code }` returns; the page renders loading, error, empty or results.

## 4. External API integration

Only `GET https://api.pricesapi.io/api/v1/products/search` (`q`, `market=us`, `limit=3`, `offers_limit=60`). Fixed host; user input is only the `q` parameter; queries that look like URLs are rejected, and no user-supplied URL is ever fetched. One request per fresh search, with a 90 s timeout (cold searches took 20-42 s in Day 1), and **no automatic retry**. HTTP mapping: 429 -> `upstream_rate_limited` (with `Retry-After`), 401 -> `upstream_auth`, 403 -> `upstream_credits`, other non-2xx -> `upstream_error`, timeout -> `upstream_timeout`, bad body -> `upstream_error`. Upstream error bodies are never forwarded to the browser.

Normalization keeps uncertainty explicit: condition is always `'unknown'` (Search has no per-offer condition), per-offer timestamp is `null` (Search has none; the true observation time is `source.scrapedAt` from `meta.scraped_at`), missing delivery is `null` and not "free", the card-level `headline_price` is kept separately and is never used as an offer price, and a candidate is the API's grouping, not a verified identical product. Strings are length-capped, URLs must be http(s), numbers must be finite and positive, and candidates/offers are capped at 3/60.

## 5. Authentication

Platform-provided (DeepSpace auth, GitHub/Google). The action route requires a verified bearer JWT. The UI is under `(app)/(protected)`, so signed-out users get a sign-in panel. All quota rows are keyed by the verified `userId`, and the browser has no read or write access to the two collections.

## 6. Secret management

`PRICESAPI_KEY` is set with `deepspace secrets upload -` from stdin (not in chat, not in shell history, not in a file). It is stored in the platform's encrypted per-app store, written to a git-ignored `.dev.vars` for local dev, and bound to the deployed Worker at `deepspace deploy`. Code reads it only as `env.PRICESAPI_KEY` in the action, and the client sends it only in an `Authorization` header. Tests assert the key does not appear in results, errors, URLs or logs. `.dev.vars` is git-ignored, and I scanned the tracked files for key patterns before the first push. The GitHub repo is private.

## 7. Caching and rate limiting

- **Cache:** `search_cache`, one row per `market|normalized-query` (case and whitespace insensitive). TTL 12 h (configurable). Stores `cachedAt` (ours) separately from `source.scrapedAt` (the price feed's). A hit needs no API key and uses no quota.
- **Per-user limit:** 3 fresh searches per UTC day, as claim rows `u:<userId>:<day>:<n>`.
- **Global budget:** 15 fresh searches per UTC day (about 150 credits/day worst case), claim rows `g:<day>:<n>`.
- **Atomicity:** `usage_claims` has `uniqueOn: ['claimKey']`. The record Durable Object checks that constraint and inserts in one synchronous step, so two simultaneous requests cannot both take the same slot. (A read-increment-write counter would not be safe.)
- **Duplicate in-flight requests:** a `lock:<key>` claim makes simultaneous identical searches share one upstream call; the second gets `search_in_progress`. A lock older than 120 s is treated as abandoned.
- **Refunds:** a slot is released only when the upstream definitely did not charge (HTTP 4xx/5xx, or an empty result). A timeout keeps the slot, since cost is unknown.
- **Retries:** none, automatic or otherwise.

## 8. Tests

`npm run test:unit` -> 4 files, 57 tests, all passing (no network, no credits). They use the saved real responses in `tests/fixtures/` and cover: successful search and normalization; missing API key (no upstream call, no quota use); 13 invalid inputs; empty response; HTTP 500/503/401/403/429; timeout; network error; malformed body; cache hit, expiry, configurable TTL, cross-user hit without a key; per-user limit, UTC-day reset, per-user isolation, global budget, configurable limit; concurrent identical requests; stale and fresh locks; lock release on failure; secret non-leakage; normalization of missing data; and route-level authentication (401 without credentials or bearer token).

Also verified by hand: the production build succeeds, `tsc` and ESLint are clean, and against the running dev Worker and the deployed Worker an unauthenticated POST to the action returns 401.

**Not covered by automated tests:** the DeepSpace platform's real record Durable Object (the tests use an in-memory fake that mimics its unique-constraint behavior; the constraint code is in the SDK), the browser UI (no component or Playwright tests for the search page), and the real JWT verification path.

## 9. API credits consumed in Day 2

One paid PricesAPI Search through the real action (via a browser session): `Sony WH-1000XM5`, about **10 credits**, plus one repeat search served from DealProof's cache (0 credits). Total experiment + Day 2 usage is about 45 of the 3,000 free credits. I cannot read the real balance from the API, so this is derived from PricesAPI's documented billing, not measured.

The result's source time (4:56:10 PM, 11/19/2026) matched the Day 1 experiment's scrape, meaning PricesAPI served its own stored copy, and not a new scrape. The UI now shows this ("Served from the price feed's own cache") so a cached upstream result is never presented as a live one.

## 10. Deployment status

See the "Deployment" section at the end of this file, which I fill in after verifying the live URL.

## 11. Known limitations

- No variant matching, ranking, bargain flags or saved products yet (by design for Day 2).
- Prices are not independently verified, and condition and shipping are unknown or missing for most offers.
- A fresh search takes 20-42 s; the UI shows progress, and the server action holds the request open for that time. The deployed platform's request-duration limits are undocumented, so verify on the deployed site.
- A user whose request times out on the client may have used a daily slot without seeing results (the server may still finish and cache).
- Old `usage_claims` rows (one per fresh search) are not cleaned up yet; the volume is tiny.
- The global budget and cache TTL are tuned for the free credits, not for real traffic.
- Day 1 found Samsung 990 PRO results dominated by other models; matching will address this later.

## 12. Main design tradeoffs

- **Record-collection claims vs a custom Durable Object.** A dedicated quota Durable Object would also be atomic, but needs manifest and migration changes. Unique-constraint claims reuse what the platform provides, at the cost of one row per use and a loop of up to N create calls to find a free slot.
- **Refund only when certain.** Refunding on timeouts could let users bypass the limit and burn credits; keeping the slot can cost a user one search. I chose to protect credits.
- **Store normalized data, not raw responses.** Smaller rows, no untrusted blobs, and the raw payload (including image URLs) is dropped. The cost is that new fields must be added to the normalizer and old cache rows will not have them (they expire in 12 h).
- **Direct `fetch` vs the integration proxy.** PricesAPI isn't in the proxy catalog, so the key is our own secret.

## Deployment

**Status: serving at https://dealproof.app.space, but the platform release record is not finalized.**

What I verified (2026-11-19, from my machine with `curl`): `GET /` -> 200, `GET /search` -> 200, and `POST /api/actions/searchProducts` without credentials -> 401. The deploy output listed `App secrets: PRICESAPI_KEY` as bound.

What is not resolved: the first `npx deepspace deploy` uploaded the assets and activated the Worker, then failed with `release_reconciliation_pending` ("could not list script secrets (CF 404)"). Every re-run since (about 20 minutes) ends with `release_in_progress`, and `npx deepspace releases` shows 0 releases and `status` says "never deployed". The platform's guidance is to re-run the unchanged deploy, which I did. I did not use `app undeploy` or `app init --new-id`, because those are destructive or fork the app.

What I have **not** verified on the deployed site: a signed-in search (needs a browser sign-in), that the 20-42 s request completes within the platform's limits, and that the bound secret works in production.
