# DealProof: submission note

**App:** https://dealproof-review.app.space (sign-in required) · **Repository:** https://github.com/ModiCodie/dealproof-review (private; reviewer access must be granted) · **Release:** #2, `main` at the latest commit listed in the repository.

## 1. What I built

DealProof compares retailer prices without comparing the wrong products. A signed-in user searches for any consumer product, picks one of up to three product groups PricesAPI returns, and sees that group's listings classified as same model, likely the same, cannot tell, different variant or different product, each with a reason. The lowest-price headline is conservative: for general products it needs at least 3 independent sellers listing the item as new with no open configuration, otherwise the page says why it cannot name a reliable lowest price. Condition and shipping stay "unknown" when not stated; every price is labelled unverified. Users can save a comparison; it keeps the chosen group and a server-side snapshot of the last successfully captured prices, so a failed or ambiguous refresh never replaces it or switches product. Three featured products (Sony WH-1000XM5, Logitech MX Master 3S, Samsung 990 PRO) have hand-written rules and free, clearly labelled demos.

## 2. DeepSpace integrations used

- **Authentication** and JWT-verified **server actions**: the only path to PricesAPI and to snapshots; identity comes from the token, never from parameters.
- **Record collections with permissions**: `saved_products` (owner-only, unique per user and product, immutable columns); server-only `search_cache`, `usage_claims`, `saved_snapshots` (all client roles denied).
- **`useQuery` / `useMutations`** with confirmed writes: the saved list, and save/remove that wait for server acknowledgement (capture runs only after the record exists).
- **Secrets store** for `PRICESAPI_KEY`; **test tooling** (test accounts, Playwright) for two-account tests on real local record storage.

Not used, deliberately: AI/LLM, payments, messaging, file storage, cron. Matching must be deterministic and explainable, and none of them improves the MVP.

## 3. Main engineering tradeoff

Correctness and explainability over coverage and convenience. Matching is title-only, rule-based and conservative because PricesAPI gives no product identifiers: when evidence is missing (no model code, unstated capacity or connector, unknown condition), the app says "cannot tell" or withholds the headline rather than guessing. The cost is that many real searches end in "not enough to determine a reliable lowest price". A second tradeoff: saved comparisons store a minimal owner-only snapshot so they survive failed refreshes, at the price of retaining third-party data whose retention terms PricesAPI does not specify (kept minimal, no expiry, not legal advice).

## 4. What the coding agent implemented

Claude Code (Claude Sonnet 5.5 for the later work) wrote the code, tests and documentation under my direction over five working days: PricesAPI client, cache and quota, the matching/anomaly/condition engine, candidate selection, comparison and saved-product UI, schemas, server actions and snapshot logic, unit and Playwright suites (326 unit, 44 browser, 10 opt-in skipped), the redesign, and the docs. I set scope and made the product decisions in the briefs (for example: no automatic paid requests, flagged prices are warnings not exclusions, no price history, conservative price summary, keep the snapshot design without an expiry).

## 5. What I independently verified

- On the live site, by hand, after release #2: production authentication; Samsung demo and variant switching; a real general PricesAPI search; candidate selection and conservative comparison; saving and reopening; persistence after signing out and back in; refreshing saved prices from the cache; cross-account isolation through Saved and direct URLs; removing a comparison and confirming its old URL is inaccessible.
- Reviewed each stage's report and approved or corrected it; submitted the DeepSpace bug report for the first app's deploy (id `8d11d4c4-e418-40eb-9912-3348a9cef234`).

Reported but **not** independently reproduced by me (agent results): the automated suites, TypeScript/ESLint/build, the local two-phase integration test of the snapshot lifecycle, and the read-only post-deploy checks (release ledger, byte-identical asset hashes, clean logs). See [`production-release.md`](production-release.md).

## 6. What remains unfinished or limited

- **Matching** is title-only: no GTIN/MPN, so a general match is at best "likely"; ambiguous variants and unknown condition are set aside, not resolved. Vague searches are refused. Some products have no good candidate (3 groups per search, US feed).
- **Prices** are feed-reported and unverified; no history, monitoring or alerts. The 60% low-price rule is a heuristic.
- **Snapshots** cover general-search saves only; the three featured products and older generic saves read the shared 12-hour cache.
- **Data rights.** PricesAPI's terms set no retention period but grant no blanket rights to underlying third-party content; I kept data minimal. The three featured-product demos embed captured PricesAPI results (also in the public bundle); I have not confirmed redistribution permission.
- **First deployment.** The original app (`dealproof`) was left in a platform-side release-reconciliation state and reported to DeepSpace; I left it untouched. The same code was deployed as a fresh app, `dealproof-review`, which is the submission URL. Root cause of the original failure is not established.
- Tested in headless Chromium (desktop, 390 px) and by hand in my own browser only; no license file.
