# Production release and acceptance

Production: **https://dealproof-review.app.space** · App `dealproof-review` (`app_01M7Z981PV35N5RAXM3RM7SRR4`) · source: GitHub `ModiCodie/dealproof-review` (private), `main`.

This page separates three kinds of evidence. They are not interchangeable.

| Kind | What it covers | Who |
|---|---|---|
| **Automated tests** | Local dev runtime and local record storage; prices mocked or synthetic; no PricesAPI calls | Test suites |
| **Agent production checks** | Deploy output, release ledger, asset hashes, logs, unauthenticated pages | Coding agent, read-only, no sign-in |
| **Owner manual verification** | Signed-in behaviour on the live site, including one real PricesAPI search | The owner, by hand |

## Release history

| # | Release ID | Deployed (UTC) | Content |
|---|---|---|---|
| 1 | `rel_01M7Z9JPCHHPJN3JBT2FZTSPFC` | 2026-11-21 14:53 | The original three-product application (imported from `7304826`, fresh-repo commits `1643641`, `d538d62`) |
| 2 | `rel_01M822W64Q09N2ZTQS9PWYFFN1` | 2026-11-22 16:54 | UI redesign, general product search, conservative matching, saved candidate identity, saved snapshots (`main` at `6ea4c90`) |

Release #1 remained available for rollback (`deepspace rollback <release-id>`) and was not used.

## Release #2 procedure (agent, read-only checks around one deploy)

Before: correct directory and App ID; local `main` equal to `origin/main` at `6ea4c90`; clean tree; release #1 recorded with rollback available; `PRICESAPI_KEY` present (name only); no deploy in flight; the schema change is additive. Then one `npx deepspace deploy` (exit 0, "edge + data plane confirmed in 4s"), no retry.

After, observed by the agent:
- Release #2 in the ledger and the activity log; release #1 still listed with rollback available.
- Five consecutive fetches served the same JS/CSS bundle. The live main bundle and the route chunks (search, saved, saved detail, panels, catalog) are byte-identical (SHA) to a local build of the same clean tree. GitHub-source releases record no commit lineage, so this hash match is the evidence tying the live site to `6ea4c90`.
- Production logs for 30 minutes after deploy: no warnings, no errors.
- Unauthenticated, desktop and 390 px: landing page with the featured products renders; `/search` and `/saved` show the sign-in gate; no console errors, no failed or 4xx requests, no horizontal scroll; no request to PricesAPI. An unauthenticated action call returns 401.
- Not observable without signing in, so not claimed by the agent: the search UI, demo comparisons, saved records, and the new `saved_snapshots` collection.

## Schema compatibility

`saved_snapshots` is a new server-only collection; no existing collection or column changed. DeepSpace creates new collections on the Durable Object's next start and keeps existing records. `src/schemas.lint.test.ts` runs the SDK's schema-lint (no findings) and pins the existing collections' columns. Local runtime created the table automatically. In production the new table is exercised by the owner's save (below); the owner's acceptance run succeeded, which indicates it initialised, but no database inspection was performed.

## Owner manual verification (reported by the owner after release #2)

The owner personally verified nine workflows on https://dealproof-review.app.space:

1. Production authentication.
2. Samsung demo and variant switching.
3. General product search using PricesAPI (a real, live search).
4. Product candidate selection and conservative comparison.
5. Saving and reopening a generic product comparison.
6. Persistence after signing out and back in.
7. Refreshing saved prices from the existing cache.
8. Cross-account isolation through Saved and direct URLs.
9. Removing the saved comparison, refreshing, and confirming the old URL is inaccessible.

This is the owner's report; the agent did not observe these runs and has no logs of them beyond the 30-minute window above.

## Automated test results (local, at `6ea4c90`)

326 unit tests and 44 browser tests pass; 10 opt-in browser tests are skipped by default (screenshots, free replay, one paid live search, the two-phase real-storage snapshot lifecycle). TypeScript, ESLint and the production build are clean. These do not prove production behaviour.

## Background: the original application

The first app (`dealproof`, `app_01M7TZWJD321CGWEMJGK49RB8C`) was left in a platform-side release-reconciliation state after its first deploy (0 releases recorded, later deploys refused as `release_in_progress`). It was reported to DeepSpace and deliberately left untouched; the root cause is not established. After the account plan was upgraded, the same code was registered as a fresh app (`dealproof-review`) and deployed without recurrence. Evidence: [`deployment-issue.md`](deployment-issue.md), [`deployment-forensics.md`](deployment-forensics.md), [`fresh-deployment-experiment.md`](fresh-deployment-experiment.md). The submission URL is the fresh app's.

## Open items

- **Retention.** PricesAPI's terms do not specify a retention period and do not grant blanket rights to the underlying third-party content. Snapshots are kept minimal (one group per saved comparison, owner-only, deleted with the record). Owner decision: no expiry for this release. Not legal advice.
- **Committed sample data.** Earlier work committed captured PricesAPI results (`tests/fixtures/real-*.normalized.json`, `tests/fixtures/pricesapi-search-*.json`, `experiments/price-api/examples/`) and the featured-product demos embed the normalised versions in the public bundle. The terms were not read for redistribution at that time; the repository is private, the live bundle is not. The raw AirPods response captured later is gitignored and never committed. Resolving this needs the owner's decision (replace with synthetic data, or confirm permission).
- **Repository access.** The repository is private; reviewers need access (see the submission note).
- No license file; no price history, monitoring or alerts by design.
