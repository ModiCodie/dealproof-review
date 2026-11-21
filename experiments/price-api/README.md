# PricesAPI feasibility experiment

Standalone Node script (Node 18+, no dependencies, no `npm install`). It is not part of the DealProof app.

## Run it

1. Create a PricesAPI account (free "Personal" plan, no card) and copy your API key from their dashboard.
2. In **your own terminal** (not in chat), set the key for that terminal session only:
   ```bash
   read -s PRICESAPI_KEY && export PRICESAPI_KEY   # type/paste the key, press Enter (nothing is echoed)
   ```
3. Run from this directory:
   ```bash
   node run.mjs check        # no network; shows key status and the budget plan
   node run.mjs catalog      # free
   node run.mjs search       # 3 calls, up to 30 credits (waits 11 s between calls: 6/min limit)
   node run.mjs snapshot     # up to 3 credits
   node run.mjs history      # 2 products x 7 days, up to 14 credits
   node run.mjs spotcheck    # free: one GET to a few retailer pages
   node run.mjs analyze      # no network; prints the data-quality summary
   # or everything in order:  node run.mjs all
   ```
4. Outputs: `out/raw/*.json` (full responses, gitignored), `out/ledger.json` (credit ledger), `out/analysis.json`, and `examples/*.json` (truncated copies, safe to commit).

Never put the key in a file, a commit, a screenshot or a chat message. If you ever do, rotate it in the PricesAPI dashboard.

## Safety rails (all enforced in code)

- Hard budget of 60 credits. The ledger persists across runs, and a call is refused if its worst-case cost would exceed the budget.
- Caps: 3 search, 3 snapshot, 2 history calls. A stage skips any call that already has a saved response, so re-running never repeats a paid call unless you pass `--force`.
- At most one retry, and only after HTTP 429 or 503 (documented as free), honouring `Retry-After` (max 65 s).
- No subscription or upgrade endpoints are used. The script only calls documented read endpoints.

## How it works (for a full-stack beginner)

- **HTTP request.** `fetch(url, {headers})` sends a GET to `https://api.pricesapi.io/api/v1/products/search?q=...&market=us`. Parameters go in the query string after `?`. The server answers with a status code (200 OK, 4xx your mistake, 5xx their problem) and a JSON text body.
- **Authentication.** The key is sent in the header `Authorization: Bearer <key>`. Headers are not part of the URL, so the key doesn't end up in logs or saved URLs. The script reads it from the environment variable `PRICESAPI_KEY` and never prints it.
- **Parsing JSON.** `JSON.parse(text)` turns the body into JavaScript objects. Search results are wrapped as `{success, data, meta}`, while Snapshot and History responses are not wrapped. The code handles both and uses `?.` so a missing field gives `undefined` instead of a crash.
- **Errors and rate limits.** Every call is recorded with its status and estimated credits. 429 means too many requests per minute (the `Retry-After` header says how long to wait), so the script waits and retries once. The script's own 11-second spacing between searches stays under the free plan's 6 per minute.
- **Matching identical products.** The API has no GTIN/UPC field. Each offer's title is checked against per-product rules in `run.mjs`: the model token must appear (`WH-1000XM5`, `MX Master 3S`, `990 PRO`), the capacity must be exactly 2TB for the SSD, and accessory keywords or other generations cause rejection. Offers are labelled `match`, `variant` (e.g. heatsink, refurbished, for-Mac), `ambiguous` (e.g. capacity not stated) or `mismatch`. Only `match` offers with a price, currency, URL, in-stock status and non-stale timestamp count as "verified comparable". Prices far from the median (under half or over double) are flagged as outliers and left out of the lowest-price figure.

## Known limits of the evidence

- Matching is keyword-based on titles, so I verify it by hand on the real data before trusting it.
- Condition (new vs refurbished) is only inferred from title words, since Snapshot and History have no condition field.
- The spot-check is a single plain GET. Many retailers block bots or render prices with JavaScript, so results are reported as `automated-price-found`, `blocked` or `inconclusive`. Manual checks are done and reported separately.
- Response shapes for Catalog, Snapshot and History came from documentation summaries. The script defensively dumps what it gets.
