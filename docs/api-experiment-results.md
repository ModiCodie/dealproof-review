# PricesAPI experiment results

Run on 2026-11-19 by the user (market `us`, free Personal plan), using `experiments/price-api/run.mjs`. I analysed the saved responses afterwards. Full responses are in `experiments/price-api/out/raw/` (gitignored). Truncated copies are in `experiments/price-api/examples/`.

## Recommendation: CONDITIONAL GO (provisional)

Current multi-retailer comparison is feasible, with caveats. Historical prices are too sparse to build a feature on. After the manual verification round (sections 10 to 14, added 2026-11-19), the recommendation stays **CONDITIONAL GO**, with a narrower product scope: verified, variant-aware offer comparison with explicit trust labels, and no deal-quality or "historic low" claims. Details and the MVP are in section 13.

**Why not full GO:**
- Search offers carry no per-offer timestamp, only one batch-level `scraped_at`.
- The documented 1-credit refresh (Snapshot) returned stale stored data, so there is no cheap way to refresh live prices.
- History was empty or near-empty.
- Condition is missing on every offer.
- Prices include implausible low outliers.

**Why not PIVOT:**
- Retailer coverage is large (at least 9 distinct retailers per product, 33 to 56 for Sony and Logitech).
- URLs and currency are present on every offer.
- Wrong-model offers were rare and easy to separate by title.

## 1. Credits and requests

Total spent: **35 of 60 credits**. The ledger shows 3 catalog calls (0 credits), 3 searches (30), 3 snapshots (3) and 2 history calls (2). No errors and no retries. Search latency was slow: 20.6 s, 42.5 s and 31.0 s (cache_source `miss`, which I read as a live scrape). Snapshot responded in about 0.3 s.

## 2. Results per product

Counts come from title-based classification (`match` / `variant` / `ambiguous` / `mismatch`). Offers are the union of the 3 candidates returned by Search (deduplicated by URL). "Verified comparable" means an exact match with price, currency and URL, in stock, not stale and not a price outlier (under half or over double the median). It is **not** a statement that the price was confirmed at the retailer.

| | Sony WH-1000XM5 | Logitech MX Master 3S | Samsung 990 PRO 2TB |
|---|---|---|---|
| Candidates returned (all correct model unless noted) | 3 (18, 11, 40 offers) | 3 (22, 60, 60 offers) | 3: **990 EVO Plus 1TB (wrong), 990 PRO 2TB w/ Heatsink, 990 Pro 4TB (wrong)** |
| Total offers | 69 | 83 | 118 |
| Match / variant / ambiguous / mismatch | 61 / 1 / 0 / 7 | 69 / 12 / 0 / 2 | 11 / 35 / 3 / 69 |
| Distinct retailers (matched) | 42 | 59 | 10 |
| Verified comparable (offers / retailers) | 48 / 33 | 65 / 56 | 10 / 9 |
| Price range among verified (USD) | 115 to 535.62 (median 276) | 59.99 to 259.99 (median 107.34) | 279.99 to 669.99 (median 529.17) |
| Lowest verified comparable (not independently confirmed) | $147.26 Walmart (after excluding two outliers at $115 and $129, both Reverb) | $59.99 azdiscountusa.com (page lists 59.99, see section 4) | $279.99 northraleighnc.paymore.com (page blocked, unconfirmed) |
| Currency | USD on all offers | USD on all offers | USD on all offers |
| Listing URL present | 100% | 100% | 100% |
| Missing `delivery_info` | 13 of 69 | 11 of 83 | 15 of 118 |
| History (7 days, 2026-11-12 to 11-18) | 2 days with data (11-14 and 11-16), 26 offers | **0 days**, 0 credits | not requested |

### Matching and variants
- **Sony:** about 90% of offers are exact matches. Seven mismatches were titles without the model token (for example "Wireless Noise Cancelling Headphones - Silver"), which I labelled mismatch but which could be real offers with truncated titles.
- **Logitech:** the 12 variants are "for Mac" (10) and "Business" (2). Mixing these with the standard model would be wrong, and only the title tells them apart.
- **Samsung** is where the data is weakest:
  - Search's own top candidate was a different product (990 EVO Plus 1TB).
  - Of 118 offers, 69 are other capacities or models.
  - About 33 are the heatsink variant, which has its own SKU and price, so I did not treat it as the same product as the plain drive.
  - Some offers (for example Newegg "Recertified") are not new.
  - Only 11 offers are unambiguous plain 2TB, from 10 retailers. The bulk of the real matches are B2B listings (directmacro, bulkdevices, serverorbit, compudevices and similar).
  - Manufacturer part numbers (MZ-V9P2T0**B**W, **C**W, **G**W) appear in titles and would give a firmer identity than keywords, but I did not implement that.

## 3. Freshness, shipping, condition

- **Search offers:** no per-offer `observed_at`. The only timestamp is `meta.scraped_at` (cache_source `miss`, so a live scrape at request time) and `meta.cache_age_s`. Search offers do include `stock_status`, `delivery_info` (free text, sometimes with a dollar amount such as "Delivery $21.49") and `url`.
- **Snapshot offers have per-offer `observed_at`, but the data was old:**
  - Sony: observed 2026-11-16 (about 92 h old, `stale: true`, threshold 26 h).
  - Logitech: observed **2026-03-20 (about 8 months old)**.
  - Samsung: `state: unobserved`, **0 offers**, even though Search returned 55 offers for that same product.
  - **Consequence:** Snapshot reads stored observations, not a live fetch. It is not a cheap way to refresh prices. The only live source I observed is Search at 10 credits.
- **Shipping:** no cost field. It exists only as free text in `delivery_info`, and is missing on 11 to 15 offers per product.
- **Condition:** no per-offer condition field (only a `condition_label` on search candidates, which was "Pre-owned" on the Samsung EVO candidate). I inferred condition from title words. Many "matched" Sony and Logitech sellers are resale marketplaces (eBay, Mercari, Poshmark, Swappa, Back Market, Reebelo, Whatnot, Reverb, TikTok Shop; 17 for Sony, 7 for Logitech) whose items may be used even if the title says nothing. The data cannot answer that.

## 4. Spot-checks against retailer pages

Method: one plain GET per listing from the script. I picked the cheapest listing from each of up to 3 distinct retailers per product, which biases the sample toward outliers.

| Result | Count | Detail |
|---|---|---|
| Automated, price found on page | 3 | azdiscountusa.com ($59.99), poshmark.com ($75.00), bulkdevices.com ($527.71) |
| Blocked | 5 | reverb.com (403), mercari.com (403), directmacro.com (403), northraleighnc.paymore.com (429), walmart.com (HTTP 200 with bot or captcha page) |
| Inconclusive | 1 | bestbuy.com (timeout) |
| Manually verified | 0 | **Not done yet** |

The "price found" result only means the number appears somewhere in the HTML. It does not prove that is the product price. Also, the Poshmark listing title is a category-like string ("Logitech Computers, Laptops & Parts..."), which suggests a used or peer-to-peer item. Manual verification of 2 to 3 listings per product is still needed before a final GO.

## 5. Assessment against the criteria

| Criterion | Result |
|---|---|
| At least 2 of 3 products with 2+ retailers | **Met (3 of 3).** Samsung has 10 matched (9 verified) retailers. |
| Exact model and key variants verifiable | **Mostly met.** Yes for Sony and Logitech via title. Samsung needs title and part-number parsing, and heatsink and capacity must be treated as variants. No GTIN/UPC. |
| Merchant listing URLs | **Met (100%).** |
| Prices, currencies, timestamps usable | **Partly.** Price and currency are present on every offer. The timestamp is batch-level on live search and per-offer only on stale stored data. |
| Ambiguous, stale or incomplete data identifiable | **Met.** Snapshot has an explicit `stale` flag, and ambiguity is detectable from titles. Condition and shipping are only partly detectable. |
| History | **Limited, so conditional.** Sony 2 of 7 days, Logitech 0 of 7. The free Catalog for Samsung's best-matching product (id 101692746) shows retained history of only 5 days, between 2026-02-21 and 2026-03-07. |

## 6. Terms of Service

See the addendum in `docs/feasibility-plan.md`. There is no explicit licence to redistribute or publicly display the data, and nothing on caching or attribution. The risk sits with us.

## 7. What this means for the app

1. **Product definition:** prefer part numbers and match on the full variant (model, capacity, heatsink, Mac or business, condition). Never merge variants into one comparison.
2. **Show provenance:** label each price with its source time (`scraped_at`), say "prices as of ..." and flag missing shipping.
3. **Outliers and marketplaces:** hide or flag prices under about half of the median, and show marketplace or resale sellers separately.
4. **Refresh:** Search (10 credits) is the live source, and caching it matters. Snapshot cannot be trusted for freshness. The free Schedules feature (beta) might keep stored data fresh, but I have not tested it.
5. **History:** treat it as optional and show it only when there is enough data. Use the free Catalog `retained` counts to decide whether to request it (it showed 5 days of old data for Samsung without any credits spent).
6. **Capacity:** at 10 credits per search, the 3,000 free credits are about 300 searches in total, so caching is needed.

## 8. Limitations of this analysis

- Classification is keyword-based, and I have only read some of the titles by eye.
- Spot-check coverage is 9 listings, with 3 positive, 5 blocked and 1 timeout.
- One run on one day. I did not test repeatability or how much prices drift.
- The outlier rule is crude, and the "lowest verified" figures are unconfirmed until checked manually.
- Samsung History and Snapshot were not meaningfully tested (Snapshot was empty, History was not requested), so Samsung history could be better or worse than Sony's.

## 9. Reproduce

See `experiments/price-api/README.md`. A re-run with cached responses costs nothing. `node run.mjs analyze` and `node run.mjs spotcheck` need no key. The remaining budget is 25 credits.

---

# Final validation round (2026-11-19)

No new PricesAPI calls were made in this round. Everything below uses the saved responses plus plain page reads.

## 10. Manual verification of retailer listings

**Method.** The Chrome extension was not connected, so pages were read through plain HTTP page fetches (one per URL; two Best Buy URLs got one retry). Nothing was bypassed. Pages that returned a block, a bot check or a timeout are marked inconclusive. This is "accessible page content", not a real browser session, so JavaScript-rendered prices may be missing.

**Selected:** 9 listings, 3 per product, chosen to include recognizable retailers and the cheapest "outlier" offers. Then 4 more attempted for retries or extra coverage (Sony.com, two Newegg pages, Best Buy retry).

| # | Product | Retailer | API price | Page result | Verified? |
|---|---|---|---|---|---|
| 1 | Logitech MX Master 3S | logitech.com (brand store) | $79.99 USD | HTTP 200. "MX Master 3S Bluetooth Edition", colour Black, $79.99 (was $99.99, 20% off), "In stock. Ready to ship", free shipping (3 to 5 business days), free 30-day returns. Sold by Logitech. Condition not stated (brand store, so presumably new). Part number only in the URL (910-007500), not in the page text. | **Verified. Price matches.** |
| 2 | Samsung 990 PRO 2TB | samsung.com | $209.99 USD | HTTP 200. "990 PRO w/ Heatsink ... 2TB", part number **MZ-V9P2T0GW**, $209.99 for the 2TB option, "Add to cart" shown. Sold by Samsung. Condition not stated. The delivery area reads "Not Available" with no zip entered (default state, not a real result). The API said "See merchant for availability". | **Verified. Price matches. Variant is heatsink.** |
| 3 | Logitech MX Master 3S | azdiscountusa.com | $59.99 USD | HTTP 200. Title "...Bluetooth Edition... Black". Price block "$59.99, Was $99.99, 40% off". Text says "New, sealed US retail unit". Seller: "Sold & shipped by AZ Discount USA" (the retailer itself, not a marketplace). Page has phone number, 30-day free returns and a price-match policy. **Availability is contradictory:** the page shows both "In stock" and "Sold out. This item is out of stock right now". Page "Model" field reads 6633199 (the Best Buy SKU), not a Logitech part number. A promo says it expires "October 31st, 2026", already past. | **Price matches the API, but "actually purchasable" is unresolved.** Treat as an unverified bargain. |
| 4 | Sony WH-1000XM5 | bestbuy.com | $169.99 | Timed out twice (60 s each). | **Inconclusive** (link in section 12) |
| 5 | Sony WH-1000XM5 | walmart.com | $147.26 | HTTP 200 but a "Robot or human?" check page. | **Inconclusive** (bot check) |
| 6 | Sony WH-1000XM5 | reverb.com | $115 | HTTP 403. | **Inconclusive** |
| 7 | Logitech MX Master 3S | bestbuy.com | $79.99 | Timed out twice. | **Inconclusive** |
| 8 | Samsung 990 PRO 2TB | adorama.com (title says "Used ... with Heatsink") | $139 | HTTP 403. Only the URL and API title say "Used", which I could not confirm from the page. | **Inconclusive** |
| 9 | Samsung 990 PRO 2TB | northraleighnc.paymore.com | $279.99 | HTTP 429 (Retry-After 60). A second attempt earlier in the automated spot-check was also blocked. | **Inconclusive** |
| 10 | Sony WH-1000XM5 | electronics.sony.com | $198 (out of stock per API) | The fetch tool refused the domain (no HTTP status). | **Inconclusive** |
| 11 | Sony WH-1000XM5 | newegg.com | $239.99 | HTTP 403. | **Inconclusive** |
| 12 | Logitech MX Master 3S | newegg.com | $79.99 | HTTP 403. | **Inconclusive** |

**Summary:** 3 of 12 pages were conclusive (logitech.com, samsung.com, azdiscountusa.com), and **all 3 matched the API price exactly**. The earlier automated spot-check also found the price string on bulkdevices.com ($527.71) and poshmark.com ($75.00), which I did not treat as verified (no page content reviewed).

**What this does and does not show:**
- Where a page could be read, the API price was right. That is encouraging for price accuracy, but it is a small and biased sample (3 pages, two of them brand-owned stores).
- **Sony has zero verified listings.** I cannot say whether the $115 to $170 Sony offers are real. The Sony price spread ($115 to $535) is the least trustworthy part of the dataset.
- **Condition was only stated on 1 page** ("New, sealed" on azdiscountusa). The brand stores say nothing about condition.
- **Shipping was visible on 2 of 3 pages** (free on logitech.com and azdiscountusa, with a delivery window), not on samsung.com.
- No page opening failed because of a bad URL. Every failure was a bot-protection or timeout response, so the URL validity question is **unanswered**, not "all fine".
- One of the fetched pages contained text trying to give instructions to an AI agent (create a document, post to Slack). The agent ignored it and I did not act on it. Retailer pages should be treated as untrusted input in the real app too.

## 11. Audit of the title-based classifier

Evidence is from the saved search offers (69 Sony, 83 Logitech, 118 Samsung).

**Incorrectly accepted or too trusting**
- **"New" is the default.** Any title with no condition word becomes `match / new`. Only 1 of 61 Sony, 4 of 69 Logitech and 0 of 11 Samsung matched titles actually say "new" or "sealed". Resale marketplaces (eBay, Mercari, Poshmark, Swappa, Back Market, Reebelo, Reverb) make up 17 of the Sony matches and 7 of the Logitech ones. "Unknown" would be the honest label.
- **Samsung part numbers.** Titles with the bare family code `MZ-V9P2T0` (such as the $279.99 paymore listing) are accepted as a plain match, but the suffix decides the variant (the page I verified is `...GW`, with heatsink). Without a suffix it is ambiguous.
- **Stock filter bug.** "Verified comparable" only excludes titles matching out/unavail/sold. "Backordered" and "See merchant for availability" passed (5 Logitech offers). Availability should be an enum.
- **First-party vs marketplace.** The seller domain is used as the retailer identity. On Walmart, the offers come from different sellers (the URL has `selectedSellerId=0` for Walmart itself and other IDs for third parties, e.g. the $147.26 and $159.99 Sony offers are marketplace sellers, and the search shows names like "Walmart - Secondipity"). Counting "Walmart" as one retailer is wrong.
- **Outlier rule.** The median-based filter (under 50% or over 200%) flagged only 2 of 48 Sony offers (both Reverb). It missed the $147 to $160 Walmart marketplace offers, and the azdiscountusa $59.99 (the only Logitech outlier at <60% of the median) was price-correct but is a questionable bargain, so a pure price rule would drop it without learning why.

**Incorrectly rejected**
- Sony offers with "w/ Audio Cable/ Case" and "With Black Earpads" were rejected by the accessory keyword rule, though they are likely the headphones plus extras. They should be `ambiguous` (bundle), not `mismatch`.
- Five Sony offers without the model token (for example "Sony Best Wireless Noise Canceling Headphones - Platinum Silver") were rejected, but may be real XM5 listings with generic titles. They should be `ambiguous`.
- On Logitech, the title "Logitech 910-006570 Computer Mice" was rejected (model token absent), but 910-006570 is the "for Mac" part number (the Walmart title confirms it), so a part-number rule would have classified it exactly.

**Correctly handled:** 66 Samsung offers for the 990 EVO Plus and 3 for the 4TB were rightly rejected, and the heatsink split was right.

**Missing condition indicators:** "Recertified", "Reconditioned" and "Refurb" were not recognised until my later fix. Others to add: "damaged", "for parts", "as is", "B-stock", "grade A/B", "demo", "display model", "bulk/OEM", "no box", "no receiver" (a Logitech eBay listing said "No Receiver"). Seller-level signals (marketplace domains) should also set condition to `unknown`.

**Duplicates:** the same domain appears several times (11 Sony domains with 22 extra offers, 12 Logitech with 17, 29 Samsung with 45; for example eBay 7, Newegg 6 and Walmart 3 on Sony or Samsung). Some are true duplicates (the same URL in different candidates, which I removed), some are different sellers on one marketplace, and some are different variants.

## 12. Proposed deterministic matching (no ML or LLM)

Rules are enough here, because the identifying information (model names, part numbers, capacity, colour) is a small closed vocabulary that appears in titles. An LLM would add cost, latency and non-determinism without fixing the real limits: the API gives no GTIN, no condition field and no seller type. Revisit only if the rule engine leaves a large share of offers `ambiguous` on a wider product set.

1. **Product catalog (hand-written, tiny, versioned).** For each supported product keep:
   - canonical model regexes (`WH-?1000XM5`, `MX\s*Master\s*3S`, `990\s*PRO`);
   - a **part-number table** that maps to variant attributes. Seed it from manufacturer pages. From what I saw: Logitech `910-007500` (black, Bluetooth Edition), `910-006570` (for Mac), Samsung `MZ-V9P2T0GW` (heatsink). Entries I have not confirmed (for example Logitech 910-006556 and 910-006558, Samsung `MZ-V9P2T0BW` and `...CW`) must be checked on manufacturer pages before use.
   - for each product, the attributes that define identity (Sony: colour is cosmetic; Logitech: Mac or standard, Bluetooth or business; Samsung: capacity, heatsink).
2. **Extraction.** Pull from the title and URL: model token, part number (including suffix), capacity (normalised to GB), variant words, colour, bundle words (`w/`, `with`, `+`, `bundle`), condition words (extended list above), and multiple-capacity patterns.
3. **Variant key.** Build a canonical key, for example `samsung-990-pro|2000GB|heatsink=yes`. Offers are only compared inside the same key.
4. **Confidence labels, with reasons attached:**
   - `exact`: part number maps to the requested variant, or model plus every identity attribute is explicit.
   - `likely`: model plus most attributes, with one inferred (for example heatsink unspecified for a bare `MZ-V9P2T0`).
   - `ambiguous`: model token missing or multiple capacities or bundle words.
   - `different-variant`: a clearly different but real variant (heatsink, Mac, 4TB).
   - `rejected`: a different product (EVO Plus), an accessory or a wrong generation.
5. **Condition label:** `new` only if the title or page says new or sealed, `used/refurb/open-box` for the keyword list, otherwise `unknown`. A resale-marketplace seller means `unknown` at best, regardless of title.
6. **Seller identity:** key on `(domain, seller name, third-party flag)`. Mark first-party when the seller name equals the domain's brand (for example "Best Buy", "Walmart" with `selectedSellerId=0`). Keep a small allow-list of known major retailers and brand stores, and a deny/flag list of resale marketplaces.
7. **Availability:** an enum `in_stock | out_of_stock | backorder | unknown` from the API text. Anything other than `in_stock` is excluded from "best price".
8. **Duplicates:** deduplicate by normalised URL (strip tracking parameters), then keep the cheapest per `(seller, variant key)` and show the rest as a count.
9. **Outliers:** do not drop. Compute a price band from first-party `exact` in-stock offers (needs 3 or more, otherwise no band) and mark any offer under 70% of the band's low end as `unverified bargain` with the reason. Never use it as "the best price" unless it has been checked.
10. **Output of every offer:** variant key, confidence, condition, seller type, availability, price, currency, URL, `scraped_at`, and the list of reasons. The classifier must be unit-testable against the saved responses in `examples/` and `out/raw/`, which are real fixtures.

## 13. Product concept: A or B?

**Recommendation: build A, with B's signals as the headline feature** (they are one product, not two).

- **Why not A alone:** a plain cross-retailer price list would put unverified outliers (the $59.99 mouse that may be sold out, the $115 Sony) at the top, and that is exactly the failure users care about on Black Friday.
- **Why not B alone:** a "misleading listings" assistant needs the comparison data underneath, and the data supports it well (variant mixing is visible, seller type and availability can be derived).
- **What we cannot claim:** history is sparse (Sony 2 of 7 days, Logitech 0), and Snapshot data was stale, so DealProof must not say "lowest price in N days", "real deal" or "price drop". Say "lowest currently listed among verified-comparable offers" and show the retailer-advertised "was" price only as the retailer's claim.

**Smallest useful MVP for the remaining four days**
- **Day 1:** scaffold the DeepSpace app. Add a server action that calls PricesAPI Search with the key stored as a secret, and caches responses (query and market, 12 to 24 h TTL) in a DO or KV store. Add a per-user daily limit. Test the real `fetch` to PricesAPI from the worker in `dev` (the docs don't cover this pattern).
- **Day 2:** the matching module from section 12, a small catalog of about 5 products, unit tests over the saved fixtures. Seed the demo with pre-fetched results for the 3 test products so the demo does not depend on slow (20 to 40 s) live searches.
- **Day 3:** UI: search box, results grouped by variant, each offer with trust badges (first-party or marketplace, condition, availability, "unverified bargain" flag, "as of" time), a "why is this excluded" list, and a Save for later list.
- **Day 4:** polish, a limitations page, deploy, and a README describing the data limits.
- **Out of scope for the MVP:** history charts, deal scores, price alerts, URL input (Search accepts retailer URLs, but I did not test it), accounts beyond what DeepSpace gives.

**Budget:** 3,000 credits minus 35 spent leaves about 2,965, which is about 296 searches at 10 each. Cache aggressively and pre-seed the demo.

## 14. Final recommendation: CONDITIONAL GO

**GO criteria review**
- 2 of 3 products with 2+ retailers: **met (3 of 3).**
- Exact model and key variants verifiable: **met for Sony and Logitech by title, partially for Samsung** (needs part-number rules). Not validated against retailer pages for Sony.
- Listing URLs: present on 100% of offers. Opening reliably: **not established** (blocks and timeouts on 9 of 12 pages).
- Prices, currencies and timestamps usable: price and currency yes (3 of 3 readable pages matched). Timestamps are only batch-level for live search.
- Ambiguous, stale or incomplete data identifiable: **yes**, given the rules above, with condition and seller type being "unknown" much of the time.

**Why not GO:** the low-price question is not settled. Sony has no verified listing, the one low-priced item I could read (azdiscountusa) shows contradictory stock, and history is too sparse to support deal claims.
**Why not PIVOT:** the data that could be checked was accurate, coverage is wide, variant mixing is detectable, and the product concept still works without history.

**How the UI should communicate the limits**
- Every price carries an "as of" time and the text "price from a retailer feed, not confirmed at checkout".
- Condition shows "Unknown" in neutral grey, not "New", unless stated.
- Third-party marketplace sellers are visibly separate from the retailer itself.
- Offers with unusually low prices appear in a separate "Unverified bargains" section with the reason, and are not ranked as the best price.
- Different variants are shown in separate groups (for example, heatsink vs no heatsink), never mixed in one price range.
- Shipping shows the retailer's text when present and "Not provided" otherwise. Never show it as free when it is missing.
- No history chart or deal verdict unless a product has enough observations, and the UI says how many days of data exist.
- Links open the merchant page, with a note that the page may show a different price or stock.

## 15. Links for manual verification (still inconclusive)

Open these in an ordinary browser and compare against the API price:
- Sony, Best Buy ($169.99): https://www.bestbuy.com/product/sony-wh-1000xm5-wireless-noise-cancelling-over-the-ear-headphones-blue/J7XSRH528S/sku/6538379
- Sony, Walmart ($147.26, marketplace seller ID 1418): https://www.walmart.com/ip/Sony-WH-1000XM5-Noise-Canceling-Wireless-Over-Ear-Headphones-Midnight-Blue/3323306909
- Sony, Reverb ($115): https://reverb.com/item/102890942-sony-wh-1000xm5-wireless-noise-canceling-over-the-ear-headphones-silver
- Sony, Sony store ($198, listed out of stock): https://electronics.sony.com/audio/headphones/headband/p/wh1000xm5-l
- Logitech, Best Buy ($79.99): https://www.bestbuy.com/product/logitech-mx-master-3s-bluetooth-edition-performance-wireless-optical-mouse-with-ultra-fast-scrolling-and-quiet-clicks-wireless-black/J7H7ZYG559/sku/6633199
- Samsung, Adorama ($139, "Used"): https://www.adorama.com/used-samsung-990-pro-2tb-nvme-pcie-40-x4-m2-internal-ssd-with-heatsink/p/us1884803
- Samsung, Paymore ($279.99): https://northraleighnc.paymore.com/products/samsung-2280mm-990-pro-2tb-m-2-nvme-gen-4-0-x-4-ssd-mz-v9p2t0-1793744577173-sf0dzofbe?store_code=NC03

Most useful to check by hand: the Sony Best Buy and Walmart listings (Sony has no verified listing yet), and whether the azdiscountusa mouse can actually be added to a cart (do not purchase).
