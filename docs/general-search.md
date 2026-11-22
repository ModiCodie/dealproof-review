# General product search

Flow: **search text → product candidates → user picks the intended product → compare offers.**

## Architecture
- `src/pages/(app)/(protected)/search.tsx`: search box (explicit submit only), featured products (no default selection, each with a free demo), candidate picker, comparison.
- `src/lib/matching/generic.ts`: deterministic, title-only matcher for any product. No LLM, no fuzzy similarity score.
- `src/lib/candidates.ts`: turns the (up to 3) PricesAPI product groupings into choices and a pick into a comparison target.
- Typed text that names a featured product (`detectTarget`) skips the candidate step and uses that product's hand-written rules (Sony WH-1000XM5, Logitech MX Master 3S, Samsung 990 PRO), unchanged.

## Identifying candidates
PricesAPI search returns up to 3 product groupings per paid search. Each becomes a card with its title, offer count, and whether it matches the search text ("Matches your search" / "Not confirmed" / "Doesn't match", with the reason). One group is pre-selected only when exactly one clearly fits; the user can always change it. Offers from all groups are pooled and every listing is judged by its own title against the picked product, because groupings can be wrong (the Samsung sample's top group was a different SSD).

## Generic matching
Identity comes from the search text: brand, model words, model codes (letters+digits, compared separated or not), model numbers. Colours and filler are ignored.
- **Identity must be specific**: a model code, or a name plus a number. "Dyson cordless vacuum" is "insufficient": every listing is "cannot tell", no lowest price, and the page explains why. Picking a candidate whose title has a model code supplies it, and the page says so.
- Only a model code can give "same model" (exact). Name + number is capped at "likely" ("no model code is stated to confirm the exact model").
- Different model code, different number, a different generation, a model-line word not searched for (Pro, Max, Plus…), accessories/parts/compatibility wording → excluded or "cannot tell", each with a stated reason.
- Special editions and multipacks are separate variants. Unstated variant detail, trim level (e.g. "Absolute"), or bundles → "likely", never exact.
- **Variants are discovered from the listings** (storage, memory, generation, screen size, heatsink), shown only if the listings state them, with a note on why a default was chosen. Colour is never a variant.
- Price integrity is unchanged: feed price vs checkout, unknown shipping and condition, provisional matches, "unusually low" wording. The anomaly check uses only the matched set, needs ≥6 independent sellers, and is not applied across variants or when identity is insufficient.

## Caching, quota, saved
- Cache key = market + the query reduced to lowercase letters/digits, so "Sony WH-1000XM5", "sony wh1000xm5" and "SONY  WH 1000 XM5" share one entry and one paid search; different words stay different. Entries written under the old key are still read (`legacyCacheKey`), new writes use the new key.
- Queries need at least one letter or digit; length limit, per-user daily quota, 12-hour cache, in-flight de-duplication and server-side auth are unchanged. The PricesAPI key never reaches the browser.
- Saved products: `family: 'generic'`, with the picked title, identity and chosen variant in the existing `variant` JSON field. No schema change; rows from earlier versions parse as before; forged or malformed generic rows are rejected. Ownership, deletion and `useMutations().ready` gating are unchanged.

## Limits (PricesAPI)
- No GTIN/UPC/MPN, brand or spec fields: **titles are the only evidence**, so a generic match can be "likely" but never verified. Condition is inferred from titles; shipping is often missing; there is no price history.
- At most 3 groupings per paid search, so some products have no good candidate and coverage is only the US feed.
- Titles that omit or misstate a model, or that bundle several models, are labelled "cannot tell" rather than guessed.
- Generic rules are English-title heuristics; unusual naming schemes (no code or number) will be "insufficient".

## Tests and fixtures
`tests/fixtures/synthetic/*` are invented (fictional `.example` retailers, made-up prices; `build.py` generates them). No test calls PricesAPI. Opt-in screenshots: `DP_SHOTS=1 npx deepspace test run e2e --grep "general shots" --port 5199` → `docs/screenshots/general-search/`.

## Real-data hardening (after the one live AirPods Pro 2 search)

The saved real response exposed defects, fixed without any new paid request:

- **Charging case.** A charging case named after the product ("... MagSafe Charging Case (Lightning)") is part of a complete product. A part is rejected only on specific evidence: "X only", "replacement/spare", compatibility wording, "<part> for <product>", or a part word as the subject before the product name. A title that is cut off never earns a rejection from its missing tail.
- **"Customizable Fit".** A lone "fit" or "for" is not compatibility wording. Phrases like "fits for", "compatible with" still are.
- **Condition.** `new / used / refurbished / open-box / defective / incomplete / unknown`. Unknown is never new. "Certified Used Refurbished" is refurbished. A cut-off "Not Working With" is shown as *possibly defective*. Defective and incomplete listings (for parts, not working, earbuds only, one earbud, no case) go to their own section.
- **Price summary (general products only).** A lowest-price headline needs at least 3 independent sellers listing the product as **new** with no open configuration. Otherwise the page says "Not enough comparable offers to determine a reliable lowest price" and still lists every listing, with why it is excluded or uncertain. The unusually-low heuristic runs only inside that homogeneous group. Prices stay feed-reported, not checkout-verified; a low-price flag is not a fraud claim.
- **Connector.** Explicit "USB-C" / "Lightning" in a title is a variant dimension (generic, not AirPods-specific). A title that does not state it is "Configuration not stated" when other listings show the product comes in different configurations. The connector is never guessed.
- **Candidates.** The feed's groups share almost no listings and differ in configuration, so a pick now compares **that group's own listings**, each judged by its own title; pooling made all picks identical. Groups merge only when their cleaned titles are identical. When no group title confirms the search, the picker says so.

### Limitations
- Saved comparisons store the product and variant but not which group was picked, so a reopened saved page pools all groups' listings (still judged by title).
- Titles only: no GTIN/MPN, so a generation or connector not in the title stays unresolved. Truncation detection is a heuristic.
- Specialised products (Sony, Logitech, Samsung) keep their original rules and price policy.

### Real response and redistribution
The real response stays **gitignored**. PricesAPI's terms (not legal advice) give no right to redistribute, so committed regression tests use synthetic titles written in the style of real listings; `live-sample.test.ts` and `tests/live-replay-shots.spec.ts` run only where the local file exists. The replay spec fixes the blank full-page screenshot (the app scrolls inside `<main>`, so `fullPage` captured one empty viewport) by sizing the viewport to the content after explicit readiness checks.

## Saved generic comparisons keep their product group

A search returns several product groups. Saving a generic comparison now records which one was picked, so reopening and refreshing compare the same product instead of pooling every group.

**Stored** (inside the existing immutable `variant` JSON of `saved_products`; no schema change, no migration): the search `query`, the group's cleaned title (`t`), the provider ids PricesAPI returns for the group (`cp` = `pid`, `cc` = `catalog_id`, `cl` = `cluster_id`), and the chosen variant (`dim_*`, `pin_*`). The group's position in the result list is never stored or used. `productKey` is unchanged, so existing rows and the uniqueness rule keep working.

**Reopen** (`getSavedComparison`, unchanged: owner-only, reads the cache, never searches, never uses quota). The client then calls `savedOffers`, which uses only the saved group's listings, judged by the saved target and variant. The same function scopes the price on the Saved list, so the list and the detail page agree and nothing about the price summary changes on reopening.

**Matching rule** (`resolveCandidate`): the saved group is found only when a group has the **identical cleaned title AND at least one equal provider id**, and carries offers. We have seen one real response only, so we do not know provider ids stay stable between fresh searches: a changed id with the same title is *not* trusted, and a similar title never is. Limitation: if ids do turn out to change on every scrape, refresh would report the product as unidentifiable; relax the rule only once that is measured.

**Explicit refresh.** The refresh still goes through `searchProducts` (12 h cache, per-user and global limits). The new result is matched to the saved identity. If it matches, the page shows the refreshed prices of the same group. If not, DealProof does not switch to another group and keeps the comparison already on screen, saying the identity could not be established. The last captured prices are kept in a per-record snapshot (next section), so a failed or unconfirmed refresh changes nothing that was saved.

**Older records.** Rows saved before this have the title but no ids. They are matched by exact cleaned title only (shown with a note), and if no stored group has that title they show a limitation and compare nothing. Sony/Logitech/Samsung rows have no candidate and behave exactly as before (every group pooled; their own rules judge each listing).

### Complete product vs accessory
A part is rejected only on specific evidence ("X only", replacement/spare, compatibility wording, "<part> for <product>", a part word before the product). A title that names a charging case but does not say whether the earbuds come with it (for example "... MagSafe Charging Case (Lightning)") is **ambiguous**: neither treated as an accessory nor assumed complete. "... with MagSafe Charging Case" is a complete product; "Replacement Charging Case" and "Charging Case Only" are accessories; "Earbuds Only" is the right product but an incomplete one.

## Saved price snapshots (last successfully captured prices)

**What is stored.** For a saved *general* product the server keeps one snapshot row per saved record in the server-only collection `saved_snapshots` (denied to every client role, like `search_cache`): the saved product group's identity, only that group's listings (at most 150 offers and about 400 KB), the feed's own observation time (`source.scrapedAt`) and DealProof's capture time. Nothing else from the search is kept: other groups' listings are not copied.

**How it is written.** Only by the server actions `captureSavedSnapshot` / `discardSavedSnapshot`, after checking that the verified caller owns the saved record. The prices are copied by the server from its own cache, never from the browser. Capture runs (1) right after a general product is saved, and (2) after an explicit refresh. It never calls PricesAPI and never uses quota. It writes nothing, and leaves the previous snapshot exactly as it was, when the saved group is not confirmed in the data, the cache entry is missing or expired, or the data was observed earlier than the saved prices.

**Reopening** reads the snapshot, so it needs no search and does not depend on the shared cache (which anyone's search can replace). The page labels the prices "Last saved prices" with the capture time and the source's observation time, and says when they are more than 12 hours old. Refresh outcomes are shown separately: *Newly refreshed prices*; *Refresh unsuccessful* (the search failed; saved prices unchanged); *Refresh could not confirm the product* (saved prices unchanged, no other group substituted).

**Deleting.** Removing a saved product asks the server to discard its snapshot, and any capture sweeps the caller's snapshots whose record no longer exists. A snapshot is never read for anyone but its owner.

**Not covered.** Sony, Logitech and Samsung records keep reading the shared cache as before (no snapshot). Older generic records have no snapshot until their first successful refresh. There is no price history and no background monitoring: a snapshot is one set of prices, replaced only by an explicit, confirmed refresh.

**Retention considerations (not legal advice).** PricesAPI's terms (https://pricesapi.io/terms, updated 1 Sep 2026) set no retention period, refresh requirement or deletion obligation for response data, and say the customer is responsible for how it stores and redistributes returned data; they neither grant nor forbid showing stored results back to the same user, and merchant content ownership is not transferred. We therefore store the minimum needed (one group's listings per saved record, owner-only, deleted with the record) and never expose it to other users or publish it. If the provider's terms change, or the owner wants a retention limit, add an expiry to `capturedAtMs`; the snapshot is already isolated in one collection for that purpose.

**Provider ids.** Group identity still requires an identical cleaned title and an equal provider id; DealProof does not assume provider ids stay stable between scrapes, which is why an unmatched group preserves the snapshot rather than guessing. Two groups with different titles save independently; groups with an identical title are one product by design (the second save reports "Already saved").

## Release readiness notes

**Real-storage integration test** (`tests/snapshot-lifecycle.spec.ts`, opt-in `DP_INTEGRATION=1`). It uses real signed-in test users, the real local record storage and the real server actions; only the one failure test stubs a response. The server-only cache is seeded with synthetic data by `tests/integration/local-cache.py` (it edits the local dev database while the dev server is stopped, never the network). Phase 1: search answered from that cache, pick a group, save through the normal confirmed mutation, capture, read the snapshot back. Then the cache is replaced (the saved group gone, a look-alike present). Phase 2: reopen shows the original offers, variant and capture time; an ambiguous refresh leaves the snapshot byte-for-byte unchanged; a new sign-in reopens it; user B is refused in the UI and on every action; removing the product deletes its snapshot. It also checks that no client, even the owner, can read or write `saved_snapshots` through the record socket.

**Schema compatibility.** `saved_snapshots` is a new collection; no existing collection or column changed (`src/schemas.lint.test.ts` pins the existing ones and runs the SDK's own `[schema-lint]` check, which reports nothing). DeepSpace's documentation says new collections are created automatically when the Durable Object starts after a deploy and existing records are kept; the local runtime did exactly that. Not verified: an actual deploy to the production app, which was not done. General product search is not in production yet, so production's saved records are the three specialised families, which are untouched.

**Data retention: decision for this release.** PricesAPI's published terms do not specify a retention period, but they also do not grant blanket rights to the underlying third-party content; the customer remains responsible for how it stores and redistributes data (this is a reading of the terms, not legal advice). The owner reviewed the terms and decided to keep the current minimal implementation without an arbitrary expiry: one selected product group's snapshot per saved comparison, the existing offer-count and size limits, observation and capture timestamps, stale-data disclosures, owner-only access, and deletion of the snapshot when the saved comparison is removed. Raw PricesAPI responses are never committed (they stay in the gitignored `experiments/price-api/out/`) and stored data is not redistributed. No further retention changes are planned for this release.
