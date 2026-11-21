# DealProof Feasibility Plan (Phase 1: research only)

Sources: pricesapi.io docs, pricing and OpenAPI file; docs.deep.space (SDK 0.43.0); serpapi.com Google Shopping API and pricing pages. Read 2026-11-19. Pricing and some PricesAPI endpoints (Snapshot, History, Schedules) are labelled Beta and may change. Pages were read through summarising fetches and some were truncated, so re-check any figure that decides a GO before relying on it. No API requests have been made.

## 1. Selected API and reasons

**Primary: PricesAPI** (`https://api.pricesapi.io/api/v1`).
- It returns multiple retailers per product (`offers[]`) and has a first-class history endpoint, which SerpApi lacks.
- Auth is a bearer header, so the key stays server-side.
- The free "Personal" plan gives 3,000 one-time credits, enough for the 100-credit experiment with a large margin.
- Search is by text or retailer URL, which matches the "name or URL" requirement.
- Credit costs are documented per endpoint, and a free Catalog endpoint helps with planning.

**Fallback: SerpApi `google_shopping`** (free tier: 250 searches/month, 50/hr).
- It returns `price`, `extracted_price`, `source` and `multiple_sources`, but the Google Shopping page documents no currency field, shipping field, condition field, timestamps or historical prices.
- Per-product retailer lists need the separate `google_immersive_product` engine, whose docs I did not read.
- It would cover "current price compare" only. It is not a substitute for history.

## 2. Relevant endpoints and fields (PricesAPI)

Every call needs `market` (lowercase 2-letter, e.g. `us`; `gb` not `uk`). An invalid market returns a free 400 that lists supported markets.

| Purpose | Endpoint | Cost |
|---|---|---|
| Find product + offers | `GET /products/search?q=&market=&limit=&offers_limit=&max_age=&no_cache=` | 10 credits per response with at least one offer (cache hits cost the same; empty and error responses are free) |
| Free lookup of IDs and retained-history summary | `GET /products/catalog?q=&market=` | 0 |
| Re-read offers by ID | `GET /products?id=&id_type=pricesapi\|catalog&market=&offers_limit=&seller_domains=` | 1 per product (not-found and failed reads are free) |
| Many products | `POST /products/batch` (up to 100 items) | 1 per product returned; full count reserved up front |
| History | `GET /products/history?id=&id_type=&market=&from=&to=&limit=&cursor=` | 1 per **day in the window that has recorded offers**; balance must cover all requested days up front; cursor follow-ups free |

Fields by need:
- **Matching:** `pid`, `product_ref {id,id_type,market}`, `catalog_id`, `cluster_id`, `title`, `brand` (Snapshot), `specs`. GTIN/EAN/UPC is **not documented**, so matching rests on titles, so I must verify it by hand.
- **Price and currency:** offer `price` (item price, excludes delivery and tax) and `currency`. Docs say Snapshot currency is assigned from the requested market and is not verified per merchant. Search `headline_price` is explicitly "not a minimum and not necessarily an offer" and must not be used as a price.
- **Merchant:** `seller`, `seller_url`, plus `seller_domain` and `seller_id` on Snapshot and History.
- **Condition:** only `condition_label` on the Search card (New, Used, Refurbished, Open Box and others; usually null). It is absent from Snapshot offers and History.
- **Shipping:** no cost field. `delivery_info` is free text, and null does not mean free. Docs say the shipping field was removed.
- **Availability:** `stock_status` or `availability` (and `availability_raw` in Snapshot).
- **Observation time:** Snapshot `observation.observed_at / age_seconds / stale` and per-offer `observed_at`; Search `meta.scraped_at`, `meta.cache_source`, `meta.cache_age_s`; History `recorded_at`, `window.first_recorded_at / last_recorded_at / days_with_offers`.

History limits:
- Window up to 1,500 days; at most 50,000 stored rows per window (denser windows return 400).
- 2 concurrent History requests per account; 60 requests/min.
- No stated retention. Depth "varies by product and market".
- Docs warn that repeated observations do not prove a price held between checks.

Free tier (Personal): 3,000 credits, **one-time, not renewing**; 6 Search requests/min; up to 3 products per Search; 25 shared schedule slots; no card required. Commercial-use terms are not documented in what I read, so check https://pricesapi.io/terms before launch (not fetched).

## 3. Experiment procedure

Products: Sony WH-1000XM5, Logitech MX Master 3S, Samsung 990 PRO 2TB. Market: `us` (confirm support first).

**Setup (the user does this; I never see the key).**
1. Create a PricesAPI account and put the key in a local shell variable, e.g. `read -s PRICESAPI_KEY; export PRICESAPI_KEY` in the terminal. Do not paste it into chat.
2. The experiment script is a throwaway local Node/Python file that reads `PRICESAPI_KEY` from the environment, writes raw JSON responses to `experiments/raw/` (gitignored), and logs every call with endpoint, credits expected and credits remaining. It has a hard counter that aborts at 100 credits.

**Steps.**
- **Step 0 (0 credits).**
  - Call Catalog for each product.
  - This confirms the market is supported and shows whether the product exists and how much retained history it has (`retained` counts). Use that to choose history windows.
  - Decision rule: if Catalog shows no retained history for a product, skip History for it.
- **Step 1: Search (3 calls, 30 credits).**
  - One call per product with `limit=1`, `offers_limit=60`.
  - Save the raw response.
  - Manually label each offer as correct variant, wrong variant (colour or capacity ignored, bundle, accessory) or unusable.
  - The 990 PRO 2TB is the main variant-confusion risk (1TB, 4TB, heatsink, PS5 versions).
- **Step 2: Snapshot (3 calls, 3 credits).**
  - Read each product by ID.
  - Compare against Step 1: same sellers, same prices, `observed_at` and `age_seconds`.
- **Step 3: Cross-check (0 credits).**
  - For about 5 offers per product (including the cheapest and one outlier), open the `url` manually and note whether the page shows the same price and product.
  - This is the real accuracy test. HTTP 200 proves nothing here.
- **Step 4: History (cap 45 credits).**
  - Per product, a 14-day window ending yesterday UTC, worst case 14 credits each, so 42 maximum.
  - Check cost against `window.days_with_offers` before spending, using the Catalog retained counts.
  - Evaluate coverage and whether it supports a trend rather than a single point. If a longer window is needed for the "is this a deal" claim (e.g. 90 days), run it for one product only and only if the remaining budget covers the worst case.
- **Step 5 (reserve).** One repeat Snapshot per product at least a few hours later (3 credits) to see price drift and whether `observed_at` advances. The remainder is reserve for retries.

## 4. Estimated credit usage

| Item | Calls | Credits |
|---|---|---|
| Catalog (free) | 3 | 0 |
| Search | 3 | 30 |
| Snapshot | 3 | 3 |
| Snapshot repeat later | 3 | 3 |
| History, 14-day window, worst case | 3 | ≤ 42 |
| **Planned worst-case total** | | **≤ 78** |
| Reserve for retries or a longer history window | | ~22 |

Hard stop: 100 credits, about 3.3% of the 3,000 free credits. Search costs 10 even when served from cache, so do not repeat searches casually. A failed or empty call is free, but a 403 `INSUFFICIENT_CREDITS` appears if the History window's reserved days exceed the balance.

## 5. Risks and limitations

- **History may be sparse or missing.** There is no stated retention and depth varies by product and market, with Australia documented as deepest. History is built from observed offers, not from the merchant's own price log, so "lowest price in N days" claims can be wrong. UI must say "observed" and show coverage, never "all-time low" without enough data.
- **No GTIN/UPC.** Wrong-variant offers are plausible, and this is the biggest data-quality risk.
- **No shipping cost, and condition only on the Search card.** Total price comparison and new vs refurbished filtering are weak. Treat `delivery_info` as display text only.
- **Currency not verified per merchant.** Treat as the market currency.
- **Freshness.** Search can be cached or stale (`served_stale`), and cold search latency can reach tens of seconds (a 41.8 s example was shown). The UI needs async handling.
- **Quota.** The free credits do not renew, and 6 Search requests/min. A public app would burn through 300 searches quickly, so caching is required.
- **Beta features** (Snapshot, History, Schedules) may change pricing or schema.
- **ToS unknown:** commercial use and caching or redistribution rules were not read.
- **Docs reading gaps:** some docs and OpenAPI portions were truncated, so field names for Snapshot and History are partly from summaries and must be confirmed against real responses.

### DeepSpace side (for the later build)

- **Secrets:** `npx deepspace secrets set PRICESAPI_KEY=...` run by the user in their own terminal (the docs warn values land in shell history; prefer `secrets upload .env` or an interactive route, and rotate if exposed). Read as `env.PRICESAPI_KEY` in server actions or Hono routes, never in frontend code. Secret changes reach a deployed app only after the next `deepspace deploy`.
- **External calls:** the documented path is the platform `integration` proxy (check `npx deepspace integrations list` for a PricesAPI entry, which I expect is not there). A generic "fetch any URL with a stored secret" recipe is **not explicitly documented**. Plain `fetch` from a server action with `env.PRICESAPI_KEY` is likely to work but is unverified, so test it in `dev` first.
- **Storage and caching:** no cache helper or TTL API is documented. Options are a DO-SQLite collection, KV (`CACHE` binding) or D1. Server actions bypass RBAC and are callable by any signed-in user, so they need per-user limits written by us. The platform rate-limits only `google/*` integrations.
- **Cron:** scheduled jobs docs were not read. Check them before relying on background refresh.

### Avoiding unnecessary requests (design rules to carry into the build)

1. Search once per product, then store the returned `product_ref` ID and use Snapshot (1 credit, 10x cheaper) for refreshes.
2. Cache responses server-side by (query, market) with a TTL (for example 6 to 24 h), and respect `observation.stale_after_seconds`.
3. Use Catalog (free) for autocomplete and existence checks.
4. Fetch History only on demand, with a bounded window, and cache it per product. History and Catalog return `Cache-Control: no-store`, so we must cache ourselves.
5. Batch Snapshots for the saved list, and cap per-user requests per day.
6. Never use `no_cache` outside explicit refresh. Never retry 500s automatically, as the docs advise.
7. Coalesce concurrent identical requests and debounce the UI.

## 6. GO / CONDITIONAL / PIVOT criteria

Measured on the 3 products, using the manually labelled results.

**GO** needs all of:
- All 3 products return at least 3 distinct retailers with a correct-variant offer, and at least 80% of the offers are correct variant (manual label).
- Prices on at least 4 of 5 spot-checked offers per product are within 5% of the merchant page, and price and currency fields are present on 100% of offers.
- Every offer has an `observed_at` (or the product has one), and at least 80% are under 48 h old.
- History returns at least 10 of the 14 days with offers for at least 2 of the 3 products, with prices plausible against the Snapshot, so a basic trend can be shown.
- Total spend ≤ 100 credits and no unexplained errors.

**CONDITIONAL** (proceed with documented mitigations) if current prices pass but any one of these holds:
- History is thin (2 products under the 10-of-14 bar, or only 1 product has any).
- 60 to 80% variant accuracy (add a title-filter or manual-confirm step).
- Stale data above the threshold.
- The ToS is unclear on caching or commercial use.

In that case ship "price comparison plus observed history with coverage labels" and avoid strong "deal" verdicts.

**PIVOT** if any of these holds:
- Fewer than 2 products have 3 or more retailers.
- Spot-check price accuracy is below 60%.
- Variant accuracy is below 60%.
- History is empty for all 3 products.
- The ToS forbids our use.

Then evaluate SerpApi (250 free searches per month) for current prices, with a self-built history by storing our own snapshots over time, and re-scope the "genuine history" claim.

## Open items before running anything

1. The user creates the PricesAPI key and exports it locally (not into chat).
2. Confirm `us` is a supported market (free Catalog or invalid-market call).
3. Read https://pricesapi.io/terms.
4. Approve the experiment script before any paid call.

---

## Addendum (2026-11-19): revised criteria and Terms of Service review

**Revised criteria (supersede section 6 where they differ; the 10-of-14-days history requirement is dropped).**
- **GO:** at least 2 of 3 products have offers from 2+ distinct retailers; exact model and key variants can be verified for the offers used; merchant listing URLs are present; prices, currencies and observation timestamps are usable; and ambiguous, stale or incomplete data can be identified.
- **CONDITIONAL GO:** current multi-retailer comparisons are trustworthy but historical coverage is limited or absent. Ship current-price comparison and make history optional.
- **PIVOT:** the API regularly mixes incompatible variants without enough information to tell them apart, or retailer coverage or price reliability is too poor for honest comparison.

**Revised budget.** Max 60 credits: 3 Search (30), 3 Snapshot (3), 2 History of 7 days each (at most 14). Worst case 47.

**Terms of Service** (https://pricesapi.io/terms, last updated 1 Sep 2026; sections 4, 7, 8 and related). Findings:
- Permitted use includes "legitimate pricing intelligence, e-commerce, research and product features", and responses may be incorporated into your own application "subject to these Terms and any rights that apply to the underlying source data".
- Prohibited: bypassing quotas or rate limits, reselling API access as your own API without written agreement, unlawful or rights-infringing use, and sharing an account or key between unrelated organisations.
- Data may be "delayed, stale, incomplete, duplicated, unavailable or incorrect". We should show timestamps and keep fallbacks.
- You are responsible for how you store, combine, publish or redistribute returned data, and for third-party and marketplace rights. The terms grant **no explicit redistribution or display licence**, and they say nothing on caching rules, TTLs, attribution or scraping. They also give no explicit free-tier-specific commercial grant.
- Search cache hits that include offers still cost 10 credits, so caching on our side is what saves credits.
- Remaining restrictions to handle: do not expose raw API responses or a pass-through endpoint to the public, keep the key server-side, and respect source-data rights. Possibly ask PricesAPI support in writing about public display and caching before launch. The separate disclaimer page (https://pricesapi.io/disclaimer) is unread.
