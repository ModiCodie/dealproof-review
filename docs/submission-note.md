# DealProof: submission note

Draft for the owner to review and edit. Lines marked **[CONFIRM]** are things only the owner can attest to; delete or change them if they are not true.

**Repository:** https://github.com/ModiCodie/dealproof (currently private) · **App URL:** https://dealproof.app.space

## 1. What I built

DealProof is a price-comparison app whose point is *not comparing the wrong products*. For three products (Sony WH-1000XM5, Logitech MX Master 3S, Samsung 990 PRO) it searches retailer offers, classifies each listing as the same model and variant, a likely match, ambiguous, a different variant or a different product, and shows the lowest reported matching offer with everything it cannot verify (condition, shipping, price accuracy, data age). It flags unusually low prices as a rule of thumb, not as fraud, and lets a signed-in user save a product and exact variant and reopen the last stored comparison.

## 2. DeepSpace integrations used

- Authentication: protected routes, JWT-verified server actions.
- Record collections with permissions: `saved_products` (owner-only via `userBound`/`ownerField`/`own`, unique per user and product, immutable columns); server-only `search_cache` and `usage_claims`.
- `useQuery` / `useMutations` for the saved list.
- Server actions: `searchProducts` (the only path to the PricesAPI) and `getSavedComparison`.
- Secrets store for the PricesAPI key.
- DeepSpace's test tooling: test accounts and Playwright fixtures.

External data: PricesAPI (Search endpoint).

## 3. Main engineering tradeoff

Correctness and explainability over coverage. I used deterministic, rule-based matching instead of an LLM, so every decision has a stated reason and a test, at the cost of supporting only three products and trusting listing titles. A second tradeoff: saved products store a small bookmark row, not a copy of the prices, so a saved product reopens with the *latest* stored data for its search rather than a snapshot.

## 4. What the coding agent implemented

Claude Code (Claude Sonnet 5.5 for the later days) wrote essentially all of the code, tests and documentation under my direction across five working days: the PricesAPI client, cache and quota logic, the matching and anomaly engine, the comparison and saved-product UI, the schema and server actions, the Playwright suites, and the docs. I set the scope, reviewed each day's report and made the product decisions recorded in the briefs (for example: keep the 60% rule unchanged, flagged offers stay eligible for the headline, no automatic paid requests, disable saving for demo samples). **[CONFIRM the level of review you actually did.]**

## 5. What I personally verified

Only the following is something I did myself or have direct knowledge of: **[CONFIRM / EDIT every line]**

- I ran the `deepspace feedback` command and submitted the deployment bug report myself (reference `8d11d4c4-e418-40eb-9912-3348a9cef234`).
- I reviewed the daily reports and approved moving to the next day.
- **[CONFIRM or delete]** I opened the app locally and tried search, variant selection, saving and reopening: *(write exactly what you did)*.
- **[CONFIRM or delete]** I checked the saved-product behaviour with two accounts myself: *(only if true)*.

Verification that the coding agent performed, which I am reporting but did not independently reproduce: 169 unit tests, 31 Playwright tests (including a two-account permission test with forged write attempts against real local record storage), TypeScript, ESLint and build checks, and zero PricesAPI calls in the final test runs.

## 6. Unfinished features and known limitations

- **Not fully deployed.** The first `deepspace deploy` left the app in a release-reconciliation state: the control plane reports "never deployed" with 0 releases, while https://dealproof.app.space serves an older build. I reported it to DeepSpace (id above); there is no response yet. Production authentication, server actions and saved-product persistence are therefore **unverified**; all verification was local. I did not undeploy, re-create or change the app identity.
- Three products only; title-only matching; prices are feed-reported and never independently verified; condition and shipping are mostly unknown.
- The 60% low-price rule is a heuristic and sensitive near the line.
- Saved products are bookmarks of the latest stored data, not snapshots, and there is no monitoring or alerting by design.
- Tested in Chromium at desktop and 390 px only.
- Demo samples cannot be saved (they are not stored server-side).
