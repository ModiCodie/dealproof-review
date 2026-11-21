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
