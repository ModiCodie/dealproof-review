# Day 3: product matching and explainable comparison

Status: implemented and tested locally. **Not deployed** (platform blocker, see `docs/deployment-issue.md`). No new PricesAPI calls were made on Day 3 (0 credits); everything uses the real Day 1 data saved in `tests/fixtures/real-*.normalized.json`.

## 1. Architecture

```
SearchResult.candidates[].offers  (normalized, from Day 2)
        │  flattened + de-duplicated
        ▼
src/lib/matching/
  text.ts        normalize untrusted titles (NFKC, strip zero-width, lowercase, length cap)
  families.ts    per-product rules + verified part numbers  -> MatchDecision
  condition.ts   condition words in title                   -> new/used/refurbished/open_box/unknown
  seller.ts      domain vs platform vs named seller vs first-party (evidence only)
  anomalies.ts   unusually-low-price flag (median rule)
  compare.ts     orchestration -> Comparison (sections + cheapest + notes)
        ▼
src/components/comparison/ComparisonView.tsx   (presentation only)
```

The module is pure TypeScript: no network, no storage, no randomness. It runs in the browser on already-fetched offers, so the backend, auth, cache and quota from Day 2 are unchanged and no new service exists.

## 2. Classification rules

| Class | Meaning |
|---|---|
| EXACT | Model and every relevant variant attribute are stated and agree with your choice |
| LIKELY | Strong evidence, but a relevant attribute is not stated (e.g. heatsink, Mac/standard edition) |
| AMBIGUOUS | Not enough information, or the title contradicts itself (several models/sizes) |
| DIFFERENT_VARIANT | Same product family, different configuration (grouped by variant) |
| REJECTED | A different product (EVO vs PRO, XM4, earbuds, MX Master 3) or an accessory |

Variant dimensions: Sony: none (colour is cosmetic). Logitech: edition standard / Mac / Business. Samsung: capacity 1/2/4 TB, heatsink with/without.

**Verified part numbers** (read from Samsung's own pages on 2026-11-19, the only ones used): `MZ-V9P2T0B/AM` = 2TB without heatsink; `MZ-V9P2T0GW` = 2TB with heatsink; the bare `MZ-V9P2T0` gives 2TB but not the heatsink. Logitech `910-…` and other Samsung codes (e.g. `MZ-V9P2T0CW`) appear in listings but were **not** verified against a manufacturer page; they are shown as "not verified" evidence and never change a decision.

Safety rules in the rules: several models or sizes in one title → AMBIGUOUS; a part number that contradicts the words → AMBIGUOUS; accessory wording → REJECTED; a headphones-plus-extras bundle → LIKELY with a note.

## 3. Why deterministic rules, not an LLM

The identifying vocabulary is small and closed (three products), so fixed rules are enough; every decision can list its evidence and be reproduced and tested byte-for-byte; and an LLM would add cost, latency, nondeterminism and a prompt-injection surface (titles are attacker-influenced text). The real gaps (no GTIN, no per-offer condition, no seller type in the feed) are missing *data*, which a model cannot invent honestly. The cost: every new product needs hand-written rules.

## 4. How uncertainty is represented

- No percentages. A class plus a reason and an evidence list (attribute, value, supports/conflicts/info, from title/part number).
- Condition defaults to **unknown**; silence is not "new". Conflicting words (e.g. "new" + "open box") → unknown. Unknown-condition offers can be compared but the result is labelled **provisional**.
- Availability: in stock / out of stock / backordered / unknown. Backorder and out-of-stock offers are shown but can never be the cheapest pick.
- Seller: first-party is `yes` only with evidence (brand store whose seller matches; Walmart `selectedSellerId=0`, an *observed, undocumented* convention). Best Buy, Amazon, Newegg, Target are treated as also hosting third parties, so the retailer name alone is `unknown`. "Walmart - X" is a third-party seller, "DoorDash - Best Buy US" is a delivery reseller.
- Match confidence and price verification are separate fields. Every offer has `priceCheck: 'not_independently_checked'`; an EXACT match never upgrades it.
- Shipping: `null` renders "Not provided" (never free). Missing source time is flagged.

## 5. Grouping and comparison

1. Analyze each offer; merge identical listings (same seller, same listing page ignoring tracking parameters, same price, same title). Different sellers on the same marketplace stay separate.
2. Flag low prices: below **60% of the median** of the comparable group, only with ≥ 6 priced listings. This is a heuristic tuned on Day 1 data (70% would have flagged a legitimate $169.99 Best Buy price). Flagged offers move to "Unverified low prices — check before trusting" and are **not hidden or called fraud**.
3. Sections (each offer in exactly one): comparable, price needs checking, ambiguous, different variants (grouped by variant), second-hand, different products.
4. Comparable = EXACT/LIKELY, new-or-unknown condition, not flagged. **Cheapest** = lowest priced, in-stock comparable offer, shown with caveats (condition, seller, shipping, time, "price not independently checked", cheaper flagged offers).
5. No "good deal" claim anywhere: there is no price history.

## 6. Real-data results (fixtures from 19 Nov 2026)

| Product | Offers | After de-dup | Comparable | Price check | Ambiguous | Second-hand | Different variant | Rejected |
|---|---|---|---|---|---|---|---|---|
| Sony WH-1000XM5 | 69 | 69 | 55 | 7 | 4 | 1 | 0 | 2 |
| Logitech MX Master 3S (standard) | 142 | 83 | 67 | 2 | 2 | 0 | 12 (Mac 10, Business 2) | 0 |
| Samsung 990 PRO 2TB without heatsink | 118 | 118 | 11 | 1 | 8 | 2 | 40 | 56 |

Examples: 990 EVO Plus and 1TB/4TB drives never enter the 2TB comparison; the heatsink listings form their own group; "2 TB SSD Game Hard Drive - Samsung - 990 PRO 1TB" is AMBIGUOUS; "MX Master 3 3S" is AMBIGUOUS; Reverb $115/$129 Sony listings are flagged but still visible. For Samsung most listings are LIKELY, not EXACT, because titles rarely say whether there is a heatsink and the part-number suffixes seen (`…CW`) are unverified. That is intended.

## 7. Tests

`src/lib/matching/matching.test.ts` (60 tests) covers all 18 required cases plus real-fixture tests; `src/components/comparison/ComparisonView.test.tsx` (2) checks the rendered wording (no "verified price" claim). Day 2's 57 tests are unchanged and pass. Command: `npx vitest run`.

## 8. Limitations

- Three products only; each new product needs rules and verified identifiers.
- Titles are the only evidence. Sellers can write misleading titles; rules reduce but cannot remove that risk.
- The 60%/n≥6 anomaly rule is a heuristic and can miss a bad price that is not low, or flag a real clearance.
- The feed has no per-offer timestamp, condition or shipping cost; these show as unknown / not provided.
- Seller handling covers a fixed list of domains; unknown sites are `unknown`.
- The Walmart first-party signal is observed, not documented.
- The saved sample is historical (19 Nov 2026) and must not be read as current prices.
- Nothing was verified on the live site (not deployed).

## 9. What you should verify yourself

1. Run `npx vitest run`, `npx tsc --noEmit`, `npx eslint src`, `npx vite build`.
2. `npm run dev`, sign in, open `/search`, load each saved sample, and read the sections. Check 2–3 "Same model and variant" listings by opening their links against the title.
3. Switch the Samsung heatsink/storage pickers and confirm the groups move.
4. Confirm the two Samsung part numbers on the pages cited in `families.ts`.
5. Judge whether the 60% rule feels right for the flagged examples.

## 9b. Deployment status

Unchanged and **unresolved**: see `docs/deployment-issue.md`. Not marked successful.


---

# Day 3.5 refinements

Scope: correctness and clarity only. No new features, no new API calls (0 PricesAPI credits), no backend changes.

## A. Price-anomaly baseline (replaces the Day 3 rule)

The threshold is unchanged: a price is flagged when it is **below 60% of the baseline median**. What changed is how the baseline is built (`src/lib/matching/anomalies.ts`):

1. **Same product and variant only.** EXACT matches form the baseline. LIKELY matches (variant not stated in the title) are added only if EXACT matches alone give fewer than six independent sellers, and the explanation then says "includes listings whose variant is likely, not confirmed". Other capacities, editions, heatsink versions, different products and ambiguous listings never enter.
2. **Condition.** Used, refurbished and open-box listings are excluded. New *and unknown* are kept (unknown is not converted to new; it simply is not known to be different). Prices in different currencies are never mixed.
3. **One observation per independent seller.** Listings are first de-duplicated (Day 3 rule). Then all listings from one seller collapse into that seller's median price. A marketplace seller counts only if the feed names them (`eBay - alice`); an unnamed marketplace listing (`eBay`) could be many different people, so it is not counted as an independent seller (it is still assessed against the baseline).
4. **At least six independent sellers.** Otherwise every offer in the group gets **"Insufficient evidence to judge whether this price is unusual"**, which is a different state from "not unusually low". Nothing is flagged and nothing is called normal.
5. **Wording of a flag:** "Unusually low price — 42% below the comparable-offer median ($X, from N independent sellers). Verify the listing before buying. This flags an anomaly, not fraud." Flagged offers stay in a visible section. (Superseded by the final decision below: a flagged offer is still eligible for the lowest reported offer.)

**Why independent sellers matter.** In the Day 3 rule, a retailer listing the same item eight times counted eight times. In a test, one seller with eight $100 listings against five $300 sellers made the old median $100, so the cheap seller could never look unusual and could even define "normal". With one vote per seller the baseline is $300 and the $100 listings are flagged.

**Limits.** 60% is a tuned heuristic, not a statistic. The offer under test contributes to its own baseline (minor at n >= 6). Unknown-condition listings stay in the baseline, so a refurbished item with no condition wording can pull it down. A long tail of expensive small resellers can pull it up.

### Before and after on the real fixtures (19 Nov 2026 data)

| Product / variant | Day 3 median (all matching listings) | Day 3 flagged | Day 3.5 baseline | Day 3.5 flagged | Change |
|---|---|---|---|---|---|
| Sony WH-1000XM5 | $281.47 (62 listings) | 7 | $292.91 (38 independent sellers, EXACT only) | 10 | **+3 flagged**: Best Buy $169.99, TikTok Shop $169.99, Mercari $170 |
| Logitech MX Master 3S, standard | $109.99 (69 listings) | 2 | $99.99 (10 independent sellers, EXACT only) | 1 | **-1**: Mercari $65 no longer flagged (65% of median); AZ Discount $59.99 still flagged |
| Samsung 990 PRO 2TB, no heatsink | $537.32 (12 listings) | 1 | $529.17 (11 sellers, includes likely matches) | 1 | none |
| Samsung 990 PRO 2TB with heatsink | $545.47 (45 listings) | 4 | $531.65 (28 sellers, EXACT only) | 4 | none |

**The Best Buy $169.99 example is a knife-edge, and this is the honest reading.** It was 60.4% of the Day 3 median (not flagged) and is 58.0% of the independent-seller median (flagged, 42% below). Nothing about the listing changed; the better baseline simply moved the median from $281 to $293 because the 38-seller baseline has a long tail of pricier small resellers. The flag does not say Best Buy's price is wrong. It says it is far below what most independent sellers charge, which is a prompt to check, and the listing remains visible with its link. I did **not** change the 60% threshold to make this example pass. If you judge that a flagged legitimate big-retailer price is a clear problem, the options are a lower threshold (for example 50%), treating well-known first-party retailers separately, or a margin of tolerance around the line. Each needs a decision from you; I have not made it.

(Superseded: see the final decision below for how the lowest-price box treats flagged offers.) Samsung 4TB (too few sellers) now shows "Insufficient evidence" instead of silently passing.

## B. Match, purchase details and price are three separate things

| Dimension | Question | Values shown |
|---|---|---|
| Product match | Is this the product and variant I chose? | Same model and variant / Likely the same, some details missing / Cannot tell / Different variant / Different product, each with a reason |
| Purchase details | What do we know about this offer? | Condition (new per title / used / refurbished / open-box / **unknown**), availability (in stock / out of stock / backordered / unknown), seller with its evidence, shipping (**Not provided** is not free) |
| Price | Has the price been independently checked? | Always "Not independently verified (API-reported price)", plus "Source observation: <feed time>" and the anomaly signal |

`OfferAnalysis.priceVerification` has exactly one possible value, `api_reported_not_verified`. There is no defensible mechanism today that attaches checking evidence to a specific offer (Day 1's manual checks were for a handful of listings, and the feed has no per-offer timestamp), so "independently checked" and "unable to verify" are deliberately not implemented. An EXACT match never changes the price label (tested).

**Summary wording.** The lowest-price box first read "Lowest listed price among matching in-stock listings" (renamed in the final decision below). The section "Comparable offers" is now "Matching listings" with a note that condition, seller and checkout cost can still differ. A dynamic sentence says how many listings were found, how many entered the comparison, and why the others did not, for example (Samsung fixture): "We found 118 listings, and 12 entered this comparison as matching the product and variant you chose, 1 of them flagged for an unusually low price. The rest were set aside: 40 are different variants; 56 are different products or accessories; 8 have too little information to tell; 2 are used, refurbished or open-box." The numbers come from the classification counts (`summarizeFiltering`), not from text.

## C. API limitations that still apply

No per-offer timestamp (one feed time for the whole search), no condition field, no shipping cost (free text only), no seller type or GTIN, and `delivery_info` is often missing. Matching therefore relies on titles. DealProof can label a price "API-reported"; it cannot say it is the retailer's current price.

## D. Tests (Day 3.5)

142 tests, all passing: Day 2 (57, unchanged), `matching.test.ts` (56; the four Day 3 anomaly tests were replaced), `price-baseline.test.ts` (24, new: independent sellers, duplicates, same-seller repetition, marketplace sellers, different variants, unknown/second-hand condition, fewer than six sellers, extreme outliers, currencies, the Best Buy boundary, before/after on all three fixtures, dynamic summary), `ComparisonView.test.tsx` (5: three-part layout, plain language, no confidence overstatement, summary from real counts, flag wording). `tsc --noEmit`, `eslint src` and `vite build` are clean.

## E. Deployment (latest check, 2026-11-20 00:06 UTC)

Unchanged. See `docs/deployment-issue.md`.

## F. What to verify manually

1. `npx vitest run`, `npx tsc --noEmit`, `npx eslint src`, `npx vite build`.
2. In the app, load the Sony saved sample. Open the "Unusually low prices" section. Open the Best Buy $169.99 link and judge whether the flag feels fair; decide whether you want to change the threshold or treat big retailers differently.
3. Load the Samsung sample, pick 4TB, and confirm the "Insufficient evidence" wording appears and nothing is called normal.
4. Read one offer card and confirm you can tell apart the match, the purchase details, and the price line.
5. Confirm no page text says "best deal", "verified" (about a price) or "guaranteed".


---

# Day 3.5 final decisions and verification

## 1. Why the 60% threshold stays

The Best Buy $169.99 listing moved from 60.4% of the Day 3 median to 58.0% of the independent-seller median. Nothing about the listing changed; a better-built baseline moved the median. Lowering the threshold only to un-flag one listing would tune the rule to a single example and would silently change every other product's results. It stays at 60%, it stays a heuristic ("unusually low compared with other listings", not a statistical guarantee, not evidence of a problem), and the page says so next to every flag. Large retailer domains are **not** exempted or trusted automatically (Best Buy is still marked "also hosts third-party sellers; the feed does not say who sells this").

## 2. Anomaly detection is separate from price-comparison eligibility

| Question | Decided by | Effect of a low-price flag |
|---|---|---|
| Is the offer the right product and variant? | matching rules | none |
| Is it eligible for the lowest reported offer? | match class (exact/likely), condition (new or unknown, not used/refurbished/open-box), availability (in stock), has a price | **none**: a flagged offer stays eligible |
| Is its price unusual compared with other sellers? | independent-seller median, 60% rule, at least six sellers | shows a visible warning next to the offer |

So the primary box is **"Lowest reported matching offer"**. If that offer is flagged, the warning sits inside the box ("Unusually low compared with other listings — 61% below the median of 38 independent sellers ($292.91). This is a rule-of-thumb comparison (flagged below 60% of the median), not evidence of a problem with the listing and not a guarantee of a good deal. Check the listing details before buying."), and the **lowest matching offer without a flag** is shown underneath as a secondary reference. Still excluded: other variants and products, ambiguous matches, used/refurbished/open-box, and anything out of stock, backordered, availability-unknown or without a price. The unknown-condition, shipping and "not independently verified" caveats are listed in the box. Match class and price verification remain separate fields.

Language changes: "Unusually low compared with other listings" replaces "Unusually low price ... verify the listing". Section title: "Unusually low compared with other listings". Page text is tested to contain none of: best deal, great deal, guaranteed lowest, verified lowest/cheapest/price, suspicious, scam, fraud.

### Results after the adjustment (real fixtures, 19 Nov 2026)

| Product / variant | Lowest reported matching offer | Flagged? | Lowest unflagged (reference) | Flagged listings |
|---|---|---|---|---|
| Sony WH-1000XM5 | $115.00, Reverb (in stock) | yes (61% below) | $181.15, eBay | 10 (unchanged from the Day 3.5 baseline; includes Best Buy $169.99, which is in stock and eligible) |
| Logitech MX Master 3S, standard | $59.99, AZ Discount USA (in stock) | yes | $65.00, Mercari (condition new per its title; edition not stated, so a likely match) | 1 |
| Samsung 990 PRO 2TB, no heatsink | $279.99, PayMore North Raleigh (in stock) | yes (likely match) | $460.80, directmacro.com | 1 |

(The independent-seller medians and the flag sets are exactly the Day 3.5 values; only which offer is *headlined* changed. Backordered and out-of-stock listings, for example Samsung $376.95 out of stock, never headline.)

## 3. Browser verification (actually run)

Tool: DeepSpace's supported tooling, `npx deepspace test run e2e` (Playwright, headless Chromium, local dev server on port 5199 because 5173 was already in use), signed in with a dedicated DeepSpace test account (`dealproof-qa@deepspace.test`, created with `deepspace test accounts`, password generated and never printed). Spec: `tests/dealproof.spec.ts` (8 tests). Screenshots: `docs/screenshots/` (12 files, desktop and 390x844).

No PricesAPI call was possible: only saved samples were used; the loading/error/empty tests answer the search request from a network mock and never let a request reach the real action; every test asserts that no request to `pricesapi.io` and no real `searchProducts` request was made.

| # | Check | Result |
|---|---|---|
| 1 | Signed out: `/search` is protected (no search form, sign-in shown) | passed |
| 2 | Signed in: navigation, user chip, search page, saved-sample picker | passed |
| 3 | Sony sample: sample banner, generated filter summary, lowest reported offer + visible flag + unflagged reference, neutral flag wording, three-part offer card, unknown condition and "Not provided" shipping labels, explanation panel, retailer links (`target=_blank`, `rel` noopener+nofollow, bestbuy.com link present), no overclaiming words in visible text, no horizontal overflow | passed |
| 4 | Logitech sample: edition selection (standard, Mac, Business) regroups offers; Mac-edition exact match and "likely" matches that name no edition | passed |
| 4b | Switching samples resets product and variant pickers | passed (after a fix, see below) |
| 5 | Samsung sample: capacity and heatsink pickers; "likely" for unstated heatsink; heatsink variant shows exact matches; 4TB shows "Insufficient evidence" and no low-price section | passed |
| 6 | Loading state (spinner, disabled button), mocked error, limit-reached error with retry time, empty result, client-side validation (no request sent) | passed |
| 7 | Mobile 390x844: no horizontal scroll on idle, Sony and Samsung views; offer card inside the viewport | passed |

Also run: the template smoke and API suites (8 passed). `collab.spec.ts` skipped itself (needs two test accounts).

**A real bug was found by this test and fixed:** loading a second saved sample kept the first product's variant state (Samsung after Sony showed no Samsung pickers) because the comparison component was reused. It is now keyed on the query and observation time, with a regression test. Two of my own first-run test assumptions were also wrong (not UI bugs): a Reverb listing does provide shipping text, and for the Mac edition the cheapest card is a "likely" match. A cosmetic fix: the wrapped "Same model and variant" pill is now one block, and warning text uses the normal foreground colour for contrast.

**Not verified:** the live deployed site (blocked); real, non-mocked live search through the browser (would spend credits); other browsers (only Chromium); screen readers; the collab spec; tablet widths.

## 4. Automated results

144 unit tests (7 files, all passing: Day 2 57, matching 56, price baseline 26, UI render 5, in `vitest`), 8 browser tests, 8 template smoke/API tests. `tsc --noEmit`, `eslint .` and `vite build` clean. No PricesAPI requests were made; no key value appears in the repository, test output or logs.

## 5. Deployment bug report

Prepared, **not yet submitted**. The CLI only shows its confirmation prompt when it has an interactive terminal; in an automated shell, running it without `--yes` would send without asking. So the submission has to be run by you in a real terminal. See `docs/deployment-issue.md`.

## 6. Remaining limitations

Title-only matching; no per-offer timestamp, condition or shipping cost in the feed; the 60% rule is a heuristic and is sensitive near the line (Best Buy $169.99); unknown-condition listings stay in baselines; a flagged offer can be the headline price, so the warning and caveats matter; the live deployment is unverified and blocked; browser coverage is Chromium only.

## Day 4 follow-up (see `docs/day4-implementation.md`)

The "Lowest reported matching offer" box now also shows the match label (a likely match is labelled "Not confirmed as the exact variant"), condition, availability, shipping, price-verification status, observation time and the retailer link. The collapsed "Before you rely on this" list holds the remaining caveats. Matching rules, the 60% rule and eligibility are unchanged.
