# Day 5 final audit

## Workflow correctness (Sign in -> Search -> Variant -> Compare -> Warnings -> Save -> Reopen -> Remove)

Every row cites automated evidence (local dev server, mocked prices) unless noted. None of it is production evidence.

| # | Property | Evidence |
|---|---|---|
| 1 | Product and variant stay selected | e2e `saved-products` 2 (reopened 4TB + heatsink shows exactly that, picker locked), `dealproof` 4b (switching samples resets pickers); unit `saved.test.ts` key/round-trip |
| 2 | Variants never mixed | `matching.test.ts` (56), e2e `dealproof` 4/5 (Logitech edition, Samsung capacity/heatsink regroup) |
| 3 | Unknown stays unknown | `ComparisonView.test.tsx`, e2e `dealproof` 3 ("Condition unknown", "Shipping: Not provided") |
| 4 | Low-price flag is not fraud | wording tests: "rule of thumb", "not evidence of a problem", no "scam/fraud/suspicious" |
| 5 | Exact match is not a verified price | every offer and the headline say "Not independently verified"; `priceVerification` has one possible value |
| 6 | Likely keeps its label | unit + e2e `saved-products` 9 (live and reopened) |
| 7 | Saved records belong to the right user | e2e `saved-products` 12, two accounts, real record storage |
| 8 | Reopen costs nothing | e2e 4 and 6 (zero search requests), unit test: action never references the upstream client or quota |
| 9 | Stale data labelled | e2e 5, observation and storage times with ages |
| 10 | Retailer links safe | only http(s) URLs kept (`normalize.ts`); links use `target=_blank rel="noopener noreferrer nofollow"`; asserted in unit and e2e |
| 11 | Understandable errors | e2e `dealproof` 6: loading, error, rate limit, empty, validation |

Day 5 change: saving from bundled demo samples is disabled with an explanation (tested in `dealproof` test 3), so a saved item can no longer be created that can never be reopened.

## Publication audit (repository still private; nothing changed)

- **Secrets:** the PricesAPI key does not occur in any commit in all history or in tracked files; no JWT/private-key shapes in history; `.dev.vars`, `.deepspace`, test-account stores, raw experiment output (`experiments/price-api/out/`) and `Agent.md` are git-ignored and were never tracked.
- **Screenshots:** 28 PNGs; they show only the test account display name "DealProof QA" and fixture retailer data. No emails.
- **Fixtures:** real PricesAPI results (public retailer titles, prices, URLs, seller names) with no personal data found by pattern search. **Not checked:** PricesAPI's terms on redistributing its data in a public repository. Please check before publishing.
- **Author metadata:** all 9+ commits carry the owner's personal Gmail address as author and committer. See the options in the final report.
- **License:** none. A public repo without a license is "all rights reserved"; the owner must choose one.
