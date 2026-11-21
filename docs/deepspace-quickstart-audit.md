# DeepSpace Quickstart compliance audit (read-only)

Audit date: 2026-11-20, about 18:45 UTC. Project commit `361291a`. Nothing was deployed, initialised, pushed, pulled, rolled back or reconfigured. Only these commands touched the platform: `auth whoami`, `status --json`, `app source --json`, `releases --json`, `activity --json`, `logs --json`, `secrets list` (names only), `app list --json`, `app update` (documented as "inspect and print guidance"), plus unauthenticated GETs of the public site. No paid PricesAPI call was made. The working tree was clean before and after.

Source of truth: the eight pages you listed, fetched from docs.deep.space on 2026-11-20. The docs footer says "Built with deepspace 0.43.0"; the project runs 0.44.2 (the current npm release per earlier checks), so the docs lag the CLI by one version.

Evidence tags: **[DOC]** official page, **[CLI]** command output today, **[LOG]** the session transcript of the original commands (the original deploy output was saved only through `| tail`, so lines before the tail are UNKNOWN), **[GIT]** repository history.

## 1. Compliance table

Causal relevance: **High** = could plausibly produce `release_reconciliation_pending`; **Low** = not on the failing code path; **None** = not related.

| # | Official step / requirement | What DealProof did, with evidence | Result | Plausible cause? | Action |
|---|---|---|---|---|---|
| 1 | Supported Node: 22.15+, 24 or 26; npm >= 11.6 [DOC installation] | Node v24.22.3, npm 11.6.2 [CLI]. A first scaffold attempt under Node 25.2.1 was refused by `create-deepspace` with no files changed; it was re-run under Node 24 [LOG 22:31] | PASS | None | none |
| 2 | `npm create deepspace@latest my-app` [DOC quickstart] | Scaffolded with `npm create deepspace@latest dealproof` under Node 24.22.3 into a scratch directory (22:31:51Z), then the files were brought into the project directory. The exact copy step is UNKNOWN; I did not find it in the log. Installed `deepspace 0.44.2`, which equals the scaffolder version (it pins exactly) [LOG] | PASS (with an unrecorded copy step) | Low | none |
| 3 | Scaffold does not register; wrangler keeps `__APP_ID__` until first use [DOC installation] | The first commit `eb27aae` (22:39Z) still contains `__APP_ID__` [GIT] | PASS (matches docs) | None | none |
| 4 | "Register before you commit anything yourself... once the placeholder is in a commit, register with `npx deepspace app init`" [DOC installation] | We committed the placeholder first, then ran `auth whoami` and `app init --json` at 22:47:21-25Z. It printed `status: registered`, `appId app_01M7TZ…`, `env: production`, `committedScaffold: false` [LOG]. The registration was committed as `5ad47f4` [GIT]. The control plane records app creation at 22:47:25Z [CLI `app list`]. This is the documented recovery path, executed correctly | PASS | None | none |
| 5 | Check the account before first use (`auth whoami`) [DOC installation] | Done immediately before `app init`. `app list` shows role `owner`, and the owner id equals the id `whoami` printed [LOG, CLI] | PASS | None | none |
| 6 | `DEEPSPACE_APP_ID` in `wrangler.toml` is the identity; commit it [DOC app-identity] | `app_01M7TZWJD321CGWEMJGK49RB8C` in `wrangler.toml`; equals `status`, `app source`, `app list` today; committed in `5ad47f4` [CLI, GIT] | PASS | None | none |
| 7 | Name: lowercase alphanumeric/dashes, globally unique [DOC deployment] | `name = "dealproof"`, `APP_NAME = "dealproof"`. The registry holds route `dealproof.app.space` active for this app id, claimed 22:54:18Z [CLI `app list`] | PASS | None | none |
| 8 | Build-time app id injection: `src/constants.ts` reads `__DEEPSPACE_APP_ID__`; `vite.config.ts` uses `deepspaceBuild({ appDir })`; `vitest.config.ts` uses `appIdDefine({ appDir })` [DOC deployment] | All three match the documented pattern exactly (read today). `app update` reports "already aligned with this CLI version"; `deepspace.migrations.json` lists 13 migrations through `2026-11-route-param-lookups` [CLI, file] | PASS | None | none |
| 9 | Production environment, no `[env.*]`, no override [DOC deployment] | No `DEEPSPACE_*` variable in the shell; `status` reports `env: production`; `wrangler.toml` has no `[env.*]` block; `releases` shows `wranglerEnv: null` [CLI] | PASS | None | none |
| 10 | Secrets: the store is the only input; `.dev.vars` is a generated cache, never read by deploy [DOC deployment] | `secrets list` shows exactly one name, `PRICESAPI_KEY` (v1, 2026-11-19T22:49:41Z). The deploy log printed `App secrets: PRICESAPI_KEY`, so the CLI read the store [LOG]. `.dev.vars` is git-ignored and was never tracked. Key value: 0 files in `dist/`, 0 in `src/`, 0 commits in history (counts only; value never printed) [CLI] | PASS | Low (see hypothesis H2) | none |
| 11 | Audit the secrets store before the first deploy (`secrets list`) [DOC deployment "Before your first deploy"] | A `secrets list` ran at 22:47:33Z ("No secrets in prd."), the secret was uploaded at 22:49:41Z, and a later `secrets list` confirmed it [LOG] | PASS | Low | none |
| 12 | Worker declares and reads the binding; not exposed to the browser | `worker.ts` declares `PRICESAPI_KEY?: string` in `Env`; read only at `src/actions/index.ts:19` (`env.PRICESAPI_KEY`); no other `src` file outside `src/server`, `src/actions`, `worker.ts` mentions it. `wrangler.toml` has the scaffold comment "detected secrets: none declared", but the deploy bound the store value regardless [LOG] | PASS (the "none declared" comment is scaffold text; effect UNKNOWN but the deploy output proves binding) | Low | ask support (Q5) |
| 13 | Durable Object manifest and bindings [DOC deployment] | `wrangler.toml` declares the six scaffold DO bindings and migration `v1`; `worker.ts` exports the six classes. The deploy printed `DO manifest: 6 binding(s)` [LOG]. `saved_products` is registered in `src/schemas.ts` but did not exist at deploy time (Day 4 is later) | PASS | None for the original failure. Untested for a future deploy | none |
| 14 | Run `npx deepspace test run` before deploying [DOC deployment] | Local suites ran (Day 2 onward); the 31 Playwright tests pass against the local build. A test run is not a precondition the platform checks | PASS | None | none |
| 15 | "Commit first - a deploy records the commit it ships" [DOC quickstart]; clean worktree [DOC releases] | Commit `57be8bf` was made at 22:54:01Z; deploy started 22:54:05Z. The CLI said "shipping the working tree of main (clean)" [GIT, LOG]. Today `HEAD == origin/main == 361291a`, clean tree [CLI] | PASS | None | none |
| 16 | `npx deepspace deploy` [DOC quickstart] | Run exactly as `npx deepspace deploy 2>&1 | tail -40` at 22:54:05Z (piped through `tail`, so non-interactive output only). It built (5s), collected 17 assets, validated the DO manifest, uploaded 17 files in 1s, then failed [LOG] | PASS (command correct). The pipe only truncated logs | None | none |
| 17 | **Source selection**: "a deploy from a checkout with a GitHub remote claims that GitHub repository"; do not run `push` before the first GitHub deploy [DOC source-control] | `origin = https://github.com/ModiCodie/dealproof.git` was added and pushed at 22:39:23Z, before registration and before the first deploy. No `push`, `pull`, `--no-push` or source verb was ever run [LOG]. The deploy printed that it would claim GitHub source permanently. Registry today: `source.provider = github`, `repository = modicodie/dealproof`, `revision 1`; the local remote is the same repository (case differs only) [CLI] | PASS (documented path), but **different from the Quickstart's implicit default** and from `AGENTS.md` ("Don't set up GitHub unless the developer explicitly asks"). I believe the original project brief asked for a GitHub repository, but I did not re-verify that wording | Low (see H3) | none; do not reselect (impossible) |
| 18 | `deploy` "does not return until it has checked" and reports `serving` confirmed/unconfirmed/unverifiable [DOC deployment] | The deploy never reached that stage. It failed after upload with `release_reconciliation_pending` [LOG] | FAIL (platform stage) | **High** (this is the failure) | support |
| 19 | Release ledger: "every deploy appends a release fact" [DOC releases] | `releases --json` returns `releases: []`; `activity` returns `events: []`; `logs` returns `app_not_deployed` [CLI] | FAIL | **High** (control plane never recorded the release) | support |
| 20 | Refusal taxonomy lists `release_in_progress` (retry the same deploy; check `releases` if it persists beyond a couple of minutes) [DOC releases] | Retried 4 times within about 12 minutes (22:54:36, ~22:56:26, 23:00:41, ~23:06), all `release_in_progress` [LOG]; no deploy since (about 19 hours) | PASS (we followed the advice, then stopped) | None | none |
| 21 | `release_reconciliation_pending` in the docs | **Not documented anywhere** in the eight pages (`grep` for "reconcil": only a generic word in the deployment page; the code itself appears in no page) [DOC] | n/a | n/a | support (Q1) |
| 22 | Rollback re-ships an existing release | No release exists, so rollback has nothing to target [CLI] | n/a | n/a | none |

Documentation inconsistencies noted (they do not explain our failure):

1. Quickstart step 1 says the first command that uses the app registers it. The scaffolder's own output and the installation page say to run `app init` first, and warn that a committed placeholder stops auto-registration. Both end in the same state.
2. Quickstart step 5 implies a GitHub-free flow ("commit, then deploy"). The source-control page says a GitHub remote present at the first deploy permanently claims GitHub. `AGENTS.md` says not to set GitHub up unless asked. The three give different defaults.
3. The deployment page promises that `deploy` confirms serving before returning. Neither it nor the releases page documents what happens when the Worker is activated but the ledger write fails.
4. Docs are labelled 0.43.0; the CLI is 0.44.2.

## 2. Version and environment findings

- Node v24.22.3 (supported line), npm 11.6.2 (meets `>=11.6.0`); the intended `$HOME/.local/node24` install is the one active in the shell.
- `deepspace 0.44.2` in `package.json` and `node_modules`; `create-deepspace@0.44.2` pinned it. CLI and SDK are the same package, so no mismatch is possible.
- `app update` says the app is already aligned with this CLI. No SDK migration is pending.
- No `DEEPSPACE_ENV` or other override; plane is production; `status.services` points to the production auth, api, platform and deploy workers.
- Logged in as the app owner (`role: owner`).
- Repo: clean, `main` equals `origin/main`.

## 3. App identity and source-control findings

- Identity is consistent in every place checked (file, `status`, `app source`, `app list`, release marker target host).
- `app list` shows the app `status: active`, `hasSecretsStore: true`, `createdAt 22:47:25Z`, `deployedAt: null`, and route `dealproof.app.space` with `status: active`, `claimedAt 22:54:18Z`, `releasedAt: null`.
- The route claim (22:54:18Z) happened 13 seconds after the deploy started (22:54:05Z), so the first deploy got past request validation, the durable reservation, the GitHub claim and the route registration. The ledger never got its release row.
- Source: GitHub is authoritative, revision 1, repository matches the local remote. The claim "fires after request validation when the durable release reservation is accepted" and "is not undone if a later deploy phase fails" [DOC source-control]. Our state matches that description exactly.
- Order of operations: remote added and pushed (22:39Z) → app registered (22:47Z) → secret uploaded (22:49Z) → deploy (22:54Z). The documented rule for GitHub source is only that `push` must not precede the first GitHub deploy; it did not. The order is valid.
- A deploy under GitHub source performs no Git read, write or credential check [DOC], so GitHub itself cannot be the failing component.

## 4. Secrets and binding findings

- Names only: one secret, `PRICESAPI_KEY`, config `prd`, version 1, set 22:49:41Z, before the first deploy, as the deployment page recommends.
- The deploy log says `App secrets: PRICESAPI_KEY` and `Custom bindings: NATIVE_AUTH_REDIRECT_URIS (plain_text)`.
- The failure text concerns exactly this area: "authoritative user-secret deletion is incomplete after 3 attempts: could not list script secrets (CF 404)". Per the deployment page, deploy "reconciles the worker's bindings against the store". The platform therefore lists the Worker script's secrets after activation to delete stale ones, and that listing got HTTP 404 from Cloudflare.
- The browser bundle and source tree do not contain the key value (0 matches, counts only). It is read only in `src/actions/index.ts`.
- `.dev.vars` is generated by the CLI, git-ignored, and not used by deploy. It cannot have caused or influenced this.
- I did not change, create or delete any secret or secrets config.

## 5. Original deployment pipeline reconstruction

Times are UTC from the session transcript, the registry (`app list`) and the git log.

| Time (2026-11-19) | Event | Evidence |
|---|---|---|
| 22:31:28 | `npm create deepspace@latest dealproof` under Node 25.2.1 refused, no files changed | LOG |
| 22:31:51 | Same command under Node 24.22.3 succeeded in a scratch directory; installed deepspace 0.44.2 (2 minutes) | LOG |
| before 22:39 | Scaffold present in the project directory (copy step UNKNOWN) | GIT |
| 22:39:15 | Initial commit `eb27aae`, `__APP_ID__` placeholder inside | GIT |
| 22:39:23 | `git push -u origin main` to the existing private GitHub repo (the repo existed before this) | LOG |
| 22:47:21-25 | `auth whoami`, `app init --json`: registered `app_01M7…`, production. Registry `createdAt 22:47:25Z` | LOG, CLI |
| 22:47:28 | Registration committed (`5ad47f4`) and pushed | GIT |
| 22:47:33 | `secrets list`: "No secrets in prd." | LOG |
| 22:47:49-22:50 | `dev start` ran; secret `PRICESAPI_KEY` uploaded 22:49:41Z; `secrets list` confirmed | LOG, CLI |
| 22:54:01 | Commit `57be8bf` | GIT |
| 22:54:05 | **`npx deepspace deploy` #1**: bound secrets read; build 5s; 17 assets collected; DO manifest 6; GitHub claim announced; "shipping the working tree of main (clean)"; 17 files uploaded in 1s; "Deploying..." | LOG |
| 22:54:18 | Registry: route `dealproof.app.space` claimed | CLI |
| ~22:54:34 | **Failed**: "Cloudflare activation may have completed, but its release record is not yet reconciled... could not list script secrets (CF 404)... Rerun deploy without changing its inputs; the server will resume the matching activation and keep a different release fenced off. [release_reconciliation_pending]" | LOG |
| 22:54:36-23:06 | Deploys #2 to #5 (unchanged inputs; one docs-only commit in between): all `release_in_progress`, "Another deploy is already activating... committing now" | LOG |
| 22:56:30 | `status`: Live "never deployed"; `GET /` 200; unauthenticated POST to an action 401 | LOG |
| 23:27 onward | Read-only checks only, repeated through today | docs/deployment-issue.md, CLI |

Stage assessment, using the pipeline the deployment page describes:

| Stage | Result |
|---|---|
| Auth, identity, source claim, durable reservation | Succeeded (registry shows source claimed, route claimed) |
| Build and asset upload | Succeeded (17 of 17) |
| Worker upload and activation | Probably succeeded: the site serves a Worker and the release marker `8c07d69a-…` |
| Secret reconciliation after activation | **Failed** (script-secret listing returned CF 404, 3 attempts) |
| Release ledger write, serving verification, DO wake | Never reached |

Last confirmed successful stage: Worker activation, inferred from the live marker.

Count discrepancy: the earlier `docs/deployment-issue.md` says six deploy attempts in total; the transcript I could parse shows five invocations (one failure plus four `release_in_progress`). One run may be missing from the readable part of the log. It does not change any conclusion.

## 6. Root-cause hypotheses, ranked

Categories: A local configuration, B auth/identity/environment/source, C build/binding, D platform release reservation or reconciliation.

**H1 (D): platform reconciliation failed on a first release and left the activation fenced. Most likely.**
- For: the error text names a platform operation (Cloudflare script-secrets listing, CF 404) after activation; the control plane holds a claimed route, a claimed source and an active app but no release row; the data plane serves a Worker with a release marker; every retry is fenced (`release_in_progress`); 19 hours later nothing resolved by itself; no docs entry or recovery command exists; `rollback` cannot start without a release.
- Against: none found. I cannot see platform logs, so I cannot confirm the cause, only that nothing local is implicated.

**H2 (C/D): first deploy with a user secret already in the store hits a platform path that lists script secrets on a brand-new script.**
- For: the failing step is specifically about user secrets, and our store had one secret before the first deploy.
- Against: the documented flow tells you to put secrets in the store before the first deploy ("Audit the secrets store"). The secret-first order is the documented one. This is a refinement of H1, not an independent local cause. If true, it is a platform bug that any app with a pre-set secret could hit; whether it does is UNKNOWN.

**H3 (B): GitHub source claimed on the first deploy changed the release path.**
- For: unlike the Quickstart's default, the remote existed before the first release, so the first deploy took the GitHub-source branch (no commit lineage, working tree shipped).
- Against: the docs present that as a supported path; the claim itself succeeded (revision 1, route active); the failure came after the source claim, in the secrets step; the docs say the claim is not undone by a later failure and to retry the same deploy. No evidence that source mode touches secret listing.

**H4 (A/B): local configuration error (wrong id/environment/name, build injection, account).** Ruled out on every point in section 1 (rows 4 to 9). The registry, the file and the build agree.

**H5 (behavioural): our retries made it worse.** Unlikely. They were all refused up front without releasing, and stopped after about 12 minutes. One caveat: one retry followed a docs-only commit. The CLI said "without changing inputs"; whether source metadata counts as an input is UNKNOWN. Even bundle-identical re-runs (17 of 17 assets already stored) did not resume the activation.

**H6 (A): scaffolding in a scratch directory and copying, or committing the placeholder before registering.** Harmless. The installation page documents the second case and prescribes `app init`, which was run correctly; the third-party-visible identity is correct.

Important consequence of the CLI's own advice ("rerun without changing its inputs; the server will resume the matching activation and keep a different release fenced off"): the working tree is now very different from the one shipped at 22:54:05Z (commit `57be8bf`). A deploy from today's `HEAD` is, by the CLI's wording, a different release and is predicted to be fenced again. A same-input retry already failed four times. So a retry from `HEAD` carries a low chance of success and no new diagnostic value, unless DeepSpace tells us the stuck activation was cleared.

## 7. Final recommendation

**Option 2: no relevant configuration issue found, likely platform-side; continue the support escalation.** Also, **not Option 3**: the missing diagnostic is DeepSpace-internal (the server's view of release `8c07d69a-…`), not something we can obtain locally.

Another deployment is **not justified now**. There is no new evidence that changes the state; the one documented remedy (rerun with unchanged inputs) was exhausted; and a deploy from `HEAD` would be a "different release" that the server is documented to fence off.

If you later want a retry, it becomes worthwhile only after DeepSpace says the stuck activation was cleared or says a retry is safe. Then:

- **Command:** `npx deepspace deploy` run from the repo root, clean tree on `main`, Node 24 on PATH, no flags (no `--ignore-stale`, `--no-push` or `--rename`).
- **Target:** app `app_01M7TZWJD321CGWEMJGK49RB8C`, name `dealproof`, production, `dealproof.app.space`.
- **What changes:** the Worker is replaced by the Day 5 build; the additive `saved_products` collection is created on first DO cold start (additive migrations are automatic per the docs); the existing `search_cache` and `usage_claims` data is untouched (I have not seen production data; whether any exists on the older live build is UNKNOWN to me, and I did not touch it); the `PRICESAPI_KEY` binding is re-bound from the store; no secret or identity change.
- **Success means all of:** exit 0 with `serving: confirmed`; `releases --json` lists at least one release with `rollbackAvailable: true`; `status` shows a live release; `activity` has events; `logs` stops returning `app_not_deployed`; `/.well-known/deepspace/release.json` changes from `8c07d69a-…` to the new release id; the live JS bundle matches the local build (contains the `saved_products` strings); then an authenticated smoke test using an authorized test account and cached searches only. A bare HTTP 200 is not evidence.
- **If it fails again:** stop after that single attempt, do not loop; save the full output (not through `tail`) and add it to the support report; no `undeploy`, `app init --new-id`, secret deletion or `--ignore-stale`.

Safest next action: wait for the reply to report `8d11d4c4-e418-40eb-9912-3348a9cef234`; ask the questions below (you can add them via the dashboard or `deepspace feedback`, which sends text outside the machine, so it needs your approval and you should run it yourself).

## 8. Questions for DeepSpace support

1. Is `release_reconciliation_pending` a known state, and what is the supported recovery when the ledger has 0 releases but the Worker marker `8c07d69a-b063-4867-ad79-38ba039e40f5` is live?
2. Can you reconcile or release the stuck activation for app `app_01M7TZWJD321CGWEMJGK49RB8C` server-side? What is the server's view of that release (prepared, activated, failed)?
3. Why did the post-activation script-secrets listing return Cloudflare 404 for a script that serves traffic? Is it an eventual-consistency window on a brand-new script, and does it affect other first deploys with a pre-set secret?
4. The CLI says "rerun without changing inputs; the server will resume the matching activation". What counts as an input (bundle bytes, source metadata, commit)? Does a later deploy from newer code count as a "different release" that stays fenced until this one resolves?
5. Does the `wrangler.toml` comment block "DeepSpace detected secrets: none declared" have any effect when the store already holds `PRICESAPI_KEY`?
6. Is the GitHub-source first claim (revision 1) intact and permanent, and does GitHub source change anything in the release-ledger write path?
7. Is it safe for us to run one `npx deepspace deploy` of the current `HEAD` after you reconcile, and should we expect the route claim (`claimedAt 22:54:18Z`, `deployedAt null`) to be reused?
8. Could the docs add `release_reconciliation_pending` to the refusal taxonomy with its remedy?

## 9. Answers to the stop-condition questions

1. **Did we follow the official Quickstart correctly?** Yes in every step that can be checked. Two choices differ from the Quickstart's implicit default (GitHub remote before first deploy; scaffold-in-scratch-then-copy with placeholder committed), and both are covered by the other official pages.
2. **Where did we deviate?** (a) GitHub remote existed before the first deploy, so source claimed GitHub; (b) the placeholder was committed before `app init`; (c) scaffolding happened in a scratch directory with an unrecorded copy step; (d) the first deploy's output was piped through `tail`.
3. **Harmless?** All four. (a) and (b) are documented, supported paths and executed correctly; (c) leaves no trace in identity; (d) only truncated logs.
4. **Could any explain `release_reconciliation_pending`?** None on evidence. The closest is (a), but the failure is in the secret-listing step after the source claim succeeded.
5. **Is GitHub/DeepSpace source correct?** Yes: GitHub, `modicodie/dealproof`, revision 1, matches the local remote.
6. **Is the app id and environment correct?** Yes: `app_01M7TZWJD321CGWEMJGK49RB8C`, production, owner account, no overrides.
7. **Another deployment justified?** No, not until DeepSpace responds or new diagnostics appear. A deploy from `HEAD` is predicted to be fenced.
8. **Safest next action?** Wait for the reply to the existing report and send the Section 8 questions through it; make no deploy and no identity or secret change.
