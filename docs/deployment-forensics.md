# Deployment forensics: `release_reconciliation_pending` on dealproof

Date: 2026-11-20, evidence gathered about 18:45-19:35 UTC. Read-only: no deploy, push, `app init`, rollback, secret read/write, or direct Cloudflare/DeepSpace-internal request. Allowed commands only: read-only CLI status commands, unauthenticated GETs/POSTs to the public site, public docs, the installed package (`node_modules/deepspace`, version 0.44.2, not modified), and a local build of an old commit in a scratch directory outside the repo.
App `app_01M7TZWJD321CGWEMJGK49RB8C`, https://dealproof.app.space, report `8d11d4c4-e418-40eb-9912-3348a9cef234`.
No secret, token, email or `.dev.vars` content appears in this file.

Evidence tags: **[LOG]** session transcript of the original commands; **[CLI]** read-only CLI output today; **[PKG]** installed `deepspace` package (`dist/cli.js`, `CHANGELOG.md`); **[PUB]** public endpoint; **[CF]** Cloudflare public API docs; **[REBUILD]** local rebuild of a commit.
Labels: **CONFIRMED** (direct evidence), **INFERRED** (follows from evidence, not directly observed), **UNKNOWN** (needs DeepSpace).

## 1. Original failure: what is retrievable

Exact output of deploy #1 (22:54:05Z start, result at about 22:54:34Z; stored in the session transcript, 39 lines, captured through `| tail -40`, so it is probably complete but I cannot prove no earlier line was cut) [LOG]:

```
App secrets: PRICESAPI_KEY
Building... Built (5s)
Collected 17 assets
DO manifest: 6 binding(s)
Custom bindings: NATIVE_AUTH_REDIRECT_URIS (plain_text)
This app's source is unclaimed - this deploy's release claims GitHub source (modicodie/dealproof) ... permanently.
GitHub source: shipping the working tree of main (clean).
Deploying dealproof...
Assets: 17 file(s), uploading 17 (649 KiB)
Uploaded 17 file(s) in 1s
Deploying dealproof...
Deploy failed
Cloudflare activation may have completed, but its release record is not yet reconciled.
Authoritative user-secret deletion is incomplete: Worker activated, but authoritative user-secret
deletion is incomplete after 3 attempts: could not list script secrets (CF 404)
Rerun deploy without changing its inputs; the server will resume the matching activation and keep
a different release fenced off. [release_reconciliation_pending]
```

What is **not** recoverable, and cannot be recreated without a new deploy (which is forbidden here):

| Item | Status |
|---|---|
| HTTP status of the deploy response | UNKNOWN (CLI prints only `body.error` and `body.code`) |
| Any nested error fields, Cloudflare error code (such as the numeric `code` in a Cloudflare error envelope), Cloudflare message text | UNKNOWN: not printed, not saved [PKG: the CLI reads only `body.error`, `body.code`] |
| Request IDs, correlation IDs, `cf-ray` | **Not recoverable.** The deploy path in the CLI never reads or prints response headers or IDs (no `x-request-id`, `cf-ray` or correlation handling exists in `dist/cli.js`) [PKG]. The only random ID is a per-run `deployKey`, which the CLI never prints |
| Exact failure timestamp | Approximate: between 22:54:05Z (command start) and 22:54:34Z (output captured), so within a 29-second window. The platform's own timestamp is UNKNOWN |
| The failed deploy's `deployKey` | Gone: it is `randomUUID()` minted per CLI run and not stored [PKG `mintIdempotencyKey`] |

Does the first output show "release record created"? No release row exists: `releases --json` returns `[]`, `activity` returns `[]`, `logs` returns `app_not_deployed` [CLI]. The package changelog (0.18.0) says this is by design: "a release is recorded only after stale bindings, including `ALLOW_DEBUG_ROUTES`, are gone" [PKG CHANGELOG ~line 755-758].

## 2. Where the 404 came from

- **CONFIRMED:** the CLI makes no Cloudflare API calls. `dist/cli.js` has zero references to `api.cloudflare.com`; the deploy is one multipart `POST ${deployUrl}/api/deploy/<appId>` to `deploy-worker.deep.space`, after assets are uploaded to the same service [PKG]. Everything Cloudflare-facing (activation, secret listing, deletion, release recording) runs inside DeepSpace's backend.
- **CONFIRMED:** the sentence "could not list script secrets (CF 404)" was composed by DeepSpace's service. The CLI forwards it verbatim: `formatDeployWorkerError` returns the server's text unchanged for `release_reconciliation_pending` [PKG].
- **UNKNOWN:** whether Cloudflare itself returned HTTP 404, or DeepSpace's code (or an internal proxy) produced or relabelled a "CF 404". The "CF" prefix suggests DeepSpace attributes the status to Cloudflare, but that is DeepSpace's label, not a captured Cloudflare response.
- **UNKNOWN:** which exact operation failed. The text says "list script secrets". Cloudflare has two such operations with different paths [CF]:
  - ordinary: `GET /accounts/{account_id}/workers/scripts/{script_name}/secrets`
  - Workers for Platforms: `GET /accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/secrets`
  DeepSpace deploys into a dispatch namespace [DOC deployment: "uploads it to Cloudflare Workers for Platforms ... registers the worker in the dispatch namespace"], so the second is the correct one. Which one the platform called is not in the message.
- Cloudflare's public docs pages I read document these endpoints and their models but do not document HTTP 404 semantics, permission names, or read-after-write consistency for them [CF]. I looked for consistency/propagation language on the WfP pages I fetched and found none. So Hypothesis H3 cannot be confirmed or rejected from public documentation either.
- Cloudflare status page (public, 50 most recent incidents): nothing reported covering 22:54Z on 2026-11-19. Nearest items: "Observability ingestion delay and query failures" (resolved 21:55Z) and "R2 and Durable Objects availability issues" (02:52-04:35Z on Nov 20). This weakly argues against a general Cloudflare outage, but a status page does not prove the absence of an account- or namespace-scoped problem [PUB].

## 3. Stage timeline

Times UTC, 2026-11-19. "Observed" means the evidence is a direct observation, not inference from a later stage.

| Stage | Time | Classification | Evidence |
|---|---|---|---|
| Local preflight (secrets read from store, DO manifest validation, GitHub-source detection) | 22:54:05+ | Confirmed successful | printed `App secrets: PRICESAPI_KEY`, `DO manifest: 6`, source-claim notice [LOG] |
| Build | 22:54:05 to about :10 | Confirmed successful | "Built (5s)" [LOG] |
| Asset upload | about 22:54:10-:12 | Confirmed successful | "Uploaded 17 file(s) in 1s" [LOG] |
| Server request validation and release reservation | before 22:54:18 | **Inferred** successful | GitHub source claimed (revision 1) and route claimed at 22:54:18Z in the registry [CLI `app list`]; the changelog says both happen after the reservation is accepted [PKG] |
| Resource provisioning (auto bindings) | n/a | Not observed. The app declares no auto-provisioned resources; the log shows only the 6 DO bindings and one plain-text var | LOG |
| Route registration | 22:54:18Z | Confirmed successful | `app list`: `dealproof.app.space` `status: active`, `claimedAt 22:54:18.431Z`, `releasedAt: null` |
| Worker activation | before about 22:54:34 | **Inferred** successful (strong), not directly observed | the CLI text says "Worker activated"; the public site serves a Worker and a release stamp [PUB]; see section 6 |
| Secret reconciliation (list, then delete stale bindings) | about 22:54:2x-:34 | **Confirmed failed** (per the server's message: 3 attempts, "could not list script secrets (CF 404)") | LOG |
| Release recording | never | Confirmed not done | `releases` `[]`, `activity` `[]`, `deployedAt: null` |
| Serving verification (10 consecutive confirmations) | never | Not observed (CLI exited at the failure; no polling happened) | LOG |
| DO wake request / cron arming | never | Not observed | LOG |

Subsequent attempts (all `release_in_progress`, no later stage reached) [LOG]: 22:54:36, about 22:56:26, about 23:00:41, about 23:06. The transcript shows 5 deploy invocations in total (1 failure plus 4 refusals). Earlier notes said 6; I could verify only 5. No deploy has been run since about 23:06Z; every later check was read-only.

## 4. Cloudflare endpoint comparison [CF] and what the evidence says

| | Ordinary Workers | Workers for Platforms (dispatch namespace) |
|---|---|---|
| List secrets | `GET /accounts/{account_id}/workers/scripts/{script_name}/secrets` | `GET /accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/secrets` |
| Script lookup | `.../workers/scripts/{script_name}` | `.../workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}` |
| Settings / bindings | `.../workers/scripts/{script_name}/settings` | `.../dispatch/namespaces/{ns}/scripts/{script_name}/settings` and `/bindings` |

The namespace segment is the only structural difference, and a script uploaded into a namespace is addressed through the namespaced path. Whether the ordinary path would return 404 for a namespaced script is standard Cloudflare behaviour as I understand it, but it is not stated in the pages I fetched, so treat it as unverified background knowledge.
Docs note: the list response model in the reference includes a `text` field described as the secret value; I did not call these endpoints (they can return secret material) and cannot say whether live list responses include values. Not needed for the conclusion.

## 5. Ranked hypotheses (about the 404 itself)

Confidence is my probability estimate from the evidence above, not a measurement. "Where" says who can settle it.

| Rank | Hypothesis | Plausible because | For | Against | What would settle it | Where |
|---|---|---|---|---|---|---|
| 1 | **H3: Worker activated, but the script was not yet observable to the list call** (read-after-write lag on a brand-new script) | First release ever for this script; the call ran seconds after activation; 3 attempts were made in the same short window | Failure occurred on the very first release; the script serves traffic now, so the resource exists | Cloudflare docs I read say nothing about lag for this endpoint; a script that was just uploaded successfully is normally listable; the retries (only up to about 12 minutes later) were refused before any visible re-attempt, so I cannot tell if a later attempt would pass | The platform log of the three attempts (timestamps, HTTP bodies, cf-ray) and whether a manual replay today succeeds | DeepSpace |
| 2 | **H6: the 404 was produced or relabelled by DeepSpace's own service layer** (for example a wrong internal route, a missing internal record, a proxy that maps another failure to "CF 404") | The CLI proves an intermediate service composed the message; "CF 404" is DeepSpace's wording | CONFIRMED that an intermediate service reported it; CLI cannot see what Cloudflare returned | No evidence the 404 was not Cloudflare's | The raw upstream response in platform logs | DeepSpace |
| 3 | **H1: wrong endpoint/resource type** (ordinary `/workers/scripts/...` used for a namespaced script) | Namespaced scripts are addressed through the dispatch path; an ordinary lookup would plausibly 404 | The only structural way to get a clean, repeatable "not found" for a script that demonstrably exists | The same platform successfully activated the script and the reconciliation logic is documented as shipped since 0.18.0 and presumably exercised on many deploys; no evidence of a first-deploy-specific code path | The endpoint URL in the platform request log | DeepSpace |
| 4 | **H2: wrong namespace or script identifier** (for example looking up by app id or old name while the script was uploaded under `dealproof`) | Platform keys apps by id but names scripts by subdomain | Name and id are different strings in this system | The app was never renamed; `name`, route host and registry agree; the same service created the script it then looked up | Identifier used in the lookup vs the upload | DeepSpace |
| 5 | **H4: permissions or visibility** (token can write but not read in the namespace) | A 404 can mask an access problem | Nothing | The same credentials performed the activation; permission failures are normally 403, not 404; no evidence either way | Token scopes and the lookup response body | DeepSpace |
| 6 | **H5 (as stated): lookup failed for another reason and DeepSpace failed to release the reservation** | A retained fence matches what we see | Fence retained after failure is **by design**, not a bug: "retains the per-app release fence on failure" [PKG CHANGELOG 0.18.0]. So "did not release" is expected; the open question is only why the later replays did not recover it (H7) | n/a | n/a | DeepSpace |

No hypothesis in this table is confirmed. The ordering is a judgement; the spread between ranks 1-3 is small.

## 6. The stuck reservation

**H7 (new, from the CLI code): our "exact replays" were probably not exact to the server, so they stayed fenced. Confidence: low to medium (about 30%) as a contributor; CONFIRMED only for the request-field difference, UNKNOWN for the server's hash.**
- The CHANGELOG says the server can resume only when "the complete Worker, secret, attribution, and source lineage hash matches the live operation", and first "proves that exact operation is live at Cloudflare; different input stays fenced" [PKG 0.18.0].
- The CLI generates a **new random `deployKey` per run** [PKG], so the server cannot match by key across runs; it must match by that content hash.
- The first request was sent while the app's source was unclaimed: `observedRepository=modicodie/dealproof`, no `sourceProvider` / `sourceRevision` / `sourceRepository`. Every retry was sent after the claim, so it carries `sourceProvider=github`, `sourceRepository`, `sourceRevision=1`, and no `observedRepository` [PKG `makeForm`, `syncDeployRepository`; registry shows revision 1]. Whether the server normalises these into the same "source lineage" hash is UNKNOWN. If it does not, a retry can never be "the exact deploy", and a first deploy that fails after claiming source cannot be replayed by the CLI at all.
- Alternative explanation for the refusals: the "prove it is live at Cloudflare" step uses the same lookup that returned 404, so resume fails for the same reason. This is consistent with H1-H3 and does not need H7.
- Separately: the retries were refused 2 seconds after the failure (22:54:36 vs 22:54:34), consistent with a fence that is held until a successful replay or an expiry. **No fence timeout or lease expiry is documented anywhere** (official docs, CLI help, CHANGELOG): the only guidance is "wait, retry, then check `releases`" [DOC releases; PKG CLI].
- Since about 23:06Z we have made no attempt, so **the current fence state is untested**: I do not know whether it expires, or whether an exact replay would succeed now. The read-only commands cannot show fence state.

Is the stuck reservation a consequence of the original failure? **Yes, with high confidence (about 85%, INFERRED from design):** the CHANGELOG describes the fence being deliberately retained when reconciliation fails. What is not established is why it has not recovered.

## 7. Production artifact vs release metadata (Investigation D) [PUB, REBUILD]

| Check | Result |
|---|---|
| Public marker `/.well-known/deepspace/release.json` | `{"release":"8c07d69a-b063-4867-ad79-38ba039e40f5"}`, etag `c4f90e24d1d0c0d0f857a3e62217d57b`, unchanged on every read since 2026-11-19 |
| Live main JS | `assets/index-BeHadXul.js`, 488,980 bytes, sha256 `828f4edc3ce95dbd…` |
| Live CSS | `assets/index-DM_xp8dV.css`, 46,753 bytes, sha256 `7c5ef586f9b6bc3e…` |
| Local rebuild of commit `57be8bf` (the exact commit shipped by deploy #1: "shipping the working tree of main (clean)") in a scratch copy | produces `index-BeHadXul.js` and `index-DM_xp8dV.css`; **sha256 identical to the live files** |
| Current HEAD build | `index-Dld1EBIR.js` / `index-CRhB50sj.css`: different |
| Live bundle contains Day 3-5 strings (`saved_products`, `getSavedComparison`, `search_cache`, `usage_claims`, "Lowest reported") | none (0 matches each; note the lazy-loaded route chunks may hold some, but the main bundle matches the rebuild byte-for-byte) |
| Unauthenticated POSTs to `/api/actions/{searchProducts,getSavedComparison,unknownName}` | all 401 `{"error":"Unauthorized"}`, so this cannot tell whether an action exists |
| Local `dist/` of the old build contains `/.well-known/deepspace/release.json`? | No: the stamp is not produced by the build. The CHANGELOG says the platform injects it into every upload [PKG CHANGELOG ~line 1017] |

Answers:
1. **Is the serving Worker from the original partial deployment?** The static assets are **byte-identical to the build of the commit the first deploy shipped**, and no other deploy ever uploaded anything (the later attempts were refused before release). **CONFIRMED for the assets; INFERRED (strong) for the Worker script**, which I cannot read publicly.
2. **Evidence the marker was published before reconciliation finished?** The stamp is injected at upload time and Cloudflare serves assets atomically with their version [PKG CHANGELOG ~1017]. A stamp is served only once that version is live on the script. Combined with "Worker activated" in the error text, this means the marker is published at activation, **before** reconciliation and release recording, which is exactly the observed order. INFERRED, not directly observed.
3. **Is the public app serving a version that never entered the ledger?** **Yes.** CONFIRMED: ledger empty, `deployedAt: null`, and a live marker with the release id of an activation the ledger never recorded.
4. **What distinguishes an incomplete release from an older completed one?** A completed release would appear in `releases` with `seq`, source fields and `rollbackAvailable`, `status` would show a live release, `activity` would have events, and `logs` would not refuse `app_not_deployed`. None holds; and an "older completed release" would imply a ledger row, which does not exist. The only evidence for "incomplete, not older" is the combination: ledger empty + CLI error text naming an activation without a record + 1 deploy ever started.

## 8. What the installed CLI does (Investigation C)

| Question | Finding [PKG] |
|---|---|
| How is a release submitted? | After a preflight (secrets read, build, DO manifest) and an asset-upload step, one multipart `POST /api/deploy/<appId>` to the deploy worker with worker modules, assets manifest, `secretsConfig`, `name`, source fields, `sourceDirty`, `deployKey`. Timeout 240s, 2 attempts, no retry on 5xx |
| What does the CLI know about Cloudflare? | Nothing: no Cloudflare API client; the CLI cannot reach it |
| Where do the Cloudflare operations run? | Server-side in DeepSpace's deploy worker. The reconciliation implementation is not in the package; it is unavailable to us |
| `release_reconciliation_pending` | Printed verbatim as the server's text; no special handling, no retry, no recovery command. It is on the pass-through list with `cli_outdated`, `secrets_read_failed`, `worker_upload_rejected` |
| `release_in_progress` | Exact handling on HTTP 409 with that code: exit 2, message "wait a moment and run the same deploy again; if it keeps refusing for more than a couple of minutes, check `deepspace releases`", action = the same deploy command |
| Timeout or recovery path for a failed reservation | **None documented** in docs, CLI, help or CHANGELOG. The CHANGELOG documents only: exact replay retries deletion with no second activation; a fresh key can resume only on a full-hash match; different input stays fenced |
| Diagnostic flags or read-only status endpoints | None: `deploy --help` has no verbose/debug/trace flag; no deploy-status or fence-status endpoint is referenced. Only `status`, `releases`, `activity`, `logs`, `app list`, `app source` exist (all show the empty ledger) |
| Can request or correlation IDs be recovered? | No. The CLI never reads response headers on the deploy path, and no ID is printed. Only DeepSpace can look the request up, by app id plus time window |

## 9. Safest potential recovery (assessed, nothing performed)

| Option | Who has access | Effect on identity / secrets / records / history | Risk and note |
|---|---|---|---|
| A. DeepSpace server-side reconciliation (replay the retained activation and finish deletion/recording) | DeepSpace only | Keeps identity, secrets, DO data; creates the first ledger row for release `8c07d69a-…` | Lowest risk; matches the design ("release recorded only after stale bindings are gone"). Needs them to confirm the lookup now works |
| B. Clear the stuck reservation (fence) without completing the release | DeepSpace only | Identity, secrets, data kept; the live Worker stays as it is; ledger remains empty until a new deploy | Moderate: leaves an activated-but-unrecorded Worker; a later deploy would then be the first ledger row. Acceptable only after they confirm the root cause is fixed, else the next deploy may fail the same way |
| C. Fix the Cloudflare/namespace lookup mapping (script id, endpoint, permissions) | DeepSpace only (their Cloudflare account) | None on our data | Prerequisite for A and for any future deploy |
| D. Supported retry after platform repair: `npx deepspace deploy` from a clean tree | Us, but only after DeepSpace says so | Replaces the Worker with Day 5 code; additive `saved_products` schema; secrets re-bound from the store; ledger gets its first row if it works | Predicted fenced again unless the server treats it as the matching operation (H7). One attempt, full output saved (not via `tail`), no loop |
| E. Another documented procedure | None found: no recovery for this code in the docs, CLI help or CHANGELOG; `rollback` needs an existing release | n/a | n/a |
| Not recommended: `app undeploy` (documented: destroys Durable Object data), `app init --new-id` / new app (new identity, new data, no recovery of this one; you ruled it out), `--ignore-stale` (skips a guard; not relevant), `secrets` changes (would alter the store the reconciliation compares against), repeated deploys | | | Each can change identity, data or history irreversibly or add noise to the fence state |

## 10. Confirmed vs inferred vs unknown

**Confirmed**
- The CLI never talks to Cloudflare; the 404 statement came from DeepSpace's backend.
- The deploy sequence ran through build, upload, source claim and route claim; the failure is in post-activation secret reconciliation; no release row, no activity, no logs.
- The live JS and CSS are byte-identical to a fresh build of commit `57be8bf`, the commit deploy #1 shipped.
- A release is documented to be recorded only after reconciliation, so an empty ledger is the designed consequence of the failure.
- The fence is documented to be retained on reconciliation failure; no timeout or recovery command is documented.
- Our four retries each used a new random key and, after the source claim, a different set of source fields than the first request.
- No request ID, correlation ID or Cloudflare error code is recoverable from our logs.

**Inferred**
- The Worker was activated (message text, live site, atomic stamp); the marker is published at activation.
- The retained fence is why retries were refused.
- No general Cloudflare outage at that time (status page only).

**Unknown without DeepSpace**
- Which Cloudflare endpoint was called, with which account/namespace/script id; the real response status and body; whether Cloudflare or DeepSpace produced the 404.
- Whether the lookup now succeeds, and whether the fence has an expiry.
- What the server includes in the "resume" hash, and why our exact-bundle retries did not resume.
- The server-side state of release `8c07d69a-…` (prepared/activated/finalizing).
- Whether other apps hit this on a first deploy with a pre-set secret.

## 11. Conclusions (stop-condition answers)

1. **Most likely technical explanation of the 404:** the post-activation "list script secrets" lookup inside DeepSpace's deploy worker failed to find the script on the first release, either because the script was not yet observable (H3) or because DeepSpace's own layer addressed or reported it incorrectly (H6/H1/H2). I cannot choose among them from local evidence.
2. **Strength of the evidence:** weak for the specific cause (no hypothesis above 30%); strong for where the failure sits (post-activation reconciliation, server-side) and for what is not the cause (local configuration, Quickstart steps, secrets exposure, Git/GitHub).
3. **Which side:** **still undetermined.** There is no sign of a Cloudflare outage, and the lookup, the fence and the failed resume are all DeepSpace code, so a DeepSpace orchestration problem is somewhat more likely than a Cloudflare resource problem. That is a lean, not a finding.
4. **Is the stuck reservation a consequence of the original failure?** Probably yes (about 85%). It is documented as deliberate fence retention; what is unexplained is why replays did not recover it (H7 or a failing liveness check).
5. **Only DeepSpace can establish:** the raw failing request and response, the exact endpoint and ids, the fence state and expiry, the resume-hash contents, and whether the platform lookup works now.
6. **Safe new action for us:** none that changes anything. Safe: send the new evidence below, and later re-run the same read-only commands. Not safe: any deploy before DeepSpace responds (predicted fenced; it also gives the fence state no new information). Optionally, if you want to test the replay theory, ask DeepSpace first whether a replay of the exact original input (commit `57be8bf`, same secret store, source now claimed) is something they want us to try. I did not do it.
7. **New evidence worth sending:** see the support update below.

## 12. Concise support update (for `8d11d4c4-e418-40eb-9912-3348a9cef234`; not sent)

> **Update to report 8d11d4c4-e418-40eb-9912-3348a9cef234 (app `app_01M7TZWJD321CGWEMJGK49RB8C`, `dealproof`, production).**
> New analysis, read-only; no further deploys since about 23:06 UTC on 2026-11-19.
> 1. **Public artifact evidence.** The live static assets (`index-BeHadXul.js` sha256 `828f4edc…`, `index-DM_xp8dV.css` sha256 `7c5ef586…`) are byte-identical to a local build of commit `57be8bf`, the commit the first deploy shipped. The public stamp is still release `8c07d69a-b063-4867-ad79-38ba039e40f5`. So the Worker serving traffic is the first deploy's activation, and it has never entered the release ledger (`releases` empty, `activity` empty, `deployedAt: null`, `logs` -> `app_not_deployed`), while the registry shows route `dealproof.app.space` active (claimed 2026-11-19T22:54:18Z) and GitHub source claimed (revision 1).
> 2. **Failure window.** First `deploy` request started about 22:54:05Z and failed by about 22:54:34Z with `release_reconciliation_pending`, text "could not list script secrets (CF 404)" after 3 attempts. The CLI does not print the HTTP status, request id or Cloudflare error code, so we cannot say which Cloudflare endpoint was called (ordinary `/workers/scripts/{name}/secrets` vs the dispatch-namespace path), or whether Cloudflare or a DeepSpace service produced the 404. Please look up the deploy-worker request for this app id in that window.
> 3. **Replays refused.** Four later runs (22:54:36, about 22:56:26, 23:00:41, 23:06Z), each with a fresh random `deployKey`, returned `release_in_progress`. The first request was sent while source was unclaimed (`observedRepository` only); the later ones carried `sourceProvider=github`, `sourceRevision=1`, `sourceRepository`. Does the "complete Worker, secret, attribution and source lineage hash" used for resuming include those fields, and could that difference alone keep a replay fenced?
> 4. **Questions.** What is the server-side state and expiry of the fence for release `8c07d69a-…`? Does the secrets listing succeed now? Can you reconcile or release it server-side? Is a single exact replay from our side welcome after that, and what would you want captured?
> 5. **Not done:** no `undeploy`, `app init --new-id`, secret change, or identity change.

(Do not attach the `.dev.vars` file or anything from `~/.deepspace`; none of the above needs them.)
