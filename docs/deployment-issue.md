# Deployment issue: `release_reconciliation_pending` / `release_in_progress`

> **Historical (original app `dealproof` only).** This describes the first app's failed deploy on 2026-11-19. The submission uses the fresh app `dealproof-review`; see [`production-release.md`](production-release.md).

Investigated 2026-11-19 (diagnostics taken at 23:27 UTC). All commands used here are read-only. No deploy was re-run today, and `app undeploy`, `app init --new-id` and any identity change were avoided.

## Timeline (Day 2)

Exact CLI timestamps were not printed, so the times are approximate (UTC, from file and session times).

| About | Event |
|---|---|
| 22:50-23:00 | `npx deepspace deploy` #1: build ok, 17 assets uploaded, GitHub source claimed (`modicodie/dealproof`). **Failed** with `release_reconciliation_pending`: "Worker activated, but authoritative user-secret deletion is incomplete after 3 attempts: could not list script secrets (CF 404)". The CLI said to rerun without changing inputs. |
| soon after | Deploy #2 (unchanged inputs): `release_in_progress` ("Another deploy is already activating for this app. It is committing now"). |
| over ~25 min | Four more unchanged re-runs, spaced 1.5 to 4.7 minutes apart: all `release_in_progress`. (Between the later runs I committed documentation only; no build input changed.) |
| 23:27 | Diagnostics below. |

## Diagnostics today

| Check | Result |
|---|---|
| `deepspace status` | App `dealproof (app_01M7TZWJD321CGWEMJGK49RB8C)`, Branch main, Worktree clean, Source "GitHub · modicodie/dealproof (manual Git ownership)", **Live: never deployed** |
| `deepspace releases` | "Loaded 0 releases" |
| `deepspace activity` | "Loaded 0 events" |
| `deepspace logs --json` | `app_not_deployed`: "has never been deployed, so it has no logs" |
| `GET https://dealproof.app.space/` and `/search` | 200 |
| `POST /api/actions/searchProducts` (no credentials) | 401 `{"error":"Unauthorized"}` |
| `GET /.well-known/deepspace/release.json` | 200, `{"release":"8c07d69a-b063-4867-ad79-38ba039e40f5"}` (a release id **is** being served) |

## Identity consistency

- `wrangler.toml`: `name = "dealproof"`, `DEEPSPACE_APP_ID = "app_01M7TZWJD321CGWEMJGK49RB8C"`, `APP_NAME = "dealproof"`. The id matches the one `app init` registered and the one `status` reports.
- Environment: production (no `[env.*]` used, no `--env` passed).
- Git: `origin` is `https://github.com/ModiCodie/dealproof.git`; the CLI reports `modicodie/dealproof` as the claimed GitHub source. Latest commit `653fc2a`, worktree clean at deploy time.
- Account: logged in as the app's registering account (`whoami` ok).

No local mismatch was found.

## Assessment

**Most likely platform-side reconciliation, not local configuration.**

1. The data plane is live: the Worker serves our build and reports a release id in its public marker.
2. The control plane has no record of it: `releases`, `activity` and `status` all say never deployed.
3. The original error names a platform operation (listing script secrets after activation returned a Cloudflare 404). That is not something local config can cause.
4. Every retry is refused as "another deploy is already activating", which matches a stuck activation lock for the one unreconciled release, and the CLI's own advice says the server will resume the matching activation.

What I cannot rule out: a first-deploy interaction with the secret binding (`PRICESAPI_KEY`) or with first-time claiming of GitHub source. Both are platform behaviors, but I have no direct evidence.

## Actions taken / not taken

- Taken: read-only status, releases, activity, logs; public marker; identity cross-check.
- Not taken: more deploys (the 6 earlier unchanged attempts were enough), `app undeploy`, `app init --new-id`, edits to the app id, secret deletion, git-source changes.

## Support report (copy as is)

> **Subject:** First deploy stuck: `release_reconciliation_pending`, then `release_in_progress` for ~25 min; app serves but registry says "never deployed"
>
> - App: `dealproof`, id `app_01M7TZWJD321CGWEMJGK49RB8C`, production, CLI/SDK `deepspace 0.44.2`, Node 24.22.3
> - Source: GitHub `modicodie/dealproof` (claimed by the first deploy), commit `57be8bf`, clean worktree
> - First `deepspace deploy` (about 22:50-23:00 UTC, 2026-11-19): build ok, 17 assets uploaded, then `release_reconciliation_pending`: "Worker activated, but authoritative user-secret deletion is incomplete after 3 attempts: could not list script secrets (CF 404)". The app has one secret, `PRICESAPI_KEY`, set before deploy via `secrets upload -`.
> - Every unchanged re-run since: `release_in_progress` ("Another deploy is already activating for this app").
> - At 23:27 UTC: `status` -> Live "never deployed"; `releases` -> 0; `activity` -> 0 events; `logs` -> `app_not_deployed`. But https://dealproof.app.space/ returns 200, an unauthenticated POST to `/api/actions/searchProducts` returns 401, and `/.well-known/deepspace/release.json` returns `{"release":"8c07d69a-b063-4867-ad79-38ba039e40f5"}`.
> - Question: can the stuck activation for release `8c07d69a-...` be reconciled or released on your side? Is it safe to re-run `deepspace deploy` now, or is there a resume command? I have not run `app undeploy` or `app init --new-id`.

## Status

Unresolved. Do **not** treat the app as deployed: the URL serves a build, but the release is not registered, logs are unavailable, and the signed-in flow on the live site is unverified. Development continues locally.


## Day 3.5 re-check (2026-11-20 00:06 UTC)

Read-only commands only, about 70 minutes after the first failure and about 40 minutes after the previous check.

| Check | Result | Changed since 23:27? |
|---|---|---|
| `deepspace status` | Live: **never deployed**; Source GitHub `modicodie/dealproof`; Worktree clean | no |
| `deepspace releases` | Loaded 0 releases | no |
| `deepspace activity` | Loaded 0 events | no |
| `deepspace logs` | `app_not_deployed` | no |
| `GET /.well-known/deepspace/release.json` | 200 `{"release":"8c07d69a-b063-4867-ad79-38ba039e40f5"}` | no (same id) |
| `npm view deepspace version` | 0.44.2 is the latest; we run 0.44.2 | n/a |

Documentation consulted: the project `AGENTS.md` (commit before deploy; the first release claims the GitHub remote permanently) and the CLI's own source for these error paths. The bundled CLI says, for `release_in_progress`: wait a moment, run the same deploy again, and "if it keeps refusing for more than a couple of minutes, check `deepspace releases`". `release_reconciliation_pending` is printed to the user as-is with no documented self-service fix. No resume or repair command exists in CLI 0.44.2 (`status|activity|logs|push|pull|clone|workspace|releases|rollback|deploy|testflight|dev|test|add|secrets|integrations|agent|auth|app|feedback`). `rollback` needs an existing release (there are none). Six deploy attempts in total (the first plus five re-runs) already exceeded the documented advice, so no further deploy was attempted.

**Local configuration vs platform evidence.**
- Local checks all pass: app id in `wrangler.toml` equals the id `status` reports; production environment; clean worktree; the GitHub source is the one the CLI claimed; the build and asset upload succeeded.
- Platform-side evidence: the failing step is the platform's own post-activation reconciliation (listing script secrets returned a Cloudflare 404), and the data plane and control plane disagree (a release id is served; the ledger has none). No local file can create that disagreement.
- Not ruled out: an interaction between first-release activation and the secret binding (`PRICESAPI_KEY`). That is still a platform behaviour.

Conclusion unchanged: platform-side, needs DeepSpace. Not deployed; do not treat the live URL as verified.

## `deepspace feedback` (verified against CLI 0.44.2 `--help`)

```
deepspace feedback [OPTIONS] [TITLE]
  -t, --type=<type>      bug | feature | other (default: bug)
  -m, --message=<message>
      --yes              skip the confirmation prompt
      --json             single-line JSON result
```

So `npx deepspace feedback "Release reconciliation stuck for dealproof" --type bug` is valid; adding `--message "<report>"` supplies the details. It sends text to DeepSpace, so **nothing has been submitted**. Wait for explicit approval, then run it without `--yes` so the CLI shows its own confirmation.

## Sanitized support report, ready for approval (contains no secrets, emails or keys)

> **Title:** Release reconciliation stuck for dealproof
>
> **App:** `dealproof`, `app_01M7TZWJD321CGWEMJGK49RB8C`, production. URL: https://dealproof.app.space. CLI/SDK `deepspace 0.44.2` (latest on npm).
>
> **What happened.** The first `deepspace deploy` (about 22:50-23:00 UTC, 2026-11-19) built successfully, uploaded 17 assets and claimed the GitHub source `modicodie/dealproof`, then failed with `release_reconciliation_pending` ("Worker activated, but authoritative user-secret deletion is incomplete after 3 attempts"; the platform's script-secrets listing returned a Cloudflare 404). Every unchanged re-run since (five, over about 25 minutes) failed with `release_in_progress` ("Another deploy is already activating for this app"). I have made no deploy attempts since 23:27 UTC.
>
> **The mismatch.** The Worker is serving: `GET /` returns 200 and `GET /.well-known/deepspace/release.json` returns release `8c07d69a-b063-4867-ad79-38ba039e40f5`. But as of 2026-11-20 00:06 UTC the control plane says nothing exists: `deepspace status` -> Live "never deployed"; `deepspace releases` -> 0 releases; `deepspace activity` -> 0 events; `deepspace logs` -> `app_not_deployed`. Results were identical at 23:27 and 00:06 UTC.
>
> **Checked locally:** app id in `wrangler.toml` matches `status`; clean worktree on `main`; production environment; one secret (`PRICESAPI_KEY`) was set before the first deploy.
>
> **Not done:** `app undeploy`, `app init --new-id`, secret deletion, identity or git-source changes, further deploy loops.
>
> **Request:** Please reconcile or release the stuck activation of release `8c07d69a-b063-4867-ad79-38ba039e40f5` so it is recorded in the release ledger (or tell me how to clear it). Please also confirm whether re-running `deepspace deploy` is now safe, and whether the missing script-secrets listing (404) is a known platform issue.

## Status

Unresolved and unchanged. Local development continues.


## Bug-report submission status (2026-11-20)

- **Not yet submitted.** The message is ready in `docs/deepspace-bug-report.txt` (1.7 KB, sanitized: app id, URL, error codes, release id, diagnostic results; no secrets, tokens or emails). State re-checked 2026-11-20 02:05 UTC: unchanged.
- **Why I did not run it myself.** In CLI 0.44.2 the confirmation prompt ("Send this to the DeepSpace team?") is only shown when stdin is an interactive terminal. An automated shell is not one, so running without `--yes` there would submit without asking. You asked for the CLI to request your confirmation, so please run this yourself in the Claude Code prompt (the `!` prefix runs it in your terminal session):

```
! PATH=$HOME/.local/node24/node_modules/.bin:$PATH npx deepspace feedback "Release reconciliation stuck for dealproof" --type bug --message "$(cat docs/deepspace-bug-report.txt)"
```

  It will show a Review screen with the exact title and text, plus context (CLI version, Node version, OS, app name), then ask for confirmation. On success it prints `Submitted as <report id>` and a dashboard link for triage status; please paste those here (or tell me and I will record them).


## Day 4 re-check (2026-11-20 16:41 UTC), read-only

Only read-only commands were run; no deploy was attempted (there is no new diagnostic evidence and the bug report is still unsent).

- `deepspace status`: Live **never deployed**; Source GitHub `modicodie/dealproof`; app id unchanged.
- `deepspace releases`: 0 releases. `deepspace activity`: 0 events. `deepspace logs`: `app_not_deployed`.
- https://dealproof.app.space/ returns 200 and `/.well-known/deepspace/release.json` still returns `8c07d69a-b063-4867-ad79-38ba039e40f5`. Unauthenticated POSTs to `/api/actions/*` return 401. These tell us the Worker answers; they do **not** show which code is running or that a release is recorded.
- SDK: `deepspace` 0.44.2 is still the latest on npm.
- **Bug report:** submitted by the project owner after this check (see "Submission record" below).

Consequences for Day 4: the new `saved_products` collection and `getSavedComparison` action exist only in the local app and the repository. A later deploy will also carry this schema change; because the stuck activation involves secret/route reconciliation rather than schemas, there is no evidence it makes things worse, but it is untested. The live site is **not** evidence that Day 4 works.


## Submission record

- **Bug report submitted by the project owner** through `npx deepspace feedback` (the owner ran it themselves and confirmed in the CLI).
- **Reference ID:** `8d11d4c4-e418-40eb-9912-3348a9cef234`
- **Triage dashboard:** https://dashboard.deep.space
- **Status:** submitted; **no response and no evidence of resolution yet.** I have not seen the report in the dashboard (it needs the owner's login), so its triage status is unknown to me.
- Reported by the owner, not independently confirmed by me: the submission itself.

## Day 5 re-check (2026-11-20 17:15 UTC), read-only

| Check | Result |
|---|---|
| `deepspace status` | Live **never deployed**; worktree clean; Source GitHub `modicodie/dealproof`; same app id |
| `deepspace releases` / `activity` / `logs` | 0 releases / 0 events / `app_not_deployed` |
| Public marker `/.well-known/deepspace/release.json` | `8c07d69a-b063-4867-ad79-38ba039e40f5`, unchanged since 2026-11-19 |
| Served JS bundle | `assets/index-BeHadXul.js`; the local build is `index-DYC7mohv.js`, so production is **not** serving the current source. The live shell bundle contains none of the Day 3/4 strings (`saved_products`, `getSavedComparison`, "Lowest reported matching offer") |
| Latest local commit | `8a8d1f5` (later commits follow) |
| SDK | `deepspace` 0.44.2, still the latest on npm |
| Docs | `docs.deep.space/guides/releases-and-rollback` lists refusal codes (`release_in_progress` etc.) but **no entry or recovery for `release_reconciliation_pending`**, and `rollback` needs an existing release, which we do not have |

**Conclusion: unresolved. Production is BLOCKED, not complete.** No deploy was attempted: there is no new diagnostic evidence, the report is awaiting triage, and repeated attempts are ruled out. Application identity, data and secrets are untouched. No Day 4/5 feature is verified on the live site.

Options that need the owner's decision (none taken): (a) wait for a reply to the report; (b) one single `npx deepspace deploy` as a probe if the owner authorizes it, which would also carry the new `saved_products` schema and has not been tested against this stuck state.
