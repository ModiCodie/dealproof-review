# Fresh deployment experiment

> **Update (2026-11-22):** this page records release #1 only and is kept as written. A second release (`rel_01M822W64Q09N2ZTQS9PWYFFN1`, redesign + general search + snapshots) was deployed and the owner then verified the signed-in production workflows by hand; the items under "Pending" below were covered by that. See [`production-release.md`](production-release.md).

**Result so far:** the fresh deployment under a new app identity **succeeded and the release ledger is complete.** The original app's failure did **not** recur. Signed-in production behaviour (auth, save/reopen/remove, persistence, user isolation) has **not yet been verified** and is listed under "Pending".

## Identities

| | Original | Fresh |
|---|---|---|
| App ID | `app_01M7TZWJD321CGWEMJGK49RB8C` | `app_01M7Z981PV35N5RAXM3RM7SRR4` |
| App name / URL | `dealproof` / https://dealproof.app.space | `dealproof-review` / https://dealproof-review.app.space |
| Repository | https://github.com/ModiCodie/dealproof (private) | https://github.com/ModiCodie/dealproof-review (private) |
| Code | `7304826` (history preserved) | imported from `7304826` via `git archive`; commits `1643641`, `d538d62` |
| State | stuck: 0 releases, `deployedAt: null`, still serves the first build (`57be8bf`); unchanged by this experiment | release #1, `deployedAt` set, serving the full app |

Why a new app: the original's first deploy activated a Worker but never recorded a release. Every later deploy (`release_in_progress`), the undeploy (`script_operation_in_progress`) and a second registration on the free plan (`app_quota_exceeded`) were then blocked. Evidence: `deployment-forensics.md`, `deployment-issue.md`, `pre-undeploy-snapshot.md`. The root cause is platform-side and not established. The account was then upgraded (`starter`), which allowed a second app. The original was deliberately left untouched for DeepSpace support (ticket `8d11d4c4-e418-40eb-9912-3348a9cef234`).

## Steps and tool versions

Node 24.22.3, npm 11.6.2, deepspace CLI 0.44.2 (no upgrades). All work was inside the isolated copy.

1. Registered with `npx deepspace app init --new-id` → status `forked`, new ID above. `name = "dealproof-review"`. `APP_NAME` stays `dealproof` (product display name).
2. `git init` in the copy after registration; credential scan of staged files (none); private repo created; pushed. No `deepspace push` was run.
3. `npm ci` refused the inherited lockfile (`@types/node` 18 vs 26 in `package.json`); `npm install` regenerated it (types only) → commit `d538d62`.
4. Secret written before the first deploy, as the docs prescribe (the store is the deploy's only secrets input): `secrets set PRICESAPI_KEY --stdin --app <new id>`, entered by the owner in their own terminal. Names-only check: `PRICESAPI_KEY (v1)`. The original app's secret stayed at v1 from Nov 19.
5. Pre-deploy checks: tsc, ESLint, build clean; `test run all` = 181 unit + 31 browser, all passing (mocked pricing, no paid requests). The key value is absent from tracked files and from `dist`. No unresolved ID placeholder in executable output; the new ID is embedded in the client `constants` chunk.
6. One deploy: `npx deepspace deploy`, 2026-11-21 14:53:28Z to 14:53:48Z, exit 0. Full sanitized output: `fresh-deployment-deploy-log.txt` (it ends "edge + data plane confirmed in 3s"). The deploy printed no request identifier.

## Release verification (observed)

- `status`: Live = release #1, GitHub `modicodie/dealproof-review`, worktree clean.
- `releases`: `rel_01M7Z9JPCHHPJN3JBT2FZTSPFC`, seq 1, kind `deploy`, `sourceDirty: false`, rollback available. The JSON carries no separate `serving` field; the CLI itself reported the edge and data plane confirmed.
- `app list`: `deployedAt` 2026-11-21T14:53:45Z, route active. `activity`: one `release.deploy` event.
- Public marker `bc0bd13c-c458-4641-9e90-9c09f41d0129` on 10 of 10 fresh connections.
- Live JS `index-DG1vYpP9.js` and CSS `index-CRhB50sj.css` are byte-identical to the local build (sha256 match). The live `constants` chunk carries the new ID.
- Logs (15 min): 5 requests, all HTTP 200, no errors or exceptions.
- Browser: landing page renders the full DealProof page; `/search` and `/saved` show the sign-in gate when signed out; no failed or 4xx requests; the only console message is the platform's `Permissions-Policy: document-domain` warning (also seen on the original).

## Pending (not verified)

Authentication on production, the sample comparison, Save → Reopen → Remove, persistence across refresh and re-login, and cross-user isolation. These need signed-in sessions on the live site. The e2e suite verified them against local storage only. No paid PricesAPI search has been made on the new app.

## Comparison with the original failure

Same code, same CLI, same secret mechanism, same documented order. The original stopped at post-activation reconciliation; the fresh app recorded its release within the same deploy. This does not explain the original failure. The only differences are a new app identity and an upgraded plan.

## Remaining issues

- The original app is still stuck and holds a slot; support has not replied.
- (Resolved 2026-11-22) The README and `submission-note.md` now describe the fresh app and release #2.
