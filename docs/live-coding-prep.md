# Live-coding preparation

A map of the code you may be asked to explain or change. Paths are relative to the repo root. Run commands with Node 24 on the PATH (`export PATH=$HOME/.local/node24/node_modules/.bin:$PATH` on this machine).

## 1. Data flow: browser -> server action -> PricesAPI

1. `src/pages/(app)/(protected)/search.tsx` submits the form and calls `searchProducts()` in `src/lib/api.ts`.
2. `api.ts` gets a JWT with `getAuthToken()` and `POST`s `/api/actions/searchProducts` with `Authorization: Bearer <jwt>`.
3. `src/server/action-routes.ts` verifies the JWT (`resolveAuth`); no valid token means 401. It builds `tools` (record access) and calls the action with the **verified** `userId`.
4. `src/actions/index.ts` -> `runSearch` in `src/server/pricing/search.ts`: validate query, read cache, lock, claim quota, **one** upstream call in `pricesapi.ts`, normalize (`normalize.ts`), store, return.
5. The browser receives normalized candidates; matching and comparison then run **in the browser** (`src/lib/matching/`), so the server never judges products.

The PricesAPI key exists only as `env.PRICESAPI_KEY` in the Worker. Nothing else calls PricesAPI. `getSavedComparison` does not (a test asserts the file never references it).

## 2. Why DeepSpace auth protects saved records

- Pages under `(app)/(protected)/` are wrapped in `AuthGate`.
- The real protection is the collection schema, `src/schemas/saved-schema.ts`: `userId` is `userBound` (the Durable Object overwrites it with the caller's id), `ownerField: 'userId'`, member permissions `read: 'own'`, `delete: 'own'`, `update: false`, `uniqueOn: ['userId','productKey']`. Rows you may not read never leave the server.
- Server actions run with RBAC **off**, so `src/server/saved/comparison.ts` re-checks `row.userId === userId` itself and answers `not_found` for "not yours" and "does not exist" alike.
- Test: `tests/saved-products.spec.ts` test 12 (two accounts, forged WebSocket frames).

## 3. Caching and quotas

`search.ts` order: cache hit (free) -> key configured? -> in-flight lock (`usage_claims`, kind `lock`) -> per-user slot (3/day) -> global slot (15/day) -> upstream -> store. Slots are rows with a unique `claimKey`, so concurrent requests cannot both win (`quota.ts`). Failures that definitely did not charge refund the slots. Limits and TTL live in `src/server/pricing/config.ts` (override in `wrangler.toml [vars]`). Cache rows are keyed `us|<lowercase query>`; saved products derive that key from their stored query.

## 4. How variants are matched

`src/lib/matching/families.ts`: `detectTarget(query)` picks the product family; `classifyTitle(target, title)` dispatches to `classifySony` / `classifyLogitech` / `classifySamsung`. Each returns a `MatchDecision` (`EXACT / LIKELY / AMBIGUOUS / DIFFERENT_VARIANT / REJECTED`, a summary, reasons, evidence). Rules are regexes over `normalizeText(title)`. `FAMILIES` defines the user-selectable dimensions (e.g. Samsung `capacity`, `heatsink`) and defaults. `compare.ts` `buildComparison` groups the decisions and picks the headline.

## 5. How price anomalies are detected

`src/lib/matching/anomalies.ts`: `assessPrices` builds a baseline from one price per independent seller (EXACT matches; LIKELY added if fewer than 6), takes the median, and flags ratio < `ANOMALY_RATIO` (0.6). Fewer than `MIN_INDEPENDENT_SELLERS` (6) gives `insufficient_evidence`. Wording lives in the same file; keep it neutral ("Unusually low compared with other listings"). Eligibility for the headline is in `compare.ts`, separate from the flag.

## 6. Why unknown information is preserved

The Search endpoint gives no per-offer condition or timestamp and often no shipping. Guessing "new" or "free shipping" would make a comparison look cleaner than the evidence supports. So `condition` defaults to `unknown` (only the title can change it), `shipping` is `null` ("Not provided", which does *not* mean free), and `priceVerification` is always `api_reported_not_verified`.

## 7. Reproducing and debugging a failing test

- Unit: `npx vitest run src/lib/matching/matching.test.ts` (add `-t "part of test name"`); `npx vitest` for watch mode.
- Types / lint: `npx tsc --noEmit`, `npx eslint .`.
- Browser: `npx deepspace test run e2e --port 5199 --grep "keyboard"`. Failure screenshots and the error context are in `.deepspace/test-results/`. If the port is busy, pick another. The runner starts its own dev server.
- Browser tests never spend credits: `searchProducts` is intercepted. Do not remove the interception; the dev server holds the real key.
- Debug a saved-product problem: open DevTools -> Network, filter `getSavedComparison`; the Worker logs `[action] "<name>" caller=<id>`; the record socket frames (`core.put`, `core.delete`, `records.ack`) show why a write was refused.

## Three small exercises (do them yourself; nothing here is implemented)

**A. Add a variant rule.** The Samsung heatsink detection (`classifySamsung`, the `hsWith` / `hsWithout` lines in `families.ts`) matches "heatsink" and "heat sink" but, as far as I can tell from reading the regexes, not the hyphenated "heat-sink", so such a title falls back to `LIKELY` ("doesn't say whether it has a heatsink"). First write a failing test in `matching.test.ts` that shows it (check my claim, don't trust it), then extend the pattern, including "w/o heat-sink" for the without case, and make sure the existing tests still pass. Also update `detectTarget` if the same wording should work in the search box.

**B. Modify an offer classification.** Today a Logitech title that does not say which edition is `LIKELY` for the standard edition. Change the behaviour so such a title is `AMBIGUOUS` instead, update the explanation text, then fix the tests that now fail and decide whether the headline price should change. Think about what that does to the median baseline in `anomalies.ts`.

**C. Fix a broken saved-product operation.** Temporarily break removal: in `src/pages/(app)/(protected)/saved/index.tsx`, make `remove` call `removeConfirmed` with the wrong id, or in `saved-schema.ts` change `delete: 'own'` to `false`. Run `npx deepspace test run e2e --grep "remove"`, read the failure, locate the cause from the test output and network frames, and restore it. Then explain why the unit test `saved.test.ts` ("lets a user see and delete only their own rows") would or would not have caught each variant of the breakage.
