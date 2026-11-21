# Day 4: saved products, flow polish, end-to-end verification

Status: implemented and tested locally. **Not deployed**: the platform-side deployment blocker is unchanged (see `docs/deployment-issue.md`). Nothing below has been verified on the live site.

## What was added

| Area | What |
|---|---|
| Saved products | "Save for later" on a comparison, a `/saved` list, a `/saved/<id>` page that reopens the stored comparison, remove (list, detail, search page), explicit refresh |
| Data model | New collection `saved_products` (small bookmark rows, no price data), owner-only |
| Server action | `getSavedComparison`: reads what the server already stored for a saved product. Never calls PricesAPI, never uses quota |
| Headline offer | Match label (Exact vs Likely), condition, availability, shipping, price-verification status, observation time and a retailer link are now in the "Lowest reported matching offer" box |
| Polish | Compact data-provenance card on search results, clearer Saved nav, stale / missing / loading / error states |

## Saved-product data model

One row per (user, product, variant) in `saved_products` (`src/schemas/saved-schema.ts`):

| Column | Purpose |
|---|---|
| `userId` | Owner. `userBound`: the record Durable Object overwrites it with the verified session user on every write. The browser never supplies it |
| `productKey` | Stable identity, e.g. `samsung-990-pro\|capacity=4TB\|heatsink=with` (`productKey()` in `src/lib/saved.ts`). Omitted choices take the family default, so "standard" cannot be saved twice |
| `family`, `variant` | The exact product and variant to compare; validated against the matching engine when read (`parseSaved`) |
| `displayName` | Label captured at save time |
| `query`, `market` | The search the comparison came from. The server **derives** the cache key from these (`cacheKey('us', query)`), so there is no second pointer that could disagree with the cache |
| record `createdAt` | "Saved at" comes from the record envelope, not a client-supplied field |

No offers, prices or API responses are copied into the row. Price data stays in the server-only `search_cache` (one row per normalized query, shared by everyone), so 1,000 users saving the same product still cost one cache row.

## Authentication and ownership

Three layers, strongest first:

1. **Record Durable Object (native DeepSpace RBAC).** `ownerField: 'userId'`; `member` and `admin` get `read: 'own'`, `create: true`, `update: false`, `delete: 'own'`; viewers and signed-out visitors get nothing. Admins deliberately get no extra read access: a shopping list is private even from the app owner. Rows the caller may not read are dropped by the server before they reach the WebSocket.
2. **`uniqueOn: ['userId', 'productKey']`.** A second save of the same product and variant is refused by the Durable Object, including against a forged or replayed client write.
3. **The privileged action checks ownership itself.** Server actions run with RBAC off, so `getSavedComparison` loads the saved row and compares `row.userId` with the verified JWT user. Another user's row, a missing row and a malformed id all return the identical `not_found` answer, so ids cannot be probed. The owner id is never read from `params`.

All columns are `immutable` and members cannot update, so a saved row can only be created or deleted. Changing the variant means saving another row.

## Caching and saved products

- Saving never contacts the price API and creates no monitoring.
- Opening a saved product calls `getSavedComparison`, which only reads `search_cache`. It returns the stored data even when past its 12-hour expiry, labelled **stale**, and returns `result: null` ("no stored prices") when the cache row does not exist. A unit test asserts the module does not reference the upstream client, quota or lock code.
- "Refresh prices" / "Get fresh prices" is an explicit button that calls the ordinary `searchProducts` action, so the 12-hour cache, per-user (3/day) and global (15/day) limits apply unchanged. Before the click the page says whether it will use a search ("This runs a new search and uses one of your fresh searches today (N of 3 left)") or just reload still-fresh data ("without using a search").
- Two times are always shown separately: **prices observed by the source** (`meta.scraped_at`) and **stored by DealProof** (cache time), each with an age ("30 hours ago").
- If someone else's search (or a later refresh) replaces the cache row, a saved product reopens with that newer data. The saved row only says *which search*, not *which snapshot*. This is the cost of not copying API responses.

## DeepSpace primitives used, and why

| Primitive | Why |
|---|---|
| Collection schema with `userBound`, `ownerField`, `uniqueOn`, `immutable`, per-role permissions | Ownership, duplicate prevention and read isolation are enforced by the platform, not UI code |
| `useQuery` / `useMutations` (`createConfirmed`, `removeConfirmed`) | Saved list and save/remove with real server acknowledgements; list updates live, also across tabs |
| Server action (`getSavedComparison`) | The cache collection is closed to every browser role, so only a privileged action can read it. The action is the one place that bridges "my saved row" to "the server's stored prices" |
| Existing `searchProducts` for refresh | Reuses cache, locks and quotas instead of a second code path that could spend credits |
| File-based routes under `(protected)/saved/` | Sign-in is required for `/saved` and `/saved/<id>` with no extra code |

Alternatives rejected: a server action for save/remove (adds code and a place to get ownership wrong for no benefit over native RBAC); storing the full comparison in the saved row (large, duplicates data, goes stale silently); a per-user cache (multiplies API spend); automatic refresh on open (violates "no paid request without an explicit action").

## Primary flow

Search -> pick product -> choose variant -> compare -> read warnings -> Save -> Reopen from Saved.

The "Lowest reported matching offer" box now shows, without scrolling into the list: price and seller; the match label; condition; availability; shipping or "Not provided"; "Not independently verified (feed-reported)"; the source observation time; the low-price warning when applicable; and a link to the retailer listing.

**A likely match is never shown as confirmed.** When the headline offer is a likely match the box shows "Likely the same, some details missing" plus "Not confirmed as the exact variant: <reason>", never "Same model and variant". The same applies to the lowest-unflagged reference line, and survives save and reopen. Tested in unit tests and browser tests (live and reopened).

## Testing

All commands run on 2026-11-20 against the local dev server. **No PricesAPI request was made**: browser tests intercept `searchProducts` and answer from saved fixtures, every test fails if a request to `pricesapi.io` is seen, and `getSavedComparison` cannot call it by construction.

| Check | Result |
|---|---|
| `npx vitest run` | 169 passed in 9 files (matching 56, price baseline 26, search/quota 52, saved-product action 10, saved model + schema 11, comparison UI 9, template 5) |
| `npx tsc --noEmit` | clean |
| `npx eslint .` | clean |
| `npx vite build` | succeeds |
| `npx deepspace test run e2e` (Playwright, headless Chromium) | 31 passed: 12 new saved-product tests, 8 earlier DealProof UI tests, 11 template tests |

### What is real and what is mocked in the browser tests

Real: DeepSpace sign-in with two test accounts, the local record Durable Object (SQLite), the `saved_products` permissions, the uniqueness rule, owner stamping, the unmocked `getSavedComparison` action (ownership; "no stored data"). Mocked: price data only (`searchProducts`, and `getSavedComparison` in the tests that need stored prices, because the dev cache is empty and filling it would need a paid search).

### Saved-product browser tests (`tests/saved-products.spec.ts`)

| # | Verifies |
|---|---|
| 1 | Save from a search; appears on `/saved` with name, variant and saved time |
| 2 | The exact variant is saved (Samsung 2TB vs 4TB with heatsink are two rows); reopening shows that variant, fixed |
| 3 | Duplicates prevented: UI hides the second save; a forged second create is refused by the Durable Object ("Duplicate ... already exists") |
| 4 | Reopen shows the stored comparison, both times, and issues **no** search request |
| 5 | Stale data is labelled and nothing is fetched for 1.5 s; one explicit click makes exactly one search call |
| 6 | No stored data (real action): explained; nothing fetched automatically |
| 7 | Remove from the search page, from the list (with Cancel), and from the detail page; gone after reload |
| 8 | Survives a page refresh and a forced fresh sign-in (new browser context) |
| 9 | A likely match keeps its uncertainty label when live and when reopened |
| 10 | 390 px: search, saved list and saved detail have no horizontal scroll |
| 11 | Save and remove work from the keyboard |
| 12 | Two accounts, see below |

### Two-account permission test (test 12, real storage)

User B, signed in as a different account, against user A's saved row:

| Attempt | Result |
|---|---|
| Open B's `/saved` | Empty list |
| Open `/saved/<A's id>` | "Saved product not found"; the page never calls the server for it |
| Forged subscription to the whole collection, by A's record id, by A's user id | A's row never returned |
| Forged `core.delete` of A's row | Refused: `DELETE DENIED: role=member, collection=saved_products` |
| Forged `core.put` over A's row | Refused (`Cannot modify immutable field 'variant'`) |
| `getSavedComparison` with A's id, B's valid token | `{success:false, code:'not_found'}`, identical to asking for a non-existent id; extra `userId`/`owner` params change nothing |
| Create a row claiming `userId` = A | Accepted but stored as B (`userId` overwritten with B's id); A's list unchanged |
| A edits A's own row | Refused (rows are create/delete only) |

Honest caveat: the update refusals above come from field immutability, which the Durable Object checks before the permission rule, so the browser test cannot show the `update: false` rule firing alone. That rule is asserted in `saved.test.ts`; the `own` rule is demonstrated by the delete refusal and the read isolation.

### Test stability

The keyboard test (11) failed intermittently in 2 of 5 early runs: it focused the Save button while it was still disabled during the list load. That was a test race, not an app bug; it now waits for the button to be enabled. After the fix it passed in each of the 5 runs I made (3 saved-product-only, 2 full-suite). That is reasonable evidence, not proof of zero flakiness.

## Manual and visual verification

Screenshots (`docs/screenshots/20-27`): search with the save control, saved list (desktop and 390 px), saved detail fresh / stale / no-stored-data, mobile search and mobile saved detail. They were viewed after the runs. Findings acted on: the data-provenance card pushed the lowest price below the fold, so it was compacted; the "Save for later" button was captured mid-load (a test timing issue; the screenshot now waits for it to be enabled). Only Chromium, desktop and 390 px were checked; no other browsers, tablet widths, screen readers or the live site.

## Known limitations

- Saved comparisons are not snapshots: they show the latest data the server has for that search (see Caching).
- A saved item whose search was never stored has no prices until the user spends a fresh search. (Day 5: saving from bundled demo samples is now disabled, with an explanation, so a sample can no longer produce a saved item that cannot be reopened. Rows saved from samples before this change still reopen as "no stored prices".)
- Variant and display name are stored once; if the matching engine later renames a variant option, an old row that no longer parses is shown as "not a recognised product" and can only be removed.
- The update-permission refusal is not independently shown in a browser test (see above).
- Only three products are supported. Matching still reads titles only. The 60% low-price rule is unchanged and sensitive near the line.
- Deployment is blocked; nothing here has run on https://dealproof.app.space.


## Follow-up: write controls wait for `useMutations().ready` (after the official skill was installed)

The installed DeepSpace skill says: "Disable write controls until `useMutations().ready`." The SDK types define `ready` as "the collection's RecordRoom can accept writes", which is separate from `useQuery().status` (the list has loaded). Before this change the Save button waited only for `useQuery().status === 'ready'`, and the Remove controls had no readiness gate. A write before the room was ready was not silently lost (the confirmed mutations reject with `not_ready` and the UI shows "Could not save/remove. Please try again."), but the controls were enabled when they should not have been.

**Controls corrected (5 places, 7 buttons):**

| Where | Control | Now disabled while |
|---|---|---|
| `src/components/saved/SaveControl.tsx` | Save for later | `busy` or query not ready or **mutations not ready** |
| `src/components/saved/SaveControl.tsx` | Remove (after saving) | `busy` or **mutations not ready** |
| `src/pages/(app)/(protected)/saved/index.tsx` | Remove, Confirm remove, Remove for an unrecognised row | **mutations not ready** |
| `src/pages/(app)/(protected)/saved/[id].tsx` | Remove from saved, Confirm remove | **mutations not ready** |

Each component now reads `ready` from the same `useMutations()` call it already used and adds `|| !ready` / `disabled={!ready}`. Query readiness is **not** replaced: the list and detail pages still render only once the query is `ready`, and Save still also waits for it. Busy state, confirmation steps and the `catch` blocks for unexpected failures are unchanged. The refresh button is not a record mutation (it calls a server action), so it is unchanged. Server-side code (`tools.create/remove` in the quota and cache modules) is not a UI control and is not affected.

**Tests (`src/components/saved/mutation-readiness.test.tsx`, 12 tests).** `deepspace`'s `useQuery` and `useMutations` are mocked so query status and mutation readiness are set independently, and the pages are rendered server-side. They check: Save disabled when the query is ready but mutations are not; Save enabled when both are ready; Save still disabled while the query is loading even if mutations are ready; Remove disabled/enabled the same way on the search page, the Saved list (including the unrecognised-row Remove) and the detail page; and the detail page shows "not found" instead of a Remove control for a record that is not in the user's list. Against the previous code, 5 of these tests fail (every "not ready" case); with the fix all 12 pass.

**Limits of these tests.** There is no DOM library in the project, so they check rendered `disabled` state, not clicks. The "Confirm remove" buttons only appear after a click, so they are gated in the code but not asserted by these tests. Clicking through a working save and remove, ownership, and permission checks remain covered by the browser tests against real record storage (`tests/saved-products.spec.ts`, 12 tests, unchanged and passing).

**Results after the change** (local, mocked prices, no PricesAPI requests): `tsc` clean, ESLint clean, `npx vitest run` 181 passed in 10 files, `npx vite build` ok, `npx deepspace test run all` exit 0 (181 unit and 31 browser tests passed). The run regenerated the 11 saved-product screenshots; the pixel differences were under 0.6% of each image and limited to time-label text, so the committed screenshots were kept.

This change is front-end only. It does not touch Worker activation, secrets or release reconciliation, so it has no bearing on the deployment blocker.
