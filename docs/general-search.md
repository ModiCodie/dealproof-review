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
